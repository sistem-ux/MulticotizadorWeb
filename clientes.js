/* =============================================================
   CONFIGURACIÓN DE SUPABASE
   (Misma configuración que aseguradoras.js — Project Settings > API)
   ============================================================= */
const SUPABASE_URL = 'https://cibtpkpxdrykozujaqba.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_zlp4_HGpTeAQKW55c_pZQA_2HEXRpaC';
const TABLE_CLIENTES = 'clientes';

/* =============================================================
   CATÁLOGO FIJO: NACIONALIDAD -> LETRA PARA LA IDENTIFICACIÓN
   ============================================================= */
const NACIONALIDAD_LETRA = {
  'Venezolano': 'V',
  'Extranjero': 'E',
  'Jurídico': 'J',
  'Gubernamental': 'G',
  'Pasaporte': 'P',
  'Menor de Edad': 'M',
};

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
  Tabla esperada en Supabase (ver 04_schema_clientes.sql):
    - clientes (nacionalidad, nro_identificacion, identificacion, nombre_cliente,
      fecha_creacion, usuario_creacion, fecha_modificacion, usuario_modificacion)

  NOTA DE SEGURIDAD: al igual que en aseguradoras.js, esta pantalla consulta con
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

/* =============================================================
   FORMATEADOR DE TEXTO EN TIEMPO REAL: "Inicial De Cada Palabra"
   Mismo patrón usado en aseguradoras.js: soporta entrada en
   mayúsculas sostenidas y conserva la posición del cursor.
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
      inputEl.setSelectionRange(start, end);
    }
  });
}

/* =============================================================
   FORMATEADOR NUMÉRICO PURO (sin separadores): usado en
   Nro. Identificación. Filtra cualquier carácter que no sea
   dígito y conserva la posición del cursor.
   ============================================================= */
function digitsOnly(str) {
  return (str || '').toString().replace(/\D/g, '');
}

function attachNumericOnlyFormatter(inputEl) {
  inputEl.addEventListener('input', () => {
    const start = inputEl.selectionStart ?? inputEl.value.length;
    const digitsBeforeCursor = digitsOnly(inputEl.value.slice(0, start)).length;
    const filtered = digitsOnly(inputEl.value);
    inputEl.value = filtered;
    const pos = Math.min(digitsBeforeCursor, filtered.length);
    inputEl.setSelectionRange(pos, pos);
  });
  // Bloquea el pegado de contenido no numérico.
  inputEl.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text');
    document.execCommand('insertText', false, digitsOnly(text));
  });
}

