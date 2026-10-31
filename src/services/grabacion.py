"""Evidencia de las entrevistas del avatar: audio completo + fotos del paciente.

El audio lo graba ElevenLabs en sus servidores (el celular del paciente no hace nada extra);
aqui se copia a DigitalOcean Spaces junto con las fotos que tomo el navegador y un meta.json
con el resumen, la transcripcion y la prueba de ojos (static/js/ojos.js). Mismo bucket que BSL-PLATAFORMA2 (fotos de formularios),
pero los objetos son PRIVADOS: son datos de salud y se ven solo con un link temporal
(link_temporal). Ruta: entrevistas-avatar/<orden o demo>/<fecha>_<conversation_id>/
"""
import os
import json
import time
import base64
import logging
import threading
from datetime import datetime, timezone, timedelta

import boto3
import requests

logger = logging.getLogger(__name__)

PREFIJO = "entrevistas-avatar"
COLOMBIA = timezone(timedelta(hours=-5))

_s3 = None


def _cliente():
    global _s3
    if _s3 is None:
        _s3 = boto3.client(
            "s3",
            endpoint_url=os.getenv("SPACES_ENDPOINT", "https://nyc3.digitaloceanspaces.com"),
            region_name="nyc3",
            aws_access_key_id=os.getenv("SPACES_KEY"),
            aws_secret_access_key=os.getenv("SPACES_SECRET"),
        )
    return _s3


def _subir(key, contenido, content_type):
    _cliente().put_object(Bucket=os.getenv("SPACES_BUCKET", "bsl-fotos"), Key=key, Body=contenido,
                          ContentType=content_type, ACL="private")
    return key


def link_temporal(key, segundos=3600):
    """URL firmada para ver un archivo privado (por defecto, valida 1 hora)."""
    return _cliente().generate_presigned_url(
        "get_object", Params={"Bucket": os.getenv("SPACES_BUCKET", "bsl-fotos"), "Key": key},
        ExpiresIn=segundos)


def _carpeta(orden_id, identificador):
    fecha = datetime.now(COLOMBIA).strftime("%Y-%m-%d_%H%M")
    return f"{PREFIJO}/{orden_id or 'demo'}/{fecha}_{identificador or 'sin-id'}"


def _subir_fotos(carpeta, fotos):
    keys = []
    for i, foto in enumerate(fotos or [], start=1):
        imagen = foto.get("imagen") or ""
        if not imagen.startswith("data:image/jpeg;base64,"):
            continue
        datos = base64.b64decode(imagen.split(",", 1)[1])
        # Una foto de 320 px pesa ~30 KB; algo mucho mas grande no viene de nuestro navegador
        if len(datos) > 500_000:
            continue
        momento = "".join(c for c in str(foto.get("momento", "")) if c.isalnum() or c == "-")[:20]
        keys.append(_subir(f"{carpeta}/foto-{i}-{momento or 'sin-momento'}.jpg", datos, "image/jpeg"))
    return keys


def limpiar_ojos(ojos):
    """La prueba de ojos tal como llega del navegador, reducida a lo que pinta la ficha del medico.

    Llega del celular del paciente, asi que se recorta todo: solo texto, con largos y cantidades
    acotadas. Las fotos de los ojos (momento "ojo-od" / "ojo-oi") se suben con las demas.

    Returns: (dict para meta.json o None, lista de fotos de los ojos)
    """
    if not isinstance(ojos, dict):
        return None, []

    def texto(v, largo=400):
        return None if v is None else str(v)[:largo]

    secciones = []
    for sec in (ojos.get("secciones") or [])[:5]:
        if not isinstance(sec, dict):
            continue
        filas = []
        for fila in (sec.get("rows") or [])[:20]:
            if not isinstance(fila, dict):
                continue
            limpia = {k: texto(fila[k]) for k in ("label", "od", "oi", "value", "reading") if fila.get(k) is not None}
            limpia["exp"] = bool(fila.get("exp"))
            filas.append(limpia)
        banderas = [["ok" if b[0] == "ok" else "warn", texto(b[1])]
                    for b in (sec.get("flags") or [])[:10] if isinstance(b, (list, tuple)) and len(b) == 2]
        secciones.append({"title": texto(sec.get("title"), 80), "note": texto(sec.get("note")),
                          "rows": filas, "flags": banderas})

    duracion = ojos.get("duracion_s")
    meta = {
        "realizado": bool(ojos.get("realizado")),
        "motivo": texto(ojos.get("motivo")),
        "fecha": texto(ojos.get("fecha"), 40),
        "camara": texto(ojos.get("camara"), 20),
        "duracion_s": int(duracion) if isinstance(duracion, (int, float)) else None,
        "secciones": secciones,
    }
    fotos = [f for f in (ojos.get("fotos") or [])
             if isinstance(f, dict) and str(f.get("momento", "")).startswith("ojo-")][:2]
    return meta, fotos


