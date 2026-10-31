// Escáner Ocular — tamizaje visual asistido por cámara (client-side)
// Motor: MediaPipe FaceLandmarker (incluye landmarks de iris refinados, 478 puntos).
// Todo el procesamiento ocurre en el navegador. No se envía nada a ningún servidor.
//
// Este archivo es la cáscara: cámara, bucle de detección, guías en pantalla y la
// compuerta de pose. Las mediciones viven en src/medidas.js y cada prueba en
// src/estudios/. Un estudio nunca toca la cámara ni el bucle.
import {
  FaceLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20";

import { sampleOf, createMotionMeter } from "./src/medidas.js";
import * as reporte from "./src/reporte.js";
import { crearEstimulo } from "./src/estimulo.js";
import { estudio as tamizaje } from "./src/estudios/tamizaje.js";
import { estudio as fatiga } from "./src/estudios/fatiga.js";
import { estudio as pupilas } from "./src/estudios/pupilas.js";
import { estudio as agudeza } from "./src/estudios/agudeza.js";

// Compuerta de pose: dispara sola al sostener una pose válida y quieta, para que el
// sujeto no tenga que mirar un botón (lo que desalinea la toma justo al capturar).
const AUTO_HOLD_MS = 2000;     // cuánto hay que sostener la pose antes del disparo
const AUTO_REARM_MS = 1500;    // margen para reacomodarse al empezar un estudio
const MOTION_TOL = 0.06;       // movimiento máx. por frame, en fracción del diámetro del iris

// --------- Estado / DOM ---------
const $ = (id) => document.getElementById(id);
const video = $("video");
const overlay = $("overlay");
const octx = overlay.getContext("2d");
const captureCanvas = document.createElement("canvas"); // captura a resolución nativa
const cctx = captureCanvas.getContext("2d", { willReadFrequently: true });

const ESTUDIOS = { tamizaje, fatiga, pupilas, agudeza };
const EXAMEN_COMPLETO = ["tamizaje", "fatiga", "pupilas", "agudeza"];

let faceLandmarker = null;
let lastSample = null;
let running = false;
let lastVideoTime = -1;

// Secuencia de estudios
let cola = [];
let estudioActivo = null;
let hayResultados = false;

// Compuerta de pose
let autoEnabled = true;
let readySince = 0;   // instante en que empezó la pose válida (0 = no hay cuenta en curso)
let armedAt = 0;      // no disparar antes de este instante
const motion = createMotionMeter();

const estimulo = crearEstimulo();

// Contexto base que reciben los estudios. Deliberadamente pequeño.
// `finish` no vive aquí: se ata a cada ejecución en siguienteEstudio(), para que un
// temporizador rezagado del estudio anterior no pueda cerrar el que ya está corriendo.
const ctxBase = {
  video, overlay, octx, captureCanvas, cctx, estimulo,
  setStatus,
  setHint,
  setBadges,
};
let ctx = ctxBase;
let runToken = 0;

// --------- Inicialización ---------
async function init() {
  try {
    const resolver = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/wasm"
    );
    faceLandmarker = await FaceLandmarker.createFromOptions(resolver, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numFaces: 1,
    });
  } catch (e) {
    setStatus("Error cargando el modelo (¿sin internet?). " + e.message);
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 960 }, facingMode: "user" },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    // Si el navegador lo permite, fijar la exposición evita que el auto-brillo
    // altere las medidas al cambiar la luz de la pantalla. Casi nunca está soportado.
    try {
      const track = stream.getVideoTracks()[0];
      if (track.getCapabilities && track.getCapabilities().exposureMode) {
        await track.applyConstraints({ advanced: [{ exposureMode: "manual" }] });
      }
    } catch (_) { /* sin control de exposición: se reportan ratios, que lo toleran */ }
  } catch (e) {
    setStatus("No se pudo acceder a la cámara: " + e.message);
    return;
  }

  setStatus("Cámara lista. Centre su rostro.");
  iniciarSecuencia(["tamizaje"]);
}

function setStatus(msg) { $("stageStatus").textContent = msg; }
function setHint(msg) { $("hint").textContent = msg || ""; }
function setBadges(html) { $("qualityBadges").innerHTML = html; }