document.addEventListener('DOMContentLoaded', async () => {

  /* =========================================================
     ESTADO GENERAL Y NOTIFICACIONES
     ========================================================= */
  let allClientes = [];
  let isEditModeCliente = false;
  let isReadOnlyCliente = false;
  let currentClienteItem = null;
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
  // modo "Ver" (solo lectura), igual que en Planes y Tarifas.
  function setFormControlsForcedDisabled(formEl, disabled) {
    formEl.querySelectorAll('input, select, textarea, button').forEach((el) => {
      if (el.type === 'button' && (el.classList.contains('btn--cancel') || el.id === 'editClienteBtn')) return;
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
     PESTAÑAS (por ahora solo "Clientes"; queda lista para más)
     ========================================================= */
  const tabButtons = document.querySelectorAll('.tab-btn');
  const panels = {
    clientes: document.getElementById('panelClientes'),
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
     ============================  CLIENTES  ===================================
     ========================================================================= */

  const searchClientes = document.getElementById('searchClientes');
  const clearSearchClientes = document.getElementById('clearSearchClientes');
  const clientesTableBody = document.getElementById('clientesTableBody');
  const clientesLoading = document.getElementById('clientesLoading');
  const clientesEmpty = document.getElementById('clientesEmpty');
  const openClienteModalBtn = document.getElementById('openClienteModalBtn');

  const clienteModalOverlay = document.getElementById('clienteModalOverlay');
  const clienteModalTitle = document.getElementById('clienteModalTitle');
  const clienteModalCloseBtn = document.getElementById('clienteModalCloseBtn');
  const cancelClienteModalBtn = document.getElementById('cancelClienteModalBtn');
  const editClienteBtn = document.getElementById('editClienteBtn');
  const clienteForm = document.getElementById('clienteForm');
  const clienteIdInput = document.getElementById('clienteId');
  const clienteNacionalidadSelect = document.getElementById('clienteNacionalidad');
  const clienteNroIdentificacionInput = document.getElementById('clienteNroIdentificacion');
  const clienteNombreInput = document.getElementById('clienteNombre');
  const clienteIdentificacionPreview = document.getElementById('clienteIdentificacionPreview');
  const submitClienteBtn = document.getElementById('submitClienteBtn');

  const fieldClienteNacionalidad = document.getElementById('fieldClienteNacionalidad');
  const fieldClienteNroIdentificacion = document.getElementById('fieldClienteNroIdentificacion');
  const fieldClienteNombre = document.getElementById('fieldClienteNombre');

  attachTitleCaseFormatter(clienteNombreInput);
  attachNumericOnlyFormatter(clienteNroIdentificacionInput);

  let currentSortClientes = { key: 'nombre_cliente', direction: 'asc' };
  const sortableHeadersClientes = document.querySelectorAll('#clientesTable th.is-sortable');

  /* =========================================================
     IDENTIFICACIÓN AUTOMÁTICA (Nacionalidad + Nro. Identificación)
     ========================================================= */
  function computeClienteIdentificacion() {
    const letra = NACIONALIDAD_LETRA[clienteNacionalidadSelect.value] || '';
    const numero = digitsOnly(clienteNroIdentificacionInput.value);
    if (!letra || !numero) return '';
    return `${letra}-${numero}`;
  }

  function updateClienteIdentificacionPreview() {
    const identificacion = computeClienteIdentificacion();
    clienteIdentificacionPreview.textContent = identificacion || 'Completa los campos para generar la identificación.';
  }

  [clienteNacionalidadSelect, clienteNroIdentificacionInput].forEach((el) => {
    el.addEventListener('input', updateClienteIdentificacionPreview);
    el.addEventListener('change', updateClienteIdentificacionPreview);
  });

  /* =========================================================
     MODAL: REGISTRAR / EDITAR / VER
     ========================================================= */
  function openClienteModal({ edit = false, item = null, readOnly = false } = {}) {
    isEditModeCliente = edit;
    isReadOnlyCliente = readOnly;
    currentClienteItem = item;

    clienteForm.reset();
    clearFeedback('clienteFormFeedback');
    [fieldClienteNacionalidad, fieldClienteNroIdentificacion, fieldClienteNombre].forEach((f) => setFieldError(f, false));
    setFormControlsForcedDisabled(clienteForm, false);

    if (item) {
      clienteModalTitle.textContent = readOnly ? 'Ver Cliente' : 'Editar Cliente';
      submitClienteBtn.textContent = 'Guardar Cambios';
      clienteIdInput.value = item.id;
      clienteNacionalidadSelect.value = item.nacionalidad || '';
      clienteNroIdentificacionInput.value = item.nro_identificacion || '';
      clienteNombreInput.value = item.nombre_cliente || '';
    } else {
      clienteModalTitle.textContent = 'Registrar Cliente';
      submitClienteBtn.textContent = 'Registrar';
      clienteIdInput.value = '';
    }

    updateClienteIdentificacionPreview();

    clienteModalOverlay.querySelector('.modal').classList.toggle('modal--readonly', readOnly);
    submitClienteBtn.style.display = readOnly ? 'none' : 'inline-flex';
    editClienteBtn.style.display = readOnly ? 'inline-flex' : 'none';
    if (readOnly) setFormControlsForcedDisabled(clienteForm, true);

    clienteModalOverlay.classList.add('is-open');
    if (!readOnly) clienteNacionalidadSelect.focus();
  }

  function closeClienteModal() {
    clienteModalOverlay.classList.remove('is-open');
    clienteForm.reset();
    currentClienteItem = null;
    updateClienteIdentificacionPreview();
  }

  openClienteModalBtn.addEventListener('click', () => openClienteModal({ edit: false }));
  clienteModalCloseBtn.addEventListener('click', closeClienteModal);
  cancelClienteModalBtn.addEventListener('click', closeClienteModal);
  clienteModalOverlay.addEventListener('click', (e) => {
    if (e.target === clienteModalOverlay) closeClienteModal();
  });
  editClienteBtn.addEventListener('click', () => {
    if (!currentClienteItem) return;
    openClienteModal({ edit: true, item: currentClienteItem, readOnly: false });
  });

  function validateClienteForm() {
    let valid = true;

    const nacionalidadOk = !!NACIONALIDAD_LETRA[clienteNacionalidadSelect.value];
    setFieldError(fieldClienteNacionalidad, !nacionalidadOk);
    if (!nacionalidadOk) valid = false;

    const numeroOk = digitsOnly(clienteNroIdentificacionInput.value).length > 0;
    setFieldError(fieldClienteNroIdentificacion, !numeroOk);
    if (!numeroOk) valid = false;

    const nombreOk = clienteNombreInput.value.trim().length >= 3;
    setFieldError(fieldClienteNombre, !nombreOk);
    if (!nombreOk) valid = false;

    return valid;
  }

  /* =========================================================
     TABLA: RENDER / ORDEN / BÚSQUEDA
     ========================================================= */
  function renderClientes(items) {
    clientesTableBody.innerHTML = '';
    if (!items.length) {
      clientesEmpty.style.display = 'block';
      return;
    }
    clientesEmpty.style.display = 'none';

    items.forEach((item) => {
      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td data-label="Cliente">${escapeHtml(item.nombre_cliente)}</td>
        <td data-label="Identificación"><span class="id-pill">${escapeHtml(item.identificacion)}</span></td>
        <td data-label="Nacionalidad">${escapeHtml(item.nacionalidad)}</td>
        <td data-label="Acciones" class="col-actions">
          <button type="button" class="action-btn action-btn--view" data-id="${item.id}" aria-label="Ver cliente">👁️</button>
          <button type="button" class="action-btn action-btn--polizas" data-id="${item.id}" aria-label="Ver pólizas del cliente">🗂️</button>
          <button type="button" class="action-btn action-btn--delete" data-id="${item.id}" aria-label="Eliminar cliente">🗑️</button>
        </td>
      `;
      clientesTableBody.appendChild(tr);

      tr.querySelector('.action-btn--view').addEventListener('click', () => {
        openClienteModal({ edit: true, item, readOnly: true });
      });
      // Redirige al módulo de Pólizas con la pestaña "Pólizas" ya filtrada
      // por este cliente (la pestaña Fracciones queda igual, sin filtrar,
      // para permitir consultas puntuales).
      tr.querySelector('.action-btn--polizas').addEventListener('click', () => {
        window.location.href = `polizas.html?cliente_id=${encodeURIComponent(item.id)}`;
      });
      tr.querySelector('.action-btn--delete').addEventListener('click', () => handleDeleteCliente(item.id));
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

  sortableHeadersClientes.forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sortKey;
      if (currentSortClientes.key === key) {
        currentSortClientes.direction = currentSortClientes.direction === 'asc' ? 'desc' : 'asc';
      } else {
        currentSortClientes = { key, direction: 'asc' };
      }
      updateSortIndicators(sortableHeadersClientes, currentSortClientes);
      applyFilterClientes();
    });
  });

  function applyFilterClientes() {
    const term = searchClientes.value.trim().toLowerCase();
    clearSearchClientes.classList.toggle('is-visible', term.length > 0);
    let result = allClientes;
    if (term) {
      result = result.filter((c) =>
        (c.nombre_cliente || '').toLowerCase().includes(term) ||
        (c.identificacion || '').toLowerCase().includes(term)
      );
    }
    result = sortItems(result, currentSortClientes.key, currentSortClientes.direction);
    renderClientes(result);
  }

  searchClientes.addEventListener('input', applyFilterClientes);
  clearSearchClientes.addEventListener('click', () => {
    searchClientes.value = '';
    applyFilterClientes();
    searchClientes.focus();
  });

  /* =========================================================
     CARGA / GUARDADO / ELIMINACIÓN
     ========================================================= */
  async function loadClientes() {
    clientesLoading.style.display = 'block';
    clientesEmpty.style.display = 'none';
    clientesTableBody.innerHTML = '';

    if (!supabaseClient) {
      clientesLoading.style.display = 'none';
      clientesEmpty.textContent = 'Supabase no está inicializado.';
      clientesEmpty.style.display = 'block';
      return;
    }

    try {
      const { data, error } = await supabaseClient
        .from(TABLE_CLIENTES)
        .select('*')
        .order('nombre_cliente', { ascending: true });

      clientesLoading.style.display = 'none';

      if (error) {
        clientesEmpty.textContent = `Error al cargar clientes: ${getErrorMessage(error)}`;
        clientesEmpty.style.display = 'block';
        return;
      }

      allClientes = data || [];
      applyFilterClientes();
    } catch (err) {
      clientesLoading.style.display = 'none';
      clientesEmpty.textContent = `No se pudo conectar con Supabase: ${getErrorMessage(err)}`;
      clientesEmpty.style.display = 'block';
    }
  }

  clienteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isReadOnlyCliente) return;
    clearFeedback('clienteFormFeedback');

    if (!validateClienteForm()) {
      showFeedback('clienteFormFeedback', 'Revisa los campos marcados antes de continuar.', 'error');
      return;
    }
    if (!supabaseClient) {
      showFeedback('clienteFormFeedback', 'No se pudo conectar con Supabase.', 'error');
      return;
    }

    submitClienteBtn.disabled = true;
    submitClienteBtn.textContent = isEditModeCliente ? 'Guardando...' : 'Registrando...';

    const currentUser = getCurrentUserLabel();
    const nacionalidad = clienteNacionalidadSelect.value;
    const nroIdentificacion = digitsOnly(clienteNroIdentificacionInput.value);
    const identificacion = `${NACIONALIDAD_LETRA[nacionalidad]}-${nroIdentificacion}`;

    const payload = {
      nacionalidad,
      nro_identificacion: nroIdentificacion,
      identificacion,
      nombre_cliente: clienteNombreInput.value.trim(),
    };

    if (isEditModeCliente) {
      payload.usuario_modificacion = currentUser;
    } else {
      payload.usuario_creacion = currentUser;
      payload.usuario_modificacion = currentUser;
    }

    try {
      let error;
      if (isEditModeCliente) {
        ({ error } = await supabaseClient.from(TABLE_CLIENTES).update(payload).eq('id', clienteIdInput.value));
      } else {
        ({ error } = await supabaseClient.from(TABLE_CLIENTES).insert([payload]));
      }

      submitClienteBtn.disabled = false;
      submitClienteBtn.textContent = isEditModeCliente ? 'Guardar Cambios' : 'Registrar';

      if (error) {
        const prefix = error.code === '23505' ? 'Ya existe un cliente registrado con esa identificación.' : 'No se pudo guardar el cliente.';
        showFeedback('clienteFormFeedback', `${prefix} ${getErrorMessage(error)}`, 'error');
        return;
      }

      showFeedback('clienteFormFeedback', isEditModeCliente ? 'Cliente actualizado correctamente.' : 'Cliente registrado correctamente.', 'success');
      await loadClientes();
      setTimeout(closeClienteModal, 700);
    } catch (err) {
      submitClienteBtn.disabled = false;
      submitClienteBtn.textContent = isEditModeCliente ? 'Guardar Cambios' : 'Registrar';
      showFeedback('clienteFormFeedback', `No se pudo guardar: ${getErrorMessage(err)}`, 'error');
    }
  });

  async function handleDeleteCliente(id) {
    const item = allClientes.find((c) => c.id === id);
    if (!item) return;

    const confirmed = await openConfirmDialog({
      title: 'Eliminar cliente',
      message: `¿Eliminar al cliente "${item.nombre_cliente}" (${item.identificacion})? Esta acción no se puede deshacer.`,
      acceptLabel: 'Eliminar',
    });
    if (!confirmed) return;

    try {
      // .select('id') tras el delete permite detectar si RLS bloqueó la
      // eliminación de forma silenciosa (mismo patrón que cotizaciones.js).
      const { data, error } = await supabaseClient.from(TABLE_CLIENTES).delete().eq('id', id).select('id');
      if (error) {
        showNotification('clientesNotification', `No se pudo eliminar: ${getErrorMessage(error)}`, 'error');
        return;
      }
      if (!data || !data.length) {
        showNotification('clientesNotification', 'No se pudo eliminar: la política de seguridad (RLS) bloqueó la operación.', 'error');
        return;
      }
      await loadClientes();
      showNotification('clientesNotification', 'Cliente eliminado correctamente.', 'success');
    } catch (err) {
      showNotification('clientesNotification', `No se pudo eliminar: ${getErrorMessage(err)}`, 'error');
    }
  }

  /* =========================================================
     TECLA ESCAPE (cierra modal o confirmación activa)
     ========================================================= */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (confirmOverlay.style.display === 'flex') { closeConfirmDialog(); return; }
    if (clienteModalOverlay.classList.contains('is-open')) closeClienteModal();
  });

  /* =========================================================
     INICIO
     ========================================================= */
  updateSortIndicators(sortableHeadersClientes, currentSortClientes);
  await initSupabase();
  await loadClientes();
});