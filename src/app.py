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

from services.patient import fetch_patient_data, guardar_resumen
from services.email import send_summary_email
from services.whatsapp import send_text_message, send_template_message
from services.ai import enviar_sugerencias_whatsapp
from services.session import create_realtime_session


@app.route('/')
def index():
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
    try:
        data = request.json
        message = data.get('message')
        _id = data.get('_id')
        nombre = data.get('nombre', 'Paciente')
        encuesta_salud = data.get('encuestaSalud', [])
        antecedentes_familiares = data.get('antecedentesFamiliares', [])

        logger.info("Datos recibidos en /send-email: %s", {
            '_id': _id, 'nombre': nombre,
            'message': message[:100] if len(message) > 100 else message
        })

        if not message:
            return jsonify({'error': 'Falta el mensaje'}), 400

        # Caso especial: Usuario sin formulario completado
        if message == "FORMULARIO_PENDIENTE":
            to = data.get('to')
            if not to:
                logger.error("No se proporciono numero de WhatsApp del paciente")
                return jsonify({'error': 'Falta numero de WhatsApp'}), 400

            link_formulario = f"https://bsl-plataforma.com/?_id={_id}"
            mensaje_formulario = f"""Hola, gracias por contactarte con BSL.

Para poder realizar tu consulta medica, necesitas completar primero las pruebas de salud ocupacional.

Por favor ingresa a este link para completar el formulario:
{link_formulario}

Una vez que termines, podras agendar tu consulta medica.

Si tienes alguna duda, no dudes en contactarnos.

🏥 *BSL - Salud Ocupacional*"""

            send_text_message(to, mensaje_formulario)
            logger.info("Link de formulario enviado por WhatsApp")

            return jsonify({
                'success': True,
                'message': 'Link de formulario enviado correctamente'
            })

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
                resumen_contenido = resumen_contenido.replace('\t', ' ').strip()
                while '\n\n' in resumen_contenido:
                    resumen_contenido = resumen_contenido.replace('\n\n', '\n')
                while '    ' in resumen_contenido:
                    resumen_contenido = resumen_contenido.replace('    ', ' ')
                resumen_contenido = resumen_contenido[:900]
                send_template_message(to, template_resumen, {"1": nombre, "2": resumen_contenido})
                logger.info("Resumen enviado por WhatsApp (template)")
            else:
                send_text_message(to, message)
                logger.info("Resumen enviado por WhatsApp (free-text fallback)")
            enviar_sugerencias_whatsapp(to, nombre, encuesta_salud, antecedentes_familiares, _id)

        if _id:
            resultado_pg = guardar_resumen(_id, message)
            logger.info("Resultado al guardar en PostgreSQL: %s", resultado_pg)

        logger.info("Envio completo: email, WhatsApp (resumen + sugerencias), y PostgreSQL")
        return jsonify({
            'success': True,
            'message': 'Resumen y sugerencias enviados correctamente'
        })

    except Exception as e:
        logger.error("Error en /send-email: %s", str(e))
        return jsonify({'error': f"Email error: {str(e)}"}), 500


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    app.run(debug=True, host="0.0.0.0", port=port)