// --------- Secuencia de estudios ---------
function iniciarSecuencia(ids) {
  reporte.clear();
  hayResultados = false;
  cola = ids.slice();
  $("reportPanel").hidden = true;
  $("capturePanel").hidden = false;
  siguienteEstudio();
}

function siguienteEstudio() {
  const id = cola.shift();
  if (!id) return mostrarReporte();

  estudioActivo = ESTUDIOS[id];
  estimulo.apagar();
  motion.reset();
  readySince = 0;
  armedAt = performance.now() + AUTO_REARM_MS;
  lastVideoTime = -1;
  running = true;

  const token = ++runToken;
  ctx = Object.assign(Object.create(ctxBase), {
    finish: () => { if (token === runToken) finalizarEstudio(); },
  });

  setHint(estudioActivo.hint || "");
  $("studyName").textContent = estudioActivo.nombre;
  $("captureBtn").hidden = !estudioActivo.requiere.pose;
  $("autoWrap").hidden = !estudioActivo.requiere.pose;

  estudioActivo.iniciar(ctx);
  requestAnimationFrame(loop);
}

function finalizarEstudio() {
  if (!estudioActivo) return;
  runToken++; // invalida cualquier callback pendiente de este estudio
  running = false;
  estimulo.apagar();
  const res = estudioActivo.terminar(ctx);
  const seccion = res == null ? null : estudioActivo.render(res);
  if (seccion) { reporte.addSection(seccion); hayResultados = true; }
  shutterBeep(); // avisa que ya puede moverse
  siguienteEstudio();
}

function mostrarReporte() {
  estudioActivo = null;
  running = false;
  if (!hayResultados) {
    reporte.addSection({
      title: "Sin resultados",
      note: "Ningún estudio pudo completarse. Revise la iluminación y vuelva a intentar.",
    });
  }
  reporte.setMeta();
  $("capturePanel").hidden = true;
  $("reportPanel").hidden = false;
}

// --------- Bucle de detección + overlay en vivo ---------
function loop() {
  if (!running) return;
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    sizeCanvases();
    const res = faceLandmarker.detectForVideo(video, performance.now());
    const lm = res.faceLandmarks && res.faceLandmarks[0] ? res.faceLandmarks[0] : null;
    lastSample = lm ? sampleOf(lm, overlay.width, overlay.height, performance.now()) : null;
    draw();
  }
  requestAnimationFrame(loop);
}

function sizeCanvases() {
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) return;
  if (overlay.width !== w) { overlay.width = w; overlay.height = h; }
  if (captureCanvas.width !== w) { captureCanvas.width = w; captureCanvas.height = h; }
}

function draw() {
  const W = overlay.width, H = overlay.height;
  octx.clearRect(0, 0, W, H);

  if (!lastSample) {
    if (!estudioActivo?.badgesPropios) setBadges('<span class="badge bad">Sin rostro</span>');
    $("captureBtn").disabled = true;
    motion.reset();
    readySince = 0;
    // El estado por defecto va antes de porFrame para que el estudio pueda sobreescribirlo.
    setStatus("Centre su rostro frente a la cámara.");
    if (estudioActivo) estudioActivo.porFrame?.(ctx, null);
    return;
  }

  const s = lastSample;
  s.steady = motion.measure(s) <= MOTION_TOL;
  dibujarIris(s);
  if (!estudioActivo?.badgesPropios) actualizarBadges(s);

  // Los estudios temporales corren siempre; los de pose esperan la compuerta.
  if (estudioActivo && !estudioActivo.requiere.pose) {
    estudioActivo.porFrame?.(ctx, s);
    return;
  }

  $("captureBtn").disabled = !s.quality.ready;
  compuertaDePose(s);
}

function dibujarIris(s) {
  const W = s.W;
  for (const key of ["OD", "OI"]) {
    const iris = s.iris[key];
    const open = s.ear[key] >= 0.18;
    octx.strokeStyle = open ? "#2ea043" : "#d29922";
    octx.lineWidth = Math.max(2, W / 400);
    octx.beginPath();
    octx.arc(iris.center.x, iris.center.y, iris.diameter / 2, 0, Math.PI * 2);
    octx.stroke();
    octx.fillStyle = octx.strokeStyle;
    octx.beginPath();
    octx.arc(iris.center.x, iris.center.y, octx.lineWidth, 0, Math.PI * 2);
    octx.fill();
  }
}

