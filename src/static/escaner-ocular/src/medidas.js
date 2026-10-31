// Medidas — convierte landmarks y píxeles en números. Sin DOM y sin estado global:
// todo lo que necesita entra por parámetro, para poder probarlo aislado.

// --------- Constantes anatómicas / configuración ---------
export const IRIS_DIAMETER_MM = 11.7; // diámetro horizontal medio del iris humano: sirve de "regla" de escala
export const EAR_OPEN = 0.18;         // umbral de apertura ocular (Eye Aspect Ratio) para considerar el ojo abierto
export const CROP_PAD = 0.9;          // margen alrededor del ojo al recortar (proporción del ancho del ojo)
export const UPSCALE = 4;             // factor de realce del recorte del ojo
export const SHARPEN = 0.7;           // intensidad del enfoque (unsharp)

// Índices de landmarks de MediaPipe (malla facial refinada).
// "OD" = ojo derecho del sujeto; "OI" = ojo izquierdo del sujeto.
export const OD = {
  outer: 33, inner: 133, top: 159, bottom: 145,
  irisRing: [469, 470, 471, 472], irisCenter: 468,
  contour: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
};
export const OI = {
  outer: 263, inner: 362, top: 386, bottom: 374,
  irisRing: [474, 475, 476, 477], irisCenter: 473,
  contour: [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466],
};

export const EYES = [["OD", OD], ["OI", OI]];

// --------- Geometría básica ---------

// Coordenada en píxeles de un landmark
export function P(lm, i, W, H) { return { x: lm[i].x * W, y: lm[i].y * H }; }
export function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

export function earOf(lm, eye, W, H) {
  const v = dist(P(lm, eye.top, W, H), P(lm, eye.bottom, W, H));
  const h = dist(P(lm, eye.outer, W, H), P(lm, eye.inner, W, H));
  return h > 0 ? v / h : 0;
}

export function irisOf(lm, eye, W, H) {
  const r = eye.irisRing.map((i) => P(lm, i, W, H));
  const d1 = dist(r[0], r[2]); // diámetro horizontal
  const d2 = dist(r[1], r[3]); // diámetro vertical
  const c = P(lm, eye.irisCenter, W, H);
  return { center: c, diameter: (d1 + d2) / 2 };
}

// --------- Muestra por frame ---------
// Barata: solo geometría. La calculamos UNA vez por frame en app.js y la comparten
// todos los estudios, para no repetir irisOf() cinco veces.
export function sampleOf(lm, W, H, t) {
  const ear = { OD: earOf(lm, OD, W, H), OI: earOf(lm, OI, W, H) };
  const iris = { OD: irisOf(lm, OD, W, H), OI: irisOf(lm, OI, W, H) };
  const avgIris = (iris.OD.diameter + iris.OI.diameter) / 2;
  const sizeFrac = W > 0 ? avgIris / W : 0;

  const eyesOpen = ear.OD >= EAR_OPEN && ear.OI >= EAR_OPEN;
  const closeEnough = sizeFrac >= 0.045; // acércate si el iris es muy pequeño
  const notTooClose = sizeFrac <= 0.18;

  return {
    t, lm, W, H, ear, iris, sizeFrac,
    quality: { eyesOpen, closeEnough, notTooClose, ready: eyesOpen && closeEnough && notTooClose },
  };
}

// Movimiento entre frames, normalizado por el tamaño del iris (para que no dependa
// de la distancia a la cámara). Suavizado con una media exponencial.
// Es una fábrica y no una variable de módulo para que cada consumidor lleve su propio
// estado y reiniciarlo no afecte a los demás.
export function createMotionMeter() {
  let prev = null;
  let ema = 1; // arranca alto para no dar por "quieto" el primer frame
  return {
    measure(sample) {
      const a = sample.iris.OD, b = sample.iris.OI;
      const scale = (a.diameter + b.diameter) / 2;
      let m = 1;
      if (prev && scale > 0) {
        m = (dist(a.center, prev.OD) + dist(b.center, prev.OI)) / 2 / scale;
      }
      prev = { OD: a.center, OI: b.center };
      ema = ema * 0.6 + m * 0.4;
      return ema;
    },
    reset() { prev = null; ema = 1; },
  };
}

// --------- Medidas sobre píxeles (requieren el frame congelado) ---------

