#!/usr/bin/env Rscript
# ============================================================================
# virsorter2_new.R
#
# EXPECTED CLI ARGUMENT ORDER (positional, exactly as below):
#   Rscript virsorter2_new.R \
#     <1: FINAL_VIRAL_SCORE_TSV>     final-viral-score.tsv
#     <2: OUTPUT_DIR>                path where figures + log are written
#     <3: FINAL_VIRAL_BOUNDARY_TSV>  final-viral-boundary.tsv
#     <4: SAMPLE_ID>                 sample identifier string
#
# Produces (Plot 1): {SAMPLE_ID}_virsorter2_score_distribution.svg / .pdf
# ============================================================================

## ---- 0. Dependency loading -------------------------------------------------
required_pkgs <- c("ggplot2", "dplyr", "tidyr", "readr")
for (pkg in required_pkgs) {
  ok <- suppressWarnings(suppressMessages(require(pkg, character.only = TRUE)))
  if (!ok) {
    message(sprintf("[FATAL] Required package '%s' is not installed. Please install it (install.packages(\"%s\")) before running this script.", pkg, pkg))
    quit(status = 1)
  }
}

## ---- 1. Argument parsing & validation -------------------------------------
args <- commandArgs(trailingOnly = TRUE)

if (length(args) != 4) {
  message("[FATAL] Expected exactly 4 positional arguments, got ", length(args), ".")
  message("Usage: Rscript virsorter2_new.R <FINAL_VIRAL_SCORE_TSV> <OUTPUT_DIR> <FINAL_VIRAL_BOUNDARY_TSV> <SAMPLE_ID>")
  quit(status = 1)
}

FINAL_VIRAL_SCORE_TSV    <- args[1]
OUTPUT_DIR                <- args[2]
FINAL_VIRAL_BOUNDARY_TSV <- args[3]
SAMPLE_ID                 <- args[4]

if (!dir.exists(OUTPUT_DIR)) {
  dir.create(OUTPUT_DIR, recursive = TRUE, showWarnings = FALSE)
}

log_path <- file.path(OUTPUT_DIR, paste0(SAMPLE_ID, "_virsorter2_run.log"))
log_con  <- file(log_path, open = "wt")

log_msg <- function(...) {
  msg <- paste0("[", format(Sys.time(), "%Y-%m-%d %H:%M:%S"), "] ", ...)
  cat(msg, "\n", file = log_con, append = TRUE)
  cat(msg, "\n")
}

log_msg("=== virsorter2_new.R run started ===")
log_msg("Script: virsorter2_new.R")
log_msg("Sample ID: ", SAMPLE_ID)
log_msg("Resolved input path (score tsv): ", FINAL_VIRAL_SCORE_TSV)
log_msg("Resolved input path (boundary tsv): ", FINAL_VIRAL_BOUNDARY_TSV)
log_msg("Resolved output directory: ", OUTPUT_DIR)

## ---- 2. Reusable publication theme ----------------------------------------
pub_theme <- theme(
  plot.title    = element_text(size = 18, color = "black", face = "bold"),
  plot.subtitle = element_text(size = 13, color = "black", face = "bold"),
  legend.text   = element_text(size = 12, color = "black", face = "bold"),
  legend.title  = element_text(size = 12, color = "black", face = "bold"),
  axis.text     = element_text(size = 14, color = "black", face = "bold"),
  axis.title    = element_text(size = 16, color = "black", face = "bold"),
  panel.background = element_rect(fill = "white", color = NA),
  plot.background  = element_rect(fill = "white", color = NA),
  panel.grid.major = element_blank(),
  panel.grid.minor = element_blank(),
  axis.line = element_line(color = "black", linewidth = 0.7)
)

## Okabe-Ito colorblind-safe palette, mapped explicitly to the 5 known groups
## plus an "Unclassified" bucket for edge cases.
group_palette <- c(
  "dsDNAphage"    = "#E69F00",
  "ssDNA"         = "#56B4E9",
  "RNA"           = "#009E73",
  "NCLDV"         = "#D55E00",
  "lavidaviridae" = "#CC79A7",
  "Unclassified"  = "#999999"
)

