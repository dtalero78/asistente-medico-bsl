// Estudio: pupilas — anisocoria discriminada por condición de luz, más reflejo
// fotomotor (experimental).
//
// Por qué dos condiciones: la anisocoria fisiológica es benigna y muy frecuente, así
// que una diferencia medida bajo una sola luz no distingue lo banal de lo relevante.
// Lo que discrimina es cómo cambia con la luz — la vía simpática se nota en penumbra
// y la parasimpática con luz.
import { median, stdev } from "../serie.js";
import { measurePupils } from "../medidas.js";
import { fmt, sparkline } from "../reporte.js";

// Guion de fases. `medir` activa la lectura de píxeles, que es cara: durante la
// adaptación no hace falta y no se paga.
// Se exporta porque la guía por voz del médico virtual (static/js/ojos.js) cuadra su narración
// con estas fases: habla en la adaptación y calla mientras se mide.
export const PLAN = [
  { fase: "blanco", dur: 10000, medir: false, etiqueta: null,        msg: "Adaptando a la luz… mire el punto" },
  { fase: "blanco", dur: 3000,  medir: true,  etiqueta: "luz",       msg: "Midiendo con luz…" },
  { fase: "rojo",   dur: 15000, medir: false, etiqueta: null,        msg: "Adaptando a la penumbra… mire el punto" },
  { fase: "rojo",   dur: 3000,  medir: true,  etiqueta: "penumbra",  msg: "Midiendo en penumbra…" },
  { fase: "rojo",   dur: 1000,  medir: true,  etiqueta: "plr-base",  msg: "No aparte la mirada…" },
  { fase: "blanco", dur: 1500,  medir: true,  etiqueta: "plr-flash", msg: "…" },
];

const RUIDO_MIN = 0.05;      // resolución mínima creíble del estimador de pupila (en ratio)
const PLR_COBERTURA = 0.8;   // fracción mínima de frames con pupila válida para reportar PLR
const PLR_CAIDA = 0.95;      // se considera iniciada la constricción bajo el 95% del basal

