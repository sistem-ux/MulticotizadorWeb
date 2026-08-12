/* =============================================================
   CONFIGURACIÓN DE SUPABASE
   (Misma configuración que aseguradoras.js / usuarios.js / cotizaciones.js)
   ============================================================= */
const SUPABASE_URL = 'https://cibtpkpxdrykozujaqba.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_zlp4_HGpTeAQKW55c_pZQA_2HEXRpaC';
const TABLE_COTIZACIONES = 'cotizaciones';
const TABLE_USUARIOS = 'usuarios';

/* Año a partir del cual existe el sistema. La lista del filtro de años se
   genera dinámicamente entre este valor y el año actual, así que al llegar
   un nuevo año (ej. 2027) aparecerá solo, sin tocar código. */
const AÑO_BASE = 2026;

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

let supabaseClient = null;

async function initSupabase() {
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return;
  }
  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm');
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (err) {
    console.error('No se pudo importar Supabase:', err);
  }
}

function getErrorMessage(error) {
  if (!error) return 'Error desconocido.';
  if (typeof error === 'string') return error;
  const parts = [];
  if (error.message) parts.push(error.message);
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

/* Paleta de colores del sistema (design tokens de dashboard.html) para los
   gráficos de Chart.js, en orden de preferencia. */
const CHART_PALETTE = ['#001F5B', '#2C7D3C', '#A6A9B0', '#0A2E70', '#5B9BD5', '#E8A33D', '#C0392B', '#7F8C9A'];

document.addEventListener('DOMContentLoaded', async () => {

  const kpiSection = document.getElementById('kpiSection');
  const kpiLoading = document.getElementById('kpiLoading');
  const kpiError = document.getElementById('kpiError');

  const kpiTotalCotizacionesEl = document.getElementById('kpiTotalCotizaciones');
  const kpiUsuariosCard = document.getElementById('kpiUsuariosCard');
  const kpiUsuariosEl = document.getElementById('kpiUsuariosRegistrados');
  const kpiVisitantesCard = document.getElementById('kpiVisitantesCard');
  const kpiVisitantesEl = document.getElementById('kpiCotizacionesVisitantes');

  const chartSucursalCard = document.getElementById('chartSucursalCard');
  const chartAsesorCard = document.getElementById('chartAsesorCard');
  const chartCompaniaCard = document.getElementById('chartCompaniaCard');

  const kpiFilterYearEl = document.getElementById('kpiFilterYear');
  const kpiFilterMonthEl = document.getElementById('kpiFilterMonth');

  /* =========================================================
     ALCANCE DE VISIBILIDAD (mismo criterio que cotizaciones.js,
     ver getRoleScope() en auth-guard.js):
       admin_nacional -> todas las cotizaciones, incluidas las de Visitante
       admin_sucursal -> solo las de usuarios de su misma sucursal
       colaborador    -> las propias + las de asesores que lo tienen a él
                         como ejecutivo
       asesor         -> solo las propias
     ========================================================= */
  // PostgREST convierte `.eq(columna, null)` en `columna=eq.null`, y Postgres
  // intenta castear el texto "null" a uuid -> error 22P02. Para comparar
  // contra NULL hay que usar `.is()`. Este helper elige el método correcto
  // según si el valor a comparar viene o no.
  function eqOrIsNull(query, column, value) {
    return (value === null || value === undefined)
      ? query.is(column, null)
      : query.eq(column, value);
  }

  function buildCotizacionesQuery(session, scope) {
    const baseSelect = 'id, elaborado_por, planes, fecha_creacion, usuario_creador_id';

    if (scope === 'admin_sucursal') {
      const query = supabaseClient
        .from(TABLE_COTIZACIONES)
        .select(`${baseSelect}, creador:usuario_creador_id!inner(sucursal_id)`);
      return eqOrIsNull(query, 'creador.sucursal_id', session.sucursalId);
    }
    if (scope === 'colaborador') {
      const query = supabaseClient
        .from(TABLE_COTIZACIONES)
        .select(`${baseSelect}, creador:usuario_creador_id!inner(ejecutivo_id)`);
      return eqOrIsNull(query, 'creador.ejecutivo_id', session.id);
    }
    if (scope === 'asesor') {
      const query = supabaseClient
        .from(TABLE_COTIZACIONES)
        .select(baseSelect);
      return eqOrIsNull(query, 'usuario_creador_id', session.id);
    }
    // admin_nacional (o alcance no reconocido): sin filtro, incluye Visitante
    return supabaseClient
      .from(TABLE_COTIZACIONES)
      .select(`${baseSelect}, creador:usuario_creador_id(full_name, sucursal:sucursal_id(sucursal))`);
  }

  /* Trae los usuarios visibles según el alcance del perfil (mismo criterio
     de sucursal usado en buildCotizacionesQuery para admin_sucursal), junto
     con su fecha_creacion, para poder filtrarlos por año/mes en memoria sin
     volver a consultar Supabase cada vez que cambia el filtro.

     NOTA: se asume que la tabla `usuarios` tiene una columna `fecha_creacion`
     (mismo nombre usado en `cotizaciones`). Si en el esquema real la columna
     se llama distinto (ej. `created_at`), ajustar el valor de
     USUARIOS_FECHA_COLUMNA abajo. */
  const USUARIOS_FECHA_COLUMNA = 'fecha_creacion';

  async function fetchUsuariosData(session, scope) {
    let query = supabaseClient.from(TABLE_USUARIOS).select(`id, ${USUARIOS_FECHA_COLUMNA}`);
    if (scope === 'admin_sucursal') {
      query = query.eq('sucursal_id', session.sucursalId);
    }
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  /* =========================================================
     FILTRO POR AÑO / MES
     ========================================================= */
  function populateYearFilter(selectEl) {
    const currentYear = new Date().getFullYear();
    const maxYear = Math.max(currentYear, AÑO_BASE);
    selectEl.innerHTML = '';
    for (let y = maxYear; y >= AÑO_BASE; y--) {
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = String(y);
      selectEl.appendChild(opt);
    }
    selectEl.value = String(maxYear);
  }

  function populateMonthFilter(selectEl) {
    selectEl.innerHTML = '';
    const optTodos = document.createElement('option');
    optTodos.value = 'todos';
    optTodos.textContent = 'Todos';
    selectEl.appendChild(optTodos);

    MESES.forEach((mes, idx) => {
      const opt = document.createElement('option');
      opt.value = String(idx); // 0 = Enero ... 11 = Diciembre
      opt.textContent = mes;
      selectEl.appendChild(opt);
    });

    selectEl.value = 'todos';
  }

  function filtrarPorFecha(items, year, month, fechaKey = 'fecha_creacion') {
    return items.filter((item) => {
      const valorFecha = item[fechaKey];
      if (!valorFecha) return false;
      const fecha = new Date(valorFecha);
      if (fecha.getFullYear() !== year) return false;
      if (month !== 'todos' && fecha.getMonth() !== Number(month)) return false;
      return true;
    });
  }

  /* =========================================================
     AGREGACIONES (a partir de las cotizaciones ya filtradas)
     ========================================================= */
  function agruparPorSucursal(items) {
    const counts = new Map();
    items.forEach((item) => {
      const nombre = item.creador?.sucursal?.sucursal || 'Sin sucursal (Visitante)';
      counts.set(nombre, (counts.get(nombre) || 0) + 1);
    });
    return counts;
  }

  function agruparPorAsesor(items) {
    const counts = new Map();
    items.forEach((item) => {
      const nombre = (item.elaborado_por || '').trim() || 'Sin especificar';
      counts.set(nombre, (counts.get(nombre) || 0) + 1);
    });
    return counts;
  }

  function agruparPorCompania(items) {
    const counts = new Map();
    items.forEach((item) => {
      const planes = Array.isArray(item.planes) ? item.planes : [];
      planes.forEach((p) => {
        const nombre = (p.aseguradora || '').trim() || 'Sin especificar';
        counts.set(nombre, (counts.get(nombre) || 0) + 1);
      });
    });
    return counts;
  }

  function mapToSortedEntries(map, limit) {
    const entries = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    return limit ? entries.slice(0, limit) : entries;
  }

  /* =========================================================
     RENDER DE TARJETAS KPI (solo cantidad)
     ========================================================= */
  function renderKpiCard(el, value) {
    if (!el) return;
    el.textContent = Number(value).toLocaleString('es-VE');
  }

  /* =========================================================
     RENDER DE GRÁFICOS (Chart.js, cargado desde dashboard.html)
     ========================================================= */
  const chartInstances = {};

  function destroyChart(canvasId) {
    if (chartInstances[canvasId]) {
      chartInstances[canvasId].destroy();
      delete chartInstances[canvasId];
    }
  }

  function renderBarChart(canvasId, entries, label) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
    destroyChart(canvasId);

    chartInstances[canvasId] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: entries.map(([nombre]) => nombre),
        datasets: [{
          label,
          data: entries.map(([, valor]) => valor),
          backgroundColor: entries.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]),
          borderRadius: 6,
          maxBarThickness: 42,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    });
  }

  function renderDoughnutChart(canvasId, entries, label) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
    destroyChart(canvasId);

    chartInstances[canvasId] = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: entries.map(([nombre]) => nombre),
        datasets: [{
          label,
          data: entries.map(([, valor]) => valor),
          backgroundColor: entries.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]),
          borderWidth: 2,
          borderColor: '#FFFFFF',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
      },
    });
  }

  function renderEmptyState(cardEl, hasData) {
    if (!cardEl) return;
    const emptyEl = cardEl.querySelector('.chart-empty');
    if (emptyEl) emptyEl.style.display = hasData ? 'none' : 'block';
    const canvasWrap = cardEl.querySelector('.chart-canvas-wrap');
    if (canvasWrap) canvasWrap.style.display = hasData ? 'block' : 'none';
  }

  /* =========================================================
     ESTADO EN MEMORIA + RENDER SEGÚN FILTROS
     (las cotizaciones y usuarios se traen una sola vez desde Supabase;
     año y mes se aplican en el cliente, sin volver a consultar)
     ========================================================= */
  let allCotizaciones = [];
  let allUsuarios = [];
  let currentScope = null;

  function renderDashboardData(cotizaciones, usuarios, scope) {
    renderKpiCard(kpiTotalCotizacionesEl, cotizaciones.length);

    if (scope === 'admin_nacional' || scope === 'admin_sucursal') {
      renderKpiCard(kpiUsuariosEl, usuarios.length);
    }

    if (scope === 'admin_nacional') {
      const visitantes = cotizaciones.filter((c) => !c.usuario_creador_id).length;
      renderKpiCard(kpiVisitantesEl, visitantes);

      const porSucursal = mapToSortedEntries(agruparPorSucursal(cotizaciones));
      renderEmptyState(chartSucursalCard, porSucursal.length > 0);
      if (porSucursal.length) {
        renderBarChart('chartSucursal', porSucursal, 'Cotizaciones');
      } else {
        destroyChart('chartSucursal');
      }
    }

    if (scope !== 'asesor') {
      const porAsesor = mapToSortedEntries(agruparPorAsesor(cotizaciones), 10);
      renderEmptyState(chartAsesorCard, porAsesor.length > 0);
      if (porAsesor.length) {
        renderBarChart('chartAsesor', porAsesor, 'Cotizaciones');
      } else {
        destroyChart('chartAsesor');
      }
    }

    const porCompania = mapToSortedEntries(agruparPorCompania(cotizaciones));
    renderEmptyState(chartCompaniaCard, porCompania.length > 0);
    if (porCompania.length) {
      renderDoughnutChart('chartCompania', porCompania, 'Planes cotizados');
    } else {
      destroyChart('chartCompania');
    }
  }

  function applyFilters() {
    const year = Number(kpiFilterYearEl.value);
    const month = kpiFilterMonthEl.value;
    const cotizacionesFiltradas = filtrarPorFecha(allCotizaciones, year, month, 'fecha_creacion');
    const usuariosFiltrados = filtrarPorFecha(allUsuarios, year, month, USUARIOS_FECHA_COLUMNA);
    renderDashboardData(cotizacionesFiltradas, usuariosFiltrados, currentScope);
  }

  kpiFilterYearEl.addEventListener('change', applyFilters);
  kpiFilterMonthEl.addEventListener('change', applyFilters);

  /* =========================================================
     CARGA PRINCIPAL
     ========================================================= */
  async function loadDashboard() {
    kpiLoading.style.display = 'block';
    kpiError.style.display = 'none';
    kpiSection.style.display = 'none';

    populateYearFilter(kpiFilterYearEl);
    populateMonthFilter(kpiFilterMonthEl);

    if (!supabaseClient) {
      kpiLoading.style.display = 'none';
      kpiError.textContent = 'Supabase no está inicializado.';
      kpiError.style.display = 'block';
      return;
    }

    const session = getSession();
    const scope = getRoleScope(session.role);

    // Aviso temprano: un "Administrador Sucursal" sin sucursal_id en su
    // sesión no puede filtrar por sucursal (ver saveSession en auth-guard.js
    // y el login en principal.html, que debe enviar ese dato).
    if (scope === 'admin_sucursal' && !session.sucursalId) {
      kpiLoading.style.display = 'none';
      kpiError.textContent = 'Tu usuario no tiene una sucursal asignada en la sesión; no se pueden calcular los indicadores. Contacta al administrador.';
      kpiError.style.display = 'block';
      return;
    }

    // Visibilidad de tarjetas/gráficos según alcance del perfil
    kpiUsuariosCard.style.display = (scope === 'admin_nacional' || scope === 'admin_sucursal') ? '' : 'none';
    kpiVisitantesCard.style.display = scope === 'admin_nacional' ? '' : 'none';
    chartSucursalCard.style.display = scope === 'admin_nacional' ? '' : 'none';
    chartAsesorCard.style.display = scope === 'asesor' ? 'none' : '';
    chartCompaniaCard.style.display = '';

    try {
      const { data, error } = await buildCotizacionesQuery(session, scope);
      if (error) throw error;

      allCotizaciones = data || [];
      currentScope = scope;

      if (scope === 'admin_nacional' || scope === 'admin_sucursal') {
        allUsuarios = await fetchUsuariosData(session, scope);
      } else {
        allUsuarios = [];
      }

      applyFilters();

      kpiLoading.style.display = 'none';
      kpiSection.style.display = 'grid';
    } catch (err) {
      kpiLoading.style.display = 'none';
      kpiError.textContent = `No se pudieron cargar los indicadores: ${getErrorMessage(err)}`;
      kpiError.style.display = 'block';
    }
  }

  await initSupabase();
  await loadDashboard();
});
