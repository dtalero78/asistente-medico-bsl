// Visión de colores: láminas pseudoisocromáticas generadas (no son las de Ishihara, que tienen
// derechos de autor). Sin DOM; el dibujo lo hace la cáscara con `puntosDeLamina`.
//
// Por qué se rehicieron: las 6 simuladas de la visiometría anterior confundían también a quien ve
// bien (BD, 60 días: los «Normal» fallaban en promedio 1 de cada 10 y solo el 34 % sacaba todo
// perfecto). Aquí cada lámina se construye para UN tipo de daltonismo rojo-verde:
//   - la figura y el fondo difieren solo en la dirección de color que ese tipo no distingue: la que
//     su matriz de simulación (Machado, Oliveira y Fernandes 2009, severidad 1) manda a cero;
//   - cada punto lleva un brillo al azar, igual en figura y fondo, para que nadie la lea por luz;
//   - las «suaves» tienen menos diferencia: las ve quien ve bien y no quien tiene una alteración
//     leve (tricromacia anómala, la forma más común).
// pruebas/casos.js comprueba los números de cada lámina con las mismas matrices.

// Matrices de Machado 2009, severidad 1.0, sobre RGB lineal
export const PROTAN = [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]];
export const DEUTAN = [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]];

// Dirección (RGB lineal, unitaria) que cada matriz manda a ~0: la confusión de ese tipo
export const CONFUSION = {
    protan: [0.9896, -0.1437, -0.0029],
    deutan: [0.9221, -0.3860, 0.0284],
};

const BASE = [0.30, 0.25, 0.06];      // ocre medio, lineal: deja margen de gama hacia rojo y verde
export const FUERZA = { fuerte: 0.26, suave: 0.09 };   // cuánto se separan figura y fondo (RGB lineal)
export const RUIDO_BRILLO = 0.16;     // ±16 % de luminancia por punto, al azar

// ---------- color ----------
export function aSrgb(c) {
    return c.map((v) => {
        const x = Math.min(1, Math.max(0, v));
        return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    });
}

export function aLineal(c) {
    return c.map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
}

export function multiplicar(m, c) {
    return m.map((fila) => fila[0] * c[0] + fila[1] * c[1] + fila[2] * c[2]);
}