export const estudio = {
  id: "pupilas",
  nombre: "Pupilas",
  requiere: { pose: false },
  hint:
    "La pantalla va a cambiar de brillo. Mire el punto central sin apartar la vista y " +
    "sin acercarse. Al final habrá un destello breve de luz blanca.",

  iniciar(ctx) {
    this._t0 = 0;
    this._muestras = [];
    this._etapa = -1;
    ctx.setStatus("Preparando la prueba de pupilas…");
  },

  porFrame(ctx, s) {
    const t = performance.now();
    if (!this._t0) this._t0 = t;
    const transcurrido = t - this._t0;

    // ¿En qué etapa del guion estamos?
    let acumulado = 0, idx = -1;
    for (let i = 0; i < PLAN.length; i++) {
      acumulado += PLAN[i].dur;
      if (transcurrido < acumulado) { idx = i; break; }
    }
    if (idx === -1) { ctx.finish(); return; }

    const etapa = PLAN[idx];
    if (idx !== this._etapa) {
      this._etapa = idx;
      ctx.estimulo.fase(etapa.fase, etapa.msg);
      if (etapa.etiqueta === "plr-flash") this._tFlash = t;
    }

    if (etapa.medir && s) {
      const W = ctx.captureCanvas.width, H = ctx.captureCanvas.height;
      ctx.cctx.drawImage(ctx.video, 0, 0, W, H);
      const r = measurePupils(s, ctx.cctx);
      this._muestras.push({ t, etiqueta: etapa.etiqueta, OD: r.OD, OI: r.OI });
    } else if (etapa.medir) {
      this._muestras.push({ t, etiqueta: etapa.etiqueta, OD: null, OI: null });
    }

    ctx.setStatus(etapa.msg);
  },

  terminar() {
    return analizar(this._muestras, this._tFlash);
  },

  render(res) {
    if (!res) return null;

    const rows = [
      {
        label: "Ratio pupila/iris con luz",
        od: fmt(res.luz.OD, 3), oi: fmt(res.luz.OI, 3),
        reading: "Mediana con la pantalla en blanco.", exp: true,
      },
      {
        label: "Ratio pupila/iris en penumbra",
        od: fmt(res.penumbra.OD, 3), oi: fmt(res.penumbra.OI, 3),
        reading: "Mediana con la pantalla en rojo de baja acción pupilar.", exp: true,
      },
      {
        label: "Diferencia entre ojos (luz)",
        value: fmt(res.deltaLuz, 3),
        reading: "Ruido estimado de la medida: ±" + fmt(res.ruido, 3) + ".",
      },
      {
        label: "Diferencia entre ojos (penumbra)",
        value: fmt(res.deltaPenumbra, 3),
        reading: "Solo se considera real si supera el ruido de la medida.",
      },
    ];

    let extra = null;
    if (res.plr.medible) {
      rows.push(
        {
          label: "Constricción al destello",
          od: fmt(res.plr.OD.constriccionPct, 1) + " %", oi: fmt(res.plr.OI.constriccionPct, 1) + " %",
          reading: "Reducción del ratio respecto al basal.", exp: true,
        },
        {
          label: "Latencia del reflejo",
          od: res.plr.OD.latenciaMs == null ? "—" : fmt(res.plr.OD.latenciaMs, 0) + " ms",
          oi: res.plr.OI.latenciaMs == null ? "—" : fmt(res.plr.OI.latenciaMs, 0) + " ms",
          reading: "Resolución de " + fmt(res.plr.resolucionMs, 0) + " ms sobre un fenómeno de ~200 ms: tómese como aproximada.",
          exp: true,
        }
      );
      extra = document.createElement("div");
      extra.className = "spark-wrap";
      const cap = document.createElement("p");
      cap.className = "section-note";
      cap.textContent = "Ratio pupila/iris promedio durante el destello.";
      extra.appendChild(cap);
      extra.appendChild(sparkline(res.plr.curva));
    }

    return {
      title: "Pupilas",
      note:
        "La fase de penumbra usa luz roja, no oscuridad: ilumina para la cámara sin " +
        "contraer la pupila como haría el blanco. Es una penumbra relativa, más débil " +
        "que la adaptación a un cuarto oscuro.",
      rows,
      extra,
      flags: banderas(res),
    };
  },
};

// --------- Análisis ---------
export function analizar(muestras, tFlash) {
  const porEtiqueta = (e) => muestras.filter((m) => m.etiqueta === e);

  const luzM = porEtiqueta("luz");
  const penM = porEtiqueta("penumbra");

  const luz = { OD: median(luzM.map((m) => m.OD)), OI: median(luzM.map((m) => m.OI)) };
  const penumbra = { OD: median(penM.map((m) => m.OD)), OI: median(penM.map((m) => m.OI)) };

  // El ruido se estima de los propios datos en vez de fijar un umbral inventado:
  // este estimador de pupila es burdo y su precisión depende del sujeto y de la luz.
  const sds = [
    stdev(luzM.map((m) => m.OD)), stdev(luzM.map((m) => m.OI)),
    stdev(penM.map((m) => m.OD)), stdev(penM.map((m) => m.OI)),
  ].filter((v) => v != null);
  const ruido = Math.max(RUIDO_MIN, sds.length ? Math.max(...sds) * 2 : RUIDO_MIN);

  const deltaLuz = luz.OD != null && luz.OI != null ? Math.abs(luz.OD - luz.OI) : null;
  const deltaPenumbra = penumbra.OD != null && penumbra.OI != null
    ? Math.abs(penumbra.OD - penumbra.OI) : null;

  return {
    luz, penumbra, deltaLuz, deltaPenumbra, ruido,
    clasificacion: clasificar(deltaLuz, deltaPenumbra, ruido),
    plr: analizarPLR(muestras, tFlash),
  };
}

