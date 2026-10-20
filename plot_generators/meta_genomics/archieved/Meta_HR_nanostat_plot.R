#!/usr/bin/env Rscript
# ==============================================================================
# SCRIPT: nanostat_raw_vs_cleaned.R  (v4)
# PURPOSE: Ingest NanoStat --tsv output for raw and cleaned reads of a single
#          metagenomic sample and generate publication-ready QC comparison plots.
#
# EXPECTED CLI ARGUMENT ORDER (EXACT):
#   arg1: RAW_NANOSTAT_TSV     (path to NanoStat --tsv output on raw.fastq)
#   arg2: CLEANED_NANOSTAT_TSV (path to NanoStat --tsv output on filtered.fastq)
#   arg3: OUTPUT_DIR           (path to output directory for figures and log)
#   arg4: SAMPLE_ID            (string, explicit sample identifier)
#
# CHANGELOG (v4):
#   - Yield Metrics plot: fixed, explicit per-facet y-axis breaks using
#     ggh4x::facetted_pos_scales (base ggplot2 cannot assign different break
#     sequences to different facets under scales = "free_y"):
#       Number of reads : 0, 5M, 10M, 15M  (raw values internally /1e6 to share
#                                            the same numeric range as bases)
#       Total bases (Gb): 0, 5, 10, 15
#       N50 (bp)         : 0, 1K, 2K, 3K, 4K, 5K
#     Bar VALUE LABELS (e.g. "12.6M reads") still derive from original
#     unscaled values -- only the axis grid/breaks are affected.
#   - Requires the 'ggh4x' package (install.packages("ggh4x") if missing).
#   - Raw/Cleaned color palette updated to user-specified #F8766D / #00BFC4.
#
# CHANGELOG (v3, carried forward):
#   - Read Length Metrics plot removed. Only Yield Metrics + Quality
#     Threshold Curve are generated.
#   - All background panel gridlines removed (major + minor) on both plots.
#   - Quality plot: black data labels, vertically offset per condition to
#     avoid overlap.
#   - Bold black axis lines/ticks (width 0.7) on both plots.
#   - Yield plot: black bar outlines (width 0.3).
# ==============================================================================

# --- Argument Parsing & Initial Validation ---
args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 4) {
  stop("FATAL ERROR: Invalid argument count. Expected exactly 4 positional arguments:\n",
       "  1: RAW_NANOSTAT_TSV\n",
       "  2: CLEANED_NANOSTAT_TSV\n",
       "  3: OUTPUT_DIR\n",
       "  4: SAMPLE_ID\n",
       "Received ", length(args), " argument(s).")
}

raw_tsv_path     <- args[1]
cleaned_tsv_path <- args[2]
output_dir       <- args[3]
sample_id        <- args[4]

if (!dir.exists(output_dir)) {
  dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
}

log_file_path <- file.path(output_dir, paste0(sample_id, "_NanoStat_run.log"))

log_msg <- function(msg, level = "INFO") {
  timestamp <- format(Sys.time(), "%Y-%m-%d %H:%M:%S")
  log_line <- sprintf("[%s] [%s] %s", timestamp, level, msg)
  cat(log_line, "\n")
  cat(log_line, "\n", file = log_file_path, append = TRUE)
}

load_package <- function(pkg) {
  if (!requireNamespace(pkg, quietly = TRUE)) {
    log_msg(sprintf("Required R package '%s' is not installed.", pkg), level = "ERROR")
    stop(sprintf("Package missing: %s. Install with install.packages('%s').", pkg, pkg))
  }
  suppressPackageStartupMessages(library(pkg, character.only = TRUE))
}

