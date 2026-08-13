/* =============================================================
   CONFIGURACIÓN DE SUPABASE
   (Misma configuración que clientes.js / aseguradoras.js — Project Settings > API)
   ============================================================= */
const SUPABASE_URL = 'https://cibtpkpxdrykozujaqba.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_zlp4_HGpTeAQKW55c_pZQA_2HEXRpaC';
const TABLE_RAMOS = 'ramos';

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
  Tabla esperada en Supabase (ver 20_schema_ramos.sql):
    - ramos (nombre_ramo, fecha_creacion, usuario_creacion,
      fecha_modificacion, usuario_modificacion)

  NOTA DE SEGURIDAD: al igual que en clientes.js, esta pantalla consulta con
  la clave anónima. El control de acceso real lo hace auth-guard.js en el
  cliente. Para producción se recomienda migrar a Supabase Auth y restringir
  RLS por auth.uid().
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

document.addEventListener('DOMContentLoaded', async () => {

  /* =========================================================
     ESTADO GENERAL Y NOTIFICACIONES
     ========================================================= */
  let allRamos = [];
  let isEditModeRamo = false;
  let isReadOnlyRamo = false;
  let currentRamoItem = null;
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

  // Fuerza deshabilitado de todos los controles del formulario para el
  // modo "Ver" (solo lectura), igual que en Clientes y Planes.
  function setFormControlsForcedDisabled(formEl, disabled) {
    formEl.querySelectorAll('input, select, textarea, button').forEach((el) => {
      if (el.type === 'button' && (el.classList.contains('btn--cancel') || el.id === 'editRamoBtn')) return;
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
     PESTAÑAS (por ahora solo "Ramos"; queda lista para más)
     ========================================================= */
  const tabButtons = document.querySelectorAll('.tab-btn');
  const panels = {
    ramos: document.getElementById('panelRamos'),
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
     ============================  RAMOS  ======================================
     ========================================================================= */

  const searchRamos = document.getElementById('searchRamos');
  const clearSearchRamos = document.getElementById('clearSearchRamos');
  const ramosTableBody = document.getElementById('ramosTableBody');
  const ramosLoading = document.getElementById('ramosLoading');
  const ramosEmpty = document.getElementById('ramosEmpty');
  const openRamoModalBtn = document.getElementById('openRamoModalBtn');

  const ramoModalOverlay = document.getElementById('ramoModalOverlay');
  const ramoModalTitle = document.getElementById('ramoModalTitle');
  const ramoModalCloseBtn = document.getElementById('ramoModalCloseBtn');
  const cancelRamoModalBtn = document.getElementById('cancelRamoModalBtn');
  const editRamoBtn = document.getElementById('editRamoBtn');
  const ramoForm = document.getElementById('ramoForm');
  const ramoIdInput = document.getElementById('ramoId');
  const ramoNombreInput = document.getElementById('ramoNombre');
  const submitRamoBtn = document.getElementById('submitRamoBtn');

  const fieldRamoNombre = document.getElementById('fieldRamoNombre');

  let currentSortRamos = { key: 'nombre_ramo', direction: 'asc' };
  const sortableHeadersRamos = document.querySelectorAll('#ramosTable th.is-sortable');

  /* =========================================================
     MODAL: REGISTRAR / EDITAR / VER
     ========================================================= */
  function openRamoModal({ edit = false, item = null, readOnly = false } = {}) {
    isEditModeRamo = edit;
    isReadOnlyRamo = readOnly;
    currentRamoItem = item;

    ramoForm.reset();
    clearFeedback('ramoFormFeedback');
    setFieldError(fieldRamoNombre, false);
    setFormControlsForcedDisabled(ramoForm, false);

    if (item) {
      ramoModalTitle.textContent = readOnly ? 'Ver Ramo' : 'Editar Ramo';
      submitRamoBtn.textContent = 'Guardar Cambios';
      ramoIdInput.value = item.id;
      ramoNombreInput.value = item.nombre_ramo || '';
    } else {
      ramoModalTitle.textContent = 'Registrar Ramo';
      submitRamoBtn.textContent = 'Registrar';
      ramoIdInput.value = '';
    }

    ramoModalOverlay.querySelector('.modal').classList.toggle('modal--readonly', readOnly);
    submitRamoBtn.style.display = readOnly ? 'none' : 'inline-flex';
    editRamoBtn.style.display = readOnly ? 'inline-flex' : 'none';
    if (readOnly) setFormControlsForcedDisabled(ramoForm, true);

    ramoModalOverlay.classList.add('is-open');
    if (!readOnly) ramoNombreInput.focus();
  }

  function closeRamoModal() {
    ramoModalOverlay.classList.remove('is-open');
    ramoForm.reset();
    currentRamoItem = null;
  }

  openRamoModalBtn.addEventListener('click', () => openRamoModal({ edit: false }));
  ramoModalCloseBtn.addEventListener('click', closeRamoModal);
  cancelRamoModalBtn.addEventListener('click', closeRamoModal);
  ramoModalOverlay.addEventListener('click', (e) => {
    if (e.target === ramoModalOverlay) closeRamoModal();
  });
  editRamoBtn.addEventListener('click', () => {
    if (!currentRamoItem) return;
    openRamoModal({ edit: true, item: currentRamoItem, readOnly: false });
  });

  function validateRamoForm() {
    let valid = true;

    const nombreOk = ramoNombreInput.value.trim().length >= 3;
    setFieldError(fieldRamoNombre, !nombreOk);
    if (!nombreOk) valid = false;

    return valid;
  }

  /* =========================================================
     TABLA: RENDER / ORDEN / BÚSQUEDA
     ========================================================= */
  function renderRamos(items) {
    ramosTableBody.innerHTML = '';
    if (!items.length) {
      ramosEmpty.style.display = 'block';
      return;
    }
    ramosEmpty.style.display = 'none';

    items.forEach((item) => {
      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td data-label="Ramo">${escapeHtml(item.nombre_ramo)}</td>
        <td data-label="Acciones" class="col-actions">
          <button type="button" class="action-btn action-btn--view" data-id="${item.id}" aria-label="Ver ramo">👁️</button>
          <button type="button" class="action-btn action-btn--delete" data-id="${item.id}" aria-label="Eliminar ramo">🗑️</button>
        </td>
      `;
      ramosTableBody.appendChild(tr);

      tr.querySelector('.action-btn--view').addEventListener('click', () => {
        openRamoModal({ edit: true, item, readOnly: true });
      });
      tr.querySelector('.action-btn--delete').addEventListener('click', () => handleDeleteRamo(item.id));
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

  sortableHeadersRamos.forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sortKey;
      if (currentSortRamos.key === key) {
        currentSortRamos.direction = currentSortRamos.direction === 'asc' ? 'desc' : 'asc';
      } else {
        currentSortRamos = { key, direction: 'asc' };
      }
      updateSortIndicators(sortableHeadersRamos, currentSortRamos);
      applyFilterRamos();
    });
  });

  function applyFilterRamos() {
    const term = searchRamos.value.trim().toLowerCase();
    clearSearchRamos.classList.toggle('is-visible', term.length > 0);
    let result = allRamos;
    if (term) {
      result = result.filter((r) => (r.nombre_ramo || '').toLowerCase().includes(term));
    }
    result = sortItems(result, currentSortRamos.key, currentSortRamos.direction);
    renderRamos(result);
  }

  searchRamos.addEventListener('input', applyFilterRamos);
  clearSearchRamos.addEventListener('click', () => {
    searchRamos.value = '';
    applyFilterRamos();
    searchRamos.focus();
  });

  /* =========================================================
     CARGA / GUARDADO / ELIMINACIÓN
     ========================================================= */
  async function loadRamos() {
    ramosLoading.style.display = 'block';
    ramosEmpty.style.display = 'none';
    ramosTableBody.innerHTML = '';

    if (!supabaseClient) {
      ramosLoading.style.display = 'none';
      ramosEmpty.textContent = 'Supabase no está inicializado.';
      ramosEmpty.style.display = 'block';
      return;
    }

    try {
      const { data, error } = await supabaseClient
        .from(TABLE_RAMOS)
        .select('*')
        .order('nombre_ramo', { ascending: true });

      ramosLoading.style.display = 'none';

      if (error) {
        ramosEmpty.textContent = `Error al cargar ramos: ${getErrorMessage(error)}`;
        ramosEmpty.style.display = 'block';
        return;
      }

      allRamos = data || [];
      applyFilterRamos();
    } catch (err) {
      ramosLoading.style.display = 'none';
      ramosEmpty.textContent = `No se pudo conectar con Supabase: ${getErrorMessage(err)}`;
      ramosEmpty.style.display = 'block';
    }
  }

  ramoForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isReadOnlyRamo) return;
    clearFeedback('ramoFormFeedback');

    if (!validateRamoForm()) {
      showFeedback('ramoFormFeedback', 'Revisa los campos marcados antes de continuar.', 'error');
      return;
    }
    if (!supabaseClient) {
      showFeedback('ramoFormFeedback', 'No se pudo conectar con Supabase.', 'error');
      return;
    }

    submitRamoBtn.disabled = true;
    submitRamoBtn.textContent = isEditModeRamo ? 'Guardando...' : 'Registrando...';

    const currentUser = getCurrentUserLabel();

    const payload = {
      nombre_ramo: ramoNombreInput.value.trim(),
    };

    if (isEditModeRamo) {
      payload.usuario_modificacion = currentUser;
    } else {
      payload.usuario_creacion = currentUser;
      payload.usuario_modificacion = currentUser;
    }

    try {
      let error;
      if (isEditModeRamo) {
        ({ error } = await supabaseClient.from(TABLE_RAMOS).update(payload).eq('id', ramoIdInput.value));
      } else {
        ({ error } = await supabaseClient.from(TABLE_RAMOS).insert([payload]));
      }

      submitRamoBtn.disabled = false;
      submitRamoBtn.textContent = isEditModeRamo ? 'Guardar Cambios' : 'Registrar';

      if (error) {
        const prefix = error.code === '23505' ? 'Ya existe un ramo registrado con ese nombre.' : 'No se pudo guardar el ramo.';
        showFeedback('ramoFormFeedback', `${prefix} ${getErrorMessage(error)}`, 'error');
        return;
      }

      showFeedback('ramoFormFeedback', isEditModeRamo ? 'Ramo actualizado correctamente.' : 'Ramo registrado correctamente.', 'success');
      await loadRamos();
      setTimeout(closeRamoModal, 700);
    } catch (err) {
      submitRamoBtn.disabled = false;
      submitRamoBtn.textContent = isEditModeRamo ? 'Guardar Cambios' : 'Registrar';
      showFeedback('ramoFormFeedback', `No se pudo guardar: ${getErrorMessage(err)}`, 'error');
    }
  });

  async function handleDeleteRamo(id) {
    const item = allRamos.find((r) => r.id === id);
    if (!item) return;

    const confirmed = await openConfirmDialog({
      title: 'Eliminar ramo',
      message: `¿Eliminar el ramo "${item.nombre_ramo}"? Esta acción no se puede deshacer.`,
      acceptLabel: 'Eliminar',
    });
    if (!confirmed) return;

    try {
      // .select('id') tras el delete permite detectar si RLS bloqueó la
      // eliminación de forma silenciosa (mismo patrón que clientes.js).
      const { data, error } = await supabaseClient.from(TABLE_RAMOS).delete().eq('id', id).select('id');
      if (error) {
        showNotification('ramosNotification', `No se pudo eliminar: ${getErrorMessage(error)}`, 'error');
        return;
      }
      if (!data || !data.length) {
        showNotification('ramosNotification', 'No se pudo eliminar: la política de seguridad (RLS) bloqueó la operación.', 'error');
        return;
      }
      await loadRamos();
      showNotification('ramosNotification', 'Ramo eliminado correctamente.', 'success');
    } catch (err) {
      showNotification('ramosNotification', `No se pudo eliminar: ${getErrorMessage(err)}`, 'error');
    }
  }

  /* =========================================================
     TECLA ESCAPE (cierra modal o confirmación activa)
     ========================================================= */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (confirmOverlay.style.display === 'flex') { closeConfirmDialog(); return; }
    if (ramoModalOverlay.classList.contains('is-open')) closeRamoModal();
  });

  /* =========================================================
     INICIO
     ========================================================= */
  updateSortIndicators(sortableHeadersRamos, currentSortRamos);
  await initSupabase();
  await loadRamos();
});
