// Estímulo — usa la pantalla como fuente de luz controlada para el estudio de pupilas.
//
// Sobre el rojo: la fase "de penumbra" no es pantalla negra sino rojo medio. Con la
// pantalla apagada el rostro queda iluminado solo por la luz del cuarto y el contraste
// pupila/iris —que ya es el punto débil de medir en luz visible— empeora justo cuando
// hay que medir. La luz roja de onda larga aporta muy poca acción pupilar respecto a su
// luminancia, así que ilumina para la cámara sin contraer la pupila como lo haría el
// blanco. Es la misma razón por la que el montaje de hardware del repo padre exige
// iluminación roja.
//
// Importante para el reporte: esto es una PENUMBRA RELATIVA, no una adaptación a
// oscuridad real. La comparación luz/penumbra es más débil que la de un cuarto oscuro.

export const FASES = {
  blanco: { css: "#ffffff", etiqueta: "luz" },
  rojo:   { css: "#b00000", etiqueta: "penumbra" },
  negro:  { css: "#000000", etiqueta: "oscuro" },
};

export function crearEstimulo() {
  let capa = null;
  let marca = null;
  let texto = null;
  let faseActual = null;

  function asegurar() {
    if (capa) return;
    capa = document.createElement("div");
    capa.className = "estimulo";
    capa.hidden = true;

    marca = document.createElement("div");
    marca.className = "estimulo-fijacion";
    capa.appendChild(marca);

    texto = document.createElement("p");
    texto.className = "estimulo-texto";
    capa.appendChild(texto);

    document.body.appendChild(capa);
  }

  return {
    /** Pinta la pantalla completa del color de la fase indicada. */
    fase(nombre, mensaje) {
      asegurar();
      const f = FASES[nombre];
      if (!f) throw new Error("Fase de estímulo desconocida: " + nombre);
      faseActual = nombre;
      capa.style.background = f.css;
      // El punto de fijación va en contraste con el fondo para verse en las tres fases,
      // y es pequeño para no alterar la luminancia de forma apreciable.
      marca.style.background = nombre === "blanco" ? "#333" : "#fff";
      texto.style.color = nombre === "blanco" ? "#555" : "rgba(255,255,255,.75)";
      texto.textContent = mensaje || "";
      capa.hidden = false;
    },

    mensaje(msg) { if (texto) texto.textContent = msg; },

    apagar() {
      faseActual = null;
      if (capa) capa.hidden = true;
    },

    get activa() { return faseActual; },
  };
}
