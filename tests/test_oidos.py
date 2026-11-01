"""La prueba de oidos llega del celular del paciente: solo se guardan numeros y textos acotados.

    python -m unittest discover tests
"""
import os
import sys
import json
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
os.environ.setdefault('OPENAI_API_KEY', 'test')

from unittest import mock  # noqa: E402

from services import grabacion  # noqa: E402
from services.grabacion import limpiar_oidos, fotos_de_oidos, MAX_ENSAYOS_OIDOS  # noqa: E402
from services import patient  # noqa: E402
from services.patient import fila_audiometria, guardar_audiometria, EQUIPO_ASISTENTE  # noqa: E402

FOTO = 'data:image/jpeg;base64,/9j/4AAQ'

PRUEBA = {
    'realizado': True, 'version': 'oidos-1', 'calibracion': 'provisional-1',
    'fecha': '2026-11-01T01:00:00Z', 'duracion_s': 412, 'perfil': 'cable',
    'umbrales': {
        'od': {'1000': {'hl': 15, 'dbfs': -78, 'estado': 'ok', 'ensayos': 9},
               '4000': {'hl': None, 'dbfs': None, 'estado': 'sin-respuesta', 'ensayos': 6}},
        'oi': {'500': {'hl': 0, 'dbfs': -88.5, 'estado': 'piso', 'ensayos': 7}},
    },
    'retest': {'primero': 15, 'segundo': 10},
    'resumen': {
        'pta4': {'od': 23.8, 'oi': 12.5},
        'grado': {'od': 'leve', 'oi': 'normal', 'general': 'normal'},
        'asimetria': {'presente': True, 'peorOido': 'od', 'diferencias': {}},
        'caidaAgudos': {'od': {'presente': True, 'diferencia': 26.7}, 'oi': {'presente': False, 'diferencia': 3}},
        'confiabilidad': {'nivel': 'confiable', 'motivos': []},
        'veredicto': 'remitir',
    },
    'falsos': {'control': 21, 'contestados': 0, 'espontaneos': 1, 'ensayos': 166},
    'ruido': {'mediana': -72.4, 'p90': -68.1},
    'parlante': {'delta': 2, 'detectado': False},
    'lateralidad': 'ok',
    'correcciones': 1, 'pausas': 0, 'camara': 'ok',
    'fotos': [{'momento': 'oidos-1', 'imagen': FOTO}, {'momento': 'oidos-2', 'imagen': FOTO}],
    'ensayos': [['od', 1000, 25, True, 480], ['od', 1000, None, False, None]],
}


