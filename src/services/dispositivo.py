"""Desde que dispositivo se hace la consulta, y los avisos del navegador cuando algo falla antes de
la entrevista (static/js/dispositivo.js).

Nacio el 1-nov-2026: en iPhone nadie podia entrar (microfono rechazado) y el servidor no se
entero. Los eventos van solo a los logs de la app, en una linea que se busca con
`doctl apps logs ... | grep EVENTO`: no se guardan en BD. Todo llega del celular del paciente,
asi que se recorta a textos cortos y a una lista fija de campos.
"""
CAMPOS_DISPOSITIVO = ("sistema", "navegador", "modelo", "pantalla", "idioma", "ua")
ETAPAS = ("inicio", "permisos", "link", "oidos", "ojos", "camara", "microfono", "conexion", "fin")


def _texto(v, largo=120):
    if v is None or isinstance(v, (dict, list)):
        return None
    # Una sola linea: el aviso va al log y no se le puede colar un salto de linea
    return " ".join(str(v).split())[:largo] or None


def limpiar_dispositivo(d):
    """El dispositivo tal como lo arma dispositivo.js, recortado. None si no vino."""
    if not isinstance(d, dict):
        return None
    limpio = {k: _texto(d.get(k), 300 if k == "ua" else 80) for k in CAMPOS_DISPOSITIVO}
    limpio["audioSession"] = d.get("audioSession") is True
    return limpio


def limpiar_evento(cuerpo):
    """El aviso del navegador, recortado. None si no es un aviso valido."""
    if not isinstance(cuerpo, dict) or cuerpo.get("etapa") not in ETAPAS:
        return None
    error = cuerpo.get("error") if isinstance(cuerpo.get("error"), dict) else {}
    extra = cuerpo.get("extra")
    return {
        "_id": _texto(cuerpo.get("_id"), 60),
        "etapa": cuerpo["etapa"],
        "error": _texto(error.get("nombre"), 60),
        "mensaje": _texto(error.get("mensaje"), 300),
        "extra": _texto(extra, 200),
        "dispositivo": limpiar_dispositivo(cuerpo.get("dispositivo")) or {},
    }


def linea_de_log(evento):
    """Una linea legible: EVENTO <etapa> <_id> | <error>: <mensaje> | <sistema> / <navegador> / <modelo>."""
    d = evento["dispositivo"]
    partes = [f"EVENTO {evento['etapa']} {evento['_id'] or 'demo'}"]
    if evento["error"] or evento["mensaje"]:
        partes.append(f"{evento['error'] or 'error'}: {evento['mensaje'] or ''}".strip())
    if evento["extra"]:
        partes.append(evento["extra"])
    partes.append(" / ".join(x for x in (d.get("sistema"), d.get("navegador"), d.get("modelo"), d.get("pantalla")) if x) or "sin dispositivo")
    return " | ".join(partes)