function actualizarBadges(s) {
  const q = s.quality;
  const b = [];
  b.push(badge(q.eyesOpen, "Ojos abiertos", "Abra los ojos"));
  b.push(q.closeEnough ? badge(q.notTooClose, "Distancia OK", "Aléjese un poco")
                       : '<span class="badge warn">Acérquese</span>');
  b.push(badge(s.steady, "Quieto", "No se mueva"));
  setBadges(b.join(""));
}

function badge(ok, okText, badText) {
  return ok ? `<span class="badge ok">✓ ${okText}</span>`
            : `<span class="badge warn">${badText}</span>`;
}

// --------- Compuerta de pose (captura automática) ---------
function compuertaDePose(s) {
  const now = performance.now();
  if (autoEnabled && s.quality.ready && s.steady && now >= armedAt) {
    if (!readySince) readySince = now;
  } else {
    readySince = 0;
  }

  if (!autoEnabled) {
    setStatus("Captura automática desactivada. Use el botón cuando esté listo.");
    return;
  }
  if (now < armedAt) { setStatus("Preparando…"); return; }
  if (!readySince) {
    setStatus(s.quality.ready ? "Casi… mantenga la cabeza quieta."
                              : "Ajuste la pose siguiendo los avisos de arriba.");
    return;
  }

  const progress = Math.min(1, (now - readySince) / AUTO_HOLD_MS);
  const remaining = Math.ceil((AUTO_HOLD_MS - (now - readySince)) / 1000);
  drawCountdown(s, progress, remaining);
  setStatus("No se mueva… capturando automáticamente.");

  if (progress >= 1) dispararPose();
}

function dispararPose() {
  if (!lastSample || !estudioActivo) return;
  readySince = 0;
  estudioActivo.onPose(ctx, lastSample);
}

// Anillo de progreso con la cuenta adentro, dibujado en el entrecejo: queda sobre el
// eje de la mirada (no hay que buscar nada fuera del encuadre) y no tapa los ojos.
function drawCountdown(s, progress, remaining) {
  const a = s.iris.OD.center, b = s.iris.OI.center;
  const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
  const sep = Math.hypot(a.x - b.x, a.y - b.y);
  const r = Math.min(sep * 0.28, s.W * 0.09); // cabe entre ambos iris sin taparlos

  octx.lineWidth = Math.max(3, s.W / 220);
  octx.lineCap = "round";
  octx.strokeStyle = "rgba(0,0,0,.35)";
  octx.beginPath();
  octx.arc(cx, cy, r, 0, Math.PI * 2);
  octx.stroke();

  octx.strokeStyle = "#2f81f7";
  octx.beginPath();
  octx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
  octx.stroke();

  octx.font = `700 ${Math.round(r * 1.1)}px system-ui, -apple-system, sans-serif`;
  octx.textAlign = "center";
  octx.textBaseline = "middle";
  octx.fillStyle = "#fff";
  octx.shadowColor = "rgba(0,0,0,.85)";
  octx.shadowBlur = r / 3;
  octx.fillText(String(Math.max(1, remaining)), cx, cy);
  octx.shadowBlur = 0;
}

// Bip corto de obturador. Sin gesto previo del usuario el navegador puede
// bloquear el audio: es un extra, nunca algo de lo que dependa el flujo.
let audioCtx = null;
function shutterBeep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.15, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.16);
  } catch (_) { /* audio no disponible: irrelevante */ }
}

// --------- Acciones de UI ---------
$("captureBtn").addEventListener("click", dispararPose);

$("autoToggle").addEventListener("change", (e) => {
  autoEnabled = e.target.checked;
  readySince = 0;
});

$("printBtn").addEventListener("click", () => window.print());

document.querySelectorAll("[data-estudio]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const id = btn.dataset.estudio;
    iniciarSecuencia(id === "completo" ? EXAMEN_COMPLETO : [id]);
  });
});

// Exponer lo mínimo para el banco de pruebas (pruebas/): no lo usa la app.
window.__escaner = { iniciarSecuencia, ESTUDIOS };

init();
