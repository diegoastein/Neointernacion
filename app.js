// Importar las funciones necesarias de Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, 
    signInAnonymously, 
    signInWithCustomToken, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    addDoc, 
    setDoc, 
    updateDoc, 
    deleteDoc, 
    onSnapshot,
    getDocs,
    getCountFromServer,
    collection, 
    query,
    where,
    orderBy,
    limit,
    setLogLevel
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- VARIABLES GLOBALES ---
let app, auth, db, userId, appId;
let pacientesCollectionRef, customDiagnosticosCollectionRef;

let filteredPacientes = []; // Pacientes que coinciden con los filtros (o los últimos 3)
let totalPatientCount = 0; // Variable para guardar el conteo total
let baseDiagnosticos = []; // La lista larga de diagnósticos
let customDiagnosticos = []; // Diagnósticos agregados por usuarios
let allDiagnosticos = []; // Lista combinada

let selectedDiagnosticos = []; // Diagnósticos seleccionados en el modal
let editingPatientId = null; // ID del paciente que se está editando
let patientToDeleteId = null; // ID del paciente a borrar

// --- CONFIGURACIÓN DE FIREBASE (¡IMPORTANTE!) ---
const firebaseConfig = {
    apiKey: "AIzaSyApnwRZQklxTBLhwBBIoyAcCiBAgzyhtvE",
    authDomain: "neomanager-a4482.firebaseapp.com",
    projectId: "neomanager-a4482",
    storageBucket: "neomanager-a4482.firebasestorage.app",
    messagingSenderId: "574188152831",
    appId: "1:574188152831:web:34ab797c5b709e7e3429ca"
};
appId = typeof __app_id !== 'undefined' ? __app_id : 'neo-manager-default';

// --- INICIALIZACIÓN DE LA APP ---

document.addEventListener('DOMContentLoaded', () => {
    // Inicializar Firebase
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    setLogLevel('Debug'); // Mostrar logs detallados de Firestore

    // Llenar la lista base de diagnósticos (MODO ANTIGUO, NO MIGRADO)
    populateBaseDiagnosticos();
    
    // Configurar listeners de la UI
    setupUIListeners();
    
    // Iniciar autenticación
    handleAuth();
});

// --- MANEJO DE AUTENTICACIÓN Y DATOS ---

function handleAuth() {
    showLoading(true, "Autenticando...");
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            userId = user.uid;
            console.log("Usuario autenticado:", userId);
            document.getElementById('user-id-display').textContent = `ID de Usuario: ${userId}`;

            // Definir rutas de la base de datos (colaborativas)
            const publicDataPath = `artifacts/${appId}/public/data`;
            pacientesCollectionRef = collection(db, `${publicDataPath}/pacientes`);
            customDiagnosticosCollectionRef = collection(db, `${publicDataPath}/diagnosticos_custom`);
            
            // Cargar datos
            loadCustomDiagnosticos(); // Cargar diagnósticos custom
            updateTotalPatientCount(); // Cargar el conteo total
            
            // Cargar los últimos pacientes por defecto para la vista inicial
            applyFiltersAndRender(); 
            
            showLoading(false);
            showView('ingreso-view'); // Empezar en la vista de ingreso
        } else {
            // Si no hay usuario, intentar loguearse
            try {
                if (typeof __initial_auth_token !== 'undefined') {
                    await signInWithCustomToken(auth, __initial_auth_token);
                } else {
                    await signInAnonymously(auth);
                }
            } catch (error) {
                console.error("Error de autenticación:", error);
                showLoading(false);
                showToast("Error de autenticación. La app no funcionará.", 'error');
            }
        }
    });
}

/** Actualiza el contador total de pacientes desde Firestore */
async function updateTotalPatientCount() {
    try {
        const snapshot = await getCountFromServer(pacientesCollectionRef);
        totalPatientCount = snapshot.data().count;
        // Actualizar el texto en la UI si corresponde
        const counterEl = document.getElementById('patient-count');
        if (counterEl && !document.getElementById('consulta-view').classList.contains('hidden')) {
             // Llama a renderPatientList para actualizar el texto
             renderPatientList(filteredPacientes, false);
        }
    } catch (error) {
        console.error("Error al obtener el conteo total:", error);
        // No mostramos toast aquí para no ser molestos en el inicio
    }
}

/** Carga y escucha los diagnósticos customizados */
function loadCustomDiagnosticos() {
    onSnapshot(query(customDiagnosticosCollectionRef), (snapshot) => {
        customDiagnosticos = snapshot.docs.map(doc => doc.data().nombre).sort();
        console.log("Diagnósticos customizados cargados:", customDiagnosticos.length);
        updateAllDiagnosticosList();
    }, (error) => {
        console.error("Error al cargar diagnósticos custom:", error);
        showToast("Error al cargar lista de diagnósticos.", 'error');
    });
}

