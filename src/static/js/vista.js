// Prueba visual guiada (reemplaza las láminas de visiometria-virtual.html de BSL-PLATAFORMA2):
// preguntas, distancia con la cámara, agudeza de cerca con la E por cada ojo, reloj de
// astigmatismo por ojo y láminas de colores. Misma experiencia que la prueba de ojos (ojos.js):
// pantalla oscura, voz de Alirio (guia-voz.js) y la cámara controlando la prueba.
// Algoritmos sin DOM en static/prueba-vista/src (con su CLAUDE.md y sus pruebas).
//
// Se carga desde el dominio del asistente (como ojos.js): nada de rutas absolutas '/static/...'.
import { sampleOf, EAR_OPEN } from '../escaner-ocular/src/medidas.js';
import { precargarModelo, liberarModelo } from './ojos.js';
import {
    distanciaMm, estadoDistancia, escalaSinCalibrar, niveles, crearEscalera, rectangulosE, distanciaDePrueba,
} from '../prueba-vista/src/agudeza.js';
import { LAMINAS, NINGUNO, puntosDeLamina, evaluarColores } from '../prueba-vista/src/colores.js';
import { concepto, DESTAPES_MAX } from '../prueba-vista/src/resultado.js';

export const VERSION = 'vista-2';

const DISTANCIA_SOSTENIDA_MS = 1500;   // en la distancia correcta este tiempo antes de seguir
const CORREGIR_CADA_MS = 4000;         // "acércate / aléjate" no más seguido que esto
const OCLUSION_AVISO_MS = 5000;        // sin el otro ojo tapado este tiempo → la voz lo recuerda
const OCLUSION_RENUNCIA_MS = 20000;    // …y después de esto sigue igual, marcado "no verificada"
const EAR_TAPADO = 0.15;               // el ojo tapado (o cerrado) baja de aquí
const DISTANCIA_RENUNCIA_MS = 30000;   // sin lograr la distancia (o sin cara) este tiempo → sigue igual,
                                       // marcado: con la mano tapando un ojo la cámara puede perder la cara
const DESTAPADO_ESPERA_MS = 8000;      // antes de cada E, si destapó el otro ojo, se espera esto a que lo tape
const TECLA_PAUSA_MS = 200;            // teclas ignoradas al aparecer cada pregunta (y las repetidas):
                                       // una flecha mantenida contestaba también la E siguiente

// Sin guía (llamada sin ella): la prueba corre igual, en silencio
const GUIA_MUDA = { decir: () => Promise.resolve(), apagar() {}, musicaOn() {}, musicaOff() {}, hablando: false };
const CARD_MM = 85.6;                  // cédula / tarjeta bancaria (ISO 7810 ID-1)

const FLECHAS = { arriba: '↑', derecha: '→', abajo: '↓', izquierda: '←' };

// ------------------------------------------------------------------ pantalla
export function montarVista(contenedor) {
    if (!document.getElementById('bsl-vista-estilos')) {
        const estilo = document.createElement('style');
        estilo.id = 'bsl-vista-estilos';
        estilo.textContent = ESTILOS;
        document.head.append(estilo);
    }
    const raiz = document.createElement('section');
    raiz.className = 'bsl-vista';
    raiz.setAttribute('aria-label', 'Prueba visual');
    raiz.innerHTML = `
        <header class="bsl-vista-cabeza">
            <div class="bsl-vista-camara"><video playsinline muted></video></div>
            <div>
                <p class="bsl-vista-paso">Prueba visual</p>
                <div class="bsl-vista-estado" role="status" aria-live="polite"></div>
            </div>
        </header>
        <div class="bsl-vista-escena">
            <h2></h2>
            <p class="bsl-vista-indicacion"></p>
            <div class="bsl-vista-lienzo"></div>
        </div>
        <div class="bsl-vista-botones"></div>`;
    contenedor.append(raiz);
    const $ = (s) => raiz.querySelector(s);
    return {
        raiz, video: $('video'), paso: $('.bsl-vista-paso'), estado: $('.bsl-vista-estado'),
        titulo: $('h2'), indicacion: $('.bsl-vista-indicacion'), lienzo: $('.bsl-vista-lienzo'),
        botones: $('.bsl-vista-botones'), quitar: () => raiz.remove(),
    };
}

