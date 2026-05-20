import os
import logging
import requests

logger = logging.getLogger(__name__)


def create_realtime_session():
    """Crea un client secret efimero con OpenAI Realtime GA API."""
    response = requests.post(
        "https://api.openai.com/v1/realtime/client_secrets",
        json={
            "session": {
                "type": "realtime",
                "model": "gpt-4o-realtime-preview",
            }
        },
        headers={
            "Authorization": "Bearer " + os.getenv("OPENAI_API_KEY"),
            "Content-Type": "application/json"
        }
    )
    data = response.json()
    logger.info("client_secrets [%s]: %s", response.status_code, str(data)[:300])
    if "value" in data:
        return {"client_secret": {"value": data["value"]}}
    return data
