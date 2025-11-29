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

let filteredPacientes = []; 
let totalPatientCount = 0; 
let baseDiagnosticos = []; 
let customDiagnosticos = []; 
let allDiagnosticos = []; 

let selectedDiagnosticos = []; 
let editingPatientId = null; 
let patientToDeleteId = null; 

// Variable para la suscripción del Dashboard
let unsubscribeDashboard = null;

// --- CONFIGURACIÓN DE FIREBASE ---
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
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    setLogLevel('Debug'); 

    populateBaseDiagnosticos();
    setupUIListeners();
    handleAuth();
});

// --- MANEJO DE AUTENTICACIÓN ---

function handleAuth() {
    showLoading(true, "Conectando...");
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            userId = user.uid;
            console.log("Usuario autenticado:", userId);
            const userDisplay = document.getElementById('user-id-display');
            if(userDisplay) userDisplay.textContent = `ID: ${userId.substring(0,6)}...`;

            const publicDataPath = `artifacts/${appId}/public/data`;
            pacientesCollectionRef = collection(db, `${publicDataPath}/pacientes`);
            customDiagnosticosCollectionRef = collection(db, `${publicDataPath}/diagnosticos_custom`);
            
            loadCustomDiagnosticos(); 
            updateTotalPatientCount(); 
            
            // Inicializar Dashboard con fecha actual
            initDashboard();

            // Cargar vista por defecto
            applyFiltersAndRender(); 
            showLoading(false);
            showView('ingreso-view'); 
        } else {
            try {
                if (typeof __initial_auth_token !== 'undefined') {
                    await signInWithCustomToken(auth, __initial_auth_token);
                } else {
                    await signInAnonymously(auth);
                }
            } catch (error) {
                console.error("Error de autenticación:", error);
                showLoading(false);
                showToast("Error de autenticación.", 'error');
            }
        }
    });
}

async function updateTotalPatientCount() {
    try {
        const snapshot = await getCountFromServer(pacientesCollectionRef);
        totalPatientCount = snapshot.data().count;
        const counterEl = document.getElementById('patient-count');
        if (counterEl && !document.getElementById('consulta-view').classList.contains('hidden')) {
             renderPatientList(filteredPacientes, false);
        }
    } catch (error) {
        console.error("Error al obtener el conteo total:", error);
    }
}

function loadCustomDiagnosticos() {
    onSnapshot(query(customDiagnosticosCollectionRef), (snapshot) => {
        customDiagnosticos = snapshot.docs.map(doc => doc.data().nombre).sort();
        updateAllDiagnosticosList();
    }, (error) => {
        console.error("Error al cargar diagnósticos custom:", error);
    });
}

// --- MANEJO DE UI ---

function setupUIListeners() {
    // Pestañas
    document.getElementById('tab-ingreso').addEventListener('click', () => showView('ingreso-view'));
    document.getElementById('tab-consulta').addEventListener('click', () => {
        showView('consulta-view');
        applyFiltersAndRender();
    });
    document.getElementById('tab-dashboard').addEventListener('click', () => {
        showView('dashboard-view');
        updateDashboardStats(); // Forzar actualización al entrar
    });

    // Botones
    document.getElementById('btn-nuevo-paciente').addEventListener('click', () => {
        resetForm();
        showView('ingreso-view');
    });

    // Dashboard Selectors
    document.getElementById('dash-month').addEventListener('change', updateDashboardStats);
    document.getElementById('dash-year').addEventListener('change', updateDashboardStats);

    // Formularios
    document.getElementById('patient-form').addEventListener('submit', handleFormSubmit);
    document.getElementById('btn-cancelar-edicion').addEventListener('click', (e) => {
        e.preventDefault();
        resetForm();
        showView('consulta-view');
    });

    // Modales
    document.getElementById('btn-open-diag-modal').addEventListener('click', () => showDiagnosticoModal(true));
    document.getElementById('btn-close-diag-modal').addEventListener('click', () => showDiagnosticoModal(false));
    document.getElementById('btn-save-diag-modal').addEventListener('click', saveDiagnosticosFromModal);
    document.getElementById('diag-modal-search').addEventListener('input', renderDiagnosticoModalList);
    document.getElementById('btn-add-new-diag').addEventListener('click', addNewDiagnostico);
    
    document.getElementById('btn-cancel-delete').addEventListener('click', () => showDeleteModal(false));
    document.getElementById('btn-confirm-delete').addEventListener('click', confirmDeletePatient);

    // Filtros
    document.getElementById('search-general').addEventListener('input', applyFiltersAndRender);
    document.getElementById('search-date-start').addEventListener('change', applyFiltersAndRender);
    document.getElementById('search-date-end').addEventListener('change', applyFiltersAndRender);
    document.getElementById('search-eg-start').addEventListener('input', applyFiltersAndRender);
    document.getElementById('search-eg-end').addEventListener('input', applyFiltersAndRender);
    document.getElementById('search-patologia').addEventListener('change', applyFiltersAndRender);

    // Exportar
    document.getElementById('btn-export-filtered').addEventListener('click', () => exportToCsv(filteredPacientes, 'pacientes_neo_vista'));
    document.getElementById('btn-export-all').addEventListener('click', handleExportAll); 
    
    // Acciones tabla
    document.getElementById('patient-list-container').addEventListener('click', handlePatientListClick);
}

