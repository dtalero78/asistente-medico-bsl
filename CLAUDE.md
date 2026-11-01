# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BSL Medical Assistant - A real-time AI voice chat application for occupational health interviews. Patients interact via voice with an OpenAI GPT-4o Realtime assistant that conducts medical history interviews, then sends summaries via email, WhatsApp, and stores them in Wix.

## Development Commands

```bash
# Setup virtual environment
python -m venv .venv
source .venv/bin/activate  # macOS/Linux
.venv\Scripts\activate     # Windows

# Install dependencies
pip install -r requirements.txt

# Run the application (kills existing process on port if needed)
./run.sh

# Or run directly
python src/app.py

# Default port: 5001 (configurable via PORT env var)

# Tests (unittest nativo, sin BD ni red)
python -m unittest discover tests
```

## Environment Variables

Required in `.env` file (see `.env.example` pattern):
- `OPENAI_API_KEY` - OpenAI API key for GPT-4o Realtime
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD` - Email configuration
- `RECEIVING_EMAIL` - Email address to receive call summaries
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` - Twilio credentials for WhatsApp
- `TWILIO_WHATSAPP_FROM` - Twilio WhatsApp sender number (format: whatsapp:+573153369631)
- `TWILIO_MESSAGING_SERVICE_SID` - Twilio messaging service ID
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` - PostgreSQL database credentials

## Architecture

### Backend (Flask)
- [src/app.py](src/app.py) - Single Flask application with three endpoints:
  - `GET /` - Serves the call interface
  - `GET /session` - Creates ephemeral OpenAI Realtime session tokens
  - `POST /send-email` - Sends summaries via email, WhatsApp, and Wix API

### Frontend (Vanilla JS + WebRTC)
- [src/static/js/app.js](src/static/js/app.js) - Core client logic:
  - WebRTC peer connection to OpenAI Realtime API
  - Data channel for function calling (sendEmail tool)
  - Patient data fetched from `bsl.com.co/_functions/chatbot` via `_id` URL parameter
  - Dynamic system prompt injection with patient-specific interview instructions

### Call Flow
1. User clicks "Iniciar Llamada" → beep sound loops
2. Frontend fetches `/session` → gets ephemeral OpenAI token
3. WebRTC connection established with OpenAI Realtime
4. On `session.created`, custom instructions injected with patient data
5. AI conducts interview, calls `sendEmail` function when done
6. Backend sends summary to: email (SMTP), WhatsApp (Twilio), PostgreSQL database

## Key Integration Points

- **PostgreSQL**: Patient data retrieval and summary storage
- **WhatsApp via Twilio**: los números pasan por `src/services/phone.py`, port del helper de BSL-PLATAFORMA2 (`src/helpers/phone.js`). Las dos apps escriben en `conversaciones_whatsapp`: si normalizan distinto, el mismo paciente queda con dos conversaciones. Cambiar una regla en las dos.
- **IrisChat (BSL-PLATAFORMA2)**: esta app escribe directo en `conversaciones_whatsapp` / `mensajes_whatsapp` (siempre `tenant_id = 'bsl'`). Guarda el texto real de cada plantilla y, en la misma transacción, hace `pg_notify('whatsapp_mensaje_externo', {mensaje_id})`; PLATAFORMA2 escucha ese canal y emite el evento de socket para que IrisChat lo muestre en vivo.
- **OpenAI Model**: `gpt-4o-realtime-preview-2024-12-17` with voice `ash`
- **AI Suggestions**: Uses `gpt-4o-mini` to generate personalized health recommendations

## Deployment

Configured for Heroku via `Procfile`:
```
web: python src/app.py
```

## Avatar en video (`/avatar`)

Videollamada con un médico virtual: LiveAvatar (HeyGen) pone el video y un agente de ElevenLabs
(cerebro Claude Haiku + voz "Alirio") conduce la entrevista. Archivos: `src/services/avatar.py`
(sesión, resumen), `src/services/grabacion.py` (audio + fotos a Spaces), `src/static/js/avatar.js`,
`src/templates/avatar.html`. El agente se crea/actualiza con `scripts/agente-avatar/sync.py` desde
`scripts/agente-avatar/prompt.md`.

- `AVATAR_EN_INICIO=1` hace que `/` (el link de NUBIA, plantilla `recordatorio_cita`) muestre el
  avatar; la voz queda siempre en `/voz`. `LIVEAVATAR_SANDBOX=1` = avatar Wayne, 1 min, gratis.
- Sin `_id` en la URL usa un paciente demo y NO despacha nada (ni correo, ni WhatsApp, ni BD).
- No hay tool `sendEmail`: el resumen sale de la transcripción con gpt-4o-mini al terminar.
- Entrevista incompleta (sin la despedida o con menos de 4 respuestas, `avatar.entrevista_completa`):
  no hay resumen ni WhatsApp, el link sigue sirviendo (se gasta al guardar `resumenLlamada`) y el
  paciente ve «Intentar de nuevo». Así NUBIA no la marca ATENDIDO. La evidencia sí va a Spaces.
- El paso de la empresa llega armado en `{{pregunta_empresa}}` (`avatar.pregunta_empresa`): confirma la de la orden; si es PARTICULAR, la pregunta.
- Evidencia: `entrevistas-avatar/<_id>/<fecha>_<ref>/` en Spaces (privado). La ficha de
  BSL-PLATAFORMA2 la muestra con «Ver entrevista». ElevenLabs retiene el audio 30 días.
- Variables: ver `.env.example` (LIVEAVATAR_*, ELEVENLABS_*, SPACES_*).

### Prueba de oídos (primera, antes de la de ojos)

Al tocar «Iniciar Consulta» va primero un tamizaje auditivo con los audífonos del paciente
(`src/static/js/oidos.js`; algoritmos y calibración en `src/static/prueba-oidos/`, con su propio
CLAUDE.md). Unos 8 min: audífonos → ruido → volumen → lateralidad → tonos en 6 frecuencias por
oído. Reemplazo propuesto de `audiometria-virtual.html` de PLATAFORMA2.

- **Misma experiencia que la de ojos**: voz de Alirio en cada paso (clips `oidos-*` en
  `scripts/voz-ojos/generar.py`, misma carpeta `voz-ojos/`). Aquí el paciente sí mira la pantalla y
  contesta con botones. **La voz calla mientras suenan los tonos**; solo habla entre un oído y otro.
- El orbe del centro es el botón «Lo oí». **Nada en pantalla puede cambiar cuando suena un tono**
  (sería una pista): sus anillos respiran siempre igual. Tampoco hay cuenta regresiva: cada tono
  tiene su ventana (1,5 s desde que empieza) y si no toca, cuenta como «no oyó» y sigue.
- **Contra la trampa** (tocar sin oír): antes de cada frecuencia la voz dice «Toca solo cuando oigas
  el pitido»; 12 % de los ensayos no tienen tono y si contesta uno la voz lo corrige y esa frecuencia
  se repite. Si tocó sin pitido, un resultado normal nunca sale «pasa» sino «repetir» (la trampa
  produce justo eso: umbrales mejores de lo que son).
- **Contra el abandono**: si deja de responder 4 tonos seguidos que debería oír (≥40 dB, el nivel
  que ya oyó en la revisión de volumen), se pausa y pregunta «¿Sigues ahí?». Sin esto la prueba
  seguía sola y salía una sordera que no existe.
- **Contra la suplantación**: el saludo avisa que se toman fotos durante los tonos; la cámara
  frontal se ve en un círculo y se toman 3 (`oidos-N`), que se suben con las de la entrevista.
- El `AudioContext` de los tonos se crea en el toque de «Iniciar Consulta» (`prepararAudio`, junto a
  `guia.desbloquear()`, antes de cualquier `await`) y se cierra al terminar, antes de la cámara y LiveKit.
- **Bluetooth**: con el micrófono abierto los audífonos pasan a «manos libres» (mono). El micrófono
  solo se usa para ruido y parlante y se cierra ANTES de la lateralidad y los tonos.
- Sin audífonos («No tengo») o cualquier falla → `{realizado: false, motivo}` y sigue a ojos.
- El resultado viaja en `/avatar/end` (`oidos`); `grabacion.limpiar_oidos` lo deja en `meta.json`
  (`oidos`, con dBFS crudos y ensayos para recalibrar, y las keys de sus fotos).
- **Va a `audiometrias` de PLATAFORMA2** (`patient.guardar_audiometria`, desde `app.guardar_evidencia`,
  aunque la entrevista se corte): umbrales en `aereo_*` (500-6000; «no oye» = 70), grado en
  `diagnostico_*`, veredicto y confiabilidad en `interpretacion`, `equipo = 'Asistente virtual BSL'`.
  Es la fila que leen el certificado, el PDF y el informe por empresa: **para las órdenes de NUBIA la
  plataforma ya no pide su audiometría virtual** (`QUITA_SI_MEDICO_BOT` en PLATAFORMA2). Si la orden ya
  tiene una audiometría de la plataforma no la toca; un reintento actualiza la del asistente. Sin
  prueba de oídos (sin audífonos) no hay fila. La visiometría de la plataforma sigue: la de ojos no
  mide agudeza ni colores.
- El paciente ve audiograma y veredicto bajo el resumen (`pintarResultadosOidos`).
- Página para probarla sola, sin entrevista: `/static/prueba-oidos/index.html`.

### Prueba de ojos (obligatoria, antes de la entrevista)

Después de la de oídos, el paciente pasa por tres estudios del Escáner Ocular
(`src/static/escaner-ocular/`, con su propio CLAUDE.md): tamizaje (foto de los ojos), fatiga
(60 s de parpadeo) y pupilas (la pantalla en blanco, luego en rojo y un destello). Son unos 2 min y medio. La cáscara
para celular es `src/static/js/ojos.js`; los estudios se usan sin modificarlos.

- **Un solo toque**: consentimiento + «Iniciar Consulta» pide cámara y micrófono en un solo aviso,
  hace la prueba y al terminar entra el médico directo. La tarjeta `vc-listo` solo sale si falla la
  conexión con el médico.
- **Va guiada por voz** (`src/static/js/guia-voz.js`): mirando la cámara no se puede leer. Cada
  instrucción suena antes de que arranque su estudio, hay correcciones habladas si la pose falla
  (acércate, aléjate, no veo tu cara) y una música suave marca el tiempo quieto («mientras suene la
  música…»). Durante el minuto y en pupilas la voz explica qué se mide (`avisos` en `ojos.js`).
- En la foto el paciente se acomoda sin poder leer: la voz corrige más seguido (1,5 s / 4 s), lo
  anima si se viene acercando («Eso, un poco más cerca»), avisa cuando ya está bien («Así está
  perfecto. Quédate quieto») y la foto espera a que termine esa frase.
- **En pupilas la voz calla mientras se mide**: escuchar con atención dilata la pupila. La
  narración se cuadra con `PLAN` (exportado de `pupilas.js`) y debe terminar antes de cada ventana
  de medición; si se alarga un clip o cambia `PLAN`, revisar el comentario de `PASOS` en `ojos.js`. Los audios están grabados en
  `src/static/assets/voz-ojos/` con la voz del médico (Alirio): se generan con
  `scripts/voz-ojos/generar.py` (textos y prompt de la música están ahí). Cambiar un texto =
  editar el script y correr `generar.py <id>`.
- En iPhone un `<audio>` solo suena si su primer `play()` ocurre dentro del toque: `guia.desbloquear()`
  va síncrono al inicio del clic de «Iniciar Consulta», antes de cualquier `await`. Por lo mismo, el
  volumen de la música va horneado en el archivo (iPhone ignora `audio.volume`).

- Va **antes** porque es obligatoria: si fuera después y el paciente cerrara a mitad de la prueba,
  se perdería la entrevista. Antes de empezarla se revisan el micrófono y que el link no esté usado
  (`/api/paciente` → 403).
- El resultado queda en memoria y viaja en `/avatar/end` (`ojos`). `grabacion.limpiar_ojos` lo
  reduce a texto acotado y lo guarda en `meta.json` (`ojos`), con las fotos `foto-N-ojo-od/oi.jpg`.
  La ficha de BSL-PLATAFORMA2 lo pinta en «Ver entrevista» (`pruebaDeOjos` en `inicio-ficha.js`).
- **Va a la historia clínica**: `app.guardar_evidencia` lo escribe también en
  `HistoriaClinica."pruebaOjos"` (jsonb, columna creada el 31-oct-2026; `fotos` = keys privadas en
  Spaces), aunque la entrevista se corte; un reintento lo sobreescribe. Si Spaces falla, se guarda
  igual sin fotos. El PDF de PLATAFORMA2 lo pone en IX. Exámenes paraclínicos con las fotos
  incrustadas (`buildPruebaOjosHTML` en `historia-clinica-html.js`, `fotosDePruebaOjos`).
- **El paciente ve sus resultados en pantalla** al final, bajo el resumen de la consulta: fotos de
  cada ojo y los tres estudios (`ojos.pintarResultados`, desde lo que quedó en memoria; no pasa por
  el servidor). Por WhatsApp no le llegan cifras, pero sí una 4a sugerencia de cuidado visual en el WhatsApp
  de sugerencias: `ojos.js` manda `indicadores` (parpadeo, % incompletos, cierres largos, PERCLOS,
  enrojecimiento), `ai.hallazgo_visual` elige UN hallazgo con reglas fijas (umbrales de las banderas
  del escáner) y gpt-4o-mini lo redacta sin cifras. **Nada de pupilas** (experimentales; con iris
  oscuros dan diferencias falsas). Sin prueba de ojos, siguen siendo 3 sugerencias.
- En la historia clínica y el certificado la sección se llama «Complemento resultados oculares».
- Cámara negada → no sigue (pide permitirla). Cualquier otra falla (sin cámara, el modelo no
  carga, error) → `{realizado: false, motivo}` y sigue a la consulta: el médico ve por qué.
- «Intentar de nuevo» tras una llamada cortada repite solo la entrevista, no la prueba.
- MediaPipe (~10 MB, CDN de jsdelivr + Google Storage) se precarga en la pantalla de inicio y se
  libera antes de conectar LiveKit: los dos a la vez ahogan un celular de gama baja.