// --- MANEJO DE LA UI (VISTAS, MODALES, ETC) ---

/** Configura todos los event listeners de la UI */
function setupUIListeners() {
    // Pestañas
    document.getElementById('tab-ingreso').addEventListener('click', () => showView('ingreso-view'));
    document.getElementById('tab-consulta').addEventListener('click', () => {
        showView('consulta-view');
        // Al cambiar a la pestaña de consulta, refrescamos la lista (cargará últimos 3 si no hay filtro)
        applyFiltersAndRender();
    });
    
    // Botón "Nuevo Paciente" (en vista consulta)
    document.getElementById('btn-nuevo-paciente').addEventListener('click', () => {
        resetForm();
        showView('ingreso-view');
    });

    // Formulario de Ingreso
    document.getElementById('patient-form').addEventListener('submit', handleFormSubmit);
    document.getElementById('btn-cancelar-edicion').addEventListener('click', (e) => {
        e.preventDefault();
        resetForm();
        showView('consulta-view');
    });

    // Modal de Diagnósticos
    document.getElementById('btn-open-diag-modal').addEventListener('click', () => showDiagnosticoModal(true));
    document.getElementById('btn-close-diag-modal').addEventListener('click', () => showDiagnosticoModal(false));
    document.getElementById('btn-save-diag-modal').addEventListener('click', saveDiagnosticosFromModal);
    document.getElementById('diag-modal-search').addEventListener('input', renderDiagnosticoModalList);
    document.getElementById('btn-add-new-diag').addEventListener('click', addNewDiagnostico);
    
    // Modal de Borrado
    document.getElementById('btn-cancel-delete').addEventListener('click', () => showDeleteModal(false));
    document.getElementById('btn-confirm-delete').addEventListener('click', confirmDeletePatient);

    // Filtros de Búsqueda (se activan al cambiar)
    document.getElementById('search-general').addEventListener('input', applyFiltersAndRender);
    document.getElementById('search-date-start').addEventListener('change', applyFiltersAndRender);
    document.getElementById('search-date-end').addEventListener('change', applyFiltersAndRender);
    document.getElementById('search-eg-start').addEventListener('input', applyFiltersAndRender);
    document.getElementById('search-eg-end').addEventListener('input', applyFiltersAndRender);
    document.getElementById('search-patologia').addEventListener('change', applyFiltersAndRender);

    // Botones de Exportación
    document.getElementById('btn-export-filtered').addEventListener('click', handleExportAll); 
    document.getElementById('btn-export-all').addEventListener('click', () => exportToCsv(filteredPacientes, 'pacientes_neo_filtrados'));
    
    // Clic en la lista de pacientes (para editar/borrar/compartir)
    document.getElementById('patient-list-container').addEventListener('click', handlePatientListClick);
}

/** Cambia entre la vista de 'Ingreso' y 'Consulta' */
function showView(viewId) {
    const ingresoView = document.getElementById('ingreso-view');
    const consultaView = document.getElementById('consulta-view');
    const tabIngreso = document.getElementById('tab-ingreso');
    const tabConsulta = document.getElementById('tab-consulta');

    if (viewId === 'ingreso-view') {
        ingresoView.classList.remove('hidden');
        consultaView.classList.add('hidden');
        tabIngreso.classList.add('border-b-2', 'border-blue-500', 'text-blue-600');
        tabIngreso.classList.remove('text-gray-500');
        tabConsulta.classList.remove('border-b-2', 'border-blue-500', 'text-blue-600');
        tabConsulta.classList.add('text-gray-500');
    } else {
        ingresoView.classList.add('hidden');
        consultaView.classList.remove('hidden');
        tabIngreso.classList.remove('border-b-2', 'border-blue-500', 'text-blue-600');
        tabIngreso.classList.add('text-gray-500');
        tabConsulta.classList.add('border-b-2', 'border-blue-500', 'text-blue-600');
        tabConsulta.classList.remove('text-gray-500');
        // El renderizado se hace en setupUIListeners o al cargar la app
    }
}

/** Muestra u oculta el overlay de carga */
function showLoading(show, message = "Cargando...") {
    const overlay = document.getElementById('loading-overlay');
    const messageEl = document.getElementById('loading-message');
    if (show) {
        messageEl.textContent = message;
        overlay.classList.remove('hidden');
    } else {
        overlay.classList.add('hidden');
    }
}

