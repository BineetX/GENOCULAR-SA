import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from updated_analysis_assets import _meta_specs, generate_updated_assets


class MetaphlanRankRemovalTest(unittest.TestCase):
    def test_all_meta_modes_keep_alpha_without_separate_rank_plot(self):
        for mode, folder in (("short", "MAG_shortread_results"), ("long", "longread_results"), ("hybrid", "hybrid_results")):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / folder).mkdir()
                specs = _meta_specs(root, mode, "sample", root)
                renderers = {spec["renderer"] for spec in specs}
                self.assertIn("mag_metaphlan_alpha_v2", renderers)
                self.assertNotIn("mag_metaphlan_rank_v2", renderers)
                sections = [{"renderer": renderer} for renderer in
                            ("read_alpha", "mag_metaphlan_alpha_v2", "metaphlan_rank_abundance", "mag_metaphlan_rank_v2")]
                with patch("updated_analysis_assets._emit", return_value=False):
                    generate_updated_assets(root, "metagenomics", mode, "sample", root, sections, [])
                self.assertEqual({section["renderer"] for section in sections}, {"read_alpha", "mag_metaphlan_alpha_v2"})


class CheckM2RetentionTest(unittest.TestCase):
    def test_successful_busco_generator_does_not_remove_checkm2(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "MAG_shortread_results").mkdir()
            sections = [{"renderer": "checkm2_quality"}]

            def emit(spec, _root, _data_dir, _sample, output_sections, _runs, _python):
                if spec["renderer"] != "mag_busco_v2":
                    return False
                output_sections.append({"renderer": "mag_busco_v2"})
                return True

            with patch("updated_analysis_assets._emit", side_effect=emit):
                generate_updated_assets(
                    root, "metagenomics", "short", "sample", root, sections, []
                )

            self.assertEqual(
                {section["renderer"] for section in sections},
                {"checkm2_quality", "mag_busco_v2"},
            )
