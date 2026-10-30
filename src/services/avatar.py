"""Sesiones de avatar en video con LiveAvatar (HeyGen).

Tres modos segun .env (ver start_session). En ninguno se usa la tool sendEmail: al terminar,
el resumen se genera desde la transcripcion con gpt-4o-mini.
"""
import os
import re
import time
import uuid
import logging
import requests
from services.ai import openai_client

logger = logging.getLogger(__name__)

API = "https://api.liveavatar.com/v1"
# Unico avatar disponible en sandbox (sesiones de ~1 min, sin consumir creditos)
SANDBOX_AVATAR_ID = "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a"
FRASE_CIERRE = "estoy generando tu resumen"
# Una entrevista completa tiene 6 respuestas (minuto, salud, familia, trabajo, accidentes, empresa);
# con 4 se toleran respuestas que el paciente junta en un solo turno
MIN_RESPUESTAS = 4
RESUMEN_INCOMPLETA = "Entrevista incompleta: la llamada se corto antes de terminar. No se genero resumen."

PACIENTE_DEMO = {
    'primerNombre': 'Carlos',
    'celular': None,
    'encuestaSalud': ['Dolor de espalda', 'Usa anteojos'],
    'antecedentesFamiliares': ['Hipertension'],
}


def _headers():
    return {"X-API-KEY": os.getenv("LIVEAVATAR_API_KEY"), "Content-Type": "application/json"}


def _data(response):
    body = response.json()
    if response.status_code >= 400 or body.get('data') is None:
        raise Exception(f"LiveAvatar {response.status_code}: {body.get('message') or body}")
    return body['data']


def build_instructions(paciente):
    """Mismo prompt que webrtc.js buildInstructions(), sin la llamada a sendEmail."""
    if paciente is None:
        return f"""
Eres el bot de validacion preconsulta de BSL. Te presentas como "bot de validacion preconsulta".

IMPORTANTE: Este paciente NO ha completado las pruebas medicas previas requeridas.

INSTRUCCIONES:
1. Saluda al paciente (ej. "Hola, soy el bot de validacion preconsulta de BSL")
2. Informale que para realizar la consulta medica debe completar primero las pruebas de salud ocupacional
3. Dile que le vas a enviar un link por WhatsApp para que complete las pruebas
4. Despidete diciendo: "Gracias por tu tiempo, {FRASE_CIERRE}. No cierres esta ventana."

TONO: Profesional, amable y comprensivo.
"""

    nombre = (paciente.get('primerNombre') or '').strip() or "el paciente"
    salud = ", ".join(paciente.get('encuestaSalud') or [])
    familia = ", ".join(paciente.get('antecedentesFamiliares') or [])
    return f"""
Eres el bot de validacion preconsulta de BSL. Realizas una entrevista breve para validar la informacion del paciente antes de la consulta medica.
Hablas siempre en espanol.

DATOS DEL PACIENTE:
- Nombre: {nombre}
- Historial de salud: {salud or "ninguno"}
- Antecedentes familiares: {familia or "ninguno"}

REGLAS CRITICAS:
1. NUNCA repitas una pregunta que ya hiciste
2. NUNCA pidas informacion que el paciente ya dio
3. Haz UNA sola pregunta a la vez y espera la respuesta
4. Manten un seguimiento mental de que preguntas ya hiciste
5. La entrevista debe durar maximo 2 minutos

FLUJO DE LA ENTREVISTA (en orden, sin repetir):
1. Ya saludaste al paciente; empieza directo con la siguiente pregunta
2. Pregunta sobre su historial de salud ({salud or "general"})
3. Pregunta sobre antecedentes familiares (solo si tiene: {familia or "omitir"})
4. Pregunta sobre su ultimo trabajo y si tuvo enfermedades laborales
5. Pregunta para que empresa solicita el certificado medico
6. Despidete

AL FINALIZAR di exactamente: "Gracias por tu tiempo, {FRASE_CIERRE}. No cierres esta ventana."
"""


def saludo(paciente):
    if paciente is None:
        return "Hola, soy el bot de validacion preconsulta de BSL."
    nombre = (paciente.get('primerNombre') or '').strip()
    return f"Hola {nombre}, soy el bot de validacion preconsulta de BSL. ¿Tienes un minuto para unas preguntas rapidas?"


def empresa_de_la_orden(paciente):
    """La empresa de la orden, o None. Casi todas las de SANITHELP-JJ dicen PARTICULAR."""
    empresa = ((paciente or {}).get('empresa') or '').strip()
    return None if not empresa or empresa.upper() == 'PARTICULAR' else empresa


def pregunta_empresa(paciente):
    """El paso de la empresa ya armado para el agente. Con la empresa como variable suelta y
    "no indicada" cuando faltaba, Haiku preguntaba "¿El certificado es para no indicada?" (30-oct)."""
    empresa = empresa_de_la_orden(paciente)
    if not empresa:
        return ('Pregunta para qué empresa solicita el certificado médico. Con su respuesta pasa a la '
                'despedida, sin pedirle que la confirme.')
    return f'Confirma la empresa de su orden: "¿El certificado es para {empresa}?". Si dice que no, pregunta para cuál.'


