// Microfono para dos revisiones: ruido del lugar y si el sonido sale por el parlante.
//
// Se abre sin cancelacion de eco, supresion de ruido ni control de ganancia: con eso el telefono
// "limpia" justo lo que queremos medir. Los niveles van en dBFS SIN calibrar (cada microfono es
// distinto): sirven para comparar y se guardan crudos para ajustar los limites con datos.
//
// Durante los tonos el microfono va cerrado: en iPhone, tenerlo abierto cambia la sesion de audio
// (puede bajar el volumen o cambiar la salida) y eso moveria los umbrales.
import { modoAutomatico } from './tonos.js';

export async function abrirMicrofono(ctx) {
    modoAutomatico();   // en 'playback' iPhone rechaza el microfono (ver tonos.js)
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const fuente = ctx.createMediaStreamSource(stream);
    const analizador = ctx.createAnalyser();
    analizador.fftSize = 4096;
    analizador.smoothingTimeConstant = 0;
    fuente.connect(analizador);
    const tiempo = new Float32Array(analizador.fftSize);
    const espectro = new Float32Array(analizador.frequencyBinCount);

    // RMS del bloque actual, en dBFS
    function nivel() {
        analizador.getFloatTimeDomainData(tiempo);
        let s = 0;
        for (const x of tiempo) s += x * x;
        return 10 * Math.log10(s / tiempo.length + 1e-12);
    }

    // Energia en la banda de una frecuencia (dB del analizador), para reconocer un tono nuestro
    function energiaEn(frecuencia) {
        analizador.getFloatFrequencyData(espectro);
        const bin = Math.round(frecuencia / (ctx.sampleRate / analizador.fftSize));
        let max = -Infinity;
        for (let i = bin - 2; i <= bin + 2; i++) max = Math.max(max, espectro[i] ?? -Infinity);
        return max;
    }

    /** Toma muestras cada 100 ms durante `ms` y devuelve la mediana y el percentil 90. */
    async function medir(ms, fn = nivel) {
        const valores = [];
        const fin = performance.now() + ms;
        while (performance.now() < fin) {
            valores.push(fn());
            await new Promise((r) => setTimeout(r, 100));
        }
        valores.sort((a, b) => a - b);
        const p = (q) => valores[Math.min(valores.length - 1, Math.floor(q * valores.length))];
        return { mediana: redondear(p(0.5)), p90: redondear(p(0.9)) };
    }

    function cerrar() {
        fuente.disconnect();
        stream.getTracks().forEach((t) => t.stop());
    }

    return { nivel, energiaEn, medir, cerrar };
}

const redondear = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
