/* =============================================================
   CONFIGURACIÓN DE SUPABASE
   ============================================================= */
const SUPABASE_URL = 'https://cibtpkpxdrykozujaqba.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_zlp4_HGpTeAQKW55c_pZQA_2HEXRpaC';

const TABLE_FRACCIONES = 'fracciones';
const TABLE_CLIENTES = 'clientes';

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
  NOTA: esta pantalla es la contraparte de "Pólizas", separada en su propia
  página pero manteniendo la misma relación de datos: cada fracción guarda
  poliza_id (FK) además de los campos denormalizados (cliente, nro_poliza,
  etc.) que ya se generan al registrar la póliza. El botón "Ver Fracciones"
  de polizas.html navega aquí con ?poliza_id=<id> para filtrar.
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

document.addEventListener('DOMContentLoaded', async () => {

  /* =========================================================
     ESTADO GENERAL
     ========================================================= */
  let allClientes = [];
  let allFracciones = [];
  let filtroPolizaId = null; // viene de ?poliza_id= en la URL (botón "Ver Fracciones" desde Pólizas)

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

  const filtroFraccionAnio = document.getElementById('filtroFraccionAnio');
  const filtroFraccionMes = document.getElementById('filtroFraccionMes');
  const resetFiltroFraccion = document.getElementById('resetFiltroFraccion');

  const fraccionesFilterChipWrap = document.getElementById('fraccionesFilterChipWrap');
  const fraccionesFilterChipNombre = document.getElementById('fraccionesFilterChipNombre');
  const fraccionesFilterChipClear = document.getElementById('fraccionesFilterChipClear');

  function fraccionConNombres(f) {
    const cliente = allClientes.find((c) => c.id === f.cliente_id);
    return { ...f, cliente_nombre: cliente?.nombre_cliente || '—' };
  }

  /* ---- Filtro Año / Mes: el año se alimenta desde la fracción más antigua
     (por fecha_inicio) hasta el año actual ---- */
  function poblarFiltroAnios() {
    const anioActual = new Date().getFullYear();
    const anios = allFracciones
      .map((f) => f.fecha_inicio ? Number(f.fecha_inicio.slice(0, 4)) : null)
      .filter((y) => Number.isInteger(y));
    const anioMin = anios.length ? Math.min(...anios, anioActual) : anioActual;

    const valorPrevio = filtroFraccionAnio.value || String(anioActual);
    filtroFraccionAnio.innerHTML = '';
    for (let y = anioActual; y >= anioMin; y--) {
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = String(y);
      filtroFraccionAnio.appendChild(opt);
    }
    filtroFraccionAnio.value = [...filtroFraccionAnio.options].some((o) => o.value === valorPrevio)
      ? valorPrevio
      : String(anioActual);
  }

  function resetearFiltroFraccion() {
    poblarFiltroAnios();
    filtroFraccionAnio.value = String(new Date().getFullYear());
    filtroFraccionMes.value = 'Todos';
    applyFilterFracciones();
  }
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
      const puedeCobrar = status === 'Por Cobrar';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Cliente">${escapeHtml(item.cliente_nombre)}</td>
        <td data-label="Nro. Póliza">${escapeHtml(item.nro_poliza)}</td>
        <td data-label="N° Fracción">${item.numero_fraccion}</td>
        <td data-label="Inicio">${formatDateEs(item.fecha_inicio)}</td>
        <td data-label="Fin">${formatDateEs(item.fecha_fin)}</td>
        <td data-label="Prima">${formatMoney(item.prima)}</td>
        <td data-label="Status"><span class="status-pill ${statusClass}">${escapeHtml(status)}</span></td>
        <td data-label="Acciones" class="col-actions">
          ${puedeCobrar ? `<button type="button" class="action-btn action-btn--cobrar" data-id="${item.id}" aria-label="Cobrar fracción" title="Cobrar">💰</button>` : ''}
        </td>
      `;
      fraccionesTableBody.appendChild(tr);
      const cobrarBtn = tr.querySelector('.action-btn--cobrar');
      if (cobrarBtn) cobrarBtn.addEventListener('click', () => openCobrarModal(item));
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

    if (filtroPolizaId) result = result.filter((f) => f.poliza_id === filtroPolizaId);

    if (term) {
      result = result.filter((f) => f.cliente_nombre.toLowerCase().includes(term) || f.nro_poliza.toLowerCase().includes(term));
    }

    const anioSel = filtroFraccionAnio.value;
    const mesSel = filtroFraccionMes.value;
    if (anioSel) {
      result = result.filter((f) => f.fecha_inicio && f.fecha_inicio.slice(0, 4) === anioSel);
    }
    if (mesSel && mesSel !== 'Todos') {
      result = result.filter((f) => f.fecha_inicio && String(Number(f.fecha_inicio.slice(5, 7))) === mesSel);
    }

    result = sortItems(result, currentSortFracciones.key, currentSortFracciones.direction);
    renderFracciones(result);
  }
  searchFracciones.addEventListener('input', applyFilterFracciones);
  clearSearchFracciones.addEventListener('click', () => { searchFracciones.value = ''; applyFilterFracciones(); searchFracciones.focus(); });

  /* Filtro por poliza_id en la URL (botón "Ver Fracciones" desde Pólizas) */
  function aplicarFiltroPolizaDesdeURL() {
    const params = new URLSearchParams(window.location.search);
    const polizaId = params.get('poliza_id');
    if (!polizaId) return;
    filtroPolizaId = polizaId;
    const fraccionRef = allFracciones.find((f) => f.poliza_id === polizaId);
    fraccionesFilterChipNombre.textContent = fraccionRef ? fraccionRef.nro_poliza : polizaId;
    fraccionesFilterChipWrap.style.display = 'block';
    applyFilterFracciones();
  }
  fraccionesFilterChipClear.addEventListener('click', () => {
    filtroPolizaId = null;
    fraccionesFilterChipWrap.style.display = 'none';
    const url = new URL(window.location.href);
    url.searchParams.delete('poliza_id');
    window.history.replaceState({}, '', url);
    applyFilterFracciones();
  });

  /* =========================================================
     COBRAR FRACCIÓN
     ========================================================= */
  const cobrarModalOverlay = document.getElementById('cobrarModalOverlay');
  const cobrarModalCloseBtn = document.getElementById('cobrarModalCloseBtn');
  const cancelCobrarBtn = document.getElementById('cancelCobrarBtn');
  const cobrarForm = document.getElementById('cobrarForm');
  const cobrarFecha = document.getElementById('cobrarFecha');
  const cobrarMoneda = document.getElementById('cobrarMoneda');
  const cobrarPrima = document.getElementById('cobrarPrima');
  const cobrarFechaIngreso = document.getElementById('cobrarFechaIngreso');
  const submitCobrarBtn = document.getElementById('submitCobrarBtn');
  const fieldCobrarFecha = document.getElementById('fieldCobrarFecha');
  const fieldCobrarMoneda = document.getElementById('fieldCobrarMoneda');
  const fieldCobrarPrima = document.getElementById('fieldCobrarPrima');
  const fieldCobrarFechaIngreso = document.getElementById('fieldCobrarFechaIngreso');
  attachMoneyFormatter(cobrarPrima);
  let fraccionACobrar = null;

  function openCobrarModal(fraccion) {
    fraccionACobrar = fraccion;
    cobrarForm.reset();
    clearFeedback('cobrarFormFeedback');
    [fieldCobrarFecha, fieldCobrarMoneda, fieldCobrarPrima, fieldCobrarFechaIngreso].forEach((f) => setFieldError(f, false));
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
    const monedaOk = !!cobrarMoneda.value;
    setFieldError(fieldCobrarMoneda, !monedaOk); if (!monedaOk) valid = false;
    const primaOk = parseMoneyInput(cobrarPrima.value) > 0;
    setFieldError(fieldCobrarPrima, !primaOk); if (!primaOk) valid = false;
    const fechaIngresoOk = !!cobrarFechaIngreso.value;
    setFieldError(fieldCobrarFechaIngreso, !fechaIngresoOk); if (!fechaIngresoOk) valid = false;
    if (!valid) {
      showFeedback('cobrarFormFeedback', 'Revisa los campos marcados antes de continuar.', 'error');
      return;
    }

    submitCobrarBtn.disabled = true;
    submitCobrarBtn.textContent = 'Registrando...';
    const currentUser = getCurrentUserLabel();

    const payload = {
      status: 'Cobrado',
      fecha_cobro: cobrarFecha.value,
      moneda_pago: cobrarMoneda.value,
      prima: parseMoneyInput(cobrarPrima.value),
      fecha_ingreso_aseguradora: cobrarFechaIngreso.value,
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

      await loadFracciones();
      showNotification('fraccionesNotification', `Fracción #${fraccionACobrar.numero_fraccion} cobrada correctamente.`, 'success');
      closeCobrarModal();
    } catch (err) {
      submitCobrarBtn.disabled = false;
      submitCobrarBtn.textContent = 'Registrar Cobro';
      showFeedback('cobrarFormFeedback', `No se pudo registrar el cobro: ${getErrorMessage(err)}`, 'error');
    }
  });

  /* =========================================================
     TECLA ESCAPE
     ========================================================= */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (cobrarModalOverlay.classList.contains('is-open')) closeCobrarModal();
  });

  /* =========================================================
     CARGA DE DATOS DESDE SUPABASE
     ========================================================= */
  async function loadClientes() {
    const { data, error } = await supabaseClient.from(TABLE_CLIENTES).select('*').order('nombre_cliente', { ascending: true });
    if (!error) allClientes = data || [];
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
  updateSortIndicators(sortableHeadersFracciones, currentSortFracciones);

  await initSupabase();
  await loadClientes();
  await loadFracciones();

  aplicarFiltroPolizaDesdeURL();
});