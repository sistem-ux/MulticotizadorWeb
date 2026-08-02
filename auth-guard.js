/* =============================================================================
   AUTH-GUARD.JS
   Control de sesión y de acceso por perfil (rol) de usuario.

   Se incluye en TODAS las páginas protegidas (dashboard.html, usuarios.html,
   cotizador.html) ANTES de su propio script, y se invoca así al final de
   cada una:

     <script src="auth-guard.js"></script>
     <script>
       document.addEventListener('DOMContentLoaded', () => {
         initAppShell({ pageName: 'dashboard.html' }); // <- nombre real del archivo
       });
     </script>

   La sesión se guarda en localStorage al hacer login en principal.html:
     userId, userEmail, userFullName, userRole (= columna `perfil` de la tabla usuarios)
   ============================================================================= */

/* -----------------------------------------------------------------------
   1. ROLES Y PERMISOS POR PÁGINA
   Ajusta este objeto para cambiar quién puede ver cada pantalla.
   ----------------------------------------------------------------------- */
const ROLES = {
  ADMIN: 'Administrador',
  COLABORADOR: 'Colaborador',
  ASESOR: 'Asesor',
  VISITANTE: 'Visitante',
};

const PAGE_PERMISSIONS = {
  'dashboard.html': [ROLES.ADMIN, ROLES.COLABORADOR, ROLES.ASESOR],
  'usuarios.html': [ROLES.ADMIN],
  'aseguradoras.html': [ROLES.ADMIN],
  'perfiles.html': [ROLES.ADMIN],
  'cotizador.html': [ROLES.ADMIN, ROLES.COLABORADOR, ROLES.ASESOR, ROLES.VISITANTE],
};

/* -----------------------------------------------------------------------
   2. SESIÓN (localStorage)
   ----------------------------------------------------------------------- */
function getSession() {
  return {
    id: localStorage.getItem('userId') || null,
    email: localStorage.getItem('userEmail') || null,
    fullName: localStorage.getItem('userFullName') || null,
    role: localStorage.getItem('userRole') || null,
  };
}

function saveSession({ id, email, fullName, role }) {
  if (id) localStorage.setItem('userId', id); else localStorage.removeItem('userId');
  if (email) localStorage.setItem('userEmail', email); else localStorage.removeItem('userEmail');
  if (fullName) localStorage.setItem('userFullName', fullName); else localStorage.removeItem('userFullName');
  localStorage.setItem('userRole', role);
}

function clearSession() {
  localStorage.removeItem('userId');
  localStorage.removeItem('userEmail');
  localStorage.removeItem('userFullName');
  localStorage.removeItem('userRole');
}

function logout() {
  clearSession();
  window.location.href = 'principal.html';
}

/* -----------------------------------------------------------------------
   3. GUARDIA DE ACCESO
   Si no hay sesión, o el rol actual no tiene permiso para esta página,
   redirige y devuelve null. Si todo está bien, devuelve la sesión.
   ----------------------------------------------------------------------- */
function requireAccess(pageName) {
  const session = getSession();
  const allowedRoles = PAGE_PERMISSIONS[pageName] || [];

  if (!session.role) {
    window.location.href = 'principal.html';
    return null;
  }

  if (!allowedRoles.includes(session.role)) {
    alert('No tienes permisos para acceder a esta sección con tu perfil actual.');
    window.location.href = session.role === ROLES.VISITANTE ? 'cotizador.html' : 'dashboard.html';
    return null;
  }

  return session;
}

/* -----------------------------------------------------------------------
   4. FILTRADO DEL MENÚ LATERAL SEGÚN EL PERFIL
   Los enlaces de sidebar.html que tengan data-roles="Administrador,Asesor"
   solo se muestran si el rol de la sesión está en esa lista.
   Un enlace sin data-roles se muestra siempre.
   ----------------------------------------------------------------------- */
function filterSidebarByRole(sidebarElement, role) {
  if (!sidebarElement) return;

  sidebarElement.querySelectorAll('.menu-link[data-roles]').forEach((link) => {
    const allowedRoles = link.dataset.roles.split(',').map((r) => r.trim());
    // El contenedor a ocultar puede ser un <li> (dentro de un submenú) o el
    // propio wrapper .menu-single (enlaces sueltos como "Dashboard").
    const container = link.closest('li') || link.closest('.menu-single') || link;
    container.style.display = allowedRoles.includes(role) ? '' : 'none';
  });

  // Si un grupo del menú se quedó sin enlaces visibles, se oculta el grupo completo
  sidebarElement.querySelectorAll('.menu-group').forEach((group) => {
    const items = Array.from(group.querySelectorAll('li'));
    const anyVisible = items.some((li) => li.style.display !== 'none');
    group.style.display = anyVisible ? '' : 'none';
  });
}

/* -----------------------------------------------------------------------
   5. INICIALIZACIÓN COMÚN DE LAS PÁGINAS PROTEGIDAS
   Carga el sidebar, aplica el filtro por rol, conecta el botón de
   mostrar/ocultar menú, y pinta el nombre de usuario + botón de cerrar sesión.
   ----------------------------------------------------------------------- */
async function initAppShell({ pageName }) {
  const session = requireAccess(pageName);
  if (!session) return; // ya fue redirigido

  const sidebarElement = document.getElementById('sidebar');
  if (sidebarElement) {
    try {
      const response = await fetch('sidebar.html');
      if (response.ok) {
        sidebarElement.innerHTML = await response.text();
        filterSidebarByRole(sidebarElement, session.role);
      } else {
        console.error('No se pudo cargar el archivo sidebar.html');
      }
    } catch (error) {
      console.error('Error de red al intentar cargar la barra lateral:', error);
    }
  }

  const mainContent = document.getElementById('mainContent');
  const sidebarToggle = document.getElementById('sidebarToggle');

  if (sidebarToggle && sidebarElement && mainContent) {
    sidebarToggle.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        sidebarElement.classList.toggle('is-mobile-visible');
      } else {
        sidebarElement.classList.toggle('is-hidden');
        mainContent.classList.toggle('is-expanded');
      }
    });
  }

  const loggedUserDisplay = document.getElementById('loggedUserDisplay');
  if (loggedUserDisplay) {
    loggedUserDisplay.innerHTML = '';
    loggedUserDisplay.style.display = 'flex';
    loggedUserDisplay.style.alignItems = 'center';
    loggedUserDisplay.style.gap = '0.75rem';

    const infoSpan = document.createElement('span');
    if (session.role === ROLES.VISITANTE) {
      infoSpan.textContent = 'Visitante';
    } else {
      infoSpan.textContent = `${session.fullName || session.email} · ${session.role}`;
    }
    infoSpan.style.fontWeight = '600';
    infoSpan.style.fontSize = '0.9rem';
    infoSpan.style.color = 'var(--color-navy)';

    const logoutBtn = document.createElement('button');
    logoutBtn.type = 'button';
    logoutBtn.textContent = 'Cerrar sesión';
    logoutBtn.className = 'btn-toggle';
    logoutBtn.addEventListener('click', logout);

    loggedUserDisplay.appendChild(infoSpan);
    loggedUserDisplay.appendChild(logoutBtn);
  }
}
