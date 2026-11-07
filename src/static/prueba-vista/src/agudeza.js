// Agudeza visual de cerca, un ojo a la vez, con la E que gira (tumbling E). Sin DOM: lo usa la
// cáscara (static/js/vista.js) y las pruebas (pruebas/casos.js).
//
// Por qué así y no las letras de la visiometría anterior: allá los tamaños eran píxeles fijos, sin
// distancia y con los dos ojos abiertos, así que se medía la pantalla y no el ojo (BD, 60 días:
// 96 % «Normal», Snellen promedio 97 %). Aquí el tamaño sale del ángulo que subtiende la E a la
// distancia medida con la cámara, y cada ojo se mide por separado.
//
// Las dos cosas que el navegador no sabe, y cómo se resuelven sin pedirle nada al paciente:
//   - Distancia: por el diámetro del iris (11.7 mm) y el campo de visión típico de la cámara
//     frontal. Error esperado ±20 %, que mueve la agudeza menos de una línea (0.1 logMAR = 26 %).
//   - Milímetros por píxel de la pantalla: en celular la densidad CSS es casi constante (~6 px/mm,
//     ±8 %, que son 0.03 logMAR). En computador varía demasiado: se calibra con una tarjeta.

import { trazoPx, SNELLEN } from '../../escaner-ocular/src/calibracion.js';

export const IRIS_MM = 11.7;
// Campo de visión de la cámara frontal sobre el lado HORIZONTAL del cuadro. En celular vertical
// es el lado corto del sensor (~55° en una cámara de ~23-26 mm equivalentes); en un computador
// la cámara web va apaisada (~65°).
export const FOV_VERTICAL_GRADOS = 55;
export const FOV_APAISADO_GRADOS = 65;
export const DISTANCIA_OBJETIVO_MM = 400;   // agudeza de cerca (celular)
export const DISTANCIA_COMPUTADOR_MM = 550; // en computador se contesta con el teclado, un poco más lejos
// Celular 35-48 cm (lo que la voz llama «unos cuarenta centímetros»); computador 38-75 cm
export const RANGO_DISTANCIA = { celular: [350, 480], computador: [380, 750] };
export const TOLERANCIA_DISTANCIA = 0.15;   // ±15 % alrededor de la distancia de la prueba
export const PX_POR_MM_CELULAR = 6.0;       // px CSS por mm en celulares (densidad CSS casi fija)
// px de dispositivo por trazo: con menos ya no es una E. En pantallas de 1x un trazo de 1 px es una
// E nítida de 5×5 px; con 2x o más se exige 2 (un solo px de dispositivo ya no se distingue bien).
export const trazoMinimo = (dpr) => (dpr >= 2 ? 2 : 1);
// El punto de corte que el concepto necesita poder medir SIEMPRE (resultado.js, AGUDEZA_NORMAL)
export const LOGMAR_CORTE = 0.3;

// Niveles de la escalera (logMAR nominal) y criterio por nivel
export const LOGMAR_INICIAL = 0.7;          // 20/100
export const LOGMAR_MAX = 1.0;              // 20/200: si no ve esto, se reporta "peor que 20/200"
export const LOGMAR_MIN = -0.1;             // 20/16
export const POR_NIVEL = 3;                 // hasta 3 E por nivel…
export const ACIERTOS_NIVEL = 2;            // …y pasa con 2

export const DIRECCIONES = ['derecha', 'abajo', 'izquierda', 'arriba'];

/** Distancia ojo-pantalla en mm a partir del iris en px del cuadro de la cámara. */
export function distanciaMm(irisPx, anchoCuadro, altoCuadro) {
    if (!irisPx || !anchoCuadro) return null;
    const fov = (anchoCuadro < altoCuadro ? FOV_VERTICAL_GRADOS : FOV_APAISADO_GRADOS) * Math.PI / 180;
    const focal = (anchoCuadro / 2) / Math.tan(fov / 2);
    return IRIS_MM * focal / irisPx;
}

