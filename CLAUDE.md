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
```

## Environment Variables

Required in `.env` file (see `.env.example` pattern):
- `OPENAI_API_KEY` - OpenAI API key for GPT-4o Realtime
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD` - Email configuration
- `RECEIVING_EMAIL` - Email address to receive call summaries
- `WHAPI_TOKEN` - Whapi.cloud token for WhatsApp messaging

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
6. Backend sends summary to: email (SMTP), WhatsApp (Whapi), Wix (HTTP POST)

## Key Integration Points

- **Wix Backend**: Patient data retrieval and summary storage at `bsl.com.co/_functions/*`
- **WhatsApp**: Colombian phone numbers auto-prefixed with `57`
- **OpenAI Model**: `gpt-4o-realtime-preview-2024-12-17` with voice `ash`

## Deployment

Configured for Heroku via `Procfile`:
```
web: python src/app.py
```
