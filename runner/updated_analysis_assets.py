"""Generate the updated, job-scoped analysis dashboards from workflow outputs."""

import json
import os
import subprocess
import sys
from pathlib import Path

MAX_JSON_BYTES = 12 * 1024 * 1024

# New renderer -> older card replaced when the updated generator succeeds.
REPLACED_RENDERERS = {
    "wgs_preprocessing": {"fastp_qc", "fastp_quality", "fastp_content", "fastp_rates", "fastp_retained"},
    "wgs_lr_preprocessing": {"nanostat_qc"},
    "wgs_quality_v2": {"wgs_quality"},
    "wgs_prokka_v2": {"wgs_prokka"},
    "wgs_interpro_v2": {"wgs_interpro"},
    "wgs_kofam_v2": {"wgs_kofam"},
    "wgs_cazymes_v2": {"wgs_cazymes"},
    "wgs_cog_v2": {"wgs_cog"},
    "wgs_amr_v2": {"wgs_amr"},
    "wgs_repeats_v2": {"wgs_repeats"},
    "mag_assembly_v2": {"metaquast_curve"},
    "mag_prokka_v2": {"prokka_features"},
    "mag_dbcan_v2": {"dbcan_composition"},
    "mag_hadeg_v2": {"hadeg_network"},
    "mag_metaphlan_v2": {"metaphlan_species"},
    "mag_metaphlan_alpha_v2": {"metaphlan_alpha_summary"},
    "mag_virsorter_v2": {"virsorter_scores"},
    "mag_nonpareil_v2": {"nonpareil_curve"},
}

REPLACED_IMAGE_SOURCES = {
    "wgs_quality_v2": {"checkm_busco"},
    "wgs_prokka_v2": {"prokka"},
    "wgs_interpro_v2": {"interpro"},
    "wgs_cazymes_v2": {"dbcan"},
    "wgs_cog_v2": {"emapper"},
    "wgs_amr_v2": {"abricate"},
}


def _first(root, *patterns):
    if root is None:
        return None
    for pattern in patterns:
        matches = sorted(root.glob(pattern))
        if matches:
            return matches[0]
    return None


def _record(spec, rc, message, runs):
    runs.append({"name": spec["renderer"], "rc": rc, "log": str(message)[-8000:]})