function clasificar(dLuz, dPen, ruido) {
  if (dLuz == null || dPen == null) return "no-medible";
  const sigLuz = dLuz > ruido;
  const sigPen = dPen > ruido;
  if (!sigLuz && !sigPen) return "sin-anisocoria";
  // Para decir que una condición supera a la otra, la diferencia entre ambas
  // diferencias también tiene que superar el ruido.
  if (dPen - dLuz > ruido) return "mayor-en-penumbra";
  if (dLuz - dPen > ruido) return "mayor-con-luz";
  return "constante";
}

function analizarPLR(muestras, tFlash) {
  const base = muestras.filter((m) => m.etiqueta === "plr-base");
  const flash = muestras.filter((m) => m.etiqueta === "plr-flash");
  if (!base.length || !flash.length || !tFlash) {
    return { medible: false, motivo: "No se registró el destello." };
  }

  const resultado = { medible: true, resolucionMs: null, curva: [] };
  const dts = [];
  for (let i = 0; i < flash.length - 1; i++) dts.push(flash[i + 1].t - flash[i].t);
  resultado.resolucionMs = dts.length ? median(dts) : null;

  for (const ojo of ["OD", "OI"]) {
    const basales = base.map((m) => m[ojo]);
    const durante = flash.map((m) => m[ojo]);
    const cobertura = durante.filter((v) => v != null).length / durante.length;
    const basal = median(basales);
    const sdBasal = stdev(basales);

    // Compuerta estricta: con iris oscuros la pupila se pierde a ratos y una curva
    // con huecos produce números convincentes pero falsos.
    if (cobertura < PLR_COBERTURA || basal == null || (sdBasal != null && sdBasal / basal > 0.15)) {
      return {
        medible: false,
        motivo: "Detección de pupila inestable durante el destello (cobertura " +
                Math.round(cobertura * 100) + " %). Es lo esperable con iris oscuros en luz " +
                "visible: requiere iluminación far-red de 625 nm para ser válido.",
      };
    }

    let minimo = basal, latencia = null;
    for (const m of flash) {
      const v = m[ojo];
      if (v == null) continue;
      if (latencia == null && v < basal * PLR_CAIDA) latencia = m.t - tFlash;
      if (v < minimo) minimo = v;
    }
    resultado[ojo] = {
      basal, minimo,
      constriccionPct: ((basal - minimo) / basal) * 100,
      latenciaMs: latencia,
    };
  }

  resultado.curva = flash.map((m) =>
    m.OD != null && m.OI != null ? (m.OD + m.OI) / 2 : null
  );
  return resultado;
}

function banderas(res) {
  const f = [];
  switch (res.clasificacion) {
    case "sin-anisocoria":
      f.push(["ok", "Sin diferencia pupilar detectable entre ambos ojos en ninguna de las dos condiciones."]);
      break;
    case "constante":
      f.push(["ok", "Diferencia pupilar similar con luz y en penumbra: patrón compatible con anisocoria fisiológica, que es frecuente y benigna."]);
      break;
    case "mayor-en-penumbra":
      f.push(["warn", "La diferencia entre pupilas aumenta en penumbra. Ese patrón apunta a la vía simpática y merece valoración profesional, sobre todo si hay caída del párpado del mismo lado."]);
      break;
    case "mayor-con-luz":
      f.push(["warn", "La diferencia entre pupilas aumenta con luz. Ese patrón apunta a la vía parasimpática y merece valoración profesional."]);
      break;
    default:
      f.push(["warn", "No se pudo medir la pupila de forma confiable en ambas condiciones. Repetir con mejor luz frontal."]);
  }

  if (!res.plr.medible) {
    f.push(["warn", "Reflejo fotomotor no medible. " + res.plr.motivo]);
  } else {
    f.push(["ok", "Reflejo fotomotor registrado. Se reportan amplitud y latencia; la velocidad no es fiable a esta tasa de muestreo."]);
  }
  return f;
}
