// Salida de tonos con Web Audio: pulsos de una frecuencia, a un nivel en dBFS, por un solo oido.
//
// - dBFS = amplitud pico del seno respecto a 1.0. Un tono a -93 dBFS tiene amplitud 2.2e-5: en
//   float no hay problema, pero el celular sale a 16 bits en muchos casos (piso ~ -96 dBFS). Por eso
//   la prueba no baja de 0 dB HL estimado (ver PISO_HL en app.js).
// - iPhone calla Web Audio con el interruptor de silencio, salvo con audioSession = 'playback'
//   (Safari 16.4+). Sin eso, la revision de lateralidad detecta que no suena.
// - PERO en 'playback' iPhone no deja abrir el microfono: getUserMedia falla sin mostrar el aviso de
//   permisos (1-nov-2026: ningun paciente de iPhone pudo entrar). Por eso 'playback' solo se pone
//   cuando el microfono ya esta cerrado, justo antes de los tonos, y modoAutomatico() lo devuelve al
//   terminar: despues vienen la camara y el microfono de la entrevista. Nunca en desbloquear().
// - Pulsos de 225 ms con rampas de 20 ms: sin chasquido al prender y apagar, y mas faciles de
//   detectar que un tono continuo (no se confunden con un zumbido de oido).

export const PULSOS = 3;
export const ENCENDIDO_MS = 225;
export const APAGADO_MS = 225;
export const RAMPA_MS = 20;
export const DURACION_MS = PULSOS * ENCENDIDO_MS + (PULSOS - 1) * APAGADO_MS;
export const MAX_DBFS = -6;          // nunca mas fuerte que esto, pase lo que pase con la calibracion
const ADELANTO_S = 0.05;             // margen para agendar en el reloj de audio

function tipoDeSesion(tipo) {
    try {
        if (navigator.audioSession) navigator.audioSession.type = tipo;
    } catch { /* navegador sin audioSession: no pasa nada */ }
}

/** Solo con el microfono cerrado (ver arriba). */
export const modoReproduccion = () => tipoDeSesion('playback');
/** El navegador decide: con microfono abierto, 'play-and-record'. Antes de pedir el microfono. */
export const modoAutomatico = () => tipoDeSesion('auto');

export function crearSalida() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx({ latencyHint: 'interactive' });

    /** Llamar SINCRONO dentro del toque del paciente (iPhone). No cambia la sesion de audio. */
    function desbloquear() {
        ctx.resume();
        const b = ctx.createBuffer(1, 1, ctx.sampleRate);
        const s = ctx.createBufferSource();
        s.buffer = b;
        s.connect(ctx.destination);
        s.start();
    }

    /**
     * Presenta un tono. Devuelve {inicio, fin} en el reloj de performance.now(), ya corrido por
     * la latencia de salida que reporte el navegador (Bluetooth puede sumar 150-300 ms y no
     * siempre la reporta: la ventana de respuesta de app.js tiene margen para eso).
     * @param {{oido:'od'|'oi'|'ambos', frecuencia:number, dbfs:number, pulsos?:number, continuo?:number}} op
     *   continuo: si viene, un solo pulso largo de esa duracion en ms (tono de referencia).
     */
    function tono({ oido, frecuencia, dbfs, pulsos = PULSOS, continuo = null }) {
        const amp = Math.pow(10, Math.min(dbfs, MAX_DBFS) / 20);
        const osc = ctx.createOscillator();
        osc.frequency.value = frecuencia;
        const g = ctx.createGain();
        g.gain.value = 0;
        osc.connect(g);
        const merger = ctx.createChannelMerger(2);
        // El oido derecho es el canal 1 (R) y el izquierdo el 0 (L)
        if (oido === 'oi' || oido === 'ambos') g.connect(merger, 0, 0);
        if (oido === 'od' || oido === 'ambos') g.connect(merger, 0, 1);
        merger.connect(ctx.destination);

        const t0 = ctx.currentTime + ADELANTO_S;
        const rampa = RAMPA_MS / 1000;
        const tramos = continuo ? [[0, continuo / 1000]]
            : Array.from({ length: pulsos }, (_, i) => [i * (ENCENDIDO_MS + APAGADO_MS) / 1000, ENCENDIDO_MS / 1000]);
        for (const [desde, dur] of tramos) {
            g.gain.setValueAtTime(0, t0 + desde);
            g.gain.linearRampToValueAtTime(amp, t0 + desde + rampa);
            g.gain.setValueAtTime(amp, t0 + desde + dur - rampa);
            g.gain.linearRampToValueAtTime(0, t0 + desde + dur);
        }
        const [ultDesde, ultDur] = tramos[tramos.length - 1];
        const finS = t0 + ultDesde + ultDur;
        osc.start(t0);
        osc.stop(finS + 0.05);
        osc.onended = () => { osc.disconnect(); g.disconnect(); merger.disconnect(); };

        const latencia = (ctx.outputLatency || ctx.baseLatency || 0) * 1000;
        const ahora = performance.now();
        const inicio = ahora + (t0 - ctx.currentTime) * 1000 + latencia;
        return { inicio, fin: inicio + (finS - t0) * 1000, detener: () => { try { osc.stop(); } catch { /* ya paro */ } } };
    }

    return { ctx, desbloquear, tono, cerrar: () => ctx.close() };
}