class TestLimpiarOidos(unittest.TestCase):

    def test_prueba_completa(self):
        m = limpiar_oidos(PRUEBA)
        self.assertTrue(m['realizado'])
        self.assertEqual(m['duracion_s'], 412)
        self.assertEqual(m['umbrales']['od']['1000'], {'hl': 15.0, 'dbfs': -78.0, 'estado': 'ok'})
        self.assertEqual(m['umbrales']['od']['4000']['estado'], 'sin-respuesta')
        self.assertEqual(m['umbrales']['oi']['500']['estado'], 'piso')
        self.assertEqual(m['resumen']['veredicto'], 'remitir')
        self.assertEqual(m['resumen']['asimetria'], {'presente': True, 'peorOido': 'od'})
        self.assertEqual(m['resumen']['caidaAgudos']['od']['diferencia'], 26.7)
        self.assertEqual(m['retest'], {'primero': 15.0, 'segundo': 10.0})
        self.assertEqual(m['ensayos'][0], ['od', 1000.0, 25.0, True, 480.0])
        self.assertEqual(m['ensayos'][1], ['od', 1000.0, None, False, None])
        self.assertEqual((m['correcciones'], m['pausas'], m['camara']), (1.0, 0.0, 'ok'))
        self.assertNotIn('fotos', m)   # las fotos no van en el meta: se suben aparte
        self.assertIsNone(m['practica'])   # pruebas oidos-1, sin practica

    def test_practica(self):
        m = limpiar_oidos({**PRUEBA, 'practica': {'rondas': 2, 'superada': True, 'latencias': [None, 1452, 980, 'x'] + [1] * 20}})
        self.assertEqual(m['practica']['rondas'], 2.0)
        self.assertTrue(m['practica']['superada'])
        self.assertEqual(m['practica']['latencias'][:4], [None, 1452.0, 980.0, None])
        self.assertEqual(len(m['practica']['latencias']), 12)

    def test_no_realizada(self):
        m = limpiar_oidos({'realizado': False, 'motivo': 'El paciente no tenía audífonos.', 'version': 'oidos-1'})
        self.assertFalse(m['realizado'])
        self.assertEqual(m['motivo'], 'El paciente no tenía audífonos.')
        self.assertIsNone(m['resumen'])
        self.assertEqual(m['umbrales'], {'od': {}, 'oi': {}})

    def test_sin_prueba(self):
        self.assertIsNone(limpiar_oidos(None))
        self.assertIsNone(limpiar_oidos('x'))

    def test_recorta_lo_que_no_viene_de_la_app(self):
        m = limpiar_oidos({
            **PRUEBA,
            'umbrales': {'od': {'1000': {'hl': '15; DROP', 'estado': 'hackeado'}, '9999': {'hl': 1}}, 'oi': 'x'},
            'resumen': {**PRUEBA['resumen'], 'veredicto': 'otro', 'confiabilidad': {'nivel': 'x', 'motivos': ['a' * 999] * 50}},
            'lateralidad': 'quien sabe',
            'ensayos': [['od', 1000, 25, True, 480]] * (MAX_ENSAYOS_OIDOS + 50) + [['malo']],
            'falsos': {'control': True, 'contestados': '3'},
        })
        self.assertEqual(m['umbrales']['od'], {'1000': {'hl': None, 'dbfs': None, 'estado': None}})
        self.assertEqual(m['umbrales']['oi'], {})
        self.assertIsNone(m['resumen']['veredicto'])
        self.assertIsNone(m['resumen']['confiabilidad']['nivel'])
        self.assertEqual(len(m['resumen']['confiabilidad']['motivos']), 10)
        self.assertEqual(len(m['resumen']['confiabilidad']['motivos'][0]), 200)
        self.assertIsNone(m['lateralidad'])
        self.assertEqual(len(m['ensayos']), MAX_ENSAYOS_OIDOS)
        self.assertEqual(m['falsos']['control'], None)   # un booleano no es un numero
        self.assertEqual(m['falsos']['contestados'], None)



class TestFotosOidos(unittest.TestCase):

    def test_solo_las_de_oidos_y_maximo_tres(self):
        fotos = fotos_de_oidos({'fotos': [{'momento': 'oidos-1', 'imagen': FOTO}, {'momento': 'ojo-od', 'imagen': FOTO},
                                          'x', *[{'momento': f'oidos-{i}', 'imagen': FOTO} for i in range(2, 9)]]})
        self.assertEqual([f['momento'] for f in fotos], ['oidos-1', 'oidos-2', 'oidos-3'])
        self.assertEqual(fotos_de_oidos(None), [])

    def test_las_fotos_se_suben_y_el_meta_lleva_sus_keys(self):
        # Sin conversation_id ni ref el meta.json se sube en el momento: se lee lo que se subio
        subidas = {}
        with mock.patch.object(grabacion, '_subir', side_effect=lambda key, datos, *a: subidas.setdefault(key, datos) and key):
            carpeta, _ = grabacion.guardar_entrevista('orden_1', None, [{'momento': 'inicio', 'imagen': FOTO}],
                                                      'Resumen', [], oidos=PRUEBA)
        meta = json.loads(subidas[f'{carpeta}/meta.json'])
        self.assertEqual(meta['oidos']['fotos'], [f'{carpeta}/foto-2-oidos-1.jpg', f'{carpeta}/foto-3-oidos-2.jpg'])
        self.assertIn(f'{carpeta}/foto-1-inicio.jpg', subidas)
        self.assertEqual(meta['oidos']['resumen']['veredicto'], 'remitir')