function showView(viewId) {
    const views = ['ingreso-view', 'consulta-view', 'dashboard-view'];
    const tabs = ['tab-ingreso', 'tab-consulta', 'tab-dashboard'];

    // Ocultar todas las vistas y desactivar pestañas
    views.forEach((v, idx) => {
        const el = document.getElementById(v);
        const tab = document.getElementById(tabs[idx]);
        
        if (v === viewId) {
            el.classList.remove('hidden');
            tab.classList.add('active');
            tab.classList.remove('inactive');
        } else {
            el.classList.add('hidden');
            tab.classList.remove('active');
            tab.classList.add('inactive');
        }
    });
}

function showLoading(show, message = "Cargando...") {
    const overlay = document.getElementById('loading-overlay');
    const messageEl = document.getElementById('loading-message');
    if (show) {
        if(messageEl) messageEl.textContent = message;
        overlay.classList.remove('hidden');
    } else {
        overlay.classList.add('hidden');
    }
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast-notification');
    const toastMessage = document.getElementById('toast-message');
    
    toastMessage.textContent = message;
    
    toast.className = "fixed bottom-5 right-5 max-w-sm w-full bg-white border-l-4 p-4 rounded shadow-lg flex items-center transition-all duration-500 z-50 transform";
    
    if (type === 'success') {
        toast.classList.add('border-green-500');
        toastMessage.classList.add('text-green-700');
    } else if (type === 'error') {
        toast.classList.add('border-red-500');
        toastMessage.classList.add('text-red-700');
    } else {
        toast.classList.add('border-yellow-500');
        toastMessage.classList.add('text-yellow-700');
    }
    
    toast.classList.remove('hidden', 'translate-y-10', 'opacity-0');
    
    setTimeout(() => {
        toast.classList.add('translate-y-10', 'opacity-0');
        setTimeout(() => toast.classList.add('hidden'), 500);
    }, 3000);
}

// --- LOGICA DASHBOARD ---

function initDashboard() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // JS months are 0-indexed

    // Llenar selector de años (Actual - 2 hasta Actual + 2)
    const yearSelect = document.getElementById('dash-year');
    yearSelect.innerHTML = '';
    for (let y = currentYear - 2; y <= currentYear + 2; y++) {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = y;
        if (y === currentYear) opt.selected = true;
        yearSelect.appendChild(opt);
    }

    // Setear mes actual
    document.getElementById('dash-month').value = currentMonth;

    // Iniciar listener
    updateDashboardStats();
}

