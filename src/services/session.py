import os
import logging
from openai import OpenAI

logger = logging.getLogger(__name__)


def create_realtime_session():
    """Crea una sesion efimera con OpenAI Realtime API (GA)."""
    client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))
    try:
        session = client.beta.realtime.sessions.create(
            model="gpt-4o-realtime-preview",
            voice="ash",
            modalities=["audio", "text"],
        )
        data = session.to_dict()
        logger.info("Session creada OK: %s", str(data)[:200])
        return data
    except Exception as e:
        logger.error("Error creando session OpenAI: %s", str(e))
        return {"error": {"message": str(e), "type": "session_error"}}
