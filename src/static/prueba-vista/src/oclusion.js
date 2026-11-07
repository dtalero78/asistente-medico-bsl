// ¿Está tapado el ojo? Por los PÍXELES, no por los párpados. Sin DOM: recibe los datos de imagen.
//
// Por qué: con la palma encima de un ojo, MediaPipe reconstruye la cara entera y dibuja ese ojo
// abierto (la cara es simétrica para el modelo), así que la apertura de los párpados (EAR) que se
// usaba nunca bajaba y la prueba no notaba si el ojo estaba tapado o no (Daniel, 7-nov-2026, en su
// celular). La imagen sí cambia: un ojo abierto tiene mucha textura (iris oscuro, blanco del ojo,
// pestañas, bordes) y una palma es piel lisa. Cada ojo se compara con SU PROPIA textura de cuando
// estaban los dos destapados: así no importa la luz, el color de los ojos ni la cámara.

// Proporciones respecto a la referencia de cada ojo (con los dos destapados)
export const OCLUSION = {
    TAPADO: 0.45,       // tapado: su textura cae bajo el 45 % de la suya
    ABIERTO: 0.6,       // y el otro conserva al menos el 60 % de la suya
    DESTAPADO: 0.75,    // durante la prueba, si el tapado vuelve sobre el 75 %, lo destapó
};
export const MUESTRAS_REFERENCIA = 12;
export const SATURADO = 240;          // luminancia casi blanca
export const MAX_SATURADOS = 0.18;    // con más de esta fracción la región no sirve: es un reflejo
// (la pantalla brillando en el lente de las gafas: lavado y sin bordes, como una palma, pero blanco;
// una palma es de tono medio). Así un reflejo nunca pasa por "tapado" ni esconde un destape.
export const RAZON_REFERENCIA = [0.5, 2];   // OD/OI de la referencia fuera de esto: un ojo ya estaba tapado
export const MUESTRAS_TAPADO = 3;           // medidas NUEVAS seguidas en "tapado" para darlo por verificado

/**
 * Textura de una región: diferencia media entre píxeles vecinos (bordes), relativa al brillo
 * medio, para que una foto más oscura no parezca "más lisa".
 * @param img  { data: RGBA, width, height }  @param r { x, y, w, h } en px de img
 */
export function textura(img, r) {
    const x0 = Math.max(0, Math.round(r.x)), y0 = Math.max(0, Math.round(r.y));
    const x1 = Math.min(img.width - 1, Math.round(r.x + r.w)), y1 = Math.min(img.height - 1, Math.round(r.y + r.h));
    if (x1 - x0 < 4 || y1 - y0 < 4) return null;
    const lum = (x, y) => {
        const i = (y * img.width + x) * 4;
        return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
    };
    let bordes = 0, brillo = 0, saturados = 0, n = 0;
    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            const v = lum(x, y);
            bordes += Math.abs(v - lum(x + 1, y)) + Math.abs(v - lum(x, y + 1));
            brillo += v;
            if (v >= SATURADO) saturados++;
            n++;
        }
    }
    if (saturados / n > MAX_SATURADOS) return null;   // reflejo: no se puede saber
    return (100 * (bordes / n)) / (brillo / n + 10);
}

/**
 * La región del ojo a partir de sus comisuras (que MediaPipe ubica bien aunque el ojo esté tapado:
 * las anclan el resto de la cara). Alto proporcional al ancho, no a los párpados.
 */
export function regionOjo(comisuraA, comisuraB, escala = 1) {
    const cx = (comisuraA.x + comisuraB.x) / 2, cy = (comisuraA.y + comisuraB.y) / 2;
    const ancho = Math.hypot(comisuraA.x - comisuraB.x, comisuraA.y - comisuraB.y) * 1.2;
    const alto = ancho * 0.6;
    return { x: (cx - ancho / 2) * escala, y: (cy - alto / 2) * escala, w: ancho * escala, h: alto * escala };
}

const mediana = (v) => { const s = v.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

/**
 * Referencia de cada ojo (mediana de las últimas muestras con los dos destapados), o null.
 * `valida(m)` filtra muestras (vista.js: solo las tomadas a la distancia de la prueba, porque la
 * textura depende de la escala). Si un ojo tiene la mitad o el doble que el otro, ya estaba tapado
 * (el paciente se adelantó): null, y vale solo el método de los párpados.
 */
export function referencia(muestras, valida = () => true) {
    const buenas = muestras.filter(valida);
    const ok = (k) => buenas.map((m) => m[k]).filter((v) => v != null && v > 0).slice(-MUESTRAS_REFERENCIA * 3);
    const od = ok('OD'), oi = ok('OI');
    if (od.length < MUESTRAS_REFERENCIA || oi.length < MUESTRAS_REFERENCIA) return null;
    const ref = { OD: mediana(od), OI: mediana(oi) };
    const razon = ref.OD / ref.OI;
    return razon < RAZON_REFERENCIA[0] || razon > RAZON_REFERENCIA[1] ? null : ref;
}

/**
 * Estado del ojo que debe estar tapado.
 * @returns 'tapado' | 'destapado' | 'otro' (el que debía quedar abierto también bajó: tapó el
 *          equivocado o los dos) | null (sin referencia o sin medida)
 */
export function estadoOclusion(ref, actual, tapado) {
    const abierto = tapado === 'OD' ? 'OI' : 'OD';
    if (!ref || !actual || actual[tapado] == null || actual[abierto] == null) return null;
    const rt = actual[tapado] / ref[tapado], ra = actual[abierto] / ref[abierto];
    if (ra < OCLUSION.ABIERTO) return 'otro';
    if (rt < OCLUSION.TAPADO) return 'tapado';
    if (rt > OCLUSION.DESTAPADO) return 'destapado';
    return null;   // a medias: ni lo uno ni lo otro
}
