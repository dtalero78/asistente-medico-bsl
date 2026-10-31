# Escáner Ocular (`src/static/escaner-ocular/`)

Se trajo de `PUPILOMETRIA/jeelizPupillometry/escaner-ocular` el 31-oct-2026. Vive aquí por dos
razones: el médico virtual corre tres de sus estudios antes de la entrevista (`src/static/js/ojos.js`,
ver el CLAUDE.md de la raíz) y Flask lo sirve tal cual como app de escritorio en
`/static/escaner-ocular/index.html` (los cuatro estudios, con operador).

**Los estudios son compartidos.** Un cambio en `src/estudios/*.js`, `medidas.js` o `serie.js` cambia
lo que mide el médico virtual en el celular de los pacientes. Correr `pruebas/unidad.html` y
`pruebas/integracion.html` (con la app levantada: `http://localhost:5001/static/escaner-ocular/pruebas/…`)
después de tocar cualquier medida.

`PLAN` de `pupilas.js` está exportado porque la voz del médico virtual cuadra su narración con
esas fases (habla en la adaptación, calla mientras se mide). Cambiar duraciones ahí = revisar
`PASOS` en `src/static/js/ojos.js`.

**La app de escritorio no envía nada a ningún servidor**; la prueba de ojos del avatar sí (secciones
de texto y las dos fotos de los ojos, a Spaces con la entrevista). El aviso del `index.html` habla de
la app de escritorio.

### Testing browser code without a webcam

Headless browsers have no camera, so the pipeline stalls at "Inicializando…". To exercise the app logic end to end anyway, stand up a throwaway harness page next to the app (delete it afterwards) that:

1. Remaps the CDN module to a local stub with an **import map** — import maps accept absolute URL keys, so `{"imports": {"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20": "./stub.js"}}` intercepts the static import inside `app.js` without touching `app.js`.
2. Has the stub export fake `FilesetResolver`/`FaceLandmarker` classes whose `detectForVideo()` returns synthetic landmarks you control (identical every frame = perfectly still; jitter them to test motion gates).
3. Overrides `navigator.mediaDevices.getUserMedia` **before** the module script runs, returning a `canvas.captureStream(30)` you paint an eye-like scene into — the pixel-reading code (`estimatePupil`, `scleraRedness`) needs real pixels under the landmarks.

`pruebas/integracion.html` already does all of this for the desktop app. For the avatar's eye test,
the same trick works on a throwaway page under `src/static/` that fetches `/avatar`, injects its body,
fakes `window.LivekitClient` and intercepts `fetch('/avatar/end')` to read the `ojos` payload.
Browsers cache the ES modules: load the harness with a `?v=N` query or hard-reload after edits.

## The app

A standalone occupational eye-screening app in Spanish, built as a **battery of studies**
that share one camera, one detection loop and one report. **Unrelated to the Jeeliz
library** — do not import `JEELIZPUPILLOMETRY` here.

- **Engine:** MediaPipe `FaceLandmarker` (478-point refined mesh, which includes iris
  landmarks), loaded as an ES module from the jsdelivr CDN, with the `.task` model pulled
  from Google Storage. **It needs internet on first load**, unlike the Jeeliz demos.
- **No build, no framework.** Native ES modules; `app.js` is the shell and everything else
  lives under `src/`.
- **Nothing is persisted between sessions** except the screen-scale calibration (not health
  data). Keep it that way: this runs on shared machines.

### Layout and the study contract

```
app.js                shell: camera, loop, on-screen guides, pose gate, study sequencing
src/medidas.js        landmarks and pixels → numbers. No DOM, no module state
src/serie.js          robust statistics + time integration
src/estimulo.js       the screen as a controlled light source
src/calibracion.js    ID-1 card → px/mm; iris → distance
src/reporte.js        section-based report renderer
src/estudios/         tamizaje · fatiga · pupilas · agudeza
pruebas/              permanent test bench (see below)
```

