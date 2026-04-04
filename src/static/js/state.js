// Estado compartido de la aplicacion
const state = {
    chatbotData: null,
    resumenGlobal: "",
    peerConnection: null,
    dataChannel: null,
    mediaStream: null,
    timerInterval: null,
    callTimeout: null,
    seconds: 0,
    isConnected: false,
    beepInterval: null
};

export const MAX_CALL_DURATION_MS = 10 * 60 * 1000;

export default state;
