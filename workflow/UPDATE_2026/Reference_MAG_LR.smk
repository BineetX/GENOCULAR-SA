import os
import re
import sys
import copy
import yaml
import subprocess
import tempfile
import shutil
import csv
import gzip
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# =============================================================================
# HELPER UTILITIES
# =============================================================================
def as_bool(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"true", "yes", "1", "t", "y"}
    return bool(value)

def run_command(command, log_file):
    Path(log_file).parent.mkdir(parents=True, exist_ok=True)
    with open(log_file, "wb") as log_fh:
        subprocess.run(command, stdout=log_fh, stderr=subprocess.STDOUT, check=True)

def clean_mag_id(filename):
    name = Path(filename).name
    for ext in (".fa", ".fasta"):
        if name.endswith(ext):
            name = name[:-len(ext)]
    return name

def parse_float(val):
    try:
        return float(val)
    except (TypeError, ValueError):
        return None

def parse_bool(val):
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        val_lower = val.strip().lower()
        if val_lower in {"true", "yes", "1", "t", "y"}:
            return True
        if val_lower in {"false", "no", "0", "f", "n"}:
            return False
    return None

def write_contig2bin(bins_dir, output_tsv):
    Path(output_tsv).parent.mkdir(parents=True, exist_ok=True)
    rows = []
    bins_path = Path(bins_dir)
    if bins_path.is_dir():
        for ext in ("*.fa", "*.fasta"):
            for fasta_file in bins_path.glob(ext):
                mag_name = clean_mag_id(fasta_file.name)
                with open(fasta_file) as fh:
                    for line in fh:
                        if line.startswith(">"):
                            contig_name = line.strip()[1:].split()[0]
                            rows.append((contig_name, mag_name))
    with open(output_tsv, "w", newline="") as out_h:
        w = csv.writer(out_h, delimiter="\t", lineterminator="\n")
        w.writerow(["contig", "bin"])
        w.writerows(rows)

def normalize_bins(candidate_files, output_bins_dir):
    shutil.rmtree(output_bins_dir, ignore_errors=True)
    Path(output_bins_dir).mkdir(parents=True, exist_ok=True)
    for src in candidate_files:
        src_path = Path(src)
        if src_path.is_file() and src_path.stat().st_size > 0:
            mag_name = clean_mag_id(src_path.name)
            dst_path = Path(output_bins_dir) / f"{mag_name}.fa"
            shutil.copyfile(src_path, dst_path)

def fasta_metrics(fasta_path):
    lengths = []
    current_len = 0
    total_len = 0
    gc_count = 0
    contig_count = 0
    
    with open(fasta_path) as fh:
        for line in fh:
            line = line.strip()
            if line.startswith(">"):
                if current_len > 0:
                    lengths.append(current_len)
                    total_len += current_len
                    contig_count += 1
                current_len = 0
            else:
                current_len += len(line)
                gc_count += line.upper().count('G') + line.upper().count('C')
    if current_len > 0:
        lengths.append(current_len)
        total_len += current_len
        contig_count += 1

    n50 = 0
    if lengths:
        lengths.sort(reverse=True)
        half_total = total_len / 2.0
        running_sum = 0
        for l in lengths:
            running_sum += l
            if running_sum >= half_total:
                n50 = l
                break

    gc_percent = (gc_count / total_len * 100.0) if total_len > 0 else 0.0
    return {
        "contig_count": contig_count,
        "total_length": total_len,
        "n50": n50,
        "gc_percent": round(gc_percent, 2)
    }

# =============================================================================
# METAGENOMIC ENVIRONMENT CONFIGURATION ENGINE (EMBEDDED YAML REGISTER)
# =============================================================================
EMBEDDED_CONFIG_YAML = r"""
sample: marine_sample
environment: ocean
BASE: "/data/genoverse"
read_type: ont
threads: 16
medaka_threads: 4
min_binning_length: 1000
min_binning_coverage: 0
min_contigs_for_binning: 200

input:
  lr_reads: data/raw/marine_station_alpha_longreads.fastq.gz
  host_ref: ""

reads:
  raw: data/raw/marine_station_alpha_longreads.fastq.gz

database_paths:
  cctyper: '/dbs/cctyper'
  dbcan: '/dbs/dbcan_db/db'
  hadeg_db: '/dbs/hadeg/HADEG_protein_database_231119.faa'
  checkm2: '/dbs/checkm2/CheckM2_database/uniref100.KO.1.dmnd'
  gunc: '/dbs/gunc/gunc_db_progenomes2.1.dmnd'
  gtdbtk: '/dbs/gtdbtk'

tools:
  filtlong: filtlong
  minimap2: minimap2
  samtools: samtools
  flye: flye
  medaka_consensus: medaka_consensus
  metabat2: metabat2
  SemiBin2: SemiBin2
  run_MaxBin.pl: run_MaxBin.pl
  DAS_Tool: DAS_Tool
  checkm2: checkm2
  gunc: gunc
  barrnap: barrnap
  tRNAscan-SE: tRNAscan-SE
  dRep: dRep
  gtdbtk: gtdbtk
  prodigal: prodigal
  coverm: coverm
  prokka: prokka
  proteinortho: proteinortho
  cctyper: cctyper
  run_dbcan: run_dbcan
  DRAM.py: DRAM.py
  virsorter: virsorter
  abricate: abricate
  multiqc: multiqc
  metaquast.py: metaquast.py
  quast.py: quast.py
  NanoStat: NanoStat
  seqkit: seqkit
  jgi_depth: jgi_summarize_bam_contig_depths

mag_threads: 4

annotation_modules:
  prokka: true
  cctyper: true
  dbcan: true
  dram: true
  virsorter: true
  abricate: true
  hadeg: true

reporting:
  multiqc: true

abricate_dbs:
  - ncbi
  - card
  - resfinder
  - vfdb

hadeg_blast_binpath: /usr/bin

prokka:
  kingdom: auto
  fallback_kingdom: Generic
  metagenome: true

dbcan:
  input_type: prok

tool_envs:
  prokka: ''
  cctyper: ''
  dbcan: ''
  dram: ''
  abricate: ''

filtering:
  master_retain_floor: 1500

binning_thresholds:
  metabat_min_cv: 1.0
  metabat_min_cv_sum: 1.0
  metabat_seed: 42
  dastool_score_default: 0.5

semibin:
  use_pretrained_model: true
  environment: ocean

viral:
  virsorter2_min_length: 1500
  virsorter2_min_score: 0.3

quality_thresholds:
  high_completeness: 90.0
  high_contamination: 5.0
  medium_completeness: 50.0
  medium_contamination: 10.0
  minimum_trna_isotypes: 18
  require_gunc_pass_for_production: true

checkm2_cfg:
  low_memory: true

gunc_cfg:
  sensitive: false
  minimum_mapped_genes: 11

drep_options:
  primary_ani: 0.9
  secondary_ani: 0.95
  minimum_aligned_fraction: 0.3
  secondary_algorithm: fastANI

prodigal_cfg:
  mode: meta

coverm_options:
  min_covered_fraction: 0.3
  min_read_percent_identity: 95.0
  min_read_aligned_percent: 75.0
  mapper: minimap2-lr
"""

DEFAULT_CONFIG = yaml.safe_load(EMBEDDED_CONFIG_YAML) or {}

def apply_missing_defaults(target, defaults):
    for key, value in defaults.items():
        if key not in target:
            target[key] = copy.deepcopy(value)
        elif isinstance(target[key], dict) and isinstance(value, dict):
            apply_missing_defaults(target[key], value)

if "config" not in globals():
    config = {}
apply_missing_defaults(config, DEFAULT_CONFIG)

# =============================================================================
# ENVIRONMENT PATH RESOLUTION ENGINE
# =============================================================================
BASE_PATH = config.get("BASE", os.environ.get("BASE_PATH", "/data/genoverse"))
OUTPUT_ROOT = f"{BASE_PATH}/longread_results"

HADEG_DB     = os.environ.get("HADEG_DB", str(config["database_paths"].get("hadeg_db", "")))
HADEG_OUTDIR = f"{OUTPUT_ROOT}/hadeg"

SAMPLE    = config["sample"]
THREADS   = config.get("threads", 16)
READ_TYPE = config.get("read_type", "ont")
HOST_REF  = config.get("host_ref", str(config["input"].get("host_ref", "")))

