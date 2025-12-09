from flask import Flask, jsonify, request, render_template
import requests
from flask_cors import CORS
import smtplib
from email.mime.text import MIMEText
from dotenv import load_dotenv
import os
import psycopg
from openai import OpenAI

load_dotenv()

app = Flask(__name__, template_folder="templates", static_folder="static")
CORS(app)
print("✅ Flask iniciado correctamente")

# Cliente OpenAI para generar sugerencias
openai_client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))

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
            "model": "gpt-realtime",
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
        nombre = data.get('nombre', 'Paciente')
        encuesta_salud = data.get('encuestaSalud', [])
        antecedentes_familiares = data.get('antecedentesFamiliares', [])

        print("📩 Datos recibidos en /send-email:", {'_id': _id, 'nombre': nombre, 'message': message[:100] + '...'})

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

        # Envío por WhatsApp: resumen + sugerencias personalizadas
        to = data.get('to')
        if not to:
            print("❌ No se proporcionó número de WhatsApp del paciente.")
        else:
            # 1. Enviar el resumen de la llamada
            sendTextMessage(to, message)

            # 2. Enviar sugerencias personalizadas (después del resumen)
            enviar_sugerencias_whatsapp(to, nombre, encuesta_salud, antecedentes_familiares)

        # Guardar resumen en PostgreSQL si hay _id
        if _id:
            resultado_pg = guardar_resumen_postgres(_id, message)
            print("📤 Resultado al guardar en PostgreSQL:", resultado_pg)

        print("✅ Envío completo: email, WhatsApp (resumen + sugerencias), y PostgreSQL")
        return jsonify({
            'success': True,
            'message': 'Resumen y sugerencias enviados correctamente'
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


def generar_sugerencias_salud(nombre, encuesta_salud, antecedentes_familiares):
    """Genera 3 sugerencias de salud personalizadas usando OpenAI"""
    try:
        prompt = f"""Eres un asesor de salud ocupacional amable y profesional de BSL.

Datos del paciente:
- Nombre: {nombre}
- Condiciones de salud reportadas: {', '.join(encuesta_salud) if encuesta_salud else 'Ninguna'}
- Antecedentes familiares: {', '.join(antecedentes_familiares) if antecedentes_familiares else 'Ninguno'}

Genera EXACTAMENTE 3 sugerencias de salud personalizadas y prácticas para este paciente.

REGLAS:
- Cada sugerencia debe ser breve (1-2 oraciones máximo)
- Deben ser consejos preventivos, NO diagnósticos
- Usa un tono cálido y motivador
- Personaliza según las condiciones reportadas
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
        print(f"✅ Sugerencias generadas: {sugerencias}")
        return sugerencias

    except Exception as e:
        print(f"❌ Error generando sugerencias: {str(e)}")
        return None


def enviar_sugerencias_whatsapp(to, nombre, encuesta_salud, antecedentes_familiares):
    """Genera y envía sugerencias personalizadas por WhatsApp"""
    sugerencias = generar_sugerencias_salud(nombre, encuesta_salud, antecedentes_familiares)

    if not sugerencias:
        print("⚠️ No se pudieron generar sugerencias")
        return

    mensaje = f"""✨ *Hola {nombre}* ✨

Gracias por completar tu entrevista de salud ocupacional con BSL.

Aquí tienes algunas recomendaciones personalizadas para ti:

{sugerencias}

─────────────────
🏥 *BSL - Salud Ocupacional*
Cuidamos de ti y tu bienestar laboral 💙"""

    sendTextMessage(to, mensaje)
    print("✅ Sugerencias enviadas por WhatsApp")

    # 3. Enviar mensaje sobre el certificado
    mensaje_certificado = "📄 En un momento llegará tu certificado."
    sendTextMessage(to, mensaje_certificado)
    print("✅ Mensaje de certificado enviado por WhatsApp")

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    app.run(debug=True, host="0.0.0.0", port=port)
