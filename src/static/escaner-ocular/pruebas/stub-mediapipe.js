// Stub de @mediapipe/tasks-vision para el banco de pruebas.
// Se inyecta con un import map, así que app.js no necesita saber que existe.
//
// El estado vive en window.__stub y se puede mover desde la prueba para simular
// parpadeos, pérdida de rostro, movimiento o cambios de tamaño pupilar.
const W = 1280, H = 960;

export const GEOM = {
  irisPx: 115,        // diámetro del iris en píxeles
  eyeHalfW: 144,
  eyeHalfH: 49,       // media apertura: EAR = eyeHalfH / eyeHalfW ≈ 0.34
  centros: { OD: { x: 330, y: 403 }, OI: { x: 950, y: 403 } },
};

window.__stub = {
  present: true,
  earScale: 1,      // 1 = ojo abierto; 0 = cerrado del todo
  irisScale: 1,     // escala el iris para simular acercarse o alejarse
  jitterPx: 0,      // movimiento entre frames
  pupilFrac: 0.42,  // ratio pupila/iris que pinta la cámara falsa
  frames: 0,
};

const IDX = {
  OD: {
    outer: 33, inner: 133, top: 159, bottom: 145,
    irisRing: [469, 470, 471, 472], irisCenter: 468,
    contour: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
  },
  OI: {
    outer: 263, inner: 362, top: 386, bottom: 374,
    irisRing: [474, 475, 476, 477], irisCenter: 473,
    contour: [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466],
  },
};

function construir() {
  const s = window.__stub;
  const lm = new Array(478);
  for (let i = 0; i < 478; i++) lm[i] = { x: 0.5, y: 0.5, z: 0 };

  const dx = s.jitterPx ? (s.frames % 2 ? s.jitterPx : -s.jitterPx) : 0;
  const R = (GEOM.irisPx / 2) * s.irisScale;
  const halfW = GEOM.eyeHalfW * s.irisScale;
  const halfH = GEOM.eyeHalfH * s.irisScale * s.earScale;

  const put = (i, xPx, yPx) => { lm[i] = { x: (xPx + dx) / W, y: yPx / H, z: 0 }; };

  for (const ojo of ["OD", "OI"]) {
    const c = GEOM.centros[ojo];
    const idx = IDX[ojo];
    put(idx.outer, c.x - halfW, c.y);
    put(idx.inner, c.x + halfW, c.y);
    put(idx.top, c.x, c.y - halfH);
    put(idx.bottom, c.x, c.y + halfH);
    put(idx.irisCenter, c.x, c.y);
    put(idx.irisRing[0], c.x + R, c.y);
    put(idx.irisRing[1], c.x, c.y - R);
    put(idx.irisRing[2], c.x - R, c.y);
    put(idx.irisRing[3], c.x, c.y + R);
    idx.contour.forEach((li, k) => {
      const a = (k / idx.contour.length) * Math.PI * 2;
      put(li, c.x + Math.cos(a) * halfW, c.y + Math.sin(a) * halfH);
    });
  }
  return lm;
}

export class FilesetResolver {
  static async forVisionTasks() { return {}; }
}

export class FaceLandmarker {
  static async createFromOptions() { return new FaceLandmarker(); }
  close() {}
  detectForVideo() {
    window.__stub.frames++;
    if (!window.__stub.present) return { faceLandmarks: [] };
    return { faceLandmarks: [construir()] };
  }
}

// Cámara falsa: pinta un rostro esquemático donde el stub pone los landmarks, para
// que las medidas que leen píxeles (pupila, enrojecimiento) tengan algo real debajo.
export function camaraFalsa() {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  (function pintar() {
    const s = window.__stub;
    g.fillStyle = "#c99b7a";
    g.fillRect(0, 0, W, H);
    if (s.present) {
      const R = (GEOM.irisPx / 2) * s.irisScale;
      for (const ojo of ["OD", "OI"]) {
        const c0 = GEOM.centros[ojo];
        g.fillStyle = "#f2f0ec";
        g.beginPath();
        g.ellipse(c0.x, c0.y, GEOM.eyeHalfW * s.irisScale,
                  Math.max(2, GEOM.eyeHalfH * s.irisScale * s.earScale), 0, 0, 6.284);
        g.fill();
        g.fillStyle = "#6b4a2f";
        g.beginPath(); g.arc(c0.x, c0.y, R, 0, 6.284); g.fill();
        g.fillStyle = "#0a0a0a";
        g.beginPath(); g.arc(c0.x, c0.y, R * s.pupilFrac, 0, 6.284); g.fill();
      }
    }
    requestAnimationFrame(pintar);
  })();
  return c.captureStream(30);
}
