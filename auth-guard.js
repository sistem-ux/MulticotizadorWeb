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
  ADMIN1: 'Usuario Master',
  ADMIN2: 'Gerente de Sucursal',
  COLABORADOR: 'Ejecutivo Comercial',
  ASESOR: 'Aliado Comercial',
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
  'fracciones.html': [ROLES.ADMIN1],
  'cotizador.html': [ROLES.ADMIN1,ROLES.ADMIN2, ROLES.COLABORADOR, ROLES.ASESOR, ROLES.VISITANTE],
  'cotizaciones.html': [ROLES.ADMIN1,ROLES.ADMIN2, ROLES.COLABORADOR, ROLES.ASESOR],
};

// -----------------------------------------------------------------------
// Acceso por MÓDULO (nueva vía, independiente del nombre del perfil).
// Cada página se asocia a la `key` de un registro de la tabla `modulos`.
// El acceso real se decide en requireAccess() usando la lista
// `modulos_permitidos` guardada por usuario (ver login_usuario RPC), no el
// nombre del perfil. Así, renombrar un perfil en la pestaña "Perfiles" no
// rompe el acceso de los usuarios ya logueados ni de los nuevos.
// PAGE_PERMISSIONS (arriba) se conserva solo como respaldo retrocompatible
// para perfiles antiguos que aún no tienen `modulos_permitidos` configurado.
// -----------------------------------------------------------------------
const PAGE_MODULO_KEY = {
  'dashboard.html': 'dashboard',
  'usuarios.html': 'usuarios',
  'aseguradoras.html': 'aseguradoras',
  'ramos.html': 'ramos',
  'clientes.html': 'clientes',
  'polizas.html': 'polizas',
  'fracciones.html': 'polizas',
  'cotizaciones.html': 'cotizaciones_salud',
  'cotizador.html': 'cotizador_salud',
};

/* -----------------------------------------------------------------------
   2. SESIÓN (localStorage)
   ----------------------------------------------------------------------- */
function getSession() {
  let modulosPermitidos = [];
  try {
    modulosPermitidos = JSON.parse(localStorage.getItem('userModulosPermitidos') || '[]');
  } catch { modulosPermitidos = []; }

  return {
    id: localStorage.getItem('userId') || null,
    email: localStorage.getItem('userEmail') || null,
    fullName: localStorage.getItem('userFullName') || null,
    role: localStorage.getItem('userRole') || null,
    sucursalId: localStorage.getItem('userSucursalId') || null,
    perfilId: localStorage.getItem('userPerfilId') || null,
    // Flag independiente del nombre del perfil (columna perfiles.es_administrador):
    // renombrar el perfil no afecta este valor ni el acceso del usuario.
    esAdministrador: localStorage.getItem('userEsAdministrador') === 'true',
    modulosPermitidos,
  };
}

// NOTA: principal.html debe pasar `sucursalId` (columna `sucursal_id` de la
// tabla usuarios) al hacer login, además de id/email/fullName/role. Sin este
// dato, el filtrado por sucursal en cotizaciones.js (perfil "Administrador
// Sucursal") no puede aplicarse.
// `esAdministrador` y `modulosPermitidos` vienen de la función RPC segura
// login_usuario() (ver SQL de seguridad de login y permisos de módulos).
function saveSession({ id, email, fullName, role, sucursalId, perfilId, esAdministrador, modulosPermitidos }) {
  if (id) localStorage.setItem('userId', id); else localStorage.removeItem('userId');
  if (email) localStorage.setItem('userEmail', email); else localStorage.removeItem('userEmail');
  if (fullName) localStorage.setItem('userFullName', fullName); else localStorage.removeItem('userFullName');
  if (sucursalId) localStorage.setItem('userSucursalId', sucursalId); else localStorage.removeItem('userSucursalId');
  if (perfilId) localStorage.setItem('userPerfilId', perfilId); else localStorage.removeItem('userPerfilId');
  localStorage.setItem('userRole', role);
  localStorage.setItem('userEsAdministrador', esAdministrador ? 'true' : 'false');
  localStorage.setItem('userModulosPermitidos', JSON.stringify(modulosPermitidos || []));
}

