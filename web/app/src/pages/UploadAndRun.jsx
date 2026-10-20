import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { apiJson } from "../lib/api.js";
import { auth } from "../lib/firebase.js";
import {
  copyTextToClipboard,
  downloadJobRecoveryFile,
  forgetJobAccessKey,
  getJobAccessKey,
  privateAnalysisPath,
  privateJobUrl,
  registerJobAccessKey,
  replaceWithPrivateJobLocation,
} from "../lib/jobAccess.js";
import {
  saveJob,
  ensureUploadTask,
  updateUploadTask,
  getUploadTaskSnapshot,
  subscribeUploadTask,
  isClientUploadStatus,
  getRawUploadTask,
  cancelUploadTask
} from "../lib/jobStore.js";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useGuidedTour } from "../lib/GuidedTourContext.jsx";
import { useAuth } from "../auth/AuthProvider.jsx";

/* ========================
   Config
   ======================== */
const CHUNK_SIZE = 50 * 1024 * 1024; // 50 MB
const CONCURRENCY = 4;
const CURRENT_JOB_KEY = "genoverse_current_job";
const UPLOAD_DRAFT_KEY = "genoverse_resumable_upload_v1";
const UPLOAD_DRAFT_VERSION = 1;

/* ========================
   Tool catalog
   ======================== */
