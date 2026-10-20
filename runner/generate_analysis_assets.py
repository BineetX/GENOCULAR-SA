#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from updated_analysis_assets import generate_updated_assets
from krona_analysis_assets import integrate_gtdb_krona
from typing import Dict, List, Optional, Tuple


ALLOWED_SECTION_TYPES = {"html", "image", "file", "plotly"}
ALLOWED_RENDERERS = {
    "fastp_qc",
    "fastp_quality",
    "fastp_content",
    "fastp_rates",
    "fastp_retained",
    "metaquast_curve",
    "checkm2_quality",
    "mapping_depth",
    "mapping_flagstat",
    "mapping_density",
    "coverm_abundance",
    "mag_alpha",
    "mag_alpha_summary",
    "mag_rank_abundance",
    "gtdbtk_taxonomy",
    "gunc_sankey",
    "cctyper_synteny",
    "cctyper_subtypes",
    "cctyper_genemap",
    "dbcan_composition",
    "prokka_features",
    "hadeg_network",
    "virsorter_scores",
    "metaphlan_species",
    "metaphlan_alpha_summary",
    "metaphlan_rank_abundance",
    "read_alpha",
    "nonpareil_curve",
    "nanostat_qc",
    "meta_amr",
    "bracken_sunburst",
    "wgs_amr",
    "wgs_cazymes",
    "wgs_quality",
    "wgs_cog",
    "wgs_interpro",
    "wgs_kofam",
    "wgs_prokka",
    "wgs_repeats",
    "wgs_preprocessing", "wgs_lr_preprocessing", "wgs_sr_hexbin_v2", "wgs_quality_v2",
    "wgs_prokka_v2", "wgs_interpro_v2", "wgs_kofam_v2", "wgs_cazymes_v2",
    "wgs_cog_v2", "wgs_amr_v2", "wgs_repeats_v2",
    "mag_assembly_v2", "mag_binning_v2", "mag_busco_v2", "mag_barrnap_v2",
    "mag_prokka_v2", "mag_dbcan_v2", "mag_hadeg_v2", "mag_metaphlan_v2",
    "mag_metaphlan_alpha_v2", "mag_metaphlan_rank_v2", "mag_virsorter_v2",
    "mag_nonpareil_v2",
}
RENDERER_VIEWS = {
    "fastp_qc": [
        ("fastp_quality", "Per-base read quality", 0),
        ("fastp_content", "Per-base nucleotide composition", 1),
        ("fastp_rates", "Q20 and Q30 quality rates", 2),
        ("fastp_retained", "Reads retained after filtering", 3),
    ],
    "mapping_depth": [
        ("mapping_flagstat", "Read mapping summary", 0),
        ("mapping_depth", "Per-contig mapping depth", 1),
    ],
    "mag_alpha": [
        ("mag_alpha_summary", "MAG alpha-diversity summary", 0),
        ("mag_rank_abundance", "MAG rank-abundance curve", 1),
    ],
    "cctyper_synteny": [
        ("cctyper_subtypes", "CRISPR-Cas subtype distribution", 0),
        ("cctyper_genemap", "CRISPR-Cas genomic synteny maps", 1),
    ],
    "metaphlan_species": [
        ("metaphlan_species", "MetaPhlAn species composition", 0),
        ("metaphlan_alpha_summary", "MetaPhlAn genus alpha diversity", 1),
    ],
}
MAX_PLOT_JSON_BYTES = 12 * 1024 * 1024
EXPANDED_ANALYSIS_VIEWS = os.getenv("GENOVERSE_EXPANDED_ANALYSIS_VIEWS", "0").strip() == "1"


