"""Testes da validação de --output do report.py.  Rodar: python3 -m unittest analytics/test_report.py"""
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

sys.modules.setdefault("httpx", types.ModuleType("httpx"))  # o report.py instala o httpx se faltar
sys.path.insert(0, str(Path(__file__).parent))
import report  # noqa: E402


class ValidarSaidaTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name, "reports").resolve()
        self.base.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def test_caminho_valido(self):
        self.assertEqual(report.validar_saida("relatorio.json", self.base), self.base / "relatorio.json")
        self.assertEqual(report.validar_saida("sub/r.json", self.base), self.base / "sub" / "r.json")

    def test_recusa_subida_de_diretorio(self):
        with self.assertRaises(ValueError):
            report.validar_saida("../../etc/x.json", self.base)

    def test_recusa_caminho_absoluto_fora_da_base(self):
        with self.assertRaises(ValueError):
            report.validar_saida("/etc/cron.d/x.json", self.base)

    def test_recusa_link_simbolico_para_fora(self):
        fora = Path(self.tmp.name, "fora")
        fora.mkdir()
        (self.base / "link").symlink_to(fora, target_is_directory=True)
        with self.assertRaises(ValueError):
            report.validar_saida("link/x.json", self.base)

    def test_recusa_extensao_diferente_de_json(self):
        with self.assertRaises(ValueError):
            report.validar_saida("relatorio.sh", self.base)

    def test_usa_report_output_dir(self):
        with mock.patch.dict(os.environ, {"REPORT_OUTPUT_DIR": str(self.base)}):
            self.assertEqual(report.validar_saida("a.json"), self.base / "a.json")

    def test_caminho_invalido_encerra_sem_gravar_nem_chamar_a_api(self):
        alvo = Path(self.tmp.name, "invasao.json")
        argv = ["report.py", "--token", "x", "--output", str(alvo)]
        with mock.patch.object(sys, "argv", argv), mock.patch.dict(os.environ, {"REPORT_OUTPUT_DIR": str(self.base)}), \
                mock.patch.object(report, "buscar_stats") as stats, mock.patch("sys.stderr"):
            with self.assertRaises(SystemExit) as fim:
                report.main()
        self.assertNotEqual(fim.exception.code, 0)
        stats.assert_not_called()
        self.assertFalse(alvo.exists())

    def test_sem_output_imprime_no_stdout(self):
        argv = ["report.py", "--token", "x"]
        with mock.patch.object(sys, "argv", argv), \
                mock.patch.object(report, "buscar_stats", return_value={}), \
                mock.patch.object(report, "buscar_todos_tickets", return_value=[]), \
                mock.patch("sys.stderr"), mock.patch("builtins.print") as imprime:
            report.main()
        self.assertTrue(any('"geradoEm"' in str(c.args[0]) for c in imprime.call_args_list if c.args))


if __name__ == "__main__":
    unittest.main()
