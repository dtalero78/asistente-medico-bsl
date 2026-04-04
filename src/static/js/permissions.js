import { showModal } from './ui.js';

export async function checkMicrophonePermission() {
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            return { granted: false, error: 'Tu navegador no soporta acceso al microfono. Por favor usa Chrome, Firefox, Safari o Edge.' };
        }

        if (navigator.permissions && navigator.permissions.query) {
            try {
                const permissionStatus = await navigator.permissions.query({ name: 'microphone' });
                if (permissionStatus.state === 'denied') {
                    return { granted: false, error: 'El permiso del microfono esta bloqueado. Por favor habilitalo en la configuracion de tu navegador.' };
                }
            } catch (e) {
                console.log('Permission query not supported, will try getUserMedia directly');
            }
        }

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        return { granted: true };

    } catch (error) {
        console.error('Error verificando permisos de microfono:', error);

        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            return { granted: false, error: 'Necesitas permitir el acceso al microfono para realizar la llamada. Por favor haz clic en el icono de candado en la barra de direcciones y habilita el microfono.' };
        } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
            return { granted: false, error: 'No se encontro un microfono. Por favor conecta un microfono y vuelve a intentar.' };
        } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
            return { granted: false, error: 'El microfono esta siendo usado por otra aplicacion. Por favor cierra otras apps que usen el microfono.' };
        } else {
            return { granted: false, error: 'No se pudo acceder al microfono. Por favor verifica tus permisos e intenta de nuevo.' };
        }
    }
}

export function showPermissionError(message) {
    showModal('Permiso de Microfono Requerido', message);
}
