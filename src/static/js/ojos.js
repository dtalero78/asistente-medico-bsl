// Prueba de ojos antes de la consulta: tamizaje, fatiga y pupilas del Escaner Ocular
// (static/escaner-ocular), corridos en el celular del paciente y sin operador. Es una cascara
// propia porque la de escaner-ocular/app.js es de escritorio (selector de estudios, reporte en
// pantalla, impresion); los estudios se usan tal cual, sin tocarlos.
//
// Una voz (guia-voz.js) dice cada instruccion antes de que arranque el estudio: mirando la camara
// no se puede leer. Mientras suena la musica el paciente se queda quieto.
//
// Los resultados no se le muestran al paciente: salen como datos (`secciones`, el mismo formato
// que pinta el reporte del escaner) para la ficha del medico en BSL-PLATAFORMA2.
// La agudeza no esta: necesita tarjeta, un cordon de 1 m y un operador con teclado.
import { sampleOf, createMotionMeter, EAR_OPEN } from '../escaner-ocular/src/medidas.js';
import { crearEstimulo } from '../escaner-ocular/src/estimulo.js';
import { estudio as tamizaje } from '../escaner-ocular/src/estudios/tamizaje.js';
import { estudio as fatiga } from '../escaner-ocular/src/estudios/fatiga.js';
import { estudio as pupilas, PLAN as PLAN_PUPILAS } from '../escaner-ocular/src/estudios/pupilas.js';

// MediaPipe se importa dinamico: si el CDN falla, el avatar tiene que seguir cargando
const MEDIAPIPE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20';
const MODELO = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const AUTO_HOLD_MS = 2000;        // pose sostenida antes de tomar la foto
const MOTION_TOL = 0.06;          // movimiento max. por frame, en fraccion del iris (igual que app.js)
const BOTON_FOTO_MS = 20000;      // tras esto aparece "Tomar la foto" por si la pose nunca queda perfecta
const TAMIZAJE_MAX_MS = 90000;    // sin rostro en 90 s se sigue: el medico ve "no se completo"
const FOTO_OJO_ANCHO = 480;
const CORRECCION_TRAS_MS = 3000;  // un problema tiene que durar esto antes de decirlo en voz alta
const CORRECCION_CADA_MS = 7000;  // y no se repite una correccion antes de esto, para no regañar
// En la foto el paciente se esta acomodando y no puede leer la pantalla: se le habla mas seguido
const FOTO_CORRECCION_TRAS_MS = 1500;
const FOTO_CORRECCION_CADA_MS = 4000;
const PERFECTO_CADA_MS = 6000;    // "Así está perfecto" no se repite si la pose parpadea entre bien y mal
const MEJORA_MIN = 1.1;           // acercarse un 10 % desde la ultima correccion = "Eso, un poco más"

// Cuando arranca la primera fase del guion de pupilas que cumple `cumple`, en ms desde el inicio
function inicioEnPupilas(cumple) {
    let t = 0;
    for (const etapa of PLAN_PUPILAS) {
        if (cumple(etapa)) return t;
        t += etapa.dur;
    }
    throw new Error('Fase de pupilas no encontrada');
}

