# /app/status_writer.py
import os, sys, json, pathlib, mimetypes, boto3, time
from botocore.config import Config
from urllib.parse import urlparse
from datetime import datetime

MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "http://minio:9000")
MINIO_ACCESS   = os.getenv("MINIO_ACCESS_KEY") or os.getenv("MINIO_ROOT_USER", "")
MINIO_SECRET   = os.getenv("MINIO_SECRET_KEY") or os.getenv("MINIO_ROOT_PASSWORD", "")
RAW_BUCKET     = os.getenv("RAW_BUCKET","raw")
RESULTS_BUCKET = os.getenv("RESULTS_BUCKET","results")
LOGS_BUCKET    = os.getenv("LOGS_BUCKET","logs")
RUNNER_WEBHOOK_TOKEN = os.getenv("RUNNER_WEBHOOK_TOKEN", "")

s3 = boto3.client(
    "s3",
    endpoint_url=MINIO_ENDPOINT,
    aws_access_key_id=MINIO_ACCESS,
    aws_secret_access_key=MINIO_SECRET,
    config=Config(signature_version="s3v4", s3={"addressing_style":"path"}),
    region_name="us-east-1",
)

# ------------------------
# existing helpers
# ------------------------
def _s3_parse(s3url: str):
    # accepts s3://bucket/key  or raw/results/logs buckets by env
    if s3url.startswith("s3://"):
        u = urlparse(s3url)
        return u.netloc, u.path.lstrip("/")
    # fallback: treat as raw bucket key
    return RAW_BUCKET, s3url.lstrip("/")

def write_status(payload: dict):
    job_id = os.getenv("JOB_ID") or payload.get("job_id")
    if not job_id:
        return
    key = f"{job_id}/status.json"
    body = json.dumps(payload).encode("utf-8")
    s3.put_object(Bucket=LOGS_BUCKET, Key=key, Body=body, ContentType="application/json")
    
    try:
        import urllib.request
        req = urllib.request.Request(
            f"http://api:8000/jobs/{job_id}/sync",
            method="POST",
            headers={"X-Runner-Token": RUNNER_WEBHOOK_TOKEN},
        )
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass

def cmd_upload_log(job_id: str, path: str):
    key = f"{job_id}/snakemake.log"
    with open(path, "rb") as f:
        s3.put_object(Bucket=LOGS_BUCKET, Key=key, Body=f, ContentType="text/plain; charset=utf-8")

def cmd_download(s3url: str, dest: str):
    b, k = _s3_parse(s3url)
    pathlib.Path(dest).parent.mkdir(parents=True, exist_ok=True)
    s3.download_file(b, k, dest)

def cmd_upload_tree(kind: str, job_id: str, root: str):
    bucket = RESULTS_BUCKET if kind == "results" else LOGS_BUCKET
    rootp = pathlib.Path(root)
    if not rootp.exists():
        return
    for p in rootp.rglob("*"):
        if p.is_file():
            rel = p.relative_to(rootp)
            key = f"{job_id}/{rel.as_posix()}"
            ctype, _ = mimetypes.guess_type(p.name)
            with open(p, "rb") as f:
                s3.put_object(Bucket=bucket, Key=key, Body=f, ContentType=ctype or "application/octet-stream")

# ------------------------
# Step timeline helpers
# ------------------------
LEGACY_TOOL_ORDER = [
    "trimmomatic",
    "cutadapt_paired",
    "seqtk_trim",
    "bbduk",
    "kraken_classify",
    "kraken_extract",
    "spades",
    "prodigal",
    "prokka",
    "repeatmasker",
    "abricate",
    "kofamscan",
    "dbcan",
    "interproscan",
    "quast",
    "busco",
    "prepare_checkm_input",
    "checkm",
    "crispr",
    "antismash",
    "final_report",
    "analysis_plots",
    "manifest",
]

WGS_SHORT_TOOL_ORDER = [
    "fastqc_raw",
    "trimmomatic",
    "cutadapt_paired",
    "seqtk_trim",
    "bbduk",
    "fastqc_trimmed",
    "kraken_classify",
    "kraken_extract_reads",
    "spades",
    "prokka",
    "repeatmasker",
    "interproscan",
    "quast",
    "busco",
    "checkm",
    "prodigal",
    "abricate",
    "kofamscan",
    "dbcan",
    "eggnog_mapper",
    "cctyper",
    "antismash",
    "hadeg",
    "barrnap_16s",
    "blast_16s",
    "fastani",
    "final_report",
    "analysis_plots",
]