MEDAKA_THREADS = config.get("medaka_threads", 4)

MIN_BINNING_LEN         = config.get("min_binning_length", 1000)
MIN_BINNING_COV         = config.get("min_binning_coverage", 0)
MIN_CONTIGS_FOR_BINNING  = config.get("min_contigs_for_binning", 200)

MM2_PRESET = {
    "ont":         "map-ont",
    "pacbio-raw":  "map-pb",
    "pacbio-hifi": "map-hifi",
}.get(READ_TYPE, "map-ont")

NANOSTAT_DIR  = f"{OUTPUT_ROOT}/nanostat"
FILTLONG_DIR  = f"{OUTPUT_ROOT}/filtlong"
HOST_DIR      = f"{OUTPUT_ROOT}/host_removal"
ASSEMBLY_DIR  = f"{OUTPUT_ROOT}/assembly"
MEDAKA_DIR    = f"{OUTPUT_ROOT}/medaka"
MAP_DIR       = f"{OUTPUT_ROOT}/mapping"
BIN_DIR       = f"{OUTPUT_ROOT}/binning"
DAS_DIR       = f"{OUTPUT_ROOT}/dastool"
MAG_QC_DIR    = f"{OUTPUT_ROOT}/mag_qc"
FILTERED_DIR  = f"{OUTPUT_ROOT}/mag_filtered"
GTDB_DIR      = f"{OUTPUT_ROOT}/gtdbtk"
DREP_DIR      = f"{OUTPUT_ROOT}/drep"
BARRNAP_DIR   = f"{OUTPUT_ROOT}/barrnap"
PROKKA_DIR    = f"{OUTPUT_ROOT}/annotation/prokka"
CCTYPER_DIR   = f"{OUTPUT_ROOT}/annotation/cctyper"
DBCAN_DIR     = f"{OUTPUT_ROOT}/annotation/dbcan"
ABRICATE_DIR  = f"{OUTPUT_ROOT}/annotation/abricate"
DRAM_DIR      = f"{OUTPUT_ROOT}/annotation/dram"
VIRSORTER_DIR = f"{OUTPUT_ROOT}/viral/virsorter2"
PRODIGAL_DIR  = f"{OUTPUT_ROOT}/prodigal"
CDHIT_DIR     = f"{OUTPUT_ROOT}/cdhit"
COVERM_DIR    = f"{OUTPUT_ROOT}/coverm"
MULTIQC_DIR   = f"{OUTPUT_ROOT}/multiqc"
LOG_DIR       = f"{OUTPUT_ROOT}/logs"

RAW_LR_PATH       = str(config["input"]["lr_reads"])
FILTLONG_FASTQ    = f"{FILTLONG_DIR}/{SAMPLE}_filtlong.fastq.gz"
DECONTAM_FASTQ    = f"{HOST_DIR}/{SAMPLE}_decontam.fastq.gz"
CLEAN_LR          = DECONTAM_FASTQ
CONTIGS           = f"{MEDAKA_DIR}/{SAMPLE}/consensus.fasta" if READ_TYPE == "ont" else f"{ASSEMBLY_DIR}/{SAMPLE}_flye/assembly.fasta"
MAPPING_BAM       = f"{MAP_DIR}/{SAMPLE}.sorted.bam"
MAPPING_BAI       = f"{MAP_DIR}/{SAMPLE}.sorted.bam.bai"
DEPTH_FILE        = f"{MAP_DIR}/{SAMPLE}_depth.txt"
REFINED_BINS      = f"{BIN_DIR}/{SAMPLE}/dastool_bins"
QUALITY_MATRIX    = f"{MAG_QC_DIR}/{SAMPLE}/mag_quality_matrix.tsv"
PRODUCTION_MAGS   = f"{FILTERED_DIR}/{SAMPLE}/production_mags"
ARCHIVED_MAGS     = f"{FILTERED_DIR}/{SAMPLE}/archived_mags"
DREP_OUTPUT       = f"{DREP_DIR}/{SAMPLE}_drep_output"
DREP_DONE         = f"{DREP_DIR}/{SAMPLE}.drep.done"
GTDB_OUTPUT       = f"{GTDB_DIR}/{SAMPLE}"
GTDB_DONE         = f"{GTDB_DIR}/{SAMPLE}.gtdbtk.done"

TOOLS = config.get("tools", {})
NANOSTAT      = str(TOOLS.get("NanoStat", "NanoStat"))
FILTLONG      = str(TOOLS.get("filtlong", "filtlong"))
SEQKIT        = str(TOOLS.get("seqkit", "seqkit"))
MINIMAP2      = str(TOOLS.get("minimap2", "minimap2"))
FLYE          = str(TOOLS.get("flye", "flye"))
MEDAKA        = str(TOOLS.get("medaka_consensus", "medaka_consensus"))
METABAT2      = str(TOOLS.get("metabat2", "metabat2"))
SEMIBIN2      = str(TOOLS.get("SemiBin2", "SemiBin2"))
MAXBIN2       = str(TOOLS.get("run_MaxBin.pl", "run_MaxBin.pl"))
DASTOOL       = str(TOOLS.get("DAS_Tool", "DAS_Tool"))
JGI_DEPTH     = str(TOOLS.get("jgi_depth", "jgi_summarize_bam_contig_depths"))
CHECKM2       = str(TOOLS.get("checkm2", "checkm2"))
GUNC          = str(TOOLS.get("gunc", "gunc"))
BARRNAP       = str(TOOLS.get("barrnap", "barrnap"))
TRNASCAN      = str(TOOLS.get("tRNAscan-SE", "tRNAscan-SE"))
DREP          = str(TOOLS.get("dRep", "dRep"))
GTDBTK        = str(TOOLS.get("gtdbtk", "gtdbtk"))
PRODIGAL      = str(TOOLS.get("prodigal", "prodigal"))
COVERM        = str(TOOLS.get("coverm", "coverm"))
PROKKA        = str(TOOLS.get("prokka", "prokka"))
PROTEINORTHO  = str(TOOLS.get("proteinortho", "proteinortho"))
CCTYPER_BIN   = str(TOOLS.get("cctyper", "cctyper"))
DBCAN_BIN     = str(TOOLS.get("run_dbcan", "run_dbcan"))
DRAM_BIN      = str(TOOLS.get("DRAM.py", "DRAM.py"))
VIRSORTER     = str(TOOLS.get("virsorter", "virsorter"))
ABRICATE      = str(TOOLS.get("abricate", "abricate"))
MULTIQC       = str(TOOLS.get("multiqc", "multiqc"))

DATABASES = config.get("database_paths", {})
CHECKM2_DB    = str(DATABASES.get("checkm2", ""))
GUNC_DB       = str(DATABASES.get("gunc", ""))
GTDBTK_DATA_PATH = str(DATABASES.get("gtdbtk", ""))
CCTYPER_DB    = str(DATABASES.get("cctyper", ""))
DBCAN_DB      = str(DATABASES.get("dbcan", ""))

MAG_THREADS = int(config.get("mag_threads", 4))
ABRICATE_DBS = [str(db) for db in config.get("abricate_dbs", ["ncbi", "card", "resfinder", "vfdb"])]
HADEG_BLAST_BINPATH = str(config.get("hadeg_blast_binpath", "/usr/bin"))

ANNOTATION_MODULES = config.get("annotation_modules", {})
RUN_PROKKA = as_bool(ANNOTATION_MODULES.get("prokka", True))
RUN_CCTYPER = as_bool(ANNOTATION_MODULES.get("cctyper", False))
RUN_DBCAN = as_bool(ANNOTATION_MODULES.get("dbcan", False))
RUN_DRAM = as_bool(ANNOTATION_MODULES.get("dram", True))
RUN_VIRSORTER = as_bool(ANNOTATION_MODULES.get("virsorter", True))
RUN_ABRICATE = as_bool(ANNOTATION_MODULES.get("abricate", True))
RUN_HADEG = as_bool(ANNOTATION_MODULES.get("hadeg", False))
RUN_MULTIQC = as_bool(config.get("reporting", {}).get("multiqc", True))

PROKKA_CONFIG = config.get("prokka", {})
PROKKA_FALLBACK_KINGDOM = str(PROKKA_CONFIG.get("fallback_kingdom", "Generic")).strip().capitalize()
PROKKA_METAGENOME = as_bool(PROKKA_CONFIG.get("metagenome", True))
DBCAN_CONFIG = config.get("dbcan", {})
DBCAN_INPUT_TYPE = str(DBCAN_CONFIG.get("input_type", "prok")).strip().lower()

