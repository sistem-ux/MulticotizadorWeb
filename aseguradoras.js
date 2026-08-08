/* =============================================================
   CONFIGURACIÓN DE SUPABASE
   (Misma configuración que usuarios.js — Project Settings > API)
   ============================================================= */
const SUPABASE_URL = 'https://cibtpkpxdrykozujaqba.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_zlp4_HGpTeAQKW55c_pZQA_2HEXRpaC';
const TABLE_ASEGURADORAS = 'aseguradoras';
const TABLE_PRODUCTOS = 'productos';
const TABLE_PLANES = 'planes';
const TABLE_TARIFAS = 'tarifas';
const LOGO_BUCKET = 'logos-aseguradoras';
const LOGO_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

/* =============================================================
   CATÁLOGOS FIJOS: COBERTURAS Y RANGOS ETARIOS (pestaña Tarifas)
   Provienen literalmente de los comentarios de Registro_de_Planes.xlsx
   (hoja "Tarifas", sección "Tarifas por rango etario").
   ============================================================= */
const COVERAGE_LIST = [
  { key: 'funerarios', label: 'Funerarios' },
  { key: 'asistencia_viajes', label: 'Asistencia en viajes' },
  { key: 'invalidez_permanente', label: 'Invalidez permanente' },
  { key: 'muerte_accidental', label: 'Muerte accidental' },
  { key: 'odontologia', label: 'Odontología' },
  { key: 'oftalmologia', label: 'Oftalmología' },
  { key: 'dermatologia', label: 'Dermatología' },
  { key: 'psicologia', label: 'Psicología' },
  { key: 'servicios_adicionales', label: 'Servicios Adicionales' },
];

const AGE_RANGES = [
  { key: '00-09', min: 0, max: 9 }, { key: '10-15', min: 10, max: 15 }, { key: '16-17', min: 16, max: 17 },
  { key: '18-18', min: 18, max: 18 }, { key: '19-19', min: 19, max: 19 }, { key: '20-24', min: 20, max: 24 },
  { key: '25-29', min: 25, max: 29 }, { key: '30-30', min: 30, max: 30 }, { key: '31-34', min: 31, max: 34 },
  { key: '35-35', min: 35, max: 35 }, { key: '36-39', min: 36, max: 39 }, { key: '40-40', min: 40, max: 40 },
  { key: '41-44', min: 41, max: 44 }, { key: '45-45', min: 45, max: 45 }, { key: '46-49', min: 46, max: 49 },
  { key: '50-50', min: 50, max: 50 }, { key: '51-54', min: 51, max: 54 }, { key: '55-55', min: 55, max: 55 },
  { key: '56-59', min: 56, max: 59 }, { key: '60-60', min: 60, max: 60 }, { key: '61-64', min: 61, max: 64 },
  { key: '65-65', min: 65, max: 65 }, { key: '66-69', min: 66, max: 69 }, { key: '70-70', min: 70, max: 70 },
  { key: '71-74', min: 71, max: 74 }, { key: '75-75', min: 75, max: 75 }, { key: '76-79', min: 76, max: 79 },
  { key: '80-80', min: 80, max: 80 }, { key: '81-84', min: 81, max: 84 }, { key: '85-85', min: 85, max: 85 },
  { key: '86-89', min: 86, max: 89 }, { key: '90-90', min: 90, max: 90 }, { key: '91-94', min: 91, max: 94 },
  { key: '95-95', min: 95, max: 95 }, { key: '96-99', min: 96, max: 99 },
];

function rangesForAges(edadMin, edadMax) {
  if (edadMin == null || edadMax == null || Number.isNaN(edadMin) || Number.isNaN(edadMax)) return [];
  return AGE_RANGES.filter((r) => r.max >= edadMin && r.min <= edadMax);
}

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

/*
  Tablas esperadas en Supabase (ver 01_schema_aseguradoras_productos.sql):
    - aseguradoras (nombre, logo_url, fecha_creacion, usuario_creacion,
      fecha_modificacion, usuario_modificacion)
    - productos (aseguradora_id -> aseguradoras.id, nombre, fecha_creacion,
      usuario_creacion, fecha_modificacion, usuario_modificacion)
    - Storage bucket público "logos-aseguradoras" para los logos PNG.

  NOTA DE SEGURIDAD: al igual que en usuarios.js, esta pantalla consulta con
  la clave anónima. El control de acceso real lo hace auth-guard.js en el
  cliente (solo perfil Administrador entra a esta página). Para producción
  se recomienda migrar a Supabase Auth y restringir RLS por auth.uid().
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

/* =============================================================
   FORMATEADOR DE TEXTO EN TIEMPO REAL: "Inicial De Cada Palabra"
   Mismo patrón usado en el formulario de grupo familiar (Fase 1):
   soporta entrada en mayúsculas sostenidas y conserva la posición
   del cursor mientras el usuario escribe.
   ============================================================= */
function toTitleCaseLive(value) {
  return value.replace(/\S+/g, (word) => {
    const first = word.charAt(0).toLocaleUpperCase('es');
    const rest = word.slice(1).toLocaleLowerCase('es');
    return first + rest;
  });
}

function attachTitleCaseFormatter(inputEl) {
  inputEl.addEventListener('input', () => {
    const start = inputEl.selectionStart;
    const end = inputEl.selectionEnd;
    const original = inputEl.value;
    const formatted = toTitleCaseLive(original);
    if (formatted !== original) {
      inputEl.value = formatted;
      // La longitud no cambia (solo mayúsculas/minúsculas), así que la
      // posición del cursor sigue siendo válida tal cual.
      inputEl.setSelectionRange(start, end);
    }
  });
}

/* =============================================================
   FORMATEADOR DE MONTOS ENTEROS CON SEPARADOR DE MILES (Planes/Tarifas)
   Usado en: Suma Asegurada, Deducibles, Gastos por fraccionamiento,
   Sumas aseguradas de coberturas y maternidad ("sin decimales con
   separador de miles"). Conserva la posición del cursor contando
   dígitos, igual que el formateador de nombres de la Fase 1.
   ============================================================= */
function digitsOnly(str) {
  return (str || '').toString().replace(/\D/g, '');
}

function formatThousands(digitsStr) {
  const digits = digitsOnly(digitsStr);
  if (!digits) return '';
  return Number(digits).toLocaleString('es-VE');
}

function attachThousandsFormatter(inputEl) {
  inputEl.addEventListener('input', () => {
    const start = inputEl.selectionStart ?? inputEl.value.length;
    const digitsBeforeCursor = digitsOnly(inputEl.value.slice(0, start)).length;
    const formatted = formatThousands(inputEl.value);
    inputEl.value = formatted;

    let count = 0;
    let pos = formatted.length;
    for (let i = 0; i < formatted.length; i++) {
      if (/\d/.test(formatted[i])) count++;
      if (count === digitsBeforeCursor) { pos = i + 1; break; }
    }
    if (digitsBeforeCursor === 0) pos = 0;
    inputEl.setSelectionRange(pos, pos);
  });
}

function getThousandsValue(inputEl) {
  const digits = digitsOnly(inputEl.value);
  return digits ? Number(digits) : null;
}

function setThousandsValue(inputEl, value) {
  inputEl.value = (value === null || value === undefined || value === '') ? '' : formatThousands(String(value));
}

/* =============================================================
   HABILITAR / DESHABILITAR CAMPOS SEGÚN UN CHECKBOX
   Patrón repetido en Planes (Gastos por fraccionamiento, Descuento
   en Divisas, Descuento de Contado): casilla destildada -> campo(s)
   deshabilitado(s) y vacío(s); casilla tildada -> campo(s) habilitado(s).
   ============================================================= */
function attachCheckToggle(checkboxEl, fieldEls) {
  function apply() {
    const enabled = checkboxEl.checked;
    fieldEls.forEach((f) => {
      f.disabled = !enabled;
      if (!enabled) f.value = '';
    });
  }
  checkboxEl.addEventListener('change', apply);
  apply();
  return apply;
}

