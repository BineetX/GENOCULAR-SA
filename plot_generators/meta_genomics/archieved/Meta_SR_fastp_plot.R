#!/usr/bin/env Rscript
# ==============================================================================
# SCRIPT: fastp_quality_report.R
# PURPOSE: Generate publication-ready before-vs-after quality/content plots
#          from a fastp JSON report for a single metagenomic sample.
#          Auto-detects single-end vs paired-end runs from the JSON itself
#          (checks for presence of read2_before_filtering/read2_after_filtering).
#          Does NOT assume any fixed sample name, read length, or library type.
#
# EXPECTED CLI ARGUMENT ORDER:
#   arg1: FASTP_JSON  (Path to fastp.json)
#   arg2: OUTPUT_DIR  (Path to directory where logs and figures will be written)
#   arg3: SAMPLE_ID   (Explicit sample identifier string)
#
# EXAMPLE SLURM/CLI INVOCATION:
#   Rscript fastp_quality_report.R \
#     /path/to/fastp.json \
#     /path/to/output_dir \
#     SAMPLE123
#
# CHANGELOG:
#   - FIX: content_curves base keys in fastp JSON are UPPERCASE (A,T,C,G,N).
#   - IMPROVEMENT: Unified "Read State" legend (square color keys) applied
#     identically across Plots 1, 2, 3a, 3b.
#   - IMPROVEMENT: Subtitles wrapped with str_wrap(); figure widths increased
#     so no subtitle/legend text is clipped.
#   - IMPROVEMENT: Panel grid lines removed entirely; only deliberate
#     reference/threshold lines (Q30, 25% base composition) remain.
#   - REMOVED: Standalone captions on Plots 1, 2, and the old Plot 3a
#     "italic label..." subtitle clause.
#   - REMOVED: Plot 4 (duplication rate) entirely, per request. Only
#     Plots 1, 2, 3a, 3b are generated now.
#   - REMOVED: Plot 3a delta annotations (+X.XX pp labels above bars) and
#     the "pp = percentage-point..." explanatory caption, per request.
# ==============================================================================

# --- 0. PACKAGE LOADING & ERROR WRAPPING --------------------------------------
load_pkg <- function(pkg) {
  if (!requireNamespace(pkg, quietly = TRUE)) {
    stop(paste0("CRITICAL ERROR: Required R package '", pkg, "' is not installed."), call. = FALSE)
  }
  suppressPackageStartupMessages(library(pkg, character.only = TRUE))
}

load_pkg("jsonlite")
load_pkg("ggplot2")
load_pkg("dplyr")
load_pkg("tidyr")
load_pkg("stringr")

# --- 1. ARGUMENT VALIDATION & LOGGING SETUP -----------------------------------
args <- commandArgs(trailingOnly = TRUE)

if (length(args) < 3) {
  cat("FATAL ERROR: Incorrect number of arguments provided.\n", file = stderr())
  cat("USAGE: Rscript fastp_quality_report.R <FASTP_JSON> <OUTPUT_DIR> <SAMPLE_ID>\n", file = stderr())
  quit(save = "no", status = 1, runLast = FALSE)
}

fastp_json_path <- args[1]
output_dir      <- args[2]
sample_id       <- args[3]

if (!dir.exists(output_dir)) {
  dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
}

log_file <- file.path(output_dir, paste0(sample_id, "_fastp_run.log"))
log_con  <- file(log_file, open = "a")

log_msg <- function(...) {
  msg <- paste0("[", format(Sys.time(), "%Y-%m-%d %H:%M:%S"), "] ", paste(...), "\n")
  cat(msg)
  cat(msg, file = log_con)
}

log_msg("======================================================================")
log_msg("STARTING: fastp_quality_report.R")
log_msg("INPUT FASTP_JSON : ", fastp_json_path)
log_msg("OUTPUT_DIR       : ", output_dir)
log_msg("SAMPLE_ID        : ", sample_id)

