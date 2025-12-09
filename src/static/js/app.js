// DEFINITIVO!!!!

let chatbotData = null;
let resumenGlobal = "";

// Audio setup
const beepSound = new Audio('/static/assets/beep.mp3'); // beep corto de espera
const holaSound = new Audio('/static/assets/hola.mp3'); // saludo "hola"
let beepInterval;

// Global variables
let peerConnection = null;
let dataChannel = null;
let mediaStream = null;
let timerInterval = null;
let callTimeout = null;
let seconds = 0;
let isConnected = false;

// Configuración de timeout (10 minutos máximo por llamada)
const MAX_CALL_DURATION_MS = 10 * 60 * 1000;

// DOM elements
const ringBox = document.getElementById('ringBox');
const callButton = document.getElementById('callButton');
const endCallBtn = document.getElementById('endCallBtn');
const callStatus = document.querySelector('.call-status');
const timer = document.querySelector('.timer');
const speakNow = document.querySelector('.speak-now');
speakNow.style.display = 'none';

// Initialize timer display
timer.style.display = 'none';

async function getChatbotData() {
    const urlParams = new URLSearchParams(window.location.search);
    const _id = urlParams.get("_id") || urlParams.get("ref");

    if (!_id) {
        console.warn("⚠️ No se proporcionó _id o ref en la URL");
        return null;
    }

    try {
        console.log("🔍 Obteniendo datos de paciente para _id:", _id);
        const response = await fetch(`/api/paciente?_id=${_id}`);
        const data = await response.json();

        if (data.error) {
            console.error("❌ Error al obtener datos:", data.error);
            return null;
        }

        data._id = _id;
        console.log("✅ Datos obtenidos y _id asignado:", data);
        return data;

    } catch (error) {
        console.error("❌ Error al obtener datos de CHATBOT:", error);
        return null;
    }
}

// ⬇️ Audio de espera (beep loop)
function startBeeping() {
    beepSound.currentTime = 0;
    beepSound.play();
    beepInterval = setInterval(() => {
        beepSound.currentTime = 0;
        beepSound.play();
    }, 2000);
}

function stopBeeping() {
    if (beepInterval) {
        clearInterval(beepInterval);
        beepInterval = null;
    }
    beepSound.pause();
    beepSound.currentTime = 0;
}

// Main: Al iniciar la llamada
async function startCall() {
    ringBox.style.display = 'block';
    callStatus.textContent = 'Llamando...';
    startBeeping(); // ⬅️ Inicia beep de espera
    endCallBtn.disabled = true;
    await initOpenAIRealtime();
}

