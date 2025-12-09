from flask import Flask, jsonify, request, render_template
import requests
from flask_cors import CORS
import smtplib
from email.mime.text import MIMEText
from dotenv import load_dotenv
import os
import psycopg

load_dotenv()

app = Flask(__name__, template_folder="templates", static_folder="static")
CORS(app)
print("✅ Flask iniciado correctamente")

# Conexión a PostgreSQL
def get_db_connection():
    return psycopg.connect(
        host=os.getenv('DB_HOST'),
        port=os.getenv('DB_PORT'),
        dbname=os.getenv('DB_NAME'),
        user=os.getenv('DB_USER'),
        password=os.getenv('DB_PASSWORD'),
        sslmode='require'
    )

# Mapeo de columnas de salud a nombres legibles
SALUD_COLS = {
    'usa_anteojos': 'Usa anteojos',
    'presion_alta': 'Presión alta',
    'problemas_cardiacos': 'Problemas cardíacos',
    'dolor_cabeza': 'Dolor de cabeza',
    'dolor_espalda': 'Dolor de espalda',
    'hernias': 'Hernias',
    'varices': 'Várices',
    'hepatitis': 'Hepatitis',
    'problemas_sueno': 'Problemas de sueño',
    'problemas_azucar': 'Problemas de azúcar',
    'enfermedad_pulmonar': 'Enfermedad pulmonar',
    'enfermedad_higado': 'Enfermedad del hígado',
    'hormigueos': 'Hormigueos',
    'cirugia_ocular': 'Cirugía ocular',
    'cirugia_programada': 'Cirugía programada',
    'condicion_medica': 'Condición médica',
    'ruido_jaqueca': 'Ruido/Jaqueca',
    'embarazo': 'Embarazo',
    'fuma': 'Fuma',
    'consumo_licor': 'Consumo de licor',
    'trastorno_psicologico': 'Trastorno psicológico',
    'sintomas_psicologicos': 'Síntomas psicológicos',
    'diagnostico_cancer': 'Diagnóstico de cáncer',
    'enfermedades_laborales': 'Enfermedades laborales',
    'enfermedad_osteomuscular': 'Enfermedad osteomuscular',
    'enfermedad_autoinmune': 'Enfermedad autoinmune'
}

# Mapeo de columnas de antecedentes familiares
FAMILIA_COLS = {
    'familia_diabetes': 'Diabetes',
    'familia_hipertension': 'Hipertensión',
    'familia_cancer': 'Cáncer',
    'familia_infartos': 'Infartos',
    'familia_trastornos': 'Trastornos',
    'familia_infecciosas': 'Enfermedades infecciosas',
    'familia_hereditarias': 'Enfermedades hereditarias',
    'familia_geneticas': 'Enfermedades genéticas'
}

@app.route('/')
def index():
    return render_template('call.html')

@app.route('/api/paciente', methods=['GET'])
def get_paciente():
    _id = request.args.get('_id')
    if not _id:
        return jsonify({'error': 'Falta el parámetro _id'}), 400

    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # Obtener todas las columnas necesarias de formularios
        columns = ['primer_nombre', 'celular'] + list(SALUD_COLS.keys()) + list(FAMILIA_COLS.keys())
        columns_str = ', '.join(columns)

        cur.execute(f'SELECT {columns_str} FROM formularios WHERE wix_id = %s ORDER BY id DESC LIMIT 1', (_id,))
        row = cur.fetchone()

        cur.close()
        conn.close()

        if not row:
            return jsonify({'error': 'Paciente no encontrado'}), 404

        # Convertir a diccionario
        row_dict = dict(zip(columns, row))

        # Construir arrays de salud y antecedentes familiares
        encuestaSalud = [nombre for col, nombre in SALUD_COLS.items() if row_dict.get(col) == 'SI']
        antecedentesFamiliares = [nombre for col, nombre in FAMILIA_COLS.items() if row_dict.get(col) == 'SI']

        return jsonify({
            'primerNombre': row_dict.get('primer_nombre') or '',
            'celular': row_dict.get('celular') or '',
            'encuestaSalud': encuestaSalud,
            'antecedentesFamiliares': antecedentesFamiliares
        })

    except Exception as e:
        print(f"❌ Error en /api/paciente: {str(e)}")
        return jsonify({'error': str(e)}), 500

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

        # Guardar resumen en PostgreSQL si hay _id
        if _id:
            resultado_pg = guardar_resumen_postgres(_id, message)
            print("📤 Resultado al guardar en PostgreSQL:", resultado_pg)

        print("✅ Envío completo: email, WhatsApp, y PostgreSQL")
        return jsonify({
            'success': True,
            'message': 'Resumen enviado por email, WhatsApp y guardado en PostgreSQL'
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


def guardar_resumen_postgres(_id, resumen):
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            'UPDATE "HistoriaClinica" SET "resumenLlamada" = %s WHERE _id = %s',
            (resumen, _id)
        )
        conn.commit()
        rows_affected = cur.rowcount
        cur.close()
        conn.close()
        print(f"📡 Resumen guardado en PostgreSQL - filas afectadas: {rows_affected}")
        return {"success": True, "rows_affected": rows_affected}
    except Exception as e:
        print("❌ Error al guardar resumen en PostgreSQL:", str(e))
        return {"success": False, "error": str(e)}

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    app.run(debug=True, host="0.0.0.0", port=port)
