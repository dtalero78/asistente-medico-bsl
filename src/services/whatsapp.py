import os
import logging
from twilio.rest import Client
from db import db_pool

logger = logging.getLogger(__name__)

twilio_client = Client(
    os.getenv('TWILIO_ACCOUNT_SID'),
    os.getenv('TWILIO_AUTH_TOKEN')
)


def send_text_message(to, message):
    """Envia mensaje de WhatsApp usando Twilio y registra en BD."""
    try:
        to = str(to).replace(' ', '').replace('+', '')
        if not to.startswith('57'):
            to = '57' + to

        to_whatsapp = f'whatsapp:+{to}'
        from_whatsapp = os.getenv('TWILIO_WHATSAPP_FROM')

        logger.info("Enviando WhatsApp de %s a %s", from_whatsapp, to_whatsapp)

        message_response = twilio_client.messages.create(
            body=message,
            from_=from_whatsapp,
            to=to_whatsapp
        )

        logger.info("WhatsApp enviado - SID: %s, Estado: %s", message_response.sid, message_response.status)

        conversacion_id = _registrar_mensaje_bd(to, message, message_response.sid)

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


def _registrar_mensaje_bd(celular, contenido, sid_twilio):
    """Registra o actualiza la conversacion y guarda el mensaje en BD."""
    conversacion_id = None
    try:
        with db_pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    'SELECT id FROM conversaciones_whatsapp WHERE celular = %s',
                    (celular,)
                )
                conv_existente = cur.fetchone()

                if conv_existente:
                    conversacion_id = conv_existente[0]
                    cur.execute(
                        '''UPDATE conversaciones_whatsapp
                           SET "stopBot" = true, fecha_ultima_actividad = NOW()
                           WHERE celular = %s''',
                        (celular,)
                    )
                    logger.info("Conversacion actualizada para %s - Conv ID: %s", celular, conversacion_id)
                else:
                    cur.execute(
                        '''INSERT INTO conversaciones_whatsapp
                           (celular, nombre_paciente, estado, "stopBot", fecha_ultima_actividad)
                           VALUES (%s, %s, 'cerrada', true, NOW())
                           RETURNING id''',
                        (celular, 'Asistente Medico IA')
                    )
                    conversacion_id = cur.fetchone()[0]
                    logger.info("Nueva conversacion creada para %s - Conv ID: %s", celular, conversacion_id)

                cur.execute(
                    'SELECT id FROM mensajes_whatsapp WHERE sid_twilio = %s',
                    (sid_twilio,)
                )
                mensaje_existente = cur.fetchone()

                if not mensaje_existente:
                    cur.execute(
                        '''INSERT INTO mensajes_whatsapp
                           (conversacion_id, contenido, direccion, sid_twilio, tipo_mensaje, timestamp)
                           VALUES (%s, %s, 'saliente', %s, 'text', NOW())''',
                        (conversacion_id, contenido, sid_twilio)
                    )
                    logger.info("Mensaje guardado en mensajes_whatsapp - Conv ID: %s, SID: %s", conversacion_id, sid_twilio)
                else:
                    logger.info("Mensaje %s ya existe en BD, omitiendo duplicado", sid_twilio)

                conn.commit()

    except Exception as db_error:
        logger.warning("Error al registrar conversacion/mensaje en BD: %s", db_error)

    return conversacion_id