function updateDashboardStats() {
    const month = parseInt(document.getElementById('dash-month').value);
    const year = parseInt(document.getElementById('dash-year').value);

    let startStr, endStr;

    if (month === 0) {
        // Año Completo
        startStr = `${year}-01-01`;
        endStr = `${year}-12-31`;
    } else {
        // Mes Específico
        startStr = `${year}-${String(month).padStart(2, '0')}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        endStr = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
    }

    console.log(`Actualizando Dashboard para: ${startStr} al ${endStr}`);

    // Cancelar suscripción anterior si existe
    if (unsubscribeDashboard) {
        unsubscribeDashboard();
    }

    // Usar 'fechaInternacion' como criterio principal para "Ingresos del periodo"
    const q = query(
        pacientesCollectionRef, 
        where("fechaInternacion", ">=", startStr),
        where("fechaInternacion", "<=", endStr)
    );

    unsubscribeDashboard = onSnapshot(q, (snapshot) => {
        const pacientes = snapshot.docs.map(doc => doc.data());
        calculateAndRenderStats(pacientes);
    }, (error) => {
        console.error("Error en Dashboard:", error);
    });
}

function calculateAndRenderStats(pacientes) {
    // 1. Contadores Básicos
    const total = pacientes.length;
    const altas = pacientes.filter(p => p.statusEgreso === 'Alta').length;
    const obitos = pacientes.filter(p => p.statusEgreso === 'Obito').length;
    const derivaciones = pacientes.filter(p => p.statusEgreso === 'Derivación').length;

    document.getElementById('stat-ingresos').textContent = total;
    document.getElementById('stat-altas').textContent = altas;
    document.getElementById('stat-obitos').textContent = obitos;
    document.getElementById('stat-derivaciones').textContent = derivaciones;

    // 2. Promedios (Peso y EG)
    let sumPeso = 0;
    let countPeso = 0;
    let sumEG = 0;
    let countEG = 0;
    let allDiags = [];

    pacientes.forEach(p => {
        if (p.peso && !isNaN(p.peso)) {
            sumPeso += Number(p.peso);
            countPeso++;
        }
        if (p.edadGestacional && !isNaN(p.edadGestacional)) {
            sumEG += Number(p.edadGestacional);
            countEG++;
        }
        if (Array.isArray(p.diagnosticos)) {
            allDiags.push(...p.diagnosticos);
        }
    });

    const avgPeso = countPeso > 0 ? Math.round(sumPeso / countPeso) : '-';
    const avgEG = countEG > 0 ? (sumEG / countEG).toFixed(1) : '-';

    document.getElementById('stat-avg-peso').textContent = avgPeso;
    document.getElementById('stat-avg-eg').textContent = avgEG;

    // 3. Top 5 Diagnósticos
    const diagCounts = {};
    allDiags.forEach(d => {
        diagCounts[d] = (diagCounts[d] || 0) + 1;
    });

    // Convertir a array, ordenar y tomar top 5
    const sortedDiags = Object.entries(diagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    const listEl = document.getElementById('stat-top-diag');
    listEl.innerHTML = '';
    
    if (sortedDiags.length === 0) {
        listEl.innerHTML = '<li class="italic text-gray-400">Sin datos registrados</li>';
    } else {
        sortedDiags.forEach(([name, count]) => {
            const li = document.createElement('li');
            li.className = "flex justify-between items-center border-b border-gray-100 pb-1 last:border-0";
            li.innerHTML = `
                <span class="truncate pr-2">${name}</span>
                <span class="bg-blue-100 text-blue-800 text-xs font-semibold px-2 py-0.5 rounded-full">${count}</span>
            `;
            listEl.appendChild(li);
        });
    }
}

// --- LOGICA MODALES Y FORMULARIOS (Resto de funciones igual) ---

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

async function handleFormSubmit(e) {
    e.preventDefault();
    showLoading(true, "Guardando...");

    const form = e.target;
    
    const nombreOriginal = form.nombre.value;
    const keywords = nombreOriginal.toLowerCase().split(' ').filter(kw => kw.length > 0);

    const patientData = {
        nombre: nombreOriginal,
        nombre_keywords: keywords, 
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
            showToast("Paciente actualizado", "success");
        } else {
            patientData.createdAt = new Date().toISOString(); 
            patientData.createdBy = userId;
            await addDoc(pacientesCollectionRef, patientData);
            updateTotalPatientCount();
            showToast("Paciente ingresado", "success");
        }
        
        resetForm();
        showView('consulta-view');
        applyFiltersAndRender();
        
    } catch (error) {
        console.error("Error al guardar:", error);
        showToast("Error al guardar.", "error");
    } finally {
        showLoading(false);
    }
}

function resetForm() {
    document.getElementById('patient-form').reset();
    editingPatientId = null;
    selectedDiagnosticos = [];
    updateSelectedDiagnosticosDisplay();
    document.getElementById('form-title').textContent = "Nuevo Ingreso";
    document.getElementById('btn-submit-form').textContent = "Guardar Paciente";
    document.getElementById('btn-cancelar-edicion').classList.add('hidden');
}

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
            document.getElementById('btn-submit-form').textContent = "Actualizar Datos";
            document.getElementById('btn-cancelar-edicion').classList.remove('hidden');
            showView('ingreso-view');
        }
    } else if (action === 'delete') {
        patientToDeleteId = id;
        showDeleteModal(true, name);
    } else if (action === 'share') { 
        const patient = filteredPacientes.find(p => p.id === id);
        if (patient) sharePatientSummary(patient);
    }
}

function sharePatientSummary(patient) {
    const summary = `
*FICHA NEONATOLOGÍA*
👤 *${patient.nombre || 'N/A'}*
📅 Nac: ${patient.fechaNacimiento || 'N/A'}
⚖️ Peso: ${patient.peso ? `${patient.peso}gr` : 'N/A'} | EG: ${patient.edadGestacional ? `${patient.edadGestacional}sem` : 'N/A'}
🏥 Procedencia: ${patient.procedencia || 'N/A'}
🏷️ Status: ${patient.statusEgreso || 'Internado'}

📋 *Diagnósticos:*
${Array.isArray(patient.diagnosticos) && patient.diagnosticos.length > 0 ? patient.diagnosticos.join(', ') : 'S/D'}
`;
    
    navigator.clipboard.writeText(summary).then(() => {
        showToast("Ficha copiada al portapapeles", 'success');
    }).catch(err => {
        // Fallback
        const textarea = document.createElement('textarea');
        textarea.value = summary;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast("Ficha copiada", 'success');
    });
}

async function confirmDeletePatient() {
    if (!patientToDeleteId) return;
    
    showLoading(true, "Borrando...");
    try {
        const patientRef = doc(db, `artifacts/${appId}/public/data/pacientes`, patientToDeleteId);
        await deleteDoc(patientRef);
        updateTotalPatientCount();
        showToast("Paciente eliminado", "success");
    } catch (error) {
        console.error("Error al borrar:", error);
        showToast("Error al eliminar.", "error");
    } finally {
        showDeleteModal(false);
        showLoading(false);
        applyFiltersAndRender();
    }
}

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

function renderDiagnosticoModalList() {
    const listContainer = document.getElementById('diag-modal-list');
    const filter = document.getElementById('diag-modal-search').value.toLowerCase();
    
    listContainer.innerHTML = '';
    
    const diagnosToShow = allDiagnosticos.filter(d => d.toLowerCase().includes(filter));
    
    if (diagnosToShow.length === 0) {
        listContainer.innerHTML = '<p class="text-sm text-gray-400 italic p-2">No se encontraron resultados.</p>';
        return;
    }

    diagnosToShow.forEach(diag => {
        const isChecked = selectedDiagnosticos.includes(diag);
        const li = document.createElement('li');
        li.classList.add('flex', 'items-center', 'p-2', 'hover:bg-gray-50', 'rounded', 'cursor-pointer');
        li.innerHTML = `
            <label class="flex items-center w-full cursor-pointer">
                <input type="checkbox" 
                       class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" 
                       data-diag-name="${diag}" 
                       ${isChecked ? 'checked' : ''}>
                <span class="ml-3 text-sm text-gray-700">${diag}</span>
            </label>
        `;
        
        li.querySelector('input').addEventListener('change', (e) => {
            const name = e.target.dataset.diagName;
            if (e.target.checked) {
                if (!selectedDiagnosticos.includes(name)) selectedDiagnosticos.push(name);
            } else {
                selectedDiagnosticos = selectedDiagnosticos.filter(d => d !== name);
            }
        });
        
        listContainer.appendChild(li);
    });
}

function saveDiagnosticosFromModal() {
    updateSelectedDiagnosticosDisplay();
    showDiagnosticoModal(false);
}

function updateSelectedDiagnosticosDisplay() {
    const container = document.getElementById('selected-diagnosticos-display');
    if (selectedDiagnosticos.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-500 w-full text-center py-2">Ningún diagnóstico seleccionado.</p>';
    } else {
        container.innerHTML = selectedDiagnosticos
            .map(d => `<span class="inline-flex items-center bg-blue-50 text-blue-700 text-xs font-semibold mr-2 mb-2 px-2.5 py-1 rounded border border-blue-100">${d}</span>`)
            .join('');
    }
}

async function addNewDiagnostico() {
    const input = document.getElementById('diag-modal-new-diag');
    const newDiagName = input.value.trim();
    
    if (!newDiagName) return;
    
    if (allDiagnosticos.some(d => d.toLowerCase() === newDiagName.toLowerCase())) {
        showToast("Ya existe ese diagnóstico", "warn");
        return;
    }
    
    try {
        await addDoc(customDiagnosticosCollectionRef, { nombre: newDiagName });
        input.value = '';
        if (!selectedDiagnosticos.includes(newDiagName)) selectedDiagnosticos.push(newDiagName);
        renderDiagnosticoModalList();
    } catch (error) {
        console.error("Error agregando diagnóstico:", error);
    }
}

async function applyFiltersAndRender() {
    const searchInput = document.getElementById('search-general');
    if (!searchInput) return;

    const searchTerm = searchInput.value.toLowerCase(); 
    const dateStart = document.getElementById('search-date-start').value;
    const dateEnd = document.getElementById('search-date-end').value;
    const egStart = parseFloat(document.getElementById('search-eg-start').value);
    const egEnd = parseFloat(document.getElementById('search-eg-end').value);
    const patologiaFilter = document.getElementById('search-patologia').value;

    const hasFilters = (searchTerm && searchTerm.trim() !== '') || dateStart || dateEnd || !isNaN(egStart) || !isNaN(egEnd) || patologiaFilter;

    if (!hasFilters) {
        try {
            const q = query(pacientesCollectionRef, orderBy("createdAt", "desc"), limit(3));
            const querySnapshot = await getDocs(q);
            filteredPacientes = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderPatientList(filteredPacientes, false);
        } catch (error) {
            console.error("Error:", error);
            renderPatientList([], false);
        }
        return;
    }

    showLoading(true, "Filtrando...");
    const qConstraints = []; 

    if (patologiaFilter) qConstraints.push(where("diagnosticos", "array-contains", patologiaFilter));
    if (dateStart) qConstraints.push(where("fechaNacimiento", ">=", dateStart));
    if (dateEnd) qConstraints.push(where("fechaNacimiento", "<=", dateEnd));
    if (!isNaN(egStart)) qConstraints.push(where("edadGestacional", ">=", egStart));
    if (!isNaN(egEnd)) qConstraints.push(where("edadGestacional", "<=", egEnd));
    
    if (searchTerm) {
        const searchKeywords = searchTerm.split(' ').filter(kw => kw.length > 0);
        searchKeywords.forEach(kw => {
            qConstraints.push(where("nombre_keywords", "array-contains", kw));
        });
    }
    
    try {
        const q = query(pacientesCollectionRef, ...qConstraints);
        const querySnapshot = await getDocs(q);
        filteredPacientes = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderPatientList(filteredPacientes, true);
    } catch (error) {
        console.error("Error en consulta:", error);
        showToast("Error en búsqueda (falta índice)", "error");
    } finally {
        showLoading(false);
    }
}

function renderPatientList(pacientes, hasFilter) {
    const listContainer = document.getElementById('patient-list-container');
    const counterEl = document.getElementById('patient-count');
    
    if (!listContainer || !counterEl) return;
    const total = totalPatientCount || 0;

    if (hasFilter) {
        counterEl.innerHTML = `Total: <b>${total}</b> | Filtrados: <b>${pacientes.length}</b>`;
    } else {
        counterEl.innerHTML = `Total Histórico: <b>${total}</b> (Mostrando últimos ${pacientes.length})`;
    }
    
    if ((!pacientes || pacientes.length === 0)) {
        listContainer.innerHTML = '<div class="p-8 text-center text-gray-400 bg-gray-50">No se encontraron pacientes.</div>';
        return;
    }
    
    listContainer.innerHTML = `
        <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-100">
                    <tr>
                        <th class="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Paciente</th>
                        <th class="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Detalles</th>
                        <th class="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                        <th class="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Acciones</th>
                    </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-100">
                    ${pacientes.map(p => `
                        <tr class="hover:bg-blue-50 transition-colors">
                            <td class="px-6 py-4 whitespace-nowrap">
                                <div class="text-sm font-bold text-gray-900">${p.nombre}</div>
                                <div class="text-xs text-gray-500">${p.fechaNacimiento || '--/--/----'}</div>
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap">
                                <div class="text-xs text-gray-700"><span class="font-semibold">Peso:</span> ${p.peso ? p.peso + 'g' : '-'}</div>
                                <div class="text-xs text-gray-700"><span class="font-semibold">EG:</span> ${p.edadGestacional ? p.edadGestacional + 's' : '-'}</div>
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap">
                                <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                    p.statusEgreso === 'Alta' ? 'bg-green-100 text-green-800' :
                                    p.statusEgreso === 'Derivación' ? 'bg-yellow-100 text-yellow-800' :
                                    p.statusEgreso === 'Obito' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'
                                }">
                                    ${p.statusEgreso || 'Internado'}
                                </span>
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                <div class="flex justify-end gap-2">
                                    <button data-action="share" data-id="${p.id}" data-name="${p.nombre}" class="btn-share shadow-sm">
                                        Compartir
                                    </button>
                                    <button data-action="edit" data-id="${p.id}" data-name="${p.nombre}" class="btn-edit shadow-sm">
                                        Editar
                                    </button>
                                    <button data-action="delete" data-id="${p.id}" data-name="${p.nombre}" class="btn-danger shadow-sm">
                                        Borrar
                                    </button>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function exportToCsv(dataToExport, filename) {
    if (!dataToExport || dataToExport.length === 0) {
        showToast("No hay datos para exportar", "warn");
        return;
    }
    const headers = ["ID", "Nombre", "F.Nac", "Peso", "EG", "Procedencia", "F.Int", "F.Egr", "Status", "Diagnosticos"];
    const csvRows = [headers.join(',')];

    dataToExport.forEach(p => {
        const escape = (val) => {
            if (val === undefined || val === null) return '';
            let str = String(val);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) str = `"${str.replace(/"/g, '""')}"`;
            return str;
        };
        const diagStr = Array.isArray(p.diagnosticos) ? p.diagnosticos.join('; ') : '';
        const values = [p.id, p.nombre, p.fechaNacimiento, p.peso, p.edadGestacional, p.procedencia, p.fechaInternacion, p.fechaEgreso, p.statusEgreso, diagStr].map(escape);
        csvRows.push(values.join(','));
    });

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}.csv`;
    link.click();
}

async function handleExportAll() {
    showLoading(true, "Exportando Todo...");
    try {
        const snapshot = await getDocs(pacientesCollectionRef);
        const all = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        exportToCsv(all, 'pacientes_neo_total_db');
    } catch (error) {
        console.error(error);
        showToast("Error al exportar todo", "error");
    } finally {
        showLoading(false);
    }
}

function populateBaseDiagnosticos() {
    baseDiagnosticos = [
       "Taquipnea Transitoria (TTRN)", "SDR / Membrana Hialina", "SALAM", "Hipertensión Pulmonar (HPPRN)", 
       "Neumonía", "Displasia Broncopulmonar", "Apnea", "Neumotórax", "Sepsis Precoz", "Sepsis Tardía", 
       "Hipoglucemia", "Hiperbilirrubinemia", "Anemia", "Policitemia", "EHI / Asfixia", "Convulsiones", 
       "HIV", "Sifilis Congénita", "CMV", "Toxoplasmosis", "Cardiopatía Congénita", "Prematurez", 
       "RCIU", "PEG", "Bajo Peso (BPN)", "Muy Bajo Peso (MBPN)", "Extremado Bajo Peso (EBPN)"
   ].sort();
}