export function lab(c) {
    const [r, g, b] = c.map((v) => Math.min(1, Math.max(0, v)));
    const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.9505;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.089;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

export function deltaE(a, b) {
    const p = lab(a), q = lab(b);
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** Colores base (RGB lineal) de figura y fondo de una lámina */
export function coloresDeLamina(lamina) {
    if (lamina.tipo === 'demo') return { figura: [0.05, 0.05, 0.05], fondo: [0.55, 0.50, 0.42] };
    const d = CONFUSION[lamina.tipo];
    const t = FUERZA[lamina.fuerza];
    return {
        figura: BASE.map((v, i) => v + t * d[i]),
        fondo: BASE.map((v, i) => v - t * d[i]),
    };
}

// ---------- láminas ----------
// demo: contraste de luz, la lee cualquiera (si la falla, no entendió la prueba o no ve).
// Las demás alternan protán y deután. 4 números parecidos por lámina (adivinar = 1 de 4) más
// «No veo ningún número».
export const LAMINAS = [
    { id: 'demo', tipo: 'demo', numero: 12, opciones: [12, 17, 21, 72] },
    { id: 'p1', tipo: 'protan', fuerza: 'fuerte', numero: 8, opciones: [8, 3, 6, 9] },
    { id: 'd1', tipo: 'deutan', fuerza: 'fuerte', numero: 29, opciones: [29, 70, 26, 28] },
    { id: 'p2', tipo: 'protan', fuerza: 'fuerte', numero: 5, opciones: [5, 2, 6, 3] },
    { id: 'd2', tipo: 'deutan', fuerza: 'fuerte', numero: 74, opciones: [74, 21, 71, 14] },
    { id: 'p3', tipo: 'protan', fuerza: 'suave', numero: 6, opciones: [6, 9, 5, 8] },
    { id: 'd3', tipo: 'deutan', fuerza: 'suave', numero: 45, opciones: [45, 15, 46, 48] },
];
export const NINGUNO = 'ninguno';

/** Generador pseudoaleatorio con semilla (mulberry32): las láminas se pueden reproducir */
export function azarConSemilla(semilla) {
    let a = semilla >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Los puntos de una lámina en un círculo de radio 1 (centro 0,0). `enFigura(x, y)` dice si un punto
 * cae en el número (la cáscara lo calcula con el texto dibujado en un canvas).
 * @returns [{ x, y, r, color: [r, g, b] sRGB 0-1 }]
 */
export function puntosDeLamina(lamina, enFigura, semilla = 1, cuantos = 900) {
    const azar = azarConSemilla(semilla);
    const { figura, fondo } = coloresDeLamina(lamina);
    const puntos = [];
    let intentos = 0;
    while (puntos.length < cuantos && intentos < cuantos * 40) {
        intentos++;
        const r = 0.012 + azar() * 0.026;
        const x = (azar() * 2 - 1) * (1 - r), y = (azar() * 2 - 1) * (1 - r);
        if (Math.hypot(x, y) > 1 - r) continue;
        if (puntos.some((p) => Math.hypot(p.x - x, p.y - y) < p.r + r + 0.004)) continue;
        const base = enFigura(x, y) ? figura : fondo;
        const brillo = 1 + (azar() * 2 - 1) * RUIDO_BRILLO;
        const tinte = (azar() * 2 - 1) * 0.015;   // un poco de variedad de tono, igual en los dos
        puntos.push({ x, y, r, color: aSrgb([base[0] * brillo + tinte, base[1] * brillo, base[2] * brillo - tinte]) });
    }
    return puntos;
}

/**
 * Resultado de colores. Fuertes: las falla quien tiene daltonismo; suaves: también una alteración leve.
 * respuestas: { [id]: número | 'ninguno' }
 */
export function evaluarColores(respuestas, laminas = LAMINAS) {
    const de = (l) => respuestas[l.id] === l.numero;
    const demo = laminas.find((l) => l.tipo === 'demo');
    const fuertes = laminas.filter((l) => l.fuerza === 'fuerte');
    const suaves = laminas.filter((l) => l.fuerza === 'suave');
    const fallas = (lista, tipo) => lista.filter((l) => l.tipo === tipo && !de(l)).length;
    const r = {
        correctas: laminas.filter((l) => l.tipo !== 'demo' && de(l)).length,
        total: laminas.filter((l) => l.tipo !== 'demo').length,
        demoOk: demo ? de(demo) : true,
        fallasProtan: fallas(fuertes, 'protan') + fallas(suaves, 'protan'),
        fallasDeutan: fallas(fuertes, 'deutan') + fallas(suaves, 'deutan'),
    };
    const fuertesFalladas = fuertes.filter((l) => !de(l)).length;
    const suavesFalladas = suaves.filter((l) => !de(l)).length;
    // Una alteración leve falla, por diseño, solo la suave de su tipo: con una basta para «dudosa»
    // (exigir las dos dejaba pasar justo el caso para el que existen)
    if (!r.demoOk) r.lectura = 'no-valida';            // no vio ni la de contraste: no entendió o no ve
    else if (fuertesFalladas >= 2) r.lectura = 'alterada';
    else if (fuertesFalladas === 1 || suavesFalladas >= 1) r.lectura = 'dudosa';
    else r.lectura = 'normal';
    if (r.lectura === 'alterada' || r.lectura === 'dudosa') {
        r.tipo = r.fallasProtan > r.fallasDeutan ? 'protan' : r.fallasDeutan > r.fallasProtan ? 'deutan' : 'rojo-verde';
    }
    return r;
}
