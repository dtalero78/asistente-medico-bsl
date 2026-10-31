// Estudio: fatiga y calidad del parpadeo (60 s).
//
// Una sola grabación produce dos lecturas —somnolencia y superficie ocular— porque
// ambas salen de la misma señal: el EAR a lo largo del tiempo. No tiene sentido
// sentar al trabajador dos veces para medir lo mismo.
import { percentile, integrateTime, sampleRate, mean } from "../serie.js";
import { fmt, sparkline } from "../reporte.js";

const BASELINE_MS = 10000;   // calibración de "ojo abierto" de este sujeto
const TOTAL_MS = 60000;
const P80 = 0.8;             // criterio PERCLOS: párpado cubre >80% del ojo abierto
const BLINK_ENTER = 0.5;     // entra en parpadeo bajo el 50% del EAR abierto
const BLINK_EXIT = 0.7;      // y sale al recuperar el 70% (histéresis)
const REFRACTORIO_MS = 100;  // dos mínimos más juntos que esto son el mismo parpadeo
const CIERRE_LARGO_MS = 500; // por encima de esto ya no es parpadeo sino cierre sostenido
const DT_MAX_MS = 200;       // saltos mayores = hueco, no se atribuyen a ningún estado

export const estudio = {
  id: "fatiga",
  nombre: "Fatiga y parpadeo",
  requiere: { pose: false },
  hint:
    "Mire a la cámara y parpadee con normalidad durante un minuto. No hable ni se " +
    "acerque: la prueba mide cuánto tiempo permanecen cerrados sus párpados y cómo " +
    "son sus parpadeos.",

  iniciar(ctx) {
    this._t0 = 0;
    this._muestras = [];
    ctx.setStatus("Prepárese… mire a la cámara con naturalidad.");
  },

  porFrame(ctx, s) {
    const t = performance.now();
    if (!this._t0) this._t0 = t;
    const transcurrido = t - this._t0;

    this._muestras.push({
      t,
      ear: s ? (s.ear.OD + s.ear.OI) / 2 : null,
    });

    const restante = Math.max(0, Math.ceil((TOTAL_MS - transcurrido) / 1000));
    if (transcurrido < BASELINE_MS) {
      ctx.setStatus(`Calibrando su apertura normal… ${restante} s`);
    } else {
      ctx.setStatus(`Midiendo parpadeo y fatiga… ${restante} s`);
    }

    if (transcurrido >= TOTAL_MS) ctx.finish();
  },

  terminar() {
    return analizar(this._muestras, this._t0);
  },

  render(res) {
    if (!res) return null;
    if (!res.medible) {
      return {
        title: "Fatiga y parpadeo",
        note: res.motivo,
        flags: [["warn", "Estudio no concluyente. Repetir con el rostro bien encuadrado y buena luz."]],
      };
    }

    const extra = document.createElement("div");
    extra.className = "spark-wrap";
    const cap = document.createElement("p");
    cap.className = "section-note";
    cap.textContent =
      "Apertura ocular durante el minuto. La banda marca el umbral de ojo cerrado (P80).";
    extra.appendChild(cap);
    extra.appendChild(sparkline(res.curva, {
      bands: [{ from: res.umbralCierre, to: 0, color: "rgba(210,153,34,.16)" }],
    }));

    return {
      title: "Fatiga y parpadeo",
      note:
        "Medido sobre " + fmt(res.validoMs / 1000, 0) + " s válidos a " +
        fmt(res.hz, 0) + " Hz. La línea base de ojo abierto se tomó en los primeros " +
        (BASELINE_MS / 1000) + " s.",
      rows: [
        {
          label: "PERCLOS", value: fmt(res.perclos * 100, 1) + " %",
          reading: "Porcentaje del tiempo con el ojo cerrado más del 80 %. El punto de corte debe fijarlo el profesional.",
        },
        {
          label: "Parpadeos por minuto", value: fmt(res.parpadeosPorMin, 1),
          reading: "Referencia descriptiva: 15–20/min en reposo, 9–17/min frente a pantalla.",
        },
        {
          label: "Parpadeos incompletos", value: fmt(res.pctIncompletos, 0) + " %",
          reading: "El párpado no llega a cubrir el ojo. Asociado a exposición de la superficie ocular.",
        },
        {
          label: "Duración media del parpadeo", value: res.duracionMedia == null ? "—" : fmt(res.duracionMedia, 0) + " ms",
          reading: "Se alarga con la somnolencia.",
        },
        {
          label: "Cierres prolongados", value: String(res.cierresLargos),
          reading: "Cierres de más de " + CIERRE_LARGO_MS + " ms: candidatos a microsueño.",
        },
        {
          label: "Tiempo descartado", value: fmt(res.descartadoMs / 1000, 1) + " s",
          reading: "Huecos sin rostro detectado; no se atribuyen a ningún estado.",
        },
      ],
      extra,
      flags: banderas(res),
    };
  },
};