def _bajar_audio_elevenlabs(conversation_id, intentos=12, espera=10):
    """ElevenLabs tarda unos segundos en procesar la conversacion antes de dar el audio."""
    headers = {"xi-api-key": os.getenv("ELEVENLABS_API_KEY")}
    base = f"https://api.elevenlabs.io/v1/convai/conversations/{conversation_id}"
    for _ in range(intentos):
        estado = requests.get(base, headers=headers, timeout=15).json()
        if estado.get("status") in ("done", "failed") and estado.get("has_audio"):
            audio = requests.get(f"{base}/audio", headers=headers, timeout=60)
            if audio.ok:
                return audio.content
        time.sleep(espera)
    return None


def buscar_conversacion(ref, inicio, intentos=6, espera=5):
    """Conversacion de ElevenLabs de esta sesion, por el ref_bsl que se le paso al agente.
    La lista no trae las variables: se revisa el detalle de las que empezaron desde la sesion.

    Cuando el agente cuelga, LiveAvatar lo reconecta un instante y queda una segunda conversacion
    con el mismo ref, vacia (0 s, "Client disconnected"). Hasta el 30-oct se tomaba la mas reciente
    y se guardaba ese audio de 4 KB: se elige la mas larga de las que tienen el ref."""
    headers = {"xi-api-key": os.getenv("ELEVENLABS_API_KEY")}
    base = "https://api.elevenlabs.io/v1/convai/conversations"
    for _ in range(intentos):
        lista = requests.get(base, headers=headers, timeout=15, params={
            "agent_id": os.getenv("ELEVENLABS_AGENT_ID"),
            "call_start_after_unix": int(inicio) - 60,
            "page_size": 30,
        }).json().get("conversations", [])
        candidatas = []
        for c in lista:
            detalle = requests.get(f"{base}/{c['conversation_id']}", headers=headers, timeout=15).json()
            variables = (detalle.get("conversation_initiation_client_data") or {}).get("dynamic_variables") or {}
            if variables.get("ref_bsl") == ref:
                candidatas.append((c.get("call_duration_secs") or 0, c["conversation_id"]))
        if candidatas and max(candidatas)[0] > 0:
            return max(candidatas)[1]
        time.sleep(espera)
    return None


def _guardar_audio(carpeta, conversation_id, meta, ref=None, inicio=None):
    try:
        if not conversation_id and ref and inicio:
            conversation_id = buscar_conversacion(ref, inicio)
            meta["conversation_id"] = conversation_id
        audio = _bajar_audio_elevenlabs(conversation_id) if conversation_id else None
        if audio:
            meta["audio"] = _subir(f"{carpeta}/audio.mp3", audio, "audio/mpeg")
        else:
            logger.warning("Sin audio de ElevenLabs para %s", conversation_id)
        _subir(f"{carpeta}/meta.json", json.dumps(meta, ensure_ascii=False, indent=2).encode(),
               "application/json")
        logger.info("Entrevista guardada en %s (audio=%s)", carpeta, bool(audio))
    except Exception as e:
        logger.error("Error guardando audio de %s: %s", conversation_id, e)


def guardar_entrevista(orden_id, conversation_id, fotos, resumen, turnos, ref=None, inicio=None, ojos=None):
    """Sube las fotos ya y el audio en segundo plano (ElevenLabs lo entrega con demora).

    Returns: (la carpeta en Spaces donde queda todo, la prueba de ojos limpia con las keys de sus
    fotos en "fotos", o None). La prueba va tambien a HistoriaClinica.pruebaOjos (ver app.py).
    """
    carpeta = _carpeta(orden_id, ref or conversation_id)
    meta_ojos, fotos_ojos = limpiar_ojos(ojos)
    meta = {
        "orden_id": orden_id,
        "ref": ref,
        "conversation_id": conversation_id,
        "fecha": datetime.now(COLOMBIA).isoformat(timespec="seconds"),
        "resumen": resumen,
        "transcripcion": turnos,
        "fotos": [],
        "audio": None,
        "ojos": meta_ojos,
    }
    try:
        meta["fotos"] = _subir_fotos(carpeta, list(fotos or [])[:5] + fotos_ojos)
    except Exception as e:
        logger.error("Error subiendo fotos de %s: %s", carpeta, e)
    if meta_ojos is not None:
        # La historia clinica en PDF las incrusta: las baja de Spaces con estas keys
        meta_ojos["fotos"] = [k for k in meta["fotos"] if "-ojo-" in k.rsplit("/", 1)[-1]]

    if conversation_id or ref:
        threading.Thread(target=_guardar_audio, args=(carpeta, conversation_id, meta, ref, inicio),
                         daemon=True).start()
    else:
        _subir(f"{carpeta}/meta.json", json.dumps(meta, ensure_ascii=False, indent=2).encode(),
               "application/json")
    return carpeta, meta_ojos
