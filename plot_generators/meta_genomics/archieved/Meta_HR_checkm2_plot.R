#!/usr/bin/env Rscript
# ==============================================================================
# checkm2_quality_scatter.R
#
# Generates a publication-ready Completeness vs Contamination scatter plot
# from a CheckM2 quality_report.tsv for a single metagenomic sample.
#
# EXPECTED CLI ARGUMENT ORDER (positional, via commandArgs(trailingOnly = TRUE)):
#   arg1: QUALITY_REPORT_TSV   - path to CheckM2 quality_report.tsv
#   arg2: OUTPUT_DIR           - directory to write plots + log file into
#   arg3: SAMPLE_ID            - sample identifier string (explicit, not parsed)
#
# Invocation:
#   Rscript checkm2_quality_scatter.R \
#     <path/to/quality_report.tsv> \
#     <path/to/output_dir> \
#     <SAMPLE_ID>
# ==============================================================================

## ---------------------------------------------------------------------------
## 0. Argument parsing & validation
## ---------------------------------------------------------------------------
args <- commandArgs(trailingOnly = TRUE)

if (length(args) != 3) {
  message(sprintf(
    "[%s] ERROR: Expected exactly 3 arguments (QUALITY_REPORT_TSV, OUTPUT_DIR, SAMPLE_ID), got %d.",
    format(Sys.time(), "%Y-%m-%d %H:%M:%S"), length(args)
  ))
  message("Usage: Rscript checkm2_quality_scatter.R <quality_report.tsv> <output_dir> <SAMPLE_ID>")
  quit(status = 1)
}

QUALITY_REPORT_TSV <- args[1]
OUTPUT_DIR         <- args[2]
SAMPLE_ID          <- args[3]

## ---------------------------------------------------------------------------
## 1. Logging setup
## ---------------------------------------------------------------------------
if (!dir.exists(OUTPUT_DIR)) {
  dir.create(OUTPUT_DIR, recursive = TRUE, showWarnings = FALSE)
}

log_path <- file.path(OUTPUT_DIR, paste0(SAMPLE_ID, "_checkm2_run.log"))
log_con  <- file(log_path, open = "a")

log_msg <- function(...) {
  msg <- paste0("[", format(Sys.time(), "%Y-%m-%d %H:%M:%S"), "] ", ...)
  cat(msg, "\n", file = log_con, append = TRUE)
  cat(msg, "\n")
}

log_msg("=== checkm2_quality_scatter.R run started ===")
log_msg("Script: checkm2_quality_scatter.R")
log_msg("Resolved QUALITY_REPORT_TSV: ", normalizePath(QUALITY_REPORT_TSV, mustWork = FALSE))
log_msg("Resolved OUTPUT_DIR: ", normalizePath(OUTPUT_DIR, mustWork = FALSE))
log_msg("SAMPLE_ID: ", SAMPLE_ID)

## ---------------------------------------------------------------------------
## 2. Safe library loading
## ---------------------------------------------------------------------------
safe_library <- function(pkg) {
  ok <- suppressWarnings(suppressMessages(require(pkg, character.only = TRUE)))
  if (!ok) {
    log_msg("ERROR: Required package '", pkg, "' is not installed. Aborting.")
    close(log_con)
    quit(status = 1)
  } else {
    log_msg("Loaded package: ", pkg, " (version ",
            as.character(utils::packageVersion(pkg)), ")")
  }
}

for (p in c("ggplot2", "dplyr", "readr")) safe_library(p)

