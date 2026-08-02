document.addEventListener('DOMContentLoaded', async () => {
  const sidebarElement = document.getElementById('sidebar');
  if (!sidebarElement) return;

  try {
    // 1. Cargar el HTML de la barra lateral de forma universal
    const response = await fetch('sidebar.html');
    const html = await response.text();
    sidebarElement.innerHTML = html;

    // 2. Lógica para detectar la pantalla actual y marcar el enlace activo
    const currentPath = window.location.pathname.split('/').pop();
    const menuLinks = sidebarElement.querySelectorAll('.menu-link');

    menuLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (href === currentPath) {
        link.style.background = 'rgba(255, 255, 255, 0.12)';
        link.style.color = '#FFFFFF';
        
        // Si está dentro de un submenú, asegurarse de expandir su grupo contenedor
        const parentList = link.closest('.menu-list');
        if (parentList) {
          parentList.classList.remove('is-hidden');
        }
      }
    });

    // 3. Activar la funcionalidad de acordeón para los títulos
    const menuTitles = sidebarElement.querySelectorAll('.menu-group__title');
    const menuLists = sidebarElement.querySelectorAll('.menu-list');

    menuTitles.forEach(title => {
      title.addEventListener('click', () => {
        const currentList = title.nextElementSibling;
        const isCurrentlyHidden = currentList.classList.contains('is-hidden');

        menuLists.forEach(list => list.classList.add('is-hidden'));

        if (isCurrentlyHidden) {
          currentList.classList.remove('is-hidden');
        }
      });
    });

  } catch (error) {
    console.error('Error al cargar la barra lateral:', error);
  }
});