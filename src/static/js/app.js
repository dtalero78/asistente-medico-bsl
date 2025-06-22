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
let timerInterval = null;
let seconds = 0;
let isConnected = false;

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
        console.log("🔍 Obteniendo datos de CHATBOT para _id:", _id);
        const response = await fetch(`https://www.bsl.com.co/_functions/chatbot?_id=${_id}`);
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
            await sendEmail(message);

            if (chatbotData?.celular) {
                let to = chatbotData.celular.replace(/\s/g, '').replace(/\+/g, '');
                if (!to.startsWith('57')) {
                    to = '57' + to;
                }
                await sendTextMessage(to, message);
            }

            endCall();
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

        // 🟢 Handler CORRECTO para la conexión
        peerConnection.onconnectionstatechange = (event) => {
            console.log("Connection state:", peerConnection.connectionState);
            if (peerConnection.connectionState === 'connected') {
                console.log('🔔 Conectado. Deteniendo beep y reproduciendo hola...');
                stopBeeping();
                setTimeout(() => {
                    holaSound.currentTime = 0;
                    holaSound.play().then(() => {
                        console.log('Hola sonando');
                    }).catch(e => console.error('Error al reproducir hola', e));
                }, 100); // Breve delay para liberar audio
                isConnected = true;
                callStatus.textContent = 'Connected';
                timer.style.display = 'block';
                speakNow.style.display = 'block';
                startTimer();
                endCallBtn.style.display = 'none';
            }
        };

        // Configuración de audio
        const audioElement = document.createElement("audio");
        audioElement.autoplay = true;
        peerConnection.ontrack = event => {
            audioElement.srcObject = event.streams[0];
        };

        const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
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

                    if (chatbotData?._id) {
                        await fetch('https://www.bsl.com.co/_functions/updateResumenChatbot', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                _id: chatbotData._id,
                                resumen
                            })
                        });
                    }

                    console.log("✅ Resumen enviado y guardado correctamente.");
                }

                // Inyectar instrucciones personalizadas
                if (msg.type === "session.created" && chatbotData) {
                    const systemInstructions = `
Eres un asistente de salud ocupacional de BSL. Tu tarea es entrevistar al paciente para completar su historia clínica laboral.

Datos del paciente:
- Nombre: ${chatbotData.primerNombre?.trim() || "el paciente"}.
- Historial de salud: ${chatbotData.encuestaSalud?.join(", ") || "no especificado"}.
- Antecedentes familiares: ${chatbotData.antecedentesFamiliares?.join(", ") || "no especificados"}.

Preguntas que debes hacer, una a una y esperando siempre la respuesta del usuario antes de pasar a la siguiente:
1. Amplía tu historial de salud: ${chatbotData.encuestaSalud?.join(", ") || "no especificado"}.
2. Háblame sobre tus antecedentes familiares consignados en el formulario (${chatbotData.antecedentesFamiliares?.join(", ") || "no especificados"}). Si no anotaste ninguno, omite esta pregunta.
3. ¿Cuál fue el último trabajo que tuviste y presentaste alguna enfermedad a partir de él?
4. ¿Para qué entidad o empresa estás solicitando el certificado médico?

Recuerda:
- No te extiendas demasiado. La entrevista no debe durar más de 2 minutos.
- Si el paciente te pregunta sobre la expedición del certificado, dile que un asesor lo contactará para enviárselo.

Al finalizar la entrevista:
1. Despídete cordialmente del paciente con una frase como: "Gracias por tu tiempo, en este momento estoy generando tu resumen. Por favor, no cierres esta ventana ni finalices la conversación hasta que veas el mensaje de que tu resumen fue enviado."
2. **Después de terminar de hablar tu despedida en voz alta**, genera un resumen breve y organizado por puntos de la conversación, siguiendo este formato de ejemplo:

Resumen de la entrevista:
- Paciente: Nombre.
- Historial de salud: Usa anteojos para presbicia.
- Antecedentes familiares: Diabetes, Hipertensión.
- Ocupación anterior: Enfermera, sin enfermedades derivadas del trabajo.
- Empresa solicitante del certificado médico: Sitel.

3. Llama la función sendEmail({ message: "resumen" }) para enviar el resumen por correo **solo cuando hayas terminado de hablar con el paciente**.
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
        const model = "gpt-4o-realtime-preview-2024-12-17";

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
    socket = null;
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    seconds = 0;
}

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

        console.log("🧾 Enviando resumen con _id:", _id, "y mensaje:", message);

        const celular = chatbotData?.celular?.replace(/\s/g, '').replace(/\+/g, '');
        let to = celular;
        if (to && !to.startsWith('57')) to = '57' + to;

        const response = await fetch('/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, _id, to })
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


