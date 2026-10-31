// Avatar en video: sala LiveKit creada por LiveAvatar (services/avatar.py). Se ve como una
// videollamada: la camara del paciente en grande (solo local, no se publica) y el doctor en un circulo.
// Antes de la consulta va la prueba de ojos (ojos.js), obligatoria; sus resultados viajan en
// memoria y se guardan junto con la entrevista en /avatar/end.
import { showNotification } from './ui.js';
import { checkMicrophonePermission, showPermissionError } from './permissions.js';
import { precargarModelo, examenOjos, pintarResultados } from './ojos.js';
import { crearGuia } from './guia-voz.js';

const { Room, RoomEvent, Track } = window.LivekitClient;

const callButton = document.getElementById('callButton');
const endCallBtn = document.getElementById('endCallBtn');
const callStatus = document.querySelector('.call-status');
const vc = document.getElementById('vc');
const video = document.getElementById('avatarVideo');
const selfVideo = document.getElementById('selfVideo');
const doctorBubble = document.getElementById('doctorBubble');
const resumenCard = document.getElementById('resumenCard');
const resumenBox = document.getElementById('resumen');
const ojosResultados = document.getElementById('ojosResultados');
const cerrarAviso = document.getElementById('cerrarAviso');
const reintentarBtn = document.getElementById('reintentarBtn');
const audioBtn = document.getElementById('audioBtn');
const consentimiento = document.getElementById('consentimiento');
const conectarBtn = document.getElementById('conectarBtn');
const ojosUI = {
    video: document.getElementById('ojosVideo'),
    overlay: document.getElementById('ojosOverlay'),
    paso: document.getElementById('ojosPaso'),
    titulo: document.getElementById('ojosTitulo'),
    indicacion: document.getElementById('ojosIndicacion'),
    estado: document.getElementById('ojosEstado'),
    botonFoto: document.getElementById('ojosFoto'),
};
const ojosReintentar = document.getElementById('ojosReintentar');
const guia = crearGuia();
ojosUI.guia = guia;

// Debe coincidir con FRASE_CIERRE en services/avatar.py
const FRASE_CIERRE = 'estoy generando tu resumen';
const DATA_TOPIC = 'agent-response';

const params = new URLSearchParams(window.location.search);
const _id = params.get('_id') || params.get('ref');

let room = null;
let camara = null;
let wakeLock = null;
let sesion = null;
let transcript = [];
let cerrando = false;
let finalizando = false;
let conversationId = null;
let ojos = null;   // resultado de la prueba de ojos; sobrevive a "Intentar de nuevo"

// Evidencia de la entrevista (opcion "audio + fotos"): el audio completo lo graba ElevenLabs en
// sus servidores, y aqui solo se toman unas fotos pequenas de la camara del paciente para
// verificar identidad. Grabar video en el navegador ahogaba los celulares de gama baja.
const MOMENTOS_FOTO = [['inicio', 4000], ['mitad-1', 45000], ['mitad-2', 90000]];
const FOTO_ANCHO = 320;
let fotos = [];
let fotoTimers = [];

function tomarFoto(momento) {
    if (!camara || !selfVideo.videoWidth || fotos.length >= 5) return;
    const canvas = document.createElement('canvas');
    canvas.width = FOTO_ANCHO;
    canvas.height = Math.round(FOTO_ANCHO * selfVideo.videoHeight / selfVideo.videoWidth);
    canvas.getContext('2d').drawImage(selfVideo, 0, 0, canvas.width, canvas.height);
    fotos.push({ momento, imagen: canvas.toDataURL('image/jpeg', 0.7) });
}

// Un solo toque para todo: consentimiento + "Iniciar Consulta" arranca la prueba de ojos y al
// terminar entra el medico. Los permisos y el link se revisan antes de la prueba: no tiene sentido
// hacer dos minutos de prueba para despues decir "Esta consulta ya fue realizada".
async function iniciar() {
    guia.desbloquear();   // antes de cualquier await: iPhone solo deja sonar dentro del toque
    callButton.disabled = true;

    const permission = await pedirPermisos();
    if (!permission.granted) {
        showPermissionError(permission.error);
        callButton.disabled = false;
        return;
    }

    if (_id && await linkUsado()) {
        vc.dataset.estado = 'fin';
        callStatus.textContent = 'Esta consulta ya fue realizada';
        return;
    }

    vc.dataset.estado = 'ojos';
    mantenerPantallaEncendida();
    await pruebaDeOjos();
}

