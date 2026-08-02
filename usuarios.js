/* =============================================================
   CONFIGURACIÓN DE SUPABASE
   Reemplaza estos valores por los de tu proyecto
   (Project Settings > API en tu panel de Supabase).
   ============================================================= */
const SUPABASE_URL = 'https://cibtpkpxdrykozujaqba.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_zlp4_HGpTeAQKW55c_pZQA_2HEXRpaC';
const TABLE_NAME = 'usuarios';

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
  Estructura de tabla esperada en Supabase (SQL de referencia):

  create table usuarios (
    id uuid primary key default gen_random_uuid(),
    full_name text not null,
    email text not null unique,
    perfil text not null check (perfil in ('Asesor', 'Colaborador', 'Administrador')),
    password text not null,
    created_at timestamp with time zone default now()
  );

  La columna `perfil` es la que usa principal.html para identificar el rol del
  usuario al iniciar sesión, y auth-guard.js para decidir qué páginas puede ver
  (PAGE_PERMISSIONS).

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

document.addEventListener('DOMContentLoaded', async () => {

  /* =========================================================
     REFERENCIAS DEL DOM
     ========================================================= */
  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const usersTableBody = document.getElementById('usersTableBody');
  const usersLoading = document.getElementById('usersLoading');
  const usersEmpty = document.getElementById('usersEmpty');

  const openModalBtn = document.getElementById('openModalBtn');
  const modalOverlay = document.getElementById('userModalOverlay');
  const modalTitle = document.getElementById('modalTitle');
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  const cancelModalBtn = document.getElementById('cancelModalBtn');
  const userForm = document.getElementById('userForm');
  const userIdInput = document.getElementById('userId');
  const fullNameInput = document.getElementById('fullName');
  const emailInput = document.getElementById('email');
  const perfilInput = document.getElementById('perfil');
  const passwordInput = document.getElementById('password');
  const togglePasswordBtn = document.getElementById('togglePasswordBtn');
  const submitBtn = document.getElementById('submitBtn');
  const editModalBtn = document.getElementById('editModalBtn');
  const formFeedback = document.getElementById('formFeedback');
  const pageNotification = document.getElementById('pageNotification');
  const confirmOverlay = document.getElementById('confirmOverlay');
  const confirmTitle = document.getElementById('confirmTitle');
  const confirmMessage = document.getElementById('confirmMessage');
  const confirmCancelBtn = document.getElementById('confirmCancelBtn');
  const confirmAcceptBtn = document.getElementById('confirmAcceptBtn');

  const fieldFullName = document.getElementById('fieldFullName');
  const fieldEmail = document.getElementById('fieldEmail');
  const fieldPerfil = document.getElementById('fieldPerfil');
  const fieldPassword = document.getElementById('fieldPassword');

  const sortableHeaders = document.querySelectorAll('#usersTable th.is-sortable');

  let allUsers = [];       // caché local para el filtro en tiempo real
  let isEditMode = false;
  let confirmResolve = null;
  let notificationTimer = null;

  // Orden por defecto: alfabético por Nombres y Apellidos, ascendente
  let currentSort = { key: 'full_name', direction: 'asc' };

  function showPageNotification(message, type = 'success', duration = 3500) {
    if (!pageNotification) return;
    pageNotification.textContent = message;
    pageNotification.className = `page-notification page-notification--${type} is-visible`;
    pageNotification.style.display = 'block';

    if (notificationTimer) {
      clearTimeout(notificationTimer);
    }

    notificationTimer = setTimeout(() => {
      pageNotification.className = 'page-notification';
      pageNotification.style.display = 'none';
      notificationTimer = null;
    }, duration);
  }

  function openConfirmDialog({ title, message, acceptLabel = 'Eliminar' }) {
    if (!confirmOverlay || !confirmTitle || !confirmMessage || !confirmAcceptBtn || !confirmCancelBtn) {
      return Promise.resolve(false);
    }

    confirmTitle.textContent = title;
    confirmMessage.textContent = message;
    confirmAcceptBtn.textContent = acceptLabel;
    confirmOverlay.style.display = 'flex';
    confirmAcceptBtn.focus();

    return new Promise((resolve) => {
      confirmResolve = resolve;
    });
  }

  function closeConfirmDialog() {
    if (!confirmOverlay) return;
    confirmOverlay.style.display = 'none';
    if (confirmResolve) {
      confirmResolve(false);
      confirmResolve = null;
    }
  }

  /* =========================================================
     FORMATEO "TIPO ORACIÓN" DEL NOMBRE (igual que en el registro
     del grupo familiar): inicial de cada palabra en mayúscula.
     ========================================================= */
  function toTitleCaseLive(value) {
    return value
      .toLowerCase()
      .replace(/(^|\s|['-])([a-záéíóúñü])/g, (m, sep, letter) => sep + letter.toUpperCase());
  }

  fullNameInput.addEventListener('input', (e) => {
    const input = e.target;
    const cursorPos = input.selectionStart;
    const originalLength = input.value.length;

    const formatted = toTitleCaseLive(input.value);
    input.value = formatted;

    const diff = formatted.length - originalLength;
    input.setSelectionRange(cursorPos + diff, cursorPos + diff);
  });

  /* =========================================================
     CORREO: solo minúsculas, números y caracteres especiales
     (se fuerza minúscula en tiempo real)
     ========================================================= */
  emailInput.addEventListener('input', (e) => {
    const input = e.target;
    const cursorPos = input.selectionStart;
    const lower = input.value.toLowerCase();
    if (lower !== input.value) {
      input.value = lower;
      input.setSelectionRange(cursorPos, cursorPos);
    }
  });

  perfilInput.addEventListener('change', () => {
    if (perfilInput.value) {
      fieldPerfil.classList.remove('has-error');
    }
  });

  /* =========================================================
     CONTRASEÑA: alfanumérica + caracteres especiales
     (mostrar / ocultar)
     ========================================================= */
  togglePasswordBtn.addEventListener('click', () => {
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    togglePasswordBtn.textContent = isPassword ? '🙈' : '👁';
    togglePasswordBtn.setAttribute('aria-label', isPassword ? 'Ocultar contraseña' : 'Mostrar contraseña');
  });

  /* =========================================================
     VALIDACIONES
     ========================================================= */
  const EMAIL_REGEX = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/;
  // Alfanumérico + caracteres especiales comunes, mínimo 8 caracteres
  const PASSWORD_REGEX = /^[A-Za-z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]{8,}$/;

  function setFieldError(fieldEl, hasError) {
    fieldEl.classList.toggle('has-error', hasError);
    const errorSpan = fieldEl.querySelector('.field-error');
    if (errorSpan) errorSpan.classList.toggle('is-visible', hasError);
  }

  function validateForm() {
    let valid = true;

    const nameOk = fullNameInput.value.trim().length >= 3;
    setFieldError(fieldFullName, !nameOk);
    if (!nameOk) valid = false;

    const emailOk = EMAIL_REGEX.test(emailInput.value.trim());
    setFieldError(fieldEmail, !emailOk);
    if (!emailOk) valid = false;

    const perfilOk = perfilInput.value.trim().length > 0;
    setFieldError(fieldPerfil, !perfilOk);
    if (!perfilOk) valid = false;

    const passwordOk = PASSWORD_REGEX.test(passwordInput.value);
    setFieldError(fieldPassword, !passwordOk);
    if (!passwordOk) valid = false;

    return valid;
  }

  function showFeedback(message, type = 'error') {
    formFeedback.textContent = message;
    formFeedback.className = `form-feedback is-visible form-feedback--${type}`;
  }

  function clearFeedback() {
    formFeedback.className = 'form-feedback';
    formFeedback.textContent = '';
  }

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

  /* =========================================================
     MODAL: abrir / cerrar
     ========================================================= */
  function openModal({ edit = false, user = null, viewOnly = false } = {}) {
    isEditMode = edit;
    userForm.reset();
    clearFeedback();
    [fieldFullName, fieldEmail, fieldPerfil, fieldPassword].forEach((f) => setFieldError(f, false));

    if (user) {
      modalTitle.textContent = viewOnly ? 'Ver Usuario' : 'Editar Usuario';
      submitBtn.textContent = 'Guardar Cambios';
      userIdInput.value = user.id;
      fullNameInput.value = user.full_name;
      emailInput.value = user.email;
      perfilInput.value = user.perfil || '';
      passwordInput.value = user.password;
    } else {
      modalTitle.textContent = 'Registrar Usuario';
      submitBtn.textContent = 'Registrar';
      userIdInput.value = '';
      perfilInput.value = '';
    }

    const isViewMode = viewOnly && !!user;
    const fields = [fullNameInput, emailInput, perfilInput, passwordInput];
    fields.forEach((field) => {
      field.disabled = isViewMode;
    });

    if (isViewMode) {
      submitBtn.style.display = 'none';
      editModalBtn.style.display = 'inline-flex';
      editModalBtn.textContent = 'Editar';
    } else {
      submitBtn.style.display = 'inline-flex';
      editModalBtn.style.display = 'none';
    }

    modalOverlay.classList.add('is-open');
    fullNameInput.focus();
  }

  function closeModal() {
    modalOverlay.classList.remove('is-open');
    userForm.reset();
    [fullNameInput, emailInput, perfilInput, passwordInput].forEach((field) => {
      field.disabled = false;
    });
    submitBtn.style.display = 'inline-flex';
    editModalBtn.style.display = 'none';
  }

  if (openModalBtn) {
    openModalBtn.addEventListener('click', () => openModal({ edit: false }));
  }
  if (editModalBtn) {
    editModalBtn.addEventListener('click', enableModalEditMode);
  }
  if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', closeModal);
  }
  if (cancelModalBtn) {
    cancelModalBtn.addEventListener('click', closeModal);
  }
  if (modalOverlay) {
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closeModal();
    });
  }
  if (confirmCancelBtn) {
    confirmCancelBtn.addEventListener('click', () => {
      closeConfirmDialog();
    });
  }

  if (confirmAcceptBtn) {
    confirmAcceptBtn.addEventListener('click', () => {
      if (confirmResolve) {
        confirmResolve(true);
        confirmResolve = null;
      }
      closeConfirmDialog();
    });
  }

  if (confirmOverlay) {
    confirmOverlay.addEventListener('click', (e) => {
      if (e.target === confirmOverlay) {
        closeConfirmDialog();
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (confirmOverlay?.style.display === 'flex') {
      closeConfirmDialog();
      return;
    }
    if (modalOverlay?.classList.contains('is-open')) closeModal();
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
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Nombres y Apellidos">${escapeHtml(user.full_name)}</td>
        <td data-label="Correo">${escapeHtml(user.email)}</td>
        <td data-label="Perfil">${escapeHtml(user.perfil || '')}</td>
        <td data-label="Contraseña"><span class="password-mask">••••••••</span></td>
        <td data-label="Acciones" class="col-actions">
          <button type="button" class="action-btn action-btn--view" data-id="${user.id}" aria-label="Ver usuario">👁</button>
          <button type="button" class="action-btn action-btn--delete" data-id="${user.id}" aria-label="Eliminar usuario">🗑️</button>
        </td>
      `;
      usersTableBody.appendChild(tr);

      const viewButton = tr.querySelector('.action-btn--view');
      const deleteButton = tr.querySelector('.action-btn--delete');

      if (viewButton) {
        viewButton.addEventListener('click', () => {
          openModal({ edit: false, user, viewOnly: true });
        });
      }

      if (deleteButton) {
        deleteButton.addEventListener('click', async () => {
          await handleDelete(user.id);
        });
      }
    });

  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
  }

  function enableModalEditMode() {
    isEditMode = true;
    [fullNameInput, emailInput, perfilInput, passwordInput].forEach((field) => {
      field.disabled = false;
    });
    submitBtn.style.display = 'inline-flex';
    editModalBtn.style.display = 'none';
    submitBtn.textContent = 'Guardar Cambios';
  }


  /* =========================================================
     ORDENAMIENTO DE LA TABLA (por columna, clic en cabecera)
     ========================================================= */
  function sortUsers(users, key, direction) {
    const factor = direction === 'desc' ? -1 : 1;
    return [...users].sort((a, b) => {
      const valueA = (a[key] || '').toString().toLowerCase();
      const valueB = (b[key] || '').toString().toLowerCase();
      return valueA.localeCompare(valueB, 'es', { sensitivity: 'base' }) * factor;
    });
  }

  function updateSortIndicators() {
    sortableHeaders.forEach((th) => {
      const indicator = th.querySelector('.sort-indicator');
      const isActive = th.dataset.sortKey === currentSort.key;
      th.classList.toggle('is-sorted', isActive);
      if (indicator) {
        indicator.textContent = isActive ? (currentSort.direction === 'asc' ? '▲' : '▼') : '';
      }
    });
  }

  sortableHeaders.forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sortKey;
      if (currentSort.key === key) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        currentSort = { key, direction: 'asc' };
      }
      updateSortIndicators();
      applyFilter();
    });
  });

  /* =========================================================
     BUSCADOR EN TIEMPO REAL (filtra por nombre, correo o perfil,
     y respeta el ordenamiento de columna activo)
     ========================================================= */
  function applyFilter() {
    const term = searchInput.value.trim().toLowerCase();
    clearSearchBtn.classList.toggle('is-visible', term.length > 0);

    let result = allUsers;

    if (term) {
      result = result.filter((user) =>
        user.full_name.toLowerCase().includes(term) ||
        user.email.toLowerCase().includes(term) ||
        (user.perfil || '').toLowerCase().includes(term)
      );
    }

    result = sortUsers(result, currentSort.key, currentSort.direction);
    renderUsers(result);
  }

  searchInput.addEventListener('input', applyFilter);

  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    applyFilter();
    searchInput.focus();
  });

  /* =========================================================
     SUPABASE: CARGAR USUARIOS
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
        .from(TABLE_NAME)
        .select('*')
        .order('created_at', { ascending: false });

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
    clearFeedback();

    if (!validateForm()) {
      showFeedback('Revisa los campos marcados antes de continuar.', 'error');
      return;
    }

    if (!supabaseClient) {
      showFeedback('No se pudo conectar con Supabase. Verifica la librería y la configuración.', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = isEditMode ? 'Guardando...' : 'Registrando...';

    const payload = {
      full_name: fullNameInput.value.trim(),
      email: emailInput.value.trim(),
      perfil: perfilInput.value,
      password: passwordInput.value,
    };

    try {
      let error;

      if (isEditMode) {
        const id = userIdInput.value;
        ({ error } = await supabaseClient
          .from(TABLE_NAME)
          .update(payload)
          .eq('id', id));
      } else {
        ({ error } = await supabaseClient
          .from(TABLE_NAME)
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
        showFeedback(`${prefix} ${message}`, 'error');
        return;
      }

      showFeedback(isEditMode ? 'Usuario actualizado correctamente.' : 'Usuario registrado correctamente.', 'success');
      await loadUsers();
      setTimeout(closeModal, 700);
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = isEditMode ? 'Guardar Cambios' : 'Registrar';
      console.error('Excepción al guardar usuario:', err);
      showFeedback(`No se pudo conectar con Supabase: ${getErrorMessage(err)}`, 'error');
    }
  });

  /* =========================================================
     SUPABASE: ELIMINAR
     ========================================================= */
  async function handleDelete(id) {
    const user = allUsers.find((u) => u.id === id);
    if (!user) {
      showPageNotification('Usuario no encontrado.', 'error');
      return;
    }

    const confirmed = await openConfirmDialog({
      title: 'Eliminar usuario',
      message: `¿Eliminar al usuario "${user.full_name}"? Esta acción no se puede deshacer.`,
      acceptLabel: 'Eliminar'
    });

    if (!confirmed) return;

    if (!supabaseClient) {
      showPageNotification('Supabase no está inicializado.', 'error');
      return;
    }

    try {
      const { error } = await supabaseClient
        .from(TABLE_NAME)
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Error al eliminar usuario:', error);
        showPageNotification(`No se pudo eliminar el usuario: ${getErrorMessage(error)}`, 'error');
        return;
      }

      await loadUsers();
      showPageNotification('Usuario eliminado correctamente.', 'success');
    } catch (err) {
      console.error('Excepción al eliminar usuario:', err);
      showPageNotification(`No se pudo eliminar el usuario: ${getErrorMessage(err)}`, 'error');
    }
  }

  /* =========================================================
     INICIO
     ========================================================= */
  updateSortIndicators();
  await initSupabase();
  await loadUsers();
});
