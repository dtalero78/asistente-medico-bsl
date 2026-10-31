// Estudio: agudeza visual con E direccional (tumbling E).
//
// Sobre la distancia de examen: a 40 cm un optotipo de 20/20 mide 0.6 mm, que en una
// pantalla de ~4 px/mm son 2 píxeles — no se puede dibujar. La prueba se hace a 1 m,
// que es lo más lejos que la cámara sigue detectando el rostro con fiabilidad. Aun así
// la pantalla impone un piso: por debajo de cierto logMAR la E deja de ser una E, y
// entonces se estaría midiendo la pantalla y no el ojo. Ese piso se calcula y se
// declara en el reporte en vez de fingir precisión que no existe.
//
// Sobre quién responde: a 1 m el sujeto no alcanza el teclado. Responde señalando con
// la mano y el operador registra la dirección, que es exactamente como se hace un
// examen de agudeza real. El operador también atestigua la oclusión del ojo.
import {
  escalaPantalla, pedirCalibracionTarjeta, distanciaMm, trazoPx, pisoLogMAR, SNELLEN,
} from "../calibracion.js";
import { median } from "../serie.js";
import { fmt } from "../reporte.js";

const DIST_REF_MM = 1000;      // largo del cordón de referencia
const TOL_DIST = 0.12;         // ±12 % antes de pausar por distancia
const NIVEL_INICIAL = 0.7;     // 20/100
const PASO = 0.1;
const POR_NIVEL = 5;
const ACIERTOS_PARA_PASAR = 3;
const DIRECCIONES = ["derecha", "abajo", "izquierda", "arriba"];
const TECLAS = { ArrowRight: 0, ArrowDown: 1, ArrowLeft: 2, ArrowUp: 3 };

