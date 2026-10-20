#!/usr/bin/env Rscript
# ==============================================================================
# genome_mapping_plots_density_only.R
#
# Genome Mapping (Coverage Profiling) — single-sample metagenomics
# Produces ONLY the Coverage Density Plot, based on a depth table.
#
# ROBUSTNESS UPDATE (2026-07-29):
#   Different upstream depth-calling tools produce different column schemas:
#     - Short-read (MetaBAT2 jgi_summarize_bam_contig_depths):
#         contigName, contigLen, totalAvgDepth, <bam>.bam, <bam>.bam-var, ...
#     - Long-read (CoverM / samtools coverage style, e.g. minimap2 pipelines):
#         Contig, <sample>.sorted Mean, <sample>.sorted Covered Fraction,
#         <sample>.sorted Length, ...
#     - Hybrid pipelines may emit either schema depending on which mapper/
#       depth tool was used for a given sample, or a merged table with both
#       naming conventions across runs.
#
#   Hard-coding "contigName"/"totalAvgDepth" broke the script the moment it
#   was fed a long-read depth table. This version auto-detects the contig-ID
#   column and the mean-depth column via case-insensitive pattern matching,
#   normalizes them to a standard internal schema (contigName, totalAvgDepth),
#   and logs which columns were selected (and which candidates were seen) so
#   future format drift is easy to diagnose. All downstream plotting logic is
#   unchanged.
#
# STYLING UPDATE (2026-08-01):
#   Removed all panel gridlines (major and minor) from the theme. The plot
#   now shows only the plot border/axis lines, axis ticks, and axis text —
#   no horizontal or vertical gridlines inside the panel. Any threshold
#   lines added via geom_vline()/geom_hline() (none currently drawn by this
#   script, but supported if added later) are unaffected by this change,
#   since those are separate plot layers, not panel gridlines.
#
# EXPECTED CLI ARGUMENT ORDER (positional, via commandArgs(trailingOnly = TRUE)):
#   arg1: DEPTH_TXT     - path to depth table (tab-delimited)
#   arg2: OUTPUT_DIR    - directory in which plots and log file are written
#   arg3: SAMPLE_ID     - sample identifier string, used in filenames/titles
#
# Example invocation:
#   Rscript genome_mapping_plots_density_only.R /path/to/depth.txt \
#           /path/to/output_dir my_sample_123
# ==============================================================================

suppressWarnings(suppressMessages({
  quiet_library <- function(pkg) {
    ok <- requireNamespace(pkg, quietly = TRUE)
    if (!ok) {
      stop(sprintf("Required package '%s' is not installed. Please install it before running this script.", pkg))
    }
    library(pkg, character.only = TRUE)
  }
}))

# ------------------------------------------------------------------------
# 0. Argument parsing & validation
# ------------------------------------------------------------------------
args <- commandArgs(trailingOnly = TRUE)

if (length(args) != 3) {
  message(sprintf(
    "[%s] ERROR: Expected 3 positional arguments (DEPTH_TXT, OUTPUT_DIR, SAMPLE_ID), got %d.",
    format(Sys.time(), "%Y-%m-%d %H:%M:%S"), length(args)
  ))
  message("Usage: Rscript genome_mapping_plots_density_only.R <DEPTH_TXT> <OUTPUT_DIR> <SAMPLE_ID>")
  quit(status = 1)
}

depth_txt_path <- args[1]
output_dir     <- args[2]
sample_id      <- args[3]

if (!dir.exists(output_dir)) {
  dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
}

log_path <- file.path(output_dir, paste0(sample_id, "_GenomeMapping_run.log"))
log_con  <- file(log_path, open = "wt")

log_msg <- function(...) {
  msg <- paste0("[", format(Sys.time(), "%Y-%m-%d %H:%M:%S"), "] ", paste0(..., collapse = " "))
  cat(msg, "\n", file = log_con, append = TRUE)
  cat(msg, "\n")
}

log_msg("=== genome_mapping_plots_density_only.R started ===")
log_msg("Resolved DEPTH_TXT    : ", depth_txt_path)
log_msg("Resolved OUTPUT_DIR   : ", output_dir)
log_msg("Resolved SAMPLE_ID    : ", sample_id)

# ------------------------------------------------------------------------
# 1. Dependencies
# ------------------------------------------------------------------------
tryCatch({
  quiet_library("ggplot2")
  quiet_library("dplyr")
  quiet_library("readr")
  quiet_library("stringr")
  log_msg("STEP: Dependencies loaded successfully (ggplot2, dplyr, readr, stringr).")
}, error = function(e) {
  log_msg("FATAL ERROR while loading dependencies: ", conditionMessage(e))
  close(log_con)
  quit(status = 1)
})