// Botones de respuesta. Devuelve una promesa con el valor tocado. `tecla` permite contestar con el
// teclado (en computador se contesta con las flechas, como en la agudeza del escáner).
function opciones(ui, lista, clase = '') {
    ui.botones.className = `bsl-vista-botones ${clase}`;
    ui.botones.replaceChildren();
    return new Promise((resolve) => {
        let listo = false;
        const elegir = (valor) => {
            if (listo) return;
            listo = true;
            window.removeEventListener('keydown', alTeclear);
            ui.botones.replaceChildren();
            resolve(valor);
        };
        const desde = performance.now();
        const alTeclear = (ev) => {
            const o = lista.find((x) => x.tecla === ev.key);
            if (!o) return;
            ev.preventDefault();
            if (ev.repeat || performance.now() - desde < TECLA_PAUSA_MS) return;
            elegir(o.valor);
        };
        if (lista.some((o) => o.tecla)) window.addEventListener('keydown', alTeclear);
        for (const o of lista) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = `bsl-vista-boton${o.secundario ? ' secundario' : ''}${o.clase ? ` ${o.clase}` : ''}`;
            b.textContent = o.etiqueta;
            if (o.aria) b.setAttribute('aria-label', o.aria);
            b.addEventListener('click', () => elegir(o.valor), { once: true });
            ui.botones.append(b);
        }
    });
}

function pantalla(ui, paso, titulo, indicacion = '') {
    ui.estado.textContent = '';
    ui.paso.textContent = paso;
    ui.titulo.textContent = titulo;
    ui.indicacion.textContent = indicacion;
    ui.lienzo.replaceChildren();
    ui.botones.replaceChildren();
}

// ------------------------------------------------------------------ cámara y detección
function crearSeguimiento(video, landmarker) {
    let corriendo = true, ultimoTiempo = -1;
    const estado = { cara: false, distancia: null, ear: { OD: null, OI: null }, distancias: [], errores: 0 };
    function bucle() {
        if (!corriendo) return;
        // Si el detector falla (GPU perdida, cerrado en otra parte) no puede morir en silencio: antes la
        // excepción cortaba el bucle y el estado quedaba congelado (con cara y distancia "buenas", o sin
        // cara para siempre). Se marca sin cara y el siguiente cuadro lo vuelve a intentar.
        try { cuadro(); } catch (error) {
            estado.errores++;
            estado.cara = false;
            if (estado.errores === 1) console.error('[vista] El detector falló:', error);
        }
        requestAnimationFrame(bucle);
    }
    function cuadro() {
        if (video.readyState >= 2 && video.currentTime !== ultimoTiempo) {
            ultimoTiempo = video.currentTime;
            const W = video.videoWidth, H = video.videoHeight;
            const r = landmarker.detectForVideo(video, performance.now());
            const lm = r.faceLandmarks && r.faceLandmarks[0];
            if (lm) {
                const s = sampleOf(lm, W, H, performance.now());
                // El iris del ojo abierto: el tapado puede salir deformado
                const iris = s.ear.OD >= s.ear.OI ? s.iris.OD.diameter : s.iris.OI.diameter;
                estado.cara = true;
                estado.distancia = distanciaMm(iris, W, H);
                estado.ear = s.ear;
                if (estado.distancia) estado.distancias.push(estado.distancia);
            } else {
                estado.cara = false;
            }
        }
    }
    requestAnimationFrame(bucle);
    return { estado, parar() { corriendo = false; } };
}