export function analyzeEye(lm, eye, W, H, cctx) {
  const iris = irisOf(lm, eye, W, H);
  const ear = earOf(lm, eye, W, H);
  const mmPerPx = IRIS_DIAMETER_MM / iris.diameter;

  // recorte del ojo (caja a partir del contorno + margen)
  const pts = eye.contour.map((i) => P(lm, i, W, H));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  pts.forEach((p) => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
  const bw = maxX - minX, bh = maxY - minY;
  const padX = bw * CROP_PAD, padY = bh * CROP_PAD * 1.2;
  const cx0 = Math.max(0, Math.floor(minX - padX));
  const cy0 = Math.max(0, Math.floor(minY - padY));
  const cw = Math.min(W - cx0, Math.ceil(bw + padX * 2));
  const ch = Math.min(H - cy0, Math.ceil(bh + padY * 2));

  const pupil = estimatePupil(iris.center, iris.diameter / 2, cctx, W, H);
  const redness = scleraRedness(lm, eye, iris, W, H, cctx);

  return {
    irisDiameterPx: iris.diameter,
    irisDiameterMm: IRIS_DIAMETER_MM, // por definición es la regla
    mmPerPx,
    ear,
    pupilRatio: pupil.ratio,
    pupilDiameterMm: pupil.ratio != null ? pupil.ratio * IRIS_DIAMETER_MM : null,
    redness,
    crop: { x: cx0, y: cy0, w: cw, h: ch },
  };
}

// Estima el radio de la pupila buscando la mancha oscura central dentro del iris.
// Burdo y sensible a reflejos: se reporta como EXPERIMENTAL.
export function estimatePupil(center, irisRadius, cctx, canvasW, canvasH) {
  const r = Math.round(irisRadius);
  if (r < 4) return { ratio: null };
  const x0 = Math.max(0, Math.round(center.x - r));
  const y0 = Math.max(0, Math.round(center.y - r));
  const size = Math.min(r * 2, canvasW - x0, canvasH - y0);
  if (size < 6) return { ratio: null };
  const img = cctx.getImageData(x0, y0, size, size).data;
  const cxl = center.x - x0, cyl = center.y - y0;

  // luminancia mínima/media dentro del círculo del iris
  let min = 255, sum = 0, n = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (Math.hypot(x - cxl, y - cyl) > irisRadius) continue;
      const i = (y * size + x) * 4;
      const L = 0.299 * img[i] + 0.587 * img[i + 1] + 0.114 * img[i + 2];
      min = Math.min(min, L); sum += L; n++;
    }
  }
  if (!n) return { ratio: null };
  const mean = sum / n;
  const thr = min + (mean - min) * 0.45; // píxeles "de pupila": claramente más oscuros que la media

  // cuenta píxeles oscuros dentro del 75% del iris
  let dark = 0;
  const inner = irisRadius * 0.75;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (Math.hypot(x - cxl, y - cyl) > inner) continue;
      const i = (y * size + x) * 4;
      const L = 0.299 * img[i] + 0.587 * img[i + 1] + 0.114 * img[i + 2];
      if (L <= thr) dark++;
    }
  }
  const pupilRadius = Math.sqrt(dark / Math.PI);
  const ratio = pupilRadius / irisRadius;
  // descarta resultados implausibles
  if (ratio < 0.15 || ratio > 0.85) return { ratio: null };
  return { ratio };
}

// Ratio pupila/iris de ambos ojos sobre el frame actual. Lo usa el estudio de pupilas,
// que sí necesita medir píxeles en cada frame (el resto de estudios no paga ese costo).
export function measurePupils(sample, cctx) {
  const out = {};
  for (const [key, eye] of EYES) {
    const iris = sample.iris[key];
    out[key] = estimatePupil(iris.center, iris.diameter / 2, cctx, sample.W, sample.H).ratio;
  }
  return out;
}

// Índice de enrojecimiento: muestrea la esclera entre el iris y la comisura externa.
export function scleraRedness(lm, eye, iris, W, H, cctx) {
  const outer = P(lm, eye.outer, W, H);
  // punto a mitad de camino entre el centro del iris y la comisura externa
  const sx = (iris.center.x + outer.x) / 2;
  const sy = (iris.center.y + outer.y) / 2;
  const box = Math.max(3, Math.round(iris.diameter * 0.18));
  const x0 = Math.max(0, Math.round(sx - box));
  const y0 = Math.max(0, Math.round(sy - box));
  const w = Math.min(box * 2, W - x0), h = Math.min(box * 2, H - y0);
  if (w < 2 || h < 2) return null;
  const d = cctx.getImageData(x0, y0, w, h).data;
  let R = 0, G = 0, B = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; n++; }
  R /= n; G /= n; B /= n;
  // sólo tiene sentido sobre zonas claras (esclera); índice = rojo vs verde/azul
  return (R * 2) / Math.max(1, G + B);
}

