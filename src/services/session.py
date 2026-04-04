import os
import logging
import requests

logger = logging.getLogger(__name__)


def create_realtime_session():
    """Crea una sesion efimera con OpenAI Realtime API."""
    url = "https://api.openai.com/v1/realtime/sessions"
    payload = {
        "model": "gpt-4o-realtime-preview-2024-12-17",
        "modalities": ["audio", "text"],
        "voice": "ash",
        "instructions": "Eres un asistente medico de BSL"
    }
    headers = {
        'Authorization': 'Bearer ' + os.getenv('OPENAI_API_KEY'),
        'Content-Type': 'application/json'
    }
    response = requests.post(url, json=payload, headers=headers)
    return response.json()
