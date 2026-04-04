import state from './state.js';
import { startBeeping, stopBeeping } from './audio.js';
import { ringBox, callButton, endCallBtn, callStatus, showNotification } from './ui.js';
import { stopTimer, formatCallSummary } from './timer.js';
import { checkMicrophonePermission, showPermissionError } from './permissions.js';
import { getChatbotData } from './api.js';
import { initOpenAIRealtime, fns } from './webrtc.js';

// Main: Al iniciar la llamada
async function startCall() {
    if (state.isConnected || callButton.disabled) return;
    callButton.disabled = true;

    callStatus.textContent = 'Verificando microfono...';

    const permissionCheck = await checkMicrophonePermission();

    if (!permissionCheck.granted) {
        showPermissionError(permissionCheck.error);
        callStatus.textContent = 'Microfono no disponible';
        callButton.disabled = false;
        return;
    }

    ringBox.style.display = 'block';
    callStatus.textContent = 'Cargando datos del paciente...';

    state.chatbotData = await getChatbotData();

    callStatus.textContent = 'Llamando...';
    startBeeping();
    endCallBtn.disabled = true;
    await initOpenAIRealtime(endCall);
}

function endCall() {
    stopBeeping();
    stopTimer();

    if (state.callTimeout) {
        clearTimeout(state.callTimeout);
        state.callTimeout = null;
    }

    if (state.dataChannel) {
        state.dataChannel.close();
        state.dataChannel = null;
    }

    if (state.mediaStream) {
        state.mediaStream.getTracks().forEach(track => track.stop());
        state.mediaStream = null;
    }

    if (state.peerConnection) {
        state.peerConnection.close();
        state.peerConnection = null;
    }

    if (state.isConnected) {
        const summary = formatCallSummary(state.seconds);
        callStatus.textContent = summary;
        endCallBtn.style.display = 'none';

        setTimeout(() => {
            ringBox.style.display = 'none';
            callButton.style.display = 'block';
            callButton.disabled = false;
            callStatus.textContent = 'Ready to call';
        }, 3000);
    } else {
        callButton.disabled = false;
    }

    state.isConnected = false;
    console.log('Llamada finalizada y recursos liberados');
}

// Event listeners
callButton.addEventListener('click', startCall);

endCallBtn.addEventListener('click', async () => {
    if (state.resumenGlobal) {
        await fns.sendEmail({ message: state.resumenGlobal });
    } else {
        console.warn("No hay resumen para enviar.");
    }
    endCall();
});

window.addEventListener('beforeunload', () => {
    if (state.peerConnection || state.dataChannel || state.mediaStream) {
        endCall();
    }
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && state.isConnected) {
        setTimeout(() => {
            if (document.visibilityState === 'hidden' && state.isConnected) {
                endCall();
            }
        }, 30000);
    }
});
