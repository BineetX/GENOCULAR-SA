// /src/pages/LandingPage.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../lib/firebase.js";
import { apiJson } from "../lib/api.js";
import { useTheme } from "../lib/ThemeContext.jsx";
import {
  Activity,
  Database,
  Server,
  Cpu,
  Clock,
  FileJson,
  Box,
  Play,
  CheckCircle2,
  ChevronRight,
  ShieldCheck,
  Microscope,
  Workflow,
  FlaskConical,
  HardDriveDownload,
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
  fastqc_clean: "https://www.bioinformatics.babraham.ac.uk/projects/fastqc/",
  trimmomatic: "http://www.usadellab.org/cms/?page=trimmomatic",
  cutadapt: "https://cutadapt.readthedocs.io/",
  cutadapt_paired: "https://cutadapt.readthedocs.io/",
  seqtk: "https://github.com/lh3/seqtk",
  seqtk_trim: "https://github.com/lh3/seqtk",
  bbduk: "https://jgi.doe.gov/data-and-tools/bbtools/",
  fastp: "https://github.com/OpenGene/fastp",
  kneaddata: "https://huttenhower.sph.harvard.edu/kneaddata/",
  metaphlan: "https://huttenhower.sph.harvard.edu/metaphlan/",
  nonpareil: "https://github.com/lmrodriguezr/nonpareil",
  kraken: "https://ccb.jhu.edu/software/kraken2/",
  kraken2: "https://ccb.jhu.edu/software/kraken2/",
  kraken_classify: "https://ccb.jhu.edu/software/kraken2/",
  kraken_extract: "https://github.com/jenniferlu717/KrakenTools",
  kraken_extract_reads: "https://github.com/jenniferlu717/KrakenTools",
  kraken_classify_short: "https://ccb.jhu.edu/software/kraken2/",
  kraken_extract_short: "https://github.com/jenniferlu717/KrakenTools",
  kraken_classify_long: "https://ccb.jhu.edu/software/kraken2/",
  kraken_extract_long: "https://github.com/jenniferlu717/KrakenTools",
  bracken: "https://ccb.jhu.edu/software/bracken/",
  nanoplot: "https://github.com/wdecoster/NanoPlot",
  nanostat_raw: "https://github.com/wdecoster/nanostat",
  nanoq_adaptive: "https://github.com/esteinig/nanoq",
  pipeline_decision: "",
  adaptive_filter: "",
  spades: "https://cab.spbu.ru/software/spades/",
  flye: "https://github.com/mikolmogorov/Flye",
  flye_assembly: "https://github.com/mikolmogorov/Flye",
  racon_round1: "https://github.com/isovic/racon",
  racon_round2: "https://github.com/isovic/racon",
  medaka_polish: "https://github.com/nanoporetech/medaka",
  finalize_assembly: "",
  unicycler: "https://github.com/rrwick/Unicycler",
  prodigal: "https://github.com/hyattpd/Prodigal",
  prodigal_assembly: "https://github.com/hyattpd/Prodigal",
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
  checkm2: "https://github.com/chklovski/CheckM2",
  gunc: "https://github.com/grp-bork/gunc",
  gtdbtk: "https://github.com/Ecogenomics/GTDBTk",
  drep: "https://github.com/MrOlm/drep",
  coverm: "https://github.com/wwood/CoverM",
  metabat2: "https://bitbucket.org/berkeleylab/metabat/",
  maxbin2: "https://sourceforge.net/projects/maxbin2/",
  semibin2: "https://github.com/BigDataBiology/SemiBin",
  dastool: "https://github.com/cmks/DAS_Tool",
  virsorter2: "https://github.com/jiarong/VirSorter2",
  megahit: "https://github.com/voutcn/megahit",
  megahit_assembly: "https://github.com/voutcn/megahit",
  operams_assembly: "https://github.com/CSB5/OPERA-MS",
  bowtie2_index: "https://bowtie-bio.sourceforge.net/bowtie2/",
  bowtie2_map: "https://bowtie-bio.sourceforge.net/bowtie2/",
  minimap2_map: "https://github.com/lh3/minimap2",
  minimap2_map_filtered: "https://github.com/lh3/minimap2",
  minimap2_gene_map: "https://github.com/lh3/minimap2",
  cdhit_genes: "https://github.com/weizhongli/cdhit",
  cdhit_proteins: "https://github.com/weizhongli/cdhit",
  salmon_index: "https://github.com/COMBINE-lab/salmon",
  salmon_quant: "https://github.com/COMBINE-lab/salmon",
  featurecounts_gene_quant: "https://subread.sourceforge.net/",
  multiqc: "https://multiqc.info/",
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
  fastqc_clean: { title: "FastQC (Clean)", desc: "Quality check after metagenomic read cleaning." },
  nonpareil: { title: "Nonpareil", desc: "Coverage and sequencing saturation estimate." },
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
  kraken2: { title: "Kraken2", desc: "K-mer based metagenomic taxonomic classification." },
  bracken: { title: "Bracken", desc: "Species-level abundance estimation from Kraken2 assignments." },
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
  virsorter2: { title: "VirSorter2", desc: "Viral contig prediction from metagenome assemblies." },
  gunc: { title: "GUNC", desc: "Genome contamination and chimerism screening for MAGs." },
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
  "fastqc_raw", "fastqc_clean", "nonpareil", "fastp", "kneaddata",
  "metaphlan", "kraken2", "bracken", "megahit", "quast",
  "bowtie2_index", "bowtie2_map", "depth", "metabat2", "maxbin2",
  "semibin2", "contig2bin_tables", "dastool", "select_dastool_bins",
  "checkm2", "busco", "quast_per_mag", "quast_per_mag_all",
  "merge_mag_qc", "mag_filter", "gunc", "gtdbtk", "drep", "coverm",
  "barrnap_per_mag", "barrnap_all", "prokka", "prokka_all",
  "cctyper_per_mag", "cctyper_all", "dbcan_per_mag", "dbcan_all",
  "abricate", "abricate_summary", "abricate_all", "virsorter2",
  "hadeg_proteinortho", "busco_filtered_per_mag", "busco_filtered_all",
  "prodigal_assembly", "cdhit_genes", "salmon_index", "salmon_quant",
  "multiqc", "analysis_plots",
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
  "cdhit_proteins", "virsorter2", "cctyper_per_mag", "cctyper_all", "dbcan_per_mag",
  "dbcan_all", "abricate", "abricate_summary", "abricate_all",
  "hadeg_proteinortho", "coverm", "minimap2_gene_map",
  "featurecounts_gene_quant", "multiqc_collect", "multiqc", "analysis_plots",
];

