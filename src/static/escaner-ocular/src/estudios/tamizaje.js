// Estudio: tamizaje estático. Congela un frame con pose válida y mide sobre él.
// Es el estudio original de la app y sigue siendo la base del informe.
import { EYES, analyzeEye, croppedEye } from "../medidas.js";
import { fmt } from "../reporte.js";

export const estudio = {
  id: "tamizaje",
  nombre: "Tamizaje estático",
  requiere: { pose: true },   // espera pose válida y quieta, y dispara solo
  hint:
    "Acerque su rostro, mire a la cámara con los ojos bien abiertos y buena iluminación " +
    "frontal suave. La foto se toma sola cuando los avisos estén en verde y usted " +
    "permanezca quieto: no necesita tocar nada ni apartar la mirada de la cámara.",

  iniciar(ctx) {
    ctx.setStatus("Centre su rostro frente a la cámara.");
  },

  // Lo llama app.js cuando la pose se sostuvo el tiempo requerido.
  onPose(ctx, sample) {
    const W = ctx.captureCanvas.width, H = ctx.captureCanvas.height;
    ctx.cctx.drawImage(ctx.video, 0, 0, W, H);

    const eyes = {};
    const crops = {};
    for (const [key, eye] of EYES) {
      eyes[key] = analyzeEye(sample.lm, eye, W, H, ctx.cctx);
      crops[key] = croppedEye(ctx.captureCanvas, eyes[key].crop);
    }
    this._resultado = { eyes, crops };
    ctx.finish();
  },

  terminar() {
    return this._resultado || null;
  },

  render(res) {
    if (!res) return null;
    const { eyes, crops } = res;
    return {
      title: "Tamizaje estático",
      media: [
        { caption: "Ojo derecho (OD)", canvas: crops.OD, downloadName: "ojo_OD.png" },
        { caption: "Ojo izquierdo (OI)", canvas: crops.OI, downloadName: "ojo_OI.png" },
      ],
      rows: [
        {
          label: "Diámetro de iris (px)",
          od: fmt(eyes.OD.irisDiameterPx, 0), oi: fmt(eyes.OI.irisDiameterPx, 0),
          reading: "Tamaño aparente del iris en la imagen (base de la escala).",
        },
        {
          label: "Escala estimada (mm/px)",
          od: fmt(eyes.OD.mmPerPx, 3), oi: fmt(eyes.OI.mmPerPx, 3),
          reading: "Asume iris ≈ 11.7 mm. Aproximada.",
        },
        {
          label: "Apertura ocular (EAR)",
          od: fmt(eyes.OD.ear, 2), oi: fmt(eyes.OI.ear, 2),
          reading: "Relación alto/ancho del ojo. Menor = más cerrado.",
        },
        {
          label: "Pupila / iris (ratio)",
          od: fmt(eyes.OD.pupilRatio, 2), oi: fmt(eyes.OI.pupilRatio, 2),
          reading: "Proporción de la pupila respecto al iris.", exp: true,
        },
        {
          label: "Diámetro de pupila ≈ (mm)",
          od: fmt(eyes.OD.pupilDiameterMm, 1), oi: fmt(eyes.OI.pupilDiameterMm, 1),
          reading: "Estimación derivada del ratio × 11.7 mm.", exp: true,
        },
        {
          label: "Índice de enrojecimiento",
          od: fmt(eyes.OD.redness, 2), oi: fmt(eyes.OI.redness, 2),
          reading: "Rojo vs verde/azul en la esclera. Mayor = más rojo.",
        },
      ],
      flags: banderas(eyes),
    };
  },
};

// Banderas orientativas (nunca diagnósticas).
function banderas(res) {
  const flags = [];

  // Enrojecimiento
  const red = [res.OD.redness, res.OI.redness].filter((v) => v != null);
  if (red.length && Math.max(...red) > 1.35) {
    flags.push(["warn", "Enrojecimiento ocular aparente por encima de lo típico. Confirmar visualmente."]);
  } else if (red.length) {
    flags.push(["ok", "Sin enrojecimiento marcado detectado."]);
  }

  // Asimetría de apertura
  if (Math.abs(res.OD.ear - res.OI.ear) > 0.07) {
    flags.push(["warn", "Diferencia notable en la apertura de los ojos (posible ptosis o entrecierre). Revisar."]);
  }

  // La pupila en una sola condición de luz no distingue una anisocoria fisiológica
  // (frecuente y benigna) de una patológica: eso lo decide el estudio de pupilas,
  // que mide en luz y en penumbra. Aquí solo se reporta si la medida fue posible.
  if (res.OD.pupilRatio == null || res.OI.pupilRatio == null) {
    flags.push(["warn", "No se pudo estimar la pupila de forma confiable (reflejos / nitidez). Repetir con mejor luz."]);
  }

  return flags;
}
