import os
import logging
from openai import OpenAI
from services.whatsapp import send_template_message, send_text_message

logger = logging.getLogger(__name__)

openai_client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))


def generar_sugerencias_salud(nombre, encuesta_salud, antecedentes_familiares):
    """Genera 3 sugerencias de salud personalizadas usando OpenAI."""
    try:
        prompt = f"""Eres un asesor de salud ocupacional amable y profesional de BSL.

Datos del paciente:
- Nombre: {nombre}
- Condiciones de salud reportadas: {', '.join(encuesta_salud) if encuesta_salud else 'Ninguna'}
- Antecedentes familiares: {', '.join(antecedentes_familiares) if antecedentes_familiares else 'Ninguno'}

Genera EXACTAMENTE 3 sugerencias de salud personalizadas y practicas para este paciente.

REGLAS:
- Cada sugerencia debe ser breve (1-2 oraciones maximo)
- Deben ser consejos preventivos, NO diagnosticos
- Usa un tono calido y motivador
- Personaliza segun las condiciones reportadas
- Si no hay condiciones, da consejos generales de bienestar laboral

FORMATO DE RESPUESTA (usa exactamente este formato):
1. [emoji relevante] [sugerencia]
2. [emoji relevante] [sugerencia]
3. [emoji relevante] [sugerencia]

Ejemplos de emojis apropiados: 💪 🏃 🥗 😴 💧 🧘 👁️ ❤️ 🩺 🌿"""

        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=300,
            temperature=0.7
        )

        sugerencias = response.choices[0].message.content.strip()
        logger.info("Sugerencias generadas: %s", sugerencias)
        return sugerencias

    except Exception as e:
        logger.error("Error generando sugerencias: %s", str(e))
        return None


def enviar_sugerencias_whatsapp(to, nombre, encuesta_salud, antecedentes_familiares, _id=None):
    """Genera y envia sugerencias personalizadas por WhatsApp."""
    sugerencias = generar_sugerencias_salud(nombre, encuesta_salud, antecedentes_familiares)

    if not sugerencias:
        logger.warning("No se pudieron generar sugerencias")
        return

    # Sanea para cumplir reglas de variables de Twilio/WhatsApp (evita error 21656):
    # sin saltos de linea consecutivos, sin tabs, sin >4 espacios, max 900 chars.
    sugerencias = sugerencias.replace('\t', ' ').strip()
    while '\n\n' in sugerencias:
        sugerencias = sugerencias.replace('\n\n', '\n')
    while '    ' in sugerencias:
        sugerencias = sugerencias.replace('    ', ' ')
    sugerencias = sugerencias[:900]

    template_sid = os.getenv('TWILIO_TEMPLATE_SUGERENCIAS_SALUD')
    if template_sid:
        send_template_message(to, template_sid, {"1": nombre, "2": sugerencias})
        logger.info("Sugerencias enviadas por WhatsApp (template)")
    else:
        # Fallback a free-text si el template no está configurado
        mensaje = f"""✨ *Hola {nombre}* ✨

Gracias por completar tu entrevista de salud ocupacional con BSL.

Aqui tienes algunas recomendaciones personalizadas para ti:

{sugerencias}

─────────────────
🏥 *BSL - Salud Ocupacional*
Cuidamos de ti y tu bienestar laboral 💙"""
        send_text_message(to, mensaje)
        logger.info("Sugerencias enviadas por WhatsApp (free-text fallback)")

    if _id:
        link_certificado = f"https://bsl-utilidades-yp78a.ondigitalocean.app/static/solicitar-certificado.html?id={_id}"
        mensaje_certificado = f"Puedes descargar tu certificado en: {link_certificado}"
    else:
        mensaje_certificado = "En un momento llegara tu certificado"

    send_text_message(to, mensaje_certificado)
    logger.info("Mensaje de certificado enviado por WhatsApp%s", ' con link personalizado' if _id else '')
