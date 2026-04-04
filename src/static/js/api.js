import state from './state.js';
import { loader, showNotification } from './ui.js';

export async function fetchWithRetry(url, options = {}, maxRetries = 2) {
    const delays = [1000, 3000];
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok && attempt < maxRetries) {
                throw new Error(`HTTP ${response.status}`);
            }
            return response;
        } catch (error) {
            if (attempt === maxRetries) throw error;
            console.warn(`Intento ${attempt + 1} fallido para ${url}, reintentando en ${delays[attempt]}ms...`);
            await new Promise(resolve => setTimeout(resolve, delays[attempt]));
        }
    }
}

export async function getChatbotData() {
    const urlParams = new URLSearchParams(window.location.search);
    const _id = urlParams.get("_id") || urlParams.get("ref");

    if (!_id) {
        console.warn("No se proporciono _id o ref en la URL");
        return null;
    }

    try {
        const response = await fetch(`/api/paciente?_id=${_id}`);
        const data = await response.json();

        if (data.error) {
            console.error("Error al obtener datos:", data.error);
            return { noData: true, _id: _id, celular: data.celular || null };
        }

        data._id = _id;
        return data;

    } catch (error) {
        console.error("Error al obtener datos de paciente:", error);
        return { noData: true, _id: _id, celular: null };
    }
}

export async function sendEmail(message) {
    loader.style.display = 'block';

    try {
        const _id = state.chatbotData?._id || null;
        const nombre = state.chatbotData?.primerNombre || 'Paciente';
        const encuestaSalud = state.chatbotData?.encuestaSalud || [];
        const antecedentesFamiliares = state.chatbotData?.antecedentesFamiliares || [];

        const celular = state.chatbotData?.celular?.replace(/\s/g, '').replace(/\+/g, '');
        let to = celular;
        if (to && !to.startsWith('57')) to = '57' + to;

        const body = JSON.stringify({
            message, _id, to, nombre, encuestaSalud, antecedentesFamiliares
        });

        const response = await fetchWithRetry('/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body
        }, 1);

        const result = await response.json();
        console.log("Respuesta del backend:", result);

        if (response.ok) {
            showNotification('Resumen enviado correctamente', 'success');
        } else {
            showNotification('Error al enviar el resumen', 'error');
        }
    } catch (error) {
        console.error("Error en sendEmail frontend:", error);
        showNotification('Error al enviar. Intenta de nuevo.', 'error');
    } finally {
        loader.style.display = 'none';
    }
}