tryCatch({

  # --- 2. FILE EXISTENCE & JSON VALIDATION ------------------------------------
  if (!file.exists(fastp_json_path)) {
    stop("Input FASTP JSON file not found: ", fastp_json_path, call. = FALSE)
  }
  log_msg("Reading input JSON file...")

  json_data <- tryCatch({
    jsonlite::fromJSON(fastp_json_path, simplifyVector = FALSE)
  }, error = function(e) {
    stop("Failed to parse JSON file '", fastp_json_path, "': ", e$message, call. = FALSE)
  })

  if (is.null(json_data$read1_before_filtering) || is.null(json_data$read1_after_filtering)) {
    stop("Malformed fastp report: 'read1_before_filtering' or 'read1_after_filtering' blocks are missing/null. ",
         "This script expects a standard fastp.json (run with --json), not a partial or custom report.",
         call. = FALSE)
  }
  if (is.null(json_data$summary$before_filtering) || is.null(json_data$summary$after_filtering)) {
    stop("Malformed fastp report: summary blocks for before/after filtering are missing/null.", call. = FALSE)
  }

  check_content_curve_keys <- function(block, block_name) {
    cc <- block$content_curves
    if (is.null(cc)) {
      log_msg("WARNING: content_curves missing entirely in ", block_name, ".")
      return(invisible(NULL))
    }
    expected <- c("A", "T", "C", "G", "N")
    present  <- expected %in% names(cc)
    if (!all(present)) {
      log_msg("WARNING: content_curves in ", block_name,
              " is missing expected uppercase keys: ",
              paste(expected[!present], collapse = ", "),
              ". Available keys: ", paste(names(cc), collapse = ", "))
    }
  }
  check_content_curve_keys(json_data$read1_before_filtering, "read1_before_filtering")
  check_content_curve_keys(json_data$read1_after_filtering,  "read1_after_filtering")

  is_paired <- !is.null(json_data$read2_before_filtering) && !is.null(json_data$read2_after_filtering)
  log_msg("Detected library layout: ", ifelse(is_paired, "PAIRED-END (R1 + R2)", "SINGLE-END (R1 only)"))

  if (is_paired) {
    check_content_curve_keys(json_data$read2_before_filtering, "read2_before_filtering")
    check_content_curve_keys(json_data$read2_after_filtering,  "read2_after_filtering")
  }

  # --- 3. GLOBAL PLOT THEME & PALETTES ----------------------------------------
  pub_theme <- theme_bw() +
    theme(
      plot.title       = element_text(size = 18, color = "black", face = "bold"),
      plot.subtitle    = element_text(size = 13, color = "black", face = "bold"),
      legend.text      = element_text(size = 12, color = "black", face = "bold"),
      legend.title     = element_text(size = 12, color = "black", face = "bold"),
      axis.text        = element_text(size = 14, color = "black", face = "bold"),
      axis.title       = element_text(size = 16, color = "black", face = "bold"),
      strip.text       = element_text(size = 14, color = "black", face = "bold"),
      plot.caption     = element_text(size = 11, color = "black", face = "italic"),
      legend.position  = "bottom",
      legend.key       = element_rect(fill = "white", color = NA),
      panel.grid       = element_blank()
    )

  pal_state    <- c("Raw" = "#E69F00", "Cleaned" = "#56B4E9")
  state_labels <- c("Raw" = "Raw read", "Cleaned" = "Clean read")

  scale_color_state <- function() {
    scale_color_manual(
      name   = "Read State:",
      values = pal_state,
      labels = state_labels,
      guide  = guide_legend(override.aes = list(linewidth = 6))
    )
  }
  scale_fill_state <- function() {
    scale_fill_manual(
      name   = "Read State:",
      values = pal_state,
      labels = state_labels
    )
  }

  wrap_sub <- function(x, width = 95) paste(str_wrap(x, width = width), collapse = "\n")

  save_plot_pair <- function(plot_obj, name_prefix, width = 10, height = 7) {
    for (ext in c(".svg", ".pdf")) {
      fname <- file.path(output_dir, paste0(name_prefix, ext))
      ggsave(filename = fname, plot = plot_obj, width = width, height = height, units = "in", dpi = 300)
    }
    log_msg("Saved plot: ", name_prefix, " (.svg and .pdf)")
  }

  # --- 4. PLOT 1: PER-BASE QUALITY CURVE --------------------------------------
  log_msg("Generating Plot 1: Per-base quality curve...")

  build_quality_df <- function(block, state_label, read_label) {
    vals <- unlist(block$quality_curves$mean)
    if (is.null(vals) || length(vals) == 0) return(NULL)
    data.frame(
      Position    = seq_along(vals),
      MeanQuality = as.numeric(vals),
      State       = state_label,
      Read        = read_label,
      stringsAsFactors = FALSE
    )
  }

  q_list <- list(
    build_quality_df(json_data$read1_before_filtering, "Raw",     "R1"),
    build_quality_df(json_data$read1_after_filtering,  "Cleaned", "R1")
  )
  if (is_paired) {
    q_list <- c(q_list, list(
      build_quality_df(json_data$read2_before_filtering, "Raw",     "R2"),
      build_quality_df(json_data$read2_after_filtering,  "Cleaned", "R2")
    ))
  }
  df_q <- bind_rows(q_list)
  if (nrow(df_q) == 0) {
    stop("Mean quality curves are empty in JSON report for all available read blocks.", call. = FALSE)
  }
  df_q$State <- factor(df_q$State, levels = c("Raw", "Cleaned"))
  df_q$Read  <- factor(df_q$Read, levels = c("R1", "R2"))

  tot_reads_before <- as.numeric(json_data$summary$before_filtering$total_reads)
  tot_reads_clean  <- as.numeric(json_data$summary$after_filtering$total_reads)
  tot_bases_before <- as.numeric(json_data$summary$before_filtering$total_bases)
  tot_bases_clean  <- as.numeric(json_data$summary$after_filtering$total_bases)

  pct_reads_discarded <- 100 * (tot_reads_before - tot_reads_clean) / tot_reads_before
  pct_bases_discarded <- 100 * (tot_bases_before - tot_bases_clean) / tot_bases_before

  sub_text_p1 <- wrap_sub(paste0(
    "Sample ID: ", sample_id,
    " | Retained reads: ", formatC(tot_reads_clean, format = "f", big.mark = ",", digits = 0),
    " | Reads discarded: ", sprintf("%.2f%%", pct_reads_discarded),
    " | Bases discarded: ", sprintf("%.2f%%", pct_bases_discarded)
  ))

  y_max_p1 <- max(40, max(df_q$MeanQuality, na.rm = TRUE))

  p1 <- ggplot(df_q, aes(x = Position, y = MeanQuality, color = State)) +
    geom_hline(yintercept = 30, linetype = "dashed", color = "gray30", linewidth = 0.8) +
    annotate("text", x = max(df_q$Position) * 0.02, y = 30, label = "Q30",
             hjust = 0, vjust = -0.6, size = 4.2, fontface = "bold", color = "gray30") +
    geom_line(linewidth = 1.1) +
    scale_color_state() +
    scale_x_continuous(expand = c(0.01, 0)) +
    scale_y_continuous(limits = c(0, y_max_p1), expand = c(0, 0)) +
    labs(
      title    = "Per-Base Mean Quality Score",
      subtitle = sub_text_p1,
      x        = "Read Position (bp)",
      y        = "Mean Phred Quality Score"
    ) +
    pub_theme

  if (is_paired) p1 <- p1 + facet_wrap(~Read, ncol = 1)

  save_plot_pair(p1, paste0(sample_id, "_fastp_per_base_quality"),
                 width = 10, height = if (is_paired) 9 else 7)

  # --- 5. PLOT 2: PER-BASE CONTENT CURVE --------------------------------------
  log_msg("Generating Plot 2: Per-base content curve...")

  parse_content <- function(block, state_label, read_label) {
    bases <- c("A", "T", "C", "G", "N")
    df_list <- list()
    cc <- block$content_curves
    if (is.null(cc)) return(data.frame())
    for (b in bases) {
      vals <- unlist(cc[[b]])
      if (!is.null(vals) && length(vals) > 0) {
        df_list[[b]] <- data.frame(
          Position = seq_along(vals),
          Content  = as.numeric(vals) * 100,
          Base     = b,
          State    = state_label,
          Read     = read_label,
          stringsAsFactors = FALSE
        )
      }
    }
    bind_rows(df_list)
  }

  c_list <- list(
    parse_content(json_data$read1_before_filtering, "Raw",     "R1"),
    parse_content(json_data$read1_after_filtering,  "Cleaned", "R1")
  )
  if (is_paired) {
    c_list <- c(c_list, list(
      parse_content(json_data$read2_before_filtering, "Raw",     "R2"),
      parse_content(json_data$read2_after_filtering,  "Cleaned", "R2")
    ))
  }
  df_c <- bind_rows(c_list)
  if (nrow(df_c) == 0) {
    stop("Content curves are empty in JSON report for all available read blocks.", call. = FALSE)
  }
  df_c$State <- factor(df_c$State, levels = c("Raw", "Cleaned"))
  df_c$Read  <- factor(df_c$Read, levels = c("R1", "R2"))

  max_n <- suppressWarnings(max(df_c$Content[df_c$Base == "N"], na.rm = TRUE))
  if (!is.finite(max_n) || max_n <= 0.1) {
    log_msg("Omitted N facet from Plot 2: Max N content is ", round(ifelse(is.finite(max_n), max_n, 0), 4),
            "% (<= 0.1% threshold).")
    df_c <- filter(df_c, Base %in% c("A", "T", "C", "G"))
  } else {
    log_msg("Included N facet in Plot 2: Max N content is ", round(max_n, 4), "% (> 0.1% threshold).")
    df_c <- filter(df_c, Base %in% c("A", "T", "C", "G", "N"))
  }
  df_c$Base <- factor(df_c$Base, levels = c("A", "T", "C", "G", "N"))

  n_bases       <- nlevels(df_c$Base)
  n_reads_facet <- if (is_paired) nlevels(df_c$Read) else 1

  sub_text_p2 <- wrap_sub(paste0(
    "Sample ID: ", sample_id,
    " | Evaluated over native read lengths",
    " | Reads discarded: ", sprintf("%.2f%%", pct_reads_discarded),
    " | Bases discarded: ", sprintf("%.2f%%", pct_bases_discarded)
  ))

  p2 <- ggplot(df_c, aes(x = Position, y = Content, color = State)) +
    geom_hline(yintercept = 25, linetype = "dotted", color = "gray40", linewidth = 0.6) +
    geom_line(linewidth = 1.0) +
    scale_color_state() +
    scale_x_continuous(expand = c(0.01, 0)) +
    scale_y_continuous(expand = expansion(mult = c(0, 0.05))) +
    labs(
      title    = "Per-Base Sequence Content Composition",
      subtitle = sub_text_p2,
      x        = "Read Position (bp)",
      y        = "Base Content (%)"
    ) +
    pub_theme

  if (is_paired) {
    p2 <- p2 + facet_grid(Read ~ Base, scales = "free_y")
  } else {
    p2 <- p2 + facet_wrap(~Base, ncol = 2, scales = "free_y")
  }

  p2_width  <- max(12, n_bases * 3.0)
  p2_height <- max(6, n_reads_facet * 3.5)

  save_plot_pair(p2, paste0(sample_id, "_fastp_per_base_content"),
                 width = p2_width, height = p2_height)

  # --- 6. PLOT 3a: Q20 AND Q30 QC RATES ---------------------------------------
  log_msg("Generating Plot 3a: Q20/Q30 rate comparison...")

  extract_rate <- function(summary_block, rate_name) {
    val <- as.numeric(summary_block[[rate_name]])
    if (!is.na(val) && val <= 1.0001) val <- val * 100
    val
  }

  q20_raw   <- extract_rate(json_data$summary$before_filtering, "q20_rate")
  q20_clean <- extract_rate(json_data$summary$after_filtering,  "q20_rate")
  q30_raw   <- extract_rate(json_data$summary$before_filtering, "q30_rate")
  q30_clean <- extract_rate(json_data$summary$after_filtering,  "q30_rate")

  df_qc <- data.frame(
    Metric = rep(c("Q20 Rate", "Q30 Rate"), each = 2),
    State  = rep(c("Raw", "Cleaned"), times = 2),
    Rate   = c(q20_raw, q20_clean, q30_raw, q30_clean),
    stringsAsFactors = FALSE
  )
  df_qc$State  <- factor(df_qc$State, levels = c("Raw", "Cleaned"))
  df_qc$Metric <- factor(df_qc$Metric, levels = c("Q20 Rate", "Q30 Rate"))

  sub_text_p3a <- wrap_sub(paste0(
    "Sample ID: ", sample_id, " | Overall read quality improvement after filtering"
  ))

  p3a <- ggplot(df_qc, aes(x = Metric, y = Rate, fill = State)) +
    geom_bar(stat = "identity", position = position_dodge(width = 0.8), width = 0.7) +
    geom_text(aes(label = sprintf("%.2f%%", Rate)),
              position = position_dodge(width = 0.8),
              vjust = -0.5, size = 4.5, fontface = "bold", color = "black") +
    scale_fill_state() +
    scale_y_continuous(limits = c(0, 112), expand = c(0, 0)) +
    labs(
      title    = "Quality Threshold Compliance (Q20 / Q30 Rates)",
      subtitle = sub_text_p3a,
      x        = "Quality Metric",
      y        = "Percentage of Bases (%)"
    ) +
    pub_theme

  save_plot_pair(p3a, paste0(sample_id, "_fastp_qc_rates"), width = 9.5, height = 6.5)

  # --- 7. PLOT 3b: TOTAL READS RETAINED ---------------------------------------
  log_msg("Generating Plot 3b: Reads retained bar chart...")

  df_reads <- data.frame(
    State = factor(c("Raw", "Cleaned"), levels = c("Raw", "Cleaned")),
    Count = c(tot_reads_before, tot_reads_clean),
    stringsAsFactors = FALSE
  )

  sub_text_p3b <- wrap_sub(paste0(
    "Sample ID: ", sample_id, " | Reads discarded: ", sprintf("%.2f%%", pct_reads_discarded)
  ))

  p3b <- ggplot(df_reads, aes(x = State, y = Count, fill = State)) +
    geom_bar(stat = "identity", width = 0.55) +
    geom_text(aes(label = formatC(Count, format = "f", big.mark = ",", digits = 0)),
              vjust = -0.5, size = 4.5, fontface = "bold", color = "black") +
    scale_fill_state() +
    scale_x_discrete(labels = state_labels) +
    scale_y_continuous(expand = expansion(mult = c(0, 0.12)),
                       labels = function(x) formatC(x, format = "f", big.mark = ",", digits = 0)) +
    labs(
      title    = "Total Reads Retained Before vs. After Filtering",
      subtitle = sub_text_p3b,
      x        = "Read State",
      y        = "Total Read Count"
    ) +
    pub_theme

  save_plot_pair(p3b, paste0(sample_id, "_fastp_reads_retained"), width = 7.5, height = 6.5)

  # --- 8. REPRODUCIBILITY SUMMARY & EXIT SUCCESS ------------------------------
  # NOTE: Plot 4 (duplication rate) has been removed per request. Only
  # Plots 1, 2, 3a, 3b are generated by this script now.
  log_msg("======================================================================")
  log_msg("ALL PLOTS SUCCESSFULLY GENERATED.")
  log_msg("Library layout used: ", ifelse(is_paired, "paired-end (R1+R2)", "single-end (R1 only)"))
  log_msg("R SESSION INFORMATION FOR REPRODUCIBILITY AUDIT:")
  log_msg(paste(capture.output(sessionInfo()), collapse = "\n"))
  log_msg("======================================================================")

}, error = function(e) {
  log_msg("FATAL PIPELINE EXCEPTION: ", e$message)
  if (exists("log_con") && isOpen(log_con)) close(log_con)
  quit(save = "no", status = 1, runLast = FALSE)
}, finally = {
  if (exists("log_con") && isOpen(log_con)) close(log_con)
})

quit(save = "no", status = 0, runLast = FALSE)