tryCatch({
  log_msg("=== NanoStat Raw vs Cleaned QC Script Started ===")
  log_msg(sprintf("Sample ID            : %s", sample_id))
  log_msg(sprintf("Raw NanoStat TSV     : %s", raw_tsv_path))
  log_msg(sprintf("Cleaned NanoStat TSV : %s", cleaned_tsv_path))
  log_msg(sprintf("Output Directory     : %s", output_dir))

  log_msg("Loading required libraries...")
  load_package("ggplot2")
  load_package("scales")
  load_package("ggh4x")
  log_msg("All dependencies loaded successfully.")

  check_input_file <- function(filepath, label) {
    if (!file.exists(filepath)) {
      err <- sprintf("Input file [%s] does not exist at path: %s", label, filepath)
      log_msg(err, level = "ERROR")
      stop(err)
    }
    if (file.info(filepath)$size == 0) {
      err <- sprintf("Input file [%s] is empty (0 bytes): %s", label, filepath)
      log_msg(err, level = "ERROR")
      stop(err)
    }
  }

  check_input_file(raw_tsv_path, "RAW_NANOSTAT_TSV")
  check_input_file(cleaned_tsv_path, "CLEANED_NANOSTAT_TSV")

  # --- Publication Typography Theme ---
  pub_theme <- theme_bw() +
    theme(
      plot.title       = element_text(size = 18, color = "black", face = "bold"),
      plot.subtitle    = element_text(size = 13, color = "black", face = "bold"),
      legend.text      = element_text(size = 12, color = "black", face = "bold"),
      legend.title     = element_text(size = 12, color = "black", face = "bold"),
      axis.text        = element_text(size = 14, color = "black", face = "bold"),
      axis.title       = element_text(size = 16, color = "black", face = "bold"),
      strip.text       = element_text(size = 14, color = "black", face = "bold"),
      legend.position  = "top",
      panel.grid.major = element_blank(),
      panel.grid.minor = element_blank(),
      panel.border     = element_blank(),
      axis.line        = element_line(color = "black", linewidth = 0.7),
      axis.ticks       = element_line(color = "black", linewidth = 0.7)
    )

  # Raw/Cleaned palette (user-updated hex values)
  raw_cleaned_colors <- c("Raw" = "#F8766D", "Cleaned" = "#00BFC4")

  parse_nanostat_tsv <- function(filepath, label) {
    log_msg(sprintf("Parsing NanoStat TSV file [%s]: %s", label, filepath))
    lines <- readLines(filepath, warn = FALSE)
    lines <- lines[nchar(trimws(lines)) > 0]

    parsed <- list()
    for (line in lines) {
      parts <- strsplit(line, "\t")[[1]]
      if (length(parts) < 2) {
        parts <- strsplit(line, ":\\s*|\\t+")[[1]]
      }
      if (length(parts) >= 2) {
        key <- trimws(sub(":$", "", parts[1]))
        val <- trimws(parts[2])
        parsed[[key]] <- val
      }
    }
    log_msg(sprintf("Parsed %d key-value rows from [%s].", length(parsed), label))
    return(parsed)
  }

  match_metric_value <- function(parsed_list, patterns, metric_name) {
    for (pat in patterns) {
      matched_key <- grep(pat, names(parsed_list), ignore.case = TRUE, value = TRUE)
      if (length(matched_key) > 0) {
        raw_val_str <- parsed_list[[matched_key[1]]]
        clean_str <- gsub(",", "", as.character(raw_val_str))
        m <- regexpr("[-+]?[0-9]*\\.?[0-9]+([eE][-+]?[0-9]+)?", clean_str, perl = TRUE)
        if (m != -1) {
          num_val <- as.numeric(regmatches(clean_str, m))
          return(num_val)
        }
      }
    }
    log_msg(sprintf("WARNING: Metric '%s' not found or non-numeric.", metric_name), level = "WARN")
    return(NA_real_)
  }

  extract_q_threshold_percentages <- function(parsed_list, label) {
    key_names <- names(parsed_list)
    q_key_idx <- grep("Q[0-9]+", key_names, ignore.case = TRUE)

    results <- numeric(0)
    for (idx in q_key_idx) {
      key <- key_names[idx]
      level_match <- regmatches(key, regexpr("Q[0-9]+", key, ignore.case = TRUE))
      if (length(level_match) == 0) next
      q_label <- toupper(level_match)

      val_str <- parsed_list[[key]]
      pct_val <- NA_real_

      if (grepl("%", val_str)) {
        m <- regexpr("[0-9.]+(?=\\s*%)", val_str, perl = TRUE)
        if (m != -1) pct_val <- as.numeric(regmatches(val_str, m))
      } else if (grepl("\\([0-9.]+\\s*%?\\)", val_str)) {
        m <- regexpr("(?<=\\()[0-9.]+(?=\\s*%?\\))", val_str, perl = TRUE)
        if (m != -1) pct_val <- as.numeric(regmatches(val_str, m))
      } else {
        clean_str <- gsub(",", "", val_str)
        m <- regexpr("[-+]?[0-9]*\\.?[0-9]+", clean_str, perl = TRUE)
        if (m != -1) {
          num_val <- as.numeric(regmatches(clean_str, m))
          pct_val <- if (!is.na(num_val) && num_val <= 1.0 && num_val > 0) num_val * 100 else num_val
        }
      }

      if (!is.na(pct_val)) {
        if (!(q_label %in% names(results))) {
          results[q_label] <- pct_val
        }
      }
    }
    log_msg(sprintf("Detected Q-thresholds in [%s]: %s", label,
                     if (length(results) > 0) paste(names(results), collapse = ", ") else "NONE"))
    return(results)
  }

  raw_parsed     <- parse_nanostat_tsv(raw_tsv_path, "Raw")
  cleaned_parsed <- parse_nanostat_tsv(cleaned_tsv_path, "Cleaned")

  raw_reads      <- match_metric_value(raw_parsed, c("^number(\\s|_)*of(\\s|_)*reads$", "^reads$"), "Number of reads")
  cleaned_reads  <- match_metric_value(cleaned_parsed, c("^number(\\s|_)*of(\\s|_)*reads$", "^reads$"), "Number of reads")

  raw_bases_bp     <- match_metric_value(raw_parsed, c("^total(\\s|_)*bases$", "^number(\\s|_)*of(\\s|_)*bases$"), "Total bases")
  cleaned_bases_bp <- match_metric_value(cleaned_parsed, c("^total(\\s|_)*bases$", "^number(\\s|_)*of(\\s|_)*bases$"), "Total bases")
  raw_bases_gb     <- raw_bases_bp / 1e9
  cleaned_bases_gb <- cleaned_bases_bp / 1e9

  raw_n50      <- match_metric_value(raw_parsed, c("^read(\\s|_)*length(\\s|_)*n50$", "^n50$"), "N50")
  cleaned_n50  <- match_metric_value(cleaned_parsed, c("^read(\\s|_)*length(\\s|_)*n50$", "^n50$"), "N50")

  raw_mean_q     <- match_metric_value(raw_parsed, c("^mean(\\s|_)*read(\\s|_)*quality$", "^mean(\\s|_)*quality$", "^mean(\\s|_)*qual$"), "Mean read quality")
  cleaned_mean_q <- match_metric_value(cleaned_parsed, c("^mean(\\s|_)*read(\\s|_)*quality$", "^mean(\\s|_)*quality$", "^mean(\\s|_)*qual$"), "Mean read quality")

  raw_q_vals     <- extract_q_threshold_percentages(raw_parsed, "Raw")
  cleaned_q_vals <- extract_q_threshold_percentages(cleaned_parsed, "Cleaned")

  format_yield_label <- function(vals, metrics) {
    sapply(seq_along(vals), function(i) {
      v <- vals[i]
      m <- as.character(metrics[i])
      if (is.na(v)) return("NA")
      if (m == "Number of reads") {
        if (v >= 1e6) {
          sprintf("%.1fM reads", v / 1e6)
        } else if (v >= 1e3) {
          sprintf("%.1fK reads", v / 1e3)
        } else {
          sprintf("%d reads", as.integer(v))
        }
      } else if (m == "Total bases (Gb)") {
        sprintf("%.2f Gb", v)
      } else if (m == "N50 (bp)") {
        paste0(formatC(round(v), format = "f", big.mark = ",", digits = 0), " bp")
      } else {
        as.character(v)
      }
    })
  }

  # ============================================================================
  # PLOT 1: Yield Metrics Panel
  # ============================================================================
  log_msg("Generating Plot 1: Yield metrics panel...")
  yield_metrics_order <- c("Number of reads", "Total bases (Gb)", "N50 (bp)")

  yield_df <- data.frame(
    metric = factor(rep(yield_metrics_order, each = 2), levels = yield_metrics_order),
    condition = factor(rep(c("Raw", "Cleaned"), times = 3), levels = c("Raw", "Cleaned")),
    value = c(raw_reads, cleaned_reads,
              raw_bases_gb, cleaned_bases_gb,
              raw_n50, cleaned_n50),
    stringsAsFactors = FALSE
  )

  yield_df$label_text <- format_yield_label(yield_df$value, yield_df$metric)

  # MODIFIED (v4): value_plot column drives the BAR HEIGHT / axis position.
  # "Number of reads" is rescaled to millions so it shares the same 0-15
  # numeric range as "Total bases (Gb)". "N50 (bp)" is left in raw bp so its
  # own fixed 0-5000 scale (with K-formatted labels) applies correctly.
  # The displayed bar LABELS (label_text, above) are unaffected -- they are
  # computed from the original unscaled `value` column.
  yield_df$value_plot <- ifelse(yield_df$metric == "Number of reads",
                                 yield_df$value / 1e6,
                                 yield_df$value)

  p1 <- ggplot(yield_df, aes(x = condition, y = value_plot, fill = condition)) +
    geom_bar(stat = "identity", position = position_dodge(width = 0.8), width = 0.6,
              color = "black", linewidth = 0.3) +
    geom_text(aes(label = label_text),
              vjust = -0.5, size = 4.2, fontface = "bold", color = "black",
              position = position_dodge(width = 0.8)) +
    facet_wrap(~metric, scales = "free_y") +
    scale_fill_manual(values = raw_cleaned_colors) +
    # Fixed, explicit per-facet y-axis breaks (order matches yield_metrics_order):
    #   1. Number of reads : 0, 5, 10, 15  -> labeled 0M, 5M, 10M, 15M
    #   2. Total bases (Gb): 0, 5, 10, 15  -> labeled as plain numbers
    #   3. N50 (bp)         : 0, 1000...5000 -> labeled 0, 1K, 2K, 3K, 4K, 5K
    ggh4x::facetted_pos_scales(
      y = list(
        scale_y_continuous(breaks = seq(0, 15, 5), limits = c(0, 15.5),
                            expand = expansion(mult = c(0, 0.05)),
                            labels = function(x) paste0(x, "M")),
        scale_y_continuous(breaks = seq(0, 15, 5), limits = c(0, 15.5),
                            expand = expansion(mult = c(0, 0.05))),
        scale_y_continuous(breaks = seq(0, 5000, 1000), limits = c(0, 5300),
                            expand = expansion(mult = c(0, 0.05)),
                            labels = function(x) paste0(x / 1000, "K"))
      )
    ) +
    labs(
      title    = paste0("NanoStat QC: Yield Metrics (", sample_id, ")"),
      subtitle = paste0("Sample ID: ", sample_id, " | Raw vs Cleaned yield comparison"),
      x        = NULL,
      y        = "Value",
      fill     = "Condition"
    ) +
    pub_theme

  p1_svg <- file.path(output_dir, paste0(sample_id, "_NanoStat_yield_metrics.svg"))
  p1_pdf <- file.path(output_dir, paste0(sample_id, "_NanoStat_yield_metrics.pdf"))

  ggsave(filename = p1_svg, plot = p1, width = 10, height = 7, units = "in", dpi = 300)
  ggsave(filename = p1_pdf, plot = p1, width = 10, height = 7, units = "in", dpi = 300)
  log_msg(sprintf("Saved Plot 1 -> %s & %s", p1_svg, p1_pdf))

  # ============================================================================
  # PLOT 2: Quality Threshold Curve (auto-detected common Q-levels)
  # ============================================================================
  log_msg("Generating Plot 2: Quality threshold curve...")

  common_qs <- intersect(names(raw_q_vals), names(cleaned_q_vals))
  if (length(common_qs) > 0) {
    q_num <- as.integer(sub("^Q", "", common_qs, ignore.case = TRUE))
    common_qs <- common_qs[order(q_num)]
  }

  all_raw_qs     <- names(raw_q_vals)
  all_cleaned_qs <- names(cleaned_q_vals)
  missing_in_raw     <- setdiff(all_cleaned_qs, all_raw_qs)
  missing_in_cleaned <- setdiff(all_raw_qs, all_cleaned_qs)
  if (length(missing_in_raw) > 0) {
    log_msg(paste("WARNING: Q-thresholds present in Cleaned but not Raw (skipped):",
                  paste(missing_in_raw, collapse = ", ")), level = "WARN")
  }
  if (length(missing_in_cleaned) > 0) {
    log_msg(paste("WARNING: Q-thresholds present in Raw but not Cleaned (skipped):",
                  paste(missing_in_cleaned, collapse = ", ")), level = "WARN")
  }

  if (length(common_qs) == 0) {
    log_msg("WARNING: No common Q-thresholds found between Raw and Cleaned files. Plot 2 skipped.", level = "WARN")
  } else {
    q_df <- data.frame(
      q_level = factor(rep(common_qs, times = 2), levels = common_qs),
      condition = factor(rep(c("Raw", "Cleaned"), each = length(common_qs)), levels = c("Raw", "Cleaned")),
      value = c(raw_q_vals[common_qs], cleaned_q_vals[common_qs]),
      stringsAsFactors = FALSE
    )
    q_df$label_text <- sprintf("%.1f%%", q_df$value)
    q_df$label_vjust <- ifelse(q_df$condition == "Raw", -0.6, -2.0)

    min_y_val <- min(q_df$value, na.rm = TRUE)
    annot_y <- ifelse(min_y_val > 35, 18, 92)
    mean_q_label <- sprintf("Raw Mean Quality: %.1f Q\nCleaned Mean Quality: %.1f Q",
                            raw_mean_q, cleaned_mean_q)

    p2 <- ggplot(q_df, aes(x = q_level, y = value, group = condition,
                           color = condition, shape = condition)) +
      geom_line(linewidth = 1.2) +
      geom_point(size = 3.8) +
      geom_text(aes(label = label_text, vjust = label_vjust),
                size = 4.2, fontface = "bold", color = "black", show.legend = FALSE) +
      annotate("label", x = 1.6, y = annot_y, label = mean_q_label,
               fontface = "bold", size = 4.5, fill = "white", color = "black",
               alpha = 0.9, label.size = 0.6) +
      scale_color_manual(values = raw_cleaned_colors) +
      scale_shape_manual(values = c("Raw" = 16, "Cleaned" = 17)) +
      scale_y_continuous(limits = c(0, 108), expand = c(0, 0),
                         labels = function(x) paste0(x, "%")) +
      labs(
        title    = paste0("NanoStat QC: Read Quality Retention (", sample_id, ")"),
        subtitle = paste0("Sample ID: ", sample_id, " | Percentage of reads/bases retained at or above Phred Q-score thresholds"),
        x        = "Phred Quality Score Threshold",
        y        = "Reads / Bases Retained (%)",
        color    = "Condition",
        shape    = "Condition"
      ) +
      pub_theme

    p2_svg <- file.path(output_dir, paste0(sample_id, "_NanoStat_quality_threshold_curve.svg"))
    p2_pdf <- file.path(output_dir, paste0(sample_id, "_NanoStat_quality_threshold_curve.pdf"))

    ggsave(filename = p2_svg, plot = p2, width = 10, height = 7, units = "in", dpi = 300)
    ggsave(filename = p2_pdf, plot = p2, width = 10, height = 7, units = "in", dpi = 300)
    log_msg(sprintf("Saved Plot 2 -> %s & %s", p2_svg, p2_pdf))
  }

  log_msg("--- R Session Info Summary ---")
  si_lines <- capture.output(sessionInfo())
  for (line in si_lines) {
    log_msg(line)
  }

  log_msg("=== NanoStat Raw vs Cleaned QC Script Completed Successfully ===")

}, error = function(e) {
  log_msg(sprintf("FATAL EXCEPTION: %s", e$message), level = "ERROR")
  if (exists("log_file_path")) {
    cat("================ TRACEBACK / CONDITION CONTEXT ================\n",
        file = log_file_path, append = TRUE)
    cat(conditionMessage(e), "\n", file = log_file_path, append = TRUE)
  }
  quit(save = "no", status = 1, runLast = FALSE)
})

quit(save = "no", status = 0, runLast = FALSE)