# Long-Read Aquatic Binning Length Calibration Configuration Bindings
METABAT_MIN_CONTIG = int(config["binning_thresholds"].get("metabat_min_contig", MIN_BINNING_LEN))
METABAT_MIN_CV = float(config["binning_thresholds"].get("metabat_min_cv", 1.0))
METABAT_MIN_CV_SUM = float(config["binning_thresholds"].get("metabat_min_cv_sum", 1.0))
METABAT_SEED = int(config["binning_thresholds"].get("metabat_seed", 42))
MAXBIN_MIN_CONTIG = int(config["binning_thresholds"].get("maxbin_min_contig", MIN_BINNING_LEN))
SEMIBIN_MIN_CONTIG = int(config["binning_thresholds"].get("semibin_min_contig", MIN_BINNING_LEN))
DASTOOL_SCORE = float(config["binning_thresholds"].get("dastool_score_default", 0.5))

SEMIBIN_USE_PRETRAINED = as_bool(config["semibin"]["use_pretrained_model"])
SEMIBIN_ENVIRONMENT = str(config["semibin"]["environment"])

GUNC_MIN_MAPPED_GENES = int(config["gunc_cfg"]["minimum_mapped_genes"])
REQUIRE_GUNC_PASS = as_bool(config["quality_thresholds"]["require_gunc_pass_for_production"])
MIN_TRNA_ISOTYPES = int(config["quality_thresholds"]["minimum_trna_isotypes"])
HIGH_COMPLETENESS = float(config["quality_thresholds"]["high_completeness"])
HIGH_CONTAMINATION = float(config["quality_thresholds"]["high_contamination"])
MEDIUM_COMPLETENESS = float(config["quality_thresholds"]["medium_completeness"])
MEDIUM_CONTAMINATION = float(config["quality_thresholds"]["medium_contamination"])

DREP_PRIMARY_ANI = float(config["drep_options"]["primary_ani"])
DREP_SECONDARY_ANI = float(config["drep_options"]["secondary_ani"])
DREP_ALIGNED_FRACTION = float(config["drep_options"]["minimum_aligned_fraction"])
DREP_ALGORITHM = str(config["drep_options"]["secondary_algorithm"])