document.addEventListener('DOMContentLoaded', async () => {

  /* =========================================================
     ESTADO GENERAL Y NOTIFICACIONES
     ========================================================= */
  let allAseguradoras = [];
  let allProductos = [];
  let allPlanes = [];
  let allTarifas = [];
  let isEditModeAseguradora = false;
  let isEditModeProducto = false;
  let isEditModePlan = false;
  let isReadOnlyPlan = false;
  let isEditModeTarifa = false;
  let isReadOnlyTarifa = false;
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

  // Fuerza deshabilitado de todos los controles de un formulario para el
  // modo "Ver" (solo lectura). Usado por Planes y Tarifas.
  function setFormControlsForcedDisabled(formEl, disabled) {
    formEl.querySelectorAll('input, select, textarea, button').forEach((el) => {
      if (el.type === 'button' && (el.classList.contains('btn--cancel') || el.id === 'editTarifaBtn')) return;
      el.disabled = disabled;
    });
  }

  /* =========================================================
     USUARIO ACTUAL (auditoría) — viene de auth-guard.js
     ========================================================= */
  function getCurrentUserLabel() {
    if (typeof getSession !== 'function') return null;
    const session = getSession();
    return session.fullName || session.email || null;
  }

  /* =========================================================
     PESTAÑAS
     ========================================================= */
  const tabButtons = document.querySelectorAll('.tab-btn');
  const panels = {
    aseguradoras: document.getElementById('panelAseguradoras'),
    productos: document.getElementById('panelProductos'),
    planes: document.getElementById('panelPlanes'),
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
     ============================  LOGO STORAGE  ===============================
     ========================================================================= */

  function extractLogoPath(url) {
    if (!url) return null;
    const marker = `/object/public/${LOGO_BUCKET}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    return url.substring(idx + marker.length);
  }

  async function uploadLogo(file) {
    const uniqueName = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const path = `aseguradoras/${uniqueName}.png`;
    const { error: uploadError } = await supabaseClient
      .storage
      .from(LOGO_BUCKET)
      .upload(path, file, { contentType: 'image/png', upsert: false });
    if (uploadError) throw uploadError;
    const { data } = supabaseClient.storage.from(LOGO_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }

  async function deleteLogoIfExists(url) {
    const path = extractLogoPath(url);
    if (!path) return;
    try {
      await supabaseClient.storage.from(LOGO_BUCKET).remove([path]);
    } catch (err) {
      console.warn('No se pudo eliminar el logo anterior del storage:', err);
    }
  }

  /* =========================================================================
     ==========================  ASEGURADORAS  ================================
     ========================================================================= */

  const searchAseguradoras = document.getElementById('searchAseguradoras');
  const clearSearchAseguradoras = document.getElementById('clearSearchAseguradoras');
  const aseguradorasTableBody = document.getElementById('aseguradorasTableBody');
  const aseguradorasLoading = document.getElementById('aseguradorasLoading');
  const aseguradorasEmpty = document.getElementById('aseguradorasEmpty');
  const openAseguradoraModalBtn = document.getElementById('openAseguradoraModalBtn');

  const aseguradoraModalOverlay = document.getElementById('aseguradoraModalOverlay');
  const aseguradoraModalTitle = document.getElementById('aseguradoraModalTitle');
  const aseguradoraModalCloseBtn = document.getElementById('aseguradoraModalCloseBtn');
  const cancelAseguradoraModalBtn = document.getElementById('cancelAseguradoraModalBtn');
  const aseguradoraForm = document.getElementById('aseguradoraForm');
  const aseguradoraIdInput = document.getElementById('aseguradoraId');
  const aseguradoraLogoUrlActualInput = document.getElementById('aseguradoraLogoUrlActual');
  const aseguradoraNombreInput = document.getElementById('aseguradoraNombre');
  const submitAseguradoraBtn = document.getElementById('submitAseguradoraBtn');

  const fieldAseguradoraNombre = document.getElementById('fieldAseguradoraNombre');
  const fieldAseguradoraLogo = document.getElementById('fieldAseguradoraLogo');

  const aseguradoraLogoFileInput = document.getElementById('aseguradoraLogoFile');
  const aseguradoraLogoSelectBtn = document.getElementById('aseguradoraLogoSelectBtn');
  const aseguradoraLogoRemoveBtn = document.getElementById('aseguradoraLogoRemoveBtn');
  const aseguradoraLogoPreview = document.getElementById('aseguradoraLogoPreview');
  const aseguradoraLogoPlaceholder = document.getElementById('aseguradoraLogoPlaceholder');

  attachTitleCaseFormatter(aseguradoraNombreInput);

  let currentSortAseguradoras = { key: 'nombre', direction: 'asc' };
  const sortableHeadersAseguradoras = document.querySelectorAll('#aseguradorasTable th.is-sortable');

  // Estado del logo dentro del modal (independiente de lo ya guardado en DB)
  let aseguradoraSelectedLogoFile = null; // File nuevo seleccionado, o null
  let aseguradoraLogoWasRemoved = false;  // true si el usuario pidió quitar el logo existente

  function setLogoPreview(url) {
    if (url) {
      aseguradoraLogoPreview.src = url;
      aseguradoraLogoPreview.style.display = 'block';
      aseguradoraLogoPlaceholder.style.display = 'none';
      aseguradoraLogoRemoveBtn.style.display = 'inline-flex';
    } else {
      aseguradoraLogoPreview.removeAttribute('src');
      aseguradoraLogoPreview.style.display = 'none';
      aseguradoraLogoPlaceholder.style.display = 'block';
      aseguradoraLogoRemoveBtn.style.display = 'none';
    }
  }

  function resetLogoUploadState() {
    aseguradoraSelectedLogoFile = null;
    aseguradoraLogoWasRemoved = false;
    aseguradoraLogoFileInput.value = '';
    setFieldError(fieldAseguradoraLogo, false);
  }

  aseguradoraLogoSelectBtn.addEventListener('click', () => aseguradoraLogoFileInput.click());

  aseguradoraLogoFileInput.addEventListener('change', () => {
    const file = aseguradoraLogoFileInput.files[0];
    if (!file) return;

    const isPng = file.type === 'image/png';
    const isValidSize = file.size <= LOGO_MAX_BYTES;

    if (!isPng || !isValidSize) {
      setFieldError(fieldAseguradoraLogo, true);
      aseguradoraLogoFileInput.value = '';
      return;
    }

    setFieldError(fieldAseguradoraLogo, false);
    aseguradoraSelectedLogoFile = file;
    aseguradoraLogoWasRemoved = false;
    setLogoPreview(URL.createObjectURL(file));
  });

  aseguradoraLogoRemoveBtn.addEventListener('click', () => {
    aseguradoraSelectedLogoFile = null;
    aseguradoraLogoWasRemoved = true;
    aseguradoraLogoFileInput.value = '';
    setLogoPreview(null);
  });

  function aseguradoraFields() {
    return [aseguradoraNombreInput];
  }

  function openAseguradoraModal({ edit = false, item = null } = {}) {
    isEditModeAseguradora = edit;
    aseguradoraForm.reset();
    clearFeedback('aseguradoraFormFeedback');
    setFieldError(fieldAseguradoraNombre, false);
    resetLogoUploadState();

    if (item) {
      aseguradoraModalTitle.textContent = 'Editar Aseguradora';
      submitAseguradoraBtn.textContent = 'Guardar Cambios';
      aseguradoraIdInput.value = item.id;
      aseguradoraLogoUrlActualInput.value = item.logo_url || '';
      aseguradoraNombreInput.value = item.nombre || '';
      setLogoPreview(item.logo_url || null);
    } else {
      aseguradoraModalTitle.textContent = 'Registrar Aseguradora';
      submitAseguradoraBtn.textContent = 'Registrar';
      aseguradoraIdInput.value = '';
      aseguradoraLogoUrlActualInput.value = '';
      setLogoPreview(null);
    }

    aseguradoraModalOverlay.classList.add('is-open');
    aseguradoraNombreInput.focus();
  }

  function closeAseguradoraModal() {
    aseguradoraModalOverlay.classList.remove('is-open');
    aseguradoraForm.reset();
    resetLogoUploadState();
    setLogoPreview(null);
  }

  openAseguradoraModalBtn.addEventListener('click', () => openAseguradoraModal({ edit: false }));
  aseguradoraModalCloseBtn.addEventListener('click', closeAseguradoraModal);
  cancelAseguradoraModalBtn.addEventListener('click', closeAseguradoraModal);
  aseguradoraModalOverlay.addEventListener('click', (e) => {
    if (e.target === aseguradoraModalOverlay) closeAseguradoraModal();
  });

  function validateAseguradoraForm() {
    let valid = true;

    const nombreOk = aseguradoraNombreInput.value.trim().length >= 3;
    setFieldError(fieldAseguradoraNombre, !nombreOk);
    if (!nombreOk) valid = false;

    return valid;
  }

  function renderAseguradoras(items) {
    aseguradorasTableBody.innerHTML = '';
    if (!items.length) {
      aseguradorasEmpty.style.display = 'block';
      return;
    }
    aseguradorasEmpty.style.display = 'none';

    items.forEach((item) => {
      const tr = document.createElement('tr');
      const isActivo = item.status === 'Activo';
      const statusClass = isActivo ? 'status-pill--activo' : 'status-pill--inactivo';
      const toggleIcon = isActivo ? '✕' : '✓';
      const toggleClass = isActivo ? 'action-btn--toggle-on' : 'action-btn--toggle-off';
      const toggleLabel = isActivo ? 'Inactivar aseguradora' : 'Activar aseguradora';

      tr.innerHTML = `
        <td data-label="Aseguradora">
          ${item.logo_url
            ? `<img src="${escapeHtml(item.logo_url)}" class="logo-thumb" alt="" onerror="this.style.display='none'">`
            : `<span class="logo-placeholder-cell" aria-hidden="true">—</span>`}
          ${escapeHtml(item.nombre)}
        </td>
        <td data-label="Status Aseguradora"><span class="status-pill ${statusClass}">${escapeHtml(item.status)}</span></td>
        <td data-label="Acciones" class="col-actions">
          <button type="button" class="action-btn action-btn--edit" data-id="${item.id}" aria-label="Editar aseguradora">✏️</button>
          <button type="button" class="action-btn ${toggleClass}" data-id="${item.id}" aria-label="${toggleLabel}">${toggleIcon}</button>
          <button type="button" class="action-btn action-btn--delete" data-id="${item.id}" aria-label="Eliminar aseguradora">🗑️</button>
        </td>
      `;
      aseguradorasTableBody.appendChild(tr);

      tr.querySelector('.action-btn--edit').addEventListener('click', () => {
        openAseguradoraModal({ edit: true, item });
      });
      tr.querySelector(`.${toggleClass}`).addEventListener('click', () => handleToggleStatusAseguradora(item));
      tr.querySelector('.action-btn--delete').addEventListener('click', () => handleDeleteAseguradora(item.id));
    });
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

  sortableHeadersAseguradoras.forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sortKey;
      if (currentSortAseguradoras.key === key) {
        currentSortAseguradoras.direction = currentSortAseguradoras.direction === 'asc' ? 'desc' : 'asc';
      } else {
        currentSortAseguradoras = { key, direction: 'asc' };
      }
      updateSortIndicators(sortableHeadersAseguradoras, currentSortAseguradoras);
      applyFilterAseguradoras();
    });
  });

  function applyFilterAseguradoras() {
    const term = searchAseguradoras.value.trim().toLowerCase();
    clearSearchAseguradoras.classList.toggle('is-visible', term.length > 0);
    let result = allAseguradoras;
    if (term) {
      result = result.filter((a) => a.nombre.toLowerCase().includes(term));
    }
    result = sortItems(result, currentSortAseguradoras.key, currentSortAseguradoras.direction);
    renderAseguradoras(result);
  }

  searchAseguradoras.addEventListener('input', applyFilterAseguradoras);
  clearSearchAseguradoras.addEventListener('click', () => {
    searchAseguradoras.value = '';
    applyFilterAseguradoras();
    searchAseguradoras.focus();
  });

  async function loadAseguradoras() {
    aseguradorasLoading.style.display = 'block';
    aseguradorasEmpty.style.display = 'none';
    aseguradorasTableBody.innerHTML = '';

    if (!supabaseClient) {
      aseguradorasLoading.style.display = 'none';
      aseguradorasEmpty.textContent = 'Supabase no está inicializado.';
      aseguradorasEmpty.style.display = 'block';
      return;
    }

    try {
      const { data, error } = await supabaseClient
        .from(TABLE_ASEGURADORAS)
        .select('*')
        .order('nombre', { ascending: true });

      aseguradorasLoading.style.display = 'none';

      if (error) {
        aseguradorasEmpty.textContent = `Error al cargar aseguradoras: ${getErrorMessage(error)}`;
        aseguradorasEmpty.style.display = 'block';
        return;
      }

      allAseguradoras = data || [];
      applyFilterAseguradoras();
      populateAseguradoraSelect();
    } catch (err) {
      aseguradorasLoading.style.display = 'none';
      aseguradorasEmpty.textContent = `No se pudo conectar con Supabase: ${getErrorMessage(err)}`;
      aseguradorasEmpty.style.display = 'block';
    }
  }

  aseguradoraForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFeedback('aseguradoraFormFeedback');

    if (!validateAseguradoraForm()) {
      showFeedback('aseguradoraFormFeedback', 'Revisa los campos marcados antes de continuar.', 'error');
      return;
    }
    if (!supabaseClient) {
      showFeedback('aseguradoraFormFeedback', 'No se pudo conectar con Supabase.', 'error');
      return;
    }

    submitAseguradoraBtn.disabled = true;
    submitAseguradoraBtn.textContent = isEditModeAseguradora ? 'Guardando...' : 'Registrando...';

    const previousLogoUrl = aseguradoraLogoUrlActualInput.value || null;
    const currentUser = getCurrentUserLabel();

    try {
      // 1) Resolver el logo final antes de tocar la tabla
      let finalLogoUrl = previousLogoUrl;
      if (aseguradoraSelectedLogoFile) {
        finalLogoUrl = await uploadLogo(aseguradoraSelectedLogoFile);
      } else if (aseguradoraLogoWasRemoved) {
        finalLogoUrl = null;
      }

      const payload = {
        nombre: aseguradoraNombreInput.value.trim(),
        logo_url: finalLogoUrl,
      };

      if (isEditModeAseguradora) {
        payload.usuario_modificacion = currentUser;
      } else {
        payload.usuario_creacion = currentUser;
        payload.usuario_modificacion = currentUser;
      }

      let error;
      if (isEditModeAseguradora) {
        ({ error } = await supabaseClient.from(TABLE_ASEGURADORAS).update(payload).eq('id', aseguradoraIdInput.value));
      } else {
        ({ error } = await supabaseClient.from(TABLE_ASEGURADORAS).insert([payload]));
      }

      submitAseguradoraBtn.disabled = false;
      submitAseguradoraBtn.textContent = isEditModeAseguradora ? 'Guardar Cambios' : 'Registrar';

      if (error) {
        const prefix = error.code === '23505' ? 'Ya existe una aseguradora con ese nombre.' : 'No se pudo guardar la aseguradora.';
        showFeedback('aseguradoraFormFeedback', `${prefix} ${getErrorMessage(error)}`, 'error');
        return;
      }

      // 2) Si el logo cambió o se quitó, borra el archivo anterior del storage (best-effort)
      if (previousLogoUrl && previousLogoUrl !== finalLogoUrl) {
        await deleteLogoIfExists(previousLogoUrl);
      }

      showFeedback('aseguradoraFormFeedback', isEditModeAseguradora ? 'Aseguradora actualizada correctamente.' : 'Aseguradora registrada correctamente.', 'success');
      await loadAseguradoras();
      setTimeout(closeAseguradoraModal, 700);
    } catch (err) {
      submitAseguradoraBtn.disabled = false;
      submitAseguradoraBtn.textContent = isEditModeAseguradora ? 'Guardar Cambios' : 'Registrar';
      showFeedback('aseguradoraFormFeedback', `No se pudo guardar: ${getErrorMessage(err)}`, 'error');
    }
  });

  async function handleToggleStatusAseguradora(item) {
    const nextStatus = item.status === 'Activo' ? 'Inactivo' : 'Activo';
    const currentUser = getCurrentUserLabel();

    try {
      const { error } = await supabaseClient
        .from(TABLE_ASEGURADORAS)
        .update({ status: nextStatus, usuario_modificacion: currentUser })
        .eq('id', item.id);

      if (error) {
        showNotification('aseguradorasNotification', `No se pudo cambiar el status: ${getErrorMessage(error)}`, 'error');
        return;
      }
      await loadAseguradoras();
      showNotification('aseguradorasNotification', `Aseguradora "${item.nombre}" marcada como ${nextStatus}.`, 'success');
    } catch (err) {
      showNotification('aseguradorasNotification', `No se pudo cambiar el status: ${getErrorMessage(err)}`, 'error');
    }
  }

  async function handleDeleteAseguradora(id) {
    const item = allAseguradoras.find((a) => a.id === id);
    if (!item) return;

    const confirmed = await openConfirmDialog({
      title: 'Eliminar aseguradora',
      message: `¿Eliminar "${item.nombre}"? Esto también eliminará en cascada sus productos, planes y coberturas asociadas. Esta acción no se puede deshacer.`,
      acceptLabel: 'Eliminar',
    });
    if (!confirmed) return;

    try {
      const { error } = await supabaseClient.from(TABLE_ASEGURADORAS).delete().eq('id', id);
      if (error) {
        showNotification('aseguradorasNotification', `No se pudo eliminar: ${getErrorMessage(error)}`, 'error');
        return;
      }
      await deleteLogoIfExists(item.logo_url);
      await loadAseguradoras();
      await loadProductos();
      showNotification('aseguradorasNotification', 'Aseguradora eliminada correctamente.', 'success');
    } catch (err) {
      showNotification('aseguradorasNotification', `No se pudo eliminar: ${getErrorMessage(err)}`, 'error');
    }
  }

  /* =========================================================================
     ============================  PRODUCTOS  ==================================
     ========================================================================= */

  const searchProductos = document.getElementById('searchProductos');
  const clearSearchProductos = document.getElementById('clearSearchProductos');
  const productosTableBody = document.getElementById('productosTableBody');
  const productosLoading = document.getElementById('productosLoading');
  const productosEmpty = document.getElementById('productosEmpty');
  const openProductoModalBtn = document.getElementById('openProductoModalBtn');

  const productoModalOverlay = document.getElementById('productoModalOverlay');
  const productoModalTitle = document.getElementById('productoModalTitle');
  const productoModalCloseBtn = document.getElementById('productoModalCloseBtn');
  const cancelProductoModalBtn = document.getElementById('cancelProductoModalBtn');
  const productoForm = document.getElementById('productoForm');
  const productoIdInput = document.getElementById('productoId');
  const productoAseguradoraSelect = document.getElementById('productoAseguradora');
  const productoNombreInput = document.getElementById('productoNombre');
  const submitProductoBtn = document.getElementById('submitProductoBtn');

  const fieldProductoAseguradora = document.getElementById('fieldProductoAseguradora');
  const fieldProductoNombre = document.getElementById('fieldProductoNombre');

  attachTitleCaseFormatter(productoNombreInput);

  let currentSortProductos = { key: 'nombre', direction: 'asc' };
  const sortableHeadersProductos = document.querySelectorAll('#productosTable th.is-sortable');

  function populateAseguradoraSelect() {
    const previousValue = productoAseguradoraSelect.value;
    productoAseguradoraSelect.innerHTML = '<option value="">Selecciona una aseguradora</option>';
    allAseguradoras.forEach((a) => {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.nombre;
      productoAseguradoraSelect.appendChild(opt);
    });
    if (previousValue) productoAseguradoraSelect.value = previousValue;
  }

  function productoFields() {
    return [productoAseguradoraSelect, productoNombreInput];
  }

  function openProductoModal({ edit = false, item = null } = {}) {
    isEditModeProducto = edit;
    productoForm.reset();
    clearFeedback('productoFormFeedback');
    [fieldProductoAseguradora, fieldProductoNombre].forEach((f) => setFieldError(f, false));

    if (item) {
      productoModalTitle.textContent = 'Editar Producto';
      submitProductoBtn.textContent = 'Guardar Cambios';
      productoIdInput.value = item.id;
      productoAseguradoraSelect.value = item.aseguradora_id;
      productoNombreInput.value = item.nombre || '';
    } else {
      productoModalTitle.textContent = 'Registrar Producto';
      submitProductoBtn.textContent = 'Registrar';
      productoIdInput.value = '';
    }

    productoModalOverlay.classList.add('is-open');
    productoNombreInput.focus();
  }

  function closeProductoModal() {
    productoModalOverlay.classList.remove('is-open');
    productoForm.reset();
  }

  openProductoModalBtn.addEventListener('click', () => openProductoModal({ edit: false }));
  productoModalCloseBtn.addEventListener('click', closeProductoModal);
  cancelProductoModalBtn.addEventListener('click', closeProductoModal);
  productoModalOverlay.addEventListener('click', (e) => {
    if (e.target === productoModalOverlay) closeProductoModal();
  });

  function validateProductoForm() {
    let valid = true;

    const aseguradoraOk = productoAseguradoraSelect.value.trim().length > 0;
    setFieldError(fieldProductoAseguradora, !aseguradoraOk);
    if (!aseguradoraOk) valid = false;

    const nombreOk = productoNombreInput.value.trim().length >= 3;
    setFieldError(fieldProductoNombre, !nombreOk);
    if (!nombreOk) valid = false;

    return valid;
  }

  function renderProductos(items) {
    productosTableBody.innerHTML = '';
    if (!items.length) {
      productosEmpty.style.display = 'block';
      return;
    }
    productosEmpty.style.display = 'none';

    items.forEach((item) => {
      const tr = document.createElement('tr');
      const aseguradoraNombre = item.aseguradoras?.nombre || allAseguradoras.find((a) => a.id === item.aseguradora_id)?.nombre || '—';
      const isActivo = item.status === 'Activo';
      const statusClass = isActivo ? 'status-pill--activo' : 'status-pill--inactivo';
      const toggleIcon = isActivo ? '✕' : '✓';
      const toggleClass = isActivo ? 'action-btn--toggle-on' : 'action-btn--toggle-off';
      const toggleLabel = isActivo ? 'Inactivar producto' : 'Activar producto';

      tr.innerHTML = `
        <td data-label="Producto">${escapeHtml(item.nombre)}</td>
        <td data-label="Aseguradora">${escapeHtml(aseguradoraNombre)}</td>
        <td data-label="Status Producto"><span class="status-pill ${statusClass}">${escapeHtml(item.status)}</span></td>
        <td data-label="Acciones" class="col-actions">
          <button type="button" class="action-btn action-btn--edit" data-id="${item.id}" aria-label="Editar producto">✏️</button>
          <button type="button" class="action-btn ${toggleClass}" data-id="${item.id}" aria-label="${toggleLabel}">${toggleIcon}</button>
          <button type="button" class="action-btn action-btn--delete" data-id="${item.id}" aria-label="Eliminar producto">🗑️</button>
        </td>
      `;
      productosTableBody.appendChild(tr);

      tr.querySelector('.action-btn--edit').addEventListener('click', () => {
        openProductoModal({ edit: true, item });
      });
      tr.querySelector(`.${toggleClass}`).addEventListener('click', () => handleToggleStatusProducto(item));
      tr.querySelector('.action-btn--delete').addEventListener('click', () => handleDeleteProducto(item.id));
    });
  }

  sortableHeadersProductos.forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sortKey;
      if (currentSortProductos.key === key) {
        currentSortProductos.direction = currentSortProductos.direction === 'asc' ? 'desc' : 'asc';
      } else {
        currentSortProductos = { key, direction: 'asc' };
      }
      updateSortIndicators(sortableHeadersProductos, currentSortProductos);
      applyFilterProductos();
    });
  });

  function applyFilterProductos() {
    const term = searchProductos.value.trim().toLowerCase();
    clearSearchProductos.classList.toggle('is-visible', term.length > 0);
    let result = allProductos;
    if (term) {
      result = result.filter((p) => p.nombre.toLowerCase().includes(term));
    }
    result = sortItems(result, currentSortProductos.key, currentSortProductos.direction);
    renderProductos(result);
  }

  searchProductos.addEventListener('input', applyFilterProductos);
  clearSearchProductos.addEventListener('click', () => {
    searchProductos.value = '';
    applyFilterProductos();
    searchProductos.focus();
  });

  async function loadProductos() {
    productosLoading.style.display = 'block';
    productosEmpty.style.display = 'none';
    productosTableBody.innerHTML = '';

    if (!supabaseClient) {
      productosLoading.style.display = 'none';
      productosEmpty.textContent = 'Supabase no está inicializado.';
      productosEmpty.style.display = 'block';
      return;
    }

    try {
      // Traemos el nombre de la aseguradora embebido vía la relación de clave foránea
      const { data, error } = await supabaseClient
        .from(TABLE_PRODUCTOS)
        .select('*, aseguradoras(nombre)')
        .order('nombre', { ascending: true });

      productosLoading.style.display = 'none';

      if (error) {
        productosEmpty.textContent = `Error al cargar productos: ${getErrorMessage(error)}`;
        productosEmpty.style.display = 'block';
        return;
      }

      allProductos = data || [];
      applyFilterProductos();
    } catch (err) {
      productosLoading.style.display = 'none';
      productosEmpty.textContent = `No se pudo conectar con Supabase: ${getErrorMessage(err)}`;
      productosEmpty.style.display = 'block';
    }
  }

  productoForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFeedback('productoFormFeedback');

    if (!validateProductoForm()) {
      showFeedback('productoFormFeedback', 'Revisa los campos marcados antes de continuar.', 'error');
      return;
    }
    if (!supabaseClient) {
      showFeedback('productoFormFeedback', 'No se pudo conectar con Supabase.', 'error');
      return;
    }

    submitProductoBtn.disabled = true;
    submitProductoBtn.textContent = isEditModeProducto ? 'Guardando...' : 'Registrando...';

    const currentUser = getCurrentUserLabel();

    const payload = {
      aseguradora_id: productoAseguradoraSelect.value,
      nombre: productoNombreInput.value.trim(),
    };

    if (isEditModeProducto) {
      payload.usuario_modificacion = currentUser;
    } else {
      payload.usuario_creacion = currentUser;
      payload.usuario_modificacion = currentUser;
    }

    try {
      let error;
      if (isEditModeProducto) {
        ({ error } = await supabaseClient.from(TABLE_PRODUCTOS).update(payload).eq('id', productoIdInput.value));
      } else {
        ({ error } = await supabaseClient.from(TABLE_PRODUCTOS).insert([payload]));
      }

      submitProductoBtn.disabled = false;
      submitProductoBtn.textContent = isEditModeProducto ? 'Guardar Cambios' : 'Registrar';

      if (error) {
        const prefix = error.code === '23505' ? 'Ya existe un producto con ese nombre para esta aseguradora.' : 'No se pudo guardar el producto.';
        showFeedback('productoFormFeedback', `${prefix} ${getErrorMessage(error)}`, 'error');
        return;
      }

      showFeedback('productoFormFeedback', isEditModeProducto ? 'Producto actualizado correctamente.' : 'Producto registrado correctamente.', 'success');
      await loadProductos();
      setTimeout(closeProductoModal, 700);
    } catch (err) {
      submitProductoBtn.disabled = false;
      submitProductoBtn.textContent = isEditModeProducto ? 'Guardar Cambios' : 'Registrar';
      showFeedback('productoFormFeedback', `No se pudo conectar con Supabase: ${getErrorMessage(err)}`, 'error');
    }
  });

  async function handleToggleStatusProducto(item) {
    const nextStatus = item.status === 'Activo' ? 'Inactivo' : 'Activo';
    const currentUser = getCurrentUserLabel();

    try {
      const { error } = await supabaseClient
        .from(TABLE_PRODUCTOS)
        .update({ status: nextStatus, usuario_modificacion: currentUser })
        .eq('id', item.id);

      if (error) {
        showNotification('productosNotification', `No se pudo cambiar el status: ${getErrorMessage(error)}`, 'error');
        return;
      }
      await loadProductos();
      showNotification('productosNotification', `Producto "${item.nombre}" marcado como ${nextStatus}.`, 'success');
    } catch (err) {
      showNotification('productosNotification', `No se pudo cambiar el status: ${getErrorMessage(err)}`, 'error');
    }
  }

  async function handleDeleteProducto(id) {
    const item = allProductos.find((p) => p.id === id);
    if (!item) return;

    const confirmed = await openConfirmDialog({
      title: 'Eliminar producto',
      message: `¿Eliminar "${item.nombre}"? Esto también eliminará en cascada sus planes y coberturas asociadas. Esta acción no se puede deshacer.`,
      acceptLabel: 'Eliminar',
    });
    if (!confirmed) return;

    try {
      const { error } = await supabaseClient.from(TABLE_PRODUCTOS).delete().eq('id', id);
      if (error) {
        showNotification('productosNotification', `No se pudo eliminar: ${getErrorMessage(error)}`, 'error');
        return;
      }
      await loadProductos();
      showNotification('productosNotification', 'Producto eliminado correctamente.', 'success');
    } catch (err) {
      showNotification('productosNotification', `No se pudo eliminar: ${getErrorMessage(err)}`, 'error');
    }
  }

  /* =========================================================================
     ==============================  PLANES  ====================================
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
  const submitPlanBtn = document.getElementById('submitPlanBtn');

  const planAseguradoraSelect = document.getElementById('planAseguradora');
  const planProductoSelect = document.getElementById('planProducto');
  const planTipoTarifaSelect = document.getElementById('planTipoTarifa');
  const planSumaAseguradaInput = document.getElementById('planSumaAsegurada');
  const planDeducibleVzlaInput = document.getElementById('planDeducibleVzla');
  const planDeducibleExteriorInput = document.getElementById('planDeducibleExterior');
  const planNombrePreview = document.getElementById('planNombrePreview');

  const planEdadMinMaternidadInput = document.getElementById('planEdadMinMaternidad');
  const planEdadMaxMaternidadInput = document.getElementById('planEdadMaxMaternidad');
  const planEdadMinTitularInput = document.getElementById('planEdadMinTitular');
  const planEdadMaxTitularInput = document.getElementById('planEdadMaxTitular');
  const planEdadMinFamiliaresInput = document.getElementById('planEdadMinFamiliares');
  const planEdadMaxFamiliaresInput = document.getElementById('planEdadMaxFamiliares');
  const planModoTarifaHijosSelect = document.getElementById('planModoTarifaHijos');

  const planGastosFraccionamientoCheck = document.getElementById('planGastosFraccionamientoCheck');
  const planGastosFraccionamientoMontoInput = document.getElementById('planGastosFraccionamientoMonto');
  const planSemestralCheck = document.getElementById('planSemestral');
  const planTrimestralCheck = document.getElementById('planTrimestral');
  const planMensualCheck = document.getElementById('planMensual');
  const planFinanciableCheck = document.getElementById('planFinanciable');

  const planDescuentoDivisasCheck = document.getElementById('planDescuentoDivisasCheck');
  const planDescuentoDivisasPorcentajeInput = document.getElementById('planDescuentoDivisasPorcentaje');
  const planDescuentoContadoCheck = document.getElementById('planDescuentoContadoCheck');
  const planDescuentoContadoPorcentajeInput = document.getElementById('planDescuentoContadoPorcentaje');

  const fieldPlanAseguradora = document.getElementById('fieldPlanAseguradora');
  const fieldPlanProducto = document.getElementById('fieldPlanProducto');
  const fieldPlanTipoTarifa = document.getElementById('fieldPlanTipoTarifa');
  const fieldPlanSumaAsegurada = document.getElementById('fieldPlanSumaAsegurada');
  const fieldPlanDeducibleVzla = document.getElementById('fieldPlanDeducibleVzla');
  const fieldPlanDeducibleExterior = document.getElementById('fieldPlanDeducibleExterior');
  const fieldPlanEdadMinMaternidad = document.getElementById('fieldPlanEdadMinMaternidad');
  const fieldPlanEdadMaxMaternidad = document.getElementById('fieldPlanEdadMaxMaternidad');
  const fieldPlanEdadMinTitular = document.getElementById('fieldPlanEdadMinTitular');
  const fieldPlanEdadMaxTitular = document.getElementById('fieldPlanEdadMaxTitular');
  const fieldPlanEdadMinFamiliares = document.getElementById('fieldPlanEdadMinFamiliares');
  const fieldPlanEdadMaxFamiliares = document.getElementById('fieldPlanEdadMaxFamiliares');
  const fieldPlanModoTarifaHijos = document.getElementById('fieldPlanModoTarifaHijos');

  attachThousandsFormatter(planSumaAseguradaInput);
  attachThousandsFormatter(planDeducibleVzlaInput);
  attachThousandsFormatter(planDeducibleExteriorInput);
  attachThousandsFormatter(planGastosFraccionamientoMontoInput);

  attachCheckToggle(planGastosFraccionamientoCheck, [planGastosFraccionamientoMontoInput]);
  attachCheckToggle(planDescuentoDivisasCheck, [planDescuentoDivisasPorcentajeInput]);
  attachCheckToggle(planDescuentoContadoCheck, [planDescuentoContadoPorcentajeInput]);

  let currentSortPlanes = { key: 'nombre_plan', direction: 'asc' };
  const sortableHeadersPlanes = document.querySelectorAll('#planesTable th.is-sortable');

  function populatePlanAseguradoraSelect() {
    const previousValue = planAseguradoraSelect.value;
    planAseguradoraSelect.innerHTML = '<option value="">Selecciona una aseguradora</option>';
    allAseguradoras.forEach((a) => {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.nombre;
      planAseguradoraSelect.appendChild(opt);
    });
    if (previousValue) planAseguradoraSelect.value = previousValue;
  }

  function populatePlanProductoSelect(aseguradoraId, selectedProductoId = '') {
    planProductoSelect.innerHTML = '';
    const productos = aseguradoraId ? allProductos.filter((p) => p.aseguradora_id === aseguradoraId) : [];
    if (!aseguradoraId) {
      planProductoSelect.innerHTML = '<option value="">Selecciona primero una aseguradora</option>';
      planProductoSelect.disabled = true;
      return;
    }
    planProductoSelect.disabled = false;
    planProductoSelect.innerHTML = '<option value="">Selecciona un producto</option>';
    productos.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.nombre;
      planProductoSelect.appendChild(opt);
    });
    if (selectedProductoId) planProductoSelect.value = selectedProductoId;
  }

  function computePlanNombre() {
    const aseguradoraNombre = planAseguradoraSelect.selectedOptions[0]?.value ? planAseguradoraSelect.selectedOptions[0].textContent : '';
    const productoNombre = planProductoSelect.selectedOptions[0]?.value ? planProductoSelect.selectedOptions[0].textContent : '';
    const suma = getThousandsValue(planSumaAseguradaInput);
    const dedVzla = getThousandsValue(planDeducibleVzlaInput);
    const dedExt = getThousandsValue(planDeducibleExteriorInput);

    if (!aseguradoraNombre || !productoNombre || suma == null || dedVzla == null || dedExt == null) return null;

    return `${aseguradoraNombre} - ${productoNombre} - $${formatThousands(String(suma))} - Ded Vzla $${formatThousands(String(dedVzla))} - Ded Ext $${formatThousands(String(dedExt))}`;
  }

  function updatePlanNombrePreview() {
    const nombre = computePlanNombre();
    planNombrePreview.textContent = nombre || 'Completa los campos para generar el nombre del plan.';
  }

  planAseguradoraSelect.addEventListener('change', () => {
    populatePlanProductoSelect(planAseguradoraSelect.value);
    updatePlanNombrePreview();
  });
  [planProductoSelect, planSumaAseguradaInput, planDeducibleVzlaInput, planDeducibleExteriorInput].forEach((el) => {
    el.addEventListener('input', updatePlanNombrePreview);
    el.addEventListener('change', updatePlanNombrePreview);
  });

  function openPlanModal({ edit = false, item = null, readOnly = false } = {}) {
    isEditModePlan = edit;
    isReadOnlyPlan = readOnly;
    planForm.reset();
    clearFeedback('planFormFeedback');
    [fieldPlanAseguradora, fieldPlanProducto, fieldPlanTipoTarifa, fieldPlanSumaAsegurada, fieldPlanDeducibleVzla,
      fieldPlanDeducibleExterior, fieldPlanEdadMinMaternidad, fieldPlanEdadMaxMaternidad, fieldPlanEdadMinTitular,
      fieldPlanEdadMaxTitular, fieldPlanEdadMinFamiliares, fieldPlanEdadMaxFamiliares, fieldPlanModoTarifaHijos]
      .forEach((f) => setFieldError(f, false));

    populatePlanAseguradoraSelect();
    populatePlanProductoSelect('');
    setFormControlsForcedDisabled(planForm, false);
    planGastosFraccionamientoMontoInput.disabled = !planGastosFraccionamientoCheck.checked;
    planDescuentoDivisasPorcentajeInput.disabled = !planDescuentoDivisasCheck.checked;
    planDescuentoContadoPorcentajeInput.disabled = !planDescuentoContadoCheck.checked;

    if (item) {
      planModalTitle.textContent = readOnly ? 'Ver Plan' : 'Editar Plan';
      submitPlanBtn.textContent = 'Guardar Cambios';
      planIdInput.value = item.id;
      planAseguradoraSelect.value = item.aseguradora_id;
      populatePlanProductoSelect(item.aseguradora_id, item.producto_id);
      planTipoTarifaSelect.value = item.tipo_tarifa || '';
      setThousandsValue(planSumaAseguradaInput, item.suma_asegurada);
      setThousandsValue(planDeducibleVzlaInput, item.deducible_venezuela);
      setThousandsValue(planDeducibleExteriorInput, item.deducible_exterior);

      planEdadMinMaternidadInput.value = item.edad_min_maternidad ?? '';
      planEdadMaxMaternidadInput.value = item.edad_max_maternidad ?? '';
      planEdadMinTitularInput.value = item.edad_min_titular ?? '';
      planEdadMaxTitularInput.value = item.edad_max_titular ?? '';
      planEdadMinFamiliaresInput.value = item.edad_min_familiares ?? '';
      planEdadMaxFamiliaresInput.value = item.edad_max_familiares ?? '';
      planModoTarifaHijosSelect.value = item.modo_tarifa_hijos || '';

      planGastosFraccionamientoCheck.checked = !!item.gastos_fraccionamiento_activo;
      planGastosFraccionamientoMontoInput.disabled = !planGastosFraccionamientoCheck.checked;
      setThousandsValue(planGastosFraccionamientoMontoInput, item.gastos_fraccionamiento_monto);
      planSemestralCheck.checked = !!item.fraccionamiento_semestral;
      planTrimestralCheck.checked = !!item.fraccionamiento_trimestral;
      planMensualCheck.checked = !!item.fraccionamiento_mensual;
      planFinanciableCheck.checked = !!item.financiable;

      planDescuentoDivisasCheck.checked = !!item.descuento_divisas_activo;
      planDescuentoDivisasPorcentajeInput.disabled = !planDescuentoDivisasCheck.checked;
      planDescuentoDivisasPorcentajeInput.value = item.descuento_divisas_porcentaje ?? '';
      planDescuentoContadoCheck.checked = !!item.descuento_contado_activo;
      planDescuentoContadoPorcentajeInput.disabled = !planDescuentoContadoCheck.checked;
      planDescuentoContadoPorcentajeInput.value = item.descuento_contado_porcentaje ?? '';

      updatePlanNombrePreview();
    } else {
      planModalTitle.textContent = 'Registrar Plan';
      submitPlanBtn.textContent = 'Registrar';
      planIdInput.value = '';
      updatePlanNombrePreview();
    }

    planModalOverlay.querySelector('.modal').classList.toggle('modal--readonly', readOnly);
    submitPlanBtn.style.display = readOnly ? 'none' : 'inline-flex';
    if (readOnly) setFormControlsForcedDisabled(planForm, true);

    planModalOverlay.classList.add('is-open');
  }

  function closePlanModal() {
    planModalOverlay.classList.remove('is-open');
    planForm.reset();
  }

  openPlanModalBtn.addEventListener('click', () => openPlanModal({ edit: false }));
  planModalCloseBtn.addEventListener('click', closePlanModal);
  cancelPlanModalBtn.addEventListener('click', closePlanModal);
  planModalOverlay.addEventListener('click', (e) => {
    if (e.target === planModalOverlay) closePlanModal();
  });

  function validatePlanForm() {
    let valid = true;
    const check = (fieldEl, ok) => { setFieldError(fieldEl, !ok); if (!ok) valid = false; };

    check(fieldPlanAseguradora, planAseguradoraSelect.value.trim().length > 0);
    check(fieldPlanProducto, planProductoSelect.value.trim().length > 0);
    check(fieldPlanTipoTarifa, planTipoTarifaSelect.value.trim().length > 0);
    check(fieldPlanSumaAsegurada, getThousandsValue(planSumaAseguradaInput) !== null);
    check(fieldPlanDeducibleVzla, getThousandsValue(planDeducibleVzlaInput) !== null);
    check(fieldPlanDeducibleExterior, getThousandsValue(planDeducibleExteriorInput) !== null);
    check(fieldPlanModoTarifaHijos, planModoTarifaHijosSelect.value.trim().length > 0);

    const minMat = Number(planEdadMinMaternidadInput.value);
    const maxMat = Number(planEdadMaxMaternidadInput.value);
    check(fieldPlanEdadMinMaternidad, planEdadMinMaternidadInput.value !== '' && minMat >= 0 && minMat <= 60);
    check(fieldPlanEdadMaxMaternidad, planEdadMaxMaternidadInput.value !== '' && maxMat >= 0 && maxMat <= 60 && maxMat >= minMat);

    const minTit = Number(planEdadMinTitularInput.value);
    const maxTit = Number(planEdadMaxTitularInput.value);
    check(fieldPlanEdadMinTitular, planEdadMinTitularInput.value !== '' && minTit >= 0 && minTit <= 120);
    check(fieldPlanEdadMaxTitular, planEdadMaxTitularInput.value !== '' && maxTit >= 0 && maxTit <= 120 && maxTit >= minTit);

    const minFam = Number(planEdadMinFamiliaresInput.value);
    const maxFam = Number(planEdadMaxFamiliaresInput.value);
    check(fieldPlanEdadMinFamiliares, planEdadMinFamiliaresInput.value !== '' && minFam >= 0 && minFam <= 120);
    check(fieldPlanEdadMaxFamiliares, planEdadMaxFamiliaresInput.value !== '' && maxFam >= 0 && maxFam <= 120 && maxFam >= minFam);

    if (planGastosFraccionamientoCheck.checked && getThousandsValue(planGastosFraccionamientoMontoInput) === null) valid = false;
    if (planDescuentoDivisasCheck.checked && planDescuentoDivisasPorcentajeInput.value === '') valid = false;
    if (planDescuentoContadoCheck.checked && planDescuentoContadoPorcentajeInput.value === '') valid = false;

    return valid;
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
      const isActivo = item.status === 'Activo';
      const statusClass = isActivo ? 'status-pill--activo' : 'status-pill--inactivo';
      const toggleIcon = isActivo ? '✕' : '✓';
      const toggleClass = isActivo ? 'action-btn--toggle-on' : 'action-btn--toggle-off';
      const toggleLabel = isActivo ? 'Inactivar plan' : 'Activar plan';

      tr.innerHTML = `
        <td data-label="Plan">${escapeHtml(item.nombre_plan)}</td>
        <td data-label="Status Plan"><span class="status-pill ${statusClass}">${escapeHtml(item.status)}</span></td>
        <td data-label="Acciones" class="col-actions">
          <button type="button" class="action-btn action-btn--view" data-id="${item.id}" aria-label="Ver plan">👁️</button>
          <button type="button" class="action-btn action-btn--edit" data-id="${item.id}" aria-label="Editar plan">✏️</button>
          <button type="button" class="action-btn action-btn--tarifa" data-id="${item.id}" aria-label="Tarifa del plan">💲</button>
          <button type="button" class="action-btn ${toggleClass}" data-id="${item.id}" aria-label="${toggleLabel}">${toggleIcon}</button>
          <button type="button" class="action-btn action-btn--delete" data-id="${item.id}" aria-label="Eliminar plan">🗑️</button>
        </td>
      `;
      planesTableBody.appendChild(tr);

      tr.querySelector('.action-btn--view').addEventListener('click', () => {
        openPlanModal({ edit: true, item, readOnly: true });
      });
      tr.querySelector('.action-btn--edit').addEventListener('click', () => {
        openPlanModal({ edit: true, item });
      });
      tr.querySelector('.action-btn--tarifa').addEventListener('click', () => {
        openTarifaModalForPlan(item);
      });
      tr.querySelector(`.${toggleClass}`).addEventListener('click', () => handleToggleStatusPlan(item));
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
      result = result.filter((p) => (p.nombre_plan || '').toLowerCase().includes(term));
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
        .select('*')
        .order('nombre_plan', { ascending: true });

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
    if (isReadOnlyPlan) return;
    clearFeedback('planFormFeedback');

    if (!validatePlanForm()) {
      showFeedback('planFormFeedback', 'Revisa los campos marcados antes de continuar.', 'error');
      return;
    }
    if (!supabaseClient) {
      showFeedback('planFormFeedback', 'No se pudo conectar con Supabase.', 'error');
      return;
    }

    const nombrePlan = computePlanNombre();
    if (!nombrePlan) {
      showFeedback('planFormFeedback', 'No se pudo generar el nombre del plan. Revisa los campos de datos principales.', 'error');
      return;
    }

    submitPlanBtn.disabled = true;
    submitPlanBtn.textContent = isEditModePlan ? 'Guardando...' : 'Registrando...';

    const currentUser = getCurrentUserLabel();

    const payload = {
      aseguradora_id: planAseguradoraSelect.value,
      producto_id: planProductoSelect.value,
      tipo_tarifa: planTipoTarifaSelect.value,
      suma_asegurada: getThousandsValue(planSumaAseguradaInput),
      deducible_venezuela: getThousandsValue(planDeducibleVzlaInput),
      deducible_exterior: getThousandsValue(planDeducibleExteriorInput),
      nombre_plan: nombrePlan,
      edad_min_maternidad: Number(planEdadMinMaternidadInput.value),
      edad_max_maternidad: Number(planEdadMaxMaternidadInput.value),
      edad_min_titular: Number(planEdadMinTitularInput.value),
      edad_max_titular: Number(planEdadMaxTitularInput.value),
      edad_min_familiares: Number(planEdadMinFamiliaresInput.value),
      edad_max_familiares: Number(planEdadMaxFamiliaresInput.value),
      modo_tarifa_hijos: planModoTarifaHijosSelect.value,
      gastos_fraccionamiento_activo: planGastosFraccionamientoCheck.checked,
      gastos_fraccionamiento_monto: planGastosFraccionamientoCheck.checked ? getThousandsValue(planGastosFraccionamientoMontoInput) : null,
      fraccionamiento_semestral: planSemestralCheck.checked,
      fraccionamiento_trimestral: planTrimestralCheck.checked,
      fraccionamiento_mensual: planMensualCheck.checked,
      financiable: planFinanciableCheck.checked,
      descuento_divisas_activo: planDescuentoDivisasCheck.checked,
      descuento_divisas_porcentaje: planDescuentoDivisasCheck.checked ? Number(planDescuentoDivisasPorcentajeInput.value) : null,
      descuento_contado_activo: planDescuentoContadoCheck.checked,
      descuento_contado_porcentaje: planDescuentoContadoCheck.checked ? Number(planDescuentoContadoPorcentajeInput.value) : null,
    };

    if (isEditModePlan) {
      payload.usuario_modificacion = currentUser;
    } else {
      payload.usuario_creacion = currentUser;
      payload.usuario_modificacion = currentUser;
    }

    try {
      let error;
      if (isEditModePlan) {
        ({ error } = await supabaseClient.from(TABLE_PLANES).update(payload).eq('id', planIdInput.value));
      } else {
        ({ error } = await supabaseClient.from(TABLE_PLANES).insert([payload]));
      }

      submitPlanBtn.disabled = false;
      submitPlanBtn.textContent = isEditModePlan ? 'Guardar Cambios' : 'Registrar';

      if (error) {
        showFeedback('planFormFeedback', `No se pudo guardar el plan. ${getErrorMessage(error)}`, 'error');
        return;
      }

      showFeedback('planFormFeedback', isEditModePlan ? 'Plan actualizado correctamente.' : 'Plan registrado correctamente.', 'success');
      await loadPlanes();
      setTimeout(closePlanModal, 700);
    } catch (err) {
      submitPlanBtn.disabled = false;
      submitPlanBtn.textContent = isEditModePlan ? 'Guardar Cambios' : 'Registrar';
      showFeedback('planFormFeedback', `No se pudo conectar con Supabase: ${getErrorMessage(err)}`, 'error');
    }
  });

  async function handleToggleStatusPlan(item) {
    const nextStatus = item.status === 'Activo' ? 'Inactivo' : 'Activo';
    const currentUser = getCurrentUserLabel();

    try {
      const { error } = await supabaseClient
        .from(TABLE_PLANES)
        .update({ status: nextStatus, usuario_modificacion: currentUser })
        .eq('id', item.id);

      if (error) {
        showNotification('planesNotification', `No se pudo cambiar el status: ${getErrorMessage(error)}`, 'error');
        return;
      }
      await loadPlanes();
      showNotification('planesNotification', `Plan "${item.nombre_plan}" marcado como ${nextStatus}.`, 'success');
    } catch (err) {
      showNotification('planesNotification', `No se pudo cambiar el status: ${getErrorMessage(err)}`, 'error');
    }
  }

  async function handleDeletePlan(id) {
    const item = allPlanes.find((p) => p.id === id);
    if (!item) return;

    const confirmed = await openConfirmDialog({
      title: 'Eliminar plan',
      message: `¿Eliminar "${item.nombre_plan}"? Esto también eliminará la tarifa asociada a este plan. Esta acción no se puede deshacer.`,
      acceptLabel: 'Eliminar',
    });
    if (!confirmed) return;

    try {
      // Elimina primero la(s) tarifa(s) asociada(s) (además del ON DELETE CASCADE
      // definido en la base de datos, se hace explícito aquí por seguridad).
      await supabaseClient.from(TABLE_TARIFAS).delete().eq('plan_id', id);

      const { error } = await supabaseClient.from(TABLE_PLANES).delete().eq('id', id);
      if (error) {
        showNotification('planesNotification', `No se pudo eliminar: ${getErrorMessage(error)}`, 'error');
        return;
      }
      await loadPlanes();
      await loadTarifas();
      showNotification('planesNotification', 'Plan eliminado correctamente.', 'success');
    } catch (err) {
      showNotification('planesNotification', `No se pudo eliminar: ${getErrorMessage(err)}`, 'error');
    }
  }

  /* =========================================================================
     ==============================  TARIFAS  ===================================
     ========================================================================= */

  const tarifaModalOverlay = document.getElementById('tarifaModalOverlay');
  const tarifaModalTitle = document.getElementById('tarifaModalTitle');
  const tarifaModalCloseBtn = document.getElementById('tarifaModalCloseBtn');
  const cancelTarifaModalBtn = document.getElementById('cancelTarifaModalBtn');
  const editTarifaBtn = document.getElementById('editTarifaBtn');
  const tarifaForm = document.getElementById('tarifaForm');
  const tarifaIdInput = document.getElementById('tarifaId');
  const tarifaPlanIdInput = document.getElementById('tarifaPlanId');
  const submitTarifaBtn = document.getElementById('submitTarifaBtn');

  const tarifaPlanNombreInput = document.getElementById('tarifaPlanNombre');
  const tarifaCoberturasContainer = document.getElementById('tarifaCoberturasContainer');
  const tarifaMaternidadContainer = document.getElementById('tarifaMaternidadContainer');
  const tarifaRangosContainer = document.getElementById('tarifaRangosContainer');

  // Se guarda el plan y la tarifa actualmente mostrados en el modal para
  // poder pasar de "Ver" a "Editar" sin tener que volver a buscar los datos.
  let currentTarifaPlan = null;
  let currentTarifaItem = null;

  /* ---------------------------------------------------------------------
     Tarjeta reutilizable de cobertura estándar (con checkbox "Servicios").
     Aplica para las 9 coberturas de la lista (Funerarios, Asistencia en
     viajes, Invalidez permanente, Muerte accidental, Odontología,
     Oftalmología, Dermatología, Psicología, Servicios Adicionales).
     --------------------------------------------------------------------- */
  function createCoverageCard(def) {
    const wrap = document.createElement('div');
    wrap.className = 'coverage-card';
    wrap.dataset.key = def.key;
    wrap.innerHTML = `
      <div class="coverage-card__title">${escapeHtml(def.label)}</div>
      <div class="coverage-card__row">
        <div class="coverage-card__field">
          <label>Estado</label>
          <select class="text-input cov-estado">
            <option value="No contempla">No contempla</option>
            <option value="Incluido">Incluido</option>
            <option value="Opcional">Opcional</option>
          </select>
        </div>
        <div class="coverage-card__field" style="display:flex;align-items:flex-end;">
          <label class="check-field"><input type="checkbox" class="cov-servicios"> Servicios</label>
        </div>
      </div>
      <div class="cov-sums"></div>
      <button type="button" class="btn-add-sum" style="display:none;">＋ Agregar suma asegurada</button>
    `;

    const estadoSelect = wrap.querySelector('.cov-estado');
    const serviciosCheck = wrap.querySelector('.cov-servicios');
    const sumsContainer = wrap.querySelector('.cov-sums');
    const addBtn = wrap.querySelector('.btn-add-sum');

    function addSumRow(sumaVal = '', primaVal = '') {
      const row = document.createElement('div');
      row.className = 'sum-row';
      row.innerHTML = `
        <div class="coverage-card__field">
          <label>Suma Asegurada</label>
          <div class="input-currency"><span class="input-currency__prefix">$</span><input type="text" inputmode="numeric" class="cov-suma"></div>
        </div>
        <div class="coverage-card__field cov-prima-field">
          <label>Prima</label>
          <div class="input-currency"><span class="input-currency__prefix">$</span><input type="number" min="0" step="0.01" class="cov-prima"></div>
        </div>
        <button type="button" class="btn-remove-sum" title="Quitar esta suma">🗑️</button>
      `;
      const sumaInput = row.querySelector('.cov-suma');
      attachThousandsFormatter(sumaInput);
      setThousandsValue(sumaInput, sumaVal);
      const primaInput = row.querySelector('.cov-prima');
      if (primaVal !== '' && primaVal != null) primaInput.value = primaVal;
      row.querySelector('.btn-remove-sum').addEventListener('click', () => {
        if (sumsContainer.children.length > 1) row.remove();
        applyState();
      });
      sumsContainer.appendChild(row);
      return row;
    }

    function applyState() {
      const estado = estadoSelect.value;
      if (estado === 'No contempla') {
        serviciosCheck.checked = false;
        serviciosCheck.disabled = true;
        addBtn.style.display = 'none';
        Array.from(sumsContainer.children).forEach((row, idx) => { if (idx > 0) row.remove(); });
        const first = sumsContainer.children[0];
        if (first) {
          first.querySelector('.cov-suma').disabled = true;
          first.querySelector('.cov-suma').value = '';
          first.querySelector('.cov-prima').disabled = true;
          first.querySelector('.cov-prima').value = '';
          first.querySelector('.cov-prima-field').style.display = 'none';
          first.querySelector('.btn-remove-sum').style.display = 'none';
        }
        return;
      }

      serviciosCheck.disabled = false;
      const isOpcional = estado === 'Opcional';
      addBtn.style.display = isOpcional ? 'inline-block' : 'none';
      if (!isOpcional) {
        Array.from(sumsContainer.children).forEach((row, idx) => { if (idx > 0) row.remove(); });
      }
      Array.from(sumsContainer.children).forEach((row) => {
        const sumaInput = row.querySelector('.cov-suma');
        const primaInput = row.querySelector('.cov-prima');
        const primaField = row.querySelector('.cov-prima-field');
        primaField.style.display = isOpcional ? '' : 'none';
        if (serviciosCheck.checked) {
          sumaInput.disabled = true; sumaInput.value = '';
          primaInput.disabled = true; primaInput.value = '';
        } else {
          sumaInput.disabled = false;
          primaInput.disabled = !isOpcional;
          if (!isOpcional) primaInput.value = '';
        }
        row.querySelector('.btn-remove-sum').style.display = (isOpcional && sumsContainer.children.length > 1) ? 'inline-flex' : 'none';
      });
    }

    estadoSelect.addEventListener('change', applyState);
    serviciosCheck.addEventListener('change', applyState);
    addBtn.addEventListener('click', () => { addSumRow(); applyState(); });

    addSumRow();
    applyState();

    return {
      element: wrap,
      setData(data) {
        estadoSelect.value = data?.estado || 'No contempla';
        serviciosCheck.checked = !!data?.servicios;
        sumsContainer.innerHTML = '';
        const sums = (data?.sumas && data.sumas.length) ? data.sumas : [{ suma_asegurada: '', prima: '' }];
        sums.forEach((s) => addSumRow(s.suma_asegurada, s.prima));
        applyState();
      },
      getData() {
        const sums = Array.from(sumsContainer.children).map((row) => ({
          suma_asegurada: getThousandsValue(row.querySelector('.cov-suma')),
          prima: row.querySelector('.cov-prima').value !== '' ? Number(row.querySelector('.cov-prima').value) : null,
        })).filter((s) => s.suma_asegurada !== null || s.prima !== null);
        return { estado: estadoSelect.value, servicios: serviciosCheck.checked, sumas: sums };
      },
    };
  }

  /* ---------------------------------------------------------------------
     Tarjeta de Maternidad (misma lógica de estado, pero con "Edad máxima"
     en lugar del checkbox "Servicios").
     --------------------------------------------------------------------- */
  function createMaternidadCard() {
    const wrap = document.createElement('div');
    wrap.className = 'coverage-card';
    wrap.innerHTML = `
      <div class="coverage-card__row">
        <div class="coverage-card__field">
          <label>Estado</label>
          <select class="text-input mat-estado">
            <option value="No contempla">No contempla</option>
            <option value="Incluido">Incluido</option>
            <option value="Opcional">Opcional</option>
          </select>
        </div>
        <div class="coverage-card__field">
          <label>Edad Máxima</label>
          <input type="number" min="0" max="60" step="1" class="text-input mat-edad-max" disabled>
        </div>
      </div>
      <div class="mat-sums"></div>
      <button type="button" class="btn-add-sum" style="display:none;">＋ Agregar suma asegurada</button>
    `;

    const estadoSelect = wrap.querySelector('.mat-estado');
    const edadMaxInput = wrap.querySelector('.mat-edad-max');
    const sumsContainer = wrap.querySelector('.mat-sums');
    const addBtn = wrap.querySelector('.btn-add-sum');

    function addSumRow(sumaVal = '', primaVal = '') {
      const row = document.createElement('div');
      row.className = 'sum-row';
      row.innerHTML = `
        <div class="coverage-card__field">
          <label>Suma Asegurada</label>
          <div class="input-currency"><span class="input-currency__prefix">$</span><input type="text" inputmode="numeric" class="mat-suma"></div>
        </div>
        <div class="coverage-card__field mat-prima-field">
          <label>Prima</label>
          <div class="input-currency"><span class="input-currency__prefix">$</span><input type="number" min="0" step="0.01" class="mat-prima"></div>
        </div>
        <button type="button" class="btn-remove-sum" title="Quitar esta suma">🗑️</button>
      `;
      const sumaInput = row.querySelector('.mat-suma');
      attachThousandsFormatter(sumaInput);
      setThousandsValue(sumaInput, sumaVal);
      const primaInput = row.querySelector('.mat-prima');
      if (primaVal !== '' && primaVal != null) primaInput.value = primaVal;
      row.querySelector('.btn-remove-sum').addEventListener('click', () => {
        if (sumsContainer.children.length > 1) row.remove();
        applyState();
      });
      sumsContainer.appendChild(row);
      return row;
    }

    function applyState() {
      const estado = estadoSelect.value;
      if (estado === 'No contempla') {
        edadMaxInput.disabled = true;
        edadMaxInput.value = '';
        addBtn.style.display = 'none';
        Array.from(sumsContainer.children).forEach((row, idx) => { if (idx > 0) row.remove(); });
        const first = sumsContainer.children[0];
        if (first) {
          first.querySelector('.mat-suma').disabled = true;
          first.querySelector('.mat-suma').value = '';
          first.querySelector('.mat-prima').disabled = true;
          first.querySelector('.mat-prima').value = '';
          first.querySelector('.mat-prima-field').style.display = 'none';
          first.querySelector('.btn-remove-sum').style.display = 'none';
        }
        return;
      }

      edadMaxInput.disabled = false;
      const isOpcional = estado === 'Opcional';
      addBtn.style.display = isOpcional ? 'inline-block' : 'none';
      if (!isOpcional) {
        Array.from(sumsContainer.children).forEach((row, idx) => { if (idx > 0) row.remove(); });
      }
      Array.from(sumsContainer.children).forEach((row) => {
        row.querySelector('.mat-suma').disabled = false;
        const primaInput = row.querySelector('.mat-prima');
        const primaField = row.querySelector('.mat-prima-field');
        primaField.style.display = isOpcional ? '' : 'none';
        primaInput.disabled = !isOpcional;
        if (!isOpcional) primaInput.value = '';
        row.querySelector('.btn-remove-sum').style.display = (isOpcional && sumsContainer.children.length > 1) ? 'inline-flex' : 'none';
      });
    }

    estadoSelect.addEventListener('change', applyState);
    addBtn.addEventListener('click', () => { addSumRow(); applyState(); });

    addSumRow();
    applyState();

    return {
      element: wrap,
      setData(data) {
        estadoSelect.value = data?.estado || 'No contempla';
        edadMaxInput.value = data?.edad_maxima ?? '';
        sumsContainer.innerHTML = '';
        const sums = (data?.sumas && data.sumas.length) ? data.sumas : [{ suma_asegurada: '', prima: '' }];
        sums.forEach((s) => addSumRow(s.suma_asegurada, s.prima));
        applyState();
      },
      getData() {
        const sums = Array.from(sumsContainer.children).map((row) => ({
          suma_asegurada: getThousandsValue(row.querySelector('.mat-suma')),
          prima: row.querySelector('.mat-prima').value !== '' ? Number(row.querySelector('.mat-prima').value) : null,
        })).filter((s) => s.suma_asegurada !== null || s.prima !== null);
        return {
          estado: estadoSelect.value,
          edad_maxima: edadMaxInput.value !== '' ? Number(edadMaxInput.value) : null,
          sumas: sums,
        };
      },
    };
  }

  // Se construyen una sola vez y se reutilizan (setData/getData) en cada apertura del modal.
  const tarifaCoverageControls = {};
  COVERAGE_LIST.forEach((def) => {
    const card = createCoverageCard(def);
    tarifaCoverageControls[def.key] = card;
    tarifaCoberturasContainer.appendChild(card.element);
  });
  const tarifaMaternidadControl = createMaternidadCard();
  tarifaMaternidadContainer.appendChild(tarifaMaternidadControl.element);

  /* ---------------------------------------------------------------------
     Tarifas por rango etario: se generan dinámicamente según la edad
     mínima/máxima de Titular y de Familiares configuradas en el Plan
     seleccionado, replicando los mismos rangos para ambos grupos.
     --------------------------------------------------------------------- */
  let tarifaRangeInputs = { titular: {}, familiares: {} };

  function renderTarifaRangos(plan) {
    tarifaRangosContainer.innerHTML = '';
    tarifaRangeInputs = { titular: {}, familiares: {} };

    if (!plan) {
      tarifaRangosContainer.innerHTML = '<p class="age-range-empty">Selecciona un plan para ver los rangos etarios disponibles.</p>';
      return;
    }

    const titularRanges = rangesForAges(plan.edad_min_titular, plan.edad_max_titular);
    const familiaresRanges = rangesForAges(plan.edad_min_familiares, plan.edad_max_familiares);

    function buildGroup(title, ranges, storeKey) {
      const groupTitle = document.createElement('div');
      groupTitle.className = 'age-range-group__title';
      groupTitle.textContent = title;
      tarifaRangosContainer.appendChild(groupTitle);

      if (!ranges.length) {
        const p = document.createElement('p');
        p.className = 'age-range-empty';
        p.textContent = 'No hay rangos configurados para este grupo en el plan seleccionado.';
        tarifaRangosContainer.appendChild(p);
        return;
      }

      const grid = document.createElement('div');
      grid.className = 'age-range-grid';
      ranges.forEach((r) => {
        const item = document.createElement('div');
        item.className = 'age-range-item';
        item.innerHTML = `
          <label>${r.key} años</label>
          <div class="input-currency"><span class="input-currency__prefix">$</span><input type="number" min="0" step="0.01" data-range="${r.key}"></div>
        `;
        grid.appendChild(item);
        tarifaRangeInputs[storeKey][r.key] = item.querySelector('input');
      });
      tarifaRangosContainer.appendChild(grid);
    }

    buildGroup('Titular', titularRanges, 'titular');
    buildGroup('Familiares', familiaresRanges, 'familiares');
  }

  function setTarifaRangosData(titularData = {}, familiaresData = {}) {
    Object.entries(tarifaRangeInputs.titular).forEach(([key, input]) => {
      if (titularData && titularData[key] != null) input.value = titularData[key];
    });
    Object.entries(tarifaRangeInputs.familiares).forEach(([key, input]) => {
      if (familiaresData && familiaresData[key] != null) input.value = familiaresData[key];
    });
  }

  function getTarifaRangosData() {
    const titular = {};
    const familiares = {};
    Object.entries(tarifaRangeInputs.titular).forEach(([key, input]) => {
      if (input.value !== '') titular[key] = Number(input.value);
    });
    Object.entries(tarifaRangeInputs.familiares).forEach(([key, input]) => {
      if (input.value !== '') familiares[key] = Number(input.value);
    });
    return { titular, familiares };
  }

  function resetTarifaCoverageControls() {
    COVERAGE_LIST.forEach((def) => tarifaCoverageControls[def.key].setData(null));
    tarifaMaternidadControl.setData(null);
  }

  // plan: registro del plan (siempre requerido, fija el nombre no editable).
  // item: tarifa existente (null si aún no se ha registrado ninguna para el plan).
  // edit: true habilita los campos; readOnly: true fuerza "solo ver".
  function openTarifaModal({ plan, item = null, readOnly = false }) {
    // El modo "edición" (UPDATE vs INSERT) depende únicamente de si ya
    // existe una tarifa para este plan, nunca de un parámetro aparte.
    const edit = !!item;
    isEditModeTarifa = edit;
    isReadOnlyTarifa = readOnly;
    currentTarifaPlan = plan;
    currentTarifaItem = item;

    tarifaForm.reset();
    clearFeedback('tarifaFormFeedback');
    setFormControlsForcedDisabled(tarifaForm, false);

    resetTarifaCoverageControls();
    renderTarifaRangos(plan);

    tarifaPlanIdInput.value = plan.id;
    tarifaPlanNombreInput.value = plan.nombre_plan;

    if (item) {
      tarifaModalTitle.textContent = readOnly ? 'Ver Tarifa' : 'Editar Tarifa';
      submitTarifaBtn.textContent = 'Guardar Cambios';
      tarifaIdInput.value = item.id;
      setTarifaRangosData(item.tarifas_titular || {}, item.tarifas_familiares || {});

      const cob = item.coberturas || {};
      COVERAGE_LIST.forEach((def) => tarifaCoverageControls[def.key].setData(cob[def.key]));
      tarifaMaternidadControl.setData(item.maternidad || null);
    } else {
      tarifaModalTitle.textContent = 'Registrar Tarifa';
      submitTarifaBtn.textContent = 'Registrar';
      tarifaIdInput.value = '';
    }

    tarifaModalOverlay.querySelector('.modal').classList.toggle('modal--readonly', readOnly);
    submitTarifaBtn.style.display = readOnly ? 'none' : 'inline-flex';
    editTarifaBtn.style.display = readOnly ? 'inline-flex' : 'none';
    if (readOnly) setFormControlsForcedDisabled(tarifaForm, true);

    // El nombre del plan nunca es editable, ni siquiera en modo edición.
    tarifaPlanNombreInput.disabled = true;

    tarifaModalOverlay.classList.add('is-open');
  }

  // Punto de entrada desde el botón 💲 de cada plan en la tabla de Planes.
  function openTarifaModalForPlan(plan) {
    const item = allTarifas.find((t) => t.plan_id === plan.id) || null;
    if (item) {
      openTarifaModal({ plan, item, readOnly: true });
    } else {
      openTarifaModal({ plan, item: null, readOnly: false });
    }
  }

  function closeTarifaModal() {
    tarifaModalOverlay.classList.remove('is-open');
    tarifaForm.reset();
    currentTarifaPlan = null;
    currentTarifaItem = null;
  }

  editTarifaBtn.addEventListener('click', () => {
    if (!currentTarifaPlan) return;
    openTarifaModal({ plan: currentTarifaPlan, item: currentTarifaItem, readOnly: false });
  });
  tarifaModalCloseBtn.addEventListener('click', closeTarifaModal);
  cancelTarifaModalBtn.addEventListener('click', closeTarifaModal);
  tarifaModalOverlay.addEventListener('click', (e) => {
    if (e.target === tarifaModalOverlay) closeTarifaModal();
  });

  function validateTarifaForm() {
    return !!tarifaPlanIdInput.value;
  }

  async function loadTarifas() {
    if (!supabaseClient) return;
    try {
      const { data, error } = await supabaseClient.from(TABLE_TARIFAS).select('*');
      if (error) {
        console.error('Error al cargar tarifas:', getErrorMessage(error));
        return;
      }
      allTarifas = data || [];
    } catch (err) {
      console.error('No se pudo conectar con Supabase (tarifas):', getErrorMessage(err));
    }
  }

  tarifaForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isReadOnlyTarifa) return;
    clearFeedback('tarifaFormFeedback');

    if (!validateTarifaForm()) {
      showFeedback('tarifaFormFeedback', 'No se pudo determinar el plan de esta tarifa.', 'error');
      return;
    }
    if (!supabaseClient) {
      showFeedback('tarifaFormFeedback', 'No se pudo conectar con Supabase.', 'error');
      return;
    }

    submitTarifaBtn.disabled = true;
    submitTarifaBtn.textContent = isEditModeTarifa ? 'Guardando...' : 'Registrando...';

    const currentUser = getCurrentUserLabel();

    const coberturas = {};
    COVERAGE_LIST.forEach((def) => { coberturas[def.key] = tarifaCoverageControls[def.key].getData(); });
    const maternidad = tarifaMaternidadControl.getData();
    const { titular, familiares } = getTarifaRangosData();

    const payload = {
      plan_id: tarifaPlanIdInput.value,
      coberturas,
      maternidad,
      tarifas_titular: titular,
      tarifas_familiares: familiares,
    };

    if (isEditModeTarifa) {
      payload.usuario_modificacion = currentUser;
    } else {
      payload.usuario_creacion = currentUser;
      payload.usuario_modificacion = currentUser;
    }

    try {
      let error;
      if (isEditModeTarifa) {
        ({ error } = await supabaseClient.from(TABLE_TARIFAS).update(payload).eq('id', tarifaIdInput.value));
      } else {
        ({ error } = await supabaseClient.from(TABLE_TARIFAS).insert([payload]));
      }

      submitTarifaBtn.disabled = false;
      submitTarifaBtn.textContent = isEditModeTarifa ? 'Guardar Cambios' : 'Registrar';

      if (error) {
        const prefix = error.code === '23505' ? 'Ya existe una tarifa registrada para este plan.' : 'No se pudo guardar la tarifa.';
        showFeedback('tarifaFormFeedback', `${prefix} ${getErrorMessage(error)}`, 'error');
        return;
      }

      showFeedback('tarifaFormFeedback', isEditModeTarifa ? 'Tarifa actualizada correctamente.' : 'Tarifa registrada correctamente.', 'success');
      await loadTarifas();
      setTimeout(closeTarifaModal, 700);
    } catch (err) {
      submitTarifaBtn.disabled = false;
      submitTarifaBtn.textContent = isEditModeTarifa ? 'Guardar Cambios' : 'Registrar';
      showFeedback('tarifaFormFeedback', `No se pudo conectar con Supabase: ${getErrorMessage(err)}`, 'error');
    }
  });

  /* =========================================================
     TECLA ESCAPE (cierra modal o confirmación activa)
     ========================================================= */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (confirmOverlay.style.display === 'flex') { closeConfirmDialog(); return; }
    if (aseguradoraModalOverlay.classList.contains('is-open')) closeAseguradoraModal();
    if (productoModalOverlay.classList.contains('is-open')) closeProductoModal();
    if (planModalOverlay.classList.contains('is-open')) closePlanModal();
    if (tarifaModalOverlay.classList.contains('is-open')) closeTarifaModal();
  });

  /* =========================================================
     INICIO
     ========================================================= */
  updateSortIndicators(sortableHeadersAseguradoras, currentSortAseguradoras);
  updateSortIndicators(sortableHeadersProductos, currentSortProductos);
  updateSortIndicators(sortableHeadersPlanes, currentSortPlanes);
  await initSupabase();
  await loadAseguradoras();
  await loadProductos();
  await loadPlanes();
  await loadTarifas();
});