// Camara y microfono en un solo aviso del navegador (antes eran dos, uno para cada uno)
async function pedirPermisos() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: 'user' } });
        stream.getTracks().forEach(t => t.stop());
        return { granted: true };
    } catch (error) {
        // Sin camara (o camara ocupada) la consulta sigue: la prueba de ojos deja el motivo para el medico
        if (error.name !== 'NotAllowedError' && error.name !== 'PermissionDeniedError') return checkMicrophonePermission();
        return { granted: false, error: 'Necesitas permitir la cámara y el micrófono para la consulta. Toca el candado junto a la dirección de la página, permítelos y vuelve a intentarlo.' };
    }
}

async function linkUsado() {
    try {
        const res = await fetch(`/api/paciente?_id=${encodeURIComponent(_id)}`);
        return res.status === 403;
    } catch {
        return false;   // si no se puede saber, lo dice /avatar/session al conectar
    }
}

async function pruebaDeOjos() {
    ojosReintentar.hidden = true;
    try {
        ojos = await examenOjos(ojosUI);
    } catch (error) {
        if (error.name !== 'NotAllowedError' && error.name !== 'PermissionDeniedError') {
            // Falla nuestra, no del paciente: sigue a la consulta y el medico ve el motivo
            console.error('[avatar] Error en la prueba de ojos:', error);
            ojos = { realizado: false, motivo: `Error inesperado (${error.message}).` };
            await pasarAlMedico();
            return;
        }
        // Camara negada. La prueba es obligatoria, asi que no se sigue sin ella
        console.warn('[avatar] Sin camara para la prueba de ojos:', error.name);
        ojosUI.titulo.textContent = 'Necesitamos tu cámara';
        ojosUI.indicacion.textContent = 'La prueba de ojos usa la cámara. Toca el candado junto a la dirección de la página, permite la cámara y vuelve a intentarlo.';
        ojosUI.estado.textContent = '';
        ojosReintentar.hidden = false;
        guia.decir('camara');
        return;
    }
    if (!ojos.realizado) console.warn('[avatar] Prueba de ojos no realizada:', ojos.motivo);
    await pasarAlMedico();
}

// Sin pantalla intermedia: la voz avisa y entra el medico. Si el navegador bloquea el audio del
// doctor por no haber toque reciente, sale audioBtn ("Toca para escuchar al doctor").
async function pasarAlMedico() {
    ojosUI.titulo.textContent = 'Conectando con el asistente…';
    ojosUI.indicacion.textContent = '';
    ojosUI.estado.textContent = '';
    await guia.decir('fin');
    await startCall();
}

async function startCall() {
    guia.apagar();
    conectarBtn.disabled = true;
    callStatus.textContent = 'Verificando micrófono...';

    const permission = await checkMicrophonePermission();
    if (!permission.granted) {
        showPermissionError(permission.error);
        callStatus.textContent = 'Micrófono no disponible';
        vc.dataset.estado = 'listo';
        conectarBtn.disabled = false;
        return;
    }

    await encenderCamara();
    vc.dataset.estado = 'llamada';

    try {
        callStatus.textContent = 'Conectando con el asistente...';
        const res = await fetch('/avatar/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ _id })
        });
        const data = await res.json();
        if (data.error === 'link_usado') {
            apagarCamara();
            vc.dataset.estado = 'fin';
            callStatus.textContent = 'Esta consulta ya fue realizada';
            return;
        }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        sesion = data;

        room = new Room({ adaptiveStream: true });
        room.on(RoomEvent.TrackSubscribed, onTrack);
        room.on(RoomEvent.DataReceived, onData);
        room.on(RoomEvent.Disconnected, () => finishCall('desconectado'));
        // iOS/Android pueden bloquear el audio si el gesto del usuario ya "expiro" tras los fetch
        room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
            audioBtn.hidden = room.canPlaybackAudio;
        });

        await room.connect(sesion.livekit_url, sesion.livekit_client_token);
        // voiceIsolation solo existe en algunos navegadores; los demas lo ignoran
        await room.localParticipant.setMicrophoneEnabled(true, {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            voiceIsolation: true
        });

        await room.startAudio().catch(() => {});
        audioBtn.hidden = room.canPlaybackAudio;
        mantenerPantallaEncendida();
        fotoTimers = MOMENTOS_FOTO.map(([momento, ms]) => setTimeout(() => tomarFoto(momento), ms));
        endCallBtn.hidden = false;
    } catch (error) {
        console.error('[avatar] Error al iniciar:', error);
        apagarCamara();
        vc.dataset.estado = 'listo';
        showNotification('No se pudo conectar con el asistente. Intenta de nuevo.', 'error');
        conectarBtn.disabled = false;
    }
}