def entrevista_completa(turnos):
    """La entrevista cuenta solo si el medico llego a la despedida y el paciente respondio. Sin esto,
    una llamada cortada (microfono mudo, sin senal) salia con un resumen de "No respondio" o con los
    datos del formulario, gastaba el link y NUBIA la marcaba APTO (Jose y Diana, 30-oct)."""
    cierre = any(t['role'] != 'user' and FRASE_CIERRE in t['text'].lower() for t in turnos)
    # "..." es silencio, no respuesta
    respuestas = [t for t in turnos if t['role'] == 'user' and len(re.sub(r'\W', '', t['text'])) >= 2]
    return cierre and len(respuestas) >= MIN_RESPUESTAS


def variables_agente(paciente, nombre=None):
    """Valores de {{...}} del prompt del agente de ElevenLabs (scripts/agente-avatar/prompt.md).
    Sin formulario (paciente None) el nombre viene de la orden."""
    if paciente is None:
        return {'nombre': (nombre or '').strip() or 'paciente', 'formulario_completo': 'no',
                'historial_salud': 'ninguno', 'antecedentes_familiares': 'ninguno',
                'pregunta_empresa': pregunta_empresa(None)}
    return {
        'nombre': (paciente.get('primerNombre') or '').strip(),
        'formulario_completo': 'si',
        'historial_salud': ", ".join(paciente.get('encuestaSalud') or []) or 'ninguno',
        'antecedentes_familiares': ", ".join(paciente.get('antecedentesFamiliares') or []) or 'ninguno',
        'pregunta_empresa': pregunta_empresa(paciente),
        # El prompt anterior usaba {{empresa}}: se sigue mandando para que ninguna llamada falle
        # mientras el servidor y el agente de ElevenLabs no esten en la misma version
        'empresa': empresa_de_la_orden(paciente) or 'no indicada',
    }


def start_session(paciente, nombre_sesion, nombre=None):
    """Arranca la sesion segun el modo configurado en .env, en orden de prioridad:

    1. ELEVENLABS_AGENT_ID: LITE + agente de ElevenLabs (cerebro y voz en ElevenLabs, como el
       agente de llamadas del CRM de LGS). LiveAvatar solo pone el video: 1 credito/min.
    2. LIVEAVATAR_VOICE_ID: FULL, LLM de LiveAvatar + voz de ElevenLabs. 2 creditos/min.
    3. Ninguno: LITE + conector OpenAI Realtime. 1 credito/min + OpenAI.
    Los modos 2 y 3 llevan el prompt en un context de LiveAvatar que se borra al terminar.

    Returns: dict con session_id, context_id (o None), livekit_url, livekit_client_token
    """
    sandbox = os.getenv("LIVEAVATAR_SANDBOX", "1") == "1"
    avatar_id = SANDBOX_AVATAR_ID if sandbox else os.getenv("LIVEAVATAR_AVATAR_ID")
    agent_id = os.getenv("ELEVENLABS_AGENT_ID")
    voice_id = os.getenv("LIVEAVATAR_VOICE_ID")

    context = None
    # Codigo unico de la sesion: viaja como variable del agente y queda guardado en la
    # conversacion de ElevenLabs; asi se encuentra su audio aunque haya varias a la vez
    ref = uuid.uuid4().hex[:16]
    inicio = int(time.time())
    if agent_id:
        config = {
            "mode": "LITE",
            "elevenlabs_agent_config": {
                "secret_id": os.getenv("LIVEAVATAR_ELEVENLABS_SECRET_ID"),
                "agent_id": agent_id,
                "dynamic_variables": {**variables_agente(paciente, nombre), "ref_bsl": ref},
            },
        }
    else:
        context = _data(requests.post(f"{API}/contexts", headers=_headers(), json={
            "name": nombre_sesion,
            "prompt": build_instructions(paciente),
            "opening_text": saludo(paciente),
        }, timeout=15))
        if voice_id:
            config = {
                "mode": "FULL",
                "avatar_persona": {
                    "voice_id": voice_id,
                    "context_id": context['id'],
                    "language": "es",
                    # Con el STT auto-elegido, respuestas largas en espanol salian vacias o
                    # transcritas en ingles ("Well, that's") y el avatar se disculpaba por el idioma
                    "stt_config": {"provider": os.getenv("LIVEAVATAR_STT_PROVIDER", "elevenlabs")},
                    "voice_settings": {"provider": "elevenLabs", "model": "eleven_v4_turbo"},
                    "llm_settings": {"provider": "openai", "model": "gpt-4o"},
                },
            }
        else:
            config = {
                "mode": "LITE",
                "openai_realtime_config": {
                    "secret_id": os.getenv("LIVEAVATAR_OPENAI_SECRET_ID"),
                    "context_id": context['id'],
                    "voice": "ash",
                    "model": "gpt-realtime",
                },
            }
    try:
        token = _data(requests.post(f"{API}/sessions/token", headers=_headers(), json={
            "avatar_id": avatar_id,
            "is_sandbox": sandbox,
            **config,
        }, timeout=15))

        session = _data(requests.post(f"{API}/sessions/start", headers={
            "Authorization": f"Bearer {token['session_token']}",
        }, timeout=30))
    except Exception:
        if context:
            delete_context(context['id'])
        raise

    logger.info("Sesion LiveAvatar %s iniciada (sandbox=%s, modo=%s)", session['session_id'], sandbox,
                'elevenlabs_agent' if agent_id else config['mode'])
    return {
        'session_id': session['session_id'],
        'context_id': context['id'] if context else None,
        'livekit_url': session['livekit_url'],
        'livekit_client_token': session['livekit_client_token'],
        'max_session_duration': session.get('max_session_duration'),
        'ref': ref,
        'inicio': inicio,
    }