function clearSession() {
  localStorage.removeItem('userId');
  localStorage.removeItem('userEmail');
  localStorage.removeItem('userFullName');
  localStorage.removeItem('userRole');
  localStorage.removeItem('userSucursalId');
  localStorage.removeItem('userPerfilId');
  localStorage.removeItem('userEsAdministrador');
  localStorage.removeItem('userModulosPermitidos');
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

  // Alcance de sucursal (ve solo lo de su sucursal): cualquier perfil que
  // incluya "sucursal" en el nombre. Cubre tanto el perfil viejo
  // "Administrador Sucursal" como el nuevo "Gerente de Sucursal".
  if (p.includes('sucursal')) return 'admin_sucursal';

  // Alcance nacional (ve todo, sin filtrar). Cubre "Administrador" a secas
  // (retrocompatibilidad) y los nuevos "Usuario Master" / "Gerente Nacional".
  if (p.startsWith('administrador') || p === 'usuario master' || p === 'gerente nacional') {
    return 'admin_nacional';
  }

  // Alcance de ejecutivo (ve lo propio + lo de los asesores que lo tienen a
  // él como ejecutivo). Cubre "Colaborador" (viejo) y "Ejecutivo Comercial" (nuevo).
  if (p === 'colaborador' || p === 'ejecutivo comercial') return 'colaborador';

  // Alcance propio (solo lo suyo). Cubre "Asesor" (viejo) y los nuevos
  // "Aliado Comercial" / "Usuario de Sektor", y es el fallback ante
  // cualquier perfil no reconocido (el más restrictivo).
  return 'asesor';
}

function requireAccess(pageName) {
  const session = getSession();
  const allowedRoles = PAGE_PERMISSIONS[pageName] || [];

  if (!session.role) {
    window.location.href = 'principal.html';
    return null;
  }

  const esAdmin = session.esAdministrador || esPerfilAdministrador(session.role);
  const moduloKey = PAGE_MODULO_KEY[pageName];

  // Vía legado: nombre de rol en PAGE_PERMISSIONS (perfiles ya existentes).
  const accesoPorRolLegado = allowedRoles.includes(session.role)
    || (esPerfilAdministrador(session.role) && allowedRoles.includes(ROLES.ADMIN));
  // Vía nueva: módulo permitido por usuario, o administrador total. No
  // depende del nombre del perfil, así que sobrevive a un renombre.
  const accesoPorModulo = esAdmin || (!!moduloKey && session.modulosPermitidos.includes(moduloKey));

  const tieneAcceso = accesoPorRolLegado || accesoPorModulo;

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
// El Visitante no inicia sesión como usuario registrado (no tiene fila en
// `usuarios` ni `modulos_permitidos`), así que sigue controlado por
// data-roles. Todos los demás perfiles se filtran por `data-modulo`, que
// se compara contra `session.modulosPermitidos` (independiente del nombre
// del perfil). Si mañana se agrega un módulo/submenú nuevo, basta con
// insertarlo en la tabla `modulos` y asignarlo a los usuarios que
// corresponda desde el modal de Usuarios: no requiere tocar este archivo.
function filterSidebarByAccess(sidebarElement, session) {
  if (!sidebarElement) return;

  const esAdmin = session.esAdministrador || esPerfilAdministrador(session.role);
  const modulos = session.modulosPermitidos || [];

  sidebarElement.querySelectorAll('.menu-link').forEach((link) => {
    const container = link.closest('li') || link.closest('.menu-single') || link;

    if (session.role === ROLES.VISITANTE) {
      const allowedRoles = (link.dataset.roles || '').split(',').map((r) => r.trim());
      container.style.display = allowedRoles.includes(ROLES.VISITANTE) ? '' : 'none';
      return;
    }

    const moduloKey = link.dataset.modulo;
    if (!moduloKey) {
      // Enlace sin módulo asociado: se muestra siempre a usuarios logueados.
      container.style.display = '';
      return;
    }

    const puedeVer = esAdmin || modulos.includes(moduloKey);
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
        filterSidebarByAccess(sidebarElement, session);
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
