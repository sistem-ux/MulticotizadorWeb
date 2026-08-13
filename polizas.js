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

  function openConfirmDialog({ title, message, acceptLabel = 'Eliminar' }) {
    const confirmOverlay = document.getElementById('confirmOverlay');
    const confirmTitle = document.getElementById('confirmTitle');
    const confirmMessage = document.getElementById('confirmMessage');
    const confirmAcceptBtn = document.getElementById('confirmAcceptBtn');
    if (!confirmOverlay) return Promise.resolve(false);
    confirmTitle.textContent = title;
    confirmMessage.textContent = message;
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

  function openPolizaModal({ edit = false, item = null, readOnly = false, clientePreseleccionado = null } = {}) {
    isEditModePoliza = edit;
    isReadOnlyPoliza = readOnly;
    currentPolizaItem = item;

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

      // Modo Ver siempre por defecto; "Editar" lo reactiva
      setPolizaFormDisabled(true);
      editPolizaBtn.style.display = readOnly ? 'inline-flex' : 'none';
      submitPolizaBtn.style.display = readOnly ? 'none' : 'inline-flex';
      submitPolizaBtn.textContent = 'Guardar Cambios';
      polizaModalOverlay.querySelector('.modal').classList.toggle('modal--readonly', readOnly);
      if (!readOnly) polizaModalTitle.textContent = 'Editar Póliza';
    } else {
      polizaModalTitle.textContent = 'Registrar Póliza';
      submitPolizaBtn.textContent = 'Registrar';
      polizaIdInput.value = '';
      setPolizaFormDisabled(false);
      editPolizaBtn.style.display = 'none';
      submitPolizaBtn.style.display = 'inline-flex';
      polizaModalOverlay.querySelector('.modal').classList.remove('modal--readonly');

      if (clientePreseleccionado) comboCliente.setValue(clientePreseleccionado);
    }

    polizaModalOverlay.classList.add('is-open');
  }

  function setPolizaFormDisabled(disabled) {
    [polizaClienteInput, polizaAsesorInput, polizaAseguradoraInput, polizaRamoInput, polizaTipoPoliza,
     polizaNroPoliza, polizaSumaAsegurada, polizaInicioVigencia, polizaPrima, polizaMensualFracciones]
      .forEach((el) => { el.disabled = disabled; });
    btnNuevoClienteDesdePoliza.disabled = disabled;
    polizaSucursal.disabled = disabled ? true : !sesionEsAdministrador();
    polizaFrecuenciaGroup.style.pointerEvents = disabled ? 'none' : 'auto';
    polizaFrecuenciaGroup.style.opacity = disabled ? '0.7' : '1';
  }

  function closePolizaModal() {
    polizaModalOverlay.classList.remove('is-open');
    polizaForm.reset();
    currentPolizaItem = null;
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

    const fracciones = generarFracciones({
      inicioVigencia: inicio,
      finVigencia: fin,
      prima,
      frecuencia: frecuenciaSeleccionada,
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
      frecuencia_pago: frecuenciaSeleccionada,
      mensual_fracciones: frecuenciaSeleccionada === 'Mensual' ? Number(polizaMensualFracciones.value) : null,
      cantidad_fracciones: fracciones.length,
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
        // Al editar, se regeneran las fracciones desde cero para reflejar
        // los nuevos datos (vigencia, prima o frecuencia pudieron cambiar).
        // ASUNCIÓN A CONFIRMAR: esto reemplaza fracciones aunque ya tengan
        // pagos registrados. Ajustar si se requiere bloquear la edición
        // cuando existan fracciones con status "Pagada".
        if (!error) {
          ({ error } = await supabaseClient.from(TABLE_FRACCIONES).delete().eq('poliza_id', polizaId));
        }
      } else {
        const insertResult = await supabaseClient.from(TABLE_POLIZAS).insert([payloadPoliza]).select('id').single();
        error = insertResult.error;
        polizaId = insertResult.data?.id;
      }

      if (error) {
        submitPolizaBtn.disabled = false;
        submitPolizaBtn.textContent = isEditModePoliza ? 'Guardar Cambios' : 'Registrar';
        const prefix = error.code === '23505' ? 'Ya existe una póliza con ese número para esta aseguradora.' : 'No se pudo guardar la póliza.';
        showFeedback('polizaFormFeedback', `${prefix} ${getErrorMessage(error)}`, 'error');
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
        usuario_creacion: currentUser,
        usuario_modificacion: currentUser,
      }));

      const { error: errorFracciones } = await supabaseClient.from(TABLE_FRACCIONES).insert(fraccionesPayload);

      submitPolizaBtn.disabled = false;
      submitPolizaBtn.textContent = isEditModePoliza ? 'Guardar Cambios' : 'Registrar';

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
      submitPolizaBtn.textContent = isEditModePoliza ? 'Guardar Cambios' : 'Registrar';
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
    return {
      ...p,
      cliente_nombre: cliente?.nombre_cliente || '—',
      aseguradora_nombre: aseguradora?.nombre || '—',
      ramo_nombre: ramo?.nombre_ramo || '—',
    };
  }

  function renderPolizas(items) {
    polizasTableBody.innerHTML = '';
    if (!items.length) { polizasEmpty.style.display = 'block'; return; }
    polizasEmpty.style.display = 'none';

    items.forEach((item) => {
      const statusClass = `status-pill--${(item.status || 'Vigente').toLowerCase()}`;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Cliente">${escapeHtml(item.cliente_nombre)}</td>
        <td data-label="Nro. Póliza">${escapeHtml(item.nro_poliza)}</td>
        <td data-label="Aseguradora">${escapeHtml(item.aseguradora_nombre)}</td>
        <td data-label="Ramo">${escapeHtml(item.ramo_nombre)}</td>
        <td data-label="Vigencia">${formatDateEs(item.inicio_vigencia)} — ${formatDateEs(item.fin_vigencia)}</td>
        <td data-label="Prima">${formatMoney(item.prima)}</td>
        <td data-label="Status"><span class="status-pill ${statusClass}">${escapeHtml(item.status || 'Vigente')}</span></td>
        <td data-label="Acciones" class="col-actions">
          <button type="button" class="action-btn action-btn--view" data-id="${item.id}" aria-label="Ver póliza">👁️</button>
          <button type="button" class="action-btn action-btn--delete" data-id="${item.id}" aria-label="Eliminar póliza">🗑️</button>
        </td>
      `;
      polizasTableBody.appendChild(tr);
      tr.querySelector('.action-btn--view').addEventListener('click', () => openPolizaModal({ edit: true, item, readOnly: true }));
      tr.querySelector('.action-btn--delete').addEventListener('click', () => handleDeletePoliza(item));
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
    } catch (err) {
      showNotification('polizasNotification', `No se pudo eliminar: ${getErrorMessage(err)}`, 'error');
    }
  }

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

  function fraccionConNombres(f) {
    const cliente = allClientes.find((c) => c.id === f.cliente_id);
    return { ...f, cliente_nombre: cliente?.nombre_cliente || '—' };
  }

  function renderFracciones(items) {
    fraccionesTableBody.innerHTML = '';
    if (!items.length) { fraccionesEmpty.style.display = 'block'; return; }
    fraccionesEmpty.style.display = 'none';

    items.forEach((item) => {
      const statusClass = `status-pill--${(item.status || 'Pendiente').toLowerCase()}`;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Cliente">${escapeHtml(item.cliente_nombre)}</td>
        <td data-label="Nro. Póliza">${escapeHtml(item.nro_poliza)}</td>
        <td data-label="N° Fracción">${item.numero_fraccion}</td>
        <td data-label="Inicio">${formatDateEs(item.fecha_inicio)}</td>
        <td data-label="Fin">${formatDateEs(item.fecha_fin)}</td>
        <td data-label="Prima">${formatMoney(item.prima)}</td>
        <td data-label="Status"><span class="status-pill ${statusClass}">${escapeHtml(item.status || 'Pendiente')}</span></td>
        <td data-label="Acciones" class="col-actions">
          <button type="button" class="action-btn action-btn--toggle-on" data-id="${item.id}" aria-label="Marcar como pagada" ${item.status === 'Pagada' ? 'style="display:none;"' : ''}>✓</button>
        </td>
      `;
      fraccionesTableBody.appendChild(tr);
      const toggleBtn = tr.querySelector('.action-btn--toggle-on');
      if (toggleBtn) toggleBtn.addEventListener('click', () => handleMarcarFraccionPagada(item));
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
    result = sortItems(result, currentSortFracciones.key, currentSortFracciones.direction);
    renderFracciones(result);
  }
  searchFracciones.addEventListener('input', applyFilterFracciones);
  clearSearchFracciones.addEventListener('click', () => { searchFracciones.value = ''; applyFilterFracciones(); searchFracciones.focus(); });

  async function handleMarcarFraccionPagada(item) {
    const currentUser = getCurrentUserLabel();
    try {
      const { error } = await supabaseClient.from(TABLE_FRACCIONES).update({ status: 'Pagada', usuario_modificacion: currentUser }).eq('id', item.id);
      if (error) { showNotification('fraccionesNotification', `No se pudo actualizar: ${getErrorMessage(error)}`, 'error'); return; }
      await loadFracciones();
      showNotification('fraccionesNotification', `Fracción #${item.numero_fraccion} marcada como Pagada.`, 'success');
    } catch (err) {
      showNotification('fraccionesNotification', `No se pudo actualizar: ${getErrorMessage(err)}`, 'error');
    }
  }

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
