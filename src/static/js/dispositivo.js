// Desde qué dispositivo se hace la consulta, y aviso al servidor cuando algo falla antes de la
// entrevista. Nació el 1-nov-2026: en iPhone nadie podía entrar (micrófono rechazado) y el servidor
// no se enteró; solo se supo porque un paciente grabó videos. Los eventos quedan en los logs de la
// app (POST /avatar/evento, services/dispositivo.py); el dispositivo, además, en el meta.json.

// Navegador a partir del user agent. En iPhone todos usan WebKit: CriOS = Chrome, FxiOS = Firefox.
function navegador(ua) {
    // WA4A: el navegador interno de WhatsApp en Android, que por lo demas dice Chrome
    if (/WhatsApp|WA4A/i.test(ua)) return 'WhatsApp (navegador interno)';
    if (/FBAN|FBAV|Instagram/i.test(ua)) return 'Facebook/Instagram (navegador interno)';
    if (/CriOS/.test(ua)) return 'Chrome iOS';
    if (/FxiOS/.test(ua)) return 'Firefox iOS';
    if (/EdgiOS|EdgA|Edg\//.test(ua)) return 'Edge';
    if (/SamsungBrowser/.test(ua)) return 'Samsung Internet';
    if (/Chrome\//.test(ua)) return 'Chrome';
    if (/Firefox\//.test(ua)) return 'Firefox';
    if (/Safari\//.test(ua)) return 'Safari';
    return 'otro';
}

function sistema(ua) {
    const ios = ua.match(/(?:iPhone|iPad|iPod).*? OS (\d+[_.]\d+)/);
    if (ios) return `iOS ${ios[1].replace('_', '.')}`;
    const android = ua.match(/Android (\d+(?:\.\d+)?)/);
    if (android) return `Android ${android[1]}`;
    if (/Macintosh/.test(ua)) return navigator.maxTouchPoints > 1 ? 'iPadOS' : 'macOS';
    if (/Windows/.test(ua)) return 'Windows';
    return 'otro';
}

export function dispositivo() {
    const ua = navigator.userAgent || '';
    // En Android el modelo viene en el user agent ("SM-A515F"); en iPhone Apple no lo da
    const modelo = (ua.match(/Android [^;]+; ([^;)]+?)(?: Build|\))/) || [])[1] || (/iPhone/.test(ua) ? 'iPhone' : null);
    return {
        sistema: sistema(ua),
        navegador: navegador(ua),
        modelo,
        pantalla: `${screen.width}x${screen.height}@${window.devicePixelRatio || 1}`,
        idioma: navigator.language || null,
        audioSession: !!navigator.audioSession,
        ua: ua.slice(0, 300),
    };
}

/**
 * Avisa al servidor qué pasó y en qué paso. No espera respuesta ni puede fallar: un aviso nunca
 * debe frenar la consulta. sendBeacon sobrevive aunque el paciente cierre la página.
 * @param {string} etapa  p. ej. 'inicio', 'permisos', 'oidos', 'ojos', 'conexion'
 * @param {Error|object|string|null} error
 */
export function reportar(etapa, error = null, extra = null) {
    try {
        const params = new URLSearchParams(window.location.search);
        const cuerpo = JSON.stringify({
            _id: params.get('_id') || params.get('ref'),
            etapa,
            error: error ? {
                nombre: error.name || null,
                mensaje: String(error.message || error.motivo || error).slice(0, 300),
            } : null,
            extra,
            dispositivo: dispositivo(),
        });
        const blob = new Blob([cuerpo], { type: 'application/json' });
        if (!(navigator.sendBeacon && navigator.sendBeacon('/avatar/evento', blob))) {
            fetch('/avatar/evento', { method: 'POST', body: cuerpo, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {});
        }
    } catch { /* nunca frena la consulta */ }
}
