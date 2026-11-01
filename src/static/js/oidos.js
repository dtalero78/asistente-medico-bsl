// Prueba de oidos antes de la de ojos: tamizaje con los audifonos del paciente. Los algoritmos
// viven en static/prueba-oidos/src (umbral, perfiles, tonos, microfono, resultado), con su propio
// CLAUDE.md; esta es la cascara para el celular.
//
// Va guiada por la voz de Alirio (guia-voz.js), igual que la de ojos: cada paso se dice antes de
// pedir algo. La voz se calla mientras suenan los tonos (taparia los mas suaves) y habla entre una
// frecuencia y otra: antes de cada una repite "toca solo cuando oigas el pitido". Aqui el paciente si
// mira la pantalla: contesta con botones.
//
// Contra la trampa (tocar sin oir): ensayos sin tono; si contesta uno, la voz lo corrige y esa
// frecuencia se repite. Contra el abandono: si deja de responder tonos que deberia oir, se pausa y
// pregunta "¿Sigues ahí?" (si no, la prueba seguiria sola y saldria una sordera que no existe).
// Contra la suplantacion: fotos con la camara frontal durante los tonos (se le avisa al inicio).
//
// Bluetooth: con el microfono abierto el celular pasa los audifonos a "manos libres", que es MONO
// y de banda angosta. Por eso el microfono se cierra despues de la revision de volumen, antes de la
// de lateralidad (en mono nadie la pasaria) y de los tonos, y no se vuelve a abrir.
import { crearUmbral } from '../prueba-oidos/src/umbral.js';
import { PERFILES, aDbfs, VERSION_CALIBRACION } from '../prueba-oidos/src/perfiles.js';
import { crearSalida, modoReproduccion, modoAutomatico, DURACION_MS } from '../prueba-oidos/src/tonos.js';
import { abrirMicrofono } from '../prueba-oidos/src/microfono.js';
import { LIMITES, resumir } from '../prueba-oidos/src/resultado.js';
import { audiograma } from '../prueba-oidos/src/audiograma.js';

export const VERSION = 'oidos-1';
const PISO_HL = 0;               // mas abajo el celular no reproduce bien (16 bits)
const TECHO_HL = 70;
const INICIO_HL = 40;
const REFERENCIA_HL = 40;        // tono de volumen y de lateralidad
// Orden clinico: 1 kHz primero, agudos, luego 500 Hz; 1 kHz se repite al final del primer oido
const ORDEN = [1000, 2000, 3000, 4000, 6000, 500];
const SECUENCIA = [
    ...ORDEN.map((f) => ({ oido: 'od', f })),
    { oido: 'od', f: 1000, retest: true },
    ...ORDEN.map((f) => ({ oido: 'oi', f })),
];
const CONTROL_PROB = 0.12;       // ensayos sin tono: miden los falsos positivos
const VENTANA_DESDE_MS = 150;    // antes de esto no es respuesta al tono, es un toque al azar
// Hasta 1,5 s desde el inicio del tono (dura 1,125 s). Mas corta, un toque al azar "acierta" menos;
// mas no se puede: Bluetooth atrasa el sonido 0,2-0,3 s y las personas mayores reaccionan mas lento.
// Nada en pantalla marca la ventana: una cuenta regresiva diria cuando hay pitido.
const VENTANA_HASTA_MS = 1500;
// Un toque poco despues de cerrar la ventana de un tono es alguien lento (o con Bluetooth que
// atrasa), no un toque al azar: se cuenta aparte, como "tardio", y no pesa en la confiabilidad
const TARDIO_MS = 700;
const ESPERA_MIN_MS = 600;       // entre ensayos, al azar, para que no se pueda adivinar el ritmo
const ESPERA_MAX_MS = 1500;
const TRAS_RESPUESTA_MS = 400;
const PARLANTE_DB = 15;          // subida del microfono en 1 kHz con el tono de referencia
const RUIDO_MS = 5000;
const A2DP_MS = 1500;            // tras cerrar el microfono, lo que tarda Bluetooth en volver a estereo
const MAX_CORRECCIONES = 3;      // "tocaste sin pitido": se repite la frecuencia hasta 3 veces en la prueba
const INACTIVO_FALLOS = 4;       // tonos seguidos sin respuesta, todos >= REFERENCIA_HL, para preguntar
const MAX_PAUSAS = 3;            // "¿Sigues ahí?" en toda la prueba (y una sola vez por frecuencia)
// Fotos para confirmar que quien responde es el paciente: al empezar cada oido y en la ultima frecuencia
const FOTOS_EN = new Set([0, ORDEN.length + 1, ORDEN.length * 2]);
const FOTO_TRAS_MS = 3000;
const FOTO_ANCHO = 320;

