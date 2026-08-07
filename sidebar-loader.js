document.addEventListener('DOMContentLoaded', async () => {
  const sidebarElement = document.getElementById('sidebar');
  if (!sidebarElement) return;

  try {
    // 1. Cargar el HTML de la barra lateral de forma universal
    const response = await fetch('sidebar.html');
    const html = await response.text();
    sidebarElement.innerHTML = html;

    // 2. Filtrar enlaces según el perfil del usuario logueado (data-roles).
    //    Si el link/grupo no trae data-roles, se asume visible para todos.
    //    getSession() la expone auth-guard.js, que debe cargarse antes que
    //    este script en cada página. Si no hay sesión, se trata como Visitante.
    const currentRole = (typeof getSession === 'function' && getSession()?.perfil) || 'Visitante';

    sidebarElement.querySelectorAll('[data-roles]').forEach((el) => {
      const allowedRoles = el.dataset.roles.split(',').map((r) => r.trim());
      if (!allowedRoles.includes(currentRole)) {
        el.style.display = 'none';
      }
    });

    // Si a un grupo no le quedó ningún enlace visible, se oculta el grupo completo
    sidebarElement.querySelectorAll('.menu-group, .menu-single').forEach((container) => {
      const tieneEnlaceVisible = Array.from(container.querySelectorAll('.menu-link'))
        .some((link) => link.style.display !== 'none');
      if (!tieneEnlaceVisible) container.style.display = 'none';
    });

    // 3. Detectar la pantalla actual y marcar el enlace activo
    //    (se excluyen los href="" — enlaces placeholder aún sin implementar —
    //    para que no se marquen todos como activos a la vez).
    const currentPath = window.location.pathname.split('/').pop();
    const menuLinks = sidebarElement.querySelectorAll('.menu-link');
    let activeGroup = null;

    menuLinks.forEach((link) => {
      const href = link.getAttribute('href');
      if (href && href === currentPath) {
        link.style.background = 'rgba(255, 255, 255, 0.12)';
        link.style.color = '#FFFFFF';
        activeGroup = link.closest('.menu-group');
      }
    });

    // Expande el grupo que contiene el enlace activo (misma clase .is-open
    // que ya controla el acordeón vía CSS, sin depender de ningún hack aparte)
    if (activeGroup) activeGroup.classList.add('is-open');

    // 4. Acordeón: un solo listener por título de grupo, consistente con el
    //    CSS (.is-open). Solo un grupo abierto a la vez.
    const menuTitles = sidebarElement.querySelectorAll('.menu-group__title');
    menuTitles.forEach((title) => {
      title.addEventListener('click', () => {
        const group = title.parentElement;
        const wasOpen = group.classList.contains('is-open');
        sidebarElement.querySelectorAll('.menu-group').forEach((g) => g.classList.remove('is-open'));
        if (!wasOpen) group.classList.add('is-open');
      });
    });

  } catch (error) {
    console.error('Error al cargar la barra lateral:', error);
  }
});
