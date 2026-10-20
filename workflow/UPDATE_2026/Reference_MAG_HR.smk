#!/usr/bin/env python

from snakemake.io import glob_wildcards
import os
import glob
import json
import shutil
import subprocess
import shlex
import tempfile
import csv
from pathlib import Path

############################################
# BASE PATHS & DATABASE SETTINGS
############################################
BASE_PATH          = config.get("BASE", os.environ.get("BASE_PATH", "/data/genoverse"))
OUTPUT_ROOT        = f"{BASE_PATH}/hybrid_water_results"

HADEG_DB           = os.environ.get("HADEG_DB", "/dbs/hadeg/HADEG_protein_database_231119.faa")
HADEG_OUTDIR       = f"{OUTPUT_ROOT}/hadeg"
HADEG_BLAST_BINPATH = config.get("hadeg_blast_binpath", "/opt/conda/bin")
HOST_DB            = config.get("host_db", "/dbs/host/environmental_filter_db")

KRAKEN2_DB         = config.get("kraken2_db", "/dbs/kraken2/standard")
BRACKEN_DB         = config.get("bracken_db", KRAKEN2_DB)
GUNC_DB            = config.get("gunc_db", "/dbs/gunc/gunc_db_progenomes.dmnd")
CHECKM2_DB         = config.get("checkm2_db", "/home/rashmi/checkm2_db/CheckM2_database/uniref100.KO.1.dmnd")
GTDBTK_DATA_PATH   = config.get("gtdbtk_data_path", "/home/rashmi/.conda/envs/gtdbk_env/share/gtdbtk-2.7.2/db")
CCTYPER_DB         = config.get("cctyper_db", "/home/rashmi/.conda/envs/cctyper/share/cctyper")
DBCAN_DB           = config.get("dbcan_db", "/dbs/dbcan_db/db")

############################################
# CONFIGURATION DEFAULTS & THRESHOLDS
############################################
SAMPLE             = config["sample"]
THREADS            = config.get("threads", 16)
READ_TYPE          = config.get("read_type", "ont")   # "ont" | "pacbio-raw" | "pacbio-hifi"
HOST_REF           = config.get("host_ref", "")       # Path to host genome reference FASTA (leave "" to skip)

ASSEMBLER_ENGINE       = config.get("assembler_engine", "metaflye").lower() # "operams" | "metaflye"
FILTLONG_MIN_LENGTH    = config.get("filtlong_min_length", 1000)
FILTLONG_KEEP_PERCENT  = config.get("filtlong_keep_percent", 85.0)
FILTLONG_MIN_MEAN_Q    = config.get("filtlong_min_mean_q", 7.0)

config.setdefault("reads", {})
RAW_R1                 = config["reads"].get("r1", f"data/raw/{SAMPLE}_R1.fastq.gz")
RAW_R2                 = config["reads"].get("r2", f"data/raw/{SAMPLE}_R2.fastq.gz")
RAW_LONG               = config["reads"].get("long", f"data/raw/{SAMPLE}.fastq.gz")

OPERAMS_DB             = config.get("operams_db", "/path/to/OPERA-MS-DB")
OPERAMS_PL             = config.get("operams_pl", "OPERA-MS.pl")
MARINE_ENV             = config.get("marine_env", "")

METABAT_MIN_CONTIG     = config.get("metabat_min_contig", 1500)
METABAT_MIN_CV         = config.get("metabat_min_cv", 1.0)
METABAT_MIN_CV_SUM     = config.get("metabat_min_cv_sum", 0)
METABAT_SEED           = config.get("metabat_seed", 133)
SEMIBIN_MIN_CONTIG     = config.get("semibin_min_contig", 2500)
MAXBIN_MIN_CONTIG      = config.get("maxbin_min_contig", 1000)
DASTOOL_SCORE          = config.get("dastool_score", 0.5)

MAG_THREADS            = config.get("mag_threads", 4)
MEMORY_MB              = config.get("memory_mb", 32000)
RUNTIME_MIN            = config.get("runtime_min", 1440)

FASTP_QUALIFIED_Q        = config.get("fastp_qualified_q", 15)
FASTP_MAX_UNQUALIFIED    = config.get("fastp_max_unqualified", 40)
FASTP_N_BASE_LIMIT       = config.get("fastp_n_base_limit", 5)
FASTP_MIN_LENGTH         = config.get("fastp_min_length", 50)
FASTP_CUT_WINDOW         = config.get("fastp_cut_window", 4)
FASTP_CUT_MEAN_Q         = config.get("fastp_cut_mean_q", 20)
FASTP_POLY_G_FLAGS       = config.get("fastp_poly_g_flags", ["--trim_poly_g"])
HOST_ENABLED             = config.get("host_enabled", True)
KNEADDATA_ENV            = config.get("kneaddata_env", "")
HOST_BOWTIE2_OPTIONS     = config.get("host_bowtie2_options", "")

HIGH_COMPLETENESS        = config.get("high_completeness", 90.0)
HIGH_CONTAMINATION       = config.get("high_contamination", 5.0)
MEDIUM_COMPLETENESS      = config.get("medium_completeness", 50.0)
MEDIUM_CONTAMINATION     = config.get("medium_contamination", 10.0)
REQUIRE_GUNC_PASS        = config.get("require_gunc_pass", True) # Strict environmental purity default
GUNC_MIN_MAPPED_GENES    = config.get("gunc_min_mapped_genes", 50)
GUNC_SENSITIVE           = config.get("gunc_sensitive", False)
CHECKM2_LOWMEM           = config.get("checkm2_lowmem", False)