WGS_LONG_TOOL_ORDER = [
    "nanoplot",
    "pipeline_decision",
    "adaptive_filter",
    "kraken_classify",
    "kraken_extract",
    "flye",
    "racon_round1",
    "racon_round2",
    "finalize_assembly",
    "quast",
    "busco",
    "checkm",
    "barrnap_16s",
    "blast_16s",
    "fastani",
    "prokka",
    "prodigal",
    "interproscan",
    "kofamscan",
    "dbcan",
    "eggnog_mapper",
    "abricate",
    "cctyper",
    "antismash",
    "repeatmasker",
    "hadeg",
    "final_report",
    "analysis_plots",
]

WGS_HYBRID_TOOL_ORDER = [
    "fastqc_raw",
    "trimmomatic",
    "cutadapt",
    "seqtk",
    "bbduk",
    "fastqc_trimmed",
    "kraken_classify_short",
    "kraken_extract_short",
    "nanoplot",
    "pipeline_decision",
    "adaptive_filter",
    "kraken_classify_long",
    "kraken_extract_long",
    "unicycler",
    "quast",
    "busco",
    "checkm",
    "prokka",
    "prodigal",
    "interproscan",
    "kofamscan",
    "dbcan",
    "eggnog_mapper",
    "abricate",
    "cctyper",
    "antismash",
    "repeatmasker",
    "hadeg",
    "barrnap_16s",
    "blast_16s",
    "fastani",
    "final_report",
    "analysis_plots",
]

META_SHORT_TOOL_ORDER = [
    "fastqc_raw",
    "fastp",
    "fastqc_clean",
    "nonpareil",
    "kraken2",
    "bracken",
    "kneaddata",
    "metaphlan",
    "megahit",
    "quast",
    "virsorter2",
    "prodigal_assembly",
    "cdhit_genes",
    "salmon_index",
    "salmon_quant",
    "bowtie2_index",
    "bowtie2_map",
    "depth",
    "metabat2",
    "maxbin2",
    "semibin2",
    "contig2bin_tables",
    "dastool",
    "select_dastool_bins",
    "checkm2",
    "busco",
    "quast_per_mag",
    "quast_per_mag_all",
    "merge_mag_qc",
    "mag_filter",
    "gunc",
    "gtdbtk",
    "drep",
    "coverm",
    "barrnap_per_mag",
    "barrnap_all",
    "prokka",
    "prokka_all",
    "cctyper_per_mag",
    "cctyper_all",
    "dbcan_per_mag",
    "dbcan_all",
    "abricate",
    "abricate_summary",
    "abricate_all",
    "hadeg_proteinortho",
    "busco_filtered_per_mag",
    "busco_filtered_all",
    "multiqc",
    "analysis_plots",
]

META_LONG_TOOL_ORDER = [
    "nanostat_raw",
    "nanoq_adaptive",
    "nanostat_filtered",
    "host_removal",
    "flye_assembly",
    "medaka_polish",
    "quast",
    "virsorter2",
    "prodigal_assembly",
    "cdhit_proteins",
    "minimap2_gene_map",
    "featurecounts_gene_quant",
    "minimap2_map",
    "depth",
    "filter_contigs_by_depth",
    "minimap2_map_filtered",
    "depth_filtered",
    "metabat_depth",
    "metabat2",
    "semibin2",
    "metabat2_to_contig2bin",
    "semibin2_to_contig2bin",
    "dastool",
    "select_dastool_bins",
    "checkm2",
    "busco",
    "quast_per_mag",
    "quast_per_mag_all",
    "merge_mag_qc",
    "mag_filter",
    "drep",
    "gtdbtk",
    "barrnap_per_mag",
    "barrnap_all",
    "prokka",
    "prokka_all",
    "cctyper_per_mag",
    "cctyper_all",
    "dbcan_per_mag",
    "dbcan_all",
    "abricate",
    "abricate_summary",
    "abricate_all",
    "hadeg_proteinortho",
    "coverm",
    "multiqc_collect",
    "multiqc",
    "analysis_plots",
]

