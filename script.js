/* =============================================================
   CONFIGURACIÓN DE SUPABASE
   (Misma configuración que aseguradoras.js / usuarios.js —
   Project Settings > API en tu proyecto de Supabase)
   ============================================================= */
const SUPABASE_URL = 'https://cibtpkpxdrykozujaqba.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_zlp4_HGpTeAQKW55c_pZQA_2HEXRpaC';
const TABLE_PLANES = 'planes';
const TABLE_TARIFAS = 'tarifas';
const TABLE_USUARIOS = 'usuarios';

/* Logo de Bareca Sociedad de Corretaje usado en el encabezado del PDF de
   cotización. Coloca el archivo entregado (bareca-logo.png) en esta ruta
   relativa al proyecto, o cámbiala por la URL pública del logo si prefieres
   subirlo al bucket de Storage (mismo patrón que los logos de aseguradoras). */
const BARECA_LOGO_URL = 'assets/bareca-logo.png';

/* Debe coincidir con las 9 coberturas fijas definidas en aseguradoras.js
   (COVERAGE_LIST), ya que las tarifas se guardan en la BD con estas mismas
   claves dentro de la columna jsonb "coberturas". */
const COVERAGE_LIST = [
  { key: 'funerarios', label: 'Funerarios' },
  { key: 'asistencia_viajes', label: 'Asistencia en viajes' },
  { key: 'invalidez_permanente', label: 'Invalidez permanente' },
  { key: 'muerte_accidental', label: 'Muerte accidental' },
  { key: 'odontologia', label: 'Odontología' },
  { key: 'oftalmologia', label: 'Oftalmología' },
  { key: 'dermatologia', label: 'Dermatología' },
  { key: 'psicologia', label: 'Psicología' },
  { key: 'servicios_adicionales', label: 'Servicios Adicionales' },
];

/* Mismo catálogo de rangos etarios usado en aseguradoras.js (Tarifas por
   rango etario), necesario aquí para ubicar la tarifa que corresponde a
   la edad de cada integrante. */
const AGE_RANGES = [
  { key: '00-09', min: 0, max: 9 }, { key: '10-15', min: 10, max: 15 }, { key: '16-17', min: 16, max: 17 },
  { key: '18-18', min: 18, max: 18 }, { key: '19-19', min: 19, max: 19 }, { key: '20-24', min: 20, max: 24 },
  { key: '25-29', min: 25, max: 29 }, { key: '30-30', min: 30, max: 30 }, { key: '31-34', min: 31, max: 34 },
  { key: '35-35', min: 35, max: 35 }, { key: '36-39', min: 36, max: 39 }, { key: '40-40', min: 40, max: 40 },
  { key: '41-44', min: 41, max: 44 }, { key: '45-45', min: 45, max: 45 }, { key: '46-49', min: 46, max: 49 },
  { key: '50-50', min: 50, max: 50 }, { key: '51-54', min: 51, max: 54 }, { key: '55-55', min: 55, max: 55 },
  { key: '56-59', min: 56, max: 59 }, { key: '60-60', min: 60, max: 60 }, { key: '61-64', min: 61, max: 64 },
  { key: '65-65', min: 65, max: 65 }, { key: '66-69', min: 66, max: 69 }, { key: '70-70', min: 70, max: 70 },
  { key: '71-74', min: 71, max: 74 }, { key: '75-75', min: 75, max: 75 }, { key: '76-79', min: 76, max: 79 },
  { key: '80-80', min: 80, max: 80 }, { key: '81-84', min: 81, max: 84 }, { key: '85-85', min: 85, max: 85 },
  { key: '86-89', min: 86, max: 89 }, { key: '90-90', min: 90, max: 90 }, { key: '91-94', min: 91, max: 94 },
  { key: '95-95', min: 95, max: 95 }, { key: '96-99', min: 96, max: 99 },
];

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