// --------- Análisis ---------
export function analizar(muestras, t0) {
  if (!muestras || muestras.length < 10) {
    return { medible: false, motivo: "No se registraron suficientes muestras." };
  }
  const inicio = t0 || muestras[0].t;

  // Línea base: percentil 85 del EAR en la ventana de calibración.
  // El p85 aproxima el estado abierto sin que los parpadeos lo arrastren hacia abajo,
  // como sí haría la mediana si el sujeto parpadea mucho.
  const cal = muestras.filter((m) => m.t - inicio < BASELINE_MS && m.ear != null);
  const abierto = percentile(cal.map((m) => m.ear), 85);
  if (!abierto || abierto <= 0) {
    return { medible: false, motivo: "No se pudo establecer la apertura ocular de referencia (rostro no detectado al inicio)." };
  }

  // Fracción de cierre, acotada. 0 = totalmente abierto, 1 = totalmente cerrado.
  const medicion = muestras
    .filter((m) => m.t - inicio >= BASELINE_MS)
    .map((m) => ({
      t: m.t,
      ear: m.ear,
      cierre: m.ear == null ? null : Math.min(1, Math.max(0, 1 - m.ear / abierto)),
    }));

  if (medicion.length < 10) {
    return { medible: false, motivo: "La ventana de medición quedó demasiado corta." };
  }

  // PERCLOS ponderado por tiempo. Contar frames sesgaría el resultado cuando la tasa
  // de refresco cae, y cae: MediaPipe compite con el resto de la página.
  // Los frames sin rostro se excluyen del tiempo válido: contarlos equivaldría a
  // darlos por ojo abierto.
  const cerrado = integrateTime(
    medicion,
    (m) => m.cierre > P80,
    DT_MAX_MS,
    (m) => m.cierre != null
  );
  const ventanaMs = medicion[medicion.length - 1].t - medicion[0].t;

  if (cerrado.validMs < ventanaMs * 0.6) {
    return {
      medible: false,
      motivo: "Se perdió el rostro durante más del 40 % de la prueba (" +
              Math.round(cerrado.droppedMs / 1000) + " s sin detección).",
    };
  }

  const { parpadeos, cierresLargos } = detectarParpadeos(medicion, abierto);
  const minutos = cerrado.validMs / 60000;
  const incompletos = parpadeos.filter((p) => p.profundidad < P80).length;

  return {
    medible: true,
    abierto,
    umbralCierre: P80,
    perclos: cerrado.fraction,
    validoMs: cerrado.validMs,
    descartadoMs: cerrado.droppedMs,
    hz: sampleRate(medicion),
    parpadeos: parpadeos.length,
    parpadeosPorMin: minutos > 0 ? parpadeos.length / minutos : null,
    pctIncompletos: parpadeos.length ? (incompletos / parpadeos.length) * 100 : null,
    duracionMedia: mean(parpadeos.map((p) => p.duracion)),
    cierresLargos,
    curva: medicion.map((m) => m.cierre),
  };
}

// Máquina de estados con histéresis: entra bajo el 50 % del EAR abierto y no sale
// hasta recuperar el 70 %, para que el ruido alrededor del umbral no cuente dos veces.
function detectarParpadeos(medicion, abierto) {
  const entra = abierto * BLINK_ENTER;
  const sale = abierto * BLINK_EXIT;
  const parpadeos = [];
  let cierresLargos = 0;

  let dentro = false, tIni = 0, earMin = Infinity, finAnterior = -Infinity;

  for (const m of medicion) {
    if (m.ear == null) {
      // Sin rostro: cerrar cualquier parpadeo en curso sin registrarlo (no sabemos
      // cuándo terminó realmente).
      dentro = false;
      continue;
    }
    if (!dentro && m.ear < entra) {
      if (m.t - finAnterior < REFRACTORIO_MS) continue; // rebote del anterior
      dentro = true; tIni = m.t; earMin = m.ear;
    } else if (dentro) {
      earMin = Math.min(earMin, m.ear);
      if (m.ear > sale) {
        const duracion = m.t - tIni;
        const profundidad = Math.min(1, Math.max(0, 1 - earMin / abierto));
        if (duracion > CIERRE_LARGO_MS) cierresLargos++;
        else parpadeos.push({ duracion, profundidad });
        dentro = false; finAnterior = m.t;
      }
    }
  }
  return { parpadeos, cierresLargos };
}

function banderas(res) {
  const f = [];

  if (res.parpadeosPorMin != null) {
    if (res.parpadeosPorMin < 10) {
      f.push(["warn", "Tasa de parpadeo baja (" + fmt(res.parpadeosPorMin, 1) +
        "/min). Es el patrón descrito en trabajo prolongado con pantalla y se asocia a ojo seco."]);
    } else {
      f.push(["ok", "Tasa de parpadeo dentro del rango descrito como habitual."]);
    }
  }

  if (res.pctIncompletos != null && res.pctIncompletos > 40) {
    f.push(["warn", "Proporción alta de parpadeos incompletos (" + fmt(res.pctIncompletos, 0) +
      " %). Asociado a exposición de la superficie ocular. Umbral no validado en esta población."]);
  }

  if (res.cierresLargos > 0) {
    f.push(["warn", res.cierresLargos + " cierre(s) de más de " + CIERRE_LARGO_MS +
      " ms durante la prueba. Valorar somnolencia antes de tareas de riesgo."]);
  }

  f.push(["ok", "PERCLOS calculado ponderando por tiempo real, no por número de frames."]);
  return f;
}