def _emit(spec, result_root, data_dir, sample, sections, runs, python):
    script = spec["script"]
    inputs = spec["inputs"]
    if not script.is_file() or any(path is None or not path.exists() for path in inputs):
        _record(spec, 0, "Skipped: updated generator or required input is unavailable.", runs)
        return False

    output = data_dir / spec["output"]
    output.unlink(missing_ok=True)
    env = os.environ.copy()
    env.update(spec.get("env", {}))
    command = [python, str(script), *[str(path) for path in spec.get("args", [])]]
    try:
        process = subprocess.run(
            command,
            cwd=data_dir,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=spec.get("timeout", 900),
        )
        rc, log = process.returncode, process.stdout or ""
    except (OSError, subprocess.TimeoutExpired) as exc:
        rc, log = 1, str(exc)

    if rc == 0 and output.is_file():
        try:
            if output.stat().st_size <= 0 or output.stat().st_size > MAX_JSON_BYTES:
                raise ValueError("JSON output is empty or exceeds the analysis size limit")
            with output.open(encoding="utf-8") as handle:
                payload = json.load(handle)
            if not isinstance(payload, dict):
                raise ValueError("JSON output is not an object")
            payload.setdefault("sample_id", str(payload.get("meta", {}).get("sample_id") or sample))
            with output.open("w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, allow_nan=False)
            if output.stat().st_size > MAX_JSON_BYTES:
                raise ValueError("JSON output exceeds the analysis size limit")
        except (OSError, ValueError, TypeError) as exc:
            rc, log = 1, f"{log}\nOutput validation failed: {exc}"
    elif rc == 0:
        rc, log = 1, f"{log}\nExpected output was not created: {output}"

    _record(spec, rc, log, runs)
    if rc:
        return False

    sections.append({
        "id": spec["renderer"],
        "title": spec["title"],
        "type": "plotly",
        "path": output.relative_to(result_root).as_posix(),
        "source": spec["script"].name,
        "order": spec["order"],
        "renderer": spec["renderer"],
    })
    return True


def _wgs_specs(root, mode, sample, generators, job_id):
    scripts = generators / "wgs" / "updates"
    def found(*patterns):
        return _first(root, *patterns)

    result = found(f"**/Combine_revised/{sample}", f"**/Combine/{sample}", f"**/Hybrid/{sample}") or root
    checkm = found("**/checkm_output/checkm.txt")
    busco = found("**/busco/**/short_summary*.txt")
    prokka = found("**/prokka/annotated_genome.tsv")
    interpro = found("**/interproscan/interproscan_results.tsv")
    kofam = found("**/kofamscan/kofamscan_results.tsv", "**/kofamscan/kofamscan_results.txt")
    dbcan = found("**/dbcan/overview.txt")
    emapper = found("**/emapper_results/annotations.emapper.annotations")
    abricate = found("**/abricate")
    repeats_out = found("**/repeatmasker/*.out")
    repeats_tbl = found("**/repeatmasker/*.tbl")
    fastqc_raw = found("**/fastqc_raw")
    fastqc_trimmed = found("**/fastqc_trimmed")

    specs = [
        ("wgs_quality_v2", "WGS_SR_Checkm_busco_json.py", "wgssr_checkmbusco_data.json", "Genome completeness", 120, [checkm, busco], [checkm, busco]),
        ("wgs_prokka_v2", "WGS_SR_Prokka_json.py", "prokka_plots_data.json", "Genome annotation", 130, [prokka], [prokka]),
        ("wgs_interpro_v2", "WGS_SR_Interproscan_json.py", "interproscan_plots_data.json", "InterPro domains", 140, [interpro], [interpro]),
        ("wgs_kofam_v2", "WGS_SR_kofam_json.py", "kofam_plots_data.json", "KEGG orthology", 150, [kofam], [kofam]),
        ("wgs_cazymes_v2", "WGS_SR_CAZymes_json.py", "cazyme_plots_data.json", "CAZyme families", 160, [dbcan], [dbcan]),
        ("wgs_cog_v2", "WGS_SR_COG_json.py", "emapper_plots_data.json", "COG functional categories", 170, [emapper], [emapper]),
        ("wgs_amr_v2", "WGS_SR_AMR_json.py", "amr_plots_data.json", "AMR and virulence hits", 180, [abricate], [abricate]),
        ("wgs_repeats_v2", "WGS_SR_Repeatmasker_json.py", "repeatmasker_plots_data.json", "Repeat landscape", 190, [repeats_out, repeats_tbl], [repeats_out, repeats_tbl]),
    ]
    result_specs = [
        {
            "renderer": renderer, "script": scripts / script, "output": output,
            "title": title, "order": order, "inputs": required, "args": args,
        }
        for renderer, script, output, title, order, required, args in specs
    ]

    if mode in {"short", "hybrid"}:
        result_specs.insert(0, {
            "renderer": "wgs_preprocessing",
            "script": scripts / "WGS_SR_Preprocessing_json.py",
            "output": "wgs_preprocessing_data.json",
            "title": "Read preprocessing",
            "order": 100,
            "inputs": [fastqc_raw, fastqc_trimmed],
            "args": [],
            "env": {"GENOCULAR_INPUT_ROOT": str(result)},
        })
    if mode in {"long", "hybrid"}:
        scratch_inputs = Path("/scratch") / job_id / "inputs" if job_id else None
        raw = found("**/*_R0.fastq", "**/*_R0.fastq.gz", "**/*raw*.fastq", "**/*raw*.fastq.gz") or _first(scratch_inputs, "*_R0.fastq*", "*raw*.fastq*", "*.fastq*")
        filtered = found("**/*_filtered.fastq", "**/*_filtered.fastq.gz")
        if raw and filtered:
            result_specs.insert(0, {
                "renderer": "wgs_lr_preprocessing",
                "script": scripts / "WGS_LR_Preprocessing_json.py",
                "output": "wgs_lr_preprocessing_data.json",
                "title": "Long-read preprocessing",
                "order": 95,
                "inputs": [raw, filtered],
                "args": [raw, filtered],
                "timeout": 1800,
            })
    return result_specs


def _meta_specs(root, mode, sample, generators):
    scripts = generators / "meta_genomics" / "updates"
    root_pattern = {"short": "**/MAG_shortread_results", "long": "**/longread_results", "hybrid": "**/hybrid_results"}[mode]
    result = _first(root, root_pattern)
    if not result:
        return []
    def found(*patterns):
        return _first(result, *patterns)

    assembly = {
        "short": found(f"assembly/{sample}_final.contigs.fa", f"assembly/megahit_{sample}/final.contigs.fa", "assembly/megahit_*/final.contigs.fa"),
        "long": found(f"medaka/{sample}/consensus.fasta", f"assembly/{sample}_flye/assembly.fasta"),
        "hybrid": found(f"operams/{sample}_nostrain/contigs.fasta", "operams/*_nostrain/contigs.fasta"),
    }[mode]
    quast = found(f"quast/{sample}/report.tsv", "quast/*/report.tsv")
    prokka = found(f"annotation/prokka/{sample}")
    dbcan = found(f"annotation/dbcan/{sample}")
    barrnap = found(f"barrnap/{sample}")
    binning = found(f"binning/{sample}")
    busco_filtered = found(f"busco_filtered/{sample}")
    busco_raw = found(f"busco/{sample}")
    metaphlan = found(f"metaphlan/{sample}_profile.txt", "metaphlan/*_profile.txt")
    viral = found(f"viral/{sample}/virsorter2")
    nonpareil = found(f"nonpareil/{sample}.npo", "nonpareil/*.npo")

    specs = [
        ("mag_assembly_v2", "MAG_assembly_contiguity_json.py", "mag_assembly_plots_data.json", "Assembly contiguity", 110, [assembly, quast], [assembly, quast]),
        ("mag_binning_v2", "MAG_binning_scatter_json.py", "mag_binning_plots_data.json", "MAG binning", 115, [binning], [binning]),
        ("mag_busco_v2", "MAG_busco_completeness_json.py", "mag_busco_plots_data.json", "MAG completeness", 120, [busco_filtered], [busco_filtered]),
        ("mag_barrnap_v2", "MAG_barrnap_rrna_json.py", "mag_barrnap_plots_data.json", "rRNA recovery", 125, [barrnap], [barrnap]),
        ("mag_prokka_v2", "MAG_prokka_feature_json.py", f"{sample}_prokka_feature_composition.json", "Prokka annotation features", 210, [prokka], [prokka]),
        ("mag_dbcan_v2", "MAG_dbcan_cazyme_json.py", "mag_dbcan_plots_data.json", "CAZyme composition", 200, [dbcan], [dbcan]),
        ("mag_hadeg_v2", "MAG_hadeg_network_json.py", "mag_hadeg_plots_data.json", "Hydrocarbon degradation network", 220, [result], [result]),
        ("mag_metaphlan_v2", "MAG_metaphlan_lollipop_json.py", "mag_metaphlan_plots_data.json", "MetaPhlAn taxonomic profile", 240, [metaphlan], [metaphlan]),
        ("mag_metaphlan_alpha_v2", "MAG_metaphlan_diversity_json.py", "mag_metaphlan_diversity_plots_data.json", "MetaPhlAn alpha diversity", 241, [metaphlan], [metaphlan]),
        ("mag_virsorter_v2", "MAG_virsorter2_json.py", "mag_virsorter2_plots_data.json", "VirSorter viral scores", 230, [viral], [viral]),
        ("mag_nonpareil_v2", "MAG_nonpareil_json.py", "mag_nonpareil_plots_data.json", "Nonpareil sequencing coverage", 260, [nonpareil], [nonpareil]),
    ]
    result_specs = [
        {
            "renderer": renderer, "script": scripts / script, "output": output,
            "title": title, "order": order, "inputs": required,
            "args": [*args, "__OUTPUT_DIR__", sample],
        }
        for renderer, script, output, title, order, required, args in specs
    ]
    if busco_raw:
        next(spec for spec in result_specs if spec["renderer"] == "mag_busco_v2")["args"].append(busco_raw)
    return result_specs


def _add_wgs_hexbin(out_root, data_dir, job_id, sample, generators_dir, sections, runs, python):
    if not job_id or not (data_dir / "wgs_preprocessing_data.json").is_file():
        return
    scratch = Path("/scratch") / job_id / "inputs"
    raw_r1 = _first(scratch, "*R1*.fastq*", "*_1.fastq*")
    raw_r2 = _first(scratch, "*R2*.fastq*", "*_2.fastq*")
    clean_r1 = _first(out_root, "**/*_R1_bbduk_cleaned.fastq*")
    clean_r2 = _first(out_root, "**/*_R2_bbduk_cleaned.fastq*")
    if not all((raw_r1, raw_r2, clean_r1, clean_r2)):
        return

    script = generators_dir / "wgs" / "updates" / "WGS_SR_quality_hexbin.py"
    image = data_dir / "PerBaseQuality_Density_WGS_SR.svg"
    image.unlink(missing_ok=True)
    try:
        result = subprocess.run(
            [python, str(script), str(raw_r1), str(raw_r2), str(clean_r1), str(clean_r2), str(image)],
            cwd=data_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=180,
        )
        rc, log = result.returncode, result.stdout
    except (OSError, subprocess.TimeoutExpired) as exc:
        rc, log = 1, str(exc)
    runs.append({"name": "wgs_sr_hexbin_v2", "rc": rc, "log": str(log)[-8000:]})
    if rc == 0 and image.is_file() and 0 < image.stat().st_size < MAX_JSON_BYTES:
        sections.append({
            "id": "wgs_sr_hexbin_v2",
            "title": "Per-base quality density",
            "type": "plotly",
            "path": (data_dir / "wgs_preprocessing_data.json").relative_to(out_root).as_posix(),
            "asset_path": image.relative_to(out_root).as_posix(),
            "source": script.name,
            "order": 105,
            "renderer": "wgs_sr_hexbin_v2",
        })


def generate_updated_assets(out_root, analysis, mode, sample, generators_dir, sections, generator_runs, python=None, job_id=""):
    if analysis not in {"wgs", "metagenomics"} or mode not in {"short", "long", "hybrid"}:
        return
    if analysis == "metagenomics":
        # Read-based alpha diversity already contains the rank-abundance view.
        sections[:] = [section for section in sections if (section.get("renderer") or section.get("id"))
                       not in {"mag_metaphlan_rank_v2", "metaphlan_rank_abundance"}]
    data_dir = out_root / "analysis" / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    specs = (
        _wgs_specs(out_root, mode, sample, generators_dir, job_id)
        if analysis == "wgs"
        else _meta_specs(out_root, mode, sample, generators_dir)
    )
    successful = set()
    for spec in specs:
        if spec.get("reuse_renderer"):
            if spec["reuse_renderer"] in successful:
                sections.append({
                    "id": spec["renderer"], "title": spec["title"], "type": "plotly",
                    "path": (data_dir / spec["output"]).relative_to(out_root).as_posix(),
                    "source": spec["script"].name, "order": spec["order"],
                    "renderer": spec["renderer"],
                })
                successful.add(spec["renderer"])
            continue
        spec["args"] = [data_dir if path == "__OUTPUT_DIR__" else path for path in spec["args"]]
        if _emit(spec, out_root, data_dir, sample, sections, generator_runs, python or sys.executable):
            successful.add(spec["renderer"])
            if spec["renderer"] == "wgs_lr_preprocessing":
                image = data_dir / "LengthQuality_Density_WGS_LR.svg"
                if image.is_file():
                    sections[-1]["asset_path"] = image.relative_to(out_root).as_posix()

    if analysis == "wgs" and mode in {"short", "hybrid"} and "wgs_preprocessing" in successful:
        _add_wgs_hexbin(out_root, data_dir, job_id, sample, generators_dir, sections, generator_runs, python or sys.executable)

    replaced = set().union(*(REPLACED_RENDERERS.get(renderer, set()) for renderer in successful))
    replaced_images = set().union(*(REPLACED_IMAGE_SOURCES.get(renderer, set()) for renderer in successful))
    if replaced or replaced_images:
        sections[:] = [
            section for section in sections
            if section.get("renderer") not in replaced
            and not (section.get("type") == "image" and section.get("source") in replaced_images)
        ]