// La camara es opcional: si el paciente la niega, la consulta sigue con el fondo de BSL
async function encenderCamara() {
    try {
        camara = await navigator.mediaDevices.getUserMedia({
            // 640x360 basta para una pantalla de celular y alivia los equipos de gama baja
            video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } },
            audio: false
        });
        selfVideo.srcObject = camara;
        selfVideo.classList.add('activa');
    } catch (error) {
        console.warn('[avatar] Sin camara:', error.name);
    }
}

// En el celular la pantalla se apagaria a mitad de la consulta (el paciente solo habla)
async function mantenerPantallaEncendida() {
    if (wakeLock && !wakeLock.released) return;
    try {
        wakeLock = await navigator.wakeLock?.request('screen');
    } catch (error) {
        console.warn('[avatar] Sin wake lock:', error.name);
    }
}

function apagarCamara() {
    camara?.getTracks().forEach(t => t.stop());
    camara = null;
    selfVideo.classList.remove('activa');
}

function onTrack(track) {
    if (track.kind === Track.Kind.Video) {
        track.attach(video);
    } else if (track.kind === Track.Kind.Audio) {
        document.body.appendChild(track.attach());
    }
}

// El microfono queda abierto todo el tiempo: el paciente puede interrumpir al doctor y el
// agente de ElevenLabs se calla y lo escucha, como en una conversacion real. (Hubo una version
// que lo silenciaba mientras el avatar hablaba, para el ruido de fondo con el VAD de LiveAvatar.)
function avatarHablando() {
    doctorBubble.classList.add('hablando');
    callStatus.textContent = 'El asistente está hablando...';
}

function avatarCallado() {
    doctorBubble.classList.remove('hablando');
    if (!finalizando && !cerrando) callStatus.textContent = 'Te escucho';
}

function onData(payload, _participant, _kind, topic) {
    if (topic !== DATA_TOPIC) return;
    let msg;
    try {
        msg = JSON.parse(new TextDecoder().decode(payload));
    } catch {
        return;
    }
    console.log('[avatar event]', msg.event_type, msg.text || '');

    // Passthrough del agente de ElevenLabs: el id de la conversacion sirve para bajar su audio
    if (msg.event_type === 'elevenlabs_agent_event'
            && msg.elevenlabs_event_type === 'conversation_initiation_metadata') {
        conversationId = msg.data?.conversation_initiation_metadata_event?.conversation_id
            || msg.data?.conversation_id || conversationId;
    }

    if (msg.event_type === 'user.transcription' && msg.text) {
        transcript.push({ role: 'user', text: msg.text });
    } else if (msg.event_type === 'avatar.transcription' && msg.text) {
        transcript.push({ role: 'assistant', text: msg.text });
        if (msg.text.toLowerCase().includes(FRASE_CIERRE)) cerrando = true;
    } else if (msg.event_type === 'avatar.speak_started') {
        avatarHablando();
    } else if (msg.event_type === 'avatar.speak_ended') {
        if (cerrando) finishCall('despedida');
        else avatarCallado();
    } else if (msg.event_type === 'session.stopped' || msg.event_type === 'session_stopped') {
        // session_stopped (con stop_reason AGENT_HANG_UP) es el del agente de ElevenLabs al colgar
        finishCall('sesion detenida');
    }
}

