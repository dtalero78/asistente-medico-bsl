# Escáner Ocular

Batería de tamizaje visual ocupacional con una cámara web estándar. Cuatro estudios que
comparten cámara, detección y reporte. Todo el procesamiento ocurre en el navegador:
**no se envía ninguna imagen a ningún servidor** y no se guarda nada entre sesiones.

> **No es un dispositivo médico.** Las mediciones son aproximadas y sensibles a la
> iluminación, la cámara, la distancia y el movimiento. **Ningún punto de corte usado
> aquí está validado en la población objetivo**: deben calibrarse contra criterio
> profesional antes de reportar nada a una empresa. Cualquier hallazgo debe confirmarlo
> un optómetra u oftalmólogo.

Esta app es **independiente de la librería `jeelizPupillometry`** del resto del
repositorio: no la importa ni comparte código con ella. Corre sobre MediaPipe
FaceLandmarker.

## Los cuatro estudios

| Estudio | Dura | Qué mide | Hardware extra |
|---|---|---|---|
| **Tamizaje** | ~5 s | Iris, apertura, pupila, enrojecimiento sobre una foto | — |
| **Fatiga** | 60 s | PERCLOS, tasa y calidad del parpadeo | — |
| **Pupilas** | ~33 s | Anisocoria en luz y en penumbra, reflejo fotomotor | — |
| **Agudeza** | ~2 min | Agudeza por ojo con E direccional | tarjeta + cordón de 1 m |

Se pueden correr sueltos o encadenados con **Examen completo** (~4 min).

### Fatiga y parpadeo

Una sola grabación da dos lecturas porque ambas salen de la misma señal: el EAR en el
tiempo. Los primeros 10 s calibran la apertura normal **de ese sujeto** (percentil 85 del
EAR); el resto mide contra esa referencia.

Dos decisiones que cambian el resultado:

- **PERCLOS se integra por tiempo, no por frames.** La tasa de refresco no es constante y
  contar frames sesgaría el número cuando caen. Hay una prueba dedicada a esto.
- **Los frames sin rostro no cuentan como tiempo válido.** Contarlos equivaldría a darlos
  por ojo abierto y el PERCLOS saldría subestimado sin que nada lo delate. Si se pierde el
  rostro más del 40 % del tiempo, el estudio se declara **no medible** en vez de reportar
  un número cómodo.

*Limitación:* la línea base asume que el sujeto llega alerta. Si ya llega somnoliento, el
PERCLOS sale subestimado. Es una limitación conocida de PERCLOS por EAR.

### Pupilas

Tres fases: pantalla blanca (adaptación + medición), pantalla roja (adaptación + medición)
y un destello blanco para el reflejo fotomotor.

**La fase de penumbra es roja, no negra.** Con la pantalla apagada el rostro queda
iluminado solo por la luz del cuarto y el contraste pupila/iris —que ya es el punto débil
de medir en luz visible— empeora justo cuando hay que medir. La luz roja de onda larga
aporta poca acción pupilar respecto a su luminancia: ilumina para la cámara sin contraer
la pupila como haría el blanco. Es una **penumbra relativa**, más débil que la adaptación
a un cuarto oscuro, y así se declara en el reporte.

**Por qué dos condiciones:** la anisocoria fisiológica es benigna y muy frecuente, así que
una diferencia medida bajo una sola luz no distingue lo banal de lo relevante. Lo que
discrimina es cómo cambia: la vía simpática se nota en penumbra y la parasimpática con luz.

El umbral de "diferencia real" **no es un número fijo**: se estima el ruido a partir de la
dispersión de las propias medidas y solo se declara una asimetría si la supera.

El **reflejo fotomotor es experimental** y tiene compuerta estricta: si la pupila no se
detectó en al menos el 80 % de los frames del destello, se reporta *no medible*. Con iris
oscuros en luz visible eso va a pasar seguido; la solución real es iluminación far-red de
625 nm. Se reportan amplitud y latencia, nunca velocidad: a 30 fps la resolución es de
33 ms sobre un fenómeno de ~200 ms.

### Agudeza visual

**La distancia de examen es 1 metro, no 40 cm.** A 40 cm un optotipo de 20/20 mide 0.6 mm,
que en una pantalla de ~4 px/mm son 2 píxeles: no se puede dibujar. Un metro es lo más
lejos que la cámara sigue detectando el rostro con fiabilidad.

