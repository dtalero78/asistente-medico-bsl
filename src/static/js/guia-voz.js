// Voz que guia las pruebas de oidos y de ojos, y musica del tiempo quieto. Los audios estan grabados en
// static/assets/voz-ojos/ (scripts/voz-ojos/generar.py, voz de Alirio, la del medico).
//
// iPhone solo deja sonar un <audio> si su primer play() ocurre dentro de un toque del paciente, y
// despues ese mismo elemento puede sonar cuantas veces se quiera. Por eso hay dos elementos fijos
// (voz y musica) que se desbloquean en el toque de "Iniciar Consulta" y se reutilizan.
// <audio> y no Web Audio: Web Audio se calla con el interruptor de silencio del iPhone.
const BASE = '/static/assets/voz-ojos/';
const CLIPS = ['intro', 'tamizaje', 'acercate', 'alejate', 'abre-ojos', 'quieto', 'un-poco-mas',
    'perfecto', 'boton-foto', 'no-te-veo',
    'foto-lista', 'fatiga', 'fatiga-que', 'faltan-30', 'fatiga-casi', 'pupilas', 'pupilas-luz',
    'pupilas-rojo', 'pupilas-destello', 'pupilas-listo', 'fin', 'camara',
    'oidos-intro', 'oidos-audifonos', 'oidos-sin-audifonos', 'oidos-silencio', 'oidos-ruido',
    'oidos-volumen', 'oidos-tono', 'oidos-oiste', 'oidos-no-sono', 'oidos-parlante', 'oidos-lado',
    'oidos-cual', 'oidos-al-reves', 'oidos-otra-vez', 'oidos-prueba', 'oidos-izquierdo',
    'oidos-pausa', 'oidos-fin', 'oidos-solo', 'oidos-solo-2', 'oidos-sin-tono', 'oidos-sigues'];
const MAX_CLIP_MS = 20000;   // si un clip no avisa que termino, no se queda esperando para siempre

export function crearGuia() {
    const voz = new Audio();
    voz.preload = 'auto';
    const musica = new Audio(`${BASE}musica.mp3`);
    musica.preload = 'auto';
    musica.loop = true;

    let hablando = false;
    let terminarClip = null;

    // Calentar la cache: asi cada clip arranca al instante cuando toca
    function precargar() {
        for (const id of CLIPS) fetch(`${BASE}${id}.mp3`).catch(() => {});
    }

    /** Llamar SINCRONO dentro del manejador del toque, antes de cualquier await. */
    function desbloquear() {
        voz.src = `${BASE}intro.mp3`;
        for (const el of [voz, musica]) {
            el.muted = true;
            const p = el.play();
            // Solo se pausa si sigue en mudo: si decir() ya lo tomo, esta sonando un clip de verdad
            if (p) p.then(() => { if (el.muted) { el.pause(); el.muted = false; } }).catch(() => { el.muted = false; });
        }
    }

    /** Dice un clip. La promesa se resuelve al terminar, aunque falle: la guia nunca frena la prueba. */
    function decir(id) {
        callar();
        return new Promise((resolve) => {
            hablando = true;
            const timer = setTimeout(fin, MAX_CLIP_MS);
            function fin() {
                clearTimeout(timer);
                voz.onended = voz.onerror = null;
                hablando = false;
                terminarClip = null;
                resolve();
            }
            terminarClip = fin;
            voz.onended = voz.onerror = fin;
            voz.muted = false;
            voz.src = `${BASE}${id}.mp3`;
            voz.play().catch(fin);
        });
    }

    function callar() {
        voz.pause();
        if (terminarClip) terminarClip();
    }

    function musicaOn() {
        musica.currentTime = 0;
        musica.play().catch(() => {});
    }

    function musicaOff() {
        musica.pause();
    }

    return {
        precargar, desbloquear, decir, callar, musicaOn, musicaOff,
        get hablando() { return hablando; },
        apagar() { callar(); musicaOff(); },
    };
}
