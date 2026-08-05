/* =============================================================
   CONFIGURACIÓN DE SUPABASE
   (Misma configuración que usuarios.js — Project Settings > API)
   ============================================================= */
const SUPABASE_URL = 'https://cibtpkpxdrykozujaqba.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_zlp4_HGpTeAQKW55c_pZQA_2HEXRpaC';
const TABLE_ASEGURADORAS = 'aseguradoras';
const TABLE_PRODUCTOS = 'productos';

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
  Tablas esperadas en Supabase (ver 01_schema.sql):
    - aseguradoras (codigo, nombre, status_tarifa, ref_inicio, igtf, edad_minima,
      edad_maxima, financiamiento_usd, financiamiento_bs, status, logo_url)
    - productos (aseguradora_id -> aseguradoras.id, nombre, edad_minima, edad_maxima,
      status, mostrar_en_inicio, status_tarifa)

  NOTA DE SEGURIDAD: al igual que en usuarios.js, esta pantalla consulta con la
  clave anónima. Para producción se recomienda activar RLS y restringir
  escritura solo a usuarios autenticados con perfil Administrador.
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
  let allAseguradoras = [];
  let allProductos = [];
  let isEditModeAseguradora = false;
  let isEditModeProducto = false;
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

  /* =========================================================
     PESTAÑAS
     ========================================================= */
  const tabButtons = document.querySelectorAll('.tab-btn');
  const panels = {
    aseguradoras: document.getElementById('panelAseguradoras'),
    productos: document.getElementById('panelProductos'),
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
  const aseguradoraNombreInput = document.getElementById('aseguradoraNombre');
  const aseguradoraEdadMinInput = document.getElementById('aseguradoraEdadMin');
  const aseguradoraEdadMaxInput = document.getElementById('aseguradoraEdadMax');
  const aseguradoraStatusInput = document.getElementById('aseguradoraStatus');
  const aseguradoraStatusTarifaInput = document.getElementById('aseguradoraStatusTarifa');
  const aseguradoraRefInicioInput = document.getElementById('aseguradoraRefInicio');
  const aseguradoraIgtfInput = document.getElementById('aseguradoraIgtf');
  const aseguradoraFinUsdInput = document.getElementById('aseguradoraFinUsd');
  const aseguradoraFinBsInput = document.getElementById('aseguradoraFinBs');
  const aseguradoraLogoInput = document.getElementById('aseguradoraLogo');
  const submitAseguradoraBtn = document.getElementById('submitAseguradoraBtn');
  const editAseguradoraModalBtn = document.getElementById('editAseguradoraModalBtn');

  const fieldAseguradoraNombre = document.getElementById('fieldAseguradoraNombre');
  const fieldAseguradoraCodigo = document.getElementById('fieldAseguradoraCodigo');
  const fieldAseguradoraEdadMin = document.getElementById('fieldAseguradoraEdadMin');
  const fieldAseguradoraEdadMax = document.getElementById('fieldAseguradoraEdadMax');

  let currentSortAseguradoras = { key: 'nombre', direction: 'asc' };
  const sortableHeadersAseguradoras = document.querySelectorAll('#aseguradorasTable th.is-sortable');

  function aseguradoraFields() {
    return [aseguradoraNombreInput, aseguradoraEdadMinInput, aseguradoraEdadMaxInput,
      aseguradoraStatusInput, aseguradoraStatusTarifaInput, aseguradoraRefInicioInput,
      aseguradoraIgtfInput, aseguradoraFinUsdInput, aseguradoraFinBsInput, aseguradoraLogoInput];
  }

  function openAseguradoraModal({ edit = false, item = null, viewOnly = false } = {}) {
    isEditModeAseguradora = edit;
    aseguradoraForm.reset();
    clearFeedback('aseguradoraFormFeedback');
    [fieldAseguradoraNombre, fieldAseguradoraCodigo, fieldAseguradoraEdadMin, fieldAseguradoraEdadMax]
      .forEach((f) => setFieldError(f, false));

    if (item) {
      aseguradoraModalTitle.textContent = viewOnly ? 'Ver Aseguradora' : 'Editar Aseguradora';
      submitAseguradoraBtn.textContent = 'Guardar Cambios';
      aseguradoraIdInput.value = item.id;
      aseguradoraNombreInput.value = item.nombre || '';
      aseguradoraEdadMinInput.value = item.edad_minima ?? '';
      aseguradoraEdadMaxInput.value = item.edad_maxima ?? '';
      aseguradoraStatusInput.value = item.status || 'ACTIVO';
      aseguradoraStatusTarifaInput.value = item.status_tarifa || 'NO APLICA';
      aseguradoraRefInicioInput.value = item.ref_inicio || '';
      aseguradoraIgtfInput.checked = !!item.igtf;
      aseguradoraFinUsdInput.checked = !!item.financiamiento_usd;
      aseguradoraFinBsInput.checked = !!item.financiamiento_bs;
      aseguradoraLogoInput.value = item.logo_url || '';
    } else {
      aseguradoraModalTitle.textContent = 'Registrar Aseguradora';
      submitAseguradoraBtn.textContent = 'Registrar';
      aseguradoraIdInput.value = '';
      aseguradoraStatusInput.value = 'ACTIVO';
      aseguradoraStatusTarifaInput.value = 'NO APLICA';
    }

    const isViewMode = viewOnly && !!item;
    aseguradoraFields().forEach((f) => { f.disabled = isViewMode; });

    if (isViewMode) {
      submitAseguradoraBtn.style.display = 'none';
      editAseguradoraModalBtn.style.display = 'inline-flex';
    } else {
      submitAseguradoraBtn.style.display = 'inline-flex';
      editAseguradoraModalBtn.style.display = 'none';
    }

    aseguradoraModalOverlay.classList.add('is-open');
    aseguradoraNombreInput.focus();
  }

  function closeAseguradoraModal() {
    aseguradoraModalOverlay.classList.remove('is-open');
    aseguradoraForm.reset();
    aseguradoraFields().forEach((f) => { f.disabled = false; });
    submitAseguradoraBtn.style.display = 'inline-flex';
    editAseguradoraModalBtn.style.display = 'none';
  }

  openAseguradoraModalBtn.addEventListener('click', () => openAseguradoraModal({ edit: false }));
  editAseguradoraModalBtn.addEventListener('click', () => {
    isEditModeAseguradora = true;
    aseguradoraFields().forEach((f) => { f.disabled = false; });
    submitAseguradoraBtn.style.display = 'inline-flex';
    editAseguradoraModalBtn.style.display = 'none';
    submitAseguradoraBtn.textContent = 'Guardar Cambios';
  });
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


    const min = aseguradoraEdadMinInput.value === '' ? null : Number(aseguradoraEdadMinInput.value);
    const max = aseguradoraEdadMaxInput.value === '' ? null : Number(aseguradoraEdadMaxInput.value);
    const minOk = min === null || (min >= 0 && min <= 99);
    setFieldError(fieldAseguradoraEdadMin, !minOk);
    if (!minOk) valid = false;

    const maxOk = max === null || (max >= 0 && max <= 99 && (min === null || max >= min));
    setFieldError(fieldAseguradoraEdadMax, !maxOk);
    if (!maxOk) valid = false;

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
      const statusClass = item.status === 'ACTIVO' ? 'status-pill--activo' : 'status-pill--inactivo';
      const finParts = [];
      if (item.financiamiento_usd) finParts.push('USD');
      if (item.financiamiento_bs) finParts.push('Bs');
      const finText = finParts.length ? finParts.join(' / ') : '—';

      tr.innerHTML = `
        <td data-label="Compañía">
          ${item.logo_url ? `<img src="${escapeHtml(item.logo_url)}" class="logo-thumb" alt="" onerror="this.style.display='none'">` : ''}
          ${escapeHtml(item.nombre)}
        </td>
        <td data-label="Código">${escapeHtml(item.codigo)}</td>
        <td data-label="Edad Mín/Máx">${item.edad_minima ?? '—'} / ${item.edad_maxima ?? '—'}</td>
        <td data-label="Financiamiento">${finText}</td>
        <td data-label="Estado"><span class="status-pill ${statusClass}">${escapeHtml(item.status)}</span></td>
        <td data-label="Acciones" class="col-actions">
          <button type="button" class="action-btn action-btn--view" data-id="${item.id}" aria-label="Ver aseguradora">👁</button>
          <button type="button" class="action-btn action-btn--delete" data-id="${item.id}" aria-label="Eliminar aseguradora">🗑️</button>
        </td>
      `;
      aseguradorasTableBody.appendChild(tr);

      tr.querySelector('.action-btn--view').addEventListener('click', () => {
        openAseguradoraModal({ edit: false, item, viewOnly: true });
      });
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
      result = result.filter((a) =>
        a.nombre.toLowerCase().includes(term) || a.codigo.toLowerCase().includes(term));
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

    const payload = {
      nombre: aseguradoraNombreInput.value.trim().toUpperCase(),
      edad_minima: aseguradoraEdadMinInput.value === '' ? null : Number(aseguradoraEdadMinInput.value),
      edad_maxima: aseguradoraEdadMaxInput.value === '' ? null : Number(aseguradoraEdadMaxInput.value),
      status: aseguradoraStatusInput.value,
      status_tarifa: aseguradoraStatusTarifaInput.value,
      ref_inicio: aseguradoraRefInicioInput.value.trim() || null,
      igtf: aseguradoraIgtfInput.checked,
      financiamiento_usd: aseguradoraFinUsdInput.checked,
      financiamiento_bs: aseguradoraFinBsInput.checked,
      logo_url: aseguradoraLogoInput.value.trim() || null,
    };

    try {
      let error;
      if (isEditModeAseguradora) {
        ({ error } = await supabaseClient.from(TABLE_ASEGURADORAS).update(payload).eq('id', aseguradoraIdInput.value));
      } else {
        ({ error } = await supabaseClient.from(TABLE_ASEGURADORAS).insert([payload]));
      }

      submitAseguradoraBtn.disabled = false;
      submitAseguradoraBtn.textContent = isEditModeAseguradora ? 'Guardar Cambios' : 'Registrar';

      showFeedback('aseguradoraFormFeedback', isEditModeAseguradora ? 'Aseguradora actualizada correctamente.' : 'Aseguradora registrada correctamente.', 'success');
      await loadAseguradoras();
      setTimeout(closeAseguradoraModal, 700);
    } catch (err) {
      submitAseguradoraBtn.disabled = false;
      submitAseguradoraBtn.textContent = isEditModeAseguradora ? 'Guardar Cambios' : 'Registrar';
      showFeedback('aseguradoraFormFeedback', `No se pudo conectar con Supabase: ${getErrorMessage(err)}`, 'error');
    }
  });

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
  const productoEdadMinInput = document.getElementById('productoEdadMin');
  const productoEdadMaxInput = document.getElementById('productoEdadMax');
  const productoStatusInput = document.getElementById('productoStatus');
  const productoStatusTarifaInput = document.getElementById('productoStatusTarifa');
  const productoMostrarInicioInput = document.getElementById('productoMostrarInicio');
  const submitProductoBtn = document.getElementById('submitProductoBtn');
  const editProductoModalBtn = document.getElementById('editProductoModalBtn');

  const fieldProductoAseguradora = document.getElementById('fieldProductoAseguradora');
  const fieldProductoNombre = document.getElementById('fieldProductoNombre');
  const fieldProductoEdadMax = document.getElementById('fieldProductoEdadMax');

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
    return [productoAseguradoraSelect, productoNombreInput, productoEdadMinInput, productoEdadMaxInput,
      productoStatusInput, productoStatusTarifaInput, productoMostrarInicioInput];
  }

  function openProductoModal({ edit = false, item = null, viewOnly = false } = {}) {
    isEditModeProducto = edit;
    productoForm.reset();
    clearFeedback('productoFormFeedback');
    [fieldProductoAseguradora, fieldProductoNombre, fieldProductoEdadMax].forEach((f) => setFieldError(f, false));

    if (item) {
      productoModalTitle.textContent = viewOnly ? 'Ver Producto' : 'Editar Producto';
      submitProductoBtn.textContent = 'Guardar Cambios';
      productoIdInput.value = item.id;
      productoAseguradoraSelect.value = item.aseguradora_id;
      productoNombreInput.value = item.nombre || '';
      productoEdadMinInput.value = item.edad_minima ?? '';
      productoEdadMaxInput.value = item.edad_maxima ?? '';
      productoStatusInput.value = item.status || 'ACTIVO';
      productoStatusTarifaInput.value = item.status_tarifa || 'NO APLICA';
      productoMostrarInicioInput.checked = !!item.mostrar_en_inicio;
    } else {
      productoModalTitle.textContent = 'Registrar Producto';
      submitProductoBtn.textContent = 'Registrar';
      productoIdInput.value = '';
      productoStatusInput.value = 'ACTIVO';
      productoStatusTarifaInput.value = 'NO APLICA';
      productoMostrarInicioInput.checked = true;
    }

    const isViewMode = viewOnly && !!item;
    productoFields().forEach((f) => { f.disabled = isViewMode; });

    if (isViewMode) {
      submitProductoBtn.style.display = 'none';
      editProductoModalBtn.style.display = 'inline-flex';
    } else {
      submitProductoBtn.style.display = 'inline-flex';
      editProductoModalBtn.style.display = 'none';
    }

    productoModalOverlay.classList.add('is-open');
    productoNombreInput.focus();
  }

  function closeProductoModal() {
    productoModalOverlay.classList.remove('is-open');
    productoForm.reset();
    productoFields().forEach((f) => { f.disabled = false; });
    submitProductoBtn.style.display = 'inline-flex';
    editProductoModalBtn.style.display = 'none';
  }

  openProductoModalBtn.addEventListener('click', () => openProductoModal({ edit: false }));
  editProductoModalBtn.addEventListener('click', () => {
    isEditModeProducto = true;
    productoFields().forEach((f) => { f.disabled = false; });
    submitProductoBtn.style.display = 'inline-flex';
    editProductoModalBtn.style.display = 'none';
    submitProductoBtn.textContent = 'Guardar Cambios';
  });
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

    const min = productoEdadMinInput.value === '' ? 0 : Number(productoEdadMinInput.value);
    const max = productoEdadMaxInput.value === '' ? 99 : Number(productoEdadMaxInput.value);
    const maxOk = max >= min;
    setFieldError(fieldProductoEdadMax, !maxOk);
    if (!maxOk) valid = false;

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
      const statusClass = item.status === 'ACTIVO' ? 'status-pill--activo' : 'status-pill--inactivo';
      const aseguradoraNombre = item.aseguradoras?.nombre || allAseguradoras.find((a) => a.id === item.aseguradora_id)?.nombre || '—';

      tr.innerHTML = `
        <td data-label="Producto">${escapeHtml(item.nombre)}</td>
        <td data-label="Aseguradora">${escapeHtml(aseguradoraNombre)}</td>
        <td data-label="Edad Mín/Máx">${item.edad_minima ?? '—'} / ${item.edad_maxima ?? '—'}</td>
        <td data-label="Mostrar en Inicio">${item.mostrar_en_inicio ? 'Sí' : 'No'}</td>
        <td data-label="Estado"><span class="status-pill ${statusClass}">${escapeHtml(item.status)}</span></td>
        <td data-label="Acciones" class="col-actions">
          <button type="button" class="action-btn action-btn--view" data-id="${item.id}" aria-label="Ver producto">👁</button>
          <button type="button" class="action-btn action-btn--delete" data-id="${item.id}" aria-label="Eliminar producto">🗑️</button>
        </td>
      `;
      productosTableBody.appendChild(tr);

      tr.querySelector('.action-btn--view').addEventListener('click', () => {
        openProductoModal({ edit: false, item, viewOnly: true });
      });
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

    const payload = {
      aseguradora_id: productoAseguradoraSelect.value,
      nombre: productoNombreInput.value.trim().toUpperCase(),
      edad_minima: productoEdadMinInput.value === '' ? 0 : Number(productoEdadMinInput.value),
      edad_maxima: productoEdadMaxInput.value === '' ? 99 : Number(productoEdadMaxInput.value),
      status: productoStatusInput.value,
      status_tarifa: productoStatusTarifaInput.value,
      mostrar_en_inicio: productoMostrarInicioInput.checked,
    };

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

  /* =========================================================
     TECLA ESCAPE (cierra modal o confirmación activa)
     ========================================================= */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (confirmOverlay.style.display === 'flex') { closeConfirmDialog(); return; }
    if (aseguradoraModalOverlay.classList.contains('is-open')) closeAseguradoraModal();
    if (productoModalOverlay.classList.contains('is-open')) closeProductoModal();
  });

  /* =========================================================
     INICIO
     ========================================================= */
  updateSortIndicators(sortableHeadersAseguradoras, currentSortAseguradoras);
  updateSortIndicators(sortableHeadersProductos, currentSortProductos);
  await initSupabase();
  await loadAseguradoras();
  await loadProductos();
});