class TestFilaAudiometria(unittest.TestCase):
    """La prueba de oidos como fila de audiometrias (la que lee el certificado en PLATAFORMA2)."""

    def test_columnas(self):
        f = fila_audiometria(limpiar_oidos(PRUEBA))
        self.assertEqual(f['equipo'], EQUIPO_ASISTENTE)
        self.assertEqual(f['aereo_od_1000'], 15)
        self.assertEqual(f['aereo_od_4000'], 70)          # no oyo ni en el techo
        self.assertEqual(f['aereo_oi_500'], 0)            # oyo en el piso
        self.assertIsNone(f['aereo_od_500'])              # no medida
        self.assertNotIn('aereo_od_250', f)               # 250 y 8000 no se miden: quedan como estan
        self.assertEqual(f['diagnostico_od'], 'Tamizaje: audición leve')
        self.assertEqual(f['remision'], 'AUDIOLOGIA')
        self.assertIn('requiere valoración auditiva', f['interpretacion'])
        self.assertIn('Asimetría entre oídos, peor el derecho', f['interpretacion'])
        self.assertIn('Caída en agudos (patrón compatible con ruido), oído derecho', f['interpretacion'])
        self.assertIn('audiometría en cabina', f['recomendaciones'])

    def test_pasa_y_repetir(self):
        pasa = {**PRUEBA, 'resumen': {**PRUEBA['resumen'], 'veredicto': 'pasa'}}
        self.assertEqual(fila_audiometria(limpiar_oidos(pasa))['remision'], 'NO APLICA')
        self.assertIsNone(fila_audiometria(limpiar_oidos(pasa))['recomendaciones'])
        rep = {**PRUEBA, 'resumen': {**PRUEBA['resumen'], 'veredicto': 'repetir',
                                     'confiabilidad': {'nivel': 'no-confiable', 'motivos': ['Contestó 5 de 20 silencios']}}}
        f = fila_audiometria(limpiar_oidos(rep))
        self.assertIn('Confiabilidad: no confiable (Contestó 5 de 20 silencios).', f['interpretacion'])
        self.assertIn('Repetir', f['recomendaciones'])

    def test_sin_prueba_no_hay_fila(self):
        self.assertIsNone(fila_audiometria(None))
        self.assertIsNone(fila_audiometria(limpiar_oidos({'realizado': False, 'motivo': 'Sin audífonos'})))


class _Cursor:
    def __init__(self, existente):
        self.existente, self.sql, self.rowcount = existente, [], 1

    def execute(self, sql, params=None):
        self.sql.append((sql, params))

    def fetchone(self):
        return self.existente

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class _Pool:
    def __init__(self, cursor):
        self.cur = cursor

    def connection(self):
        pool = self

        class _Conn:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def cursor(self):
                return pool.cur

            def commit(self):
                pass
        return _Conn()


class TestGuardarAudiometria(unittest.TestCase):

    def _guardar(self, existente):
        cur = _Cursor(existente)
        with mock.patch.object(patient, 'db_pool', _Pool(cur)):
            r = guardar_audiometria('orden_1', limpiar_oidos(PRUEBA))
        return r, [sql for sql, _ in cur.sql], cur.sql

    def test_sin_audiometria_inserta_con_los_datos_de_la_orden(self):
        r, sqls, crudo = self._guardar(None)
        self.assertTrue(r['success'])
        self.assertTrue(sqls[1].startswith('INSERT INTO audiometrias'))
        self.assertIn('FROM "HistoriaClinica" WHERE _id = %s', sqls[1])
        self.assertEqual(crudo[1][1][-1], 'orden_1')

    def test_reintento_actualiza_la_del_asistente(self):
        r, sqls, _ = self._guardar((7, EQUIPO_ASISTENTE))
        self.assertTrue(sqls[1].startswith('UPDATE audiometrias SET'))

    def test_no_toca_la_de_la_plataforma(self):
        for equipo in (None, 'MA 790'):
            r, sqls, _ = self._guardar((7, equipo))
            self.assertTrue(r.get('omitida'), equipo)
            self.assertEqual(len(sqls), 1, equipo)   # solo el SELECT

    def test_sin_prueba_no_escribe(self):
        with mock.patch.object(patient, 'db_pool', _Pool(_Cursor(None))) as p:
            self.assertFalse(guardar_audiometria('orden_1', None)['success'])
            self.assertEqual(p.cur.sql, [])


if __name__ == '__main__':
    unittest.main()