// `avisos`: lo que dice la voz durante el estudio, en ms desde que arranca. Los `clips` de un aviso
// suenan seguidos. En pupilas la narracion va solo en la adaptacion y tiene que terminar antes de
// cada ventana de medicion: escuchar con atencion dilata la pupila. Hoy: "luz" 4.5 s desde 0.5 s
// (mide a los 10 s); "rojo" + "destello" 13.7 s desde 13.2 s (mide a los 28 s). Si se alarga un
// clip o cambia PLAN en pupilas.js, revisar que siga cabiendo.
const PASOS = [
    {
        estudio: tamizaje,
        titulo: 'Foto de tus ojos',
        indicacion: 'Sostén el celular frente a tu cara, a un palmo, con buena luz de frente. Abre bien los ojos: la foto se toma sola.',
        voz: 'tamizaje',
        alTerminar: 'foto-lista',
        corrige: true,
    },
    {
        estudio: fatiga,
        titulo: 'Parpadeo',
        indicacion: 'Mientras suene la música, mira la cámara y parpadea normal. No hables ni muevas el celular.',
        voz: 'fatiga',
        musica: true,
        avisos: [                                          // TOTAL_MS de fatiga.js es 60 s
            { ms: 3000, clips: ['fatiga-que'] },
            { ms: 30000, clips: ['faltan-30'] },
            { ms: 48000, clips: ['fatiga-casi'] },
        ],
    },
    {
        estudio: pupilas,
        titulo: 'Pupilas',
        indicacion: 'La pantalla va a cambiar de color. Mientras suene la música, mira el punto del centro sin apartar la vista.',
        voz: 'pupilas',
        musica: true,
        alTerminar: 'pupilas-listo',
        avisos: [
            { ms: 500, clips: ['pupilas-luz'] },
            { ms: inicioEnPupilas((e) => e.fase === 'rojo') + 200, clips: ['pupilas-rojo', 'pupilas-destello'] },
        ],
    },
];

let modeloPromesa = null;

/** Empieza a bajar MediaPipe y el modelo (~10 MB) mientras el paciente lee la pantalla de inicio. */
export function precargarModelo() {
    if (!modeloPromesa) {
        modeloPromesa = crearLandmarker().catch((error) => {
            modeloPromesa = null;   // que el siguiente intento vuelva a bajarlo
            throw error;
        });
    }
    return modeloPromesa;
}

/** Libera el detector precargado si al final no hubo prueba (ya la hizo en la visiometría): sin esto
 *  quedaba vivo durante la videollamada, y los dos juntos ahogan un celular de gama baja. */
export function liberarModelo() {
    const promesa = modeloPromesa;
    modeloPromesa = null;
    promesa?.then((l) => l.close?.()).catch(() => {});
}