META_HYBRID_TOOL_ORDER = [
    "fastp",
    "kneaddata",
    "kraken2",
    "bracken",
    "nanostat_raw",
    "nanoq_adaptive",
    "nanostat_filtered",
    "host_removal_lr",
    "megahit_assembly",
    "operams_assembly",
    "quast",
    "virsorter2",
    "prodigal_assembly",
    "cdhit_proteins",
    "bowtie2_gene_map",
    "featurecounts_gene_quant",
    "bowtie2_index",
    "bowtie2_map",
    "minimap2_map",
    "merge_bams",
    "depth",
    "metabat2",
    "semibin2",
    "metabat2_to_contig2bin",
    "semibin2_to_contig2bin",
    "dastool",
    "select_dastool_bins",
    "checkm2",
    "busco",
    "quast_per_mag",
    "quast_per_mag_all",
    "merge_mag_qc",
    "mag_filter",
    "gtdbtk",
    "drep",
    "coverm",
    "barrnap_per_mag",
    "barrnap_all",
    "prokka",
    "prokka_all",
    "cctyper_per_mag",
    "cctyper_all",
    "dbcan_per_mag",
    "dbcan_all",
    "abricate",
    "abricate_summary",
    "abricate_all",
    "hadeg_proteinortho",
    "busco_filtered_per_mag",
    "busco_filtered_all",
    "multiqc_collect",
    "multiqc",
    "analysis_plots",
]

PROFILE_TOOL_ORDERS = {
    "wgs:short": WGS_SHORT_TOOL_ORDER,
    "wgs:long": WGS_LONG_TOOL_ORDER,
    "wgs:hybrid": WGS_HYBRID_TOOL_ORDER,
    "metagenomics:short": META_SHORT_TOOL_ORDER,
    "metagenomics:long": META_LONG_TOOL_ORDER,
    "metagenomics:hybrid": META_HYBRID_TOOL_ORDER,
}

