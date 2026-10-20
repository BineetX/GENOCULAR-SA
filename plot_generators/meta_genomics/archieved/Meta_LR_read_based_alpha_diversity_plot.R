#!/usr/bin/env Rscript
# ============================================================================
# metaphlan_alpha_diversity.R  (genus-level alpha diversity + rank-abundance)
# Publication-ready revision:
#   - Explicit metric naming (Shannon H' natural log; Simpson's 1-D Gini-Simpson)
#   - Value labels on diversity bars, legend removed (redundant with facet strips)
#   - Whittaker curve: % units on y-axis, N genera annotated on-plot,
#     grid lines removed except bold black axis lines (width 0.7)
#
# Expected CLI argument order (exactly 3, positional):
#   Rscript metaphlan_alpha_diversity.R <PROFILE_TXT> <OUTPUT_DIR> <SAMPLE_ID>
#     arg1 PROFILE_TXT : MetaPhlAn4 profile.txt (tab-separated, '#'-comment header)
#     arg2 OUTPUT_DIR  : directory where figures + log are written
#     arg3 SAMPLE_ID   : sample identifier (never parsed from a filename)
# ============================================================================

## ---------------------------------------------------------------------------
## 0. ARGUMENT PARSING & VALIDATION
## ---------------------------------------------------------------------------
args <- commandArgs(trailingOnly = TRUE)

if (length(args) != 3) {
  message(sprintf(
    "[FATAL] Expected exactly 3 arguments (PROFILE_TXT, OUTPUT_DIR, SAMPLE_ID), got %d.",
    length(args)
  ))
  quit(status = 1)
}

profile_txt <- args[1]
output_dir  <- args[2]
sample_id   <- args[3]

if (!dir.exists(output_dir)) {
  dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
}

log_path <- file.path(output_dir, paste0(sample_id, "_MetaPhlAn4_run.log"))
log_con  <- file(log_path, open = "wt")

log_msg <- function(...) {
  ts <- format(Sys.time(), "%Y-%m-%d %H:%M:%S")
  txt <- paste0("[", ts, "] ", paste0(..., collapse = " "))
  cat(txt, "\n", file = log_con, append = TRUE)
  cat(txt, "\n")
}

log_msg("==== metaphlan_alpha_diversity.R START ====")
log_msg("Script: metaphlan_alpha_diversity.R")
log_msg("PROFILE_TXT: ", profile_txt)
log_msg("OUTPUT_DIR: ", output_dir)
log_msg("SAMPLE_ID: ", sample_id)

## ---------------------------------------------------------------------------
## 1. DEPENDENCIES
## ---------------------------------------------------------------------------
required_pkgs <- c("ggplot2", "dplyr", "tidyr", "readr")

load_pkg <- function(pkg) {
  ok <- suppressWarnings(suppressMessages(require(pkg, character.only = TRUE)))
  if (!ok) {
    log_msg("[FATAL] Required package not available: ", pkg)
    close(log_con)
    quit(status = 1)
  }
  log_msg("Loaded package: ", pkg, " (", as.character(utils::packageVersion(pkg)), ")")
}

tryCatch({
  invisible(lapply(required_pkgs, load_pkg))
}, error = function(e) {
  log_msg("[FATAL] Error while loading packages: ", conditionMessage(e))
  close(log_con)
  quit(status = 1)
})

## ---------------------------------------------------------------------------
## 2. PUBLICATION THEME (font/size/weight table — do not deviate)
##    Grid lines removed entirely; axis lines bold black, width 0.7
## ---------------------------------------------------------------------------
pub_theme <- theme_minimal(base_size = 14) +
  theme(
    plot.title    = element_text(size = 18, color = "black", face = "bold"),
    plot.subtitle = element_text(size = 13, color = "black", face = "bold"),
    legend.text   = element_text(size = 12, color = "black", face = "bold"),
    legend.title  = element_text(size = 12, color = "black", face = "bold"),
    axis.text     = element_text(size = 14, color = "black", face = "bold"),
    axis.title    = element_text(size = 16, color = "black", face = "bold"),
    panel.grid.major = element_blank(),
    panel.grid.minor = element_blank(),
    axis.line    = element_line(color = "black", linewidth = 0.7),
    axis.ticks   = element_line(color = "black", linewidth = 0.7)
  )

