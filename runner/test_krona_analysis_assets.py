import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from krona_analysis_assets import integrate_gtdb_krona


class KronaAnalysisTests(unittest.TestCase):
    def test_existing_report_replaces_plot_and_preserves_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = root / "sample_gtdbtk_krona.html"
            report.write_text("<html>Krona</html>")
            sections = [{"renderer": "gtdbtk_taxonomy", "path": "analysis/data/taxonomy.json"}, {"id": "other"}]
            integrate_gtdb_krona(root, "sample", None, sections, [])
            self.assertEqual(len(sections), 2)
            self.assertEqual(sections[-1]["type"], "html")
            self.assertEqual(sections[-1]["data_path"], "analysis/data/taxonomy.json")
            integrate_gtdb_krona(root, "sample", None, sections, [])
            self.assertEqual(len(sections), 2)
            self.assertEqual(sections[-1]["data_path"], "analysis/data/taxonomy.json")

    def test_generates_from_unique_genomes_and_both_domains(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inputs = root / "MAG_shortread_results/gtdbtk/sample"
            inputs.mkdir(parents=True)
            (inputs / "gtdbtk.bac120.summary.tsv").write_text("user_genome\tclassification\na\td__Bacteria;p__P;c__\nb\td__Bacteria;p__P;c__\n")
            (inputs / "gtdbtk.ar53.summary.tsv").write_text("user_genome\tclassification\nc\td__Archaea;p__A\n")
            def generate(command, **kwargs):
                Path(command[2]).write_text("<html><krona/></html>")
                return SimpleNamespace(returncode=0, stdout="OK", stderr="")
            sections = [{"renderer": "gtdbtk_taxonomy", "path": "analysis/data/taxonomy.json"}]
            with patch("krona_analysis_assets.shutil.which", return_value="/usr/bin/ktImportText"), patch("krona_analysis_assets.subprocess.run", side_effect=generate):
                integrate_gtdb_krona(root, "sample", None, sections, [])
            self.assertEqual(sections[0]["id"], "gtdbtk_krona")
            text = (root / "analysis/reports/sample_gtdbtk_krona_input.txt").read_text()
            self.assertIn("2\tBacteria\tP\n", text)
            self.assertIn("1\tArchaea\tA\n", text)

    def test_missing_tool_does_not_drop_existing_taxonomy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inputs = root / "gtdbtk/sample"
            inputs.mkdir(parents=True)
            (inputs / "gtdbtk.bac120.summary.tsv").write_text("user_genome\tclassification\na\td__Bacteria\n")
            sections = [{"renderer": "gtdbtk_taxonomy", "path": "analysis/data/taxonomy.json"}]
            runs = []
            with patch("krona_analysis_assets.shutil.which", return_value=None):
                integrate_gtdb_krona(root, "sample", None, sections, runs)
            self.assertEqual(sections[0]["renderer"], "gtdbtk_taxonomy")
            self.assertEqual(runs[0]["rc"], 1)