const TOOL_CATALOG = {
  fastqc_raw: {
    name: "FastQC (Raw)",
    desc: "Pre-trimming quality check.",
    expected: ["fastqc_raw/*_fastqc.html"],
  },
  trimmomatic: {
    name: "Trimmomatic",
    desc: "Adapter/quality trimming.",
    expected: [
      "*_R1_paired.fastq",
      "*_R2_paired.fastq",
      "*_R1_unpaired.fastq",
      "*_R2_unpaired.fastq",
    ],
  },
  cutadapt_paired: {
    name: "Cutadapt",
    desc: "Adapter trimming after Trimmomatic.",
    expected: ["*_R1_trimmed.fastq", "*_R2_trimmed.fastq"],
  },
  cutadapt: {
    name: "Cutadapt",
    desc: "Adapter trimming for short reads in hybrid mode.",
    expected: ["*_R1_trimmed.fastq", "*_R2_trimmed.fastq"],
  },
  seqtk_trim: {
    name: "Seqtk",
    desc: "Lightweight quality trimming.",
    expected: ["*_R1_seqtk_trimmed.fastq", "*_R2_seqtk_trimmed.fastq"],
  },
  seqtk: {
    name: "Seqtk",
    desc: "Short-read quality trimming in hybrid mode.",
    expected: ["*_R1_seqtk_trimmed.fastq", "*_R2_seqtk_trimmed.fastq"],
  },
  bbduk: {
    name: "BBDuk",
    desc: "K-mer filtering.",
    expected: ["*_R1_bbduk_cleaned.fastq", "*_R2_bbduk_cleaned.fastq"],
  },
  fastqc_trimmed: {
    name: "FastQC (Trimmed)",
    desc: "Post-trimming quality check.",
    expected: ["fastqc_trimmed/*_fastqc.html"],
  },
  fastqc_clean: {
    name: "FastQC (Clean)",
    desc: "Quality check after metagenomic read cleaning.",
    expected: ["fastqc_clean/*_fastqc.html"],
  },
  nonpareil: {
    name: "Nonpareil",
    desc: "Estimate metagenomic coverage and sequencing saturation.",
    expected: ["nonpareil/*.npo"],
  },
  kraken_classify: {
    name: "Kraken2: Classification",
    desc: "Taxonomic classification of reads.",
    expected: ["kraken2_report.txt", "kraken2_output.txt"],
  },
  kraken_extract_reads: {
    name: "Kraken2: Extract Reads",
    desc: "Extracts reads that pass taxonomy filters.",
    expected: [
      "kraken_classified/<sample>_classified_R1.fastq",
      "kraken_classified/<sample>_classified_R2.fastq",
    ],
  },
  kraken_classify_short: {
    name: "Kraken2: Classify Short Reads",
    desc: "Taxonomic classification of short reads (hybrid mode).",
    expected: ["kraken_short/kraken2_report.txt"],
  },
  kraken_extract_short: {
    name: "Kraken2: Extract Short Reads",
    desc: "Extract short reads for hybrid assembly.",
    expected: [
      "kraken_classified/<sample>_classified_R1.fastq",
      "kraken_classified/<sample>_classified_R2.fastq",
    ],
  },
  nanoplot: {
    name: "NanoPlot",
    desc: "Long-read quality diagnostics.",
    expected: ["nanoplot/NanoStats.txt"],
  },
  pipeline_decision: {
    name: "Adaptive Decision",
    desc: "Selects filtering parameters from QC and coverage.",
    expected: ["decisions/pipeline_decision.json"],
  },
  adaptive_filter: {
    name: "Adaptive Filter",
    desc: "Applies NanoFilt/Filtlong logic to long reads.",
    expected: ["filtered/<sample>_filtered.fastq"],
  },
  kraken_classify_long: {
    name: "Kraken2: Classify Long Reads",
    desc: "Taxonomic classification of long reads (hybrid mode).",
    expected: ["kraken_long/kraken2_report.txt"],
  },
  kraken_extract_long: {
    name: "Kraken2: Extract Long Reads",
    desc: "Extract long reads for hybrid assembly.",
    expected: ["kraken_long_classified/<sample>_long_classified.fastq"],
  },
  kraken_extract: {
    name: "Kraken2: Extract Reads",
    desc: "Extract long reads that pass taxonomy filters.",
    expected: ["kraken_classified/<sample>_classified.fastq"],
  },
  spades: {
    name: "SPAdes",
    desc: "De novo short-read assembly.",
    expected: ["spades_output/contigs.fasta"],
  },
  flye: {
    name: "Flye",
    desc: "Long-read assembly.",
    expected: ["flye/assembly.fasta"],
  },
  racon_round1: {
    name: "Racon Round 1",
    desc: "First polishing round.",
    expected: ["racon/round1.fasta"],
  },
  racon_round2: {
    name: "Racon Round 2",
    desc: "Second polishing round.",
    expected: ["racon/round2.fasta"],
  },
  finalize_assembly: {
    name: "Finalize Assembly",
    desc: "Selects the final polished assembly.",
    expected: ["assembly/final_assembly.fasta"],
  },
  unicycler: {
    name: "Unicycler",
    desc: "Hybrid assembly from short + long reads.",
    expected: ["unicycler/assembly.fasta"],
  },
  prokka: {
    name: "Prokka",
    desc: "Genome annotation.",
    expected: [
      "prokka/annotated_genome.gff",
      "prokka/annotated_genome.faa",
      "prokka/annotated_genome.ffn",
    ],
  },
  repeatmasker: {
    name: "RepeatMasker",
    desc: "Mask repeats.",
    expected: [
      "repeatmasker/repeatmasker_output.gff",
      "repeatmasker/contigs.masked.fasta",
    ],
  },
  interproscan: {
    name: "InterProScan",
    desc: "Protein domains and GO.",
    expected: ["interproscan/interproscan_results.tsv"],
  },
  quast: {
    name: "QUAST",
    desc: "Assembly QC.",
    expected: ["quast/report.html"],
  },
  busco: {
    name: "BUSCO",
    desc: "Completeness assessment.",
    expected: ["busco/*/short_summary.txt"],
  },
  prepare_checkm_input: {
    name: "Prepare CheckM Input",
    desc: "Prep contigs for CheckM.",
    expected: ["checkm_input/contigs.fasta"],
  },
  checkm: {
    name: "CheckM",
    desc: "Completeness/contamination.",
    expected: ["checkm_output/checkm.txt"],
  },
  prodigal: {
    name: "Prodigal",
    desc: "Gene prediction.",
    expected: [
      "prodigal/genes.coords",
      "prodigal/proteins.faa",
      "prodigal/genes.fna",
    ],
  },
  abricate: {
    name: "ABRicate",
    desc: "AMR/virulence/plasmid genes.",
    expected: [
      "abricate/abricate_resfinder.csv",
      "abricate/abricate_ncbi.csv",
      "abricate/abricate_card.csv",
      "abricate/abricate_vfdb.csv",
      "abricate/abricate_plasmidfinder.csv",
    ],
  },
  kofamscan: {
    name: "KofamScan",
    desc: "KO annotation.",
    expected: ["kofamscan/kofamscan_results.txt"],
  },
  dbcan: {
    name: "dbCAN",
    desc: "CAZyme annotation.",
    expected: ["dbcan/overview.txt"],
  },
  eggnog_mapper: {
    name: "eggNOG-mapper",
    desc: "Orthology-based annotation.",
    expected: ["emapper_results/annotations.emapper.annotations"],
  },
  cctyper: {
    name: "CCTyper",
    desc: "CRISPR-Cas typing.",
    expected: ["crispr_output/crispr_summary.txt"],
  },
  crispr: {
    name: "CRISPRCasFinder",
    desc: "CRISPR arrays & Cas genes.",
    expected: ["crispr_output/crispr_summary.txt"],
  },
  antismash: {
    name: "antiSMASH",
    desc: "BGC detection.",
    expected: ["antismash_results/knownclusterblast.txt"],
  },
  hadeg: {
    name: "HADEG",
    desc: "Hydrocarbon degradation gene analysis.",
    expected: ["hadeg/hadeg_done.flag"],
  },
  barrnap_16s: {
    name: "Barrnap 16S",
    desc: "16S rRNA extraction.",
    expected: ["barrnap/contigs_16s.fasta"],
  },
  blast_16s: {
    name: "BLAST 16S",
    desc: "16S similarity search against SILVA.",
    expected: ["blast_16s/blast_16s_results.txt"],
  },
  fastani: {
    name: "FastANI",
    desc: "ANI against downloaded references.",
    expected: ["fastani/fastani_results.txt"],
  },
  final_report: {
    name: "Final Report",
    desc: "Consolidated summary.",
    expected: ["final_report.txt"],
  },
  manifest: {
    name: "Manifest",
    desc: "Result file list for the interface.",
    expected: ["manifest.json"],
  },
  fastp: {
    name: "fastp",
    desc: "Short-read quality trimming and filtering.",
    expected: ["fastp/*_fastp.html", "fastp/*_fastp.json"],
  },
  kneaddata: {
    name: "KneadData",
    desc: "Host read removal and decontamination.",
    expected: ["kneaddata/*_paired_1.fastq", "host_removal_sr/*/R1_decontam.fastq"],
  },
  metaphlan: {
    name: "MetaPhlAn",
    desc: "Taxonomic profiling from cleaned metagenomic reads.",
    expected: ["metaphlan/*_profile.txt"],
  },
  kraken2: {
    name: "Kraken2",
    desc: "K-mer based metagenomic taxonomic classification.",
    expected: ["kraken2/*_report.txt"],
  },
  bracken: {
    name: "Bracken",
    desc: "Species-level abundance estimation from Kraken2 assignments.",
    expected: ["kraken2/*_bracken_species.tsv"],
  },
  megahit: {
    name: "MEGAHIT",
    desc: "Short-read metagenome assembly.",
    expected: ["assembly/*_final.contigs.fa"],
  },
  megahit_assembly: {
    name: "MEGAHIT",
    desc: "Short-read assembly branch for hybrid metagenomics.",
    expected: ["megahit/*/final.contigs.fa"],
  },
  operams_assembly: {
    name: "OPERA-MS",
    desc: "Hybrid metagenome assembly with short and long reads.",
    expected: ["operams/*/contigs.fasta"],
  },
  nanostat_raw: {
    name: "NanoStat (Raw)",
    desc: "Long-read quality statistics before filtering.",
    expected: ["nanostat/*/raw_nanostat.txt"],
  },
  nanoq_adaptive: {
    name: "nanoq",
    desc: "Adaptive long-read filtering.",
    expected: ["nanoq/*/filtered.fastq", "nanoq/*/filtered.fastq.gz"],
  },
  nanostat_filtered: {
    name: "NanoStat (Filtered)",
    desc: "Long-read quality statistics after nanoq filtering.",
    expected: ["nanostat/*/filtered_nanostat.txt"],
  },
  host_removal: {
    name: "Host Removal",
    desc: "Long-read host decontamination.",
    expected: ["host_removal/*/decontam.fastq"],
  },
  host_removal_lr: {
    name: "Long-read Host Removal",
    desc: "Long-read host decontamination for hybrid inputs.",
    expected: ["host_removal_lr/*/decontam.fastq"],
  },
  flye_assembly: {
    name: "metaFlye",
    desc: "Long-read metagenome assembly.",
    expected: ["assembly/*_flye/assembly.fasta"],
  },
  medaka_polish: {
    name: "Medaka",
    desc: "ONT assembly polishing.",
    expected: ["medaka/*/consensus.fasta"],
  },
  bowtie2_index: {
    name: "Bowtie2 Index",
    desc: "Build assembly index for read mapping.",
    expected: ["mapping/*_index*.bt2"],
  },
  bowtie2_map: {
    name: "Bowtie2 Mapping",
    desc: "Map short reads back to contigs.",
    expected: ["mapping/*.sorted.bam"],
  },
  minimap2_map: {
    name: "Minimap2 Mapping",
    desc: "Map long reads back to contigs.",
    expected: ["mapping/*.sorted.bam"],
  },
  merge_bams: {
    name: "Merge BAMs",
    desc: "Merge short-read and long-read assembly alignments.",
    expected: ["mapping/*merged*.bam"],
  },
  depth: {
    name: "Depth Summary",
    desc: "Calculate contig depth for binning.",
    expected: ["mapping/*_depth.txt"],
  },
  filter_contigs_by_depth: {
    name: "Depth Filter",
    desc: "Filter contigs before long-read binning.",
    expected: ["mapping/*_contigs_filtered.fasta"],
  },
  minimap2_map_filtered: {
    name: "Minimap2 Filtered Mapping",
    desc: "Map reads to depth-filtered contigs.",
    expected: ["mapping/*filtered*.bam"],
  },
  depth_filtered: {
    name: "Filtered Depth Summary",
    desc: "Calculate depth for filtered contigs.",
    expected: ["mapping/*filtered*_depth.txt"],
  },
  metabat_depth: {
    name: "MetaBAT Depth",
    desc: "Prepare depth table for MetaBAT2.",
    expected: ["mapping/*metabat*depth*"],
  },
  metabat2: {
    name: "MetaBAT2",
    desc: "Metagenome binning with coverage profiles.",
    expected: ["binning/*/metabat2.done"],
  },
  maxbin2: {
    name: "MaxBin2",
    desc: "Composition and abundance based binning.",
    expected: ["binning/*/maxbin2.done"],
  },
  semibin2: {
    name: "SemiBin2",
    desc: "Self-supervised metagenome binning.",
    expected: ["binning/*/semibin2.done"],
  },
  virsorter2: {
    name: "VirSorter2",
    desc: "Viral contig prediction from metagenome assemblies.",
    expected: ["viral/*/virsorter2.done"],
  },
  gunc: {
    name: "GUNC",
    desc: "Genome contamination and chimerism screening for MAGs.",
    expected: ["gunc/*/gunc_maxcss.tsv"],
  },
  contig2bin_tables: {
    name: "Contig-to-bin Tables",
    desc: "Prepare binning tables for DAS Tool.",
    expected: ["binning/*/*contig2bin*.tsv"],
  },
  metabat2_to_contig2bin: {
    name: "MetaBAT2 Contig Map",
    desc: "Convert MetaBAT2 bins to contig-to-bin format.",
    expected: ["binning/*/*metabat*contig2bin*.tsv"],
  },
  semibin2_to_contig2bin: {
    name: "SemiBin2 Contig Map",
    desc: "Convert SemiBin2 bins to contig-to-bin format.",
    expected: ["binning/*/*semibin*contig2bin*.tsv"],
  },
  dastool: {
    name: "DAS Tool",
    desc: "Consensus MAG bin selection.",
    expected: ["dastool/*_DASTool_bins", "dastool/*.dastool.done"],
  },
  select_dastool_bins: {
    name: "Select MAGs",
    desc: "Select and stage DAS Tool bins.",
    expected: ["dastool/*_DASTool_bins_clean/*.fa", "dastool/*_DASTool_bins_clean.done"],
  },
  checkm2: {
    name: "CheckM2",
    desc: "MAG completeness and contamination assessment.",
    expected: ["checkm2/*/quality_report.tsv"],
  },
  quast_per_mag: {
    name: "MetaQUAST per MAG",
    desc: "Assembly quality metrics for each MAG.",
    expected: ["mag_quast/*/mag_quast.done"],
  },
  quast_per_mag_all: {
    name: "MetaQUAST MAG Summary",
    desc: "Finalize per-MAG assembly QC.",
    expected: ["mag_quast/*/mag_quast.done"],
  },
  merge_mag_qc: {
    name: "Merge MAG QC",
    desc: "Combine CheckM2, BUSCO, and MetaQUAST metrics.",
    expected: ["mag_merged_qc/*/combined_quality_summary.tsv", "mag_qc_merged/*/combined_quality_summary.tsv"],
  },
  mag_filter: {
    name: "MAG Filter",
    desc: "Filter MAGs by quality thresholds.",
    expected: ["mag_filtered/*.filter.done", "mag_filtered/*/filter_log.tsv", "mag_filtered/*/*.fa"],
  },
  gtdbtk: {
    name: "GTDB-Tk",
    desc: "Taxonomic classification of MAGs.",
    expected: ["gtdbtk/*/gtdbtk.bac120.summary.tsv"],
  },
  drep: {
    name: "dRep",
    desc: "MAG dereplication.",
    expected: ["drep/*/dereplicated_genomes"],
  },
  coverm: {
    name: "CoverM",
    desc: "MAG abundance and coverage profiling.",
    expected: ["coverm/*/coverage.tsv"],
  },
  barrnap_per_mag: {
    name: "Barrnap per MAG",
    desc: "Detect rRNA features per MAG.",
    expected: ["barrnap/*/*.gff"],
  },
  barrnap_all: {
    name: "Barrnap Summary",
    desc: "Collect MAG 16S rRNA detections.",
    expected: ["barrnap/*/all_MAGs_16S_rRNA.fa"],
  },
  prokka_all: {
    name: "Prokka Summary",
    desc: "Finalize MAG annotations.",
    expected: ["annotation/prokka/*/prokka.done"],
  },
  cctyper_per_mag: {
    name: "CCTyper per MAG",
    desc: "CRISPR-Cas typing per MAG.",
    expected: ["annotation/cctyper/*/*.tsv"],
  },
  cctyper_all: {
    name: "CCTyper Summary",
    desc: "Collect CRISPR-Cas typing outputs.",
    expected: ["annotation/cctyper/*/cctyper.done"],
  },
  dbcan_per_mag: {
    name: "dbCAN per MAG",
    desc: "CAZyme annotation per MAG.",
    expected: ["annotation/dbcan/*/*.txt"],
  },
  dbcan_all: {
    name: "dbCAN Summary",
    desc: "Collect CAZyme annotations.",
    expected: ["annotation/dbcan/*/dbcan.done"],
  },
  abricate_summary: {
    name: "ABRicate Summary",
    desc: "Summarize AMR and virulence annotations.",
    expected: ["annotation/abricate/*/*summary*"],
  },
  abricate_all: {
    name: "ABRicate Complete",
    desc: "Finalize ABRicate annotation outputs.",
    expected: ["annotation/abricate/*/abricate.done"],
  },
  hadeg_proteinortho: {
    name: "HADEG Proteinortho",
    desc: "Hydrocarbon degradation orthology analysis.",
    expected: ["hadeg/*/hadeg_proteinortho.done"],
  },
  busco_filtered_per_mag: {
    name: "BUSCO Filtered MAG",
    desc: "Completeness check for each filtered MAG.",
    expected: ["busco_filtered/*/*"],
  },
  busco_filtered_all: {
    name: "BUSCO Filtered Summary",
    desc: "Collect filtered MAG BUSCO outputs.",
    expected: ["busco_filtered/*/busco_filtered_all.done"],
  },
  prodigal_assembly: {
    name: "Prodigal Assembly",
    desc: "Predict genes on the metagenome assembly.",
    expected: ["prodigal/*/predicted_genes.ffn"],
  },
  cdhit_genes: {
    name: "CD-HIT Genes",
    desc: "Cluster nucleotide gene catalogue.",
    expected: ["cdhit/*/gene_catalogue_nr.ffn"],
  },
  cdhit_proteins: {
    name: "CD-HIT Proteins",
    desc: "Cluster protein gene catalogue.",
    expected: ["cdhit/*/gene_catalogue_nr.faa"],
  },
  salmon_index: {
    name: "Salmon Index",
    desc: "Build gene catalogue quantification index.",
    expected: ["salmon/*/index"],
  },
  salmon_quant: {
    name: "Salmon Quant",
    desc: "Quantify short-read gene catalogue abundance.",
    expected: ["salmon/*/quant.sf"],
  },
  minimap2_gene_map: {
    name: "Minimap2 Gene Mapping",
    desc: "Map long reads to the gene catalogue.",
    expected: ["quant_longread/*/*.bam"],
  },
  bowtie2_gene_map: {
    name: "Bowtie2 Gene Mapping",
    desc: "Map short reads to the hybrid gene catalogue.",
    expected: ["quant_hybrid/*/*.bam"],
  },
  featurecounts_gene_quant: {
    name: "featureCounts",
    desc: "Quantify gene catalogue abundance.",
    expected: ["quant_longread/*/gene_counts.txt", "quant_hybrid/*/gene_counts.txt"],
  },
  multiqc_collect: {
    name: "MultiQC Collect",
    desc: "Collect inputs for MultiQC.",
    expected: ["multiqc/*"],
  },
  multiqc: {
    name: "MultiQC",
    desc: "Aggregate pipeline quality reports.",
    expected: ["multiqc/multiqc_report.html", "multiqc/*/multiqc_report.html"],
  },
  analysis_plots: {
    name: "Analysis Plots",
    desc: "Generate frontend-ready result plots.",
    expected: ["analysis_assets/*", "plots/*"],
  },
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

const WGS_SHORT_ORDER = [
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
];

const WGS_LONG_ORDER = [
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
];

const WGS_HYBRID_ORDER = [
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
];

const META_SHORT_ORDER = [
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
];

const META_LONG_ORDER = [
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
];

const META_HYBRID_ORDER = [
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
];

const RESULTS_PREVIEW_COUNT = 6;
const ANALYSIS_TYPES = [
  { key: "wgs", label: "WGS", hint: "Whole-genome sequencing workflow" },
  {
    key: "metagenomics",
    label: "Metagenomics",
    hint: "Metagenomis sample analysis workflow",
  },
];
const READ_MODES = [
  { key: "short", label: "Short", hint: "Paired-end (R1 + R2)" },
  { key: "long", label: "Long", hint: "Single long-read file" },
  { key: "hybrid", label: "Hybrid", hint: "R1 + R2 + R_long" },
];
const ENABLE_META_SHORT_SETTINGS = true;

function defaultMetaShortConfig() {
  return {
    fastp: {
      qualified_quality_phred: 20,
      minimum_length: 50,
      low_complexity_filter: true,
      cut_front: true,
      cut_tail: true,
    },
    megahit: { min_contig_len: 1000 },
    kraken2: { enabled: true, confidence: 0, minimum_hit_groups: 2 },
    bracken: { read_length: 150, level: "S", threshold: 10 },
    viral: { enabled: true, virsorter2_min_length: 1500, virsorter2_min_score: 0.5 },
    semibin: { min_len: 1500 },
    gunc: { enabled: true, minimum_mapped_genes: 11 },
    quality_thresholds: { minimum_completeness: 50, maximum_contamination: 10 },
    drep_options: {
      primary_ani: 0.9,
      secondary_ani: 0.95,
      minimum_aligned_fraction: 0.3,
      minimum_completeness: 50,
      maximum_contamination: 10,
    },
    annotation_modules: {
      prokka: true,
      cctyper: true,
      dbcan: true,
      abricate: true,
      hadeg: true,
      busco_filtered: true,
    },
  };
}

const PIPELINE_ORDERS = {
  "wgs:short": WGS_SHORT_ORDER,
  "wgs:long": WGS_LONG_ORDER,
  "wgs:hybrid": WGS_HYBRID_ORDER,
  "metagenomics:short": META_SHORT_ORDER,
  "metagenomics:long": META_LONG_ORDER,
  "metagenomics:hybrid": META_HYBRID_ORDER,
};

const PIPELINE_TREES = {
  "wgs:short": [
    {
      key: "fastqc_raw",
      children: [
        {
          key: "trimmomatic",
          children: [
            {
              key: "cutadapt_paired",
              children: [
                {
                  key: "seqtk_trim",
                  children: [
                    {
                      key: "bbduk",
                      children: [
                        { key: "fastqc_trimmed" },
                        {
                          key: "kraken_classify",
                          children: [
                            {
                              key: "kraken_extract_reads",
                              children: [
                                {
                                  key: "spades",
                                  children: [
                                    { key: "prokka", children: [{ key: "interproscan" }] },
                                    { key: "prodigal", children: [{ key: "kofamscan" }] },
                                    { key: "quast" },
                                    { key: "busco" },
                                    { key: "checkm" },
                                    { key: "abricate" },
                                    { key: "dbcan" },
                                    { key: "eggnog_mapper" },
                                    { key: "cctyper" },
                                    { key: "antismash" },
                                    { key: "repeatmasker" },
                                    { key: "hadeg" },
                                    { key: "barrnap_16s" },
                                    { key: "blast_16s" },
                                    { key: "fastani" },
                                    { key: "final_report" },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  "wgs:long": [
    {
      key: "nanoplot",
      children: [
        {
          key: "pipeline_decision",
          children: [
            {
              key: "adaptive_filter",
              children: [
                {
                  key: "kraken_classify",
                  children: [
                    {
                      key: "kraken_extract",
                      children: [
                        {
                          key: "flye",
                          children: [
                            {
                              key: "racon_round1",
                              children: [
                                {
                                  key: "racon_round2",
                                  children: [{ key: "finalize_assembly" }],
                                },
                              ],
                            },
                            { key: "quast" },
                            { key: "busco" },
                            { key: "checkm" },
                            { key: "barrnap_16s" },
                            { key: "blast_16s" },
                            { key: "fastani" },
                            { key: "prokka", children: [{ key: "interproscan" }] },
                            { key: "prodigal", children: [{ key: "kofamscan" }] },
                            { key: "dbcan" },
                            { key: "eggnog_mapper" },
                            { key: "abricate" },
                            { key: "cctyper" },
                            { key: "antismash" },
                            { key: "repeatmasker" },
                            { key: "hadeg" },
                            { key: "final_report" },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  "wgs:hybrid": [
    {
      key: "fastqc_raw",
      children: [
        {
          key: "trimmomatic",
          children: [
            {
              key: "cutadapt",
              children: [
                {
                  key: "seqtk",
                  children: [
                    {
                      key: "bbduk",
                      children: [
                        { key: "fastqc_trimmed" },
                        {
                          key: "kraken_classify_short",
                          children: [{ key: "kraken_extract_short" }],
                        },
                        {
                          key: "nanoplot",
                          children: [
                            {
                              key: "pipeline_decision",
                              children: [
                                {
                                  key: "adaptive_filter",
                                  children: [
                                    {
                                      key: "kraken_classify_long",
                                      children: [{ key: "kraken_extract_long" }],
                                    },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                        {
                          key: "unicycler",
                          children: [
                            { key: "quast" },
                            { key: "busco" },
                            { key: "checkm" },
                            { key: "prokka", children: [{ key: "interproscan" }] },
                            { key: "prodigal", children: [{ key: "kofamscan" }] },
                            { key: "dbcan" },
                            { key: "eggnog_mapper" },
                            { key: "abricate" },
                            { key: "cctyper" },
                            { key: "antismash" },
                            { key: "repeatmasker" },
                            { key: "hadeg" },
                            { key: "barrnap_16s" },
                            { key: "blast_16s" },
                            { key: "fastani" },
                            { key: "final_report" },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  "metagenomics:short": [
    { key: "fastqc_raw" },
    {
      key: "fastp",
      children: [
        { key: "fastqc_clean" },
        { key: "nonpareil" },
        { key: "kraken2", children: [{ key: "bracken" }] },
        {
          key: "kneaddata",
          children: [
            { key: "metaphlan" },
            {
              key: "megahit",
              children: [
                { key: "quast" },
                { key: "virsorter2" },
                {
                  key: "prodigal_assembly",
                  children: [
                    {
                      key: "cdhit_genes",
                      children: [{ key: "salmon_index", children: [{ key: "salmon_quant" }] }],
                    },
                  ],
                },
                {
                  key: "bowtie2_index",
                  children: [
                    {
                      key: "bowtie2_map",
                      children: [
                        {
                          key: "depth",
                          children: [
                            { key: "metabat2" },
                            { key: "maxbin2" },
                            { key: "semibin2" },
                            {
                              key: "contig2bin_tables",
                              children: [
                                {
                                  key: "dastool",
                                  children: [
                                    {
                                      key: "select_dastool_bins",
                                      children: [
                                        { key: "checkm2" },
                                        { key: "busco" },
                                        { key: "quast_per_mag", children: [{ key: "quast_per_mag_all" }] },
                                        {
                                          key: "merge_mag_qc",
                                          children: [
                                            {
                                              key: "mag_filter",
                                              children: [
                                                { key: "gunc" },
                                                { key: "gtdbtk" },
                                                { key: "drep" },
                                                { key: "coverm" },
                                                { key: "barrnap_per_mag", children: [{ key: "barrnap_all" }] },
                                                { key: "prokka", children: [{ key: "prokka_all", children: [{ key: "hadeg_proteinortho" }] }] },
                                                { key: "cctyper_per_mag", children: [{ key: "cctyper_all" }] },
                                                { key: "dbcan_per_mag", children: [{ key: "dbcan_all" }] },
                                                { key: "abricate", children: [{ key: "abricate_summary" }, { key: "abricate_all" }] },
                                                { key: "busco_filtered_per_mag", children: [{ key: "busco_filtered_all" }] },
                                                { key: "multiqc", children: [{ key: "analysis_plots" }] },
                                              ],
                                            },
                                          ],
                                        },
                                      ],
                                    },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  "metagenomics:long": [
    {
      key: "nanostat_raw",
      children: [
        {
          key: "nanoq_adaptive",
          children: [
            {
              key: "nanostat_filtered",
              children: [
                {
                  key: "host_removal",
                  children: [
                    {
                      key: "flye_assembly",
                      children: [
                        {
                          key: "medaka_polish",
                          children: [
                            { key: "quast" },
                            { key: "virsorter2" },
                            {
                              key: "prodigal_assembly",
                              children: [
                                { key: "cdhit_proteins" },
                                { key: "minimap2_gene_map", children: [{ key: "featurecounts_gene_quant" }] },
                              ],
                            },
                            {
                              key: "minimap2_map",
                              children: [
                                {
                                  key: "depth",
                                  children: [
                                    {
                                      key: "filter_contigs_by_depth",
                                      children: [
                                        {
                                          key: "minimap2_map_filtered",
                                          children: [
                                            {
                                              key: "depth_filtered",
                                              children: [
                                                { key: "metabat_depth" },
                                                { key: "metabat2" },
                                                { key: "semibin2" },
                                                {
                                                  key: "metabat2_to_contig2bin",
                                                  children: [
                                                    {
                                                      key: "semibin2_to_contig2bin",
                                                      children: [
                                                        {
                                                          key: "dastool",
                                                          children: [
                                                            {
                                                              key: "select_dastool_bins",
                                                              children: [
                                                                { key: "checkm2" },
                                                                { key: "busco" },
                                                                { key: "quast_per_mag", children: [{ key: "quast_per_mag_all" }] },
                                                                {
                                                                  key: "merge_mag_qc",
                                                                  children: [
                                                                    {
                                                                      key: "mag_filter",
                                                                      children: [
                                                                        { key: "drep" },
                                                                        { key: "gtdbtk" },
                                                                        { key: "coverm" },
                                                                        { key: "barrnap_per_mag", children: [{ key: "barrnap_all" }] },
                                                                        { key: "prokka", children: [{ key: "prokka_all", children: [{ key: "hadeg_proteinortho" }] }] },
                                                                        { key: "cctyper_per_mag", children: [{ key: "cctyper_all" }] },
                                                                        { key: "dbcan_per_mag", children: [{ key: "dbcan_all" }] },
                                                                        { key: "abricate", children: [{ key: "abricate_summary" }, { key: "abricate_all" }] },
                                                                        { key: "multiqc_collect", children: [{ key: "multiqc" }, { key: "analysis_plots" }] },
                                                                      ],
                                                                    },
                                                                  ],
                                                                },
                                                              ],
                                                            },
                                                          ],
                                                        },
                                                      ],
                                                    },
                                                  ],
                                                },
                                              ],
                                            },
                                          ],
                                        },
                                      ],
                                    },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  "metagenomics:hybrid": [
    {
      key: "fastp",
      children: [
        {
          key: "kneaddata",
          children: [
            { key: "kraken2", children: [{ key: "bracken" }] },
            { key: "megahit_assembly" },
          ],
        },
      ],
    },
    {
      key: "nanostat_raw",
      children: [
        {
          key: "nanoq_adaptive",
          children: [{ key: "nanostat_filtered", children: [{ key: "host_removal_lr" }] }],
        },
      ],
    },
    {
      key: "operams_assembly",
      children: [
        { key: "quast" },
        { key: "virsorter2" },
        {
          key: "prodigal_assembly",
          children: [
            { key: "cdhit_proteins" },
            { key: "bowtie2_gene_map", children: [{ key: "featurecounts_gene_quant" }] },
          ],
        },
        { key: "bowtie2_index", children: [{ key: "bowtie2_map" }] },
        { key: "minimap2_map" },
        {
          key: "merge_bams",
          children: [
            {
              key: "depth",
              children: [
                { key: "metabat2" },
                { key: "semibin2" },
                {
                  key: "metabat2_to_contig2bin",
                  children: [
                    {
                      key: "semibin2_to_contig2bin",
                      children: [
                        {
                          key: "dastool",
                          children: [
                            {
                              key: "select_dastool_bins",
                              children: [
                                { key: "checkm2" },
                                { key: "busco" },
                                { key: "quast_per_mag", children: [{ key: "quast_per_mag_all" }] },
                                {
                                  key: "merge_mag_qc",
                                  children: [
                                    {
                                      key: "mag_filter",
                                      children: [
                                        { key: "gtdbtk" },
                                        { key: "drep" },
                                        { key: "coverm" },
                                        { key: "barrnap_per_mag", children: [{ key: "barrnap_all" }] },
                                        { key: "prokka", children: [{ key: "prokka_all", children: [{ key: "hadeg_proteinortho" }] }] },
                                        { key: "cctyper_per_mag", children: [{ key: "cctyper_all" }] },
                                        { key: "dbcan_per_mag", children: [{ key: "dbcan_all" }] },
                                        { key: "abricate", children: [{ key: "abricate_summary" }, { key: "abricate_all" }] },
                                        { key: "busco_filtered_per_mag", children: [{ key: "busco_filtered_all" }] },
                                        { key: "multiqc_collect", children: [{ key: "multiqc" }, { key: "analysis_plots" }] },
                                      ],
                                    },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

function profileKey(analysisType, readMode) {
  const analysis = analysisType === "metagenomics" ? "metagenomics" : "wgs";
  const mode =
    readMode === "long" || readMode === "hybrid" || readMode === "short"
      ? readMode
      : "short";
  return `${analysis}:${mode}`;
}

function formatJobDate(date = new Date()) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}_${month}_${year}`;
}

function defaultJobName(analysisType = "wgs", readMode = "short") {
  const jobType = analysisType === "metagenomics" ? "Meta" : "WGS";
  const mode =
    readMode === "long" || readMode === "hybrid" || readMode === "short"
      ? readMode
      : "short";
  return `${jobType}_${mode}_${formatJobDate()}`;
}

function shouldReplaceDefaultJobName(value) {
  const name = String(value || "").trim();
  return (
    !name ||
    name === "Job1" ||
    /^(WGS|Meta)_(short|long|hybrid)_\d{2}_\d{2}_\d{4}$/.test(name)
  );
}

function parseProfileKey(key) {
  const [analysisRaw, modeRaw] = String(key || "").split(":");
  const analysis = analysisRaw === "metagenomics" ? "metagenomics" : "wgs";
  const mode =
    modeRaw === "long" || modeRaw === "hybrid" || modeRaw === "short"
      ? modeRaw
      : "short";
  return { analysis, mode, key: `${analysis}:${mode}` };
}

function getProfileOrder(analysisType, readMode) {
  const key = profileKey(analysisType, readMode);
  return PIPELINE_ORDERS[key] || LEGACY_ORDER;
}

function getOrderForProfileKey(key) {
  return PIPELINE_ORDERS[key] || null;
}

function getProfileTree(analysisType, readMode) {
  const key = profileKey(analysisType, readMode);
  return (
    PIPELINE_TREES[key] ||
    PIPELINE_TREES["metagenomics:short"] ||
    []
  );
}

function getTreeForProfileKey(key) {
  return PIPELINE_TREES[key] || null;
}

function stepsFromStatusPayload(payload) {
  if (Array.isArray(payload?.rail?.steps)) return payload.rail.steps;
  if (Array.isArray(payload?.steps)) return payload.steps;
  return [];
}

function inferProfileKeyFromSteps(steps) {
  const keys = new Set(
    (steps || [])
      .map(step => String(step?.key || step?.name || "").trim().toLowerCase())
      .filter(Boolean)
  );

  if (
    [
      "operams_assembly",
      "host_removal_lr",
      "merge_bams",
      "bowtie2_gene_map",
      "megahit_assembly",
    ].some(key => keys.has(key))
  ) {
    return "metagenomics:hybrid";
  }

  if (
    [
      "flye_assembly",
      "medaka_polish",
      "nanoq_adaptive",
      "nanostat_raw",
      "nanostat_filtered",
      "minimap2_gene_map",
      "filter_contigs_by_depth",
      "metabat_depth",
    ].some(key => keys.has(key))
  ) {
    return "metagenomics:long";
  }

  if (
    [
      "fastp",
      "kneaddata",
      "metaphlan",
      "megahit",
      "maxbin2",
      "salmon_index",
      "salmon_quant",
      "checkm2",
      "dastool",
      "gtdbtk",
    ].some(key => keys.has(key))
  ) {
    return "metagenomics:short";
  }

  return "";
}

function profileFromStatusPayload(payload) {
  const key = String(payload?.rail?.profile || payload?.profile || "")
    .trim()
    .toLowerCase();
  if (PIPELINE_ORDERS[key]) return key;
  return inferProfileKeyFromSteps(stepsFromStatusPayload(payload));
}

function orderFromStatusPayload(payload, fallbackOrder) {
  const key = profileFromStatusPayload(payload);
  return key ? PIPELINE_ORDERS[key] || fallbackOrder : fallbackOrder;
}

function queuedStepsForOrder(order) {
  return order.map(k => ({
    id: k,
    key: k,
    name: TOOL_CATALOG[k]?.name || k,
    status: "queued",
    outputs: [],
  }));
}

function inferRunningKeyFromMessage(message) {
  const raw = String(message || "").trim().toLowerCase();
  if (!raw) return "";
  const m = raw.match(/running:\s*([a-z0-9_.-]+)/i);
  if (!m) return "";
  return m[1].replace(/[.\-\s]+/g, "_");
}

function isFinalizingMessage(message) {
  const raw = String(message || "").trim().toLowerCase();
  return /\b(finalizing|organizing reports|uploading result|uploading output|uploading logs)\b/.test(raw);
}

/* ========================
   Helpers
   ======================== */
function planParts(file, chunk = CHUNK_SIZE) {
  const parts = [];
  let off = 0,
    pn = 1;
  while (off < file.size) {
    const end = Math.min(off + chunk, file.size);
    parts.push({ partNumber: pn++, start: off, end, size: end - off });
    off = end;
  }
  return parts;
}

function readUploadDraft() {
  try {
    const parsed = JSON.parse(localStorage.getItem(UPLOAD_DRAFT_KEY) || "null");
    return parsed?.version === UPLOAD_DRAFT_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

function writeUploadDraft(draft) {
  if (!draft) return;
  localStorage.setItem(
    UPLOAD_DRAFT_KEY,
    JSON.stringify({ ...draft, version: UPLOAD_DRAFT_VERSION, updatedAt: Date.now() })
  );
}

function clearStoredUploadDraft() {
  try {
    localStorage.removeItem(UPLOAD_DRAFT_KEY);
  } catch {
    // Browser storage is optional; the active in-memory upload still works.
  }
}

async function sampledFileFingerprint(file) {
  if (!file || isReusableUpload(file)) return "";
  if (!globalThis.crypto?.subtle) {
    return `metadata:${file.size}:${Number(file.lastModified || 0)}`;
  }
  const sampleSize = 1024 * 1024;
  const head = new Uint8Array(await file.slice(0, Math.min(sampleSize, file.size)).arrayBuffer());
  const tailStart = Math.max(0, file.size - sampleSize);
  const tail = new Uint8Array(await file.slice(tailStart, file.size).arrayBuffer());
  const metadata = new TextEncoder().encode(`${file.size}\0${file.type || ""}`);
  const sampled = new Uint8Array(metadata.length + head.length + tail.length);
  sampled.set(metadata, 0);
  sampled.set(head, metadata.length);
  sampled.set(tail, metadata.length + head.length);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", sampled));
  return `sha256-sampled:${Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function describeUploadFile(file) {
  if (!file) return null;
  return {
    name: file.name || "",
    size: Number(file.size || 0),
    type: file.type || "FASTQ",
    lastModified: Number(file.lastModified || 0),
    reusable: isReusableUpload(file),
    key: file.key || "",
    sourceJobId: file.sourceJobId || "",
    fingerprint: await sampledFileFingerprint(file),
    done: isReusableUpload(file) ? Number(file.size || 0) : 0,
    session: null,
  };
}

function fileFromDraft(descriptor) {
  if (!descriptor) return null;
  if (descriptor.reusable && descriptor.key) {
    return {
      name: descriptor.name,
      size: Number(descriptor.size || 0),
      type: descriptor.type || "FASTQ",
      key: descriptor.key,
      reusable: true,
      sourceJobId: descriptor.sourceJobId || "",
    };
  }
  if (descriptor.session?.completed) {
    return {
      name: descriptor.name,
      size: Number(descriptor.size || 0),
      type: descriptor.type || "FASTQ",
      resumableCompleted: true,
    };
  }
  if (descriptor.name) {
    return {
      name: descriptor.name,
      size: Number(descriptor.size || 0),
      type: descriptor.type || "FASTQ",
      isDraftDummy: true,
    };
  }
  return null;
}

function fmtBytes(n) {
  if (n == null) return "-";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0,
    v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 2 : 0)} ${u[i]}`;
}

function fmtSpeed(bps) {
  if (!bps || !Number.isFinite(bps) || bps <= 0) return "—";
  const u = ["B/s", "KB/s", "MB/s", "GB/s"];
  let i = 0;
  let v = bps;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 2 : 0)} ${u[i]}`;
}

function fmtEta(seconds) {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

const pct = (done, total) =>
  total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

function isReusableUpload(file) {
  return Boolean(file?.reusable && file?.key);
}

function fileDisplayName(file, fallback = "Choose FASTQ file") {
  return file?.name || fallback;
}

function fileDisplayMeta(file, fallback = ".fastq / .fq / .gz") {
  if (!file) return fallback;
  if (file.isDraftDummy) {
    return (
      <span className="text-rose-600 font-semibold">
        {fallback} ({fmtBytes(file.size)})
      </span>
    );
  }
  const sizeLabel = file.size ? fmtBytes(file.size) : "stored in MinIO";
  return isReusableUpload(file) ? `${sizeLabel} · reused` : sizeLabel;
}

function formatReusableDate(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fileForReusableRole(item, role, keyName) {
  const key = item?.[keyName];
  if (!key) return null;
  const files = Array.isArray(item?.files) ? item.files : [];
  const normalizedRole = role.toLowerCase();
  const match = files.find(fileItem => {
    const fileRole = String(fileItem?.role || "").trim().toLowerCase();
    return fileItem?.key === key || fileRole === normalizedRole;
  });
  return {
    name: match?.name || key.split("/").pop() || role,
    size: Number(match?.size || 0),
    type: match?.type || "FASTQ",
    key,
    reusable: true,
    sourceJobId: item.job_id,
    sourceSample: item.sample,
    uploadedAt: item.created_at,
  };
}

function reusableFilesForRun(item, readMode) {
  const r1Role = readMode === "long" ? "Long reads" : "R1";
  return {
    r1: fileForReusableRole(item, r1Role, "r1_key"),
    r2: readMode === "long" ? null : fileForReusableRole(item, "R2", "r2_key"),
    rLong: readMode === "hybrid" ? fileForReusableRole(item, "Long reads", "r_long_key") : null,
  };
}

/* Normalize ANY backend status to one of: done | running | failed | cancelled | skipped | queued */
function normalizeStatus(s) {
  const x = String(s || "").toLowerCase();
  if (/(success|complete|completed|done|ok|finished)/.test(x)) return "done";
  if (/(cancelled|canceled|cancel)/.test(x)) return "cancelled";
  if (/(run|running|active|in[_-]?progress|working)/.test(x)) return "running";
  if (/(fail|error|crash|aborted)/.test(x)) return "failed";
  if (/(skip|skipped)/.test(x)) return "skipped";
  if (/(queue|queued|pending|waiting)/.test(x)) return "queued";
  return "queued";
}

function isStaleJobError(error) {
  const msg = String(error?.message || error || "");
  return (
    /\b(403|404)\b/.test(msg) ||
    /job not found|not authorized|forbidden|no active rq job/i.test(msg)
  );
}

function statusColors(s) {
  switch (s) {
    case "done":
      return {
        cls: "bg-emerald-500 text-white ring-emerald-300",
        dot: "bg-white",
        glow: "shadow-[0_0_0_8px_rgba(16,185,129,0.15)]",
      };
    case "running":
      return {
        cls: "bg-sky-600 text-white ring-sky-300",
        dot: "bg-white",
        glow: "shadow-[0_0_0_10px_rgba(2,132,199,0.18)]",
      };
    case "failed":
      return {
        cls: "bg-rose-600 text-white ring-rose-300",
        dot: "bg-white",
        glow: "shadow-[0_0_0_10px_rgba(244,63,94,0.18)]",
      };
    case "cancelled":
      return {
        cls: "bg-slate-600 text-white ring-slate-300",
        dot: "bg-white",
        glow: "",
      };
    case "skipped":
      return {
        cls: "bg-slate-300 text-slate-800 ring-slate-200",
        dot: "bg-slate-700",
        glow: "",
      };
    default:
      return {
        cls: "bg-slate-200 text-slate-700 ring-slate-300",
        dot: "bg-slate-700",
        glow: "",
      };
  }
}

/* Build a full, ordered step list by merging defaults + backend + previous state */
function makeOrderedSteps(prevSteps, backendSteps, order) {
  const prevMap = Object.fromEntries((prevSteps || []).map(s => [s.key, s]));
  const backMap = Object.fromEntries((backendSteps || []).map(s => [s.key, s]));

  const ordered = order.map(key => {
    const fromBack = backMap[key];
    const base =
      fromBack ||
      prevMap[key] || {
        id: key,
        key,
        name: TOOL_CATALOG[key]?.name || key,
        status: "queued",
        outputs: [],
      };
    return {
      ...base,
      id: base.id || key,
      key,
      name: base.name || TOOL_CATALOG[key]?.name || key,
      status: normalizeStatus(base.status || "queued"),
      summary: base.summary || TOOL_CATALOG[key]?.desc,
      outputs: Array.isArray(base.outputs) ? base.outputs : [],
      progress: base.progress && typeof base.progress === "object" ? base.progress : null,
    };
  });

  // Append any backend steps not in default order (rare)
  Object.keys(backMap).forEach(key => {
    if (!order.includes(key)) {
      const b = backMap[key];
      const status = normalizeStatus(b.status);
      const hasSignal =
        status !== "queued" ||
        (Array.isArray(b.outputs) && b.outputs.length > 0) ||
        Boolean(b.summary);
      if (!hasSignal) return;
      ordered.push({
        id: b.id || key,
        key,
        name: b.name || b.key || key,
        status,
        summary: b.summary,
        outputs: Array.isArray(b.outputs) ? b.outputs : [],
        progress: b.progress && typeof b.progress === "object" ? b.progress : null,
      });
    }
  });

  return ordered;
}

/* Parse backend shape into normalized step list */
function deriveStepsFromStatus(s, order) {
  const overallState = normalizeStatus(s?.state || s?.rail?.state || "queued");
  const src = Array.isArray(s?.rail?.steps)
    ? s.rail.steps
    : Array.isArray(s?.steps)
      ? s.steps
      : [];

  const fromBackend = src.map(st => {
    const key = st.key || (st.name || "").toLowerCase().replace(/\s+/g, "_");
    return {
      id: st.id || key,
      key,
      name: st.name || TOOL_CATALOG[key]?.name || key,
      status: normalizeStatus(st.status || s?.state),
      summary: st.summary || "",
      outputs: Array.isArray(st.outputs) ? st.outputs : [],
      progress: st.progress && typeof st.progress === "object" ? st.progress : null,
    };
  });

  // If backend provided nothing, synthesize from high-level counters
  if (!fromBackend.length) {
    const isTerminal = ["done", "failed", "cancelled"].includes(overallState);
    const doneCount = Math.min(
      Number.isFinite(s?.completed) ? s.completed : 0,
      order.length
    );
    return order.map((key, idx) => {
      let status = "queued";
      if (idx < doneCount) status = "done";
      else if (idx === doneCount && !isTerminal)
        status = "running";
      if (overallState === "failed" && idx === doneCount) status = "failed";
      if (overallState === "cancelled" && idx === doneCount) status = "cancelled";
      return {
        id: key,
        key,
        name: TOOL_CATALOG[key]?.name || key,
        status,
        summary: TOOL_CATALOG[key]?.desc,
        outputs: [],
      };
    });
  }

  // Reconcile stale rail payloads: status can be "running" while rail steps lag.
  if (overallState === "running" && !isFinalizingMessage(s?.message || s?.rail?.message)) {
    const hasRunning = fromBackend.some(st => normalizeStatus(st.status) === "running");
    if (!hasRunning) {
      const hintedKey = inferRunningKeyFromMessage(s?.message || s?.rail?.message);
      let targetKey = "";

      if (hintedKey && fromBackend.some(st => st.key === hintedKey)) {
        targetKey = hintedKey;
      } else if (hintedKey && order.includes(hintedKey)) {
        targetKey = hintedKey;
      } else {
        const firstQueued = fromBackend.find(
          st => order.includes(st.key) && normalizeStatus(st.status) === "queued"
        );
        if (firstQueued) targetKey = firstQueued.key;
      }

      if (!targetKey && Number.isFinite(s?.completed) && order.length > 0) {
        const idx = Math.min(Math.max(0, s.completed), order.length - 1);
        targetKey = order[idx];
      }

      if (targetKey) {
        return fromBackend.map(st =>
          st.key === targetKey && normalizeStatus(st.status) !== "failed"
            ? { ...st, status: "running" }
            : st
        );
      }
    }
  }

  return fromBackend;
}

/* Guess which step a file belongs to for the Outputs section */
function expectedPatternToRegex(pat) {
  const escaped = String(pat || "")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/<sample>/gi, "[^/]+")
    .replace(/\\\*/g, "[^/]*");
  return new RegExp(escaped, "i");
}

const EXPECTED_REGEX = Object.fromEntries(
  Object.entries(TOOL_CATALOG).map(([key, cfg]) => [
    key,
    (cfg?.expected || []).map(expectedPatternToRegex),
  ])
);

function belongsTo(stepKey, fileKey) {
  const k = `/${stepKey}`.toLowerCase();
  const f = `/${(fileKey || "").toLowerCase()}`;
  const expected = EXPECTED_REGEX[stepKey] || [];
  for (const re of expected) {
    if (re.test(f)) return true;
  }
  return (
    f.includes(`${k}/`) ||
    f.includes(`${k}-`) ||
    f.includes(`${k}_`) ||
    f.includes(`${k}.`)
  );
}

/* ========================
   Multipart upload
   ======================== */
async function uploadFileMultipart({
  file,
  jobId,
  jobAccessKey,
  fingerprint,
  resumeSession,
  onSession,
  onProgress,
  signal,
}) {
  let uploadId = String(resumeSession?.uploadId || "");
  let key = String(resumeSession?.key || "");
  let partSize = Number(resumeSession?.partSize || CHUNK_SIZE);
  let serverParts = [];

  if (uploadId && key) {
    const status = await apiJson(`/uploads/multipart/status`, {
      method: "POST",
      jobAccessKey,
      signal,
      body: JSON.stringify({ key, uploadId }),
    });
    if (Number(status.size || 0) !== Number(file.size || 0) || status.filename !== file.name) {
      throw new Error(`The selected file does not match the interrupted upload: ${file.name}`);
    }
    if (status.fingerprint && fingerprint && status.fingerprint !== fingerprint) {
      throw new Error(`The selected file content does not match the interrupted upload: ${file.name}`);
    }
    if (status.state === "completed") {
      onProgress?.(file.size, file.size);
      onSession?.({ uploadId, key, partSize: Number(status.part_size || partSize), completed: true });
      return { key, resumed: true };
    }
    partSize = Number(status.part_size || partSize);
    serverParts = Array.isArray(status.parts) ? status.parts : [];
  } else {
    const created = await apiJson(`/uploads/multipart/create`, {
      method: "POST",
      jobAccessKey,
      signal,
      body: JSON.stringify({
        filename: file.name,
        job_id: jobId,
        size: file.size,
        part_size: partSize,
        fingerprint: fingerprint || "",
      }),
    });
    uploadId = created.uploadId;
    key = created.key;
  }

  onSession?.({ uploadId, key, partSize, completed: false });
  const parts = planParts(file, partSize);
  const completedByNumber = new Map();
  for (const item of serverParts) {
    const partNumber = Number(item.PartNumber || 0);
    const planned = parts[partNumber - 1];
    if (
      planned &&
      Number(item.Size || 0) === planned.size &&
      String(item.ETag || "")
    ) {
      completedByNumber.set(partNumber, {
        ETag: String(item.ETag),
        PartNumber: partNumber,
      });
    }
  }

  let uploadedBytes = parts.reduce(
    (sum, part) => sum + (completedByNumber.has(part.partNumber) ? part.size : 0),
    0
  );
  onProgress?.(uploadedBytes, file.size);
  const missingParts = parts.filter(part => !completedByNumber.has(part.partNumber));
  let urlMap = {};
  if (missingParts.length) {
    const signed = await apiJson(`/uploads/multipart/sign`, {
      method: "POST",
      jobAccessKey,
      signal,
      body: JSON.stringify({
        key,
        uploadId,
        parts: missingParts.map(part => part.partNumber),
      }),
    });
    urlMap = signed.urls || {};
  }

  let cursor = 0;
  async function uploadPartWithRetry(part) {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (signal?.aborted) throw new DOMException("Upload aborted", "AbortError");
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await new Promise((resolve, reject) => {
          const online = () => {
            cleanup();
            resolve();
          };
          const aborted = () => {
            cleanup();
            reject(new DOMException("Upload aborted", "AbortError"));
          };
          const cleanup = () => {
            window.removeEventListener("online", online);
            signal?.removeEventListener("abort", aborted);
          };
          window.addEventListener("online", online, { once: true });
          signal?.addEventListener("abort", aborted, { once: true });
        });
      }
      try {
        const response = await fetch(urlMap[String(part.partNumber)], {
          method: "PUT",
          body: file.slice(part.start, part.end),
          signal,
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          throw new Error(
            `Part ${part.partNumber} failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ""}`
          );
        }
        const ETag = response.headers.get("ETag") || response.headers.get("etag");
        if (!ETag) throw new Error(`Part ${part.partNumber} did not return an ETag`);
        return { ETag, PartNumber: part.partNumber };
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        lastError = error;
        if (attempt < 3) {
          await new Promise(resolve => window.setTimeout(resolve, attempt * 1000));
        }
      }
    }
    throw lastError || new Error(`Part ${part.partNumber} could not be uploaded`);
  }

  async function next() {
    while (cursor < missingParts.length) {
      const part = missingParts[cursor++];
      const completedPart = await uploadPartWithRetry(part);
      completedByNumber.set(part.partNumber, completedPart);
      uploadedBytes += part.size;
      onProgress?.(uploadedBytes, file.size);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, missingParts.length) }, () => next())
  );

  const completed = parts.map(part => completedByNumber.get(part.partNumber)).filter(Boolean);
  if (completed.length !== parts.length) throw new Error("Multipart upload is incomplete");

  await apiJson(`/uploads/multipart/complete`, {
    method: "POST",
    jobAccessKey,
    signal,
    body: JSON.stringify({ key, uploadId, parts: completed }),
  });
  onSession?.({ uploadId, key, partSize, completed: true });
  return { key, resumed: Boolean(resumeSession) };
}


/* ========================
   UI bits
   ======================== */
const Icon = {
  done: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      className="shrink-0"
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"
      />
    </svg>
  ),
  failed: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      className="shrink-0"
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M12 2 2 22h20L12 2zm1 15h-2v-2h2v2zm0-4h-2v-4h2v4z"
      />
    </svg>
  ),
  running: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      className="animate-spin shrink-0"
      aria-hidden
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
        fill="none"
        opacity="0.25"
      />
      <path
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
      />
    </svg>
  ),
  skipped: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      className="shrink-0"
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M5 3h14v2H5zm0 16h14v2H5zM5 7h10v2H5zm0 4h8v2H5zm0 4h6v2H5z"
      />
    </svg>
  ),
  cancelled: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      className="shrink-0"
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M6 6h12v12H6z"
      />
    </svg>
  ),
  queued: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      className="shrink-0"
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M12 6v6l4 2-0.75 1.86L10 14V6h2z"
      />
    </svg>
  ),
};

function StatusBadge({ status }) {
  const s = statusColors(status);
  const ico =
    status === "done"
      ? Icon.done
      : status === "failed"
        ? Icon.failed
        : status === "cancelled"
          ? Icon.cancelled
          : status === "running"
            ? Icon.running
            : status === "skipped"
              ? Icon.skipped
              : Icon.queued;
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded ring-1 ${s.cls}`}
    >
      {ico}
      <span className="capitalize">{status}</span>
    </span>
  );
}

function statusDotClass(status) {
  switch (status) {
    case "done":
      return "bg-emerald-500";
    case "running":
      return "bg-sky-500 animate-pulse";
    case "failed":
      return "bg-rose-500";
    case "cancelled":
      return "bg-slate-500";
    case "skipped":
      return "bg-slate-400";
    default:
      return "bg-slate-300";
  }
}

function StepPill({ step, index, isCurrent, onClick, innerRef }) {
  const s = statusColors(step.status);
  const progressPercent =
    step.progress && Number.isFinite(Number(step.progress.percent))
      ? Math.max(0, Math.min(100, Number(step.progress.percent)))
      : null;
  return (
    <Motion.button
      ref={innerRef}
      onClick={onClick}
      title={step.name}
      data-status={normalizeStatus(step.status)}
      className={`genocular-step-pill shrink-0 rounded-2xl px-3.5 py-2 ring-1 ${s.cls} select-none relative`}
      initial={false}
      animate={{
        scale: isCurrent ? 1.06 : 1.0,
        boxShadow: isCurrent ? s.glow : "0 0 0 rgba(0,0,0,0)",
      }}
      transition={{ type: "spring", stiffness: 320, damping: 22 }}
    >
      <div className="flex items-center gap-2">
        <span className={`inline-block w-2 h-2 rounded-full ${s.dot}`} />
        <span className="font-medium text-xs md:text-sm">
          {index + 1}. {step.name}
        </span>
        {normalizeStatus(step.status) === "running" && progressPercent !== null && (
          <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold">
            {Math.round(progressPercent)}%
          </span>
        )}
      </div>
      {step.status === "running" && (
        <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-sky-400 animate-ping" />
      )}
    </Motion.button>
  );
}

function PipelineRail({ steps, currentId, onSelect }) {
  const stepRefs = useRef({});
  const stepsStatusKey = steps.map(step => `${step.id}:${step.status}`).join(",");

  useEffect(() => {
    const el = stepRefs.current[currentId];
    el?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [currentId, stepsStatusKey]);

  return (
    <div className="relative">
      <div className="genocular-pipeline-rail flex items-center gap-3 overflow-x-auto no-scrollbar p-3 rounded-2xl border bg-white/80 backdrop-blur">
        {steps.map((s, i) => (
          <React.Fragment key={s.id}>
            <StepPill
              step={s}
              index={i}
              isCurrent={s.id === currentId}
              onClick={() => onSelect(s.id)}
              innerRef={node => {
                stepRefs.current[s.id] = node;
              }}
            />
            {i < steps.length - 1 && (
              <div
                data-status={normalizeStatus(s.status)}
                className="genocular-rail-connector h-1 w-10 md:w-14 rounded-full bg-gradient-to-r from-slate-200 to-slate-300"
              />
            )}
          </React.Fragment>
        ))}
      </div>
      <div className="genocular-flow-legend px-1 pt-2 text-xs text-slate-500 flex items-center gap-3 flex-wrap">
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />{" "}
          Done
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-sky-600 inline-block" />{" "}
          Running
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-rose-600 inline-block" />{" "}
          Failed
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-slate-400 inline-block" />{" "}
          Skipped
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-slate-300 inline-block" />{" "}
          Queued
        </span>
      </div>
    </div>
  );
}

function connectorClasses(status) {
  switch (status) {
    case "done":
      return { line: "bg-emerald-300", arrow: "border-l-emerald-300" };
    case "running":
      return { line: "bg-sky-300", arrow: "border-l-sky-300" };
    case "failed":
      return { line: "bg-rose-300", arrow: "border-l-rose-300" };
    case "skipped":
      return { line: "bg-slate-300", arrow: "border-l-slate-300" };
    default:
      return { line: "bg-slate-200", arrow: "border-l-slate-200" };
  }
}

function PipelineNode({
  node,
  depth,
  isLast,
  stepsByKey,
  stepIndexByKey,
  selectedId,
  currentId,
  onSelect,
}) {
  const fallback = {
    id: node.key,
    key: node.key,
    name: TOOL_CATALOG[node.key]?.name || node.key,
    status: "queued",
  };
  const step = stepsByKey.get(node.key) || fallback;
  const status = normalizeStatus(step.status || "queued");
  const label = step.name || TOOL_CATALOG[node.key]?.name || node.key;
  const description = TOOL_CATALOG[node.key]?.desc || step.summary || "";
  const isSelected = selectedId === step.id || selectedId === step.key;
  const isRunningNode = currentId === step.id || currentId === step.key || status === "running";
  const connector = connectorClasses(status);
  const dot = statusDotClass(status);
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const stepIndex = stepIndexByKey.get(node.key);

  return (
    <li className={`genocular-flow-item relative ${depth > 0 ? "pl-6" : ""}`}>
      {depth > 0 && (
        <>
          <span
            data-status={status}
            className={`genocular-tree-connector absolute left-2 top-0 w-px ${connector.line} ${isLast ? "h-3" : "h-full"}`}
          />
          <span data-status={status} className={`genocular-tree-connector absolute left-2 top-3 h-px w-3 ${connector.line}`} />
          <span
            data-status={status}
            className={`genocular-tree-arrow absolute left-4 top-2 w-0 h-0 border-y-[4px] border-y-transparent border-l-[6px] ${connector.arrow}`}
          />
        </>
      )}
      <button
        type="button"
        onClick={() => onSelect(step.id || step.key)}
        className={[
          "genocular-flow-node group relative inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition shadow-sm",
          isSelected
            ? "border-sky-300 bg-sky-50 shadow-[0_0_0_3px_rgba(14,165,233,0.15)]"
            : isRunningNode
              ? "border-sky-300 bg-sky-50/70 shadow-[0_0_0_3px_rgba(14,165,233,0.15)]"
              : "border-slate-200 bg-white hover:bg-slate-50",
        ].join(" ")}
        data-status={status}
        data-selected={isSelected ? "true" : "false"}
      >
        <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
        {stepIndex ? (
          <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
            {stepIndex}
          </span>
        ) : null}
        <span className="genocular-flow-label font-medium text-slate-800">{label}</span>
        <span className="text-[10px] text-slate-500 capitalize tracking-wide">{status}</span>
        {isRunningNode && (
          <span className="h-2 w-2 rounded-full bg-sky-500 animate-pulse" />
        )}
        {description && (
          <span
            className="genocular-flow-tooltip pointer-events-none absolute left-full top-1/2 z-50 ml-3 w-64 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white px-3.5 py-3 text-left text-xs leading-relaxed text-slate-700 opacity-0 shadow-2xl shadow-slate-900/15 ring-1 ring-black/5 transition duration-150 group-hover:translate-x-1 group-hover:opacity-100 group-focus-visible:translate-x-1 group-focus-visible:opacity-100"
            role="tooltip"
          >
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {label}
            </span>
            <span className="mt-1 block">{description}</span>
          </span>
        )}
      </button>
      {hasChildren && (
        <ul className="genocular-flow-children mt-3 ml-4 pl-4 space-y-2 border-l border-slate-200/90">
          {node.children.map((child, idx) => (
            <PipelineNode
              key={child.key}
              node={child}
              depth={depth + 1}
              isLast={idx === node.children.length - 1}
              stepsByKey={stepsByKey}
              stepIndexByKey={stepIndexByKey}
              selectedId={selectedId}
              currentId={currentId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function PipelineTree({ tree, stepsByKey, stepIndexByKey, selectedId, currentId, onSelect }) {
  return (
    <div className="genocular-pipeline-flow rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-white p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] uppercase tracking-wide text-slate-500">
          Pipeline Flow
        </div>
      </div>
      <ul className="space-y-2.5">
        {tree.map((node, idx) => (
          <PipelineNode
            key={node.key}
            node={node}
            depth={0}
            isLast={idx === tree.length - 1}
            stepsByKey={stepsByKey}
            stepIndexByKey={stepIndexByKey}
            selectedId={selectedId}
            currentId={currentId}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </div>
  );
}

function ToolDetails({ step }) {
  const cat = TOOL_CATALOG[step.key] || {};
  const desc = step.summary || cat.desc || "—";
  const progress = step.progress && typeof step.progress === "object" ? step.progress : null;
  const progressPercent =
    progress && Number.isFinite(Number(progress.percent))
      ? Math.max(0, Math.min(100, Number(progress.percent)))
      : null;
  const progressMessage = progress?.message || progress?.detail || "";

  return (
    <Motion.div
      key={step.id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="genocular-tool-details rounded-2xl border bg-white p-4 shadow-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <StatusBadge status={step.status} />
          <h3 className="text-lg font-semibold">{step.name}</h3>
        </div>
        <code className="text-xs text-slate-500">{step.key}</code>
      </div>

      <p className="mt-2 text-sm text-slate-700">{desc}</p>

      {progress && (progressPercent !== null || progressMessage) && (
        <div className="genocular-tool-progress mt-3 rounded-2xl border border-sky-100 bg-sky-50/70 p-3">
          <div className="flex items-center justify-between gap-3 text-xs font-semibold text-sky-800">
            <span>Live tool progress</span>
            {progressPercent !== null && <span>{Math.round(progressPercent)}%</span>}
          </div>
          {progressPercent !== null && (
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/80 shadow-inner">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-500 via-cyan-500 to-teal-500 transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          )}
          {progressMessage && (
            <p className="mt-2 break-words text-xs text-slate-700">{progressMessage}</p>
          )}
          {progress?.updatedAt && (
            <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">
              Updated {progress.updatedAt}
            </p>
          )}
        </div>
      )}

      {Array.isArray(step.outputs) && step.outputs.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold text-slate-600 mb-1">
            This job’s outputs
          </div>
          <ul className="text-sm list-disc pl-5">
            {step.outputs.map(o => (
              <li key={o.key}>
                <a
                  className="text-sky-600 hover:underline break-all"
                  href={o.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {o.label || o.key}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Motion.div>
  );
}

/* ========================
   Page
   ======================== */
export default function UploadAndRun() {
  const navigate = useNavigate();
  const { user: accountUser } = useAuth();
  const [searchParams] = useSearchParams();
  const requestedJobId = String(searchParams.get("job_id") || "").trim();
  const requestedDemoProfile = String(searchParams.get("demo_profile") || "")
    .trim()
    .toLowerCase();
  const guidedTour = useGuidedTour();
  const [analysisType, setAnalysisType] = useState("wgs");
  const [readMode, setReadMode] = useState("short");
  const [sampleId, setSampleId] = useState(() => defaultJobName("wgs", "short"));
  const [metaShortConfig, setMetaShortConfig] = useState(() => defaultMetaShortConfig());
  const selectedProfileKey = useMemo(
    () => profileKey(analysisType, readMode),
    [analysisType, readMode]
  );
  const [activeProfileKey, setActiveProfileKey] = useState("");
  const activeOrder = useMemo(
    () => getOrderForProfileKey(activeProfileKey) || getProfileOrder(analysisType, readMode),
    [activeProfileKey, analysisType, readMode]
  );
  const [fileR1, setFileR1] = useState(null);
  const [fileR2, setFileR2] = useState(null);
  const [fileRLong, setFileRLong] = useState(null);
  const [reusableUploads, setReusableUploads] = useState([]);
  const [reusableLoading, setReusableLoading] = useState(false);
  const [reusableError, setReusableError] = useState("");
  const [reusableRetentionDays, setReusableRetentionDays] = useState(7);
  const [uploadDraft, setUploadDraft] = useState(() => readUploadDraft());

  const [status, setStatus] = useState("idle"); // idle | uploading | paused | submitting | polling | done | error
  const [jobId, setJobId] = useState("");
  const [jobAccessExpiresAt, setJobAccessExpiresAt] = useState("");
  const [jobAccessScope, setJobAccessScope] = useState("");
  const [notificationEmail, setNotificationEmail] = useState("");
  const [privateLinkCopied, setPrivateLinkCopied] = useState(false);
  const [showPrivateLink, setShowPrivateLink] = useState(false);
  const [recoveryPromptJobId, setRecoveryPromptJobId] = useState("");
  const [viewerLinkUrl, setViewerLinkUrl] = useState("");
  const [viewerLinkStatus, setViewerLinkStatus] = useState("");
  const [error, setError] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);

  // progress
  const [r1Progress, setR1] = useState({ done: 0, total: 0 });
  const [r2Progress, setR2] = useState({ done: 0, total: 0 });
  const [rLongProgress, setRLong] = useState({ done: 0, total: 0 });
  const [r1Speed, setR1Speed] = useState(0);
  const [r2Speed, setR2Speed] = useState(0);
  const [rLongSpeed, setRLongSpeed] = useState(0);
  const [r1Eta, setR1Eta] = useState(null);
  const [r2Eta, setR2Eta] = useState(null);
  const [rLongEta, setRLongEta] = useState(null);
  const r1StatRef = useRef({ ts: 0, done: 0 });
  const r2StatRef = useRef({ ts: 0, done: 0 });
  const rLongStatRef = useRef({ ts: 0, done: 0 });

  // results + status polling
  const [results, setResults] = useState([]);
  const [jobState, setJobState] = useState("queued");
  const [jobCompleted, setJC] = useState(0);
  const [jobTotal, setJT] = useState(0);
  const [jobMsg, setJM] = useState("");
  const [queuePosition, setQueuePosition] = useState(null);
  const [queueDepth, setQueueDepth] = useState(null);
  const [queuedAhead, setQueuedAhead] = useState(null);
  const [expandedResults, setExpandedResults] = useState({});

  const [steps, setSteps] = useState(queuedStepsForOrder(activeOrder));
  const [selectedStepId, setSelectedStepId] = useState(steps[0]?.id);

  const pollTimer = useRef(null);
  const statusTimer = useRef(null);
  const stepsTimer = useRef(null);
  const restoredJobRef = useRef("");
  const demoRequestRef = useRef("");

  const saveUploadDraft = useCallback((nextDraft) => {
    const normalized = {
      ...nextDraft,
      version: UPLOAD_DRAFT_VERSION,
      updatedAt: Date.now(),
    };
    setUploadDraft(normalized);
    try {
      writeUploadDraft(normalized);
    } catch {
      // The server-side multipart session still protects completed chunks.
    }
    return normalized;
  }, []);

  const updateUploadDraftFile = useCallback((draft, role, patch) => {
    const nextDraft = {
      ...draft,
      files: {
        ...(draft?.files || {}),
        [role]: {
          ...(draft?.files?.[role] || {}),
          ...patch,
        },
      },
    };
    return saveUploadDraft(nextDraft);
  }, [saveUploadDraft]);

  const clearUploadDraft = useCallback(() => {
    setUploadDraft(null);
    clearStoredUploadDraft();
  }, []);

  const clearTimers = () => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    if (statusTimer.current) clearInterval(statusTimer.current);
    if (stepsTimer.current) clearInterval(stepsTimer.current);
    pollTimer.current = null;
    statusTimer.current = null;
    stepsTimer.current = null;
  };

  const applyUploadSnapshot = useCallback((snapshot) => {
    if (!snapshot) return;
    if (snapshot.sampleId) setSampleId(snapshot.sampleId);
    if (snapshot.analysisType) setAnalysisType(snapshot.analysisType);
    if (snapshot.readMode) setReadMode(snapshot.readMode);
    if (snapshot.profileKey) setActiveProfileKey(snapshot.profileKey);
    if (snapshot.status) setStatus(snapshot.status);
    if (snapshot.error) setError(snapshot.error);
    setR1(snapshot.r1Progress || { done: 0, total: 0 });
    setR2(snapshot.r2Progress || { done: 0, total: 0 });
    setRLong(snapshot.rLongProgress || { done: 0, total: 0 });
  }, []);

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, []);

  const needsR2 = readMode !== "long";
  const needsRLong = readMode === "hybrid";
  const isMetagenomics = analysisType === "metagenomics";

  const isGuidedStep = useCallback(
    step => guidedTour.active && guidedTour.step === step,
    [guidedTour.active, guidedTour.step]
  );
  const tourTargetClass = useCallback(
    step =>
      isGuidedStep(step)
        ? "guided-tour-target guided-tour-target-active"
        : "guided-tour-target",
    [isGuidedStep]
  );

  const readModeIndex = Math.max(
    0,
    READ_MODES.findIndex(mode => mode.key === readMode)
  );
  const hasAnySelectedFile = Boolean(fileR1 || fileR2 || fileRLong);
  const hasRequiredFiles = Boolean(
    fileR1 && (!needsR2 || fileR2) && (!needsRLong || fileRLong)
  );
  const setupStageIndex = jobId ? 4 : hasRequiredFiles ? 3 : hasAnySelectedFile ? 2 : 1;
  const uploadGridColsClass =
    readMode === "hybrid"
      ? "grid gap-5 md:grid-cols-2 xl:grid-cols-3"
      : readMode === "long"
        ? "grid gap-5 md:grid-cols-1 max-w-2xl w-full mx-auto"
        : "grid gap-5 md:grid-cols-2";
  const isBusy = status === "uploading" || status === "submitting" || status === "polling";
  const hasInterruptedUpload = Boolean(
    uploadDraft?.jobId && uploadDraft.jobId === jobId && status === "paused"
  );
  const draftFiles = uploadDraft?.files || {};
  const matchesDraftDescriptor = (file, descriptor) =>
    Boolean(
      file &&
      !file.isDraftDummy &&
      descriptor &&
      file.name === descriptor.name &&
      Number(file.size || 0) === Number(descriptor.size || 0)
    );
  const canResumeUpload = Boolean(
    hasInterruptedUpload &&
    matchesDraftDescriptor(fileR1, draftFiles.r1) &&
    (!needsR2 || matchesDraftDescriptor(fileR2, draftFiles.r2)) &&
    (!needsRLong || matchesDraftDescriptor(fileRLong, draftFiles.rLong))
  );
  const reusableChoices = useMemo(
    () =>
      reusableUploads
        .map(item => ({ item, files: reusableFilesForRun(item, readMode) }))
        .filter(choice =>
          choice.files.r1 &&
          (!needsR2 || choice.files.r2) &&
          (!needsRLong || choice.files.rLong)
        ),
    [reusableUploads, readMode, needsR2, needsRLong]
  );
  const usingReusableUpload = [fileR1, fileR2, fileRLong].some(isReusableUpload);

  function resetUploadInputs() {
    setFileR1(null);
    setFileR2(null);
    setFileRLong(null);
    setR1({ done: 0, total: 0 });
    setR2({ done: 0, total: 0 });
    setRLong({ done: 0, total: 0 });
    setR1Speed(0);
    setR2Speed(0);
    setRLongSpeed(0);
    setR1Eta(null);
    setR2Eta(null);
    setRLongEta(null);
    r1StatRef.current = { ts: 0, done: 0 };
    r2StatRef.current = { ts: 0, done: 0 };
    rLongStatRef.current = { ts: 0, done: 0 };
  }

  function applyReusableUpload(item) {
    const files = reusableFilesForRun(item, readMode);
    if (!files.r1 || (needsR2 && !files.r2) || (needsRLong && !files.rLong)) return;

    setFileR1(files.r1);
    setFileR2(files.r2);
    setFileRLong(files.rLong);
    setR1({ done: files.r1.size || 0, total: files.r1.size || 0 });
    setR2({ done: files.r2?.size || 0, total: files.r2?.size || 0 });
    setRLong({ done: files.rLong?.size || 0, total: files.rLong?.size || 0 });
    setR1Speed(0);
    setR2Speed(0);
    setRLongSpeed(0);
    setR1Eta(null);
    setR2Eta(null);
    setRLongEta(null);
    if (shouldReplaceDefaultJobName(sampleId) && item.sample) {
      setSampleId(item.sample);
    }
  }

  function handleR1FileChange(nextFile) {
    setFileR1(nextFile);
    setR1({ done: 0, total: nextFile?.size || 0 });
    setR1Speed(0);
    setR1Eta(null);
  }

  function handleR2FileChange(nextFile) {
    setFileR2(nextFile);
    setR2({ done: 0, total: nextFile?.size || 0 });
    setR2Speed(0);
    setR2Eta(null);
  }

  function handleRLongFileChange(nextFile) {
    setFileRLong(nextFile);
    setRLong({ done: 0, total: nextFile?.size || 0 });
    setRLongSpeed(0);
    setRLongEta(null);
  }

  function resetMetaShortConfig() {
    setMetaShortConfig(defaultMetaShortConfig());
  }

  function handleAnalysisTypeChange(nextType) {
    if (status === "uploading" || status === "submitting" || status === "polling" || status === "paused")
      return;
    if (nextType === analysisType) return;
    setActiveProfileKey("");
    setReusableUploads([]);
    setReusableError("");
    if (guidedTour.active) guidedTour.chooseAnalysis(nextType);
    setAnalysisType(nextType);
    setReadMode("short");
    setSampleId(current =>
      shouldReplaceDefaultJobName(current) ? defaultJobName(nextType, "short") : current
    );
    const order = getProfileOrder(nextType, "short");
    const freshSteps = queuedStepsForOrder(order);
    setSteps(freshSteps);
    setSelectedStepId(freshSteps[0]?.id || "");
    resetUploadInputs();
  }

  function handleReadModeChange(nextMode) {
    if (status === "uploading" || status === "submitting" || status === "polling" || status === "paused")
      return;
    if (nextMode === readMode) return;
    setActiveProfileKey("");
    setReusableUploads([]);
    setReusableError("");
    if (guidedTour.active) guidedTour.chooseReadMode(nextMode);
    setReadMode(nextMode);
    setSampleId(current =>
      shouldReplaceDefaultJobName(current) ? defaultJobName(analysisType, nextMode) : current
    );
    const order = getProfileOrder(analysisType, nextMode);
    const freshSteps = queuedStepsForOrder(order);
    setSteps(freshSteps);
    setSelectedStepId(freshSteps[0]?.id || "");
    resetUploadInputs();
  }

  useEffect(() => {
    if (!guidedTour.active) return;
    if (!guidedTour.analysisType || guidedTour.analysisType === analysisType) return;
    handleAnalysisTypeChange(guidedTour.analysisType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guidedTour.active, guidedTour.analysisType]);

  useEffect(() => {
    if (!guidedTour.active) return;
    if (!guidedTour.readMode || guidedTour.readMode === readMode) return;
    handleReadModeChange(guidedTour.readMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guidedTour.active, guidedTour.readMode]);

  useEffect(() => {
    if (!guidedTour.active) return;
    const target = document.querySelector(`[data-tour-target="${guidedTour.step}"]`);
    target?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }, [guidedTour.active, guidedTour.step]);

  useEffect(() => {
    if (!Object.hasOwn(PIPELINE_ORDERS, requestedDemoProfile)) return undefined;
    if (demoRequestRef.current === requestedDemoProfile) return undefined;
    demoRequestRef.current = requestedDemoProfile;
    handleDemoRun(requestedDemoProfile);
    return undefined;
    // The profile query is the single-use command. handleDemoRun is declared
    // below and intentionally consumes the current page state once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedDemoProfile]);

  useEffect(() => {
    let cancelled = false;

    const fetchReusableUploads = async () => {
      setReusableLoading(true);
      setReusableError("");
      try {
        const query = new URLSearchParams({
          analysis_type: analysisType,
          read_mode: readMode,
          limit: "20",
        });
        const payload = await apiJson(`/uploads/reusable?${query.toString()}`);
        if (cancelled) return;
        setReusableUploads(Array.isArray(payload.items) ? payload.items : []);
        setReusableRetentionDays(payload.retention_days || 7);
      } catch (fetchError) {
        if (cancelled) return;
        setReusableUploads([]);
        setReusableError(fetchError?.message || "Unable to load previous uploads.");
      } finally {
        if (!cancelled) setReusableLoading(false);
      }
    };

    const unsubscribe = auth.onAuthStateChanged(userAccount => {
      if (userAccount) {
        fetchReusableUploads();
      } else {
        setReusableUploads([]);
        setReusableLoading(false);
        setReusableError("");
      }
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [analysisType, readMode]);

  const attachOutputsToSteps = useCallback(items => {
    if (!Array.isArray(items) || !items.length) return;
    setSteps(prev => {
      const mapped = prev.map(st => {
        const outs = items
          .filter(it => belongsTo(st.key, it.key))
          .map(it => ({
            key: it.key,
            url: it.url,
            label: it.key.split("/").pop(),
          }));
        return outs.length ? { ...st, outputs: outs } : st;
      });
      return mapped;
    });
  }, []);

  const beginPolling = useCallback(
    (activeJobId, fallbackProfileKey = "") => {
      if (!activeJobId) return;
      clearTimers();
      let stopPolling = false;
      if (fallbackProfileKey) setActiveProfileKey(fallbackProfileKey);
      setStatus("polling");
      setError("");
      setIsCancelling(false);
      setQueuePosition(null);
      setQueueDepth(null);
      setQueuedAhead(null);

      const syncProfileFromPayload = payload => {
        const key = profileFromStatusPayload(payload);
        if (!key) return;
        setActiveProfileKey(key);
        const [analysis, mode] = key.split(":");
        if (analysis) setAnalysisType(prev => (prev === analysis ? prev : analysis));
        if (mode) setReadMode(prev => (prev === mode ? prev : mode));
      };

      const clearCurrentJob = () => {
        stopPolling = true;
        clearTimers();
        setStatus("idle");
        setJobId("");
        setJobState("queued");
        setResults([]);
        setError("");
        setJM("");
        try {
          localStorage.removeItem(CURRENT_JOB_KEY);
        } catch { /* optional browser state */ }
      };

      const pollResults = async () => {
        if (stopPolling) return;
        try {
          const res = await apiJson(`/jobs/${activeJobId}/results`);
          const items = res.items || [];
          setResults(items);
          attachOutputsToSteps(items);
        } catch {
          // ignore transient
        }
      };

      const pollSteps = async () => {
        if (stopPolling) return;
        try {
          const rail = await apiJson(`/jobs/${activeJobId}/steps`);
          syncProfileFromPayload(rail);
          const fallbackOrder = getOrderForProfileKey(fallbackProfileKey) || activeOrder;
          const resolvedOrder = orderFromStatusPayload(rail, fallbackOrder);
          const back = deriveStepsFromStatus(rail, resolvedOrder);
          setSteps(prev => makeOrderedSteps(prev, back, resolvedOrder));
        } catch {
          // ignore transient
        }
      };

      const pollStatus = async () => {
        if (stopPolling) return;
        try {
          const s = await apiJson(`/jobs/${activeJobId}/status`);
          const stateNorm = normalizeStatus(s.state || "unknown");

          setJobState(stateNorm);
          setJC(s.completed ?? 0);
          setJT(s.total ?? 0);
          setJM(s.message || "");
          setQueuePosition(Number.isInteger(s.queue_position) ? s.queue_position : null);
          setQueueDepth(Number.isInteger(s.queue_depth) ? s.queue_depth : null);
          setQueuedAhead(Number.isInteger(s.queued_ahead) ? s.queued_ahead : null);

          syncProfileFromPayload(s);
          const fallbackOrder = getOrderForProfileKey(fallbackProfileKey) || activeOrder;
          const resolvedOrder = orderFromStatusPayload(s, fallbackOrder);
          const back = deriveStepsFromStatus(s, resolvedOrder);
          setSteps(prev => makeOrderedSteps(prev, back, resolvedOrder));

          if (stateNorm === "cancelled") {
            clearCurrentJob();
            return;
          }

          if (stateNorm === "done" || stateNorm === "failed") {
            if (stateNorm === "done") {
              // A status and result poll can land on opposite sides of the
              // completion timestamp. Fetch once more before stopping timers.
              await pollResults();
            }
            clearTimers();
            setStatus(stateNorm === "failed" ? "error" : "done");
            if (stateNorm === "failed") {
              setError(s.message || "Pipeline failed.");
            }
            try {
              localStorage.removeItem(CURRENT_JOB_KEY);
            } catch { /* optional browser state */ }
          }
        } catch (e) {
          if (isStaleJobError(e)) {
            clearCurrentJob();
          }
        }
      };

      // initial fetch
      (async () => {
        await Promise.all([pollResults(), pollStatus(), pollSteps()]);
        if (stopPolling) return;
        clearTimers();
        pollTimer.current = setInterval(pollResults, 10_000);
        statusTimer.current = setInterval(pollStatus, 5_000);
        stepsTimer.current = setInterval(pollSteps, 7_500);
      })();
    },
    [activeOrder, attachOutputsToSteps]
  );

  // Restore from a private capability link or available server-side history.
  useEffect(() => {
    let cancelled = false;

    const restore = async userAccount => {
      if (cancelled) return;
      if (Object.hasOwn(PIPELINE_ORDERS, requestedDemoProfile)) return;
      const requestedAccessKey = requestedJobId ? getJobAccessKey(requestedJobId) : "";
      const accountId = String(userAccount?.uid || "");
      if (requestedJobId && !requestedAccessKey && !accountId) {
        setStatus("error");
        setError("This job needs its complete private link. The access key appears after #access= and is not sent by email unless you opt in.");
        return;
      }
      if (!requestedJobId && !accountId) return;
      if (requestedAccessKey) {
        try {
          const accessInfo = await apiJson(`/jobs/${encodeURIComponent(requestedJobId)}/access`);
          if (cancelled) return;
          setJobAccessScope(String(accessInfo?.scope || "viewer"));
          setJobAccessExpiresAt(String(accessInfo?.expires_at || ""));
        } catch (accessError) {
          if (cancelled) return;
          setStatus("error");
          setError([403, 404].includes(accessError?.status)
            ? "This private job link is invalid, expired, or has been revoked."
            : accessError?.message || String(accessError));
          return;
        }
      }

      let localJob = null;
      let persistedDraft = readUploadDraft();
      try {
        const raw = localStorage.getItem(CURRENT_JOB_KEY);
        localJob = raw ? JSON.parse(raw) : null;
        if (localJob?.userId && localJob.userId !== accountId) localJob = null;
      } catch {
        localJob = null;
      }
      if (
        persistedDraft &&
        (
          (persistedDraft.userId && persistedDraft.userId !== accountId) ||
          Date.now() - Number(persistedDraft.updatedAt || persistedDraft.createdAt || 0) > 7 * 24 * 3600 * 1000
        )
      ) {
        persistedDraft = null;
        clearStoredUploadDraft();
        setUploadDraft(null);
      }

      let serverJobs = [];
      let serverHistoryLoaded = false;
      if (accountId) {
        try {
          const response = await apiJson(
            `/user-jobs?user_id=${encodeURIComponent(accountId)}`
          );
          serverJobs = Array.isArray(response?.jobs) ? response.jobs : [];
          serverHistoryLoaded = true;
        } catch {
          // A valid local current-job record can still be restored if history
          // is temporarily unavailable; job APIs enforce ownership.
        }
      }
      if (cancelled) return;

      const requestedJob = requestedJobId
        ? serverJobs.find(item => item.jobId === requestedJobId) || { jobId: requestedJobId }
        : null;
      const resumableDraft = persistedDraft?.jobId &&
        (!requestedJobId || persistedDraft.jobId === requestedJobId)
        ? persistedDraft
        : null;
      if (resumableDraft) {
        const activeUpload = getUploadTaskSnapshot(resumableDraft.jobId);
        const savedProfileKey = resumableDraft.profileKey || "wgs:short";
        const parsedProfile = parseProfileKey(savedProfileKey);
        restoredJobRef.current = resumableDraft.jobId;
        setUploadDraft(resumableDraft);
        setJobId(resumableDraft.jobId);
        setSampleId(resumableDraft.sampleId || defaultJobName(parsedProfile.analysis, parsedProfile.mode));
        setAnalysisType(parsedProfile.analysis);
        setReadMode(parsedProfile.mode);
        setActiveProfileKey(savedProfileKey);
        setFileR1(fileFromDraft(resumableDraft.files?.r1));
        setFileR2(fileFromDraft(resumableDraft.files?.r2));
        setFileRLong(fileFromDraft(resumableDraft.files?.rLong));
        setR1({
          done: Number(resumableDraft.files?.r1?.done || 0),
          total: Number(resumableDraft.files?.r1?.size || 0),
        });
        setR2({
          done: Number(resumableDraft.files?.r2?.done || 0),
          total: Number(resumableDraft.files?.r2?.size || 0),
        });
        setRLong({
          done: Number(resumableDraft.files?.rLong?.done || 0),
          total: Number(resumableDraft.files?.rLong?.size || 0),
        });
        if (activeUpload && isClientUploadStatus(activeUpload.status)) {
          applyUploadSnapshot(activeUpload);
        } else {
          const pausedDraft = { ...resumableDraft, status: "paused" };
          saveUploadDraft(pausedDraft);
          setStatus("paused");
          setJobState("queued");
          setJM("Upload paused. Reselect the matching local file or files to continue.");
        }
        return;
      }
      const activeServerJob = serverJobs.find(item =>
        ["queued", "running"].includes(normalizeStatus(item.state))
      );
      const localServerJob = localJob?.jobId
        ? serverJobs.find(item => item.jobId === localJob.jobId)
        : null;
      const localUpload = localJob?.jobId
        ? getUploadTaskSnapshot(localJob.jobId)
        : null;
      const localIsActive = Boolean(
        localServerJob &&
        ["queued", "running"].includes(normalizeStatus(localServerJob.state))
      );
      const localCandidate =
        localJob &&
          (
            (localUpload && isClientUploadStatus(localUpload.status)) ||
            localIsActive ||
            !serverHistoryLoaded
          )
          ? { ...localJob, ...(localServerJob || {}) }
          : null;
      const saved = requestedJob || localCandidate || activeServerJob;
      if (!saved?.jobId || restoredJobRef.current === saved.jobId) return;
      restoredJobRef.current = saved.jobId;

      const savedProfileKey =
        saved.profileKey ||
        saved.profile ||
        (saved.analysisType && saved.readMode
          ? profileKey(saved.analysisType, saved.readMode)
          : "");
      const parsedProfile = savedProfileKey ? parseProfileKey(savedProfileKey) : null;

      setJobId(saved.jobId);
      if (saved.sampleId) setSampleId(saved.sampleId);
      if (parsedProfile?.analysis) setAnalysisType(parsedProfile.analysis);
      else if (saved.analysisType) setAnalysisType(saved.analysisType);
      if (parsedProfile?.mode) setReadMode(parsedProfile.mode);
      else if (saved.readMode) setReadMode(saved.readMode);
      if (savedProfileKey) setActiveProfileKey(savedProfileKey);

      try {
        localStorage.setItem(
          CURRENT_JOB_KEY,
          JSON.stringify({
            ...saved,
            jobId: saved.jobId,
            userId: accountId,
            profileKey: savedProfileKey,
            ts: saved.ts || Date.now(),
          })
        );
      } catch { /* optional browser state */ }

      const activeUpload = getUploadTaskSnapshot(saved.jobId);
      if (activeUpload && isClientUploadStatus(activeUpload.status)) {
        applyUploadSnapshot(activeUpload);
        return;
      }
      beginPolling(saved.jobId, savedProfileKey);
    };

    const unsubscribe = auth.onAuthStateChanged(userAccount => {
      restore(userAccount);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
    // beginPolling deliberately uses the server payload to resolve the final
    // pipeline profile; rerunning this effect would create duplicate timers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedJobId, requestedDemoProfile]);

  useEffect(() => {
    if (!jobId) return undefined;
    const activeUpload = getUploadTaskSnapshot(jobId);
    if (!activeUpload) return undefined;

    let startedPolling = false;
    return subscribeUploadTask(jobId, (snapshot) => {
      applyUploadSnapshot(snapshot);
      if (snapshot.status === "polling" && !startedPolling) {
        startedPolling = true;
        beginPolling(snapshot.jobId, snapshot.profileKey);
      }
    });
  }, [applyUploadSnapshot, beginPolling, jobId]);

  useEffect(() => {
    if (!jobId && ["idle", "done", "error"].includes(status)) {
      const freshSteps = queuedStepsForOrder(activeOrder);
      setSteps(freshSteps);
      setSelectedStepId(freshSteps[0]?.id || "");
    }
  }, [activeOrder, status, jobId]);

  const canRun = useMemo(
    () =>
      sampleId &&
      fileR1 &&
      (!needsR2 || fileR2) &&
      (!needsRLong || fileRLong) &&
      !hasInterruptedUpload &&
      status !== "uploading" &&
      status !== "submitting" &&
      status !== "polling",
    [sampleId, fileR1, fileR2, fileRLong, needsR2, needsRLong, hasInterruptedUpload, status]
  );

  // keep selected step synced with "current"
  useEffect(() => {
    const current =
      steps.find(s => s.status === "running") ||
      [...steps].reverse().find(s => s.status === "failed") ||
      [...steps].reverse().find(s => s.status === "done") ||
      steps[0];
    if (current && current.id !== selectedStepId) setSelectedStepId(current.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps.map(s => `${s.id}:${s.status}`).join("|")]);

  async function executeUpload(resumeDraft = null) {
    const runProfile = parseProfileKey(resumeDraft?.profileKey || selectedProfileKey);
    const runAnalysisType = runProfile.analysis;
    const runReadMode = runProfile.mode;
    const runProfileKey = runProfile.key;
    const runSampleId = resumeDraft?.sampleId || sampleId;
    const runNeedsR2 = runReadMode === "short" || runReadMode === "hybrid";
    const runNeedsRLong = runReadMode === "hybrid";

    if (!fileR1) return;
    if (runNeedsR2 && !fileR2) return;
    if (runNeedsRLong && !fileRLong) return;
    const requestedEmail = notificationEmail.trim();
    if (requestedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requestedEmail)) {
      setStatus("error");
      setError("Enter a valid notification email address or leave the optional field empty.");
      return;
    }
    setError("");
    setIsCancelling(false);
    let newJobId = resumeDraft?.jobId || "";
    let jobAccessKey = newJobId ? getJobAccessKey(newJobId) : "";
    if (!resumeDraft) {
      try {
        const initialized = await apiJson("/jobs/init", { method: "POST" });
        newJobId = String(initialized?.job_id || "");
        jobAccessKey = String(initialized?.access_key || "");
        if (!newJobId || !registerJobAccessKey(newJobId, jobAccessKey)) {
          throw new Error("The server did not return valid private job access details.");
        }
        setJobAccessExpiresAt(String(initialized?.expires_at || ""));
        setJobAccessScope("owner");
        replaceWithPrivateJobLocation(newJobId, jobAccessKey);
      } catch (initializationError) {
        setStatus("error");
        setError(initializationError?.message || String(initializationError));
        return;
      }
    } else if (!jobAccessKey && !auth.currentUser) {
      setStatus("paused");
      setError("Open the private job link supplied when this upload was created to resume it.");
      return;
    }
    const runOrder = getOrderForProfileKey(runProfileKey) || activeOrder;
    const uploadController = new AbortController();
    setJobId(newJobId);
    setActiveProfileKey(runProfileKey);
    setStatus("uploading");
    ensureUploadTask(newJobId, {
      sampleId: runSampleId,
      analysisType: runAnalysisType,
      readMode: runReadMode,
      profileKey: runProfileKey,
      status: "uploading",
      error: "",
      r1Progress: { done: 0, total: fileR1?.size || 0 },
      r2Progress: { done: 0, total: fileR2?.size || 0 },
      rLongProgress: { done: 0, total: fileRLong?.size || 0 },
      controller: uploadController,
    });

    let activeDraft = resumeDraft;
    try {
      if (resumeDraft) {
        const selections = [
          ["r1", fileR1],
          ...(runNeedsR2 ? [["r2", fileR2]] : []),
          ...(runNeedsRLong ? [["rLong", fileRLong]] : []),
        ];
        for (const [role, selectedFile] of selections) {
          const descriptor = resumeDraft.files?.[role];
          if (!matchesDraftDescriptor(selectedFile, descriptor)) {
            throw new Error(`Reselect the original ${descriptor?.name || role} file to resume.`);
          }
          if (!descriptor.reusable && !descriptor.session?.completed) {
            const fingerprint = await sampledFileFingerprint(selectedFile);
            if (descriptor.fingerprint && fingerprint !== descriptor.fingerprint) {
              throw new Error(`The selected ${descriptor.name} file does not match the interrupted upload.`);
            }
          }
        }
        activeDraft = saveUploadDraft({ ...resumeDraft, status: "uploading", error: "" });
      } else {
        const [r1Descriptor, r2Descriptor, rLongDescriptor] = await Promise.all([
          describeUploadFile(fileR1),
          runNeedsR2 ? describeUploadFile(fileR2) : null,
          runNeedsRLong ? describeUploadFile(fileRLong) : null,
        ]);
        activeDraft = saveUploadDraft({
          version: UPLOAD_DRAFT_VERSION,
          jobId: newJobId,
          userId: auth.currentUser?.uid || "",
          sampleId: runSampleId,
          analysisType: runAnalysisType,
          readMode: runReadMode,
          profileKey: runProfileKey,
          status: "uploading",
          error: "",
          createdAt: Date.now(),
          pipelineConfig:
            ENABLE_META_SHORT_SETTINGS && runProfileKey === "metagenomics:short"
              ? metaShortConfig
              : null,
          files: {
            r1: r1Descriptor,
            r2: r2Descriptor,
            rLong: rLongDescriptor,
          },
        });
      }
    } catch (validationError) {
      updateUploadTask(newJobId, {
        status: "paused",
        error: validationError?.message || String(validationError),
      });
      setStatus("paused");
      setError(validationError?.message || String(validationError));
      return;
    }

    // reset rail
    setSteps(queuedStepsForOrder(runOrder));

    // mark this as current job (for refresh persistence)
    try {
      localStorage.setItem(
        CURRENT_JOB_KEY,
        JSON.stringify({
          jobId: newJobId,
          userId: auth.currentUser?.uid || "",
          sampleId: runSampleId,
          analysisType: runAnalysisType,
          readMode: runReadMode,
          profileKey: runProfileKey,
          ts: Date.now(),
        })
      );
    } catch {
      // ignore
    }

    try {
      // Upload or reuse R1
      const r1Total = fileR1.size || 0;
      const r1InitialDone = isReusableUpload(fileR1) ? r1Total : 0;
      setR1({ done: r1InitialDone, total: r1Total });
      updateUploadTask(newJobId, {
        status: "uploading",
        r1Progress: { done: r1InitialDone, total: r1Total },
      });
      setR1Speed(0);
      setR1Eta(null);
      r1StatRef.current = { ts: 0, done: 0 };
      const r1 = isReusableUpload(fileR1)
        ? { key: fileR1.key, reused: true }
        : await uploadFileMultipart({
          file: fileR1,
          jobId: newJobId,
          jobAccessKey,
          fingerprint: activeDraft.files?.r1?.fingerprint || "",
          resumeSession: activeDraft.files?.r1?.session || null,
          signal: uploadController.signal,
          onSession: session => {
            activeDraft = updateUploadDraftFile(activeDraft, "r1", { session });
          },
          onProgress: (doneBytes, totalBytes) => {
            activeDraft = updateUploadDraftFile(activeDraft, "r1", { done: doneBytes });
            setR1({ done: doneBytes, total: totalBytes });
            updateUploadTask(newJobId, {
              status: "uploading",
              r1Progress: { done: doneBytes, total: totalBytes },
            });
            const now = Date.now();
            const last = r1StatRef.current;
            if (last.ts && now - last.ts >= 400) {
              const deltaBytes = doneBytes - last.done;
              const deltaMs = now - last.ts;
              const bps = deltaMs > 0 ? deltaBytes / (deltaMs / 1000) : 0;
              if (bps > 0) {
                setR1Speed(bps);
                setR1Eta(totalBytes > doneBytes ? (totalBytes - doneBytes) / bps : 0);
              }
            }
            r1StatRef.current = { ts: now, done: doneBytes };
          },
        });

      let r2 = null;
      if (runNeedsR2 && fileR2) {
        // Upload or reuse R2 (paired/short read)
        const r2Total = fileR2.size || 0;
        const r2InitialDone = isReusableUpload(fileR2) ? r2Total : 0;
        setR2({ done: r2InitialDone, total: r2Total });
        updateUploadTask(newJobId, {
          status: "uploading",
          r2Progress: { done: r2InitialDone, total: r2Total },
        });
        setR2Speed(0);
        setR2Eta(null);
        r2StatRef.current = { ts: 0, done: 0 };
        r2 = isReusableUpload(fileR2)
          ? { key: fileR2.key, reused: true }
          : await uploadFileMultipart({
            file: fileR2,
            jobId: newJobId,
            jobAccessKey,
            fingerprint: activeDraft.files?.r2?.fingerprint || "",
            resumeSession: activeDraft.files?.r2?.session || null,
            signal: uploadController.signal,
            onSession: session => {
              activeDraft = updateUploadDraftFile(activeDraft, "r2", { session });
            },
            onProgress: (doneBytes, totalBytes) => {
              activeDraft = updateUploadDraftFile(activeDraft, "r2", { done: doneBytes });
              setR2({ done: doneBytes, total: totalBytes });
              updateUploadTask(newJobId, {
                status: "uploading",
                r2Progress: { done: doneBytes, total: totalBytes },
              });
              const now = Date.now();
              const last = r2StatRef.current;
              if (last.ts && now - last.ts >= 400) {
                const deltaBytes = doneBytes - last.done;
                const deltaMs = now - last.ts;
                const bps = deltaMs > 0 ? deltaBytes / (deltaMs / 1000) : 0;
                if (bps > 0) {
                  setR2Speed(bps);
                  setR2Eta(totalBytes > doneBytes ? (totalBytes - doneBytes) / bps : 0);
                }
              }
              r2StatRef.current = { ts: now, done: doneBytes };
            },
          });
      } else {
        setR2({ done: 0, total: 0 });
        setR2Speed(0);
        setR2Eta(null);
      }

      let rLong = null;
      if (runNeedsRLong && fileRLong) {
        // Upload or reuse long-read file for hybrid mode
        const rLongTotal = fileRLong.size || 0;
        const rLongInitialDone = isReusableUpload(fileRLong) ? rLongTotal : 0;
        setRLong({ done: rLongInitialDone, total: rLongTotal });
        updateUploadTask(newJobId, {
          status: "uploading",
          rLongProgress: { done: rLongInitialDone, total: rLongTotal },
        });
        setRLongSpeed(0);
        setRLongEta(null);
        rLongStatRef.current = { ts: 0, done: 0 };
        rLong = isReusableUpload(fileRLong)
          ? { key: fileRLong.key, reused: true }
          : await uploadFileMultipart({
            file: fileRLong,
            jobId: newJobId,
            jobAccessKey,
            fingerprint: activeDraft.files?.rLong?.fingerprint || "",
            resumeSession: activeDraft.files?.rLong?.session || null,
            signal: uploadController.signal,
            onSession: session => {
              activeDraft = updateUploadDraftFile(activeDraft, "rLong", { session });
            },
            onProgress: (doneBytes, totalBytes) => {
              activeDraft = updateUploadDraftFile(activeDraft, "rLong", { done: doneBytes });
              setRLong({ done: doneBytes, total: totalBytes });
              updateUploadTask(newJobId, {
                status: "uploading",
                rLongProgress: { done: doneBytes, total: totalBytes },
              });
              const now = Date.now();
              const last = rLongStatRef.current;
              if (last.ts && now - last.ts >= 400) {
                const deltaBytes = doneBytes - last.done;
                const deltaMs = now - last.ts;
                const bps = deltaMs > 0 ? deltaBytes / (deltaMs / 1000) : 0;
                if (bps > 0) {
                  setRLongSpeed(bps);
                  setRLongEta(totalBytes > doneBytes ? (totalBytes - doneBytes) / bps : 0);
                }
              }
              rLongStatRef.current = { ts: now, done: doneBytes };
            },
          });
      } else {
        setRLong({ done: 0, total: 0 });
        setRLongSpeed(0);
        setRLongEta(null);
      }

      const uid = auth.currentUser?.uid || "";
      const email = requestedEmail;
      const submitterName = auth.currentUser?.displayName || "";
      const uploadedFiles = [
        { role: runReadMode === "long" ? "Long reads" : "R1", file: fileR1, key: r1.key },
        ...(runNeedsR2 && fileR2 ? [{ role: "R2", file: fileR2, key: r2?.key || "" }] : []),
        ...(runNeedsRLong && fileRLong ? [{ role: "Long reads", file: fileRLong, key: rLong?.key || "" }] : []),
      ].map(item => ({
        role: item.role,
        name: item.file?.name || "",
        size: item.file?.size || 0,
        type: item.file?.type || "FASTQ",
        key: item.key,
        reused: isReusableUpload(item.file),
        source_job_id: item.file?.sourceJobId || "",
      }));

      // Submit job to API, including user_id + user_email
      setStatus("submitting");
      updateUploadTask(newJobId, { status: "submitting" });
      const submitPayload = {
        sample: runSampleId,
        r1_key: r1.key,
        // backend currently requires r2_key; keep fallback for long-read-only runs
        r2_key: r2?.key || r1.key,
        analysis_type: runAnalysisType,
        read_mode: runReadMode,
        pipeline_profile: runProfileKey,
        user_id: uid,
        user_email: email,
        user_name: submitterName,
        files: uploadedFiles,
      };
      if (rLong?.key) submitPayload.r_long_key = rLong.key;
      if (ENABLE_META_SHORT_SETTINGS && runProfileKey === "metagenomics:short") {
        submitPayload.pipeline_config = resumeDraft?.pipelineConfig || metaShortConfig;
      }
      await apiJson(`/jobs/${newJobId}/submit`, {
        method: "POST",
        body: JSON.stringify(submitPayload),
      });
      setRecoveryPromptJobId(newJobId);

      // Save to per-user job history (client-side)
      if (uid) {
        saveJob(uid, {
          jobId: newJobId,
          sampleId: runSampleId,
          analysisType: runAnalysisType,
          readMode: runReadMode,
          r1: fileR1?.name,
          r2: fileR2?.name || "",
          rLong: fileRLong?.name || "",
          ts: Date.now(),
        });
      }

      // Start polling
      clearUploadDraft();
      updateUploadTask(newJobId, { status: "polling" });
      beginPolling(newJobId, runProfileKey);
    } catch (e) {
      const task = getRawUploadTask(newJobId);
      if (task?.cancelled) return;
      const message =
        typeof navigator !== "undefined" && !navigator.onLine
          ? "Connection lost. The upload is paused and can be resumed when you are online."
          : `${e?.message || String(e)} The completed chunks were kept; select Resume upload to continue.`;
      updateUploadTask(newJobId, {
        status: "paused",
        error: message,
      });
      activeDraft = saveUploadDraft({ ...activeDraft, status: "paused", error: message });
      setError(message);
      setJM("Upload paused");
      setStatus("paused");
      clearTimers();
    }
  }

  function handleRun() {
    return executeUpload(null);
  }

  function handleResumeUpload() {
    if (!uploadDraft) return undefined;
    return executeUpload(uploadDraft);
  }

  async function handleCopyPrivateLink() {
    const url = privateJobUrl(jobId);
    if (!url) return;
    const copied = await copyTextToClipboard(url);
    if (copied) {
      setPrivateLinkCopied(true);
      setShowPrivateLink(false);
      window.setTimeout(() => setPrivateLinkCopied(false), 2500);
    } else {
      setShowPrivateLink(true);
      setError("Automatic copying is blocked by this browser. Select and copy the private link shown below.");
    }
  }

  function handleDownloadRecoveryFile(targetJobId = jobId, closePrompt = false) {
    const downloaded = downloadJobRecoveryFile(targetJobId, jobAccessExpiresAt);
    if (downloaded && closePrompt) setRecoveryPromptJobId("");
  }

  async function handleCreateViewerLink() {
    if (!jobId || jobAccessScope !== "owner") return;
    setViewerLinkStatus("Creating read-only link…");
    try {
      const created = await apiJson(`/jobs/${encodeURIComponent(jobId)}/viewer-links`, {
        method: "POST",
      });
      const url = privateJobUrl(jobId, String(created?.access_key || ""));
      if (!url) throw new Error("The server did not return a valid read-only link.");
      setViewerLinkUrl(url);
      const copied = await copyTextToClipboard(url);
      setViewerLinkStatus(
        copied
          ? "New read-only link copied"
          : "Read-only link created. Select and copy it below."
      );
    } catch (shareError) {
      setViewerLinkStatus(shareError?.message || "Could not create the read-only link.");
    }
  }

  async function handleCopyViewerLink() {
    if (!viewerLinkUrl) return;
    const copied = await copyTextToClipboard(viewerLinkUrl);
    setViewerLinkStatus(
      copied
        ? "Read-only link copied"
        : "Automatic copying is blocked. Select and copy the link below."
    );
  }

  async function handleRevokeViewerLinks() {
    if (!jobId || jobAccessScope !== "owner") return;
    setViewerLinkStatus("Revoking read-only links…");
    try {
      const result = await apiJson(`/jobs/${encodeURIComponent(jobId)}/viewer-links`, {
        method: "DELETE",
      });
      setViewerLinkUrl("");
      setViewerLinkStatus(`${Number(result?.revoked || 0)} read-only link${Number(result?.revoked || 0) === 1 ? "" : "s"} revoked`);
    } catch (revokeError) {
      setViewerLinkStatus(revokeError?.message || "Could not revoke read-only links.");
    }
  }

  async function handleDemoRun(profileOverride = "") {
    if (isBusy) return;

    const runProfile = parseProfileKey(profileOverride || selectedProfileKey);
    const runProfileKey = runProfile.key;
    const runOrder = getOrderForProfileKey(runProfileKey) || activeOrder;
    setError("");
    setResults([]);
    setExpandedResults({});
    setIsCancelling(false);
    setStatus("submitting");
    setJobState("queued");
    setJC(0);
    setJT(runOrder.length);
    setJM("Preparing synthetic demonstration inputs");
    setQueuePosition(null);
    setQueueDepth(0);
    setQueuedAhead(0);
    setAnalysisType(runProfile.analysis);
    setReadMode(runProfile.mode);
    setActiveProfileKey(runProfileKey);
    setSteps(queuedStepsForOrder(runOrder));
    setSelectedStepId(runOrder[0] || "");
    resetUploadInputs();
    clearTimers();

    try {
      const created = await apiJson("/demo-runs", {
        method: "POST",
        body: JSON.stringify({ profile: runProfileKey }),
      });
      const newJobId = String(created?.job_id || "");
      const jobAccessKey = String(created?.access_key || "");
      if (!newJobId || !registerJobAccessKey(newJobId, jobAccessKey)) {
        throw new Error("Demo API did not return valid private job access details.");
      }

      setJobId(newJobId);
      setJobAccessExpiresAt(String(created?.expires_at || ""));
      setJobAccessScope("owner");
      setSampleId(created?.sample || defaultJobName(runProfile.analysis, runProfile.mode));
      try {
        localStorage.setItem(
          CURRENT_JOB_KEY,
          JSON.stringify({
            jobId: newJobId,
            userId: auth.currentUser?.uid || "",
            sampleId: created?.sample || "GENOCULAR_DEMO",
            analysisType: runProfile.analysis,
            readMode: runProfile.mode,
            profileKey: runProfileKey,
            isDemo: true,
            ts: Date.now(),
          })
        );
      } catch { /* optional browser state */ }
      navigate(created?.private_path || `/run?job_id=${encodeURIComponent(newJobId)}#access=${encodeURIComponent(jobAccessKey)}`, { replace: true });
      beginPolling(newJobId, runProfileKey);
    } catch (demoError) {
      setError(demoError?.message || String(demoError));
      setStatus("error");
      setJobState("failed");
    }
  }

  function abortDraftSessions(draft) {
    const draftAccessKey = getJobAccessKey(draft?.jobId);
    const sessions = Object.values(draft?.files || {})
      .map(descriptor => descriptor?.session)
      .filter(session => session?.uploadId && session?.key);
    for (const session of sessions) {
      apiJson("/uploads/multipart/abort", {
        method: "POST",
        jobAccessKey: draftAccessKey,
        body: JSON.stringify({ key: session.key, uploadId: session.uploadId }),
      }).catch(() => { });
    }
  }

  function resetAll() {
    const previousJobId = jobId;
    const task = jobId ? getRawUploadTask(jobId) : null;
    if (task) task.cancelled = true;
    task?.controller?.abort?.();
    const storedDraft = uploadDraft || readUploadDraft();
    if (storedDraft) abortDraftSessions(storedDraft);
    clearUploadDraft();
    setAnalysisType("wgs");
    setReadMode("short");
    setSampleId(defaultJobName("wgs", "short"));
    setActiveProfileKey("");
    resetMetaShortConfig();
    resetUploadInputs();
    setResults([]);
    setError("");
    setStatus("idle");
    setJobId("");
    setJobAccessExpiresAt("");
    setJobAccessScope("");
    setPrivateLinkCopied(false);
    setShowPrivateLink(false);
    setRecoveryPromptJobId("");
    setViewerLinkUrl("");
    setViewerLinkStatus("");
    setJobState("queued");
    setJC(0);
    setJT(0);
    setJM("");
    setQueuePosition(null);
    setQueueDepth(null);
    setQueuedAhead(null);
    setIsCancelling(false);
    setExpandedResults({});
    const freshSteps = queuedStepsForOrder(getProfileOrder("wgs", "short"));
    setSteps(freshSteps);
    setSelectedStepId(freshSteps[0]?.id || "");
    clearTimers();
    try {
      localStorage.removeItem(CURRENT_JOB_KEY);
    } catch {
      // ignore
    }
    if (previousJobId) forgetJobAccessKey(previousJobId);
    navigate("/run", { replace: true });
  }

  async function handleCancelJob() {
    if (!jobId) return;

    // 1) If we are still in client-side phase (uploading/submitting),
    // there is NO RQ job yet. Just abort locally and reset UI.
    if (status === "uploading" || status === "submitting" || status === "paused") {
      cancelUploadTask(jobId);
      updateUploadTask(jobId, {
        status: "error",
        error: "Upload cancelled by user.",
      });
      setJM("Upload cancelled by user.");
      resetAll();
      return;
    }

    // 2) If we are not polling / queued / running anymore, just reset.
    if (status !== "polling" && jobState !== "running" && jobState !== "queued") {
      resetAll();
      return;
    }

    setIsCancelling(true);
    setError("");
    try {
      await apiJson(`/jobs/${jobId}/cancel`, {
        method: "POST",
      });
      // Treat as cancelled immediately from UI perspective
      setJM("Job cancellation requested.");
      setJobState("cancelled");
      clearTimers();
      try {
        localStorage.removeItem(CURRENT_JOB_KEY);
      } catch { /* optional browser state */ }
      // Fully reset UI so user returns to empty page
      resetAll();
    } catch (e) {
      const msg = e?.message || String(e);

      // If backend says this job is stale/missing/not active, the user's
      // safest path is to clear the restored job and return to the upload form.
      if (isStaleJobError(e)) {
        setJM("Job was not active on the backend; treating as cancelled.");
        clearTimers();
        try {
          localStorage.removeItem(CURRENT_JOB_KEY);
        } catch { /* optional browser state */ }
        resetAll();
      } else {
        setError(msg);
        setIsCancelling(false);
      }
    }
  }

  const totalBytes =
    (fileR1?.size || 0) +
    (needsR2 ? fileR2?.size || 0 : 0) +
    (needsRLong ? fileRLong?.size || 0 : 0);
  const totalDone =
    r1Progress.done +
    (needsR2 ? r2Progress.done : 0) +
    (needsRLong ? rLongProgress.done : 0);
  const totalSpeed =
    r1Speed + (needsR2 ? r2Speed : 0) + (needsRLong ? rLongSpeed : 0);
  const totalEta = totalSpeed > 0 ? (totalBytes - totalDone) / totalSpeed : null;

  const currentId =
    steps.find(s => s.status === "running")?.id ||
    [...steps].reverse().find(s => s.status === "failed")?.id ||
    [...steps].reverse().find(s => s.status === "done")?.id ||
    steps[0]?.id;

  const pipelineTree = useMemo(
    () => getTreeForProfileKey(activeProfileKey) || getProfileTree(analysisType, readMode),
    [activeProfileKey, analysisType, readMode]
  );

  const selected = steps.find(s => s.id === selectedStepId) || steps[0];

  const canCancel =
    !!jobId &&
    jobAccessScope !== "viewer" &&
    (jobState === "running" ||
      jobState === "queued" ||
      status === "uploading" ||
      status === "submitting" ||
      status === "paused" ||
      status === "polling");
  const isDemoRun = String(jobId || "").startsWith("demo-");

  const groupedResults = useMemo(() => {
    if (!results.length) return { groups: [], unassigned: [] };

    const groups = steps.map(st => ({ step: st, items: [] }));
    const unassigned = [];

    for (const item of results) {
      let matched = false;
      for (const g of groups) {
        if (belongsTo(g.step.key, item.key)) {
          g.items.push(item);
          matched = true;
          break;
        }
      }
      if (!matched) unassigned.push(item);
    }

    return {
      groups: groups.filter(g => g.items.length > 0),
      unassigned,
    };
  }, [results, steps]);

  const stepsByKey = useMemo(() => {
    const m = new Map();
    steps.forEach(s => m.set(s.key, s));
    return m;
  }, [steps]);

  const stepIndexByKey = useMemo(() => {
    const m = new Map();
    steps.forEach((s, idx) => {
      if (!m.has(s.key)) m.set(s.key, idx + 1);
    });
    return m;
  }, [steps]);

  const stepStats = useMemo(() => {
    const counts = { done: 0, running: 0, failed: 0, queued: 0, skipped: 0 };
    for (const s of steps) {
      const k = normalizeStatus(s.status);
      if (Object.prototype.hasOwnProperty.call(counts, k)) counts[k] += 1;
    }
    return counts;
  }, [steps]);

  const activeToolNames = useMemo(
    () => Array.from(new Set(
      steps
        .filter(step => normalizeStatus(step.status) === "running")
        .map(step => String(step.name || TOOL_CATALOG[step.key]?.name || step.key || "").trim())
        .filter(Boolean)
    )),
    [steps]
  );
  const isFinalizing = jobState === "running" && isFinalizingMessage(jobMsg);
  const visibleJobMessage =
    jobState === "running" && !isFinalizing && activeToolNames.length
      ? `Running: ${activeToolNames.join(", ")}`
      : jobMsg;
  const progressTotal = jobTotal > 0 ? jobTotal : steps.length;
  const fallbackCompleted = stepStats.done + stepStats.failed + stepStats.skipped;
  const progressCompleted = Math.min(
    progressTotal,
    isFinalizing ? progressTotal : jobCompleted > 0 ? jobCompleted : fallbackCompleted
  );
  const pipelineProgressPct = pct(progressCompleted, progressTotal);
  const canAnalyzeCurrentJob = Boolean(
    jobId && (jobState === "done" || status === "done")
  );

  function isGroupExpanded(key) {
    return !!expandedResults[key];
  }

  function toggleGroup(key) {
    setExpandedResults(prev => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div className="genocular-run min-h-screen overflow-x-clip bg-slate-50 text-slate-900">
      <div className="w-full px-4 sm:px-8 lg:px-14 xl:px-20 py-8 space-y-6">
        {/* header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="genocular-page-title">
              Submit Analysis Run
            </h1>
            <p className="genocular-page-subtitle">
              Configure a {analysisType === "wgs" ? "WGS" : "metagenomics"} profile, upload {readMode === "short" ? "paired short-read" : readMode === "long" ? "long-read" : "short-read and long-read"} FASTQ inputs, and submit the run for server-side workflow execution.
            </p>
          </div>
          {accountUser && (
            <Link
              className="inline-flex shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-800"
              to="/jobs"
            >
              View my jobs
            </Link>
          )}
        </div>

        {isDemoRun && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm">
            <div className="font-semibold">Demonstration run using synthetic example data</div>
            <div className="mt-0.5 text-xs text-amber-800">
              This one-minute playback does not execute pipeline tools and its illustrative results must not be used for scientific interpretation.
            </div>
          </div>
        )}

        {hasInterruptedUpload && (
          <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-4 text-sm text-slate-800 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="font-semibold text-sky-950">Interrupted upload available</div>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  Reselect the same local file{needsR2 || needsRLong ? "s" : ""}. Already uploaded chunks will be verified in MinIO and will not be sent again.
                </p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
                  {[draftFiles.r1, needsR2 ? draftFiles.r2 : null, needsRLong ? draftFiles.rLong : null]
                    .filter(Boolean)
                    .map(descriptor => (
                      <span key={descriptor.name}>
                        {descriptor.name} · {fmtBytes(descriptor.done || 0)} of {fmtBytes(descriptor.size || 0)}
                      </span>
                    ))}
                </div>
              </div>
              <button
                type="button"
                onClick={resetAll}
                className="shrink-0 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Discard upload
              </button>
            </div>
          </div>
        )}

        {/* Upload card */}
        <Motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={[
            "genocular-run-card relative overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white/95 p-4 shadow-[0_28px_70px_-48px_rgba(15,23,42,0.48)] ring-1 ring-slate-900/[0.02] sm:p-6",
          ].join(" ")}
        >
          <Motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-3xl"
            initial={false}
            animate={{
              opacity: 1,
              x: 0,
            }}
            transition={{ duration: 0.4, ease: "easeInOut" }}
            style={{
              background:
                isMetagenomics
                  ? "radial-gradient(circle at 96% 0%, rgba(20,184,166,0.1), transparent 30%)"
                  : "radial-gradient(circle at 96% 0%, rgba(14,165,233,0.1), transparent 30%)",
            }}
          />

          <div className="relative z-10 flex flex-col gap-5">
            <nav
              aria-label="Run setup progress"
              className="grid gap-2 rounded-2xl border border-slate-200/80 bg-slate-50/75 p-2 sm:grid-cols-3"
            >
              {["Select workflow", "Upload input files", "Submit pipeline"].map((label, index) => {
                const stage = index + 1;
                const active = setupStageIndex === stage;
                const complete = setupStageIndex > stage;
                return (
                  <div
                    key={label}
                    className={[
                      "flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-sm transition-colors",
                      active
                        ? `${isMetagenomics ? "ring-teal-200" : "ring-sky-200"} bg-white font-semibold text-slate-950 shadow-sm ring-1`
                        : complete
                          ? "font-medium text-emerald-700"
                          : "text-slate-500",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold",
                        complete
                          ? "bg-emerald-600 text-white"
                          : active
                            ? isMetagenomics
                              ? "bg-teal-700 text-white"
                              : "bg-sky-700 text-white"
                            : "bg-slate-200 text-slate-500",
                      ].join(" ")}
                    >
                      {complete ? "✓" : stage}
                    </span>
                    <span>{label}</span>
                  </div>
                );
              })}
            </nav>

            <section className={`genocular-run-panel order-[1] rounded-2xl border p-4 sm:p-5 ${isMetagenomics ? "border-teal-200 bg-teal-50/35" : "border-sky-200 bg-sky-50/35"}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-base font-semibold tracking-[-0.02em] text-slate-950">Workflow Selection</div>
                  <div className="mt-0.5 text-xs text-slate-500">Choose the analysis scope and sequencing technology.</div>
                </div>
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${isMetagenomics ? "border-teal-200 bg-teal-50 text-teal-800" : "border-sky-200 bg-sky-50 text-sky-800"}`}>
                  {analysisType === "wgs" ? "WGS" : "Metagenomics"} · {readMode} reads
                </span>
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Analysis type</div>
                  <div
                    data-tour-target="analysis"
                    className={`genocular-run-toggle relative grid grid-cols-2 rounded-2xl border border-slate-200 bg-white/85 p-1 shadow-sm ${tourTargetClass("analysis")}`}
                  >
                    <Motion.span
                      aria-hidden
                      className={[
                        "absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-xl ring-1 shadow-sm",
                        isMetagenomics
                          ? "bg-gradient-to-r from-teal-100 to-emerald-50 ring-teal-200"
                          : "bg-gradient-to-r from-sky-100 to-indigo-50 ring-sky-200",
                      ].join(" ")}
                      initial={false}
                      animate={{ x: analysisType === "wgs" ? "0%" : "100%" }}
                      transition={{ type: "spring", stiffness: 320, damping: 26 }}
                    />
                    {ANALYSIS_TYPES.map(opt => {
                      const active = analysisType === opt.key;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => handleAnalysisTypeChange(opt.key)}
                          disabled={
                            status === "uploading" ||
                            status === "submitting" ||
                            status === "polling" ||
                            status === "paused"
                          }
                          className={[
                            "relative z-10 rounded-xl px-4 py-3 text-left transition",
                            active
                              ? isMetagenomics
                                ? "text-teal-800"
                                : "text-sky-800"
                              : "text-slate-600 hover:text-slate-800",
                          ].join(" ")}
                        >
                          <div className="text-sm font-semibold leading-tight">
                            {opt.label}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5 leading-tight">
                            {opt.hint}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Read technology</div>
                  <div
                    data-tour-target="readMode"
                    className={`genocular-run-toggle relative grid grid-cols-3 rounded-2xl border border-slate-200 bg-white/85 p-1 shadow-sm ${tourTargetClass("readMode")}`}
                  >
                    <Motion.span
                      aria-hidden
                      className="absolute inset-y-1 left-1 w-[calc(33.333%-0.25rem)] rounded-xl bg-gradient-to-r from-indigo-100 to-violet-50 ring-1 ring-indigo-200 shadow-sm"
                      initial={false}
                      animate={{ x: `${readModeIndex * 100}%` }}
                      transition={{ type: "spring", stiffness: 320, damping: 26 }}
                    />
                    {READ_MODES.map(opt => {
                      const active = readMode === opt.key;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => handleReadModeChange(opt.key)}
                          disabled={
                            status === "uploading" ||
                            status === "submitting" ||
                            status === "polling" ||
                            status === "paused"
                          }
                          className={[
                            "relative z-10 rounded-xl px-2 py-2.5 text-center transition",
                            active
                              ? "text-indigo-800"
                              : "text-slate-600 hover:text-slate-800",
                          ].join(" ")}
                        >
                          <div className="text-sm font-semibold leading-tight">{opt.label}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5 leading-tight">
                            {opt.hint}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div
                data-tour-target="jobName"
                className={`mt-4 space-y-1 rounded-xl border border-slate-200 bg-white p-3.5 ${tourTargetClass("jobName")}`}
              >
                <label className="text-sm font-medium">Job name</label>
                <input
                  className="mt-1 border rounded-lg px-3 py-2.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                  value={sampleId}
                  onChange={e => setSampleId(e.target.value)}
                  placeholder="e.g. ILSM1213"
                />
                <p className="text-[11px] text-slate-500">
                  Used in output folders and reports.
                </p>
              </div>
            </section>

            {(reusableError || reusableChoices.length > 0 || usingReusableUpload) && (
              <div className="genocular-run-panel order-[4] rounded-2xl border border-slate-200 bg-white/75 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      Previous uploads
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">Available from the last {reusableRetentionDays} days</div>
                  </div>
                  {usingReusableUpload && (
                    <button
                      type="button"
                      onClick={resetUploadInputs}
                      disabled={isBusy}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Clear files
                    </button>
                  )}
                </div>

                {reusableLoading && (
                  <div className="mt-3 text-xs text-slate-500">Checking previous uploads…</div>
                )}
                {!reusableLoading && reusableError && (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    Previous uploads are unavailable right now.
                  </div>
                )}
                {!reusableLoading && reusableChoices.length > 0 && (
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {reusableChoices.map(({ item, files }) => (
                      <button
                        key={item.job_id}
                        type="button"
                        onClick={() => applyReusableUpload(item)}
                        disabled={isBusy}
                        className="genocular-reuse-card group rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-3 text-left transition hover:border-sky-300 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate text-sm font-semibold text-slate-900">
                            {item.sample || item.job_id}
                          </span>
                          <span className="shrink-0 rounded-full bg-sky-50 px-2 py-1 text-[10px] font-medium text-sky-700 ring-1 ring-sky-100">
                            Reuse
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          {formatReusableDate(item.created_at)} · {item.status || "stored"}
                        </div>
                        <div className="mt-2 space-y-1 text-[11px] text-slate-600">
                          {files.r1 && <div className="truncate">R1: {files.r1.name}</div>}
                          {files.r2 && <div className="truncate">R2: {files.r2.name}</div>}
                          {files.rLong && <div className="truncate">Long: {files.rLong.name}</div>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="order-[2] flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-base font-semibold tracking-[-0.02em] text-slate-950">Upload Input Files</div>
                <div className="mt-0.5 text-xs text-slate-500">Select the FASTQ inputs required for this profile.</div>
              </div>
              <span className={`rounded-full border bg-white px-3 py-1 text-xs font-medium shadow-sm ${isMetagenomics ? "border-teal-200 text-teal-700" : "border-sky-200 text-sky-700"}`}>
                {needsRLong ? 3 : needsR2 ? 2 : 1} file{needsR2 || needsRLong ? "s" : ""} required
              </span>
            </div>

            <Motion.div
              data-tour-target="upload"
              className={`genocular-upload-grid ${uploadGridColsClass} order-[3] relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/55 p-3 sm:p-4 ${tourTargetClass("upload")}`}
              layout
              transition={{ layout: { type: "spring", stiffness: 360, damping: 32 } }}
            >
              <Motion.div
                layout
                transition={{ layout: { type: "spring", stiffness: 360, damping: 32 } }}
                className="space-y-1"
              >
                <label className="text-sm font-medium">{readMode === "long" ? "Upload long reads" : "Upload R1"}</label>
                <div className="relative">
                  <input
                    id="upload-r1"
                    type="file"
                    accept=".fastq,.fq,.fastq.gz,.fq.gz,.gz"
                    onChange={event => handleR1FileChange(event.target.files?.[0] || null)}
                    className="sr-only"
                  />
                  <label
                    htmlFor="upload-r1"
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => {
                      e.preventDefault();
                      if (e.dataTransfer.files?.[0]) handleR1FileChange(e.dataTransfer.files[0]);
                    }}
                    className={[
                      "genocular-file-drop group flex min-h-[118px] cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-4 text-xs transition-all duration-200",
                      fileR1
                        ? "border-sky-300 bg-sky-50/70 shadow-[0_0_0_3px_rgba(14,165,233,0.12)]"
                        : "border-dashed border-slate-200 bg-white/80 hover:-translate-y-px hover:border-sky-300 hover:bg-white hover:shadow-sm",
                    ].join(" ")}
                  >
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M4 16.5A4.5 4.5 0 0 1 8.5 12h.5a5 5 0 0 1 10 1v.5a3.5 3.5 0 0 1-3.5 3.5H8.5A4.5 4.5 0 0 1 4 16.5Z" />
                        <path d="M12 8v8" />
                        <path d="M9 11l3-3 3 3" />
                      </svg>
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] text-slate-500 uppercase tracking-wide">
                        {readMode === "long" ? "R1 long-read file" : "R1 file"}
                      </div>
                      <div className="text-sm font-medium text-slate-900 truncate">
                        {fileDisplayName(fileR1, hasInterruptedUpload ? draftFiles.r1?.name : undefined)}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {fileDisplayMeta(fileR1, hasInterruptedUpload ? "Reselect this file to resume" : undefined)}
                      </div>
                    </div>
                    <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm group-hover:border-sky-200 group-hover:bg-sky-50">
                      {fileR1 && !fileR1.isDraftDummy ? "Change" : "Browse"}
                    </span>
                  </label>
                </div>
                {fileR1 && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between text-[11px] text-slate-600 mb-1">
                      <span>
                        {fmtBytes(r1Progress.done)} / {fmtBytes(r1Progress.total)}
                      </span>
                      <span>
                        {fmtSpeed(r1Speed)} · ETA {fmtEta(r1Eta)}
                      </span>
                    </div>
                    <div className="relative w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-sky-600 transition-all duration-300"
                        style={{ width: `${pct(r1Progress.done, r1Progress.total)}%` }}
                      />
                      <div className="absolute inset-0 flex items-center justify-end pr-2 text-[10px] text-white/90">
                        <span className="font-medium drop-shadow">
                          {pct(r1Progress.done, r1Progress.total)}%
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </Motion.div>

              <AnimatePresence initial={false} mode="popLayout">
                {needsR2 && (
                  <Motion.div
                    key="upload-r2-card"
                    layout
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.98 }}
                    transition={{
                      opacity: { duration: 0.18 },
                      y: { type: "spring", stiffness: 360, damping: 30 },
                      scale: { duration: 0.18 },
                      layout: { type: "spring", stiffness: 360, damping: 32 },
                    }}
                    className="space-y-1"
                  >
                    <label className="text-sm font-medium">Upload R2</label>
                    <div className="relative">
                      <input
                        id="upload-r2"
                        type="file"
                        accept=".fastq,.fq,.fastq.gz,.fq.gz,.gz"
                        onChange={event => handleR2FileChange(event.target.files?.[0] || null)}
                        className="sr-only"
                      />
                      <label
                        htmlFor="upload-r2"
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => {
                          e.preventDefault();
                          if (e.dataTransfer.files?.[0]) handleR2FileChange(e.dataTransfer.files[0]);
                        }}
                        className={[
                          "genocular-file-drop group flex min-h-[118px] cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-4 text-xs transition-all duration-200",
                          fileR2
                            ? "border-emerald-300 bg-emerald-50/70 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]"
                            : "border-dashed border-slate-200 bg-white/80 hover:-translate-y-px hover:border-emerald-300 hover:bg-white hover:shadow-sm",
                        ].join(" ")}
                      >
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                            <path d="M4 16.5A4.5 4.5 0 0 1 8.5 12h.5a5 5 0 0 1 10 1v.5a3.5 3.5 0 0 1-3.5 3.5H8.5A4.5 4.5 0 0 1 4 16.5Z" />
                            <path d="M12 8v8" />
                            <path d="M9 11l3-3 3 3" />
                          </svg>
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] text-slate-500 uppercase tracking-wide">R2 file</div>
                          <div className="text-sm font-medium text-slate-900 truncate">
                            {fileDisplayName(fileR2, hasInterruptedUpload ? draftFiles.r2?.name : undefined)}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {fileDisplayMeta(fileR2, hasInterruptedUpload ? "Reselect this file to resume" : undefined)}
                          </div>
                        </div>
                        <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm group-hover:border-emerald-200 group-hover:bg-emerald-50">
                          {fileR2 && !fileR2.isDraftDummy ? "Change" : "Browse"}
                        </span>
                      </label>
                    </div>
                    {fileR2 && (
                      <div className="mt-2">
                        <div className="flex items-center justify-between text-[11px] text-slate-600 mb-1">
                          <span>
                            {fmtBytes(r2Progress.done)} / {fmtBytes(r2Progress.total)}
                          </span>
                          <span>
                            {fmtSpeed(r2Speed)} · ETA {fmtEta(r2Eta)}
                          </span>
                        </div>
                        <div className="relative w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-600 transition-all duration-300"
                            style={{ width: `${pct(r2Progress.done, r2Progress.total)}%` }}
                          />
                          <div className="absolute inset-0 flex items-center justify-end pr-2 text-[10px] text-white/90">
                            <span className="font-medium drop-shadow">
                              {pct(r2Progress.done, r2Progress.total)}%
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </Motion.div>
                )}

                {needsRLong && (
                  <Motion.div
                    key="upload-r-long-card"
                    layout
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.98 }}
                    transition={{
                      opacity: { duration: 0.2 },
                      y: { type: "spring", stiffness: 360, damping: 30 },
                      scale: { duration: 0.2 },
                      layout: { type: "spring", stiffness: 360, damping: 32 },
                    }}
                    className="space-y-1 md:col-span-2 xl:col-span-1"
                  >
                    <label className="text-sm font-medium">Upload long reads</label>
                    <div className="relative">
                      <input
                        id="upload-r-long"
                        type="file"
                        accept=".fastq,.fq,.fastq.gz,.fq.gz,.gz"
                        onChange={event => handleRLongFileChange(event.target.files?.[0] || null)}
                        className="sr-only"
                      />
                      <label
                        htmlFor="upload-r-long"
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => {
                          e.preventDefault();
                          if (e.dataTransfer.files?.[0]) handleRLongFileChange(e.dataTransfer.files[0]);
                        }}
                        className={[
                          "genocular-file-drop group flex min-h-[118px] cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-4 text-xs transition-all duration-200",
                          fileRLong
                            ? "border-amber-300 bg-amber-50/70 shadow-[0_0_0_3px_rgba(245,158,11,0.16)]"
                            : "border-dashed border-slate-200 bg-white/80 hover:-translate-y-px hover:border-amber-300 hover:bg-white hover:shadow-sm",
                        ].join(" ")}
                      >
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                            <path d="M4 16.5A4.5 4.5 0 0 1 8.5 12h.5a5 5 0 0 1 10 1v.5a3.5 3.5 0 0 1-3.5 3.5H8.5A4.5 4.5 0 0 1 4 16.5Z" />
                            <path d="M12 8v8" />
                            <path d="M9 11l3-3 3 3" />
                          </svg>
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] text-slate-500 uppercase tracking-wide">Long-read file</div>
                          <div className="text-sm font-medium text-slate-900 truncate">
                            {fileDisplayName(fileRLong, hasInterruptedUpload ? draftFiles.rLong?.name : undefined)}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {fileDisplayMeta(fileRLong, hasInterruptedUpload ? "Reselect this file to resume" : undefined)}
                          </div>
                        </div>
                        <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm group-hover:border-amber-200 group-hover:bg-amber-50">
                          {fileRLong && !fileRLong.isDraftDummy ? "Change" : "Browse"}
                        </span>
                      </label>
                    </div>
                    {fileRLong && (
                      <div className="mt-2">
                        <div className="flex items-center justify-between text-[11px] text-slate-600 mb-1">
                          <span>
                            {fmtBytes(rLongProgress.done)} / {fmtBytes(rLongProgress.total)}
                          </span>
                          <span>
                            {fmtSpeed(rLongSpeed)} · ETA {fmtEta(rLongEta)}
                          </span>
                        </div>
                        <div className="relative w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-500 transition-all duration-300"
                            style={{ width: `${pct(rLongProgress.done, rLongProgress.total)}%` }}
                          />
                          <div className="absolute inset-0 flex items-center justify-end pr-2 text-[10px] text-white/90">
                            <span className="font-medium drop-shadow">
                              {pct(rLongProgress.done, rLongProgress.total)}%
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </Motion.div>
                )}
              </AnimatePresence>
            </Motion.div>

            <Motion.div
              data-tour-target="submit"
              layout="position"
              transition={{ layout: { duration: 0.2, ease: "easeOut" } }}
              className={`genocular-run-panel order-[6] relative rounded-2xl border bg-white p-4 shadow-[0_18px_44px_-36px_rgba(15,23,42,0.5)] sm:p-5 ${isMetagenomics ? "border-teal-200" : "border-sky-200"} ${tourTargetClass("submit")}`}
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="text-base font-semibold tracking-[-0.02em] text-slate-950">Pipeline submission</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {analysisType === "wgs" ? "WGS" : "Metagenomics"} · {readMode} reads · {needsRLong ? 3 : needsR2 ? 2 : 1} input file{needsR2 || needsRLong ? "s" : ""}
                  </div>
                  <label className="mt-3 block max-w-sm text-xs font-medium text-slate-700">
                    Completion email <span className="font-normal text-slate-400">(optional)</span>
                    <input
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      maxLength={254}
                      value={notificationEmail}
                      onChange={event => setNotificationEmail(event.target.value)}
                      disabled={["uploading", "submitting", "polling"].includes(status)}
                      placeholder="name@example.org"
                      className="mt-1.5 block h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 disabled:bg-slate-100"
                    />
                    <span className="mt-1 block font-normal leading-5 text-slate-500">
                      Receive submission, status, and completion updates.
                    </span>
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  {hasInterruptedUpload ? (
                    <Motion.button
                      type="button"
                      onClick={handleResumeUpload}
                      disabled={!canResumeUpload}
                      className={[
                        "inline-flex min-h-11 items-center justify-center rounded-xl px-6 text-sm font-semibold transition",
                        canResumeUpload
                          ? isMetagenomics
                            ? "bg-gradient-to-r from-teal-700 to-emerald-600 text-white shadow-[0_14px_28px_-18px_rgba(13,148,136,0.8)] hover:brightness-105"
                            : "bg-gradient-to-r from-sky-700 to-indigo-600 text-white shadow-[0_14px_28px_-18px_rgba(2,132,199,0.8)] hover:brightness-105"
                          : "cursor-not-allowed bg-slate-200 text-slate-500",
                      ].join(" ")}
                      whileHover={canResumeUpload ? { y: -1 } : {}}
                      whileTap={canResumeUpload ? { y: 0 } : {}}
                    >
                      Resume upload
                    </Motion.button>
                  ) : (
                    <Motion.button
                      onClick={handleRun}
                      disabled={!canRun}
                      className={[
                        "inline-flex min-h-11 items-center justify-center rounded-xl px-6 text-sm font-semibold transition",
                        canRun
                          ? isMetagenomics
                            ? "bg-gradient-to-r from-teal-700 to-emerald-600 text-white shadow-[0_14px_28px_-18px_rgba(13,148,136,0.8)] hover:brightness-105"
                            : "bg-gradient-to-r from-sky-700 to-indigo-600 text-white shadow-[0_14px_28px_-18px_rgba(2,132,199,0.8)] hover:brightness-105"
                          : "cursor-not-allowed bg-slate-200 text-slate-500",
                      ].join(" ")}
                      whileHover={canRun ? { y: -1 } : {}}
                      whileTap={canRun ? { y: 0 } : {}}
                    >
                      Run pipeline
                    </Motion.button>
                  )}

                  <button
                    type="button"
                    onClick={resetAll}
                    disabled={
                      status === "uploading" ||
                      status === "submitting" ||
                      status === "polling"
                    }
                    className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Reset
                  </button>

                  {jobId && (
                    <button
                      type="button"
                      onClick={handleCancelJob}
                      disabled={!canCancel || isCancelling}
                      className="inline-flex min-h-11 items-center justify-center rounded-xl border border-rose-300 bg-rose-50 px-5 text-sm font-medium text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isCancelling ? "Cancelling…" : "Cancel job"}
                    </button>
                  )}
                  {canAnalyzeCurrentJob && (
                    <button
                      type="button"
                      onClick={() => navigate(privateAnalysisPath(jobId) || `/analysis?job_id=${encodeURIComponent(jobId)}`)}
                      className="inline-flex min-h-11 items-center justify-center rounded-xl border border-emerald-300 bg-emerald-50 px-5 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100"
                    >
                      Analyze results
                    </button>
                  )}
                </div>
              </div>

              {jobId && getJobAccessKey(jobId) && (
                <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3.5 text-xs text-emerald-950">
                  <div className="font-semibold">Job access</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleCopyPrivateLink}
                      className="rounded-lg border border-emerald-300 bg-white px-3 py-2 font-medium text-emerald-800 transition hover:bg-emerald-100"
                    >
                      {privateLinkCopied ? "Private link copied" : "Copy private link"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownloadRecoveryFile(jobId)}
                      className="rounded-lg border border-emerald-300 bg-white px-3 py-2 font-medium text-emerald-800 transition hover:bg-emerald-100"
                    >
                      Download recovery file
                    </button>
                    {jobAccessScope === "owner" && (
                      <>
                        <button
                          type="button"
                          onClick={handleCreateViewerLink}
                          className="rounded-lg border border-sky-300 bg-white px-3 py-2 font-medium text-sky-800 transition hover:bg-sky-50"
                        >
                          Copy new read-only link
                        </button>
                        <button
                          type="button"
                          onClick={handleRevokeViewerLinks}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700 transition hover:bg-slate-100"
                        >
                          Revoke read-only links
                        </button>
                      </>
                    )}
                  </div>
                  {showPrivateLink && (
                    <div className="mt-3">
                      <label htmlFor="private-job-link" className="mb-1 block font-medium text-emerald-900">
                        Private job link
                      </label>
                      <input
                        id="private-job-link"
                        type="text"
                        readOnly
                        value={privateJobUrl(jobId)}
                        onFocus={(event) => event.currentTarget.select()}
                        className="w-full rounded-lg border border-emerald-300 bg-white px-3 py-2 font-mono text-[11px] text-slate-700"
                      />
                    </div>
                  )}
                  {viewerLinkUrl && (
                    <div className="mt-3">
                      <label htmlFor="viewer-job-link" className="mb-1 block font-medium text-sky-900">
                        New read-only private link
                      </label>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <input
                          id="viewer-job-link"
                          type="text"
                          readOnly
                          value={viewerLinkUrl}
                          onFocus={(event) => event.currentTarget.select()}
                          className="min-w-0 flex-1 rounded-lg border border-sky-300 bg-white px-3 py-2 font-mono text-[11px] text-slate-700"
                        />
                        <button
                          type="button"
                          onClick={handleCopyViewerLink}
                          className="rounded-lg border border-sky-300 bg-white px-3 py-2 font-medium text-sky-800 transition hover:bg-sky-50"
                        >
                          Copy link
                        </button>
                      </div>
                    </div>
                  )}
                  {viewerLinkStatus && (
                    <div className="mt-2 text-[11px] text-emerald-800" role="status">
                      {viewerLinkStatus}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500">
                <span>Status:</span>
                <span
                  className={
                    status === "error"
                      ? "font-semibold text-rose-600"
                      : status === "paused"
                        ? "font-semibold text-amber-700"
                        : ""
                  }
                >
                  {status}
                </span>
                {jobId && (
                  <>
                    {" "}
                    · Job{" "}
                    <code className="text-[11px] text-slate-500">{jobId}</code>
                  </>
                )}
                {jobState === "queued" && queuePosition !== null && (
                  <>
                    {" "}
                    · Queue position <b>{queuePosition}</b>
                    {queueDepth !== null ? (
                      <>
                        {" "}
                        / {queueDepth}
                      </>
                    ) : null}
                  </>
                )}
              </div>
            </Motion.div>

            {error && (
              <div className={`order-[7] rounded-lg border p-2 text-xs break-words ${status === "paused"
                  ? "border-amber-300 bg-amber-50 text-amber-800"
                  : "border-rose-300 bg-rose-50 text-rose-700"
                }`}>
                {error}
              </div>
            )}

            {/* Upload progress */}
            {hasAnySelectedFile && (
              <div className="genocular-run-panel order-[8] rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">
                      Total Upload
                    </div>
                    <div className="text-lg font-semibold text-slate-900">
                      {fmtBytes(totalDone)} / {fmtBytes(totalBytes)}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                    <span className="px-2 py-0.5 rounded-full border border-slate-200 bg-white">
                      Speed <b className="text-slate-900">{fmtSpeed(totalSpeed)}</b>
                    </span>
                    <span className="px-2 py-0.5 rounded-full border border-slate-200 bg-white">
                      ETA <b className="text-slate-900">{fmtEta(totalEta)}</b>
                    </span>
                    <span className="px-2 py-0.5 rounded-full border border-slate-200 bg-white">
                      <b className="text-slate-900">{pct(totalDone, totalBytes)}%</b>
                    </span>
                  </div>
                </div>

                <div className="mt-3 relative w-full h-5 bg-slate-200/70 rounded-full overflow-hidden shadow-inner">
                  <div
                    className="h-full bg-gradient-to-r from-sky-500 to-emerald-500 transition-all duration-300"
                    style={{ width: `${pct(totalDone, totalBytes)}%` }}
                  />
                  <div className="absolute inset-0 flex items-center justify-between px-3 text-[11px] text-slate-700">
                    <span className="font-medium">Uploading data</span>
                    <span className="font-medium">{pct(totalDone, totalBytes)}%</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Motion.div>

        {/* Everything below appears ONLY after Run Pipeline (jobId set) */}
        {jobId ? (
          <>
            {/* Pipeline rail + details */}
            <Motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-3"
            >
              <div className="genocular-run-pipeline rounded-2xl p-4 border bg-gradient-to-tr from-white via-slate-50 to-white shadow-sm">
                <div className="genocular-run-panel rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs text-slate-600">
                      Job state: <span className="font-semibold capitalize text-slate-900">{isFinalizing ? "finalizing" : jobState}</span>
                      {visibleJobMessage ? <span className="text-slate-500"> · {visibleJobMessage}</span> : null}
                    </div>
                    {jobState === "queued" && queuePosition !== null ? (
                      <div className="text-xs text-sky-700">
                        Queue #{queuePosition}
                        {queuedAhead !== null ? ` (${queuedAhead} ahead)` : ""}
                        {queueDepth !== null ? ` / ${queueDepth}` : ""}
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-2">
                    <div className="mb-1 flex items-center justify-between text-[11px] text-slate-600">
                      <span>Pipeline progress</span>
                      <span>{pipelineProgressPct}% ({progressCompleted}/{progressTotal || 0})</span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-full bg-gradient-to-r from-sky-500 via-cyan-500 to-emerald-500 transition-all duration-500"
                        style={{ width: `${pipelineProgressPct}%` }}
                      />
                    </div>
                  </div>
                  {isFinalizing ? (
                    <div className="mt-3 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs text-cyan-800">
                      Pipeline tools have finished. GENOCULAR is organizing reports, indexing results, and uploading result files for download.
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">Completed {stepStats.done}</span>
                    <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-sky-700">Running {stepStats.running}</span>
                    <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-rose-700">Failed {stepStats.failed}</span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-700">Queued {stepStats.queued}</span>
                    <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-slate-700">Skipped {stepStats.skipped}</span>
                  </div>
                  {jobState === "running" && !isFinalizing && activeToolNames.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                      {activeToolNames.map(name => (
                        <span key={name} className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 font-medium text-sky-700">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" />
                          {name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <PipelineRail
                  steps={steps}
                  currentId={currentId}
                  onSelect={setSelectedStepId}
                />
                <div className="mt-4">
                  <PipelineTree
                    tree={pipelineTree}
                    stepsByKey={stepsByKey}
                    stepIndexByKey={stepIndexByKey}
                    selectedId={selectedStepId}
                    currentId={currentId}
                    onSelect={setSelectedStepId}
                  />
                </div>
              </div>

              <AnimatePresence mode="wait">
                {steps.length ? (
                  <ToolDetails
                    key={selectedStepId}
                    step={selected || steps[0]}
                  />
                ) : null}
              </AnimatePresence>
            </Motion.div>

            {/* Results */}
            <Motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="genocular-run-panel border border-slate-200 rounded-2xl p-5 bg-white/90 shadow-sm space-y-2"
            >
              <h2 className="genocular-section-title">Results</h2>
              {results.length === 0 ? (
                <div className="text-sm text-slate-600">
                  {status === "polling"
                    ? "Availbale after completion of job."
                    : "No results yet."}
                </div>
              ) : (
                <div className="space-y-4">
                  {groupedResults.groups.map(g => {
                    const groupKey = `tool:${g.step.key}`;
                    const expanded = isGroupExpanded(groupKey);
                    const visible = expanded
                      ? g.items
                      : g.items.slice(0, RESULTS_PREVIEW_COUNT);
                    const hasMore = g.items.length > RESULTS_PREVIEW_COUNT;
                    return (
                      <div key={g.step.key} className="space-y-1">
                        <div className="text-xs font-semibold text-slate-600 flex items-center gap-2">
                          <span>{g.step.name || g.step.key}</span>
                          <span className="text-[10px] text-slate-400">
                            {g.items.length} file{g.items.length === 1 ? "" : "s"}
                          </span>
                        </div>
                        <ul className="list-disc pl-5 space-y-1 text-sm">
                          {visible.map(it => (
                            <li key={it.key}>
                              <a
                                className="text-sky-600 hover:underline break-all"
                                href={it.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {it.key}
                              </a>
                            </li>
                          ))}
                        </ul>
                        {hasMore && (
                          <button
                            type="button"
                            onClick={() => toggleGroup(groupKey)}
                            className="text-xs text-slate-500 hover:text-slate-700 hover:underline"
                          >
                            {expanded
                              ? "Show fewer"
                              : `Show all ${g.items.length} files`}
                          </button>
                        )}
                      </div>
                    );
                  })}

                  {groupedResults.unassigned.length > 0 && (
                    <div className="space-y-1">
                      {(() => {
                        const groupKey = "other";
                        const expanded = isGroupExpanded(groupKey);
                        const visible = expanded
                          ? groupedResults.unassigned
                          : groupedResults.unassigned.slice(0, RESULTS_PREVIEW_COUNT);
                        const hasMore =
                          groupedResults.unassigned.length > RESULTS_PREVIEW_COUNT;
                        return (
                          <>
                            <div className="text-xs font-semibold text-slate-600 flex items-center gap-2">
                              <span>Other outputs</span>
                              <span className="text-[10px] text-slate-400">
                                {groupedResults.unassigned.length} file
                                {groupedResults.unassigned.length === 1 ? "" : "s"}
                              </span>
                            </div>
                            <ul className="list-disc pl-5 space-y-1 text-sm">
                              {visible.map(it => (
                                <li key={it.key}>
                                  <a
                                    className="text-sky-600 hover:underline break-all"
                                    href={it.url}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {it.key}
                                  </a>
                                </li>
                              ))}
                            </ul>
                            {hasMore && (
                              <button
                                type="button"
                                onClick={() => toggleGroup(groupKey)}
                                className="text-xs text-slate-500 hover:text-slate-700 hover:underline"
                              >
                                {expanded
                                  ? "Show fewer"
                                  : `Show all ${groupedResults.unassigned.length} files`}
                              </button>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}
            </Motion.div>
          </>
        ) : null}
      </div>

      {recoveryPromptJobId && getJobAccessKey(recoveryPromptJobId) && (
        <div
          className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/45 px-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="recovery-download-title"
        >
          <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
              Job submitted
            </div>
            <h2 id="recovery-download-title" className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
              Download the recovery file
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Keep this file to reopen the job later.
            </p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setRecoveryPromptJobId("")}
                className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
              >
                Later
              </button>
              <button
                type="button"
                onClick={() => handleDownloadRecoveryFile(recoveryPromptJobId, true)}
                className="min-h-11 rounded-xl bg-emerald-700 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800"
              >
                Download recovery file
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