## Fixed, consistent color palettes (Okabe-Ito colorblind-safe)
metric_colors <- c(
  "Observed Genera" = "#009E73",
  "Shannon Diversity Index (H', natural log)"  = "#0072B2",
  "Simpson's Diversity Index (1-D)"  = "#D55E00"
)
rank_abund_color <- "#0072B2"
n_annotation_color <- "grey30"

## ---------------------------------------------------------------------------
## 3. MAIN LOGIC (wrapped in tryCatch)
## ---------------------------------------------------------------------------
main <- function() {

  ## --- 3.1 Input validation -------------------------------------------------
  if (!file.exists(profile_txt)) {
    stop(sprintf("Input profile file does not exist: %s", profile_txt))
  }
  log_msg("Confirmed input file exists: ", profile_txt)

  ## --- 3.2 Read profile.txt, skipping '#' comment/header lines -------------
  raw_lines <- readLines(profile_txt, warn = FALSE)
  data_lines <- raw_lines[!grepl("^#", raw_lines)]
  data_lines <- data_lines[nzchar(trimws(data_lines))]

  log_msg("Total lines read: ", length(raw_lines),
          " | Comment/header lines skipped: ", length(raw_lines) - length(data_lines),
          " | Data lines kept: ", length(data_lines))

  if (length(data_lines) == 0) {
    stop("No data rows remained after filtering '#' comment/header lines.")
  }

  parsed <- read.delim(
    text = paste(data_lines, collapse = "\n"),
    header = FALSE, sep = "\t", stringsAsFactors = FALSE
  )

  ncols <- ncol(parsed)
  if (ncols == 3) {
    colnames(parsed) <- c("clade_name", "NCBI_tax_id", "relative_abundance")
    log_msg("Detected 3-column profile.txt format (no additional_species).")
  } else if (ncols >= 4) {
    colnames(parsed)[1:4] <- c("clade_name", "NCBI_tax_id", "relative_abundance", "additional_species")
    if (ncols > 4) {
      log_msg("Detected >4 columns; columns beyond 4 ignored.")
    }
    log_msg("Detected 4+ column profile.txt format; additional_species column present and will be IGNORED for diversity math.")
  } else {
    stop(sprintf("Unexpected number of columns (%d) in profile.txt data rows.", ncols))
  }

  parsed$relative_abundance <- suppressWarnings(as.numeric(parsed$relative_abundance))
  n_bad_abund <- sum(is.na(parsed$relative_abundance))
  if (n_bad_abund > 0) {
    log_msg("[WARN] ", n_bad_abund, " row(s) had non-numeric relative_abundance; dropped.")
    parsed <- parsed[!is.na(parsed$relative_abundance), ]
  }

  log_msg("Rows parsed from PROFILE_TXT: ", nrow(parsed))

  ## --- 3.3 Exclude UNCLASSIFIED rows ----------------------------------------
  last_segment <- function(clade) {
    segs <- strsplit(clade, "\\|")[[1]]
    segs[length(segs)]
  }
  parsed$last_seg <- vapply(parsed$clade_name, last_segment, character(1))

  is_unclassified <- parsed$last_seg == "UNCLASSIFIED" | parsed$clade_name == "UNCLASSIFIED"
  n_unclassified <- sum(is_unclassified)
  if (n_unclassified > 0) {
    log_msg("Excluding ", n_unclassified, " UNCLASSIFIED row(s) from calculations.")
  } else {
    log_msg("No UNCLASSIFIED rows found.")
  }
  parsed <- parsed[!is_unclassified, ]

  ## --- 3.4 Extract GENUS-level rows only ------------------------------------
  genus_rows <- parsed[startsWith(parsed$last_seg, "g__"), ]
  log_msg("Genus-level rows extracted: ", nrow(genus_rows))

  if (nrow(genus_rows) == 0) {
    stop("No genus-level (g__) rows found in PROFILE_TXT after filtering. Cannot compute genus-level diversity or rank-abundance. Flagging for manual review.")
  }

  abund <- genus_rows$relative_abundance
  total <- sum(abund, na.rm = TRUE)

  ## Detect scale: ~100 (percent) vs ~1 (fraction)
  if (abs(total - 100) <= abs(total - 1)) {
    scale_detected <- 100
  } else {
    scale_detected <- 1
  }
  log_msg("Genus-level abundance sum=", round(total, 4),
          " | detected scale=", scale_detected)

  dev_pct <- abs(total - scale_detected) / scale_detected * 100
  if (dev_pct > 1) {
    log_msg("[WARN] Genus-level abundance sum deviates from ", scale_detected,
            " by ", round(dev_pct, 2), "% (>1% threshold).")
  }

  ## Proportions used for diversity math (unitless, sums to 1)
  p_i_all <- abund / scale_detected
  p_i <- p_i_all[p_i_all > 0]

  ## Percent values used for plotting/display only (sums to 100)
  ## This guarantees the y-axis label "Relative Abundance (%)" is always
  ## true regardless of whether the source file used a 0-100 or 0-1 scale.
  genus_rows$relative_abundance_pct <- genus_rows$relative_abundance / scale_detected * 100

  shannon <- -sum(p_i * log(p_i))          # natural log (ln), per Chao & Chiu 2016
  simpson <- 1 - sum(p_i^2)                # Gini-Simpson index (1 - D); higher = more diverse
  observed <- length(p_i)
  n_genera <- observed

  log_msg("Genus-level diversity — Shannon(H', ln)=", round(shannon, 4),
          " Simpson(1-D)=", round(simpson, 4), " Observed=", observed)

  subtitle_txt <- paste0("Sample ID: ", sample_id, " | Genera detected: ", n_genera)

  ## --- 3.5 PLOT 1: Genus-level alpha diversity summary (3 metrics, free-y facets)
  log_msg("Generating Plot 1: genus-level alpha diversity summary (free-y facets).")

  metric_levels <- c("Observed Genera",
                      "Shannon Diversity Index (H', natural log)",
                      "Simpson's Diversity Index (1-D)")

  summary_df <- data.frame(
    Metric = factor(metric_levels, levels = metric_levels),
    Value  = c(observed, shannon, simpson),
    stringsAsFactors = FALSE
  )
  ## Value labels: integer for Observed, 2 decimals for the indices
  summary_df$Label <- c(
    as.character(observed),
    sprintf("H' = %.2f", shannon),
    sprintf("1-D = %.2f", simpson)
  )

  p1 <- ggplot(summary_df, aes(x = Metric, y = Value, fill = Metric)) +
    geom_col(width = 0.5, color = "black", linewidth = 0.2) +
    geom_text(aes(label = Label), vjust = -0.6, size = 4.5,
              fontface = "bold", color = "black") +
    facet_wrap(~ Metric, scales = "free", nrow = 1,
               labeller = label_wrap_gen(width = 22)) +
    scale_fill_manual(values = metric_colors, drop = TRUE) +
    scale_y_continuous(expand = expansion(mult = c(0, 0.18))) +
    guides(fill = "none") +
    labs(
      title = "MetaPhlAn4 Genus-Level Alpha Diversity Summary",
      subtitle = subtitle_txt,
      x = NULL,
      y = "Diversity Value"
    ) +
    pub_theme +
    theme(
      legend.position = "none",
      strip.text = element_text(size = 12.5, color = "black", face = "bold"),
      axis.text.x = element_blank(),
      axis.ticks.x = element_blank()
    )

  p1_svg <- file.path(output_dir, paste0(sample_id, "_MetaPhlAn4_genus_alpha_diversity_summary.svg"))
  p1_pdf <- file.path(output_dir, paste0(sample_id, "_MetaPhlAn4_genus_alpha_diversity_summary.pdf"))
  ggsave(p1_svg, plot = p1, width = 11, height = 7, units = "in", dpi = 300)
  ggsave(p1_pdf, plot = p1, width = 11, height = 7, units = "in", dpi = 300)
  log_msg("Saved Plot 1: ", p1_svg)
  log_msg("Saved Plot 1: ", p1_pdf)

  ## --- 3.6 PLOT 2: Genus-level rank-abundance (Whittaker) curve -------------
  log_msg("Generating Plot 2: genus-level rank-abundance (Whittaker) curve.")

  ra_df <- genus_rows[genus_rows$relative_abundance_pct > 0, ]
  n_excluded_zero <- nrow(genus_rows) - nrow(ra_df)
  if (n_excluded_zero > 0) {
    log_msg("Excluded ", n_excluded_zero, " genus row(s) with relative_abundance == 0 before log transform.")
  }

  ra_df <- ra_df[order(-ra_df$relative_abundance_pct), ]
  ra_df$rank <- seq_len(nrow(ra_df))

  n_plotted <- nrow(ra_df)
  min_abund <- min(ra_df$relative_abundance_pct)
  max_abund <- max(ra_df$relative_abundance_pct)
  log_msg("Rank-abundance curve: N genera plotted=", n_plotted,
          " | min relative_abundance(%)=", round(min_abund, 6),
          " | max relative_abundance(%)=", round(max_abund, 6))

  ## On-plot N annotation: dashed vertical line at the last rank + text label
  ## placed near the curve's tail (upper side of the dashed line so it never
  ## collides with the low-abundance points sitting at/near the line itself).
  n_label_y <- 10^(log10(max_abund) - 0.15 * (log10(max_abund) - log10(min_abund)))

  p2 <- ggplot(ra_df, aes(x = rank, y = relative_abundance_pct)) +
    geom_vline(xintercept = n_plotted, linetype = "dashed",
               color = n_annotation_color, linewidth = 0.5) +
    geom_line(color = rank_abund_color, linewidth = 0.9) +
    geom_point(color = rank_abund_color, size = 2.2) +
    annotate("text", x = n_plotted, y = n_label_y,
             label = paste0("N = ", n_plotted, " genera"),
             hjust = 1.05, size = 4.3, fontface = "bold", color = n_annotation_color) +
    scale_y_log10() +
    labs(
      title = "MetaPhlAn4 Genus-Level Rank-Abundance (Whittaker) Curve",
      subtitle = subtitle_txt,
      x = "Genus Rank (1 = most abundant)",
      y = "Relative Abundance (%, log10 scale)"
    ) +
    pub_theme

  p2_svg <- file.path(output_dir, paste0(sample_id, "_MetaPhlAn4_genus_rank_abundance_curve.svg"))
  p2_pdf <- file.path(output_dir, paste0(sample_id, "_MetaPhlAn4_genus_rank_abundance_curve.pdf"))
  ggsave(p2_svg, plot = p2, width = 10, height = 7, units = "in", dpi = 300)
  ggsave(p2_pdf, plot = p2, width = 10, height = 7, units = "in", dpi = 300)
  log_msg("Saved Plot 2: ", p2_svg)
  log_msg("Saved Plot 2: ", p2_pdf)

  log_msg("All plots generated successfully.")
}

## ---------------------------------------------------------------------------
## 4. EXECUTE WITH ERROR HANDLING
## ---------------------------------------------------------------------------
exit_status <- 0
tryCatch({
  main()
}, error = function(e) {
  log_msg("[FATAL ERROR] ", conditionMessage(e))
  log_msg("Call: ", paste(deparse(conditionCall(e)), collapse = " "))
  exit_status <<- 1
}, warning = function(w) {
  log_msg("[UNCAUGHT WARNING] ", conditionMessage(w))
})

## ---------------------------------------------------------------------------
## 5. REPRODUCIBILITY / VALIDATION HOOK
## ---------------------------------------------------------------------------
log_msg("---- sessionInfo() ----")
si <- capture.output(sessionInfo())
for (line in si) {
  cat(line, "\n", file = log_con, append = TRUE)
}

log_msg("==== metaphlan_alpha_diversity.R END (exit_status=", exit_status, ") ====")
close(log_con)

quit(status = exit_status)