/** Muestra un mensaje temporal (toast) */
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast-notification');
    const toastMessage = document.getElementById('toast-message');
    
    toastMessage.textContent = message;
    
    toast.classList.remove('bg-green-500', 'bg-red-500', 'bg-yellow-500');
    
    if (type === 'success') {
        toast.classList.add('bg-green-500');
    } else if (type === 'error') {
        toast.classList.add('bg-red-500');
    } else {
        toast.classList.add('bg-yellow-500');
    }
    
    toast.classList.remove('hidden', 'opacity-0');
    
    setTimeout(() => {
        toast.classList.add('opacity-0');
        setTimeout(() => toast.classList.add('hidden'), 500);
    }, 3000);
}

/** Muestra u oculta el modal de diagnósticos */
function showDiagnosticoModal(show) {
    const modal = document.getElementById('diagnostico-modal');
    if (show) {
        renderDiagnosticoModalList();
        modal.classList.remove('hidden');
    } else {
        document.getElementById('diag-modal-search').value = '';
        modal.classList.add('hidden');
    }
}

/** Muestra u oculta el modal de confirmación de borrado */
function showDeleteModal(show, patientName = '') {
    const modal = document.getElementById('delete-modal');
    if (show) {
        document.getElementById('delete-patient-name').textContent = patientName;
        modal.classList.remove('hidden');
    } else {
        modal.classList.add('hidden');
        patientToDeleteId = null;
    }
}

// --- LÓGICA DEL FORMULARIO DE INGRESO ---

/** Maneja el envío del formulario (Crear o Actualizar) */
async function handleFormSubmit(e) {
    e.preventDefault();
    showLoading(true, "Guardando...");

    const form = e.target;
    
    // Lógica Nivel Pro para crear las palabras clave
    const nombreOriginal = form.nombre.value;
    const keywords = nombreOriginal.toLowerCase().split(' ').filter(kw => kw.length > 0);

    const patientData = {
        nombre: nombreOriginal,
        nombre_keywords: keywords, // Campo "Nivel Pro" para buscar
        fechaNacimiento: form.fechaNacimiento.value,
        peso: form.peso.valueAsNumber,
        edadGestacional: form.edadGestacional.valueAsNumber,
        procedencia: form.procedencia.value,
        fechaInternacion: form.fechaInternacion.value,
        fechaEgreso: form.fechaEgreso.value,
        statusEgreso: form.statusEgreso.value,
        diagnosticos: selectedDiagnosticos,
        lastUpdatedBy: userId,
        lastUpdatedAt: new Date().toISOString()
    };

    try {
        if (editingPatientId) {
            const patientRef = doc(db, `artifacts/${appId}/public/data/pacientes`, editingPatientId);
            await updateDoc(patientRef, patientData);
            showToast("Paciente actualizado con éxito", "success");
        } else {
            patientData.createdAt = new Date().toISOString(); // Este campo se usa para ordenar los "últimos"
            patientData.createdBy = userId;
            await addDoc(pacientesCollectionRef, patientData);
            updateTotalPatientCount();
            showToast("Paciente ingresado con éxito", "success");
        }
        
        resetForm();
        showView('consulta-view');
        // Forzamos recarga de la lista para ver el nuevo
        applyFiltersAndRender();
        
    } catch (error) {
        console.error("Error al guardar paciente:", error);
        showToast("Error al guardar el paciente.", "error");
    } finally {
        showLoading(false);
    }
}

/** Limpia el formulario y el estado de edición */
function resetForm() {
    document.getElementById('patient-form').reset();
    editingPatientId = null;
    selectedDiagnosticos = [];
    updateSelectedDiagnosticosDisplay();
    document.getElementById('form-title').textContent = "Ingreso de Nuevo Paciente";
    document.getElementById('btn-submit-form').textContent = "Guardar Paciente";
    document.getElementById('btn-cancelar-edicion').classList.add('hidden');
}

/** Maneja el clic en los botones de la lista de pacientes */
function handlePatientListClick(e) {
    const button = e.target.closest('button');
    if (!button) return;

    const action = button.dataset.action;
    const id = button.dataset.id;
    const name = button.dataset.name;

    if (action === 'edit') {
        const patient = filteredPacientes.find(p => p.id === id);
        if (patient) {
            const form = document.getElementById('patient-form');
            form.nombre.value = patient.nombre || '';
            form.fechaNacimiento.value = patient.fechaNacimiento || '';
            form.peso.value = patient.peso || null;
            form.edadGestacional.value = patient.edadGestacional || null;
            form.procedencia.value = patient.procedencia || '';
            form.fechaInternacion.value = patient.fechaInternacion || '';
            form.fechaEgreso.value = patient.fechaEgreso || '';
            form.statusEgreso.value = patient.statusEgreso || '';
            selectedDiagnosticos = Array.isArray(patient.diagnosticos) ? [...patient.diagnosticos] : [];
            updateSelectedDiagnosticosDisplay();
            editingPatientId = patient.id;
            document.getElementById('form-title').textContent = "Editando Paciente";
            document.getElementById('btn-submit-form').textContent = "Actualizar Paciente";
            document.getElementById('btn-cancelar-edicion').classList.remove('hidden');
            showView('ingreso-view');
        } else {
            showToast("Error al cargar paciente. Intente de nuevo.", "error");
        }
        
    } else if (action === 'delete') {
        patientToDeleteId = id;
        showDeleteModal(true, name);
    } else if (action === 'share') { // <-- NUEVO: Manejo del botón Compartir
        const patient = filteredPacientes.find(p => p.id === id);
        if (patient) {
            sharePatientSummary(patient);
        } else {
             showToast("Error: No se encontró el paciente para compartir.", "error");
        }
    }
}