// Funciones de email y WhatsApp
const fns = {
    sendEmail: async ({ message }) => {
        try {
            resumenGlobal = message;
            endCallBtn.style.display = 'block';
            await sendEmail(message); // <-- Llama solo a tu backend
            endCall();                // <-- Siempre cierra
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
};


async function initOpenAIRealtime() {
    try {
        chatbotData = await getChatbotData();

        const tokenResponse = await fetch("session");
        const data = await tokenResponse.json();
        console.log("🔍 Respuesta completa de /session:", data);
        const EPHEMERAL_KEY = data.client_secret.value;

        peerConnection = new RTCPeerConnection();

        // 🟢 Handler para todos los estados de conexión
        peerConnection.onconnectionstatechange = (event) => {
            const state = peerConnection.connectionState;
            console.log("Connection state:", state);

            if (state === 'connected') {
                console.log('🔔 Conectado. Deteniendo beep y reproduciendo hola...');
                stopBeeping();
                setTimeout(() => {
                    holaSound.currentTime = 0;
                    holaSound.play().then(() => {
                        console.log('Hola sonando');
                    }).catch(e => console.error('Error al reproducir hola', e));
                }, 100);
                isConnected = true;
                callStatus.textContent = 'Connected';
                timer.style.display = 'block';
                speakNow.style.display = 'block';
                startTimer();
                endCallBtn.style.display = 'none';

                // Iniciar timeout de seguridad
                callTimeout = setTimeout(() => {
                    console.log('⏱️ Timeout de llamada alcanzado (10 min)');
                    showNotification('Llamada finalizada por tiempo máximo', 'info');
                    endCall();
                }, MAX_CALL_DURATION_MS);

            } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
                console.log('⚠️ Conexión terminada:', state);
                endCall();
            }
        };

        // Configuración de audio
        const audioElement = document.createElement("audio");
        audioElement.autoplay = true;
        peerConnection.ontrack = event => {
            audioElement.srcObject = event.streams[0];
        };

        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        peerConnection.addTrack(mediaStream.getTracks()[0]);

        // Crear canal de datos
        dataChannel = peerConnection.createDataChannel('response');

        // Función para registrar tools disponibles
        function configureData() {
            console.log('Configuring data channel');
            const event = {
                type: 'session.update',
                session: {
                    modalities: ['text', 'audio'],
                    tools: [{
                        type: 'function',
                        name: 'sendEmail',
                        description: 'Envía un resumen por correo cuando el paciente se despida',
                        parameters: {
                            type: 'object',
                            properties: {
                                message: {
                                    type: 'string',
                                    description: 'Email body content'
                                }
                            },
                            required: ['message']
                        }
                    }]
                }
            };
            dataChannel.send(JSON.stringify(event));
        }

        // Al abrir el dataChannel
        dataChannel.addEventListener('open', () => {
            console.log('✅ Data channel opened');
            configureData();
        });

        // Array para almacenar las respuestas
        let respuestas = [];

        // Modificar el manejo de mensajes recibidos desde OpenAI
        dataChannel.addEventListener('message', async (ev) => {
            try {
                const msg = JSON.parse(ev.data);
                console.log("Mensaje recibido:", msg);

                if (msg.type === "response.text") {
                    const respuesta = msg.text.trim();
                    console.log("📥 Respuesta procesada:", respuesta);

                    const empresaRegex = /empresa\s(?:se\sllama|es)\s(.+?)(\.|$)/i;
                    const match = respuesta.match(empresaRegex);
                    const nombreEmpresa = match ? match[1].trim() : null;

                    respuestas.push({
                        textoCompleto: respuesta,
                        nombreEmpresa: nombreEmpresa || "No especificado"
                    });
                    console.log("📋 Respuestas actualizadas:", respuestas);
                }

                if (msg.type === "response.summary") {
                    let resumen = msg.text.trim();

                    const nombrePaciente = chatbotData?.primerNombre?.trim() || "el paciente";
                    const saludo = `Hola ${nombrePaciente}, recibí este resumen de tu llamada y quiero confirmarlo contigo\n\n`;
                    const puntos = resumen
                        .split(/\. (?=[A-ZÁÉÍÓÚ])/g)
                        .map(frase => frase.trim().replace(/\.$/, ''))
                        .filter(f => f.length > 0)
                        .map(frase => `- ${frase}.`)
                        .join('\n');

                    resumen = `${saludo}:\n${puntos}`;
                    console.log("📥 Resumen recibido:", resumen);

                    respuestas.push({
                        textoCompleto: resumen,
                        tipo: "resumen"
                    });

                    resumenGlobal = resumen;
                    endCallBtn.style.display = 'block';

                    await fns.sendEmail({ message: resumen });

                    console.log("✅ Resumen enviado y guardado correctamente.");
                }

                // Inyectar instrucciones personalizadas
                if (msg.type === "session.created" && chatbotData) {
                    const systemInstructions = `
Eres un asistente de salud ocupacional de BSL. Realizas entrevistas médicas breves.

DATOS DEL PACIENTE:
- Nombre: ${chatbotData.primerNombre?.trim() || "el paciente"}
- Historial de salud: ${chatbotData.encuestaSalud?.join(", ") || "ninguno"}
- Antecedentes familiares: ${chatbotData.antecedentesFamiliares?.join(", ") || "ninguno"}

REGLAS CRÍTICAS:
1. NUNCA repitas una pregunta que ya hiciste
2. NUNCA pidas información que el paciente ya dio
3. Haz UNA sola pregunta a la vez y espera la respuesta
4. Mantén un seguimiento mental de qué preguntas ya hiciste
5. La entrevista debe durar máximo 2 minutos

FLUJO DE LA ENTREVISTA (en orden, sin repetir):
1. Saluda brevemente usando el nombre del paciente
2. Pregunta sobre su historial de salud (${chatbotData.encuestaSalud?.join(", ") || "general"})
3. Pregunta sobre antecedentes familiares (solo si tiene: ${chatbotData.antecedentesFamiliares?.join(", ") || "omitir"})
4. Pregunta sobre su último trabajo y si tuvo enfermedades laborales
5. Pregunta para qué empresa solicita el certificado médico
6. Despídete y genera el resumen

AL FINALIZAR:
- Di: "Gracias por tu tiempo, estoy generando tu resumen. No cierres esta ventana."
- Llama sendEmail({ message: "resumen con los puntos de la entrevista" })

FORMATO DEL RESUMEN:
Resumen de la entrevista:
- Paciente: [nombre]
- Historial de salud: [respuesta]
- Antecedentes familiares: [respuesta]
- Ocupación anterior: [respuesta]
- Empresa solicitante: [respuesta]
`;

                    const sessionUpdate = {
                        type: "session.update",
                        session: { instructions: systemInstructions }
                    };
                    dataChannel.send(JSON.stringify(sessionUpdate));
                    console.log("📨 Instrucciones personalizadas enviadas");
                }

                // Manejo de funciones definidas
                if (msg.type === 'response.function_call_arguments.done') {
                    const fn = fns[msg.name];
                    if (fn !== undefined) {
                        console.log(`🔧 Ejecutando función ${msg.name} con argumentos:`, msg.arguments);
                        const args = JSON.parse(msg.arguments);
                        const result = await fn(args);

                        const event = {
                            type: 'conversation.item.create',
                            item: {
                                type: 'function_call_output',
                                call_id: msg.call_id,
                                output: JSON.stringify(result)
                            }
                        };
                        dataChannel.send(JSON.stringify(event));
                    }
                }
            } catch (error) {
                console.error('❌ Error manejando mensaje:', error);
            }
        });

        // Crear y enviar offer SDP
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        const apiUrl = "https://api.openai.com/v1/realtime";
        const model = "gpt-realtime";

        const sdpResponse = await fetch(`${apiUrl}?model=${model}`, {
            method: "POST",
            body: offer.sdp,
            headers: {
                Authorization: `Bearer ${EPHEMERAL_KEY}`,
                "Content-Type": "application/sdp"
            },
        });

        const answer = {
            type: "answer",
            sdp: await sdpResponse.text(),
        };
        await peerConnection.setRemoteDescription(answer);

    } catch (error) {
        console.error("❌ Error en initOpenAIRealtime:", error);
        endCall();
    }
}

function startTimer() {
    seconds = 0;
    timer.style.display = 'block';
    timerInterval = setInterval(() => {
        seconds++;
        timer.textContent = formatTime(seconds);
    }, 2000);
}

function formatTime(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatCallSummary(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    let summary = 'Call Duration: ';
    if (hours > 0) summary += `${hours}h `;
    if (minutes > 0) summary += `${minutes}m `;
    summary += `${remainingSeconds}s`;

    return summary;
}

function endCall() {
    stopBeeping();
    stopTimer();

    // Cancelar timeout de seguridad
    if (callTimeout) {
        clearTimeout(callTimeout);
        callTimeout = null;
    }

    // Cerrar dataChannel primero
    if (dataChannel) {
        dataChannel.close();
        dataChannel = null;
    }

    // Detener micrófono (liberar recursos)
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => {
            track.stop();
            console.log('🎤 Track de audio detenido');
        });
        mediaStream = null;
    }

    // Cerrar conexión WebRTC
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    if (isConnected) {
        const summary = formatCallSummary(seconds);
        callStatus.textContent = summary;
        endCallBtn.style.display = 'none';

        setTimeout(() => {
            ringBox.style.display = 'none';
            callButton.style.display = 'block';
            callStatus.textContent = 'Ready to call';
        }, 3000);
    }

    isConnected = false;
    console.log('📴 Llamada finalizada y recursos liberados');
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    seconds = 0;
}