def _rel(path: Path, root: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def _validate_relative_asset_path(value: str) -> str:
    path = Path(str(value or ""))
    if not value or "\\" in value or "\x00" in value or path.is_absolute() or ".." in path.parts:
        raise ValueError(f"unsafe analysis asset path: {value!r}")
    return path.as_posix()


def _validate_plot_json(path: Path) -> None:
    size = path.stat().st_size
    if size <= 0 or size > MAX_PLOT_JSON_BYTES:
        raise ValueError(f"plot JSON size outside allowed range: {path} ({size} bytes)")
    with path.open("r", encoding="utf-8") as fh:
        payload = json.load(fh)
    if not isinstance(payload, dict) or not isinstance(payload.get("sample_id"), str):
        raise ValueError(f"plot JSON must be an object with a string sample_id: {path}")


def _first_file(root: Path, patterns: List[str]) -> Optional[Path]:
    for pat in patterns:
        try:
            matches = sorted(root.glob(pat))
        except OSError:
            matches = []
        if matches:
            return matches[0]
    return None


def _build_python_candidates(tool_env_root: Optional[Path]) -> List[str]:
    env_candidates = []
    for env_key in (
        "GENOVERSE_ENV_MARINE",
        "GENOVERSE_ENV_PROKKA",
        "GENOVERSE_ENV_INTERPROSCAN",
        "GENOVERSE_ENV_EGGNOG",
        "GENOVERSE_ENV_DBCAN",
        "GENOVERSE_ENV_ABRICATE",
    ):
        v = os.getenv(env_key, "").strip()
        if v:
            env_candidates.append(str(Path(v) / "bin" / "python"))

    root_candidates = []
    if tool_env_root:
        for d in ("marine", "prokka", "interproscan_env", "eggnog-mapper", "dbcan", "abricate-env"):
            root_candidates.append(str(tool_env_root / d / "bin" / "python"))

    return env_candidates + root_candidates + [
        "/opt/conda/envs/snakemake/bin/python",
        "python3",
    ]


def _pick_plot_python(tool_env_root: Optional[Path]) -> str:
    for py in _build_python_candidates(tool_env_root):
        try:
            probe = subprocess.run(
                [py, "-c", "import pandas,matplotlib; print('ok')"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=20,
            )
            if probe.returncode == 0:
                return py
        except Exception:
            continue
    return sys.executable


def _run(
    cmd: List[str],
    cwd: Optional[Path] = None,
    env: Optional[Dict[str, str]] = None,
) -> Tuple[int, str]:
    proc = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    return proc.returncode, proc.stdout or ""


def _add_section(
    sections: List[Dict],
    *,
    sec_id: str,
    title: str,
    sec_type: str,
    path: str,
    source: str = "",
    order: int = 1000,
    renderer: str = "",
) -> None:
    if sec_type not in ALLOWED_SECTION_TYPES:
        raise ValueError(f"unsupported analysis section type: {sec_type}")
    path = _validate_relative_asset_path(path)
    if sec_type == "plotly" and renderer not in ALLOWED_RENDERERS:
        raise ValueError(f"unsupported Plotly renderer: {renderer}")
    if any(
        str(s.get("path", "")).strip() == path
        and (sec_type != "plotly" or str(s.get("renderer", "")) == renderer)
        for s in sections
    ):
        return
    section = {
        "id": sec_id,
        "title": title,
        "type": sec_type,
        "path": path,
        "source": source,
        "order": order,
    }
    if renderer:
        section["renderer"] = renderer
    sections.append(section)


def _add_plot_views(
    sections: List[Dict],
    *,
    sec_prefix: str,
    title: str,
    path: str,
    source: str,
    order: int,
    renderer: str,
) -> None:
    # Keep the default output compatible with workers that were started before
    # the expanded renderer allowlist was deployed. New workers opt in below
    # through GENOVERSE_EXPANDED_ANALYSIS_VIEWS.
    views = RENDERER_VIEWS.get(renderer, [(renderer, title, 0)]) if EXPANDED_ANALYSIS_VIEWS else [(renderer, title, 0)]
    for view_renderer, view_title, order_offset in views:
        _add_section(
            sections,
            sec_id=f"{sec_prefix}_{view_renderer}" if sec_prefix else view_renderer,
            title=view_title,
            sec_type="plotly",
            path=path,
            source=source,
            order=order + order_offset,
            renderer=view_renderer,
        )


def _has_any_data_rows(csv_dir: Path) -> bool:
    for p in sorted(csv_dir.glob("*.csv")):
        try:
            with p.open("r", encoding="utf-8", errors="replace") as fh:
                # Header line + at least one non-empty data line
                next(fh, None)
                for line in fh:
                    if line.strip():
                        return True
        except Exception:
            continue
    return False


def _collect_png_sections(out_root: Path, plot_root: Path, sections: List[Dict], prefix: str, title_prefix: str, order_base: int) -> None:
    try:
        pngs = sorted(plot_root.glob("*.png"))
    except OSError:
        pngs = []
    for i, p in enumerate(pngs, start=1):
        _add_section(
            sections,
            sec_id=f"{prefix}_{i}",
            title=f"{title_prefix}: {p.stem.replace('_', ' ')}",
            sec_type="image",
            path=_rel(p, out_root),
            source=prefix,
            order=order_base + i,
        )


def _pick_meta_python(tool_env_root: Optional[Path]) -> str:
    candidates = _build_python_candidates(tool_env_root)
    if tool_env_root and tool_env_root.exists():
        candidates.extend(str(p / "bin" / "python") for p in sorted(tool_env_root.iterdir()) if p.is_dir())
    for py in dict.fromkeys(candidates):
        try:
            probe = subprocess.run(
                [py, "-c", "import pandas,numpy,scipy; print('ok')"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=20,
            )
            if probe.returncode == 0:
                return py
        except Exception:
            continue
    return sys.executable


def _pick_updated_python(tool_env_root: Optional[Path]) -> str:
    candidates = _build_python_candidates(tool_env_root)
    if tool_env_root and tool_env_root.exists():
        candidates.extend(str(path / "bin" / "python") for path in sorted(tool_env_root.iterdir()) if path.is_dir())
    for python in dict.fromkeys(candidates):
        try:
            probe = subprocess.run(
                [python, "-c", "import sys,pandas,numpy,scipy,matplotlib; assert sys.version_info >= (3, 9)"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=20,
            )
            if probe.returncode == 0:
                return python
        except Exception:
            continue
    return sys.executable


def _generate_meta_json(
    *,
    out_root: Path,
    sample: str,
    mode: str,
    generators_dir: Path,
    tool_env_root: Optional[Path],
    sections: List[Dict],
    generator_runs: List[Dict],
) -> None:
    result_roots = {
        "short": ["**/MAG_shortread_results"],
        "long": ["**/longread_results"],
        "hybrid": ["**/hybrid_results"],
    }
    mag_root = _first_file(out_root, result_roots.get(mode, []))
    scripts_dir = generators_dir / "meta_genomics" / "modified"
    if not mag_root or not mag_root.is_dir() or not scripts_dir.is_dir():
        generator_runs.append({"name": f"meta_{mode}_interactive", "rc": 0, "log": "Skipped: metagenomics result tree or JSON generators not found."})
        return

    sample_id = sample or out_root.name
    data_dir = out_root / "analysis" / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    py = _pick_meta_python(tool_env_root)

    def found(*patterns: str) -> Optional[Path]:
        return _first_file(mag_root, list(patterns))

    fastp = found(f"fastp/{sample_id}_fastp.json", f"fastp/{sample_id}/fastp.json", "fastp/**/*fastp*.json")
    if mode == "long":
        assembly = found(f"medaka/{sample_id}/consensus.fasta", f"assembly/{sample_id}_flye/assembly.fasta")
        bam = found(f"mapping/{sample_id}_filtered.sorted.bam", f"mapping/{sample_id}.sorted.bam")
        depth = found(f"mapping/{sample_id}_filtered_depth.txt", f"mapping/{sample_id}_depth.txt")
    elif mode == "hybrid":
        assembly = found(f"operams/{sample_id}_nostrain/contigs.fasta", "operams/*_nostrain/contigs.fasta")
        bam = found(f"mapping/{sample_id}.sorted.bam")
        depth = found(f"mapping/{sample_id}_depth.txt")
    else:
        assembly = found(f"assembly/megahit_{sample_id}/final.contigs.fa", "assembly/megahit_*/final.contigs.fa")
        bam = found(f"mapping/{sample_id}.sorted.bam", "mapping/*.sorted.bam")
        depth = found(f"mapping/{sample_id}_depth.txt", "mapping/*_depth.txt")
    quast = found(f"quast/{sample_id}/report.tsv", "quast/*/report.tsv")
    checkm2 = found(f"checkm2/{sample_id}/quality_report.tsv", "checkm2/*/quality_report.tsv")
    nanostat_raw = found(f"nanostat/{sample_id}/raw_nanostat.txt", "nanostat/*/raw_nanostat.txt")
    nanostat_clean = found(
        f"nanostat/{sample_id}/filtered_nanostat.txt",
        "nanostat/*/filtered_nanostat.txt",
        # Backward compatibility for runs completed before post-filter
        # NanoStat became an explicit workflow stage.
        f"nanoq/{sample_id}/nanoq_summary.txt",
        "nanoq/*/nanoq_summary.txt",
    )
    coverm = found(f"coverm/{sample_id}/coverage.tsv", "coverm/*/coverage.tsv")
    bac120 = found(f"gtdbtk/{sample_id}/gtdbtk.bac120.summary.tsv", "gtdbtk/*/gtdbtk.bac120.summary.tsv")
    ar53 = found(f"gtdbtk/{sample_id}/gtdbtk.ar53.summary.tsv", "gtdbtk/*/gtdbtk.ar53.summary.tsv")
    gunc = found(f"gunc/{sample_id}/gunc_maxcss.tsv", "gunc/*/gunc_maxcss.tsv")
    cctyper = found(f"annotation/cctyper/{sample_id}", "annotation/cctyper/*")
    dbcan = found(f"annotation/dbcan/{sample_id}", "annotation/dbcan/*")
    prokka = found(f"annotation/prokka/{sample_id}", "annotation/prokka/*")
    viral_score = found(f"viral/{sample_id}/virsorter2/final-viral-score.tsv", "viral/*/virsorter2/final-viral-score.tsv")
    viral_boundary = found(f"viral/{sample_id}/virsorter2/final-viral-boundary.tsv", "viral/*/virsorter2/final-viral-boundary.tsv")
    metaphlan = found(f"metaphlan/{sample_id}_profile.txt", "metaphlan/*_profile.txt")
    nonpareil = found(f"nonpareil/{sample_id}.npo", "nonpareil/*.npo")
    abricate_summary = found(f"annotation/abricate/{sample_id}", "annotation/abricate/*")
    bracken = found(f"bracken/{sample_id}.bracken", "bracken/*.bracken")

    specs = []
    if mode in {"long", "hybrid"}:
        specs.append(("nanostat", "generate_nanostat_json.py", [nanostat_raw, nanostat_clean], "nanostat_qc", "Long-read quality", "nanostat_qc", 95))
    specs.extend([
        ("fastp", "generate_fastp_json.py", [fastp], "fastp_qc", "Read quality before and after filtering", "fastp_qc", 100),
        ("metaquast", "generate_metaquast_json.py", [assembly, quast], "metaquast_curve", "Assembly contiguity", "metaquast_curve", 110),
        ("checkm2", "generate_checkm2_json.py", [checkm2], "checkm2_quality", "MAG completeness and contamination", "checkm2_quality", 120),
        ("mapping_depth", "generate_genome_depth_json.py", [bam, depth], "mapping_depth_profile", "Read mapping depth", "mapping_depth", 130),
        ("mapping_density", "generate_density_json.py", [depth], "mapping_coverage_density", "Coverage density", "mapping_density", 140),
        ("coverm", "generate_coverm_json.py", [coverm, bac120, ar53], "coverm_relative_abundance", "MAG relative abundance", "coverm_abundance", 150),
        ("mag_alpha", "generate_alpha_diversity_mag_json.py", [coverm], "mag_alpha_diversity", "MAG alpha diversity", "mag_alpha", 160),
        ("gtdbtk", "generate_gtdbtk_json.py", [bac120, ar53], "gtdbtk_taxonomy", "GTDB-Tk taxonomy", "gtdbtk_taxonomy", 170),
        ("gunc", "generate_gunc_json.py", [gunc], "gunc_sankey", "GUNC contamination flow", "gunc_sankey", 180),
        ("cctyper", "generate_cctyper_json.py", [cctyper], "cctyper_annotation", "CRISPR-Cas systems", "cctyper_synteny", 190),
        ("dbcan", "generate_dbcan_json.py", [dbcan], "dbcan_cazyme_composition", "CAZyme composition", "dbcan_composition", 200),
        ("meta_amr", "generate_amr_json.py", [abricate_summary], "amr_summary", "AMR and virulence hits", "meta_amr", 205),
        ("prokka", "generate_prokka_json.py", [prokka], "prokka_features", "Prokka annotation features", "prokka_features", 210),
        ("hadeg", "generate_hadeg_json.py", [mag_root], "hadeg_network", "Hydrocarbon degradation network", "hadeg_network", 220),
        ("virsorter2", "generate_virsorter2_json.py", [viral_score, viral_boundary], "virsorter2_scores", "VirSorter2 viral scores", "virsorter_scores", 230),
        ("metaphlan", "generate_metaphlan_json.py", [metaphlan], "metaphlan_species", "MetaPhlAn species profile", "metaphlan_species", 240),
        ("bracken", "generate_bracken_json.py", [bracken], "bracken_abundance", "Community taxonomy (Bracken)", "bracken_sunburst", 245),
        ("read_alpha", "generate_read_based_alpha_diversity_json.py", [metaphlan], "read_based_alpha_diversity", "Read-based alpha diversity", "read_alpha", 250),
        ("nonpareil", "generate_nonpareil_json.py", [nonpareil], "nonpareil_curve", "Nonpareil sequencing coverage", "nonpareil_curve", 260),
    ])

    run_env = os.environ.copy()
    if tool_env_root:
        extra_bins = [tool_env_root / "mapping_env" / "bin", tool_env_root / "nonpareil" / "bin"]
        run_env["PATH"] = os.pathsep.join([str(p) for p in extra_bins if p.exists()] + [run_env.get("PATH", "")])

    for name, script_name, inputs, output_stem, title, renderer, order in specs:
        script = scripts_dir / script_name
        output_path = data_dir / f"{sample_id}_{output_stem}.json"
        if not script.exists() or any(p is None or not p.exists() for p in inputs):
            missing = [str(p) if p else "not found" for p in inputs if p is None or not p.exists()]
            generator_runs.append({"name": name, "rc": 0, "log": f"Skipped: missing input(s): {', '.join(missing)}"})
            continue

        if name == "mapping_depth":
            cmd_inputs = [inputs[0], data_dir, sample_id, inputs[1]]
        elif name == "nanostat":
            cmd_inputs = [inputs[0], inputs[1], data_dir, sample_id]
        elif name == "coverm":
            cmd_inputs = [inputs[0], data_dir, inputs[1], inputs[2], sample_id]
        elif name == "gtdbtk":
            cmd_inputs = [*inputs, data_dir, sample_id]
        elif name == "virsorter2":
            cmd_inputs = [inputs[0], data_dir, inputs[1], sample_id]
        elif name == "metaquast":
            cmd_inputs = [*inputs, data_dir, sample_id]
        else:
            cmd_inputs = [inputs[0], data_dir, sample_id]

        rc, txt = _run([py, str(script), *[str(v) for v in cmd_inputs]], env=run_env)
        if rc == 0 and not output_path.exists():
            rc = 1
            txt += f"\nExpected output was not created: {output_path}"
        if rc == 0:
            try:
                _validate_plot_json(output_path)
            except (OSError, ValueError, json.JSONDecodeError) as exc:
                rc = 1
                txt += f"\nOutput validation failed: {exc}"
        generator_runs.append({"name": name, "rc": rc, "log": txt[-8000:]})
        if rc == 0:
            _add_plot_views(
                sections,
                sec_prefix="meta",
                title=title,
                path=_rel(output_path, out_root),
                source=name,
                order=order,
                renderer=renderer,
            )


def _generate_wgs_json(
    *,
    out_root: Path,
    sample: str,
    mode: str,
    generators_dir: Path,
    tool_env_root: Optional[Path],
    sections: List[Dict],
    generator_runs: List[Dict],
) -> None:
    scripts_dir = generators_dir / "wgs" / "modified"
    meta_scripts_dir = generators_dir / "meta_genomics" / "modified"
    if not scripts_dir.is_dir():
        generator_runs.append({"name": f"wgs_{mode}_interactive", "rc": 0, "log": "Skipped: WGS JSON generators not found."})
        return

    sample_id = sample or out_root.name
    data_dir = out_root / "analysis" / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    py = _pick_meta_python(tool_env_root)

    def found(*patterns: str) -> Optional[Path]:
        return _first_file(out_root, list(patterns))

    assembly_patterns = {
        "short": ["**/spades_output/contigs.fasta"],
        "long": ["**/polished/final_polished.fasta", "**/flye_output/assembly.fasta"],
        "hybrid": ["**/unicycler/assembly.fasta"],
    }
    assembly = found(*assembly_patterns.get(mode, []))
    quast = found("**/quast/report.tsv")
    fastp = found("**/fastp/*fastp*.json", "**/fastp.json")
    prokka = found("**/prokka/annotated_genome.tsv")
    interpro = found("**/interproscan/interproscan_results.tsv")
    kofam = found("**/kofamscan/kofamscan_results.tsv")
    dbcan = found("**/dbcan/overview.txt")
    emapper = found("**/emapper_results/annotations.emapper.annotations")
    abricate = found("**/abricate")
    checkm = found("**/checkm_output/checkm.txt")
    busco = found("**/busco/**/short_summary.txt", "**/busco/**/short_summary*.txt")
    repeatmasker = found("**/repeatmasker")

    specs = [
        ("wgs_fastp", scripts_dir / "generate_fastp_json.py", [fastp], "fastp_qc", "Read quality before and after filtering", "fastp_qc", 100),
        ("wgs_metaquast", meta_scripts_dir / "generate_metaquast_json.py", [assembly, quast], "metaquast_curve", "Assembly contiguity", "metaquast_curve", 110),
        ("wgs_quality", scripts_dir / "generate_checkm_busco_json.py", [checkm, busco], "checkm_busco_summary", "Genome completeness", "wgs_quality", 120),
        ("wgs_prokka", scripts_dir / "generate_prokka_json.py", [prokka], "prokka_summary", "Genome annotation", "wgs_prokka", 130),
        ("wgs_interpro", scripts_dir / "generate_interproscan_json.py", [interpro], "interproscan_summary", "InterPro domains", "wgs_interpro", 140),
        ("wgs_kofam", scripts_dir / "generate_kofam_json.py", [kofam], "kofam_summary", "KEGG orthology", "wgs_kofam", 150),
        ("wgs_cazymes", scripts_dir / "generate_cazymes_json.py", [dbcan], "cazymes_summary", "CAZyme families", "wgs_cazymes", 160),
        ("wgs_cog", scripts_dir / "generate_cog_json.py", [emapper], "emapper_summary", "COG functional categories", "wgs_cog", 170),
        ("wgs_amr", scripts_dir / "generate_amr_json.py", [abricate], "amr_summary", "AMR and virulence hits", "wgs_amr", 180),
        ("wgs_repeats", scripts_dir / "generate_repeatmasker_json.py", [repeatmasker], "repeatmasker_summary", "Repeat landscape", "wgs_repeats", 190),
    ]

    for name, script, inputs, output_stem, title, renderer, order in specs:
        output_path = data_dir / f"{sample_id}_{output_stem}.json"
        if not script.exists() or any(p is None or not p.exists() for p in inputs):
            missing = [str(p) if p else "not found" for p in inputs if p is None or not p.exists()]
            generator_runs.append({"name": name, "rc": 0, "log": f"Skipped: missing input(s): {', '.join(missing)}"})
            continue

        if name == "wgs_quality":
            cmd_inputs = [inputs[0], inputs[1], data_dir, sample_id]
        elif name == "wgs_metaquast":
            cmd_inputs = [inputs[0], inputs[1], data_dir, sample_id]
        else:
            cmd_inputs = [inputs[0], data_dir, sample_id]

        rc, txt = _run([py, str(script), *[str(v) for v in cmd_inputs]])
        if rc == 0 and not output_path.exists():
            rc = 1
            txt += f"\nExpected output was not created: {output_path}"
        if rc == 0:
            try:
                _validate_plot_json(output_path)
            except (OSError, ValueError, json.JSONDecodeError) as exc:
                rc = 1
                txt += f"\nOutput validation failed: {exc}"
        generator_runs.append({"name": name, "rc": rc, "log": txt[-8000:]})
        if rc == 0:
            _add_plot_views(
                sections,
                sec_prefix="",
                title=title,
                path=_rel(output_path, out_root),
                source=name,
                order=order,
                renderer=renderer,
            )


def generate_analysis_index(
    out_root: Path,
    analysis: str,
    mode: str,
    job_id: str,
    sample: str,
    generators_dir: Path,
    tool_env_root: Optional[Path],
) -> Dict:
    analysis_dir = out_root / "analysis"
    plots_dir = analysis_dir / "plots"
    analysis_dir.mkdir(parents=True, exist_ok=True)
    plots_dir.mkdir(parents=True, exist_ok=True)

    sections: List[Dict] = []
    generator_runs: List[Dict] = []
    py = _pick_plot_python(tool_env_root)

    # Core built-in reports.
    antismash_idx = _first_file(out_root, ["**/antismash_results/index.html"])
    if antismash_idx:
        _add_section(
            sections,
            sec_id="antismash_report",
            title="antiSMASH Report",
            sec_type="html",
            path=_rel(antismash_idx, out_root),
            source="builtin",
            order=10,
        )

    nanoplot_idx = _first_file(out_root, ["**/nanoplot/NanoPlot-report.html"])
    if nanoplot_idx:
        _add_section(
            sections,
            sec_id="nanoplot_report",
            title="NanoPlot Report",
            sec_type="html",
            path=_rel(nanoplot_idx, out_root),
            source="builtin",
            order=20,
        )

    multiqc_idx = _first_file(out_root, ["**/multiqc/multiqc_report.html"])
    if multiqc_idx:
        _add_section(
            sections,
            sec_id="multiqc_report",
            title="MultiQC Report",
            sec_type="html",
            path=_rel(multiqc_idx, out_root),
            source="builtin",
            order=25,
        )

    quast_idx = _first_file(out_root, ["**/quast/*/report.html", "**/quast/report.html"])
    if quast_idx:
        _add_section(
            sections,
            sec_id="quast_report",
            title="Assembly Quality (QUAST)",
            sec_type="html",
            path=_rel(quast_idx, out_root),
            source="builtin",
            order=27,
        )

    crispr_plot = _first_file(out_root, ["**/crispr_output/plot.png"])
    if crispr_plot:
        _add_section(
            sections,
            sec_id="crispr_plot",
            title="CRISPR Plot",
            sec_type="image",
            path=_rel(crispr_plot, out_root),
            source="builtin",
            order=30,
        )

    # Plot generators
    script_map = {
        "prokka": generators_dir / "WS_Prokka_plots.py",
        "interpro": generators_dir / "WS_Interpro_plots.py",
        "emapper": generators_dir / "WS_emapper_plots.py",
        "abricate": generators_dir / "WS_abricate_plots.py",
        "dbcan": generators_dir / "WS_dbcan_plot_fixed.py",
        "checkm_busco": generators_dir / "WS_CHeckm_busco_plots.py",
    }

    prokka_tsv = _first_file(out_root, ["**/prokka/annotated_genome.tsv"])
    if prokka_tsv and script_map["prokka"].exists():
        outdir = plots_dir / "prokka"
        outdir.mkdir(parents=True, exist_ok=True)
        cmd = [py, str(script_map["prokka"]), "-i", str(prokka_tsv), "-o", str(outdir)]
        prokka_faa = _first_file(out_root, ["**/prokka/annotated_genome.faa"])
        if prokka_faa:
            cmd.extend(["--faa", str(prokka_faa)])
        rc, txt = _run(cmd)
        generator_runs.append({"name": "prokka", "rc": rc, "log": txt[-8000:]})
        if rc == 0:
            _collect_png_sections(out_root, outdir, sections, "prokka", "Prokka", 110)

    interpro_tsv = _first_file(out_root, ["**/interproscan/interproscan_results.tsv"])
    if interpro_tsv and script_map["interpro"].exists():
        outdir = plots_dir / "interpro"
        outdir.mkdir(parents=True, exist_ok=True)
        rc, txt = _run([py, str(script_map["interpro"]), "-i", str(interpro_tsv), "-o", str(outdir)])
        generator_runs.append({"name": "interpro", "rc": rc, "log": txt[-8000:]})
        if rc == 0:
            _collect_png_sections(out_root, outdir, sections, "interpro", "InterPro", 210)

    emapper_ann = _first_file(out_root, ["**/emapper_results/annotations.emapper.annotations"])
    if emapper_ann and script_map["emapper"].exists():
        outdir = plots_dir / "emapper"
        outdir.mkdir(parents=True, exist_ok=True)
        rc, txt = _run([py, str(script_map["emapper"]), "-a", str(emapper_ann), "-o", str(outdir)])
        generator_runs.append({"name": "emapper", "rc": rc, "log": txt[-8000:]})
        if rc == 0:
            _collect_png_sections(out_root, outdir, sections, "emapper", "eggNOG", 310)

    abricate_dir = _first_file(out_root, ["**/abricate"])
    if abricate_dir and abricate_dir.is_dir() and script_map["abricate"].exists():
        if _has_any_data_rows(abricate_dir):
            outdir = plots_dir / "abricate"
            outdir.mkdir(parents=True, exist_ok=True)
            rc, txt = _run(
                [
                    py,
                    str(script_map["abricate"]),
                    "--indir",
                    str(abricate_dir),
                    "--outdir",
                    str(outdir),
                    "--fmt",
                    "png",
                    "--dpi",
                    "300",
                    "--top",
                    "20",
                ]
            )
            generator_runs.append({"name": "abricate", "rc": rc, "log": txt[-8000:]})
            if rc == 0:
                _collect_png_sections(out_root, outdir, sections, "abricate", "ABRicate", 410)
        else:
            generator_runs.append(
                {
                    "name": "abricate",
                    "rc": 0,
                    "log": "Skipped: no non-empty ABRicate CSV rows found.",
                }
            )

    dbcan_overview = _first_file(out_root, ["**/dbcan/**/overview.txt"])
    if dbcan_overview and script_map["dbcan"].exists():
        outdir = plots_dir / "dbcan"
        outdir.mkdir(parents=True, exist_ok=True)
        local_overview = outdir / "overview.txt"
        local_overview.write_text(dbcan_overview.read_text(errors="replace"))
        rc, txt = _run([py, str(script_map["dbcan"])], cwd=outdir)
        generator_runs.append({"name": "dbcan", "rc": rc, "log": txt[-8000:]})
        if rc == 0:
            _collect_png_sections(out_root, outdir, sections, "dbcan", "dbCAN", 510)

    checkm_summary = _first_file(
        out_root,
        [
            "**/checkm_output/checkm.txt",
            "**/checkm/checkm.txt",
            "**/checkm_output/*checkm*.txt",
        ],
    )
    busco_summary = _first_file(
        out_root,
        [
            "**/busco/**/short_summary.specific*.txt",
            "**/busco/**/short_summary*.txt",
        ],
    )
    if checkm_summary and busco_summary and script_map["checkm_busco"].exists():
        outdir = plots_dir / "checkm_busco"
        outdir.mkdir(parents=True, exist_ok=True)
        outprefix = outdir / "genome_quality_summary"
        rc, txt = _run(
            [
                py,
                str(script_map["checkm_busco"]),
                "--checkm",
                str(checkm_summary),
                "--busco",
                str(busco_summary),
                "--outprefix",
                str(outprefix),
            ]
        )
        generator_runs.append({"name": "checkm_busco", "rc": rc, "log": txt[-8000:]})
        if rc == 0:
            _collect_png_sections(out_root, outdir, sections, "checkm_busco", "CheckM + BUSCO", 610)

    if analysis == "wgs" and mode in {"short", "long", "hybrid"}:
        _generate_wgs_json(
            out_root=out_root,
            sample=sample,
            mode=mode,
            generators_dir=generators_dir,
            tool_env_root=tool_env_root,
            sections=sections,
            generator_runs=generator_runs,
        )
    elif analysis == "metagenomics" and mode in {"short", "long", "hybrid"}:
        _generate_meta_json(
            out_root=out_root,
            sample=sample,
            mode=mode,
            generators_dir=generators_dir,
            tool_env_root=tool_env_root,
            sections=sections,
            generator_runs=generator_runs,
        )

    generate_updated_assets(
        out_root, analysis, mode, sample, generators_dir, sections, generator_runs,
        python=_pick_updated_python(tool_env_root),
        job_id=job_id,
    )

    if analysis == "metagenomics":
        integrate_gtdb_krona(out_root, sample, tool_env_root, sections, generator_runs)

    sections.sort(key=lambda s: (int(s.get("order", 9999)), str(s.get("title", ""))))
    if len(sections) > 64:
        raise ValueError(f"analysis manifest exceeds the 64-section limit: {len(sections)}")
    index = {
        "version": 2,
        "job_id": job_id,
        "sample": sample,
        "analysis_type": analysis,
        "mode": mode,
        "generated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "sections": sections,
        "generator_runs": generator_runs,
    }
    index_path = analysis_dir / "index.json"
    temp_path = analysis_dir / ".index.json.tmp"
    temp_path.write_text(json.dumps(index, indent=2), encoding="utf-8")
    os.replace(temp_path, index_path)
    return index


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Generate analysis assets and index.json for a job output tree.")
    p.add_argument("--out-root", required=True, help="Absolute path to OUTPUT/<sample> root")
    p.add_argument("--analysis", default="wgs", help="Analysis type (wgs/metagenomics)")
    p.add_argument("--mode", default="short", help="Read mode (short/long/hybrid)")
    p.add_argument("--job-id", default="", help="Job id")
    p.add_argument("--sample", default="", help="Sample name")
    p.add_argument("--plot-generators-dir", default="/project/plot_generators", help="Directory containing plot generator scripts")
    p.add_argument("--tool-env-root", default="", help="Tool env root used to discover python interpreters")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    out_root = Path(args.out_root).resolve()
    generators_dir = Path(args.plot_generators_dir).resolve()
    tool_env_root = Path(args.tool_env_root).resolve() if str(args.tool_env_root).strip() else None

    if not out_root.exists():
        print(f"[analysis] output root does not exist: {out_root}")
        return 1
    if not generators_dir.exists():
        print(f"[analysis] plot generators directory not found: {generators_dir}")
        return 1

    idx = generate_analysis_index(
        out_root=out_root,
        analysis=str(args.analysis or "wgs").strip().lower(),
        mode=str(args.mode or "short").strip().lower(),
        job_id=str(args.job_id or "").strip(),
        sample=str(args.sample or "").strip(),
        generators_dir=generators_dir,
        tool_env_root=tool_env_root,
    )
    print(f"[analysis] wrote {out_root / 'analysis' / 'index.json'}")
    print(f"[analysis] sections={len(idx.get('sections', []))}")
    for run in idx.get("generator_runs", []):
        print(f"[analysis] generator={run.get('name')} rc={run.get('rc')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
