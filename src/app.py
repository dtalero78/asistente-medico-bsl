from flask import Flask, jsonify, request, render_template
import requests
from flask_cors import CORS
import smtplib
from email.mime.text import MIMEText
from dotenv import load_dotenv
import os

load_dotenv()

app = Flask(__name__, template_folder="templates", static_folder="static")
CORS(app)
print("✅ Flask iniciado correctamente")

@app.route('/')
def index():
    return render_template('call.html')

@app.route('/session', methods=['GET'])
def get_session():
    try:
        url = "https://api.openai.com/v1/realtime/sessions"
        payload = {
            "model": "gpt-4o-realtime-preview-2024-12-17",
            "modalities": ["audio", "text"],
            "voice": "ash",
            "instructions": "Eres un asistente médico de BSL"
        }
        headers = {
            'Authorization': 'Bearer ' + os.getenv('OPENAI_API_KEY'),
            'Content-Type': 'application/json'
        }
        response = requests.post(url, json=payload, headers=headers)
        return response.json()
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/send-email', methods=['POST'])
def send_email():
    try:
        data = request.json
        message = data.get('message')
        _id = data.get('_id')

        print("📩 Datos recibidos en /send-email:", {'_id': _id, 'message': message})

        if not message:
            return jsonify({'error': 'Falta el mensaje'}), 400

        # Enviar correo
        msg = MIMEText(message)
        msg['Subject'] = 'Call Summary'
        msg['From'] = os.getenv('SMTP_USERNAME')
        msg['To'] = os.getenv('RECEIVING_EMAIL')

        with smtplib.SMTP_SSL(
            host=os.getenv('SMTP_HOST'),
            port=int(os.getenv('SMTP_PORT')),
            timeout=10
        ) as server:
            server.login(os.getenv('SMTP_USERNAME'), os.getenv('SMTP_PASSWORD'))
            server.send_message(msg)

        print("✅ Correo enviado")

        # ----------- AQUÍ VA EL ENVÍO POR WHATSAPP, BIEN INDENTADO ----------
        to = data.get('to')
        if not to:
            print("❌ No se proporcionó número de WhatsApp del paciente.")
        else:
            sendTextMessage(to, message)
        # -------------------------------------------------------------------

        # Guardar resumen en Wix si hay _id
        if _id:
            wix_url = "https://www.bsl.com.co/_functions/actualizarResumen"
            resultado_wix = enviar_resumen_a_wix(wix_url, _id, message)
            print("📤 Resultado al guardar en Wix:", resultado_wix)

        print("✅ Envío completo: email, WhatsApp, y Wix")
        return jsonify({
            'success': True,
            'message': 'Resumen enviado por email, WhatsApp y guardado en Wix'
        })

    except Exception as e:
        print("❌ Error en /send-email:", str(e))
        return jsonify({'error': f"Email error: {str(e)}"}), 500

def sendTextMessage(to, message):
    # --- Formatea el número ---
    to = str(to).replace(' ', '').replace('+', '')
    if not to.startswith('57'):
        to = '57' + to
    # --------------------------

    url = "https://gate.whapi.cloud/messages/text"
    headers = {
        "accept": "application/json",
        "authorization": f"Bearer {os.getenv('WHAPI_TOKEN')}",
        "content-type": "application/json"
    }
    payload = {
        "typing_time": 0,
        "to": to,
        "body": message
    }
    try:
        response = requests.post(url, json=payload, headers=headers)
        print("📡 Código de respuesta Whapi:", response.status_code)
        print("📡 Body de respuesta Whapi:", response.text)
        response.raise_for_status()
        print("✅ WhatsApp enviado")
        return response.json()
    except Exception as e:
        print("❌ Error al enviar por WhatsApp:", e)
        if 'response' in locals():
            print("🔴 Respuesta completa Whapi (error):", response.text)
        return {"success": False, "error": str(e), "body": response.text if 'response' in locals() else ""}


def enviar_resumen_a_wix(wix_url, _id, resumen):
    try:
        payload = {
            "_id": _id,
            "resumen": resumen
        }
        headers = {
            "Content-Type": "application/json"
        }

        response = requests.post(wix_url, json=payload, headers=headers)
        print("📡 Respuesta de Wix - status:", response.status_code)
        print("📡 Respuesta de Wix - body:", response.text)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print("❌ Error al enviar resumen a Wix:", str(e))
        return {"success": False, "error": str(e)}

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    app.run(debug=True, host="0.0.0.0", port=port)