FRIENDLY_NAMES = {
    "fastqc_raw": "FastQC (Raw)",
    "fastqc_clean": "FastQC (Clean)",
    "fastqc_trimmed": "FastQC (Trimmed)",
    "nonpareil": "Nonpareil",
    "trimmomatic": "Trimmomatic",
    "cutadapt_paired": "Cutadapt",
    "cutadapt": "Cutadapt",
    "seqtk_trim": "Seqtk",
    "seqtk": "Seqtk",
    "bbduk": "BBDuk",
    "kraken_classify": "Kraken2 Classify",
    "kraken_extract": "Kraken2 Extract",
    "kraken_extract_reads": "Kraken2 Extract",
    "kraken_classify_short": "Kraken2 Classify (Short)",
    "kraken_extract_short": "Kraken2 Extract (Short)",
    "kraken_classify_long": "Kraken2 Classify (Long)",
    "kraken_extract_long": "Kraken2 Extract (Long)",
    "spades": "SPAdes",
    "flye": "Flye",
    "racon_round1": "Racon Round 1",
    "racon_round2": "Racon Round 2",
    "finalize_assembly": "Finalize Assembly",
    "unicycler": "Unicycler",
    "nanoplot": "NanoPlot",
    "pipeline_decision": "Adaptive Decision",
    "adaptive_filter": "Adaptive Filter",
    "pipeline_setup": "Pipeline Setup",
    "prodigal": "Prodigal",
    "prokka": "Prokka",
    "repeatmasker": "RepeatMasker",
    "abricate": "ABRicate",
    "kofamscan": "KofamScan",
    "dbcan": "dbCAN",
    "eggnog_mapper": "eggNOG-mapper",
    "interproscan": "InterProScan",
    "quast": "QUAST",
    "busco": "BUSCO",
    "prepare_checkm_input": "Prep CheckM",
    "checkm": "CheckM",
    "cctyper": "CCTyper",
    "crispr": "CRISPRCasFinder",
    "antismash": "antiSMASH",
    "hadeg": "HADEG",
    "barrnap_16s": "Barrnap 16S",
    "blast_16s": "BLAST 16S",
    "fastani": "FastANI",
    "final_report": "Final Report",
    "analysis_plots": "Analysis Plots",
    "manifest": "Manifest",
    "fastp": "fastp",
    "kneaddata": "KneadData",
    "metaphlan": "MetaPhlAn",
    "kraken2": "Kraken2",
    "bracken": "Bracken",
    "megahit": "MEGAHIT",
    "megahit_assembly": "MEGAHIT",
    "operams_assembly": "OPERA-MS",
    "nanostat_raw": "NanoStat (Raw)",
    "nanoq_adaptive": "nanoq",
    "nanostat_filtered": "NanoStat (Filtered)",
    "host_removal": "Host Removal",
    "host_removal_lr": "Long-read Host Removal",
    "flye_assembly": "metaFlye",
    "medaka_polish": "Medaka",
    "bowtie2_index": "Bowtie2 Index",
    "bowtie2_map": "Bowtie2 Mapping",
    "minimap2_map": "Minimap2 Mapping",
    "merge_bams": "Merge BAMs",
    "depth": "Depth Summary",
    "filter_contigs_by_depth": "Depth Filter",
    "minimap2_map_filtered": "Minimap2 Filtered Mapping",
    "depth_filtered": "Filtered Depth Summary",
    "metabat_depth": "MetaBAT Depth",
    "metabat2": "MetaBAT2",
    "maxbin2": "MaxBin2",
    "semibin2": "SemiBin2",
    "virsorter2": "VirSorter2",
    "gunc": "GUNC",
    "contig2bin_tables": "Contig-to-bin Tables",
    "metabat2_to_contig2bin": "MetaBAT2 Contig Map",
    "semibin2_to_contig2bin": "SemiBin2 Contig Map",
    "dastool": "DAS Tool",
    "select_dastool_bins": "Select MAGs",
    "checkm2": "CheckM2",
    "quast_per_mag": "MetaQUAST per MAG",
    "quast_per_mag_all": "MetaQUAST MAG Summary",
    "merge_mag_qc": "Merge MAG QC",
    "mag_filter": "MAG Filter",
    "gtdbtk": "GTDB-Tk",
    "drep": "dRep",
    "coverm": "CoverM",
    "barrnap_per_mag": "Barrnap per MAG",
    "barrnap_all": "Barrnap Summary",
    "prokka_all": "Prokka Summary",
    "cctyper_per_mag": "CCTyper per MAG",
    "cctyper_all": "CCTyper Summary",
    "dbcan_per_mag": "dbCAN per MAG",
    "dbcan_all": "dbCAN Summary",
    "abricate_summary": "ABRicate Summary",
    "abricate_all": "ABRicate Complete",
    "hadeg_proteinortho": "HADEG Proteinortho",
    "busco_filtered_per_mag": "BUSCO Filtered MAG",
    "busco_filtered_all": "BUSCO Filtered Summary",
    "prodigal_assembly": "Prodigal Assembly",
    "cdhit_genes": "CD-HIT Genes",
    "cdhit_proteins": "CD-HIT Proteins",
    "salmon_index": "Salmon Index",
    "salmon_quant": "Salmon Quant",
    "minimap2_gene_map": "Minimap2 Gene Mapping",
    "bowtie2_gene_map": "Bowtie2 Gene Mapping",
    "featurecounts_gene_quant": "featureCounts",
    "multiqc_collect": "MultiQC Collect",
    "multiqc": "MultiQC",
}

def _now_iso():
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"

def _steps_key(job_id: str) -> str:
    return f"{job_id}/steps.json"

def _tool_order_for(profile: str) -> list[str]:
    p = (profile or "").strip().lower()
    if p in PROFILE_TOOL_ORDERS:
        return PROFILE_TOOL_ORDERS[p]
    return LEGACY_TOOL_ORDER

def _steps_skeleton(profile: str = "") -> dict:
    tool_order = _tool_order_for(profile)
    return {
        "profile": profile or "legacy",
        "state": "queued",
        "message": "",
        "completed": 0,
        "total": len(tool_order),
        "steps": [
            {
                "key": k,
                "name": FRIENDLY_NAMES.get(k, k),
                "status": "queued",
                "outputs": []
            }
            for k in tool_order
        ],
    }

def _steps_align_to_profile(doc: dict) -> dict:
    profile = (doc.get("profile") or "").strip().lower()
    if profile not in PROFILE_TOOL_ORDERS:
        return doc

    desired = _tool_order_for(profile)
    existing_steps = doc.get("steps") if isinstance(doc.get("steps"), list) else []
    existing_by_key = {
        s.get("key"): s
        for s in existing_steps
        if isinstance(s, dict) and s.get("key")
    }

    aligned = []
    for key in desired:
        step = existing_by_key.pop(key, None) or {
            "key": key,
            "name": FRIENDLY_NAMES.get(key, key),
            "status": "queued",
            "outputs": [],
        }
        step.setdefault("name", FRIENDLY_NAMES.get(key, key))
        step.setdefault("status", "queued")
        step.setdefault("outputs", [])
        aligned.append(step)

    aligned.extend(existing_by_key.values())
    doc["steps"] = aligned
    doc["total"] = len(aligned)
    return doc

