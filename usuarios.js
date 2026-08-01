/* =============================================================
   CONFIGURACIÓN DE SUPABASE
   Reemplaza estos valores por los de tu proyecto
   (Project Settings > API en tu panel de Supabase).
   ============================================================= */
const SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';
const SUPABASE_ANON_KEY = 'TU-ANON-KEY';
const TABLE_NAME = 'usuarios';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/*
  Estructura de tabla esperada en Supabase (SQL de referencia):

  create table usuarios (
    id uuid primary key default gen_random_uuid(),
    full_name text not null,
    email text not null unique,
    password text not null,
    created_at timestamp with time zone default now()
  );

  NOTA DE SEGURIDAD:
  Guardar contraseñas en texto plano no es una práctica segura para producción.
  Lo ideal es usar Supabase Auth o aplicar un hash (ej. bcrypt) antes de insertar.
  Este ejemplo las guarda directamente para mantener el alcance del requerimiento.
*/

document.addEventListener('DOMContentLoaded', () => {

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
  const passwordInput = document.getElementById('password');
  const togglePasswordBtn = document.getElementById('togglePasswordBtn');
  const submitBtn = document.getElementById('submitBtn');
  const formFeedback = document.getElementById('formFeedback');

  const fieldFullName = document.getElementById('fieldFullName');
  const fieldEmail = document.getElementById('fieldEmail');
  const fieldPassword = document.getElementById('fieldPassword');

  let allUsers = [];       // caché local para el filtro en tiempo real
  let isEditMode = false;

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

  /* =========================================================
     MODAL: abrir / cerrar
     ========================================================= */
  function openModal({ edit = false, user = null } = {}) {
    isEditMode = edit;
    userForm.reset();
    clearFeedback();
    [fieldFullName, fieldEmail, fieldPassword].forEach((f) => setFieldError(f, false));

    if (edit && user) {
      modalTitle.textContent = 'Editar Usuario';
      submitBtn.textContent = 'Guardar Cambios';
      userIdInput.value = user.id;
      fullNameInput.value = user.full_name;
      emailInput.value = user.email;
      passwordInput.value = user.password;
    } else {
      modalTitle.textContent = 'Registrar Usuario';
      submitBtn.textContent = 'Registrar';
      userIdInput.value = '';
    }

    modalOverlay.classList.add('is-open');
    fullNameInput.focus();
  }

  function closeModal() {
    modalOverlay.classList.remove('is-open');
    userForm.reset();
  }

  openModalBtn.addEventListener('click', () => openModal({ edit: false }));
  modalCloseBtn.addEventListener('click', closeModal);
  cancelModalBtn.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalOverlay.classList.contains('is-open')) closeModal();
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
        <td data-label="Contraseña"><span class="password-mask">••••••••</span></td>
        <td data-label="Acciones" class="col-actions">
          <button type="button" class="action-btn action-btn--edit" data-id="${user.id}" aria-label="Editar usuario">✏️</button>
          <button type="button" class="action-btn action-btn--delete" data-id="${user.id}" aria-label="Eliminar usuario">🗑️</button>
        </td>
      `;
      usersTableBody.appendChild(tr);
    });

    usersTableBody.querySelectorAll('.action-btn--edit').forEach((btn) => {
      btn.addEventListener('click', () => {
        const user = allUsers.find((u) => u.id === btn.dataset.id);
        if (user) openModal({ edit: true, user });
      });
    });

    usersTableBody.querySelectorAll('.action-btn--delete').forEach((btn) => {
      btn.addEventListener('click', () => handleDelete(btn.dataset.id));
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
  }

  /* =========================================================
     BUSCADOR EN TIEMPO REAL (filtra el listado ya cargado)
     ========================================================= */
  function applyFilter() {
    const term = searchInput.value.trim().toLowerCase();
    clearSearchBtn.classList.toggle('is-visible', term.length > 0);

    if (!term) {
      renderUsers(allUsers);
      return;
    }

    const filtered = allUsers.filter((user) =>
      user.full_name.toLowerCase().includes(term) ||
      user.email.toLowerCase().includes(term)
    );
    renderUsers(filtered);
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

    const { data, error } = await supabaseClient
      .from(TABLE_NAME)
      .select('*')
      .order('created_at', { ascending: false });

    usersLoading.style.display = 'none';

    if (error) {
      console.error('Error al cargar usuarios:', error);
      usersEmpty.textContent = 'Ocurrió un error al cargar los usuarios.';
      usersEmpty.style.display = 'block';
      return;
    }

    allUsers = data || [];
    applyFilter();
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

    submitBtn.disabled = true;
    submitBtn.textContent = isEditMode ? 'Guardando...' : 'Registrando...';

    const payload = {
      full_name: fullNameInput.value.trim(),
      email: emailInput.value.trim(),
      password: passwordInput.value,
    };

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
      showFeedback('No se pudo guardar el usuario. Intenta de nuevo.', 'error');
      return;
    }

    showFeedback(isEditMode ? 'Usuario actualizado correctamente.' : 'Usuario registrado correctamente.', 'success');
    await loadUsers();
    setTimeout(closeModal, 700);
  });

  /* =========================================================
     SUPABASE: ELIMINAR
     ========================================================= */
  async function handleDelete(id) {
    const user = allUsers.find((u) => u.id === id);
    const confirmed = confirm(`¿Eliminar al usuario "${user ? user.full_name : ''}"? Esta acción no se puede deshacer.`);
    if (!confirmed) return;

    const { error } = await supabaseClient
      .from(TABLE_NAME)
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error al eliminar usuario:', error);
      alert('No se pudo eliminar el usuario. Intenta de nuevo.');
      return;
    }

    await loadUsers();
  }

  /* =========================================================
     INICIO
     ========================================================= */
  loadUsers();
});