const META_HYBRID_ORDER = [
  "fastp", "kneaddata", "kraken2", "bracken", "nanostat_raw", "nanoq_adaptive", "host_removal_lr",
  "megahit_assembly", "operams_assembly", "quast", "bowtie2_index",
  "bowtie2_map", "minimap2_map", "merge_bams", "depth", "metabat2",
  "semibin2", "metabat2_to_contig2bin", "semibin2_to_contig2bin",
  "dastool", "select_dastool_bins", "checkm2", "busco", "quast_per_mag",
  "quast_per_mag_all", "merge_mag_qc", "mag_filter", "gtdbtk", "drep",
  "coverm", "barrnap_per_mag", "barrnap_all", "prokka", "prokka_all",
  "cctyper_per_mag", "cctyper_all", "dbcan_per_mag", "dbcan_all",
  "abricate", "abricate_summary", "abricate_all", "virsorter2", "hadeg_proteinortho",
  "busco_filtered_per_mag", "busco_filtered_all", "prodigal_assembly",
  "cdhit_proteins", "bowtie2_gene_map", "featurecounts_gene_quant",
  "multiqc_collect", "multiqc", "analysis_plots",
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

function fmtAvgDuration(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "—";
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
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
      className="genocular-magnetic-button group relative inline-flex items-center gap-3 px-8 py-3.5 bg-slate-900 text-white rounded-full font-semibold text-sm shadow-xl hover:bg-slate-800 transition-all overflow-hidden"
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
  const { isDark } = useTheme();
  const [user, setUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [stats, setStats] = useState({ totalRuns: null, loading: true });
  const [runDurations, setRunDurations] = useState({ runTypes: [], loading: true });

  // Auth check
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setCheckingAuth(false);
    });
    return () => unsub();
  }, []);

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

  // Metrics (includes total runs)
  const METRICS = useMemo(
    () => [
      { label: "Submitted Jobs", value: stats.totalRuns ?? "—", suffix: "", type: "fixed" },
      { label: "Mean Runtime", value: fmtAvgDuration(activeDuration?.avg_seconds), suffix: "", type: "fixed" },
      { label: "Workflow Steps", value: pipelineSteps.length, suffix: "", type: "fixed" },
      { label: "History Window", value: 7, suffix: " days", type: "fixed" },
    ],
    [stats.totalRuns, activeDuration?.avg_seconds, pipelineSteps.length]
  );

  return (
    <div
      className="genocular-landing min-h-[calc(100vh-56px-40px)] text-slate-900 flex flex-col selection:bg-cyan-100 selection:text-slate-950"
      style={{ fontFamily: '"IBM Plex Sans", "Source Sans 3", "Segoe UI", sans-serif' }}
    >
      <main className="genocular-landing-main flex-1 flex flex-col bg-gradient-to-b from-slate-100 via-white to-slate-100">
        <section className="genocular-landing-hero relative overflow-hidden border-b border-slate-300 lg:min-h-[86vh] flex items-center">
          <div className="pointer-events-none absolute inset-0">
            <div className="genocular-landing-grid absolute inset-0 bg-[linear-gradient(to_right,rgba(71,85,105,0.18)_1px,transparent_1px),linear-gradient(to_bottom,rgba(71,85,105,0.14)_1px,transparent_1px)] bg-[size:44px_44px]" />
            <div className="genocular-landing-glow absolute inset-0 bg-[radial-gradient(circle_at_75%_10%,rgba(14,165,233,0.24),transparent_35%),radial-gradient(circle_at_20%_80%,rgba(13,148,136,0.18),transparent_40%),linear-gradient(180deg,rgba(248,250,252,0.68),rgba(255,255,255,0.96))]" />
            {gridBeams.map((beam, idx) => (
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
              <div className="space-y-8 z-10">
                <motion.div
                  variants={fadeUp}
                  custom={0}
                  initial="hidden"
                  animate="visible"
                  className="flex flex-wrap items-center gap-3"
                >
                  <Badge>BRIC-ILS Microbial Genomics Server</Badge>
                  <Pill icon={ShieldCheck} text="Under Development Vesrion" />
                </motion.div>

                <motion.div variants={fadeUp} custom={1} initial="hidden" animate="visible" className="space-y-4">
                  <h1 className="text-4xl sm:text-5xl xl:text-6xl font-semibold tracking-tight text-slate-950 leading-[1.08]">
                    GENOCULAR
                    <span className="mt-3 block text-xl sm:text-2xl xl:text-3xl font-medium tracking-normal text-slate-700">
                      Microbial genome and metagenome analysis server
                    </span>
                  </h1>
                  <p className="text-base sm:text-lg text-slate-700 max-w-2xl leading-relaxed">
                    GENOCULAR provides server-side workflows for microbial isolate WGS
                    and metagenomics datasets. It supports short-read, long-read, and
                    hybrid sequencing inputs, with organized outputs for QC, assembly,
                    annotation, MAG analysis, functional screening, reports, and plots.
                  </p>
                </motion.div>

                <motion.div
                  variants={fadeUp}
                  custom={2}
                  initial="hidden"
                  animate="visible"
                  className="grid sm:grid-cols-2 gap-3 max-w-3xl"
                >
                  <FeatureChip icon={Workflow} label="Run Profiles" value="WGS · Metagenomics · Hybrid" />
                  <FeatureChip icon={Box} label="Input Types" value="Illumina · ONT/Nanopore" />
                  <FeatureChip icon={Database} label="Outputs" value="QC · Assemblies · MAGs · Reports" />
                  <FeatureChip icon={Cpu} label="Execution" value="Server-side Snakemake workflows" />
                </motion.div>

                <motion.div variants={fadeUp} custom={3} initial="hidden" animate="visible" className="space-y-5 pt-1">
                  <div className="flex flex-wrap items-center gap-4">
                    <MagneticButton onClick={handleStartNow} disabled={checkingAuth}>
                      <Play size={16} className="opacity-80" />
                      {checkingAuth ? "Checking access..." : "Submit a Job"}
                      <ChevronRight size={16} className="text-cyan-200" />
                    </MagneticButton>
                    <div className="rounded-xl border border-slate-300 bg-white/80 px-3 py-2 text-xs text-slate-600 shadow-sm flex flex-col">
                      <span className="font-medium text-slate-800">
                        {user ? `Signed in: ${user.email}` : "Sign in required for submission"}
                      </span>
                    </div>
                  </div>
                </motion.div>

                <motion.div variants={fadeUp} custom={4} initial="hidden" animate="visible" className="pt-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-3xl">
                    {METRICS.map((m, i) => (
                      <MetricCard
                        key={m.label}
                        label={m.label}
                        value={m.value}
                        suffix={m.suffix}
                        type={m.type}
                        i={i}
                      />
                    ))}
                  </div>
                </motion.div>
              </div>

              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
                className="relative w-full max-w-xl justify-self-center lg:justify-self-end"
              >
                <ParallaxCard className="genocular-pipeline-card bg-white/95 border-slate-200">
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

                  <PipelineSchematic steps={pipelineSteps} dark={isDark} />

                  <div className="bg-slate-50 border-t border-slate-200 p-3 text-[11px] text-slate-500 flex justify-between items-center">
                    <div className="flex gap-3">
                      <Dot color="bg-emerald-500" label="Integrated environments" />
                      <Dot color="bg-cyan-500" label="Validated Tools" />
                      <Dot color="bg-teal-500" label="Organized results" />
                    </div>
                    <div className="text-slate-500 flex items-center gap-1">
                      <CheckCircle2 size={12} />
                      Developed at BRIC-ILS
                    </div>
                  </div>
                </ParallaxCard>
              </motion.div>
            </div>
          </div>
        </section>

        <section className="genocular-landing-runtime w-full border-t border-slate-300 py-16 bg-slate-100/80">
          <div className="w-full px-4 sm:px-8 lg:px-14 xl:px-20">
            <div className="flex items-center gap-2 mb-8">
              <Clock size={16} className="text-cyan-700" />
              <div>
                <h2 className="text-sm font-bold text-slate-950 uppercase tracking-wider">
                  Runtime Observed on This Server
                </h2>
                <p className="mt-1 text-xs text-slate-600">
                  Average wall-clock time from completed jobs. Runtime depends on read depth, profile choice, sample complexity, and queue load.
                </p>
              </div>
            </div>

            {runDurations.loading ? (
              <p className="text-sm text-slate-600">Loading run statistics…</p>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {durationRows.map((rt) => (
                  <div
                    key={rt.profile}
                    className="p-4 rounded-xl border border-slate-300 bg-white shadow-sm"
                  >
                    <div className="text-xs font-bold uppercase tracking-wide text-slate-700 mb-2">
                      {rt.label || rt.profile}
                    </div>
                    <div className="text-2xl font-bold text-slate-950">
                      {fmtAvgDuration(rt.avg_seconds)}
                    </div>
                    <div className="text-[12px] text-slate-600 mt-1">
                      {rt.count > 0
                        ? `avg. over ${rt.count} completed run${rt.count === 1 ? "" : "s"}`
                        : "not enough completed runs yet"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="genocular-landing-info w-full border-t border-slate-300 py-16 bg-white">
          <div className="w-full px-4 sm:px-8 lg:px-14 xl:px-20">
            <div className="grid md:grid-cols-3 gap-10">
              <InfoColumn
                title="Analysis Scope"
                text="GENOCULAR is built for microbial isolate genomes and microbial community datasets, with separate profiles for short-read, long-read, and hybrid sequencing."
              />
              <InfoColumn
                title="Workflow Tracking"
                text="Each run is submitted as a defined profile with recorded inputs, job metadata, live progress, logs, and completed result artifacts."
              />
              <InfoColumn
                title="Result Review"
                text="Outputs are organized around practical endpoints: read QC, assemblies, annotations, MAG quality, taxonomy, functional screening, tables, reports, and plots."
              />
            </div>

            <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              <FeatureCard icon={Workflow} title="Six Runnable Profiles" desc="WGS and metagenomics workflows are available for short-read, long-read, and hybrid sequencing data." />
              <FeatureCard icon={Database} title="Quality Assessment" desc="Read QC, trimming summaries, assembly statistics, completeness checks, and contamination estimates are reported where relevant." />
              <FeatureCard icon={Cpu} title="Assembly and MAGs" desc="The server supports isolate genome assembly, metagenome assembly, coverage estimation, binning, and MAG quality assessment." />
              <FeatureCard icon={FlaskConical} title="Biological Annotation" desc="Gene prediction, functional annotation, CRISPR-Cas typing, AMR/marker screening, CAZyme analysis, and secondary metabolite screening are included by profile." />
              <FeatureCard icon={HardDriveDownload} title="Structured Outputs" desc="Completed jobs expose organized reports, tables, logs, plots, FASTA files, annotations, and downloadable result folders." />
              <FeatureCard icon={Server} title="Server Deployment" desc="Uploads, job execution, status tracking, result browsing, and administrative monitoring are handled through the GENOCULAR server." />
            </div>

            <div className="genocular-landing-cta mt-14 flex flex-col sm:flex-row items-center justify-between gap-6 rounded-2xl border border-slate-300 bg-slate-100 p-6 shadow-sm">
              <div>
                <h3 className="text-lg font-semibold text-slate-950">Run a GENOCULAR analysis</h3>
                <p className="text-sm text-slate-700">Choose the profile, upload FASTQ inputs, submit the job, and review results from the same server interface.</p>
              </div>
              <MagneticButton onClick={handleStartNow}>
                Open Run Page <ChevronRight size={16} />
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

const TechChip = ({ icon: Icon, label }) => (
  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 bg-white backdrop-blur-sm text-xs font-medium text-slate-700 shadow-sm">
    <Icon size={12} className="text-cyan-600" />
    {label}
  </div>
);

const FeatureChip = ({ icon: Icon, label, value }) => (
  <div className="rounded-xl border border-slate-300 bg-white/90 p-3 shadow-sm backdrop-blur">
    <div className="flex items-center gap-2 text-slate-600 text-[11px] uppercase tracking-wide">
      <Icon size={13} className="text-cyan-700" />
      {label}
    </div>
    <div className="mt-1 text-sm font-medium text-slate-950">{value}</div>
  </div>
);

const MetricCard = ({ label, value, suffix, type, i }) => {
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    if (type === "fixed") {
      setDisplay(value);
      return;
    }
    let raf;
    const start = performance.now();
    const duration = 900 + i * 120;
    const step = (t) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.floor(value * eased));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, i, type]);

  return (
    <motion.div
      variants={fadeUp}
      custom={0.2 * i}
      initial="hidden"
      animate="visible"
      whileHover={{ y: -2, backgroundColor: "#f8fafc" }}
      className="p-3 rounded-xl border border-slate-300 bg-white/95 transition-colors cursor-default shadow-sm"
    >
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-600 mb-1">{label}</div>
      <div className="text-2xl font-semibold text-slate-950">
        {display}
        <span className="text-slate-600 text-base font-medium ml-1">{suffix}</span>
      </div>
    </motion.div>
  );
};

const FeatureCard = ({ icon: Icon, title, desc }) => (
  <motion.div
    whileHover={{ y: -3, backgroundColor: "#f8fafc" }}
    className="p-4 rounded-xl border border-slate-300 bg-white transition-colors cursor-default shadow-sm"
  >
    <div className="flex items-center gap-2 mb-1 text-slate-800">
      <Icon size={16} className="text-cyan-700" />
      <span className="text-xs font-bold uppercase tracking-wide">{title}</span>
    </div>
    <p className="text-[13px] text-slate-700 leading-relaxed">{desc}</p>
  </motion.div>
);

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