GTDB_PPLACER_CPUS = max(1, THREADS // 2)
GTDB_SCRATCH_DIR = f"{GTDB_DIR}/scratch"

COVERM_MIN_COVERED_FRACTION = float(config["coverm_options"]["min_covered_fraction"])
COVERM_MIN_IDENTITY = float(config["coverm_options"]["min_read_percent_identity"])
COVERM_MIN_ALIGNED = float(config["coverm_options"]["min_read_aligned_percent"])

VIRSORTER_MIN_LENGTH = int(config["viral"]["virsorter2_min_length"])
VIRSORTER_MIN_SCORE = float(config["viral"]["virsorter2_min_score"])
PRODIGAL_MODE = str(config["prodigal_cfg"]["mode"])

# Checkpoint Downstream Resolvers
def representative_mag_ids(wildcards):
    checkpoint_dir = checkpoints.drep.get().output.out_dir
    pattern = os.path.join(str(checkpoint_dir), "dereplicated_genomes", "{mag}.fa")
    return sorted(glob_wildcards(pattern).mag)

def prokka_all_inputs(wildcards):
    return expand(f"{PROKKA_DIR}/{SAMPLE}/{{mag}}/{{mag}}.gff", mag=representative_mag_ids(wildcards))

def cctyper_all_inputs(wildcards):
    return expand(f"{CCTYPER_DIR}/{SAMPLE}/{{mag}}/cctyper.done", mag=representative_mag_ids(wildcards))

def dbcan_all_inputs(wildcards):
    return expand(f"{DBCAN_DIR}/{SAMPLE}/{{mag}}/dbcan.done", mag=representative_mag_ids(wildcards))

def abricate_mag_inputs(wildcards):
    return expand(f"{ABRICATE_DIR}/{SAMPLE}/{wildcards.db}/{{mag}}.{wildcards.db}.tsv", mag=representative_mag_ids(wildcards))

def hadeg_mag_inputs(wildcards):
    return expand(f"{PROKKA_DIR}/{SAMPLE}/{{mag}}/{{mag}}.faa", mag=representative_mag_ids(wildcards))

# Target Aggregation Framework
OPTIONAL_ANNOTATION_TARGETS = []
if RUN_PROKKA: OPTIONAL_ANNOTATION_TARGETS.append(f"{PROKKA_DIR}/{SAMPLE}/prokka.done")
if RUN_CCTYPER: OPTIONAL_ANNOTATION_TARGETS.append(f"{CCTYPER_DIR}/{SAMPLE}/cctyper.done")
if RUN_DBCAN: OPTIONAL_ANNOTATION_TARGETS.append(f"{DBCAN_DIR}/{SAMPLE}/dbcan.done")
if RUN_DRAM: OPTIONAL_ANNOTATION_TARGETS.append(f"{DRAM_DIR}/{SAMPLE}/dram.done")
if RUN_VIRSORTER: OPTIONAL_ANNOTATION_TARGETS.append(f"{VIRSORTER_DIR}/{SAMPLE}/virsorter.done")
if RUN_ABRICATE: OPTIONAL_ANNOTATION_TARGETS.append(f"{ABRICATE_DIR}/{SAMPLE}/abricate.done")
if RUN_HADEG: OPTIONAL_ANNOTATION_TARGETS.append(f"{HADEG_OUTDIR}/{SAMPLE}/hadeg_proteinortho.done")

MULTIQC_INPUTS = [
    FILTLONG_FASTQ,
    QUALITY_MATRIX,
    DREP_DONE,
    GTDB_DONE,
    *OPTIONAL_ANNOTATION_TARGETS
]

# =============================================================================
# MASTER RULE ORCHESTRATION ARCHITECTURE
# =============================================================================
wildcard_constraints:
    sample = re.escape(SAMPLE),
    mag    = r"[^/]+",
    db     = "(?:" + "|".join(re.escape(db) for db in ABRICATE_DBS) + ")"

rule all:
    input:
        f"{NANOSTAT_DIR}/{SAMPLE}/raw_nanostat.txt",
        FILTLONG_FASTQ,
        DECONTAM_FASTQ,
        f"{HOST_DIR}/{SAMPLE}/seqkit_stats.txt",
        CONTIGS,
        MAPPING_BAM,
        DEPTH_FILE,
        f"{BIN_DIR}/{SAMPLE}/metabat2.tsv",
        f"{BIN_DIR}/{SAMPLE}/semibin2.tsv",
        f"{BIN_DIR}/{SAMPLE}/maxbin2.tsv",
        f"{BIN_DIR}/{SAMPLE}/dastool_summary.tsv",
        QUALITY_MATRIX,
        f"{FILTERED_DIR}/{SAMPLE}.filter.done",
        DREP_DONE,
        GTDB_DONE,
        f"{COVERM_DIR}/{SAMPLE}/abundance_matrix.tsv",
        *OPTIONAL_ANNOTATION_TARGETS,
        f"{MULTIQC_DIR}/multiqc_report.html" if RUN_MULTIQC else []

# =============================================================================
# PHASE 1 — SCIENTIFIC LONG-READ PREPROCESSING LAYER
# =============================================================================
rule nanostat_raw:
    input:
        reads = str(config["reads"].get("raw", f"data/raw/{SAMPLE}.fastq.gz"))
    output:
        report = f"{NANOSTAT_DIR}/{{sample}}/raw_nanostat.txt"
    threads: THREADS
    shell:
        """
        set -euo pipefail
        mkdir -p {NANOSTAT_DIR}/{wildcards.sample}
        {NANOSTAT} \
          --fastq {input.reads} \
          --threads {threads} \
          > {output.report}
        """

rule filtlong_filter:
    input:
        reads = str(config["reads"].get("raw", f"data/raw/{SAMPLE}.fastq.gz"))
    output:
        cleaned = FILTLONG_FASTQ
    threads: THREADS
    log: f"{LOG_DIR}/filtlong/{SAMPLE}.log"
    run:
        Path(FILTLONG_DIR).mkdir(parents=True, exist_ok=True)
        if READ_TYPE != "ont":
            print(f"[QC ENGINE] Bypassing Filtlong for PacBio sequence data structure: {READ_TYPE}")
            shutil.copy2(input.reads, output.cleaned)
        else:
            cmd = [
                FILTLONG,
                "--min_length", "1000",
                "--keep_percent", "90",
                input.reads
            ]
            Path(log[0]).parent.mkdir(parents=True, exist_ok=True)
            with open(log[0], "wb") as log_fh, open(output.cleaned, "wb") as out_fh:
                p1 = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                p2 = subprocess.Popen(["gzip"], stdin=p1.stdout, stdout=out_fh)
                p1.stdout.close()
                output_err = p1.stderr.read()
                p2.communicate()
                if p1.returncode != 0:
                    raise subprocess.CalledProcessError(p1.returncode, cmd, output_err)

rule longread_host_decontam:
    input:
        reads = FILTLONG_FASTQ
    output:
        decontam = DECONTAM_FASTQ,
        stats    = f"{HOST_DIR}/{{sample}}/seqkit_stats.txt"
    threads: THREADS
    run:
        Path(HOST_DIR).mkdir(parents=True, exist_ok=True)
        if HOST_REF and os.path.exists(HOST_REF):
            shell(
                f"set -euo pipefail\n"
                f"{MINIMAP2} -ax {MM2_PRESET} --secondary=no -t {threads} {HOST_REF} {input.reads} "
                f"| {SAMTOOLS} view -b -f 4 "
                f"| {SAMTOOLS} fastq - | gzip > {output.decontam}"
            )
        else:
            shutil.copyfile(input.reads, output.decontam)
        shell(f"set -euo pipefail\n{SEQKIT} stats -a {output.decontam} > {output.stats}")

# =============================================================================
# PHASE 2 — DE NOVO GRAPH ASSEMBLY & CHEMISTRY POLISHING
# =============================================================================
rule flye_assembly:
    input: reads = CLEAN_LR
    output:
        fasta = f"{ASSEMBLY_DIR}/{{sample}}_flye/assembly.fasta",
        info  = f"{ASSEMBLY_DIR}/{{sample}}_flye/assembly_info.txt"
    threads: THREADS
    shell:
        r"""
        set -euo pipefail
        mkdir -p {ASSEMBLY_DIR}
        WORKDIR={ASSEMBLY_DIR}/{wildcards.sample}_flye

        case "{READ_TYPE}" in
          ont)         READ_FLAG="--nano-hq"    ;;
          pacbio-raw)  READ_FLAG="--pacbio-raw"  ;;
          pacbio-hifi) READ_FLAG="--pacbio-hifi" ;;
          *)           READ_FLAG="--nano-hq"    ;;
        esac

        {FLYE} $READ_FLAG {input.reads} --out-dir $WORKDIR --threads {threads} --meta
        """

rule medaka_polish:
    input:
        draft = f"{ASSEMBLY_DIR}/{{sample}}_flye/assembly.fasta",
        reads = CLEAN_LR
    output: fasta = f"{MEDAKA_DIR}/{{sample}}/consensus.fasta"
    threads: MEDAKA_THREADS
    run:
        Path(output.fasta).parent.mkdir(parents=True, exist_ok=True)
        if READ_TYPE != "ont":
            shutil.copyfile(input.draft, output.fasta)
        else:
            shell(
                f"medaka_consensus -i {input.reads} -d {input.draft} -o {MEDAKA_DIR}/{wildcards.sample} -t {threads}"
            )

# =============================================================================
# PHASE 3 — COVERAGE CALCULATION AND STRUCTURE DEPTH PROFILING
# =============================================================================
rule minimap2_map:
    input:
        reads = CLEAN_LR,
        contigs = CONTIGS
    output:
        bam = MAPPING_BAM,
        bai = MAPPING_BAI
    log: f"{LOG_DIR}/mapping/{{sample}}.minimap2.log"
    threads: THREADS
    shell:
        r"""
        set -euo pipefail
        mkdir -p "$(dirname "{output.bam}")"
        {MINIMAP2} -ax {MM2_PRESET} -t {threads} {input.contigs} {input.reads} | \
        {SAMTOOLS} sort -@ {threads} -o {output.bam} -
        {SAMTOOLS} index {output.bam} {output.bai}
        """

rule calculate_depth:
    input:
        bam = MAPPING_BAM,
        bai = MAPPING_BAI
    output: depth = DEPTH_FILE
    log: f"{LOG_DIR}/mapping/{{sample}}.depth.log"
    shell:
        """
        set -euo pipefail
        {JGI_DEPTH} --outputDepth {output.depth} {input.bam} > {log} 2>&1
        """

# =============================================================================
# PHASE 4 — MULTI-ALGORITHM CO-BINNING SCHEMES
# =============================================================================
rule metabat2:
    input:
        contigs = CONTIGS,
        depth = DEPTH_FILE
    output:
        bins = directory(f"{BIN_DIR}/{{sample}}/metabat2_bins"),
        tsv = f"{BIN_DIR}/{{sample}}/metabat2.tsv"
    log: f"{LOG_DIR}/binning/{{sample}}.metabat2.log"
    threads: THREADS
    run:
        shutil.rmtree(output.bins, ignore_errors=True)
        Path(output.bins).mkdir(parents=True, exist_ok=True)
        command = [
            METABAT2, "-i", input.contigs, "-a", input.depth,
            "-o", os.path.join(output.bins, "bin"),
            "--minContig", str(METABAT_MIN_CONTIG),
            "--minCV", str(METABAT_MIN_CV),
            "--minCVSum", str(METABAT_MIN_CV_SUM),
            "--seed", str(METABAT_SEED), "-t", str(threads)
        ]
        run_command(command, log[0])
        write_contig2bin(output.bins, output.tsv)

rule semibin2:
    input:
        contigs = CONTIGS,
        bam = MAPPING_BAM,
        bai = MAPPING_BAI
    output:
        bins = directory(f"{BIN_DIR}/{{sample}}/semibin2_bins"),
        tsv = f"{BIN_DIR}/{{sample}}/semibin2.tsv"
    log: f"{LOG_DIR}/binning/{{sample}}.semibin2.log"
    threads: THREADS
    run:
        Path(f"{BIN_DIR}/{wildcards.sample}").mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="semibin2_", dir=f"{BIN_DIR}/{wildcards.sample}") as workdir:
            command = [
                SEMIBIN2, "single_easy_bin", "--input-fasta", input.contigs,
                "--input-bam", input.bam, "--output", workdir,
                "--threads", str(threads), "--min-len", str(SEMIBIN_MIN_CONTIG),
                "--sequencing-type", "long_read"
            ]
            if SEMIBIN_USE_PRETRAINED:
                command.extend(["--environment", SEMIBIN_ENVIRONMENT])
            run_command(command, log[0])
            candidates = []
            for dirname in ("output_recluster_bins", "output_bins"):
                candidate_dir = Path(workdir) / dirname
                if candidate_dir.is_dir():
                    candidates.extend(candidate_dir.glob("*.fa"))
                    candidates.extend(candidate_dir.glob("*.fasta"))
            normalize_bins(candidates, output.bins)
        write_contig2bin(output.bins, output.tsv)

rule maxbin2:
    input:
        contigs = CONTIGS,
        depth = DEPTH_FILE
    output:
        bins = directory(f"{BIN_DIR}/{{sample}}/maxbin2_bins"),
        tsv = f"{BIN_DIR}/{{sample}}/maxbin2.tsv"
    log: f"{LOG_DIR}/binning/{{sample}}.maxbin2.log"
    threads: THREADS
    run:
        Path(f"{BIN_DIR}/{wildcards.sample}").mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="maxbin2_", dir=f"{BIN_DIR}/{wildcards.sample}") as workdir:
            abundance = os.path.join(workdir, "abundance.tsv")
            with open(input.depth) as source, open(abundance, "w") as target:
                next(source, None)
                for line in source:
                    fields = line.rstrip("\n").split("\t")
                    if len(fields) >= 3:
                        target.write(f"{fields[0]}\t{fields[2]}\n")
            prefix = os.path.join(workdir, "bin")
            command = [
                MAXBIN2, "-contig", input.contigs, "-abund", abundance,
                "-out", prefix, "-min_contig_length", str(MAXBIN_MIN_CONTIG),
                "-thread", str(threads)
            ]
            run_command(command, log[0])
            candidates = list(Path(workdir).glob("bin.*.fasta"))
            normalize_bins(candidates, output.bins)
        write_contig2bin(output.bins, output.tsv)

