# Prueba de oídos (`src/static/prueba-oidos/`)

Tamizaje auditivo virtual en el celular del paciente, con sus propios audífonos. Va **primero** en
el flujo del avatar (antes de la prueba de ojos; ver el CLAUDE.md de la raíz). Reemplazo propuesto
de `audiometria-virtual.html` de BSL-PLATAFORMA2 (16 MP3 de Wix con 7 beeps, el paciente cuenta
cuántos oyó).

Por qué se rehízo (BD, oct-2026): de 6.688 virtuales en 3 meses, 23 % salen con las 16
frecuencias en 0 dB y 24 % con alguna en ≥50 dB; en 116 pacientes con la virtual y una
presencial (MA 790, Bogotá, intramural) a ≤30 días, la diferencia media es 16 dB. Meta: ≤10 dB.

## Dónde está cada cosa

- `src/` — algoritmos sin DOM, compartidos:
  - `umbral.js`: Hughson-Westlake modificado (baja 10 / sube 5, umbral = 2 aciertos en subida).
    Piso 0 dB HL (bajo eso el celular a 16 bits no reproduce bien), techo 70.
  - `tonos.js`: Web Audio, 3 pulsos de 225 ms con rampas, un oído por canal del ChannelMerger
    (0 = izquierdo, 1 = derecho). Nunca más de -6 dBFS.
  - `microfono.js`: ruido del lugar y detección de parlante (dBFS sin calibrar).
  - `perfiles.js`: dBFS → dB HL por tipo de audífono (calibración, ver abajo).
  - `resultado.js`: PTA4, grado OMS 2021, asimetría (≥15 dB en 2 frecuencias seguidas), caída en
    agudos (3-6k vs 0,5-2k ≥15 dB y >25 dB HL), confiabilidad y veredicto (pasa / remitir / repetir).
  - `audiograma.js`: el SVG del audiograma.
- `../js/oidos.js` — **la cáscara** (flujo, voz, botones, resultado para el paciente). La usan el
  avatar y la página de prueba.
- `index.html` + `demo.js` — la prueba sola, con los mismos estilos del avatar (`avatar.css`,
  sección «Prueba de oídos»). No guarda nada.

## Cómo mide (oidos.js)

1k, 2k, 3k, 4k, 6k, 500 Hz en el derecho, 1 kHz repetido, y lo mismo en el izquierdo. 12 % de
ensayos sin tono (falsos positivos). Ventana de respuesta de 150 ms a 2,5 s desde el inicio del tono
(dura 1,125 s). Era 1,5 s hasta `oidos-2`: la primera paciente real (1-nov-2026, Bluetooth, navegador
de WhatsApp) perdió 45 respuestas por tardías y salió «repetir» sin haber tocado un solo silencio. Un
toque hasta 0,7 s después de cerrar la ventana de un tono es «tardío» y no cuenta como al azar. Espera al azar entre ensayos. Antes de los tonos: tipo de
audífono, ruido (5 s), volumen al máximo con tono de referencia (si el micrófono lo oye fuerte →
sale por parlante) y lateralidad (2 tonos, ¿qué oído?).

- **El micrófono se cierra antes de la lateralidad** y no se vuelve a abrir: con el micrófono
  abierto, los audífonos Bluetooth pasan a «manos libres», que es mono y de banda angosta (nadie
  pasaría la lateralidad y 6 kHz no se reproduciría). En iPhone además cambia la sesión de audio.
- **Práctica** antes de medir (`practicar`): 3 tonos fuertes (40 dB HL, 1 kHz) por los dos oídos;
  con 2 a tiempo sigue, si no la voz explica otra vez (hasta 3 rondas, y sigue igual). No entra en
  los umbrales; queda en `practica` (rondas, latencias, superada). Sin ella, los primeros tonos del
  derecho eran el aprendizaje y salían «sin respuesta» aun a 70 dB.
- La voz calla mientras suenan tonos; antes de cada frecuencia dice «Toca apenas oigas el pitido, y
  solo si lo oyes»: las dos cosas, rápido y solo si lo oye (antes solo decía lo segundo y la gente
  esperaba a estar segura). Los toques fuera de la ventana solo cuentan como «al azar» mientras se mide.
