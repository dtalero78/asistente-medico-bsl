"""Crea o actualiza el agente de ElevenLabs del avatar (el "cerebro") a partir de prompt.md.

Mismo patron que el agente de llamadas del CRM de LGS (scripts/agente-voz/sync.mjs alla).

    python scripts/agente-avatar/sync.py   # sin ELEVENLABS_AGENT_ID en .env: lo crea e imprime el id
                                           # con ELEVENLABS_AGENT_ID: lo actualiza
"""
import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parents[2]
load_dotenv(RAIZ / '.env')

API = 'https://api.elevenlabs.io/v1/convai/agents'
KEY = os.getenv('ELEVENLABS_API_KEY')
AGENT_ID = os.getenv('ELEVENLABS_AGENT_ID')
if not KEY:
    sys.exit('Falta ELEVENLABS_API_KEY')

prompt = (Path(__file__).parent / 'prompt.md').read_text(encoding='utf-8')

config = {
    'name': 'BSL · Médico virtual (avatar)',
    'tags': ['asistente-medico-bsl'],
    'conversation_config': {
        'agent': {
            'language': 'es',
            'first_message': 'Hola {{nombre}}, soy el médico virtual de BSL. ¿Tienes un minuto para unas preguntas rápidas antes de tu examen?',
            'dynamic_variables': {
                'dynamic_variable_placeholders': {
                    'nombre': 'Carlos',
                    'formulario_completo': 'si',
                    'historial_salud': 'Dolor de espalda, Usa anteojos',
                    'antecedentes_familiares': 'Hipertension',
                    # La de la orden; 'no indicada' si dice PARTICULAR (avatar.empresa_de_la_orden)
                    'empresa': 'no indicada',
                    # Codigo de la sesion (no lo usa el prompt): con el se encuentra el audio
                    # de cada entrevista en src/services/grabacion.py
                    'ref_bsl': 'demo',
                },
            },
            'prompt': {
                'prompt': prompt,
                'llm': 'claude-haiku-5-5',
                'temperature': None,
                'built_in_tools': {
                    'end_call': {'name': 'end_call', 'params': {'system_tool_type': 'end_call'}},
                },
            },
        },
        # Alirio: colombiano, calido (biblioteca de ElevenLabs). LiveAvatar exige PCM 24 kHz.
        'tts': {
            'model_id': 'eleven_v4_turbo',
            'voice_id': 'nPwdEe2zxbAbdkRLsG5T',
            'agent_output_audio_format': 'pcm_24000',
        },
        'asr': {'keywords': ['BSL', 'anteojos', 'hipertensión', 'osteomuscular']},
        # El paciente puede interrumpir al doctor (el microfono va siempre abierto), pero un
        # "ajá" o un "mmm" mientras el doctor habla no lo corta, como no cortaria a una persona
        'turn': {
            'interruption_ignore_terms': ['ajá', 'aja', 'mmm', 'mm', 'ujum', 'ok', 'okey', 'sí sí', 'claro'],
            'interruption_ignore_term_languages': ['es'],
            'merge_with_default_ignore_terms': True,
            # noisy_environment_detection no esta disponible en el plan Creator (403)
        },
        'conversation': {'max_duration_seconds': 600},
    },
    # Son datos de salud: el audio y la transcripcion se copian a Spaces de BSL al terminar
    # (src/services/grabacion.py), asi que ElevenLabs no necesita guardarlos para siempre
    'platform_settings': {
        'privacy': {'record_voice': True, 'retention_days': 30},
    },
}

res = requests.request(
    'PATCH' if AGENT_ID else 'POST',
    f'{API}/{AGENT_ID}' if AGENT_ID else f'{API}/create',
    headers={'xi-api-key': KEY},
    json=config,
    timeout=30,
)
if not res.ok:
    sys.exit(f'{res.status_code} {res.text[:1000]}')
print(f'Agente {AGENT_ID} actualizado' if AGENT_ID else f"Agente creado: {res.json()['agent_id']}")