async function crearLandmarker() {
    const { FaceLandmarker, FilesetResolver } = await import(MEDIAPIPE);
    const resolver = await FilesetResolver.forVisionTasks(`${MEDIAPIPE}/wasm`);
    const opciones = (delegate) => ({
        baseOptions: { modelAssetPath: MODELO, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
    });
    // Algunos celulares no tienen WebGL utilizable: en CPU va mas lento pero mide igual
    try {
        return await FaceLandmarker.createFromOptions(resolver, opciones('GPU'));
    } catch (error) {
        console.warn('[ojos] Sin GPU, uso CPU:', error.message);
        return FaceLandmarker.createFromOptions(resolver, opciones('CPU'));
    }
}

/**
 * Corre los tres estudios en secuencia. Nunca rechaza salvo que el paciente niegue la camara
 * (error con name 'NotAllowedError'): la prueba es obligatoria y eso lo resuelve el paciente.
 * Cualquier otra falla (sin camara, sin modelo) devuelve { realizado: false, motivo } para que la
 * consulta siga y el medico vea por que no hay prueba.
 *
 * @param {object} ui  { video, overlay, titulo, paso, indicacion, estado, botonFoto, guia? }
 * @returns {Promise<{realizado, motivo?, fecha, camara, duracion_s, secciones, fotos}>}
 */
export async function examenOjos(ui) {
    const inicio = Date.now();
    const guia = ui.guia || GUIA_MUDA;
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
            audio: false,
        });
    } catch (error) {
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') throw error;
        return { realizado: false, motivo: `No se pudo abrir la cámara (${error.name}).` };
    }

    let landmarker;
    let camara = '?';
    try {
        ui.estado.textContent = 'Preparando la prueba…';
        ui.video.srcObject = stream;
        await ui.video.play();
        camara = `${ui.video.videoWidth}x${ui.video.videoHeight}`;
        await guia.decir('intro');
        landmarker = await precargarModelo();
    } catch (error) {
        stream.getTracks().forEach((t) => t.stop());
        console.error('[ojos] Sin modelo:', error);
        return { realizado: false, motivo: 'No se pudo cargar el detector de rostro en este celular.' };
    }

    const secciones = [];
    const fotos = [];
    const crudos = {};   // resultado de cada estudio sin pintar, para los indicadores
    try {
        for (let i = 0; i < PASOS.length; i++) {
            const paso = PASOS[i];
            ui.paso.textContent = `Prueba de ojos · ${i + 1} de ${PASOS.length}`;
            ui.titulo.textContent = paso.titulo;
            ui.indicacion.textContent = paso.indicacion;
            ui.estado.textContent = 'Escucha la instrucción…';
            await guia.decir(paso.voz);
            const res = await correrEstudio(paso, landmarker, ui, guia);
            crudos[paso.estudio.id] = res;
            if (res != null && paso.alTerminar) await guia.decir(paso.alTerminar);
            if (res == null) {
                secciones.push({ title: paso.estudio.nombre, note: 'No se completó: no se detectó el rostro del paciente.' });
                continue;
            }
            const seccion = paso.estudio.render(res);
            for (const m of seccion.media || []) {
                fotos.push({ momento: `ojo-${m.downloadName.includes('OD') ? 'od' : 'oi'}`, imagen: aJpeg(m.canvas) });
            }
            secciones.push(limpiarSeccion(seccion));
        }
    } catch (error) {
        // Un error a mitad de la prueba no puede dejar al paciente sin consulta
        console.error('[ojos] Error durante la prueba:', error);
        return { realizado: false, motivo: `La prueba falló a mitad de camino (${error.message}).` };
    } finally {
        guia.apagar();
        stream.getTracks().forEach((t) => t.stop());
        ui.video.srcObject = null;
        // Libera la GPU antes de que entre LiveKit: los dos juntos ahogan un celular de gama baja
        landmarker.close?.();
        modeloPromesa = null;
    }

    return {
        realizado: true,
        fecha: new Date().toISOString(),
        camara,
        duracion_s: Math.round((Date.now() - inicio) / 1000),
        secciones,
        fotos,
        indicadores: indicadoresDe(crudos),
    };
}

/**
 * Arma la pantalla de la prueba (camara, instrucciones, botones) dentro de `contenedor`, con su
 * propio estilo, para paginas que no son el avatar: la visiometria virtual de BSL-PLATAFORMA2 carga
 * este modulo desde el dominio del asistente. Ocupa toda la pantalla, oscura como el avatar.
 * @returns el objeto `ui` que pide examenOjos, mas `inicio` (boton), `reintentar` y `quitar()`
 */
export function montarPruebaOjos(contenedor) {
    if (!document.getElementById('bsl-ojos-estilos')) {
        const estilo = document.createElement('style');
        estilo.id = 'bsl-ojos-estilos';
        estilo.textContent = ESTILOS_MONTADA;
        document.head.append(estilo);
    }
    const raiz = document.createElement('section');
    raiz.className = 'bsl-ojos';
    raiz.setAttribute('aria-label', 'Prueba de ojos');
    raiz.innerHTML = `
        <div class="bsl-ojos-escena"><video playsinline muted></video><canvas></canvas></div>
        <div class="bsl-ojos-panel">
            <p class="bsl-ojos-paso">Prueba de ojos</p>
            <h2></h2>
            <p class="bsl-ojos-indicacion"></p>
            <div class="bsl-ojos-estado" role="status" aria-live="polite"></div>
            <button type="button" class="bsl-ojos-boton" data-rol="inicio" hidden>Empezar</button>
            <button type="button" class="bsl-ojos-boton" data-rol="foto" hidden>Tomar la foto</button>
            <button type="button" class="bsl-ojos-boton" data-rol="reintentar" hidden>Ya activé la cámara</button>
        </div>`;
    contenedor.append(raiz);
    const $ = (sel) => raiz.querySelector(sel);
    return {
        video: $('video'),
        overlay: $('canvas'),
        paso: $('.bsl-ojos-paso'),
        titulo: $('h2'),
        indicacion: $('.bsl-ojos-indicacion'),
        estado: $('.bsl-ojos-estado'),
        botonFoto: $('[data-rol="foto"]'),
        inicio: $('[data-rol="inicio"]'),
        reintentar: $('[data-rol="reintentar"]'),
        quitar: () => raiz.remove(),
    };
}