// Limpiar recursos si el usuario cierra la pestaña o navega fuera
window.addEventListener('beforeunload', () => {
    if (peerConnection || dataChannel || mediaStream) {
        endCall();
    }
});

// También manejar cuando la página se oculta (móviles)
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && isConnected) {
        console.log('📱 Página oculta, manteniendo conexión por 30s...');
        // Dar 30 segundos de gracia antes de cerrar (por si vuelve)
        setTimeout(() => {
            if (document.visibilityState === 'hidden' && isConnected) {
                console.log('📴 Cerrando conexión por inactividad');
                endCall();
            }
        }, 30000);
    }
});

callButton.addEventListener('click', startCall);
endCallBtn.addEventListener('click', async () => {
    if (resumenGlobal) {
        console.log("📨 Enviando resumen antes de finalizar...");
        await fns.sendEmail({ message: resumenGlobal });
    } else {
        console.warn("⚠️ No hay resumen para enviar.");
    }
    endCall();
});

async function sendEmail(message) {
    const loader = document.querySelector('.loader');
    loader.style.display = 'block';

    try {
        const _id = chatbotData?._id || null;
        const nombre = chatbotData?.primerNombre || 'Paciente';
        const encuestaSalud = chatbotData?.encuestaSalud || [];
        const antecedentesFamiliares = chatbotData?.antecedentesFamiliares || [];

        console.log("🧾 Enviando resumen con _id:", _id, "nombre:", nombre, "y mensaje:", message);

        const celular = chatbotData?.celular?.replace(/\s/g, '').replace(/\+/g, '');
        let to = celular;
        if (to && !to.startsWith('57')) to = '57' + to;

        const response = await fetch('/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message,
                _id,
                to,
                nombre,
                encuestaSalud,
                antecedentesFamiliares
            })
        });

        const result = await response.json();
        console.log("📬 Respuesta del backend:", result);

        if (response.ok) {
            showNotification('Email sent successfully!', 'success');
        } else {
            showNotification('Failed to send email', 'error');
        }
    } catch (error) {
        console.error("❌ Error en sendEmail frontend:", error);
        showNotification('Error sending email', 'error');
    } finally {
        loader.style.display = 'none';
    }
}

function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 3000);
}