## ---- 3. Main logic wrapped in tryCatch -------------------------------------
result <- tryCatch({

  ## -- 3a. Input existence checks --
  if (!file.exists(FINAL_VIRAL_SCORE_TSV)) {
    stop(sprintf("Input file not found: FINAL_VIRAL_SCORE_TSV does not exist at path '%s'", FINAL_VIRAL_SCORE_TSV))
  }
  if (!file.exists(FINAL_VIRAL_BOUNDARY_TSV)) {
    stop(sprintf("Input file not found: FINAL_VIRAL_BOUNDARY_TSV does not exist at path '%s'", FINAL_VIRAL_BOUNDARY_TSV))
  }
  log_msg("STEP: input existence checks passed for both TSV files.")

  ## -- 3b. Read score TSV --
  score_df <- suppressMessages(readr::read_tsv(FINAL_VIRAL_SCORE_TSV, show_col_types = FALSE))
  log_msg("STEP: read FINAL_VIRAL_SCORE_TSV. Row count = ", nrow(score_df), ", Column count = ", ncol(score_df))

  ## -- 3c. Read boundary TSV (validated + logged, not directly plotted) --
  boundary_df <- suppressMessages(readr::read_tsv(FINAL_VIRAL_BOUNDARY_TSV, show_col_types = FALSE))
  log_msg("STEP: read FINAL_VIRAL_BOUNDARY_TSV successfully. Row count = ", nrow(boundary_df), " (not directly plotted in Plot 1).")

  ## -- 3d. Empty score file -> valid biological outcome, exit 0 gracefully --
  if (nrow(score_df) == 0) {
    log_msg("RESULT: final-viral-score.tsv has zero rows. No viral sequences were recovered for this sample.")
    log_msg("STEP: skipping plot generation gracefully (this is a valid biological outcome, not a pipeline error).")
    log_msg("=== virsorter2_new.R run finished (no plots generated) ===")
    close(log_con)
    quit(status = 0)
  }

  ## -- 3e. Required column check --
  required_cols <- c("max_score", "max_score_group")
  missing_cols <- setdiff(required_cols, colnames(score_df))
  if (length(missing_cols) > 0) {
    stop(sprintf("Malformed input: required column(s) missing from final-viral-score.tsv: %s",
                  paste(missing_cols, collapse = ", ")))
  }

  ## -- 3f. Coerce max_score to numeric, log any NAs introduced --
  n_before_na <- sum(is.na(score_df$max_score))
  score_df$max_score <- suppressWarnings(as.numeric(score_df$max_score))
  n_after_na <- sum(is.na(score_df$max_score))
  n_new_na <- n_after_na - n_before_na
  if (n_new_na > 0) {
    log_msg("WARNING: coercion of max_score to numeric introduced ", n_new_na,
            " new NA value(s). These rows will be dropped from the plot.")
  } else {
    log_msg("STEP: max_score confirmed numeric with no coercion issues.")
  }
  score_df <- score_df[!is.na(score_df$max_score), ]

  ## -- 3g. Handle unexpected/blank max_score_group values -> "Unclassified" --
  known_groups <- c("dsDNAphage", "ssDNA", "RNA", "NCLDV", "lavidaviridae")
  raw_group <- trimws(as.character(score_df$max_score_group))
  is_unexpected <- is.na(raw_group) | raw_group == "" | raw_group == "NA" | !(raw_group %in% known_groups)
  n_unexpected <- sum(is_unexpected)
  if (n_unexpected > 0) {
    log_msg("WARNING: ", n_unexpected,
            " row(s) had blank/unexpected max_score_group values; binned into 'Unclassified' category.")
  }
  score_df$max_score_group_clean <- ifelse(is_unexpected, "Unclassified", raw_group)
  score_df$max_score_group_clean <- factor(
    score_df$max_score_group_clean,
    levels = c(known_groups, "Unclassified")
  )
  score_df$max_score_group_clean <- droplevels(score_df$max_score_group_clean)

  log_msg("STEP: filtering / group cleanup complete. Final row count for plotting = ", nrow(score_df))

  ## -- 3h. Confidence tier counts for annotation --
  n_high_conf <- sum(score_df$max_score >= 0.9)
  n_mixed_conf <- sum(score_df$max_score >= 0.5 & score_df$max_score <= 0.8)
  n_gap_band  <- sum(score_df$max_score > 0.8 & score_df$max_score < 0.9)
  n_total <- nrow(score_df)
  log_msg("STEP: confidence tier counts computed. High-confidence (>=0.9) = ", n_high_conf,
          "; Mixed/moderate (0.5-0.8) = ", n_mixed_conf,
          "; Gap band (0.8-0.9, not called out in caption) = ", n_gap_band,
          "; Total = ", n_total)

  ## -- 3i. Build Plot 1: score distribution histogram --
  subtitle_txt <- paste0("Total sequences: ", n_total)

  annotation_txt <- paste0(
    "High-confidence (\u2265 0.9): ", n_high_conf, "  |  ",
    "Mixed/moderate (0.5 - 0.8): ", n_mixed_conf
  )

  used_levels <- levels(score_df$max_score_group_clean)
  plot_palette <- group_palette[used_levels]

  p1 <- ggplot(score_df, aes(x = max_score, fill = max_score_group_clean)) +
    geom_histogram(binwidth = 0.05, boundary = 0, color = "black", linewidth = 0.3, alpha = 0.9, position = "stack") +
    geom_vline(xintercept = 0.5, linetype = "dashed", color = "grey20", linewidth = 0.8) +
    geom_vline(xintercept = 0.9, linetype = "dotted", color = "grey20", linewidth = 0.8) +
    annotate("text", x = 0.5, y = Inf, label = "Sensitivity cutoff (0.5)",
             angle = 90, vjust = -0.6, hjust = 1.05, size = 4, fontface = "bold", color = "grey20") +
    annotate("text", x = 0.9, y = Inf, label = "High-confidence cutoff (0.9)",
             angle = 90, vjust = -0.6, hjust = 1.05, size = 4, fontface = "bold", color = "grey20") +
    scale_fill_manual(values = plot_palette, name = "Viral group", drop = TRUE) +
    scale_x_continuous(limits = c(0, 1), breaks = seq(0, 1, 0.1)) +
    scale_y_continuous(expand = expansion(mult = c(0, 0.08))) +
    labs(
      title = "VirSorter2 Score Distribution by Viral Group",
      subtitle = subtitle_txt,
      x = "Maximum classifier score (max_score)",
      y = "Number of sequences (count)",
      caption = annotation_txt
    ) +
    pub_theme +
    theme(
      plot.caption = element_text(size = 12, color = "black", face = "bold", hjust = 0)
    )

  log_msg("STEP: Plot 1 (score distribution histogram) object built successfully.")

  ## -- 3j. Save Plot 1 in svg + pdf --
  svg_path <- file.path(OUTPUT_DIR, paste0(SAMPLE_ID, "_virsorter2_score_distribution.svg"))
  pdf_path <- file.path(OUTPUT_DIR, paste0(SAMPLE_ID, "_virsorter2_score_distribution.pdf"))

  ggsave(filename = svg_path, plot = p1, width = 10, height = 7, units = "in", dpi = 300)
  log_msg("STEP: saved plot -> ", svg_path)

  ggsave(filename = pdf_path, plot = p1, width = 10, height = 7, units = "in", dpi = 300)
  log_msg("STEP: saved plot -> ", pdf_path)

  log_msg("STEP: plot generation complete.")

  TRUE
}, error = function(e) {
  log_msg("[FATAL ERROR] ", conditionMessage(e))
  log_msg("Call context: ", paste(deparse(conditionCall(e)), collapse = " "))
  log_msg("=== virsorter2_new.R run terminated with error ===")
  close(log_con)
  quit(status = 1)
})

## ---- 4. Reproducibility / validation hook ----------------------------------
log_msg("--- sessionInfo() summary for reproducibility ---")
si <- sessionInfo()
log_msg("R version: ", si$R.version$version.string)
pkg_versions <- vapply(required_pkgs, function(p) as.character(packageVersion(p)), character(1))
for (p in required_pkgs) {
  log_msg("Package ", p, " version: ", pkg_versions[[p]])
}

log_msg("=== virsorter2_new.R run finished successfully ===")
close(log_con)
quit(status = 0)
