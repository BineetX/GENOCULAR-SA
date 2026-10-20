#!/usr/bin/env Rscript
# ==============================================================================
# prokka_new.R
# Prokka per-MAG gene feature composition summary for one metagenomic sample
#
# EXPECTED CLI ARGUMENT ORDER (positional, exactly 3):
#   arg1: PROKKA_SAMPLE_DIR   - directory containing one subfolder per MAG/bin,
#                                each with a <mag_id>.txt Prokka summary file
#   arg2: OUTPUT_DIR          - path where plots + table + log are written
#   arg3: SAMPLE_ID           - sample identifier string (used verbatim, never
#                                auto-detected/re-derived from folder names)
#
# Usage:
#   Rscript prokka_new.R <PROKKA_SAMPLE_DIR> <OUTPUT_DIR> <SAMPLE_ID>
# ==============================================================================

## ---- 0. Argument validation -------------------------------------------------
args <- commandArgs(trailingOnly = TRUE)

if (length(args) != 3) {
  message(sprintf(
    "[%s] ERROR: Expected exactly 3 arguments (PROKKA_SAMPLE_DIR, OUTPUT_DIR, SAMPLE_ID), got %d.",
    format(Sys.time(), "%Y-%m-%d %H:%M:%S"), length(args)
  ))
  message("Usage: Rscript prokka_new.R <PROKKA_SAMPLE_DIR> <OUTPUT_DIR> <SAMPLE_ID>")
  quit(status = 1)
}

prokka_sample_dir <- args[1]
output_dir        <- args[2]
sample_id         <- args[3]

## ---- 1. Dependency loading (defensive) --------------------------------------
required_pkgs <- c("ggplot2", "dplyr", "tidyr", "readr", "stringr")

safe_load <- function(pkg) {
  ok <- suppressWarnings(suppressMessages(requireNamespace(pkg, quietly = TRUE)))
  if (!ok) {
    message(sprintf(
      "[%s] ERROR: Required package '%s' is not installed. Please install it before running this script.",
      format(Sys.time(), "%Y-%m-%d %H:%M:%S"), pkg
    ))
    quit(status = 1)
  }
  suppressPackageStartupMessages(library(pkg, character.only = TRUE))
}

invisible(lapply(required_pkgs, safe_load))

## ---- 2. Output dir / log setup ----------------------------------------------
if (!dir.exists(output_dir)) {
  dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
}

log_file <- file.path(output_dir, paste0(sample_id, "_prokka_run.log"))
log_con  <- file(log_file, open = "wt")

log_msg <- function(...) {
  msg <- paste0("[", format(Sys.time(), "%Y-%m-%d %H:%M:%S"), "] ", paste0(..., collapse = " "))
  writeLines(msg, con = log_con)
  flush(log_con)
}

log_msg("=========================================================")
log_msg("Script: prokka_new.R")
log_msg("Run start")
log_msg("Resolved PROKKA_SAMPLE_DIR: ", normalizePath(prokka_sample_dir, mustWork = FALSE))
log_msg("Resolved OUTPUT_DIR: ", normalizePath(output_dir, mustWork = FALSE))
log_msg("SAMPLE_ID (verbatim from arg3): ", sample_id)