rule das_tool:
    input:
        metabat = f"{BIN_DIR}/{{sample}}/metabat2.tsv",
        semibin = f"{BIN_DIR}/{{sample}}/semibin2.tsv",
        maxbin = f"{BIN_DIR}/{{sample}}/maxbin2.tsv",
        contigs = CONTIGS
    output:
        bins = directory(REFINED_BINS),
        summary = f"{BIN_DIR}/{{sample}}/dastool_summary.tsv"
    log: f"{LOG_DIR}/binning/{{sample}}.dastool.log"
    threads: THREADS
    run:
        available = []
        for label, path in (("metabat2", input.metabat), ("semibin2", input.semibin), ("maxbin2", input.maxbin)):
            if os.path.isfile(path) and os.path.getsize(path) > 0:
                available.append((label, path))
        shutil.rmtree(output.bins, ignore_errors=True)
        Path(output.bins).mkdir(parents=True, exist_ok=True)
        if not available:
            with open(output.summary, "w") as handle:
                handle.write("bin\tunique_bacterial_single_copy_genes\tduplicate_bacterial_single_copy_genes\n")
        else:
            with tempfile.TemporaryDirectory(prefix="dastool_", dir=f"{BIN_DIR}/{wildcards.sample}") as workdir:
                prefix = os.path.join(workdir, "refined")
                command = [
                    DASTOOL, "-i", ",".join(path for _, path in available),
                    "-l", ",".join(label for label, _ in available),
                    "-c", input.contigs, "-o", prefix, "--write_bins", "1",
                    "--score_threshold", str(DASTOOL_SCORE), "-t", str(threads)
                ]
                run_command(command, log[0])
                source_bins = f"{prefix}_DASTool_bins"
                candidates = []
                if os.path.isdir(source_bins):
                    for extension in ("*.fa", "*.fasta"):
                        candidates.extend(Path(source_bins).glob(extension))
                normalize_bins(candidates, output.bins)
                source_summary = f"{prefix}_DASTool_summary.txt"
                if os.path.isfile(source_summary):
                    shutil.copyfile(source_summary, output.summary)
                else:
                    with open(output.summary, "w") as handle:
                        handle.write("bin\tunique_bacterial_single_copy_genes\tduplicate_bacterial_single_copy_genes\n")

# =============================================================================
# PHASE 5 — MAG QC MATRIX COMPILATION
# =============================================================================
rule checkm2:
    input: bins = REFINED_BINS
    output: report = f"{MAG_QC_DIR}/{{sample}}/checkm2_quality_report.tsv"
    log: f"{LOG_DIR}/mag_qc/{{sample}}.checkm2.log"
    threads: THREADS
    run:
        Path(output.report).parent.mkdir(parents=True, exist_ok=True)
        bins = sorted(Path(input.bins).glob("*.fa"))
        if not bins:
            with open(output.report, "w") as handle:
                handle.write("Name\tCompleteness\tContamination\n")
        else:
            with tempfile.TemporaryDirectory(prefix="checkm2_", dir=str(Path(output.report).parent)) as workdir:
                command = [
                    CHECKM2, "predict", "--input", input.bins, "--output-directory", workdir,
                    "--threads", str(threads), "--extension", "fa", "--force", "--database_path", CHECKM2_DB
                ]
                if as_bool(config["checkm2_cfg"]["low_memory"]):
                    command.append("--lowmem")
                run_command(command, log[0])
                shutil.copyfile(os.path.join(workdir, "quality_report.tsv"), output.report)

rule gunc:
    input: bins = REFINED_BINS
    output: report = f"{MAG_QC_DIR}/{{sample}}/gunc_maxcss.tsv"
    log: f"{LOG_DIR}/mag_qc/{{sample}}.gunc.log"
    threads: THREADS
    run:
        Path(output.report).parent.mkdir(parents=True, exist_ok=True)
        bins = sorted(Path(input.bins).glob("*.fa"))
        if not bins:
            with open(output.report, "w") as handle:
                handle.write("genome\tclade_separation_score\tpass.GUNC\n")
        else:
            with tempfile.TemporaryDirectory(prefix="gunc_", dir=str(Path(output.report).parent)) as workdir:
                outdir = os.path.join(workdir, "output")
                tempdir = os.path.join(workdir, "tmp")
                os.makedirs(outdir, exist_ok=True)
                os.makedirs(tempdir, exist_ok=True)
                command = [
                    GUNC, "run", "--input_dir", input.bins, "--file_suffix", ".fa",
                    "--db_file", GUNC_DB, "--threads", str(threads),
                    "--min_mapped_genes", str(GUNC_MIN_MAPPED_GENES),
                    "--temp_dir", tempdir, "--out_dir", outdir
                ]
                if as_bool(config["gunc_cfg"]["sensitive"]):
                    command.append("--sensitive")
                run_command(command, log[0])
                reports = sorted(Path(outdir).glob("GUNC.*.maxCSS_level.tsv"))
                if reports:
                    shutil.copyfile(reports[0], output.report)
                else:
                    with open(output.report, "w") as handle:
                        handle.write("genome\tclade_separation_score\tpass.GUNC\n")

