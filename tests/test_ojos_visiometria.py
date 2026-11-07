"""La prueba de ojos hecha al final de la visiometria virtual de BSL-PLATAFORMA2 (7-nov-2026): esa
pagina carga ojos.js desde aqui y guarda por /ojos/guardar. Si ya la tiene, el asistente no la repite,
y una prueba que no se pudo hacer nunca pisa una hecha.

    python -m unittest discover tests
"""
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
os.environ.setdefault('OPENAI_API_KEY', 'test')

import app  # noqa: E402
from services import grabacion, patient  # noqa: E402
from test_oidos import _Cursor, _Pool  # noqa: E402

FOTO = 'data:image/jpeg;base64,/9j/4AAQ'
PRUEBA = {'realizado': True, 'camara': '960x1280', 'secciones': [{'title': 'Pupilas', 'rows': [], 'flags': []}],
          'fotos': [{'momento': 'ojo-od', 'imagen': FOTO}, {'momento': 'ojo-oi', 'imagen': FOTO}],
          'indicadores': {'pct_incompletos': 41}}


class TestEndpoints(unittest.TestCase):

    def setUp(self):
        self.cliente = app.app.test_client()

    def test_estado_solo_booleanos(self):
        with mock.patch.object(app, 'es_orden_bsl', return_value=True), \
                mock.patch.object(app, 'prueba_ojos_hecha', return_value={'realizado': True, 'secciones': ['x']}):
            r = self.cliente.get('/ojos/estado?_id=orden_1')
        self.assertEqual(r.get_json(), {'aplica': True, 'hecha': True})   # nada clinico

    def test_estado_otra_ips_no_aplica(self):
        with mock.patch.object(app, 'es_orden_bsl', return_value=False), \
                mock.patch.object(app, 'prueba_ojos_hecha') as hecha:
            r = self.cliente.get('/ojos/estado?_id=orden_vip')
        self.assertEqual(r.get_json(), {'aplica': False, 'hecha': False})
        hecha.assert_not_called()

    def test_id_invalido(self):
        self.assertEqual(self.cliente.get('/ojos/estado?_id=../x').status_code, 400)
        self.assertEqual(self.cliente.post('/ojos/guardar', json={'_id': 'a/b', 'ojos': PRUEBA}).status_code, 400)

    def test_guardar(self):
        with mock.patch.object(app, 'es_orden_bsl', return_value=True), \
                mock.patch.object(app, 'prueba_ojos_hecha', return_value=None), \
                mock.patch.object(grabacion, '_subir', side_effect=lambda key, *a: key), \
                mock.patch.object(app, 'guardar_prueba_ojos') as guardar:
            r = self.cliente.post('/ojos/guardar', json={'_id': 'orden_1', 'ojos': PRUEBA})
        self.assertEqual(r.status_code, 200)
        _id, prueba = guardar.call_args.args
        self.assertEqual(_id, 'orden_1')
        self.assertTrue(prueba['realizado'])
        self.assertEqual(len(prueba['fotos']), 2)
        self.assertTrue(all('_visiometria/foto-' in k and '-ojo-' in k for k in prueba['fotos']))

    def test_guardar_orden_de_otra_ips(self):
        with mock.patch.object(app, 'es_orden_bsl', return_value=False), \
                mock.patch.object(app, 'guardar_prueba_ojos') as guardar:
            r = self.cliente.post('/ojos/guardar', json={'_id': 'orden_vip', 'ojos': PRUEBA})
        self.assertEqual(r.status_code, 404)
        guardar.assert_not_called()

    def test_spaces_caido_igual_guarda_sin_fotos(self):
        with mock.patch.object(app, 'es_orden_bsl', return_value=True), \
                mock.patch.object(app, 'prueba_ojos_hecha', return_value=None), \
                mock.patch.object(grabacion, '_subir', side_effect=RuntimeError('spaces')), \
                mock.patch.object(app, 'guardar_prueba_ojos') as guardar:
            r = self.cliente.post('/ojos/guardar', json={'_id': 'orden_1', 'ojos': PRUEBA})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(guardar.call_args.args[1]['realizado'])

    def test_no_reescribe_una_hecha(self):
        with mock.patch.object(app, 'es_orden_bsl', return_value=True), \
                mock.patch.object(app, 'prueba_ojos_hecha', return_value={'realizado': True}), \
                mock.patch.object(app, 'guardar_prueba_ojos') as guardar:
            r = self.cliente.post('/ojos/guardar', json={'_id': 'orden_1', 'ojos': PRUEBA})
        self.assertEqual(r.status_code, 409)
        guardar.assert_not_called()

    def test_cuerpo_que_no_es_objeto(self):
        self.assertEqual(self.cliente.post('/ojos/guardar', json=['orden_1']).status_code, 400)
        self.assertEqual(self.cliente.post('/ojos/guardar', data='x', content_type='application/json').status_code, 400)


class TestCarpetaVisiometria(unittest.TestCase):

    def test_meta_con_origen(self):
        subidas = {}
        with mock.patch.object(grabacion, '_subir', side_effect=lambda key, cont, tipo: subidas.setdefault(key, cont) and key):
            carpeta, prueba = grabacion.guardar_prueba_visiometria('orden_1', PRUEBA)
        self.assertTrue(carpeta.startswith('entrevistas-avatar/orden_1/') and carpeta.endswith('_visiometria'))
        import json
        meta = json.loads(subidas[f'{carpeta}/meta.json'])
        self.assertEqual(meta['origen'], 'visiometria')
        self.assertEqual(meta['ojos']['indicadores'], {'pct_incompletos': 41.0})

    def test_sin_prueba(self):
        with mock.patch.object(grabacion, '_subir') as subir:
            self.assertEqual(grabacion.guardar_prueba_visiometria('orden_1', None), (None, None))
        subir.assert_not_called()


class TestNoPisaUnaHecha(unittest.TestCase):

    def test_una_fallida_no_pisa_una_hecha(self):
        cur = _Cursor(None)
        with mock.patch.object(patient, 'db_pool', _Pool(cur)):
            patient.guardar_prueba_ojos('orden_1', {'realizado': False, 'motivo': 'sin camara'})
        sql, params = cur.sql[0]
        self.assertIn("\"pruebaOjos\"->>'realizado'", sql)
        self.assertIs(params[2], False)

    def test_una_hecha_siempre_se_guarda(self):
        cur = _Cursor(None)
        with mock.patch.object(patient, 'db_pool', _Pool(cur)):
            patient.guardar_prueba_ojos('orden_1', {'realizado': True})
        self.assertIs(cur.sql[0][1][2], True)


class TestPruebaOjosHecha(unittest.TestCase):

    def _con(self, fila):
        with mock.patch.object(patient, 'db_pool', _Pool(_Cursor(fila))):
            return patient.prueba_ojos_hecha('orden_1')

    def test_hecha(self):
        self.assertEqual(self._con(({'realizado': True, 'indicadores': {}},))['realizado'], True)

    def test_no_realizada_o_vacia_no_cuenta(self):
        self.assertIsNone(self._con(({'realizado': False},)))
        self.assertIsNone(self._con((None,)))
        self.assertIsNone(self._con(None))

    def test_bd_caida_mejor_repetirla(self):
        pool = mock.Mock()
        pool.connection.side_effect = RuntimeError('bd')
        with mock.patch.object(patient, 'db_pool', pool):
            self.assertIsNone(patient.prueba_ojos_hecha('orden_1'))


if __name__ == '__main__':
    unittest.main()