// Lo mismo que avatar.css le da a la prueba en el avatar (.vc-ojos y .estimulo), para montarPruebaOjos
const ESTILOS_MONTADA = `
.bsl-ojos { position: fixed; inset: 0; z-index: 9000; display: flex; flex-direction: column;
    background: #131417; color: #fff; font-family: system-ui, -apple-system, sans-serif; }
.bsl-ojos-escena { position: relative; flex: 1; min-height: 0; overflow: hidden; background: #1c1e24; }
.bsl-ojos-escena video, .bsl-ojos-escena canvas { position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: cover; transform: scaleX(-1); }
.bsl-ojos-panel { flex: none; padding: 16px 16px max(20px, env(safe-area-inset-bottom)); display: flex;
    flex-direction: column; align-items: center; gap: 8px; text-align: center; }
.bsl-ojos-paso { margin: 0; font-size: 0.8rem; color: rgba(255,255,255,.6); }
.bsl-ojos h2 { margin: 0; font-size: 1.2rem; font-weight: 500; }
.bsl-ojos-indicacion { margin: 0; font-size: 0.92rem; line-height: 1.45; color: rgba(255,255,255,.78); max-width: 440px; }
.bsl-ojos-estado { background: rgba(255,255,255,.08); padding: 8px 16px; border-radius: 18px; font-size: 0.92rem; }
.bsl-ojos-estado:empty { display: none; }
.bsl-ojos-boton { width: min(100%, 300px); min-height: 48px; padding: 12px 24px; border: none; border-radius: 8px;
    background: #0b5cff; color: #fff; font: inherit; font-size: 1rem; font-weight: 500; cursor: pointer; }
.bsl-ojos-boton[hidden] { display: none; }
.bsl-ojos-boton:disabled { background: #3a3f4b; color: rgba(255,255,255,.6); }
.estimulo { position: fixed; inset: 0; z-index: 9100; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 24px; }
.estimulo[hidden] { display: none; }
.estimulo-fijacion { width: 10px; height: 10px; border-radius: 50%; }
.estimulo-texto { margin: 0; font-size: 14px; letter-spacing: .3px; }
`;

/**
 * Pinta los resultados de la prueba de ojos bajo el resumen de la consulta: fotos de cada ojo y
 * las tablas de los tres estudios, en renglones porque la tarjeta es angosta (cabe en un celular).
 * Todo con textContent: las secciones son texto armado por los estudios.
 */
export function pintarResultados(contenedor, resultado) {
    contenedor.replaceChildren();
    contenedor.hidden = true;
    if (!resultado || !resultado.realizado || !(resultado.secciones || []).length) return;

    const el = (tag, clase, texto) => {
        const n = document.createElement(tag);
        if (clase) n.className = clase;
        if (texto != null) n.textContent = texto;
        return n;
    };

    contenedor.append(el('h3', 'vc-ojos-titulo', 'Resultados de tu prueba de ojos'));

    if ((resultado.fotos || []).length) {
        const fotos = el('div', 'vc-ojos-fotos');
        for (const f of resultado.fotos) {
            const fig = el('figure');
            const img = el('img');
            img.src = f.imagen;
            img.alt = f.momento === 'ojo-od' ? 'Foto de tu ojo derecho' : 'Foto de tu ojo izquierdo';
            fig.append(img, el('figcaption', null, f.momento === 'ojo-od' ? 'Ojo derecho (OD)' : 'Ojo izquierdo (OI)'));
            fotos.append(fig);
        }
        contenedor.append(fotos);
    }

    for (const s of resultado.secciones) {
        const bloque = el('div', 'vc-ojos-estudio');
        bloque.append(el('h4', null, s.title));
        for (const r of s.rows || []) {
            const fila = el('div', 'vc-ojos-fila');
            const nombre = el('div', 'vc-ojos-medida');
            nombre.append(el('span', null, r.label));
            if (r.exp) nombre.append(el('span', 'vc-ojos-exp', ' (experimental)'));
            if (r.reading) nombre.append(el('small', null, r.reading));
            const valor = r.od !== undefined || r.oi !== undefined
                ? `OD ${r.od ?? '—'} · OI ${r.oi ?? '—'}` : (r.value ?? '—');
            fila.append(nombre, el('div', 'vc-ojos-valor', valor));
            bloque.append(fila);
        }
        for (const [tipo, msg] of s.flags || []) {
            bloque.append(el('p', `vc-ojos-bandera ${tipo === 'ok' ? 'ok' : 'alerta'}`, `${tipo === 'ok' ? '✓' : '⚠'} ${msg}`));
        }
        contenedor.append(bloque);
    }
    contenedor.hidden = false;
}