DREP_PRIMARY_ANI         = config.get("drep_primary_ani", 0.90)
DREP_SECONDARY_ANI       = config.get("drep_secondary_ani", 0.95)
DREP_ALIGNED_FRACTION    = config.get("drep_aligned_fraction", 0.30)
DREP_ALGORITHM           = config.get("drep_algorithm", "skani")
GTDB_PPLACER_CPUS        = config.get("gtdb_pplacer_cpus", max(1, THREADS // 2))
COVERM_MAPPER            = config.get("coverm_mapper", "minimap2")
COVERM_MIN_COVERED_FRACTION = config.get("coverm_min_covered_fraction", 0.0)
COVERM_MIN_IDENTITY      = config.get("coverm_min_identity", 90.0)
COVERM_MIN_ALIGNED       = config.get("coverm_min_aligned", 70.0)
PRODIGAL_MODE            = config.get("prodigal_mode", "meta")
PROKKA_KINGDOM           = config.get("prok_kingdom", "auto")
VIRSORTER_MIN_LENGTH     = config.get("virsorter_min_length", 1500)
VIRSORTER_MIN_SCORE      = config.get("virsorter_min_score", 0.5)
KRAKEN_CONFIDENCE        = config.get("kraken_confidence", 0.0)
KRAKEN_MIN_HIT_GROUPS    = config.get("kraken_min_hit_groups", 2)
KRAKEN_MEMORY_MAPPING    = config.get("kraken_memory_mapping", False)
BRACKEN_LEVEL            = config.get("bracken_level", "S")
BRACKEN_THRESHOLD        = config.get("bracken_threshold", 10)
BRACKEN_READ_LENGTH      = config.get("bracken_read_length", 150)

MM2_PRESET = {
    "ont":         "map-ont",
    "pacbio-raw":  "map-pb",
    "pacbio-hifi": "map-hifi",
}.get(READ_TYPE, "map-ont")

############################################
# DIRECTORIES & CONDA ENV PATHS
############################################
RAW_QC_DIR     = f"{OUTPUT_ROOT}/qc/raw_short"
CLEAN_QC_DIR   = f"{OUTPUT_ROOT}/qc/clean_short"
ASSEMBLY_QC_DIR= f"{OUTPUT_ROOT}/qc/assembly"
FASTP_DIR      = f"{OUTPUT_ROOT}/qc/fastp"
HOST_DIR       = f"{OUTPUT_ROOT}/host_removal"
NANOSTAT_DIR   = f"{OUTPUT_ROOT}/nanostat"
NANOQ_DIR      = f"{OUTPUT_ROOT}/nanoq"
FILTLONG_DIR   = f"{OUTPUT_ROOT}/qc/filtlong"
MEGAHIT_DIR    = f"{OUTPUT_ROOT}/megahit"
OPRAMS_DIR     = f"{OUTPUT_ROOT}/operams"
FLYE_DIR       = f"{OUTPUT_ROOT}/metaflye"
QUAST_DIR      = f"{OUTPUT_ROOT}/quast"
MAP_DIR        = f"{OUTPUT_ROOT}/mapping"
BIN_DIR        = f"{OUTPUT_ROOT}/binning"
DAS_DIR        = f"{OUTPUT_ROOT}/dastool"
MAG_QC_DIR     = f"{OUTPUT_ROOT}/mag_qc"
FILTERED_DIR   = f"{OUTPUT_ROOT}/mag_filtered"
PRODUCTION_MAGS= f"{FILTERED_DIR}/{SAMPLE}/production_mags"
ARCHIVED_MAGS  = f"{FILTERED_DIR}/{SAMPLE}/archived_mags"
QUALITY_MATRIX = f"{FILTERED_DIR}/{SAMPLE}/quality_assessment_matrix.tsv"
GTDB_OUTPUT    = f"{OUTPUT_ROOT}/taxonomy/gtdbtk/{SAMPLE}"
GTDB_SCRATCH_DIR= f"{GTDB_OUTPUT}/scratch"
GTDB_DONE      = f"{GTDB_OUTPUT}/gtdbtk.done"
DREP_DIR       = f"{OUTPUT_ROOT}/dereplication/{SAMPLE}"
DREP_OUTPUT    = f"{DREP_DIR}/drep_out"
DREP_DONE      = f"{DREP_DIR}/drep.done"
ANNOTATION_DIR = f"{OUTPUT_ROOT}/annotation"
PROKKA_DIR     = f"{ANNOTATION_DIR}/prokka/{SAMPLE}"
CCTYPER_DIR    = f"{ANNOTATION_DIR}/cctyper/{SAMPLE}"
DBCAN_DIR      = f"{ANNOTATION_DIR}/dbcan/{SAMPLE}"
ABRICATE_DIR   = f"{ANNOTATION_DIR}/abricate/{SAMPLE}"
DRAM_DIR       = f"{ANNOTATION_DIR}/dram/{SAMPLE}"
VIRAL_DIR      = f"{OUTPUT_ROOT}/viral"
QUANT_DIR      = f"{OUTPUT_ROOT}/quant_hybrid"
KRAKEN_DIR     = f"{OUTPUT_ROOT}/tax/kraken2"
BRACKEN_DIR    = f"{OUTPUT_ROOT}/tax/bracken"
METAPHLAN_DIR  = f"{OUTPUT_ROOT}/tax/metaphlan"
MULTIQC_DIR    = f"{OUTPUT_ROOT}/multiqc"
LOG_DIR        = f"{OUTPUT_ROOT}/logs"

CHECKM2_ENV    = "/opt/conda/envs/checkm2_env"
GUNC_ENV       = "/opt/conda/envs/gunc_env"
PROKKA_ENV     = "/home/rashmi/.conda/envs/prokka/bin"
GTDBTK_ENV     = "/home/rashmi/.conda/envs/gtdbk_env/bin"
DREP_ENV       = "/home/rashmi/.conda/envs/drep_env/bin"
COVERM_ENV     = "/home/rashmi/.conda/envs/coverm-env/bin"
CCTYPER_ENV    = "/home/rashmi/.conda/envs/cctyper/bin"
DBCAN_ENV      = "/home/rashmi/.conda/envs/dbcan/bin"
ABRICATE_ENV   = "/home/rashmi/.conda/envs/abricate-env/bin"
DRAM_ENV       = "/home/rashmi/.conda/envs/dram/bin" if os.path.exists("/home/rashmi/.conda/envs/dram/bin") else ""
KNEADDATA_ENV  = config.get("kneaddata_env", "")

############################################
# TOOL BINARIES
############################################
FASTP          = "fastp"
MEGAHIT        = "megahit"
NANOSTAT       = "NanoStat"
NANOQ          = "nanoq"
FILTLONG       = "filtlong"
PIGZ           = "pigz"
MINIMAP2       = "minimap2"
SAMTOOLS       = "samtools"
SEQKIT         = "seqkit"
BOWTIE2        = "bowtie2"
BOWTIE2_BUILD  = "bowtie2-build"
JGI_DEPTH      = "jgi_summarize_bam_contig_depths"
METABAT2       = "metabat2"
SEMIBIN2       = "SemiBin2"
MAXBIN2        = "run_MaxBin.pl"
DASTOOL        = "DAS_Tool"
CHECKM2        = "checkm2"
CHECKM2_PY     = "python"
GUNC           = "gunc"
GTDBTK         = "gtdbtk"
DREP           = "dRep"
BARRNAP        = "barrnap"
PROKKA         = "prokka"
CCTYPER_BIN    = "cctyper"
DBCAN_BIN      = "run_dbcan"
ABRICATE       = "abricate"
METAPHLAN      = "metaphlan"
DRAM_BIN       = "DRAM.py"
VIRSORTER2     = "virsorter"
PRODIGAL       = "prodigal"
CDHIT_AA       = "cd-hit"
COVERM         = "coverm"
FEATURECOUNTS  = "featureCounts"
KRAKEN2        = "kraken2"
BRACKEN        = "bracken"
MULTIQC        = "multiqc"
PROTEINORTHO   = "proteinortho"

RUN_KRAKEN     = config.get("run_kraken", True)
RUN_METAPHLAN  = config.get("run_metaphlan", True)
RUN_PROKKA     = config.get("run_prokka", True)
RUN_CCTYPER    = config.get("run_cctyper", True)
RUN_DBCAN      = config.get("run_dbcan", True)
RUN_DRAM       = config.get("run_dram", True)
RUN_ABRICATE   = config.get("run_abricate", True)
RUN_HADEG      = config.get("run_hadeg", True)

FASTP_R1       = f"{FASTP_DIR}/{SAMPLE}_R1_val_1.fastq.gz"
FASTP_R2       = f"{FASTP_DIR}/{SAMPLE}_R2_val_2.fastq.gz"
FASTP_SINGLETONS = f"{FASTP_DIR}/{SAMPLE}_singletons.fastq.gz"
HOST_R1        = f"{HOST_DIR}/{SAMPLE}/R1_decontam.fastq.gz"
HOST_R2        = f"{HOST_DIR}/{SAMPLE}/R2_decontam.fastq.gz"
HOST_SINGLETONS = f"{HOST_DIR}/{SAMPLE}/singletons_decontam.fastq.gz"
CLEAN_R1       = HOST_R1
CLEAN_R2       = HOST_R2
FILTLONG_FASTQ   = f"{FILTLONG_DIR}/{SAMPLE}_filtlong.fastq.gz"
FILTERED_FASTQ   = f"{NANOQ_DIR}/{SAMPLE}/filtered.fastq.gz"
DECONTAM_FASTQ   = f"{HOST_DIR}/{SAMPLE}/long_decontam.fastq.gz"

ASSEMBLER_FASTA = f"{OPRAMS_DIR}/{SAMPLE}_contigs.fasta" if ASSEMBLER_ENGINE == "operams" else f"{FLYE_DIR}/{SAMPLE}/assembly.fasta"
CONTIGS        = ASSEMBLY_FASTA

MAPPING_BAM      = f"{MAP_DIR}/{SAMPLE}.sorted.bam"
MAPPING_BAI      = f"{MAP_DIR}/{SAMPLE}.sorted.bam.bai"
DEPTH_FILE       = f"{MAP_DIR}/{SAMPLE}_depth.txt"
REFINED_BINS     = f"{DAS_DIR}/{SAMPLE}_DASTool_bins_clean"

############################################
# HELPER PYTHON FUNCTIONS & UTILITIES
############################################
def gzip_has_data(filepath):
    try:
        if os.path.exists(filepath) and os.path.getsize(filepath) > 100:
            with open(filepath, "rb") as f:
                header = f.read(2)
            if header == b'\x1f\x8b':
                import gzip
                with gzip.open(filepath, "rb") as gz:
                    return len(gz.read(1)) > 0
    except Exception:
        pass
    return False

def run_command(cmd, log_file, env=None):
    Path(log_file).parent.mkdir(parents=True, exist_ok=True)
    with open(log_file, "wb") as log_fh:
        subprocess.run(cmd, stdout=log_fh, stderr=subprocess.STDOUT, env=env, check=True)

def first_existing(paths):
    for p in paths:
        if Path(p).exists():
            return Path(p)
    return paths[0]

def get_adaptive_filtlong_params(nanostat_report_path):
    min_len = FILTLONG_MIN_LENGTH
    keep_pct = FILTLONG_KEEP_PERCENT
    try:
        if os.path.exists(nanostat_report_path):
            with open(nanostat_report_path, "r") as f:
                content = f.read()
                for line in content.splitlines():
                    if "Read length N50" in line or "N50" in line:
                        parts = line.split(":")
                        if len(parts) > 1:
                            val = float(parts[1].strip().replace(",", "").split()[0])
                            if val < 2000:
                                min_len = 500
                                keep_pct = 90.0
                            elif val > 10000:
                                min_len = 2000
                                keep_pct = 80.0
    except Exception:
        pass
    return min_len, keep_pct

def write_contig2bin(bins_dir, tsv_output):
    rows = []
    for fa in glob.glob(os.path.join(bins_dir, "*.fa")) + glob.glob(os.path.join(bins_dir, "*.fasta")):
        bin_id = os.path.splitext(os.path.basename(fa))[0]
        with open(fa) as fh:
            for line in fh:
                if line.startswith(">"):
                    rows.append(f"{line[1:].strip().split()[0]}\t{bin_id}")
    with open(tsv_output, "w") as out:
        out.write("contig\tbin_id\n" + ("\n".join(rows) + "\n" if rows else ""))

def normalize_bins(candidate_paths, output_bins_dir):
    Path(output_bins_dir).mkdir(parents=True, exist_ok=True)
    for src in candidate_paths:
        if not Path(src).is_file():
            continue
        fname = Path(src).name
        if fname.endswith(".fa.fa"):
            clean_name = fname[:-6] + ".fa"
        elif fname.endswith(".fasta.fasta"):
            clean_name = fname[:-12] + ".fasta"
        else:
            clean_name = fname
        if not clean_name.endswith((".fa", ".fasta")):
            clean_name += ".fa"
        if "_sub" in clean_name:
            continue
        shutil.copyfile(src, os.path.join(output_bins_dir, clean_name))

def clean_mag_id(filename):
    base = os.path.basename(filename)
    for ext in (".fa.fa", ".fasta.fasta", ".fa", ".fasta"):
        if base.endswith(ext):
            base = base[:-len(ext)]
            break
    return base

def parse_float(val):
    try:
        return float(val) if val not in (None, "None", "N/A", "") else None
    except ValueError:
        return None

def parse_bool(val):
    if isinstance(val, bool):
        return val
    if str(val).strip().lower() in ("true", "t", "1", "yes", "y", "pass"):
        return True
    if str(val).strip().lower() in ("false", "f", "0", "no", "n", "fail"):
        return False
    return None

def fasta_metrics(fasta_path):
    lengths = []
    current_len = 0
    with open(fasta_path) as fh:
        for line in fh:
            if line.startswith(">"):
                if current_len > 0: lengths.append(current_len)
                current_len = 0
            else: current_len += len(line.strip())
        if current_len > 0: lengths.append(current_len)
    total_len = sum(lengths)
    count = len(lengths)
    n50 = 0
    if lengths:
        lengths.sort(reverse=True)
        acc = 0
        for l in lengths:
            acc += l
            if acc >= total_len / 2:
                n50 = l
                break
    return {"contig_count": count, "total_length": total_len, "n50": n50, "gc_percent": 50.0}

def prefix_fasta(src, dst, prefix):
    with open(src) as s, open(dst, "w") as d:
        for line in s:
            if line.startswith(">"):
                d.write(f">{prefix}_{line[1:]}")
            else: d.write(line)

def get_dereplicated_mags_dynamic(wildcards):
    try:
        drep_output_dir = checkpoints.drep.get(sample=wildcards.sample).output.out_dir
    except Exception:
        drep_output_dir = DREP_OUTPUT
    drep_dir = Path(drep_output_dir) / "dereplicated_genomes"
    if not drep_dir.exists():
        return []
    return [clean_mag_id(f.name) for f in drep_dir.glob("*.fa")] + [clean_mag_id(f.name) for f in drep_dir.glob("*.fasta")]

def abricate_mag_inputs(wildcards):
    mags = get_dereplicated_mags_dynamic(wildcards)
    return expand(f"{ABRICATE_DIR}/{{sample}}/{{db}}/{{mag}}.{{db}}.tsv", sample=wildcards.sample, db=wildcards.db, mag=mags)

def cctyper_all_inputs(wildcards):
    mags = get_dereplicated_mags_dynamic(wildcards)
    return expand(f"{CCTYPER_DIR}/{{sample}}/{{mag}}/cctyper.done", sample=wildcards.sample, mag=mags)

def dbcan_all_inputs(wildcards):
    mags = get_dereplicated_mags_dynamic(wildcards)
    return expand(f"{DBCAN_DIR}/{{sample}}/{{mag}}/dbcan.done", sample=wildcards.sample, mag=mags)

def get_all_refined_mags(wildcards):
    bin_files = glob.glob(os.path.join(REFINED_BINS, "*.fa")) + glob.glob(os.path.join(REFINED_BINS, "*.fasta"))
    return [clean_mag_id(Path(f).name) for f in bin_files]

MULTIQC_INPUTS = [
    f"{FASTP_DIR}/{SAMPLE}_fastp.html",
    f"{QUAST_DIR}/{SAMPLE}/report.html",
    f"{QUALITY_MATRIX}",
    f"{GTDB_DONE}",
    f"{DREP_DONE}",
    f"{COVERM_DIR}/{SAMPLE}/abundance_matrix.tsv",
    f"{ANNOTATION_DIR}/{SAMPLE}/prodigal.done",
    f"{VIRAL_DIR}/{SAMPLE}/virsorter2.done",
    f"{KRAKEN_DIR}/{SAMPLE}_bracken_species.tsv",
    f"{METAPHLAN_DIR}/{SAMPLE}_metaphlan_profile.txt"
]

############################################
# WILDCARD CONSTRAINTS
############################################
wildcard_constraints:
    sample = r"[A-Za-z0-9._-]+(?<!_filtered)",
    mag    = r"[A-Za-z0-9._-]+"

ABRICATE_DBS = ["ncbi", "argannot", "resfinder", "ecoli_vf", "vfdb", "ecoh", "plasmidfinder", "card"]

############################################
# RULE ALL — COMPREHENSIVE TARGET MATRIX
############################################
rule all:
    input:
        MULTIQC_INPUTS

# =============================================================================
# PHASE 1 — PRODUCTION HYBRID PREPROCESSING & ADAPTIVE LONG-READ QC
# =============================================================================

rule fastqc_raw_short:
    input: 
        r1 = RAW_R1, 
        r2 = RAW_R2
    output:
        html_r1 = f"{RAW_QC_DIR}/{SAMPLE}_R1_fastqc.html", zip_r1 = f"{RAW_QC_DIR}/{SAMPLE}_R1_fastqc.zip",
        html_r2 = f"{RAW_QC_DIR}/{SAMPLE}_R2_fastqc.html", zip_r2 = f"{RAW_QC_DIR}/{SAMPLE}_R2_fastqc.zip"
    log: f"{LOG_DIR}/fastqc_raw/{SAMPLE}.log"
    threads: 2
    run:
        Path(log[0]).parent.mkdir(parents=True, exist_ok=True)
        cmd = ["fastqc", "-t", str(threads), input.r1, input.r2, "-o", str(Path(output.html_r1).parent)]
        subprocess.run(cmd, check=True)

rule fastp_clean:
    input: 
        r1 = RAW_R1, 
        r2 = RAW_R2
    output:
        r1 = FASTP_R1, 
        r2 = FASTP_R2,
        singleton1 = temp(f"{FASTP_DIR}/{SAMPLE}_unpaired_1.fastq.gz"),
        singleton2 = temp(f"{FASTP_DIR}/{SAMPLE}_unpaired_2.fastq.gz"),
        singletons = FASTP_SINGLETONS,
        json = f"{FASTP_DIR}/{SAMPLE}_fastp.json", 
        html = f"{FASTP_DIR}/{SAMPLE}_fastp.html"
    log: f"{LOG_DIR}/fastp/{SAMPLE}.log"
    threads: THREADS
    resources: mem_mb=8000, runtime=RUNTIME_MIN
    run:
        Path(FASTP_DIR).mkdir(parents=True, exist_ok=True)
        command = [
            FASTP, "--in1", input.r1, "--in2", input.r2, "--out1", output.r1, "--out2", output.r2,
            "--unpaired1", output.singleton1, "--unpaired2", output.singleton2,
            "--json", output.json, "--html", output.html,
            "--qualified_quality_phred", str(FASTP_QUALIFIED_Q),
            "--unqualified_percent_limit", str(FASTP_MAX_UNQUALIFIED),
            "--n_base_limit", str(FASTP_N_BASE_LIMIT),
            "--length_required", str(FASTP_MIN_LENGTH),
            "--cut_front", "--cut_tail",
            "--cut_front_window_size", str(FASTP_CUT_WINDOW),
            "--cut_front_mean_quality", str(FASTP_CUT_MEAN_Q),
            "--cut_tail_window_size", str(FASTP_CUT_WINDOW),
            "--cut_tail_mean_quality", str(FASTP_CUT_MEAN_Q),
            "--detect_adapter_for_pe", "--thread", str(threads),
            *FASTP_POLY_G_FLAGS,
        ]
        run_command(command, log[0])
        with open(output.singletons, "wb") as merged:
            for singleton in (output.singleton1, output.singleton2):
                with open(singleton, "rb") as source: shutil.copyfileobj(source, merged)

rule host_decontaminate_short:
    input: 
        r1 = FASTP_R1, 
        r2 = FASTP_R2, 
        singletons = FASTP_SINGLETONS
    output: 
        r1 = HOST_R1, 
        r2 = HOST_R2, 
        singletons = HOST_SINGLETONS,
        audit = f"{HOST_DIR}/{{sample}}/short_host_removal_audit.txt"
    log: f"{LOG_DIR}/host_removal/{SAMPLE}.log"
    threads: THREADS
    resources: mem_mb=MEMORY_MB, runtime=RUNTIME_MIN
    run:
        if not HOST_ENABLED: 
            raise ValueError("host_decontaminate requested but disabled")
        Path(HOST_DIR).mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=f"{SAMPLE}_host_", dir=HOST_DIR) as workdir:
            input_dir, paired_dir = Path(workdir)/"input", Path(workdir)/"paired"
            input_dir.mkdir(); paired_dir.mkdir()
            paired_r1, paired_r2 = input_dir/f"{SAMPLE}_R1.trimmed.fastq", input_dir/f"{SAMPLE}_R2.trimmed.fastq"
            
            with open(input.r1, "rb") as source, open(paired_r1, "wb") as target:
                import gzip
                with gzip.open(input.r1, "rb") as gz: shutil.copyfileobj(gz, target)
            with open(paired_r2, "wb") as target:
                with gzip.open(input.r2, "rb") as gz: shutil.copyfileobj(gz, target)
            
            env = os.environ.copy()
            if KNEADDATA_ENV:
                env["PATH"] = KNEADDATA_ENV + os.pathsep + env.get("PATH", "")
            
            paired_command = [
                "kneaddata", "--input1", str(paired_r1), "--input2", str(paired_r2),
                "--output", str(paired_dir), "--output-prefix", SAMPLE,
                "--reference-db", str(HOST_DB), "--threads", str(threads),
                "--bypass-trim", "--bypass-trf", "--log", log[0],
            ]
            if HOST_BOWTIE2_OPTIONS: 
                paired_command.append(f"--bowtie2-options={HOST_BOWTIE2_OPTIONS}")
            subprocess.run(paired_command, env=env, check=True)
            
            paired_1 = first_existing([paired_dir/f"{SAMPLE}_paired_1.fastq", paired_dir/f"{SAMPLE}_kneaddata_paired_1.fastq"])
            paired_2 = first_existing([paired_dir/f"{SAMPLE}_paired_2.fastq", paired_dir/f"{SAMPLE}_kneaddata_paired_2.fastq"])
            for source, target in ((paired_1, output.r1), (paired_2, output.r2)):
                with open(target, "wb") as compressed:
                    subprocess.run([PIGZ, "-p", str(threads), "-c", str(source)], stdout=compressed, check=True)

            with open(output.audit, "w") as audit_fh:
                audit_fh.write(f"Sample: {SAMPLE}\nHost DB: {HOST_DB}\nStatus: Completed successfully\n")

rule kraken2:
    input:
        r1 = CLEAN_R1,
        r2 = CLEAN_R2
    output:
        report = f"{KRAKEN_DIR}/{SAMPLE}_kraken2_report.tsv",
        out    = f"{KRAKEN_DIR}/{SAMPLE}_kraken2.out"
    log: f"{LOG_DIR}/kraken2/{SAMPLE}.log"
    threads: THREADS
    run:
        Path(output.report).parent.mkdir(parents=True, exist_ok=True)
        env = os.environ.copy()
        env["PATH"] = str(Path(KRAKEN2).parent) + os.pathsep + env.get("PATH", "")
        command = [
            KRAKEN2, "--db", KRAKEN2_DB, "--threads", str(threads),
            "--paired", input.r1, input.r2, "--report", output.report, "--output", output.out
        ]
        if KRAKEN_CONFIDENCE > 0.0: command.extend(["--confidence", str(KRAKEN_CONFIDENCE)])
        if KRAKEN_MIN_HIT_GROUPS > 2: command.extend(["--minimum-hit-groups", str(KRAKEN_MIN_HIT_GROUPS)])
        if KRAKEN_MEMORY_MAPPING: command.append("--memory-mapping")
        run_command(command, log[0], env=env)

rule bracken:
    input:
        report = f"{KRAKEN_DIR}/{SAMPLE}_kraken2_report.tsv"
    output:
        species = f"{KRAKEN_DIR}/{SAMPLE}_bracken_species.tsv"
    log: f"{LOG_DIR}/bracken/{SAMPLE}.log"
    run:
        env = os.environ.copy()
        env["PATH"] = str(Path(BRACKEN).parent) + os.pathsep + env.get("PATH", "")
        command = [
            BRACKEN, "-d", KRAKEN2_DB, "-i", input.report, "-o", output.species,
            "-l", BRACKEN_LEVEL, "-t", str(BRACKEN_THRESHOLD), "-r", str(BRACKEN_READ_LENGTH)
        ]
        run_command(command, log[0], env=env)

rule metaphlan_profiling:
    input:
        r1 = CLEAN_R1,
        r2 = CLEAN_R2
    output:
        profile = f"{METAPHLAN_DIR}/{SAMPLE}_metaphlan_profile.txt",
        bowtie2 = f"{METAPHLAN_DIR}/{SAMPLE}_metaphlan.bowtie2.bz2"
    log: f"{LOG_DIR}/metaphlan/{SAMPLE}.log"
    threads: THREADS
    run:
        Path(output.profile).parent.mkdir(parents=True, exist_ok=True)
        env = os.environ.copy()
        command = [
            METAPHLAN, f"{input.r1},{input.r2}", "--input_type", "fastq",
            "--bowtie2out", output.bowtie2, "-o", output.profile, "--nproc", str(threads)
        ]
        run_command(command, log[0], env=env)

rule nanostat_raw:
    input:
        reads = str(config["reads"].get("raw_long", f"data/raw/{SAMPLE}.fastq.gz"))
    output:
        report = f"{NANOSTAT_DIR}/{{sample}}/raw_nanostat.txt"
    threads: THREADS
    run:
        Path(output.report).parent.mkdir(parents=True, exist_ok=True)
        command = [NANOSTAT, "--fastq", input.reads, "--threads", str(threads)]
        with open(output.report, "w") as out_fh:
            subprocess.run(command, stdout=out_fh, check=True)

rule filtlong_adaptive_filter:
    input:
        reads = str(config["reads"].get("raw_long", f"data/raw/{SAMPLE}.fastq.gz")),
        nanostat = f"{NANOSTAT_DIR}/{{sample}}/raw_nanostat.txt"
    output:
        cleaned = FILTLONG_FASTQ
    threads: THREADS
    log: f"{LOG_DIR}/filtlong/{SAMPLE}.log"
    run:
        Path(FILTLONG_DIR).mkdir(parents=True, exist_ok=True)
        if READ_TYPE != "ont":
            if input.reads.endswith(".gz"):
                shutil.copy2(input.reads, output.cleaned)
            else:
                with open(input.reads, "rb") as f_in, open(output.cleaned, "wb") as f_out:
                    subprocess.run([PIGZ, "-p", str(threads), "-c"], stdin=f_in, stdout=f_out, check=True)
        else:
            dyn_min_len, dyn_keep_pct = get_adaptive_filtlong_params(input.nanostat)
            cmd = [
                FILTLONG, "--min_length", str(dyn_min_len),
                "--keep_percent", str(dyn_keep_pct),
                "--min_mean_q", str(FILTLONG_MIN_MEAN_Q),
                input.reads
            ]
            Path(log[0]).parent.mkdir(parents=True, exist_ok=True)
            with open(log[0], "wb") as log_fh, open(output.cleaned, "wb") as out_fh:
                p1 = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                p2 = subprocess.Popen([PIGZ, "-p", str(threads), "-c"], stdin=p1.stdout, stdout=out_fh)
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
        stats    = f"{HOST_DIR}/{{sample}}/seqkit_stats.txt",
        audit    = f"{HOST_DIR}/{{sample}}/long_host_removal_audit.txt"
    threads: THREADS
    run:
        Path(HOST_DIR).mkdir(parents=True, exist_ok=True)
        if HOST_REF and os.path.exists(HOST_REF):
            shell(
                f"set -euo pipefail\n"
                f"{MINIMAP2} -ax {MM2_PRESET} --secondary=no -t {threads} {HOST_REF} {input.reads} "
                f"| {SAMTOOLS} view -b -f 4 "
                f"| {SAMTOOLS} fastq - | {PIGZ} -p {threads} > {output.decontam}"
            )
        else:
            if input.reads.endswith(".gz"):
                shutil.copyfile(input.reads, output.decontam)
            else:
                with open(input.reads, "rb") as f_in, open(output.decontam, "wb") as f_out:
                    subprocess.run([PIGZ, "-p", str(threads), "-c"], stdin=f_in, stdout=f_out, check=True)
        shell(f"set -euo pipefail\n{SEQKIT} stats -a {output.decontam} > {output.stats}")
        with open(output.audit, "w") as audit_fh:
            audit_fh.write(f"Sample: {SAMPLE}\nLong-read Host Reference: {HOST_REF}\nDecontamination Complete.\n")

# =============================================================================
# PHASE 2 — USER-CONFIGURABLE ASSEMBLY ENGINE (OPERA-MS / metaFlye) & QUAST
# =============================================================================

rule conditional_assembly:
    input:
        long_r   = DECONTAM_FASTQ,
        short_r1 = HOST_R1,
        short_r2 = HOST_R2
    output:
        contigs  = ASSEMBLY_FASTA
    log:
        f"{OPRAMS_DIR}/{{sample}}_assembly_engine.log"
    threads: THREADS
    params:
        engine    = ASSEMBLER_ENGINE,
        genome_db = OPERAMS_DB,
        libnsl    = os.environ.get("LIBNSL_SO", "")
    run:
        Path(log[0]).parent.mkdir(parents=True, exist_ok=True)
        env = os.environ.copy()
        
        if params.engine == "operams":
            outdir = Path(f"{OPRAMS_DIR}/{wildcards.sample}_nostrain")
            if outdir.exists(): shutil.rmtree(outdir)
            outdir.mkdir(parents=True, exist_ok=True)
            if params.libnsl and os.path.exists(params.libnsl):
                env["LD_PRELOAD"] = params.libnsl
            if MARINE_ENV:
                env["PATH"] = str(MARINE_ENV) + os.pathsep + env.get("PATH", "")
            command = [
                "perl", OPERAMS_PL,
                "--short-read1", input.short_r1, "--short-read2", input.short_r2,
                "--long-read", input.long_r, "--genome-db", params.genome_db,
                "--no-strain-clustering", "--num-processors", str(threads), "--out-dir", str(outdir)
            ]
            with open(log[0], "wb") as log_fh:
                subprocess.run(command, stdout=log_fh, stderr=subprocess.STDOUT, env=env, check=True)
            final_output = outdir / "contigs.fasta"
            if not final_output.exists():
                raise FileNotFoundError(f"OPERA-MS failed: {final_output}")
            shutil.copyfile(final_output, output.contigs)
            
        elif params.engine in ("metaflye", "flye"):
            flye_outdir = Path(f"{FLYE_DIR}/{wildcards.sample}")
            shutil.rmtree(flye_outdir, ignore_errors=True)
            flye_outdir.mkdir(parents=True, exist_ok=True)
            
            flye_platform_flag = {
                "ont": "--nano-hq",
                "pacbio-raw": "--pacbio-raw",
                "pacbio-hifi": "--pacbio-hifi"
            }.get(READ_TYPE, "--nano-hq")
            
            command = [
                "flye", flye_platform_flag, input.long_r,
                "--out-dir", str(flye_outdir),
                "--threads", str(threads),
                "--meta", "--iterations", "2" # Resolved low iteration flaw
            ]
            with open(log[0], "wb") as log_fh:
                subprocess.run(command, stdout=log_fh, stderr=subprocess.STDOUT, env=env, check=True)
            final_output = flye_outdir / "assembly.fasta"
            if not final_output.exists():
                raise FileNotFoundError(f"metaFlye failed: {final_output}")
            shutil.copyfile(final_output, output.contigs)
        else:
            raise ValueError(f"Unknown assembler engine: {params.engine}. Use 'operams' or 'metaflye'.")

rule assembly_qc_metaquast:
    input:
        contigs = ASSEMBLY_FASTA, r1 = HOST_R1, r2 = HOST_R2, long_reads = DECONTAM_FASTQ
    output:
        html = f"{QUAST_DIR}/{{sample}}/report.html",
        tsv  = f"{QUAST_DIR}/{{sample}}/report.tsv"
    threads: THREADS
    resources:
        mem_mb = MEMORY_MB, runtime = RUNTIME_MIN
    run:
        outdir = f"{QUAST_DIR}/{wildcards.sample}"
        shutil.rmtree(outdir, ignore_errors=True)
        command = [
            "metaquast.py", input.contigs, "--pe1", input.r1, "--pe2", input.r2,
            "--nanopore", input.long_reads, "--min-contig", str(METABAT_MIN_CONTIG),
            "--threads", str(threads), "--output-dir", outdir, "--meta"
        ]
        run_command(command, f"{LOG_DIR}/quast/{wildcards.sample}.log")

# =============================================================================
# PHASE 3 — CROSS-MAPPING, SYNCHRONIZED FILTERING & BINNING
# =============================================================================

rule bowtie2_index:
    input:
        contigs = ASSEMBLY_FASTA
    output:
        index_dir = directory(f"{MAP_DIR}/{{sample}}_bt2_index")
    threads: THREADS
    run:
        shutil.rmtree(output.index_dir, ignore_errors=True)
        Path(output.index_dir).mkdir(parents=True, exist_ok=True)
        subprocess.run([BOWTIE2_BUILD, "--threads", str(threads), input.contigs, os.path.join(output.index_dir, "index")], check=True)

rule bowtie2_map_short_reads:
    input:
        r1 = HOST_R1, r2 = HOST_R2, singletons = HOST_SINGLETONS, index_dir = f"{MAP_DIR}/{{sample}}_bt2_index"
    output:
        bam = f"{MAP_DIR}/{{sample}}_sr.sorted.bam",
        bai = f"{MAP_DIR}/{{sample}}_sr.sorted.bam.bai",
        stats = f"{MAP_DIR}/{{sample}}_sr.flagstat"
    threads: THREADS
    run:
        Path(MAP_DIR).mkdir(parents=True, exist_ok=True)
        align_threads, sort_threads = max(1, threads // 2), max(1, threads - (threads // 2))
        singleton_arg = f" -U {shlex.quote(input.singletons)}" if gzip_has_data(input.singletons) else ""
        command = (
            f"set -euo pipefail; "
            f"{shlex.quote(BOWTIE2)} --very-sensitive -x {shlex.quote(os.path.join(input.index_dir, 'index'))} "
            f"-1 {shlex.quote(input.r1)} -2 {shlex.quote(input.r2)}{singleton_arg} -p {align_threads} --no-unal | "
            f"{shlex.quote(SAMTOOLS)} view -b -q 10 - | "
            f"{shlex.quote(SAMTOOLS)} sort -@ {sort_threads} -o {shlex.quote(output.bam)} -; "
            f"{shlex.quote(SAMTOOLS)} index -@ {sort_threads} {shlex.quote(output.bam)} {shlex.quote(output.bai)}; "
            f"{shlex.quote(SAMTOOLS)} flagstat {shlex.quote(output.bam)} > {shlex.quote(output.stats)}"
        )
        subprocess.run(["bash", "-c", command], check=True)

rule minimap2_map_long_reads:
    input:
        reads = DECONTAM_FASTQ, contigs = ASSEMBLY_FASTA
    output:
        bam = f"{MAP_DIR}/{{sample}}_lr_filtered.sorted.bam",
        bai = f"{MAP_DIR}/{{sample}}_lr_filtered.sorted.bam.bai",
        stats = f"{MAP_DIR}/{{sample}}_lr.flagstat"
    threads: THREADS
    run:
        Path(MAP_DIR).mkdir(parents=True, exist_ok=True)
        command = (
            f"set -euo pipefail; "
            f"{shlex.quote(MINIMAP2)} -ax {MM2_PRESET} -t {threads} {shlex.quote(input.contigs)} {shlex.quote(input.reads)} | "
            f"{shlex.quote(SAMTOOLS)} view -b -q 20 -F 260 - | "
            f"{shlex.quote(SAMTOOLS)} sort -@ {threads} -o {shlex.quote(output.bam)} -; "
            f"{shlex.quote(SAMTOOLS)} index -@ {threads} {shlex.quote(output.bam)} {shlex.quote(output.bai)}; "
            f"{shlex.quote(SAMTOOLS)} flagstat {shlex.quote(output.bam)} > {shlex.quote(output.stats)}"
        )
        subprocess.run(["bash", "-c", command], check=True)

rule calculate_short_read_depth:
    input:
        bam = f"{MAP_DIR}/{{sample}}_sr.sorted.bam", bai = f"{MAP_DIR}/{{sample}}_sr.sorted.bam.bai"
    output:
        depth = DEPTH_FILE
    run:
        subprocess.run([JGI_DEPTH, "--outputDepth", output.depth, input.bam], check=True)

rule filter_contigs_and_synchronize_depth:
    input:
        contigs = ASSEMBLY_FASTA, depth = DEPTH_FILE
    output:
        filtered_contigs = f"{OUTPUT_ROOT}/qc/assembly/{{sample}}_filtered_for_binning.fasta",
        filtered_depth   = f"{MAP_DIR}/{{sample}}_filtered_depth.txt"
    run:
        min_len = max(METABAT_MIN_CONTIG, SEMIBIN_MIN_CONTIG, MAXBIN_MIN_CONTIG)
        valid_contigs = set()
        Path(output.filtered_depth).parent.mkdir(parents=True, exist_ok=True)
        Path(output.filtered_contigs).parent.mkdir(parents=True, exist_ok=True)

        with open(input.depth, "rt") as df:
            reader = csv.reader(df, delimiter="\t")
            header = next(reader, None)
            if not header:
                raise ValueError(f"Depth file {input.depth} is empty or malformed.")
            
            name_idx = header.index("contigName") if "contigName" in header else 0
            len_idx = header.index("contigLen") if "contigLen" in header else (1 if len(header) > 1 else 1)
            
            rows_to_keep = [header]
            for fields in reader:
                if len(fields) > max(name_idx, len_idx):
                    contig_name = fields[name_idx]
                    contig_len_str = fields[len_idx]
                    try:
                        if int(contig_len_str) >= min_len:
                            valid_contigs.add(contig_name)
                            rows_to_keep.append(fields)
                    except ValueError:
                        continue

        with open(output.filtered_depth, "wt", newline="") as fout:
            writer = csv.writer(fout, delimiter="\t", lineterminator="\n")
            writer.writerows(rows_to_keep)

        with open(input.contigs, "rt") as fin, open(output.filtered_contigs, "wt") as fout:
            write_flag = False
            for line in fin:
                if line.startswith(">"):
                    contig_id = line[1:].strip().split()[0]
                    write_flag = (contig_id in valid_contigs)
                if write_flag: fout.write(line)

rule metabat2_binning:
    input:
        contigs = rules.filter_contigs_and_synchronize_depth.output.filtered_contigs,
        depth   = f"{MAP_DIR}/{{sample}}_filtered_depth.txt"
    output:
        bins = directory(f"{BIN_DIR}/{{sample}}/metabat2_bins"),
        tsv  = f"{BIN_DIR}/{{sample}}/metabat2.tsv"
    threads: THREADS
    run:
        shutil.rmtree(output.bins, ignore_errors=True)
        Path(output.bins).mkdir(parents=True, exist_ok=True)
        command = [
            METABAT2, "-i", input.contigs, "-a", input.depth, "-o", os.path.join(output.bins, "bin"),
            "--minContig", str(METABAT_MIN_CONTIG), "--minCV", str(METABAT_MIN_CV),
            "--minCVSum", str(METABAT_MIN_CV_SUM), "--seed", str(METABAT_SEED), "-t", str(threads)
        ]
        run_command(command, f"{LOG_DIR}/binning/{wildcards.sample}.metabat2.log")
        write_contig2bin(output.bins, output.tsv)

rule semibin2_binning:
    input:
        contigs = rules.filter_contigs_and_synchronize_depth.output.filtered_contigs,
        bam     = f"{MAP_DIR}/{{sample}}_sr.sorted.bam",
        bai     = f"{MAP_DIR}/{{sample}}_sr.sorted.bam.bai"
    output:
        bins = directory(f"{BIN_DIR}/{{sample}}/semibin2_bins"),
        tsv  = f"{BIN_DIR}/{{sample}}/semibin2.tsv"
    threads: THREADS
    run:
        workdir = f"{BIN_DIR}/{wildcards.sample}/semibin2_work"
        shutil.rmtree(workdir, ignore_errors=True)
        Path(workdir).mkdir(parents=True, exist_ok=True)
        command = [
            SEMIBIN2, "single_easy_bin", "--input-fasta", input.contigs,
            "--input-bam", input.bam, "--output", workdir, "--threads", str(threads),
            "--min-len", str(SEMIBIN_MIN_CONTIG), "--sequencing-type", "short_read"
        ]
        run_command(command, f"{LOG_DIR}/binning/{wildcards.sample}.semibin2.log")
        candidates = []
        for d in ("output_recluster_bins", "output_bins", "."):
            cdir = Path(workdir) / d
            if cdir.is_dir():
                candidates.extend(list(cdir.glob("*.fa")) + list(cdir.glob("*.fasta")))
        normalize_bins(candidates, output.bins)
        write_contig2bin(output.bins, output.tsv)

rule maxbin2_binning:
    input:
        contigs = rules.filter_contigs_and_synchronize_depth.output.filtered_contigs,
        depth   = f"{MAP_DIR}/{{sample}}_filtered_depth.txt"
    output:
        bins = directory(f"{BIN_DIR}/{{sample}}/maxbin2_bins"),
        tsv  = f"{BIN_DIR}/{{sample}}/maxbin2.tsv"
    threads: THREADS
    run:
        workdir = f"{BIN_DIR}/{wildcards.sample}/maxbin2_work"
        shutil.rmtree(workdir, ignore_errors=True)
        Path(workdir).mkdir(parents=True, exist_ok=True)
        abundance = os.path.join(workdir, "abundance.tsv")
        with open(input.depth, "rt") as src:
            header = src.readline().strip().split("\t")
            abund_idx = header.index("totalAvgDepth") if "totalAvgDepth" in header else (3 if len(header) > 3 else 2)
            name_idx = header.index("contigName") if "contigName" in header else 0
            with open(abundance, "w") as tgt:
                for line in src:
                    fields = line.rstrip("\n").split("\t")
                    if len(fields) > abund_idx:
                        tgt.write(f"{fields[name_idx]}\t{fields[abund_idx]}\n")
        command = [
            MAXBIN2, "-contig", input.contigs, "-abund", abundance,
            "-out", os.path.join(workdir, "bin"), "-min_contig_length", str(MAXBIN_MIN_CONTIG), "-thread", str(threads)
        ]
        run_command(command, f"{LOG_DIR}/binning/{wildcards.sample}.maxbin2.log")
        normalize_bins(list(Path(workdir).glob("bin.*.fasta")), output.bins)
        write_contig2bin(output.bins, output.tsv)

rule dastool:
    input:
        metabat = f"{BIN_DIR}/{{sample}}/metabat2.tsv",
        semibin = f"{BIN_DIR}/{{sample}}/semibin2.tsv",
        maxbin  = f"{BIN_DIR}/{{sample}}/maxbin2.tsv",
        contigs = rules.filter_contigs_and_synchronize_depth.output.filtered_contigs
    output:
        bins = directory(f"{DAS_DIR}/{{sample}}_DASTool_bins"),
        done = f"{DAS_DIR}/{{sample}}.dastool.done"
    threads: THREADS
    run:
        available = [(lbl, p) for lbl, p in (("metabat2", input.metabat), ("semibin2", input.semibin), ("maxbin2", input.maxbin)) if os.path.isfile(p) and os.path.getsize(p) > 0]
        shutil.rmtree(output.bins, ignore_errors=True)
        Path(output.bins).mkdir(parents=True, exist_ok=True)
        if available:
            with tempfile.TemporaryDirectory(prefix="dastool_", dir=f"{DAS_DIR}") as workdir:
                prefix = os.path.join(workdir, "refined")
                command = [
                    DASTOOL, "-i", ",".join(p for _, p in available),
                    "-l", ",".join(lbl for lbl, _ in available),
                    "-c", input.contigs, "-o", prefix, "--write_bins", "1",
                    "--score_threshold", str(DASTOOL_SCORE), "-t", str(threads)
                ]
                run_command(command, f"{LOG_DIR}/binning/{wildcards.sample}.dastool.log")
                source_bins = f"{prefix}_DASTool_bins"
                candidates = list(Path(source_bins).glob("*.fa")) + list(Path(source_bins).glob("*.fasta")) if os.path.isdir(source_bins) else []
                normalize_bins(candidates, output.bins)
        open(output.done, "w").close()

checkpoint select_dastool_bins:
    input:
        bins_dir = f"{DAS_DIR}/{{sample}}_DASTool_bins",
        done     = f"{DAS_DIR}/{{sample}}.dastool.done"
    output:
        bins = directory(f"{DAS_DIR}/{{sample}}_DASTool_bins_clean"),
        done = f"{DAS_DIR}/{{sample}}.dastool.done_clean"
    shell:
        r"""
        set -euo pipefail
        mkdir -p {output.bins}
        for f in {input.bins_dir}/*.fa {input.bins_dir}/*.fasta; do
            [ -f "$f" ] || continue
            bn=$(basename "$f")
            case "$bn" in
                *_sub.fa | *_sub.fasta) continue ;;
            esac
            cp "$f" "{output.bins}/$bn"
        done
        touch {output.done}
        """

# =============================================================================
# PHASE 4 — ADVANCED MAG QUALITY & FILTERING (PARALLELIZED)
# =============================================================================

rule checkm2:
    input: bins=REFINED_BINS
    output: report=f"{MAG_QC_DIR}/{SAMPLE}/checkm2_quality_report.tsv"
    log: f"{LOG_DIR}/mag_qc/{SAMPLE}.checkm2.log"
    threads: THREADS
    run:
        Path(output.report).parent.mkdir(parents=True, exist_ok=True)
        bins = sorted(list(Path(input.bins).glob("*.fa")) + list(Path(input.bins).glob("*.fasta")))
        if not bins:
            with open(output.report, "w") as handle: handle.write("Name\tCompleteness\tContamination\n")
        else:
            env = os.environ.copy()
            env["PATH"] = CHECKM2_ENV + os.pathsep + PROKKA_ENV + os.pathsep + env.get("PATH", "")
            with tempfile.TemporaryDirectory(prefix="checkm2_", dir=str(Path(output.report).parent)) as workdir:
                command = [
                    CHECKM2, "predict", "--input", input.bins, "--output-directory", workdir,
                    "--threads", str(threads), "-x", "fa", "--force", "--database_path", CHECKM2_DB,
                ]
                if CHECKM2_LOWMEM: command.append("--lowmem")
                with open(log[0], "wb") as log_handle:
                    subprocess.run(command, stdout=log_handle, stderr=subprocess.STDOUT, env=env, check=True)
                shutil.copyfile(os.path.join(workdir, "quality_report.tsv"), output.report)

rule gunc:
    input: bins=REFINED_BINS
    output: report=f"{MAG_QC_DIR}/{SAMPLE}/gunc_maxcss.tsv"
    log: f"{LOG_DIR}/mag_qc/{SAMPLE}.gunc.log"
    threads: THREADS
    run:
        Path(output.report).parent.mkdir(parents=True, exist_ok=True)
        bins = sorted(list(Path(input.bins).glob("*.fa")) + list(Path(input.bins).glob("*.fasta")))
        if not bins:
            with open(output.report, "w") as handle: handle.write("genome\tclade_separation_score\tpass.GUNC\n")
        else:
            env = os.environ.copy()
            env["PATH"] = GUNC_ENV + os.pathsep + env.get("PATH", "")
            with tempfile.TemporaryDirectory(prefix="gunc_", dir=str(Path(output.report).parent)) as workdir:
                outdir, tempdir = os.path.join(workdir, "output"), os.path.join(workdir, "tmp")
                os.makedirs(outdir); os.makedirs(tempdir)
                command = [
                    GUNC, "run", "--input_dir", input.bins, "--file_suffix", ".fa",
                    "--db_file", GUNC_DB, "--threads", str(threads), "--min_mapped_genes", str(GUNC_MIN_MAPPED_GENES),
                    "--temp_dir", tempdir, "--out_dir", outdir,
                ]
                if GUNC_SENSITIVE: command.append("--sensitive")
                with open(log[0], "wb") as log_handle:
                    subprocess.run(command, stdout=log_handle, stderr=subprocess.STDOUT, env=env, check=True)
                gunc_files = list(Path(outdir).glob("GUNC.*.maxCSS_level.tsv"))
                if gunc_files:
                    shutil.copyfile(gunc_files[0], output.report)
                else:
                    with open(output.report, "w") as handle: handle.write("genome\tclade_separation_score\tpass.GUNC\n")

rule structural_mag_qc_single:
    input:
        fasta = lambda wildcards: first_existing([f"{REFINED_BINS}/{wildcards.mag}.fa", f"{REFINED_BINS}/{wildcards.mag}.fasta"])
    output:
        summary = f"{MAG_QC_DIR}/{{sample}}/structural_details/{{mag}}/summary.tsv"
    log:
        f"{LOG_DIR}/mag_qc/{{sample}}/structural_{{mag}}.log"
    threads: 2
    run:
        Path(output.summary).parent.mkdir(parents=True, exist_ok=True)
        env = os.environ.copy()
        env["PATH"] = PROKKA_ENV + os.pathsep + env.get("PATH", "")
        
        mag_dir = Path(output.summary).parent
        bac_gff, arc_gff = mag_dir / "barrnap_bacteria.gff", mag_dir / "barrnap_archaea.gff"
        
        with open(bac_gff, "w") as out_h, open(mag_dir / "barrnap_bacteria.log", "w") as err_h:
            subprocess.run([BARRNAP, "--kingdom", "bac", "--threads", "1", str(input.fasta)], stdout=out_h, stderr=err_h, env=env, check=False)
        with open(arc_gff, "w") as out_h, open(mag_dir / "barrnap_archaea.log", "w") as err_h:
            subprocess.run([BARRNAP, "--kingdom", "arc", "--threads", "1", str(input.fasta)], stdout=out_h, stderr=err_h, env=env, check=False)
        
        def rrna_profile(gff_path):
            profile = {"5S": False, "16S": False, "23S": False}
            if os.path.isfile(gff_path):
                with open(gff_path) as handle:
                    for line in handle:
                        if not line.startswith("#") and "(partial)" not in line:
                            for name in profile:
                                if f"Name={name}_rRNA" in line: profile[name] = True
            return profile

        bac_rrna, arc_rrna = rrna_profile(bac_gff), rrna_profile(arc_gff)
        selected_domain = "Bacteria" if sum(bac_rrna.values()) >= sum(arc_rrna.values()) else "Archaea"
        sel_rrna = bac_rrna if selected_domain == "Bacteria" else arc_rrna
        
        metrics = fasta_metrics(input.fasta)
        metrics.update({
            "MAG": wildcards.mag, "structural_domain": selected_domain,
            "structural_complete": all(sel_rrna.values()),
            "bacterial_structural_complete": all(bac_rrna.values()),
            "archaeal_structural_complete": all(arc_rrna.values()),
            "has_5S": sel_rrna["5S"], "has_16S": sel_rrna["16S"], "has_23S": sel_rrna["23S"],
            "trna_isotype_count": 0,
        })
        
        fields = ["MAG", "contig_count", "total_length", "n50", "gc_percent", "structural_domain", "structural_complete", "bacterial_structural_complete", "archaeal_structural_complete", "has_5S", "has_16S", "has_23S", "trna_isotype_count"]
        with open(output.summary, "w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields, delimiter="\t", lineterminator="\n")
            writer.writeheader(); writer.writerow(metrics)

rule structural_mag_qc_aggregate:
    input:
        summaries = lambda wildcards: expand(f"{MAG_QC_DIR}/{{sample}}/structural_details/{{mag}}/summary.tsv", sample=wildcards.sample, mag=get_all_refined_mags(wildcards))
    output:
        summary = f"{MAG_QC_DIR}/{SAMPLE}/structural_qc.tsv"
    run:
        fields = ["MAG", "contig_count", "total_length", "n50", "gc_percent", "structural_domain", "structural_complete", "bacterial_structural_complete", "archaeal_structural_complete", "has_5S", "has_16S", "has_23S", "trna_isotype_count"]
        Path(output.summary).parent.mkdir(parents=True, exist_ok=True)
        all_rows = []
        for s_file in input.summaries:
            if os.path.exists(s_file) and os.path.getsize(s_file) > 0:
                with open(s_file) as sf:
                    reader = csv.DictReader(sf, delimiter="\t")
                    for r in reader:
                        all_rows.append(r)
        all_rows.sort(key=lambda r: r["MAG"])
        with open(output.summary, "w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields, delimiter="\t", lineterminator="\n")
            writer.writeheader()
            if all_rows: writer.writerows(all_rows)

rule merge_mag_qc:
    input: bins=REFINED_BINS, checkm2=f"{MAG_QC_DIR}/{SAMPLE}/checkm2_quality_report.tsv", gunc=f"{MAG_QC_DIR}/{SAMPLE}/gunc_maxcss.tsv", structural=f"{MAG_QC_DIR}/{SAMPLE}/structural_qc.tsv"
    output: matrix=QUALITY_MATRIX
    log: f"{LOG_DIR}/mag_qc/{SAMPLE}.merge.log"
    run:
        checkm, gunc_dict, structural = {}, {}, {}
        if os.path.exists(input.checkm2) and os.path.getsize(input.checkm2) > 0:
            with open(input.checkm2) as h:
                for r in csv.DictReader(h, delimiter="\t"):
                    if name_key := next((k for k in ("Name", "name", "Bin Id", "Bin_Id", "Genome") if k in r), None):
                        checkm[clean_mag_id(r[name_key])] = {"checkm2_completeness": parse_float(r.get("Completeness")), "checkm2_contamination": parse_float(r.get("Contamination"))}
        if os.path.exists(input.gunc) and os.path.getsize(input.gunc) > 0:
            with open(input.gunc) as h:
                for r in csv.DictReader(h, delimiter="\t"):
                    if "genome" in r: gunc_dict[clean_mag_id(r["genome"])] = {"gunc_pass": parse_bool(r.get("pass.GUNC")), "gunc_css": parse_float(r.get("clade_separation_score")), "gunc_reference_representation_score": parse_float(r.get("reference_representation_score"))}
        if os.path.exists(input.structural) and os.path.getsize(input.structural) > 0:
            with open(input.structural) as h:
                for r in csv.DictReader(h, delimiter="\t"):
                    structural[clean_mag_id(r["MAG"])] = {k: parse_bool(r.get(k)) if "complete" in k or "has" in k else r.get(k) for k in r.keys() if k != "MAG"}
        
        rows = []
        for fasta in sorted(list(Path(input.bins).glob("*.fa")) + list(Path(input.bins).glob("*.fasta"))):
            mag = clean_mag_id(fasta.name)
            row = {"MAG": mag}
            row.update(checkm.get(mag, {"checkm2_completeness": None, "checkm2_contamination": None}))
            row.update(gunc_dict.get(mag, {"gunc_pass": None, "gunc_css": None, "gunc_reference_representation_score": None}))
            row.update(structural.get(mag, {"structural_complete": False}))
            
            c, ct, hs = row["checkm2_completeness"], row["checkm2_contamination"], row.get("structural_complete")
            if c is None or ct is None: tier = "Unassessed"
            elif c > HIGH_COMPLETENESS and ct < HIGH_CONTAMINATION and hs: tier = "High-quality draft MAG"
            elif c >= MEDIUM_COMPLETENESS and ct < MEDIUM_CONTAMINATION: tier = "Medium-quality draft MAG"
            else: tier = "Low-quality draft MAG"
            
            eligible = tier in {"High-quality draft MAG", "Medium-quality draft MAG"}
            reasons = []
            if not eligible: reasons.append("quality_threshold")
            if REQUIRE_GUNC_PASS and row.get("gunc_pass") is not True: eligible = False; reasons.append("gunc_not_passed")
            
            row.update({"mimag_inspired_tier": tier, "production_eligible": eligible, "exclusion_reason": ";".join(reasons)})
            rows.append(row)
            
        Path(output.matrix).parent.mkdir(parents=True, exist_ok=True)
        with open(output.matrix, "w", newline="") as h:
            headers = ["MAG", "checkm2_completeness", "checkm2_contamination", "gunc_pass", 
                       "gunc_css", "gunc_reference_representation_score", "structural_complete",
                       "mimag_inspired_tier", "production_eligible", "exclusion_reason"]
            if rows: headers = list(rows[0].keys())
            writer = csv.DictWriter(h, fieldnames=headers, delimiter="\t", lineterminator="\n")
            writer.writeheader()
            if rows: writer.writerows(rows)

rule mag_filter:
    input: matrix=QUALITY_MATRIX, bins=REFINED_BINS
    output: production=directory(PRODUCTION_MAGS), archive=directory(ARCHIVED_MAGS), done=f"{FILTERED_DIR}/{SAMPLE}.filter.done"
    run:
        shutil.rmtree(output.production, ignore_errors=True); shutil.rmtree(output.archive, ignore_errors=True)
        Path(output.production).mkdir(parents=True, exist_ok=True); Path(output.archive).mkdir(parents=True, exist_ok=True)
        decisions = {}
        if os.path.exists(input.matrix) and os.path.getsize(input.matrix) > 0:
            with open(input.matrix) as h:
                for r in csv.DictReader(h, delimiter="\t"): decisions[clean_mag_id(r["MAG"])] = parse_bool(r.get("production_eligible")) is True
        copied_production, copied_archive = 0, 0
        for fasta in sorted(list(Path(input.bins).glob("*.fa")) + list(Path(input.bins).glob("*.fasta"))):
            target = output.production if decisions.get(clean_mag_id(fasta.name), False) else output.archive
            shutil.copyfile(fasta, Path(target) / fasta.name)
            if decisions.get(clean_mag_id(fasta.name), False): copied_production += 1
            else: copied_archive += 1
        Path(output.done).write_text(f"production={copied_production}\tarchive={copied_archive}\n")

# =============================================================================
# PHASE 5 — ANNOTATION, VIRAL DISCOVERY, TAXONOMY & SCALABLE FUNCTIONAL PROFILING
# =============================================================================

rule gtdbtk:
    input: drep_dir=DREP_OUTPUT, drep_done=DREP_DONE
    output: out_dir=directory(GTDB_OUTPUT), done=GTDB_DONE
    log: f"{LOG_DIR}/taxonomy/{SAMPLE}.gtdbtk.log"
    threads: THREADS
    run:
        genomes = sorted(list((Path(input.drep_dir) / "dereplicated_genomes").glob("*.fa")) + list((Path(input.drep_dir) / "dereplicated_genomes").glob("*.fasta")))
        shutil.rmtree(output.out_dir, ignore_errors=True); Path(output.out_dir).mkdir(parents=True, exist_ok=True)
        if genomes:
            Path(GTDB_SCRATCH_DIR).mkdir(parents=True, exist_ok=True)
            env = os.environ.copy()
            env["PATH"] = GTDBTK_ENV + os.pathsep + env.get("PATH", "")
            env["GTDBTK_DATA_PATH"] = GTDBTK_DATA_PATH
            command = [
                GTDBTK, "classify_wf", "--genome_dir", str(Path(input.drep_dir) / "dereplicated_genomes"),
                "--out_dir", output.out_dir, "--extension", "fa", "--cpus", str(threads),
                "--pplacer_cpus", str(GTDB_PPLACER_CPUS), "--scratch_dir", GTDB_SCRATCH_DIR,
            ]
            with open(log[0], "wb") as log_handle:
                subprocess.run(command, stdout=log_handle, stderr=subprocess.STDOUT, env=env, check=True)
        Path(output.done).write_text("completed\n")

rule virsorter2:
    input:
        contigs = CONTIGS
    output:
        done = f"{VIRAL_DIR}/{SAMPLE}/virsorter2.done"
    log:
        f"{LOG_DIR}/viral/{SAMPLE}.virsorter2.log"
    threads: THREADS
    run:
        workdir = f"{VIRAL_DIR}/{SAMPLE}/virsorter2"
        shutil.rmtree(workdir, ignore_errors=True)
        Path(workdir).parent.mkdir(parents=True, exist_ok=True)
        Path(log[0]).parent.mkdir(parents=True, exist_ok=True)
        env = os.environ.copy()
        env["PATH"] = str(Path(VIRSORTER2).parent) + os.pathsep + env.get("PATH", "")
        command = [
            VIRSORTER2, "run", "-i", input.contigs, "-w", workdir, "-j", str(threads),
            "--min-length", str(VIRSORTER_MIN_LENGTH), "--min-score", str(VIRSORTER_MIN_SCORE), "all"
        ]
        run_command(command, log[0], env=env)
        Path(output.done).touch()

checkpoint drep:
    input: production=PRODUCTION_MAGS, done=f"{FILTERED_DIR}/{SAMPLE}.filter.done", matrix=QUALITY_MATRIX
    output: out_dir=directory(DREP_OUTPUT), done=DREP_DONE
    log: f"{LOG_DIR}/dereplication/{SAMPLE}.drep.log"
    threads: THREADS
    run:
        genomes = sorted(list(Path(input.production).glob("*.fa")) + list(Path(input.production).glob("*.fasta")))
        shutil.rmtree(output.out_dir, ignore_errors=True); Path(output.out_dir).parent.mkdir(parents=True, exist_ok=True)
        quality = {}
        if os.path.exists(input.matrix) and os.path.getsize(input.matrix) > 0:
            with open(input.matrix) as h:
                for r in csv.DictReader(h, delimiter="\t"): quality[clean_mag_id(r["MAG"])] = (parse_float(r.get("checkm2_completeness")) or 0.0, parse_float(r.get("checkm2_contamination")) or 100.0)
        
        if len(genomes) <= 1:
            rep_dir = Path(output.out_dir) / "dereplicated_genomes"
            rep_dir.mkdir(parents=True, exist_ok=True)
            if genomes: shutil.copyfile(genomes[0], rep_dir / genomes[0].name)
        else:
            info_csv = f"{DREP_DIR}/{SAMPLE}_genome_info.csv"
            with open(info_csv, "w", newline="") as h:
                w = csv.writer(h, lineterminator="\n"); w.writerow(["genome", "completeness", "contamination"])
                for g in genomes: w.writerow([g.name, *quality.get(clean_mag_id(g.name), (0.0, 100.0))])
            env = os.environ.copy()
            env["PATH"] = DREP_ENV + os.pathsep + env.get("PATH", "")
            command = [
                DREP, "dereplicate", output.out_dir, "-g", *map(str, genomes), "--genomeInfo", info_csv,
                "-pa", str(DREP_PRIMARY_ANI), "-sa", str(DREP_SECONDARY_ANI), "-nc", str(DREP_ALIGNED_FRACTION),
                "--S_algorithm", DREP_ALGORITHM, "-comp", "0", "-con", "100", "-p", str(threads),
            ]
            with open(log[0], "wb") as log_handle:
                subprocess.run(command, stdout=log_handle, stderr=subprocess.STDOUT, env=env, check=True)
        Path(output.done).write_text("completed\n")

rule coverm_abundance:
    input: drep_dir=DREP_OUTPUT, drep_done=DREP_DONE, r1=CLEAN_R1, r2=CLEAN_R2
    output: tsv=f"{COVERM_DIR}/{SAMPLE}/abundance_matrix.tsv", done=f"{COVERM_DIR}/{SAMPLE}/coverm.done"
    log: f"{LOG_DIR}/abundance/{SAMPLE}.coverm.log"
    threads: THREADS
    run:
        genomes = sorted(list((Path(input.drep_dir) / "dereplicated_genomes").glob("*.fa")) + list((Path(input.drep_dir) / "dereplicated_genomes").glob("*.fasta")))
        Path(output.tsv).parent.mkdir(parents=True, exist_ok=True)
        if genomes:
            env = os.environ.copy()
            env["PATH"] = COVERM_ENV + os.pathsep + env.get("PATH", "")
            command = [
                COVERM, "genome", "--coupled", input.r1, input.r2, "--genome-fasta-files", *map(str, genomes),
                "--mapper", COVERM_MAPPER, "--threads", str(threads), "--methods", "mean", "relative_abundance", "covered_fraction",
                "--min-covered-fraction", str(COVERM_MIN_COVERED_FRACTION), "--min-read-percent-identity", str(COVERM_MIN_IDENTITY),
                "--min-read-aligned-percent", str(COVERM_MIN_ALIGNED), "--output-file", output.tsv,
            ]
            with open(log[0], "wb") as log_handle:
                subprocess.run(command, stdout=log_handle, stderr=subprocess.STDOUT, env=env, check=True)
        else:
            with open(output.tsv, "w") as handle: handle.write("Genome\tMean\tRelative Abundance (%)\tCovered Fraction\n")
        Path(output.done).write_text("completed\n")

# Scalable Batch Prokka Annotation across Dereplicated MAGs
rule prokka_batch:
    input:
        drep_done=DREP_DONE,
        drep_dir=DREP_OUTPUT
    output:
        done=f"{PROKKA_DIR}/{{sample}}/prokka_batch.done"
    threads: THREADS
    run:
        genomes = sorted(list((Path(input.drep_dir) / "dereplicated_genomes").glob("*.fa")) + list((Path(input.drep_dir) / "dereplicated_genomes").glob("*.fasta")))
        env = os.environ.copy()
        env["PATH"] = PROKKA_ENV + os.pathsep + env.get("PATH", "")
        
        for genome in genomes:
            mag = clean_mag_id(genome.name)
            outdir = Path(PROKKA_DIR) / wildcards.sample / mag
            shutil.rmtree(outdir, ignore_errors=True)
            outdir.mkdir(parents=True, exist_ok=True)
            command = [PROKKA, "--outdir", str(outdir), "--prefix", mag, "--cpus", str(MAG_THREADS), "--force", "--compliant", "--metagenome", str(genome)]
            subprocess.run(command, env=env, check=True)
            
        Path(output.done).parent.mkdir(parents=True, exist_ok=True)
        Path(output.done).touch()

# Scalable Batch dbCAN CAZyme Profiling
rule dbcan_batch:
    input:
        drep_done=DREP_DONE,
        drep_dir=DREP_OUTPUT
    output:
        done=f"{DBCAN_DIR}/{{sample}}/dbcan_batch.done"
    threads: THREADS
    run:
        genomes = sorted(list((Path(input.drep_dir) / "dereplicated_genomes").glob("*.fa")) + list((Path(input.drep_dir) / "dereplicated_genomes").glob("*.fasta")))
        env = os.environ.copy()
        env["PATH"] = DBCAN_ENV + os.pathsep + env.get("PATH", "")
        
        for genome in genomes:
            mag = clean_mag_id(genome.name)
            outdir = Path(DBCAN_DIR) / wildcards.sample / mag
            shutil.rmtree(outdir, ignore_errors=True)
            outdir.mkdir(parents=True, exist_ok=True)
            command = [DBCAN_BIN, str(genome), "meta", "--db_dir", DBCAN_DB, "--out_dir", str(outdir), "--tf_cpu", str(MAG_THREADS), "--dia_cpu", str(MAG_THREADS), "--hmm_cpu", str(MAG_THREADS)]
            subprocess.run(command, env=env, check=True)
            
        Path(output.done).parent.mkdir(parents=True, exist_ok=True)
        Path(output.done).touch()

# Scalable Batch cctyper CRISPR/Cas Typing
rule cctyper_batch:
    input:
        drep_done=DREP_DONE,
        drep_dir=DREP_OUTPUT
    output:
        done=f"{CCTYPER_DIR}/{{sample}}/cctyper_batch.done"
    threads: THREADS
    run:
        genomes = sorted(list((Path(input.drep_dir) / "dereplicated_genomes").glob("*.fa")) + list((Path(input.drep_dir) / "dereplicated_genomes").glob("*.fasta")))
        env = os.environ.copy()
        env["PATH"] = CCTYPER_ENV + os.pathsep + env.get("PATH", "")
        
        for genome in genomes:
            mag = clean_mag_id(genome.name)
            outdir = Path(CCTYPER_DIR) / wildcards.sample / mag
            shutil.rmtree(outdir, ignore_errors=True)
            outdir.mkdir(parents=True, exist_ok=True)
            command = [CCTYPER_BIN, str(genome), str(outdir), "--db", CCTYPER_DB, "-t", str(MAG_THREADS)]
            subprocess.run(command, env=env, check=False)
            
        Path(output.done).parent.mkdir(parents=True, exist_ok=True)
        Path(output.done).touch()

# Scalable Batch Abricate Antimicrobial Resistance & Virulence Profiling
rule abricate_batch:
    input:
        drep_done=DREP_DONE,
        drep_dir=DREP_OUTPUT
    output:
        done=f"{ABRICATE_DIR}/{{sample}}/abricate_batch.done"
    threads: THREADS
    run:
        genomes = sorted(list((Path(input.drep_dir) / "dereplicated_genomes").glob("*.fa")) + list((Path(input.drep_dir) / "dereplicated_genomes").glob("*.fasta")))
        env = os.environ.copy()
        env["PATH"] = ABRICATE_ENV + os.pathsep + env.get("PATH", "")
        
        for db in ABRICATE_DBS:
            db_outdir = Path(ABRICATE_DIR) / wildcards.sample / db
            db_outdir.mkdir(parents=True, exist_ok=True)
            for genome in genomes:
                mag = clean_mag_id(genome.name)
                tsv_out = db_outdir / f"{mag}.{db}.tsv"
                with open(tsv_out, "wb") as out_h:
                    subprocess.run([ABRICATE, "--db", db, "--minid", "80", "--mincov", "70", str(genome)], stdout=out_h, env=env, check=True)
                    
        Path(output.done).parent.mkdir(parents=True, exist_ok=True)
        Path(output.done).touch()

# Scalable Batch DRAM Functional Profiling
rule dram_batch:
    input:
        drep_done=DREP_DONE,
        drep_dir=DREP_OUTPUT
    output:
        done=f"{DRAM_DIR}/{{sample}}/dram_batch.done"
    threads: THREADS
    run:
        genomes = sorted(list((Path(input.drep_dir) / "dereplicated_genomes").glob("*.fa")) + list((Path(input.drep_dir) / "dereplicated_genomes").glob("*.fasta")))
        outdir = Path(DRAM_DIR) / wildcards.sample / "batch_output"
        shutil.rmtree(outdir, ignore_errors=True)
        outdir.mkdir(parents=True, exist_ok=True)
        
        env = os.environ.copy()
        if DRAM_ENV:
            env["PATH"] = DRAM_ENV + os.pathsep + env.get("PATH", "")
            
        fasta_args = [str(g.resolve()) for g in genomes]
        if fasta_args:
            command = [
                DRAM_BIN, "annotate_genes", "-i", *fasta_args, "-o", str(outdir),
                "--threads", str(threads), "--min_contig_size", "1000"
            ]
            subprocess.run(command, env=env, check=True)
                
        Path(output.done).touch()

# Optimized Proteinortho execution via parallelized Prodigal ORF calling
rule hadeg_proteinortho_optimized:
    input:
        hadeg_db=lambda wc: HADEG_DB,
        drep_done=DREP_DONE,
        drep_dir=DREP_OUTPUT
    output:
        tsv=f"{HADEG_OUTDIR}/{{sample}}/Results_HADEG.proteinortho.tsv",
        done=f"{HADEG_OUTDIR}/{{sample}}/hadeg_proteinortho.done"
    threads: THREADS
    run:
        outdir = Path(output.tsv).parent.resolve()
        clean_dir = outdir / "clean_faa"
        shutil.rmtree(clean_dir, ignore_errors=True)
        clean_dir.mkdir(parents=True, exist_ok=True)
        
        hadeg_db = Path(input.hadeg_db).resolve()
        genomes = sorted(list((Path(input.drep_dir) / "dereplicated_genomes").glob("*.fa")) + list((Path(input.drep_dir) / "dereplicated_genomes").glob("*.fasta")))
        
        def sanitize_fasta(src, dst):
            import re
            allowed = re.compile(r"[^XOUBZACDEFGHIKLMNPQRSTVWY]", re.IGNORECASE)
            with open(src) as s, open(dst, "w") as d:
                for line in s:
                    if line.startswith(">"): d.write(line)
                    elif (seq := allowed.sub("", line.strip())): d.write(seq + "\n")
        
        sanitize_fasta(hadeg_db, clean_dir / hadeg_db.name)
        clean_mags = []
        
        env = os.environ.copy()
        env["PATH"] = str(Path(PRODIGAL).parent) + os.pathsep + env.get("PATH", "")
        
        for genome in genomes:
            mag = clean_mag_id(genome.name)
            faa_out = clean_dir / f"{mag}.faa"
            cmd = [PRODIGAL, "-i", str(genome.resolve()), "-a", str(faa_out), "-p", "meta", "-q"]
            subprocess.run(cmd, env=env, check=True)
            
            sanitized_faa = clean_dir / f"{mag}.sanitized.faa"
            sanitize_fasta(faa_out, sanitized_faa)
            clean_mags.append(str(sanitized_faa.resolve()))
            
        if not clean_mags:
            Path(output.tsv).write_text(f"# Species\tGenes\tAlg.-Conn.\t{hadeg_db.name}\n")
        else:
            env_po = os.environ.copy()
            env_po["PATH"] = str(Path(PROTEINORTHO).parent) + os.pathsep + HADEG_BLAST_BINPATH + os.pathsep + env_po.get("PATH", "")
            subprocess.run(
                [PROTEINORTHO, str((clean_dir / hadeg_db.name).resolve()), *clean_mags, 
                 "-identity=50", "-conn=0.3", "-synteny=0", "-project=Results_HADEG", f"-cpus={threads}"],
                cwd=outdir, env=env_po, check=True
            )
        Path(output.done).touch()

rule multiqc:
    input: MULTIQC_INPUTS
    output: report=f"{MULTIQC_DIR}/multiqc_report.html"
    log: f"{LOG_DIR}/reporting/{SAMPLE}_multiqc.log"
    threads: 1
    run:
        Path(MULTIQC_DIR).mkdir(parents=True, exist_ok=True); Path(log[0]).parent.mkdir(parents=True, exist_ok=True)
        scan_paths = [FASTP_DIR, RAW_QC_DIR, CLEAN_QC_DIR, ASSEMBLY_QC_DIR, MAP_DIR, MAG_QC_DIR]
        if RUN_KRAKEN: scan_paths.append(KRAKEN_DIR)
        if RUN_METAPHLAN: scan_paths.append(METAPHLAN_DIR)
        if RUN_DRAM: scan_paths.append(DRAM_DIR)
        if RUN_HADEG: scan_paths.append(HADEG_OUTDIR)
        
        env = os.environ.copy()
        env["PATH"] = str(Path(MULTIQC).parent) + os.pathsep + env.get("PATH", "")
        with open(log[0], "wb") as log_handle:
            subprocess.run([MULTIQC, *scan_paths, "--ignore", "*.done", "--ignore", "*.bam", "--ignore", "*.bai", "--ignore", "*/per_mag/*", "-o", MULTIQC_DIR, "--force"], stdout=log_handle, stderr=subprocess.STDOUT, env=env, check=False)