const GUIA_MUDA = { decir: async () => {}, callar() {}, apagar() {} };
const RECORDATORIOS = ['oidos-solo', 'oidos-solo-2'];
const SOLO_SI_OYES = 'Toca solo cuando oigas el pitido.';
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const azar = (a, b) => a + Math.random() * (b - a);
const limitar = (x, a, b) => Math.min(b, Math.max(a, x));

// Iconos de los tipos de audifono (trazo, heredan el color)
const ICONOS = {
    cable: '<path d="M9 4a3 3 0 0 0-3 3v3a3 3 0 0 0 3 3h1V4z"/><path d="M15 4a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3h-1V4z"/><path d="M10 13v3a3 3 0 0 0 3 3h0a3 3 0 0 0 3-3v-1"/><path d="M14 13v2"/><path d="M13 19v2"/>',
    airpods: '<path d="M8 4a3 3 0 0 0-3 3 3 3 0 0 0 3 3v9a1.5 1.5 0 0 0 3 0V7a3 3 0 0 0-3-3z"/><path d="M16 4a3 3 0 0 1 3 3 3 3 0 0 1-3 3v9a1.5 1.5 0 0 1-3 0V7a3 3 0 0 1 3-3z"/>',
    'galaxy-buds': '<circle cx="7.5" cy="12" r="4.5"/><circle cx="16.5" cy="12" r="4.5"/><circle cx="7.5" cy="12" r="1.5"/><circle cx="16.5" cy="12" r="1.5"/>',
    diadema: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>',
    bluetooth: '<path d="M7 7l10 10-5 4V3l5 4L7 17"/>',
    ninguno: '<circle cx="12" cy="12" r="9"/><path d="M6 6l12 12"/>',
};
const icono = (id) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONOS[id] || ''}</svg>`;

/** Crear y desbloquear la salida de tonos. Llamar SINCRONO dentro del toque (iPhone). */
export function prepararAudio() {
    const salida = crearSalida();
    salida.desbloquear();
    return salida;
}

/**
 * Corre la prueba completa. Nunca rechaza: cualquier falla devuelve {realizado: false, motivo}
 * para que la consulta siga y el medico vea por que no hay prueba.
 *
 * @param {object} ui {paso, barra, orbe, orbeTexto, titulo, indicacion, voz, opciones,
 *                     lados, frecuencias, camara (<video>), guia?}
 * @param {object} salida la de prepararAudio(), creada en el toque de "Iniciar Consulta"
 */
export async function examenOidos(ui, salida) {
    const guia = ui.guia || GUIA_MUDA;
    const t0 = Date.now();
    const p = crearPantalla(ui, guia);
    try {
        return await correr(p, ui, salida, t0);
    } catch (error) {
        console.error('[oidos] Error durante la prueba:', error);
        return { realizado: false, motivo: `La prueba falló a mitad de camino (${error.message}).`, version: VERSION };
    } finally {
        guia.apagar();
        p.limpiar();
        salida.cerrar().catch(() => {});   // libera el audio antes de la camara y de LiveKit
        // Sin esto la entrevista no podria abrir el microfono en iPhone (ver tonos.js)
        modoAutomatico();
    }
}

// ------------------------------------------------------------------ pantalla
function crearPantalla(ui, guia) {
    let tocarOrbe = null;

    ui.orbe.addEventListener('pointerdown', manejarToque);
    function manejarToque(e) {
        if (ui.orbe.dataset.modo !== 'responde') return;
        e.preventDefault();
        const t = performance.now();
        ui.orbe.classList.remove('toque');
        void ui.orbe.offsetWidth;
        ui.orbe.classList.add('toque');
        tocarOrbe?.(t);
    }

    // Lo que dice la voz se marca en pantalla (barras), y lo que esta escrito no cambia mientras habla
    async function decir(id) {
        ui.voz.hidden = false;
        try { await guia.decir(id); } finally { ui.voz.hidden = true; }
    }

    function paso(titulo, indicacion = '', modo = 'guia', texto = '') {
        ui.titulo.textContent = titulo;
        ui.indicacion.textContent = indicacion;
        ui.orbe.dataset.modo = modo;
        ui.orbeTexto.textContent = texto;
        ui.opciones.replaceChildren();
        ui.opciones.dataset.tipo = '';
    }

    /** Muestra botones y resuelve con el valor del que se toque. Tocar calla la voz. */
    function opciones(lista, tipo = 'respuestas') {
        ui.opciones.replaceChildren();
        ui.opciones.dataset.tipo = tipo;
        return new Promise((resolve) => {
            for (const op of lista) {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = `oi-opcion ${op.primario ? 'primario' : ''}`;
                b.dataset.valor = op.valor ?? '';
                if (op.icono) b.insertAdjacentHTML('beforeend', icono(op.icono));
                const t = document.createElement('span');
                t.className = 'oi-opcion-texto';
                const fuerte = document.createElement('strong');
                fuerte.textContent = op.etiqueta;
                t.appendChild(fuerte);
                if (op.detalle) {
                    const d = document.createElement('small');
                    d.textContent = op.detalle;
                    t.appendChild(d);
                }
                b.appendChild(t);
                b.addEventListener('click', () => {
                    const v = op.alTocar ? op.alTocar() : op.valor;   // alTocar corre dentro del toque
                    guia.callar();
                    ui.opciones.replaceChildren();
                    resolve(v);
                });
                ui.opciones.appendChild(b);
            }
        });
    }

    function progreso(i, total, oido) {
        ui.barra.style.width = `${Math.round((i / total) * 100)}%`;
        ui.lados.hidden = !oido;
        ui.lados.querySelectorAll('[data-lado]').forEach((el) => el.classList.toggle('activo', el.dataset.lado === oido));
        ui.frecuencias.hidden = oido == null;
        ui.frecuencias.querySelectorAll('li').forEach((li, k) => {
            li.className = k < i ? 'hecha' : k === i ? 'actual' : '';
        });
    }

    ui.frecuencias.replaceChildren(...SECUENCIA.map(() => document.createElement('li')));

    return {
        decir, paso, opciones, progreso,
        set tocarOrbe(fn) { tocarOrbe = fn; },
        limpiar() {
            ui.orbe.removeEventListener('pointerdown', manejarToque);
            ui.opciones.replaceChildren();
            ui.voz.hidden = true;
        },
    };
}

// ------------------------------------------------------------------ flujo
async function correr(p, ui, salida, t0) {
    p.paso('Prueba de oídos', 'Primero tus oídos y después tus ojos. Mientras suenan los tonos tomaremos unas fotos para confirmar que eres tú.');
    p.progreso(0, SECUENCIA.length, null);
    await p.decir('oidos-intro');

    // 1. Audifonos
    p.paso('¿Qué audífonos tienes?', 'Póntelos, los dos, y elige el tipo.');
    const eleccion = p.opciones([
        ...PERFILES.map((x) => ({ valor: x.id, etiqueta: x.nombre, detalle: x.detalle, icono: x.id })),
        { valor: 'ninguno', etiqueta: 'No tengo', detalle: 'Seguimos con los ojos', icono: 'ninguno' },
    ], 'perfiles');
    p.decir('oidos-audifonos');
    const idPerfil = await eleccion;
    if (idPerfil === 'ninguno') {
        p.paso('Sin audífonos', 'La prueba de oídos necesita audífonos. Seguimos con la de ojos.');
        await p.decir('oidos-sin-audifonos');
        return { realizado: false, motivo: 'El paciente no tenía audífonos.', version: VERSION };
    }
    const perfil = PERFILES.find((x) => x.id === idPerfil);

    // 2. Ruido y volumen, con microfono
    let mic = null;
    try {
        mic = await abrirMicrofono(salida.ctx);
    } catch (e) {
        console.warn('[oidos] Sin microfono:', e.name);
    }
    const ruido = mic ? await revisarRuido(p, mic) : null;
    const parlante = await revisarVolumen(p, salida, perfil, mic);
    if (mic) mic.cerrar();
    modoReproduccion();
    await dormir(A2DP_MS);

    // 3. Lateralidad, ya sin microfono (en "manos libres" el audio es mono)
    const lateralidad = await revisarLateralidad(p, salida, perfil);

    // 4. Tonos, con la camara prendida para las fotos (se abre antes: en iPhone abrirla puede
    // interrumpir el audio un instante, mejor mientras habla la voz que en medio de un tono)
    p.paso('Ahora la prueba', `${SOLO_SI_OYES} Aunque sea muy suave.`, 'guia');
    const camara = await abrirCamara(ui.camara);
    await p.decir('oidos-prueba');
    let medidas;
    try {
        medidas = await medirTonos(p, salida, perfil, camara);
    } finally {
        camara?.cerrar();
    }

    p.progreso(SECUENCIA.length, SECUENCIA.length, null);
    p.paso('¡Listo!', 'Terminamos con tus oídos.', 'listo');
    await p.decir('oidos-fin');

    const base = {
        od: medidas.umbrales.od, oi: medidas.umbrales.oi, techo: TECHO_HL, perfil,
        falsos: medidas.falsos,
        retest: medidas.retest,
        ruido: ruido ? { antes: ruido.mediana, despues: null } : null,
        lateralidad, parlante: parlante?.detectado ?? null,
        correcciones: medidas.correcciones, pausas: medidas.pausas,
    };
    return {
        realizado: true,
        version: VERSION,
        calibracion: VERSION_CALIBRACION,
        fecha: new Date().toISOString(),
        duracion_s: Math.round((Date.now() - t0) / 1000),
        perfil: perfil.id,
        umbrales: medidas.umbrales,
        retest: medidas.retest,
        resumen: resumir(base),
        falsos: medidas.falsos,
        ruido,
        parlante,
        lateralidad,
        correcciones: medidas.correcciones,
        pausas: medidas.pausas,
        camara: camara ? 'ok' : 'no disponible',
        fotos: medidas.fotos,
        ensayos: medidas.ensayos,
    };
}

async function revisarRuido(p, mic) {
    for (;;) {
        p.paso('Silencio, por favor', 'Estamos midiendo el ruido del lugar.', 'escucha', '');
        await p.decir('oidos-silencio');
        await dormir(400);
        const r = await mic.medir(RUIDO_MS);
        if (r.mediana == null || r.mediana < LIMITES.ruidoNoConfiable) return r;
        p.paso('Hay mucho ruido', 'Apaga el televisor, cierra la puerta o aléjate de la calle.');
        const otra = p.opciones([
            { valor: true, etiqueta: 'Medir otra vez', primario: true },
            { valor: false, etiqueta: 'Seguir así' },
        ]);
        p.decir('oidos-ruido');
        if (!(await otra)) return r;
    }
}

// Tono de referencia en los dos oidos; de paso, si el microfono lo oye fuerte, sale por el parlante
async function revisarVolumen(p, salida, perfil, mic) {
    const dbfs = aDbfs(REFERENCIA_HL, 1000, perfil);
    let parlante = null;
    for (;;) {
        p.paso('Sube el volumen al máximo', 'Hasta el tope, con los audífonos puestos.');
        const listo = p.opciones([{ valor: true, etiqueta: 'Ya lo subí', primario: true }]);
        p.decir('oidos-volumen');
        await listo;

        p.paso('Escucha', 'Va a sonar un tono en los dos oídos.', 'escucha', 'Escucha…');
        await p.decir('oidos-tono');
        await dormir(500);
        if (mic) {
            const base = await mic.medir(800, () => mic.energiaEn(1000));
            const ref = salida.tono({ oido: 'ambos', frecuencia: 1000, dbfs, continuo: 2000 });
            await dormir(Math.max(0, ref.inicio - performance.now()) + 300);
            const con = await mic.medir(1200, () => mic.energiaEn(1000));
            await dormir(600);
            const delta = con.mediana != null && base.mediana != null ? Math.round(con.mediana - base.mediana) : null;
            parlante = { delta, detectado: delta != null && delta >= PARLANTE_DB };
        } else {
            salida.tono({ oido: 'ambos', frecuencia: 1000, dbfs, continuo: 2000 });
            await dormir(2400);
        }

        if (parlante?.detectado) {
            p.paso('¿Tienes los audífonos conectados?', 'Parece que el sonido sale por el parlante del celular.');
            const r = p.opciones([
                { valor: 'otra', etiqueta: 'Ya los conecté', primario: true },
                { valor: 'seguir', etiqueta: 'Sí están conectados' },
            ]);
            p.decir('oidos-parlante');
            if (await r === 'otra') continue;
        }

        p.paso('¿Oíste el tono?');
        const r = p.opciones([
            { valor: 'si', etiqueta: 'Sí, lo oí', primario: true },
            { valor: 'otra', etiqueta: 'Repetir' },
            { valor: 'no', etiqueta: 'No oí nada' },
        ]);
        p.decir('oidos-oiste');
        const oyo = await r;
        if (oyo === 'si') return parlante;
        if (oyo === 'no') {
            p.paso('No sonó', 'Volumen al tope, audífonos conectados y, en iPhone, el modo silencio apagado.');
            const otra = p.opciones([{ valor: true, etiqueta: 'Probar otra vez', primario: true }]);
            p.decir('oidos-no-sono');
            await otra;
        }
    }
}

async function revisarLateralidad(p, salida, perfil) {
    const dbfs = aDbfs(REFERENCIA_HL, 1000, perfil);
    for (let intento = 0; intento < 2; intento++) {
        p.paso('¿Por qué oído?', 'Vas a oír un tono en un solo oído.');
        await p.decir('oidos-lado');
        const oidos = Math.random() < 0.5 ? ['od', 'oi'] : ['oi', 'od'];
        const respuestas = [];
        for (const oido of oidos) {
            p.paso('Escucha', '', 'escucha', 'Escucha…');
            await dormir(700);
            salida.tono({ oido, frecuencia: 1000, dbfs });
            await dormir(DURACION_MS + 300);
            p.paso('¿En qué oído lo oíste?');
            const r = p.opciones([
                { valor: 'oi', etiqueta: 'Izquierdo', primario: true },
                { valor: 'od', etiqueta: 'Derecho', primario: true },
                { valor: null, etiqueta: 'No lo oí' },
            ], 'lados');
            p.decir('oidos-cual');
            respuestas.push(await r);
        }
        if (respuestas.every((r, i) => r === oidos[i])) return 'ok';
        if (intento === 0) {
            const alReves = respuestas.every((r, i) => r && r !== oidos[i]);
            p.paso(alReves ? 'Audífonos al revés' : 'Probemos otra vez',
                alReves ? 'El que dice R va en el oído derecho y el L en el izquierdo.' : 'Revisa que tengas puestos los dos audífonos.');
            await p.decir(alReves ? 'oidos-al-reves' : 'oidos-otra-vez');
        }
    }
    return 'fallo';
}

// Una llamada o una alarma suspenden el audio y los tonos dejarian de sonar sin que nadie lo note:
// todo saldria "no oye". Se pausa y el toque de "Continuar" lo reactiva (iPhone exige el toque).
async function audioPausado(p, salida) {
    p.paso('Se pausó el sonido', 'Revisa que los audífonos sigan conectados y el volumen al máximo.');
    const r = p.opciones([{ etiqueta: 'Continuar', primario: true, alTocar: () => { salida.desbloquear(); modoReproduccion(); return true; } }]);
    p.decir('oidos-pausa');
    await r;
    await dormir(300);
}

// Camara frontal en un circulo chico (que se note que esta prendida). Si no se puede, sigue sin fotos.
async function abrirCamara(video) {
    if (!video) return null;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false,
        });
        video.srcObject = stream;
        video.hidden = false;
        await video.play().catch(() => {});
        return {
            foto() {
                if (!video.videoWidth) return null;
                const c = document.createElement('canvas');
                c.width = FOTO_ANCHO;
                c.height = Math.round(FOTO_ANCHO * video.videoHeight / video.videoWidth);
                c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
                return c.toDataURL('image/jpeg', 0.7);
            },
            cerrar() {
                stream.getTracks().forEach((t) => t.stop());
                video.srcObject = null;
                video.hidden = true;
            },
        };
    } catch (e) {
        console.warn('[oidos] Sin camara para las fotos:', e.name);
        return null;
    }
}

async function medirTonos(p, salida, perfil, camara) {
    const umbrales = { od: {}, oi: {} };
    const falsos = { control: 0, contestados: 0, espontaneos: 0, tardios: 0, ensayos: 0 };
    const ensayos = [];   // [oido, frecuencia, hl | null (control), oyo, ms desde el inicio del tono]
    const fotos = [];
    let retest = null;
    let ultimo = null;
    let correcciones = 0;
    let pausas = 0;
    let interrumpido = false;
    const alOcultar = () => { if (document.hidden) interrumpido = true; };
    document.addEventListener('visibilitychange', alOcultar);

    // Toques: dentro de la ventana responden el ensayo; poco despues de la de un tono son tardios; el
    // resto (durante la prueba) son al azar
    let ventana = null;   // {desde, hasta, resolver}
    let cierreTono = -Infinity;   // cuando vencio sin respuesta la ultima ventana con tono
    let midiendo = false;
    p.tocarOrbe = (t) => {
        if (!midiendo) return;
        if (ventana && t >= ventana.desde && t <= ventana.hasta) ventana.resolver(t);
        else if (t - cierreTono <= TARDIO_MS) falsos.tardios++;
        else falsos.espontaneos++;
    };
    const esperarRespuesta = (desde, hasta, conTono) => new Promise((resolve) => {
        const timer = setTimeout(() => {
            ventana = null;
            if (conTono) cierreTono = performance.now();
            resolve(null);
        }, Math.max(0, hasta - performance.now()));
        ventana = { desde, hasta, resolver: (t) => { clearTimeout(timer); ventana = null; resolve(t); } };
    });
    const esperarVisible = () => (document.hidden
        ? new Promise((r) => document.addEventListener('visibilitychange', function f() {
            if (!document.hidden) { document.removeEventListener('visibilitychange', f); r(); }
        }))
        : Promise.resolve());
    const titulo = (oido) => (oido === 'od' ? 'Oído derecho' : 'Oído izquierdo');
    const aResponder = (oido) => p.paso(titulo(oido), SOLO_SI_OYES, 'responde', 'Lo oí');

    try {
        let oidoActual = null;
        for (let i = 0; i < SECUENCIA.length; i++) {
            const { oido, f, retest: esRetest } = SECUENCIA[i];
            midiendo = false;
            p.progreso(i, SECUENCIA.length, oido);
            // Antes de cada frecuencia, la voz: al cambiar de oido lo anuncia (y lo recuerda); en las
            // demas, "toca solo cuando oigas el pitido". La primera ya lo dijo "oidos-prueba".
            if (oidoActual && oido !== oidoActual) {
                p.paso('Vas muy bien', `Ahora el oído izquierdo. ${SOLO_SI_OYES}`, 'guia');
                await p.decir('oidos-izquierdo');
            } else if (i > 0) {
                p.paso(titulo(oido), SOLO_SI_OYES, 'guia');
                await p.decir(RECORDATORIOS[i % RECORDATORIOS.length]);
            }
            oidoActual = oido;
            if (FOTOS_EN.has(i) && camara) {
                setTimeout(() => {
                    const imagen = camara.foto();
                    if (imagen) fotos.push({ momento: `oidos-${fotos.length + 1}`, imagen });
                }, FOTO_TRAS_MS);
            }

            // Cerca del umbral anterior: cada 10 dB de mas son dos ensayos
            const inicio = limitar((ultimo ?? INICIO_HL - 10) + 10, 15, 50);
            let u = crearUmbral({ inicio, piso: PISO_HL, techo: TECHO_HL });
            let fallosAltos = 0;
            let preguntado = false;
            aResponder(oido);
            midiendo = true;

            while (!u.terminado) {
                await esperarVisible();
                interrumpido = false;
                await dormir(azar(ESPERA_MIN_MS, ESPERA_MAX_MS));

                if (Math.random() < CONTROL_PROB) {
                    const ahora = performance.now();
                    const r = await esperarRespuesta(ahora + VENTANA_DESDE_MS, ahora + VENTANA_HASTA_MS, false);
                    if (interrumpido) continue;
                    falsos.control++;
                    if (r != null) falsos.contestados++;
                    ensayos.push([oido, f, null, r != null, null]);
                    // Toco sin pitido: se le corrige ya y la frecuencia empieza de nuevo
                    if (r != null && correcciones < MAX_CORRECCIONES) {
                        correcciones++;
                        midiendo = false;
                        p.paso('No había pitido', `${SOLO_SI_OYES} Repetimos este tono.`, 'guia');
                        await p.decir('oidos-sin-tono');
                        u = crearUmbral({ inicio, piso: PISO_HL, techo: TECHO_HL });
                        fallosAltos = 0;
                        aResponder(oido);
                        midiendo = true;
                    }
                    continue;
                }

                if (salida.ctx.state !== 'running') {
                    midiendo = false;
                    await audioPausado(p, salida);
                    aResponder(oido);
                    midiendo = true;
                    continue;
                }
                const hl = u.siguiente();
                const t = salida.tono({ oido, frecuencia: f, dbfs: aDbfs(hl, f, perfil) });
                const r = await esperarRespuesta(t.inicio + VENTANA_DESDE_MS, t.inicio + VENTANA_HASTA_MS, true);
                if (interrumpido) { t.detener(); continue; }   // se fue de la pagina: ese ensayo no cuenta
                u.responder(r != null);
                ensayos.push([oido, f, hl, r != null, r != null ? Math.round(r - t.inicio) : null]);
                if (r != null) await dormir(TRAS_RESPUESTA_MS);

                // Oyo el tono de referencia (REFERENCIA_HL) en la revision de volumen: si ahora deja
                // de responder varios tonos asi de fuertes, lo mas probable es que no este atento
                fallosAltos = r == null && hl >= REFERENCIA_HL ? fallosAltos + 1 : 0;
                if (fallosAltos >= INACTIVO_FALLOS && !preguntado && pausas < MAX_PAUSAS) {
                    preguntado = true;
                    pausas++;
                    midiendo = false;
                    p.paso('¿Sigues ahí?', 'Toca el botón para continuar.', 'guia');
                    const sigo = p.opciones([{ valor: true, etiqueta: 'Sigo aquí', primario: true }]);
                    p.decir('oidos-sigues');
                    await sigo;
                    u = crearUmbral({ inicio, piso: PISO_HL, techo: TECHO_HL });
                    fallosAltos = 0;
                    aResponder(oido);
                    midiendo = true;
                }
            }

            const res = u.resultado();
            const medida = {
                hl: res.umbral,
                dbfs: res.umbral == null ? null : Math.round(aDbfs(res.umbral, f, perfil) * 10) / 10,
                estado: res.estado,
                ensayos: res.ensayos,
            };
            if (esRetest) retest = { primero: umbrales.od[1000]?.hl ?? null, segundo: medida.hl };
            else umbrales[oido][f] = medida;
            ultimo = res.umbral ?? (res.estado === 'sin-respuesta' ? TECHO_HL : null);
        }
    } finally {
        midiendo = false;
        p.tocarOrbe = null;
        document.removeEventListener('visibilitychange', alOcultar);
    }
    falsos.ensayos = ensayos.length;
    return { umbrales, falsos, ensayos, retest, correcciones, pausas, fotos };
}

// ------------------------------------------------------------------ resultados para el paciente
const VEREDICTOS = {
    pasa: ['Tu audición está dentro de lo esperado', 'ok'],
    remitir: ['Te recomendamos una valoración de tus oídos', 'alerta'],
    repetir: ['La prueba no fue concluyente', 'alerta'],
};

/**
 * Pinta el resultado bajo el resumen de la consulta (como pintarResultados de ojos.js): veredicto,
 * audiograma y el promedio de cada oido. El audiograma es un SVG armado con numeros nuestros.
 */
export function pintarResultadosOidos(contenedor, resultado) {
    contenedor.replaceChildren();
    contenedor.hidden = true;
    if (!resultado?.realizado || !resultado.resumen) return;
    const r = resultado.resumen;

    const titulo = document.createElement('h3');
    titulo.className = 'oi-res-titulo';
    titulo.textContent = 'Prueba de oídos';
    const [texto, clase] = VEREDICTOS[r.veredicto] || VEREDICTOS.repetir;
    const veredicto = document.createElement('p');
    veredicto.className = `oi-res-veredicto ${clase}`;
    veredicto.textContent = texto;

    const grafico = document.createElement('div');
    grafico.className = 'oi-res-audiograma';
    grafico.innerHTML = audiograma(resultado.umbrales, TECHO_HL);

    const leyenda = document.createElement('div');
    leyenda.className = 'oi-res-oidos';
    for (const [oido, nombre] of [['od', 'Derecho'], ['oi', 'Izquierdo']]) {
        const caja = document.createElement('div');
        caja.className = `oi-res-oido ${oido}`;
        const n = document.createElement('span');
        n.textContent = `${oido === 'od' ? '○' : '✕'} ${nombre}`;
        const v = document.createElement('strong');
        v.textContent = r.pta4[oido] == null ? '—' : `${Math.round(r.pta4[oido])} dB`;
        const g = document.createElement('small');
        g.textContent = r.grado[oido] ? `Audición ${r.grado[oido]}` : '';
        caja.append(n, v, g);
        leyenda.appendChild(caja);
    }

    const nota = document.createElement('p');
    nota.className = 'oi-res-nota';
    nota.textContent = 'Tamizaje con tus audífonos: no reemplaza una audiometría. El médico revisa el resultado.';

    contenedor.append(titulo, veredicto, grafico, leyenda, nota);
    contenedor.hidden = false;
}