// Las cifras con las que el asistente arma la recomendación visual del WhatsApp
// (ai.hallazgo_visual). Solo las confiables: nada de pupilas, que son experimentales y con iris
// oscuros dan diferencias entre ojos que no existen.
export function indicadoresDe({ tamizaje: t, fatiga: f }) {
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const rojos = t && t.eyes ? [t.eyes.OD.redness, t.eyes.OI.redness].map(num).filter((v) => v != null) : [];
    const fatiga = f && f.medible ? f : null;
    return {
        parpadeos_min: fatiga ? num(fatiga.parpadeosPorMin) : null,
        pct_incompletos: fatiga ? num(fatiga.pctIncompletos) : null,
        cierres_largos: fatiga ? num(fatiga.cierresLargos) : null,
        perclos: fatiga ? num(fatiga.perclos) : null,
        enrojecimiento_max: rojos.length ? Math.max(...rojos) : null,
    };
}

// Lo mismo que hace siguienteEstudio() + loop() + compuertaDePose() en escaner-ocular/app.js,
// para un solo estudio. `finish` se ata a cada arranque con un token, como alla: un temporizador
// rezagado no puede cerrar el arranque siguiente.
function correrEstudio(paso, landmarker, ui, guia) {
    const estudio = paso.estudio;
    return new Promise((resolve) => {
        const W = () => ui.video.videoWidth, H = () => ui.video.videoHeight;
        const captureCanvas = document.createElement('canvas');
        const cctx = captureCanvas.getContext('2d', { willReadFrequently: true });
        const octx = ui.overlay.getContext('2d');
        const estimulo = crearEstimulo();
        const motion = createMotionMeter();
        const setStatus = (msg) => { ui.estado.textContent = msg; };
        const ctxBase = { video: ui.video, overlay: ui.overlay, octx, captureCanvas, cctx, estimulo, setStatus, setHint() {}, setBadges() {} };

        let ctx = ctxBase;
        let token = 0;
        let corriendo = false;
        let ultimoTiempo = -1;
        let arranque = 0;
        let readySince = 0;
        let ultimaMuestra = null;
        let avisosDichos = new Set();
        let problema = null, problemaDesde = 0, ultimaCorreccion = 0;
        let tamanoAlCorregir = 0, ultimoPerfecto = 0, avisoBoton = false;

        function arrancar() {
            const mio = ++token;
            ctx = Object.assign(Object.create(ctxBase), { finish: () => { if (mio === token) terminar(); } });
            corriendo = true;
            arranque = performance.now();
            readySince = 0;
            motion.reset();
            ui.botonFoto.hidden = true;
            avisosDichos = new Set();
            problema = null;
            avisoBoton = false;
            if (paso.musica) guia.musicaOn();
            estudio.iniciar(ctx);
            requestAnimationFrame(bucle);
        }

        function terminar(res = estudio.terminar(ctx)) {
            token++;
            corriendo = false;
            estimulo.apagar();
            guia.apagar();
            octx.clearRect(0, 0, ui.overlay.width, ui.overlay.height);
            ui.botonFoto.hidden = true;
            ui.botonFoto.onclick = null;
            document.removeEventListener('visibilitychange', alCambiarVisibilidad);
            resolve(res);
        }

        // Si el paciente sale a otra app, la medida de ese estudio ya no vale (el bucle se detiene
        // y la luz de la pantalla deja de llegarle): al volver se repite el estudio desde cero.
        function alCambiarVisibilidad() {
            if (document.visibilityState === 'hidden') {
                token++;
                corriendo = false;
                estimulo.apagar();
                guia.apagar();
            } else if (!corriendo) {
                arrancar();
            }
        }
        document.addEventListener('visibilitychange', alCambiarVisibilidad);

        ui.botonFoto.onclick = () => { if (ultimaMuestra) dispararPose(); };

        function dispararPose() {
            readySince = 0;
            if (captureCanvas.width !== W()) { captureCanvas.width = W(); captureCanvas.height = H(); }
            estudio.onPose(ctx, ultimaMuestra);
        }

        function bucle() {
            if (!corriendo) return;
            const v = ui.video;
            if (v.readyState >= 2 && v.currentTime !== ultimoTiempo) {
                ultimoTiempo = v.currentTime;
                if (ui.overlay.width !== W()) { ui.overlay.width = W(); ui.overlay.height = H(); }
                if (captureCanvas.width !== W()) { captureCanvas.width = W(); captureCanvas.height = H(); }
                const r = landmarker.detectForVideo(v, performance.now());
                const lm = r.faceLandmarks && r.faceLandmarks[0] ? r.faceLandmarks[0] : null;
                ultimaMuestra = lm ? sampleOf(lm, W(), H(), performance.now()) : null;
                alFrame(ultimaMuestra);
            }
            if (corriendo) requestAnimationFrame(bucle);
        }

        function alFrame(s) {
            octx.clearRect(0, 0, ui.overlay.width, ui.overlay.height);
            const transcurrido = performance.now() - arranque;
            // Antes que nada: corregir() lee s.steady, y si se calcula despues toda pose buena sale "movida"
            if (s) s.steady = motion.measure(s) <= MOTION_TOL;

            (paso.avisos || []).forEach((aviso, i) => {
                if (transcurrido >= aviso.ms && !avisosDichos.has(i)) {
                    avisosDichos.add(i);
                    decirSeguidos(aviso.clips);
                }
            });
            corregir(s, transcurrido);

            if (estudio.requiere.pose) {
                if (transcurrido > TAMIZAJE_MAX_MS) { terminar(null); return; }
                ui.botonFoto.hidden = transcurrido < BOTON_FOTO_MS;
                ui.botonFoto.disabled = !s;
                if (!avisoBoton && transcurrido >= BOTON_FOTO_MS && !guia.hablando) {
                    avisoBoton = true;
                    guia.decir('boton-foto');
                }
            }

            if (!s) {
                motion.reset();
                readySince = 0;
                setStatus('No vemos tu cara: ponla frente a la cámara.');
                if (!estudio.requiere.pose) estudio.porFrame?.(ctx, null);
                return;
            }

            dibujarIris(octx, s);

            if (!estudio.requiere.pose) {
                estudio.porFrame?.(ctx, s);
                return;
            }

            const q = s.quality;
            const ahora = performance.now();
            if (q.ready && s.steady) {
                if (!readySince) {
                    readySince = ahora;
                    // Que sepa que ya esta bien: si no, sigue moviendose buscando la posicion
                    if (ahora - ultimoPerfecto >= PERFECTO_CADA_MS) {
                        ultimoPerfecto = ahora;
                        guia.decir('perfecto');
                    }
                }
            } else {
                readySince = 0;
            }
            if (!q.eyesOpen) setStatus('Abre bien los ojos.');
            else if (!q.closeEnough) setStatus('Acerca un poco el celular.');
            else if (!q.notTooClose) setStatus('Aleja un poco el celular.');
            else if (!s.steady) setStatus('Quédate quieto…');
            else setStatus('No te muevas… tomando la foto.');

            // Espera tambien a que termine "Así está perfecto": que no lo corte "ya tenemos la foto"
            if (readySince && ahora - readySince >= AUTO_HOLD_MS && !guia.hablando) dispararPose();
        }

        // Si el estudio se corta (salio a otra app, termino), los clips que faltaban ya no suenan
        async function decirSeguidos(clips) {
            const mio = token;
            for (const clip of clips) {
                if (mio !== token) return;
                await guia.decir(clip);
            }
        }

        // Correcciones en voz alta cuando un problema se sostiene: en la foto, cualquier aviso de
        // pose; en los estudios con musica, solo que no se ve la cara (un parpadeo no es problema).
        function corregir(s, transcurrido) {
            let ahora = null;
            if (!s) ahora = 'no-te-veo';
            else if (paso.corrige) {
                const q = s.quality;
                ahora = !q.eyesOpen ? 'abre-ojos' : !q.closeEnough ? 'acercate'
                    : !q.notTooClose ? 'alejate' : !s.steady ? 'quieto' : null;
            }
            const tras = paso.corrige ? FOTO_CORRECCION_TRAS_MS : CORRECCION_TRAS_MS;
            const cada = paso.corrige ? FOTO_CORRECCION_CADA_MS : CORRECCION_CADA_MS;
            const t = performance.now();
            if (ahora !== problema) { problema = ahora; problemaDesde = t; tamanoAlCorregir = 0; return; }
            if (!problema || guia.hablando || transcurrido < tras) return;
            if (t - problemaDesde >= tras && t - ultimaCorreccion >= cada) {
                ultimaCorreccion = t;
                // Si ya se viene acercando, animarlo en vez de repetirle lo mismo
                const mejora = problema === 'acercate' && tamanoAlCorregir && s.sizeFrac >= tamanoAlCorregir * MEJORA_MIN;
                tamanoAlCorregir = s ? s.sizeFrac : 0;
                guia.decir(mejora ? 'un-poco-mas' : problema);
            }
        }

        arrancar();
    });
}