async function finishCall(motivo) {
    if (finalizando || !sesion) return;
    finalizando = true;
    console.log('[avatar] Finalizando:', motivo);

    endCallBtn.hidden = true;
    callStatus.textContent = 'Generando tu resumen...';
    fotoTimers.forEach(clearTimeout);
    tomarFoto('final');
    if (room) {
        room.removeAllListeners();
        await room.disconnect();
    }
    apagarCamara();
    wakeLock?.release().catch(() => {});
    wakeLock = null;
    audioBtn.hidden = true;
    vc.dataset.estado = 'fin';

    try {
        const res = await fetch('/avatar/end', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: sesion.session_id,
                context_id: sesion.context_id,
                _id,
                transcript,
                conversation_id: conversationId,
                ref: sesion.ref,
                inicio: sesion.inicio,
                fotos,
                ojos
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

        // Cortada antes de terminar: el link sigue sirviendo, recargar arranca de cero
        if (data.incompleta) {
            callStatus.textContent = 'La llamada se cortó';
            document.getElementById('resumenTitulo').textContent = 'La llamada se cortó';
            resumenBox.textContent = 'No alcanzamos a terminar la entrevista. Busca un lugar con buena señal, revisa que el micrófono esté activo y vuelve a intentarlo.';
            reintentarBtn.hidden = false;
            resumenCard.hidden = false;
            return;
        }

        callStatus.textContent = data.demo ? 'Demo: el resumen no se envió a nadie' : 'Resumen enviado. Ya puedes cerrar esta ventana.';
        if (data.resumen) {
            resumenBox.textContent = data.resumen;
            pintarResultados(ojosResultados, ojos);
            cerrarAviso.hidden = false;
            resumenCard.hidden = false;
        }
    } catch (error) {
        console.error('[avatar] Error al cerrar:', error);
        callStatus.textContent = 'No se pudo enviar el resumen';
        showNotification('Error al generar el resumen', 'error');
    }
}

// "Intentar de nuevo" tras una llamada cortada: la prueba de ojos ya esta hecha, solo se repite la
// entrevista. Recargar la pagina obligaba a repetir la prueba.
function reintentarLlamada() {
    room = null;
    sesion = null;
    transcript = [];
    cerrando = false;
    finalizando = false;
    conversationId = null;
    fotos = [];
    fotoTimers = [];
    document.querySelectorAll('body > audio').forEach(a => a.remove());
    doctorBubble.classList.remove('hablando');
    resumenCard.hidden = true;
    reintentarBtn.hidden = true;
    document.getElementById('resumenTitulo').textContent = 'Consulta finalizada';
    resumenBox.textContent = '';
    pintarResultados(ojosResultados, null);
    cerrarAviso.hidden = true;
    callStatus.textContent = 'Listo para iniciar';
    startCall();
}

// MediaPipe y el modelo pesan ~10 MB: se bajan mientras el paciente lee la pantalla de inicio
precargarModelo().catch(error => console.warn('[avatar] No se pudo precargar la prueba de ojos:', error));
guia.precargar();

callButton.addEventListener('click', iniciar);
conectarBtn.addEventListener('click', startCall);
ojosReintentar.addEventListener('click', pruebaDeOjos);
// Sin aceptar la grabacion (audio + fotos) no se puede iniciar la consulta
callButton.disabled = !consentimiento.checked;
consentimiento.addEventListener('change', () => { callButton.disabled = !consentimiento.checked; });
endCallBtn.addEventListener('click', () => finishCall('boton'));
reintentarBtn.addEventListener('click', () => (ojos ? reintentarLlamada() : location.reload()));
audioBtn.addEventListener('click', () => room?.startAudio());

// Igual que la llamada de voz: si el paciente se va a otra app mas de 30 s, se cierra.
// Al volver, el wake lock se pierde y hay que pedirlo otra vez.
let ocultaTimer = null;
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        if (room && !finalizando) ocultaTimer = setTimeout(() => finishCall('pestaña oculta'), 30000);
    } else {
        clearTimeout(ocultaTimer);
        if ((room && !finalizando) || vc.dataset.estado === 'ojos') mantenerPantallaEncendida();
    }
});