def _steps_load(job_id: str) -> dict:
    """Load steps.json from LOGS_BUCKET; return skeleton if missing/invalid."""
    key = _steps_key(job_id)
    try:
        obj = s3.get_object(Bucket=LOGS_BUCKET, Key=key)
        return _steps_align_to_profile(json.loads(obj["Body"].read()))
    except Exception:
        return _steps_skeleton("legacy")

def _steps_write(job_id: str, payload: dict):
    s3.put_object(
        Bucket=LOGS_BUCKET,
        Key=_steps_key(job_id),
        Body=json.dumps(payload).encode("utf-8"),
        ContentType="application/json",
    )

def _steps_set_state(doc: dict):
    done = sum(1 for s in doc["steps"] if s.get("status") in ("done","skipped"))
    doc["completed"] = done
    doc["total"] = len(doc["steps"])
    if any(s.get("status") == "failed" for s in doc["steps"]):
        doc["state"] = "failed"
    elif done == len(doc["steps"]):
        doc["state"] = "done"
    elif any(s.get("status") == "running" for s in doc["steps"]):
        doc["state"] = "running"
    else:
        doc["state"] = "queued"

def _steps_upsert(doc: dict, key: str) -> dict:
    for s in doc["steps"]:
        if s["key"] == key:
            return s
    s = {"key": key, "name": FRIENDLY_NAMES.get(key, key), "status": "queued", "outputs": []}
    doc["steps"].append(s)
    doc["total"] = len(doc["steps"])
    return s

def cmd_steps_init(job_id: str, message: str = "Pipeline starting", profile: str = ""):
    d = _steps_skeleton(profile)
    d["state"] = "running"
    d["message"] = message
    d["completed"] = 0
    d["total"] = len(d["steps"])
    _steps_write(job_id, d)

def cmd_steps_event(action: str, job_id: str, step_key: str, summary: str = "", msg: str = ""):
    d = _steps_load(job_id)
    s = _steps_upsert(d, step_key)

    if action == "start":
        s["status"]    = "running"
        s["startedAt"] = _now_iso()
        s["progress"] = {"percent": 0, "message": summary or f"{step_key} running", "updatedAt": s["startedAt"]}
        if summary: s["summary"] = summary
        if msg:      d["message"] = msg
    elif action == "done":
        s["status"]  = "done"
        s["endedAt"] = _now_iso()
        s["progress"] = {"percent": 100, "message": summary or f"{step_key} finished", "updatedAt": s["endedAt"]}
        if summary: s["summary"] = summary
    elif action == "fail":
        s["status"]  = "failed"
        s["endedAt"] = _now_iso()
        progress = s.get("progress") if isinstance(s.get("progress"), dict) else {}
        progress.update({"message": msg or summary or f"{step_key} failed", "updatedAt": s["endedAt"]})
        s["progress"] = progress
        if summary: s["summary"] = summary
        d["message"] = msg or f"{step_key} failed"
    elif action == "skip":
        s["status"]  = "skipped"
        s["endedAt"] = _now_iso()
        s["progress"] = {"message": summary or f"{step_key} skipped", "updatedAt": s["endedAt"]}
        if summary: s["summary"] = summary
    elif action == "progress":
        if s.get("status") in {"done", "failed", "skipped", "cancelled", "canceled"}:
            _steps_set_state(d)
            _steps_write(job_id, d)
            return
        progress = s.get("progress") if isinstance(s.get("progress"), dict) else {}
        if summary:
            progress["message"] = summary
        if msg:
            try:
                percent = float(msg)
                if 0 <= percent <= 100:
                    progress["percent"] = round(percent, 1)
            except Exception:
                progress["detail"] = msg
        progress["updatedAt"] = _now_iso()
        s["progress"] = progress
        if s.get("status") == "queued":
            s["status"] = "running"
    elif action == "message":
        d["message"] = msg or summary
    else:
        print(f"unknown steps action: {action}", file=sys.stderr)
        sys.exit(2)

    _steps_set_state(d)
    _steps_write(job_id, d)

