"""El resumen se guarda en la BD aunque el correo o el WhatsApp fallen (4-nov-2026: el SMTP se colgo
y tres pacientes con la entrevista completa quedaron PENDIENTE, sin resumenLlamada).

    python -m unittest discover tests
"""
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
os.environ.setdefault('OPENAI_API_KEY', 'test')

import app  # noqa: E402

DATOS = {'message': 'Resumen de la entrevista:\n- Paciente: Ingrid', '_id': 'orden_x', 'to': '3001234567',
         'nombre': 'Ingrid'}
GUARDADO = {'success': True, 'rows_affected': 1}


class TestDespacharResumen(unittest.TestCase):

    def test_correo_caido_igual_guarda_y_manda_whatsapp(self):
        with mock.patch.object(app, 'guardar_resumen', return_value=GUARDADO) as guardar, \
                mock.patch.object(app, 'send_summary_email', side_effect=TimeoutError('read timed out')), \
                mock.patch.object(app, 'enviar_resumen_whatsapp') as whatsapp:
            body, status = app.despachar_resumen(dict(DATOS))
        self.assertEqual(status, 200)
        guardar.assert_called_once_with('orden_x', DATOS['message'])
        whatsapp.assert_called_once()

    def test_whatsapp_caido_igual_guarda(self):
        with mock.patch.object(app, 'guardar_resumen', return_value=GUARDADO) as guardar, \
                mock.patch.object(app, 'send_summary_email'), \
                mock.patch.object(app, 'enviar_resumen_whatsapp', side_effect=RuntimeError('twilio')):
            body, status = app.despachar_resumen(dict(DATOS))
        self.assertEqual(status, 200)
        guardar.assert_called_once()

    def test_se_guarda_antes_de_avisar(self):
        orden = []
        with mock.patch.object(app, 'guardar_resumen', side_effect=lambda *a: orden.append('bd') or GUARDADO), \
                mock.patch.object(app, 'send_summary_email', side_effect=lambda *a: orden.append('correo')), \
                mock.patch.object(app, 'enviar_resumen_whatsapp', side_effect=lambda *a: orden.append('whatsapp')):
            app.despachar_resumen(dict(DATOS))
        self.assertEqual(orden, ['bd', 'correo', 'whatsapp'])

    def test_bd_caida_no_despacha(self):
        # Sin resumen guardado el link sigue sirviendo y el paciente reintenta: no se le manda el
        # WhatsApp para no duplicarlo en el reintento.
        with mock.patch.object(app, 'guardar_resumen', return_value={'success': False, 'error': 'x'}), \
                mock.patch.object(app, 'send_summary_email') as correo, \
                mock.patch.object(app, 'enviar_resumen_whatsapp') as whatsapp:
            body, status = app.despachar_resumen(dict(DATOS))
        self.assertEqual(status, 500)
        correo.assert_not_called()
        whatsapp.assert_not_called()


if __name__ == '__main__':
    unittest.main()
