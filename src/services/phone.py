"""Normalizacion de telefonos a E.164.

Port de src/helpers/phone.js de BSL-PLATAFORMA2. Las dos apps escriben en la misma
tabla conversaciones_whatsapp: si cada una normaliza distinto, el mismo paciente
termina con dos conversaciones en IrisChat. Si se cambia una regla aca, cambiarla
alla tambien (y al reves).

Antes esta app hacia `if not to.startswith('57'): to = '57' + to`, que destruia
cualquier numero internacional: un peruano 51965423527 salia como +5751965423527.
"""
import re
import phonenumbers

# WhatsApp usernames (jun-2026): Twilio manda 'whatsapp:CC.BSUID' en vez del telefono
# cuando el usuario oculto su numero. No es un telefono: se conserva tal cual.
BSUID_RE = re.compile(r'^[A-Za-z]{2}\.[A-Za-z0-9]{1,128}$')


def es_bsuid(valor):
    if not valor:
        return False
    sin_prefijo = re.sub(r'^whatsapp:', '', str(valor), flags=re.I).strip()
    return bool(BSUID_RE.match(sin_prefijo))


def _parse(numero, region=None):
    try:
        return phonenumbers.parse(numero, region)
    except phonenumbers.NumberParseException:
        return None


def _e164(parsed):
    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)


def _posible(parsed):
    # Como isPossible() de libphonenumber-js: el numero completo, no "solo marcable
    # localmente" (is_possible_number de phonenumbers tambien acepta eso).
    return (parsed is not None and phonenumbers.is_possible_number_with_reason(parsed)
            == phonenumbers.ValidationResult.IS_POSSIBLE)


def _valido(parsed):
    """Como isValid() de libphonenumber-js en PLATAFORMA2, que usa la metadata "min":
    longitud posible + patron general del pais. phonenumbers.is_valid_number usa la
    metadata completa y rechaza rangos colombianos reales que la otra acepta
    (3521234567 salia como Luxemburgo, 6041234567 como Malasia). Las dos apps tienen
    que dar el mismo resultado."""
    if not _posible(parsed):
        return False
    region = phonenumbers.region_code_for_country_code(parsed.country_code)
    md = phonenumbers.PhoneMetadata.metadata_for_region(region)
    patron = md.general_desc.national_number_pattern if md and md.general_desc else None
    if not patron:
        return phonenumbers.is_valid_number(parsed)
    return re.fullmatch(patron, phonenumbers.national_significant_number(parsed)) is not None


def normalizar_telefono(celular):
    """E.164 con `+` (ej: +573001234567, +15394301312), o 'whatsapp:CC.BSUID'.

    Colombia es el pais por defecto: un numero nacional de 10 digitos se asume
    colombiano. Los que ya traen indicativo internacional (con o sin `+`) se respetan.
    """
    if not celular:
        return None

    sin_prefijo_wa = re.sub(r'^whatsapp:', '', str(celular), flags=re.I).strip()
    if es_bsuid(sin_prefijo_wa):
        return 'whatsapp:' + sin_prefijo_wa

    limpio = re.sub(r'[^\d+]', '', sin_prefijo_wa)
    tenia_mas = limpio.startswith('+')
    digitos = limpio.replace('+', '')
    if not digitos:
        return None

    # 1) Indicativo internacional explicito -> se respeta tal cual.
    if tenia_mas:
        parsed = _parse('+' + digitos)
        return _e164(parsed) if _valido(parsed) else '+' + digitos

    # 2) Colombia con indicativo pero sin `+`: 57 + 10 digitos.
    if len(digitos) == 12 and digitos.startswith('57'):
        parsed = _parse('+' + digitos)
        if _valido(parsed):
            return _e164(parsed)

    # 3) Nacional colombiano de 10 digitos. Va ANTES del intento internacional:
    #    300/350/601 tambien son indicativos de otros paises y aca gana Colombia.
    if len(digitos) == 10:
        parsed = _parse(digitos, 'CO')
        if _valido(parsed):
            return _e164(parsed)

    # 4) Internacional sin `+` (15394301312 -> US, 51965423527 -> PE).
    if len(digitos) >= 8:
        parsed = _parse('+' + digitos)
        if _valido(parsed):
            return _e164(parsed)

        # Mexico legacy: +52 1 XXXXXXXXXX. Ese `1` sobra y WhatsApp lo rechaza.
        if digitos.startswith('521') and len(digitos) == 13:
            sin_uno = _parse('+52' + digitos[3:])
            if _valido(sin_uno):
                return _e164(sin_uno)

        # Numeraciones nuevas que la libreria aun no valida al 100%.
        if _posible(parsed):
            return _e164(parsed)

    # 5) Fallback historico: asumir colombiano.
    return '+57' + digitos


def formatear_para_whatsapp(celular):
    """Campo `to` de Twilio: 'whatsapp:+573001234567' (o 'whatsapp:CC.BSUID')."""
    e164 = normalizar_telefono(celular)
    if not e164:
        return None
    return e164 if e164.startswith('whatsapp:') else f'whatsapp:{e164}'