/** Genera el resumen del paciente y lo copia al portapapeles. */
function sharePatientSummary(patient) {
    const summary = `
--- FICHA NEONATOLOGÍA ---
Paciente: ${patient.nombre || 'N/A'}
F. Nacimiento: ${patient.fechaNacimiento || 'N/A'}
Edad Gestacional: ${patient.edadGestacional ? `${patient.edadGestacional} sem` : 'N/A'}
Peso: ${patient.peso ? `${patient.peso} gr` : 'N/A'}
Procedencia: ${patient.procedencia || 'N/A'}

F. Internación: ${patient.fechaInternacion || 'N/A'}
F. Egreso: ${patient.fechaEgreso || 'N/A'}
Status Egreso: ${patient.statusEgreso || 'Internado'}

Diagnósticos:
- ${Array.isArray(patient.diagnosticos) && patient.diagnosticos.length > 0
    ? patient.diagnosticos.join('\n- ')
    : 'Ninguno registrado'}
    
ID Interno: ${patient.id || 'N/A'}
`;

    // Copiar el texto al portapapeles
    // Usamos el método 'execCommand' como alternativa robusta en iframes
    const textarea = document.createElement('textarea');
    textarea.value = summary;
    textarea.style.position = 'fixed'; // Para evitar desplazamiento
    textarea.style.opacity = 0;
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    
    try {
        const successful = document.execCommand('copy');
        if (successful) {
            showToast(`Ficha de ${patient.nombre} copiada al portapapeles.`, 'success');
        } else {
             showToast("Error: No se pudo copiar el texto. Intente manualmente.", 'warn');
        }
    } catch (err) {
        console.error('Error al intentar copiar:', err);
        showToast("Error: El navegador no permite copiar automáticamente.", 'error');
    } finally {
        document.body.removeChild(textarea);
    }
}

// ... (Resto de las funciones de UI, Modales y Lógica de Diagnósticos) ...

/** Confirma y ejecuta el borrado del paciente */
async function confirmDeletePatient() {
    if (!patientToDeleteId) return;
    
    showLoading(true, "Borrando paciente...");
    try {
        const patientRef = doc(db, `artifacts/${appId}/public/data/pacientes`, patientToDeleteId);
        await deleteDoc(patientRef);
        updateTotalPatientCount();
        showToast("Paciente borrado con éxito", "success");
    } catch (error) {
        console.error("Error al borrar paciente:", error);
        showToast("Error al borrar el paciente.", "error");
    } finally {
        showDeleteModal(false);
        showLoading(false);
        applyFiltersAndRender();
    }
}

// --- LÓGICA DEL MODAL DE DIAGNÓSTICOS ---

/** Actualiza la lista combinada de diagnósticos y el select de filtro */
function updateAllDiagnosticosList() {
    allDiagnosticos = [...baseDiagnosticos, ...customDiagnosticos].sort();
    
    const selectPatologia = document.getElementById('search-patologia');
    const currentValue = selectPatologia.value; 
    
    selectPatologia.innerHTML = '<option value="">-- Todas las Patologías --</option>';
    
    allDiagnosticos.forEach(diag => {
        const option = document.createElement('option');
        option.value = diag;
        option.textContent = diag;
        selectPatologia.appendChild(option);
    });
    
    selectPatologia.value = currentValue;
}

