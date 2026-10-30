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
- La empresa de la orden llega al agente como `{{empresa}}`: la confirma; si es PARTICULAR, la pregunta.
- Evidencia: `entrevistas-avatar/<_id>/<fecha>_<ref>/` en Spaces (privado). La ficha de
  BSL-PLATAFORMA2 la muestra con «Ver entrevista». ElevenLabs retiene el audio 30 días.
- Variables: ver `.env.example` (LIVEAVATAR_*, ELEVENLABS_*, SPACES_*).
