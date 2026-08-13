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
  ADMIN1: 'Administrador Nacional',
  ADMIN2: 'Administrador Sucursal',
  COLABORADOR: 'Colaborador',
  ASESOR: 'Asesor',
  VISITANTE: 'Visitante',
};

const PAGE_PERMISSIONS = {
  'dashboard.html': [ROLES.ADMIN1,ROLES.ADMIN2, ROLES.COLABORADOR, ROLES.ASESOR],
  'usuarios.html': [ROLES.ADMIN1],
  'aseguradoras.html': [ROLES.ADMIN1],
  'clientes.html': [ROLES.ADMIN1],
  'planes.html': [ROLES.ADMIN1],
  'perfiles.html': [ROLES.ADMIN1],
  'ramos.html': [ROLES.ADMIN1],
  'polizas.html': [ROLES.ADMIN1],
  'cotizador.html': [ROLES.ADMIN1,ROLES.ADMIN2, ROLES.COLABORADOR, ROLES.ASESOR, ROLES.VISITANTE],
  'cotizaciones.html': [ROLES.ADMIN1,ROLES.ADMIN2, ROLES.COLABORADOR, ROLES.ASESOR],
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
    sucursalId: localStorage.getItem('userSucursalId') || null,
  };
}

// NOTA: principal.html debe pasar `sucursalId` (columna `sucursal_id` de la
// tabla usuarios) al hacer login, además de id/email/fullName/role. Sin este
// dato, el filtrado por sucursal en cotizaciones.js (perfil "Administrador
// Sucursal") no puede aplicarse.
function saveSession({ id, email, fullName, role, sucursalId }) {
  if (id) localStorage.setItem('userId', id); else localStorage.removeItem('userId');
  if (email) localStorage.setItem('userEmail', email); else localStorage.removeItem('userEmail');
  if (fullName) localStorage.setItem('userFullName', fullName); else localStorage.removeItem('userFullName');
  if (sucursalId) localStorage.setItem('userSucursalId', sucursalId); else localStorage.removeItem('userSucursalId');
  localStorage.setItem('userRole', role);
}

function clearSession() {
  localStorage.removeItem('userId');
  localStorage.removeItem('userEmail');
  localStorage.removeItem('userFullName');
  localStorage.removeItem('userRole');
  localStorage.removeItem('userSucursalId');
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
// El perfil real de un usuario (columna `perfil` en la tabla usuarios) puede
// venir con variantes como "Administrador Nacional" o "Administrador
// Sucursal" además de "Administrador" a secas (ver perfiles.html). Para el
// control de acceso por página, cualquier perfil que EMPIECE con
// "Administrador" se trata como ROLES.ADMIN.
function esPerfilAdministrador(perfilNombre) {
  return (perfilNombre || '').trim().toLowerCase().startsWith('administrador');
}

// -----------------------------------------------------------------------
// Alcance de visibilidad de datos (usado por cotizaciones.js y cualquier
// otra pantalla que deba filtrar registros por perfil/sucursal/ejecutivo).
//   admin_nacional  -> ve todo, sin filtrar
//   admin_sucursal  -> ve solo lo asociado a su sucursal
//   colaborador     -> ve lo propio + lo de los asesores que lo tienen
//                       a él como ejecutivo
//   asesor          -> ve solo lo propio
// "Administrador" a secas (sin sufijo) se trata como alcance nacional, por
// retrocompatibilidad con perfiles ya creados antes de existir la variante
// "Administrador Sucursal".
// -----------------------------------------------------------------------
function getRoleScope(perfilNombre) {
  const p = (perfilNombre || '').trim().toLowerCase();
  if (p.startsWith('administrador')) {
    return p.includes('sucursal') ? 'admin_sucursal' : 'admin_nacional';
  }
  if (p === 'colaborador') return 'colaborador';
  if (p === 'asesor') return 'asesor';
  return 'asesor'; // fallback más restrictivo ante un perfil no reconocido
}

function requireAccess(pageName) {
  const session = getSession();
  const allowedRoles = PAGE_PERMISSIONS[pageName] || [];

  if (!session.role) {
    window.location.href = 'principal.html';
    return null;
  }

  const tieneAcceso = allowedRoles.includes(session.role)
    || (esPerfilAdministrador(session.role) && allowedRoles.includes(ROLES.ADMIN));

  if (!tieneAcceso) {
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
    const puedeVer = allowedRoles.includes(role)
      || (esPerfilAdministrador(role) && allowedRoles.includes(ROLES.ADMIN));
    container.style.display = puedeVer ? '' : 'none';
  });

  // Si un grupo del menú se quedó sin enlaces visibles, se oculta el grupo completo
  sidebarElement.querySelectorAll('.menu-group').forEach((group) => {
    const items = Array.from(group.querySelectorAll('li'));
    const anyVisible = items.some((li) => li.style.display !== 'none');
    group.style.display = anyVisible ? '' : 'none';
  });
}

/* -----------------------------------------------------------------------
   4b. ENLACE ACTIVO + ACORDEÓN DEL MENÚ LATERAL
   sidebar.html ya no trae lógica propia embebida (ni onclick inline ni
   hacks): todo el comportamiento del sidebar se centraliza aquí, que es
   el único lugar desde donde realmente se carga (initAppShell). Así se
   evita duplicar esta lógica en un segundo archivo que termine
   desincronizado o sin conectarse a ninguna página.
   ----------------------------------------------------------------------- */
