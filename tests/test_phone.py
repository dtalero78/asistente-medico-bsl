"""Mismos casos que tests/phone.test.js de BSL-PLATAFORMA2: las dos apps tienen que
normalizar igual, o el mismo paciente queda con dos conversaciones en IrisChat.

    python -m unittest discover tests
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from services.phone import normalizar_telefono, formatear_para_whatsapp, es_bsuid  # noqa: E402


class TestNormalizarTelefono(unittest.TestCase):

    def test_celulares_colombianos(self):
        for entrada in ['3001234567', '573001234567', '+573001234567', 'whatsapp:+573001234567',
                        '300 123 4567', '300-123-4567', '(300) 123 4567', ' +57 300 123 4567 ']:
            self.assertEqual(normalizar_telefono(entrada), '+573001234567', entrada)

    def test_prefijos_que_colisionan_con_indicativos(self):
        # 350 = Gibraltar, 351 = Portugal, 352 = Luxemburgo. En Colombia gana Colombia.
        self.assertEqual(normalizar_telefono('3501234567'), '+573501234567')
        self.assertEqual(normalizar_telefono('3511234567'), '+573511234567')
        self.assertEqual(normalizar_telefono('3521234567'), '+573521234567')

    def test_fijo_colombiano_60x(self):
        self.assertEqual(normalizar_telefono('6011234567'), '+576011234567')
        self.assertEqual(normalizar_telefono('6041234567'), '+576041234567')

    def test_internacionales_sin_mas(self):
        self.assertEqual(normalizar_telefono('15394301312'), '+15394301312')    # US
        self.assertEqual(normalizar_telefono('51965423527'), '+51965423527')    # PE
        self.assertEqual(normalizar_telefono('34600123456'), '+34600123456')    # ES
        self.assertEqual(normalizar_telefono('5215512345678'), '+525512345678')  # MX (1 legacy)

    def test_internacionales_con_mas(self):
        self.assertEqual(normalizar_telefono('+15394301312'), '+15394301312')
        self.assertEqual(normalizar_telefono('+51965423527'), '+51965423527')
        self.assertEqual(normalizar_telefono('whatsapp:+51965423527'), '+51965423527')

    def test_idempotencia(self):
        for entrada in ['3001234567', '15394301312', '51965423527', '6011234567', '+34600123456']:
            una = normalizar_telefono(entrada)
            self.assertEqual(normalizar_telefono(una), una, entrada)

    def test_vacios_y_basura(self):
        for entrada in [None, '', '   ', 'abc']:
            self.assertIsNone(normalizar_telefono(entrada), repr(entrada))

    def test_no_reconocible_cae_al_fallback_colombiano(self):
        self.assertEqual(normalizar_telefono('12345'), '+5712345')

    def test_bsuid_se_conserva(self):
        bsuid = 'whatsapp:CO.1A2b3C4d5E6f7G8h9I0j'
        self.assertTrue(es_bsuid(bsuid))
        self.assertTrue(es_bsuid('US.' + 'A1' * 64))
        self.assertFalse(es_bsuid('whatsapp:+573001234567'))
        self.assertFalse(es_bsuid('3001234567'))
        self.assertEqual(normalizar_telefono(bsuid), bsuid)
        self.assertEqual(normalizar_telefono('CO.1A2b3C4d5E6f7G8h9I0j'), bsuid)


class TestFormatearParaWhatsApp(unittest.TestCase):

    def test_campo_to_de_twilio(self):
        self.assertEqual(formatear_para_whatsapp('3001234567'), 'whatsapp:+573001234567')
        self.assertEqual(formatear_para_whatsapp('573001234567'), 'whatsapp:+573001234567')
        self.assertEqual(formatear_para_whatsapp('15394301312'), 'whatsapp:+15394301312')
        self.assertEqual(formatear_para_whatsapp('+51965423527'), 'whatsapp:+51965423527')
        self.assertEqual(formatear_para_whatsapp('whatsapp:+573001234567'), 'whatsapp:+573001234567')
        self.assertIsNone(formatear_para_whatsapp(None))

    def test_no_se_le_pega_57_a_un_internacional(self):
        for entrada in ['15394301312', '51965423527', '+15394301312', '+51965423527']:
            self.assertFalse(formatear_para_whatsapp(entrada).startswith('whatsapp:+57'), entrada)

    def test_bsuid_no_duplica_el_prefijo(self):
        self.assertEqual(formatear_para_whatsapp('whatsapp:CO.1A2b3C4d5E'), 'whatsapp:CO.1A2b3C4d5E')
        self.assertEqual(formatear_para_whatsapp('CO.1A2b3C4d5E'), 'whatsapp:CO.1A2b3C4d5E')


if __name__ == '__main__':
    unittest.main()