// --------- Realce del recorte del ojo ---------

// Devuelve un canvas con el recorte ampliado y enfocado. Sin tocar el DOM de la página.
export function croppedEye(captureCanvas, crop, scale = UPSCALE) {
  const src = document.createElement("canvas");
  src.width = crop.w; src.height = crop.h;
  src.getContext("2d").drawImage(
    captureCanvas, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h
  );
  return enhance(src, scale);
}

function enhance(srcCanvas, scale) {
  const out = document.createElement("canvas");
  out.width = srcCanvas.width * scale;
  out.height = srcCanvas.height * scale;
  const ctx = out.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(srcCanvas, 0, 0, out.width, out.height);
  sharpen(ctx, out.width, out.height, SHARPEN);
  return out;
}

// Unsharp mask sencillo (kernel de realce de bordes).
function sharpen(ctx, w, h, amount) {
  const src = ctx.getImageData(0, 0, w, h);
  const s = src.data;
  const dst = ctx.createImageData(w, h);
  const d = dst.data;
  const k = [0, -amount, 0, -amount, 1 + 4 * amount, -amount, 0, -amount, 0];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      for (let c = 0; c < 3; c++) {
        let acc = 0, ki = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            acc += s[((y + dy) * w + (x + dx)) * 4 + c] * k[ki++];
          }
        }
        const i = (y * w + x) * 4 + c;
        d[i] = acc < 0 ? 0 : acc > 255 ? 255 : acc;
      }
      d[(y * w + x) * 4 + 3] = 255;
    }
  }
  ctx.putImageData(dst, 0, 0);
}

// --------- Verificación de oclusión ---------
// Un ojo tapado por la palma deja de parecer un ojo: desaparece el disco oscuro del
// iris contra la esclera clara y queda piel casi uniforme. Se mide como contraste de
// luminancia dentro de la caja del ojo.
//
// La decisión NO usa un umbral absoluto sino la comparación entre ambos ojos: el
// destapado da la referencia y el tapado debe caer muy por debajo. Así no depende del
// tono de piel, de la cámara ni de la luz del cuarto — el mismo criterio que se usa
// para la anisocoria.

export function eyeBox(lm, eye, W, H) {
  const pts = eye.contour.map((i) => P(lm, i, W, H));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  pts.forEach((p) => {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  });
  const x = Math.max(0, Math.floor(minX));
  const y = Math.max(0, Math.floor(minY));
  return { x, y, w: Math.min(W - x, Math.ceil(maxX - minX)), h: Math.min(H - y, Math.ceil(maxY - minY)) };
}

/** Contraste (percentil 90 − percentil 10 de luminancia) dentro de la caja del ojo. */
export function eyeContrast(lm, eye, W, H, cctx) {
  const b = eyeBox(lm, eye, W, H);
  if (b.w < 6 || b.h < 4) return null;
  const d = cctx.getImageData(b.x, b.y, b.w, b.h).data;
  // Histograma en vez de ordenar: es O(n) y los percentiles salen exactos.
  const hist = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    hist[(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0]++;
    n++;
  }
  if (!n) return null;
  const percentil = (p) => {
    const objetivo = n * p;
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= objetivo) return v; }
    return 255;
  };
  return percentil(0.9) - percentil(0.1);
}

/**
 * @returns {{OD:number|null, OI:number|null, cubierto:'OD'|'OI'|null, razon:number|null}}
 * `cubierto` es el ojo que parece tapado, o null si ambos se ven abiertos.
 */
export function occlusionState(sample, cctx, razonMax = 0.45) {
  const OD_ = eyeContrast(sample.lm, OD, sample.W, sample.H, cctx);
  const OI_ = eyeContrast(sample.lm, OI, sample.W, sample.H, cctx);
  if (OD_ == null || OI_ == null) return { OD: OD_, OI: OI_, cubierto: null, razon: null };
  const alto = Math.max(OD_, OI_);
  if (alto <= 0) return { OD: OD_, OI: OI_, cubierto: null, razon: null };
  const razon = Math.min(OD_, OI_) / alto;
  if (razon > razonMax) return { OD: OD_, OI: OI_, cubierto: null, razon };
  return { OD: OD_, OI: OI_, cubierto: OD_ < OI_ ? "OD" : "OI", razon };
}