Aun así la pantalla impone un **piso**: por debajo de cierto logMAR la E deja de ser una E
y se estaría midiendo la pantalla, no el ojo. Ese piso se calcula para cada equipo y se
declara en el reporte ("no permite dibujar por debajo de 20/27: es el límite del equipo,
no del ojo").

Calibración, dos pasos de segundos:

1. **Tarjeta ID-1** (cédula o tarjeta bancaria, 85.60 mm) contra la pantalla → px/mm.
   Se guarda por dispositivo en `localStorage`; no es dato de salud.
2. **Cordón de 1 m** para fijar la distancia una vez. A partir de ahí la cámara la calcula
   sola con `distancia = 1000 × irisPxRef / irisPx`. **El supuesto de iris = 11.7 mm se
   cancela en esa división**, así que el error poblacional de ±0.42 mm no entra en la
   distancia: solo entran el largo del cordón y el ruido de píxel.

Si el sujeto se inclina más de ±12 %, la prueba se pausa.

**Optotipo E direccional**, que no exige alfabetización — decisión deliberada para tamizaje
ocupacional. Escalera desde 0.5 logMAR en pasos de 0.1, cinco por nivel, se aprueba con 3.

**Quién responde:** a 1 m el sujeto no alcanza el teclado. Señala con la mano y el operador
registra la dirección con las flechas, igual que en un examen de agudeza real. El operador
también atestigua la oclusión del ojo: verificarla por cámara exigiría modelo de manos, que
no está en esta pila. Lo que sí se verifica de forma continua es la distancia.

*Fuera de alcance:* visión de color. Las láminas de Ishihara tienen derechos de autor y una
alternativa generada requiere validación propia.

## Cómo correrla

Archivos estáticos, sin build ni dependencias que instalar:

Vive dentro del asistente médico y la sirve su Flask:

```bash
python src/app.py                   # desde la raíz de asistente-medico-bsl
# http://localhost:5001/static/escaner-ocular/index.html
```

Tres de los estudios (tamizaje, fatiga y pupilas) los corre también el médico virtual antes de
la entrevista, con su propia cáscara para celular: `src/static/js/ojos.js`. Esa versión **sí**
envía los resultados (texto y las dos fotos de los ojos) para la ficha del médico.

- **`localhost` sirve por HTTP.** `getUserMedia` exige contexto seguro y `localhost` ya
  cuenta como tal. Desde otra máquina o IP sí hace falta **HTTPS**.
- **Necesita internet en la primera carga**: MediaPipe viene del CDN de jsdelivr y el
  modelo de Google Storage.
- Si vas a **editar**, recargá con `Cmd+Shift+R`: Chrome puede seguir sirviendo los
  módulos viejos **sin volver a pedirlos**, así que parece que tus cambios no hicieran nada.

## Pruebas

```
pruebas/unidad.html        42 aserciones sobre los algoritmos — abrir y mirar el resumen
pruebas/integracion.html   la app completa con MediaPipe simulado y cámara falsa
pruebas/stub-mediapipe.js  landmarks sintéticos controlables desde window.__stub
```

`unidad.html` es donde se prueba la matemática, sin cámara ni DOM: percentiles,
integración temporal (incluido el caso de frames caídos), PERCLOS y conteo de parpadeos
contra series sintéticas calculadas a mano, clasificación de los cuatro patrones de
anisocoria, la compuerta del PLR y la óptica de la agudeza. Deja el resultado en
`window.__pruebas` para poder automatizarlo.

`integracion.html` **no duplica el `index.html`**: lo descarga y le inyecta el cuerpo, así
no se desincroniza. Sustituye MediaPipe con un import map (aceptan URL absolutas como
clave, así que `app.js` corre sin modificar) y reemplaza `getUserMedia` por un
`canvas.captureStream` que pinta ojos donde el stub pone los landmarks — necesario porque
las medidas de pupila y enrojecimiento leen píxeles reales.

Desde `window.__escaner.iniciarSecuencia([...])` se puede lanzar cualquier estudio, y
moviendo `window.__stub` se simulan parpadeos, pérdida de rostro o cambios de pupila.

## Estructura

```
index.html            estructura + aviso legal
app.js                cáscara: cámara, bucle, guías, compuerta de pose, secuencia
styles.css            tema oscuro + reglas @media print
src/
  medidas.js          landmarks y píxeles → números (sin DOM, sin estado global)
  serie.js            estadística robusta e integración temporal
  estimulo.js         la pantalla como fuente de luz controlada
  calibracion.js      tarjeta ID-1 y distancia por iris
  reporte.js          render del informe por secciones
  estudios/           tamizaje · fatiga · pupilas · agudeza
```

Un estudio nunca toca la cámara ni el bucle: recibe una muestra por frame y devuelve datos.
La muestra común se calcula **una sola vez** por frame en `app.js` y la comparten todos.
`finish` se ata a cada ejecución con un token, para que un temporizador rezagado de un
estudio no pueda cerrar el siguiente.

Interfaz que implementa cada estudio:

```js
export const estudio = {
  id, nombre, requiere: { pose }, hint,
  iniciar(ctx),            // puede ser async
  porFrame(ctx, muestra),  // muestra === null si no hay rostro
  onPose(ctx, muestra),    // solo si requiere.pose
  terminar(ctx),           // → resultado
  render(resultado),       // → sección del informe
};
```

## Qué mide, y con qué reservas

Toda cifra en milímetros del tamizaje estático sale de asumir que el iris mide 11.7 mm:
es la única referencia de escala con una cámara sin calibrar, y en la población real ese
diámetro es 11.80 ± 0.42 mm (rango 10.8–12.8). Por eso **las diferencias entre ojos son
más confiables que los valores absolutos**: el error de escala es el mismo para los dos
ojos de la misma persona.

Las medidas de pupila van marcadas como **experimental** en la propia tabla: se estima
buscando la mancha oscura central dentro del iris, lo que es burdo y sensible a reflejos.
Cuando el resultado es implausible se reporta `—` en vez de inventar un número.

Las banderas son **orientativas y nunca diagnósticas**: sugieren confirmar con un
profesional.
