//DEFINITIVO!!!!




let chatbotData = null;
let resumenGlobal = ""; // 👈 Puedes definir esto fuera de la función, arriba en app.js


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

        // ✅ Forzamos que el _id quede disponible dentro del objeto
        data._id = _id;
        console.log("✅ Datos obtenidos y _id asignado:", data);
        return data;

    } catch (error) {
        console.error("❌ Error al obtener datos de CHATBOT:", error);
        return null;
    }
}




// Audio setup
const beepSound = new Audio('static/assets/beep.mp3');
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


async function startCall() {
    ringBox.style.display = 'block';
    callStatus.textContent = 'Llamando...';
    startBeeping();
    endCallBtn.disabled = true; // ⛔ Desactivar botón hasta tener resumen
    await initOpenAIRealtime();
  }
  


function startBeeping() {
    beepSound.play();
    beepInterval = setInterval(() => {
        beepSound.play();
    }, 3000);
}


function stopBeeping() {
    clearInterval(beepInterval);
}


const fns = {
    
    sendEmail: async ({ message }) => {
        try {
            resumenGlobal = message;
            endCallBtn.style.display = 'block'; // ✅ Mostrar botón ahora que tenemos resumen
            await sendEmail(message);

            if (chatbotData?.celular) {
                const to = chatbotData.celular.replace(/\s/g, '').replace(/\+/g, '');
                await sendTextMessage(to, message);
            }

            // ✅ Esperamos que todo esté enviado, luego cerramos canal
            endCall();

            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }



};


async function initOpenAIRealtime() {
    try {
        chatbotData = await getChatbotData(); // 🔍 Obtenemos los datos de la URL (_id o ref)


        const tokenResponse = await fetch("session");
        const data = await tokenResponse.json();
        console.log("🔍 Respuesta completa de /session:", data);
        const EPHEMERAL_KEY = data.client_secret.value;


        peerConnection = new RTCPeerConnection();


        // Listener del estado de conexión
        peerConnection.onconnectionstatechange = (event) => {
            console.log("Connection state:", peerConnection.connectionState);
            if (peerConnection.connectionState === 'connected') {
                stopBeeping();
                isConnected = true;
                callStatus.textContent = 'Connected';
                timer.style.display = 'block';
                speakNow.style.display = 'block'; // ✅ Mostrar solo cuando se establece conexión
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
                    tools: [
                        
                        {
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
                        },


                    ]
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

        // Si el mensaje contiene información relevante, procesarla
        if (msg.type === "response.text") {
            const respuesta = msg.text.trim();
            console.log("📥 Respuesta procesada:", respuesta);

            // Extraer el nombre de la empresa (si aplica) y agregar al array
            const empresaRegex = /empresa\s(?:se\sllama|es)\s(.+?)(\.|$)/i;
            const match = respuesta.match(empresaRegex);
            const nombreEmpresa = match ? match[1].trim() : null;

            respuestas.push({
                textoCompleto: respuesta,
                nombreEmpresa: nombreEmpresa || "No especificado"
            });

            console.log("📋 Respuestas actualizadas:", respuestas);
        }

        // ...existing code for handling other message types...

        // Inyectar instrucciones personalizadas si llega el evento de creación de sesión
        if (msg.type === "session.created" && chatbotData) {
            const systemInstructions = `
            Eres un asistente de salud ocupacional de BSL. Pregúntale al paciente sobre su historial médico.
            El paciente se llama ${chatbotData.primerNombre?.trim() || "el paciente"}.
            Historial de salud: ${chatbotData.encuestaSalud?.join(", ") || "no especificado"}.
            Antecedentes familiares: ${chatbotData.antecedentesFamiliares?.join(", ") || "no especificados"}.
            
            Pregúntale sobre el historial de salud y los antecedentes familiares que anotó en el formulario. Si no anotó ninguno, no lo menciones.
            pregúntale por los últimos 2 trabajos que tuvo y si tiene alguna enfermedad a partir de ellos.
            Pregúntale para que entidad o empresa está solicitando el certificado médico.
            No te extiendas demasiado. La entrevista no debe durar más de 2 minutos.
            Si te pregunta algo relacionado sobre la expedición de su certificado médico, dile que un asesor lo contactará para enviárselo
            Al finalizar la entrevista, genera un resumen completo de la conversación y llámalo como función sendEmail({ message: "resumen" }) para enviarlo por correo.
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
    timer.style.display = 'block'; // Make timer visible
    timerInterval = setInterval(() => {
        seconds++;
        timer.textContent = formatTime(seconds);
    }, 1000);
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

    const ringBox = document.getElementById('ringBox');
    const callButton = document.getElementById('callButton');

    if (isConnected) {
        const summary = formatCallSummary(seconds);
        callStatus.textContent = summary;
        endCallBtn.style.display = 'none';

        // Show summary for 3 seconds then reset UI
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
    endCall(); // Luego sí finaliza la llamada
  });
  

  async function sendEmail(message) {
    const loader = document.querySelector('.loader');
    loader.style.display = 'block';

    try {
        const _id = chatbotData?._id || null;

        console.log("🧾 Enviando resumen con _id:", _id, "y mensaje:", message);

        const response = await fetch('/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, _id })  // ✅ Enviar _id correctamente
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


    // Remove notification after 3 seconds
    setTimeout(() => {
        notification.remove();
    }, 3000);
}


function sendTextMessage(toNumber, messageBody) {
    const url = "https://gate.whapi.cloud/messages/text";
    const headers = {
        "accept": "application/json",
        "authorization": "Bearer due3eWCwuBM2Xqd6cPujuTRqSbMb68lt",
        "content-type": "application/json"
    };
    const postData = {
        "typing_time": 0,
        "to": toNumber,
        "body": messageBody
    };
    return fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(postData)
    })
        .then(response => response.json())
        .then(json => {
            console.log("📤 Enviado por WhatsApp:", json);
            return json;
        })
        .catch(err => console.error("❌ Error enviando por WhatsApp:", err));
}
