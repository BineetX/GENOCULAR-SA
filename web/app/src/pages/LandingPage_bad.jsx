// /src/pages/LandingPage.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { useAuth } from "../auth/AuthProvider.jsx";
import { apiJson } from "../lib/api.js";
import {
  Database,
  Server,
  Cpu,
  Clock,
  Box,
  Play,
  CheckCircle2,
  ChevronRight,
  ShieldCheck,
  Microscope,
  Workflow,
  FlaskConical,
  HardDriveDownload,
  FileText,
  ListTree,
  AlertTriangle,
  Loader2,
  Hourglass,
} from "lucide-react";

import pipelineSvg from "../assets/pipeline.svg";

/* ================================
   Animations & Visual Config
================================= */
const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.5, ease: "easeOut" },
  }),
};

// Background beams config
const gridBeams = [
  { top: "18%", left: "6%", axis: "x", distance: 480, duration: 9.5, delay: 0.4 },
  { top: "58%", left: "12%", axis: "x", distance: 560, duration: 11.2, delay: 1.2 },
  { top: "28%", left: "85%", axis: "y", distance: -300, duration: 10.3, delay: 0.7 },
  { top: "76%", left: "78%", axis: "y", distance: -360, duration: 12.4, delay: 1.7 },
];

// Carousel row height (px) = h-10 (40) + space-y-2 (8)
const CAROUSEL_ITEM_HEIGHT = 48;

const TOOL_LINKS = {
  fastqc_raw: "https://www.bioinformatics.babraham.ac.uk/projects/fastqc/",
  trimmomatic: "http://www.usadellab.org/cms/?page=trimmomatic",
  cutadapt: "https://cutadapt.readthedocs.io/",
  cutadapt_paired: "https://cutadapt.readthedocs.io/",
  seqtk: "https://github.com/lh3/seqtk",
  seqtk_trim: "https://github.com/lh3/seqtk",
  bbduk: "https://jgi.doe.gov/data-and-tools/bbtools/",
  kraken: "https://ccb.jhu.edu/software/kraken2/",
  kraken_classify: "https://ccb.jhu.edu/software/kraken2/",
  kraken_extract: "https://github.com/jenniferlu717/KrakenTools",
  kraken_extract_reads: "https://github.com/jenniferlu717/KrakenTools",
  kraken_classify_short: "https://ccb.jhu.edu/software/kraken2/",
  kraken_extract_short: "https://github.com/jenniferlu717/KrakenTools",
  kraken_classify_long: "https://ccb.jhu.edu/software/kraken2/",
  kraken_extract_long: "https://github.com/jenniferlu717/KrakenTools",
  nanoplot: "https://github.com/wdecoster/NanoPlot",
  pipeline_decision: "",
  adaptive_filter: "",
  spades: "https://cab.spbu.ru/software/spades/",
  flye: "https://github.com/mikolmogorov/Flye",
  racon_round1: "https://github.com/isovic/racon",
  racon_round2: "https://github.com/isovic/racon",
  finalize_assembly: "",
  unicycler: "https://github.com/rrwick/Unicycler",
  prodigal: "https://github.com/hyattpd/Prodigal",
  prokka: "https://github.com/tseemann/prokka",
  fastqc_trimmed: "https://www.bioinformatics.babraham.ac.uk/projects/fastqc/",
  repeatmasker: "http://www.repeatmasker.org/",
  abricate: "https://github.com/tseemann/abricate",
  kofam: "https://github.com/takaram/kofam_scan",
  kofamscan: "https://github.com/takaram/kofam_scan",
  dbcan: "https://bcb.unl.edu/dbCAN2/",
  eggnog: "https://github.com/eggnogdb/eggnog-mapper",
  eggnog_mapper: "https://github.com/eggnogdb/eggnog-mapper",
  interpro: "https://www.ebi.ac.uk/interpro/",
  interproscan: "https://www.ebi.ac.uk/interpro/",
  quast: "http://quast.sourceforge.net/",
  busco: "https://busco.ezlab.org/",
  prepare_checkm_input: "https://github.com/Ecogenomics/CheckM",
  prepcheckm: "https://github.com/Ecogenomics/CheckM",
  checkm: "https://github.com/Ecogenomics/CheckM",
  cctyper: "https://github.com/Russel88/CRISPRCasTyper",
  crispr: "https://crisprcas.i2bc.paris-saclay.fr/",
  antismash: "https://antismash.secondarymetabolites.org/",
  hadeg: "https://github.com/jakob-schneider/HADEG",
  barrnap_16s: "https://github.com/tseemann/barrnap",
  blast_16s: "https://blast.ncbi.nlm.nih.gov/Blast.cgi",
  fastani: "https://github.com/ParBLiSS/FastANI",
  // final report is internal – no external link
};

