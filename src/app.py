from flask import Flask, jsonify, request, render_template
from flask_cors import CORS
from dotenv import load_dotenv
import os
import logging

load_dotenv()

logging.basicConfig(
    format='%(asctime)s %(levelname)s %(name)s: %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

app = Flask(__name__, template_folder="templates", static_folder="static")
CORS(app)
logger.info("Flask iniciado correctamente")

from services.patient import fetch_patient_data, guardar_resumen, guardar_prueba_ojos
from services.email import send_summary_email
from services.whatsapp import send_text_message, send_template_message
from services.ai import enviar_sugerencias_whatsapp
from services.session import create_realtime_session
from services import avatar, grabacion
from services.avatar import PACIENTE_DEMO
import time


@app.route('/')
def index():
    # El link que manda NUBIA a la hora de la cita (plantilla recordatorio_cita de BSL-PLATAFORMA2)
    # apunta aqui y su URL esta fija en la plantilla aprobada por Meta: el interruptor decide si el
    # paciente ve el avatar en video o la llamada de voz, sin tocar la plantilla.
    if os.getenv('AVATAR_EN_INICIO') == '1':
        return render_template('avatar.html')
    return render_template('call.html')


@app.route('/voz')
def voz():
    """La llamada de voz de siempre, aunque el avatar este en el inicio."""
    return render_template('call.html')


@app.route('/api/paciente', methods=['GET'])
def get_paciente():
    _id = request.args.get('_id')
    if not _id:
        return jsonify({'error': 'Falta el parametro _id'}), 400

    try:
        result = fetch_patient_data(_id)

        if result.get('used'):
            return jsonify({'error': 'link_usado'}), 403

        if not result.get('found'):
            if result.get('celular'):
                return jsonify({
                    'error': 'Paciente no encontrado en formularios',
                    'celular': result['celular']
                }), 404
            else:
                return jsonify({'error': 'Paciente no encontrado'}), 404

        return jsonify({
            'primerNombre': result['primerNombre'],
            'celular': result['celular'],
            'encuestaSalud': result['encuestaSalud'],
            'antecedentesFamiliares': result['antecedentesFamiliares']
        })

    except Exception as e:
        logger.error("Error en /api/paciente: %s", str(e))
        return jsonify({'error': str(e)}), 500


@app.route('/session', methods=['GET'])
def get_session():
    try:
        return create_realtime_session()
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/send-email', methods=['POST'])
def send_email():
    body, status = despachar_resumen(request.json)
    return jsonify(body), status


def despachar_resumen(data):
    """Email + WhatsApp (resumen y sugerencias) + PostgreSQL. Lo usan la voz y el avatar."""
    try:
        message = data.get('message')
        _id = data.get('_id')
        nombre = data.get('nombre', 'Paciente')
        encuesta_salud = data.get('encuestaSalud', [])
        antecedentes_familiares = data.get('antecedentesFamiliares', [])
        indicadores_ojos = data.get('indicadoresOjos')

        logger.info("Datos recibidos en /send-email: %s", {
            '_id': _id, 'nombre': nombre,
            'message': message[:100] if len(message) > 100 else message
        })

        if not message:
            return {'error': 'Falta el mensaje'}, 400

        # Caso especial: Usuario sin formulario completado
        if message == "FORMULARIO_PENDIENTE":
            to = data.get('to')
            if not to:
                logger.error("No se proporciono numero de WhatsApp del paciente")
                return {'error': 'Falta numero de WhatsApp'}, 400

            link_formulario = f"https://bsl-plataforma.com/?_id={_id}"
            mensaje_formulario = f"""Hola, gracias por contactarte con BSL.

Para poder realizar tu consulta medica, necesitas completar primero las pruebas de salud ocupacional.

Por favor ingresa a este link para completar el formulario:
{link_formulario}

Una vez que termines, podras agendar tu consulta medica.

Si tienes alguna duda, no dudes en contactarnos.

🏥 *BSL - Salud Ocupacional*"""

            # Enviar como PLANTILLA (link_formulario, UTILITY) para que entregue también
            # fuera de la ventana de 24h. Antes se mandaba texto libre y fallaba con 63016
            # si el paciente no habia escrito en las ultimas 24h. Fallback a texto libre.
            template_formulario = os.getenv('TWILIO_TEMPLATE_LINK_FORMULARIO', 'HXea23b4e56f1a6e1a0ebda2378355442e')
            resultado_form = send_template_message(to, template_formulario, {"1": nombre, "2": _id, "3": data.get('empresa', 'BSL')})
            if resultado_form.get('success'):
                logger.info("Link de formulario enviado por WhatsApp (template link_formulario)")
            else:
                logger.warning("Template formulario fallo (%s); usando texto libre", resultado_form.get('error'))
                send_text_message(to, mensaje_formulario)

            return {
                'success': True,
                'message': 'Link de formulario enviado correctamente'
            }, 200

        # Flujo normal: Usuario con formulario completado
        send_summary_email(message)

        to = data.get('to')
        if not to:
            logger.error("No se proporciono numero de WhatsApp del paciente")
        else:
            template_resumen = os.getenv('TWILIO_TEMPLATE_RESUMEN_ENTREVISTA')
            if template_resumen:
                resumen_contenido = message
                if resumen_contenido.lower().lstrip().startswith('resumen de la entrevista'):
                    partes = resumen_contenido.split('\n', 1)
                    resumen_contenido = partes[1].strip() if len(partes) > 1 else resumen_contenido
                # Twilio content variables NO admiten newlines, tabs, ni >4 espacios (error 21656)
                resumen_contenido = resumen_contenido.replace('\t', ' ').strip()
                resumen_contenido = resumen_contenido.replace('\n', ' • ')
                while '    ' in resumen_contenido:
                    resumen_contenido = resumen_contenido.replace('    ', ' ')
                resumen_contenido = resumen_contenido[:900]
                resultado_template = send_template_message(to, template_resumen, {"1": nombre, "2": resumen_contenido})
                if resultado_template.get('success'):
                    logger.info("Resumen enviado por WhatsApp (template) OK")
                else:
                    logger.error("Fallo template resumen, usando free-text: %s", resultado_template.get('error'))
                    send_text_message(to, message)
            else:
                send_text_message(to, message)
                logger.info("Resumen enviado por WhatsApp (free-text fallback)")
            enviar_sugerencias_whatsapp(to, nombre, encuesta_salud, antecedentes_familiares, _id, indicadores_ojos)

        if _id:
            resultado_pg = guardar_resumen(_id, message)
            logger.info("Resultado al guardar en PostgreSQL: %s", resultado_pg)

        logger.info("Envio completo: email, WhatsApp (resumen + sugerencias), y PostgreSQL")
        return {
            'success': True,
            'message': 'Resumen y sugerencias enviados correctamente'
        }, 200

    except Exception as e:
        logger.error("Error en /send-email: %s", str(e))
        return {'error': f"Email error: {str(e)}"}, 500


# --- Avatar en video (LiveAvatar). Ver services/avatar.py ---

@app.route('/avatar')
def avatar_page():
    return render_template('avatar.html')


@app.route('/avatar/session', methods=['POST'])
def avatar_session():
    """Sin _id usa el paciente demo: sirve para probar sin tocar pacientes reales."""
    _id = (request.json or {}).get('_id')
    try:
        if _id:
            result = fetch_patient_data(_id)
            if result.get('used'):
                return jsonify({'error': 'link_usado'}), 403
            paciente = result if result.get('found') else None
            nombre = result.get('primerNombre')
        else:
            paciente, nombre = PACIENTE_DEMO, None

        sesion = avatar.start_session(paciente, f"bsl-{_id or 'demo'}-{int(time.time())}", nombre)
        return jsonify(sesion)
    except Exception as e:
        logger.error("Error en /avatar/session: %s", str(e))
        return jsonify({'error': str(e)}), 500


def guardar_evidencia(_id, data, resumen, turnos):
    """Evidencia de la entrevista a Spaces y la prueba de ojos a HistoriaClinica.pruebaOjos.
    Si Spaces falla, la prueba igual queda en la historia clinica, sin fotos."""
    carpeta, prueba = None, None
    try:
        carpeta, prueba = grabacion.guardar_entrevista(_id, data.get('conversation_id'), data.get('fotos'),
                                                       resumen, turnos, data.get('ref'), data.get('inicio'),
                                                       data.get('ojos'))
    except Exception as e:
        logger.error("No se pudo guardar la grabacion de %s: %s", _id or 'demo', e)
        prueba, _ = grabacion.limpiar_ojos(data.get('ojos'))
    if _id and prueba is not None:
        guardar_prueba_ojos(_id, prueba)
    return carpeta


@app.route('/avatar/end', methods=['POST'])
def avatar_end():
    """Cierra la sesion, arma el resumen desde la transcripcion y lo despacha (salvo en demo)."""
    data = request.json or {}
    session_id = data.get('session_id')
    _id = data.get('_id')
    avatar.stop_session(session_id)
    if data.get('context_id'):
        avatar.delete_context(data['context_id'])

    try:
        if _id:
            result = fetch_patient_data(_id)
            if result.get('used'):
                return jsonify({'error': 'link_usado'}), 403
            paciente = result if result.get('found') else None
            celular = result.get('celular')
        else:
            paciente, celular = PACIENTE_DEMO, None

        # La transcripcion del navegador llega al instante; la de LiveAvatar es el respaldo
        turnos = data.get('transcript') or avatar.fetch_transcript(session_id)

        # Cortada antes de la despedida: no hay resumen, asi que el link sigue sirviendo (se gasta
        # cuando se guarda resumenLlamada) y NUBIA no la marca ATENDIDO. La evidencia si se guarda,
        # para que el equipo vea el intento en la ficha.
        if paciente is not None and not avatar.entrevista_completa(turnos):
            logger.info("Entrevista incompleta %s (%d turnos)", _id or 'demo', len(turnos))
            guardar_evidencia(_id, data, avatar.RESUMEN_INCOMPLETA, turnos)
            return jsonify({'success': True, 'incompleta': True})

        resumen = avatar.generar_resumen(paciente, turnos)
        logger.info("Resumen avatar %s: %s", _id or 'demo', resumen[:200])

        # Evidencia (audio de ElevenLabs + fotos del navegador) en Spaces. Si falla, el
        # resumen igual se despacha: no se le cobra al paciente un error de almacenamiento.
        carpeta = guardar_evidencia(_id, data, resumen, turnos)

        if not _id:
            return jsonify({'success': True, 'demo': True, 'resumen': resumen, 'grabacion': carpeta})

        # Solo si la prueba de ojos se hizo: de ahi sale la 4a sugerencia, la visual
        ojos = grabacion.limpiar_ojos(data.get('ojos'))[0] or {}
        body, status = despachar_resumen({
            'message': resumen,
            '_id': _id,
            'to': celular,
            'nombre': (paciente or result).get('primerNombre') or 'Paciente',
            'encuestaSalud': (paciente or {}).get('encuestaSalud', []),
            'antecedentesFamiliares': (paciente or {}).get('antecedentesFamiliares', []),
            'indicadoresOjos': ojos.get('indicadores') if ojos.get('realizado') else None,
        })
        body['resumen'] = resumen
        return jsonify(body), status
    except Exception as e:
        logger.error("Error en /avatar/end: %s", str(e))
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    app.run(debug=True, host="0.0.0.0", port=port)
