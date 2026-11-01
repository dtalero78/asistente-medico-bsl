import json
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
            # Verificar si la llamada ya fue realizada
            cur.execute(
                'SELECT "resumenLlamada", empresa FROM "HistoriaClinica" WHERE _id = %s LIMIT 1',
                (_id,)
            )
            historia = cur.fetchone()
            if historia and historia[0]:
                logger.info("Link ya usado para _id: %s", _id)
                return {'used': True}
            # El medico virtual la confirma en vez de preguntarla (ver avatar.empresa_de_la_orden)
            empresa = ((historia[1] if historia else None) or '').strip()

            columns = ['primer_nombre', 'celular'] + list(SALUD_COLS.keys()) + list(FAMILIA_COLS.keys())
            columns_str = ', '.join(columns)

            cur.execute(f'SELECT {columns_str} FROM formularios WHERE wix_id = %s ORDER BY id DESC LIMIT 1', (_id,))
            row = cur.fetchone()

            if not row:
                logger.warning("No se encontro paciente en formularios para _id: %s", _id)
                logger.info("Buscando celular en HistoriaClinica...")

                # El nombre tambien: sin el, el avatar saludaba "Hola , soy..." y el WhatsApp "Hola Paciente"
                cur.execute('SELECT celular, "primerNombre" FROM "HistoriaClinica" WHERE _id = %s LIMIT 1', (_id,))
                historia_row = cur.fetchone()
                nombre = ((historia_row[1] if historia_row else None) or '').strip().title()

                if historia_row and historia_row[0]:
                    celular = historia_row[0].strip()
                    logger.info("Celular encontrado en HistoriaClinica: %s", celular)
                    return {
                        'found': False,
                        'celular': celular,
                        'primerNombre': nombre,
                        'empresa': empresa
                    }
                else:
                    logger.error("No se encontro celular en HistoriaClinica para _id: %s", _id)
                    return {'found': False, 'celular': None, 'primerNombre': nombre, 'empresa': empresa}

            row_dict = dict(zip(columns, row))

            encuesta_salud = [nombre for col, nombre in SALUD_COLS.items() if row_dict.get(col) == 'SI']
            antecedentes_familiares = [nombre for col, nombre in FAMILIA_COLS.items() if row_dict.get(col) == 'SI']

            return {
                'found': True,
                'primerNombre': row_dict.get('primer_nombre') or '',
                'celular': row_dict.get('celular') or '',
                'encuestaSalud': encuesta_salud,
                'antecedentesFamiliares': antecedentes_familiares,
                'empresa': empresa
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


def guardar_prueba_ojos(_id, prueba):
    """Guarda la prueba de ojos (ya limpia, grabacion.limpiar_ojos) en HistoriaClinica.pruebaOjos,
    para que entre a la historia clinica (IX. Examenes paraclinicos en BSL-PLATAFORMA2). No gasta el
    link: eso lo hace resumenLlamada. Un reintento la sobreescribe."""
    try:
        with db_pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    'UPDATE "HistoriaClinica" SET "pruebaOjos" = %s::jsonb WHERE _id = %s',
                    (json.dumps(prueba, ensure_ascii=False), _id)
                )
                conn.commit()
                logger.info("Prueba de ojos guardada en PostgreSQL - filas afectadas: %d", cur.rowcount)
                return {"success": True, "rows_affected": cur.rowcount}
    except Exception as e:
        logger.error("Error al guardar la prueba de ojos en PostgreSQL: %s", str(e))
        return {"success": False, "error": str(e)}


# Prueba de oidos -> tabla audiometrias de BSL-PLATAFORMA2. Para las ordenes de NUBIA la plataforma
# ya no pide su audiometria virtual (capas/reglas/pruebas-requeridas.js, QUITA_SI_MEDICO_BOT): esta
# fila es la que leen el certificado, la historia clinica en PDF y el informe por empresa.
EQUIPO_ASISTENTE = 'Asistente virtual BSL'
FRECUENCIAS_AUDIOMETRIA = ('500', '1000', '2000', '3000', '4000', '6000')
TECHO_OIDOS_HL = 70
VEREDICTO_TEXTO = {
    'pasa': 'audición dentro de lo esperado',
    'remitir': 'requiere valoración auditiva',
    'repetir': 'prueba no concluyente, repetir',
}


def _umbral_columna(u):
    """dB HL de una frecuencia para la columna aereo_*: 'no oye ni en el techo' se guarda como el
    techo (70), igual que la audiometria virtual anterior guardaba 70 cuando no oia."""
    if not isinstance(u, dict):
        return None
    if u.get('estado') == 'sin-respuesta':
        return TECHO_OIDOS_HL
    hl = u.get('hl')
    return int(round(hl)) if isinstance(hl, (int, float)) and not isinstance(hl, bool) else None


