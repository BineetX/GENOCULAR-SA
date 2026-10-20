import json
import tempfile
import unittest
from pathlib import Path

from generate_analysis_assets import generate_analysis_index


class WgsAnalysisBundleTest(unittest.TestCase):
    def test_nested_wgs_outputs_produce_valid_interactive_manifest(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            sample = "fixture_sample"
            result = root / "Combine_revised" / sample

            fixtures = {
                "spades_output/contigs.fasta": ">contig_1\nACGTACGTACGT\n>contig_2\nACGTACGT\n",
                "quast/report.tsv": "# contigs\t2\nLargest contig\t12\nTotal length\t20\nGC\t50\nN50\t12\nN90\t8\nL50\t1\nL90\t2\n",
                "checkm_output/checkm.txt": "Bin Id\tMarker lineage\tCompleteness\tContamination\tStrain heterogeneity\tGenome size (bp)\tGC\tCoding density\t# contigs\tN50 (contigs)\t# predicted genes\nfixture\tBacteria\t98.5\t1.2\t0\t20\t50\t90\t2\t12\t5\n",
                "busco/fixture_busco_output/short_summary.txt": "C:98.0%[S:97.0%,D:1.0%],F:1.0%,M:1.0%,n:100\n",
                "prokka/annotated_genome.tsv": "locus_tag\tftype\tproduct\nGENE_1\tCDS\tABC transporter\nGENE_2\tCDS\thypothetical protein\n",
                "interproscan/interproscan_results.tsv": "GENE_1\tmd5\t100\tPfam\tPF00001\tABC domain\t1\t90\t1e-20\tT\t2026-01-01\tIPR000001\tABC transporter\tGO:0001\n",
                "kofamscan/kofamscan_results.tsv": "*\tGENE_1\tK00001\t100\t120\t1e-20\tATP synthase\n",
                "dbcan/overview.txt": "Gene ID\tHMMER\t#ofTools\nGENE_1\tGH5(1-100)\t2\n",
                "emapper_results/annotations.emapper.annotations": "#query\tCOG_category\tEC\tPFAMs\nGENE_1\tJG\t1.1.1.1\tPF00001\n",
                "repeatmasker/contigs.fasta.out": "  100  1.5  0.0  0.0 contig_1 1 10 (0) + repeat  DNA/hAT 1 10 (0) 1\n",
                "repeatmasker/contigs.fasta.tbl": "total length: 20 bp\ngc level: 50.0%\nbases masked: 10 bp (50.0%)\n",
            }
            for relative, content in fixtures.items():
                path = result / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")

            abricate = result / "abricate"
            abricate.mkdir(parents=True)
            for database in ("card", "ncbi", "plasmidfinder", "resfinder", "vfdb"):
                (abricate / f"abricate_{database}.csv").write_text(
                    "#FILE\tSEQUENCE\tGENE\tRESISTANCE\nfixture\tcontig_1\tblaFIX\tBeta-lactam\n",
                    encoding="utf-8",
                )

            manifest = generate_analysis_index(
                out_root=root,
                analysis="wgs",
                mode="short",
                job_id="fixture-job",
                sample=sample,
                generators_dir=Path(__file__).resolve().parents[1] / "plot_generators",
                tool_env_root=None,
            )

            renderers = {section.get("renderer") for section in manifest["sections"]}
            expected_updated = {
                "wgs_quality_v2", "wgs_prokka_v2", "wgs_interpro_v2",
                "wgs_kofam_v2", "wgs_cazymes_v2", "wgs_cog_v2",
                "wgs_amr_v2", "wgs_repeats_v2",
            }
            self.assertTrue(expected_updated.issubset(renderers), renderers)
            self.assertFalse({"wgs_quality", "wgs_prokka", "wgs_interpro", "wgs_kofam", "wgs_cazymes", "wgs_cog", "wgs_amr", "wgs_repeats"} & renderers)
            for section in manifest["sections"]:
                payload = json.loads((root / section["path"]).read_text(encoding="utf-8"))
                self.assertEqual(payload["sample_id"], sample)

    def test_long_and_hybrid_nested_assembly_paths(self):
        profiles = {
            "long": "Combine/fixture_sample/polished/final_polished.fasta",
            "hybrid": "Hybrid/fixture_sample/unicycler/assembly.fasta",
        }
        for mode, assembly_path in profiles.items():
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as temp_dir:
                root = Path(temp_dir)
                assembly = root / assembly_path
                assembly.parent.mkdir(parents=True, exist_ok=True)
                assembly.write_text(">contig_1\nACGTACGTACGT\n", encoding="utf-8")
                quast = assembly.parents[1] / "quast" / "report.tsv"
                quast.parent.mkdir(parents=True, exist_ok=True)
                quast.write_text("# contigs\t1\nN50\t12\nL50\t1\n", encoding="utf-8")

                manifest = generate_analysis_index(
                    out_root=root,
                    analysis="wgs",
                    mode=mode,
                    job_id=f"fixture-{mode}",
                    sample="fixture_sample",
                    generators_dir=Path(__file__).resolve().parents[1] / "plot_generators",
                    tool_env_root=None,
                )
                self.assertEqual(manifest["mode"], mode)
                self.assertEqual(manifest["sample"], "fixture_sample")
                self.assertIsInstance(manifest["sections"], list)


if __name__ == "__main__":
    unittest.main()