document.addEventListener('DOMContentLoaded', async () => {

  /* =========================================================
     REFERENCIAS DEL DOM
     ========================================================= */
  const applicantNameInput = document.getElementById('applicantName');
  const elaboradoPorInput = document.getElementById('elaboradoPorInput');
  const elaboradoPorSelect = document.getElementById('elaboradoPorSelect');
  const elaboradoPorHint = document.getElementById('elaboradoPorHint');
  const tarifaTipoSelect = document.getElementById('tarifaTipoSelect');
  const tableBody = document.getElementById('familyTableBody');
  const rowTemplate = document.getElementById('rowTemplate');
  const addChildBtn = document.getElementById('addChildBtn');
  const showPlansBtn = document.getElementById('showPlansBtn');
  const modifyDataBtn = document.getElementById('modifyDataBtn');
  const plansContainer = document.getElementById('plansContainer'); 

  // Referencias a la ventana modal
  const coveragesModal = document.getElementById('coveragesModal');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const modalCoveragesBody = document.getElementById('modalCoveragesBody');
  const saveCoveragesBtn = document.getElementById('saveCoveragesBtn');

  // Referencias al filtro de aseguradoras y a la comparación de planes
  const insurerFilterBar = document.getElementById('insurerFilterBar');
  const comparisonBar = document.getElementById('comparisonBar');
  const comparisonCountText = document.getElementById('comparisonCountText');
  const viewComparisonBtn = document.getElementById('viewComparisonBtn');
  const comparisonModal = document.getElementById('comparisonModal');
  const closeComparisonModalBtn = document.getElementById('closeComparisonModalBtn');
  const comparisonTableWrapper = document.getElementById('comparisonTableWrapper');
  const comparisonPrintHeader = document.getElementById('comparisonPrintHeader');
  const exportComparisonBtn = document.getElementById('exportComparisonBtn');

  const MAX_PLANES_COMPARACION = 4;

  let childCount = 0;
  let currentSelectedPlanId = null; // Para saber a qué plan le estamos agregando adicionales
  let planSelectionOrder = []; // IDs de los planes marcados para comparar, en orden de selección
  let planesDisponiblesActuales = []; // Últimos planes traídos de Supabase (sin filtrar por aseguradora)
  let integrantesActuales = []; // Últimos integrantes usados para calcular la cotización
  let elaboradoPorActual = ''; // Nombre final de "Elaborado por" usado en la última cotización
  let tarifaTipoActual = 'Emisión'; // "Emisión" o "Continuidad", usado en la última cotización
  let usuariosContactoPorNombre = {}; // { [full_name]: { email, telefono } } — para el encabezado del PDF
  let activeInsurerFilters = new Set(); // Nombres de aseguradoras activas en el filtro
  const coberturasSeleccionadasPorPlan = {}; // { [planId]: string[] } — persiste al re-renderizar tarjetas (filtro, etc.)
  let isFamilyLocked = false;

  // Se inicializa temprano para que esté listo cuando el usuario presione "Mostrar planes"
  await initSupabase();

  /* =========================================================
     1. FORMATEO "TIPO ORACIÓN" DEL NOMBRE
     ========================================================= */
  function toTitleCaseLive(value) {
    return value
      .toLowerCase()
      .replace(/(^|\s|['-])([a-záéíóúñü])/g, (match, sep, letter) => sep + letter.toUpperCase());
  }

  function validateApplicantName() {
    const input = applicantNameInput;
    const value = input.value.trim();
    const lettersCount = value.replace(/[^a-záéíóúñü]/gi, '').length;
    const isValid = lettersCount >= 3;

    input.classList.toggle('has-error', !isValid);
    input.setAttribute('aria-invalid', isValid ? 'false' : 'true');
    return isValid;
  }

  applicantNameInput.addEventListener('input', (e) => {
    const input = e.target;
    const cursorPos = input.selectionStart;
    const originalLength = input.value.length;

    const formatted = toTitleCaseLive(input.value);
    input.value = formatted;

    const newLength = formatted.length;
    const diff = newLength - originalLength;
    input.setSelectionRange(cursorPos + diff, cursorPos + diff);
    validateApplicantName();
  });

  /* =========================================================
     1.1 "ELABORADO POR" — según el perfil de la sesión
     (getSession() la expone auth-guard.js, cargado antes que este script)
     - Visitante: escribe el nombre manualmente (mismo formato "tipo oración").
     - Asesor: nombre de la sesión, fijo y deshabilitado.
     - Colaborador / Administrador: por defecto el usuario de la sesión,
       pero puede elegir cualquier otro usuario activo registrado.
     ========================================================= */
  function validateElaboradoPor() {
    const session = getSession();
    if (session.role === 'Administrador' || session.role === 'Colaborador') {
      const isValid = !!elaboradoPorSelect.value;
      elaboradoPorSelect.classList.toggle('has-error', !isValid);
      elaboradoPorSelect.setAttribute('aria-invalid', isValid ? 'false' : 'true');
      return isValid;
    }
    if (session.role === 'Asesor') return true; // valor fijo, siempre viene de la sesión

    // Visitante: mismo criterio que el nombre del solicitante (mínimo 3 letras)
    const value = elaboradoPorInput.value.trim();
    const lettersCount = value.replace(/[^a-záéíóúñü]/gi, '').length;
    const isValid = lettersCount >= 3;
    elaboradoPorInput.classList.toggle('has-error', !isValid);
    elaboradoPorInput.setAttribute('aria-invalid', isValid ? 'false' : 'true');
    return isValid;
  }

  function getElaboradoPorValue() {
    const session = getSession();
    if (session.role === 'Administrador' || session.role === 'Colaborador') {
      return elaboradoPorSelect.value;
    }
    return elaboradoPorInput.value.trim();
  }

  // Carga una sola vez el correo y teléfono de los usuarios activos, para
  // poder mostrarlos junto al nombre del asesor en el encabezado del PDF
  // (independiente del rol de la sesión: Visitante, Asesor, Colaborador o
  // Administrador). Requiere la columna "telefono" en la tabla usuarios
  // (ver script SQL 17_add_telefono_usuarios.sql).
  async function loadUsuariosContacto() {
    if (!supabaseClient) return [];

    try {
      const { data, error } = await supabaseClient
        .from(TABLE_USUARIOS)
        .select('id, full_name, email, telefono, status')
        .eq('status', 'Activo')
        .order('full_name', { ascending: true });

      if (error) {
        console.error('No se pudo cargar el contacto de usuarios:', getErrorMessage(error));
        return [];
      }

      usuariosContactoPorNombre = {};
      (data || []).forEach((u) => {
        if (!u.full_name) return;
        usuariosContactoPorNombre[u.full_name] = { email: u.email || '', telefono: u.telefono || '' };
      });

      return data || [];
    } catch (err) {
      console.error('No se pudo conectar con Supabase (usuarios):', getErrorMessage(err));
      return [];
    }
  }

  // Devuelve { email, telefono } para el nombre de asesor indicado, con
  // fallback al correo de la sesión actual si no se encuentra registrado
  // (por ejemplo, cuando un Visitante escribe un nombre libre).
  function resolveAsesorContacto(nombreAsesor) {
    const registrado = usuariosContactoPorNombre[nombreAsesor];
    if (registrado) return registrado;
    const session = getSession();
    return { email: session.email || '', telefono: '' };
  }

  async function populateElaboradoPorSelect(session, usuarios) {
    elaboradoPorSelect.innerHTML = '<option value="">Selecciona un usuario</option>';

    const nombres = (usuarios || []).map((u) => u.full_name).filter(Boolean);

    // Si el usuario de la sesión no aparece entre los usuarios activos
    // (caso borde), se agrega igual como opción para no perder el valor
    // por defecto.
    const currentName = session.fullName;
    if (currentName && !nombres.includes(currentName)) nombres.unshift(currentName);

    nombres.forEach((nombre) => {
      const opt = document.createElement('option');
      opt.value = nombre;
      opt.textContent = nombre;
      elaboradoPorSelect.appendChild(opt);
    });

    if (currentName && nombres.includes(currentName)) {
      elaboradoPorSelect.value = currentName;
    }
  }

  async function setupElaboradoPor() {
    const session = getSession();
    const role = session.role;
    const usuarios = await loadUsuariosContacto();

    if (role === 'Visitante') {
      elaboradoPorInput.style.display = '';
      elaboradoPorSelect.style.display = 'none';
      elaboradoPorInput.disabled = false;
      elaboradoPorInput.value = '';
      elaboradoPorHint.textContent = 'Escribe el nombre de quien elabora la cotización.';
    } else if (role === 'Asesor') {
      elaboradoPorInput.style.display = '';
      elaboradoPorSelect.style.display = 'none';
      elaboradoPorInput.disabled = true;
      elaboradoPorInput.value = session.fullName || session.email || '';
      elaboradoPorHint.textContent = 'Se usa el nombre de tu usuario registrado.';
    } else {
      // Administrador o Colaborador
      elaboradoPorInput.style.display = 'none';
      elaboradoPorSelect.style.display = '';
      elaboradoPorSelect.disabled = false;
      elaboradoPorHint.textContent = 'Por defecto se usa tu nombre; puedes seleccionar otro usuario registrado.';
      await populateElaboradoPorSelect(session, usuarios);
    }
  }

  elaboradoPorInput.addEventListener('input', (e) => {
    // Solo tiene efecto cuando el campo está habilitado (perfil Visitante);
    // para Asesor el campo está deshabilitado y no dispara "input".
    const input = e.target;
    const cursorPos = input.selectionStart;
    const originalLength = input.value.length;

    const formatted = toTitleCaseLive(input.value);
    input.value = formatted;

    const newLength = formatted.length;
    const diff = newLength - originalLength;
    input.setSelectionRange(cursorPos + diff, cursorPos + diff);
    validateElaboradoPor();
  });

  elaboradoPorSelect.addEventListener('change', validateElaboradoPor);

  await setupElaboradoPor();

  /* =========================================================
     2. UTILIDADES DE FECHA / EDAD
     ========================================================= */
  function parseDateValue(value) {
    if (!value) return null;
    const trimmed = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const [year, month, day] = trimmed.split('-').map(Number);
      const parsed = new Date(year, month - 1, day);
      if (parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day) {
        return parsed;
      }
    }
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
      const [day, month, year] = trimmed.split('/').map(Number);
      const parsed = new Date(year, month - 1, day);
      if (parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day) {
        return parsed;
      }
    }
    return null;
  }

  // --- NUEVO: Función auxiliar para calcular diferencia exacta en días ---
  function calculateAgeInDays(dateStr) {
    const bd = parseDateValue(dateStr);
    if (!bd) return 0;
    const today = new Date();
    // Si la fecha de nacimiento es futura (error), retornamos 0
    if (bd > today) return 0;
    // Diferencia en milisegundos
    const diffTime = today - bd;
    // Convertir milisegundos a días (1000ms * 60s * 60m * 24h)
    // Usamos Math.floor para obtener días completos cumplidos
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  }
  // -----------------------------------------------------------------------

  function formatDateForDisplay(value) {
    const parsedDate = parseDateValue(value);
    if (!parsedDate) return '';
    const day = String(parsedDate.getDate()).padStart(2, '0');
    const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
    const year = parsedDate.getFullYear();
    return `${day}/${month}/${year}`;
  }

  function formatDateInputValue(value) {
    const cleaned = String(value || '').replace(/\D/g, '').slice(0, 8);
    if (cleaned.length <= 2) return cleaned;
    if (cleaned.length <= 4) return `${cleaned.slice(0, 2)}/${cleaned.slice(2)}`;
    return `${cleaned.slice(0, 2)}/${cleaned.slice(2, 4)}/${cleaned.slice(4, 8)}`;
  }

  function calculateAge(birthDateStr) {
    const birthDate = parseDateValue(birthDateStr);
    if (!birthDate) return '';
    const today = new Date();
    if (birthDate > today) return '';
    let years = today.getFullYear() - birthDate.getFullYear();
    let months = today.getMonth() - birthDate.getMonth();
    let days = today.getDate() - birthDate.getDate();
    if (days < 0) {
      months -= 1;
      const prevMonth = new Date(today.getFullYear(), today.getMonth(), 0);
      days += prevMonth.getDate();
    }
    if (months < 0) {
      years -= 1;
      months += 12;
    }
    if (years >= 1) return `${years} año${years !== 1 ? 's' : ''}`;
    if (months >= 1) return `${months} mes${months !== 1 ? 'es' : ''}`;
    return `${Math.max(days, 0)} día${days !== 1 ? 's' : ''}`;
  }

  function validateDateForRow(row) {
    const checkbox = row.querySelector('.row-checkbox');
    const dateInput = row.querySelector('.date-input');
    const shouldRequireDate = checkbox.checked && !dateInput.disabled;
    const hasValidDate = !shouldRequireDate || Boolean(formatDateForDisplay(dateInput.value));
    row.classList.toggle('has-error', shouldRequireDate && !hasValidDate);
    dateInput.setAttribute('aria-invalid', shouldRequireDate && !hasValidDate ? 'true' : 'false');
    return hasValidDate;
  }

  function validateGenderForRow(row) {
    const relation = row.dataset.relation || '';
    const checkbox = row.querySelector('.row-checkbox');
    const genderSelect = row.querySelector('.gender-select');
    const requiresGender = relation === 'Titular' || (relation === 'Cónyuge' && checkbox.checked);
    const hasValidGender = !requiresGender || (genderSelect && genderSelect.value);
    if (genderSelect) {
      genderSelect.classList.toggle('has-error', !hasValidGender);
      genderSelect.setAttribute('aria-invalid', !hasValidGender ? 'true' : 'false');
    }
    return hasValidGender;
  }

  function validateFamilyForm() {
    const rows = Array.from(tableBody.querySelectorAll('.family-row'));
    let allValid = true;
    rows.forEach((row) => {
      const validDate = validateDateForRow(row);
      const validGender = validateGenderForRow(row);
      const rowHasError = !validDate || !validGender;
      row.classList.toggle('has-error', rowHasError);
      allValid = allValid && !rowHasError;
    });
    return allValid;
  }

  function setFamilyFormLocked(locked) {
    isFamilyLocked = locked;

    // El campo "Elaborado por" se bloquea junto con el resto del formulario
    // (para Asesor ya viene deshabilitado siempre, así que no hay cambio).
    const session = getSession();
    if (session.role === 'Administrador' || session.role === 'Colaborador') {
      elaboradoPorSelect.disabled = locked;
    } else if (session.role === 'Visitante') {
      elaboradoPorInput.disabled = locked;
    }

    const rows = Array.from(tableBody.querySelectorAll('.family-row'));

    rows.forEach((row) => {
      const checkbox = row.querySelector('.row-checkbox');
      const dateInput = row.querySelector('.date-input');
      const ageInput = row.querySelector('.age-input');
      const genderSelect = row.querySelector('.gender-select');
      const relation = row.dataset.relation || '';
      const isChecked = checkbox.checked;
      const isTitular = relation === 'Titular';

      checkbox.disabled = locked || isTitular || row.dataset.baseCheckboxDisabled === 'true';

      if (locked) {
        dateInput.disabled = true;
        ageInput.disabled = true;
        row.classList.add('is-disabled');
        genderSelect.disabled = true;
      } else {
        const shouldDisableDate = !isChecked;
        dateInput.disabled = shouldDisableDate;
        ageInput.disabled = shouldDisableDate;
        row.classList.toggle('is-disabled', !isChecked);
        const isGenderEditable = relation === 'Titular' || relation === 'Cónyuge';
        genderSelect.disabled = !isGenderEditable || !isChecked;
      }
    });

    updateGenderControls();
    updateAddChildButtonState();
  }

  function updateGenderControls() {
    const rows = Array.from(tableBody.querySelectorAll('.family-row'));
    const titularRow = rows.find((row) => row.dataset.relation === 'Titular');
    const titularGender = titularRow?.querySelector('.gender-select')?.value || '';
    const spouseRow = rows.find((row) => row.dataset.relation === 'Cónyuge');
    const spouseCheckbox = spouseRow?.querySelector('.row-checkbox');
    const spouseGenderSelect = spouseRow?.querySelector('.gender-select');

    rows.forEach((row) => {
      const relation = row.dataset.relation || '';
      const genderSelect = row.querySelector('.gender-select');
      const checkbox = row.querySelector('.row-checkbox');

      if (relation === 'Titular') {
        const currentValue = genderSelect.value || titularGender;
        genderSelect.innerHTML = `<option value="">—</option><option value="M"${currentValue === 'M' ? ' selected' : ''}>M</option><option value="F"${currentValue === 'F' ? ' selected' : ''}>F</option>`;
        genderSelect.disabled = isFamilyLocked || false;
        return;
      }
      if (relation === 'Cónyuge') {
        const allowedGenders = titularGender === 'M' ? ['F'] : titularGender === 'F' ? ['M'] : ['M', 'F'];
        const currentValue = spouseGenderSelect?.value || '';
        const validCurrentValue = currentValue && allowedGenders.includes(currentValue) ? currentValue : '';
        genderSelect.innerHTML = `<option value="">—</option>` + allowedGenders.map(val => `<option value="${val}"${val === validCurrentValue ? ' selected' : ''}>${val}</option>`).join('');
        if (!checkbox.checked) {
          genderSelect.value = '';
          genderSelect.disabled = true;
        } else {
          genderSelect.value = validCurrentValue || '';
          genderSelect.disabled = isFamilyLocked;
        }
        return;
      }
      genderSelect.innerHTML = '<option value="">—</option><option value="M">M</option><option value="F">F</option>';
      genderSelect.value = '';
      genderSelect.disabled = true;
    });

    if (spouseGenderSelect && spouseCheckbox && !spouseCheckbox.checked) {
      spouseGenderSelect.value = '';
    }
  }

  /* =========================================================
     3. EVENTOS DE FILAS
     ========================================================= */
  function attachRowEvents(row) {
    const checkbox = row.querySelector('.row-checkbox');
    const dateInput = row.querySelector('.date-input');
    const ageInput = row.querySelector('.age-input');
    const genderSelect = row.querySelector('.gender-select');
    const relation = row.dataset.relation || '';
    const isChildRow = relation.startsWith('Hijo ');
    const isFirstChildRow = relation === 'Hijo 1';

    checkbox.addEventListener('change', () => {
      const isUnchecked = !checkbox.checked;
      if (isUnchecked && isChildRow) {
        const childRows = getChildRows();
        const currentIndex = childRows.indexOf(row);
        if (currentIndex >= 0) {
          if (isFirstChildRow) childRows.slice(1).forEach(r => r.remove());
          else childRows.slice(currentIndex).forEach(r => r.remove());
        }
        updateChildRows();
      }
      if (isUnchecked) {
        dateInput.value = ''; ageInput.value = '';
        dateInput.disabled = true; ageInput.disabled = true;
        row.classList.add('is-disabled');
      } else {
        dateInput.disabled = false; ageInput.disabled = false;
        row.classList.remove('is-disabled');
      }
      validateDateForRow(row);
      updateGenderControls();
      updateAddChildButtonState();
    });

    genderSelect.addEventListener('change', () => {
      if (relation === 'Titular' || relation === 'Cónyuge') updateGenderControls();
      // Re-validate this row when gender changes
      validateGenderForRow(row);
    });

    dateInput.addEventListener('input', () => {
      dateInput.value = formatDateInputValue(dateInput.value);
      ageInput.value = calculateAge(formatDateForDisplay(dateInput.value));
      validateDateForRow(row);
    });

    dateInput.addEventListener('blur', () => {
      dateInput.value = formatDateInputValue(dateInput.value);
      validateDateForRow(row);
    });
  }

  function getChildRows() {
    return Array.from(tableBody.querySelectorAll('.family-row')).filter(row => row.dataset.relation?.startsWith('Hijo '));
  }

  function updateChildRows() {
    getChildRows().forEach((row, index) => {
      row.dataset.relation = `Hijo ${index + 1}`;
      row.querySelector('.relation-name').textContent = `Hijo ${index + 1}`;
    });
    updateAddChildButtonState();
  }

  function updateAddChildButtonState() {
    const childRows = getChildRows();
    const lastCheckbox = childRows[childRows.length - 1]?.querySelector('.row-checkbox');
    addChildBtn.disabled = isFamilyLocked || !lastCheckbox || !lastCheckbox.checked;
  }

  function createRow(relationName, { checked = true, disabledCheckbox = false } = {}) {
    const row = rowTemplate.content.cloneNode(true).querySelector('.family-row');
    row.querySelector('.relation-name').textContent = relationName;
    row.dataset.relation = relationName;
    const checkbox = row.querySelector('.row-checkbox');
    const genderSelect = row.querySelector('.gender-select');
    row.dataset.baseCheckboxDisabled = String(disabledCheckbox);
    checkbox.checked = checked;
    checkbox.disabled = disabledCheckbox;
    genderSelect.disabled = !(relationName === 'Titular' || relationName === 'Cónyuge');
    if (!checked) {
      row.querySelector('.date-input').disabled = true;
      row.querySelector('.age-input').disabled = true;
      row.classList.add('is-disabled');
      if (relationName === 'Cónyuge') genderSelect.value = '';
    }
    attachRowEvents(row);
    return row;
  }

  function initRows() {
    tableBody.appendChild(createRow('Titular', { checked: true, disabledCheckbox: true }));
    tableBody.appendChild(createRow('Cónyuge', { checked: false }));
    tableBody.appendChild(createRow('Madre', { checked: false }));
    tableBody.appendChild(createRow('Padre', { checked: false }));
    tableBody.appendChild(createRow('Hijo 1', { checked: false }));
    updateChildRows();
    updateGenderControls();
  }
  initRows();
  setFamilyFormLocked(false);

  addChildBtn.addEventListener('click', () => {
    tableBody.appendChild(createRow(`Hijo ${getChildRows().length + 1}`, { checked: true }));
    updateChildRows();
    updateGenderControls();
    setFamilyFormLocked(isFamilyLocked);
  });

  modifyDataBtn.addEventListener('click', () => {
    planSelectionOrder = [];
    currentSelectedPlanId = null;
    planesDisponiblesActuales = [];
    integrantesActuales = [];
    activeInsurerFilters.clear();
    Object.keys(coberturasSeleccionadasPorPlan).forEach(key => delete coberturasSeleccionadasPorPlan[key]);
    plansContainer.innerHTML = '';
    plansContainer.style.display = 'none';
    insurerFilterBar.innerHTML = '';
    insurerFilterBar.style.display = 'none';
    comparisonBar.classList.remove('is-visible');
    setFamilyFormLocked(false);
    showPlansBtn.disabled = false;
    modifyDataBtn.disabled = true;
  });

  /* =========================================================
     4. FUNCIONAMIENTO DE LA VENTANA MODAL 
     ========================================================= */
  
  // Cerrar modal al hacer clic en la "X"
  closeModalBtn.addEventListener('click', () => {
    coveragesModal.classList.remove('active');
  });

  // Guardar adicionales (incluyendo suma y prima) y mostrarlos en el plan
  // correspondiente. Se guarda el objeto completo (no solo el texto) para
  // que el motor de cálculo pueda sumar las primas reales.
  saveCoveragesBtn.addEventListener('click', () => {
    const rows = modalCoveragesBody.querySelectorAll('div[style*="display: flex"]');
    const seleccionados = [];
    let validacionExitosa = true;
    const plan = planesDisponiblesActuales.find((p) => p.id === currentSelectedPlanId);

    // Usamos un bucle for tradicional para poder detener la ejecución si falta una suma
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const chk = row.querySelector('.modal-cov-checkbox');
      const sel = row.querySelector('.modal-cov-sum');

      if (chk && chk.checked) {
        const index = Number(chk.dataset.index);
        const adicional = plan?.coberturasAdicionales?.[index];
        if (!adicional) continue;

        if (adicional.porServicio) {
          // Cobertura "por Servicio": no requiere seleccionar suma, la prima
          // ya viene fija desde la configuración de la tarifa.
          seleccionados.push({
            key: adicional.key,
            nombre: adicional.nombre,
            sumaAsegurada: null,
            prima: Number(adicional.prima) || 0,
            porServicio: true,
            isMaternidad: !!adicional.isMaternidad,
          });
          continue;
        }

        // VALIDACIÓN: Si el checkbox está marcado, el select NO puede estar vacío
        if (!sel || !sel.value) {
          const nombreCobertura = row.querySelector('span')?.textContent.trim() || 'la cobertura';
          alert(`Por favor selecciona una suma asegurada para la cobertura: ${nombreCobertura}`);
          validacionExitosa = false;
          break; // Detenemos el bucle
        }

        const sumaValue = Number(sel.value);
        const sumaObj = adicional.sumas.find((s) => Number(s.suma_asegurada) === sumaValue);

        seleccionados.push({
          key: adicional.key,
          nombre: adicional.nombre,
          sumaAsegurada: sumaValue,
          prima: sumaObj ? Number(sumaObj.prima) : 0,
          porServicio: false,
          isMaternidad: !!adicional.isMaternidad,
        });
      }
    }

    // Si la validación falló (falta alguna suma), detenemos la función aquí
    if (!validacionExitosa) {
      return; 
    }

    // Si todo está correcto, guardamos en el estado persistente (sobrevive a
    // que las tarjetas se vuelvan a dibujar, p. ej. al cambiar el filtro de
    // aseguradora) y actualizamos la vista antes de cerrar el modal.
    coberturasSeleccionadasPorPlan[currentSelectedPlanId] = seleccionados;
    aplicarTextoCoberturasEnTarjeta(currentSelectedPlanId);

    coveragesModal.classList.remove('active');
  });

  // Pinta (o limpia) el texto de adicionales de una tarjeta a partir del
  // estado persistente. Se usa tanto al guardar en el modal como al volver
  // a renderizar las tarjetas (por ejemplo, tras cambiar el filtro).
  function aplicarTextoCoberturasEnTarjeta(planId) {
    const targetDiv = document.getElementById(`selected_cov_text_${planId}`);
    if (!targetDiv) return;
    const seleccionados = coberturasSeleccionadasPorPlan[planId] || [];
    if (seleccionados.length > 0) {
      targetDiv.style.display = 'block';
      targetDiv.textContent = `Adicionales: ${seleccionados.map((s) => s.porServicio ? s.nombre : `${s.nombre} ($${formatCurrencyThousands(s.sumaAsegurada)})`).join(', ')}`;
    } else {
      targetDiv.style.display = 'none';
      targetDiv.textContent = '';
    }
  }

  /* =========================================================
     5. MOTOR DE COTIZACIÓN — datos reales desde Supabase
     ========================================================= */

  // Formatea un número con separador de miles (mismo criterio que aseguradoras.js)
  function formatCurrencyThousands(value) {
    if (value === null || value === undefined || value === '') return '';
    return Number(value).toLocaleString('es-VE');
  }

  // Escapa texto antes de insertarlo como HTML (nombre del plan, mensajes de error)
  function escapeHtmlLocal(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
  }

  /* Convierte la columna jsonb "coberturas" (y "maternidad") de una tarifa
     en la lista de "adicionales" seleccionables que espera el modal de
     Coberturas Adicionales de este cotizador. Solo se incluyen las
     coberturas marcadas como "Opcional" en Registro de Planes: las que
     están "Incluido" ya forman parte del plan base (no se seleccionan) y
     las "No contempla" no aplican para ese plan. */
  function buildCoberturasAdicionales(tarifa) {
    if (!tarifa) return [];
    const adicionales = [];

    COVERAGE_LIST.forEach((def) => {
      const cov = tarifa.coberturas ? tarifa.coberturas[def.key] : null;
      if (!cov || cov.estado !== 'Opcional') return;

      if (cov.servicios) {
        // Modo "Servicios": no se maneja Suma Asegurada, solo una Prima fija.
        // Se selecciona con un simple checkbox, sin desplegable de suma.
        const row = (cov.sumas || []).find((s) => s.prima != null);
        if (!row) return;
        adicionales.push({ key: def.key, nombre: def.label, porServicio: true, prima: Number(row.prima), isMaternidad: false });
        return;
      }

      const sumas = (cov.sumas || []).filter((s) => s.suma_asegurada != null && s.prima != null);
      if (!sumas.length) return;
      adicionales.push({ key: def.key, nombre: def.label, sumas, porServicio: false, isMaternidad: false });
    });

    // La Maternidad se mantiene disponible en el mismo modal de "+ Adicionales"
    // (misma interacción para el usuario), pero se marca con isMaternidad para
    // que el motor de cálculo la sume aparte y nunca dentro de "Coberturas
    // Adicionales".
    const mat = tarifa.maternidad;
    if (mat && mat.estado === 'Opcional') {
      const sumas = (mat.sumas || []).filter((s) => s.suma_asegurada != null && s.prima != null);
      if (sumas.length) {
        adicionales.push({ key: 'maternidad', nombre: 'Maternidad', sumas, isMaternidad: true });
      }
    }

    return adicionales;
  }

  /* Trae de Supabase los planes con status "Activo" que además tengan una
     tarifa con status "Actualizada" asociada (sin tarifa actualizada, el
     plan no se puede cotizar). Devuelve cada plan ya enriquecido con su
     tarifa y con "coberturasAdicionales" listo para el modal. */
  async function fetchPlanesCotizables() {
    if (!supabaseClient) {
      return { planes: [], error: 'No se pudo conectar con Supabase.' };
    }

    const [planesRes, tarifasRes] = await Promise.all([
      // NOTA: tras la migración de esquema (script 11), las tablas son
      // "aseguradora" y "producto" (singular); se ajustan aquí los alias de
      // relación y se agrega logo_url para el encabezado del PDF. Revisa
      // esta consulta cuando termines de conectar el motor de cotización
      // completo al esquema actual (tarifas, planes, etc.).
      supabaseClient.from(TABLE_PLANES).select('*, aseguradora:aseguradoras(nombre, logo_url), producto:productos(nombre)').eq('status', 'Activo'),
      supabaseClient.from(TABLE_TARIFAS).select('*').eq('status', 'Actualizada'),
    ]);

    if (planesRes.error) return { planes: [], error: getErrorMessage(planesRes.error) };
    if (tarifasRes.error) return { planes: [], error: getErrorMessage(tarifasRes.error) };

    const tarifaPorPlanId = new Map((tarifasRes.data || []).map((t) => [t.plan_id, t]));

    const planes = (planesRes.data || [])
      .filter((plan) => tarifaPorPlanId.has(plan.id)) // solo planes con tarifa actualizada
      .map((plan) => {
        const tarifa = tarifaPorPlanId.get(plan.id);
        return {
          ...plan,
          _tarifa: tarifa,
          coberturasAdicionales: buildCoberturasAdicionales(tarifa),
          aseguradora_nombre: plan.aseguradora?.nombre || 'Sin aseguradora',
          aseguradora_logo: plan.aseguradora?.logo_url || null,
          producto_nombre: plan.producto?.nombre || 'Sin producto',
        };
      });

    return { planes, error: null };
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

  function getNumericAge(dateStr) {
    const bd = parseDateValue(dateStr);
    if (!bd) return -1;
    const today = new Date();
    let age = today.getFullYear() - bd.getFullYear();
    const m = today.getMonth() - bd.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) age--;
    return age;
  }

  // Actualiza el estado visual (tarjeta, título, insignia y botón) según si
  // el plan está marcado o no para comparación. La insignia solo indica
  // "Seleccionado", sin número de orden ni fecha/hora.
  function applyPlanSelectionState(card, planId) {
    const isSelected = planSelectionOrder.includes(planId);
    const title = card.querySelector('.plan-title');
    const badge = card.querySelector('.plan-selection-badge');
    const button = card.querySelector('.select-plan-btn');

    if (isSelected) {
      card.classList.add('is-selected');
      title.classList.add('is-selected');
      badge.classList.add('is-active');
      badge.textContent = 'Seleccionado';
      button.textContent = 'Quitar de comparación';
      button.classList.remove('btn--primary');
      button.classList.add('btn--secondary');
    } else {
      card.classList.remove('is-selected');
      title.classList.remove('is-selected');
      badge.classList.remove('is-active');
      badge.textContent = 'Sin seleccionar';
      button.textContent = 'Comparar';
      button.classList.remove('btn--secondary');
      button.classList.add('btn--primary');
    }
  }

  // Actualiza la barra flotante de comparación (contador + botón "Ver comparación")
  function updateComparisonBar() {
    const count = planSelectionOrder.length;
    comparisonCountText.textContent = `${count} de ${MAX_PLANES_COMPARACION} planes seleccionados`;
    comparisonBar.classList.toggle('is-visible', count > 0);
  }

  // Determina si la regla de maternidad de un plan aplica para el grupo
  // familiar actualmente cotizado (Titular o Cónyuge mujer dentro del rango
  // de edad de maternidad configurado en el plan).
  function aplicaMaternidadParaPlan(plan) {
    return integrantesActuales.some(miembro => {
      if (miembro.parentesco !== 'Titular' && miembro.parentesco !== 'Cónyuge') return false;
      if (miembro.genero !== 'F') return false;
      const edadNum = getNumericAge(miembro.fechaNacimiento);
      if (plan.edad_min_maternidad != null && edadNum < plan.edad_min_maternidad) return false;
      if (plan.edad_max_maternidad != null && edadNum > plan.edad_max_maternidad) return false;
      return true;
    });
  }

  /* =========================================================
     5.1 FILTRO POR ASEGURADORA
     ========================================================= */

  // Dibuja los botones de aseguradora (uno por cada aseguradora presente en
  // los planes disponibles) más el botón para liberar el filtro.
  function renderInsurerFilterBar(planes) {
    const nombres = Array.from(new Set(planes.map(p => p.aseguradora_nombre || 'Sin aseguradora')))
      .sort((a, b) => a.localeCompare(b, 'es'));

    insurerFilterBar.innerHTML = '';

    if (nombres.length <= 1) {
      insurerFilterBar.style.display = 'none';
      return;
    }
    insurerFilterBar.style.display = 'flex';

    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'insurer-filter-btn' + (activeInsurerFilters.size === 0 ? ' is-active' : '');
    allBtn.textContent = 'Todas las aseguradoras';
    allBtn.addEventListener('click', () => {
      activeInsurerFilters.clear();
      applyInsurerFilterAndRender();
    });
    insurerFilterBar.appendChild(allBtn);

    nombres.forEach(nombre => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'insurer-filter-btn' + (activeInsurerFilters.has(nombre) ? ' is-active' : '');
      btn.textContent = nombre;
      btn.addEventListener('click', () => {
        if (activeInsurerFilters.has(nombre)) {
          activeInsurerFilters.delete(nombre);
        } else {
          activeInsurerFilters.add(nombre);
        }
        applyInsurerFilterAndRender();
      });
      insurerFilterBar.appendChild(btn);
    });
  }

  // Vuelve a pintar la barra de filtros (para reflejar el estado activo) y
  // las tarjetas de planes según las aseguradoras seleccionadas.
  function applyInsurerFilterAndRender() {
    renderInsurerFilterBar(planesDisponiblesActuales);
    const planesFiltrados = activeInsurerFilters.size === 0
      ? planesDisponiblesActuales
      : planesDisponiblesActuales.filter(p => activeInsurerFilters.has(p.aseguradora_nombre || 'Sin aseguradora'));
    renderPlanCards(planesFiltrados);
  }

  /* =========================================================
     5.2 RENDERIZADO DE TARJETAS DE PLANES (grid de 3 en 3)
     ========================================================= */
  function renderPlanCards(planes) {
    plansContainer.innerHTML = '';
    plansContainer.className = 'plans-grid';

    if (planes.length === 0) {
      plansContainer.innerHTML = '<p style="text-align:center; color:#A6A9B0; margin-top:20px; grid-column: 1 / -1;">No hay planes que coincidan con el filtro seleccionado.</p>';
      return;
    }

    planes.forEach(plan => {
      const card = document.createElement('div');
      card.className = 'plan-item';

      card.innerHTML = `
        <div class="plan-header-row">
          <h3 class="plan-title" title="${escapeHtmlLocal(plan.aseguradora_nombre || 'Sin aseguradora')}">${escapeHtmlLocal(plan.aseguradora_nombre || 'Sin aseguradora')}</h3>
          <h3 class="plan-details">Suma Asegurada: $${formatCurrencyThousands(plan.suma_asegurada)}</h3>
          <p class="plan-details">Producto:${escapeHtmlLocal(plan.producto_nombre || 'Sin producto')}
          <p class="plan-details">Ded. Vzla: $${formatCurrencyThousands(plan.deducible_venezuela)}</p>
          <p class="plan-details">Ded. Ext: $${formatCurrencyThousands(plan.deducible_exterior)}</p>
        </div>

        <div class="plan-actions-row">
          <button type="button" class="btn btn--secondary open-modal-btn" style="padding: 6px 12px; font-size: 13px;">+ Adicionales</button>
          <div class="plan-selection-badge">Sin seleccionar</div>
        </div>

        <!-- Aquí aparecerán los adicionales seleccionados -->
        <div id="selected_cov_text_${plan.id}" class="selected-coverages-text" style="display: none;"></div>

        <button type="button" class="btn btn--primary select-plan-btn" style="width: 100%;">Comparar</button>
      `;

      plansContainer.appendChild(card);
      applyPlanSelectionState(card, plan.id);
      aplicarTextoCoberturasEnTarjeta(plan.id); // Restaura adicionales guardados previamente (persisten entre filtros)

      const selectPlanBtn = card.querySelector('.select-plan-btn');
      selectPlanBtn.addEventListener('click', () => {
        const existingIndex = planSelectionOrder.indexOf(plan.id);

        if (existingIndex >= 0) {
          planSelectionOrder.splice(existingIndex, 1);
          applyPlanSelectionState(card, plan.id);
          updateComparisonBar();
          return;
        }

        if (planSelectionOrder.length >= MAX_PLANES_COMPARACION) {
          window.alert(`Puedes comparar un máximo de ${MAX_PLANES_COMPARACION} planes. Quita uno para agregar otro.`);
          return;
        }

        planSelectionOrder.push(plan.id);
        applyPlanSelectionState(card, plan.id);
        updateComparisonBar();
      });

      // Evento para abrir el modal y pintar los checkboxes dinámicamente
      const btnOpenModal = card.querySelector('.open-modal-btn');
      btnOpenModal.addEventListener('click', () => {
        currentSelectedPlanId = plan.id;
        modalCoveragesBody.innerHTML = ''; // Limpiar modal anterior

        const aplicaMaternidad = aplicaMaternidadParaPlan(plan);
        const seleccionActualPlan = coberturasSeleccionadasPorPlan[plan.id] || [];

        plan.coberturasAdicionales.forEach((adicional, index) => {
          let disabled = '';
          let tachado = '';

          if (adicional.isMaternidad && !aplicaMaternidad) {
            disabled = 'disabled';
            tachado = 'style="color:#A6A9B0; text-decoration:line-through;"';
          }

          // Verificar si ya estaba seleccionado previamente (estado persistente)
          const seleccionPrevia = seleccionActualPlan.find((s) => s.key === adicional.key);
          const isChecked = seleccionPrevia ? 'checked' : '';

          // Contenedor por cada adicional (Fila: Checkbox + Nombre + Select de Suma)
          const itemRow = document.createElement('div');
          itemRow.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px;';

          if (adicional.porServicio) {
            // Cobertura "por Servicio": no hay Suma Asegurada que elegir,
            // solo se selecciona o no (la Prima ya está fija en el plan).
            itemRow.innerHTML = `
              <div ${tachado} style="display:flex; align-items:center; gap:8px; cursor:pointer; flex: 1;">
                <input type="checkbox" class="modal-cov-checkbox" data-key="${adicional.key}" data-index="${index}" ${disabled} ${isChecked}>
                <span style="font-size: 14px;">${adicional.nombre} ${disabled ? '(No aplica)' : ''}</span>
              </div>
            `;
          } else {
            itemRow.innerHTML = `
              <div ${tachado} style="display:flex; align-items:center; gap:8px; cursor:pointer; flex: 1;">
                <input type="checkbox" class="modal-cov-checkbox" data-key="${adicional.key}" data-index="${index}" ${disabled} ${isChecked}>
                <span style="font-size: 14px;">${adicional.nombre} ${disabled ? '(No aplica)' : ''}</span>
              </div>
              <select class="text-input modal-cov-sum" data-index="${index}" style="width: 130px; padding: 4px 8px; font-size: 13px;" ${!isChecked || disabled ? 'disabled' : ''}>
                <option value="">Suma...</option>
                ${adicional.sumas.map(s => `<option value="${s.suma_asegurada}" ${seleccionPrevia && Number(seleccionPrevia.sumaAsegurada) === Number(s.suma_asegurada) ? 'selected' : ''}>$${formatCurrencyThousands(s.suma_asegurada)}</option>`).join('')}
              </select>
            `;
          }

          modalCoveragesBody.appendChild(itemRow);

          // Lógica interactiva: al tildar el checkbox, se habilita/deshabilita su propio desplegable
          const chk = itemRow.querySelector('.modal-cov-checkbox');
          const sel = itemRow.querySelector('.modal-cov-sum');

          if (sel) {
            chk.addEventListener('change', () => {
              if (chk.checked) {
                sel.disabled = false;
              } else {
                sel.disabled = true;
                sel.value = '';
              }
            });
          }
        });

        coveragesModal.classList.add('active');
      });
    });
  }

  /* =========================================================
     5.3 MOTOR DE CÁLCULO DE COTIZACIÓN
     (Cobertura Básica, Coberturas Adicionales, Maternidad, Total Anual
     y Fraccionamiento — mismos campos que se mostrarán en el PDF final)
     ========================================================= */

  // Formatea un monto con 2 decimales fijos (a diferencia de
  // formatCurrencyThousands, que se usa para montos enteros como Suma
  // Asegurada). Se usa en todos los resultados del motor de cálculo.
  function formatMoney(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '0,00';
    return num.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Ubica, dentro de un objeto de tarifas por rango etario (jsonb con
  // claves tipo "20-24"), el valor que corresponde a una edad puntual.
  function tarifaPorEdad(tarifasPorRango, edad) {
    if (!tarifasPorRango || edad == null || edad < 0) return 0;
    const rango = AGE_RANGES.find((r) => edad >= r.min && edad <= r.max);
    if (!rango) return 0;
    const valor = tarifasPorRango[rango.key];
    return valor != null ? Number(valor) : 0;
  }

  // Cobertura Básica: suma de la tarifa por edad de cada integrante
  // incluido (Titular y Familiares por rango etario). Los hijos se tratan
  // según el modo configurado en el plan:
  //  - "Por hijo": cada hijo se tarifica individualmente por su edad,
  //    igual que el resto de familiares.
  //  - "Por cantidad de hijos": se usa un monto fijo según el total de
  //    hijos incluidos (tarifas_hijos_cantidad: claves "1","2","3","4+").
  function calcularCoberturaBasica(plan, integrantes) {
    const tarifa = plan._tarifa;
    if (!tarifa) return 0;

    let total = 0;
    const hijosIncluidos = [];

    integrantes.forEach((miembro) => {
      const edad = getNumericAge(miembro.fechaNacimiento);
      const esHijo = (miembro.parentesco || '').startsWith('Hijo ');

      if (miembro.parentesco === 'Titular') {
        total += tarifaPorEdad(tarifa.tarifas_titular, edad);
      } else if (esHijo && plan.modo_tarifa_hijos === 'Por cantidad de hijos') {
        hijosIncluidos.push(miembro);
      } else {
        // Cónyuge, Madre, Padre, o Hijos en modo "Por hijo"
        total += tarifaPorEdad(tarifa.tarifas_familiares, edad);
      }
    });

    if (plan.modo_tarifa_hijos === 'Por cantidad de hijos' && hijosIncluidos.length > 0) {
      const clave = hijosIncluidos.length >= 4 ? '4+' : String(hijosIncluidos.length);
      const tabla = tarifa.tarifas_hijos_cantidad || {};
      total += Number(tabla[clave] || 0);
    }

    return total;
  }

  // Suma de todas las coberturas adicionales seleccionadas por el usuario
  // (excluye Maternidad, que se calcula aparte), cada una multiplicada por
  // el total de integrantes incluidos en la cotización.
  function calcularCoberturasAdicionales(planId, totalIntegrantes) {
    const seleccionados = coberturasSeleccionadasPorPlan[planId] || [];
    return seleccionados
      .filter((s) => !s.isMaternidad)
      .reduce((acc, s) => acc + (Number(s.prima) || 0) * totalIntegrantes, 0);
  }

  // Prima de Maternidad: solo aplica si el plan la contempla y el grupo
  // familiar es elegible (Titular o Cónyuge mujer dentro del rango de edad
  // de maternidad del plan). Si está "Incluida" no genera costo adicional
  // (ya forma parte de la Cobertura Básica); si es "Opcional" solo cuenta
  // si el usuario la seleccionó explícitamente en "+ Adicionales".
  function calcularMaternidad(plan, planId) {
    const tarifa = plan._tarifa;
    const mat = tarifa ? tarifa.maternidad : null;
    if (!mat || mat.estado === 'No contempla') return 0;
    if (!aplicaMaternidadParaPlan(plan)) return 0;
    if (mat.estado === 'Incluido') return 0;

    const seleccionados = coberturasSeleccionadasPorPlan[planId] || [];
    const seleccion = seleccionados.find((s) => s.isMaternidad);
    return seleccion ? (Number(seleccion.prima) || 0) : 0;
  }

  // Arma el desglose completo de la cotización para un plan: Cobertura
  // Básica, Coberturas Adicionales, Maternidad, Total Anual y
  // Fraccionamiento (según las frecuencias de pago habilitadas en el plan).
  function calcularCotizacionPlan(plan) {
    const integrantes = integrantesActuales;
    const totalIntegrantes = integrantes.length;

    const basica = calcularCoberturaBasica(plan, integrantes);
    const adicionales = calcularCoberturasAdicionales(plan.id, totalIntegrantes);
    const maternidad = calcularMaternidad(plan, plan.id);
    const totalAnual = basica + adicionales + maternidad;

    const fraccionamiento = {
      semestral: plan.fraccionamiento_semestral ? totalAnual / 2 : null,
      trimestral: plan.fraccionamiento_trimestral ? totalAnual / 4 : null,
      mensual: plan.fraccionamiento_mensual ? totalAnual / (plan.fraccionamiento_mensual_fracciones || 12) : null,
      mensualFracciones: plan.fraccionamiento_mensual_fracciones || 12,
      gastoAdmin: plan.gastos_fraccionamiento_activo ? Number(plan.gastos_fraccionamiento_monto || 0) : 0,
    };

    return {
      basica,
      adicionales,
      maternidad,
      totalBasicaMasAdicionales: basica + adicionales,
      totalAnual,
      fraccionamiento,
    };
  }

  /* =========================================================
     5.4 RESUMEN COMPARATIVO Y EXPORTACIÓN A PDF
     ========================================================= */

  // Formatea una fecha al estilo "DD/MM/AAAA" usado en el encabezado del PDF.
  function formatDateEs(date) {
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    return `${d}/${m}/${y}`;
  }

  // La vigencia de la cotización es siempre de 7 días a partir de hoy.
  function computeVencimiento() {
    const hoy = new Date();
    const venc = new Date(hoy);
    venc.setDate(venc.getDate() + 7);
    return formatDateEs(venc);
  }

  // Arma el texto "Titular (38 años), Cónyuge (29 años), Hijo 1 (12 años)"
  // a partir de los integrantes incluidos, en el mismo orden en que
  // aparecen en la tabla del formulario (Titular, Cónyuge/Madre/Padre,
  // luego Hijos en orden).
  function buildGrupoFamiliarText(integrantes) {
    if (!integrantes || integrantes.length === 0) return '—';
    return integrantes
      .map((m) => {
        const edad = getNumericAge(m.fechaNacimiento);
        const edadTexto = edad >= 0 ? `${edad} años` : 'edad no indicada';
        return `${m.parentesco} (${edadTexto})`;
      })
      .join(', ');
  }

  // Puebla el encabezado del PDF (logo, título, datos de solicitante/asesor,
  // tipo de tarifa, vencimiento y grupo familiar) replicando el formato del
  // documento de referencia (PDF_Cotización_Salud.docx). Se llama justo
  // antes de mostrar/exportar el modal de comparación.
  function renderComparisonPrintHeader() {
    const session = getSession();
    const nombreAsesor = elaboradoPorActual || getElaboradoPorValue() || session.fullName || session.email || '—';
    const contacto = resolveAsesorContacto(nombreAsesor);
    const nombreSolicitante = applicantNameInput.value.trim() || '—';
    const fechaHoy = formatDateEs(new Date());
    const vencimiento = computeVencimiento();
    const grupoFamiliarTexto = buildGrupoFamiliarText(integrantesActuales);

    const contactoPartes = [contacto.email, contacto.telefono].filter(Boolean).join(' · ');

    comparisonPrintHeader.innerHTML = `
      <div class="print-header__top">
        <div class="print-header__brand">
          <img src="${BARECA_LOGO_URL}" alt="Bareca Sociedad de Corretaje">
        </div>
        <div class="print-header__main">
          <p class="print-header__title">Cotización Salud Individual</p>
          ${contactoPartes ? `<p class="print-header__asesor-contacto">${escapeHtmlLocal(contactoPartes)}</p>` : ''}
          <p class="print-header__fecha">Fecha de la cotización: ${fechaHoy}</p>
        </div>
      </div>
      <div class="print-header__rows">
        <div class="print-info-row">
          <span><strong>Solicitante:</strong> ${escapeHtmlLocal(nombreSolicitante)}</span>
          <span><strong>Asesor:</strong> ${escapeHtmlLocal(nombreAsesor)}</span>
        </div>
        <div class="print-tarifa-row">
          <span class="print-tarifa-badge">Tarifa: ${escapeHtmlLocal(tarifaTipoActual || 'Emisión')}</span>
          <span class="print-vencimiento">Vencimiento: ${vencimiento}</span>
        </div>
        <div class="print-grupo-familiar">
          <strong>Grupo familiar:</strong> ${escapeHtmlLocal(grupoFamiliarTexto)}
        </div>
      </div>
    `;
  }

  // Devuelve el bloque de encabezado de columna para una aseguradora: su
  // logo (si tiene uno cargado en el catálogo) y su nombre debajo, igual
  // que en el documento de referencia. Si no hay logo, muestra solo el
  // nombre en su lugar.
  function buildInsurerHeaderCell(plan) {
    const nombre = escapeHtmlLocal(plan.aseguradora_nombre || 'Sin aseguradora');
    const logoImg = plan.aseguradora_logo
      ? `<img src="${escapeHtmlLocal(plan.aseguradora_logo)}" alt="${nombre}" onerror="this.style.display='none'">`
      : '';
    return `<div class="comparison-insurer-header">${logoImg}<span>${nombre}</span></div>`;
  }

  function renderComparisonModal() {
    const planesSeleccionados = planSelectionOrder
      .map(id => planesDisponiblesActuales.find(p => p.id === id))
      .filter(Boolean);

    comparisonTableWrapper.innerHTML = '';

    if (planesSeleccionados.length === 0) {
      comparisonTableWrapper.innerHTML = '<p style="text-align:center; color:#A6A9B0;">No hay planes seleccionados para comparar.</p>';
      return;
    }

    // Se calcula una sola vez por plan y se reutiliza en todas las filas de dinero.
    const cotizaciones = new Map(planesSeleccionados.map((p) => [p.id, calcularCotizacionPlan(p)]));
    const numCols = planesSeleccionados.length + 1;

    // Cada fila puede llevar una clase de fila (zebra, sección, total) y una
    // clase de celda para resaltar valores puntuales (suma asegurada, total
    // anual), igual al estilo del documento de referencia.
    const filasDefinicion = [
      { label: 'Producto', get: (p) => p.producto_nombre || '—', rowClass: 'row-shaded' },
      { label: 'Suma Asegurada', get: (p) => `$${formatCurrencyThousands(p.suma_asegurada)}`, cellClass: 'comparison-suma-asegurada' },
      {
        label: 'Detalle Adicionales', rowClass: 'row-shaded', cellClass: 'comparison-detalle-adicionales', get: (p) => {
          const seleccionados = coberturasSeleccionadasPorPlan[p.id] || [];
          return seleccionados.length > 0
            ? seleccionados.map((s) => s.porServicio ? s.nombre : `${s.nombre} ($${formatCurrencyThousands(s.sumaAsegurada)})`).join(', ')
            : 'Ninguno';
        },
      },
      { section: 'Total Estimado a Pagar Anual' },
      { label: 'Total Cobertura Básica', get: (p) => `$${formatMoney(cotizaciones.get(p.id).basica)}` },
      { label: 'Total Cob. Adicionales', get: (p) => `$${formatMoney(cotizaciones.get(p.id).adicionales)}`, rowClass: 'row-shaded' },

      { label: 'Maternidad', get: (p) => `$${formatMoney(cotizaciones.get(p.id).maternidad)}` },
      {
        label: 'Total Anual', rowClass: 'comparison-total-anual-row', get: (p) => `$${formatMoney(cotizaciones.get(p.id).totalAnual)}`,
      },
      { section: 'Fraccionamiento' },
      {
        label: 'Gasto Admin. por Fraccionamiento', get: (p) => {
          const g = cotizaciones.get(p.id).fraccionamiento.gastoAdmin;
          return g ? `$${formatMoney(g)}` : '—';
        },
      },
      {
        label: 'Semestral', rowClass: 'row-shaded', get: (p) => {
          const v = cotizaciones.get(p.id).fraccionamiento.semestral;
          return v != null ? `$${formatMoney(v)}` : '—';
        },
      },
      {
        label: 'Trimestral', get: (p) => {
          const v = cotizaciones.get(p.id).fraccionamiento.trimestral;
          return v != null ? `$${formatMoney(v)}` : '—';
        },
      },
      {
        label: 'Mensual', rowClass: 'row-shaded', get: (p) => {
          const f = cotizaciones.get(p.id).fraccionamiento;
          return f.mensual != null ? `$${formatMoney(f.mensual)} (${f.mensualFracciones} cuotas)` : '—';
        },
      },
    ];

    const encabezado = '<thead><tr><th>Aseguradoras</th>' +
      planesSeleccionados.map((p) => `<th>${buildInsurerHeaderCell(p)}</th>`).join('') + '</tr></thead>';

    const cuerpo = '<tbody>' + filasDefinicion.map(def => {
      if (def.section) {
        return `<tr class="comparison-section-row"><td colspan="${numCols}">${escapeHtmlLocal(def.section)}</td></tr>`;
      }
      const rowClass = def.rowClass ? ` class="${def.rowClass}"` : '';
      const cellClass = def.cellClass ? ` class="${def.cellClass}"` : '';
      return `<tr${rowClass}><td class="comparison-row-label">${escapeHtmlLocal(def.label)}</td>` +
        planesSeleccionados.map(p => `<td${cellClass}>${escapeHtmlLocal(def.get(p))}</td>`).join('') +
        '</tr>';
    }).join('') + '</tbody>';

    const table = document.createElement('table');
    table.className = 'comparison-table';
    table.innerHTML = encabezado + cuerpo;
    comparisonTableWrapper.appendChild(table);
  }

  viewComparisonBtn.addEventListener('click', () => {
    renderComparisonPrintHeader();
    renderComparisonModal();
    comparisonModal.classList.add('active');
  });

  closeComparisonModalBtn.addEventListener('click', () => {
    comparisonModal.classList.remove('active');
  });

  // Exporta el resumen comparativo a PDF usando el diálogo de impresión del
  // navegador (Guardar como PDF), aislando solo el modal de comparación.
  exportComparisonBtn.addEventListener('click', () => {
    document.body.classList.add('printing-comparison');
    window.print();
  });

  window.addEventListener('afterprint', () => {
    document.body.classList.remove('printing-comparison');
  });

  showPlansBtn.addEventListener('click', async () => {
    if (!validateApplicantName()) {
      applicantNameInput.focus();
      window.alert('El nombre del solicitante es obligatorio y debe tener al menos 3 letras.');
      return;
    }

    if (!validateElaboradoPor()) {
      const session = getSession();
      const target = (session.role === 'Administrador' || session.role === 'Colaborador') ? elaboradoPorSelect : elaboradoPorInput;
      target.focus();
      window.alert('Indica quién elabora la cotización.');
      return;
    }

    if (!validateFamilyForm()) {
      window.alert('Completa las fechas y géneros obligatorios de los integrantes incluidos.');
      return;
    }

    elaboradoPorActual = getElaboradoPorValue();
    tarifaTipoActual = tarifaTipoSelect.value || 'Emisión';

    setFamilyFormLocked(true);
    showPlansBtn.disabled = true;
    showPlansBtn.textContent = 'Cargando...';
    modifyDataBtn.disabled = false;

    const rows = Array.from(tableBody.querySelectorAll('.family-row'));
    integrantesActuales = rows.map(row => {
      const checkbox = row.querySelector('.row-checkbox');
      const dateInput = row.querySelector('.date-input');
      const genderSelect = row.querySelector('.gender-select');
      return {
        parentesco: row.dataset.relation,
        incluido: checkbox.checked,
        fechaNacimiento: dateInput.value,
        genero: genderSelect ? genderSelect.value : null
      };
    }).filter(member => member.incluido && member.fechaNacimiento);

    // Reiniciar filtros, comparación y contenedores antes de la nueva búsqueda
    activeInsurerFilters.clear();
    planSelectionOrder = [];
    Object.keys(coberturasSeleccionadasPorPlan).forEach(key => delete coberturasSeleccionadasPorPlan[key]);
    updateComparisonBar();
    insurerFilterBar.innerHTML = '';
    insurerFilterBar.style.display = 'none';

    plansContainer.innerHTML = '<p style="text-align:center; color:#A6A9B0; margin-top:20px;">Cargando planes...</p>';
    plansContainer.className = 'plans-grid';
    plansContainer.style.display = 'grid';

    // 1. Traer de Supabase solo los planes Activos que tengan una tarifa
    //    Actualizada asociada (si un plan no tiene tarifa "Actualizada", no
    //    se puede cotizar y queda descartado desde la propia consulta).
    const { planes: planesCotizables, error } = await fetchPlanesCotizables();

    showPlansBtn.disabled = false;
    showPlansBtn.textContent = 'Mostrar planes';

    if (error) {
      plansContainer.innerHTML = `<p style="text-align:center; color:#C0392B; margin-top:20px;">No se pudieron cargar los planes: ${escapeHtmlLocal(error)}</p>`;
      return;
    }

    // 2. Edad del Titular, para compararla contra el rango de edad de
    //    Titular configurado en cada plan (edad_min_titular / edad_max_titular).
    const titular = integrantesActuales.find(miembro => miembro.parentesco === 'Titular');
    const edadTitular = titular ? getNumericAge(titular.fechaNacimiento) : -1;

    const planesDisponibles = planesCotizables.filter(plan => {
      if (plan.edad_min_titular != null && edadTitular < plan.edad_min_titular) return false;
      if (plan.edad_max_titular != null && edadTitular > plan.edad_max_titular) return false;
      return true;
    });

    planesDisponiblesActuales = planesDisponibles;

    if (planesDisponibles.length === 0) {
      plansContainer.innerHTML = '<p style="text-align:center; color:#A6A9B0; margin-top:20px;">No hay planes disponibles para la edad del titular.</p>';
      return;
    }

    // 3. Botones de filtro por aseguradora + tarjetas de planes (grid de 3 en 3)
    renderInsurerFilterBar(planesDisponiblesActuales);
    renderPlanCards(planesDisponiblesActuales);
  });

});