// Sin guia (el banco de pruebas, o si se llama sin ella): la prueba corre igual, en silencio
const GUIA_MUDA = {
    decir: () => Promise.resolve(), apagar() {}, musicaOn() {}, musicaOff() {}, hablando: false,
};

function dibujarIris(octx, s) {
    for (const key of ['OD', 'OI']) {
        const iris = s.iris[key];
        octx.strokeStyle = s.ear[key] >= EAR_OPEN ? '#35b36b' : '#d29922';
        octx.lineWidth = Math.max(2, s.W / 400);
        octx.beginPath();
        octx.arc(iris.center.x, iris.center.y, iris.diameter / 2, 0, Math.PI * 2);
        octx.stroke();
    }
}

// La seccion que devuelve render() trae nodos del DOM (canvas de los ojos, minigraficas): para el
// medico solo viajan el texto y las cifras, que es lo que la ficha pinta.
export function limpiarSeccion(s) {
    const texto = (v) => (v == null ? undefined : String(v));
    return {
        title: texto(s.title),
        note: texto(s.note),
        rows: (s.rows || []).map((r) => ({
            label: texto(r.label), od: texto(r.od), oi: texto(r.oi), value: texto(r.value),
            reading: texto(r.reading), exp: Boolean(r.exp),
        })),
        flags: (s.flags || []).map(([tipo, msg]) => [tipo === 'ok' ? 'ok' : 'warn', String(msg)]),
    };
}

function aJpeg(canvas) {
    const escala = Math.min(1, FOTO_OJO_ANCHO / canvas.width);
    const c = document.createElement('canvas');
    c.width = Math.round(canvas.width * escala);
    c.height = Math.round(canvas.height * escala);
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
}
