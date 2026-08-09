/* =============================================================
   CONFIGURACIÓN DE SUPABASE
   Reemplaza estos valores por los de tu proyecto
   (Project Settings > API en tu panel de Supabase).
   ============================================================= */
const SUPABASE_URL = 'https://cibtpkpxdrykozujaqba.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_zlp4_HGpTeAQKW55c_pZQA_2HEXRpaC';
const TABLE_USUARIOS = 'usuarios';
const TABLE_PERFILES = 'perfiles';
const TABLE_SUCURSALES = 'sucursales';

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
    const usersEmpty = document.getElementById('usersEmpty');
    if (usersEmpty) {
      usersEmpty.textContent = `No se pudo cargar Supabase: ${getErrorMessage(err)}`;
      usersEmpty.style.display = 'block';
    }
  }
}

/*
  Estructura de tablas esperada en Supabase (ver 14_creacion_perfiles_sucursales.sql
  y 16_migracion_usuarios_columnas.sql):

  usuarios:
    id, full_name, email, password,
    perfil (texto, retrocompatible con auth-guard.js),
    perfil_id (uuid -> perfiles.id), sucursal_id (uuid -> sucursales.id),
    status ('Activo' | 'Inactivo'),
    fecha_creacion, usuario_creacion, fecha_modificacion, usuario_modificacion

  perfiles / sucursales:
    id, perfil / sucursal (texto), status,
    fecha_creacion, usuario_creacion, fecha_modificacion, usuario_modificacion

  La columna `perfil` (texto) es la que usa principal.html para identificar el
  rol del usuario al iniciar sesión, y auth-guard.js para decidir qué páginas
  puede ver (PAGE_PERMISSIONS). Se mantiene por retrocompatibilidad: este panel
  ahora guarda tanto `perfil_id` (nueva fuente de verdad normalizada) como
  `perfil` (el nombre en texto), en cada alta/edición de usuario.

  NOTA DE SEGURIDAD:
  Guardar contraseñas en texto plano y consultarlas desde el cliente (anon key)
  no es una práctica segura para producción. Lo ideal es:
    1) Activar Row Level Security (RLS) en esta tabla.
    2) Mover la validación de login a una función RPC de Postgres que reciba
       email/password y devuelva solo el perfil, sin exponer la contraseña.
    3) O migrar por completo a Supabase Auth + una tabla `profiles` con el perfil.
  Este ejemplo las guarda y consulta directamente para mantener el alcance
  original del requerimiento.
*/

/* =============================================================
   HELPERS GLOBALES (compartidos por Usuarios, Perfiles y Sucursales)
   ============================================================= */