// Espera a estar a la distancia de la prueba de forma sostenida; mientras tanto la voz corrige.
// @returns true si la logró; false si se rindió (DISTANCIA_RENUNCIA_MS): la prueba sigue igual y el
// resultado lo marca, en vez de quedarse para siempre diciendo "no veo tu cara".
async function esperarDistancia(ui, seg, guia) {
    let desde = 0, ultimaCorreccion = 0;
    const inicio = performance.now();
    for (;;) {
        await esperar(150);
        const e = seg.estado, ahora = performance.now();
        if (ahora - inicio > DISTANCIA_RENUNCIA_MS) return false;
        const lectura = !e.cara ? null : estadoDistancia(e.distancia, seg.objetivo);
        ui.estado.textContent = !e.cara ? 'No vemos tu cara' : lectura === 'bien' ? 'Distancia correcta'
            : lectura === 'cerca' ? 'Aléjate un poco' : 'Acércate un poco';
        if (lectura === 'bien') {
            if (!desde) desde = ahora;
            if (ahora - desde >= DISTANCIA_SOSTENIDA_MS) return true;
        } else {
            desde = 0;
            if (!guia.hablando && ahora - ultimaCorreccion > CORREGIR_CADA_MS) {
                ultimaCorreccion = ahora;
                guia.decir(!e.cara ? 'no-te-veo' : lectura === 'cerca' ? 'alejate' : 'acercate');
            }
        }
    }
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ dibujo
function dibujarE(ui, trazo, direccion) {
    const dpr = window.devicePixelRatio || 1;
    const c = document.createElement('canvas');
    c.width = c.height = trazo * 5;
    c.style.width = c.style.height = `${(trazo * 5) / dpr}px`;
    c.className = 'bsl-vista-e';
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#000';
    for (const [x, y, w, h] of rectangulosE(direccion)) g.fillRect(x * trazo, y * trazo, w * trazo, h * trazo);
    const marco = document.createElement('div');
    marco.className = 'bsl-vista-marco';
    marco.append(c);
    ui.lienzo.replaceChildren(marco);
}

// Que cada trazo caiga en px enteros de dispositivo: con densidades fraccionarias (2,625x) el
// centrado deja el canvas entre píxeles y un trazo de 2 px se pinta como 1 y 3. Se llama con los
// botones YA puestos (si no, al aparecer mueven la E medio píxel) y otra vez si cambia la pantalla.
function alinearE() {
    const c = document.querySelector('.bsl-vista-e');
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.style.transform = '';
    const r = c.getBoundingClientRect();
    const dx = (Math.round(r.left * dpr) - r.left * dpr) / dpr, dy = (Math.round(r.top * dpr) - r.top * dpr) / dpr;
    if (dx || dy) c.style.transform = `translate(${dx}px, ${dy}px)`;
}

// Reloj de astigmatismo: 12 radios de 3 líneas finas, iguales; con astigmatismo algunos se ven
// más oscuros o nítidos que otros.
function dibujarReloj(ui) {
    const dpr = window.devicePixelRatio || 1;
    const lado = Math.min(ui.lienzo.clientWidth || 300, 300);
    const c = document.createElement('canvas');
    c.width = c.height = Math.round(lado * dpr);
    c.style.width = c.style.height = `${lado}px`;
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.fillStyle = '#fff';
    g.fillRect(0, 0, lado, lado);
    const cx = lado / 2, r1 = lado * 0.12, r2 = lado * 0.47;
    g.strokeStyle = '#000';
    // Líneas gruesas: con 1,6 px el suavizado pintaba las diagonales más claras que las horizontales
    // y verticales, y alguien sin astigmatismo podía ver "algunas más oscuras"
    g.lineWidth = 3;
    g.lineCap = 'butt';
    for (let k = 0; k < 12; k++) {
        const a = (k * Math.PI) / 6;
        for (const dx of [-6, 0, 6]) {
            const nx = -Math.sin(a) * dx, ny = Math.cos(a) * dx;
            g.beginPath();
            g.moveTo(cx + Math.cos(a) * r1 + nx, cx + Math.sin(a) * r1 + ny);
            g.lineTo(cx + Math.cos(a) * r2 + nx, cx + Math.sin(a) * r2 + ny);
            g.stroke();
        }
    }
    g.fillStyle = '#000';
    g.beginPath();
    g.arc(cx, cx, 4, 0, Math.PI * 2);
    g.fill();
    ui.lienzo.replaceChildren(c);
}

// El número de la lámina se dibuja en un canvas aparte y se usa como máscara de los puntos
function dibujarLamina(ui, lamina, semilla) {
    const dpr = window.devicePixelRatio || 1;
    const lado = Math.min(ui.lienzo.clientWidth || 300, 320);
    const m = document.createElement('canvas');
    m.width = m.height = 200;
    const mg = m.getContext('2d');
    mg.fillStyle = '#000';
    mg.font = `bold ${String(lamina.numero).length > 1 ? 120 : 150}px Arial, sans-serif`;
    mg.textAlign = 'center';
    mg.textBaseline = 'middle';
    mg.fillText(String(lamina.numero), 100, 108);
    const datos = mg.getImageData(0, 0, 200, 200).data;
    const enFigura = (x, y) => {
        const px = Math.round((x + 1) * 100), py = Math.round((y + 1) * 100);
        return px >= 0 && py >= 0 && px < 200 && py < 200 && datos[(py * 200 + px) * 4 + 3] > 128;
    };
    const c = document.createElement('canvas');
    c.width = c.height = Math.round(lado * dpr);
    c.style.width = c.style.height = `${lado}px`;
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    const R = lado / 2;
    for (const p of puntosDeLamina(lamina, enFigura, semilla)) {
        g.fillStyle = `rgb(${p.color.map((v) => Math.round(v * 255)).join(',')})`;
        g.beginPath();
        g.arc(R + p.x * R, R + p.y * R, p.r * R, 0, Math.PI * 2);
        g.fill();
    }
    ui.lienzo.replaceChildren(c);
}

// ------------------------------------------------------------------ calibración (solo computador)
function calibrarConTarjeta(ui, guia) {
    pantalla(ui, 'Prueba visual', 'Tamaño de tu pantalla',
        'Pon una tarjeta (cédula o tarjeta bancaria) sobre la pantalla y mueve la barra hasta que el rectángulo tenga su mismo ancho.');
    guia.decir('vista-tarjeta');
    const caja = document.createElement('div');
    caja.className = 'bsl-vista-tarjeta-caja';
    const tarjeta = document.createElement('div');
    tarjeta.className = 'bsl-vista-tarjeta';
    const rango = document.createElement('input');
    rango.type = 'range'; rango.min = '150'; rango.max = '900'; rango.value = String(Math.round(CARD_MM * 3.78));
    const pintar = () => { tarjeta.style.width = `${rango.value}px`; tarjeta.style.height = `${rango.value * 53.98 / CARD_MM}px`; };
    rango.addEventListener('input', pintar);
    pintar();
    caja.append(tarjeta, rango);
    ui.lienzo.replaceChildren(caja);
    return opciones(ui, [{ etiqueta: 'Listo', valor: true }]).then(() => Number(rango.value) / CARD_MM);
}

// ------------------------------------------------------------------ un ojo
async function medirOjo(ui, seg, guia, ojo, lista) {
    const tapado = ojo === 'OD' ? 'OI' : 'OD';
    const nombre = ojo === 'OD' ? 'derecho' : 'izquierdo';
    pantalla(ui, `Ojo ${nombre}`, `Tápate el ojo ${tapado === 'OI' ? 'izquierdo' : 'derecho'}`,
        'Con la palma de la mano, sin apretarlo. El otro ojo queda abierto.');
    await guia.decir(ojo === 'OD' ? 'vista-tapa-izquierdo' : 'vista-tapa-derecho');

    // Que de verdad esté tapado: el ojo tapado se ve cerrado y el que se mide, abierto
    let oclusionVerificada = false;
    const inicio = performance.now();
    let avisado = 0;
    for (;;) {
        const e = seg.estado;
        const bien = e.cara && e.ear[tapado] != null && e.ear[tapado] < EAR_TAPADO && e.ear[ojo] >= EAR_OPEN;
        if (bien) { oclusionVerificada = true; break; }
        const t = performance.now() - inicio;
        if (t > OCLUSION_RENUNCIA_MS) break;
        if (t > OCLUSION_AVISO_MS * (avisado + 1) && !guia.hablando) {
            avisado++;
            guia.decir(tapado === 'OI' ? 'vista-tapa-bien-izquierdo' : 'vista-tapa-bien-derecho');
        }
        ui.estado.textContent = !e.cara ? 'No vemos tu cara' : `Tápate el ojo ${tapado === 'OI' ? 'izquierdo' : 'derecho'}`;
        await esperar(150);
    }
    let distanciaControlada = await esperarDistancia(ui, seg, guia);

    // La E
    pantalla(ui, `Ojo ${nombre}`, '¿Hacia dónde apunta la E?', seg.tipo === 'computador'
        ? 'Toca o usa las flechas del teclado hacia donde apuntan sus patas.' : 'Toca la flecha hacia donde apuntan sus patas.');
    if (ojo === 'OD') await guia.decir('vista-e');
    const esc = crearEscalera(lista);
    let destapes = 0;
    while (!esc.terminado) {
        // Cada E se muestra con la distancia correcta (mientras se haya podido controlar)…
        if (distanciaControlada && (estadoDistancia(seg.estado.distancia, seg.objetivo) !== 'bien' || !seg.estado.cara)) {
            ui.lienzo.replaceChildren();
            distanciaControlada = await esperarDistancia(ui, seg, guia);
        }
        // …y con el otro ojo tapado: si se destapó, se le recuerda y se espera un momento
        if (oclusionVerificada && destapes < DESTAPES_MAX && seg.estado.cara && seg.estado.ear[tapado] >= EAR_OPEN) {
            destapes++;
            ui.lienzo.replaceChildren();
            guia.decir(tapado === 'OI' ? 'vista-tapa-bien-izquierdo' : 'vista-tapa-bien-derecho');
            const t0 = performance.now();
            while (seg.estado.ear[tapado] >= EAR_TAPADO && performance.now() - t0 < DESTAPADO_ESPERA_MS) await esperar(150);
        }
        const e = esc.siguiente();
        dibujarE(ui, e.nivel.trazo, e.direccion);
        ui.estado.textContent = `Ojo ${nombre}`;
        const teclas = { arriba: 'ArrowUp', izquierda: 'ArrowLeft', derecha: 'ArrowRight', abajo: 'ArrowDown' };
        const pregunta = opciones(ui, [
            ...['arriba', 'izquierda', 'derecha', 'abajo'].map((d) => ({ etiqueta: FLECHAS[d], valor: d, clase: `flecha ${d}`, aria: d, tecla: teclas[d] })),
            { etiqueta: 'No la veo', valor: 'no-veo', secundario: true, clase: 'no-veo', tecla: ' ' },
        ], 'cruz');
        alinearE();   // con los botones ya puestos
        esc.responder(e, await pregunta);
    }

    // Reloj de astigmatismo, con el mismo ojo tapado
    pantalla(ui, `Ojo ${nombre}`, 'Mira el centro del reloj', '¿Todas las líneas se ven igual de negras?');
    dibujarReloj(ui);
    guia.decir('vista-reloj');
    const reloj = await opciones(ui, [
        { etiqueta: 'Todas iguales', valor: 'igual' },
        { etiqueta: 'Algunas más oscuras', valor: 'distinto', secundario: true },
    ]);

    return { ...esc.resultado(), reloj, oclusionVerificada, destapes, distanciaControlada, ensayos: esc.ensayos };
}

// ------------------------------------------------------------------ la prueba
/**
 * Corre la prueba visual completa. Rechaza solo si el paciente niega la cámara (NotAllowedError):
 * es obligatoria y eso lo resuelve el paciente. Otra falla → { realizado: false, motivo }.
 * @param ui  de montarVista, con ui.guia (guia-voz.js)
 */
export async function examenVista(ui) {
    const guia = ui.guia || GUIA_MUDA;
    const inicio = Date.now();
    let stream, seg;
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false,
        });
    } catch (error) {
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') throw error;
        return { realizado: false, motivo: `No se pudo abrir la cámara (${error.name}).`, version: VERSION };
    }
    try {
        ui.video.srcObject = stream;
        try {
            await ui.video.play();
        } catch (error) {
            // Que un rechazo de reproducción no se confunda con la cámara negada (el paciente vería
            // "permite la cámara" sin que sea eso)
            throw new Error(`No se pudo reproducir la cámara (${error.name}).`);
        }
        const camara = `${ui.video.videoWidth}x${ui.video.videoHeight}`;
        pantalla(ui, 'Prueba visual', 'Prueba visual', 'Vamos a revisar qué tan bien ves de cerca y los colores.');
        await guia.decir('vista-intro');
        const landmarker = await precargarModelo();
        seg = crearSeguimiento(ui.video, landmarker);
        window.addEventListener('resize', alinearE);

        // 1. Preguntas (las mismas de la visiometría anterior, más las gafas)
        const si = [{ etiqueta: 'Sí', valor: 'Si' }, { etiqueta: 'No', valor: 'No', secundario: true }];
        pantalla(ui, 'Antes de empezar', '¿Usas gafas o lentes de contacto?');
        guia.decir('vista-gafas');
        const gafas = await opciones(ui, si);
        if (gafas === 'Si') {
            pantalla(ui, 'Antes de empezar', 'Póntelas', 'Si las tienes contigo, póntelas: la prueba es con ellas.');
            await guia.decir('vista-ponte-gafas');
            await opciones(ui, [{ etiqueta: 'Listo', valor: true }]);
        }
        const tres = [...si, { etiqueta: 'No sé', valor: 'No sé', secundario: true }];
        pantalla(ui, 'Antes de empezar', '¿Te han diagnosticado miopía?');
        guia.decir('vista-miopia');
        const miopia = await opciones(ui, tres);
        pantalla(ui, 'Antes de empezar', '¿Y astigmatismo?');
        guia.decir('vista-astigmatismo');
        const astigmatismo = await opciones(ui, tres);

        // 2. Tamaño de la pantalla (en celular se sabe; en computador, con la tarjeta)
        let pxPorMm = escalaSinCalibrar({ ancho: screen.width, alto: screen.height, tactil: navigator.maxTouchPoints > 0 });
        const metodoEscala = pxPorMm ? 'celular' : 'tarjeta';
        if (!pxPorMm) pxPorMm = await calibrarConTarjeta(ui, guia);
        const dpr = window.devicePixelRatio || 1;
        // La distancia de la prueba sale de la pantalla: la cercana a 40 cm (55 en computador) en la
        // que 20/40 cae exacto en px enteros (agudeza.distanciaDePrueba)
        seg.tipo = metodoEscala === 'celular' ? 'celular' : 'computador';
        seg.objetivo = distanciaDePrueba(pxPorMm, dpr, seg.tipo);
        const lista = niveles(pxPorMm, dpr, seg.objetivo);

        // 3. Distancia
        const cm = Math.round(seg.objetivo / 10);
        pantalla(ui, 'Distancia', `A unos ${cm} cm`, seg.tipo === 'celular'
            ? 'Más o menos el largo de tu antebrazo. Te digo si te acercas o te alejas.'
            : 'Siéntate frente a la cámara. Te digo si te acercas o te alejas.');
        await guia.decir(seg.tipo === 'celular' ? 'vista-distancia' : 'vista-distancia-pc');
        const distanciaInicial = await esperarDistancia(ui, seg, guia);
        if (distanciaInicial) await guia.decir('vista-distancia-bien');

        // 4. Cada ojo
        const OD = await medirOjo(ui, seg, guia, 'OD', lista);
        const OI = await medirOjo(ui, seg, guia, 'OI', lista);
        pantalla(ui, 'Colores', 'Destápate los ojos');
        await guia.decir('vista-destapate');

        // 5. Colores, con los dos ojos
        pantalla(ui, 'Colores', '¿Qué número ves?', 'En cada círculo de puntos hay un número escondido.');
        await guia.decir('vista-colores');
        const respuestas = {};
        const semilla = Math.floor(Math.random() * 1e9);
        for (const [k, lamina] of LAMINAS.entries()) {
            ui.paso.textContent = `Colores · ${k + 1} de ${LAMINAS.length}`;
            dibujarLamina(ui, lamina, semilla + k);
            const orden = [...lamina.opciones].sort(() => Math.random() - 0.5);
            respuestas[lamina.id] = await opciones(ui, [
                ...orden.map((n) => ({ etiqueta: String(n), valor: n })),
                { etiqueta: 'No veo ningún número', valor: NINGUNO, secundario: true, clase: 'ancho' },
            ], 'numeros');
        }
        const colores = { ...evaluarColores(respuestas), respuestas, semilla };

        const ojos = { OD, OI };
        const c = concepto(ojos, colores);
        const ds = seg.estado.distancias.slice().sort((a, b) => a - b);
        pantalla(ui, 'Prueba visual', 'Terminamos');
        await guia.decir('vista-fin');
        return {
            realizado: true,
            version: VERSION,
            fecha: new Date().toISOString(),
            duracion_s: Math.round((Date.now() - inicio) / 1000),
            preguntas: { gafas, miopia, astigmatismo },
            escala: { pxPorMm: Math.round(pxPorMm * 100) / 100, metodo: metodoEscala, dpr },
            camara,
            distanciaObjetivoMm: seg.objetivo,
            distanciaMedianaMm: ds.length ? Math.round(ds[Math.floor(ds.length / 2)]) : null,
            erroresDetector: seg.estado.errores,
            ojos,
            colores,
            ...c,
        };
    } catch (error) {
        if (error.name === 'NotAllowedError') throw error;
        console.error('[vista] Error durante la prueba:', error);
        return { realizado: false, motivo: `La prueba falló a mitad de camino (${error.message}).`, version: VERSION };
    } finally {
        seg?.parar();
        window.removeEventListener('resize', alinearE);
        guia.apagar();
        stream.getTracks().forEach((t) => t.stop());
        ui.video.srcObject = null;
        // Libera el detector (GPU) salvo que siga otra prueba que lo reutilice (la de ojos en la
        // visiometría): ui.liberarModelo = false
        if (ui.liberarModelo !== false) liberarModelo();
    }
}

