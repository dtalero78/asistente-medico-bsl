"""Avisos del navegador (POST /avatar/evento) y dispositivo en el meta.json: llegan del celular del
paciente, sin login, asi que solo pasa una lista fija de campos cortos.

    python -m unittest discover tests
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from services.dispositivo import limpiar_dispositivo, limpiar_evento, linea_de_log  # noqa: E402

IPHONE = {
    'sistema': 'iOS 18.6', 'navegador': 'Chrome iOS', 'modelo': 'iPhone', 'pantalla': '390x844@3',
    'idioma': 'es-CO', 'audioSession': True,
    'ua': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 CriOS/141.0 Mobile/15E148',
}


class TestDispositivo(unittest.TestCase):

    def test_pasa_lo_conocido(self):
        d = limpiar_dispositivo({**IPHONE, 'otro': 'x', 'cookies': 'y'})
        self.assertEqual(d['navegador'], 'Chrome iOS')
        self.assertTrue(d['audioSession'])
        self.assertNotIn('otro', d)
        self.assertNotIn('cookies', d)

    def test_recorta(self):
        d = limpiar_dispositivo({'sistema': 'a' * 500, 'ua': 'b' * 900, 'audioSession': 'si', 'modelo': {'x': 1}})
        self.assertEqual(len(d['sistema']), 80)
        self.assertEqual(len(d['ua']), 300)
        self.assertFalse(d['audioSession'])   # solo True cuenta
        self.assertIsNone(d['modelo'])

    def test_sin_dispositivo(self):
        self.assertIsNone(limpiar_dispositivo(None))
        self.assertIsNone(limpiar_dispositivo('iPhone'))


class TestEvento(unittest.TestCase):

    def test_el_caso_del_iphone(self):
        e = limpiar_evento({'_id': 'orden_1', 'etapa': 'permisos', 'dispositivo': IPHONE,
                            'error': {'nombre': 'InvalidStateError', 'mensaje': 'Capture not allowed'},
                            'extra': 'camara y microfono juntos'})
        self.assertEqual(linea_de_log(e),
                         'EVENTO permisos orden_1 | InvalidStateError: Capture not allowed | camara y microfono juntos'
                         ' | iOS 18.6 / Chrome iOS / iPhone / 390x844@3')

    def test_inicio_sin_error(self):
        e = limpiar_evento({'etapa': 'inicio', 'dispositivo': IPHONE})
        self.assertEqual(linea_de_log(e), 'EVENTO inicio demo | iOS 18.6 / Chrome iOS / iPhone / 390x844@3')

    def test_etapa_desconocida_o_basura(self):
        self.assertIsNone(limpiar_evento({'etapa': 'borrar todo'}))
        self.assertIsNone(limpiar_evento(None))
        self.assertIsNone(limpiar_evento(['inicio']))

    def test_no_se_cuelan_lineas_en_el_log(self):
        e = limpiar_evento({'etapa': 'oidos', '_id': 'x\nEVENTO falso', 'error': {'mensaje': 'a\r\nb' + 'c' * 999},
                            'dispositivo': 'no es un dict'})
        linea = linea_de_log(e)
        self.assertNotIn('\n', linea)
        self.assertNotIn('\r', linea)
        self.assertLessEqual(len(e['mensaje']), 300)
        self.assertTrue(linea.endswith('sin dispositivo'))


if __name__ == '__main__':
    unittest.main()