/** ¿Está a la distancia de la prueba? 'cerca' | 'lejos' | 'bien' */
export function estadoDistancia(mm, objetivo = DISTANCIA_OBJETIVO_MM) {
    if (mm == null) return null;
    if (mm < objetivo * (1 - TOLERANCIA_DISTANCIA)) return 'cerca';
    if (mm > objetivo * (1 + TOLERANCIA_DISTANCIA)) return 'lejos';
    return 'bien';
}

/**
 * La distancia de la prueba para ESTA pantalla: la más cercana a la nominal (40 cm en celular) en la
 * que el corte 20/40 cae exacto en px enteros. Sin esto, con trazos enteros el nivel más cercano a
 * 20/40 podía ser 20/43 (y alguien que ve 20/40 salía «Aceptable») o la pantalla ni siquiera llegaba
 * a 20/40 (un computador de 1x a 40 cm no baja de 20/91): todos salían mal sin importar su vista.
 * La distancia es lo único que se puede mover, así que se elige ella.
 */
export function distanciaDePrueba(pxPorMm, dpr, tipo = 'celular') {
    const nominal = tipo === 'celular' ? DISTANCIA_OBJETIVO_MM : DISTANCIA_COMPUTADOR_MM;
    const [min, max] = RANGO_DISTANCIA[tipo];
    const porMmDeDistancia = trazoPx(0, 1, pxPorMm) * dpr;          // px de trazo a logMAR 0 por mm
    const factor = Math.pow(10, LOGMAR_CORTE);
    const distanciaPara = (n) => n / (factor * porMmDeDistancia);  // donde el corte mide n px exactos
    let mejor = null;
    for (let n = trazoMinimo(dpr); n <= 40; n++) {
        const d = distanciaPara(n);
        if (d < min) continue;
        if (d > max) break;
        if (!mejor || Math.abs(d - nominal) < Math.abs(mejor - nominal)) mejor = d;
    }
    if (mejor) return Math.round(mejor);
    // Ningún entero cae en el rango (p. ej. un monitor de 27" 1440p, o un celular de 1,75x): la
    // distancia del rango con el nivel más cercano a 20/40 sin pasarse (más estricto, nunca más
    // laxo); entre empates, la más cercana a la nominal.
    let eleccion = nominal, mejorNivel = -Infinity;
    for (let d = min; d <= max; d += 5) {
        const n = niveles(pxPorMm, dpr, d).filter((x) => x.logMAR <= LOGMAR_CORTE + 1e-9).map((x) => x.logMAR);
        const nivel = n.length ? Math.max(...n) : -Infinity;
        if (nivel > mejorNivel + 1e-9 || (Math.abs(nivel - mejorNivel) < 1e-9 && Math.abs(d - nominal) < Math.abs(eleccion - nominal))) {
            mejorNivel = nivel;
            eleccion = d;
        }
    }
    return eleccion;
}

/**
 * px CSS por mm de esta pantalla sin calibrar, o null si hay que calibrar con la tarjeta.
 * Solo se confía en celulares (pantalla táctil y lado corto < 600 px CSS).
 */
export function escalaSinCalibrar({ ancho, alto, tactil }) {
    return tactil && Math.min(ancho, alto) < 600 ? PX_POR_MM_CELULAR : null;
}

/**
 * Los niveles que esta pantalla puede dibujar honestamente a la distancia objetivo, del más
 * grande al más chico. El trazo de la E se redondea a px ENTEROS de dispositivo (si no, el
 * navegador lo difumina) y el logMAR de cada nivel es el que de verdad resulta de ese redondeo.
 * @returns [{ trazo (px dispositivo), logMAR, snellen }]
 */
export function niveles(pxPorMm, dpr, distancia = DISTANCIA_OBJETIVO_MM) {
    const porUnidad = trazoPx(0, distancia, pxPorMm) * dpr;   // px de dispositivo por trazo a logMAR 0
    const vistos = new Set();
    const lista = [];
    for (let l = LOGMAR_MAX; l >= LOGMAR_MIN - 1e-9; l -= 0.1) {
        const trazo = Math.round(porUnidad * Math.pow(10, l));
        if (trazo < trazoMinimo(dpr) || vistos.has(trazo)) continue;
        vistos.add(trazo);
        const real = Math.round(Math.log10(trazo / porUnidad) * 100) / 100;
        lista.push({ trazo, logMAR: real, snellen: SNELLEN(real) });
    }
    return lista;
}