export const estudio = {
  id: "agudeza",
  nombre: "Agudeza visual",
  requiere: { pose: false },
  badgesPropios: true,
  hint:
    "Prueba de agudeza a un metro. El sujeto señala hacia dónde apuntan las patas de " +
    "la E y el operador registra la respuesta con las flechas del teclado.",

  async iniciar(ctx) {
    this._ctx = ctx;
    this._irisBuf = [];
    this._ref = null;
    this._resultados = { OD: null, OI: null };
    this._ojo = "OD";
    this._fase = "espera";
    this._pausadoPorDistancia = false;
    this._ui = crearUI(this);
    this._onKey = (e) => {
      if (this._fase !== "prueba" || this._pausadoPorDistancia) return;
      const d = TECLAS[e.key];
      if (d === undefined) return;
      e.preventDefault();
      this.responder(d);
    };
    window.addEventListener("keydown", this._onKey);

    this._pxPorMm = escalaPantalla();
    if (!this._pxPorMm) {
      this._ui.capa.hidden = true;
      this._pxPorMm = await pedirCalibracionTarjeta();
      this._ui.capa.hidden = false;
    }
    this._fase = "distancia";
    this._ui.mostrarDistancia();
    ctx.setStatus("Calibrando distancia de examen…");
  },

  porFrame(ctx, s) {
    if (!s) {
      this._ui.badge("Sin rostro — el sujeto debe mirar a la cámara", "bad");
      return;
    }
    // Se usa el iris del ojo en prueba: el ojo tapado devuelve landmarks poco fiables.
    const px = this._fase === "prueba" ? s.iris[this._ojo].diameter
                                       : (s.iris.OD.diameter + s.iris.OI.diameter) / 2;
    this._irisBuf.push(px);
    if (this._irisBuf.length > 20) this._irisBuf.shift();
    const irisPx = median(this._irisBuf);

    if (this._fase === "distancia") {
      this._irisActual = irisPx;
      this._ui.badge("Rostro detectado — listo para fijar la distancia", "ok");
      return;
    }

    if (this._fase === "prueba" && this._ref) {
      const d = distanciaMm(irisPx, this._ref);
      this._distancia = d;
      const desvio = Math.abs(d - DIST_REF_MM) / DIST_REF_MM;
      const fuera = desvio > TOL_DIST;
      if (fuera !== this._pausadoPorDistancia) {
        this._pausadoPorDistancia = fuera;
        this._ui.pausa(fuera, d < DIST_REF_MM ? "Aléjese" : "Acérquese");
      }
      this._ui.badge(
        `Distancia ${Math.round(d)} mm · ojo ${this._ojo}`,
        fuera ? "warn" : "ok"
      );
    }
  },

  // --------- Flujo ---------
  fijarDistancia() {
    if (!this._irisActual) return;
    this._ref = { distanciaMm: DIST_REF_MM, irisPx: this._irisActual };
    this._piso = pisoLogMAR(DIST_REF_MM, this._pxPorMm);
    this._fase = "prueba";
    this.empezarOjo("OD");
  },

  empezarOjo(ojo) {
    this._ojo = ojo;
    this._nivel = NIVEL_INICIAL;
    this._aciertos = 0;
    this._presentados = 0;
    this._ultimoAprobado = null;
    this._irisBuf = [];
    this._esperando = true; // no se admiten respuestas hasta que haya optotipo
    this._ui.mostrarInstruccionOjo(ojo, () => this.siguienteOptotipo());
  },

  siguienteOptotipo() {
    if (this._fase !== "prueba") return;
    if (this._nivel < this._piso) return this.terminarOjo();
    this._orientacion = Math.floor(Math.random() * 4);
    const trazo = trazoPx(this._nivel, this._distancia || DIST_REF_MM, this._pxPorMm);
    this._ui.dibujarE(trazo, this._orientacion, this._nivel, this._ojo);
    this._esperando = false; // ya hay optotipo en pantalla: se admite respuesta
  },

  // `_esperando` evita que una segunda pulsación rápida cuente como otra respuesta
  // al mismo optotipo, que falsearía el nivel de agudeza.
  responder(dir) {
    if (this._fase !== "prueba" || this._esperando) return;
    this._esperando = true;
    this._presentados++;
    if (dir === this._orientacion) this._aciertos++;
    this._ui.marcar(dir === this._orientacion);

    if (this._presentados < POR_NIVEL) return setTimeout(() => this.siguienteOptotipo(), 220);

    if (this._aciertos >= ACIERTOS_PARA_PASAR) {
      this._ultimoAprobado = this._nivel;
      this._nivel = Math.round((this._nivel - PASO) * 100) / 100;
      this._aciertos = 0; this._presentados = 0;
      return setTimeout(() => this.siguienteOptotipo(), 220);
    }
    this.terminarOjo();
  },

  terminarOjo() {
    if (this._fase !== "prueba") return;
    this._resultados[this._ojo] = {
      logMAR: this._ultimoAprobado,
      pisoAlcanzado: this._ultimoAprobado != null && this._ultimoAprobado <= this._piso + 1e-9,
    };
    if (this._ojo === "OD") return this.empezarOjo("OI");
    this._fase = "fin";
    this._ctx.finish();
  },

  terminar() {
    window.removeEventListener("keydown", this._onKey);
    if (this._ui) this._ui.destruir();
    if (!this._ref) return { abortado: true };
    return {
      resultados: this._resultados,
      piso: this._piso,
      pxPorMm: this._pxPorMm,
      distanciaMm: DIST_REF_MM,
    };
  },

  render(res) {
    if (!res || res.abortado) {
      return {
        title: "Agudeza visual",
        note: "La prueba no llegó a iniciarse (no se fijó la distancia de examen).",
      };
    }
    const linea = (ojo) => {
      const r = res.resultados[ojo];
      if (!r || r.logMAR == null) return "peor que " + SNELLEN(NIVEL_INICIAL);
      return `${SNELLEN(r.logMAR)} (logMAR ${fmt(r.logMAR, 2)})`;
    };
    return {
      title: "Agudeza visual",
      note:
        `Medida a ${res.distanciaMm / 1000} m con E direccional. Esta pantalla ` +
        `(${fmt(res.pxPorMm, 2)} px/mm) no permite dibujar optotipos por debajo de ` +
        `${SNELLEN(res.piso)}: ese es el límite del equipo, no del ojo.`,
      rows: [
        {
          label: "Agudeza sin corrección",
          od: linea("OD"), oi: linea("OI"),
          reading: "Último nivel superado con 3 de 5 aciertos.",
        },
      ],
      flags: banderas(res),
    };
  },
};

function banderas(res) {
  const f = [];
  const peor = ["OD", "OI"]
    .map((o) => res.resultados[o]?.logMAR)
    .filter((v) => v != null);

  if (!peor.length) {
    f.push(["warn", "Ningún ojo superó el nivel inicial. Repetir la prueba y, si se confirma, derivar a optometría."]);
    return f;
  }
  const max = Math.max(...peor);
  if (max > 0.3) {
    f.push(["warn", `Agudeza por debajo de ${SNELLEN(0.3)} en al menos un ojo. Derivar a valoración optométrica.`]);
  } else {
    f.push(["ok", `Agudeza de ${SNELLEN(0.3)} o mejor en ambos ojos evaluados.`]);
  }
  if (["OD", "OI"].every((o) => res.resultados[o]?.pisoAlcanzado)) {
    f.push(["warn", "Ambos ojos llegaron al límite que puede dibujar esta pantalla: la agudeza real podría ser mejor que la reportada."]);
  }
  f.push(["ok", "La distancia se verificó con la cámara durante toda la prueba; si el sujeto se movía, la prueba se pausaba."]);
  return f;
}

