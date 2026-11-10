"""Al guardar el resumen se avisa a BSL-PLATAFORMA2 (pg_notify 'entrevista_terminada') en la misma
transaccion, para que cierre la orden en el momento (Daniel, 9-nov-2026). Sin BD."""
import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
from services import patient  # noqa: E402


class Cursor:
    def __init__(self, filas):
        self.filas, self.sql, self.rowcount = filas, [], 0
    def execute(self, sql, params=None):
        self.sql.append((sql, params))
        self.rowcount = self.filas if sql.startswith('UPDATE') else 1
    def __enter__(self): return self
    def __exit__(self, *a): return False


class Conexion:
    def __init__(self, cur): self.cur, self.commits = cur, 0
    def cursor(self): return self.cur
    def commit(self): self.commits += 1
    def __enter__(self): return self
    def __exit__(self, *a): return False


def guardar(filas):
    cur = Cursor(filas)
    con = Conexion(cur)
    with mock.patch.object(patient, 'db_pool', mock.Mock(connection=lambda: con)):
        r = patient.guardar_resumen('orden_1', 'resumen')
    return r, cur, con


class TestAvisoResumen(unittest.TestCase):
    def test_avisa_con_la_orden_antes_del_commit(self):
        r, cur, con = guardar(1)
        self.assertEqual(r, {'success': True, 'rows_affected': 1})
        self.assertIn("pg_notify('entrevista_terminada'", cur.sql[1][0])
        self.assertEqual(json.loads(cur.sql[1][1][0]), {'orden_id': 'orden_1'})
        self.assertEqual(con.commits, 1)

    def test_sin_orden_no_avisa(self):
        r, cur, _ = guardar(0)
        self.assertEqual(r['rows_affected'], 0)
        self.assertEqual(len(cur.sql), 1)


if __name__ == '__main__':
    unittest.main()
