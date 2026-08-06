/* =============================================================
   CONFIGURACIÓN DE SUPABASE
   (Misma configuración que usuarios.js — Project Settings > API)
   ============================================================= */
const SUPABASE_URL = 'https://cibtpkpxdrykozujaqba.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_zlp4_HGpTeAQKW55c_pZQA_2HEXRpaC';
const TABLE_ASEGURADORAS = 'aseguradoras';
const TABLE_PRODUCTOS = 'productos';
const LOGO_BUCKET = 'logos-aseguradoras';
const LOGO_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

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

      tr.innerHTML = `
        <td data-label="Aseguradora">
          ${item.logo_url
            ? `<img src="${escapeHtml(item.logo_url)}" class="logo-thumb" alt="" onerror="this.style.display='none'">`
            : `<span class="logo-placeholder-cell" aria-hidden="true">—</span>`}
          ${escapeHtml(item.nombre)}
        </td>
        <td data-label="Acciones" class="col-actions">
          <button type="button" class="action-btn action-btn--edit" data-id="${item.id}" aria-label="Editar aseguradora">✏️</button>
          <button type="button" class="action-btn action-btn--delete" data-id="${item.id}" aria-label="Eliminar aseguradora">🗑️</button>
        </td>
      `;
      aseguradorasTableBody.appendChild(tr);

      tr.querySelector('.action-btn--edit').addEventListener('click', () => {
        openAseguradoraModal({ edit: true, item });
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

      tr.innerHTML = `
        <td data-label="Producto">${escapeHtml(item.nombre)}</td>
        <td data-label="Aseguradora">${escapeHtml(aseguradoraNombre)}</td>
        <td data-label="Acciones" class="col-actions">
          <button type="button" class="action-btn action-btn--edit" data-id="${item.id}" aria-label="Editar producto">✏️</button>
          <button type="button" class="action-btn action-btn--delete" data-id="${item.id}" aria-label="Eliminar producto">🗑️</button>
        </td>
      `;
      productosTableBody.appendChild(tr);

      tr.querySelector('.action-btn--edit').addEventListener('click', () => {
        openProductoModal({ edit: true, item });
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