// --------- Capa de interacción ---------
function crearUI(est) {
  const capa = document.createElement("div");
  capa.className = "agudeza";
  capa.innerHTML = `
    <div class="agudeza-barra">
      <span class="badge" id="agBadge"></span>
      <span class="agudeza-nivel" id="agNivel"></span>
    </div>
    <div class="agudeza-centro" id="agCentro"></div>
    <div class="agudeza-pausa" id="agPausa" hidden></div>
    <div class="agudeza-pie" id="agPie"></div>`;
  document.body.appendChild(capa);

  const centro = capa.querySelector("#agCentro");
  const pie = capa.querySelector("#agPie");
  const pausa = capa.querySelector("#agPausa");
  const badgeEl = capa.querySelector("#agBadge");
  const nivelEl = capa.querySelector("#agNivel");
  const dpr = window.devicePixelRatio || 1;

  const api = {
    capa,
    badge(texto, tipo) {
      badgeEl.textContent = texto;
      badgeEl.className = "badge " + (tipo || "");
    },
    mostrarDistancia() {
      centro.innerHTML = `
        <div class="agudeza-msg">
          <h2>Distancia de examen</h2>
          <p>Ubique al sujeto a <strong>1 metro</strong> de la pantalla usando el cordón
             de referencia. Cuando esté en posición y con el rostro detectado, fije la
             distancia: a partir de ahí la cámara la vigila sola.</p>
        </div>`;
      pie.innerHTML = "";
      const b = document.createElement("button");
      b.className = "btn primary";
      b.textContent = "Fijar distancia";
      b.addEventListener("click", () => est.fijarDistancia());
      pie.appendChild(b);
    },
    mostrarInstruccionOjo(ojo, seguir) {
      const tapado = ojo === "OD" ? "izquierdo" : "derecho";
      centro.innerHTML = `
        <div class="agudeza-msg">
          <h2>Ojo ${ojo === "OD" ? "derecho" : "izquierdo"}</h2>
          <p>Pida al sujeto que se tape el ojo <strong>${tapado}</strong> sin presionarlo.
             Debe señalar con la mano hacia dónde apuntan las patas de la E.</p>
        </div>`;
      pie.innerHTML = "";
      const b = document.createElement("button");
      b.className = "btn primary";
      b.textContent = "Comenzar";
      b.addEventListener("click", seguir);
      pie.appendChild(b);
    },
    dibujarE(trazoCss, orientacion, nivel, ojo) {
      nivelEl.textContent = `${SNELLEN(nivel)} · ojo ${ojo}`;
      const u = Math.max(1, Math.round(trazoCss * dpr));
      const lado = u * 5;
      const pad = u * 2;
      const c = document.createElement("canvas");
      c.width = lado + pad * 2; c.height = lado + pad * 2;
      c.style.width = (c.width / dpr) + "px";
      c.style.height = (c.height / dpr) + "px";
      const g = c.getContext("2d");
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      g.save();
      g.translate(c.width / 2, c.height / 2);
      g.rotate(orientacion * Math.PI / 2);
      g.translate(-lado / 2, -lado / 2);
      g.fillStyle = "#000";
      g.fillRect(0, 0, u, lado);          // columna
      g.fillRect(0, 0, lado, u);          // pata superior
      g.fillRect(0, u * 2, lado, u);      // pata media
      g.fillRect(0, u * 4, lado, u);      // pata inferior
      g.restore();
      centro.innerHTML = "";
      centro.appendChild(c);
      api.pintarBotones();
    },
    pintarBotones() {
      pie.innerHTML = "";
      DIRECCIONES.forEach((d, i) => {
        const b = document.createElement("button");
        b.className = "btn ghost";
        b.textContent = { 0: "→", 1: "↓", 2: "←", 3: "↑" }[i] + " " + d;
        b.addEventListener("click", () => est.responder(i));
        pie.appendChild(b);
      });
    },
    marcar(ok) {
      centro.classList.add(ok ? "acierto" : "fallo");
      setTimeout(() => centro.classList.remove("acierto", "fallo"), 200);
    },
    pausa(activa, texto) {
      pausa.hidden = !activa;
      pausa.textContent = activa ? texto + " — vuelva a un metro para continuar" : "";
    },
    destruir() { capa.remove(); },
  };
  return api;
}
