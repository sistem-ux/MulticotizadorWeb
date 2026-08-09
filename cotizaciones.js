/* =============================================================
   CONFIGURACIÓN DE SUPABASE
   (Misma configuración que aseguradoras.js / usuarios.js / script.js —
   Project Settings > API en tu proyecto de Supabase)
   ============================================================= */
const SUPABASE_URL = 'https://cibtpkpxdrykozujaqba.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_zlp4_HGpTeAQKW55c_pZQA_2HEXRpaC';
const TABLE_COTIZACIONES = 'cotizaciones';

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

function formatMoney(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return '—';
  return num.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Recibe una fecha en formato ISO ("AAAA-MM-DD" o timestamptz) y la muestra
// como "DD/MM/AAAA", igual que en el resto del sistema (cotizador.js).
function formatDateEs(isoValue) {
  if (!isoValue) return '—';
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return '—';
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

function formatDateTimeEs(isoValue) {
  if (!isoValue) return '—';
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return '—';
  const fecha = formatDateEs(isoValue);
  const hora = date.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
  return `${fecha} ${hora}`;
}

// Arma el texto "Titular (38 años), Cónyuge (35 años), Hijo 1 (10 años)" a
// partir del grupo familiar guardado (mismo formato usado en el PDF del
// cotizador — ver buildGrupoFamiliarText en script.js).
function buildGrupoFamiliarText(integrantes) {
  if (!Array.isArray(integrantes) || integrantes.length === 0) return '—';
  return integrantes
    .map((m) => {
      const edad = getNumericAgeFromDate(m.fechaNacimiento);
      const edadTexto = edad >= 0 ? `${edad} años` : 'edad no indicada';
      return `${m.parentesco || 'Integrante'} (${edadTexto})`;
    })
    .join(', ');
}

function getNumericAgeFromDate(dateStr) {
  if (!dateStr) return -1;
  const bd = new Date(dateStr);
  if (Number.isNaN(bd.getTime())) return -1;
  const today = new Date();
  let age = today.getFullYear() - bd.getFullYear();
  const m = today.getMonth() - bd.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) age--;
  return age;
}

document.addEventListener('DOMContentLoaded', async () => {

  /* =========================================================
     ESTADO GENERAL Y NOTIFICACIONES
     ========================================================= */
  let allCotizaciones = [];
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

  /* =========================================================================
     ==========================  COTIZACIONES  =================================
     ========================================================================= */

  const searchCotizaciones = document.getElementById('searchCotizaciones');
  const clearSearchCotizaciones = document.getElementById('clearSearchCotizaciones');
  const filterTarifaCotizaciones = document.getElementById('filterTarifaCotizaciones');
  const cotizacionesTableBody = document.getElementById('cotizacionesTableBody');
  const cotizacionesLoading = document.getElementById('cotizacionesLoading');
  const cotizacionesEmpty = document.getElementById('cotizacionesEmpty');

  const cotizacionModalOverlay = document.getElementById('cotizacionModalOverlay');
  const cotizacionModalCloseBtn = document.getElementById('cotizacionModalCloseBtn');
  const closeCotizacionModalBtn = document.getElementById('closeCotizacionModalBtn');
  const cotizacionDetalleGenerales = document.getElementById('cotizacionDetalleGenerales');
  const cotizacionDetalleGrupoFamiliar = document.getElementById('cotizacionDetalleGrupoFamiliar');
  const cotizacionDetallePlanesBody = document.getElementById('cotizacionDetallePlanesBody');
  const cotizacionDetalleControl = document.getElementById('cotizacionDetalleControl');

  let currentSortCotizaciones = { key: 'fecha_creacion', direction: 'desc' };
  const sortableHeadersCotizaciones = document.querySelectorAll('#cotizacionesTable th.is-sortable');

  function detailItem(label, value) {
    return `
      <div class="detail-item">
        <span class="detail-item__label">${escapeHtml(label)}</span>
        <span class="detail-item__value">${value}</span>
      </div>
    `;
  }

  function openCotizacionModal(item) {
    const tarifaClass = item.tipo_tarifa === 'Continuidad' ? 'status-pill--continuidad' : 'status-pill--emision';

    cotizacionDetalleGenerales.innerHTML = [
      detailItem('Solicitante', escapeHtml(item.nombre_solicitante || '—')),
      detailItem('Elaborado por', escapeHtml(item.elaborado_por || '—')),
      detailItem('Tarifa', `<span class="status-pill ${tarifaClass}">${escapeHtml(item.tipo_tarifa || '—')}</span>`),
      detailItem('Vencimiento', formatDateEs(item.vencimiento)),
    ].join('');

    cotizacionDetalleGrupoFamiliar.textContent = buildGrupoFamiliarText(item.grupo_familiar);

    const planes = Array.isArray(item.planes) ? item.planes : [];
    if (planes.length === 0) {
      cotizacionDetallePlanesBody.innerHTML = `<tr><td colspan="5" class="detail-planes-empty">Esta cotización no tiene planes registrados.</td></tr>`;
    } else {
      cotizacionDetallePlanesBody.innerHTML = planes.map((p) => {
        const opcionales = Array.isArray(p.coberturas_opcionales) && p.coberturas_opcionales.length > 0
          ? p.coberturas_opcionales.map((c) => escapeHtml(c.nombre || c.key || '')).join(', ')
          : 'Ninguno';
        return `
          <tr>
            <td>${escapeHtml(p.aseguradora || '—')}</td>
            <td>${escapeHtml(p.producto || '—')}</td>
            <td>$${formatMoney(p.suma_asegurada)}</td>
            <td>${opcionales}</td>
            <td>$${formatMoney(p.total_anual)}</td>
          </tr>
        `;
      }).join('');
    }

    cotizacionDetalleControl.innerHTML = [
      detailItem('Creado por', escapeHtml(item.usuario_creador_nombre || '—')),
      detailItem('Fecha de creación', formatDateTimeEs(item.fecha_creacion)),
      detailItem('Modificado por', escapeHtml(item.usuario_modificador_nombre || '—')),
      detailItem('Última modificación', formatDateTimeEs(item.fecha_modificacion)),
    ].join('');

    cotizacionModalOverlay.classList.add('is-open');
  }

  function closeCotizacionModal() {
    cotizacionModalOverlay.classList.remove('is-open');
  }

  cotizacionModalCloseBtn.addEventListener('click', closeCotizacionModal);
  closeCotizacionModalBtn.addEventListener('click', closeCotizacionModal);
  cotizacionModalOverlay.addEventListener('click', (e) => {
    if (e.target === cotizacionModalOverlay) closeCotizacionModal();
  });

  function renderCotizaciones(items) {
    cotizacionesTableBody.innerHTML = '';
    if (!items.length) {
      cotizacionesEmpty.style.display = 'block';
      return;
    }
    cotizacionesEmpty.style.display = 'none';

    items.forEach((item) => {
      const tr = document.createElement('tr');
      const tarifaClass = item.tipo_tarifa === 'Continuidad' ? 'status-pill--continuidad' : 'status-pill--emision';
      const cantidadPlanes = Array.isArray(item.planes) ? item.planes.length : 0;

      tr.innerHTML = `
        <td data-label="Fecha">${formatDateEs(item.fecha_creacion)}</td>
        <td data-label="Solicitante">${escapeHtml(item.nombre_solicitante)}</td>
        <td data-label="Asesor">${escapeHtml(item.elaborado_por || '—')}</td>
        <td data-label="Tarifa"><span class="status-pill ${tarifaClass}">${escapeHtml(item.tipo_tarifa)}</span></td>
        <td data-label="Vencimiento">${formatDateEs(item.vencimiento)}</td>
        <td data-label="Acciones" class="col-actions">
          <button type="button" class="action-btn action-btn--view" data-id="${item.id}" aria-label="Ver cotización">👁️</button>
          <button type="button" class="action-btn action-btn--delete" data-id="${item.id}" aria-label="Eliminar cotización">🗑️</button>
        </td>
      `;
      cotizacionesTableBody.appendChild(tr);

      tr.querySelector('.action-btn--view').addEventListener('click', () => openCotizacionModal(item));
      tr.querySelector('.action-btn--delete').addEventListener('click', () => handleDeleteCotizacion(item.id));
    });
  }

  function sortCotizaciones(items, key, direction) {
    const factor = direction === 'desc' ? -1 : 1;
    return [...items].sort((a, b) => {
      if (key === 'fecha_creacion') {
        return (new Date(a.fecha_creacion) - new Date(b.fecha_creacion)) * factor;
      }
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

  sortableHeadersCotizaciones.forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sortKey;
      if (currentSortCotizaciones.key === key) {
        currentSortCotizaciones.direction = currentSortCotizaciones.direction === 'asc' ? 'desc' : 'asc';
      } else {
        currentSortCotizaciones = { key, direction: key === 'fecha_creacion' ? 'desc' : 'asc' };
      }
      updateSortIndicators(sortableHeadersCotizaciones, currentSortCotizaciones);
      applyFilterCotizaciones();
    });
  });
  updateSortIndicators(sortableHeadersCotizaciones, currentSortCotizaciones);

  function applyFilterCotizaciones() {
    const term = searchCotizaciones.value.trim().toLowerCase();
    const tarifaSeleccionada = filterTarifaCotizaciones.value;
    clearSearchCotizaciones.classList.toggle('is-visible', term.length > 0);

    let result = allCotizaciones;
    if (term) {
      result = result.filter((c) =>
        (c.nombre_solicitante || '').toLowerCase().includes(term) ||
        (c.elaborado_por || '').toLowerCase().includes(term)
      );
    }
    if (tarifaSeleccionada) {
      result = result.filter((c) => c.tipo_tarifa === tarifaSeleccionada);
    }
    result = sortCotizaciones(result, currentSortCotizaciones.key, currentSortCotizaciones.direction);
    renderCotizaciones(result);
  }

  searchCotizaciones.addEventListener('input', applyFilterCotizaciones);
  filterTarifaCotizaciones.addEventListener('change', applyFilterCotizaciones);
  clearSearchCotizaciones.addEventListener('click', () => {
    searchCotizaciones.value = '';
    applyFilterCotizaciones();
    searchCotizaciones.focus();
  });

  /* =========================================================
     VISIBILIDAD DE COTIZACIONES SEGÚN PERFIL
     Requiere que `cotizaciones` tenga la columna `usuario_creador_id`
     (uuid -> usuarios.id, NULL cuando la crea un Visitante sin sesión) y
     que auth-guard.js exponga getSession()/getRoleScope() (ver ese archivo
     para la definición de cada alcance).

       admin_nacional -> todas las cotizaciones, incluidas las de Visitante
       admin_sucursal -> solo las de usuarios de su misma sucursal
       colaborador    -> las propias + las de asesores que lo tienen a él
                         como ejecutivo (usuarios.ejecutivo_id = su id)
       asesor         -> solo las propias
     ========================================================= */
  function buildCotizacionesQuery() {
    const session = typeof getSession === 'function' ? getSession() : {};
    const scope = typeof getRoleScope === 'function' ? getRoleScope(session.role) : 'asesor';

    if (scope === 'admin_sucursal') {
      return supabaseClient
        .from(TABLE_COTIZACIONES)
        .select('*, usuarios:usuario_creador_id!inner(sucursal_id)')
        .eq('usuarios.sucursal_id', session.sucursalId);
    }
    if (scope === 'colaborador') {
      return supabaseClient
        .from(TABLE_COTIZACIONES)
        .select('*, usuarios:usuario_creador_id!inner(ejecutivo_id)')
        .eq('usuarios.ejecutivo_id', session.id);
    }
    if (scope === 'asesor') {
      return supabaseClient
        .from(TABLE_COTIZACIONES)
        .select('*')
        .eq('usuario_creador_id', session.id);
    }
    // admin_nacional (o alcance no reconocido): sin filtro, ve todo
    return supabaseClient.from(TABLE_COTIZACIONES).select('*');
  }

  async function loadCotizaciones() {
    cotizacionesLoading.style.display = 'block';
    cotizacionesEmpty.style.display = 'none';
    cotizacionesTableBody.innerHTML = '';

    if (!supabaseClient) {
      cotizacionesLoading.style.display = 'none';
      cotizacionesEmpty.textContent = 'Supabase no está inicializado.';
      cotizacionesEmpty.style.display = 'block';
      return;
    }

    try {
      const { data, error } = await buildCotizacionesQuery()
        .order('fecha_creacion', { ascending: false });

      cotizacionesLoading.style.display = 'none';

      if (error) {
        cotizacionesEmpty.textContent = `Error al cargar cotizaciones: ${getErrorMessage(error)}`;
        cotizacionesEmpty.style.display = 'block';
        return;
      }

      // El join embebido `usuarios` solo se usa para filtrar en el servidor;
      // se descarta para no interferir con el resto del render.
      allCotizaciones = (data || []).map(({ usuarios, ...c }) => c);
      applyFilterCotizaciones();
    } catch (err) {
      cotizacionesLoading.style.display = 'none';
      cotizacionesEmpty.textContent = `No se pudo conectar con Supabase: ${getErrorMessage(err)}`;
      cotizacionesEmpty.style.display = 'block';
    }
  }

  async function handleDeleteCotizacion(id) {
    const confirmed = await openConfirmDialog({
      title: 'Eliminar cotización',
      message: '¿Eliminar esta cotización? Esta acción no se puede deshacer.',
      acceptLabel: 'Eliminar',
    });
    if (!confirmed) return;

    const { error } = await supabaseClient.from(TABLE_COTIZACIONES).delete().eq('id', id);
    if (error) {
      showNotification('cotizacionesNotification', `No se pudo eliminar: ${getErrorMessage(error)}`, 'error');
      return;
    }

    showNotification('cotizacionesNotification', 'Cotización eliminada correctamente.', 'success');
    await loadCotizaciones();
  }

  /* =========================================================
     INICIALIZACIÓN
     ========================================================= */
  await initSupabase();
  await loadCotizaciones();
});
