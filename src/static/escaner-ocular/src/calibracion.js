// Calibración — resuelve las dos cosas que el navegador no sabe y que la agudeza
// visual necesita: cuánto mide físicamente un píxel de esta pantalla, y a qué
// distancia está el sujeto.
//
// Distancia: NO se usa la distancia focal ni el supuesto de iris = 11.7 mm. Se mide
// el iris en píxeles a una distancia conocida (el cordón) y después
//
//     distancia = distanciaRef × irisPxRef / irisPx
//
// El tamaño real del iris se cancela en la división, así que el error poblacional de
// ±0.42 mm no entra en la medida de distancia. Solo entran el largo del cordón y el
// ruido de píxel.

const CARD_MM_W = 85.60; // ISO/IEC 7810 ID-1: cédula, licencia, tarjeta bancaria
const CARD_MM_H = 53.98;

function claveEscala() {
  const dpr = window.devicePixelRatio || 1;
  return `escaner.escalaPantalla.${screen.width}x${screen.height}@${dpr}`;
}

/** px CSS por milímetro de esta pantalla, o null si nunca se calibró. */
export function escalaPantalla() {
  const v = parseFloat(localStorage.getItem(claveEscala()));
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function guardarEscalaPantalla(pxPorMm) {
  // No es dato de salud: guardarlo en un equipo compartido no crea el problema de
  // privacidad que sí tendría almacenar exámenes.
  localStorage.setItem(claveEscala(), String(pxPorMm));
}

/**
 * Pide al usuario ajustar un rectángulo hasta que coincida con una tarjeta real.
 * @returns {Promise<number>} px CSS por milímetro
 */
export function pedirCalibracionTarjeta() {
  return new Promise((resolve) => {
    const capa = document.createElement("div");
    capa.className = "calibracion";
    capa.innerHTML = `
      <div class="calibracion-caja">
        <h2>Calibrar la pantalla</h2>
        <p>
          Apoye una <strong>cédula o tarjeta bancaria</strong> sobre la pantalla y mueva
          el control hasta que el rectángulo tenga exactamente su tamaño.
        </p>
        <div class="tarjeta" id="calTarjeta"></div>
        <input type="range" id="calRango" min="150" max="900" step="1" />
        <p class="calibracion-dato"><span id="calDato"></span></p>
        <button class="btn primary" id="calOk">Listo</button>
      </div>`;
    document.body.appendChild(capa);

    const tarjeta = capa.querySelector("#calTarjeta");
    const rango = capa.querySelector("#calRango");
    const dato = capa.querySelector("#calDato");

    // Punto de partida: 96 dpi nominal ≈ 3.78 px/mm
    rango.value = String(Math.round(CARD_MM_W * 3.78));

    const pintar = () => {
      const w = parseFloat(rango.value);
      tarjeta.style.width = w + "px";
      tarjeta.style.height = (w * CARD_MM_H / CARD_MM_W) + "px";
      dato.textContent = (w / CARD_MM_W).toFixed(2) + " px por mm";
    };
    rango.addEventListener("input", pintar);
    pintar();

    capa.querySelector("#calOk").addEventListener("click", () => {
      const pxPorMm = parseFloat(rango.value) / CARD_MM_W;
      guardarEscalaPantalla(pxPorMm);
      capa.remove();
      resolve(pxPorMm);
    });
  });
}

/** Distancia actual en mm, a partir de una referencia tomada a distancia conocida. */
export function distanciaMm(irisPx, ref) {
  if (!ref || !irisPx) return null;
  return ref.distanciaMm * ref.irisPx / irisPx;
}

/**
 * Tamaño del trazo (una barra de la E) para un logMAR dado.
 * En logMAR 0 el trazo subtiende 1 minuto de arco; cada punto de logMAR lo multiplica
 * por diez. La E completa mide 5 trazos de alto.
 */
export function trazoPx(logMAR, distanciaMm_, pxPorMm) {
  const radianes = Math.pow(10, logMAR) * (1 / 60) * (Math.PI / 180);
  return distanciaMm_ * radianes * pxPorMm;
}

/**
 * logMAR más pequeño que esta pantalla puede dibujar honestamente a esta distancia.
 * Por debajo del mínimo de píxeles por trazo la E deja de ser una E y la prueba
 * mediría la pantalla, no el ojo.
 */
export function pisoLogMAR(distanciaMm_, pxPorMm, minPx = 3, dpr = null) {
  const escala = dpr || window.devicePixelRatio || 1;
  const porUnidad = trazoPx(0, distanciaMm_, pxPorMm) * escala;
  if (porUnidad <= 0) return null;
  return Math.log10(minPx / porUnidad);
}

/**
 * Distancia mínima a la que ESTA pantalla puede dibujar un optotipo del logMAR
 * objetivo. Es la inversa de pisoLogMAR: en vez de aceptar el techo del equipo,
 * calcula a qué distancia hay que ponerse para alcanzar el corte que interesa.
 *
 * Sin esto, una pantalla de baja densidad da "no alcanza el corte" para todo el
 * mundo, y un tamizaje que marca a todos no sirve para nada.
 */
export function distanciaParaLogMAR(logMAR, pxPorMm, minPx = 3, dpr = null) {
  const escala = dpr || window.devicePixelRatio || 1;
  const porMm = Math.pow(10, logMAR) * (1 / 60) * (Math.PI / 180) * pxPorMm * escala;
  if (porMm <= 0) return null;
  return minPx / porMm;
}

export const SNELLEN = (logMAR) => {
  const den = Math.round(20 * Math.pow(10, logMAR));
  return `20/${den}`;
};