/**
 * Escalera descendente de tamizaje: empieza cerca de 20/100, baja un nivel mientras acierte 2 de
 * hasta 3 E, y se detiene en el primer nivel que no pasa. Si no pasa el inicial, sube hasta el más
 * grande. La agudeza es el último nivel aprobado.
 */
export function crearEscalera(lista, azar = Math.random) {
    let i = 0;
    let mejor = Infinity;
    lista.forEach((n, k) => {
        if (Math.abs(n.logMAR - LOGMAR_INICIAL) < mejor) { mejor = Math.abs(n.logMAR - LOGMAR_INICIAL); i = k; }
    });
    let aciertos = 0, intentos = 0, subiendo = false;
    let aprobado = null;           // índice del nivel más chico aprobado
    let terminado = lista.length === 0;
    const ensayos = [];
    const previas = [];

    // Al azar entre las 4 (adivinar = 1 de 4). Antes nunca se repetía la anterior, y quien
    // tocaba "cualquiera menos la de antes" acertaba 1 de 3. Solo se evita 3 veces seguidas.
    function direccion() {
        let d;
        do { d = DIRECCIONES[Math.floor(azar() * 4)]; } while (previas.length >= 2 && previas.at(-1) === d && previas.at(-2) === d);
        previas.push(d);
        return d;
    }

    return {
        get terminado() { return terminado; },
        get ensayos() { return ensayos; },
        /** La próxima E: { nivel, direccion } o null si terminó */
        siguiente() {
            return terminado ? null : { nivel: lista[i], direccion: direccion() };
        },
        /** respuesta: una de DIRECCIONES o 'no-veo' */
        responder(mostrada, respuesta) {
            const correcta = respuesta === mostrada.direccion;
            ensayos.push({ logMAR: mostrada.nivel.logMAR, mostrada: mostrada.direccion, respuesta, correcta });
            intentos++;
            if (correcta) aciertos++;
            const paso = aciertos >= ACIERTOS_NIVEL;
            const fallo = intentos - aciertos > POR_NIVEL - ACIERTOS_NIVEL;
            if (!paso && !fallo) return;
            aciertos = 0; intentos = 0;
            if (paso) {
                aprobado = i;
                if (subiendo || i === lista.length - 1) { terminado = true; return; }
                i++;
            } else if (aprobado == null && i > 0) {
                subiendo = true;   // no vio el inicial: probar más grande
                i--;
            } else {
                terminado = true;
            }
        },
        /** { logMAR, snellen, peorQue? } del ojo */
        resultado() {
            if (aprobado == null) {
                const grande = lista[0];
                return grande ? { logMAR: null, snellen: null, peorQue: grande.snellen } : { logMAR: null, snellen: null };
            }
            const n = lista[aprobado];
            // Aprobó el nivel más chico que la pantalla dibuja: su agudeza puede ser mejor
            return { logMAR: n.logMAR, snellen: n.snellen, limiteDePantalla: aprobado === lista.length - 1 };
        },
    };
}

/**
 * La E en una cuadrícula de 5×5 trazos, apuntando a `direccion` (hacia donde abren las patas).
 * Devuelve los rectángulos [x, y, w, h] en unidades de trazo, para dibujar en px enteros.
 */
export function rectangulosE(direccion) {
    // E apuntando a la derecha: barra vertical a la izquierda y tres patas
    const base = [[0, 0, 1, 5], [1, 0, 4, 1], [1, 2, 4, 1], [1, 4, 4, 1]];
    const rotar = ([x, y, w, h], veces) => {
        let r = [x, y, w, h];
        for (let k = 0; k < veces; k++) r = [5 - r[1] - r[3], r[0], r[3], r[2]];   // 90° horario
        return r;
    };
    const veces = { derecha: 0, abajo: 1, izquierda: 2, arriba: 3 }[direccion];
    return base.map((r) => rotar(r, veces));
}
