// /src/pages/LandingPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion as Motion } from "framer-motion";
import { apiJson } from "../lib/api.js";
import { useTheme } from "../lib/ThemeContext.jsx";
import GenocularLogo from "../components/GenocularLogo.jsx";
import {
  Database,
  Clock,
  Play,
  ChevronRight,
} from "lucide-react";

import metaHybridPipeline from "../assets/Meta_HR.png";
import metaLongPipeline from "../assets/Meta_LR.png";
import metaShortPipeline from "../assets/Meta_SR.png";
import wgsHybridPipeline from "../assets/WGS_HR.png";
import wgsLongPipeline from "../assets/WGS_LR.png";
import wgsShortPipeline from "../assets/WGS_SR.png";

const PROFILE_SCHEMATICS = {
  "wgs:short": {
    src: wgsShortPipeline,
    alt: "WGS short-read workflow schematic",
  },
  "wgs:long": {
    src: wgsLongPipeline,
    alt: "WGS long-read workflow schematic",
  },
  "wgs:hybrid": {
    src: wgsHybridPipeline,
    alt: "WGS hybrid-read workflow schematic",
  },
  "metagenomics:short": {
    src: metaShortPipeline,
    alt: "Metagenomics short-read workflow schematic",
  },
  "metagenomics:long": {
    src: metaLongPipeline,
    alt: "Metagenomics long-read workflow schematic",
  },
  "metagenomics:hybrid": {
    src: metaHybridPipeline,
    alt: "Metagenomics hybrid-read workflow schematic",
  },
};

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
  nanostat_filtered: "https://github.com/wdecoster/nanostat",
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
  manifest: { title: "Manifest", desc: "Result manifest for downstream access." },
  fastp: { title: "fastp", desc: "Short-read quality trimming and filtering." },
  kneaddata: { title: "KneadData", desc: "Host read removal and decontamination." },
  metaphlan: { title: "MetaPhlAn", desc: "Taxonomic profiling from cleaned reads." },
  kraken2: { title: "Kraken2", desc: "K-mer based metagenomic taxonomic classification." },
  bracken: { title: "Bracken", desc: "Species-level abundance estimation from Kraken2 assignments." },
  megahit: { title: "MEGAHIT", desc: "Short-read metagenome assembly." },
  megahit_assembly: { title: "MEGAHIT", desc: "Hybrid short-read assembly branch." },
  operams_assembly: { title: "OPERA-MS", desc: "Hybrid metagenome assembly." },
  nanostat_raw: { title: "NanoStat (Raw)", desc: "Long-read quality statistics before filtering." },
  nanoq_adaptive: { title: "nanoq", desc: "Adaptive long-read filtering." },
  nanostat_filtered: { title: "NanoStat (Filtered)", desc: "Long-read quality statistics after nanoq filtering." },
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
  "nanostat_raw", "nanoq_adaptive", "nanostat_filtered", "host_removal", "flye_assembly",
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
  "fastp", "kneaddata", "kraken2", "bracken", "nanostat_raw", "nanoq_adaptive", "nanostat_filtered", "host_removal_lr",
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