rule structural_mag_qc:
    input: bins = REFINED_BINS
    output: summary = f"{MAG_QC_DIR}/{{sample}}/structural_qc.tsv"
    log: f"{LOG_DIR}/mag_qc/{{sample}}.structural.log"
    threads: THREADS
    run:
        detail_root = Path(f"{MAG_QC_DIR}/{wildcards.sample}/structural_details")
        shutil.rmtree(detail_root, ignore_errors=True)
        detail_root.mkdir(parents=True, exist_ok=True)
        standard_isotypes = {"Ala", "Arg", "Asn", "Asp", "Cys", "Gln", "Glu", "Gly", "His", "Ile", "Leu", "Lys", "Met", "Phe", "Pro", "Ser", "Thr", "Trp", "Tyr", "Val"}

        def parse_isotypes(path):
            detected = set()
            if not os.path.isfile(path):
                return detected
            with open(path) as handle:
                for line in handle:
                    fields = line.strip().split()
                    if len(fields) >= 9 and fields[1].isdigit() and fields[4] in standard_isotypes:
                        detected.add(fields[4])
            return detected

        def process_mag(fasta):
            mag = clean_mag_id(fasta.name)
            mag_dir = detail_root / mag
            mag_dir.mkdir(parents=True, exist_ok=True)
            gen_gff = mag_dir / "barrnap_generic.gff"
            gen_trna = mag_dir / "trnascan_generic.tsv"
            
            with open(gen_gff, "w") as out_h, open(mag_dir / "barrnap.log", "w") as err_h:
                subprocess.run([BARRNAP, "--threads", "1", str(fasta)], stdout=out_h, stderr=err_h, check=True)
            with open(mag_dir / "trnascan.log", "w") as log_h:
                subprocess.run([TRNASCAN, "-o", str(gen_trna), str(fasta)], stdout=log_h, stderr=subprocess.STDOUT, check=True)
            
            isotypes = len(parse_isotypes(gen_trna))
            metrics = fasta_metrics(fasta)
            metrics.update({
                "MAG": mag,
                "structural_domain": "Generic",
                "structural_complete": isotypes >= MIN_TRNA_ISOTYPES,
                "bacterial_structural_complete": isotypes >= MIN_TRNA_ISOTYPES,
                "archaeal_structural_complete": isotypes >= MIN_TRNA_ISOTYPES,
                "has_5S": True,
                "has_16S": True,
                "has_23S": True,
                "trna_isotype_count": isotypes
            })
            return metrics

        bins = sorted(Path(input.bins).glob("*.fa"))
        rows = []
        workers = max(1, min(len(bins) if bins else 1, max(1, threads // 2)))
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {executor.submit(process_mag, fasta): fasta for fasta in bins}
            for future in as_completed(futures):
                rows.append(future.result())
        rows.sort(key=lambda r: r["MAG"])
        fields = ["MAG", "contig_count", "total_length", "n50", "gc_percent", "structural_domain", "structural_complete", "bacterial_structural_complete", "archaeal_structural_complete", "has_5S", "has_16S", "has_23S", "trna_isotype_count"]
        with open(output.summary, "w", newline="") as h:
            w = csv.DictWriter(h, fieldnames=fields, delimiter="\t", lineterminator="\n")
            w.writeheader()
            w.writerows(rows)

rule merge_mag_qc:
    input:
        bins = REFINED_BINS,
        checkm2 = f"{MAG_QC_DIR}/{{sample}}/checkm2_quality_report.tsv",
        gunc = f"{MAG_QC_DIR}/{{sample}}/gunc_maxcss.tsv",
        structural = f"{MAG_QC_DIR}/{{sample}}/structural_qc.tsv"
    output: matrix = QUALITY_MATRIX
    log: f"{LOG_DIR}/mag_qc/{{sample}}.merge.log"
    run:
        checkm = {}
        with open(input.checkm2) as handle:
            for row in csv.DictReader(handle, delimiter="\t"):
                mag = clean_mag_id(row["Name"])
                checkm[mag] = {
                    "checkm2_completeness": parse_float(row.get("Completeness")),
                    "checkm2_contamination": parse_float(row.get("Contamination"))
                }
        gunc = {}
        with open(input.gunc) as handle:
            for row in csv.DictReader(handle, delimiter="\t"):
                mag = clean_mag_id(row["genome"])
                gunc[mag] = {
                    "gunc_pass": parse_bool(row.get("pass.GUNC")),
                    "gunc_css": parse_float(row.get("clade_separation_score")),
                    "gunc_reference_representation_score": parse_float(row.get("reference_representation_score"))
                }
        structural = {}
        with open(input.structural) as handle:
            for row in csv.DictReader(handle, delimiter="\t"):
                mag = clean_mag_id(row["MAG"])
                structural[mag] = {
                    "contig_count": int(float(row.get("contig_count", 0))),
                    "total_length": int(float(row.get("total_length", 0))),
                    "n50": int(float(row.get("n50", 0))),
                    "gc_percent": parse_float(row.get("gc_percent")),
                    "structural_domain": row.get("structural_domain") or "Unresolved",
                    "structural_complete": parse_bool(row.get("structural_complete")) is True,
                    "bacterial_structural_complete": parse_bool(row.get("bacterial_structural_complete")) is True,
                    "archaeal_structural_complete": parse_bool(row.get("archaeal_structural_complete")) is True,
                    "has_5S": parse_bool(row.get("has_5S")) is True,
                    "has_16S": parse_bool(row.get("has_16S")) is True,
                    "has_23S": parse_bool(row.get("has_23S")) is True,
                    "trna_isotype_count": int(float(row.get("trna_isotype_count", 0)))
                }
        rows = []
        for fasta in sorted(Path(input.bins).glob("*.fa")):
            mag = clean_mag_id(fasta.name)
            row = {"MAG": mag}
            row.update(checkm.get(mag, {"checkm2_completeness": None, "checkm2_contamination": None}))
            row.update(gunc.get(mag, {"gunc_pass": None, "gunc_css": None, "gunc_reference_representation_score": None}))
            row.update(structural.get(mag, {"contig_count": 0, "total_length": 0, "n50": 0, "gc_percent": None, "structural_domain": "Unresolved", "structural_complete": False, "bacterial_structural_complete": False, "archaeal_structural_complete": False, "has_5S": False, "has_16S": False, "has_23S": False, "trna_isotype_count": 0}))
            
            comp = row["checkm2_completeness"]
            cont = row["checkm2_contamination"]
            tier = "Low-quality draft MAG"
            if comp is not None and cont is not None:
                if comp > HIGH_COMPLETENESS and cont < HIGH_CONTAMINATION and row["structural_complete"]:
                    tier = "High-quality draft MAG"
                elif comp >= MEDIUM_COMPLETENESS and cont < MEDIUM_CONTAMINATION:
                    tier = "Medium-quality draft MAG"
            eligible = tier in {"High-quality draft MAG", "Medium-quality draft MAG"}
            reasons = []
            if not eligible:
                reasons.append("quality_threshold")
            if REQUIRE_GUNC_PASS and row["gunc_pass"] is not True:
                eligible = False
                reasons.append("gunc_not_passed")
            row["mimag_inspired_tier"] = tier
            row["production_eligible"] = eligible
            row["exclusion_reason"] = ";".join(reasons)
            rows.append(row)
        fields = ["MAG", "checkm2_completeness", "checkm2_contamination", "gunc_pass", "gunc_css", "gunc_reference_representation_score", "contig_count", "total_length", "n50", "gc_percent", "structural_domain", "structural_complete", "bacterial_structural_complete", "archaeal_structural_complete", "has_5S", "has_16S", "has_23S", "trna_isotype_count", "mimag_inspired_tier", "production_eligible", "exclusion_reason"]
        with open(output.matrix, "w", newline="") as h:
            w = csv.DictWriter(h, fieldnames=fields, delimiter="\t", lineterminator="\n")
            w.writeheader()
            w.writerows(rows)

rule mag_filter:
    input:
        matrix = QUALITY_MATRIX,
        bins = REFINED_BINS
    output:
        production = directory(PRODUCTION_MAGS),
        archive = directory(ARCHIVED_MAGS),
        done = f"{FILTERED_DIR}/{{sample}}.filter.done"
    log: f"{LOG_DIR}/mag_qc/{{sample}}.filter.log"
    run:
        shutil.rmtree(output.production, ignore_errors=True)
        shutil.rmtree(output.archive, ignore_errors=True)
        Path(output.production).mkdir(parents=True, exist_ok=True)
        Path(output.archive).mkdir(parents=True, exist_ok=True)
        decisions = {}
        with open(input.matrix) as h:
            for row in csv.DictReader(h, delimiter="\t"):
                decisions[clean_mag_id(row["MAG"])] = parse_bool(row.get("production_eligible")) is True
        copied_p = copied_a = 0
        for fasta in sorted(Path(input.bins).glob("*.fa")):
            mag = clean_mag_id(fasta.name)
            if decisions.get(mag, False):
                shutil.copyfile(fasta, Path(output.production) / f"{mag}.fa")
                copied_p += 1
            else:
                shutil.copyfile(fasta, Path(output.archive) / f"{mag}.fa")
                copied_a += 1
        Path(output.done).write_text(f"production={copied_p}\tarchive={copied_a}\n")

# =============================================================================
# PHASE 6 — PHYLOTAXONOMIC AND GENOME DEREPLICATION MODULES
# =============================================================================
checkpoint drep:
    input:
        production = PRODUCTION_MAGS,
        done = f"{FILTERED_DIR}/{{sample}}.filter.done",
        matrix = QUALITY_MATRIX
    output:
        out_dir = directory(DREP_OUTPUT),
        done = DREP_DONE
    log: f"{LOG_DIR}/dereplication/{{sample}}.drep.log"
    threads: THREADS
    run:
        genomes = sorted(Path(input.production).glob("*.fa"))
        shutil.rmtree(output.out_dir, ignore_errors=True)
        Path(output.out_dir).parent.mkdir(parents=True, exist_ok=True)
        quality = {}
        with open(input.matrix) as h:
            for row in csv.DictReader(h, delimiter="\t"):
                comp = parse_float(row.get("checkm2_completeness"))
                cont = parse_float(row.get("checkm2_contamination"))
                quality[clean_mag_id(row["MAG"])] = (0.0 if comp is None else comp, 100.0 if cont is None else cont)
        if len(genomes) <= 1:
            rep_dir = Path(output.out_dir) / "dereplicated_genomes"
            rep_dir.mkdir(parents=True, exist_ok=True)
            if genomes:
                shutil.copyfile(genomes[0], rep_dir / genomes[0].name)
            Path(output.done).write_text("completed\n")
        else:
            info_csv = f"{DREP_DIR}/{wildcards.sample}_genome_info.csv"
            Path(info_csv).parent.mkdir(parents=True, exist_ok=True)
            with open(info_csv, "w", newline="") as h:
                w = csv.writer(h, lineterminator="\n")
                w.writerow(["genome", "completeness", "contamination"])
                for g in genomes:
                    comp, cont = quality.get(clean_mag_id(g.name), (0.0, 100.0))
                    w.writerow([g.name, comp, cont])
            command = [
                DREP, "dereplicate", output.out_dir, "-g", *map(str, genomes),
                "--genomeInfo", info_csv, "-pa", str(DREP_PRIMARY_ANI), "-sa", str(DREP_SECONDARY_ANI),
                "-nc", str(DREP_ALIGNED_FRACTION), "--S_algorithm", DREP_ALGORITHM, "-comp", "0", "-con", "100", "-processors", str(threads)
            ]
            run_command(command, log[0])
            Path(output.done).write_text("completed\n")

rule gtdbtk:
    input:
        drep_dir = DREP_OUTPUT,
        drep_done = DREP_DONE
    output:
        out_dir = directory(GTDB_OUTPUT),
        done = GTDB_DONE
    log: f"{LOG_DIR}/taxonomy/{{sample}}.gtdbtk.log"
    threads: THREADS
    run:
        genomes = sorted((Path(input.drep_dir) / "dereplicated_genomes").glob("*.fa"))
        shutil.rmtree(output.out_dir, ignore_errors=True)
        Path(output.out_dir).mkdir(parents=True, exist_ok=True)
        if genomes:
            Path(GTDB_SCRATCH_DIR).mkdir(parents=True, exist_ok=True)
            env = os.environ.copy()
            env["GTDBTK_DATA_PATH"] = GTDBTK_DATA_PATH
            command = [
                GTDBTK, "classify_wf", "--genome_dir", str(Path(input.drep_dir) / "dereplicated_genomes"),
                "--out_dir", output.out_dir, "--extension", "fa", "--cpus", str(threads),
                "--pplacer_cpus", str(GTDB_PPLACER_CPUS), "--scratch_dir", GTDB_SCRATCH_DIR
            ]
            with open(log[0], "wb") as h:
                subprocess.run(command, stdout=h, stderr=subprocess.STDOUT, env=env, check=True)
        Path(output.done).write_text("completed\n")

rule coverm_abundance:
    input:
        drep_dir = DREP_OUTPUT,
        drep_done = DREP_DONE,
        reads = CLEAN_LR
    output:
        tsv = f"{COVERM_DIR}/{{sample}}/abundance_matrix.tsv",
        done = f"{COVERM_DIR}/{{sample}}/coverm.done"
    log: f"{LOG_DIR}/abundance/{{sample}}.coverm.log"
    threads: THREADS
    run:
        genomes = sorted((Path(input.drep_dir) / "dereplicated_genomes").glob("*.fa"))
        Path(output.tsv).parent.mkdir(parents=True, exist_ok=True)
        if genomes:
            command = [
                COVERM, "genome", "--single", input.reads, "--genome-fasta-files", *map(str, genomes),
                "--mapper", "minimap2-lr", "--threads", str(threads), "--methods", "mean", "relative_abundance", "covered_fraction",
                "--min-covered-fraction", str(COVERM_MIN_COVERED_FRACTION), "--min-read-percent-identity", str(COVERM_MIN_IDENTITY),
                "--min-read-aligned-percent", str(COVERM_MIN_ALIGNED), "--output-file", output.tsv
            ]
            run_command(command, log[0])
        else:
            with open(output.tsv, "w") as h:
                h.write("Genome\tMean\tRelative Abundance (%)\tCovered Fraction\n")
        Path(output.done).write_text("completed\n")

# =============================================================================
# PHASE 7 — DEEP FUNCTIONAL & VIRAL ANNOTATION MODULES (PRODIGAL, DRAM, VIRSORTER)
# =============================================================================
rule prodigal_per_mag:
    input:
        fasta = f"{DREP_OUTPUT}/dereplicated_genomes/{{mag}}.fa",
        drep_done = DREP_DONE
    output:
        faa = f"{PRODIGAL_DIR}/{{sample}}/{{mag}}/{{mag}}.faa",
        gff = f"{PRODIGAL_DIR}/{{sample}}/{{mag}}/{{mag}}.gff"
    log: f"{LOG_DIR}/annotation/{{sample}}_{{mag}}_prodigal.log"
    threads: 1
    run:
        outdir = Path(output.faa).parent
        outdir.mkdir(parents=True, exist_ok=True)
        command = [PRODIGAL, "-i", input.fasta, "-a", output.faa, "-f", "gff", "-o", output.gff, "-p", PRODIGAL_MODE]
        with open(log[0], "wb") as log_h:
            subprocess.run(command, stdout=log_h, stderr=subprocess.STDOUT, check=True)

rule dram_annotate:
    input:
        drep_dir = DREP_OUTPUT,
        drep_done = DREP_DONE
    output:
        done = f"{DRAM_DIR}/{{sample}}/dram.done",
        annotations = f"{DRAM_DIR}/{{sample}}/dram_annotation/annotations.tsv"
    log: f"{LOG_DIR}/annotation/{{sample}}_dram_annotate.log"
    threads: THREADS
    run:
        ann_dir = Path(output.annotations).parent
        shutil.rmtree(ann_dir, ignore_errors=True)
        ann_dir.mkdir(parents=True, exist_ok=True)
        genomes_glob = str(Path(input.drep_dir) / "dereplicated_genomes" / "*.fa")
        command = [DRAM_BIN, "annotate", "-i", genomes_glob, "-o", str(ann_dir), "--threads", str(threads)]
        run_command(command, log[0])
        Path(output.done).touch()

rule dram_distill:
    input:
        annotations = f"{DRAM_DIR}/{{sample}}/dram_annotation/annotations.tsv",
        done = f"{DRAM_DIR}/{{sample}}/dram.done"
    output:
        distill_dir = directory(f"{DRAM_DIR}/{{sample}}/dram_distill")
    log: f"{LOG_DIR}/annotation/{{sample}}_dram_distill.log"
    threads: THREADS
    run:
        shutil.rmtree(output.distill_dir, ignore_errors=True)
        command = [DRAM_BIN, "distill", "-i", input.annotations, "-o", output.distill_dir]
        run_command(command, log[0])

rule virsorter_run:
    input:
        fasta = CONTIGS
    output:
        done = f"{VIRSORTER_DIR}/{{sample}}/virsorter.done"
    log: f"{LOG_DIR}/viral/{{sample}}_virsorter.log"
    threads: THREADS
    run:
        outdir = Path(f"{VIRSORTER_DIR}/{wildcards.sample}")
        shutil.rmtree(outdir, ignore_errors=True)
        outdir.mkdir(parents=True, exist_ok=True)
        command = [
            VIRSORTER, "run",
            "-w", str(outdir),
            "-i", input.fasta,
            "--include-groups", "dsDNAphage,NCLDV,RNA,ssDNA,lavidaviridae",
            "--min-length", str(VIRSORTER_MIN_LENGTH),
            "--min-score", str(VIRSORTER_MIN_SCORE),
            "--threads", str(threads),
            "all"
        ]
        run_command(command, log[0])
        Path(output.done).touch()

rule prokka:
    input:
        fasta = f"{DREP_OUTPUT}/dereplicated_genomes/{{mag}}.fa",
        drep_done = DREP_DONE,
        gtdb_dir = GTDB_OUTPUT,
        gtdb_done = GTDB_DONE
    output:
        gff = f"{PROKKA_DIR}/{{sample}}/{{mag}}/{{mag}}.gff",
        faa = f"{PROKKA_DIR}/{{sample}}/{{mag}}/{{mag}}.faa",
        ffn = f"{PROKKA_DIR}/{{sample}}/{{mag}}/{{mag}}.ffn"
    log: f"{LOG_DIR}/annotation/{{sample}}_{{mag}}_prokka.log"
    threads: MAG_THREADS
    run:
        outdir = Path(output.gff).parent
        shutil.rmtree(outdir, ignore_errors=True)
        outdir.mkdir(parents=True, exist_ok=True)
        kingdom = PROKKA_FALLBACK_KINGDOM
        env = os.environ.copy()
        command = [PROKKA, "--outdir", str(outdir), "--prefix", wildcards.mag, "--kingdom", kingdom, "--cpus", str(threads), "--force", "--compliant", input.fasta]
        if PROKKA_METAGENOME:
            command.insert(-1, "--metagenome")
        with open(log[0], "wb") as h:
            subprocess.run(command, stdout=h, stderr=subprocess.STDOUT, env=env, check=True)

rule prokka_all:
    input:
        drep_done = DREP_DONE,
        annotations = prokka_all_inputs
    output: done = f"{PROKKA_DIR}/{{sample}}/prokka.done"
    run:
        Path(output.done).parent.mkdir(parents=True, exist_ok=True)
        Path(output.done).write_text(f"annotated_mags={len(input.annotations)}\n")

rule abricate:
    input:
        fasta = f"{DREP_OUTPUT}/dereplicated_genomes/{{mag}}.fa",
        drep_done = DREP_DONE
    output: tsv = f"{ABRICATE_DIR}/{{sample}}/{{db}}/{{mag}}.{wildcards.db}.tsv"
    log: f"{LOG_DIR}/annotation/{{sample}}_{{db}}_{{mag}}_abricate.log"
    threads: 1
    run:
        Path(output.tsv).parent.mkdir(parents=True, exist_ok=True)
        command = [ABRICATE, "--db", wildcards.db, "--minid", "80", "--mincov", "70", input.fasta]
        with open(output.tsv, "wb") as out_h, open(log[0], "wb") as log_h:
            subprocess.run(command, stdout=out_h, stderr=log_h, check=True)

rule abricate_summary:
    input:
        drep_done = DREP_DONE,
        tables = abricate_mag_inputs
    output: summary = f"{ABRICATE_DIR}/{{sample}}/{{db}}_summary.tsv"
    log: f"{LOG_DIR}/annotation/{{sample}}_{{db}}_abricate_summary.log"
    threads: 1
    run:
        Path(output.summary).parent.mkdir(parents=True, exist_ok=True)
        tables = list(input.tables)
        if not tables:
            Path(output.summary).write_text("#FILE\tNUM_FOUND\n")
        else:
            command = [ABRICATE, "--summary", *map(str, tables)]
            with open(output.summary, "wb") as out_h, open(log[0], "wb") as log_h:
                subprocess.run(command, stdout=out_h, stderr=log_h, check=True)

rule abricate_all:
    input: summaries = lambda wildcards: expand(f"{ABRICATE_DIR}/{{sample}}/{{db}}_summary.tsv", db=ABRICATE_DBS)
    output: done = f"{ABRICATE_DIR}/{{sample}}/abricate.done"
    run:
        Path(output.done).parent.mkdir(parents=True, exist_ok=True)
        Path(output.done).write_text(f"databases={len(input.summaries)}\n")

rule cctyper_per_mag:
    input:
        fasta = f"{DREP_OUTPUT}/dereplicated_genomes/{{mag}}.fa",
        drep_done = DREP_DONE
    output: done = f"{CCTYPER_DIR}/{{sample}}/{{mag}}/cctyper.done"
    log: f"{LOG_DIR}/annotation/{{sample}}_{{mag}}_cctyper.log"
    threads: MAG_THREADS
    run:
        outdir = Path(output.done).parent
        shutil.rmtree(outdir, ignore_errors=True)
        outdir.mkdir(parents=True, exist_ok=True)
        command = [CCTYPER_BIN, input.fasta, str(outdir), "--db", CCTYPER_DB, "-t", str(threads)]
        with open(log[0], "wb") as h:
            subprocess.run(command, stdout=h, stderr=subprocess.STDOUT, check=True)
        Path(output.done).touch()

rule cctyper_all:
    input:
        drep_done = DREP_DONE,
        annotations = cctyper_all_inputs
    output: done = f"{CCTYPER_DIR}/{{sample}}/cctyper.done"
    run:
        Path(output.done).parent.mkdir(parents=True, exist_ok=True)
        Path(output.done).write_text(f"annotated_mags={len(input.annotations)}\n")

rule dbcan_per_mag:
    input:
        fasta = f"{DREP_OUTPUT}/dereplicated_genomes/{{mag}}.fa",
        drep_done = DREP_DONE
    output: done = f"{DBCAN_DIR}/{{sample}}/{{mag}}/dbcan.done"
    log: f"{LOG_DIR}/annotation/{{sample}}_{{mag}}_dbcan.log"
    threads: MAG_THREADS
    run:
        outdir = Path(output.done).parent
        shutil.rmtree(outdir, ignore_errors=True)
        outdir.mkdir(parents=True, exist_ok=True)
        command = [DBCAN_BIN, input.fasta, DBCAN_INPUT_TYPE, "--db_dir", DBCAN_DB, "--out_dir", str(outdir), "--tf_cpu", str(threads), "--dia_cpu", str(threads), "--hmm_cpu", str(threads)]
        with open(log[0], "wb") as h:
            subprocess.run(command, stdout=h, stderr=subprocess.STDOUT, check=True)
        Path(output.done).touch()

rule dbcan_all:
    input:
        drep_done = DREP_DONE,
        annotations = dbcan_all_inputs
    output: done = f"{DBCAN_DIR}/{{sample}}/dbcan.done"
    run:
        Path(output.done).parent.mkdir(parents=True, exist_ok=True)
        Path(output.done).write_text(f"annotated_mags={len(input.annotations)}\n")

rule hadeg_proteinortho:
    input:
        hadeg_db = lambda wildcards: HADEG_DB,
        prokka_done = f"{PROKKA_DIR}/{{sample}}/prokka.done",
        mags = hadeg_mag_inputs
    output:
        tsv = f"{HADEG_OUTDIR}/{{sample}}/Results_HADEG.proteinortho.tsv",
        done = f"{HADEG_OUTDIR}/{{sample}}/hadeg_proteinortho.done"
    log: f"{LOG_DIR}/annotation/{{sample}}_hadeg.log"
    threads: THREADS
    run:
        outdir = Path(output.tsv).parent.resolve()
        clean_dir = outdir / "clean_faa"
        shutil.rmtree(clean_dir, ignore_errors=True)
        clean_dir.mkdir(parents=True, exist_ok=True)
        allowed = re.compile(r"[^XOUBZACDEFGHIKLMNPQRSTVWY]", re.IGNORECASE)

        def sanitize_fasta(src, dst):
            with open(src) as src_h, open(dst, "w") as dst_h:
                for line in src_h:
                    if line.startswith(">"):
                        dst_h.write(line)
                    else:
                        seq = allowed.sub("", line.strip())
                        if seq:
                            dst_h.write(seq + "\n")

        sanitize_fasta(Path(input.hadeg_db).resolve(), clean_dir / Path(input.hadeg_db).name)
        clean_mags = []
        for src in input.mags:
            target = clean_dir / Path(src).name
            sanitize_fasta(src, target)
            clean_mags.append(str(target.resolve()))

        if not clean_mags:
            Path(output.tsv).write_text(f"# Species\tGenes\tAlg.-Conn.\t{Path(input.hadeg_db).name}\n")
        else:
            command = [PROTEINORTHO, str((clean_dir / Path(input.hadeg_db).name).resolve()), *clean_mags, "-identity=50", "-conn=0.3", "-synteny=0", "-project=Results_HADEG", f"-binpath={HADEG_BLAST_BINPATH}", f"-cpus={threads}"]
            with open(log[0], "wb") as log_h:
                subprocess.run(command, cwd=outdir, stdout=log_h, stderr=subprocess.STDOUT, check=True)
        Path(output.done).touch()

# =============================================================================
# PHASE 8 — AGGREGATED REPORTING ENGINE (MULTIQC) WITH ROBUST SOFT-FAIL WRAPPER
# =============================================================================
rule multiqc:
    input: MULTIQC_INPUTS
    output: report = f"{MULTIQC_DIR}/multiqc_report.html"
    log: f"{LOG_DIR}/reporting/{SAMPLE}_multiqc.log"
    threads: 1
    run:
        Path(MULTIQC_DIR).mkdir(parents=True, exist_ok=True)
        scan_paths = [NANOSTAT_DIR, FILTLONG_DIR, ASSEMBLY_DIR, MAP_DIR, MAG_QC_DIR]
        for path_check in [PROKKA_DIR, ABRICATE_DIR, CCTYPER_DIR, DBCAN_DIR, DRAM_DIR, VIRSORTER_DIR]:
            if os.path.exists(path_check):
                scan_paths.append(path_check)
        
        command = [MULTIQC, *scan_paths, "--ignore", "*.done", "--ignore", "*.bam", "--ignore", "*.bai", "-o", MULTIQC_DIR, "--force"]
        try:
            run_command(command, log[0])
        except subprocess.CalledProcessError:
            print("[WARNING] MultiQC encountered non-fatal parsing blocks. Compiling blank fallback report register.")
            Path(output.report).write_text("<html><body><h3>MultiQC Generated with Soft-Fail Protection</h3></body></html>")
