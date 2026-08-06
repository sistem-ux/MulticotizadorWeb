/* =============================================================
   CONFIGURACIÓN DE SUPABASE
   (Misma configuración que usuarios.js / aseguradoras.js)
   ============================================================= */
const SUPABASE_URL = 'https://cibtpkpxdrykozujaqba.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_zlp4_HGpTeAQKW55c_pZQA_2HEXRpaC';
const TABLE_ASEGURADORAS = 'aseguradoras';
const TABLE_PRODUCTOS = 'productos';
const TABLE_PLANES = 'planes';
const TABLE_TARIFAS_EDAD = 'plan_tarifas_edad';
const TABLE_TARIFAS_HIJOS = 'plan_tarifas_hijos';
const TABLE_OPCIONALES = 'opcionales';
const TABLE_OPCIONALES_PLANES = 'opcionales_planes';

let supabaseClient = null;

async function initSupabase() {
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.info('Supabase inicializado desde UMD.');
    return;
  }
  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm');
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.info('Supabase inicializado desde ESM fallback.');
  } catch (err) {
    console.error('No se pudo importar Supabase:', err);
  }
}

/* =============================================================
   CONSTANTES DEL MOTOR DE TARIFAS
   ============================================================= */

// Rangos de edad tal como están en la hoja "02.Planes" del Excel original.
const AGE_BANDS = [
  [0, 9], [10, 15], [16, 17], [18, 18], [19, 19], [20, 24], [25, 29], [30, 30],
  [31, 34], [35, 35], [36, 39], [40, 40], [41, 44], [45, 45], [46, 49], [50, 50],
  [51, 54], [55, 55], [56, 59], [60, 60], [61, 64], [65, 65], [66, 69], [70, 70],
  [71, 74], [75, 75], [76, 79], [80, 80], [81, 84], [85, 85], [86, 89], [90, 90],
  [91, 94], [95, 95], [96, 99],
];

const HIJOS_BANDS = [
  { key: '1', label: '1 Hijo' },
  { key: '2', label: '2 Hijos' },
  { key: '3', label: '3 Hijos' },
  { key: '+4', label: '+4 Hijos' },
];

// Coberturas base del plan (columna coberturas jsonb). Cada una acepta
// OPCIONAL / INCLUIDO / NO CONTEMPLA. "maternidad" además guarda la edad
// máxima permitida para esa cobertura.
const COBERTURA_FIELDS = [
  { key: 'funerarios', label: 'Funerarios' },
  { key: 'asistencia_viajes', label: 'Asistencia en Viajes' },
  { key: 'maternidad', label: 'Maternidad', hasEdadMax: true },
  { key: 'invalidez_permanente', label: 'Invalidez Permanente' },
  { key: 'muerte_accidental', label: 'Muerte Accidental' },
  { key: 'odontologia', label: 'Odontología' },
  { key: 'oftalmologia', label: 'Oftalmología' },
  { key: 'dermatologia', label: 'Dermatología' },
  { key: 'psicologia', label: 'Psicología' },
  { key: 'serv_adicionales', label: 'Servicios Adicionales' },
];

const COBERTURA_OPTIONS = ['NO CONTEMPLA', 'OPCIONAL', 'INCLUIDO'];

// Fraccionamiento de pago (columna fraccionamiento jsonb). Cada modalidad
// tiene su variante normal y su variante en USD.
const FRACCIONAMIENTO_FIELDS = [
  { key: 'semestral', label: 'Semestral' },
  { key: 'cuatrimestral', label: 'Cuatrimestral' },
  { key: 'trimestral', label: 'Trimestral' },
  { key: 'bimestral', label: 'Bimestral' },
  { key: 'mensual', label: 'Mensual' },
];

/* =============================================================
   UTILIDADES COMPARTIDAS
   ============================================================= */

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

function formatMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  return Number(v).toLocaleString('es-VE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

document.addEventListener('DOMContentLoaded', async () => {

  /* =========================================================
     ESTADO GENERAL
     ========================================================= */
  let allAseguradoras = [];
  let allProductos = [];
  let allPlanes = [];
  let allOpcionales = [];

  let isEditModePlan = false;
  let isEditModeOpcional = false;
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
  confirmOverlay.addEventListener('click', (e) => {
    if (e.target === confirmOverlay) closeConfirmDialog();
  });

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

  function sortItems(items, key, direction, getter) {
    const factor = direction === 'desc' ? -1 : 1;
    return [...items].sort((a, b) => {
      const va = (getter ? getter(a, key) : a[key] ?? '').toString().toLowerCase();
      const vb = (getter ? getter(b, key) : b[key] ?? '').toString().toLowerCase();
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
     PESTAÑAS
     ========================================================= */
  const tabButtons = document.querySelectorAll('.tab-btn');
  const panels = {
    planes: document.getElementById('panelPlanes'),
    opcionales: document.getElementById('panelOpcionales'),
  };

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      tabButtons.forEach((b) => b.classList.toggle('is-active', b === btn));
      Object.entries(panels).forEach(([key, panel]) => {
        panel.classList.toggle('is-active', key === target);
      });
    });
  });

  /* =========================================================================
     =============================  PLANES  ====================================
     ========================================================================= */

  const searchPlanes = document.getElementById('searchPlanes');
  const clearSearchPlanes = document.getElementById('clearSearchPlanes');
  const planesTableBody = document.getElementById('planesTableBody');
  const planesLoading = document.getElementById('planesLoading');
  const planesEmpty = document.getElementById('planesEmpty');
  const openPlanModalBtn = document.getElementById('openPlanModalBtn');

  const planModalOverlay = document.getElementById('planModalOverlay');
  const planModalTitle = document.getElementById('planModalTitle');
  const planModalCloseBtn = document.getElementById('planModalCloseBtn');
  const cancelPlanModalBtn = document.getElementById('cancelPlanModalBtn');
  const planForm = document.getElementById('planForm');
  const planIdInput = document.getElementById('planId');
  const planAseguradoraSelect = document.getElementById('planAseguradora');
  const planProductoSelect = document.getElementById('planProducto');
  const planCodigoInput = document.getElementById('planCodigo');
  const planTipoTarifaInput = document.getElementById('planTipoTarifa');
  const planSumaAseguradaInput = document.getElementById('planSumaAsegurada');
  const planDeducibleInput = document.getElementById('planDeducible');
  const planDeducibleExteriorInput = document.getElementById('planDeducibleExterior');
  const planEdadMinTarifaInput = document.getElementById('planEdadMinTarifa');
  const planStatusInput = document.getElementById('planStatus');
  const planStatusProductoInput = document.getElementById('planStatusProducto');
  const planFinanciableInput = document.getElementById('planFinanciable');
  const planEdadMinTitularInput = document.getElementById('planEdadMinTitular');
  const planEdadMaxTitularInput = document.getElementById('planEdadMaxTitular');
  const planEdadMinFamiliaresInput = document.getElementById('planEdadMinFamiliares');
  const planEdadMaxFamiliaresInput = document.getElementById('planEdadMaxFamiliares');
  const planServAdicionalesPlanesInput = document.getElementById('planServAdicionalesPlanes');
  const planDescPagoContadoAplicaInput = document.getElementById('planDescPagoContadoAplica');
  const planDescPagoContadoPctInput = document.getElementById('planDescPagoContadoPct');
  const planDescPagoDivisasAplicaInput = document.getElementById('planDescPagoDivisasAplica');
  const planDescPagoDivisasPctInput = document.getElementById('planDescPagoDivisasPct');
  const planGastoAdminFraccionamientoInput = document.getElementById('planGastoAdminFraccionamiento');
  const planModoTarifaHijosSelect = document.getElementById('planModoTarifaHijos');
  const hijosGridWrapper = document.getElementById('hijosGridWrapper');
  const hijosGridContainer = document.getElementById('hijosGridContainer');
  const coberturasContainer = document.getElementById('coberturasContainer');
  const fraccionamientoContainer = document.getElementById('fraccionamientoContainer');
  const tarifasGridContainer = document.getElementById('tarifasGridContainer');
  const submitPlanBtn = document.getElementById('submitPlanBtn');
  const editPlanModalBtn = document.getElementById('editPlanModalBtn');

  const fieldPlanAseguradora = document.getElementById('fieldPlanAseguradora');
  const fieldPlanProducto = document.getElementById('fieldPlanProducto');
  const fieldPlanCodigo = document.getElementById('fieldPlanCodigo');

  let currentSortPlanes = { key: 'codigo', direction: 'asc' };
  const sortableHeadersPlanes = document.querySelectorAll('#planesTable th.is-sortable');

  // -----------------------------------------------------------------
  // Construcción dinámica de sub-formularios dentro del modal de Plan
  // -----------------------------------------------------------------
  function buildCoberturasFields() {
    coberturasContainer.innerHTML = '';
    COBERTURA_FIELDS.forEach((cf) => {
      const row = document.createElement('div');
      row.className = 'cobertura-row';
      row.innerHTML = `
        <span class="cobertura-label">${cf.label}</span>
        <select id="cob_${cf.key}" class="text-input">
          ${COBERTURA_OPTIONS.map((o) => `<option value="${o}">${o}</option>`).join('')}
        </select>
        ${cf.hasEdadMax ? `<input type="number" id="cob_${cf.key}_edad_max" class="text-input cobertura-extra" placeholder="Edad máx." min="0" max="99">` : ''}
      `;
      coberturasContainer.appendChild(row);
    });
  }

  function buildFraccionamientoFields() {
    fraccionamientoContainer.innerHTML = '';
    FRACCIONAMIENTO_FIELDS.forEach((ff) => {
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <div class="checkbox-inline">
          <input type="checkbox" id="frac_${ff.key}">
          <label for="frac_${ff.key}">${ff.label}</label>
        </div>
        <div class="checkbox-inline" style="margin-left: 1.25rem;">
          <input type="checkbox" id="frac_${ff.key}_usd">
          <label for="frac_${ff.key}_usd">${ff.label} (USD)</label>
        </div>
      `;
      fraccionamientoContainer.appendChild(wrap);
    });
  }

  function buildTarifasGrid() {
    tarifasGridContainer.innerHTML = '';
    AGE_BANDS.forEach(([desde, hasta]) => {
      const cell = document.createElement('div');
      cell.className = 'tarifa-cell';
      cell.innerHTML = `
        <label for="tarifa_${desde}_${hasta}">${String(desde).padStart(2, '0')}-${String(hasta).padStart(2, '0')}</label>
        <input type="number" id="tarifa_${desde}_${hasta}" step="0.01" min="0" placeholder="—">
      `;
      tarifasGridContainer.appendChild(cell);
    });
  }

  function buildHijosGrid() {
    hijosGridContainer.innerHTML = '';
    HIJOS_BANDS.forEach((hb) => {
      const cell = document.createElement('div');
      cell.className = 'tarifa-cell';
      cell.innerHTML = `
        <label for="hijos_${hb.key}">${hb.label}</label>
        <input type="number" id="hijos_${hb.key}" step="0.01" min="0" placeholder="—">
      `;
      hijosGridContainer.appendChild(cell);
    });
  }

  buildCoberturasFields();
  buildFraccionamientoFields();
  buildTarifasGrid();
  buildHijosGrid();

  planModoTarifaHijosSelect.addEventListener('change', () => {
    hijosGridWrapper.style.display = planModoTarifaHijosSelect.value === 'POR CANTIDAD DE HIJOS' ? 'block' : 'none';
  });

  function clearTarifasGrid() {
    AGE_BANDS.forEach(([desde, hasta]) => {
      document.getElementById(`tarifa_${desde}_${hasta}`).value = '';
    });
    HIJOS_BANDS.forEach((hb) => { document.getElementById(`hijos_${hb.key}`).value = ''; });
  }

  function resetCoberturasFields() {
    COBERTURA_FIELDS.forEach((cf) => {
      document.getElementById(`cob_${cf.key}`).value = 'NO CONTEMPLA';
      if (cf.hasEdadMax) document.getElementById(`cob_${cf.key}_edad_max`).value = '';
    });
  }

  function resetFraccionamientoFields() {
    FRACCIONAMIENTO_FIELDS.forEach((ff) => {
      document.getElementById(`frac_${ff.key}`).checked = false;
      document.getElementById(`frac_${ff.key}_usd`).checked = false;
    });
  }

  function populateAseguradoraSelects() {
    [planAseguradoraSelect, document.getElementById('opcionalAseguradora')].forEach((select) => {
      if (!select) return;
      const previousValue = select.value;
      select.innerHTML = '<option value="">Selecciona una aseguradora</option>';
      allAseguradoras.forEach((a) => {
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = a.nombre;
        select.appendChild(opt);
      });
      if (previousValue) select.value = previousValue;
    });
  }

  function populateProductoSelect(selectEl, aseguradoraId, selectedValue = '') {
    selectEl.innerHTML = '';
    const productos = allProductos.filter((p) => p.aseguradora_id === aseguradoraId);
    if (!aseguradoraId) {
      selectEl.innerHTML = '<option value="">Selecciona primero una aseguradora</option>';
      selectEl.disabled = true;
      return;
    }
    selectEl.disabled = false;
    selectEl.innerHTML = '<option value="">Selecciona un producto</option>';
    productos.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.nombre;
      selectEl.appendChild(opt);
    });
    if (selectedValue) selectEl.value = selectedValue;
  }

  planAseguradoraSelect.addEventListener('change', () => {
    populateProductoSelect(planProductoSelect, planAseguradoraSelect.value);
  });

  function planFields() {
    return [planAseguradoraSelect, planProductoSelect, planCodigoInput, planTipoTarifaInput,
      planSumaAseguradaInput, planDeducibleInput, planDeducibleExteriorInput, planEdadMinTarifaInput,
      planStatusInput, planStatusProductoInput, planFinanciableInput, planEdadMinTitularInput,
      planEdadMaxTitularInput, planEdadMinFamiliaresInput, planEdadMaxFamiliaresInput,
      planServAdicionalesPlanesInput, planDescPagoContadoAplicaInput, planDescPagoContadoPctInput,
      planDescPagoDivisasAplicaInput, planDescPagoDivisasPctInput, planGastoAdminFraccionamientoInput,
      planModoTarifaHijosSelect];
  }

  async function openPlanModal({ edit = false, item = null, viewOnly = false } = {}) {
    isEditModePlan = edit;
    planForm.reset();
    clearFeedback('planFormFeedback');
    [fieldPlanAseguradora, fieldPlanProducto, fieldPlanCodigo].forEach((f) => setFieldError(f, false));
    resetCoberturasFields();
    resetFraccionamientoFields();
    clearTarifasGrid();
    hijosGridWrapper.style.display = 'none';

    if (item) {
      planModalTitle.textContent = viewOnly ? 'Ver Plan' : 'Editar Plan';
      submitPlanBtn.textContent = 'Guardar Cambios';
      planIdInput.value = item.id;
      planAseguradoraSelect.value = item.aseguradora_id;
      populateProductoSelect(planProductoSelect, item.aseguradora_id, item.producto_id);
      planCodigoInput.value = item.codigo || '';
      planTipoTarifaInput.value = item.tipo_tarifa || 'EMISIÓN';
      planSumaAseguradaInput.value = item.suma_asegurada ?? '';
      planDeducibleInput.value = item.deducible ?? 0;
      planDeducibleExteriorInput.value = item.deducible_exterior ?? 0;
      planEdadMinTarifaInput.value = item.edad_minima_tarifa ?? 0;
      planStatusInput.value = item.status || 'ACTIVO';
      planStatusProductoInput.value = item.status_producto || 'ACTIVO';
      planFinanciableInput.checked = !!item.financiable;
      planEdadMinTitularInput.value = item.edad_minima_titular ?? 0;
      planEdadMaxTitularInput.value = item.edad_maxima_titular ?? 99;
      planEdadMinFamiliaresInput.value = item.edad_minima_familiares ?? 0;
      planEdadMaxFamiliaresInput.value = item.edad_maxima_familiares ?? 99;
      planServAdicionalesPlanesInput.value = (item.serv_adicionales_planes || []).join(', ');
      planModoTarifaHijosSelect.value = item.modo_tarifa_hijos || 'POR HIJO';
      hijosGridWrapper.style.display = planModoTarifaHijosSelect.value === 'POR CANTIDAD DE HIJOS' ? 'block' : 'none';

      const cob = item.coberturas || {};
      COBERTURA_FIELDS.forEach((cf) => {
        const el = document.getElementById(`cob_${cf.key}`);
        if (el && cob[cf.key]) el.value = cob[cf.key];
        if (cf.hasEdadMax) {
          const edadEl = document.getElementById(`cob_${cf.key}_edad_max`);
          if (edadEl) edadEl.value = cob[`${cf.key}_edad_max`] ?? '';
        }
      });

      const desc = item.descuentos || {};
      planDescPagoContadoAplicaInput.checked = !!desc.pago_contado_aplica;
      planDescPagoContadoPctInput.value = desc.pago_contado_pct ?? 0;
      planDescPagoDivisasAplicaInput.checked = !!desc.pago_divisas_aplica;
      planDescPagoDivisasPctInput.value = desc.pago_divisas_pct ?? 0;

      const frac = item.fraccionamiento || {};
      FRACCIONAMIENTO_FIELDS.forEach((ff) => {
        document.getElementById(`frac_${ff.key}`).checked = !!frac[ff.key];
        document.getElementById(`frac_${ff.key}_usd`).checked = !!frac[`${ff.key}_usd`];
      });
      planGastoAdminFraccionamientoInput.value = frac.gasto_admin_fraccionamiento ?? 0;

      // Cargar tarifas por edad y por hijos existentes desde Supabase
      try {
        const { data: tarifasEdad } = await supabaseClient
          .from(TABLE_TARIFAS_EDAD).select('edad_desde, edad_hasta, tarifa').eq('plan_id', item.id);
        (tarifasEdad || []).forEach((t) => {
          const el = document.getElementById(`tarifa_${t.edad_desde}_${t.edad_hasta}`);
          if (el) el.value = t.tarifa;
        });

        const { data: tarifasHijos } = await supabaseClient
          .from(TABLE_TARIFAS_HIJOS).select('num_hijos, tarifa').eq('plan_id', item.id);
        (tarifasHijos || []).forEach((t) => {
          const el = document.getElementById(`hijos_${t.num_hijos}`);
          if (el) el.value = t.tarifa;
        });
      } catch (err) {
        console.error('No se pudieron cargar las tarifas del plan:', err);
      }
    } else {
      planModalTitle.textContent = 'Registrar Plan';
      submitPlanBtn.textContent = 'Registrar';
      planIdInput.value = '';
      planStatusInput.value = 'ACTIVO';
      planStatusProductoInput.value = 'ACTIVO';
      planTipoTarifaInput.value = 'EMISIÓN';
      planDeducibleInput.value = 0;
      planDeducibleExteriorInput.value = 0;
      planEdadMinTarifaInput.value = 0;
      planEdadMinTitularInput.value = 0;
      planEdadMaxTitularInput.value = 99;
      planEdadMinFamiliaresInput.value = 0;
      planEdadMaxFamiliaresInput.value = 99;
      planModoTarifaHijosSelect.value = 'POR HIJO';
      populateProductoSelect(planProductoSelect, '');
      planCodigoInput.value = `PLAN-${Math.random().toString(16).slice(2, 10).toUpperCase()}`;
    }

    const isViewMode = viewOnly && !!item;
    planFields().forEach((f) => { f.disabled = isViewMode; });
    coberturasContainer.querySelectorAll('input, select').forEach((f) => { f.disabled = isViewMode; });
    fraccionamientoContainer.querySelectorAll('input').forEach((f) => { f.disabled = isViewMode; });
    tarifasGridContainer.querySelectorAll('input').forEach((f) => { f.disabled = isViewMode; });
    hijosGridContainer.querySelectorAll('input').forEach((f) => { f.disabled = isViewMode; });
    if (isViewMode) planProductoSelect.disabled = true;

    if (isViewMode) {
      submitPlanBtn.style.display = 'none';
      editPlanModalBtn.style.display = 'inline-flex';
    } else {
      submitPlanBtn.style.display = 'inline-flex';
      editPlanModalBtn.style.display = 'none';
    }

    planModalOverlay.classList.add('is-open');
  }

  function closePlanModal() {
    planModalOverlay.classList.remove('is-open');
    planForm.reset();
    planFields().forEach((f) => { f.disabled = false; });
    coberturasContainer.querySelectorAll('input, select').forEach((f) => { f.disabled = false; });
    fraccionamientoContainer.querySelectorAll('input').forEach((f) => { f.disabled = false; });
    tarifasGridContainer.querySelectorAll('input').forEach((f) => { f.disabled = false; });
    hijosGridContainer.querySelectorAll('input').forEach((f) => { f.disabled = false; });
    submitPlanBtn.style.display = 'inline-flex';
    editPlanModalBtn.style.display = 'none';
  }

  openPlanModalBtn.addEventListener('click', () => openPlanModal({ edit: false }));
  editPlanModalBtn.addEventListener('click', () => {
    isEditModePlan = true;
    planFields().forEach((f) => { f.disabled = false; });
    coberturasContainer.querySelectorAll('input, select').forEach((f) => { f.disabled = false; });
    fraccionamientoContainer.querySelectorAll('input').forEach((f) => { f.disabled = false; });
    tarifasGridContainer.querySelectorAll('input').forEach((f) => { f.disabled = false; });
    hijosGridContainer.querySelectorAll('input').forEach((f) => { f.disabled = false; });
    submitPlanBtn.style.display = 'inline-flex';
    editPlanModalBtn.style.display = 'none';
    submitPlanBtn.textContent = 'Guardar Cambios';
  });
  planModalCloseBtn.addEventListener('click', closePlanModal);
  cancelPlanModalBtn.addEventListener('click', closePlanModal);
  planModalOverlay.addEventListener('click', (e) => { if (e.target === planModalOverlay) closePlanModal(); });

  function validatePlanForm() {
    let valid = true;

    const aseguradoraOk = planAseguradoraSelect.value.trim().length > 0;
    setFieldError(fieldPlanAseguradora, !aseguradoraOk);
    if (!aseguradoraOk) valid = false;

    const productoOk = planProductoSelect.value.trim().length > 0;
    setFieldError(fieldPlanProducto, !productoOk);
    if (!productoOk) valid = false;

    const codigoOk = /^[A-Za-z0-9\-]{3,}$/.test(planCodigoInput.value.trim());
    setFieldError(fieldPlanCodigo, !codigoOk);
    if (!codigoOk) valid = false;

    if (!planSumaAseguradaInput.value || Number(planSumaAseguradaInput.value) <= 0) valid = false;

    return valid;
  }

  function collectCoberturasPayload() {
    const cob = {};
    COBERTURA_FIELDS.forEach((cf) => {
      cob[cf.key] = document.getElementById(`cob_${cf.key}`).value;
      if (cf.hasEdadMax) {
        const v = document.getElementById(`cob_${cf.key}_edad_max`).value;
        cob[`${cf.key}_edad_max`] = v === '' ? null : Number(v);
      }
    });
    return cob;
  }

  function collectFraccionamientoPayload() {
    const frac = {};
    FRACCIONAMIENTO_FIELDS.forEach((ff) => {
      frac[ff.key] = document.getElementById(`frac_${ff.key}`).checked;
      frac[`${ff.key}_usd`] = document.getElementById(`frac_${ff.key}_usd`).checked;
    });
    frac.gasto_admin_fraccionamiento = Number(planGastoAdminFraccionamientoInput.value) || 0;
    return frac;
  }

  function collectTarifasEdadPayload(planId) {
    const rows = [];
    AGE_BANDS.forEach(([desde, hasta]) => {
      const v = document.getElementById(`tarifa_${desde}_${hasta}`).value;
      if (v !== '') rows.push({ plan_id: planId, edad_desde: desde, edad_hasta: hasta, tarifa: Number(v) });
    });
    return rows;
  }

  function collectTarifasHijosPayload(planId) {
    const rows = [];
    HIJOS_BANDS.forEach((hb) => {
      const v = document.getElementById(`hijos_${hb.key}`).value;
      if (v !== '') rows.push({ plan_id: planId, num_hijos: hb.key, tarifa: Number(v) });
    });
    return rows;
  }

  function renderPlanes(items) {
    planesTableBody.innerHTML = '';
    if (!items.length) {
      planesEmpty.style.display = 'block';
      return;
    }
    planesEmpty.style.display = 'none';

    items.forEach((item) => {
      const tr = document.createElement('tr');
      const statusClass = item.status === 'ACTIVO' ? 'status-pill--activo' : 'status-pill--inactivo';
      const aseguradoraNombre = item.aseguradoras?.nombre || '—';
      const productoNombre = item.productos?.nombre || '—';

      tr.innerHTML = `
        <td data-label="Código">${escapeHtml(item.codigo)}</td>
        <td data-label="Aseguradora">${escapeHtml(aseguradoraNombre)}</td>
        <td data-label="Producto">${escapeHtml(productoNombre)}</td>
        <td data-label="Suma Asegurada">${formatMoney(item.suma_asegurada)}</td>
        <td data-label="Deducible">${formatMoney(item.deducible)}</td>
        <td data-label="Estado"><span class="status-pill ${statusClass}">${escapeHtml(item.status)}</span></td>
        <td data-label="Acciones" class="col-actions">
          <button type="button" class="action-btn action-btn--view" data-id="${item.id}" aria-label="Ver plan">👁</button>
          <button type="button" class="action-btn action-btn--delete" data-id="${item.id}" aria-label="Eliminar plan">🗑️</button>
        </td>
      `;
      planesTableBody.appendChild(tr);

      tr.querySelector('.action-btn--view').addEventListener('click', () => {
        openPlanModal({ edit: false, item, viewOnly: true });
      });
      tr.querySelector('.action-btn--delete').addEventListener('click', () => handleDeletePlan(item.id));
    });
  }

  sortableHeadersPlanes.forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sortKey;
      if (currentSortPlanes.key === key) {
        currentSortPlanes.direction = currentSortPlanes.direction === 'asc' ? 'desc' : 'asc';
      } else {
        currentSortPlanes = { key, direction: 'asc' };
      }
      updateSortIndicators(sortableHeadersPlanes, currentSortPlanes);
      applyFilterPlanes();
    });
  });

  function applyFilterPlanes() {
    const term = searchPlanes.value.trim().toLowerCase();
    clearSearchPlanes.classList.toggle('is-visible', term.length > 0);
    let result = allPlanes;
    if (term) {
      result = result.filter((p) =>
        p.codigo.toLowerCase().includes(term) ||
        (p.aseguradoras?.nombre || '').toLowerCase().includes(term) ||
        (p.productos?.nombre || '').toLowerCase().includes(term));
    }
    result = sortItems(result, currentSortPlanes.key, currentSortPlanes.direction);
    renderPlanes(result);
  }

  searchPlanes.addEventListener('input', applyFilterPlanes);
  clearSearchPlanes.addEventListener('click', () => {
    searchPlanes.value = '';
    applyFilterPlanes();
    searchPlanes.focus();
  });

  async function loadPlanes() {
    planesLoading.style.display = 'block';
    planesEmpty.style.display = 'none';
    planesTableBody.innerHTML = '';

    if (!supabaseClient) {
      planesLoading.style.display = 'none';
      planesEmpty.textContent = 'Supabase no está inicializado.';
      planesEmpty.style.display = 'block';
      return;
    }

    try {
      const { data, error } = await supabaseClient
        .from(TABLE_PLANES)
        .select('*, aseguradoras(nombre), productos(nombre)')
        .order('codigo', { ascending: true });

      planesLoading.style.display = 'none';

      if (error) {
        planesEmpty.textContent = `Error al cargar planes: ${getErrorMessage(error)}`;
        planesEmpty.style.display = 'block';
        return;
      }

      allPlanes = data || [];
      applyFilterPlanes();
    } catch (err) {
      planesLoading.style.display = 'none';
      planesEmpty.textContent = `No se pudo conectar con Supabase: ${getErrorMessage(err)}`;
      planesEmpty.style.display = 'block';
    }
  }

  planForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFeedback('planFormFeedback');

    if (!validatePlanForm()) {
      showFeedback('planFormFeedback', 'Revisa los campos marcados antes de continuar.', 'error');
      return;
    }
    if (!supabaseClient) {
      showFeedback('planFormFeedback', 'No se pudo conectar con Supabase.', 'error');
      return;
    }

    submitPlanBtn.disabled = true;
    submitPlanBtn.textContent = isEditModePlan ? 'Guardando...' : 'Registrando...';

    const servAdicionalesPlanes = planServAdicionalesPlanesInput.value
      .split(',').map((s) => s.trim()).filter(Boolean);

    const payload = {
      aseguradora_id: planAseguradoraSelect.value,
      producto_id: planProductoSelect.value,
      codigo: planCodigoInput.value.trim().toUpperCase(),
      tipo_tarifa: planTipoTarifaInput.value.trim() || 'EMISIÓN',
      status: planStatusInput.value,
      status_producto: planStatusProductoInput.value,
      suma_asegurada: Number(planSumaAseguradaInput.value),
      deducible: Number(planDeducibleInput.value) || 0,
      deducible_exterior: Number(planDeducibleExteriorInput.value) || 0,
      edad_minima_tarifa: Number(planEdadMinTarifaInput.value) || 0,
      edad_minima_titular: Number(planEdadMinTitularInput.value) || 0,
      edad_maxima_titular: Number(planEdadMaxTitularInput.value) || 99,
      edad_minima_familiares: Number(planEdadMinFamiliaresInput.value) || 0,
      edad_maxima_familiares: Number(planEdadMaxFamiliaresInput.value) || 99,
      financiable: planFinanciableInput.checked,
      coberturas: collectCoberturasPayload(),
      serv_adicionales_planes: servAdicionalesPlanes,
      descuentos: {
        pago_contado_aplica: planDescPagoContadoAplicaInput.checked,
        pago_contado_pct: Number(planDescPagoContadoPctInput.value) || 0,
        pago_divisas_aplica: planDescPagoDivisasAplicaInput.checked,
        pago_divisas_pct: Number(planDescPagoDivisasPctInput.value) || 0,
      },
      fraccionamiento: collectFraccionamientoPayload(),
      modo_tarifa_hijos: planModoTarifaHijosSelect.value,
    };

    try {
      let planId = planIdInput.value;
      let error;

      if (isEditModePlan) {
        ({ error } = await supabaseClient.from(TABLE_PLANES).update(payload).eq('id', planId));
      } else {
        const insertResult = await supabaseClient.from(TABLE_PLANES).insert([payload]).select().single();
        error = insertResult.error;
        if (!error) planId = insertResult.data.id;
      }

      if (error) {
        submitPlanBtn.disabled = false;
        submitPlanBtn.textContent = isEditModePlan ? 'Guardar Cambios' : 'Registrar';
        const prefix = error.code === '23505' ? 'Ya existe un plan con ese código.' : 'No se pudo guardar el plan.';
        showFeedback('planFormFeedback', `${prefix} ${getErrorMessage(error)}`, 'error');
        return;
      }

      // Reemplazamos las tarifas por edad y por hijos del plan
      await supabaseClient.from(TABLE_TARIFAS_EDAD).delete().eq('plan_id', planId);
      const tarifasEdadRows = collectTarifasEdadPayload(planId);
      if (tarifasEdadRows.length) {
        await supabaseClient.from(TABLE_TARIFAS_EDAD).insert(tarifasEdadRows);
      }

      await supabaseClient.from(TABLE_TARIFAS_HIJOS).delete().eq('plan_id', planId);
      if (payload.modo_tarifa_hijos === 'POR CANTIDAD DE HIJOS') {
        const tarifasHijosRows = collectTarifasHijosPayload(planId);
        if (tarifasHijosRows.length) {
          await supabaseClient.from(TABLE_TARIFAS_HIJOS).insert(tarifasHijosRows);
        }
      }

      submitPlanBtn.disabled = false;
      submitPlanBtn.textContent = isEditModePlan ? 'Guardar Cambios' : 'Registrar';
      showFeedback('planFormFeedback', isEditModePlan ? 'Plan actualizado correctamente.' : 'Plan registrado correctamente.', 'success');
      await loadPlanes();
      setTimeout(closePlanModal, 700);
    } catch (err) {
      submitPlanBtn.disabled = false;
      submitPlanBtn.textContent = isEditModePlan ? 'Guardar Cambios' : 'Registrar';
      showFeedback('planFormFeedback', `No se pudo conectar con Supabase: ${getErrorMessage(err)}`, 'error');
    }
  });

  async function handleDeletePlan(id) {
    const item = allPlanes.find((p) => p.id === id);
    if (!item) return;

    const confirmed = await openConfirmDialog({
      title: 'Eliminar plan',
      message: `¿Eliminar el plan "${item.codigo}"? Esto también eliminará sus tarifas y su relación con coberturas adicionales. Esta acción no se puede deshacer.`,
      acceptLabel: 'Eliminar',
    });
    if (!confirmed) return;

    try {
      const { error } = await supabaseClient.from(TABLE_PLANES).delete().eq('id', id);
      if (error) {
        showNotification('planesNotification', `No se pudo eliminar: ${getErrorMessage(error)}`, 'error');
        return;
      }
      await loadPlanes();
      showNotification('planesNotification', 'Plan eliminado correctamente.', 'success');
    } catch (err) {
      showNotification('planesNotification', `No se pudo eliminar: ${getErrorMessage(err)}`, 'error');
    }
  }

  /* =========================================================================
     ======================  COBERTURAS ADICIONALES (OPCIONALES)  =============
     ========================================================================= */

  const searchOpcionales = document.getElementById('searchOpcionales');
  const clearSearchOpcionales = document.getElementById('clearSearchOpcionales');
  const opcionalesTableBody = document.getElementById('opcionalesTableBody');
  const opcionalesLoading = document.getElementById('opcionalesLoading');
  const opcionalesEmpty = document.getElementById('opcionalesEmpty');
  const openOpcionalModalBtn = document.getElementById('openOpcionalModalBtn');

  const opcionalModalOverlay = document.getElementById('opcionalModalOverlay');
  const opcionalModalTitle = document.getElementById('opcionalModalTitle');
  const opcionalModalCloseBtn = document.getElementById('opcionalModalCloseBtn');
  const cancelOpcionalModalBtn = document.getElementById('cancelOpcionalModalBtn');
  const opcionalForm = document.getElementById('opcionalForm');
  const opcionalIdInput = document.getElementById('opcionalId');
  const opcionalAseguradoraSelect = document.getElementById('opcionalAseguradora');
  const opcionalProductoSelect = document.getElementById('opcionalProducto');
  const opcionalCodigoInput = document.getElementById('opcionalCodigo');
  const opcionalTipoCoberturaInput = document.getElementById('opcionalTipoCobertura');
  const opcionalCoberturaInput = document.getElementById('opcionalCobertura');
  const opcionalNombreServicioInput = document.getElementById('opcionalNombreServicio');
  const opcionalSumaInput = document.getElementById('opcionalSuma');
  const opcionalPrimaInput = document.getElementById('opcionalPrima');
  const opcionalPrima2Input = document.getElementById('opcionalPrima2');
  const opcionalPrima3Input = document.getElementById('opcionalPrima3');
  const opcionalStatusInput = document.getElementById('opcionalStatus');
  const opcionalPlanesChecklist = document.getElementById('opcionalPlanesChecklist');
  const submitOpcionalBtn = document.getElementById('submitOpcionalBtn');
  const editOpcionalModalBtn = document.getElementById('editOpcionalModalBtn');

  const fieldOpcionalAseguradora = document.getElementById('fieldOpcionalAseguradora');
  const fieldOpcionalProducto = document.getElementById('fieldOpcionalProducto');
  const fieldOpcionalCodigo = document.getElementById('fieldOpcionalCodigo');

  let currentSortOpcionales = { key: 'cobertura', direction: 'asc' };
  const sortableHeadersOpcionales = document.querySelectorAll('#opcionalesTable th.is-sortable');

  function renderOpcionalPlanesChecklist(productoId, selectedPlanIds = []) {
    const planesDelProducto = allPlanes.filter((p) => p.producto_id === productoId);
    if (!planesDelProducto.length) {
      opcionalPlanesChecklist.innerHTML = '<p style="color: var(--color-gray); font-size: 0.85rem;">Este producto no tiene planes registrados todavía.</p>';
      return;
    }
    opcionalPlanesChecklist.innerHTML = planesDelProducto.map((p) => `
      <label>
        <input type="checkbox" class="opcional-plan-checkbox" value="${p.id}" ${selectedPlanIds.includes(p.id) ? 'checked' : ''}>
        ${escapeHtml(p.codigo)}
      </label>
    `).join('');
  }

  opcionalAseguradoraSelect.addEventListener('change', () => {
    populateProductoSelect(opcionalProductoSelect, opcionalAseguradoraSelect.value);
    opcionalPlanesChecklist.innerHTML = '<p style="color: var(--color-gray); font-size: 0.85rem;">Selecciona primero un producto.</p>';
  });

  opcionalProductoSelect.addEventListener('change', () => {
    renderOpcionalPlanesChecklist(opcionalProductoSelect.value);
  });

  function opcionalFields() {
    return [opcionalAseguradoraSelect, opcionalProductoSelect, opcionalCodigoInput, opcionalTipoCoberturaInput,
      opcionalCoberturaInput, opcionalNombreServicioInput, opcionalSumaInput, opcionalPrimaInput,
      opcionalPrima2Input, opcionalPrima3Input, opcionalStatusInput];
  }

  async function openOpcionalModal({ edit = false, item = null, viewOnly = false } = {}) {
    isEditModeOpcional = edit;
    opcionalForm.reset();
    clearFeedback('opcionalFormFeedback');
    [fieldOpcionalAseguradora, fieldOpcionalProducto, fieldOpcionalCodigo].forEach((f) => setFieldError(f, false));

    let selectedPlanIds = [];

    if (item) {
      opcionalModalTitle.textContent = viewOnly ? 'Ver Cobertura Adicional' : 'Editar Cobertura Adicional';
      submitOpcionalBtn.textContent = 'Guardar Cambios';
      opcionalIdInput.value = item.id;
      opcionalAseguradoraSelect.value = item.aseguradora_id;
      populateProductoSelect(opcionalProductoSelect, item.aseguradora_id, item.producto_id);
      opcionalCodigoInput.value = item.codigo || '';
      opcionalTipoCoberturaInput.value = item.tipo_cobertura || 'INDIVIDUAL';
      opcionalCoberturaInput.value = item.cobertura || 'FUNERARIOS';
      opcionalNombreServicioInput.value = item.nombre_servicio || '';
      opcionalSumaInput.value = item.suma_asegurada ?? '';
      opcionalPrimaInput.value = item.prima ?? '';
      opcionalPrima2Input.value = item.prima2 ?? '';
      opcionalPrima3Input.value = item.prima3 ?? '';
      opcionalStatusInput.value = item.status || 'ACTIVO';

      try {
        const { data } = await supabaseClient
          .from(TABLE_OPCIONALES_PLANES).select('plan_id').eq('opcional_id', item.id);
        selectedPlanIds = (data || []).map((r) => r.plan_id);
      } catch (err) {
        console.error('No se pudieron cargar los planes asociados:', err);
      }
      renderOpcionalPlanesChecklist(item.producto_id, selectedPlanIds);
    } else {
      opcionalModalTitle.textContent = 'Registrar Cobertura Adicional';
      submitOpcionalBtn.textContent = 'Registrar';
      opcionalIdInput.value = '';
      opcionalStatusInput.value = 'ACTIVO';
      opcionalTipoCoberturaInput.value = 'INDIVIDUAL';
      populateProductoSelect(opcionalProductoSelect, '');
      opcionalPlanesChecklist.innerHTML = '<p style="color: var(--color-gray); font-size: 0.85rem;">Selecciona primero un producto.</p>';
      opcionalCodigoInput.value = `COB-${Math.random().toString(16).slice(2, 10).toUpperCase()}`;
    }

    const isViewMode = viewOnly && !!item;
    opcionalFields().forEach((f) => { f.disabled = isViewMode; });
    opcionalPlanesChecklist.querySelectorAll('input').forEach((f) => { f.disabled = isViewMode; });
    if (isViewMode) opcionalProductoSelect.disabled = true;

    if (isViewMode) {
      submitOpcionalBtn.style.display = 'none';
      editOpcionalModalBtn.style.display = 'inline-flex';
    } else {
      submitOpcionalBtn.style.display = 'inline-flex';
      editOpcionalModalBtn.style.display = 'none';
    }

    opcionalModalOverlay.classList.add('is-open');
  }

  function closeOpcionalModal() {
    opcionalModalOverlay.classList.remove('is-open');
    opcionalForm.reset();
    opcionalFields().forEach((f) => { f.disabled = false; });
    submitOpcionalBtn.style.display = 'inline-flex';
    editOpcionalModalBtn.style.display = 'none';
  }

  openOpcionalModalBtn.addEventListener('click', () => openOpcionalModal({ edit: false }));
  editOpcionalModalBtn.addEventListener('click', () => {
    isEditModeOpcional = true;
    opcionalFields().forEach((f) => { f.disabled = false; });
    opcionalPlanesChecklist.querySelectorAll('input').forEach((f) => { f.disabled = false; });
    submitOpcionalBtn.style.display = 'inline-flex';
    editOpcionalModalBtn.style.display = 'none';
    submitOpcionalBtn.textContent = 'Guardar Cambios';
  });
  opcionalModalCloseBtn.addEventListener('click', closeOpcionalModal);
  cancelOpcionalModalBtn.addEventListener('click', closeOpcionalModal);
  opcionalModalOverlay.addEventListener('click', (e) => { if (e.target === opcionalModalOverlay) closeOpcionalModal(); });

  function validateOpcionalForm() {
    let valid = true;

    const aseguradoraOk = opcionalAseguradoraSelect.value.trim().length > 0;
    setFieldError(fieldOpcionalAseguradora, !aseguradoraOk);
    if (!aseguradoraOk) valid = false;

    const productoOk = opcionalProductoSelect.value.trim().length > 0;
    setFieldError(fieldOpcionalProducto, !productoOk);
    if (!productoOk) valid = false;

    const codigoOk = /^[A-Za-z0-9\-]{3,}$/.test(opcionalCodigoInput.value.trim());
    setFieldError(fieldOpcionalCodigo, !codigoOk);
    if (!codigoOk) valid = false;

    if (opcionalPrimaInput.value === '' || Number(opcionalPrimaInput.value) < 0) valid = false;

    return valid;
  }

  function renderOpcionales(items) {
    opcionalesTableBody.innerHTML = '';
    if (!items.length) {
      opcionalesEmpty.style.display = 'block';
      return;
    }
    opcionalesEmpty.style.display = 'none';

    items.forEach((item) => {
      const tr = document.createElement('tr');
      const statusClass = item.status === 'ACTIVO' ? 'status-pill--activo' : 'status-pill--inactivo';
      const aseguradoraNombre = item.aseguradoras?.nombre || '—';
      const productoNombre = item.productos?.nombre || '—';
      const planesCount = item._planesCount ?? 0;

      tr.innerHTML = `
        <td data-label="Cobertura">${escapeHtml(item.cobertura)}${item.nombre_servicio ? ` — ${escapeHtml(item.nombre_servicio)}` : ''}</td>
        <td data-label="Aseguradora / Producto">${escapeHtml(aseguradoraNombre)} / ${escapeHtml(productoNombre)}</td>
        <td data-label="Suma Asegurada">${formatMoney(item.suma_asegurada)}</td>
        <td data-label="Prima">${formatMoney(item.prima)}</td>
        <td data-label="Planes Asociados">${planesCount}</td>
        <td data-label="Estado"><span class="status-pill ${statusClass}">${escapeHtml(item.status)}</span></td>
        <td data-label="Acciones" class="col-actions">
          <button type="button" class="action-btn action-btn--view" data-id="${item.id}" aria-label="Ver cobertura">👁</button>
          <button type="button" class="action-btn action-btn--delete" data-id="${item.id}" aria-label="Eliminar cobertura">🗑️</button>
        </td>
      `;
      opcionalesTableBody.appendChild(tr);

      tr.querySelector('.action-btn--view').addEventListener('click', () => {
        openOpcionalModal({ edit: false, item, viewOnly: true });
      });
      tr.querySelector('.action-btn--delete').addEventListener('click', () => handleDeleteOpcional(item.id));
    });
  }

  sortableHeadersOpcionales.forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sortKey;
      if (currentSortOpcionales.key === key) {
        currentSortOpcionales.direction = currentSortOpcionales.direction === 'asc' ? 'desc' : 'asc';
      } else {
        currentSortOpcionales = { key, direction: 'asc' };
      }
      updateSortIndicators(sortableHeadersOpcionales, currentSortOpcionales);
      applyFilterOpcionales();
    });
  });

  function applyFilterOpcionales() {
    const term = searchOpcionales.value.trim().toLowerCase();
    clearSearchOpcionales.classList.toggle('is-visible', term.length > 0);
    let result = allOpcionales;
    if (term) {
      result = result.filter((o) =>
        o.codigo.toLowerCase().includes(term) || o.cobertura.toLowerCase().includes(term));
    }
    result = sortItems(result, currentSortOpcionales.key, currentSortOpcionales.direction);
    renderOpcionales(result);
  }

  searchOpcionales.addEventListener('input', applyFilterOpcionales);
  clearSearchOpcionales.addEventListener('click', () => {
    searchOpcionales.value = '';
    applyFilterOpcionales();
    searchOpcionales.focus();
  });

  async function loadOpcionales() {
    opcionalesLoading.style.display = 'block';
    opcionalesEmpty.style.display = 'none';
    opcionalesTableBody.innerHTML = '';

    if (!supabaseClient) {
      opcionalesLoading.style.display = 'none';
      opcionalesEmpty.textContent = 'Supabase no está inicializado.';
      opcionalesEmpty.style.display = 'block';
      return;
    }

    try {
      const { data, error } = await supabaseClient
        .from(TABLE_OPCIONALES)
        .select('*, aseguradoras(nombre), productos(nombre)')
        .order('cobertura', { ascending: true });

      if (error) {
        opcionalesLoading.style.display = 'none';
        opcionalesEmpty.textContent = `Error al cargar coberturas: ${getErrorMessage(error)}`;
        opcionalesEmpty.style.display = 'block';
        return;
      }

      // Contamos los planes asociados a cada opcional (para la columna "Planes Asociados")
      const { data: junctionRows } = await supabaseClient.from(TABLE_OPCIONALES_PLANES).select('opcional_id');
      const counts = {};
      (junctionRows || []).forEach((r) => { counts[r.opcional_id] = (counts[r.opcional_id] || 0) + 1; });

      allOpcionales = (data || []).map((o) => ({ ...o, _planesCount: counts[o.id] || 0 }));
      opcionalesLoading.style.display = 'none';
      applyFilterOpcionales();
    } catch (err) {
      opcionalesLoading.style.display = 'none';
      opcionalesEmpty.textContent = `No se pudo conectar con Supabase: ${getErrorMessage(err)}`;
      opcionalesEmpty.style.display = 'block';
    }
  }

  opcionalForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFeedback('opcionalFormFeedback');

    if (!validateOpcionalForm()) {
      showFeedback('opcionalFormFeedback', 'Revisa los campos marcados antes de continuar.', 'error');
      return;
    }
    if (!supabaseClient) {
      showFeedback('opcionalFormFeedback', 'No se pudo conectar con Supabase.', 'error');
      return;
    }

    submitOpcionalBtn.disabled = true;
    submitOpcionalBtn.textContent = isEditModeOpcional ? 'Guardando...' : 'Registrando...';

    const payload = {
      aseguradora_id: opcionalAseguradoraSelect.value,
      producto_id: opcionalProductoSelect.value,
      codigo: opcionalCodigoInput.value.trim().toUpperCase(),
      tipo_cobertura: opcionalTipoCoberturaInput.value,
      cobertura: opcionalCoberturaInput.value,
      nombre_servicio: opcionalNombreServicioInput.value.trim() || null,
      suma_asegurada: opcionalSumaInput.value === '' ? null : Number(opcionalSumaInput.value),
      prima: Number(opcionalPrimaInput.value),
      prima2: opcionalPrima2Input.value === '' ? null : Number(opcionalPrima2Input.value),
      prima3: opcionalPrima3Input.value === '' ? null : Number(opcionalPrima3Input.value),
      status: opcionalStatusInput.value,
    };

    const selectedPlanIds = Array.from(opcionalPlanesChecklist.querySelectorAll('.opcional-plan-checkbox:checked'))
      .map((cb) => cb.value);

    try {
      let opcionalId = opcionalIdInput.value;
      let error;

      if (isEditModeOpcional) {
        ({ error } = await supabaseClient.from(TABLE_OPCIONALES).update(payload).eq('id', opcionalId));
      } else {
        const insertResult = await supabaseClient.from(TABLE_OPCIONALES).insert([payload]).select().single();
        error = insertResult.error;
        if (!error) opcionalId = insertResult.data.id;
      }

      if (error) {
        submitOpcionalBtn.disabled = false;
        submitOpcionalBtn.textContent = isEditModeOpcional ? 'Guardar Cambios' : 'Registrar';
        const prefix = error.code === '23505' ? 'Ya existe una cobertura con ese código.' : 'No se pudo guardar la cobertura.';
        showFeedback('opcionalFormFeedback', `${prefix} ${getErrorMessage(error)}`, 'error');
        return;
      }

      // Reemplazamos la relación con los planes asociados
      await supabaseClient.from(TABLE_OPCIONALES_PLANES).delete().eq('opcional_id', opcionalId);
      if (selectedPlanIds.length) {
        const junctionRows = selectedPlanIds.map((planId) => ({ opcional_id: opcionalId, plan_id: planId }));
        await supabaseClient.from(TABLE_OPCIONALES_PLANES).insert(junctionRows);
      }

      submitOpcionalBtn.disabled = false;
      submitOpcionalBtn.textContent = isEditModeOpcional ? 'Guardar Cambios' : 'Registrar';
      showFeedback('opcionalFormFeedback', isEditModeOpcional ? 'Cobertura actualizada correctamente.' : 'Cobertura registrada correctamente.', 'success');
      await loadOpcionales();
      setTimeout(closeOpcionalModal, 700);
    } catch (err) {
      submitOpcionalBtn.disabled = false;
      submitOpcionalBtn.textContent = isEditModeOpcional ? 'Guardar Cambios' : 'Registrar';
      showFeedback('opcionalFormFeedback', `No se pudo conectar con Supabase: ${getErrorMessage(err)}`, 'error');
    }
  });

  async function handleDeleteOpcional(id) {
    const item = allOpcionales.find((o) => o.id === id);
    if (!item) return;

    const confirmed = await openConfirmDialog({
      title: 'Eliminar cobertura adicional',
      message: `¿Eliminar "${item.cobertura}"? Se eliminará también su relación con los planes asociados. Esta acción no se puede deshacer.`,
      acceptLabel: 'Eliminar',
    });
    if (!confirmed) return;

    try {
      const { error } = await supabaseClient.from(TABLE_OPCIONALES).delete().eq('id', id);
      if (error) {
        showNotification('opcionalesNotification', `No se pudo eliminar: ${getErrorMessage(error)}`, 'error');
        return;
      }
      await loadOpcionales();
      showNotification('opcionalesNotification', 'Cobertura eliminada correctamente.', 'success');
    } catch (err) {
      showNotification('opcionalesNotification', `No se pudo eliminar: ${getErrorMessage(err)}`, 'error');
    }
  }

  /* =========================================================
     CARGA DE ASEGURADORAS Y PRODUCTOS (compartida por ambas pestañas)
     ========================================================= */
  async function loadAseguradorasYProductos() {
    if (!supabaseClient) return;
    try {
      const { data: aseguradoras } = await supabaseClient.from(TABLE_ASEGURADORAS).select('*').order('nombre');
      allAseguradoras = aseguradoras || [];

      const { data: productos } = await supabaseClient.from(TABLE_PRODUCTOS).select('*').order('nombre');
      allProductos = productos || [];

      populateAseguradoraSelects();
    } catch (err) {
      console.error('No se pudieron cargar aseguradoras/productos:', err);
    }
  }

  /* =========================================================
     TECLA ESCAPE
     ========================================================= */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (confirmOverlay.style.display === 'flex') { closeConfirmDialog(); return; }
    if (planModalOverlay.classList.contains('is-open')) closePlanModal();
    if (opcionalModalOverlay.classList.contains('is-open')) closeOpcionalModal();
  });

  /* =========================================================
     INICIO
     ========================================================= */
  updateSortIndicators(sortableHeadersPlanes, currentSortPlanes);
  updateSortIndicators(sortableHeadersOpcionales, currentSortOpcionales);
  await initSupabase();
  await loadAseguradorasYProductos();
  await loadPlanes();
  await loadOpcionales();
});