const PrimaryAction = ({ onClick, disabled, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="group inline-flex min-h-16 w-full items-center justify-center gap-3 rounded-xl border border-cyan-700/80 bg-gradient-to-r from-cyan-700 to-teal-600 px-7 text-white shadow-[0_16px_32px_-18px_rgba(8,145,178,0.75)] transition-[transform,box-shadow,filter] duration-200 hover:-translate-y-0.5 hover:brightness-105 hover:shadow-[0_20px_38px_-18px_rgba(8,145,178,0.8)] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600 focus-visible:ring-offset-2 sm:w-auto sm:min-w-[15rem] disabled:cursor-wait disabled:opacity-60 disabled:hover:translate-y-0"
  >
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/25 bg-white/15 text-white transition-colors group-hover:bg-white/20">
      <Play size={16} fill="currentColor" strokeWidth={1.8} className="translate-x-px" />
    </span>
    <span className="text-base font-semibold tracking-[-0.015em]">
      {children}
    </span>
    <ChevronRight size={18} className="ml-1 opacity-85 transition-transform group-hover:translate-x-0.5" />
  </button>
);

/* ================================
   Landing
================================= */
const LandingPage = () => {
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const [stats, setStats] = useState({
    totalRuns: null,
    completedRuns: null,
    activeRuns: null,
    queuedRuns: null,
    loading: true,
  });
  const [runDurations, setRunDurations] = useState({ runTypes: [], loading: true });

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
          setStats({
            totalRuns: total,
            completedRuns: typeof data?.completed_runs === "number" ? data.completed_runs : null,
            activeRuns: typeof data?.active_runs === "number" ? data.active_runs : null,
            queuedRuns: typeof data?.queued_runs === "number" ? data.queued_runs : null,
            loading: false,
          });
        }
      } catch {
        if (!cancelled) {
          setStats({ totalRuns: null, completedRuns: null, activeRuns: null, queuedRuns: null, loading: false });
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
      } catch {
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
    navigate("/run");
  };

  const [analysisType, setAnalysisType] = useState("wgs");
  const [readMode, setReadMode] = useState("short");
  const selectedProfile = `${analysisType}:${readMode}`;
  const selectedSchematic = PROFILE_SCHEMATICS[selectedProfile] || PROFILE_SCHEMATICS["wgs:short"];

  useEffect(() => {
    if (typeof Image === "undefined") return undefined;
    const timer = window.setTimeout(() => {
      Object.values(PROFILE_SCHEMATICS).forEach(({ src }) => {
        const image = new Image();
        image.src = src;
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, []);

  const durationRows = useMemo(() => {
    const byProfile = new Map((runDurations.runTypes || []).map((row) => [row.profile, row]));
    return PROFILE_KEYS.map((profile) => ({
      profile,
      label: PROFILE_LABELS[profile],
      avg_seconds: byProfile.get(profile)?.avg_seconds ?? null,
      count: byProfile.get(profile)?.count ?? 0,
    }));
  }, [runDurations.runTypes]);
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
  const runtimeGroups = [
    { key: "wgs", label: "Whole-genome sequencing" },
    { key: "metagenomics", label: "Metagenomics" },
  ];
  const maxRuntimeSeconds = Math.max(
    ...durationRows.map((row) => row.avg_seconds || 0),
    1
  );

  return (
    <div className="genocular-landing min-h-[calc(100vh-56px-40px)] text-slate-900 selection:bg-cyan-100 selection:text-slate-950">
      <main className="genocular-landing-main bg-slate-50">
        <section className="genocular-landing-hero relative overflow-hidden border-b border-slate-200 bg-slate-50">
          <div className="pointer-events-none absolute inset-0">
            <div className="genocular-landing-grid absolute inset-0 bg-[linear-gradient(to_right,rgba(100,116,139,0.07)_1px,transparent_1px),linear-gradient(to_bottom,rgba(100,116,139,0.07)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:linear-gradient(to_bottom,black,transparent_88%)]" />
            <div className="genocular-landing-glow absolute inset-0 bg-[radial-gradient(circle_at_75%_22%,rgba(6,182,212,0.14),transparent_28%),radial-gradient(circle_at_14%_84%,rgba(13,148,136,0.08),transparent_24%)]" />
            <div className="genocular-landing-orbit absolute -right-48 -top-56 h-[700px] w-[700px] rounded-full border border-cyan-200/60" />
            <div className="genocular-landing-orbit absolute -right-28 -top-44 h-[560px] w-[560px] rounded-full border border-sky-200/60" />
            <div className="genocular-landing-orbit absolute right-2 top-[-84px] h-[420px] w-[420px] rounded-full border border-teal-200/50" />
          </div>

          <div className="relative mx-auto w-full max-w-[1560px] px-4 py-14 sm:px-8 lg:px-14 lg:py-20 xl:px-20">
            <div className="genocular-landing-hero-grid grid items-center gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] xl:grid-cols-[minmax(0,0.8fr)_minmax(36rem,1.2fr)] xl:gap-20">
              <div className="z-10 min-w-0 max-w-2xl [container-type:inline-size]">
                <Motion.div
                  variants={fadeUp}
                  custom={0}
                  initial="hidden"
                  animate="visible"
                  className="inline-flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-800"
                >
                  <GenocularLogo className="h-12 w-12" priority />
                  BRIC-ILS microbial genomics server
                </Motion.div>

                <Motion.div variants={fadeUp} custom={1} initial="hidden" animate="visible" className="mt-7">
                  <h1>
                    <span className="genocular-landing-wordmark block max-w-full whitespace-nowrap bg-gradient-to-r from-slate-950 via-slate-800 to-cyan-800 bg-clip-text text-5xl text-[clamp(2.65rem,15cqw,5rem)] font-semibold leading-none tracking-[-0.045em] text-transparent">
                      GENOCULAR
                    </span>
                    <span className="mt-6 block max-w-xl text-2xl font-medium leading-[1.15] tracking-[-0.03em] text-slate-700 sm:text-3xl xl:text-[2.15rem]">
                      Microbial genomics, from reads to results.
                    </span>
                  </h1>
                  <p className="mt-5 max-w-xl text-[15px] leading-7 text-slate-600 sm:text-base">
                    Run WGS and metagenomics workflows for short-read,
                    long-read, and hybrid microbial sequencing data.
                  </p>
                </Motion.div>

                <Motion.div
                  variants={fadeUp}
                  custom={2}
                  initial="hidden"
                  animate="visible"
                  className="genocular-landing-facts mt-9 grid max-w-xl grid-cols-3 border-y border-slate-200 bg-white/35 py-4 backdrop-blur-sm"
                >
                  <ProductFact value="06" label="Workflow profiles" />
                  <ProductFact value="03" label="Read modes" bordered />
                  <ProductFact value="WGS + META" label="Analysis scope" />
                </Motion.div>

                <Motion.div variants={fadeUp} custom={3} initial="hidden" animate="visible" className="mt-9">
                  <PrimaryAction onClick={handleStartNow}>
                    Run analysis
                  </PrimaryAction>
                </Motion.div>
              </div>

              <Motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: "easeOut", delay: 0.12 }}
                className="relative min-w-0 w-full"
              >
                <div className="genocular-pipeline-card relative min-w-0">
                  <div className="genocular-pipeline-header border-b border-slate-200/80 pb-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-base font-semibold tracking-[-0.02em] text-slate-950"></div>
                      </div>
                      <div className="text-right">
                        <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 shadow-sm">
                          {/* <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> */}
                          {activeProfileLabel}
                        </div>
                        <div className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400">{pipelineSteps.length} stages</div>
                      </div>
                    </div>

                    <div className="genocular-pipeline-controls mt-4 grid gap-3 rounded-xl border border-slate-200/80 bg-white/55 p-2.5 sm:grid-cols-2">
                      <div>
                        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Analysis</div>
                        <div className="genocular-segmented-control inline-flex w-full rounded-lg bg-slate-100 p-1">
                          {ANALYSIS_OPTIONS.map((opt) => (
                            <button
                              type="button"
                              key={opt.key}
                              aria-pressed={analysisType === opt.key}
                              onClick={() => setAnalysisType(opt.key)}
                              className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${analysisType === opt.key
                                ? "bg-slate-900 text-white shadow-sm"
                                : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                                }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Read mode</div>
                        <div className="genocular-segmented-control inline-flex w-full rounded-lg bg-slate-100 p-1">
                          {MODE_OPTIONS.map((opt) => (
                            <button
                              type="button"
                              key={opt.key}
                              aria-pressed={readMode === opt.key}
                              onClick={() => setReadMode(opt.key)}
                              className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${readMode === opt.key
                                ? "bg-cyan-700 text-white shadow-sm"
                                : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                                }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <PipelineSchematic
                    steps={pipelineSteps}
                    schematic={selectedSchematic}
                    dark={isDark}
                  />
                </div>
              </Motion.div>
            </div>
          </div>
        </section>

        <section className="genocular-activity-section relative overflow-hidden border-b border-slate-200 bg-slate-100 py-16 lg:py-20">
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(8,145,178,0.09),transparent_26%),radial-gradient(circle_at_90%_80%,rgba(15,118,110,0.08),transparent_24%)]" />
          <div className="relative mx-auto w-full max-w-[1560px] px-4 sm:px-8 lg:px-14 xl:px-20">
            <h2 className="max-w-2xl text-3xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-4xl">
              Usage and runtime
            </h2>

            <div className="mt-9 grid items-stretch gap-6 lg:grid-cols-[minmax(280px,0.66fr)_minmax(0,1.34fr)]">
              <div className="genocular-activity-card relative overflow-hidden rounded-3xl bg-slate-950 p-6 text-white shadow-[0_30px_70px_-42px_rgba(15,23,42,0.9)] sm:p-7">
                <div aria-hidden className="absolute -right-24 -top-24 h-64 w-64 rounded-full border border-cyan-400/20" />
                <div aria-hidden className="absolute -right-12 -top-12 h-40 w-40 rounded-full border border-teal-300/20" />
                <div className="relative">
                  <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300">
                    <Database size={13} />
                    Jobs
                  </div>
                  <div className="mt-9 text-[4.75rem] font-semibold leading-none tracking-[-0.065em] text-white sm:text-[5.5rem]">
                    {stats.loading ? "—" : stats.totalRuns ?? "—"}
                  </div>
                  <div className="mt-2 text-sm text-slate-400">Submitted Jobs</div>

                  <div className="mt-9 grid grid-cols-3 gap-3 border-t border-white/10 pt-5">
                    <ActivityMetric label="Completed" value={stats.loading ? "—" : stats.completedRuns ?? "—"} />
                    <ActivityMetric label="Running now" value={stats.loading ? "—" : stats.activeRuns ?? "—"} accent />
                    <ActivityMetric label="Queued" value={stats.loading ? "—" : stats.queuedRuns ?? "—"} />
                  </div>
                </div>
              </div>

              <div className="genocular-runtime-card rounded-3xl border border-slate-200 bg-white/85 p-5 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.55)] backdrop-blur sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-slate-950">Observed runtime</h3>
                    <p className="mt-1 text-xs text-slate-500">Mean duration of completed analyses.</p>
                  </div>
                  <Clock size={17} className="text-cyan-700" />
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  {runtimeGroups.map((group) => (
                    <RuntimeGroup
                      key={group.key}
                      title={group.label}
                      rows={durationRows.filter((row) => row.profile.startsWith(`${group.key}:`))}
                      loading={runDurations.loading}
                      maxSeconds={maxRuntimeSeconds}
                      selectedProfile={selectedProfile}
                      onSelect={(profile) => {
                        const [nextAnalysis, nextMode] = profile.split(":");
                        setAnalysisType(nextAnalysis);
                        setReadMode(nextMode);
                      }}
                    />
                  ))}
                </div>

                <div className="mt-4 flex items-center gap-2 text-[10px] text-slate-400">
                  <span className="h-px w-5 bg-slate-300" />

                </div>
              </div>
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

const ProductFact = ({ value, label, bordered = false }) => (
  <div className={`px-3 sm:px-5 ${bordered ? "border-x border-slate-200" : ""}`}>
    <div className="text-sm font-semibold tracking-[-0.02em] text-slate-900 sm:text-base">{value}</div>
    <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500">{label}</div>
  </div>
);

const ActivityMetric = ({ label, value, accent = false }) => (
  <div className="rounded-xl border border-white/10 bg-white/[0.045] px-4 py-3">
    <div className={`text-2xl font-semibold tracking-tight ${accent ? "text-cyan-300" : "text-white"}`}>{value}</div>
    <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400">{label}</div>
  </div>
);

const RuntimeGroup = ({ title, rows, loading, maxSeconds, selectedProfile, onSelect }) => (
  <div className="genocular-runtime-group overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/50">
    <div className="genocular-runtime-group-title border-b border-slate-200 bg-white/75 px-4 py-3 text-xs font-semibold text-slate-900">
      {title}
    </div>
    <div className="genocular-runtime-rows divide-y divide-slate-100">
      {rows.map((row) => {
        const mode = row.profile.split(":")[1];
        const selected = row.profile === selectedProfile;
        const barWidth = row.avg_seconds
          ? Math.max(7, Math.round((row.avg_seconds / maxSeconds) * 100))
          : 0;
        return (
          <button
            type="button"
            key={row.profile}
            onClick={() => onSelect(row.profile)}
            className={`genocular-runtime-row group relative grid w-full grid-cols-[1fr_auto] items-center gap-4 overflow-hidden px-4 py-3 text-left transition-colors ${selected ? "bg-cyan-50/80" : "hover:bg-white"
              }`}
          >
            <span
              aria-hidden
              className={`absolute inset-y-0 left-0 transition-all ${selected ? "bg-cyan-500/10" : "bg-slate-300/20"}`}
              style={{ width: `${barWidth}%` }}
            />
            <div className="relative flex items-center gap-3">
              <span className={`h-2 w-2 rounded-full ring-4 ${selected ? "bg-cyan-600 ring-cyan-100" : "bg-slate-300 ring-slate-100"}`} />
              <div>
                <div className="text-sm font-medium capitalize text-slate-800">{mode} reads</div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  {loading ? "Loading…" : row.count > 0 ? `${row.count} timed completion${row.count === 1 ? "" : "s"}` : "No timing data"}
                </div>
              </div>
            </div>
            <div className="relative text-right">
              <div className="text-base font-semibold text-slate-950">{loading ? "—" : fmtAvgDuration(row.avg_seconds)}</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-400">average</div>
            </div>
          </button>
        );
      })}
    </div>
  </div>
);

/* ================================
   Interactive Pipeline Schematic
================================= */
/* ================================
   Interactive Pipeline Schematic
================================= */
const PipelineSchematic = ({ steps, schematic, dark = false }) => {
  const safeSteps = Array.isArray(steps) ? steps : [];
  const totalSteps = safeSteps.length || 1;
  const activeSchematic = schematic || PROFILE_SCHEMATICS["wgs:short"];

  const [activeIndex, setActiveIndex] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [displayedSchematic, setDisplayedSchematic] = useState(activeSchematic);

  useEffect(() => {
    if (displayedSchematic.src === activeSchematic.src) return undefined;
    if (typeof Image === "undefined") {
      setDisplayedSchematic(activeSchematic);
      return undefined;
    }

    let cancelled = false;
    const nextImage = new Image();
    nextImage.src = activeSchematic.src;

    const reveal = () => {
      const decoding = typeof nextImage.decode === "function"
        ? nextImage.decode().catch(() => undefined)
        : Promise.resolve();
      decoding.finally(() => {
        if (!cancelled) setDisplayedSchematic(activeSchematic);
      });
    };

    if (nextImage.complete) reveal();
    else {
      nextImage.onload = reveal;
      nextImage.onerror = reveal;
    }

    return () => {
      cancelled = true;
      nextImage.onload = null;
      nextImage.onerror = null;
    };
  }, [activeSchematic, displayedSchematic.src]);

  useEffect(() => {
    setActiveIndex(0);
  }, [steps]);

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
  };

  const handleRowEnter = (idx) => {
    setHovering(true);
    setActiveIndex(idx);
  };

  const handleRowClick = (step, idx) => {
    setActiveIndex(idx);

    const url = TOOL_LINKS[step.key];
    if (url && typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div
      className={
        "relative flex min-h-[320px] flex-col gap-3 py-5 cursor-default " +
        (dark ? "bg-transparent" : "bg-transparent")
      }
    >
      {/* Active step pill */}
      {activeStep && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2">
          <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] ${dark ? "border-slate-700 bg-slate-900/95 text-slate-100" : "border-slate-200 bg-white/95 text-slate-700 shadow-sm"
            }`}>
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-cyan-500" />
            <span className="font-medium">
              {activeIndex + 1} / {safeSteps.length || 1} · {activeStep.title}
            </span>
          </div>
        </div>
      )}

      {/* Schematic with flowing "reads" and smooth marker */}
      <div className="relative w-full mt-6">
        <div className="genocular-profile-schematic-frame relative aspect-[1986/408] w-full overflow-hidden">
          <AnimatePresence initial={false} mode="sync">
            <Motion.img
              key={displayedSchematic.src}
              src={displayedSchematic.src}
              alt={displayedSchematic.alt}
              className="genocular-profile-schematic absolute inset-0 h-full w-full select-none object-contain"
              initial={{ opacity: 0, scale: 0.997, filter: "blur(2px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, scale: 1.002, filter: "blur(1px)" }}
              transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
              draggable="false"
            />
          </AnimatePresence>
        </div>

        {/* Glowing vertical marker tied to active step (springy smooth) */}
        <Motion.div
          className="pointer-events-none absolute inset-y-[12%] w-[2px] rounded-full bg-cyan-500/80 shadow-[0_0_12px_rgba(8,145,178,0.45)]"
          initial={false}
          animate={{ left: markerLeft }}
          transition={{ type: "spring", stiffness: 90, damping: 18 }}
        />

        {/* Multi-lane data tracks along bottom */}
        <div className={`pointer-events-none absolute inset-x-[8%] bottom-6 h-[2px] rounded-full overflow-hidden ${dark ? "bg-slate-700/80" : "bg-slate-200/80"}`}>
          <Motion.div
            className="absolute left-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-sky-400 shadow-[0_0_18px_rgba(56,189,248,0.8)]"
            initial={{ x: "-10%" }}
            animate={{ x: ["-10%", "110%"] }}
            transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
          />
          <Motion.div
            className="absolute left-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_16px_rgba(52,211,153,0.8)]"
            initial={{ x: "-30%" }}
            animate={{ x: ["-30%", "110%"] }}
            transition={{ duration: 6.2, repeat: Infinity, ease: "easeInOut", delay: 0.7 }}
          />
          <Motion.div
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
          "relative mt-2 h-[192px] overflow-hidden rounded-xl border " +
          (dark ? "bg-slate-900/70 border-slate-700" : "bg-slate-50/80 border-slate-200")
        }
        onMouseEnter={handleContainerEnter}
        onMouseLeave={handleContainerLeave}
        onWheel={handleWheel}
      >
        {/* fade top & bottom */}
        <div className={`pointer-events-none absolute inset-x-0 top-0 h-10 ${dark ? "bg-gradient-to-b from-slate-900 via-slate-900/70 to-transparent" : "bg-gradient-to-b from-white via-white/80 to-transparent"}`} />
        <div className={`pointer-events-none absolute inset-x-0 bottom-0 h-10 ${dark ? "bg-gradient-to-t from-slate-900 via-slate-900/70 to-transparent" : "bg-gradient-to-t from-white via-white/80 to-transparent"}`} />

        <Motion.div
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
              <Motion.div
                key={step.key || step.title || idx}
                style={{
                  opacity,
                  scale,
                  filter: blur > 0 ? `blur(${blur}px)` : "none",
                }}
                className="px-3"
                onMouseEnter={() => handleRowEnter(idx)}
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
              </Motion.div>
            );
          })}
        </Motion.div>
      </div>
    </div>
  );
};




export default LandingPage;