def fila_audiometria(meta):
    """La prueba de oidos (ya limpia, grabacion.limpiar_oidos) como columnas de audiometrias, o None
    si no se hizo. Puro: sin BD."""
    if not isinstance(meta, dict) or not meta.get('realizado') or not meta.get('resumen'):
        return None
    r = meta['resumen']
    fila = {'equipo': EQUIPO_ASISTENTE}
    for oido in ('od', 'oi'):
        umbrales = (meta.get('umbrales') or {}).get(oido) or {}
        for f in FRECUENCIAS_AUDIOMETRIA:
            fila[f'aereo_{oido}_{f}'] = _umbral_columna(umbrales.get(f))
        grado = (r.get('grado') or {}).get(oido)
        fila[f'diagnostico_{oido}'] = f'Tamizaje: audición {grado}' if grado else None

    conf = r.get('confiabilidad') or {}
    partes = ['Tamizaje auditivo con el asistente virtual de BSL, con los audífonos del paciente '
              '(calibración provisional; no reemplaza una audiometría en cabina).',
              f"Resultado: {VEREDICTO_TEXTO.get(r.get('veredicto'), 'sin veredicto')}."]
    nivel = (conf.get('nivel') or 'sin dato').replace('-', ' ')
    motivos = [m for m in (conf.get('motivos') or []) if m]
    partes.append(f"Confiabilidad: {nivel}" + (f" ({'; '.join(motivos)})." if motivos else '.'))
    pta = r.get('pta4') or {}
    if pta.get('od') is not None and pta.get('oi') is not None:
        partes.append(f"PTA4: oído derecho {round(pta['od'])} dB, oído izquierdo {round(pta['oi'])} dB.")
    asim = r.get('asimetria') or {}
    if asim.get('presente'):
        partes.append(f"Asimetría entre oídos, peor el {'derecho' if asim.get('peorOido') == 'od' else 'izquierdo'}.")
    caida = r.get('caidaAgudos') or {}
    for oido, nombre in (('od', 'derecho'), ('oi', 'izquierdo')):
        if (caida.get(oido) or {}).get('presente'):
            partes.append(f'Caída en agudos (patrón compatible con ruido), oído {nombre}.')
    fila['interpretacion'] = ' '.join(partes)

    veredicto = r.get('veredicto')
    fila['recomendaciones'] = {
        'remitir': 'Valoración auditiva con audiometría en cabina.',
        'repetir': 'Repetir la prueba auditiva: el resultado no fue confiable.',
    }.get(veredicto)
    fila['remision'] = 'AUDIOLOGIA' if veredicto == 'remitir' else 'NO APLICA'
    return fila


def guardar_audiometria(_id, meta):
    """Escribe la prueba de oidos en audiometrias. Si la orden ya tiene una audiometria hecha en la
    plataforma (virtual o por un profesional), no la toca: solo actualiza la que escribio el
    asistente (un reintento). Los datos del paciente salen de HistoriaClinica."""
    fila = fila_audiometria(meta)
    if not _id or fila is None:
        return {"success": False, "motivo": "sin prueba de oidos"}
    columnas = list(fila)
    try:
        with db_pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, equipo FROM audiometrias WHERE orden_id = %s AND tenant_id = 'bsl' "
                    "AND deleted_at IS NULL ORDER BY id DESC LIMIT 1", (_id,))
                existente = cur.fetchone()
                if existente and existente[1] != EQUIPO_ASISTENTE:
                    logger.info("Orden %s ya tiene audiometria de la plataforma: no se toca", _id)
                    return {"success": True, "omitida": True}
                if existente:
                    sets = ', '.join(f'{c} = %s' for c in columnas)
                    cur.execute(f"UPDATE audiometrias SET {sets}, updated_at = CURRENT_TIMESTAMP WHERE id = %s",
                                [fila[c] for c in columnas] + [existente[0]])
                else:
                    cur.execute(
                        f'INSERT INTO audiometrias (orden_id, numero_id, primer_nombre, primer_apellido, empresa, '
                        f'cod_empresa, tenant_id, {", ".join(columnas)}) '
                        f'SELECT _id, "numeroId", "primerNombre", "primerApellido", empresa, "codEmpresa", \'bsl\', '
                        f'{", ".join(["%s"] * len(columnas))} FROM "HistoriaClinica" WHERE _id = %s',
                        [fila[c] for c in columnas] + [_id])
                conn.commit()
                logger.info("Audiometria del asistente guardada para %s - filas: %d", _id, cur.rowcount)
                return {"success": True, "rows_affected": cur.rowcount}
    except Exception as e:
        logger.error("Error al guardar la audiometria del asistente en PostgreSQL: %s", str(e))
        return {"success": False, "error": str(e)}