/** Renderiza la lista de checkboxes en el modal de diagnósticos */
function renderDiagnosticoModalList() {
    const listContainer = document.getElementById('diag-modal-list');
    const filter = document.getElementById('diag-modal-search').value.toLowerCase();
    
    listContainer.innerHTML = '';
    
    const diagnosToShow = allDiagnosticos.filter(d => d.toLowerCase().includes(filter));
    
    if (diagnosToShow.length === 0 && filter === '') {
        listContainer.innerHTML = '<p class="text-gray-500">Cargando diagnósticos...</p>';
        return;
    }

    if (diagnosToShow.length === 0 && filter !== '') {
        listContainer.innerHTML = `<p class="text-gray-500">No se encontraron diagnósticos para "${filter}".</p>`;
        return;
    }

    diagnosToShow.forEach(diag => {
        const isChecked = selectedDiagnosticos.includes(diag);
        const li = document.createElement('li');
        li.classList.add('flex', 'items-center', 'p-2', 'hover:bg-gray-100', 'rounded-md');
        li.innerHTML = `
            <label class="flex items-center w-full cursor-pointer">
                <input type="checkbox" 
                       class="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500" 
                       data-diag-name="${diag}" 
                       ${isChecked ? 'checked' : ''}>
                <span class="ml-3 text-gray-700">${diag}</span>
            </label>
        `;
        
        li.querySelector('input').addEventListener('change', (e) => {
            const name = e.target.dataset.diagName;
            if (e.target.checked) {
                if (!selectedDiagnosticos.includes(name)) {
                    selectedDiagnosticos.push(name);
                }
            } else {
                selectedDiagnosticos = selectedDiagnosticos.filter(d => d !== name);
            }
        });
        
        listContainer.appendChild(li);
    });
}

/** Guarda los diagnósticos seleccionados del modal al formulario */
function saveDiagnosticosFromModal() {
    updateSelectedDiagnosticosDisplay();
    showDiagnosticoModal(false);
}

/** Actualiza el display de diagnósticos seleccionados en el formulario */
function updateSelectedDiagnosticosDisplay() {
    const container = document.getElementById('selected-diagnosticos-display');
    if (selectedDiagnosticos.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-500">Ningún diagnóstico seleccionado.</p>';
    } else {
        container.innerHTML = selectedDiagnosticos
            .map(d => `<span class="inline-flex items-center bg-blue-100 text-blue-800 text-sm font-medium mr-2 mb-2 px-2.5 py-0.5 rounded-full">${d}</span>`)
            .join('');
    }
}

/** Agrega un nuevo diagnóstico customizado a Firestore */
async function addNewDiagnostico() {
    const input = document.getElementById('diag-modal-new-diag');
    const newDiagName = input.value.trim();
    
    if (!newDiagName) {
        showToast("Escriba un nombre para el diagnóstico", "warn");
        return;
    }
    
    if (allDiagnosticos.some(d => d.toLowerCase() === newDiagName.toLowerCase())) {
        showToast("Ese diagnóstico ya existe", "warn");
        return;
    }
    
    try {
        await addDoc(customDiagnosticosCollectionRef, { nombre: newDiagName });
        showToast("Diagnóstico agregado", "success");
        input.value = '';
        if (!selectedDiagnosticos.includes(newDiagName)) {
             selectedDiagnosticos.push(newDiagName);
        }
        renderDiagnosticoModalList();
    } catch (error) {
        console.error("Error agregando diagnóstico:", error);
        showToast("No se pudo agregar el diagnóstico", "error");
    }
}

// --- LÓGICA DE CONSULTA Y FILTRADO ---

/** Aplica filtros, consulta a Firestore y renderiza */
async function applyFiltersAndRender() {
    const searchInput = document.getElementById('search-general');
    if (!searchInput) return;

    // 1. OBTENER TODOS LOS FILTROS
    const searchTerm = searchInput.value.toLowerCase(); // Convertido a minúsculas
    const dateStart = document.getElementById('search-date-start').value;
    const dateEnd = document.getElementById('search-date-end').value;
    const egStartValue = document.getElementById('search-eg-start').value;
    const egEndValue = document.getElementById('search-eg-end').value;
    const patologiaFilter = document.getElementById('search-patologia').value;

    const egStart = parseFloat(egStartValue);
    const egEnd = parseFloat(egEndValue);

    // 2. VERIFICAR SI HAY FILTROS ACTIVOS
    const hasFilters =
        (searchTerm && searchTerm.trim() !== '') ||
        dateStart || dateEnd ||
        !isNaN(egStart) || !isNaN(egEnd) ||
        patologiaFilter;

    // Si no hay filtros, CARGAR LOS ÚLTIMOS 3 INGRESOS
    if (!hasFilters) {
        showLoading(true, "Cargando últimos ingresos...");
        try {
            // Consulta: Ordenar por fecha de creación (descendente) y limitar a 3
            const q = query(pacientesCollectionRef, orderBy("createdAt", "desc"), limit(3));
            const querySnapshot = await getDocs(q);
            
            filteredPacientes = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            // Renderizar (false indica que no es un filtro de búsqueda activa)
            renderPatientList(filteredPacientes, false);
        } catch (error) {
            console.error("Error cargando últimos pacientes:", error);
            // Si falla (ej: falta índice o campo createdAt), mostramos lista vacía
            filteredPacientes = [];
            renderPatientList([], false);
        } finally {
            showLoading(false);
        }
        return;
    }

    // 3. MOSTRAR CARGA Y PREPARAR CONSULTA DE FILTROS
    showLoading(true, "Buscando...");
    
    const qConstraints = []; 

    // 4. CONSTRUIR LAS CONDICIONES DE CONSULTA
    
    // Filtro Patología
    if (patologiaFilter) {
        qConstraints.push(where("diagnosticos", "array-contains", patologiaFilter));
    }
    // Filtro Fecha Nacimiento
    if (dateStart) {
        qConstraints.push(where("fechaNacimiento", ">=", dateStart));
    }
    if (dateEnd) {
        qConstraints.push(where("fechaNacimiento", "<=", dateEnd));
    }
    // Filtro Edad Gestacional
    if (!isNaN(egStart)) {
        qConstraints.push(where("edadGestacional", ">=", egStart));
    }
    if (!isNaN(egEnd)) {
        qConstraints.push(where("edadGestacional", "<=", egEnd));
    }
    
    // Filtro Nivel Pro por Nombre (keywords)
    if (searchTerm) {
        const searchKeywords = searchTerm.split(' ').filter(kw => kw.length > 0);
        searchKeywords.forEach(kw => {
            qConstraints.push(where("nombre_keywords", "array-contains", kw));
        });
    }
    
    // 5. EJECUTAR LA CONSULTA
    try {
        const q = query(pacientesCollectionRef, ...qConstraints);
        const querySnapshot = await getDocs(q);
        
        filteredPacientes = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        renderPatientList(filteredPacientes, true);

    } catch (error) {
        console.error("Error en la consulta:", error);
        showToast("Error al buscar. (Posiblemente falte un índice en Firebase. Revisa la consola de JS para el link)", "error");
        console.log("======================================");
        console.log("ERROR DE FIRESTORE: Si el error menciona un índice, copiá y pegá el link que aparece en esta consola para crearlo.");
        console.log("======================================");
    } finally {
        showLoading(false);
    }
}


