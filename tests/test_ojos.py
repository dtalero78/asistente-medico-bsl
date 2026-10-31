"""La prueba de ojos llega del celular del paciente: solo se guarda lo que pinta la ficha.

    python -m unittest discover tests
"""
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
os.environ.setdefault('OPENAI_API_KEY', 'test')

from services import grabacion  # noqa: E402
from services.grabacion import limpiar_ojos  # noqa: E402
from services import ai  # noqa: E402
from services.ai import hallazgo_visual  # noqa: E402

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



class TestIndicadoresOjos(unittest.TestCase):

    def test_solo_numeros_de_la_lista(self):
        meta, _ = limpiar_ojos({'realizado': True, 'indicadores': {
            'parpadeos_min': 20.4, 'pct_incompletos': 41, 'cierres_largos': 0, 'perclos': 0.011,
            'enrojecimiento_max': None, 'pupila_od': 0.24, 'perclos_texto': 'alto', 'cierres': True}})
        self.assertEqual(meta['indicadores'], {'parpadeos_min': 20.4, 'pct_incompletos': 41.0,
                                               'cierres_largos': 0.0, 'perclos': 0.011})

    def test_sin_indicadores(self):
        meta, _ = limpiar_ojos({'realizado': True, 'indicadores': 'basura'})
        self.assertEqual(meta['indicadores'], {})


class TestHallazgoVisual(unittest.TestCase):

    def test_sin_prueba_no_hay_cuarta_sugerencia(self):
        self.assertIsNone(hallazgo_visual(None))
        self.assertIsNone(hallazgo_visual({}))

    def test_parpadeos_incompletos(self):
        # El caso del 31-oct: 41 % de parpadeos incompletos, tasa normal, pupilas dispares (no se usan)
        h = hallazgo_visual({'parpadeos_min': 20.4, 'pct_incompletos': 41, 'cierres_largos': 0, 'enrojecimiento_max': 1.30})
        self.assertIn('no cerraron el ojo por completo', h)

    def test_somnolencia_va_primero(self):
        h = hallazgo_visual({'cierres_largos': 2, 'pct_incompletos': 60, 'parpadeos_min': 5})
        self.assertIn('somnolencia', h)

    def test_parpadeo_bajo_y_enrojecimiento(self):
        self.assertIn('parpadea poco', hallazgo_visual({'parpadeos_min': 6, 'pct_incompletos': 10}))
        self.assertIn('enrojecidos', hallazgo_visual({'parpadeos_min': 18, 'enrojecimiento_max': 1.5}))

    def test_todo_normal(self):
        self.assertIn('no mostro hallazgos', hallazgo_visual({'parpadeos_min': 18, 'pct_incompletos': 10, 'enrojecimiento_max': 1.0}))

    def test_el_prompt_pide_cuatro_sin_cifras(self):
        respuesta = mock.Mock()
        respuesta.choices = [mock.Mock(message=mock.Mock(content='1. a\n2. b\n3. c\n4. 👁️ d'))]
        with mock.patch.object(ai.openai_client.chat.completions, 'create', return_value=respuesta) as crear:
            ai.generar_sugerencias_salud('Mery', [], [], hallazgo_visual({'pct_incompletos': 41}))
            prompt = crear.call_args.kwargs['messages'][0]['content']
            ai.generar_sugerencias_salud('Mery', [], [], None)
            prompt_sin = crear.call_args.kwargs['messages'][0]['content']
        self.assertIn('EXACTAMENTE 4', prompt)
        self.assertIn('4. [emoji relevante]', prompt)
        self.assertIn('sin cifras', prompt)
        self.assertNotIn('41', prompt)
        self.assertIn('EXACTAMENTE 3', prompt_sin)
        self.assertNotIn('4. [emoji relevante]', prompt_sin)


if __name__ == '__main__':
    unittest.main()
