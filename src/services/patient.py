import logging
from db import db_pool

logger = logging.getLogger(__name__)

# Mapeo de columnas de salud a nombres legibles
SALUD_COLS = {
    'usa_anteojos': 'Usa anteojos',
    'presion_alta': 'Presion alta',
    'problemas_cardiacos': 'Problemas cardiacos',
    'dolor_cabeza': 'Dolor de cabeza',
    'dolor_espalda': 'Dolor de espalda',
    'hernias': 'Hernias',
    'varices': 'Varices',
    'hepatitis': 'Hepatitis',
    'problemas_sueno': 'Problemas de sueno',
    'problemas_azucar': 'Problemas de azucar',
    'enfermedad_pulmonar': 'Enfermedad pulmonar',
    'enfermedad_higado': 'Enfermedad del higado',
    'hormigueos': 'Hormigueos',
    'cirugia_ocular': 'Cirugia ocular',
    'cirugia_programada': 'Cirugia programada',
    'condicion_medica': 'Condicion medica',
    'ruido_jaqueca': 'Ruido/Jaqueca',
    'embarazo': 'Embarazo',
    'fuma': 'Fuma',
    'consumo_licor': 'Consumo de licor',
    'trastorno_psicologico': 'Trastorno psicologico',
    'sintomas_psicologicos': 'Sintomas psicologicos',
    'diagnostico_cancer': 'Diagnostico de cancer',
    'enfermedades_laborales': 'Enfermedades laborales',
    'enfermedad_osteomuscular': 'Enfermedad osteomuscular',
    'enfermedad_autoinmune': 'Enfermedad autoinmune'
}

# Mapeo de columnas de antecedentes familiares
FAMILIA_COLS = {
    'familia_diabetes': 'Diabetes',
    'familia_hipertension': 'Hipertension',
    'familia_cancer': 'Cancer',
    'familia_infartos': 'Infartos',
    'familia_trastornos': 'Trastornos',
    'familia_infecciosas': 'Enfermedades infecciosas',
    'familia_hereditarias': 'Enfermedades hereditarias',
    'familia_geneticas': 'Enfermedades geneticas'
}


def fetch_patient_data(_id):
    """Busca datos del paciente en formularios, con fallback a HistoriaClinica.

    Returns:
        dict con datos del paciente, o dict con 'error' y opcionalmente 'celular'
    Raises:
        Exception si hay error de BD
    """
    with db_pool.connection() as conn:
        with conn.cursor() as cur:
            columns = ['primer_nombre', 'celular'] + list(SALUD_COLS.keys()) + list(FAMILIA_COLS.keys())
            columns_str = ', '.join(columns)

            cur.execute(f'SELECT {columns_str} FROM formularios WHERE wix_id = %s ORDER BY id DESC LIMIT 1', (_id,))
            row = cur.fetchone()

            if not row:
                logger.warning("No se encontro paciente en formularios para _id: %s", _id)
                logger.info("Buscando celular en HistoriaClinica...")

                cur.execute('SELECT celular FROM "HistoriaClinica" WHERE _id = %s LIMIT 1', (_id,))
                historia_row = cur.fetchone()

                if historia_row and historia_row[0]:
                    celular = historia_row[0].strip()
                    logger.info("Celular encontrado en HistoriaClinica: %s", celular)
                    return {
                        'found': False,
                        'celular': celular
                    }
                else:
                    logger.error("No se encontro celular en HistoriaClinica para _id: %s", _id)
                    return {'found': False, 'celular': None}

            row_dict = dict(zip(columns, row))

            encuesta_salud = [nombre for col, nombre in SALUD_COLS.items() if row_dict.get(col) == 'SI']
            antecedentes_familiares = [nombre for col, nombre in FAMILIA_COLS.items() if row_dict.get(col) == 'SI']

            return {
                'found': True,
                'primerNombre': row_dict.get('primer_nombre') or '',
                'celular': row_dict.get('celular') or '',
                'encuestaSalud': encuesta_salud,
                'antecedentesFamiliares': antecedentes_familiares
            }


def guardar_resumen(_id, resumen):
    """Guarda el resumen de la llamada en HistoriaClinica."""
    try:
        with db_pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    'UPDATE "HistoriaClinica" SET "resumenLlamada" = %s WHERE _id = %s',
                    (resumen, _id)
                )
                conn.commit()
                rows_affected = cur.rowcount
                logger.info("Resumen guardado en PostgreSQL - filas afectadas: %d", rows_affected)
                return {"success": True, "rows_affected": rows_affected}
    except Exception as e:
        logger.error("Error al guardar resumen en PostgreSQL: %s", str(e))
        return {"success": False, "error": str(e)}
