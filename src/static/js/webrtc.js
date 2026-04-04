import state, { MAX_CALL_DURATION_MS } from './state.js';
import { stopBeeping, playHola } from './audio.js';
import { callStatus, timer, speakNow, endCallBtn, ringBox, callButton, showNotification } from './ui.js';
import { startTimer } from './timer.js';
import { fetchWithRetry, sendEmail } from './api.js';

let _endCall = null;

// Funciones de email y WhatsApp (tool calling)
const fns = {
    sendEmail: async ({ message }) => {
        try {
            state.resumenGlobal = message;
            endCallBtn.style.display = 'block';
            await sendEmail(message);
            if (_endCall) _endCall();
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
};

export { fns };

export async function initOpenAIRealtime(endCall) {
    _endCall = endCall;
    try {
        callStatus.textContent = 'Conectando con el asistente...';

        const tokenResponse = await fetchWithRetry("session");
        const data = await tokenResponse.json();
        const EPHEMERAL_KEY = data.client_secret.value;

        state.peerConnection = new RTCPeerConnection();

        state.peerConnection.onconnectionstatechange = () => {
            const pcState = state.peerConnection.connectionState;
            console.log("Connection state:", pcState);

            if (pcState === 'connected') {
                stopBeeping();
                setTimeout(() => {
                    playHola().catch(e => console.error('Error al reproducir hola', e));
                }, 100);
                state.isConnected = true;
                callStatus.textContent = 'Connected';
                timer.style.display = 'block';
                speakNow.style.display = 'block';
                startTimer();
                endCallBtn.style.display = 'none';

                state.callTimeout = setTimeout(() => {
                    console.log('Timeout de llamada alcanzado (10 min)');
                    showNotification('Llamada finalizada por tiempo maximo', 'info');
                    endCall();
                }, MAX_CALL_DURATION_MS);

            } else if (pcState === 'disconnected') {
                console.log('Conexion perdida, esperando reconexion...');
                callStatus.textContent = 'Conexion perdida. Reconectando...';
                setTimeout(() => {
                    if (state.peerConnection && state.peerConnection.connectionState === 'disconnected') {
                        console.log('No se pudo reconectar, cerrando llamada');
                        endCall();
                    }
                }, 5000);
            } else if (pcState === 'failed' || pcState === 'closed') {
                console.log('Conexion terminada:', pcState);
                endCall();
            }
        };

        const audioElement = document.createElement("audio");
        audioElement.autoplay = true;
        state.peerConnection.ontrack = event => {
            audioElement.srcObject = event.streams[0];
        };

        state.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        state.peerConnection.addTrack(state.mediaStream.getTracks()[0]);

        state.dataChannel = state.peerConnection.createDataChannel('response');

        function configureData() {
            const event = {
                type: 'session.update',
                session: {
                    modalities: ['text', 'audio'],
                    tools: [{
                        type: 'function',
                        name: 'sendEmail',
                        description: 'Envia un resumen por correo cuando el paciente se despida',
                        parameters: {
                            type: 'object',
                            properties: {
                                message: { type: 'string', description: 'Email body content' }
                            },
                            required: ['message']
                        }
                    }]
                }
            };
            state.dataChannel.send(JSON.stringify(event));
        }

        state.dataChannel.addEventListener('open', () => {
            console.log('Data channel opened');
            configureData();
        });

        let respuestas = [];

        state.dataChannel.addEventListener('message', async (ev) => {
            try {
                const msg = JSON.parse(ev.data);

                if (msg.type === "response.text") {
                    const respuesta = msg.text.trim();
                    const empresaRegex = /empresa\s(?:se\sllama|es)\s(.+?)(\.|$)/i;
                    const match = respuesta.match(empresaRegex);
                    respuestas.push({
                        textoCompleto: respuesta,
                        nombreEmpresa: match ? match[1].trim() : "No especificado"
                    });
                }

                if (msg.type === "response.summary") {
                    let resumen = msg.text.trim();
                    const nombrePaciente = state.chatbotData?.primerNombre?.trim() || "el paciente";
                    const saludo = `Hola ${nombrePaciente}, recibi este resumen de tu llamada y quiero confirmarlo contigo\n\n`;
                    const puntos = resumen
                        .split(/\. (?=[A-Z\u00C1\u00C9\u00CD\u00D3\u00DA])/g)
                        .map(frase => frase.trim().replace(/\.$/, ''))
                        .filter(f => f.length > 0)
                        .map(frase => `- ${frase}.`)
                        .join('\n');

                    resumen = `${saludo}:\n${puntos}`;
                    respuestas.push({ textoCompleto: resumen, tipo: "resumen" });

                    state.resumenGlobal = resumen;
                    endCallBtn.style.display = 'block';
                    await fns.sendEmail({ message: resumen });
                }

                if (msg.type === "session.created" && state.chatbotData) {
                    let systemInstructions;

                    if (state.chatbotData.noData) {
                        systemInstructions = `
Eres un asistente de salud ocupacional de BSL.

IMPORTANTE: Este paciente NO ha completado las pruebas medicas previas requeridas.

INSTRUCCIONES:
1. Saluda al paciente de manera amable
2. Informale que para realizar la consulta medica debe completar primero las pruebas de salud ocupacional
3. Dile que le vas a enviar un link por WhatsApp para que complete las pruebas
4. Llama la funcion sendEmail con el mensaje: "FORMULARIO_PENDIENTE"
5. Despidete cordialmente

TONO: Amable, profesional y comprensivo.

EJEMPLO DE MENSAJE:
"Hola, gracias por contactarte con BSL. Para poder realizar tu consulta medica, primero necesitas completar las pruebas de salud ocupacional. Te voy a enviar un link por WhatsApp para que las completes. Una vez terminadas, podras continuar con tu consulta. De acuerdo?"
`;
                    } else {
                        systemInstructions = `
Eres un asistente de salud ocupacional de BSL. Realizas entrevistas medicas breves.

DATOS DEL PACIENTE:
- Nombre: ${state.chatbotData.primerNombre?.trim() || "el paciente"}
- Historial de salud: ${state.chatbotData.encuestaSalud?.join(", ") || "ninguno"}
- Antecedentes familiares: ${state.chatbotData.antecedentesFamiliares?.join(", ") || "ninguno"}

REGLAS CRITICAS:
1. NUNCA repitas una pregunta que ya hiciste
2. NUNCA pidas informacion que el paciente ya dio
3. Haz UNA sola pregunta a la vez y espera la respuesta
4. Manten un seguimiento mental de que preguntas ya hiciste
5. La entrevista debe durar maximo 2 minutos

FLUJO DE LA ENTREVISTA (en orden, sin repetir):
1. Saluda brevemente usando el nombre del paciente
2. Pregunta sobre su historial de salud (${state.chatbotData.encuestaSalud?.join(", ") || "general"})
3. Pregunta sobre antecedentes familiares (solo si tiene: ${state.chatbotData.antecedentesFamiliares?.join(", ") || "omitir"})
4. Pregunta sobre su ultimo trabajo y si tuvo enfermedades laborales
5. Pregunta para que empresa solicita el certificado medico
6. Despidete y genera el resumen

AL FINALIZAR:
- Di: "Gracias por tu tiempo, estoy generando tu resumen. No cierres esta ventana."
- Llama sendEmail({ message: "resumen con los puntos de la entrevista" })

FORMATO DEL RESUMEN:
Resumen de la entrevista:
- Paciente: [nombre]
- Historial de salud: [respuesta]
- Antecedentes familiares: [respuesta]
- Ocupacion anterior: [respuesta]
- Empresa solicitante: [respuesta]
`;
                    }

                    const sessionUpdate = {
                        type: "session.update",
                        session: { instructions: systemInstructions }
                    };
                    state.dataChannel.send(JSON.stringify(sessionUpdate));
                    console.log("Instrucciones personalizadas enviadas");
                }

                if (msg.type === 'response.function_call_arguments.done') {
                    const fn = fns[msg.name];
                    if (fn !== undefined) {
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
                        state.dataChannel.send(JSON.stringify(event));
                    }
                }
            } catch (error) {
                console.error('Error manejando mensaje:', error);
            }
        });

        const offer = await state.peerConnection.createOffer();
        await state.peerConnection.setLocalDescription(offer);

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
        await state.peerConnection.setRemoteDescription(answer);

    } catch (error) {
        console.error("Error en initOpenAIRealtime:", error);
        stopBeeping();
        callStatus.textContent = 'Error al conectar';
        showNotification('No se pudo conectar con el asistente. Intenta de nuevo.', 'error');
        setTimeout(() => {
            ringBox.style.display = 'none';
            callButton.disabled = false;
        }, 3000);
    }
}