const TOOL_META = {
  fastqc_raw: { title: "FastQC (Raw)", desc: "Raw short-read quality baseline." },
  trimmomatic: { title: "Trimmomatic", desc: "Initial adapter and quality trimming." },
  cutadapt_paired: { title: "Cutadapt", desc: "Paired adapter trimming." },
  cutadapt: { title: "Cutadapt", desc: "Short-read adapter trimming in hybrid mode." },
  seqtk_trim: { title: "Seqtk", desc: "Short-read quality trimming." },
  seqtk: { title: "Seqtk", desc: "Short-read trimming in hybrid mode." },
  bbduk: { title: "BBDuk", desc: "K-mer based contaminant filtering." },
  fastqc_trimmed: { title: "FastQC (Trimmed)", desc: "Post-trim quality confirmation." },
  kraken_classify: { title: "Kraken2: Classify", desc: "Taxonomy assignment." },
  kraken_extract_reads: { title: "Kraken2: Extract Reads", desc: "Extract classified short reads." },
  kraken_extract: { title: "Kraken2: Extract Reads", desc: "Extract classified long reads." },
  kraken_classify_short: { title: "Kraken2: Short Classify", desc: "Taxonomy on short reads." },
  kraken_extract_short: { title: "Kraken2: Short Extract", desc: "Short-read extraction for hybrid." },
  kraken_classify_long: { title: "Kraken2: Long Classify", desc: "Taxonomy on long reads." },
  kraken_extract_long: { title: "Kraken2: Long Extract", desc: "Long-read extraction for hybrid." },
  spades: { title: "SPAdes", desc: "Short-read de novo assembly." },
  flye: { title: "Flye", desc: "Long-read assembly." },
  racon_round1: { title: "Racon Round 1", desc: "Long-read polishing pass 1." },
  racon_round2: { title: "Racon Round 2", desc: "Long-read polishing pass 2." },
  finalize_assembly: { title: "Finalize Assembly", desc: "Select polished final assembly." },
  unicycler: { title: "Unicycler", desc: "Hybrid assembly (short + long)." },
  nanoplot: { title: "NanoPlot", desc: "Long-read QC distribution analysis." },
  pipeline_decision: { title: "Adaptive Decision", desc: "Pipeline rule selection from QC signals." },
  adaptive_filter: { title: "Adaptive Filter", desc: "Long-read filtering stage." },
  prokka: { title: "Prokka", desc: "Genome annotation." },
  prodigal: { title: "Prodigal", desc: "Coding sequence prediction." },
  repeatmasker: { title: "RepeatMasker", desc: "Repeat masking." },
  interproscan: { title: "InterProScan", desc: "Protein domain annotation." },
  quast: { title: "QUAST", desc: "Assembly quality metrics." },
  busco: { title: "BUSCO", desc: "Completeness benchmarking." },
  prepare_checkm_input: { title: "Prepare CheckM Input", desc: "Input preparation for CheckM." },
  checkm: { title: "CheckM", desc: "Completeness and contamination." },
  abricate: { title: "ABRicate", desc: "AMR and virulence marker scan." },
  kofamscan: { title: "KofamScan", desc: "KO assignment." },
  dbcan: { title: "dbCAN", desc: "CAZyme annotation." },
  eggnog_mapper: { title: "eggNOG-mapper", desc: "Orthology-based functional annotation." },
  cctyper: { title: "CCTyper", desc: "CRISPR-Cas typing." },
  crispr: { title: "CRISPRCasFinder", desc: "CRISPR locus detection." },
  antismash: { title: "antiSMASH", desc: "Biosynthetic gene cluster mining." },
  hadeg: { title: "HADEG", desc: "Hydrocarbon degradation gene screening." },
  barrnap_16s: { title: "Barrnap 16S", desc: "16S rRNA extraction." },
  blast_16s: { title: "BLAST 16S", desc: "SILVA 16S similarity search." },
  fastani: { title: "FastANI", desc: "ANI benchmarking against references." },
  final_report: { title: "Final Report", desc: "Consolidated output and report index." },
  manifest: { title: "Manifest", desc: "Artifact manifest for downstream access." },
  fastp: { title: "fastp", desc: "Short-read quality trimming and filtering." },
  kneaddata: { title: "KneadData", desc: "Host read removal and decontamination." },
  metaphlan: { title: "MetaPhlAn", desc: "Taxonomic profiling from cleaned reads." },
  megahit: { title: "MEGAHIT", desc: "Short-read metagenome assembly." },
  megahit_assembly: { title: "MEGAHIT", desc: "Hybrid short-read assembly branch." },
  operams_assembly: { title: "OPERA-MS", desc: "Hybrid metagenome assembly." },
  nanostat_raw: { title: "NanoStat", desc: "Long-read summary statistics." },
  nanoq_adaptive: { title: "nanoq", desc: "Adaptive long-read filtering." },
  host_removal: { title: "Host Removal", desc: "Long-read host decontamination." },
  host_removal_lr: { title: "Long-read Host Removal", desc: "Hybrid long-read decontamination." },
  flye_assembly: { title: "metaFlye", desc: "Long-read metagenome assembly." },
  medaka_polish: { title: "Medaka", desc: "ONT assembly polishing." },
  bowtie2_index: { title: "Bowtie2 Index", desc: "Build contig mapping index." },
  bowtie2_map: { title: "Bowtie2 Mapping", desc: "Map short reads to contigs." },
  minimap2_map: { title: "Minimap2 Mapping", desc: "Map long reads to contigs." },
  merge_bams: { title: "Merge BAMs", desc: "Merge hybrid read alignments." },
  depth: { title: "Depth Summary", desc: "Calculate contig coverage." },
  filter_contigs_by_depth: { title: "Depth Filter", desc: "Filter contigs before binning." },
  minimap2_map_filtered: { title: "Minimap2 Filtered Mapping", desc: "Map reads to filtered contigs." },
  depth_filtered: { title: "Filtered Depth Summary", desc: "Calculate filtered contig coverage." },
  metabat_depth: { title: "MetaBAT Depth", desc: "Prepare MetaBAT2 depth table." },
  metabat2: { title: "MetaBAT2", desc: "Coverage-based MAG binning." },
  maxbin2: { title: "MaxBin2", desc: "Composition and abundance based binning." },
  semibin2: { title: "SemiBin2", desc: "Self-supervised MAG binning." },
  contig2bin_tables: { title: "Contig-to-bin Tables", desc: "Prepare DAS Tool bin maps." },
  metabat2_to_contig2bin: { title: "MetaBAT2 Contig Map", desc: "Convert MetaBAT2 bins for DAS Tool." },
  semibin2_to_contig2bin: { title: "SemiBin2 Contig Map", desc: "Convert SemiBin2 bins for DAS Tool." },
  dastool: { title: "DAS Tool", desc: "Consensus MAG bin selection." },
  select_dastool_bins: { title: "Select MAGs", desc: "Stage DAS Tool MAG bins." },
  checkm2: { title: "CheckM2", desc: "MAG quality assessment." },
  quast_per_mag: { title: "MetaQUAST per MAG", desc: "Assembly QC for each MAG." },
  quast_per_mag_all: { title: "MetaQUAST MAG Summary", desc: "Finalize MAG assembly QC." },
  merge_mag_qc: { title: "Merge MAG QC", desc: "Combine MAG quality metrics." },
  mag_filter: { title: "MAG Filter", desc: "Filter MAGs by quality thresholds." },
  gtdbtk: { title: "GTDB-Tk", desc: "MAG taxonomic classification." },
  drep: { title: "dRep", desc: "MAG dereplication." },
  coverm: { title: "CoverM", desc: "MAG abundance profiling." },
  barrnap_per_mag: { title: "Barrnap per MAG", desc: "Detect rRNA features per MAG." },
  barrnap_all: { title: "Barrnap Summary", desc: "Collect 16S rRNA detections." },
  prokka_all: { title: "Prokka Summary", desc: "Finalize MAG annotation outputs." },
  cctyper_per_mag: { title: "CCTyper per MAG", desc: "CRISPR-Cas typing per MAG." },
  cctyper_all: { title: "CCTyper Summary", desc: "Collect CRISPR-Cas typing results." },
  dbcan_per_mag: { title: "dbCAN per MAG", desc: "CAZyme annotation per MAG." },
  dbcan_all: { title: "dbCAN Summary", desc: "Collect CAZyme annotations." },
  abricate_summary: { title: "ABRicate Summary", desc: "Summarize marker annotations." },
  abricate_all: { title: "ABRicate Complete", desc: "Finalize marker annotations." },
  hadeg_proteinortho: { title: "HADEG Proteinortho", desc: "Hydrocarbon degradation orthology analysis." },
  busco_filtered_per_mag: { title: "BUSCO Filtered MAG", desc: "Completeness for filtered MAGs." },
  busco_filtered_all: { title: "BUSCO Filtered Summary", desc: "Collect filtered MAG BUSCO outputs." },
  prodigal_assembly: { title: "Prodigal Assembly", desc: "Predict genes on metagenome assembly." },
  cdhit_genes: { title: "CD-HIT Genes", desc: "Cluster nucleotide gene catalogue." },
  cdhit_proteins: { title: "CD-HIT Proteins", desc: "Cluster protein gene catalogue." },
  salmon_index: { title: "Salmon Index", desc: "Build gene quantification index." },
  salmon_quant: { title: "Salmon Quant", desc: "Quantify gene catalogue abundance." },
  minimap2_gene_map: { title: "Minimap2 Gene Mapping", desc: "Map long reads to gene catalogue." },
  bowtie2_gene_map: { title: "Bowtie2 Gene Mapping", desc: "Map short reads to gene catalogue." },
  featurecounts_gene_quant: { title: "featureCounts", desc: "Quantify gene catalogue abundance." },
  multiqc_collect: { title: "MultiQC Collect", desc: "Collect report inputs." },
  multiqc: { title: "MultiQC", desc: "Aggregate quality reports." },
  analysis_plots: { title: "Analysis Plots", desc: "Generate frontend-ready result plots." },
};

