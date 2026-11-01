// Paciente simulado para correr la pagina completa sin audifonos ni persona (Playwright:
// `page.addInitScript({ path: 'src/static/prueba-oidos/pruebas/simulador.js' })` antes de abrir
// index.html). No toca app.js:
//
// - Espia Web Audio: al arrancar cada oscilador mira su frecuencia, la amplitud que agenda su
//   GainNode y a que canal del ChannelMerger va (0 = izquierdo, 1 = derecho). Con el perfil
//   "cable" pasa esa amplitud a dB HL y decide si el paciente "oye" con una curva logistica.
// - Si oye, toca el orbe («Lo oí») 350-700 ms despues del inicio del tono.
// - Toca "Empezar" y contesta los botones de oidos.js: perfil "cable", "sí", el oido correcto.
// - El microfono es un MediaStream en silencio; la camara, un canvas con una "cara" (para las fotos).
//
// Umbrales del paciente: window.__umbralesSimulados (si no, una muesca por ruido en el derecho).
// Modos (window.__simulador, antes de cargar la pagina):
//   tocarAlAzar: toques/s al azar sobre el orbe, oiga o no (el tramposo)
//   ausente: [desde, hasta] en ms desde el primer tono de la prueba: ni responde ni toca botones
// Lo que hizo queda en window.__simStats.
// Al terminar, index.html deja el resultado en window.__pruebaOidos.
(() => {
    const UMBRALES = window.__umbralesSimulados || {
        od: { 500: 10, 1000: 10, 2000: 15, 3000: 30, 4000: 45, 6000: 40 },
        oi: { 500: 10, 1000: 10, 2000: 10, 3000: 10, 4000: 20, 6000: 15 },
    };
    // perfiles.js, perfil "cable": HL = dBFS + 100 - RETSPL
    const RETSPL = { 500: 11.5, 1000: 7, 2000: 9, 3000: 10, 4000: 9.5, 6000: 15.5 };
    const azar = (a, b) => a + Math.random() * (b - a);
    const oye = (hl, T) => Math.random() < 0.01 + 0.98 / (1 + Math.exp(-(hl - T) / 2));
    let ultimoOido = null;
    const MODO = window.__simulador || {};
    const stats = window.__simStats = { tonos: 0, alAzar: 0, ignoradosAusente: 0 };
    let primerTono = null;
    const ausente = () => primerTono != null && MODO.ausente
        && performance.now() - primerTono >= MODO.ausente[0] && performance.now() - primerTono < MODO.ausente[1];

    const amp = new WeakMap();      // GainNode -> amplitud maxima agendada
    const canales = new WeakMap();  // GainNode -> Set de canales del merger
    const gainDe = new WeakMap();   // Oscillator -> GainNode

    const rampa = AudioParam.prototype.linearRampToValueAtTime;
    AudioParam.prototype.linearRampToValueAtTime = function (v, t) {
        if (this.__gain) amp.set(this.__gain, Math.max(amp.get(this.__gain) || 0, v));
        return rampa.call(this, v, t);
    };
    const crearGain = BaseAudioContext.prototype.createGain;
    BaseAudioContext.prototype.createGain = function () {
        const g = crearGain.call(this);
        g.gain.__gain = g;
        return g;
    };
    const conectar = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destino, salida, entrada) {
        if (this instanceof OscillatorNode && destino instanceof GainNode) gainDe.set(this, destino);
        if (this instanceof GainNode && destino instanceof ChannelMergerNode) {
            if (!canales.has(this)) canales.set(this, new Set());
            canales.get(this).add(entrada);
        }
        return conectar.apply(this, arguments);
    };
    const arrancar = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (t) {
        const g = gainDe.get(this);
        const f = Math.round(this.frequency.value);
        const ch = canales.get(g) || new Set();
        const oido = ch.size === 2 ? 'ambos' : ch.has(1) ? 'od' : 'oi';
        ultimoOido = oido;
        const a = amp.get(g) || 0;
        if (a > 0 && RETSPL[f] != null && oido !== 'ambos') {
            const hl = 20 * Math.log10(a) + 100 - RETSPL[f];
            const boton = document.getElementById('oidosOrbe');
            const enPrueba = boton && boton.dataset.modo === 'responde';
            if (enPrueba) { stats.tonos++; primerTono ??= performance.now(); }
            if (enPrueba && ausente()) stats.ignoradosAusente++;
            else if (enPrueba && oye(hl, UMBRALES[oido][f])) {
                const retraso = (t - this.context.currentTime) * 1000 + azar(350, 700);
                setTimeout(() => boton.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), retraso);
            }
        }
        return arrancar.call(this, t);
    };

    // Los clics del simulador no son gestos reales: Chrome deja el AudioContext suspendido. La
    // logica no depende del reloj de audio, asi que se le dice a app.js que esta corriendo.
    Object.defineProperty(BaseAudioContext.prototype, 'state', { get: () => 'running' });

    // Microfono en silencio y camara con una "cara" dibujada
    navigator.mediaDevices.getUserMedia = async (c = {}) => {
        const pistas = [];
        if (c.video) {
            const cv = document.createElement('canvas');
            cv.width = 640; cv.height = 480;
            const x = cv.getContext('2d');
            setInterval(() => {
                x.fillStyle = '#2b3240'; x.fillRect(0, 0, 640, 480);
                x.fillStyle = '#c9a27e'; x.beginPath(); x.ellipse(320, 230, 120, 160, 0, 0, 7); x.fill();
            }, 100);
            pistas.push(...cv.captureStream(15).getVideoTracks());
        }
        if (c.audio) pistas.push(...new AudioContext().createMediaStreamDestination().stream.getAudioTracks());
        return new MediaStream(pistas);
    };

    // El tramposo: toques al azar sobre el orbe durante la prueba
    if (MODO.tocarAlAzar) {
        setInterval(() => {
            const boton = document.getElementById('oidosOrbe');
            if (boton?.dataset.modo === 'responde' && !ausente() && Math.random() < MODO.tocarAlAzar * 0.1) {
                stats.alAzar++;
                boton.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            }
        }, 100);
    }

    // Pantallas: "Empezar", tipo de audifono y respuestas (oidos.js pone data-valor en cada boton)
    const PREFERIDOS = ['true', 'si', 'seguir', ''];
    let empezado = false;
    setInterval(() => {
        const empezar = document.getElementById('empezar');
        if (!empezado && empezar) {
            empezado = true;
            empezar.click();
            return;
        }
        const caja = document.getElementById('oidosOpciones');
        const botones = caja ? [...caja.querySelectorAll('.oi-opcion')] : [];
        if (!botones.length || ausente()) return;
        if (caja.dataset.tipo === 'perfiles') {
            botones.find((b) => b.dataset.valor === 'cable')?.click();
        } else if (caja.dataset.tipo === 'lados') {
            botones.find((b) => b.dataset.valor === ultimoOido)?.click();
        } else {
            for (const v of PREFERIDOS) {
                const b = botones.find((x) => x.dataset.valor === v);
                if (b) { b.click(); return; }
            }
        }
    }, 500);
})();
