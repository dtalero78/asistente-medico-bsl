"""Cuando una entrevista del avatar cuenta como hecha, y la empresa que el medico confirma.

    python -m unittest discover tests
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
os.environ.setdefault('OPENAI_API_KEY', 'test')

from services.avatar import entrevista_completa, empresa_de_la_orden, pregunta_empresa  # noqa: E402

CIERRE = {'role': 'assistant', 'text': 'Gracias por tu tiempo, estoy generando tu resumen. No cierres esta ventana.'}


def paciente(*respuestas):
    return [t for r in respuestas for t in ({'role': 'assistant', 'text': '¿?'}, {'role': 'user', 'text': r})]


class TestEntrevistaCompleta(unittest.TestCase):

    def test_completa(self):
        self.assertTrue(entrevista_completa(paciente('Sí.', 'No.', 'Mi papá.', 'Operario.', 'No.', 'Subred Sur.') + [CIERRE]))

    def test_sin_despedida_no_cuenta(self):
        # Diana: "Hola", "Hola", "No te escucho" y se corto
        self.assertFalse(entrevista_completa(paciente('Hola.', 'Hola.', 'No te escucho.')))
        self.assertFalse(entrevista_completa(paciente('Sí.', 'No.', 'Mi papá.', 'Operario.', 'No.')))

    def test_silencios_no_son_respuestas(self):
        # Jose: microfono mudo y el medico cerro con otra frase
        cierre_sin_audio = {'role': 'assistant', 'text': 'Jose, no logro escucharte, así que cierro la llamada por ahora.'}
        self.assertFalse(entrevista_completa(paciente('...', '...', '...') + [cierre_sin_audio]))
        self.assertFalse(entrevista_completa(paciente('...', '...', '...', '...', 'Sí.') + [CIERRE]))

    def test_vacia(self):
        self.assertFalse(entrevista_completa([]))

    def test_rol_de_liveavatar(self):
        # La transcripcion de respaldo de LiveAvatar no usa "assistant"
        turnos = paciente('Sí.', 'No.', 'Mi papá.', 'Operario.') + [{'role': 'avatar', 'text': CIERRE['text']}]
        self.assertTrue(entrevista_completa(turnos))


class TestEmpresaDeLaOrden(unittest.TestCase):

    def test_particular_o_vacia_no_se_confirma(self):
        for empresa in [None, '', '  ', 'PARTICULAR', 'Particular']:
            self.assertIsNone(empresa_de_la_orden({'empresa': empresa}), empresa)
        self.assertIsNone(empresa_de_la_orden(None))

    def test_nombre_real(self):
        self.assertEqual(empresa_de_la_orden({'empresa': ' WELTNEU CO '}), 'WELTNEU CO')

    def test_pregunta_sin_empresa_no_nombra_ninguna(self):
        # Haiku leia "no indicada" como si fuera el nombre: "¿El certificado es para no indicada?"
        for paciente in [None, {'empresa': 'PARTICULAR'}]:
            texto = pregunta_empresa(paciente)
            self.assertIn('para qué empresa', texto)
            self.assertNotIn('indicada', texto)
            self.assertNotIn('PARTICULAR', texto)

    def test_pregunta_con_empresa_la_confirma(self):
        self.assertIn('¿El certificado es para WELTNEU CO?', pregunta_empresa({'empresa': 'WELTNEU CO'}))


if __name__ == '__main__':
    unittest.main()