# ------------------------------------------------------------------------
# 2. Publication theme (single reusable object; applied to the plot)
# ------------------------------------------------------------------------
# panel.grid.major and panel.grid.minor are both blanked so the plot panel
# shows no internal gridlines at all -- only the axis lines/ticks (from
# theme_bw()'s panel border) and axis text remain.
pub_theme <- theme_bw(base_size = 14) +
  theme(
    plot.title      = element_text(size = 18, color = "black", face = "bold"),
    plot.subtitle   = element_text(size = 13, color = "black", face = "bold"),
    legend.text     = element_text(size = 12, color = "black", face = "bold"),
    legend.title    = element_text(size = 12, color = "black", face = "bold"),
    axis.text       = element_text(size = 14, color = "black", face = "bold"),
    axis.title      = element_text(size = 16, color = "black", face = "bold"),
    panel.grid.major = element_blank(),
    panel.grid.minor = element_blank()
  )

# ------------------------------------------------------------------------
# 2b. Schema auto-detection helpers
# ------------------------------------------------------------------------
# Candidate patterns (checked in order, case-insensitive) for the contig-ID
# column and the mean-depth column, across known depth-file conventions:
#   - MetaBAT2 / jgi_summarize_bam_contig_depths  (short-read pipelines)
#   - CoverM / samtools coverage style             (long-read pipelines)
#   - Generic minimap2/samtools depth summaries    (hybrid pipelines)
CONTIG_ID_PATTERNS <- c(
  "^contigName$", "^contig$", "^contig_id$", "^name$", "^#rname$", "^rname$"
)

DEPTH_COL_PATTERNS <- c(
  "^totalAvgDepth$",          # MetaBAT2 jgi_summarize
  "^avg[_ ]?depth$",
  "^meandepth$",
  "\\bmean$",                 # e.g. "SRR14307796.sorted Mean" (CoverM style)
  "\\bmean[_ ]?depth\\b",
  "\\bcoverage$",
  "^depth$"
)

detect_column <- function(colnames_vec, patterns, label, log_fn) {
  for (pat in patterns) {
    hits <- colnames_vec[grepl(pat, colnames_vec, ignore.case = TRUE, perl = TRUE)]
    if (length(hits) >= 1) {
      chosen <- hits[1]
      if (length(hits) > 1) {
        log_fn("NOTE: Multiple candidate ", label, " columns matched pattern '",
               pat, "': ", paste(hits, collapse = ", "),
               " -- using first match: '", chosen, "'.")
      }
      return(chosen)
    }
  }
  return(NA_character_)
}