function highlightActiveSidebarLink(sidebarElement, pageName) {
  if (!sidebarElement) return null;
  let activeGroup = null;

  sidebarElement.querySelectorAll('.menu-link').forEach((link) => {
    const href = link.getAttribute('href');
    // Se excluyen los href="" (enlaces placeholder aún sin implementar) para
    // que no se marquen todos como "activos" al mismo tiempo.
    if (href && href === pageName) {
      link.style.background = 'rgba(255, 255, 255, 0.12)';
      link.style.color = '#FFFFFF';
      activeGroup = link.closest('.menu-group');
    }
  });

  return activeGroup;
}

function setupSidebarAccordion(sidebarElement, initiallyOpenGroup) {
  if (!sidebarElement) return;

  const allGroups = sidebarElement.querySelectorAll('.menu-group');

  // Expande el grupo del enlace activo (si el filtro por rol no lo ocultó)
  if (initiallyOpenGroup && initiallyOpenGroup.style.display !== 'none') {
    initiallyOpenGroup.classList.add('is-open');
  }

  sidebarElement.querySelectorAll('.menu-group__title').forEach((title) => {
    title.addEventListener('click', () => {
      const group = title.parentElement;
      const wasOpen = group.classList.contains('is-open');
      // Cierra cualquier grupo que esté desplegado en ese momento...
      allGroups.forEach((g) => g.classList.remove('is-open'));
      // ...y abre el que se acaba de presionar (si no era el que ya estaba abierto)
      if (!wasOpen) group.classList.add('is-open');
    });
  });
}

/* -----------------------------------------------------------------------
   4c. OVERLAY DE FONDO PARA EL SIDEBAR EN MÓVIL
   Se inyecta una única vez (estilos + elemento) y se reutiliza en cada
   llamada a initAppShell. Vive fuera del <aside id="sidebar"> porque el
   sidebar tiene `transform` en su CSS, y un elemento position:fixed dentro
   de un ancestro con transform queda posicionado relativo a ese ancestro
   en vez de a la ventana completa.
   ----------------------------------------------------------------------- */
function ensureSidebarOverlay() {
  let overlay = document.getElementById('sidebarOverlay');
  if (overlay) return overlay;

  if (!document.getElementById('sidebarOverlayStyles')) {
    const style = document.createElement('style');
    style.id = 'sidebarOverlayStyles';
    style.textContent = `
      .sidebar-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.45);
        z-index: 95;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.25s ease;
      }
      .sidebar-overlay.is-visible {
        opacity: 1;
        pointer-events: auto;
      }
      @media (min-width: 769px) {
        .sidebar-overlay { display: none; }
      }
    `;
    document.head.appendChild(style);
  }

  overlay = document.createElement('div');
  overlay.id = 'sidebarOverlay';
  overlay.className = 'sidebar-overlay';
  document.body.appendChild(overlay);
  return overlay;
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
        const activeGroup = highlightActiveSidebarLink(sidebarElement, pageName);
        setupSidebarAccordion(sidebarElement, activeGroup);
      } else {
        console.error('No se pudo cargar el archivo sidebar.html');
      }
    } catch (error) {
      console.error('Error de red al intentar cargar la barra lateral:', error);
    }
  }

  const mainContent = document.getElementById('mainContent');
  const sidebarToggle = document.getElementById('sidebarToggle');

  if (sidebarElement) {
    const sidebarOverlay = ensureSidebarOverlay();
    const sidebarCloseBtn = sidebarElement.querySelector('#sidebarCloseBtn');

    // Cierra el sidebar sin importar si estamos en el layout de escritorio
    // (donde "cerrado" = colapsado con is-hidden) o en el overlay móvil
    // (donde "cerrado" = quitar is-mobile-visible + apagar el overlay).
    const closeSidebar = () => {
      if (window.innerWidth <= 768) {
        sidebarElement.classList.remove('is-mobile-visible');
        sidebarOverlay.classList.remove('is-visible');
      } else {
        sidebarElement.classList.add('is-hidden');
        if (mainContent) mainContent.classList.add('is-expanded');
      }
    };

    if (sidebarToggle && mainContent) {
      sidebarToggle.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
          const isNowVisible = sidebarElement.classList.toggle('is-mobile-visible');
          sidebarOverlay.classList.toggle('is-visible', isNowVisible);
        } else {
          sidebarElement.classList.toggle('is-hidden');
          mainContent.classList.toggle('is-expanded');
        }
      });
    }

    if (sidebarCloseBtn) {
      sidebarCloseBtn.addEventListener('click', closeSidebar);
    }

    sidebarOverlay.addEventListener('click', closeSidebar);

    // Clic fuera del sidebar: solo aplica en el modo overlay móvil. En
    // escritorio el sidebar es parte fija del layout, así que un clic en el
    // contenido no debe cerrarlo (sería molesto mientras se trabaja).
    document.addEventListener('click', (event) => {
      const isMobileOpen = sidebarElement.classList.contains('is-mobile-visible');
      if (!isMobileOpen) return;
      const clickedInsideSidebar = sidebarElement.contains(event.target);
      const clickedToggleBtn = sidebarToggle && sidebarToggle.contains(event.target);
      if (!clickedInsideSidebar && !clickedToggleBtn) {
        closeSidebar();
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
