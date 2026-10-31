// Serie — estadística robusta e integración temporal para los estudios que graban
// una ventana de video. Funciones puras: se prueban sin navegador.

// Descarta null / undefined / NaN. Casi toda medida puede fallar en un frame suelto.
export function compact(xs) {
  return xs.filter((v) => v != null && !Number.isNaN(v));
}

export function mean(xs) {
  const v = compact(xs);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function median(xs) {
  return percentile(xs, 50);
}

// Percentil con interpolación lineal. p va de 0 a 100.
export function percentile(xs, p) {
  const v = compact(xs).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  if (v.length === 1) return v[0];
  const pos = (v.length - 1) * (p / 100);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return v[lo];
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

export function stdev(xs) {
  const v = compact(xs);
  if (v.length < 2) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

/**
 * Integra el tiempo en que se cumple una condición, ponderando por la duración real
 * de cada intervalo en vez de contar frames.
 *
 * Por qué importa: la tasa de refresco no es constante — MediaPipe compite con el
 * resto de la página y con otras pestañas. Contar frames haría que un periodo con
 * frames caídos pesara menos de lo que realmente duró, y PERCLOS saldría sesgado.
 *
 * Hay dos formas de perder tiempo y ninguna debe atribuirse a un estado:
 *  - Huecos mayores a `dtMax`: la pestaña pasó a segundo plano o la cámara se cortó.
 *  - Muestras inválidas (`esValida` falsa): hubo frame, pero sin rostro detectado.
 * La segunda importa especialmente: contar "sin rostro" como tiempo válido equivaldría
 * a darlo por ojo abierto, y el PERCLOS saldría subestimado sin que nada lo delate.
 *
 * @param {Array<{t:number}>} samples muestras ordenadas por tiempo
 * @param {(s:any)=>boolean} pred condición a medir
 * @param {number} dtMax salto máximo creíble entre muestras, en ms
 * @param {(s:any)=>boolean} [esValida] si la muestra aporta información
 * @returns {{conditionMs:number, validMs:number, droppedMs:number, fraction:number}}
 */
export function integrateTime(samples, pred, dtMax = 200, esValida = null) {
  let conditionMs = 0, validMs = 0, droppedMs = 0;
  for (let i = 0; i < samples.length - 1; i++) {
    const dt = samples[i + 1].t - samples[i].t;
    if (!(dt > 0)) continue;              // reloj no monótono: ignorar
    if (dt > dtMax) { droppedMs += dt; continue; }
    if (esValida && !esValida(samples[i])) { droppedMs += dt; continue; }
    validMs += dt;
    if (pred(samples[i])) conditionMs += dt;
  }
  return {
    conditionMs, validMs, droppedMs,
    fraction: validMs > 0 ? conditionMs / validMs : null,
  };
}

// Tasa de muestreo mediana, en Hz. Sirve para declarar en el reporte con qué
// resolución temporal se midió (relevante para el PLR).
export function sampleRate(samples) {
  const dts = [];
  for (let i = 0; i < samples.length - 1; i++) {
    const dt = samples[i + 1].t - samples[i].t;
    if (dt > 0 && dt < 200) dts.push(dt);
  }
  const m = median(dts);
  return m ? 1000 / m : null;
}

// Recorta una ventana temporal [desde, hasta) en ms absolutos.
export function window(samples, from, to) {
  return samples.filter((s) => s.t >= from && s.t < to);
}