const LEGACY_ORDER = [
  "trimmomatic",
  "cutadapt_paired",
  "seqtk_trim",
  "bbduk",
  "kraken_classify",
  "kraken_extract",
  "spades",
  "prokka",
  "repeatmasker",
  "interproscan",
  "quast",
  "busco",
  "prepare_checkm_input",
  "checkm",
  "prodigal",
  "abricate",
  "kofamscan",
  "dbcan",
  "eggnog_mapper",
  "crispr",
  "antismash",
  "final_report",
  "manifest",
];

const META_SHORT_ORDER = [
  "fastp", "kneaddata", "metaphlan", "megahit", "quast",
  "bowtie2_index", "bowtie2_map", "depth", "metabat2", "maxbin2",
  "contig2bin_tables", "dastool", "select_dastool_bins", "checkm2", "busco",
  "quast_per_mag", "quast_per_mag_all", "merge_mag_qc", "mag_filter",
  "gtdbtk", "drep", "coverm", "barrnap_per_mag", "barrnap_all",
  "prokka", "prokka_all", "cctyper_per_mag", "cctyper_all",
  "dbcan_per_mag", "dbcan_all", "abricate", "abricate_summary",
  "abricate_all", "hadeg_proteinortho", "busco_filtered_per_mag",
  "busco_filtered_all", "prodigal_assembly", "cdhit_genes",
  "salmon_index", "salmon_quant", "multiqc", "analysis_plots",
];

const META_LONG_ORDER = [
  "nanostat_raw", "nanoq_adaptive", "host_removal", "flye_assembly",
  "medaka_polish", "quast", "minimap2_map", "depth",
  "filter_contigs_by_depth", "minimap2_map_filtered", "depth_filtered",
  "metabat_depth", "metabat2", "semibin2", "metabat2_to_contig2bin",
  "semibin2_to_contig2bin", "dastool", "select_dastool_bins",
  "checkm2", "busco", "quast_per_mag", "quast_per_mag_all",
  "merge_mag_qc", "mag_filter", "drep", "gtdbtk", "barrnap_per_mag",
  "barrnap_all", "prokka", "prokka_all", "prodigal_assembly",
  "cdhit_proteins", "cctyper_per_mag", "cctyper_all", "dbcan_per_mag",
  "dbcan_all", "abricate", "abricate_summary", "abricate_all",
  "hadeg_proteinortho", "coverm", "minimap2_gene_map",
  "featurecounts_gene_quant", "multiqc_collect", "multiqc", "analysis_plots",
];

const META_HYBRID_ORDER = [
  "fastp", "kneaddata", "nanostat_raw", "nanoq_adaptive", "host_removal_lr",
  "megahit_assembly", "operams_assembly", "quast", "bowtie2_index",
  "bowtie2_map", "minimap2_map", "merge_bams", "depth", "metabat2",
  "semibin2", "metabat2_to_contig2bin", "semibin2_to_contig2bin",
  "dastool", "select_dastool_bins", "checkm2", "busco", "quast_per_mag",
  "quast_per_mag_all", "merge_mag_qc", "mag_filter", "gtdbtk", "drep",
  "coverm", "barrnap_per_mag", "barrnap_all", "prokka", "prokka_all",
  "cctyper_per_mag", "cctyper_all", "dbcan_per_mag", "dbcan_all",
  "abricate", "abricate_summary", "abricate_all", "hadeg_proteinortho",
  "busco_filtered_per_mag", "busco_filtered_all", "prodigal_assembly",
  "cdhit_proteins", "bowtie2_gene_map", "featurecounts_gene_quant",
  "multiqc", "analysis_plots",
];

const PROFILE_LABELS = {
  "wgs:short": "WGS · Short Reads",
  "wgs:long": "WGS · Long Reads",
  "wgs:hybrid": "WGS · Hybrid",
  "metagenomics:short": "Metagenomics · Short Reads",
  "metagenomics:long": "Metagenomics · Long Reads",
  "metagenomics:hybrid": "Metagenomics · Hybrid",
};

const PROFILE_KEYS = Object.keys(PROFILE_LABELS);

// Read-mode input description (factual: which sequencing chemistries feed each mode).
const READ_MODE_INPUTS = {
  short: "Illumina paired-end FASTQ",
  long: "Oxford Nanopore or PacBio FASTQ",
  hybrid: "Illumina paired-end + long-read FASTQ",
};

// Principal output categories per analysis type (matches Results Artifacts capability copy).
const ANALYSIS_OUTPUTS = {
  wgs: "QC report, assembly, gene calls, genome annotation, AMR/CRISPR screens",
  metagenomics: "QC report, metagenome assembly, MAGs, taxonomy, functional annotation",
};

