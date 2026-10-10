import os
import re
import json
import logging
from twilio.rest import Client
from db import db_pool

logger = logging.getLogger(__name__)

twilio_client = Client(
    os.getenv('TWILIO_ACCOUNT_SID'),
    os.getenv('TWILIO_AUTH_TOKEN')
)

# Esta app solo atiende pacientes de BSL. Las tablas de WhatsApp son multi-tenant
# (las comparte con BSL-PLATAFORMA2), asi que todo lo que se lee o escribe va
# filtrado por tenant: si no, un celular que tambien existe en otro tenant podria
# recibir el mensaje en esa conversacion y no verse en ninguna bandeja de IrisChat.
TENANT_ID = 'bsl'

# Texto de las plantillas Twilio Content (son inmutables -> 1 fetch por SID).
_plantillas_cache = {}


def _aplicar_variables(texto, variables):
    return re.sub(r'\{\{(\d+)\}\}', lambda m: str(variables.get(m.group(1), m.group(0))), texto or '')


def _texto_plantilla(content_sid, variables):
    """Texto legible de la plantilla para guardarlo en el chat.

    Mismo criterio que BSL-PLATAFORMA2 (renderTemplateMensaje): el body con las
    variables sustituidas mas los links de los botones. Asi IrisChat muestra lo que
    el paciente recibio. Antes se guardaba '[TEMPLATE] HX... | {{1}}: ...', un formato
    que IrisChat no sabe leer y que dibujaba como una tarjeta vacia.
    """
    if content_sid not in _plantillas_cache:
        try:
            types = twilio_client.content.v1.contents(content_sid).fetch().types or {}
            body, actions = '', []
            for t in types.values():
                # twilio/text usa `body`; twilio/card pone el texto en `title`.
                if not body and (t.get('body') or t.get('title')):
                    body = t.get('body') or t.get('title')
                if not actions and isinstance(t.get('actions'), list):
                    actions = t['actions']
            if body:
                _plantillas_cache[content_sid] = (body, actions)
        except Exception as e:
            logger.warning("No se pudo leer el texto de la plantilla %s: %s", content_sid, e)

    if content_sid in _plantillas_cache:
        body, actions = _plantillas_cache[content_sid]
        texto = _aplicar_variables(body, variables)
        urls = [a for a in actions if a and a.get('type') == 'URL' and a.get('url')]
        if urls:
            texto += '\n' + '\n'.join(f"🔗 {_aplicar_variables(a['url'], variables)}" for a in urls)
        return texto

    # Si Twilio no responde: el placeholder de PLATAFORMA2, que IrisChat si sabe dibujar.
    vars_texto = ', '.join(f'{{{{{k}}}}}: {v}' for k, v in variables.items())
    return f'[TEMPLATE] Template enviado ({content_sid})\nVariables: {vars_texto}'


def send_template_message(to, content_sid, variables: dict):
    """Envia mensaje de WhatsApp usando una plantilla Twilio aprobada por Meta."""
    try:
        to = str(to).replace(' ', '').replace('+', '')
        if not to.startswith('57'):
            to = '57' + to
        to_whatsapp = f'whatsapp:+{to}'
        celular_bd = f'+{to}'
        from_whatsapp = os.getenv('TWILIO_WHATSAPP_FROM')

        message_response = twilio_client.messages.create(
            content_sid=content_sid,
            content_variables=json.dumps(variables),
            from_=from_whatsapp,
            to=to_whatsapp
        )

        logger.info("Template enviado - SID: %s, Estado: %s", message_response.sid, message_response.status)

        contenido = _texto_plantilla(content_sid, variables)
        _registrar_mensaje_bd(celular_bd, contenido, message_response.sid, tipo_mensaje='template')

        return {"success": True, "sid": message_response.sid, "status": message_response.status}

    except Exception as e:
        logger.error("Error al enviar template WhatsApp: %s", e)
        return {"success": False, "error": str(e)}


def send_text_message(to, message):
    """Envia mensaje de WhatsApp usando Twilio y registra en BD."""
    try:
        to = str(to).replace(' ', '').replace('+', '')
        if not to.startswith('57'):
            to = '57' + to

        to_whatsapp = f'whatsapp:+{to}'
        celular_bd = f'+{to}'
        from_whatsapp = os.getenv('TWILIO_WHATSAPP_FROM')

        logger.info("Enviando WhatsApp de %s a %s", from_whatsapp, to_whatsapp)

        message_response = twilio_client.messages.create(
            body=message,
            from_=from_whatsapp,
            to=to_whatsapp
        )

        logger.info("WhatsApp enviado - SID: %s, Estado: %s", message_response.sid, message_response.status)

        conversacion_id = _registrar_mensaje_bd(celular_bd, message, message_response.sid)

        return {
            "success": True,
            "sid": message_response.sid,
            "status": message_response.status,
            "conversacion_id": conversacion_id
        }

    except Exception as e:
        logger.error("Error al enviar por WhatsApp (Twilio): %s", e)
        return {
            "success": False,
            "error": str(e)
        }


def _registrar_mensaje_bd(celular, contenido, sid_twilio, tipo_mensaje='text'):
    """Registra o actualiza la conversacion y guarda el mensaje en BD."""
    conversacion_id = None
    try:
        with db_pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    'SELECT id FROM conversaciones_whatsapp WHERE celular = %s AND tenant_id = %s',
                    (celular, TENANT_ID)
                )
                conv_existente = cur.fetchone()

                if conv_existente:
                    conversacion_id = conv_existente[0]
                    cur.execute(
                        '''UPDATE conversaciones_whatsapp
                           SET "stopBot" = true, fecha_ultima_actividad = NOW()
                           WHERE id = %s AND tenant_id = %s''',
                        (conversacion_id, TENANT_ID)
                    )
                    logger.info("Conversacion actualizada para %s - Conv ID: %s", celular, conversacion_id)
                else:
                    cur.execute(
                        '''INSERT INTO conversaciones_whatsapp
                           (celular, nombre_paciente, estado, "stopBot", fecha_ultima_actividad, tenant_id)
                           VALUES (%s, %s, 'cerrada', true, NOW(), %s)
                           RETURNING id''',
                        (celular, 'Asistente Medico IA', TENANT_ID)
                    )
                    conversacion_id = cur.fetchone()[0]
                    logger.info("Nueva conversacion creada para %s - Conv ID: %s", celular, conversacion_id)

                cur.execute(
                    'SELECT id FROM mensajes_whatsapp WHERE sid_twilio = %s AND tenant_id = %s',
                    (sid_twilio, TENANT_ID)
                )
                mensaje_existente = cur.fetchone()

                if not mensaje_existente:
                    cur.execute(
                        '''INSERT INTO mensajes_whatsapp
                           (conversacion_id, contenido, direccion, sid_twilio, tipo_mensaje,
                            enviado_por_tipo, timestamp, tenant_id)
                           VALUES (%s, %s, 'saliente', %s, %s, 'sistema', NOW(), %s)''',
                        (conversacion_id, contenido, sid_twilio, tipo_mensaje, TENANT_ID)
                    )
                    logger.info("Mensaje guardado en mensajes_whatsapp - Conv ID: %s, SID: %s", conversacion_id, sid_twilio)
                else:
                    logger.info("Mensaje %s ya existe en BD, omitiendo duplicado", sid_twilio)

                conn.commit()

    except Exception as db_error:
        logger.warning("Error al registrar conversacion/mensaje en BD: %s", db_error)

    return conversacion_id