def stop_session(session_id):
    try:
        requests.post(f"{API}/sessions/stop", headers=_headers(),
                      json={"session_id": session_id, "reason": "USER_CLOSED"}, timeout=15)
    except Exception as e:
        logger.warning("No se pudo detener la sesion %s: %s", session_id, e)


def delete_context(context_id):
    try:
        requests.delete(f"{API}/contexts/{context_id}", headers=_headers(), timeout=15)
    except Exception as e:
        logger.warning("No se pudo borrar el context %s: %s", context_id, e)


def fetch_transcript(session_id, intentos=4):
    """Transcripcion guardada por LiveAvatar, como lista de {role, text}."""
    for intento in range(intentos):
        try:
            data = _data(requests.get(f"{API}/sessions/{session_id}/transcript",
                                      headers=_headers(), timeout=15))
            turnos = [{'role': t['role'], 'text': t['transcript']} for t in data['transcript_data']]
            if turnos:
                return turnos
        except Exception as e:
            logger.warning("Transcripcion %s intento %d: %s", session_id, intento + 1, e)
        time.sleep(2)
    return []


# Etiquetas de tono de la voz v4 de ElevenLabs ("[sad]", "[slow]"): no se pronuncian, pero
# llegan en la transcripcion
ETIQUETA_TONO = re.compile(r"\[[a-z ]{2,20}\]\s*", re.IGNORECASE)


def generar_resumen(paciente, turnos):
    """Resumen clinico de la entrevista. Recibe tambien lo que el paciente reporto en el
    formulario: sin eso, "estoy en tratamiento" no dice de que, y "mi papa" no dice que tiene."""
    if paciente is None:
        return "FORMULARIO_PENDIENTE"

    conversacion = "\n".join(f"{t['role']}: {ETIQUETA_TONO.sub('', t['text']).strip()}" for t in turnos)
    nombre = (paciente.get('primerNombre') or '').strip() or "el paciente"
    salud = ", ".join(paciente.get('encuestaSalud') or []) or "ninguno"
    familia = ", ".join(paciente.get('antecedentesFamiliares') or []) or "ninguno"
    response = openai_client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": f"""Eres medico de salud ocupacional de BSL. Resume la entrevista de validacion preconsulta que hizo el medico virtual (assistant) con el paciente {nombre} (user).

Lo que el paciente reporto antes en su formulario:
- Historial de salud: {salud}
- Antecedentes familiares: {familia}
- Empresa en la orden: {empresa_de_la_orden(paciente) or "la orden no la trae"}

Transcripcion:
{conversacion}

Escribe el resumen EXACTAMENTE con este formato. Reglas:
- Redacta en tercera persona y en lenguaje clinico breve, no cites literalmente al paciente.
- Relaciona cada respuesta con lo que reporto en el formulario (ej. "Dolor de espalda: en tratamiento actualmente").
- Si el paciente cuenta en la entrevista algo que NO reporto en el formulario (una condicion, un medicamento, un antecedente familiar), agregale "(no estaba en el formulario)" para que el medico lo note.
- Usa solo lo que el paciente dijo en la entrevista; no inventes nada.
- Un dato del formulario que el paciente NO confirmo en la entrevista va como "segun formulario, no lo confirmo en la entrevista". Nunca escribas "reporta" o "refiere" de algo que no dijo en la entrevista.
- Si el paciente confirmo la empresa de la orden ("si"), escribe el nombre de esa empresa.
- Si un punto no se alcanzo a preguntar o el paciente no respondio, escribe "No respondio".

Resumen de la entrevista:
- Paciente: [nombre]
- Historial de salud: [condiciones del formulario y su estado actual segun el paciente]
- Antecedentes familiares: [quien tiene que condicion, y datos relevantes como si fallecio]
- Ocupacion anterior: [ultimo trabajo]
- Enfermedades o accidentes laborales: [respuesta]
- Empresa solicitante: [respuesta]"""}],
        max_tokens=400,
        temperature=0.2,
    )
    return response.choices[0].message.content.strip()
