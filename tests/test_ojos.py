"""La prueba de ojos llega del celular del paciente: solo se guarda lo que pinta la ficha.

    python -m unittest discover tests
"""
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from services import grabacion  # noqa: E402
from services.grabacion import limpiar_ojos  # noqa: E402

FOTO = 'data:image/jpeg;base64,/9j/4AAQ'


class TestLimpiarOjos(unittest.TestCase):

    def test_prueba_completa(self):
        meta, fotos = limpiar_ojos({
            'realizado': True, 'fecha': '2026-10-31T15:00:00Z', 'camara': '960x1280', 'duracion_s': 131,
            'secciones': [{
                'title': 'Fatiga y parpadeo', 'note': 'Medido sobre 50 s válidos a 24 Hz.',
                'rows': [{'label': 'PERCLOS', 'value': '3.1 %', 'reading': 'Tiempo con el ojo cerrado.'},
                         {'label': 'Pupila / iris (ratio)', 'od': '0.31', 'oi': '0.33', 'exp': True}],
                'flags': [['ok', 'Tasa de parpadeo habitual.'], ['warn', '1 cierre largo.']],
            }],
            'fotos': [{'momento': 'ojo-od', 'imagen': FOTO}, {'momento': 'ojo-oi', 'imagen': FOTO}],
        })
        self.assertTrue(meta['realizado'])
        self.assertEqual(meta['duracion_s'], 131)
        self.assertEqual(meta['secciones'][0]['rows'][0], {'label': 'PERCLOS', 'value': '3.1 %', 'reading': 'Tiempo con el ojo cerrado.', 'exp': False})
        self.assertEqual(meta['secciones'][0]['rows'][1]['od'], '0.31')
        self.assertTrue(meta['secciones'][0]['rows'][1]['exp'])
        self.assertEqual(meta['secciones'][0]['flags'][1], ['warn', '1 cierre largo.'])
        self.assertEqual([f['momento'] for f in fotos], ['ojo-od', 'ojo-oi'])

    def test_no_realizada(self):
        meta, fotos = limpiar_ojos({'realizado': False, 'motivo': 'No se pudo cargar el detector de rostro en este celular.'})
        self.assertFalse(meta['realizado'])
        self.assertIn('detector', meta['motivo'])
        self.assertEqual(meta['secciones'], [])
        self.assertEqual(fotos, [])

    def test_sin_prueba(self):
        # JS viejo en cache o alguien que se salto la pantalla: la entrevista se guarda igual
        self.assertEqual(limpiar_ojos(None), (None, []))
        self.assertEqual(limpiar_ojos('basura'), (None, []))

    def test_recorta_lo_que_no_viene_de_la_app(self):
        meta, fotos = limpiar_ojos({
            'realizado': 'si', 'duracion_s': 'mucho', 'camara': 'x' * 500,
            'secciones': [{'title': 'T', 'rows': [{'label': 'a' * 5000, '<script>': 'x'}] * 50,
                           'flags': [['peligro', 'msg'], 'no-es-lista']}] * 9 + ['no-es-dict'],
            'fotos': [{'momento': 'inicio', 'imagen': FOTO}, {'momento': 'ojo-od', 'imagen': FOTO}] * 5,
        })
        self.assertIsNone(meta['duracion_s'])
        self.assertEqual(len(meta['camara']), 20)
        self.assertEqual(len(meta['secciones']), 5)
        fila = meta['secciones'][0]['rows'][0]
        self.assertEqual(len(meta['secciones'][0]['rows']), 20)
        self.assertEqual(set(fila), {'label', 'exp'})
        self.assertEqual(len(fila['label']), 400)
        self.assertEqual(meta['secciones'][0]['flags'], [['warn', 'msg']])
        # Solo fotos de ojos, y como mucho las dos que manda la app
        self.assertEqual([f['momento'] for f in fotos], ['ojo-od', 'ojo-od'])



class TestGuardarEntrevista(unittest.TestCase):

    def test_la_prueba_lleva_las_keys_de_las_fotos_de_los_ojos(self):
        # La historia clinica en PDF baja las fotos de los ojos con estas keys
        subidas = []
        with mock.patch.object(grabacion, '_subir', side_effect=lambda key, *a: subidas.append(key) or key):
            carpeta, prueba = grabacion.guardar_entrevista(
                'orden_1', None,
                [{'momento': 'inicio', 'imagen': FOTO}, {'momento': 'final', 'imagen': FOTO}],
                'Resumen', [], ojos={'realizado': True, 'secciones': [],
                                     'fotos': [{'momento': 'ojo-od', 'imagen': FOTO}, {'momento': 'ojo-oi', 'imagen': FOTO}]})
        self.assertEqual(prueba['fotos'], [f'{carpeta}/foto-3-ojo-od.jpg', f'{carpeta}/foto-4-ojo-oi.jpg'])
        self.assertIn(f'{carpeta}/foto-1-inicio.jpg', subidas)
        self.assertIn(f'{carpeta}/meta.json', subidas)

    def test_sin_prueba(self):
        with mock.patch.object(grabacion, '_subir', side_effect=lambda key, *a: key):
            _, prueba = grabacion.guardar_entrevista('orden_1', None, [], 'Resumen', [])
        self.assertIsNone(prueba)


if __name__ == '__main__':
    unittest.main()
