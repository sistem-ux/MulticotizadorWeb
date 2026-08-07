/* =============================================================
   CONFIGURACIÓN DE SUPABASE
   (Misma configuración que aseguradoras.js / usuarios.js —
   Project Settings > API en tu proyecto de Supabase)
   ============================================================= */
const SUPABASE_URL = 'https://cibtpkpxdrykozujaqba.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_zlp4_HGpTeAQKW55c_pZQA_2HEXRpaC';
const TABLE_PLANES = 'planes';
const TABLE_TARIFAS = 'tarifas';

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

  let childCount = 0;
  let currentSelectedPlanId = null; // Para saber a qué plan le estamos agregando adicionales
  let planSelectionHistory = []; // Guarda el orden y momento de cada selección de plan
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
    planSelectionHistory = [];
    currentSelectedPlanId = null;
    plansContainer.innerHTML = '';
    plansContainer.style.display = 'none';
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

  // Guardar adicionales (incluyendo suma) y mostrarlos en el plan correspondiente
  saveCoveragesBtn.addEventListener('click', () => {
    const rows = modalCoveragesBody.querySelectorAll('div[style*="display: flex"]');
    const seleccionados = [];
    let validacionExitosa = true;

    // Usamos un bucle for tradicional para poder detener la ejecución si falta una suma
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const chk = row.querySelector('.modal-cov-checkbox');
      const sel = row.querySelector('.modal-cov-sum');

      if (chk && chk.checked) {
        // VALIDACIÓN: Si el checkbox está marcado, el select NO puede estar vacío
        if (!sel || !sel.value) {
          alert(`Por favor selecciona una suma asegurada para la cobertura: ${chk.value}`);
          validacionExitosa = false;
          break; // Detenemos el bucle
        }
        
        // Si tiene valor, lo agregamos al arreglo
        const sumaTexto = ` (${sel.value})`;
        seleccionados.push(`${chk.value}${sumaTexto}`);
      }
    }

    // Si la validación falló (falta alguna suma), detenemos la función aquí
    if (!validacionExitosa) {
      return; 
    }

    // Si todo está correcto, actualizamos la vista y cerramos el modal
    const targetDiv = document.getElementById(`selected_cov_text_${currentSelectedPlanId}`);
    if (seleccionados.length > 0) {
      targetDiv.style.display = 'block';
      targetDiv.textContent = `Adicionales: ${seleccionados.join(', ')}`;
    } else {
      targetDiv.style.display = 'none';
      targetDiv.textContent = '';
    }

    coveragesModal.classList.remove('active');
  });

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
      const sumas = (cov.sumas || [])
        .map((s) => (s.suma_asegurada != null ? `$${formatCurrencyThousands(s.suma_asegurada)}` : null))
        .filter(Boolean);
      if (!sumas.length) return;
      adicionales.push({ nombre: def.label, sumas });
    });

    const mat = tarifa.maternidad;
    if (mat && mat.estado === 'Opcional') {
      const sumas = (mat.sumas || [])
        .map((s) => (s.suma_asegurada != null ? `$${formatCurrencyThousands(s.suma_asegurada)}` : null))
        .filter(Boolean);
      if (sumas.length) {
        adicionales.push({ nombre: 'Maternidad', sumas });
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
      supabaseClient.from(TABLE_PLANES).select('*').eq('status', 'Activo'),
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

  function formatSelectionTimestamp(date) {
    return date.toLocaleString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  function applyPlanSelectionState(card, planId) {
    const selection = [...planSelectionHistory].reverse().find(item => item.planId === planId);
    const title = card.querySelector('.plan-title');
    const badge = card.querySelector('.plan-selection-badge');
    const button = card.querySelector('.select-plan-btn');

    if (selection) {
      card.classList.add('is-selected');
      title.classList.add('is-selected');
      badge.classList.add('is-active');
      badge.textContent = `Selección #${selection.selectionNumber} · ${selection.selectedAt}`;
      button.textContent = 'Quitar selección';
      button.classList.remove('btn--primary');
      button.classList.add('btn--secondary');
    } else {
      card.classList.remove('is-selected');
      title.classList.remove('is-selected');
      badge.classList.remove('is-active');
      badge.textContent = 'Sin seleccionar';
      button.textContent = 'Seleccionar este Plan';
      button.classList.remove('btn--secondary');
      button.classList.add('btn--primary');
    }
  }

  showPlansBtn.addEventListener('click', async () => {
    if (!validateApplicantName()) {
      applicantNameInput.focus();
      window.alert('El nombre del solicitante es obligatorio y debe tener al menos 3 letras.');
      return;
    }

    if (!validateFamilyForm()) {
      window.alert('Completa las fechas y géneros obligatorios de los integrantes incluidos.');
      return;
    }

    setFamilyFormLocked(true);
    showPlansBtn.disabled = true;
    showPlansBtn.textContent = 'Cargando...';
    modifyDataBtn.disabled = false;

    const rows = Array.from(tableBody.querySelectorAll('.family-row'));
    const integrantes = rows.map(row => {
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

    plansContainer.innerHTML = '<p style="text-align:center; color:#A6A9B0; margin-top:20px;">Cargando planes...</p>';
    plansContainer.className = 'plans-list';
    plansContainer.style.display = 'block';

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
    const titular = integrantes.find(miembro => miembro.parentesco === 'Titular');
    const edadTitular = titular ? getNumericAge(titular.fechaNacimiento) : -1;

    const planesDisponibles = planesCotizables.filter(plan => {
      if (plan.edad_min_titular != null && edadTitular < plan.edad_min_titular) return false;
      if (plan.edad_max_titular != null && edadTitular > plan.edad_max_titular) return false;
      return true;
    });

    if (planesDisponibles.length === 0) {
      plansContainer.innerHTML = '<p style="text-align:center; color:#A6A9B0; margin-top:20px;">No hay planes disponibles para la edad del titular.</p>';
      return;
    }

    plansContainer.innerHTML = '';

    // 3. Regla de Maternidad: aplica por Titular o Cónyuge (mujer) cuya edad
    //    esté dentro del rango de maternidad propio de CADA plan
    //    (edad_min_maternidad / edad_max_maternidad, definidos en el plan).
    function aplicaMaternidadParaPlan(plan) {
      return integrantes.some(miembro => {
        if (miembro.parentesco !== 'Titular' && miembro.parentesco !== 'Cónyuge') return false;
        if (miembro.genero !== 'F') return false;
        const edadNum = getNumericAge(miembro.fechaNacimiento);
        if (plan.edad_min_maternidad != null && edadNum < plan.edad_min_maternidad) return false;
        if (plan.edad_max_maternidad != null && edadNum > plan.edad_max_maternidad) return false;
        return true;
      });
    }

    // 4. Imprimir tarjetas de planes en formato lista
    planesDisponibles.forEach(plan => {
      const card = document.createElement('div');
      card.className = 'plan-item';
      
      card.innerHTML = `
        <div class="plan-header-row">
          <div>
            <h3 class="plan-title">${escapeHtmlLocal(plan.nombre_plan)}</h3>
            <p class="plan-details">Suma Asegurada: $${formatCurrencyThousands(plan.suma_asegurada)}</p>
          </div>
          <button type="button" class="btn btn--secondary open-modal-btn" style="padding: 6px 12px; font-size: 13px;">+ Adicionales</button>
        </div>

        <div class="plan-selection-badge">Sin seleccionar</div>
        
        <!-- Aquí aparecerán los adicionales seleccionados -->
        <div id="selected_cov_text_${plan.id}" class="selected-coverages-text" style="display: none;"></div>
        
        <button type="button" class="btn btn--primary select-plan-btn" style="margin-top: 10px; width: 100%;">Seleccionar este Plan</button>
      `;
      
      plansContainer.appendChild(card);
      applyPlanSelectionState(card, plan.id);

      const selectPlanBtn = card.querySelector('.select-plan-btn');
      selectPlanBtn.addEventListener('click', () => {
        const existingSelectionIndex = planSelectionHistory.findIndex(item => item.planId === plan.id);

        if (existingSelectionIndex >= 0) {
          planSelectionHistory.splice(existingSelectionIndex, 1);
          applyPlanSelectionState(card, plan.id);
          return;
        }

        const selectedAt = formatSelectionTimestamp(new Date());
        planSelectionHistory.push({
          planId: plan.id,
          selectionNumber: planSelectionHistory.length + 1,
          selectedAt
        });
        applyPlanSelectionState(card, plan.id);
      });

      // Evento para abrir el modal y pintar los checkboxes dinámicamente
      const btnOpenModal = card.querySelector('.open-modal-btn');
      btnOpenModal.addEventListener('click', () => {
        currentSelectedPlanId = plan.id;
        modalCoveragesBody.innerHTML = ''; // Limpiar modal anterior

        const divTextoActual = document.getElementById(`selected_cov_text_${plan.id}`);
        const textoActual = divTextoActual.textContent;
        const aplicaMaternidad = aplicaMaternidadParaPlan(plan);

        plan.coberturasAdicionales.forEach((adicional, index) => {
          let disabled = '';
          let tachado = '';
          
          if (adicional.nombre === 'Maternidad' && !aplicaMaternidad) {
            disabled = 'disabled';
            tachado = 'style="color:#A6A9B0; text-decoration:line-through;"';
          }

          // Verificar si ya estaba seleccionado previamente en el texto del plan
          const yaSeleccionado = textoActual.includes(adicional.nombre);
          const isChecked = yaSeleccionado ? 'checked' : '';

          // Contenedor por cada adicional (Fila: Checkbox + Nombre + Select de Suma)
          const itemRow = document.createElement('div');
          itemRow.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px;';
          
          itemRow.innerHTML = `
            <div ${tachado} style="display:flex; align-items:center; gap:8px; cursor:pointer; flex: 1;">
              <input type="checkbox" class="modal-cov-checkbox" value="${adicional.nombre}" data-index="${index}" ${disabled} ${isChecked}>
              <span style="font-size: 14px;">${adicional.nombre} ${disabled ? '(No aplica)' : ''}</span>
            </div>
            <select class="text-input modal-cov-sum" data-index="${index}" style="width: 130px; padding: 4px 8px; font-size: 13px;" ${!isChecked || disabled ? 'disabled' : ''}>
              <option value="">Suma...</option>
              ${adicional.sumas.map(suma => `<option value="${suma}" ${textoActual.includes(`${adicional.nombre} (${suma})`) ? 'selected' : ''}>${suma}</option>`).join('')}
            </select>
          `;

          modalCoveragesBody.appendChild(itemRow);

          // Lógica interactiva: al tildar el checkbox, se habilita/deshabilita su propio desplegable
          const chk = itemRow.querySelector('.modal-cov-checkbox');
          const sel = itemRow.querySelector('.modal-cov-sum');

          chk.addEventListener('change', () => {
            if (chk.checked) {
              sel.disabled = false;
            } else {
              sel.disabled = true;
              sel.value = '';
            }
          });
        });

        coveragesModal.classList.add('active');
      });
    });
  });

});