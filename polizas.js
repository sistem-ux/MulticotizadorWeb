/* =============================================================
   CONFIGURACIÓN DE SUPABASE
   ============================================================= */
const SUPABASE_URL = 'https://cibtpkpxdrykozujaqba.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_zlp4_HGpTeAQKW55c_pZQA_2HEXRpaC';

const TABLE_POLIZAS = 'polizas';
const TABLE_FRACCIONES = 'fracciones';
const TABLE_CLIENTES = 'clientes';
const TABLE_USUARIOS = 'usuarios';
const TABLE_SUCURSALES = 'sucursales';
const TABLE_ASEGURADORAS = 'aseguradoras';
const TABLE_RAMOS = 'ramos';
const TABLE_PLANES = 'planes';

let supabaseClient = null;

async function initSupabase() {
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return;
  }
  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm');
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (err) {
    console.error('No se pudo importar Supabase:', err);
  }
}

/*
  NOTA: al igual que el resto del sistema, esta pantalla usa la clave
  anónima; el control de acceso real lo hace auth-guard.js.

  NOTA DE DISEÑO (fracciones): se generan en el front (no con triggers de
  base de datos) al registrar la póliza, siguiendo la tabla de frecuencias
  documentada en 23_schema_polizas_fracciones.sql. La prima se reparte en
  partes iguales redondeadas a 2 decimales, y la última fracción absorbe la
  diferencia de redondeo para que la suma cuadre exacto con la prima total.
  Las fechas de inicio de cada fracción se calculan sumando meses a la fecha
  de inicio de vigencia, respetando el día del mes y ajustando al último día
  del mes destino cuando ese día no existe (ej. 31 de enero + 1 mes = 28/29
  de febrero).
*/