def cmd_finalize_steps(job_id: str):
    d = _steps_load(job_id)
    now = _now_iso()
    steps = d.get("steps") if isinstance(d.get("steps"), list) else []
    for s in steps:
        if not isinstance(s, dict):
            continue
        if s.get("status") == "running":
            s["status"] = "done"
            s["endedAt"] = s.get("endedAt") or now
            summary = s.get("summary") or f"{s.get('key', 'step')} finished"
            s["summary"] = summary
            s["progress"] = {
                "percent": 100,
                "message": summary,
                "updatedAt": now,
            }
    _steps_set_state(d)
    if d.get("state") == "done":
        d["message"] = "Pipeline completed; finalizing results"
    else:
        d["message"] = "Finalizing results"
    d["finalizingAt"] = now
    _steps_write(job_id, d)

# ------------------------
# CLI
# ------------------------
def _parse_steps_args(rest):
    """
    Parse:
      steps-init <job_id> [message...]
      steps-init <job_id> --profile <analysis:mode> [message...]
      steps <action> <job_id> <step_key> [summary words ...] [--msg MESSAGE...]
    """
    if not rest:
        print("usage:\n  status_writer.py steps-init <job_id> [message]\n"
              "  status_writer.py steps <start|done|fail|skip|progress|message> <job_id> <step_key> [summary] [--msg TEXT]",
              file=sys.stderr)
        sys.exit(2)

    sub = rest[0]

    if sub == "steps-init":
        if len(rest) < 2:
            print("usage: status_writer.py steps-init <job_id> [message]", file=sys.stderr)
            sys.exit(2)
        job_id = rest[1]
        profile = ""
        msg_parts = []
        i = 2
        while i < len(rest):
            if rest[i] == "--profile":
                if i + 1 >= len(rest):
                    print("usage: status_writer.py steps-init <job_id> [--profile analysis:mode] [message]", file=sys.stderr)
                    sys.exit(2)
                profile = rest[i + 1]
                i += 2
                continue
            msg_parts.append(rest[i])
            i += 1
        message = " ".join(msg_parts) if msg_parts else "Pipeline starting"
        cmd_steps_init(job_id, message, profile=profile)
        return True

    if sub == "steps":
        if len(rest) < 4:
            print("usage: status_writer.py steps <action> <job_id> <step_key> [summary] [--msg TEXT]", file=sys.stderr)
            sys.exit(2)
        action  = rest[1]
        job_id  = rest[2]
        step    = rest[3]

        # parse optional [summary words ...] and optional --msg
        summary_parts = []
        msg = ""
        i = 4
        while i < len(rest):
            if rest[i] == "--msg":
                msg = " ".join(rest[i+1:]) if i+1 < len(rest) else ""
                break
            summary_parts.append(rest[i])
            i += 1
        summary = " ".join(summary_parts).strip()

        cmd_steps_event(action, job_id, step, summary, msg)
        return True

    if sub == "finalize-steps":
        if len(rest) != 2:
            print("usage: status_writer.py finalize-steps <job_id>", file=sys.stderr)
            sys.exit(2)
        cmd_finalize_steps(rest[1])
        return True

    return False

def main():
    args = sys.argv
    if len(args) == 1:
        # read JSON from stdin and write status.json
        payload = json.load(sys.stdin)
        write_status(payload)
        return

    # NEW: handle step timeline commands first
    if _parse_steps_args(args[1:]):
        return

    # legacy/other commands
    cmd = args[1]
    if cmd == "upload-log":
        if len(args) != 4:
            print("usage: status_writer.py upload-log <job_id> <path>", file=sys.stderr)
            sys.exit(2)
        _, _, job_id, path = args
        cmd_upload_log(job_id, path)

    elif cmd == "upload-tree":
        if len(args) != 5:
            print("usage: status_writer.py upload-tree <results|logs> <job_id> <root>", file=sys.stderr)
            sys.exit(2)
        _, _, kind, job_id, root = args
        cmd_upload_tree(kind, job_id, root)

    elif cmd == "download":
        if len(args) != 4:
            print("usage: status_writer.py download <s3url> <dest>", file=sys.stderr)
            sys.exit(2)
        _, _, s3url, dest = args
        cmd_download(s3url, dest)

    else:
        print(f"unknown command: {cmd}", file=sys.stderr)
        sys.exit(2)

if __name__ == "__main__":
    main()