## ---------------------------------------------------------------------------
## 3. Reusable typography theme (Section C spec)
## ---------------------------------------------------------------------------
checkm2_theme <- ggplot2::theme_minimal(base_size = 14) +
  ggplot2::theme(
    plot.title      = ggplot2::element_text(size = 18, color = "black", face = "bold"),
    plot.subtitle   = ggplot2::element_text(size = 13, color = "black", face = "bold"),
    legend.text     = ggplot2::element_text(size = 12, color = "black", face = "bold"),
    legend.title    = ggplot2::element_text(size = 12, color = "black", face = "bold"),
    axis.text       = ggplot2::element_text(size = 14, color = "black", face = "bold"),
    axis.title      = ggplot2::element_text(size = 16, color = "black", face = "bold"),
    axis.line       = ggplot2::element_line(color = "black", linewidth = 0.8),
    axis.ticks      = ggplot2::element_line(color = "black", linewidth = 0.8),
    panel.background = ggplot2::element_rect(fill = "white", color = NA),
    plot.background   = ggplot2::element_rect(fill = "white", color = NA),
    panel.grid.minor  = ggplot2::element_blank(),
    panel.grid.major  = ggplot2::element_blank()
  )

## ---------------------------------------------------------------------------
## 4. Main logic wrapped in tryCatch
## ---------------------------------------------------------------------------
main <- function() {

  ## -- 4a. Input existence check -------------------------------------------
  if (!file.exists(QUALITY_REPORT_TSV)) {
    stop(sprintf("Input file does not exist: %s", QUALITY_REPORT_TSV))
  }
  log_msg("Input file found. Reading quality_report.tsv ...")

  ## -- 4b. Read TSV ----------------------------------------------------------
  qr <- readr::read_tsv(QUALITY_REPORT_TSV, show_col_types = FALSE, progress = FALSE)
  log_msg("File read successfully. Step: file read complete.")

  required_cols <- c("Name", "Completeness", "Contamination")
  missing_cols <- setdiff(required_cols, colnames(qr))
  if (length(missing_cols) > 0) {
    stop(sprintf("Missing required column(s) in quality_report.tsv: %s",
                 paste(missing_cols, collapse = ", ")))
  }

  n_before <- nrow(qr)
  log_msg("Row count before NA filtering: ", n_before)

  ## -- 4c. NA filtering --------------------------------------------------
  qr_clean <- dplyr::filter(qr, !is.na(Completeness), !is.na(Contamination))
  n_after  <- nrow(qr_clean)
  n_dropped <- n_before - n_after

  log_msg("Step: filtering/NA handling complete.")
  log_msg("Row count after NA filtering: ", n_after)
  if (n_dropped > 0) {
    log_msg("WARNING: Dropped ", n_dropped,
            " row(s) with NA in Completeness and/or Contamination.")
  } else {
    log_msg("No rows dropped due to NA values.")
  }

  ## -- 4d. Zero valid rows guard ------------------------------------------
  if (n_after == 0) {
    log_msg("ERROR: Zero valid rows remain after NA filtering. ",
            "Skipping plot generation. No figure will be produced.")
    return(invisible(NULL))
  }

  ## -- 4e. Zone classification (MIMAG / Bowers et al. 2017) ----------------
  log_msg("Step: zone classification (MIMAG / Bowers et al. 2017 thresholds).")

  qr_clean <- dplyr::mutate(
    qr_clean,
    Zone = dplyr::case_when(
      Completeness >= 90 & Contamination < 5  ~ "High quality",
      Completeness >= 50 & Contamination < 10 ~ "Medium quality",
      TRUE                                     ~ "Low quality/discard"
    )
  )

  zone_counts <- qr_clean %>%
    dplyr::count(Zone) %>%
    tibble::deframe()

  get_n <- function(zone) if (zone %in% names(zone_counts)) zone_counts[[zone]] else 0L

  n_high <- get_n("High quality")
  n_med  <- get_n("Medium quality")
  n_low  <- get_n("Low quality/discard")

  log_msg("Zone counts -> High quality: ", n_high,
          " | Medium quality: ", n_med,
          " | Low quality/discard: ", n_low)

  # Legend labels embedding per-zone counts
  zone_labels <- c(
    "High quality"        = sprintf("High quality (n=%d)", n_high),
    "Medium quality"      = sprintf("Medium quality (n=%d)", n_med),
    "Low quality/discard" = sprintf("Low quality/discard (n=%d)", n_low)
  )

  qr_clean <- dplyr::mutate(
    qr_clean,
    ZoneLabel = factor(
      zone_labels[Zone],
      levels = c(zone_labels["High quality"],
                 zone_labels["Medium quality"],
                 zone_labels["Low quality/discard"])
    )
  )

  # Explicit hex palette, keyed to the labeled factor levels
  zone_colors <- stats::setNames(
    c("#4DAF4A", "#FF8C00", "#E41A1C"),
    c(zone_labels["High quality"], zone_labels["Medium quality"], zone_labels["Low quality/discard"])
  )

  ## -- 4f. Subtitle composition (explicit, no raw variable dumps) ----------
  subtitle_str <- paste0("Sample ID: ", SAMPLE_ID, " | MAGs assessed: ", n_after)

  ## -- 4g. Plot generation --------------------------------------------------
  log_msg("Step: plot generation starting.")

  p <- ggplot2::ggplot(qr_clean, ggplot2::aes(x = Completeness, y = Contamination)) +
    # MIMAG contamination reference lines (5% / 10%)
    ggplot2::geom_hline(yintercept = 5,  linetype = "dashed", color = "grey60", linewidth = 0.4) +
    ggplot2::geom_hline(yintercept = 10, linetype = "dashed", color = "grey60", linewidth = 0.4) +
    # MIMAG completeness reference lines (50% / 70% / 90%)
    ggplot2::geom_vline(xintercept = 50, linetype = "dashed", color = "grey60", linewidth = 0.4) +
    ggplot2::geom_vline(xintercept = 70, linetype = "dashed", color = "grey60", linewidth = 0.4) +
    ggplot2::geom_vline(xintercept = 90, linetype = "dashed", color = "grey60", linewidth = 0.4) +
    ggplot2::geom_point(
      ggplot2::aes(fill = ZoneLabel),
      shape  = 21,
      color  = "black",
      stroke = 0.3,
      size   = 3,
      alpha  = 0.9
    ) +
    ggplot2::scale_fill_manual(name = "MAG Quality", values = zone_colors) +
    ggplot2::scale_x_continuous(limits = c(0, 100), breaks = seq(0, 100, 10),
                                 expand = ggplot2::expansion(mult = 0.02)) +
    ggplot2::scale_y_continuous(limits = c(0, 20), breaks = seq(0, 20, 5),
                                 expand = ggplot2::expansion(mult = 0.02)) +
    ggplot2::labs(
      title    = "CheckM2 MAG Quality: Completeness vs Contamination",
      subtitle = subtitle_str,
      x        = "Completeness (%)",
      y        = "Contamination (%)"
    ) +
    checkm2_theme

  log_msg("Step: plot object constructed.")

  ## -- 4h. Save outputs -----------------------------------------------------
  svg_path <- file.path(OUTPUT_DIR, paste0("checkm2_completeness_contamination.svg"))
  pdf_path <- file.path(OUTPUT_DIR, paste0("checkm2_completeness_contamination.pdf"))

  ggplot2::ggsave(filename = svg_path, plot = p, width = 10, height = 7, units = "in", dpi = 300)
  log_msg("Saved SVG: ", svg_path)

  ggplot2::ggsave(filename = pdf_path, plot = p, width = 10, height = 7, units = "in", dpi = 300)
  log_msg("Saved PDF: ", pdf_path)

  log_msg("Step: file save complete.")
}

## ---------------------------------------------------------------------------
## 5. Run with error handling
## ---------------------------------------------------------------------------
tryCatch(
  {
    main()
  },
  error = function(e) {
    log_msg("ERROR: ", conditionMessage(e))
    log_msg("=== checkm2_quality_scatter.R run terminated with error ===")
    close(log_con)
    quit(status = 1)
  },
  warning = function(w) {
    log_msg("WARNING captured during execution: ", conditionMessage(w))
  }
)

## ---------------------------------------------------------------------------
## 6. Reproducibility / sessionInfo summary
## ---------------------------------------------------------------------------
log_msg("--- Session info summary ---")
log_msg("R version: ", R.version.string)
for (p in c("ggplot2", "dplyr", "readr")) {
  log_msg(p, " version: ", as.character(utils::packageVersion(p)))
}
log_msg("=== checkm2_quality_scatter.R run completed successfully ===")

close(log_con)