/** Renderiza la lista de pacientes en la vista de consulta */
function renderPatientList(pacientes, hasFilter) {
    const listContainer = document.getElementById('patient-list-container');
    const counterEl = document.getElementById('patient-count');
    
    if (!listContainer || !counterEl) return;

    const total = totalPatientCount || 0;

    if (hasFilter) {
        // Caso búsqueda activa
        counterEl.textContent = `Total ingresados: ${total} paciente(s). Coinciden con la búsqueda: ${pacientes.length}`;
    } else {
        // Caso vista por defecto (últimos 3)
        if (pacientes.length > 0) {
            counterEl.textContent = `Total ingresados: ${total}. Mostrando los últimos ${pacientes.length} ingresos.`;
        } else {
            counterEl.textContent = `Total ingresados: ${total} paciente(s). Use los filtros para buscar.`;
        }
    }
    
    // Si no hay pacientes y NO es la vista por defecto con últimos ingresos
    if ((!pacientes || pacientes.length === 0) && hasFilter) {
        listContainer.innerHTML = '<p class="text-gray-500 text-center py-8">No se encontraron pacientes que coincidan con la búsqueda.</p>';
        return;
    }
    
    // Si no hay pacientes y ES la vista por defecto (ej: base de datos vacía o error)
    if ((!pacientes || pacientes.length === 0) && !hasFilter) {
        listContainer.innerHTML = '<p class="text-gray-500 text-center py-8">Use los filtros de arriba para realizar una búsqueda.</p>';
        return;
    }
    
    listContainer.innerHTML = `
        <div class="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
            <table class="min-w-full divide-y divide-gray-200 bg-white">
                <thead class="bg-gray-50">
                    <tr>
                        <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nombre</th>
                        <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell">F. Nac.</th>
                        <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Peso</th>
                        <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">EG</th>
                        <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">Procedencia</th>
                        <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">Status Egreso</th>
                        <th scope="col" class="relative px-6 py-3"><span class="sr-only">Acciones</span></th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-200">
                    ${pacientes.map(p => `
                        <tr class="hover:bg-gray-50">
                            <td class="px-6 py-4 whitespace-nowrap">
                                <div class="text-sm font-medium text-gray-900">${p.nombre}</div>
                                <div class="text-sm text-gray-500 md:hidden">${p.fechaNacimiento || 'N/A'}</div>
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 hidden sm:table-cell">${p.fechaNacimiento || 'N/A'}</td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${p.peso ? `${p.peso} gr` : 'N/A'}</td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${p.edadGestacional ? `${p.edadGestacional} sem` : 'N/A'}</td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 hidden md:table-cell">${p.procedencia || 'N/A'}</td>
                            <td class="px-6 py-4 whitespace-nowrap hidden md:table-cell">
                                ${p.statusEgreso ? `<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                    p.statusEgreso === 'Alta' ? 'bg-green-100 text-green-800' :
                                    p.statusEgreso === 'Derivación' ? 'bg-yellow-100 text-yellow-800' :
                                    p.statusEgreso === 'Obito' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'
                                }">${p.statusEgreso}</span>` : '<span class="text-gray-400">Internado</span>'}
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium flex justify-end space-x-2">
                                <button data-action="share" data-id="${p.id}" data-name="${p.nombre}" class="text-gray-500 hover:text-blue-500" title="Compartir Ficha">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684L12 12l-3.316-1.342m0 2.684a2 2 0 110-2.684m0 2.684c.245.485.49 1.485.49 2.073 0 1.054-1.127 1.472-2.316 1.472s-2.316-.418-2.316-1.472c0-.588.245-1.588.49-2.073m4.632 0h.442c.749 0 1.51.326 2.014.946l3.65 4.542a1.865 1.865 0 01-1.077 2.628L10 20l-1.92-2.421a1.865 1.865 0 01-1.077-2.628l3.65-4.542a1.865 1.865 0 012.014-.946z"/></svg>
                                </button>
                                <button data-action="edit" data-id="${p.id}" data-name="${p.nombre}" class="text-blue-600 hover:text-blue-900" title="Editar">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                                </button>
                                <button data-action="delete" data-id="${p.id}" data-name="${p.nombre}" class="text-red-600 hover:text-red-900 ml-1" title="Borrar">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// --- LÓGICA DE EXPORTACIÓN ---

/** Exporta un array de datos a un archivo CSV */
function exportToCsv(dataToExport, filename) {
    if (!dataToExport || dataToExport.length === 0) {
        showToast("No hay datos para exportar", "warn");
        return;
    }
    
    const headers = [
        "ID", "Nombre", "Fecha Nacimiento", "Peso (gr)", "EG (sem)", "Procedencia", 
        "Fecha Internación", "Fecha Egreso", "Status Egreso", "Diagnósticos"
    ];
    const csvRows = [headers.join(',')];

    dataToExport.forEach(p => {
        const escapeCSV = (val) => {
            if (val === undefined || val === null) return '';
            let str = String(val);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                str = `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        const diagnosticosStr = Array.isArray(p.diagnosticos) ? p.diagnosticos.join('; ') : '';
        
        const values = [
            p.id,
            p.nombre,
            p.fechaNacimiento,
            p.peso,
            p.edadGestacional,
            p.procedencia,
            p.fechaInternacion,
            p.fechaEgreso,
            p.statusEgreso,
            diagnosticosStr
        ].map(escapeCSV);
        
        csvRows.push(values.join(','));
    });

    const csvString = csvRows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast("Datos exportados", "success");
}

/** Exporta TODOS los pacientes de la base de datos */
async function handleExportAll() {
    showLoading(true, "Exportando todos los pacientes...");

    try {
        // 1. Consultar TODOS los pacientes, sin filtros
        const querySnapshot = await getDocs(pacientesCollectionRef);
        
        // 2. Mapear los resultados
        const allPacientes = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        if (allPacientes.length === 0) {
            showToast("No hay pacientes para exportar", "warn");
            showLoading(false); // No olvidar ocultar el loading
            return;
        }

        // 3. Llamar a la función de exportación existente
        exportToCsv(allPacientes, 'pacientes_neo_total');

    } catch (error) {
        console.error("Error al exportar todo:", error);
        showToast("Error al exportar todos los pacientes", "error");
    } finally {
        showLoading(false);
    }
}


// --- DATOS (DIAGNÓSTICOS) ---

/** Popula la lista base de diagnósticos (MODO ANTIGUO) */
function populateBaseDiagnosticos() {
     baseDiagnosticos = [
        "Taquipnea Transitoria del Recién Nacido (TTRN)", "Síndrome de Dificultad Respiratoria (SDR)", "Síndrome de Aspiración de Líquido Amniótico Meconial (SALAM)", 
        "Hipertensión Pulmonar Persistente del Recién Nacido (HPPRN)", "Neumonía Neonatal Precoz", "Neumonía Neonatal Tardía", "Displasia Broncopulmonar (DBP)", 
        "Apnea del Prematuro", "Neumotórax", "Hernia Diafragmática Congénita", "Atresia de Coanas", "Enfisema Lobar Congénito", "Malformación Adenomatosa Quística Pulmonar", 
        "Hiperbilirrubinemia Neonatal", "Hipoglucemia Neonatal", "Hipocalcemia Neonatal", "Hipotermia Neonatal", "Inestabilidad Térmica", "Anemia del Prematuro", 
        "Policitemia Neonatal", "Enfermedad Hemorrágica del Recién Nacido", "Trombocitopenia Neonatal Inmune", "Trombocitopenia Neonatal No Inmune", 
        "Trastornos de la Coagulación Neonatal", "Hiponatremia", "Hipernatremia", "Hipomagnesemia", "Sospecha de Error Innato del Metabolismo", 
        "Sospecha de Sepsis Neonatal Precoz", "Sepsis Neonatal Precoz Confirmada", "Sospecha de Sepsis Neonatal Tardía", "Sepsis Neonatal Tardía Confirmada", 
        "Meningitis Neonatal", "Infección por Citomegalovirus (CMV) Congénito", "Infección por Herpes Simple (HSV) Neonatal", "Sífilis Congénita", 
        "Toxoplasmosis Congénita", "Conjuntivitis Neonatal Química", "Conjuntivitis Neonatal Gonocócica", "Conjuntivitis Neonatal por Clamidia", "Onfalitis", 
        "Candidiasis Sistémica Neonatal", "Infección del Tracto Urinario (ITU) Neonatal", "Encefalopatía Hipóxico-Isquémica (EHI)", "Convulsiones Neonatales", 
        "Hemorragia Intraventricular Grado I", "Hemorragia Intraventricular Grado II", "Hemorragia Intraventricular Grado III", "Hemorragia Intraventricular Grado IV", 
        "Leucomalacia Periventricular (LPV)", "Hidrocefalia Congénita", "Hidrocefalia Adquirida", "Mielomeningocele", "Microcefalia", "Macrocefalia", 
        "Síndrome de Abstinencia Neonatal (SAN)", "Hemorragia Subdural Neonatal", "Hemorragia Subaracnoidea Neonatal", "Hipotonía Neonatal", 
        "Parálisis Braquial Obstétrica", "Parálisis Facial Neonatal", "Ductus Arterioso Persistente (PCA)", "Comunicación Interauricular (CIA)", 
        "Comunicación Interventricular (CIV)", "Coartación de Aorta (CoA)", "Tetralogía de Fallot", "Transposición de Grandes Vasos (TGV)", 
        "Síndrome de Corazón Izquierdo Hipoplásico", "Canal Auriculoventricular", "Estenosis Pulmonar Crítica", "Estenosis Aórtica Crítica", "Shock Séptico Neonatal", 
        "Shock Cardiogénico Neonatal", "Shock Hipovolémico Neonatal", "Taquicardia Supraventricular Neonatal", "Sospecha de Enterocolitis Necrotizante", 
        "Enterocolitis Necrotizante Confirmada", "Reflujo Gastroesofágico (RGE) Neonatal", "Dificultades de Alimentación", "Intolerancia Alimentaria", 
        "Atresia Esofágica", "Fístula Traqueoesofágica", "Atresia Duodenal", "Estenosis Duodenal", "Atresia Yeyuno-ileal", "Malrotación Intestinal", 
        "Vólvulo Intestinal", "Enfermedad de Hirschsprung", "Íleo Meconial", "Ano Imperforado", "Gastrosquisis", "Onfalocele", "Diarrea Neonatal Infecciosa", 
        "Diarrea Neonatal Metabólica", "Deshidratación Neonatal", 
        "Prematurez", // Diagnóstico consolidado
        "Restricción del Crecimiento Intrauterino (RCIU)", "Pequeño para la Edad Gestacional (PEG)", "Retinopatía del Prematuro (ROP) Estadio 1", 
        "Retinopatía del Prematuro (ROP) Estadio 2", "Retinopatía del Prematuro (ROP) Estadio 3", "Retinopatía del Prematuro (ROP) Estadio 4", 
        "Retinopatía del Prematuro (ROP) Estadio 5", "Osteopenia del Prematuro", "Hipoacusia Neonatal", "Bajo Peso al Nacer (BPN)", "Muy Bajo Peso al Nacer (MBPN)", 
        "Extremado Bajo Peso al Nacer (EBPN)", "Insuficiencia Renal Aguda (IRA) Neonatal", "Hidronefrosis Neonatal", "Reflujo Vesicoureteral", 
        "Válvulas de Uretra Posterior", "Extrofia Vesical", "Hipospadias", "Epispadias", "Trastorno del Desarrollo Sexual (Genitales Ambiguos)", 
        "Riñón Multiquístico Displásico", "Displasia del Desarrollo de la Cadera (DDC)", "Fisura Labiopalatina", "Síndrome de Down (Trisomía 21)", 
        "Síndrome de Edwards (Trisomía 18)", "Síndrome de Patau (Trisomía 13)", "Síndrome de Turner", "Pie Equinovaro (Pie Zambo)", "Cefalohematoma", 
        "Caput Succedaneum", "Fractura de Clavícula Obstétrica", "Linfangioma / Higroma Quístico", "Hemangioma Infantil", "Hiperplasia Suprarrenal Congénita", 
        "Hipotiroidismo Congénito"
    ];
    baseDiagnosticos.sort();
}