function getErrorMessage(error) {
  if (!error) return 'Error desconocido.';
  if (typeof error === 'string') return error;
  const parts = [];
  if (error.message) parts.push(error.message);
  if (error.status) parts.push(`status ${error.status}`);
  if (error.code) parts.push(`code ${error.code}`);
  if (error.details) parts.push(error.details);
  if (error.hint) parts.push(error.hint);
  return parts.filter(Boolean).join(' | ') || JSON.stringify(error);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function formatMoney(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return '—';
  return `$${n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateEs(isoDate) {
  if (!isoDate) return '—';
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

/* Convierte un status a clase CSS válida (espacios -> guiones) */
function statusToClass(status) {
  return (status || '').toLowerCase().trim().replace(/\s+/g, '-');
}

const MESES_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/* =============================================================
   ARITMÉTICA DE FECHAS: suma de meses con ajuste de fin de mes
   ============================================================= */
function addMonthsClamped(isoDate, months) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const totalMonthIndex = (m - 1) + months;
  const targetYear = y + Math.floor(totalMonthIndex / 12);
  const targetMonth0 = ((totalMonthIndex % 12) + 12) % 12; // 0-based, siempre positivo
  const lastDayTargetMonth = new Date(targetYear, targetMonth0 + 1, 0).getDate();
  const day = Math.min(d, lastDayTargetMonth);
  const mm = String(targetMonth0 + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${targetYear}-${mm}-${dd}`;
}

function addDaysIso(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function todayIsoDate() {
  const d = new Date();
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/* Días restantes hasta la fecha fin de vigencia (negativo si ya venció). */
function diasHastaVencimiento(finVigencia) {
  if (!finVigencia) return null;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const [y, m, d] = finVigencia.split('-').map(Number);
  const fin = new Date(y, m - 1, d);
  return Math.round((fin - hoy) / 86400000);
}

/* Estatus efectivo de la póliza: "Vencido" se calcula automáticamente en el
   front (no se persiste en la BD) cuando fin_vigencia ya pasó, sin necesidad
   de ninguna acción manual. No aplica sobre pólizas ya Anuladas, que
   conservan su estatus. */
function getPolizaStatusEfectivo(item) {
  const status = item.status || 'Vigente';
  if (status === 'Anulado') return 'Anulado';
  if (item.fin_vigencia && item.fin_vigencia < todayIsoDate()) return 'Vencido';
  return status;
}

/* =============================================================
   FRECUENCIA DE PAGO -> Cantidad de fracciones e intervalo (meses)
   ============================================================= */
function getFrecuenciaConfig(frecuencia, mensualFracciones) {
  const map = {
    'Anual': { fracciones: 1, intervaloMeses: 12 },
    'Semestral': { fracciones: 2, intervaloMeses: 6 },
    'Cuatrimestral': { fracciones: 3, intervaloMeses: 4 },
    'Trimestral': { fracciones: 4, intervaloMeses: 3 },
    'Bimestral': { fracciones: 6, intervaloMeses: 2 },
    'Mensual': { fracciones: Number(mensualFracciones) || 12, intervaloMeses: 1 },
  };
  return map[frecuencia] || null;
}

/* Genera el arreglo de fracciones (fecha_inicio, fecha_fin, prima) a partir
   de los datos de la póliza. No incluye los campos denormalizados (eso lo
   agrega el caller antes de insertar). */
function generarFracciones({ inicioVigencia, finVigencia, prima, frecuencia, mensualFracciones }) {
  const config = getFrecuenciaConfig(frecuencia, mensualFracciones);
  if (!config) return [];

  const { fracciones: cantidad, intervaloMeses } = config;
  const primaBase = Math.round((prima / cantidad) * 100) / 100;
  const primaUltima = Math.round((prima - primaBase * (cantidad - 1)) * 100) / 100;

  const resultado = [];
  for (let i = 0; i < cantidad; i++) {
    const fechaInicio = addMonthsClamped(inicioVigencia, i * intervaloMeses);
    const esUltima = i === cantidad - 1;
    const fechaFin = esUltima
      ? finVigencia
      : addDaysIso(addMonthsClamped(inicioVigencia, (i + 1) * intervaloMeses), -1);

    resultado.push({
      numero_fraccion: i + 1,
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin,
      prima: esUltima ? primaUltima : primaBase,
    });
  }
  return resultado;
}

/* =============================================================
   FORMATEO DE PRIMA: miles con "." y decimales con ","
   ============================================================= */
function parseMoneyInput(value) {
  if (!value) return 0;
  const cleaned = value.replace(/\./g, '').replace(',', '.').replace(/[^0-9.]/g, '');
  const n = Number(cleaned);
  return Number.isNaN(n) ? 0 : n;
}

function formatMoneyInputLive(value) {
  let cleaned = value.replace(/[^0-9,]/g, '');
  const parts = cleaned.split(',');
  let intPart = parts[0] || '';
  let decPart = parts.length > 1 ? parts[1].slice(0, 2) : '';
  intPart = intPart.replace(/^0+(?=\d)/, '');
  intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return parts.length > 1 ? `${intPart},${decPart}` : intPart;
}

function attachMoneyFormatter(inputEl) {
  inputEl.addEventListener('input', (e) => {
    const input = e.target;
    const cursorFromEnd = input.value.length - input.selectionStart;
    input.value = formatMoneyInputLive(input.value);
    const newPos = Math.max(0, input.value.length - cursorFromEnd);
    input.setSelectionRange(newPos, newPos);
  });
}

/* Usuario actual (auditoría / permisos) — viene de auth-guard.js */
function getCurrentSession() {
  if (typeof getSession !== 'function') return null;
  return getSession();
}
function getCurrentUserLabel() {
  const session = getCurrentSession();
  return session?.fullName || session?.email || null;
}
// Misma convención usada en usuarios.js: cualquier perfil que EMPIECE con
// "administrador" (Administrador Nacional, Administrador de Sucursal, etc.)
// puede cambiar la Sucursal de la póliza. El resto de perfiles no.
function sesionEsAdministrador() {
  const session = getCurrentSession();
  const perfilNombre = (session?.perfil || '').trim().toLowerCase();
  return perfilNombre.startsWith('administrador');
}

document.addEventListener('DOMContentLoaded', async () => {

  /* =========================================================
     ESTADO GENERAL
     ========================================================= */
  let allClientes = [];
  let allUsuarios = [];
  let allSucursales = [];
  let allAseguradoras = [];
  let allRamos = [];
  let allPlanes = [];
  let allPolizas = [];
  let allFracciones = [];

  let confirmResolve = null;
  const notificationTimers = {};

  function showNotification(elementId, message, type = 'success', duration = 3500) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = message;
    el.className = `page-notification page-notification--${type} is-visible`;
    el.style.display = 'block';
    if (notificationTimers[elementId]) clearTimeout(notificationTimers[elementId]);
    notificationTimers[elementId] = setTimeout(() => {
      el.className = 'page-notification';
      el.style.display = 'none';
    }, duration);
  }

  function openConfirmDialog({ title, message, messageHtml, acceptLabel = 'Eliminar' }) {
    const confirmOverlay = document.getElementById('confirmOverlay');
    const confirmTitle = document.getElementById('confirmTitle');
    const confirmMessage = document.getElementById('confirmMessage');
    const confirmAcceptBtn = document.getElementById('confirmAcceptBtn');
    if (!confirmOverlay) return Promise.resolve(false);
    confirmTitle.textContent = title;
    if (messageHtml) { confirmMessage.innerHTML = messageHtml; } else { confirmMessage.textContent = message; }
    confirmAcceptBtn.textContent = acceptLabel;
    confirmOverlay.style.display = 'flex';
    confirmAcceptBtn.focus();
    return new Promise((resolve) => { confirmResolve = resolve; });
  }
  function closeConfirmDialog() {
    const confirmOverlay = document.getElementById('confirmOverlay');
    if (!confirmOverlay) return;
    confirmOverlay.style.display = 'none';
    if (confirmResolve) { confirmResolve(false); confirmResolve = null; }
  }
  const confirmCancelBtn = document.getElementById('confirmCancelBtn');
  const confirmAcceptBtn = document.getElementById('confirmAcceptBtn');
  const confirmOverlay = document.getElementById('confirmOverlay');
  confirmCancelBtn.addEventListener('click', closeConfirmDialog);
  confirmAcceptBtn.addEventListener('click', () => {
    if (confirmResolve) { confirmResolve(true); confirmResolve = null; }
    closeConfirmDialog();
  });
  confirmOverlay.addEventListener('click', (e) => { if (e.target === confirmOverlay) closeConfirmDialog(); });

  function setFieldError(fieldEl, hasError) {
    if (!fieldEl) return;
    fieldEl.classList.toggle('has-error', hasError);
    const errorSpan = fieldEl.querySelector('.field-error');
    if (errorSpan) errorSpan.classList.toggle('is-visible', hasError);
  }
  function showFeedback(elId, message, type = 'error') {
    const el = document.getElementById(elId);
    el.textContent = message;
    el.className = `form-feedback is-visible form-feedback--${type}`;
  }
  function clearFeedback(elId) {
    const el = document.getElementById(elId);
    el.className = 'form-feedback';
    el.textContent = '';
  }
  function sortItems(items, key, direction) {
    const factor = direction === 'desc' ? -1 : 1;
    return [...items].sort((a, b) => {
      const va = (a[key] ?? '').toString().toLowerCase();
      const vb = (b[key] ?? '').toString().toLowerCase();
      return va.localeCompare(vb, 'es', { sensitivity: 'base' }) * factor;
    });
  }
  function updateSortIndicators(headers, currentSort) {
    headers.forEach((th) => {
      const indicator = th.querySelector('.sort-indicator');
      const isActive = th.dataset.sortKey === currentSort.key;
      th.classList.toggle('is-sorted', isActive);
      if (indicator) indicator.textContent = isActive ? (currentSort.direction === 'asc' ? '▲' : '▼') : '';
    });
  }

  /* =========================================================
     PESTAÑAS (ambas siempre visibles/navegables)
     ========================================================= */
  const tabButtons = document.querySelectorAll('.tab-btn');
  const panels = {
    polizas: document.getElementById('panelPolizas'),
    fracciones: document.getElementById('panelFracciones'),
  };
  function activarTab(target) {
    tabButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.tab === target));
    Object.entries(panels).forEach(([key, panel]) => panel.classList.toggle('is-active', key === target));
  }
  tabButtons.forEach((btn) => btn.addEventListener('click', () => activarTab(btn.dataset.tab)));

  /* =========================================================================
     ==========================  COMBO CON BUSCADOR  ============================
     ========================================================================= */
  function setupSearchableCombo({ inputEl, hiddenEl, dropdownEl, getItems, renderLabel, onSelect, onClear }) {
    let highlightedIndex = -1;
    let currentOptions = [];

    function renderDropdown(term) {
      const items = getItems();
      const termLower = (term || '').trim().toLowerCase();
      currentOptions = termLower
        ? items.filter((it) => renderLabel(it).toLowerCase().includes(termLower))
        : items;

      dropdownEl.innerHTML = '';
      if (!currentOptions.length) {
        const empty = document.createElement('div');
        empty.className = 'combo-search__empty';
        empty.textContent = 'Sin resultados.';
        dropdownEl.appendChild(empty);
      } else {
        currentOptions.slice(0, 50).forEach((item, idx) => {
          const opt = document.createElement('div');
          opt.className = 'combo-search__option';
          opt.textContent = renderLabel(item);
          opt.addEventListener('click', () => selectItem(item));
          dropdownEl.appendChild(opt);
        });
      }
      dropdownEl.classList.add('is-open');
      highlightedIndex = -1;
    }

    function selectItem(item) {
      hiddenEl.value = item.id;
      inputEl.value = renderLabel(item);
      dropdownEl.classList.remove('is-open');
      onSelect(item);
    }

    inputEl.addEventListener('focus', () => renderDropdown(inputEl.value));
    inputEl.addEventListener('input', () => {
      if (hiddenEl.value) { hiddenEl.value = ''; if (onClear) onClear(); }
      renderDropdown(inputEl.value);
    });
    inputEl.addEventListener('keydown', (e) => {
      if (!dropdownEl.classList.contains('is-open')) return;
      const optsEls = dropdownEl.querySelectorAll('.combo-search__option');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlightedIndex = Math.min(highlightedIndex + 1, optsEls.length - 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlightedIndex = Math.max(highlightedIndex - 1, 0);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightedIndex >= 0 && currentOptions[highlightedIndex]) selectItem(currentOptions[highlightedIndex]);
        return;
      } else if (e.key === 'Escape') {
        dropdownEl.classList.remove('is-open');
        return;
      }
      optsEls.forEach((el, idx) => el.classList.toggle('is-highlighted', idx === highlightedIndex));
    });
    document.addEventListener('click', (e) => {
      if (!inputEl.contains(e.target) && !dropdownEl.contains(e.target)) {
        dropdownEl.classList.remove('is-open');
      }
    });

    return {
      reset() { inputEl.value = ''; hiddenEl.value = ''; dropdownEl.classList.remove('is-open'); },
      setValue(item) { if (item) selectItem(item); },
      refresh() { if (dropdownEl.classList.contains('is-open')) renderDropdown(inputEl.value); },
    };
  }

  /* =========================================================================
     ============================  MÓDULO PÓLIZAS  ==============================
     ========================================================================= */

  const searchPolizas = document.getElementById('searchPolizas');
  const clearSearchPolizas = document.getElementById('clearSearchPolizas');
  const polizasTableBody = document.getElementById('polizasTableBody');
  const polizasLoading = document.getElementById('polizasLoading');
  const polizasEmpty = document.getElementById('polizasEmpty');
  const openPolizaModalBtn = document.getElementById('openPolizaModalBtn');

  const polizaModalOverlay = document.getElementById('polizaModalOverlay');
  const polizaModalTitle = document.getElementById('polizaModalTitle');
  const polizaModalCloseBtn = document.getElementById('polizaModalCloseBtn');
  const cancelPolizaModalBtn = document.getElementById('cancelPolizaModalBtn');
  const editPolizaBtn = document.getElementById('editPolizaBtn');
  const anularPolizaBtn = document.getElementById('anularPolizaBtn');
  const renovarPolizaBtn = document.getElementById('renovarPolizaBtn');
  const reactivarPolizaBtn = document.getElementById('reactivarPolizaBtn');
  const verFraccionesPolizaBtn = document.getElementById('verFraccionesPolizaBtn');
  const eliminarPolizaBtn = document.getElementById('eliminarPolizaBtn');
  const polizaAccionesTitle = document.getElementById('polizaAccionesTitle');
  const polizaAccionesBox = document.getElementById('polizaAccionesBox');
  const polizaPrimaResumenBox = document.getElementById('polizaPrimaResumenBox');
  const polizaPrimaTotal = document.getElementById('polizaPrimaTotal');
  const polizaPrimaDevengada = document.getElementById('polizaPrimaDevengada');
  const polizaForm = document.getElementById('polizaForm');
  const polizaIdInput = document.getElementById('polizaId');
  const submitPolizaBtn = document.getElementById('submitPolizaBtn');

  const polizaClienteInput = document.getElementById('polizaClienteInput');
  const polizaClienteId = document.getElementById('polizaClienteId');
  const polizaClienteDropdown = document.getElementById('polizaClienteDropdown');
  const btnNuevoClienteDesdePoliza = document.getElementById('btnNuevoClienteDesdePoliza');

  const polizaAsesorInput = document.getElementById('polizaAsesorInput');
  const polizaAsesorId = document.getElementById('polizaAsesorId');
  const polizaAsesorDropdown = document.getElementById('polizaAsesorDropdown');

  const polizaSucursal = document.getElementById('polizaSucursal');
  const polizaSucursalHint = document.getElementById('polizaSucursalHint');

  const polizaAseguradoraInput = document.getElementById('polizaAseguradoraInput');
  const polizaAseguradoraId = document.getElementById('polizaAseguradoraId');
  const polizaAseguradoraDropdown = document.getElementById('polizaAseguradoraDropdown');

  const polizaTipoPoliza = document.getElementById('polizaTipoPoliza');
  const polizaNroPoliza = document.getElementById('polizaNroPoliza');

  const polizaRamoInput = document.getElementById('polizaRamoInput');
  const polizaRamoId = document.getElementById('polizaRamoId');
  const polizaRamoDropdown = document.getElementById('polizaRamoDropdown');

  const fieldPolizaSumaAsegurada = document.getElementById('fieldPolizaSumaAsegurada');
  const polizaSumaAsegurada = document.getElementById('polizaSumaAsegurada');

  const polizaInicioVigencia = document.getElementById('polizaInicioVigencia');
  const polizaFinVigencia = document.getElementById('polizaFinVigencia');
  const polizaPrima = document.getElementById('polizaPrima');

  const polizaFrecuenciaGroup = document.getElementById('polizaFrecuenciaGroup');
  const polizaFrecuenciaBloqueadaHint = document.getElementById('polizaFrecuenciaBloqueadaHint');
  const fieldPolizaMensualFracciones = document.getElementById('fieldPolizaMensualFracciones');
  const polizaMensualFracciones = document.getElementById('polizaMensualFracciones');
  const polizaFraccionesPreview = document.getElementById('polizaFraccionesPreview');

  const fieldPolizaCliente = document.getElementById('fieldPolizaCliente');
  const fieldPolizaAsesor = document.getElementById('fieldPolizaAsesor');
  const fieldPolizaSucursal = document.getElementById('fieldPolizaSucursal');
  const fieldPolizaAseguradora = document.getElementById('fieldPolizaAseguradora');
  const fieldPolizaTipoPoliza = document.getElementById('fieldPolizaTipoPoliza');
  const fieldPolizaNroPoliza = document.getElementById('fieldPolizaNroPoliza');
  const fieldPolizaRamo = document.getElementById('fieldPolizaRamo');
  const fieldPolizaInicioVigencia = document.getElementById('fieldPolizaInicioVigencia');
  const fieldPolizaPrima = document.getElementById('fieldPolizaPrima');
  const fieldPolizaFrecuencia = document.getElementById('fieldPolizaFrecuencia');

  attachMoneyFormatter(polizaPrima);

  /* Nro. Póliza: fuerza mayúsculas, dígitos y "-" */
  polizaNroPoliza.addEventListener('input', (e) => {
    const input = e.target;
    const cursorPos = input.selectionStart;
    const before = input.value.length;
    const cleaned = input.value.toUpperCase().replace(/[^A-Z0-9\-]/g, '');
    input.value = cleaned;
    const diff = cleaned.length - before;
    input.setSelectionRange(cursorPos + diff, cursorPos + diff);
  });

  let isEditModePoliza = false;
  let isReadOnlyPoliza = false;
  let currentPolizaItem = null;
  let filtroClienteId = null; // viene de ?cliente_id= en la URL (botón desde Clientes)

  let currentSortPolizas = { key: 'cliente_nombre', direction: 'asc' };
  const sortableHeadersPolizas = document.querySelectorAll('#polizasTable th.is-sortable');

  const filtroPolizaTipo = document.getElementById('filtroPolizaTipo');
  const filtroPolizaAnio = document.getElementById('filtroPolizaAnio');
  const filtroPolizaMes = document.getElementById('filtroPolizaMes');
  const resetFiltroPoliza = document.getElementById('resetFiltroPoliza');
  let polizaOrigenRenovacion = null;
  // true cuando la póliza en edición tiene al menos una fracción "Cobrado":
  // en ese caso no se permite modificar la frecuencia de pago (ni, por lo
  // tanto, regenerar las fracciones al guardar).
  let frecuenciaBloqueadaPorCobro = false;
  let frecuenciaOriginalPoliza = '';

  /* ---- Panel lateral "Filtros avanzados" ---- */
  const openPolizaFiltrosBtn = document.getElementById('openPolizaFiltrosBtn');
  const closePolizaFiltrosBtn = document.getElementById('closePolizaFiltrosBtn');
  const polizaFiltrosOverlay = document.getElementById('polizaFiltrosOverlay');
  const polizaFiltrosPanel = document.getElementById('polizaFiltrosPanel');

  function abrirPanelFiltrosPoliza() {
    polizaFiltrosPanel.classList.add('is-open');
    polizaFiltrosOverlay.classList.add('is-open');
    polizaFiltrosPanel.setAttribute('aria-hidden', 'false');
  }
  function cerrarPanelFiltrosPoliza() {
    polizaFiltrosPanel.classList.remove('is-open');
    polizaFiltrosOverlay.classList.remove('is-open');
    polizaFiltrosPanel.setAttribute('aria-hidden', 'true');
  }
  openPolizaFiltrosBtn.addEventListener('click', abrirPanelFiltrosPoliza);
  closePolizaFiltrosBtn.addEventListener('click', cerrarPanelFiltrosPoliza);
  polizaFiltrosOverlay.addEventListener('click', cerrarPanelFiltrosPoliza);

  /* ---- Combos ---- */
  const comboCliente = setupSearchableCombo({
    inputEl: polizaClienteInput, hiddenEl: polizaClienteId, dropdownEl: polizaClienteDropdown,
    getItems: () => allClientes,
    renderLabel: (c) => `${c.nombre_cliente} — ${c.identificacion}`,
    onSelect: () => setFieldError(fieldPolizaCliente, false),
  });

  const comboAsesor = setupSearchableCombo({
    inputEl: polizaAsesorInput, hiddenEl: polizaAsesorId, dropdownEl: polizaAsesorDropdown,
    getItems: () => allUsuarios,
    renderLabel: (u) => u.full_name,
    onSelect: (usuario) => {
      setFieldError(fieldPolizaAsesor, false);
      aplicarSucursalDeAsesor(usuario);
    },
  });

  const comboAseguradora = setupSearchableCombo({
    inputEl: polizaAseguradoraInput, hiddenEl: polizaAseguradoraId, dropdownEl: polizaAseguradoraDropdown,
    getItems: () => allAseguradoras,
    renderLabel: (a) => a.nombre,
    onSelect: () => { setFieldError(fieldPolizaAseguradora, false); refrescarSumaAsegurada(); },
  });

  const comboRamo = setupSearchableCombo({
    inputEl: polizaRamoInput, hiddenEl: polizaRamoId, dropdownEl: polizaRamoDropdown,
    getItems: () => allRamos,
    renderLabel: (r) => r.nombre_ramo,
    onSelect: () => { setFieldError(fieldPolizaRamo, false); refrescarSumaAsegurada(); },
  });

  /* ---- Sucursal: autocompletada por Asesor, editable solo para Administrador ---- */
  function poblarSelectSucursal(selectedId) {
    polizaSucursal.innerHTML = '<option value="">Selecciona una sucursal</option>';
    allSucursales.filter((s) => s.status === 'Activo').forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.sucursal;
      polizaSucursal.appendChild(opt);
    });
    if (selectedId) polizaSucursal.value = selectedId;
  }

  function aplicarSucursalDeAsesor(usuario) {
    poblarSelectSucursal(usuario?.sucursal_id || '');
    setFieldError(fieldPolizaSucursal, false);
    const puedeEditar = sesionEsAdministrador();
    polizaSucursal.disabled = !puedeEditar;
    polizaSucursalHint.textContent = puedeEditar
      ? 'Puedes cambiar la sucursal por tu perfil de administrador.'
      : 'Se autocompleta con la sucursal del asesor seleccionado (no editable para tu perfil).';
  }

  /* ---- Suma Asegurada: depende de Ramo.con_suma_asegurada + Aseguradora + Ramo ---- */
  function refrescarSumaAsegurada() {
    const ramo = allRamos.find((r) => r.id === polizaRamoId.value);
    const aseguradoraId = polizaAseguradoraId.value;

    if (!ramo || !ramo.con_suma_asegurada) {
      fieldPolizaSumaAsegurada.style.display = 'none';
      polizaSumaAsegurada.innerHTML = '';
      polizaSumaAsegurada.value = '';
      return;
    }

    fieldPolizaSumaAsegurada.style.display = 'block';

    if (!aseguradoraId) {
      polizaSumaAsegurada.innerHTML = '<option value="">Selecciona primero la aseguradora</option>';
      return;
    }

    const planesFiltrados = allPlanes.filter((p) =>
      p.aseguradora_id === aseguradoraId && p.ramo_id === ramo.id && p.status === 'Activo'
    );

    polizaSumaAsegurada.innerHTML = '<option value="">Selecciona la suma asegurada</option>';
    if (!planesFiltrados.length) {
      polizaSumaAsegurada.innerHTML = '<option value="">No hay planes activos para esta aseguradora y ramo</option>';
      return;
    }

    planesFiltrados
      .sort((a, b) => (a.suma_asegurada || 0) - (b.suma_asegurada || 0))
      .forEach((plan) => {
        const opt = document.createElement('option');
        opt.value = plan.id;
        opt.textContent = `${formatMoney(plan.suma_asegurada)} — ${plan.nombre_plan || ''}`.trim();
        polizaSumaAsegurada.appendChild(opt);
      });
  }

  /* ---- Fin de Vigencia (solo lectura, calculado) ---- */
  function refrescarFinVigencia() {
    if (!polizaInicioVigencia.value) { polizaFinVigencia.value = ''; return; }
    const fin = addMonthsClamped(polizaInicioVigencia.value, 12);
    polizaFinVigencia.value = formatDateEs(fin);
  }
  polizaInicioVigencia.addEventListener('change', () => {
    refrescarFinVigencia();
    refrescarPreviewFracciones();
  });

  /* ---- Frecuencia de pago: selección única simulada con checkboxes ---- */
  let frecuenciaSeleccionada = '';
  polizaFrecuenciaGroup.querySelectorAll('.freq-option').forEach((label) => {
    const checkbox = label.querySelector('input[type="checkbox"]');
    label.addEventListener('click', (e) => {
      e.preventDefault();
      const value = label.dataset.value;
      const yaSeleccionada = frecuenciaSeleccionada === value;
      frecuenciaSeleccionada = yaSeleccionada ? '' : value;

      polizaFrecuenciaGroup.querySelectorAll('.freq-option').forEach((l) => {
        const cb = l.querySelector('input[type="checkbox"]');
        const seleccionado = l.dataset.value === frecuenciaSeleccionada;
        l.classList.toggle('is-selected', seleccionado);
        cb.checked = seleccionado;
      });

      fieldPolizaMensualFracciones.style.display = frecuenciaSeleccionada === 'Mensual' ? 'block' : 'none';
      setFieldError(fieldPolizaFrecuencia, false);
      refrescarPreviewFracciones();
    });
  });
  polizaMensualFracciones.addEventListener('change', refrescarPreviewFracciones);
  polizaPrima.addEventListener('input', refrescarPreviewFracciones);

  function refrescarPreviewFracciones() {
    const inicio = polizaInicioVigencia.value;
    const prima = parseMoneyInput(polizaPrima.value);
    if (!inicio || !prima || !frecuenciaSeleccionada) {
      polizaFraccionesPreview.textContent = 'Selecciona inicio de vigencia, prima y frecuencia para previsualizar las fracciones a generar.';
      return;
    }
    const fin = addMonthsClamped(inicio, 12);
    const fracciones = generarFracciones({
      inicioVigencia: inicio,
      finVigencia: fin,
      prima,
      frecuencia: frecuenciaSeleccionada,
      mensualFracciones: polizaMensualFracciones.value,
    });
    const resumen = fracciones.map((f) => `#${f.numero_fraccion}: ${formatDateEs(f.fecha_inicio)} (${formatMoney(f.prima)})`).join(' · ');
    polizaFraccionesPreview.innerHTML = `<strong>Se generarán ${fracciones.length} fracción(es):</strong><br>${resumen}`;
  }

  /* =========================================================
     FILTROS (Producción / Vencimiento + Año + Mes)
     ========================================================= */
  function getCampoFechaFiltroPoliza() {
    if (filtroPolizaTipo.value === 'Vencimiento') return 'fin_vigencia';
    if (filtroPolizaTipo.value === 'Todos') return null; // sin campo único: se evalúan ambas fechas
    return 'inicio_vigencia';
  }

  function poblarFiltroAniosPoliza() {
    const campo = getCampoFechaFiltroPoliza();
    const campos = campo ? [campo] : ['inicio_vigencia', 'fin_vigencia'];
    const anioActual = new Date().getFullYear();
    const anios = allPolizas
      .flatMap((p) => campos.map((c) => (p[c] ? Number(p[c].slice(0, 4)) : null)))
      .filter((y) => Number.isInteger(y));
    const anioMin = anios.length ? Math.min(...anios, anioActual) : anioActual;
    const anioMax = anios.length ? Math.max(...anios, anioActual) : anioActual;

    const valorPrevio = filtroPolizaAnio.value || 'Todos';
    filtroPolizaAnio.innerHTML = '<option value="Todos">Todos</option>';
    for (let y = anioMax; y >= anioMin; y--) {
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = String(y);
      filtroPolizaAnio.appendChild(opt);
    }
    filtroPolizaAnio.value = [...filtroPolizaAnio.options].some((o) => o.value === valorPrevio)
      ? valorPrevio
      : 'Todos';
  }

  /* "Ejecutivo" = usuarios con perfil Colaborador, Administrador Nacional o
     Administrador Sucursal (misma convención de esPerfilAdministrador /
     esPerfilColaborador usada en usuarios.js, basada en el campo legacy
     "perfil"). */
  function getEjecutivos() {
    return allUsuarios.filter((u) => {
      const perfilNombre = (u.perfil || '').trim().toLowerCase();
      return perfilNombre.startsWith('administrador') || perfilNombre === 'colaborador';
    });
  }

  /* =========================================================================
     ==================  COMBO CON BUSCADOR Y MULTI-SELECCIÓN  ==================
     Usado por los criterios Sucursal / Ejecutivo / Asesor del panel de
     "Filtros avanzados" de Pólizas: permite elegir varios valores (chips),
     con buscador de texto sobre la lista de opciones disponibles.
     ========================================================================= */
  function setupMultiSelectCombo({ inputEl, chipsEl, dropdownEl, getItems, getId, renderLabel, onChange, allOptionLabel }) {
    let selectedIds = [];

    function renderChips() {
      chipsEl.innerHTML = '';
      const items = getItems();
      selectedIds.forEach((id) => {
        const item = items.find((it) => getId(it) === id);
        if (!item) return;
        const chip = document.createElement('span');
        chip.className = 'ms-chip';
        const label = document.createElement('span');
        label.textContent = renderLabel(item);
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.setAttribute('aria-label', 'Quitar');
        removeBtn.textContent = '✕';
        removeBtn.addEventListener('click', () => {
          selectedIds = selectedIds.filter((v) => v !== id);
          renderChips();
          renderDropdown(inputEl.value);
          onChange();
        });
        chip.appendChild(label);
        chip.appendChild(removeBtn);
        chipsEl.appendChild(chip);
      });
    }

    function renderDropdown(term) {
      const items = getItems();
      const termLower = (term || '').trim().toLowerCase();
      const filtered = termLower ? items.filter((it) => renderLabel(it).toLowerCase().includes(termLower)) : items;

      dropdownEl.innerHTML = '';
      if (allOptionLabel) {
        const allOpt = document.createElement('div');
        allOpt.className = 'combo-search__option ms-option ms-option--all' + (selectedIds.length === 0 ? ' is-selected' : '');
        const allCheck = document.createElement('span');
        allCheck.className = 'ms-option__check';
        allCheck.textContent = selectedIds.length === 0 ? '✓' : '';
        const allLabel = document.createElement('span');
        allLabel.textContent = allOptionLabel;
        allOpt.appendChild(allCheck);
        allOpt.appendChild(allLabel);
        allOpt.addEventListener('click', () => {
          selectedIds = [];
          renderChips();
          renderDropdown(inputEl.value);
          onChange();
        });
        dropdownEl.appendChild(allOpt);
      }
      if (!filtered.length) {
        const empty = document.createElement('div');
        empty.className = 'combo-search__empty';
        empty.textContent = 'Sin resultados.';
        dropdownEl.appendChild(empty);
      } else {
        filtered.slice(0, 50).forEach((item) => {
          const id = getId(item);
          const isSel = selectedIds.includes(id);
          const opt = document.createElement('div');
          opt.className = 'combo-search__option ms-option' + (isSel ? ' is-selected' : '');
          const check = document.createElement('span');
          check.className = 'ms-option__check';
          check.textContent = isSel ? '✓' : '';
          const label = document.createElement('span');
          label.textContent = renderLabel(item);
          opt.appendChild(check);
          opt.appendChild(label);
          opt.addEventListener('click', () => {
            selectedIds = isSel ? selectedIds.filter((v) => v !== id) : [...selectedIds, id];
            renderChips();
            renderDropdown(inputEl.value);
            onChange();
          });
          dropdownEl.appendChild(opt);
        });
      }
      dropdownEl.classList.add('is-open');
    }

    inputEl.addEventListener('focus', () => renderDropdown(inputEl.value));
    inputEl.addEventListener('input', () => renderDropdown(inputEl.value));
    document.addEventListener('click', (e) => {
      if (!inputEl.contains(e.target) && !dropdownEl.contains(e.target) && !chipsEl.contains(e.target)) {
        dropdownEl.classList.remove('is-open');
      }
    });

    return {
      getValues() { return selectedIds; },
      reset() {
        selectedIds = [];
        inputEl.value = '';
        renderChips();
        dropdownEl.classList.remove('is-open');
      },
      /* Quita de la selección los ids que ya no existan en getItems() (tras
         un cambio en cascada, p.ej. al cambiar la Sucursal seleccionada).
         Devuelve true si hubo algún cambio. */
      prune() {
        const validIds = new Set(getItems().map(getId));
        const before = selectedIds.length;
        selectedIds = selectedIds.filter((id) => validIds.has(id));
        renderChips();
        return selectedIds.length !== before;
      },
    };
  }

  /* ---- Criterios Sucursal / Ejecutivo / Asesor (panel "Filtros avanzados"
     de Pólizas), en cascada:
     Sucursal -> acota las opciones de Ejecutivo y Asesor a esa(s) sucursal(es).
     Ejecutivo -> acota las opciones de Asesor a los asesores de ese(esos) ejecutivo(s). ---- */
  const filtroPolizaSucursalInput = document.getElementById('filtroPolizaSucursalInput');
  const filtroPolizaSucursalChips = document.getElementById('filtroPolizaSucursalChips');
  const filtroPolizaSucursalDropdown = document.getElementById('filtroPolizaSucursalDropdown');

  const filtroPolizaEjecutivoInput = document.getElementById('filtroPolizaEjecutivoInput');
  const filtroPolizaEjecutivoChips = document.getElementById('filtroPolizaEjecutivoChips');
  const filtroPolizaEjecutivoDropdown = document.getElementById('filtroPolizaEjecutivoDropdown');

  const filtroPolizaAsesorInput = document.getElementById('filtroPolizaAsesorInput');
  const filtroPolizaAsesorChips = document.getElementById('filtroPolizaAsesorChips');
  const filtroPolizaAsesorDropdown = document.getElementById('filtroPolizaAsesorDropdown');

  const filtroPolizaAseguradoraInput = document.getElementById('filtroPolizaAseguradoraInput');
  const filtroPolizaAseguradoraChips = document.getElementById('filtroPolizaAseguradoraChips');
  const filtroPolizaAseguradoraDropdown = document.getElementById('filtroPolizaAseguradoraDropdown');

  const comboFiltroSucursal = setupMultiSelectCombo({
    inputEl: filtroPolizaSucursalInput, chipsEl: filtroPolizaSucursalChips, dropdownEl: filtroPolizaSucursalDropdown,
    getItems: () => allSucursales,
    getId: (s) => s.id,
    renderLabel: (s) => s.sucursal,
    onChange: () => {
      comboFiltroEjecutivo.prune();
      comboFiltroAsesor.prune();
      applyFilterPolizas();
    },
  });

  const comboFiltroEjecutivo = setupMultiSelectCombo({
    inputEl: filtroPolizaEjecutivoInput, chipsEl: filtroPolizaEjecutivoChips, dropdownEl: filtroPolizaEjecutivoDropdown,
    getItems: () => {
      const sucursalSel = comboFiltroSucursal.getValues();
      return getEjecutivos().filter((u) => !sucursalSel.length || sucursalSel.includes(u.sucursal_id));
    },
    getId: (u) => u.id,
    renderLabel: (u) => u.full_name,
    onChange: () => {
      comboFiltroAsesor.prune();
      applyFilterPolizas();
    },
  });

  const comboFiltroAsesor = setupMultiSelectCombo({
    inputEl: filtroPolizaAsesorInput, chipsEl: filtroPolizaAsesorChips, dropdownEl: filtroPolizaAsesorDropdown,
    getItems: () => {
      const sucursalSel = comboFiltroSucursal.getValues();
      const ejecutivoSel = comboFiltroEjecutivo.getValues();
      return allUsuarios.filter((u) =>
        (!sucursalSel.length || sucursalSel.includes(u.sucursal_id)) &&
        (!ejecutivoSel.length || ejecutivoSel.includes(u.ejecutivo_id))
      );
    },
    getId: (u) => u.id,
    renderLabel: (u) => u.full_name,
    onChange: () => applyFilterPolizas(),
  });

  const comboFiltroAseguradora = setupMultiSelectCombo({
    inputEl: filtroPolizaAseguradoraInput, chipsEl: filtroPolizaAseguradoraChips, dropdownEl: filtroPolizaAseguradoraDropdown,
    getItems: () => allAseguradoras,
    getId: (a) => a.id,
    renderLabel: (a) => a.nombre,
    allOptionLabel: 'Todas las aseguradoras',
    onChange: () => applyFilterPolizas(),
  });

  function resetearFiltroPoliza() {
    filtroPolizaTipo.value = 'Todos';
    poblarFiltroAniosPoliza();
    filtroPolizaAnio.value = 'Todos';
    filtroPolizaMes.value = 'Todos';
    comboFiltroSucursal.reset();
    comboFiltroEjecutivo.reset();
    comboFiltroAsesor.reset();
    comboFiltroAseguradora.reset();
    applyFilterPolizas();
  }

  filtroPolizaTipo.addEventListener('change', () => {
    poblarFiltroAniosPoliza();
    applyFilterPolizas();
  });
  filtroPolizaAnio.addEventListener('change', applyFilterPolizas);
  filtroPolizaMes.addEventListener('change', applyFilterPolizas);
  resetFiltroPoliza.addEventListener('click', resetearFiltroPoliza);

  /* =========================================================
     MODAL PÓLIZA: abrir / cerrar
     ========================================================= */
  function resetPolizaFormUI() {
    comboCliente.reset();
    comboAsesor.reset();
    comboAseguradora.reset();
    comboRamo.reset();
    poblarSelectSucursal('');
    polizaSucursal.disabled = true;
    polizaSucursalHint.textContent = 'Se autocompleta con la sucursal del asesor seleccionado.';
    fieldPolizaSumaAsegurada.style.display = 'none';
    polizaSumaAsegurada.innerHTML = '';
    polizaFinVigencia.value = '';
    frecuenciaSeleccionada = '';
    polizaFrecuenciaGroup.querySelectorAll('.freq-option').forEach((l) => {
      l.classList.remove('is-selected');
      l.querySelector('input[type="checkbox"]').checked = false;
    });
    fieldPolizaMensualFracciones.style.display = 'none';
    polizaMensualFracciones.value = '12';
    polizaFraccionesPreview.textContent = 'Selecciona inicio de vigencia, prima y frecuencia para previsualizar las fracciones a generar.';
    [fieldPolizaCliente, fieldPolizaAsesor, fieldPolizaSucursal, fieldPolizaAseguradora, fieldPolizaTipoPoliza,
     fieldPolizaNroPoliza, fieldPolizaRamo, fieldPolizaInicioVigencia, fieldPolizaPrima, fieldPolizaFrecuencia]
      .forEach((f) => setFieldError(f, false));
  }

  /* Prima Total / Prima Devengada: se calculan en el front a partir de las
     fracciones asociadas (no se persisten en la BD, solo son de lectura y
     únicamente se muestran en el detalle de la póliza). */
  function refrescarPrimaResumen(polizaId) {
    const fraccionesPoliza = allFracciones.filter((f) => f.poliza_id === polizaId);
    const primaTotal = fraccionesPoliza.reduce((sum, f) => sum + Number(f.prima || 0), 0);
    const primaDevengada = fraccionesPoliza
      .filter((f) => f.status === 'Cobrado')
      .reduce((sum, f) => sum + Number(f.prima || 0), 0);
    polizaPrimaTotal.value = formatMoney(primaTotal);
    polizaPrimaDevengada.value = formatMoney(primaDevengada);
  }

  function openPolizaModal({ edit = false, item = null, readOnly = false, clientePreseleccionado = null, renewFrom = null } = {}) {
    isEditModePoliza = edit;
    isReadOnlyPoliza = readOnly;
    currentPolizaItem = item;
    polizaOrigenRenovacion = null;

    polizaForm.reset();
    clearFeedback('polizaFormFeedback');
    resetPolizaFormUI();

    if (item) {
      polizaModalTitle.textContent = 'Ver Póliza';
      polizaIdInput.value = item.id;

      const cliente = allClientes.find((c) => c.id === item.cliente_id);
      if (cliente) comboCliente.setValue(cliente);
      const asesor = allUsuarios.find((u) => u.id === item.asesor_id);
      if (asesor) { polizaAsesorInput.value = asesor.full_name; polizaAsesorId.value = asesor.id; }
      poblarSelectSucursal(item.sucursal_id);
      const aseguradora = allAseguradoras.find((a) => a.id === item.aseguradora_id);
      if (aseguradora) { polizaAseguradoraInput.value = aseguradora.nombre; polizaAseguradoraId.value = aseguradora.id; }
      polizaTipoPoliza.value = item.tipo_poliza;
      polizaNroPoliza.value = item.nro_poliza;
      const ramo = allRamos.find((r) => r.id === item.ramo_id);
      if (ramo) { polizaRamoInput.value = ramo.nombre_ramo; polizaRamoId.value = ramo.id; }
      refrescarSumaAsegurada();
      if (item.plan_id) polizaSumaAsegurada.value = item.plan_id;
      polizaInicioVigencia.value = item.inicio_vigencia;
      refrescarFinVigencia();
      polizaPrima.value = formatMoneyInputLive(String(item.prima).replace('.', ','));

      const freqLabel = polizaFrecuenciaGroup.querySelector(`.freq-option[data-value="${item.frecuencia_pago}"]`);
      if (freqLabel) {
        frecuenciaSeleccionada = item.frecuencia_pago;
        freqLabel.classList.add('is-selected');
        freqLabel.querySelector('input[type="checkbox"]').checked = true;
      }
      if (item.frecuencia_pago === 'Mensual') {
        fieldPolizaMensualFracciones.style.display = 'block';
        polizaMensualFracciones.value = String(item.mensual_fracciones || 12);
      }
      refrescarPreviewFracciones();

      // Frecuencia de pago: solo se puede modificar si NINGUNA fracción
      // asociada está "Cobrado". Si hay al menos una cobrada, se bloquea
      // (aunque el resto del formulario esté en modo edición).
      frecuenciaOriginalPoliza = item.frecuencia_pago;
      {
        const fraccionesPolizaLock = allFracciones.filter((f) => f.poliza_id === item.id);
        frecuenciaBloqueadaPorCobro = fraccionesPolizaLock.some((f) => f.status === 'Cobrado');
      }
      aplicarBloqueoFrecuencia();

      // Modo Ver siempre por defecto; "Editar" lo reactiva
      setPolizaFormDisabled(readOnly);
      editPolizaBtn.style.display = readOnly && item.status !== 'Anulado' ? 'inline-flex' : 'none';
      submitPolizaBtn.style.display = readOnly ? 'none' : 'inline-flex';
      submitPolizaBtn.textContent = 'Guardar Cambios';
      polizaModalOverlay.querySelector('.modal').classList.toggle('modal--readonly', readOnly);
      if (!readOnly) polizaModalTitle.textContent = 'Editar Póliza';

      // "Prima de cada Recibo" solo se muestra al registrar/editar; en el
      // detalle (Ver) se reemplaza por Prima Total / Prima Devengada.
      fieldPolizaPrima.style.display = readOnly ? 'none' : 'block';

      // Prima Total / Prima Devengada + accesos rápidos: solo en el detalle (Ver)
      polizaPrimaResumenBox.style.display = readOnly ? 'grid' : 'none';
      if (readOnly) refrescarPrimaResumen(item.id);
      verFraccionesPolizaBtn.style.display = readOnly ? 'inline-flex' : 'none';
      {
        const statusEfectivo = getPolizaStatusEfectivo(item);
        const fraccionesPoliza = allFracciones.filter((f) => f.poliza_id === item.id);
        const tieneFraccionesCobradas = fraccionesPoliza.some((f) => f.status === 'Cobrado');
        const tieneFraccionesPorCobrar = fraccionesPoliza.some((f) => f.status === 'Por Cobrar');
        const dias = diasHastaVencimiento(item.fin_vigencia);

        // Eliminar: solo si la póliza está Vigente y no tiene fracciones ya cobradas.
        eliminarPolizaBtn.style.display = (readOnly && statusEfectivo === 'Vigente' && !tieneFraccionesCobradas) ? 'inline-flex' : 'none';

        // Anular: solo si la póliza está Vigente y aún tiene fracciones por cobrar.
        anularPolizaBtn.style.display = (readOnly && statusEfectivo === 'Vigente' && tieneFraccionesPorCobrar) ? 'inline-flex' : 'none';

        // Renovar: Vigente dentro de los 90 días previos al vencimiento, o ya Vencida.
        const puedeRenovar = (statusEfectivo === 'Vigente' && dias !== null && dias <= 90) || statusEfectivo === 'Vencido';
        renovarPolizaBtn.style.display = (readOnly && puedeRenovar) ? 'inline-flex' : 'none';

        reactivarPolizaBtn.style.display = (readOnly && statusEfectivo === 'Vencido') ? 'inline-flex' : 'none';
      }
      polizaAccionesTitle.style.display = readOnly ? 'block' : 'none';
      polizaAccionesBox.style.display = readOnly ? 'flex' : 'none';
    } else {
      polizaModalTitle.textContent = renewFrom ? 'Renovar Póliza' : 'Registrar Póliza';
      submitPolizaBtn.textContent = renewFrom ? 'Registrar Renovación' : 'Registrar';
      polizaIdInput.value = '';
      setPolizaFormDisabled(false);
      editPolizaBtn.style.display = 'none';
      anularPolizaBtn.style.display = 'none';
      renovarPolizaBtn.style.display = 'none';
      reactivarPolizaBtn.style.display = 'none';
      verFraccionesPolizaBtn.style.display = 'none';
      eliminarPolizaBtn.style.display = 'none';
      polizaAccionesTitle.style.display = 'none';
      polizaAccionesBox.style.display = 'none';
      polizaPrimaResumenBox.style.display = 'none';
      fieldPolizaPrima.style.display = 'block';
      frecuenciaBloqueadaPorCobro = false;
      frecuenciaOriginalPoliza = '';
      aplicarBloqueoFrecuencia();
      submitPolizaBtn.style.display = 'inline-flex';
      polizaModalOverlay.querySelector('.modal').classList.remove('modal--readonly');

      if (clientePreseleccionado) comboCliente.setValue(clientePreseleccionado);
      if (renewFrom) prellenarRenovacion(renewFrom);
    }

    polizaModalOverlay.classList.add('is-open');
  }

  /* ---- Renovación: prellenar datos de la póliza anterior y bloquear
     los campos que no se deben editar en una renovación ---- */
  function prellenarRenovacion(original) {
    polizaOrigenRenovacion = original;

    const cliente = allClientes.find((c) => c.id === original.cliente_id);
    if (cliente) comboCliente.setValue(cliente);

    const asesor = allUsuarios.find((u) => u.id === original.asesor_id);
    if (asesor) { polizaAsesorInput.value = asesor.full_name; polizaAsesorId.value = asesor.id; }

    poblarSelectSucursal(original.sucursal_id);

    const aseguradora = allAseguradoras.find((a) => a.id === original.aseguradora_id);
    if (aseguradora) { polizaAseguradoraInput.value = aseguradora.nombre; polizaAseguradoraId.value = aseguradora.id; }

    polizaTipoPoliza.value = 'Renovación';
    polizaNroPoliza.value = original.nro_poliza;

    const ramo = allRamos.find((r) => r.id === original.ramo_id);
    if (ramo) { polizaRamoInput.value = ramo.nombre_ramo; polizaRamoId.value = ramo.id; }
    refrescarSumaAsegurada();
    if (original.plan_id) polizaSumaAsegurada.value = original.plan_id;

    if (original.fin_vigencia) {
      polizaInicioVigencia.value = original.fin_vigencia;
      refrescarFinVigencia();
    }

    // Prima vacía y frecuencia sin seleccionar: el usuario debe registrarlas
    polizaPrima.value = '';
    refrescarPreviewFracciones();

    [fieldPolizaCliente, fieldPolizaAsesor, fieldPolizaSucursal, fieldPolizaAseguradora,
     fieldPolizaTipoPoliza, fieldPolizaNroPoliza].forEach((f) => setFieldError(f, false));

    // Campos que se mantienen igual a la póliza anterior: no se editan
    polizaClienteInput.disabled = true;
    btnNuevoClienteDesdePoliza.disabled = true;
    polizaAsesorInput.disabled = true;
    polizaSucursal.disabled = true;
    polizaAseguradoraInput.disabled = true;
    polizaTipoPoliza.disabled = true;
    polizaNroPoliza.disabled = true;
    polizaRamoInput.disabled = true;

    polizaSucursalHint.textContent = 'Se mantiene la sucursal de la póliza original (renovación).';
  }

  function openRenovarPolizaModal(item) {
    openPolizaModal({ edit: false, renewFrom: item });
  }

  let polizaFormDisabledActual = true;

  // Aplica el estado visual/interactivo del grupo de Frecuencia de Pago,
  // combinando el estado general del formulario (disabled) con el bloqueo
  // específico por fracciones ya cobradas (frecuenciaBloqueadaPorCobro).
  function aplicarBloqueoFrecuencia() {
    const bloqueado = polizaFormDisabledActual || frecuenciaBloqueadaPorCobro;
    polizaFrecuenciaGroup.style.pointerEvents = bloqueado ? 'none' : 'auto';
    polizaFrecuenciaGroup.style.opacity = bloqueado ? '0.7' : '1';
    fieldPolizaMensualFracciones.style.pointerEvents = frecuenciaBloqueadaPorCobro ? 'none' : 'auto';
    polizaFrecuenciaBloqueadaHint.style.display = (!polizaFormDisabledActual && frecuenciaBloqueadaPorCobro) ? 'block' : 'none';
  }

  function setPolizaFormDisabled(disabled) {
    polizaFormDisabledActual = disabled;
    [polizaClienteInput, polizaAsesorInput, polizaAseguradoraInput, polizaRamoInput, polizaTipoPoliza,
     polizaNroPoliza, polizaSumaAsegurada, polizaInicioVigencia, polizaPrima, polizaMensualFracciones]
      .forEach((el) => { el.disabled = disabled; });
    btnNuevoClienteDesdePoliza.disabled = disabled;
    polizaSucursal.disabled = disabled ? true : !sesionEsAdministrador();
    aplicarBloqueoFrecuencia();
  }

  function submitPolizaBtnIdleLabel() {
    if (isEditModePoliza) return 'Guardar Cambios';
    return polizaOrigenRenovacion ? 'Registrar Renovación' : 'Registrar';
  }

  function closePolizaModal() {
    polizaModalOverlay.classList.remove('is-open');
    polizaForm.reset();
    currentPolizaItem = null;
    polizaOrigenRenovacion = null;
  }

  openPolizaModalBtn.addEventListener('click', () => {
    const clientePre = filtroClienteId ? allClientes.find((c) => c.id === filtroClienteId) : null;
    openPolizaModal({ edit: false, clientePreseleccionado: clientePre });
  });
  polizaModalCloseBtn.addEventListener('click', closePolizaModal);
  cancelPolizaModalBtn.addEventListener('click', closePolizaModal);
  polizaModalOverlay.addEventListener('click', (e) => { if (e.target === polizaModalOverlay) closePolizaModal(); });
  editPolizaBtn.addEventListener('click', () => {
    if (!currentPolizaItem) return;
    openPolizaModal({ edit: true, item: currentPolizaItem, readOnly: false });
  });
  verFraccionesPolizaBtn.addEventListener('click', () => {
    if (currentPolizaItem) openVerFraccionesModal(currentPolizaItem);
  });
  anularPolizaBtn.addEventListener('click', () => {
    if (currentPolizaItem) openAnularPolizaModal(currentPolizaItem);
  });
  renovarPolizaBtn.addEventListener('click', () => {
    if (!currentPolizaItem) return;
    const item = currentPolizaItem;
    closePolizaModal();
    openRenovarPolizaModal(item);
  });
  eliminarPolizaBtn.addEventListener('click', () => {
    if (currentPolizaItem) handleDeletePoliza(currentPolizaItem);
  });
  reactivarPolizaBtn.addEventListener('click', () => {
    if (currentPolizaItem) handleReactivarPoliza(currentPolizaItem);
  });

  /* =========================================================
     VALIDACIÓN Y GUARDADO
     ========================================================= */
  function validatePolizaForm() {
    let valid = true;

    const clienteOk = !!polizaClienteId.value;
    setFieldError(fieldPolizaCliente, !clienteOk); if (!clienteOk) valid = false;

    const asesorOk = !!polizaAsesorId.value;
    setFieldError(fieldPolizaAsesor, !asesorOk); if (!asesorOk) valid = false;

    const sucursalOk = !!polizaSucursal.value;
    setFieldError(fieldPolizaSucursal, !sucursalOk); if (!sucursalOk) valid = false;

    const aseguradoraOk = !!polizaAseguradoraId.value;
    setFieldError(fieldPolizaAseguradora, !aseguradoraOk); if (!aseguradoraOk) valid = false;

    const tipoOk = !!polizaTipoPoliza.value;
    setFieldError(fieldPolizaTipoPoliza, !tipoOk); if (!tipoOk) valid = false;

    const nroOk = /^[A-Z0-9\-]+$/.test(polizaNroPoliza.value.trim());
    setFieldError(fieldPolizaNroPoliza, !nroOk); if (!nroOk) valid = false;

    const ramoOk = !!polizaRamoId.value;
    setFieldError(fieldPolizaRamo, !ramoOk); if (!ramoOk) valid = false;

    const ramoSeleccionado = allRamos.find((r) => r.id === polizaRamoId.value);
    if (ramoSeleccionado?.con_suma_asegurada) {
      const sumaOk = !!polizaSumaAsegurada.value;
      setFieldError(fieldPolizaSumaAsegurada, !sumaOk); if (!sumaOk) valid = false;
    }

    const inicioOk = !!polizaInicioVigencia.value;
    setFieldError(fieldPolizaInicioVigencia, !inicioOk); if (!inicioOk) valid = false;

    const primaOk = parseMoneyInput(polizaPrima.value) > 0;
    setFieldError(fieldPolizaPrima, !primaOk); if (!primaOk) valid = false;

    const frecuenciaOk = !!frecuenciaSeleccionada;
    setFieldError(fieldPolizaFrecuencia, !frecuenciaOk); if (!frecuenciaOk) valid = false;

    return valid;
  }

  polizaForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isReadOnlyPoliza) return;
    clearFeedback('polizaFormFeedback');

    if (!validatePolizaForm()) {
      showFeedback('polizaFormFeedback', 'Revisa los campos marcados antes de continuar.', 'error');
      return;
    }
    if (!supabaseClient) {
      showFeedback('polizaFormFeedback', 'No se pudo conectar con Supabase.', 'error');
      return;
    }

    submitPolizaBtn.disabled = true;
    submitPolizaBtn.textContent = isEditModePoliza ? 'Guardando...' : 'Registrando...';

    const currentUser = getCurrentUserLabel();
    const inicio = polizaInicioVigencia.value;
    const fin = addMonthsClamped(inicio, 12);
    const prima = parseMoneyInput(polizaPrima.value);
    const ramoSeleccionado = allRamos.find((r) => r.id === polizaRamoId.value);
    const planSeleccionado = ramoSeleccionado?.con_suma_asegurada
      ? allPlanes.find((p) => p.id === polizaSumaAsegurada.value)
      : null;

    // Si la póliza tiene fracciones cobradas, la frecuencia queda bloqueada
    // en la UI: se conserva la frecuencia/cantidad de fracciones original y
    // NO se regeneran las fracciones. Si no está bloqueada (registro nuevo,
    // o edición sin fracciones cobradas), se usa lo seleccionado en el
    // formulario y se regeneran las fracciones acorde a la frecuencia.
    const bloqueado = isEditModePoliza && frecuenciaBloqueadaPorCobro;
    const frecuenciaFinal = bloqueado ? frecuenciaOriginalPoliza : frecuenciaSeleccionada;
    const mensualFraccionesFinal = bloqueado
      ? (currentPolizaItem?.mensual_fracciones ?? null)
      : (frecuenciaSeleccionada === 'Mensual' ? Number(polizaMensualFracciones.value) : null);

    const fracciones = bloqueado ? [] : generarFracciones({
      inicioVigencia: inicio,
      finVigencia: fin,
      prima,
      frecuencia: frecuenciaFinal,
      mensualFracciones: polizaMensualFracciones.value,
    });

    const payloadPoliza = {
      cliente_id: polizaClienteId.value,
      asesor_id: polizaAsesorId.value,
      sucursal_id: polizaSucursal.value,
      aseguradora_id: polizaAseguradoraId.value,
      tipo_poliza: polizaTipoPoliza.value,
      nro_poliza: polizaNroPoliza.value.trim(),
      ramo_id: polizaRamoId.value,
      plan_id: planSeleccionado ? planSeleccionado.id : null,
      suma_asegurada: planSeleccionado ? planSeleccionado.suma_asegurada : null,
      inicio_vigencia: inicio,
      prima,
      frecuencia_pago: frecuenciaFinal,
      mensual_fracciones: mensualFraccionesFinal,
      cantidad_fracciones: bloqueado ? (currentPolizaItem?.cantidad_fracciones ?? 0) : fracciones.length,
    };

    if (isEditModePoliza) {
      payloadPoliza.usuario_modificacion = currentUser;
    } else {
      payloadPoliza.usuario_creacion = currentUser;
      payloadPoliza.usuario_modificacion = currentUser;
    }

    try {
      let polizaId;
      let error;

      if (isEditModePoliza) {
        polizaId = polizaIdInput.value;
        ({ error } = await supabaseClient.from(TABLE_POLIZAS).update(payloadPoliza).eq('id', polizaId));
        // Al editar, se regeneran las fracciones desde cero solo cuando la
        // frecuencia no está bloqueada (ninguna fracción "Cobrado"). Si está
        // bloqueada, las fracciones existentes se conservan intactas.
        if (!error && !bloqueado) {
          ({ error } = await supabaseClient.from(TABLE_FRACCIONES).delete().eq('poliza_id', polizaId));
        }
      } else {
        const insertResult = await supabaseClient.from(TABLE_POLIZAS).insert([payloadPoliza]).select('id').single();
        error = insertResult.error;
        polizaId = insertResult.data?.id;
      }

      if (error) {
        submitPolizaBtn.disabled = false;
        submitPolizaBtn.textContent = submitPolizaBtnIdleLabel();
        const prefix = error.code === '23505' ? 'Ya existe una póliza con ese número para esta aseguradora.' : 'No se pudo guardar la póliza.';
        showFeedback('polizaFormFeedback', `${prefix} ${getErrorMessage(error)}`, 'error');
        return;
      }

      // Si está bloqueado, no se tocan las fracciones existentes.
      if (bloqueado) {
        submitPolizaBtn.disabled = false;
        submitPolizaBtn.textContent = submitPolizaBtnIdleLabel();
        showFeedback('polizaFormFeedback', 'Póliza actualizada correctamente.', 'success');
        await Promise.all([loadPolizas(), loadFracciones()]);
        setTimeout(closePolizaModal, 700);
        return;
      }

      // Inserta las fracciones con los datos denormalizados de la póliza
      const fraccionesPayload = fracciones.map((f) => ({
        poliza_id: polizaId,
        numero_fraccion: f.numero_fraccion,
        cliente_id: payloadPoliza.cliente_id,
        asesor_id: payloadPoliza.asesor_id,
        sucursal_id: payloadPoliza.sucursal_id,
        aseguradora_id: payloadPoliza.aseguradora_id,
        ramo_id: payloadPoliza.ramo_id,
        tipo_poliza: payloadPoliza.tipo_poliza,
        nro_poliza: payloadPoliza.nro_poliza,
        plan_id: payloadPoliza.plan_id,
        suma_asegurada: payloadPoliza.suma_asegurada,
        fecha_inicio: f.fecha_inicio,
        fecha_fin: f.fecha_fin,
        prima: f.prima,
        status: 'Por Cobrar',
        usuario_creacion: currentUser,
        usuario_modificacion: currentUser,
      }));

      const { error: errorFracciones } = await supabaseClient.from(TABLE_FRACCIONES).insert(fraccionesPayload);

      submitPolizaBtn.disabled = false;
      submitPolizaBtn.textContent = submitPolizaBtnIdleLabel();

      if (errorFracciones) {
        showFeedback('polizaFormFeedback', `La póliza se guardó, pero hubo un error generando las fracciones: ${getErrorMessage(errorFracciones)}`, 'error');
        await Promise.all([loadPolizas(), loadFracciones()]);
        return;
      }

      showFeedback('polizaFormFeedback', isEditModePoliza ? 'Póliza actualizada correctamente.' : 'Póliza registrada correctamente.', 'success');
      await Promise.all([loadPolizas(), loadFracciones()]);
      setTimeout(closePolizaModal, 700);
    } catch (err) {
      submitPolizaBtn.disabled = false;
      submitPolizaBtn.textContent = submitPolizaBtnIdleLabel();
      showFeedback('polizaFormFeedback', `No se pudo guardar: ${getErrorMessage(err)}`, 'error');
    }
  });

  /* =========================================================
     TABLA PÓLIZAS: render / orden / búsqueda / filtro por cliente
     ========================================================= */
  function polizaConNombres(p) {
    const cliente = allClientes.find((c) => c.id === p.cliente_id);
    const aseguradora = allAseguradoras.find((a) => a.id === p.aseguradora_id);
    const ramo = allRamos.find((r) => r.id === p.ramo_id);
    const asesor = allUsuarios.find((u) => u.id === p.asesor_id);
    const sucursal = allSucursales.find((s) => s.id === p.sucursal_id);
    const ejecutivo = asesor ? allUsuarios.find((u) => u.id === asesor.ejecutivo_id) : null;
    return {
      ...p,
      cliente_nombre: cliente?.nombre_cliente || '—',
      aseguradora_nombre: aseguradora?.nombre || '—',
      ramo_nombre: ramo?.nombre_ramo || '—',
      asesor_nombre: asesor?.full_name || '—',
      sucursal_nombre: sucursal?.sucursal || '—',
      ejecutivo_nombre: ejecutivo?.full_name || '—',
    };
  }

  function renderPolizas(items) {
    polizasTableBody.innerHTML = '';
    if (!items.length) { polizasEmpty.style.display = 'block'; return; }
    polizasEmpty.style.display = 'none';

    items.forEach((item) => {
      const status = getPolizaStatusEfectivo(item);
      const statusClass = `status-pill--${statusToClass(status)}`;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Cliente">${escapeHtml(item.cliente_nombre)}</td>
        <td data-label="Nro. Póliza">${escapeHtml(item.nro_poliza)}</td>
        <td data-label="Aseguradora">${escapeHtml(item.aseguradora_nombre)}</td>
        <td data-label="Ramo">${escapeHtml(item.ramo_nombre)}</td>
        <td data-label="Sucursal">${escapeHtml(item.sucursal_nombre)}</td>
        <td data-label="Asesor">${escapeHtml(item.asesor_nombre)}</td>
        <td data-label="Ejecutivo">${escapeHtml(item.ejecutivo_nombre)}</td>
        <td data-label="Vigencia">${formatDateEs(item.inicio_vigencia)} — ${formatDateEs(item.fin_vigencia)}</td>
        <td data-label="Prima">${formatMoney(item.prima)}</td>
        <td data-label="Status"><span class="status-pill ${statusClass}">${escapeHtml(status)}</span></td>
      `;
      // Toda la fila es clicable: abre el detalle de la póliza (modal "Ver Póliza"),
      // donde viven ahora todas las acciones (Fracciones, Renovar, Reactivar, Anular, Editar, Eliminar).
      tr.addEventListener('click', () => openPolizaModal({ edit: true, item, readOnly: true }));
      polizasTableBody.appendChild(tr);
    });
  }

  sortableHeadersPolizas.forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sortKey;
      currentSortPolizas = currentSortPolizas.key === key
        ? { key, direction: currentSortPolizas.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' };
      updateSortIndicators(sortableHeadersPolizas, currentSortPolizas);
      applyFilterPolizas();
    });
  });

  function applyFilterPolizas() {
    const term = searchPolizas.value.trim().toLowerCase();
    clearSearchPolizas.classList.toggle('is-visible', term.length > 0);

    let result = allPolizas.map(polizaConNombres);

    if (filtroClienteId) result = result.filter((p) => p.cliente_id === filtroClienteId);

    if (term) {
      result = result.filter((p) =>
        p.cliente_nombre.toLowerCase().includes(term) || p.nro_poliza.toLowerCase().includes(term)
      );
    }

    const campoFiltro = getCampoFechaFiltroPoliza();
    const camposFecha = campoFiltro ? [campoFiltro] : ['inicio_vigencia', 'fin_vigencia'];
    const anioSel = filtroPolizaAnio.value;
    const mesSel = filtroPolizaMes.value;
    if (anioSel && anioSel !== 'Todos') {
      result = result.filter((p) => camposFecha.some((c) => p[c] && p[c].slice(0, 4) === anioSel));
    }
    if (mesSel && mesSel !== 'Todos') {
      result = result.filter((p) => camposFecha.some((c) => p[c] && String(Number(p[c].slice(5, 7))) === mesSel));
    }

    const sucursalSel = comboFiltroSucursal.getValues();
    if (sucursalSel.length) result = result.filter((p) => sucursalSel.includes(p.sucursal_id));

    const asesorSel = comboFiltroAsesor.getValues();
    if (asesorSel.length) result = result.filter((p) => asesorSel.includes(p.asesor_id));

    const ejecutivoSel = comboFiltroEjecutivo.getValues();
    if (ejecutivoSel.length) {
      result = result.filter((p) => {
        const asesor = allUsuarios.find((u) => u.id === p.asesor_id);
        return asesor && ejecutivoSel.includes(asesor.ejecutivo_id);
      });
    }

    const aseguradoraSel = comboFiltroAseguradora.getValues();
    if (aseguradoraSel.length) result = result.filter((p) => aseguradoraSel.includes(p.aseguradora_id));

    result = sortItems(result, currentSortPolizas.key, currentSortPolizas.direction);
    renderPolizas(result);
  }

  searchPolizas.addEventListener('input', applyFilterPolizas);
  clearSearchPolizas.addEventListener('click', () => { searchPolizas.value = ''; applyFilterPolizas(); searchPolizas.focus(); });

  /* Filtro por cliente_id en la URL (botón "Ver pólizas" desde Clientes) */
  const polizasFilterChipWrap = document.getElementById('polizasFilterChipWrap');
  const polizasFilterChipNombre = document.getElementById('polizasFilterChipNombre');
  const polizasFilterChipClear = document.getElementById('polizasFilterChipClear');

  function aplicarFiltroClienteDesdeURL() {
    const params = new URLSearchParams(window.location.search);
    const clienteId = params.get('cliente_id');
    if (!clienteId) return;
    filtroClienteId = clienteId;
    const cliente = allClientes.find((c) => c.id === clienteId);
    polizasFilterChipNombre.textContent = cliente ? cliente.nombre_cliente : clienteId;
    polizasFilterChipWrap.style.display = 'block';
    activarTab('polizas');
    applyFilterPolizas();
  }
  polizasFilterChipClear.addEventListener('click', () => {
    filtroClienteId = null;
    polizasFilterChipWrap.style.display = 'none';
    const url = new URL(window.location.href);
    url.searchParams.delete('cliente_id');
    window.history.replaceState({}, '', url);
    applyFilterPolizas();
  });

  async function handleDeletePoliza(item) {
    const confirmed = await openConfirmDialog({
      title: 'Eliminar póliza',
      message: `¿Eliminar la póliza "${item.nro_poliza}"? Esto también eliminará todas sus fracciones. Esta acción no se puede deshacer.`,
      acceptLabel: 'Eliminar',
    });
    if (!confirmed) return;

    try {
      const { data, error } = await supabaseClient.from(TABLE_POLIZAS).delete().eq('id', item.id).select('id');
      if (error) { showNotification('polizasNotification', `No se pudo eliminar: ${getErrorMessage(error)}`, 'error'); return; }
      if (!data || !data.length) { showNotification('polizasNotification', 'No se pudo eliminar: la política de seguridad (RLS) bloqueó la operación.', 'error'); return; }
      await Promise.all([loadPolizas(), loadFracciones()]);
      showNotification('polizasNotification', 'Póliza eliminada correctamente.', 'success');
      closePolizaModal();
    } catch (err) {
      showNotification('polizasNotification', `No se pudo eliminar: ${getErrorMessage(err)}`, 'error');
    }
  }

  async function handleReactivarPoliza(item) {
    const confirmed = await openConfirmDialog({
      title: 'Reactivar póliza',
      message: `¿Reactivar la póliza "${item.nro_poliza}"? Su estado pasará a Vigente.`,
      acceptLabel: 'Reactivar',
    });
    if (!confirmed) return;

    const currentUser = getCurrentUserLabel();
    try {
      const { error } = await supabaseClient.from(TABLE_POLIZAS)
        .update({ status: 'Vigente', usuario_modificacion: currentUser })
        .eq('id', item.id);
      if (error) { showNotification('polizasNotification', `No se pudo reactivar: ${getErrorMessage(error)}`, 'error'); return; }
      await Promise.all([loadPolizas(), loadFracciones()]);
      showNotification('polizasNotification', 'Póliza reactivada correctamente.', 'success');
      closePolizaModal();
    } catch (err) {
      showNotification('polizasNotification', `No se pudo reactivar: ${getErrorMessage(err)}`, 'error');
    }
  }

  /* =========================================================
     ANULAR PÓLIZA
     ========================================================= */
  const anularPolizaModalOverlay = document.getElementById('anularPolizaModalOverlay');
  const anularPolizaModalCloseBtn = document.getElementById('anularPolizaModalCloseBtn');
  const cancelAnularPolizaBtn = document.getElementById('cancelAnularPolizaBtn');
  const anularPolizaForm = document.getElementById('anularPolizaForm');
  const causaAnulacion = document.getElementById('causaAnulacion');
  const fieldCausaAnulacion = document.getElementById('fieldCausaAnulacion');
  const submitAnularPolizaBtn = document.getElementById('submitAnularPolizaBtn');
  let polizaAAnular = null;

  function openAnularPolizaModal(item) {
    polizaAAnular = item;
    anularPolizaForm.reset();
    clearFeedback('anularPolizaFormFeedback');
    setFieldError(fieldCausaAnulacion, false);
    anularPolizaModalOverlay.classList.add('is-open');
    causaAnulacion.focus();
  }
  function closeAnularPolizaModal() {
    anularPolizaModalOverlay.classList.remove('is-open');
    polizaAAnular = null;
  }
  anularPolizaModalCloseBtn.addEventListener('click', closeAnularPolizaModal);
  cancelAnularPolizaBtn.addEventListener('click', closeAnularPolizaModal);
  anularPolizaModalOverlay.addEventListener('click', (e) => { if (e.target === anularPolizaModalOverlay) closeAnularPolizaModal(); });

  anularPolizaForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!polizaAAnular) return;
    clearFeedback('anularPolizaFormFeedback');

    const causa = causaAnulacion.value.trim();
    const causaOk = causa.length >= 5;
    setFieldError(fieldCausaAnulacion, !causaOk);
    if (!causaOk) {
      showFeedback('anularPolizaFormFeedback', 'Escribe la causa de la anulación (mínimo 5 caracteres).', 'error');
      return;
    }

    submitAnularPolizaBtn.disabled = true;
    submitAnularPolizaBtn.textContent = 'Anulando...';
    const currentUser = getCurrentUserLabel();

    try {
      const { error } = await supabaseClient.from(TABLE_POLIZAS)
        .update({ status: 'Anulado', causa_anulacion: causa, usuario_modificacion: currentUser })
        .eq('id', polizaAAnular.id);

      if (error) {
        submitAnularPolizaBtn.disabled = false;
        submitAnularPolizaBtn.textContent = 'Anular Póliza';
        showFeedback('anularPolizaFormFeedback', `No se pudo anular la póliza: ${getErrorMessage(error)}`, 'error');
        return;
      }

      // Cascada: las fracciones que aún no fueron cobradas pasan a Anulado.
      await supabaseClient.from(TABLE_FRACCIONES)
        .update({ status: 'Anulado', usuario_modificacion: currentUser })
        .eq('poliza_id', polizaAAnular.id)
        .neq('status', 'Cobrado');

      submitAnularPolizaBtn.disabled = false;
      submitAnularPolizaBtn.textContent = 'Anular Póliza';
      await Promise.all([loadPolizas(), loadFracciones()]);
      showNotification('polizasNotification', 'Póliza anulada correctamente.', 'success');
      closeAnularPolizaModal();
      closePolizaModal();
    } catch (err) {
      submitAnularPolizaBtn.disabled = false;
      submitAnularPolizaBtn.textContent = 'Anular Póliza';
      showFeedback('anularPolizaFormFeedback', `No se pudo anular: ${getErrorMessage(err)}`, 'error');
    }
  });

  /* =========================================================================
     ===========================  MÓDULO FRACCIONES  ============================
     ========================================================================= */

  const searchFracciones = document.getElementById('searchFracciones');
  const clearSearchFracciones = document.getElementById('clearSearchFracciones');
  const fraccionesTableBody = document.getElementById('fraccionesTableBody');
  const fraccionesLoading = document.getElementById('fraccionesLoading');
  const fraccionesEmpty = document.getElementById('fraccionesEmpty');
  let currentSortFracciones = { key: 'cliente_nombre', direction: 'asc' };
  const sortableHeadersFracciones = document.querySelectorAll('#fraccionesTable th.is-sortable');

  const filtroFraccionStatus = document.getElementById('filtroFraccionStatus');
  const filtroFraccionAnio = document.getElementById('filtroFraccionAnio');
  const filtroFraccionMes = document.getElementById('filtroFraccionMes');
  const resetFiltroFraccion = document.getElementById('resetFiltroFraccion');

  /* ---- Panel lateral "Filtros avanzados" (Fracciones) ---- */
  const openFraccionFiltrosBtn = document.getElementById('openFraccionFiltrosBtn');
  const closeFraccionFiltrosBtn = document.getElementById('closeFraccionFiltrosBtn');
  const fraccionFiltrosOverlay = document.getElementById('fraccionFiltrosOverlay');
  const fraccionFiltrosPanel = document.getElementById('fraccionFiltrosPanel');

  function abrirPanelFiltrosFraccion() {
    fraccionFiltrosPanel.classList.add('is-open');
    fraccionFiltrosOverlay.classList.add('is-open');
    fraccionFiltrosPanel.setAttribute('aria-hidden', 'false');
  }
  function cerrarPanelFiltrosFraccion() {
    fraccionFiltrosPanel.classList.remove('is-open');
    fraccionFiltrosOverlay.classList.remove('is-open');
    fraccionFiltrosPanel.setAttribute('aria-hidden', 'true');
  }
  openFraccionFiltrosBtn.addEventListener('click', abrirPanelFiltrosFraccion);
  closeFraccionFiltrosBtn.addEventListener('click', cerrarPanelFiltrosFraccion);
  fraccionFiltrosOverlay.addEventListener('click', cerrarPanelFiltrosFraccion);

  function fraccionConNombres(f) {
    const cliente = allClientes.find((c) => c.id === f.cliente_id);
    const asesor = allUsuarios.find((u) => u.id === f.asesor_id);
    const sucursal = allSucursales.find((s) => s.id === f.sucursal_id);
    const ejecutivo = asesor ? allUsuarios.find((u) => u.id === asesor.ejecutivo_id) : null;
    const poliza = allPolizas.find((p) => p.id === f.poliza_id);
    return {
      ...f,
      cliente_nombre: cliente?.nombre_cliente || '—',
      asesor_nombre: asesor?.full_name || '—',
      sucursal_nombre: sucursal?.sucursal || '—',
      ejecutivo_nombre: ejecutivo?.full_name || '—',
      aseguradora_id: poliza?.aseguradora_id || null,
    };
  }

  /* ---- Filtro Año / Mes: el año se alimenta desde la fracción más antigua
     (por fecha_inicio) hasta el año actual. Incluye opción "Todos". ---- */
  function poblarFiltroAnios() {
    const anioActual = new Date().getFullYear();
    const anios = allFracciones
      .map((f) => f.fecha_inicio ? Number(f.fecha_inicio.slice(0, 4)) : null)
      .filter((y) => Number.isInteger(y));
    const anioMin = anios.length ? Math.min(...anios, anioActual) : anioActual;
    const anioMax = anios.length ? Math.max(...anios, anioActual) : anioActual;

    const valorPrevio = filtroFraccionAnio.value || 'Todos';
    filtroFraccionAnio.innerHTML = '<option value="Todos">Todos</option>';
    for (let y = anioMax; y >= anioMin; y--) {
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = String(y);
      filtroFraccionAnio.appendChild(opt);
    }
    filtroFraccionAnio.value = [...filtroFraccionAnio.options].some((o) => o.value === valorPrevio)
      ? valorPrevio
      : 'Todos';
  }

  /* ---- Criterios Sucursal / Ejecutivo / Asesor / Aseguradora (panel
     "Filtros avanzados" de Fracciones), en cascada:
     Sucursal -> acota las opciones de Ejecutivo y Asesor a esa(s) sucursal(es).
     Ejecutivo -> acota las opciones de Asesor a los asesores de ese(esos) ejecutivo(s). ---- */
  const filtroFraccionSucursalInput = document.getElementById('filtroFraccionSucursalInput');
  const filtroFraccionSucursalChips = document.getElementById('filtroFraccionSucursalChips');
  const filtroFraccionSucursalDropdown = document.getElementById('filtroFraccionSucursalDropdown');

  const filtroFraccionEjecutivoInput = document.getElementById('filtroFraccionEjecutivoInput');
  const filtroFraccionEjecutivoChips = document.getElementById('filtroFraccionEjecutivoChips');
  const filtroFraccionEjecutivoDropdown = document.getElementById('filtroFraccionEjecutivoDropdown');

  const filtroFraccionAsesorInput = document.getElementById('filtroFraccionAsesorInput');
  const filtroFraccionAsesorChips = document.getElementById('filtroFraccionAsesorChips');
  const filtroFraccionAsesorDropdown = document.getElementById('filtroFraccionAsesorDropdown');

  const filtroFraccionAseguradoraInput = document.getElementById('filtroFraccionAseguradoraInput');
  const filtroFraccionAseguradoraChips = document.getElementById('filtroFraccionAseguradoraChips');
  const filtroFraccionAseguradoraDropdown = document.getElementById('filtroFraccionAseguradoraDropdown');

  const comboFiltroFraccionSucursal = setupMultiSelectCombo({
    inputEl: filtroFraccionSucursalInput, chipsEl: filtroFraccionSucursalChips, dropdownEl: filtroFraccionSucursalDropdown,
    getItems: () => allSucursales,
    getId: (s) => s.id,
    renderLabel: (s) => s.sucursal,
    onChange: () => {
      comboFiltroFraccionEjecutivo.prune();
      comboFiltroFraccionAsesor.prune();
      applyFilterFracciones();
    },
  });

  const comboFiltroFraccionEjecutivo = setupMultiSelectCombo({
    inputEl: filtroFraccionEjecutivoInput, chipsEl: filtroFraccionEjecutivoChips, dropdownEl: filtroFraccionEjecutivoDropdown,
    getItems: () => {
      const sucursalSel = comboFiltroFraccionSucursal.getValues();
      return getEjecutivos().filter((u) => !sucursalSel.length || sucursalSel.includes(u.sucursal_id));
    },
    getId: (u) => u.id,
    renderLabel: (u) => u.full_name,
    onChange: () => {
      comboFiltroFraccionAsesor.prune();
      applyFilterFracciones();
    },
  });

  const comboFiltroFraccionAsesor = setupMultiSelectCombo({
    inputEl: filtroFraccionAsesorInput, chipsEl: filtroFraccionAsesorChips, dropdownEl: filtroFraccionAsesorDropdown,
    getItems: () => {
      const sucursalSel = comboFiltroFraccionSucursal.getValues();
      const ejecutivoSel = comboFiltroFraccionEjecutivo.getValues();
      return allUsuarios.filter((u) =>
        (!sucursalSel.length || sucursalSel.includes(u.sucursal_id)) &&
        (!ejecutivoSel.length || ejecutivoSel.includes(u.ejecutivo_id))
      );
    },
    getId: (u) => u.id,
    renderLabel: (u) => u.full_name,
    onChange: () => applyFilterFracciones(),
  });

  const comboFiltroFraccionAseguradora = setupMultiSelectCombo({
    inputEl: filtroFraccionAseguradoraInput, chipsEl: filtroFraccionAseguradoraChips, dropdownEl: filtroFraccionAseguradoraDropdown,
    getItems: () => allAseguradoras,
    getId: (a) => a.id,
    renderLabel: (a) => a.nombre,
    allOptionLabel: 'Todas las aseguradoras',
    onChange: () => applyFilterFracciones(),
  });

  function resetearFiltroFraccion() {
    filtroFraccionStatus.value = 'Todos';
    poblarFiltroAnios();
    filtroFraccionAnio.value = 'Todos';
    filtroFraccionMes.value = 'Todos';
    comboFiltroFraccionSucursal.reset();
    comboFiltroFraccionEjecutivo.reset();
    comboFiltroFraccionAsesor.reset();
    comboFiltroFraccionAseguradora.reset();
    applyFilterFracciones();
  }
  filtroFraccionStatus.addEventListener('change', applyFilterFracciones);
  filtroFraccionAnio.addEventListener('change', applyFilterFracciones);
  filtroFraccionMes.addEventListener('change', applyFilterFracciones);
  resetFiltroFraccion.addEventListener('click', resetearFiltroFraccion);

  function renderFracciones(items) {
    fraccionesTableBody.innerHTML = '';
    if (!items.length) { fraccionesEmpty.style.display = 'block'; return; }
    fraccionesEmpty.style.display = 'none';

    items.forEach((item) => {
      const status = item.status || 'Por Cobrar';
      const statusClass = `status-pill--${statusToClass(status)}`;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Cliente">${escapeHtml(item.cliente_nombre)}</td>
        <td data-label="Nro. Póliza">${escapeHtml(item.nro_poliza)}</td>
        <td data-label="Sucursal">${escapeHtml(item.sucursal_nombre)}</td>
        <td data-label="Asesor">${escapeHtml(item.asesor_nombre)}</td>
        <td data-label="Ejecutivo">${escapeHtml(item.ejecutivo_nombre)}</td>
        <td data-label="N° Fracción">${item.numero_fraccion}</td>
        <td data-label="Inicio">${formatDateEs(item.fecha_inicio)}</td>
        <td data-label="Fin">${formatDateEs(item.fecha_fin)}</td>
        <td data-label="Prima">${formatMoney(item.prima)}</td>
        <td data-label="Status"><span class="status-pill ${statusClass}">${escapeHtml(status)}</span></td>
      `;
      // Toda la fila es clicable: abre el modal "Detalle de Fracción",
      // donde vive ahora la acción de Cobrar.
      tr.addEventListener('click', () => openDetalleFraccionModal(item));
      fraccionesTableBody.appendChild(tr);
    });
  }

  sortableHeadersFracciones.forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sortKey;
      currentSortFracciones = currentSortFracciones.key === key
        ? { key, direction: currentSortFracciones.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' };
      updateSortIndicators(sortableHeadersFracciones, currentSortFracciones);
      applyFilterFracciones();
    });
  });

  function applyFilterFracciones() {
    const term = searchFracciones.value.trim().toLowerCase();
    clearSearchFracciones.classList.toggle('is-visible', term.length > 0);
    let result = allFracciones.map(fraccionConNombres);

    if (term) {
      result = result.filter((f) => f.cliente_nombre.toLowerCase().includes(term) || f.nro_poliza.toLowerCase().includes(term));
    }

    const statusSel = filtroFraccionStatus.value;
    if (statusSel && statusSel !== 'Todos') {
      result = result.filter((f) => (f.status || 'Por Cobrar') === statusSel);
    }

    const anioSel = filtroFraccionAnio.value;
    const mesSel = filtroFraccionMes.value;
    if (anioSel && anioSel !== 'Todos') {
      result = result.filter((f) => f.fecha_inicio && f.fecha_inicio.slice(0, 4) === anioSel);
    }
    if (mesSel && mesSel !== 'Todos') {
      result = result.filter((f) => f.fecha_inicio && String(Number(f.fecha_inicio.slice(5, 7))) === mesSel);
    }

    const sucursalSel = comboFiltroFraccionSucursal.getValues();
    if (sucursalSel.length) result = result.filter((f) => sucursalSel.includes(f.sucursal_id));

    const asesorSel = comboFiltroFraccionAsesor.getValues();
    if (asesorSel.length) result = result.filter((f) => asesorSel.includes(f.asesor_id));

    const ejecutivoSel = comboFiltroFraccionEjecutivo.getValues();
    if (ejecutivoSel.length) {
      result = result.filter((f) => {
        const asesor = allUsuarios.find((u) => u.id === f.asesor_id);
        return asesor && ejecutivoSel.includes(asesor.ejecutivo_id);
      });
    }

    const aseguradoraSel = comboFiltroFraccionAseguradora.getValues();
    if (aseguradoraSel.length) result = result.filter((f) => aseguradoraSel.includes(f.aseguradora_id));

    result = sortItems(result, currentSortFracciones.key, currentSortFracciones.direction);
    renderFracciones(result);
  }
  searchFracciones.addEventListener('input', applyFilterFracciones);
  clearSearchFracciones.addEventListener('click', () => { searchFracciones.value = ''; applyFilterFracciones(); searchFracciones.focus(); });

  /* =========================================================
     VER FRACCIONES DE UNA PÓLIZA (modal de detalle)
     ========================================================= */
  const verFraccionesModalOverlay = document.getElementById('verFraccionesModalOverlay');
  const verFraccionesModalCloseBtn = document.getElementById('verFraccionesModalCloseBtn');
  const closeVerFraccionesBtn = document.getElementById('closeVerFraccionesBtn');
  const verFraccionesList = document.getElementById('verFraccionesList');
  const verFraccionesModalTitle = document.getElementById('verFraccionesModalTitle');
  let polizaEnVerFracciones = null;

  function renderVerFraccionesList() {
    if (!polizaEnVerFracciones) return;
    const fraccionesPoliza = allFracciones
      .filter((f) => f.poliza_id === polizaEnVerFracciones.id)
      .sort((a, b) => a.numero_fraccion - b.numero_fraccion);

    verFraccionesList.innerHTML = '';
    if (!fraccionesPoliza.length) {
      verFraccionesList.innerHTML = '<p class="fraccion-list__info">Esta póliza no tiene fracciones registradas.</p>';
      return;
    }
    fraccionesPoliza.forEach((f) => {
      const status = f.status || 'Por Cobrar';
      const statusClass = `status-pill--${statusToClass(status)}`;
      const puedeCobrar = status === 'Por Cobrar';
      const estaCobrada = status === 'Cobrado';
      const datosCobroHtml = estaCobrada
        ? `<br><span class="fraccion-list__cobro">
             Fecha de Cobro: <strong>${formatDateEs(f.fecha_cobro)}</strong> &nbsp;·&nbsp;
             Nro. de Recibo: <strong>${escapeHtml(f.numero_recibo || '—')}</strong> &nbsp;·&nbsp;
             Moneda de Pago: <strong>${escapeHtml(f.moneda_pago || '—')}</strong>
           </span>`
        : '';
      const row = document.createElement('div');
      row.className = 'fraccion-list__item';
      row.innerHTML = `
        <div class="fraccion-list__info">
          <strong>Fracción #${f.numero_fraccion}</strong> — ${formatDateEs(f.fecha_inicio)} a ${formatDateEs(f.fecha_fin)}<br>
          Prima: ${formatMoney(f.prima)} &nbsp;·&nbsp; <span class="status-pill ${statusClass}">${escapeHtml(status)}</span>
          ${datosCobroHtml}
        </div>
        <div class="fraccion-list__actions">
          ${puedeCobrar ? `<button type="button" class="btn btn--secondary btn--sm action-btn--cobrar-detalle">💰 Cobrar</button>` : ''}
        </div>
      `;
      const cobrarBtn = row.querySelector('.action-btn--cobrar-detalle');
      if (cobrarBtn) cobrarBtn.addEventListener('click', () => openCobrarModal(f));
      verFraccionesList.appendChild(row);
    });
  }

  function openVerFraccionesModal(polizaItem) {
    polizaEnVerFracciones = polizaItem;
    verFraccionesModalTitle.textContent = `Fracciones — Póliza ${polizaItem.nro_poliza}`;
    renderVerFraccionesList();
    verFraccionesModalOverlay.classList.add('is-open');
  }
  function closeVerFraccionesModal() {
    verFraccionesModalOverlay.classList.remove('is-open');
    polizaEnVerFracciones = null;
  }
  verFraccionesModalCloseBtn.addEventListener('click', closeVerFraccionesModal);
  closeVerFraccionesBtn.addEventListener('click', closeVerFraccionesModal);
  verFraccionesModalOverlay.addEventListener('click', (e) => { if (e.target === verFraccionesModalOverlay) closeVerFraccionesModal(); });

  /* =========================================================
     DETALLE DE FRACCIÓN (modal abierto al hacer click en una fila
     de la tabla de la pestaña Fracciones). Aquí vive la acción "Cobrar".
     ========================================================= */
  const detalleFraccionModalOverlay = document.getElementById('detalleFraccionModalOverlay');
  const detalleFraccionModalCloseBtn = document.getElementById('detalleFraccionModalCloseBtn');
  const detalleFraccionCancelBtn = document.getElementById('detalleFraccionCancelBtn');
  const detalleFraccionCliente = document.getElementById('detalleFraccionCliente');
  const detalleFraccionNroPoliza = document.getElementById('detalleFraccionNroPoliza');
  const detalleFraccionSucursal = document.getElementById('detalleFraccionSucursal');
  const detalleFraccionAsesor = document.getElementById('detalleFraccionAsesor');
  const detalleFraccionEjecutivo = document.getElementById('detalleFraccionEjecutivo');
  const detalleFraccionNumero = document.getElementById('detalleFraccionNumero');
  const detalleFraccionInicio = document.getElementById('detalleFraccionInicio');
  const detalleFraccionFin = document.getElementById('detalleFraccionFin');
  const detalleFraccionPrima = document.getElementById('detalleFraccionPrima');
  const detalleFraccionStatus = document.getElementById('detalleFraccionStatus');
  const detalleFraccionCobroBox = document.getElementById('detalleFraccionCobroBox');
  const detalleFraccionCobroInfo = document.getElementById('detalleFraccionCobroInfo');
  const detalleFraccionAccionesTitle = document.getElementById('detalleFraccionAccionesTitle');
  const detalleFraccionAccionesBox = document.getElementById('detalleFraccionAccionesBox');
  const detalleFraccionCobrarBtn = document.getElementById('detalleFraccionCobrarBtn');
  let fraccionEnDetalle = null;

  function renderDetalleFraccion() {
    if (!fraccionEnDetalle) return;
    const f = fraccionEnDetalle;
    const status = f.status || 'Por Cobrar';
    const statusClass = `status-pill--${statusToClass(status)}`;
    const puedeCobrar = status === 'Por Cobrar';
    const estaCobrada = status === 'Cobrado';

    detalleFraccionCliente.textContent = f.cliente_nombre || '—';
    detalleFraccionNroPoliza.textContent = f.nro_poliza || '—';
    detalleFraccionSucursal.textContent = f.sucursal_nombre || '—';
    detalleFraccionAsesor.textContent = f.asesor_nombre || '—';
    detalleFraccionEjecutivo.textContent = f.ejecutivo_nombre || '—';
    detalleFraccionNumero.textContent = f.numero_fraccion;
    detalleFraccionInicio.textContent = formatDateEs(f.fecha_inicio);
    detalleFraccionFin.textContent = formatDateEs(f.fecha_fin);
    detalleFraccionPrima.textContent = formatMoney(f.prima);
    detalleFraccionStatus.innerHTML = `<span class="status-pill ${statusClass}">${escapeHtml(status)}</span>`;

    if (estaCobrada) {
      detalleFraccionCobroInfo.innerHTML = `
        Fecha de Cobro: <strong>${formatDateEs(f.fecha_cobro)}</strong> &nbsp;·&nbsp;
        Nro. de Recibo: <strong>${escapeHtml(f.numero_recibo || '—')}</strong> &nbsp;·&nbsp;
        Moneda de Pago: <strong>${escapeHtml(f.moneda_pago || '—')}</strong>
      `;
      detalleFraccionCobroBox.style.display = '';
    } else {
      detalleFraccionCobroBox.style.display = 'none';
    }

    detalleFraccionAccionesTitle.style.display = puedeCobrar ? '' : 'none';
    detalleFraccionAccionesBox.style.display = puedeCobrar ? '' : 'none';
  }

  function openDetalleFraccionModal(item) {
    fraccionEnDetalle = item;
    renderDetalleFraccion();
    detalleFraccionModalOverlay.classList.add('is-open');
  }
  function closeDetalleFraccionModal() {
    detalleFraccionModalOverlay.classList.remove('is-open');
    fraccionEnDetalle = null;
  }
  detalleFraccionModalCloseBtn.addEventListener('click', closeDetalleFraccionModal);
  detalleFraccionCancelBtn.addEventListener('click', closeDetalleFraccionModal);
  detalleFraccionModalOverlay.addEventListener('click', (e) => { if (e.target === detalleFraccionModalOverlay) closeDetalleFraccionModal(); });
  detalleFraccionCobrarBtn.addEventListener('click', () => { if (fraccionEnDetalle) openCobrarModal(fraccionEnDetalle); });

  /* =========================================================
     COBRAR FRACCIÓN
     ========================================================= */
  const cobrarModalOverlay = document.getElementById('cobrarModalOverlay');
  const cobrarModalCloseBtn = document.getElementById('cobrarModalCloseBtn');
  const cancelCobrarBtn = document.getElementById('cancelCobrarBtn');
  const cobrarForm = document.getElementById('cobrarForm');
  const cobrarFecha = document.getElementById('cobrarFecha');
  const cobrarFechaIngreso = document.getElementById('cobrarFechaIngreso');
  const cobrarNumeroRecibo = document.getElementById('cobrarNumeroRecibo');
  const cobrarMoneda = document.getElementById('cobrarMoneda');
  const cobrarPrima = document.getElementById('cobrarPrima');
  const submitCobrarBtn = document.getElementById('submitCobrarBtn');
  const fieldCobrarFecha = document.getElementById('fieldCobrarFecha');
  const fieldCobrarFechaIngreso = document.getElementById('fieldCobrarFechaIngreso');
  const fieldCobrarNumeroRecibo = document.getElementById('fieldCobrarNumeroRecibo');
  const cobrarNumeroReciboError = document.getElementById('cobrarNumeroReciboError');
  const fieldCobrarMoneda = document.getElementById('fieldCobrarMoneda');
  const fieldCobrarPrima = document.getElementById('fieldCobrarPrima');
  attachMoneyFormatter(cobrarPrima);
  let fraccionACobrar = null;

  // Número de recibo: solo dígitos y "-" (se limpia cualquier otro carácter al escribir/pegar).
  cobrarNumeroRecibo.addEventListener('input', () => {
    const limpio = cobrarNumeroRecibo.value.replace(/[^0-9-]/g, '');
    if (limpio !== cobrarNumeroRecibo.value) cobrarNumeroRecibo.value = limpio;
  });

  function openCobrarModal(fraccion) {
    fraccionACobrar = fraccion;
    cobrarForm.reset();
    clearFeedback('cobrarFormFeedback');
    [fieldCobrarFecha, fieldCobrarFechaIngreso, fieldCobrarNumeroRecibo, fieldCobrarMoneda, fieldCobrarPrima].forEach((f) => setFieldError(f, false));
    cobrarPrima.value = formatMoneyInputLive(String(fraccion.prima ?? '').replace('.', ','));
    cobrarModalOverlay.classList.add('is-open');
  }
  function closeCobrarModal() {
    cobrarModalOverlay.classList.remove('is-open');
    fraccionACobrar = null;
  }
  cobrarModalCloseBtn.addEventListener('click', closeCobrarModal);
  cancelCobrarBtn.addEventListener('click', closeCobrarModal);
  cobrarModalOverlay.addEventListener('click', (e) => { if (e.target === cobrarModalOverlay) closeCobrarModal(); });

  cobrarForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!fraccionACobrar) return;
    clearFeedback('cobrarFormFeedback');

    let valid = true;
    const fechaOk = !!cobrarFecha.value;
    setFieldError(fieldCobrarFecha, !fechaOk); if (!fechaOk) valid = false;
    const fechaIngresoOk = !!cobrarFechaIngreso.value;
    setFieldError(fieldCobrarFechaIngreso, !fechaIngresoOk); if (!fechaIngresoOk) valid = false;

    const numeroRecibo = cobrarNumeroRecibo.value.trim();
    const numeroReciboFormatoOk = numeroRecibo === '' || /^[0-9-]+$/.test(numeroRecibo);
    let numeroReciboOk = numeroReciboFormatoOk;
    if (!numeroReciboFormatoOk) {
      cobrarNumeroReciboError.textContent = 'Solo se permiten números y el carácter "-".';
    } else if (numeroRecibo !== '') {
      // Único dentro de la misma aseguradora: se busca la aseguradora de la
      // póliza de esta fracción y se compara contra las demás fracciones de
      // pólizas de esa misma aseguradora.
      const polizaActual = allPolizas.find((p) => p.id === fraccionACobrar.poliza_id);
      const aseguradoraId = polizaActual?.aseguradora_id || null;
      const yaExiste = allFracciones.some((f) => {
        if (f.id === fraccionACobrar.id) return false;
        if (!f.numero_recibo || f.numero_recibo.trim() !== numeroRecibo) return false;
        const polizaF = allPolizas.find((p) => p.id === f.poliza_id);
        return (polizaF?.aseguradora_id || null) === aseguradoraId;
      });
      if (yaExiste) {
        numeroReciboOk = false;
        cobrarNumeroReciboError.textContent = 'Ese número de recibo ya está registrado para esta aseguradora.';
      }
    }
    setFieldError(fieldCobrarNumeroRecibo, !numeroReciboOk); if (!numeroReciboOk) valid = false;

    const monedaOk = !!cobrarMoneda.value;
    setFieldError(fieldCobrarMoneda, !monedaOk); if (!monedaOk) valid = false;
    const primaOk = parseMoneyInput(cobrarPrima.value) > 0;
    setFieldError(fieldCobrarPrima, !primaOk); if (!primaOk) valid = false;
    if (!valid) {
      showFeedback('cobrarFormFeedback', 'Revisa los campos marcados antes de continuar.', 'error');
      return;
    }

    const montoConfirm = formatMoney(parseMoneyInput(cobrarPrima.value));
    const confirmado = await openConfirmDialog({
      title: 'Confirmar cobro',
      messageHtml: `¿Confirmas el cobro de la Fracción #${fraccionACobrar.numero_fraccion} por <strong>${montoConfirm}</strong>?`,
      acceptLabel: 'Aceptar',
    });
    if (!confirmado) return;

    submitCobrarBtn.disabled = true;
    submitCobrarBtn.textContent = 'Registrando...';
    const currentUser = getCurrentUserLabel();

    const payload = {
      status: 'Cobrado',
      fecha_cobro: cobrarFecha.value,
      fecha_ingreso_aseguradora: cobrarFechaIngreso.value,
      numero_recibo: numeroRecibo || null,
      moneda_pago: cobrarMoneda.value,
      prima: parseMoneyInput(cobrarPrima.value),
      usuario_modificacion: currentUser,
    };

    try {
      const { error } = await supabaseClient.from(TABLE_FRACCIONES).update(payload).eq('id', fraccionACobrar.id);
      submitCobrarBtn.disabled = false;
      submitCobrarBtn.textContent = 'Registrar Cobro';

      if (error) {
        showFeedback('cobrarFormFeedback', `No se pudo registrar el cobro: ${getErrorMessage(error)}`, 'error');
        return;
      }

      await Promise.all([loadFracciones(), loadPolizas()]);
      if (polizaEnVerFracciones) renderVerFraccionesList();
      if (fraccionEnDetalle && fraccionEnDetalle.id === fraccionACobrar.id) {
        const actualizada = allFracciones.find((f) => f.id === fraccionACobrar.id);
        fraccionEnDetalle = actualizada ? fraccionConNombres(actualizada) : fraccionEnDetalle;
        renderDetalleFraccion();
      }
      showNotification('fraccionesNotification', `Fracción #${fraccionACobrar.numero_fraccion} cobrada correctamente.`, 'success');
      closeCobrarModal();
    } catch (err) {
      submitCobrarBtn.disabled = false;
      submitCobrarBtn.textContent = 'Registrar Cobro';
      showFeedback('cobrarFormFeedback', `No se pudo registrar el cobro: ${getErrorMessage(err)}`, 'error');
    }
  });

  /* =========================================================================
     ============  MODAL CLIENTE EMBEBIDO (registrar sin salir)  ================
     ========================================================================= */
  const NACIONALIDAD_LETRA = {
    'Venezolano': 'V', 'Extranjero': 'E', 'Jurídico': 'J',
    'Gubernamental': 'G', 'Pasaporte': 'P', 'Menor de Edad': 'M',
  };

  const clienteModalOverlay = document.getElementById('clienteModalOverlay');
  const clienteModalCloseBtn = document.getElementById('clienteModalCloseBtn');
  const cancelClienteModalBtn = document.getElementById('cancelClienteModalBtn');
  const clienteForm = document.getElementById('clienteForm');
  const clienteNacionalidad = document.getElementById('clienteNacionalidad');
  const clienteNroIdentificacion = document.getElementById('clienteNroIdentificacion');
  const clienteNombre = document.getElementById('clienteNombre');
  const clienteIdentificacionPreview = document.getElementById('clienteIdentificacionPreview');
  const submitClienteBtn = document.getElementById('submitClienteBtn');

  const fieldClienteNacionalidad = document.getElementById('fieldClienteNacionalidad');
  const fieldClienteNroIdentificacion = document.getElementById('fieldClienteNroIdentificacion');
  const fieldClienteNombre = document.getElementById('fieldClienteNombre');

  clienteNroIdentificacion.addEventListener('input', (e) => {
    const input = e.target;
    const cursorPos = input.selectionStart;
    const cleaned = input.value.replace(/[^0-9]/g, '');
    if (cleaned !== input.value) { input.value = cleaned; input.setSelectionRange(cursorPos - 1, cursorPos - 1); }
    refrescarPreviewIdentificacion();
  });
  clienteNacionalidad.addEventListener('change', refrescarPreviewIdentificacion);

  function refrescarPreviewIdentificacion() {
    const letra = NACIONALIDAD_LETRA[clienteNacionalidad.value];
    const nro = clienteNroIdentificacion.value.trim();
    clienteIdentificacionPreview.textContent = (letra && nro) ? `${letra}-${nro}` : 'Completa los campos para generar la identificación.';
  }

  function openClienteModalEmbebido() {
    clienteForm.reset();
    clearFeedback('clienteFormFeedback');
    [fieldClienteNacionalidad, fieldClienteNroIdentificacion, fieldClienteNombre].forEach((f) => setFieldError(f, false));
    refrescarPreviewIdentificacion();
    clienteModalOverlay.classList.add('is-open');
    clienteNacionalidad.focus();
  }
  function closeClienteModalEmbebido() {
    clienteModalOverlay.classList.remove('is-open');
    clienteForm.reset();
  }
  btnNuevoClienteDesdePoliza.addEventListener('click', openClienteModalEmbebido);
  clienteModalCloseBtn.addEventListener('click', closeClienteModalEmbebido);
  cancelClienteModalBtn.addEventListener('click', closeClienteModalEmbebido);
  clienteModalOverlay.addEventListener('click', (e) => { if (e.target === clienteModalOverlay) closeClienteModalEmbebido(); });

  function validateClienteFormEmbebido() {
    let valid = true;
    const nacOk = !!clienteNacionalidad.value;
    setFieldError(fieldClienteNacionalidad, !nacOk); if (!nacOk) valid = false;
    const nroOk = /^[0-9]+$/.test(clienteNroIdentificacion.value.trim());
    setFieldError(fieldClienteNroIdentificacion, !nroOk); if (!nroOk) valid = false;
    const nombreOk = clienteNombre.value.trim().length >= 3;
    setFieldError(fieldClienteNombre, !nombreOk); if (!nombreOk) valid = false;
    return valid;
  }

  clienteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFeedback('clienteFormFeedback');
    if (!validateClienteFormEmbebido()) {
      showFeedback('clienteFormFeedback', 'Revisa los campos marcados antes de continuar.', 'error');
      return;
    }
    if (!supabaseClient) {
      showFeedback('clienteFormFeedback', 'No se pudo conectar con Supabase.', 'error');
      return;
    }

    submitClienteBtn.disabled = true;
    submitClienteBtn.textContent = 'Registrando...';

    const currentUser = getCurrentUserLabel();
    const letra = NACIONALIDAD_LETRA[clienteNacionalidad.value];
    const nro = clienteNroIdentificacion.value.trim();

    const payload = {
      nacionalidad: clienteNacionalidad.value,
      nro_identificacion: nro,
      identificacion: `${letra}-${nro}`,
      nombre_cliente: clienteNombre.value.trim(),
      usuario_creacion: currentUser,
      usuario_modificacion: currentUser,
    };

    try {
      const { data, error } = await supabaseClient.from(TABLE_CLIENTES).insert([payload]).select('*').single();

      submitClienteBtn.disabled = false;
      submitClienteBtn.textContent = 'Registrar';

      if (error) {
        const prefix = error.code === '23505' ? 'Ya existe un cliente registrado con esa identificación.' : 'No se pudo registrar el cliente.';
        showFeedback('clienteFormFeedback', `${prefix} ${getErrorMessage(error)}`, 'error');
        return;
      }

      showFeedback('clienteFormFeedback', 'Cliente registrado correctamente.', 'success');
      await loadClientes();
      // Selecciona automáticamente el cliente recién creado como Asegurado
      if (data) comboCliente.setValue(data);
      setTimeout(closeClienteModalEmbebido, 700);
    } catch (err) {
      submitClienteBtn.disabled = false;
      submitClienteBtn.textContent = 'Registrar';
      showFeedback('clienteFormFeedback', `No se pudo guardar: ${getErrorMessage(err)}`, 'error');
    }
  });

  /* =========================================================
     TECLA ESCAPE
     ========================================================= */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (confirmOverlay.style.display === 'flex') { closeConfirmDialog(); return; }
    if (clienteModalOverlay.classList.contains('is-open')) { closeClienteModalEmbebido(); return; }
    if (cobrarModalOverlay.classList.contains('is-open')) { closeCobrarModal(); return; }
    if (detalleFraccionModalOverlay.classList.contains('is-open')) { closeDetalleFraccionModal(); return; }
    if (verFraccionesModalOverlay.classList.contains('is-open')) { closeVerFraccionesModal(); return; }
    if (anularPolizaModalOverlay.classList.contains('is-open')) { closeAnularPolizaModal(); return; }
    if (polizaModalOverlay.classList.contains('is-open')) closePolizaModal();
  });

  /* =========================================================
     CARGA DE DATOS DESDE SUPABASE
     ========================================================= */
  async function loadClientes() {
    const { data, error } = await supabaseClient.from(TABLE_CLIENTES).select('*').order('nombre_cliente', { ascending: true });
    if (!error) allClientes = data || [];
  }
  async function loadUsuarios() {
    const { data, error } = await supabaseClient.from(TABLE_USUARIOS).select('*').eq('status', 'Activo').order('full_name', { ascending: true });
    if (!error) allUsuarios = data || [];
  }
  async function loadSucursales() {
    const { data, error } = await supabaseClient.from(TABLE_SUCURSALES).select('*').order('sucursal', { ascending: true });
    if (!error) allSucursales = data || [];
  }
  async function loadAseguradoras() {
    const { data, error } = await supabaseClient.from(TABLE_ASEGURADORAS).select('*').eq('status', 'Activo').order('nombre', { ascending: true });
    if (!error) allAseguradoras = data || [];
  }
  async function loadRamos() {
    const { data, error } = await supabaseClient.from(TABLE_RAMOS).select('*').order('nombre_ramo', { ascending: true });
    if (!error) allRamos = data || [];
  }
  async function loadPlanes() {
    const { data, error } = await supabaseClient.from(TABLE_PLANES).select('*').eq('status', 'Activo');
    if (!error) allPlanes = data || [];
  }

  async function loadPolizas() {
    polizasLoading.style.display = 'block';
    polizasEmpty.style.display = 'none';
    polizasTableBody.innerHTML = '';

    if (!supabaseClient) {
      polizasLoading.style.display = 'none';
      polizasEmpty.textContent = 'Supabase no está inicializado.';
      polizasEmpty.style.display = 'block';
      return;
    }
    try {
      const { data, error } = await supabaseClient.from(TABLE_POLIZAS).select('*').order('fecha_creacion', { ascending: false });
      polizasLoading.style.display = 'none';
      if (error) {
        polizasEmpty.textContent = `Error al cargar pólizas: ${getErrorMessage(error)}`;
        polizasEmpty.style.display = 'block';
        return;
      }
      allPolizas = data || [];
      poblarFiltroAniosPoliza();
      applyFilterPolizas();
    } catch (err) {
      polizasLoading.style.display = 'none';
      polizasEmpty.textContent = `No se pudo conectar con Supabase: ${getErrorMessage(err)}`;
      polizasEmpty.style.display = 'block';
    }
  }

  async function loadFracciones() {
    fraccionesLoading.style.display = 'block';
    fraccionesEmpty.style.display = 'none';
    fraccionesTableBody.innerHTML = '';

    if (!supabaseClient) {
      fraccionesLoading.style.display = 'none';
      fraccionesEmpty.textContent = 'Supabase no está inicializado.';
      fraccionesEmpty.style.display = 'block';
      return;
    }
    try {
      const { data, error } = await supabaseClient.from(TABLE_FRACCIONES).select('*').order('fecha_inicio', { ascending: true });
      fraccionesLoading.style.display = 'none';
      if (error) {
        fraccionesEmpty.textContent = `Error al cargar fracciones: ${getErrorMessage(error)}`;
        fraccionesEmpty.style.display = 'block';
        return;
      }
      allFracciones = data || [];
      poblarFiltroAnios();
      applyFilterFracciones();
    } catch (err) {
      fraccionesLoading.style.display = 'none';
      fraccionesEmpty.textContent = `No se pudo conectar con Supabase: ${getErrorMessage(err)}`;
      fraccionesEmpty.style.display = 'block';
    }
  }

  /* =========================================================
     INICIO
     ========================================================= */
  updateSortIndicators(sortableHeadersPolizas, currentSortPolizas);
  updateSortIndicators(sortableHeadersFracciones, currentSortFracciones);

  await initSupabase();
  await Promise.all([loadClientes(), loadUsuarios(), loadSucursales(), loadAseguradoras(), loadRamos(), loadPlanes()]);
  await Promise.all([loadPolizas(), loadFracciones()]);

  aplicarFiltroClienteDesdeURL();
});