- **Trampa** (tocar sin oír): contestar un silencio → la voz corrige y la frecuencia se repite (hasta
  3 veces). En `resultado.js`, silencios contestados, toques al azar (≥8 % de los ensayos dudosa,
  ≥15 % no confiable) y correcciones (2 dudosa, 3 no confiable) marcan `conducta`: con ella un
  resultado normal sale «repetir», nunca «pasa». Caso de regresión en `pruebas/casos.js`: el
  tramposo del simulador (1 toque cada ~7 s) escondía una muesca de 45 dB y salía «pasa».
- **Abandono**: 4 tonos seguidos ≥ REFERENCIA_HL sin respuesta → «¿Sigues ahí?» (una vez por
  frecuencia, 3 en la prueba) y la frecuencia empieza de nuevo. 2 pausas = dudosa.
- **Fotos**: la cámara frontal se abre antes de los tonos (en iPhone abrirla puede cortar el audio
  un instante: mejor mientras habla la voz) y toma 3 fotos de 320 px, al empezar cada oído y en la
  última frecuencia. Sin cámara sigue sin fotos (`camara: 'no disponible'`).

## Calibración (lo delicado)

`dB HL = dBFS + desfase[frecuencia]` por perfil de audífono (`src/perfiles.js`). Los desfases son
**provisionales** (100 dB SPL a 0 dBFS con volumen al máximo, menos RETSPL de ISO 389-1): no hay
audiómetro para medirlos. Plan: recalcularlos con la población (mediana de menores de 30 sin
antecedentes ≈ 0-5 dB HL por perfil) y validar contra las presenciales de Bogotá (mismo día,
50-100 pacientes). Por eso cada prueba guarda los dBFS crudos y `calibracion` (versión): cambiar
un desfase = subir `VERSION_CALIBRACION`.

Lo que NO depende de la calibración pesa más en el veredicto: diferencia entre oídos, forma de la
curva, repetición de 1 kHz, falsos positivos. Los límites de confiabilidad (`LIMITES`) y de ruido
(dBFS de micrófono sin calibrar) también son provisionales.

## Límites conocidos

- Una página web no puede leer ni fijar el volumen del sistema. Se pide al máximo; una curva
  plana y alta en los dos oídos se marca «posible volumen bajo».
- iPhone calla Web Audio con el interruptor de silencio: `navigator.audioSession.type =
  'playback'` (Safari 16.4+). La revisión de volumen pregunta si sonó.
- Si el `AudioContext` se suspende a mitad de la prueba (llamada, alarma) los tonos no sonarían:
  antes de cada tono se revisa y, si no está `running`, se pausa y se pide un toque. **Este camino
  no lo cubre el simulador** (no puede suspender el audio).
- Bluetooth: códecs con pérdida pueden borrar tonos muy suaves; queda como nota en confiabilidad.
- Sin enmascaramiento: una asimetría grande (≥40 dB) puede ser audición cruzada.

## Pruebas

- Unidad (algoritmo con oyente simulado, 300 corridas por umbral, y resultado.js):
  `node src/static/prueba-oidos/pruebas/node.mjs` o `pruebas/unidad.html` en el navegador.
- Punta a punta sin audífonos: `pruebas/simulador.js` es un paciente simulado (espía Web Audio,
  toca el orbe según el nivel real del tono, contesta los botones). Con Playwright:
  `page.addInitScript({ path: '…/pruebas/simulador.js' })` y abrir `/static/prueba-oidos/index.html`
  (la guía de voz busca `/static/assets/…`: servir con Flask o con un estático cuya raíz tenga
  `static/`). El resultado queda en `window.__pruebaOidos`. Umbrales: `window.__umbralesSimulados`.
  Modos (`window.__simulador`): `tocarAlAzar` (toques/s, el tramposo), `ausente: [desde, hasta]`
  (ms desde el primer tono), y `lento` (ms de más en cada respuesta). Lo que hizo queda en `window.__simStats`.
  Ojo: `addInitScript` sigue activo en esa pestaña aunque se navegue a otra página.
- Backend: `tests/test_oidos.py` (`grabacion.limpiar_oidos`).