function fmtAvgDuration(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "—";
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

// Same state vocabulary as JobsHistory.jsx / SidebarNav.jsx, reused here for consistency.
function normalizeJobState(s = "") {
  const x = String(s || "").toLowerCase();
  if (!x) return "unknown";
  if (/(fail|error|cancel|abort)/.test(x)) return "failed";
  if (/(queue|queued|pending|wait)/.test(x)) return "queued";
  if (/(run|running|in[_-]?progress|active|start)/.test(x)) return "running";
  if (/(complete|completed|done|success|succeeded|finished|ok)/.test(x)) return "completed";
  return "unknown";
}

const JOB_STATE_META = {
  running: { label: "Running", tone: "bg-sky-50 text-sky-700 ring-sky-200", icon: Loader2 },
  queued: { label: "Queued", tone: "bg-amber-50 text-amber-700 ring-amber-200", icon: Hourglass },
  completed: { label: "Completed", tone: "bg-emerald-50 text-emerald-700 ring-emerald-200", icon: CheckCircle2 },
  failed: { label: "Failed", tone: "bg-red-50 text-red-700 ring-red-200", icon: AlertTriangle },
  unknown: { label: "Not checked", tone: "bg-slate-100 text-slate-600 ring-slate-200", icon: Clock },
};

function fmtElapsed(fromMs, toMs = Date.now()) {
  if (!fromMs) return "—";
  const s = Math.max(0, Math.round((toMs - fromMs) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function displaySampleName(sampleId = "") {
  const raw = String(sampleId || "").trim();
  if (!raw) return "Untitled submission";
  const n = raw.toLowerCase();
  if (["sample", "sample1", "s1", "job1", "job"].includes(n)) return "Untitled submission";
  return raw;
}

const PROFILE_ORDERS = {
  "wgs:short": [
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
  ],
  "wgs:long": [
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
  ],
  "wgs:hybrid": [
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
  ],
  "metagenomics:short": META_SHORT_ORDER,
  "metagenomics:long": META_LONG_ORDER,
  "metagenomics:hybrid": META_HYBRID_ORDER,
};

const ANALYSIS_OPTIONS = [
  { key: "wgs", label: "WGS" },
  { key: "metagenomics", label: "Metagenomics" },
];

const MODE_OPTIONS = [
  { key: "short", label: "Short" },
  { key: "long", label: "Long" },
  { key: "hybrid", label: "Hybrid" },
];

// Real, already-implemented capabilities only — no invented tools or claims.
const CAPABILITY_ITEMS = [
  {
    icon: Workflow,
    title: "Read QC and preprocessing",
    desc: "Adapter trimming, quality filtering, and host-read removal ahead of assembly or profiling.",
    profiles: "All profiles",
  },
  {
    icon: Box,
    title: "Genome and metagenome assembly",
    desc: "Short-read, long-read, and hybrid assembly strategies depending on the selected profile.",
    profiles: "WGS · Metagenomics",
  },
  {
    icon: FlaskConical,
    title: "Assembly-quality assessment",
    desc: "QUAST and BUSCO metrics report contiguity and completeness for each assembly.",
    profiles: "All profiles",
  },
  {
    icon: Database,
    title: "Genome binning and MAG recovery",
    desc: "Coverage- and composition-based binning with DAS Tool consensus bin selection.",
    profiles: "Metagenomics",
  },
  {
    icon: FlaskConical,
    title: "MAG-quality evaluation",
    desc: "CheckM2 completeness and contamination estimates per recovered MAG.",
    profiles: "Metagenomics",
  },
  {
    icon: Microscope,
    title: "Taxonomic classification",
    desc: "Kraken2-based read classification and GTDB-Tk taxonomy for isolates and MAGs.",
    profiles: "All profiles",
  },
  {
    icon: FileText,
    title: "Genome annotation",
    desc: "Gene calling and functional annotation of predicted coding sequences.",
    profiles: "All profiles",
  },
  {
    icon: ShieldCheck,
    title: "AMR and virulence analysis",
    desc: "Marker-based screening for antimicrobial resistance and virulence genes.",
    profiles: "All profiles",
  },
  {
    icon: ListTree,
    title: "CRISPR-Cas analysis",
    desc: "Detection and typing of CRISPR-Cas loci in assembled sequences.",
    profiles: "All profiles",
  },
  {
    icon: Cpu,
    title: "Functional annotation",
    desc: "Orthology- and domain-based functional assignment of predicted genes.",
    profiles: "All profiles",
  },
  {
    icon: HardDriveDownload,
    title: "Result reports and artifacts",
    desc: "Structured, downloadable result folders with reports, tables, and logs.",
    profiles: "All profiles",
  },
  {
    icon: Server,
    title: "Controlled user-specific access",
    desc: "Job history and result visibility scoped to the authenticated user.",
    profiles: "All profiles",
  },
];

/* ================================
   Magnetic Button (CTA)
================================= */
const MagneticButton = ({ onClick, disabled, children }) => {
  const ref = useRef(null);
  const [t, setT] = useState({ x: 0, y: 0 });

  const reset = () => setT({ x: 0, y: 0 });

  const onMouseMove = (e) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) * 0.12;
    const dy = (e.clientY - cy) * 0.12;
    setT({ x: dx, y: dy });
  };

  return (
    <motion.button
      ref={ref}
      onMouseMove={onMouseMove}
      onMouseLeave={reset}
      onClick={onClick}
      disabled={disabled}
      style={{ transform: `translate3d(${t.x}px, ${t.y}px, 0)` }}
      whileHover={{ scale: 1.03, boxShadow: "0 28px 40px -18px rgba(14,165,233,0.35)" }}
      whileTap={{ scale: 0.98 }}
      className="group relative inline-flex items-center gap-3 px-8 py-3.5 bg-slate-900 text-white rounded-full font-semibold text-sm shadow-xl hover:bg-slate-800 transition-all overflow-hidden"
    >
      <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent z-10" />
      <span className="relative z-20 flex items-center gap-2">{children}</span>
    </motion.button>
  );
};

/* ================================
   Parallax Card (subtle)
================================= */
const ParallaxCard = ({ children, className = "" }) => {
  return (
    <div className="relative [perspective:1200px]">
      <div className={`relative rounded-2xl border border-slate-200 bg-white/95 backdrop-blur-md shadow-[0_28px_52px_-26px_rgba(15,23,42,0.35)] overflow-hidden [transform-style:preserve-3d] ${className}`}>
        {/* glossy highlight following global cursor */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(500px circle at var(--mx, 50%) var(--my, 50%), rgba(56,189,248,0.12), transparent 60%)",
            mixBlendMode: "screen",
          }}
        />
        {children}
      </div>
    </div>
  );
};

/* ================================
   Landing
================================= */
const LandingPage = () => {
  const navigate = useNavigate();
  const prefersReducedMotion = useReducedMotion();
  const { user, loading: checkingAuth } = useAuth();
  const [stats, setStats] = useState({ totalRuns: null, loading: true });
  const [runDurations, setRunDurations] = useState({ runTypes: [], loading: true });

  // Recent jobs registry (real backend data — same endpoints as JobsHistory.jsx)
  const [recentJobs, setRecentJobs] = useState([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [statusMap, setStatusMap] = useState({});

  useEffect(() => {
    let cancelled = false;
    if (!user?.uid) {
      setRecentJobs([]);
      setJobsLoading(false);
      return;
    }
    setJobsLoading(true);
    (async () => {
      try {
        const res = await apiJson(`/user-jobs?user_id=${encodeURIComponent(user.uid)}`);
        if (cancelled) return;
        const jobs = Array.isArray(res?.jobs) ? res.jobs : [];
        setRecentJobs(jobs.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)));
      } catch {
        if (!cancelled) setRecentJobs([]);
      } finally {
        if (!cancelled) setJobsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  // Poll status for the jobs shown on the homepage, mirroring JobsHistory.jsx.
  useEffect(() => {
    if (!recentJobs.length) return;
    let active = true;
    const ids = recentJobs.slice(0, 6).map((r) => r.jobId).filter(Boolean);

    const refresh = async () => {
      await Promise.all(
        ids.map(async (jobId) => {
          try {
            const s = await apiJson(`/jobs/${jobId}/status`);
            if (!active) return;
            setStatusMap((m) => ({ ...m, [jobId]: s }));
          } catch {
            // transient — keep prior known status
          }
        })
      );
    };
    refresh();
    const timer = setInterval(refresh, 10_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [recentJobs]);

  // Fetch stats (total runs)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const data = await apiJson("/stats/overview");
        if (!cancelled) {
          const total =
            typeof data?.total_runs === "number"
              ? data.total_runs
              : typeof data?.totalRuns === "number"
                ? data.totalRuns
                : null;
          setStats({ totalRuns: total, loading: false });
        }
      } catch (err) {
        if (!cancelled) {
          setStats({ totalRuns: null, loading: false });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch stats (average run time by run type)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const data = await apiJson("/stats/run-durations");
        if (!cancelled) {
          setRunDurations({ runTypes: data?.run_types || [], loading: false });
        }
      } catch (err) {
        if (!cancelled) {
          setRunDurations({ runTypes: [], loading: false });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleStartNow = () => {
    if (checkingAuth) return;
    navigate(user ? "/run" : "/signin");
  };

  const [analysisType, setAnalysisType] = useState("wgs");
  const [readMode, setReadMode] = useState("short");
  const selectedProfile = `${analysisType}:${readMode}`;
  const durationRows = useMemo(() => {
    const byProfile = new Map((runDurations.runTypes || []).map((row) => [row.profile, row]));
    return PROFILE_KEYS.map((profile) => ({
      profile,
      label: PROFILE_LABELS[profile],
      avg_seconds: byProfile.get(profile)?.avg_seconds ?? null,
      count: byProfile.get(profile)?.count ?? 0,
    }));
  }, [runDurations.runTypes]);
  const activeDuration = durationRows.find((row) => row.profile === selectedProfile);
  const selectedOrder = PROFILE_ORDERS[selectedProfile] || LEGACY_ORDER;
  const pipelineSteps = useMemo(
    () =>
      selectedOrder.map((k) => ({
        key: k,
        title: TOOL_META[k]?.title || k.replace(/_/g, " "),
        desc: TOOL_META[k]?.desc || "Workflow stage",
      })),
    [selectedOrder]
  );
  const activeProfileLabel = `${analysisType.toUpperCase()} · ${readMode.toUpperCase()}`;

  const selectedWorkflowSummary = useMemo(
    () => ({
      profileLabel: PROFILE_LABELS[selectedProfile] || activeProfileLabel,
      input: READ_MODE_INPUTS[readMode] || "Sequencing FASTQ",
      stageCount: pipelineSteps.length,
      firstStage: pipelineSteps[0]?.title,
      lastStage: pipelineSteps[pipelineSteps.length - 1]?.title,
      outputs: ANALYSIS_OUTPUTS[analysisType] || "Workflow-specific result artifacts",
      ctaLabel: `Start ${PROFILE_LABELS[selectedProfile] || activeProfileLabel} analysis`,
      medianRuntime:
        activeDuration && activeDuration.count > 0 && typeof activeDuration.avg_seconds === "number"
          ? fmtAvgDuration(activeDuration.avg_seconds)
          : null,
      completedRuns: activeDuration?.count || 0,
    }),
    [selectedProfile, activeProfileLabel, readMode, analysisType, pipelineSteps, activeDuration]
  );

  // Job workspace summary — derived only from real /user-jobs + /jobs/{id}/status data.
  const jobWorkspace = useMemo(() => {
    const rows = recentJobs.map((r) => {
      const st = statusMap[r.jobId];
      const state = normalizeJobState(st?.state);
      return { ...r, status: st, state };
    });
    const counts = { running: 0, queued: 0, completed: 0, failed: 0, unknown: 0 };
    rows.forEach((r) => {
      counts[r.state] = (counts[r.state] || 0) + 1;
    });
    return { rows, counts, total: rows.length };
  }, [recentJobs, statusMap]);

  return (
    <div
      className="min-h-[calc(100vh-56px-40px)] text-slate-900 flex flex-col selection:bg-cyan-100 selection:text-slate-950"
      style={{ fontFamily: '"IBM Plex Sans", "Source Sans 3", "Segoe UI", sans-serif' }}
    >
      <main className="flex-1 flex flex-col bg-gradient-to-b from-slate-100 via-white to-slate-100">
        <section className="relative overflow-hidden border-b border-slate-300 lg:min-h-[86vh] flex items-center">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(71,85,105,0.18)_1px,transparent_1px),linear-gradient(to_bottom,rgba(71,85,105,0.14)_1px,transparent_1px)] bg-[size:44px_44px]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_10%,rgba(14,165,233,0.24),transparent_35%),radial-gradient(circle_at_20%_80%,rgba(13,148,136,0.18),transparent_40%),linear-gradient(180deg,rgba(248,250,252,0.68),rgba(255,255,255,0.96))]" />
            {!prefersReducedMotion && gridBeams.map((beam, idx) => (
              <motion.span
                key={idx}
                className="absolute rounded-full blur-[1px]"
                style={{
                  top: beam.top,
                  left: beam.left,
                  width: beam.axis === "x" ? "180px" : "2px",
                  height: beam.axis === "x" ? "2px" : "180px",
                  background:
                    "linear-gradient(to right, rgba(56,189,248,0.0), rgba(8,145,178,0.62), rgba(13,148,136,0.0))",
                }}
                animate={
                  beam.axis === "x"
                    ? { x: [0, beam.distance], opacity: [0, 1, 0] }
                    : { y: [0, beam.distance], opacity: [0, 1, 0] }
                }
                transition={{
                  duration: beam.duration,
                  delay: beam.delay,
                  repeat: Infinity,
                  repeatDelay: 1.3,
                  ease: "linear",
                }}
              />
            ))}
          </div>

          <div className="relative w-full px-4 sm:px-8 lg:px-14 xl:px-20 py-12 lg:py-14">
            <div className="grid gap-12 lg:grid-cols-2 xl:grid-cols-[1.1fr_0.9fr] items-start">
              <div className="space-y-6 z-10">
                <motion.div
                  variants={fadeUp}
                  custom={0}
                  initial="hidden"
                  animate="visible"
                  className="flex flex-wrap items-center gap-3"
                >
                  <Badge>BRIC–ILS Microbial Genomics Server</Badge>
                  <Pill icon={ShieldCheck} text="Authenticated analysis workspace" />
                </motion.div>

                <motion.div variants={fadeUp} custom={1} initial="hidden" animate="visible" className="space-y-3">
                  <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-slate-950 leading-[1.15]">
                    GENOCULAR
                  </h1>
                  <p className="text-base sm:text-lg font-medium text-slate-800 leading-snug max-w-2xl">
                    Integrated microbial whole-genome and metagenomic analysis
                  </p>
                  <p className="text-sm sm:text-[15px] text-slate-600 max-w-2xl leading-relaxed">
                    GENOCULAR provides reproducible server-side workflows for microbial isolate WGS
                    and metagenomics using short-read, long-read, and hybrid sequencing data.
                  </p>
                </motion.div>

                <motion.div
                  variants={fadeUp}
                  custom={2}
                  initial="hidden"
                  animate="visible"
                  className="rounded-xl border border-slate-300 bg-white/90 divide-y divide-slate-200 shadow-sm"
                >
                  <CapabilityRow label="Supported data" value="Illumina paired-end · Oxford Nanopore · PacBio · Hybrid" />
                  <CapabilityRow label="Analysis profiles" value="Microbial isolate WGS · Metagenomics and MAG recovery" />
                  <CapabilityRow label="Core processing" value="Quality control · Assembly · Binning · Taxonomy · Annotation" />
                  <CapabilityRow label="Results" value="QC reports · Assemblies · Genomes · MAGs · Biological annotations" />
                  <CapabilityRow label="Reproducibility" value="Defined workflows · Recorded parameters · Logs · Downloadable artifacts" last />
                </motion.div>

                <motion.div variants={fadeUp} custom={3} initial="hidden" animate="visible" className="space-y-3 pt-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <MagneticButton onClick={handleStartNow} disabled={checkingAuth}>
                      <Play size={16} className="opacity-80" />
                      {checkingAuth ? "Checking access…" : selectedWorkflowSummary.ctaLabel}
                      <ChevronRight size={16} className="text-cyan-200" />
                    </MagneticButton>
                    <button
                      onClick={() => navigate("/jobs")}
                      className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-600"
                    >
                      View jobs
                    </button>
                    <button
                      onClick={() => navigate("/about")}
                      className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-600"
                    >
                      Documentation
                    </button>
                  </div>
                  <div className="text-xs text-slate-500">
                    {user ? (
                      <>Signed in as <span className="font-medium text-slate-700">{user.email}</span></>
                    ) : (
                      "Sign in required to submit or view analyses."
                    )}
                  </div>
                </motion.div>

                <motion.div variants={fadeUp} custom={4} initial="hidden" animate="visible">
                  <SelectedWorkflowSummary summary={selectedWorkflowSummary} />
                </motion.div>

                <motion.div variants={fadeUp} custom={5} initial="hidden" animate="visible">
                  <JobWorkspaceSummary
                    user={user}
                    loading={jobsLoading}
                    workspace={jobWorkspace}
                    totalServerRuns={stats.totalRuns}
                    onOpenJob={(jobId) => navigate(`/jobs?job_id=${encodeURIComponent(jobId)}`)}
                    onViewAll={() => navigate("/jobs")}
                  />
                </motion.div>
              </div>

              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
                className="relative w-full max-w-xl justify-self-center lg:justify-self-end"
              >
                <ParallaxCard className="bg-white/95 border-slate-200">
                  <div className="border-b border-slate-200 px-4 py-3 bg-slate-50/80">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[11px] font-mono text-slate-600 uppercase tracking-[0.14em] flex items-center gap-2">
                        <Microscope size={13} className="text-cyan-600" />
                        Pipeline Preview
                      </div>
                      <span className="text-[10px] text-slate-500">{activeProfileLabel}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-slate-200 bg-white p-2">
                        <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Analysis</div>
                        <div className="flex gap-1">
                          {ANALYSIS_OPTIONS.map((opt) => (
                            <button
                              key={opt.key}
                              onClick={() => setAnalysisType(opt.key)}
                              className={
                                "px-2 py-1 rounded-md text-[11px] border transition-colors " +
                                (analysisType === opt.key
                                  ? "bg-cyan-50 border-cyan-500 text-cyan-700"
                                  : "bg-white border-slate-200 text-slate-500 hover:text-slate-800")
                              }
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-white p-2">
                        <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Read Mode</div>
                        <div className="flex gap-1">
                          {MODE_OPTIONS.map((opt) => (
                            <button
                              key={opt.key}
                              onClick={() => setReadMode(opt.key)}
                              className={
                                "px-2 py-1 rounded-md text-[11px] border transition-colors " +
                                (readMode === opt.key
                                  ? "bg-teal-50 border-teal-500 text-teal-700"
                                  : "bg-white border-slate-200 text-slate-500 hover:text-slate-800")
                              }
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <PipelineSchematic steps={pipelineSteps} />

                  <div className="bg-slate-50 border-t border-slate-200 p-3 text-[11px] text-slate-500 flex justify-between items-center">
                    <div className="flex gap-3">
                      <Dot color="bg-emerald-500" label="Integrated Enviromanets" />
                      <Dot color="bg-cyan-500" label="Validated Tools" />
                      <Dot color="bg-teal-500" label="Comprehenssive Result" />
                    </div>
                    <div className="text-slate-500 flex items-center gap-1">
                      <CheckCircle2 size={12} />
                      Develloped at BRIC-ILS
                    </div>
                  </div>
                </ParallaxCard>
              </motion.div>
            </div>
          </div>
        </section>

        <section className="w-full border-t border-slate-300 py-12 bg-slate-100/80">
          <div className="w-full px-4 sm:px-8 lg:px-14 xl:px-20">
            <div className="flex items-center gap-2 mb-5">
              <Clock size={16} className="text-cyan-700" />
              <div>
                <h2 className="text-sm font-bold text-slate-950 uppercase tracking-wider">
                  Observed Runtime by Workflow Profile
                </h2>
                <p className="mt-1 text-xs text-slate-600">
                  Median wall-clock time from completed jobs on this server; runtime varies with read depth, genome complexity, and queue load.
                </p>
              </div>
            </div>

            {runDurations.loading ? (
              <p className="text-sm text-slate-600">Loading run statistics…</p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                      <th scope="col" className="px-4 py-2 font-semibold">Workflow profile</th>
                      <th scope="col" className="px-4 py-2 font-semibold">Median runtime</th>
                      <th scope="col" className="px-4 py-2 font-semibold">Completed runs</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {durationRows.map((rt) => {
                      const hasData = rt.count > 0 && typeof rt.avg_seconds === "number";
                      return (
                        <tr key={rt.profile} className={rt.profile === selectedProfile ? "bg-cyan-50/60" : ""}>
                          <td className="px-4 py-2.5 font-medium text-slate-800">{rt.label || rt.profile}</td>
                          <td className="px-4 py-2.5 font-mono text-slate-900">
                            {hasData ? fmtAvgDuration(rt.avg_seconds) : (
                              <span className="font-sans text-slate-400">Insufficient completed runs</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-slate-600">{rt.count}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <section className="w-full border-t border-slate-300 py-16 bg-white">
          <div className="w-full px-4 sm:px-8 lg:px-14 xl:px-20">
            <div className="grid md:grid-cols-3 gap-10">
              <InfoColumn
                title="Analysis scope"
                text="Microbial isolate WGS and metagenomic workflows for short-read, long-read, and hybrid sequencing designs."
              />
              <InfoColumn
                title="Reproducible execution"
                text="Each submission records the workflow profile, parameters, input metadata, execution state, logs, and generated artifacts."
              />
              <InfoColumn
                title="Biological interpretation"
                text="Results are organized around read quality, assemblies, genomes or MAGs, taxonomy, functional annotation, and other workflow-specific endpoints."
              />
            </div>

            <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
              {CAPABILITY_ITEMS.map((item) => (
                <CapabilityExplorerRow key={item.title} item={item} />
              ))}
            </div>

            <div className="mt-14 flex flex-col sm:flex-row items-center justify-between gap-6 rounded-2xl border border-slate-300 bg-slate-100 p-6 shadow-sm">
              <div>
                <h3 className="text-lg font-semibold text-slate-950">Submit a microbial sequencing dataset</h3>
                <p className="text-sm text-slate-700">Select an analysis profile based on the sequencing design, upload FASTQ inputs, and monitor the job through completion.</p>
              </div>
              <MagneticButton onClick={handleStartNow}>
                {selectedWorkflowSummary.ctaLabel} <ChevronRight size={16} />
              </MagneticButton>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

/* ================================
   Subcomponents
================================= */

const Badge = ({ children }) => (
  <div className="flex items-center gap-2 rounded-full bg-white/90 border border-slate-300 px-3 py-1 shadow-sm backdrop-blur">
    <span className="h-2 w-2 rounded-full bg-emerald-600 animate-pulse" />
    <span className="text-[11px] font-bold tracking-wider text-slate-800 uppercase">{children}</span>
  </div>
);

const Pill = ({ icon: Icon, text }) => (
  <span className="inline-flex items-center gap-1 rounded-full bg-cyan-100 px-3 py-1 text-[11px] font-semibold text-cyan-800 border border-cyan-300 backdrop-blur">
    <Icon size={12} />
    {text}
  </span>
);

const CapabilityRow = ({ label, value, last = false }) => (
  <div className={`px-4 py-2.5 ${last ? "" : ""}`}>
    <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-3">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 sm:w-40 sm:shrink-0">
        {label}
      </span>
      <span className="text-[13px] text-slate-800">{value}</span>
    </div>
  </div>
);

// Reacts only to the existing analysisType/readMode selection already owned by the
// pipeline-preview header — this is a read-only summary, not a duplicate control.
const SelectedWorkflowSummary = ({ summary }) => (
  <div className="rounded-xl border border-slate-300 bg-white/90 p-4 shadow-sm">
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
        <ListTree size={13} className="text-cyan-700" />
        Selected workflow
      </div>
      {summary.medianRuntime && (
        <span className="text-[11px] text-slate-500">
          Median runtime <span className="font-mono text-slate-700">{summary.medianRuntime}</span>{" "}
          ({summary.completedRuns} completed run{summary.completedRuns === 1 ? "" : "s"})
        </span>
      )}
    </div>
    <div className="mt-1.5 text-sm font-semibold text-slate-950">{summary.profileLabel}</div>
    <dl className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[12px]">
      <div>
        <dt className="text-slate-500">Input</dt>
        <dd className="text-slate-800">{summary.input}</dd>
      </div>
      <div>
        <dt className="text-slate-500">Stages</dt>
        <dd className="text-slate-800">
          {summary.stageCount} steps, {summary.firstStage} → {summary.lastStage}
        </dd>
      </div>
      <div>
        <dt className="text-slate-500">Outputs</dt>
        <dd className="text-slate-800">{summary.outputs}</dd>
      </div>
    </dl>
  </div>
);

const JOB_SUMMARY_TILES = [
  { key: "running", label: "Running" },
  { key: "queued", label: "Queued" },
  { key: "completed", label: "Completed" },
  { key: "failed", label: "Needs attention" },
];

const JobWorkspaceSummary = ({ user, loading, workspace, totalServerRuns, onOpenJob, onViewAll }) => {
  if (!user) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white/70 p-4 text-sm text-slate-600">
        Sign in to see running, queued, and completed analyses for your account.
      </div>
    );
  }

  const recent = workspace.rows.slice(0, 4);

  return (
    <div className="rounded-xl border border-slate-300 bg-white/90 shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
          <Clock size={13} className="text-cyan-700" />
          Job workspace
        </div>
        <div className="flex items-center gap-3">
          {typeof totalServerRuns === "number" && (
            <span className="text-[11px] text-slate-500">
              {totalServerRuns} submitted server-wide
            </span>
          )}
          <button
            onClick={onViewAll}
            className="text-xs font-medium text-cyan-700 hover:text-cyan-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-600 rounded"
          >
            View all jobs
          </button>
        </div>
      </div>

      {loading ? (
        <div className="px-4 py-3 text-sm text-slate-500">Loading job status…</div>
      ) : workspace.total === 0 ? (
        <div className="px-4 py-3 text-sm text-slate-600">No analyses are currently running.</div>
      ) : (
        <>
          <div className="grid grid-cols-4 divide-x divide-slate-200 border-b border-slate-200">
            {JOB_SUMMARY_TILES.map((tile) => (
              <div key={tile.key} className="px-3 py-2 text-center">
                <div className="text-lg font-semibold text-slate-950">{workspace.counts[tile.key] || 0}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">{tile.label}</div>
              </div>
            ))}
          </div>
          <ul className="divide-y divide-slate-100">
            {recent.map((r) => {
              const meta = JOB_STATE_META[r.state] || JOB_STATE_META.unknown;
              const StatusIcon = meta.icon;
              const currentStep =
                r.status?.rail?.current?.name || r.status?.rail?.current?.key || r.status?.rail?.current?.id || "";
              return (
                <li key={r.jobId}>
                  <button
                    onClick={() => onOpenJob(r.jobId)}
                    className="group flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cyan-600"
                    title={currentStep ? `Current stage: ${currentStep}` : undefined}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-slate-800">
                        {displaySampleName(r.sampleId)}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-slate-400">{r.jobId}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-[11px] text-slate-500">
                      {r.state === "running" && currentStep && (
                        <span className="hidden sm:inline text-slate-500">{currentStep}</span>
                      )}
                      <span className="whitespace-nowrap">{fmtElapsed(r.ts)} ago</span>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ring-1 ${meta.tone}`}>
                        <StatusIcon size={11} className={r.state === "running" ? "animate-spin" : ""} aria-hidden />
                        {meta.label}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
};

const CapabilityExplorerRow = ({ item }) => {
  const [open, setOpen] = useState(false);
  const Icon = item.icon;
  return (
    <div className="border-b border-slate-100 py-2">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-600 rounded"
      >
        <Icon size={14} className="shrink-0 text-cyan-700" />
        <span className="text-[13px] font-medium text-slate-800">{item.title}</span>
        <ChevronRight size={14} className={`ml-auto shrink-0 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="mt-1.5 pl-[26px] pr-2 text-[12px] text-slate-600 leading-relaxed">
          <p>{item.desc}</p>
          <p className="mt-1 text-[11px] text-slate-500">Used by: {item.profiles}</p>
        </div>
      )}
    </div>
  );
};

const InfoColumn = ({ title, text }) => (
  <div className="space-y-3 group">
    <h2 className="text-sm font-bold text-slate-950 uppercase tracking-wider flex items-center gap-2">
      <div className="w-1 h-4 bg-cyan-700 rounded-full group-hover:h-6 transition-all" />
      {title}
    </h2>
    <p className="text-sm text-slate-700 leading-relaxed">{text}</p>
  </div>
);

const Dot = ({ color = "bg-slate-400", label = "" }) => (
  <span className="inline-flex items-center gap-2 text-slate-600">
    <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
    {label}
  </span>
);

/* ================================
   Interactive Pipeline Schematic
================================= */
/* ================================
   Interactive Pipeline Schematic
================================= */
const PipelineSchematic = ({ steps, dark = false }) => {
  const safeSteps = Array.isArray(steps) ? steps : [];
  const totalSteps = safeSteps.length || 1;

  const [activeIndex, setActiveIndex] = useState(0);      // current focused step
  const [hovering, setHovering] = useState(false);        // pauses auto-cycle
  const [hoveredIdx, setHoveredIdx] = useState(null);     // which row mouse is resting on
  const [showHint, setShowHint] = useState(false);        // “left click opens docs” bubble
  const hintTimerRef = useRef(null);

  // Auto-cycle through steps when not interacting
  useEffect(() => {
    if (!safeSteps.length) return;
    if (hovering) return;

    const id = setInterval(() => {
      setActiveIndex((prev) => {
        if (!safeSteps.length) return 0;
        const next = prev + 1;
        return next >= safeSteps.length ? 0 : next;
      });
    }, 2200);

    return () => clearInterval(id);
  }, [hovering, safeSteps.length]);

  // Show hint only if user *rests* on a tool for a bit
  useEffect(() => {
    if (hoveredIdx == null) {
      setShowHint(false);
      if (hintTimerRef.current) {
        clearTimeout(hintTimerRef.current);
        hintTimerRef.current = null;
      }
      return;
    }

    if (hintTimerRef.current) {
      clearTimeout(hintTimerRef.current);
    }

    hintTimerRef.current = setTimeout(() => {
      setShowHint(true);
    }, 800); // ms before bubble appears

    return () => {
      if (hintTimerRef.current) {
        clearTimeout(hintTimerRef.current);
        hintTimerRef.current = null;
      }
    };
  }, [hoveredIdx]);

  const activeStep = safeSteps.length
    ? safeSteps[activeIndex % safeSteps.length]
    : null;

  // Position of highlight marker over schematic (0 → left, 1 → right)
  const posFrac = totalSteps > 1 ? activeIndex / (totalSteps - 1) : 0;
  const markerLeft = `calc(8% + ${posFrac * 84}%)`; // 8% padding on each side

  const handleWheel = (e) => {
    if (!safeSteps.length) return;
    e.preventDefault();

    setHovering(true);
    setShowHint(false);
    setHoveredIdx(null);

    const stepDelta = e.deltaY > 0 ? 1 : -1;
    setActiveIndex((prev) => {
      const len = safeSteps.length;
      if (!len) return 0;
      let next = prev + stepDelta;
      if (next < 0) next = 0;
      if (next >= len) next = len - 1;
      return next;
    });
  };

  const handleContainerEnter = () => {
    setHovering(true);
  };

  const handleContainerLeave = () => {
    setHovering(false);
    setHoveredIdx(null);
    setShowHint(false);
  };

  const handleRowEnter = (idx) => {
    setHovering(true);
    setHoveredIdx(idx);
    setActiveIndex(idx);
    setShowHint(false); // reset; timer will decide if it reappears
  };

  const handleRowLeave = (idx) => {
    setHoveredIdx((prev) => (prev === idx ? null : prev));
  };

  const handleRowClick = (step, idx) => {
    setActiveIndex(idx);
    setHoveredIdx(idx);
    setShowHint(false);

    const url = TOOL_LINKS[step.key];
    if (url && typeof window !== "undefined") {
      const ok = window.confirm(
        `Open “${step.title}” documentation in a new tab?`
      );
      if (ok) {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    }
  };

  return (
    <div
      className={
        "relative p-6 min-h-[340px] flex flex-col gap-4 cursor-default " +
        (dark ? "bg-slate-950/70" : "bg-white")
      }
    >
      {/* Active step pill */}
      {activeStep && (
        <div className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 z-20">
          <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] shadow-md ${
            dark ? "bg-slate-900/95 text-slate-100 shadow-slate-950/60" : "bg-slate-900/95 text-slate-100 shadow-slate-900/40"
          }`}>
            <span className={`inline-flex h-1.5 w-1.5 rounded-full ${dark ? "bg-cyan-300" : "bg-emerald-400"}`} />
            <span className="font-mono uppercase tracking-wide">
              Step {activeIndex + 1}/{safeSteps.length || 1}: {activeStep.title}
            </span>
          </div>
        </div>
      )}

      {/* Schematic with flowing "reads" and smooth marker */}
      <div className="relative w-full mt-6">
        <img
          src={pipelineSvg}
          alt="Pipeline schematic"
          className="w-full h-auto select-none"
        />

        {/* Glowing vertical marker tied to active step (springy smooth) */}
        <motion.div
          className="pointer-events-none absolute inset-y-[12%] w-[3px] rounded-full bg-gradient-to-b from-sky-400 via-emerald-400 to-sky-500 shadow-[0_0_20px_rgba(56,189,248,0.8)]"
          initial={false}
          animate={{ left: markerLeft }}
          transition={{ type: "spring", stiffness: 90, damping: 18 }}
        />

        {/* Multi-lane data tracks along bottom */}
        <div className={`pointer-events-none absolute inset-x-[8%] bottom-6 h-[2px] rounded-full overflow-hidden ${dark ? "bg-slate-700/80" : "bg-slate-200/80"}`}>
          <motion.div
            className="absolute left-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-sky-400 shadow-[0_0_18px_rgba(56,189,248,0.8)]"
            initial={{ x: "-10%" }}
            animate={{ x: ["-10%", "110%"] }}
            transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute left-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_16px_rgba(52,211,153,0.8)]"
            initial={{ x: "-30%" }}
            animate={{ x: ["-30%", "110%"] }}
            transition={{ duration: 6.2, repeat: Infinity, ease: "easeInOut", delay: 0.7 }}
          />
          <motion.div
            className="absolute left-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-indigo-400 shadow-[0_0_16px_rgba(129,140,248,0.8)]"
            initial={{ x: "-55%" }}
            animate={{ x: ["-55%", "110%"] }}
            transition={{ duration: 7.4, repeat: Infinity, ease: "easeInOut", delay: 1.3 }}
          />
        </div>
      </div>

      {/* Vertical carousel – hover row, scroll, click */}
      <div
        className={
          "mt-4 relative h-[220px] overflow-hidden rounded-xl border " +
          (dark ? "bg-slate-900/70 border-slate-700" : "bg-slate-50/80 border-slate-200")
        }
        onMouseEnter={handleContainerEnter}
        onMouseLeave={handleContainerLeave}
        onWheel={handleWheel}
      >
        {/* Hint bubble – only when resting on a tool */}
        {showHint && (
          <div className="pointer-events-none absolute right-2 top-2 z-10 text-[10px] text-slate-400 flex flex-col items-end gap-1">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 shadow-sm ${dark ? "border border-slate-700 bg-slate-900/95" : "border border-slate-200 bg-white/95"}`}>
              <span className={`text-[9px] font-semibold ${dark ? "text-slate-200" : "text-slate-700"}`}>Left click</span>
              <span className={`text-[9px] ${dark ? "text-slate-400" : "text-slate-500"}`}>to open tool docs ↗</span>
            </span>
          </div>
        )}

        {/* fade top & bottom */}
        <div className={`pointer-events-none absolute inset-x-0 top-0 h-10 ${dark ? "bg-gradient-to-b from-slate-900 via-slate-900/70 to-transparent" : "bg-gradient-to-b from-white via-white/80 to-transparent"}`} />
        <div className={`pointer-events-none absolute inset-x-0 bottom-0 h-10 ${dark ? "bg-gradient-to-t from-slate-900 via-slate-900/70 to-transparent" : "bg-gradient-to-t from-white via-white/80 to-transparent"}`} />

        <motion.div
          className="flex flex-col space-y-2 py-3"
          animate={{ y: -(activeIndex - 2) * CAROUSEL_ITEM_HEIGHT }}
          transition={{ type: "spring", stiffness: 90, damping: 18 }}
        >
          {safeSteps.map((step, idx) => {
            const dist = Math.abs(idx - activeIndex);
            const clamped = Math.min(dist, 3);
            const opacity = [1, 0.78, 0.52, 0.28][clamped];
            const scale = [1, 0.97, 0.94, 0.9][clamped];
            const blur = [0, 0.3, 0.8, 1.5][clamped];

            return (
              <motion.div
                key={step.key || step.title || idx}
                style={{
                  opacity,
                  scale,
                  filter: blur > 0 ? `blur(${blur}px)` : "none",
                }}
                className="px-3"
                onMouseEnter={() => handleRowEnter(idx)}
                onMouseLeave={() => handleRowLeave(idx)}
                onClick={() => handleRowClick(step, idx)}
              >
                <div
                  className={
                    "h-10 flex items-center justify-between rounded-lg border px-3 text-[11px] font-medium cursor-pointer transition-colors " +
                    (idx === activeIndex
                      ? (dark
                          ? "border-cyan-300/70 bg-slate-900 shadow-[0_10px_24px_-12px_rgba(34,211,238,0.55)]"
                          : "border-sky-500 bg-white shadow-[0_10px_20px_-10px_rgba(56,189,248,0.6)]")
                      : (dark
                          ? "border-slate-700 bg-slate-900/70 hover:bg-slate-800/80"
                          : "border-slate-200 bg-slate-50 hover:bg-white/80"))
                  }
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-semibold ${dark ? "text-slate-400" : "text-slate-500"}`}>
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    <span className={`text-[11px] truncate max-w-[140px] ${dark ? "text-slate-100" : "text-slate-900"}`}>
                      {step.title}
                    </span>
                  </div>
                  <span className={`text-[10px] truncate max-w-[150px] text-right ${dark ? "text-slate-400" : "text-slate-500"}`}>
                    {step.desc}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </div>
  );
};




export default LandingPage;