function getErrorMessage(error) {
  if (!error) return 'Error desconocido.';
  if (typeof error === 'string') return error;

  const parts = [];
  if (error.message) parts.push(error.message);
  if (error.status) parts.push(`status ${error.status}`);
  if (error.statusText) parts.push(error.statusText);
  if (error.code) parts.push(`code ${error.code}`);
  if (error.details) parts.push(error.details);
  if (error.hint) parts.push(error.hint);

  const text = parts.filter(Boolean).join(' | ');
  return text || JSON.stringify(error);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function formatDateTime(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('es-VE', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(value);
  }
}

/* Formateo "tipo oración": inicial de cada palabra en mayúscula
   (usado en Nombres y Apellidos, Perfil y Sucursal) */
function toTitleCaseLive(value) {
  return value
    .toLowerCase()
    .replace(/(^|\s|['-])([a-záéíóúñü])/g, (m, sep, letter) => sep + letter.toUpperCase());
}

function attachTitleCaseFormatter(inputEl) {
  inputEl.addEventListener('input', (e) => {
    const input = e.target;
    const cursorPos = input.selectionStart;
    const originalLength = input.value.length;

    const formatted = toTitleCaseLive(input.value);
    input.value = formatted;

    const diff = formatted.length - originalLength;
    input.setSelectionRange(cursorPos + diff, cursorPos + diff);
  });
}

/* Usuario actual (auditoría) — viene de auth-guard.js */
function getCurrentUserLabel() {
  if (typeof getSession !== 'function') return null;
  const session = getSession();
  return session?.fullName || session?.email || null;
}

document.addEventListener('DOMContentLoaded', async () => {

  /* =========================================================
     ESTADO GENERAL Y CONFIRMACIÓN COMPARTIDA
     ========================================================= */
  let allUsers = [];
  let allPerfiles = [];
  let allSucursales = [];
  let confirmResolve = null;
  const notificationTimers = {};

  function showPageNotification(elementId, message, type = 'success', duration = 3500) {
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

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (confirmOverlay?.style.display === 'flex') { closeConfirmDialog(); return; }
    [userModalOverlay, perfilModalOverlay, sucursalModalOverlay].forEach((ov) => {
      if (ov?.classList.contains('is-open')) ov.classList.remove('is-open');
    });
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
     PESTAÑAS
     ========================================================= */
  const tabButtons = document.querySelectorAll('.tab-btn');
  const panels = {
    usuarios: document.getElementById('panelUsuarios'),
    perfiles: document.getElementById('panelPerfiles'),
    sucursales: document.getElementById('panelSucursales'),
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
     =============================  USUARIOS  ===================================
     ========================================================================= */

  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const usersTableBody = document.getElementById('usersTableBody');
  const usersLoading = document.getElementById('usersLoading');
  const usersEmpty = document.getElementById('usersEmpty');

  const openModalBtn = document.getElementById('openModalBtn');
  const userModalOverlay = document.getElementById('userModalOverlay');
  const modalTitle = document.getElementById('modalTitle');
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  const cancelModalBtn = document.getElementById('cancelModalBtn');
  const userForm = document.getElementById('userForm');
  const userIdInput = document.getElementById('userId');
  const sucursalSelect = document.getElementById('sucursalSelect');
  const ejecutivoSelect = document.getElementById('ejecutivoSelect');
  const ejecutivoHint = document.getElementById('ejecutivoHint');
  const fullNameInput = document.getElementById('fullName');
  const emailInput = document.getElementById('email');
  const telefonoInput = document.getElementById('telefono');
  const perfilInput = document.getElementById('perfil');
  const passwordInput = document.getElementById('password');
  const togglePasswordBtn = document.getElementById('togglePasswordBtn');
  const submitBtn = document.getElementById('submitBtn');
  const formFeedback = document.getElementById('formFeedback');

  const fieldSucursal = document.getElementById('fieldSucursal');
  const fieldEjecutivo = document.getElementById('fieldEjecutivo');
  const fieldFullName = document.getElementById('fieldFullName');
  const fieldEmail = document.getElementById('fieldEmail');
  const fieldTelefono = document.getElementById('fieldTelefono');
  const fieldPerfil = document.getElementById('fieldPerfil');
  const fieldPassword = document.getElementById('fieldPassword');

  const userViewDetail = document.getElementById('userViewDetail');
  const userViewId = document.getElementById('userViewId');
  const userViewStatus = document.getElementById('userViewStatus');
  const userViewFechaCreacion = document.getElementById('userViewFechaCreacion');
  const userViewUsuarioCreacion = document.getElementById('userViewUsuarioCreacion');
  const userViewFechaModificacion = document.getElementById('userViewFechaModificacion');
  const userViewUsuarioModificacion = document.getElementById('userViewUsuarioModificacion');

  const sortableHeaders = document.querySelectorAll('#usersTable th.is-sortable');

  let isEditMode = false;
  let isReadOnlyUser = false;
  let currentSort = { key: 'full_name', direction: 'asc' };

  attachTitleCaseFormatter(fullNameInput);

  // Cuando el perfil es Administrador o Colaborador, el "Ejecutivo" mostrado
  // es el propio nombre del usuario: si lo edita en vivo, se refleja también
  // en la opción (aunque el campo permanezca no editable).
  fullNameInput.addEventListener('input', () => {
    const perfilSeleccionado = allPerfiles.find((p) => p.id === perfilInput.value);
    const perfilNombre = perfilSeleccionado ? perfilSeleccionado.perfil : '';
    if (perfilNombre === 'Administrador' || perfilNombre === 'Colaborador') {
      refreshEjecutivoField();
    }
  });

  /* Correo: solo minúsculas */
  emailInput.addEventListener('input', (e) => {
    const input = e.target;
    const cursorPos = input.selectionStart;
    const lower = input.value.toLowerCase();
    if (lower !== input.value) {
      input.value = lower;
      input.setSelectionRange(cursorPos, cursorPos);
    }
  });

  sucursalSelect.addEventListener('change', () => {
    if (sucursalSelect.value) fieldSucursal.classList.remove('has-error');
    refreshEjecutivoField();
  });

  /* Teléfono: solo dígitos, espacios, +, -, paréntesis */
  telefonoInput.addEventListener('input', (e) => {
    const input = e.target;
    const cursorPos = input.selectionStart;
    const cleaned = input.value.replace(/[^0-9+\-\s()]/g, '');
    if (cleaned !== input.value) {
      input.value = cleaned;
      input.setSelectionRange(cursorPos - 1, cursorPos - 1);
    }
    if (TELEFONO_REGEX.test(input.value.trim()) || input.value.trim() === '') {
      fieldTelefono.classList.remove('has-error');
    }
  });

  perfilInput.addEventListener('change', () => {
    if (perfilInput.value) fieldPerfil.classList.remove('has-error');
    refreshEjecutivoField();
  });

  /* Contraseña: mostrar / ocultar */
  togglePasswordBtn.addEventListener('click', () => {
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    togglePasswordBtn.textContent = isPassword ? '🙈' : '👁';
    togglePasswordBtn.setAttribute('aria-label', isPassword ? 'Ocultar contraseña' : 'Mostrar contraseña');
  });

  const EMAIL_REGEX = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/;
  const TELEFONO_REGEX = /^[0-9+\-\s()]{7,20}$/;
  const PASSWORD_REGEX = /^[A-Za-z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]{8,}$/;

  function validateForm() {
    let valid = true;

    const sucursalOk = sucursalSelect.value.trim().length > 0;
    setFieldError(fieldSucursal, !sucursalOk);
    if (!sucursalOk) valid = false;

    const nameOk = fullNameInput.value.trim().length >= 3;
    setFieldError(fieldFullName, !nameOk);
    if (!nameOk) valid = false;

    const emailOk = EMAIL_REGEX.test(emailInput.value.trim());
    setFieldError(fieldEmail, !emailOk);
    if (!emailOk) valid = false;

    // Teléfono es opcional: solo se valida el formato si el usuario escribió algo.
    const telefonoValue = telefonoInput.value.trim();
    const telefonoOk = telefonoValue === '' || TELEFONO_REGEX.test(telefonoValue);
    setFieldError(fieldTelefono, !telefonoOk);
    if (!telefonoOk) valid = false;

    const perfilOk = perfilInput.value.trim().length > 0;
    setFieldError(fieldPerfil, !perfilOk);
    if (!perfilOk) valid = false;

    // "Ejecutivo" solo es obligatorio a elegir cuando el perfil es Asesor;
    // para Administrador/Colaborador se autocompleta (propio nombre) y no
    // se valida como selección del usuario.
    const perfilSeleccionadoValidacion = allPerfiles.find((p) => p.id === perfilInput.value);
    const perfilNombreValidacion = perfilSeleccionadoValidacion ? perfilSeleccionadoValidacion.perfil : '';
    if (perfilNombreValidacion === 'Asesor') {
      const ejecutivoOk = ejecutivoSelect.value.trim().length > 0;
      setFieldError(fieldEjecutivo, !ejecutivoOk);
      if (!ejecutivoOk) valid = false;
    } else {
      setFieldError(fieldEjecutivo, false);
    }

    const passwordOk = PASSWORD_REGEX.test(passwordInput.value);
    setFieldError(fieldPassword, !passwordOk);
    if (!passwordOk) valid = false;

    return valid;
  }

  /* Listas desplegables de Sucursal y Perfil (solo registros Activos) */
  function populateSucursalSelect(selectedId) {
    const previous = selectedId ?? sucursalSelect.value;
    sucursalSelect.innerHTML = '<option value="">Selecciona una sucursal</option>';
    allSucursales
      .filter((s) => s.status === 'Activo')
      .forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.sucursal;
        sucursalSelect.appendChild(opt);
      });
    if (previous) sucursalSelect.value = previous;
  }

  function populatePerfilSelect(selectedId) {
    const previous = selectedId ?? perfilInput.value;
    perfilInput.innerHTML = '<option value="">Selecciona un perfil</option>';
    allPerfiles
      .filter((p) => p.status === 'Activo')
      .forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.perfil;
        perfilInput.appendChild(opt);
      });
    if (previous) perfilInput.value = previous;
  }

  /* =========================================================
     LISTA "EJECUTIVO" (después de Sucursal)
     Depende del perfil seleccionado:
       - Administrador / Colaborador: campo no editable, se autocompleta
         con el propio nombre del usuario (es su propio ejecutivo).
       - Asesor: lista de Colaboradores Activos de la MISMA sucursal
         elegida en el campo Sucursal.
       - Cualquier otro perfil (o ninguno aún): no aplica, campo deshabilitado.
     ========================================================= */
  function refreshEjecutivoField(selectedId) {
    const previous = selectedId ?? ejecutivoSelect.dataset.pendingValue ?? ejecutivoSelect.value;
    const perfilSeleccionado = allPerfiles.find((p) => p.id === perfilInput.value);
    const perfilNombre = perfilSeleccionado ? perfilSeleccionado.perfil : '';

    ejecutivoSelect.innerHTML = '';
    setFieldError(fieldEjecutivo, false);

    if (perfilNombre === 'Administrador' || perfilNombre === 'Colaborador') {
      const opt = document.createElement('option');
      opt.value = 'self';
      opt.textContent = fullNameInput.value.trim() || '(Nombre del propio usuario)';
      ejecutivoSelect.appendChild(opt);
      ejecutivoSelect.value = 'self';
      ejecutivoSelect.disabled = true;
      ejecutivoHint.textContent = 'Este perfil es su propio ejecutivo; el campo no es editable.';
      return;
    }

    if (perfilNombre === 'Asesor') {
      ejecutivoSelect.disabled = false;
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Selecciona un ejecutivo';
      ejecutivoSelect.appendChild(placeholder);

      const sucursalId = sucursalSelect.value;
      if (!sucursalId) {
        ejecutivoSelect.disabled = true;
        ejecutivoHint.textContent = 'Primero selecciona la sucursal del usuario.';
        return;
      }

      const colaboradores = allUsers.filter((u) => {
        const perfilU = u.perfiles?.perfil || u.perfil || '';
        return perfilU === 'Colaborador' && u.sucursal_id === sucursalId && (u.status || 'Activo') === 'Activo';
      });

      colaboradores.forEach((u) => {
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = u.full_name;
        ejecutivoSelect.appendChild(opt);
      });

      ejecutivoHint.textContent = colaboradores.length > 0
        ? 'Solo se listan los colaboradores Activos de la sucursal seleccionada.'
        : 'No hay colaboradores Activos registrados en esa sucursal.';

      if (previous) ejecutivoSelect.value = previous;
      return;
    }

    // Ningún perfil seleccionado, o un perfil distinto (p. ej. Visitante): no aplica.
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No aplica para este perfil';
    ejecutivoSelect.appendChild(opt);
    ejecutivoSelect.disabled = true;
    ejecutivoHint.textContent = 'El ejecutivo se determina automáticamente según el perfil seleccionado.';
  }

  /* =========================================================
     MODAL: abrir / cerrar
     ========================================================= */
  function openModal({ edit = false, user = null, viewOnly = false } = {}) {
    isEditMode = edit;
    isReadOnlyUser = viewOnly;
    userForm.reset();
    clearFeedback('formFeedback');
    [fieldSucursal, fieldFullName, fieldEmail, fieldTelefono, fieldPerfil, fieldPassword, fieldEjecutivo].forEach((f) => setFieldError(f, false));

    populateSucursalSelect();
    populatePerfilSelect();

    if (user) {
      modalTitle.textContent = viewOnly ? 'Ver Usuario' : 'Editar Usuario';
      submitBtn.textContent = 'Guardar Cambios';
      userIdInput.value = user.id;
      sucursalSelect.value = user.sucursal_id || '';
      fullNameInput.value = user.full_name;
      emailInput.value = user.email;
      telefonoInput.value = user.telefono || '';
      perfilInput.value = user.perfil_id || '';
      passwordInput.value = user.password;

      userViewId.textContent = user.id;
      userViewStatus.textContent = user.status || 'Activo';
      userViewFechaCreacion.textContent = formatDateTime(user.fecha_creacion);
      userViewUsuarioCreacion.textContent = user.usuario_creacion || '—';
      userViewFechaModificacion.textContent = formatDateTime(user.fecha_modificacion);
      userViewUsuarioModificacion.textContent = user.usuario_modificacion || '—';
    } else {
      modalTitle.textContent = 'Registrar Usuario';
      submitBtn.textContent = 'Registrar';
      userIdInput.value = '';
      sucursalSelect.value = '';
      perfilInput.value = '';
    }

    // El campo "Ejecutivo" depende del perfil (y de la sucursal, si es
    // Asesor), así que se calcula siempre después de fijar esos valores.
    // Para Administrador/Colaborador no importa lo que traiga la BD: el
    // propio refreshEjecutivoField() lo autocompleta con el nombre propio.
    refreshEjecutivoField(user ? user.ejecutivo_id : '');

    const fields = [sucursalSelect, fullNameInput, emailInput, telefonoInput, perfilInput, passwordInput];
    fields.forEach((field) => { field.disabled = viewOnly; });
    if (viewOnly) ejecutivoSelect.disabled = true;

    userViewDetail.style.display = viewOnly ? 'flex' : 'none';
    submitBtn.style.display = viewOnly ? 'none' : 'inline-flex';

    userModalOverlay.classList.add('is-open');
    if (!viewOnly) fullNameInput.focus();
  }

  function closeModal() {
    userModalOverlay.classList.remove('is-open');
    userForm.reset();
    [sucursalSelect, fullNameInput, emailInput, telefonoInput, perfilInput, passwordInput].forEach((field) => { field.disabled = false; });
    submitBtn.style.display = 'inline-flex';
    userViewDetail.style.display = 'none';
  }

  openModalBtn.addEventListener('click', () => openModal({ edit: false }));
  modalCloseBtn.addEventListener('click', closeModal);
  cancelModalBtn.addEventListener('click', closeModal);
  userModalOverlay.addEventListener('click', (e) => {
    if (e.target === userModalOverlay) closeModal();
  });

  /* =========================================================
     RENDER DE LA TABLA
     ========================================================= */
  function renderUsers(users) {
    usersTableBody.innerHTML = '';

    if (!users.length) {
      usersEmpty.style.display = 'block';
      return;
    }
    usersEmpty.style.display = 'none';

    users.forEach((user) => {
      const sucursalNombre = user.sucursales?.sucursal || '—';
      const perfilNombre = user.perfiles?.perfil || user.perfil || '—';
      const isActivo = (user.status || 'Activo') === 'Activo';
      const statusClass = isActivo ? 'status-pill--activo' : 'status-pill--inactivo';
      const toggleIcon = isActivo ? '✕' : '✓';
      const toggleClass = isActivo ? 'action-btn--toggle-on' : 'action-btn--toggle-off';
      const toggleLabel = isActivo ? 'Inactivar usuario' : 'Activar usuario';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Nombres y Apellidos">${escapeHtml(user.full_name)}</td>
        <td data-label="Correo">${escapeHtml(user.email)}</td>
        <td data-label="Teléfono">${escapeHtml(user.telefono || '—')}</td>
        <td data-label="Sucursal">${escapeHtml(sucursalNombre)}</td>
        <td data-label="Perfil">${escapeHtml(perfilNombre)}</td>
        <td data-label="Status"><span class="status-pill ${statusClass}">${escapeHtml(user.status || 'Activo')}</span></td>
        <td data-label="Acciones" class="col-actions">
          <button type="button" class="action-btn action-btn--edit" data-id="${user.id}" aria-label="Editar usuario">✏️</button>
          <button type="button" class="action-btn action-btn--view" data-id="${user.id}" aria-label="Ver usuario">👁️</button>
          <button type="button" class="action-btn ${toggleClass}" data-id="${user.id}" aria-label="${toggleLabel}">${toggleIcon}</button>
          <button type="button" class="action-btn action-btn--delete" data-id="${user.id}" aria-label="Eliminar usuario">🗑️</button>
        </td>
      `;
      usersTableBody.appendChild(tr);

      tr.querySelector('.action-btn--edit').addEventListener('click', () => {
        openModal({ edit: true, user, viewOnly: false });
      });
      tr.querySelector('.action-btn--view').addEventListener('click', () => {
        openModal({ edit: true, user, viewOnly: true });
      });
      tr.querySelector(`.${toggleClass}`).addEventListener('click', () => handleToggleStatusUser(user));
      tr.querySelector('.action-btn--delete').addEventListener('click', () => handleDelete(user.id));
    });
  }

  /* =========================================================
     ORDENAMIENTO Y BÚSQUEDA
     ========================================================= */
  sortableHeaders.forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sortKey;
      if (currentSort.key === key) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        currentSort = { key, direction: 'asc' };
      }
      updateSortIndicators(sortableHeaders, currentSort);
      applyFilter();
    });
  });

  function applyFilter() {
    const term = searchInput.value.trim().toLowerCase();
    clearSearchBtn.classList.toggle('is-visible', term.length > 0);

    let result = allUsers;

    if (term) {
      result = result.filter((user) =>
        user.full_name.toLowerCase().includes(term) ||
        user.email.toLowerCase().includes(term) ||
        (user.telefono || '').toLowerCase().includes(term) ||
        (user.perfiles?.perfil || user.perfil || '').toLowerCase().includes(term) ||
        (user.sucursales?.sucursal || '').toLowerCase().includes(term)
      );
    }

    result = sortItems(result, currentSort.key, currentSort.direction);
    renderUsers(result);
  }

  searchInput.addEventListener('input', applyFilter);
  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    applyFilter();
    searchInput.focus();
  });

  /* =========================================================
     SUPABASE: CARGAR USUARIOS (con nombre de sucursal y perfil embebidos)
     ========================================================= */
  async function loadUsers() {
    usersLoading.style.display = 'block';
    usersEmpty.style.display = 'none';
    usersTableBody.innerHTML = '';

    if (!supabaseClient) {
      usersLoading.style.display = 'none';
      usersEmpty.textContent = 'Supabase no está inicializado. Verifica la importación de la librería y la clave.';
      usersEmpty.style.display = 'block';
      return;
    }

    try {
      const { data, error } = await supabaseClient
        .from(TABLE_USUARIOS)
        .select('*, perfiles:perfil_id(perfil), sucursales:sucursal_id(sucursal)')
        .order('full_name', { ascending: true });

      usersLoading.style.display = 'none';

      if (error) {
        console.error('Error al cargar usuarios:', error);
        usersEmpty.textContent = `Error al cargar usuarios: ${getErrorMessage(error)}`;
        usersEmpty.style.display = 'block';
        return;
      }

      allUsers = data || [];
      applyFilter();
    } catch (err) {
      usersLoading.style.display = 'none';
      console.error('Excepción al cargar usuarios:', err);
      usersEmpty.textContent = `No se pudo conectar con Supabase: ${getErrorMessage(err)}`;
      usersEmpty.style.display = 'block';
    }
  }

  /* =========================================================
     SUPABASE: REGISTRAR / EDITAR (UPSERT)
     ========================================================= */
  userForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFeedback('formFeedback');

    if (isReadOnlyUser) return;

    if (!validateForm()) {
      showFeedback('formFeedback', 'Revisa los campos marcados antes de continuar.', 'error');
      return;
    }

    if (!supabaseClient) {
      showFeedback('formFeedback', 'No se pudo conectar con Supabase. Verifica la librería y la configuración.', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = isEditMode ? 'Guardando...' : 'Registrando...';

    const currentUser = getCurrentUserLabel();
    const perfilSeleccionado = allPerfiles.find((p) => p.id === perfilInput.value);
    const perfilNombreSeleccionado = perfilSeleccionado ? perfilSeleccionado.perfil : '';

    // "Ejecutivo": Administrador/Colaborador son su propio ejecutivo
    // (se autorreferencia); Asesor usa el colaborador elegido en el select;
    // cualquier otro perfil no aplica y queda en null.
    const esAutoEjecutivo = perfilNombreSeleccionado === 'Administrador' || perfilNombreSeleccionado === 'Colaborador';
    let ejecutivoIdPayload = null;
    if (esAutoEjecutivo) {
      // En edición ya conocemos el id propio; en registro se completa
      // después del insert (ver más abajo), porque el id aún no existe.
      ejecutivoIdPayload = isEditMode ? userIdInput.value : null;
    } else if (perfilNombreSeleccionado === 'Asesor') {
      ejecutivoIdPayload = ejecutivoSelect.value || null;
    }

    const payload = {
      sucursal_id: sucursalSelect.value,
      full_name: fullNameInput.value.trim(),
      email: emailInput.value.trim(),
      telefono: telefonoInput.value.trim() || null,
      perfil_id: perfilInput.value,
      // Se mantiene el nombre en texto por retrocompatibilidad con
      // auth-guard.js / el login, que leen "perfil" como texto plano.
      perfil: perfilSeleccionado ? perfilSeleccionado.perfil : null,
      ejecutivo_id: ejecutivoIdPayload,
      password: passwordInput.value,
    };

    if (isEditMode) {
      payload.usuario_modificacion = currentUser;
    } else {
      payload.usuario_creacion = currentUser;
      payload.usuario_modificacion = currentUser;
      payload.status = 'Activo';
    }

    try {
      let error;

      if (isEditMode) {
        const id = userIdInput.value;
        ({ error } = await supabaseClient
          .from(TABLE_USUARIOS)
          .update(payload)
          .eq('id', id));
      } else if (esAutoEjecutivo) {
        // Administrador/Colaborador: el id todavía no existe al momento del
        // insert, así que se crea primero y luego se autorreferencia
        // (ejecutivo_id = su propio id recién generado).
        const insertResult = await supabaseClient
          .from(TABLE_USUARIOS)
          .insert([payload])
          .select('id')
          .single();
        error = insertResult.error;

        if (!error && insertResult.data) {
          ({ error } = await supabaseClient
            .from(TABLE_USUARIOS)
            .update({ ejecutivo_id: insertResult.data.id })
            .eq('id', insertResult.data.id));
        }
      } else {
        ({ error } = await supabaseClient
          .from(TABLE_USUARIOS)
          .insert([payload]));
      }

      submitBtn.disabled = false;
      submitBtn.textContent = isEditMode ? 'Guardar Cambios' : 'Registrar';

      if (error) {
        console.error('Error al guardar usuario:', error);
        const message = getErrorMessage(error);
        const prefix = error.status === 401 || error.statusCode === 401
          ? 'Acceso denegado a Supabase. Verifica la ANON KEY y los permisos de la tabla.'
          : 'No se pudo guardar el usuario.';
        showFeedback('formFeedback', `${prefix} ${message}`, 'error');
        return;
      }

      showFeedback('formFeedback', isEditMode ? 'Usuario actualizado correctamente.' : 'Usuario registrado correctamente.', 'success');
      await loadUsers();
      setTimeout(closeModal, 700);
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = isEditMode ? 'Guardar Cambios' : 'Registrar';
      console.error('Excepción al guardar usuario:', err);
      showFeedback('formFeedback', `No se pudo conectar con Supabase: ${getErrorMessage(err)}`, 'error');
    }
  });

  /* =========================================================
     SUPABASE: ACTIVAR / INACTIVAR
     ========================================================= */
  async function handleToggleStatusUser(user) {
    const nextStatus = (user.status || 'Activo') === 'Activo' ? 'Inactivo' : 'Activo';
    const currentUser = getCurrentUserLabel();

    try {
      const { error } = await supabaseClient
        .from(TABLE_USUARIOS)
        .update({ status: nextStatus, usuario_modificacion: currentUser })
        .eq('id', user.id);

      if (error) {
        showPageNotification('pageNotification', `No se pudo cambiar el status: ${getErrorMessage(error)}`, 'error');
        return;
      }
      await loadUsers();
      showPageNotification('pageNotification', `Usuario "${user.full_name}" marcado como ${nextStatus}.`, 'success');
    } catch (err) {
      showPageNotification('pageNotification', `No se pudo cambiar el status: ${getErrorMessage(err)}`, 'error');
    }
  }

  /* =========================================================
     SUPABASE: ELIMINAR
     ========================================================= */
  async function handleDelete(id) {
    const user = allUsers.find((u) => u.id === id);
    if (!user) {
      showPageNotification('pageNotification', 'Usuario no encontrado.', 'error');
      return;
    }

    const confirmed = await openConfirmDialog({
      title: 'Eliminar usuario',
      message: `¿Eliminar al usuario "${user.full_name}"? Esta acción no se puede deshacer.`,
      acceptLabel: 'Eliminar'
    });

    if (!confirmed) return;

    if (!supabaseClient) {
      showPageNotification('pageNotification', 'Supabase no está inicializado.', 'error');
      return;
    }

    try {
      const { error } = await supabaseClient
        .from(TABLE_USUARIOS)
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Error al eliminar usuario:', error);
        showPageNotification('pageNotification', `No se pudo eliminar el usuario: ${getErrorMessage(error)}`, 'error');
        return;
      }

      await loadUsers();
      showPageNotification('pageNotification', 'Usuario eliminado correctamente.', 'success');
    } catch (err) {
      console.error('Excepción al eliminar usuario:', err);
      showPageNotification('pageNotification', `No se pudo eliminar el usuario: ${getErrorMessage(err)}`, 'error');
    }
  }

  /* =========================================================================
     =============================  PERFILES  ===================================
     ========================================================================= */

  const searchPerfiles = document.getElementById('searchPerfiles');
  const clearSearchPerfiles = document.getElementById('clearSearchPerfiles');
  const perfilesTableBody = document.getElementById('perfilesTableBody');
  const perfilesLoading = document.getElementById('perfilesLoading');
  const perfilesEmpty = document.getElementById('perfilesEmpty');
  const openPerfilModalBtn = document.getElementById('openPerfilModalBtn');

  const perfilModalOverlay = document.getElementById('perfilModalOverlay');
  const perfilModalTitle = document.getElementById('perfilModalTitle');
  const perfilModalCloseBtn = document.getElementById('perfilModalCloseBtn');
  const cancelPerfilModalBtn = document.getElementById('cancelPerfilModalBtn');
  const perfilForm = document.getElementById('perfilForm');
  const perfilIdInput = document.getElementById('perfilId');
  const perfilNombreInput = document.getElementById('perfilNombre');
  const submitPerfilBtn = document.getElementById('submitPerfilBtn');
  const fieldPerfilNombre = document.getElementById('fieldPerfilNombre');

  const perfilViewDetail = document.getElementById('perfilViewDetail');
  const perfilViewId = document.getElementById('perfilViewId');
  const perfilViewStatus = document.getElementById('perfilViewStatus');
  const perfilViewFechaCreacion = document.getElementById('perfilViewFechaCreacion');
  const perfilViewUsuarioCreacion = document.getElementById('perfilViewUsuarioCreacion');
  const perfilViewFechaModificacion = document.getElementById('perfilViewFechaModificacion');
  const perfilViewUsuarioModificacion = document.getElementById('perfilViewUsuarioModificacion');

  let isEditModePerfil = false;
  let isReadOnlyPerfil = false;
  let currentSortPerfiles = { key: 'perfil', direction: 'asc' };
  const sortableHeadersPerfiles = document.querySelectorAll('#perfilesTable th.is-sortable');

  attachTitleCaseFormatter(perfilNombreInput);

  function openPerfilModal({ edit = false, item = null, viewOnly = false } = {}) {
    isEditModePerfil = edit;
    isReadOnlyPerfil = viewOnly;
    perfilForm.reset();
    clearFeedback('perfilFormFeedback');
    setFieldError(fieldPerfilNombre, false);

    if (item) {
      perfilModalTitle.textContent = viewOnly ? 'Ver Perfil' : 'Editar Perfil';
      submitPerfilBtn.textContent = 'Guardar Cambios';
      perfilIdInput.value = item.id;
      perfilNombreInput.value = item.perfil || '';

      perfilViewId.textContent = item.id;
      perfilViewStatus.textContent = item.status;
      perfilViewFechaCreacion.textContent = formatDateTime(item.fecha_creacion);
      perfilViewUsuarioCreacion.textContent = item.usuario_creacion || '—';
      perfilViewFechaModificacion.textContent = formatDateTime(item.fecha_modificacion);
      perfilViewUsuarioModificacion.textContent = item.usuario_modificacion || '—';
    } else {
      perfilModalTitle.textContent = 'Registrar Perfil';
      submitPerfilBtn.textContent = 'Registrar';
      perfilIdInput.value = '';
    }

    perfilNombreInput.disabled = viewOnly;
    perfilViewDetail.style.display = viewOnly ? 'flex' : 'none';
    submitPerfilBtn.style.display = viewOnly ? 'none' : 'inline-flex';

    perfilModalOverlay.classList.add('is-open');
    if (!viewOnly) perfilNombreInput.focus();
  }

  function closePerfilModal() {
    perfilModalOverlay.classList.remove('is-open');
    perfilForm.reset();
    perfilNombreInput.disabled = false;
    perfilViewDetail.style.display = 'none';
    submitPerfilBtn.style.display = 'inline-flex';
  }

  openPerfilModalBtn.addEventListener('click', () => openPerfilModal({ edit: false }));
  perfilModalCloseBtn.addEventListener('click', closePerfilModal);
  cancelPerfilModalBtn.addEventListener('click', closePerfilModal);
  perfilModalOverlay.addEventListener('click', (e) => {
    if (e.target === perfilModalOverlay) closePerfilModal();
  });

  function validatePerfilForm() {
    const nombreOk = perfilNombreInput.value.trim().length >= 3;
    setFieldError(fieldPerfilNombre, !nombreOk);
    return nombreOk;
  }

  function renderPerfiles(items) {
    perfilesTableBody.innerHTML = '';
    if (!items.length) {
      perfilesEmpty.style.display = 'block';
      return;
    }
    perfilesEmpty.style.display = 'none';

    items.forEach((item) => {
      const isActivo = item.status === 'Activo';
      const statusClass = isActivo ? 'status-pill--activo' : 'status-pill--inactivo';
      const toggleIcon = isActivo ? '✕' : '✓';
      const toggleClass = isActivo ? 'action-btn--toggle-on' : 'action-btn--toggle-off';
      const toggleLabel = isActivo ? 'Inactivar perfil' : 'Activar perfil';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Perfil">${escapeHtml(item.perfil)}</td>
        <td data-label="Status"><span class="status-pill ${statusClass}">${escapeHtml(item.status)}</span></td>
        <td data-label="Acciones" class="col-actions">
          <button type="button" class="action-btn action-btn--edit" data-id="${item.id}" aria-label="Editar perfil">✏️</button>
          <button type="button" class="action-btn action-btn--view" data-id="${item.id}" aria-label="Ver perfil">👁️</button>
          <button type="button" class="action-btn ${toggleClass}" data-id="${item.id}" aria-label="${toggleLabel}">${toggleIcon}</button>
          <button type="button" class="action-btn action-btn--delete" data-id="${item.id}" aria-label="Eliminar perfil">🗑️</button>
        </td>
      `;
      perfilesTableBody.appendChild(tr);

      tr.querySelector('.action-btn--edit').addEventListener('click', () => openPerfilModal({ edit: true, item }));
      tr.querySelector('.action-btn--view').addEventListener('click', () => openPerfilModal({ edit: true, item, viewOnly: true }));
      tr.querySelector(`.${toggleClass}`).addEventListener('click', () => handleToggleStatusPerfil(item));
      tr.querySelector('.action-btn--delete').addEventListener('click', () => handleDeletePerfil(item.id));
    });
  }

  sortableHeadersPerfiles.forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sortKey;
      if (currentSortPerfiles.key === key) {
        currentSortPerfiles.direction = currentSortPerfiles.direction === 'asc' ? 'desc' : 'asc';
      } else {
        currentSortPerfiles = { key, direction: 'asc' };
      }
      updateSortIndicators(sortableHeadersPerfiles, currentSortPerfiles);
      applyFilterPerfiles();
    });
  });

  function applyFilterPerfiles() {
    const term = searchPerfiles.value.trim().toLowerCase();
    clearSearchPerfiles.classList.toggle('is-visible', term.length > 0);
    let result = allPerfiles;
    if (term) result = result.filter((p) => p.perfil.toLowerCase().includes(term));
    result = sortItems(result, currentSortPerfiles.key, currentSortPerfiles.direction);
    renderPerfiles(result);
  }

  searchPerfiles.addEventListener('input', applyFilterPerfiles);
  clearSearchPerfiles.addEventListener('click', () => {
    searchPerfiles.value = '';
    applyFilterPerfiles();
    searchPerfiles.focus();
  });

  async function loadPerfiles() {
    perfilesLoading.style.display = 'block';
    perfilesEmpty.style.display = 'none';
    perfilesTableBody.innerHTML = '';

    if (!supabaseClient) {
      perfilesLoading.style.display = 'none';
      perfilesEmpty.textContent = 'Supabase no está inicializado.';
      perfilesEmpty.style.display = 'block';
      return;
    }

    try {
      const { data, error } = await supabaseClient
        .from(TABLE_PERFILES)
        .select('*')
        .order('perfil', { ascending: true });

      perfilesLoading.style.display = 'none';

      if (error) {
        perfilesEmpty.textContent = `Error al cargar perfiles: ${getErrorMessage(error)}`;
        perfilesEmpty.style.display = 'block';
        return;
      }

      allPerfiles = data || [];
      applyFilterPerfiles();
      // Refresca el <select> de Perfil en el modal de Usuarios por si cambió el catálogo
      populatePerfilSelect();
    } catch (err) {
      perfilesLoading.style.display = 'none';
      perfilesEmpty.textContent = `No se pudo conectar con Supabase: ${getErrorMessage(err)}`;
      perfilesEmpty.style.display = 'block';
    }
  }

  perfilForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFeedback('perfilFormFeedback');

    if (isReadOnlyPerfil) return;

    if (!validatePerfilForm()) {
      showFeedback('perfilFormFeedback', 'Revisa los campos marcados antes de continuar.', 'error');
      return;
    }
    if (!supabaseClient) {
      showFeedback('perfilFormFeedback', 'No se pudo conectar con Supabase.', 'error');
      return;
    }

    submitPerfilBtn.disabled = true;
    submitPerfilBtn.textContent = isEditModePerfil ? 'Guardando...' : 'Registrando...';

    const currentUser = getCurrentUserLabel();
    const payload = { perfil: perfilNombreInput.value.trim() };

    if (isEditModePerfil) {
      payload.usuario_modificacion = currentUser;
    } else {
      payload.usuario_creacion = currentUser;
      payload.usuario_modificacion = currentUser;
      payload.status = 'Activo';
    }

    try {
      let error;
      if (isEditModePerfil) {
        ({ error } = await supabaseClient.from(TABLE_PERFILES).update(payload).eq('id', perfilIdInput.value));
      } else {
        ({ error } = await supabaseClient.from(TABLE_PERFILES).insert([payload]));
      }

      submitPerfilBtn.disabled = false;
      submitPerfilBtn.textContent = isEditModePerfil ? 'Guardar Cambios' : 'Registrar';

      if (error) {
        const prefix = error.code === '23505' ? 'Ya existe un perfil con ese nombre.' : 'No se pudo guardar el perfil.';
        showFeedback('perfilFormFeedback', `${prefix} ${getErrorMessage(error)}`, 'error');
        return;
      }

      showFeedback('perfilFormFeedback', isEditModePerfil ? 'Perfil actualizado correctamente.' : 'Perfil registrado correctamente.', 'success');
      await loadPerfiles();
      setTimeout(closePerfilModal, 700);
    } catch (err) {
      submitPerfilBtn.disabled = false;
      submitPerfilBtn.textContent = isEditModePerfil ? 'Guardar Cambios' : 'Registrar';
      showFeedback('perfilFormFeedback', `No se pudo guardar: ${getErrorMessage(err)}`, 'error');
    }
  });

  async function handleToggleStatusPerfil(item) {
    const nextStatus = item.status === 'Activo' ? 'Inactivo' : 'Activo';
    const currentUser = getCurrentUserLabel();

    try {
      const { error } = await supabaseClient
        .from(TABLE_PERFILES)
        .update({ status: nextStatus, usuario_modificacion: currentUser })
        .eq('id', item.id);

      if (error) {
        showPageNotification('perfilesNotification', `No se pudo cambiar el status: ${getErrorMessage(error)}`, 'error');
        return;
      }
      await loadPerfiles();
      showPageNotification('perfilesNotification', `Perfil "${item.perfil}" marcado como ${nextStatus}.`, 'success');
    } catch (err) {
      showPageNotification('perfilesNotification', `No se pudo cambiar el status: ${getErrorMessage(err)}`, 'error');
    }
  }

  async function handleDeletePerfil(id) {
    const item = allPerfiles.find((p) => p.id === id);
    if (!item) return;

    const confirmed = await openConfirmDialog({
      title: 'Eliminar perfil',
      message: `¿Eliminar el perfil "${item.perfil}"? Los usuarios que lo tengan asignado quedarán sin perfil normalizado (perfil_id). Esta acción no se puede deshacer.`,
      acceptLabel: 'Eliminar',
    });
    if (!confirmed) return;

    try {
      const { error } = await supabaseClient.from(TABLE_PERFILES).delete().eq('id', id);
      if (error) {
        showPageNotification('perfilesNotification', `No se pudo eliminar: ${getErrorMessage(error)}`, 'error');
        return;
      }
      await loadPerfiles();
      await loadUsers();
      showPageNotification('perfilesNotification', 'Perfil eliminado correctamente.', 'success');
    } catch (err) {
      showPageNotification('perfilesNotification', `No se pudo eliminar: ${getErrorMessage(err)}`, 'error');
    }
  }

  /* =========================================================================
     ============================  SUCURSALES  ==================================
     ========================================================================= */

  const searchSucursales = document.getElementById('searchSucursales');
  const clearSearchSucursales = document.getElementById('clearSearchSucursales');
  const sucursalesTableBody = document.getElementById('sucursalesTableBody');
  const sucursalesLoading = document.getElementById('sucursalesLoading');
  const sucursalesEmpty = document.getElementById('sucursalesEmpty');
  const openSucursalModalBtn = document.getElementById('openSucursalModalBtn');

  const sucursalModalOverlay = document.getElementById('sucursalModalOverlay');
  const sucursalModalTitle = document.getElementById('sucursalModalTitle');
  const sucursalModalCloseBtn = document.getElementById('sucursalModalCloseBtn');
  const cancelSucursalModalBtn = document.getElementById('cancelSucursalModalBtn');
  const sucursalForm = document.getElementById('sucursalForm');
  const sucursalIdInput = document.getElementById('sucursalId');
  const sucursalNombreInput = document.getElementById('sucursalNombre');
  const submitSucursalBtn = document.getElementById('submitSucursalBtn');
  const fieldSucursalNombre = document.getElementById('fieldSucursalNombre');

  const sucursalViewDetail = document.getElementById('sucursalViewDetail');
  const sucursalViewId = document.getElementById('sucursalViewId');
  const sucursalViewStatus = document.getElementById('sucursalViewStatus');
  const sucursalViewFechaCreacion = document.getElementById('sucursalViewFechaCreacion');
  const sucursalViewUsuarioCreacion = document.getElementById('sucursalViewUsuarioCreacion');
  const sucursalViewFechaModificacion = document.getElementById('sucursalViewFechaModificacion');
  const sucursalViewUsuarioModificacion = document.getElementById('sucursalViewUsuarioModificacion');

  let isEditModeSucursal = false;
  let isReadOnlySucursal = false;
  let currentSortSucursales = { key: 'sucursal', direction: 'asc' };
  const sortableHeadersSucursales = document.querySelectorAll('#sucursalesTable th.is-sortable');

  attachTitleCaseFormatter(sucursalNombreInput);

  function openSucursalModal({ edit = false, item = null, viewOnly = false } = {}) {
    isEditModeSucursal = edit;
    isReadOnlySucursal = viewOnly;
    sucursalForm.reset();
    clearFeedback('sucursalFormFeedback');
    setFieldError(fieldSucursalNombre, false);

    if (item) {
      sucursalModalTitle.textContent = viewOnly ? 'Ver Sucursal' : 'Editar Sucursal';
      submitSucursalBtn.textContent = 'Guardar Cambios';
      sucursalIdInput.value = item.id;
      sucursalNombreInput.value = item.sucursal || '';

      sucursalViewId.textContent = item.id;
      sucursalViewStatus.textContent = item.status;
      sucursalViewFechaCreacion.textContent = formatDateTime(item.fecha_creacion);
      sucursalViewUsuarioCreacion.textContent = item.usuario_creacion || '—';
      sucursalViewFechaModificacion.textContent = formatDateTime(item.fecha_modificacion);
      sucursalViewUsuarioModificacion.textContent = item.usuario_modificacion || '—';
    } else {
      sucursalModalTitle.textContent = 'Registrar Sucursal';
      submitSucursalBtn.textContent = 'Registrar';
      sucursalIdInput.value = '';
    }

    sucursalNombreInput.disabled = viewOnly;
    sucursalViewDetail.style.display = viewOnly ? 'flex' : 'none';
    submitSucursalBtn.style.display = viewOnly ? 'none' : 'inline-flex';

    sucursalModalOverlay.classList.add('is-open');
    if (!viewOnly) sucursalNombreInput.focus();
  }

  function closeSucursalModal() {
    sucursalModalOverlay.classList.remove('is-open');
    sucursalForm.reset();
    sucursalNombreInput.disabled = false;
    sucursalViewDetail.style.display = 'none';
    submitSucursalBtn.style.display = 'inline-flex';
  }

  openSucursalModalBtn.addEventListener('click', () => openSucursalModal({ edit: false }));
  sucursalModalCloseBtn.addEventListener('click', closeSucursalModal);
  cancelSucursalModalBtn.addEventListener('click', closeSucursalModal);
  sucursalModalOverlay.addEventListener('click', (e) => {
    if (e.target === sucursalModalOverlay) closeSucursalModal();
  });

  function validateSucursalForm() {
    const nombreOk = sucursalNombreInput.value.trim().length >= 3;
    setFieldError(fieldSucursalNombre, !nombreOk);
    return nombreOk;
  }

  function renderSucursales(items) {
    sucursalesTableBody.innerHTML = '';
    if (!items.length) {
      sucursalesEmpty.style.display = 'block';
      return;
    }
    sucursalesEmpty.style.display = 'none';

    items.forEach((item) => {
      const isActivo = item.status === 'Activo';
      const statusClass = isActivo ? 'status-pill--activo' : 'status-pill--inactivo';
      const toggleIcon = isActivo ? '✕' : '✓';
      const toggleClass = isActivo ? 'action-btn--toggle-on' : 'action-btn--toggle-off';
      const toggleLabel = isActivo ? 'Inactivar sucursal' : 'Activar sucursal';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Sucursal">${escapeHtml(item.sucursal)}</td>
        <td data-label="Status"><span class="status-pill ${statusClass}">${escapeHtml(item.status)}</span></td>
        <td data-label="Acciones" class="col-actions">
          <button type="button" class="action-btn action-btn--edit" data-id="${item.id}" aria-label="Editar sucursal">✏️</button>
          <button type="button" class="action-btn action-btn--view" data-id="${item.id}" aria-label="Ver sucursal">👁️</button>
          <button type="button" class="action-btn ${toggleClass}" data-id="${item.id}" aria-label="${toggleLabel}">${toggleIcon}</button>
          <button type="button" class="action-btn action-btn--delete" data-id="${item.id}" aria-label="Eliminar sucursal">🗑️</button>
        </td>
      `;
      sucursalesTableBody.appendChild(tr);

      tr.querySelector('.action-btn--edit').addEventListener('click', () => openSucursalModal({ edit: true, item }));
      tr.querySelector('.action-btn--view').addEventListener('click', () => openSucursalModal({ edit: true, item, viewOnly: true }));
      tr.querySelector(`.${toggleClass}`).addEventListener('click', () => handleToggleStatusSucursal(item));
      tr.querySelector('.action-btn--delete').addEventListener('click', () => handleDeleteSucursal(item.id));
    });
  }

  sortableHeadersSucursales.forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sortKey;
      if (currentSortSucursales.key === key) {
        currentSortSucursales.direction = currentSortSucursales.direction === 'asc' ? 'desc' : 'asc';
      } else {
        currentSortSucursales = { key, direction: 'asc' };
      }
      updateSortIndicators(sortableHeadersSucursales, currentSortSucursales);
      applyFilterSucursales();
    });
  });

  function applyFilterSucursales() {
    const term = searchSucursales.value.trim().toLowerCase();
    clearSearchSucursales.classList.toggle('is-visible', term.length > 0);
    let result = allSucursales;
    if (term) result = result.filter((s) => s.sucursal.toLowerCase().includes(term));
    result = sortItems(result, currentSortSucursales.key, currentSortSucursales.direction);
    renderSucursales(result);
  }

  searchSucursales.addEventListener('input', applyFilterSucursales);
  clearSearchSucursales.addEventListener('click', () => {
    searchSucursales.value = '';
    applyFilterSucursales();
    searchSucursales.focus();
  });

  async function loadSucursales() {
    sucursalesLoading.style.display = 'block';
    sucursalesEmpty.style.display = 'none';
    sucursalesTableBody.innerHTML = '';

    if (!supabaseClient) {
      sucursalesLoading.style.display = 'none';
      sucursalesEmpty.textContent = 'Supabase no está inicializado.';
      sucursalesEmpty.style.display = 'block';
      return;
    }

    try {
      const { data, error } = await supabaseClient
        .from(TABLE_SUCURSALES)
        .select('*')
        .order('sucursal', { ascending: true });

      sucursalesLoading.style.display = 'none';

      if (error) {
        sucursalesEmpty.textContent = `Error al cargar sucursales: ${getErrorMessage(error)}`;
        sucursalesEmpty.style.display = 'block';
        return;
      }

      allSucursales = data || [];
      applyFilterSucursales();
      // Refresca el <select> de Sucursal en el modal de Usuarios por si cambió el catálogo
      populateSucursalSelect();
    } catch (err) {
      sucursalesLoading.style.display = 'none';
      sucursalesEmpty.textContent = `No se pudo conectar con Supabase: ${getErrorMessage(err)}`;
      sucursalesEmpty.style.display = 'block';
    }
  }

  sucursalForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFeedback('sucursalFormFeedback');

    if (isReadOnlySucursal) return;

    if (!validateSucursalForm()) {
      showFeedback('sucursalFormFeedback', 'Revisa los campos marcados antes de continuar.', 'error');
      return;
    }
    if (!supabaseClient) {
      showFeedback('sucursalFormFeedback', 'No se pudo conectar con Supabase.', 'error');
      return;
    }

    submitSucursalBtn.disabled = true;
    submitSucursalBtn.textContent = isEditModeSucursal ? 'Guardando...' : 'Registrando...';

    const currentUser = getCurrentUserLabel();
    const payload = { sucursal: sucursalNombreInput.value.trim() };

    if (isEditModeSucursal) {
      payload.usuario_modificacion = currentUser;
    } else {
      payload.usuario_creacion = currentUser;
      payload.usuario_modificacion = currentUser;
      payload.status = 'Activo';
    }

    try {
      let error;
      if (isEditModeSucursal) {
        ({ error } = await supabaseClient.from(TABLE_SUCURSALES).update(payload).eq('id', sucursalIdInput.value));
      } else {
        ({ error } = await supabaseClient.from(TABLE_SUCURSALES).insert([payload]));
      }

      submitSucursalBtn.disabled = false;
      submitSucursalBtn.textContent = isEditModeSucursal ? 'Guardar Cambios' : 'Registrar';

      if (error) {
        const prefix = error.code === '23505' ? 'Ya existe una sucursal con ese nombre.' : 'No se pudo guardar la sucursal.';
        showFeedback('sucursalFormFeedback', `${prefix} ${getErrorMessage(error)}`, 'error');
        return;
      }

      showFeedback('sucursalFormFeedback', isEditModeSucursal ? 'Sucursal actualizada correctamente.' : 'Sucursal registrada correctamente.', 'success');
      await loadSucursales();
      setTimeout(closeSucursalModal, 700);
    } catch (err) {
      submitSucursalBtn.disabled = false;
      submitSucursalBtn.textContent = isEditModeSucursal ? 'Guardar Cambios' : 'Registrar';
      showFeedback('sucursalFormFeedback', `No se pudo guardar: ${getErrorMessage(err)}`, 'error');
    }
  });

  async function handleToggleStatusSucursal(item) {
    const nextStatus = item.status === 'Activo' ? 'Inactivo' : 'Activo';
    const currentUser = getCurrentUserLabel();

    try {
      const { error } = await supabaseClient
        .from(TABLE_SUCURSALES)
        .update({ status: nextStatus, usuario_modificacion: currentUser })
        .eq('id', item.id);

      if (error) {
        showPageNotification('sucursalesNotification', `No se pudo cambiar el status: ${getErrorMessage(error)}`, 'error');
        return;
      }
      await loadSucursales();
      showPageNotification('sucursalesNotification', `Sucursal "${item.sucursal}" marcada como ${nextStatus}.`, 'success');
    } catch (err) {
      showPageNotification('sucursalesNotification', `No se pudo cambiar el status: ${getErrorMessage(err)}`, 'error');
    }
  }

  async function handleDeleteSucursal(id) {
    const item = allSucursales.find((s) => s.id === id);
    if (!item) return;

    const confirmed = await openConfirmDialog({
      title: 'Eliminar sucursal',
      message: `¿Eliminar la sucursal "${item.sucursal}"? Los usuarios que la tengan asignada quedarán sin sucursal. Esta acción no se puede deshacer.`,
      acceptLabel: 'Eliminar',
    });
    if (!confirmed) return;

    try {
      const { error } = await supabaseClient.from(TABLE_SUCURSALES).delete().eq('id', id);
      if (error) {
        showPageNotification('sucursalesNotification', `No se pudo eliminar: ${getErrorMessage(error)}`, 'error');
        return;
      }
      await loadSucursales();
      await loadUsers();
      showPageNotification('sucursalesNotification', 'Sucursal eliminada correctamente.', 'success');
    } catch (err) {
      showPageNotification('sucursalesNotification', `No se pudo eliminar: ${getErrorMessage(err)}`, 'error');
    }
  }

  /* =========================================================
     INICIO
     ========================================================= */
  updateSortIndicators(sortableHeaders, currentSort);
  updateSortIndicators(sortableHeadersPerfiles, currentSortPerfiles);
  updateSortIndicators(sortableHeadersSucursales, currentSortSucursales);

  await initSupabase();
  // Perfiles y Sucursales primero, para poder poblar los <select> del
  // modal de Usuarios y mostrar los nombres embebidos en su listado.
  await Promise.all([loadPerfiles(), loadSucursales()]);
  await loadUsers();
});