# ------------------------------------------------------------------------
# 3. Main logic
# ------------------------------------------------------------------------
result <- tryCatch({

  # --- 3a. Existence checks -------------------------------------------------
  if (!file.exists(depth_txt_path)) {
    stop("Input DEPTH_TXT file does not exist at path: ", depth_txt_path)
  }
  log_msg("STEP: Verified existence of input file.")

  # --- 3b. Read depth table --------------------------------------------------
  depth_df_raw <- readr::read_tsv(depth_txt_path, show_col_types = FALSE, progress = FALSE)
  orig_colnames <- colnames(depth_df_raw)
  log_msg("STEP: Read DEPTH_TXT. Rows: ", nrow(depth_df_raw), " | Columns: ", paste(orig_colnames, collapse = ", "))

  # --- 3b-i. Auto-detect schema (short-read / long-read / hybrid) -----------
  contig_col <- detect_column(orig_colnames, CONTIG_ID_PATTERNS, "contig-ID", log_msg)
  depth_col  <- detect_column(orig_colnames, DEPTH_COL_PATTERNS, "mean-depth", log_msg)

  if (is.na(contig_col) || is.na(depth_col)) {
    stop(
      "Could not auto-detect required column(s) in DEPTH_TXT.\n",
      "  Contig-ID column detected : ", ifelse(is.na(contig_col), "NOT FOUND", contig_col), "\n",
      "  Mean-depth column detected: ", ifelse(is.na(depth_col), "NOT FOUND", depth_col), "\n",
      "  Available columns in file : ", paste(orig_colnames, collapse = ", "), "\n",
      "  Please check the depth-file format, or extend CONTIG_ID_PATTERNS / ",
      "DEPTH_COL_PATTERNS in this script to cover the new naming convention."
    )
  }

  log_msg("STEP: Schema auto-detected. Using contig-ID column '", contig_col,
          "' and mean-depth column '", depth_col, "'.")

  # Normalize to the standard internal schema used by all downstream logic.
  depth_df <- depth_df_raw %>%
    dplyr::rename(contigName = !!contig_col, totalAvgDepth = !!depth_col) %>%
    dplyr::mutate(
      contigName = as.character(contigName),
      totalAvgDepth = suppressWarnings(as.numeric(totalAvgDepth))
    )

  n_na_depth <- sum(is.na(depth_df$totalAvgDepth))
  if (n_na_depth > 0) {
    log_msg("WARNING: ", n_na_depth, " row(s) had non-numeric totalAvgDepth and were coerced to NA.")
  }
  depth_df <- depth_df %>% dplyr::filter(!is.na(totalAvgDepth))
  log_msg("STEP: Depth table cleaned. Rows retained: ", nrow(depth_df))

  if (nrow(depth_df) == 0) {
    stop("No usable rows remain in DEPTH_TXT after cleaning (all totalAvgDepth values were non-numeric/NA).")
  }

  # --- 3c. Derived columns ----------------------------------------------------
  depth_df <- depth_df %>%
    dplyr::mutate(
      log10_depth = log10(totalAvgDepth + 1)
    )

  n_contigs_total <- nrow(depth_df)

  # ==========================================================================
  # PLOT 1: Coverage Density Plot
  # ==========================================================================
  log_msg("STEP: Generating Plot 1 (Coverage Density Plot).")

  subtitle_1 <- paste0("Sample ID: ", sample_id, " | Total contigs analyzed: ", n_contigs_total)

  # Use Sheather-Jones bandwidth selector to avoid over-smoothing true
  # multi-modal peaks (default Silverman bandwidth risks masking bins).
  # Guard against degenerate input (e.g. long-read assemblies with very few
  # contigs, or near-zero variance in depth) where bw.SJ() can fail outright.
  dens_obj <- tryCatch(
    {
      if (n_contigs_total < 5 || stats::sd(depth_df$log10_depth, na.rm = TRUE) == 0) {
        stop("Insufficient variation/sample size for bw='SJ'; using default bandwidth.")
      }
      density(depth_df$log10_depth, bw = "SJ")
    },
    error = function(e) {
      log_msg("WARNING: bw='SJ' failed or was skipped (", conditionMessage(e), "); falling back to default bandwidth.")
      density(depth_df$log10_depth)
    }
  )
  log_msg("STEP: Density estimate computed. Bandwidth: ", round(dens_obj$bw, 4))

  x_max_plot <- max(5, ceiling(max(depth_df$log10_depth, na.rm = TRUE)))

  p1 <- ggplot(depth_df, aes(x = log10_depth)) +
    geom_density(fill = "steelblue", alpha = 0.6, color = "black",
                 linewidth = 0.6, bw = dens_obj$bw) +
    scale_x_continuous(breaks = seq(0, x_max_plot, by = 1), limits = c(0, x_max_plot)) +
    # Remove the default top/bottom padding on the y-axis so the density
    # curve sits directly on the x-axis instead of appearing to "float".
    scale_y_continuous(expand = expansion(mult = c(0, 0.05))) +
    labs(
      title = "Contig Coverage Density Distribution",
      subtitle = subtitle_1,
      x = expression(log[10]*"(Average Depth + 1)"),
      y = "Density"
    ) +
    pub_theme

  density_svg <- file.path(output_dir, paste0(sample_id, "_mapping_coverage_density.svg"))
  density_pdf <- file.path(output_dir, paste0(sample_id, "_mapping_coverage_density.pdf"))

  ggsave(filename = density_svg, plot = p1, width = 10, height = 7, units = "in", dpi = 300)
  ggsave(filename = density_pdf, plot = p1, width = 10, height = 7, units = "in", dpi = 300)
  log_msg("STEP: Saved Plot 1 to: ", density_svg, " and ", density_pdf)

  log_msg("STEP: Density plot generated successfully.")
  TRUE

}, error = function(e) {
  log_msg("FATAL ERROR: ", conditionMessage(e))
  log_msg("=== genome_mapping_plots_density_only.R terminated with error ===")
  close(log_con)
  quit(status = 1)
})

# ------------------------------------------------------------------------
# 4. Reproducibility / validation hook
# ------------------------------------------------------------------------
log_msg("=== Session Info (for reproducibility validation) ===")
session_lines <- capture.output(sessionInfo())
for (ln in session_lines) {
  cat(paste0("[", format(Sys.time(), "%Y-%m-%d %H:%M:%S"), "] ", ln), "\n", file = log_con, append = TRUE)
}

log_msg("=== genome_mapping_plots_density_only.R completed successfully ===")
close(log_con)
quit(status = 0)