A study never touches the camera or the loop. `app.js` computes the shared per-frame
sample **once** (`sampleOf`) and hands it to the active study:

```js
export const estudio = {
  id, nombre, requiere: { pose }, hint, badgesPropios,
  iniciar(ctx),            // may be async
  porFrame(ctx, muestra),  // muestra === null when no face is detected
  onPose(ctx, muestra),    // only when requiere.pose
  terminar(ctx),           // → result
  render(result),          // → report section spec
};
```

`ctx.finish` is **bound per run with a token**. Do not hoist it back onto the shared ctx:
a stray `setTimeout` from a finished study would otherwise close the study that is
currently running.

### Things that were bugs and must stay fixed

These are cheap to reintroduce and expensive to notice, because each one produces a
plausible-looking number instead of an error:

- **PERCLOS integrates elapsed time, not frame counts** (`integrateTime` in `serie.js`).
  The frame rate is not constant — MediaPipe competes with the rest of the page.
- **Frames without a face are excluded from valid time**, via `integrateTime`'s `esValida`
  predicate. Counting them is equivalent to scoring them as eyes-open, which silently
  deflates PERCLOS.
- **The acuity response handler debounces** (`_esperando`). Two fast key presses would
  otherwise score two answers for one optotype and corrupt the acuity level.

### Physics that constrain the design

- **Acuity is tested at 1 m, not 40 cm.** At 40 cm a 20/20 optotype is 0.6 mm — about two
  pixels on a typical screen, so it cannot be drawn. 1 m is also about as far as the camera
  still detects the face reliably. The screen still imposes a **floor**; it is computed
  (`pisoLogMAR`) and declared in the report rather than silently pretending to precision.
- **Distance is measured relative to a known reference**, `distancia = 1000 × irisPxRef /
  irisPx`. The 11.7 mm iris assumption cancels in that division, so the population spread
  of ±0.42 mm does not enter the distance at all.
- **The pupils study's dark phase is red, not black.** Long-wavelength light drives little
  pupil constriction for its luminance, so it lights the face for the camera without
  constricting the pupil the way white would. It is a *relative* dimness, not dark
  adaptation, and the report says so.
- **Pupil metrics degrade badly on dark irises in visible light.** That is why the PLR has
  a hard coverage gate and reports "no medible" instead of a number. The real fix is
  far-red 625 nm illumination.
- **Anisocoria significance is derived from the data's own noise**, not a fixed threshold —
  this estimator's precision varies by subject and lighting.

### Test bench (`escaner-ocular/pruebas/`)

Permanent, not scratch. `unidad.html` asserts the algorithms with no camera and no DOM
(percentiles, time integration including dropped frames, PERCLOS and blink counts against
hand-computed synthetic series, the four anisocoria patterns, the PLR gate, acuity optics)
and leaves the tally in `window.__pruebas`.

`integracion.html` runs the real app headless: it **fetches `index.html` and injects its
body** rather than duplicating it, remaps the MediaPipe CDN URL through an import map, and
replaces `getUserMedia` with a `canvas.captureStream` that paints eyes where the stub puts
its landmarks — the pupil and redness code reads real pixels, so a blank canvas is not
enough. Drive studies with `window.__escaner.iniciarSecuencia([...])` and simulate blinks,
face loss or pupil changes through `window.__stub`.

Run both after any change to the measurement code.

## Conventions to match

- ES modules with top-level `import`, loaded via `<script type="module">`. Top-level `const` config block, small pure helpers, no classes, no framework.
- Spanish everywhere the user can see it — UI copy, status messages and code comments alike.
- Tunable thresholds are named constants at the top of the file, never inline magic numbers, so they can be calibrated against real subjects without reading the logic.
- Identifiers stay in English, comments and user-facing strings in Spanish. That is what the existing code does; renaming across the refactor would have made the diff unreviewable.
- Anything a professional could read as a number has to carry its uncertainty: report `—` or "no medible" rather than a value the method cannot support, and say in the report what limits it.