## ---- 3. Main logic wrapped in tryCatch --------------------------------------
main <- function() {

  ## -- 3a. Validate input directory --
  if (!dir.exists(prokka_sample_dir)) {
    stop(sprintf(
      "PROKKA_SAMPLE_DIR does not exist or is not a directory: '%s'. Cannot proceed with Prokka summary parsing.",
      prokka_sample_dir
    ))
  }
  log_msg("STEP: Input directory validated successfully.")

  mag_dirs <- list.dirs(prokka_sample_dir, full.names = TRUE, recursive = FALSE)
  log_msg(sprintf("STEP: Found %d candidate MAG subfolder(s) in PROKKA_SAMPLE_DIR.", length(mag_dirs)))

  fields_of_interest <- c("CDS", "gene", "tRNA", "rRNA", "tmRNA", "repeat_region")

  parse_prokka_txt <- function(txt_path) {
    lines <- tryCatch(readLines(txt_path, warn = FALSE), error = function(e) character(0))
    result <- setNames(as.list(rep(0, length(fields_of_interest))), fields_of_interest)

    for (ln in lines) {
      parts <- str_split(ln, ":", n = 2)[[1]]
      if (length(parts) == 2) {
        key <- str_trim(parts[1])
        val <- suppressWarnings(as.numeric(str_trim(parts[2])))
        if (key %in% fields_of_interest && !is.na(val)) {
          result[[key]] <- val
        }
      }
    }
    result
  }

  ## -- 3b. Parse each MAG folder --
  mag_records <- list()
  n_fallback_used <- 0

  for (mdir in mag_dirs) {
    mag_id <- basename(mdir)

    expected_txt <- file.path(mdir, paste0(mag_id, ".txt"))
    txt_path <- NULL

    if (file.exists(expected_txt)) {
      txt_path <- expected_txt
    } else {
      candidate_txts <- list.files(mdir, pattern = "\\.txt$", full.names = TRUE)
      if (length(candidate_txts) >= 1) {
        txt_path <- candidate_txts[1]
        n_fallback_used <- n_fallback_used + 1
        log_msg(sprintf(
          "WARNING: Expected summary file not found for MAG '%s'. Falling back to '%s'.",
          mag_id, basename(txt_path)
        ))
      }
    }

    if (is.null(txt_path)) {
      log_msg(sprintf("WARNING: No .txt summary file found for MAG '%s'. Skipping this MAG.", mag_id))
      next
    }

    parsed <- parse_prokka_txt(txt_path)

    mag_records[[mag_id]] <- data.frame(
      MAG_ID        = mag_id,
      CDS           = parsed$CDS,
      gene          = parsed$gene,
      tRNA          = parsed$tRNA,
      rRNA          = parsed$rRNA,
      tmRNA         = parsed$tmRNA,
      repeat_region = parsed$repeat_region,
      stringsAsFactors = FALSE
    )
  }

  log_msg(sprintf("STEP: Parsing complete. %d MAG(s) parsed successfully. %d fallback(s) used.",
                   length(mag_records), n_fallback_used))

  ## -- 3c. Assemble combined data frame --
  if (length(mag_records) == 0) {
    log_msg("STEP: Zero MAGs produced parseable data. Proceeding with empty-data fallback.")
    combined <- data.frame(
      MAG_ID = character(0), CDS = numeric(0), gene = numeric(0),
      tRNA = numeric(0), rRNA = numeric(0), tmRNA = numeric(0),
      repeat_region = numeric(0), stringsAsFactors = FALSE
    )
  } else {
    combined <- do.call(rbind, mag_records)
    rownames(combined) <- NULL
  }

  combined <- combined %>%
    mutate(other_genes = pmax(gene - CDS, 0))

  n_bins <- nrow(combined)
  log_msg(sprintf("STEP: Combined data frame assembled. n_bins = %d.", n_bins))

  ## -- 3d. Bin numbering: sort ascending by CDS, assign Bin_Label ONCE --
  pad_width <- if (n_bins > 99) 3 else 2

  if (n_bins > 0) {
    combined <- combined %>%
      arrange(CDS) %>%
      mutate(
        Bin_Label = paste0("Bin", formatC(row_number(), width = pad_width, flag = "0"))
      )
  } else {
    combined <- combined %>% mutate(Bin_Label = character(0))
  }

  # Single lookup/factor object reused for both plot Y-axis and table
  bin_levels <- combined$Bin_Label
  combined <- combined %>%
    mutate(Bin_Label = factor(Bin_Label, levels = bin_levels))

  log_msg("STEP: Bin-numbering assignment computed once (ascending CDS order) and reused for plot + table.")

  ## -- 3e. Compute nice-multiplier scale factor for left (RNA/structural) side --
  right_max <- if (n_bins > 0) max(combined$CDS + combined$other_genes, na.rm = TRUE) else 0
  left_raw_max <- if (n_bins > 0) {
    max(combined$tRNA + combined$rRNA + combined$tmRNA + combined$repeat_region, na.rm = TRUE)
  } else 0

  nice_multipliers <- c(1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10, 15, 20, 25, 50, 100, 250, 500, 1000)

  compute_scale_factor <- function(right_max, left_raw_max) {
    if (left_raw_max <= 0 || right_max <= 0) return(1)
    target <- (right_max * 0.65) / left_raw_max
    if (!is.finite(target) || target <= 0) return(1)
    nice_multipliers[which.min(abs(nice_multipliers - target))]
  }

  scale_factor <- compute_scale_factor(right_max, left_raw_max)
  log_msg(sprintf("STEP: Dual-scale multiplier computed. scale_factor = %s (right_max=%.2f, left_raw_max=%.2f).",
                   scale_factor, right_max, left_raw_max))

  ## -- 3f. Publication theme (single reusable object) --
  pub_theme <- theme(
    plot.title    = element_text(size = 18, color = "black", face = "bold"),
    plot.subtitle = element_text(size = 13, color = "black", face = "bold"),
    legend.text   = element_text(size = 12, color = "black", face = "bold"),
    legend.title  = element_text(size = 12, color = "black", face = "bold"),
    axis.text     = element_text(size = 14, color = "black", face = "bold"),
    axis.title    = element_text(size = 16, color = "black", face = "bold"),
    axis.line     = element_line(color = "black", linewidth = 0.5),
    axis.ticks    = element_line(color = "black", linewidth = 0.5),
    panel.grid.major = element_blank(),
    panel.grid.minor = element_blank(),
    panel.background = element_rect(fill = "white", color = NA),
    plot.background  = element_rect(fill = "white", color = NA)
  )

  # Exact client-specified palette (kept as-is, no auto-adjustment for contrast)
  feature_colors <- c(
    "CDS"               = "#FFDC00",  # Yellow
    "Other/Pseudogenes" = "#85144b",  # Maroon
    "tRNA"              = "#C2E7B9",  # Green
    "rRNA"              = "#FF4136",  # Red
    "tmRNA"             = "#001F3F",  # Dark Blue
    "Repeat Regions"    = "#0074D9"   # Blue
  )

  x_axis_title <- sprintf(
    "\u25C4 Non-coding RNA & Repeat Features (Scaled \u00D7%s)  |  Protein-Coding Genes & Pseudogenes \u25BA",
    scale_factor
  )

  subtitle_text <- paste0("Sample ID: ", sample_id, " | MAGs analyzed: ", n_bins)

  ## -- 3g. Build plot data (long format, diverging) --
  if (n_bins > 0) {
    plot_data_right <- combined %>%
      select(Bin_Label, CDS, other_genes) %>%
      pivot_longer(cols = c(CDS, other_genes), names_to = "feature", values_to = "value") %>%
      mutate(
        feature = ifelse(feature == "CDS", "CDS", "Other/Pseudogenes"),
        side = "right",
        plot_value = value
      )

    plot_data_left <- combined %>%
      select(Bin_Label, tRNA, rRNA, tmRNA, repeat_region) %>%
      pivot_longer(cols = c(tRNA, rRNA, tmRNA, repeat_region), names_to = "feature", values_to = "value") %>%
      mutate(
        feature = case_when(
          feature == "tRNA" ~ "tRNA",
          feature == "rRNA" ~ "rRNA",
          feature == "tmRNA" ~ "tmRNA",
          feature == "repeat_region" ~ "Repeat Regions",
          TRUE ~ feature
        ),
        side = "left",
        plot_value = -1 * value * scale_factor
      )

    plot_data <- bind_rows(plot_data_right, plot_data_left) %>%
      mutate(feature = factor(feature, levels = c(
        "tRNA", "rRNA", "tmRNA", "Repeat Regions", "Other/Pseudogenes", "CDS"
      )))

    # Label offset computed as a fixed proportion of the data range (right_max),
    # not a text-relative hjust, so it scales consistently regardless of font
    # rendering or how many bins/how wide the data range is.
    label_offset <- right_max * 0.02

    cds_labels <- combined %>%
      select(Bin_Label, CDS, other_genes) %>%
      mutate(label_x = CDS + other_genes + label_offset)

    log_msg("STEP: Plot data (long format, diverging dual-scale) constructed.")

    # Overall axis range with symmetric-ish padding: left side uses scaled
    # left_raw_max, right side uses right_max. Add ~12% headroom on the right
    # so CDS count labels never clip against the panel edge.
    axis_upper <- right_max * 1.12
    axis_lower <- -1 * left_raw_max * scale_factor * 1.05

    p <- ggplot() +
      geom_col(
        data = plot_data,
        aes(x = Bin_Label, y = plot_value, fill = feature),
        width = 0.7, color = "black", linewidth = 0.2
      ) +
      geom_text(
        data = cds_labels,
        aes(x = Bin_Label, y = label_x, label = CDS),
        hjust = 0, size = 4, fontface = "bold", color = "black"
      ) +
      geom_hline(yintercept = 0, color = "black", linewidth = 0.6) +
      coord_flip() +
      scale_fill_manual(
        values = feature_colors, name = "Feature Type",
        guide = guide_legend(override.aes = list(color = "black", linewidth = 0.2))
      ) +
      scale_y_continuous(limits = c(axis_lower, axis_upper), expand = expansion(mult = 0.01)) +
      labs(
        title    = "Prokka Gene Feature Composition per MAG",
        subtitle = subtitle_text,
        x        = "Bin",
        y        = x_axis_title
      ) +
      pub_theme

  } else {
    log_msg("STEP: Zero MAGs with parseable data. Generating graceful empty-plot fallback.")
    p <- ggplot() +
      annotate("text", x = 0.5, y = 0.5, label = "No Prokka summary data found",
               size = 6, fontface = "bold", color = "black") +
      theme_void() +
      labs(
        title    = "Prokka Gene Feature Composition per MAG",
        subtitle = subtitle_text
      ) +
      pub_theme
  }

  log_msg("STEP: Plot object generated.")

  ## -- 3h. Save plot (svg + pdf) --
  svg_path <- file.path(output_dir, paste0(sample_id, "_prokka_feature_composition.svg"))
  pdf_path <- file.path(output_dir, paste0(sample_id, "_prokka_feature_composition.pdf"))

  ggsave(filename = svg_path, plot = p, width = 14, height = 9, units = "in", dpi = 300)
  ggsave(filename = pdf_path, plot = p, width = 14, height = 9, units = "in", dpi = 300)

  log_msg("STEP: Plot saved: ", svg_path)
  log_msg("STEP: Plot saved: ", pdf_path)

  ## -- 3i. Build and write companion table (same Bin_Label/order as plot) --
  table_path <- file.path(output_dir, paste0(sample_id, "_prokka_feature_composition_table.tsv"))

  if (n_bins > 0) {
    out_table <- combined %>%
      arrange(CDS) %>%
      select(Bin_Label, MAG_ID, CDS, gene, other_genes, tRNA, rRNA, tmRNA, repeat_region) %>%
      mutate(Bin_Label = as.character(Bin_Label))
  } else {
    out_table <- data.frame(
      Bin_Label = character(0), MAG_ID = character(0), CDS = numeric(0),
      gene = numeric(0), other_genes = numeric(0), tRNA = numeric(0),
      rRNA = numeric(0), tmRNA = numeric(0), repeat_region = numeric(0),
      stringsAsFactors = FALSE
    )
  }

  readr::write_tsv(out_table, table_path)
  log_msg("STEP: Table written: ", table_path)
  log_msg(sprintf("STEP: Table row count = %d.", nrow(out_table)))

  invisible(NULL)
}

result <- tryCatch(
  {
    main()
    "SUCCESS"
  },
  error = function(e) {
    log_msg("ERROR: ", conditionMessage(e))
    log_msg("ERROR: Script terminating due to the above condition.")
    "FAILURE"
  }
)

## ---- 4. Reproducibility / sessionInfo footer --------------------------------
log_msg("---- sessionInfo() ----")
si_lines <- capture.output(sessionInfo())
for (ln in si_lines) log_msg(ln)

log_msg("Run end")
log_msg("=========================================================")
close(log_con)

if (identical(result, "FAILURE")) {
  quit(status = 1)
} else {
  quit(status = 0)
}