const ESTILOS = `
.bsl-vista { position: fixed; inset: 0; z-index: 9000; display: flex; flex-direction: column; gap: 12px;
    background: #131417; color: #fff; font-family: system-ui, -apple-system, sans-serif;
    padding: max(14px, env(safe-area-inset-top)) 16px max(18px, env(safe-area-inset-bottom)); }
.bsl-vista-cabeza { display: flex; align-items: center; gap: 12px; }
.bsl-vista-camara { flex: none; width: 64px; height: 64px; border-radius: 50%; overflow: hidden; background: #1c1e24;
    border: 2px solid rgba(255,255,255,.2); }
.bsl-vista-camara video { width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); }
.bsl-vista-paso { margin: 0; font-size: 0.8rem; color: rgba(255,255,255,.6); }
.bsl-vista-estado { margin-top: 4px; display: inline-block; background: rgba(255,255,255,.08); padding: 5px 12px;
    border-radius: 14px; font-size: 0.85rem; }
.bsl-vista-estado:empty { display: none; }
.bsl-vista-escena { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 10px; text-align: center; }
.bsl-vista h2 { margin: 0; font-size: 1.25rem; font-weight: 500; }
.bsl-vista-indicacion { margin: 0; font-size: 0.92rem; line-height: 1.45; color: rgba(255,255,255,.78); max-width: 420px; }
.bsl-vista-indicacion:empty { display: none; }
.bsl-vista-lienzo { width: 100%; display: flex; justify-content: center; align-items: center; min-height: 0; }
.bsl-vista-marco { background: #fff; padding: 48px; border-radius: 14px; display: flex; }
.bsl-vista-e { image-rendering: pixelated; display: block; }
.bsl-vista-lienzo canvas:not(.bsl-vista-e) { border-radius: 12px; }   /* la E no: le cortaba las puntas */
.bsl-vista-botones { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
.bsl-vista-botones:empty { display: none; }
.bsl-vista-boton { min-width: 120px; min-height: 52px; padding: 12px 20px; border: none; border-radius: 10px;
    background: #0b5cff; color: #fff; font: inherit; font-size: 1.05rem; font-weight: 500; cursor: pointer; }
.bsl-vista-boton.secundario { background: rgba(255,255,255,.12); }
.bsl-vista-botones.cruz { display: grid; grid-template-columns: repeat(3, 72px); grid-template-rows: repeat(3, 72px);
    gap: 8px; justify-content: center; grid-template-areas: ". arriba ." "izquierda . derecha" ". abajo ." ; }
.bsl-vista-botones.cruz .flecha { min-width: 0; min-height: 0; width: 72px; height: 72px; font-size: 2rem; padding: 0; }
.bsl-vista-botones.cruz .arriba { grid-area: arriba; } .bsl-vista-botones.cruz .abajo { grid-area: abajo; }
.bsl-vista-botones.cruz .izquierda { grid-area: izquierda; } .bsl-vista-botones.cruz .derecha { grid-area: derecha; }
.bsl-vista-botones.cruz .no-veo { grid-column: 1 / -1; grid-row: 4; width: 100%; }
.bsl-vista-botones.numeros .bsl-vista-boton { min-width: 84px; }
.bsl-vista-botones .ancho { flex-basis: 100%; max-width: 320px; }
.bsl-vista-tarjeta-caja { display: flex; flex-direction: column; align-items: center; gap: 16px; width: 100%; }
.bsl-vista-tarjeta { border: 2px solid #8fb6ff; border-radius: 8px; background: rgba(143,182,255,.12); max-width: 100%; }
.bsl-vista-tarjeta-caja input { width: min(100%, 420px); }
`;
