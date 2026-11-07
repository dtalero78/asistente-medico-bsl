# Prueba visual (`src/static/prueba-vista/`)

Visiometría guiada en el celular del paciente: agudeza de cerca **por cada ojo** con la E que gira,
reloj de astigmatismo por ojo y láminas de colores, con la misma experiencia de la prueba de ojos
(pantalla oscura, voz de Alirio, la cámara controlando la prueba). Reemplazo propuesto de las láminas
de `visiometria-virtual.html` de BSL-PLATAFORMA2, para BSL e ipsVip (Daniel, 7-nov-2026).
**Fase 1: prototipo.** Todavía no lo usa ninguna página de pacientes.

Por qué se rehízo (BD, 60 días, BSL): 96 % sale «Normal», Snellen promedio 97 %, Landolt 99 %. Los
tamaños eran píxeles fijos, sin distancia y con los dos ojos: medía la pantalla. Las láminas de
colores simuladas confundían también a quien ve bien (los «Normal» promedian 89 % y solo el 34 %
saca todo perfecto).

## Dónde está cada cosa

- `src/agudeza.js` — distancia por el iris, escala de la pantalla, niveles de la E y la escalera.
- `src/colores.js` — láminas pseudoisocromáticas generadas, simulación de daltonismo, lectura.
- `src/resultado.js` — concepto (Normal / Aceptable / Revisión Sugerida) y sus motivos.
- `../js/vista.js` — **la cáscara**: flujo, cámara, voz, botones, dibujo (E, reloj, láminas).
  Se carga desde el dominio del asistente (como `ojos.js`): nada de rutas absolutas `/static/...`.
- `index.html` + `demo.js` — la prueba sola. No guarda nada.
- Voz: clips `vista-*` en `scripts/voz-ojos/generar.py`; `guia-voz.js` los lista en `CLIPS_VISTA`
  (aparte: el avatar no los precarga).

## Cómo mide (y con qué reservas)

- **Distancia**, medida por el iris (11,7 mm) y el campo de visión típico de la cámara frontal (55°
  del lado corto en celular vertical, 65° en cámara web). Error esperado ±20 %, que mueve la agudeza
  menos de una línea (una línea = 0,1 logMAR = 26 %). Cada E se muestra solo con la distancia bien
  (±15 %); si no, la voz corrige («acércate» / «aléjate»).
- **La distancia de la prueba depende de la pantalla** (`distanciaDePrueba`): la más cercana a 40 cm
  (55 en computador) en la que **20/40 cae exacto** en px enteros. Así el corte siempre se puede
  medir: con 40 cm fijos un computador de 1x no bajaba de 20/91 (todos «Revisión Sugerida») y en
  2x el nivel más cercano era 20/43 (quien ve 20/40 salía «Aceptable»). Rango: celular 35-48 cm
  (lo que la voz llama «unos cuarenta»), computador 38-75 cm («medio metro», su propio clip). Si
  ningún entero cae en el rango, la distancia con el nivel más cercano a 20/40 sin pasarse. En
  computador se contesta también con las flechas del teclado (teclas repetidas y las de los
  primeros 200 ms se ignoran: una flecha mantenida contestaba la E siguiente).
- **Nunca se queda colgada**: si en 30 s no logra la distancia o no ve la cara (con la mano tapando
  un ojo puede perderla), sigue y marca `distanciaControlada: false`. El detector atrapa sus errores
  (`erroresDetector`) en vez de morir en silencio, y se libera al terminar (`ui.liberarModelo = false`
  si sigue la prueba de ojos, que lo reutiliza).
- **mm por píxel**: en celular la densidad CSS es casi fija (~6 px/mm, ±8 %). En computador no:
  se calibra con una tarjeta (cédula) sobre la pantalla.
- **La E** se dibuja con trazos de px ENTEROS de dispositivo (si no, se difumina), alineada a la
  cuadrícula de píxeles aunque la densidad sea fraccionaria (2,625x), y el logMAR de cada nivel es el
  real de ese redondeo: por eso salen agudezas como 20/29 o 20/48. Mínimo 2 px por trazo (1 en
  pantallas de 1x); si aprueba el nivel más chico, se marca `limiteDePantalla`.
- **Escalera**: empieza cerca de 20/100, baja mientras acierte 2 de hasta 3, para en el primer nivel
  que no pasa; si no ve la inicial, sube hasta 20/200. Dirección al azar entre las 4 (adivinar = 1 de
  4), nunca 3 iguales seguidas.
- **Un ojo a la vez**: la cámara exige el ojo tapado «cerrado» (EAR < 0,15) y el medido abierto. Si
  en 20 s no lo logra (con la mano encima MediaPipe puede no verlo así), sigue igual y queda
  `oclusionVerificada: false`. Si se verificó, antes de cada E se revisa otra vez: si lo destapó, la
  voz se lo recuerda (`destapes`; después de 3 ya no se revisa y queda el motivo para el médico).
  **Por confirmar con pacientes reales.**
- **Reloj**: líneas de 3 px; con 1,6 el suavizado dejaba las diagonales más claras (falso positivo).
- **Láminas**: cada una para UN tipo (protán o deután): figura y fondo difieren solo en la dirección
  de color que su matriz de Machado 2009 manda a cero, con brillo al azar por punto. «Fuertes» para
  daltonismo, «suaves» para alteraciones leves (con fallar la suave de su tipo ya sale «dudosa»), y
  una de ejemplo de contraste (si la falla, la prueba de colores no es válida). 4 números por
  lámina más «No veo» (adivinar = 1 de 4). `pruebas/casos.js` lo comprueba con las matrices.
- **Concepto**: cortes de tamizaje con nombre en `resultado.js` (20/40 normal por ojo, peor ojo hasta
  20/63 aceptable, 2 líneas entre ojos, reloj distinto, colores). **No validados en esta población.**

## Pruebas

`node src/static/prueba-vista/pruebas/node.mjs` (80 casos): distancia, 20/40 exacto en 8 tipos de
pantalla (y el más cercano en las que no se puede), la E en sus cuatro direcciones, direcciones al azar, pacientes simulados con agudeza
conocida (la escalera queda a un nivel o menos en ≥ 85 %), cada lámina contra la simulación de
daltonismo, lectura de colores y concepto.

Punta a punta sin cámara: el stub del escáner (`escaner-ocular/pruebas/stub-mediapipe.js`) tiene
`__stub.earOjo = { OD, OI }` para tapar un ojo, `irisScale` para la distancia (0,26 ≈ 39 cm con
su cámara de 1280 apaisada) y `present = false` para perder la cara. Simular un celular sobrescribiendo `navigator.maxTouchPoints`,
`screen.width` y `devicePixelRatio` antes de cargar los módulos.
