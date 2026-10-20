#!/usr/bin/env Rscript
# =============================================================================
# dbcan_new.R
# CAZyme family composition per MAG — Stacked bar (grouped by CAZyme class)
# Pipeline: Metagenomics/WGS automated pipeline
#
# EXPECTED CLI ARGUMENT ORDER (positional, all required):
#   Rscript dbcan_new.R <DBCAN_SAMPLE_DIR> <OUTPUT_DIR> <SAMPLE_ID>
#
#   arg1  DBCAN_SAMPLE_DIR : path to the dbCAN results directory for THIS
#                            sample only (i.e. .../annotation/dbcan/<sample_id>),
#                            containing one subfolder per MAG, each with an
#                            overview.txt file.
#   arg2  OUTPUT_DIR       : pipeline-provided output directory. Plots and the
#                            run log are written here (a "plots" subfolder is
#                            created automatically).
#   arg3  SAMPLE_ID        : sample identifier, passed explicitly by the SLURM
#                            wrapper (never parsed/guessed from a path string).
#
# OUTPUTS:
#   <OUTPUT_DIR>/plots/<SAMPLE_ID>_dbcan_cazyme_composition.svg
#   <OUTPUT_DIR>/plots/<SAMPLE_ID>_dbcan_cazyme_composition.pdf
#   <OUTPUT_DIR>/<SAMPLE_ID>_dbcan_run.log
# =============================================================================

# --- 1. PACKAGES -------------------------------------------------------------
required_pkgs <- c("ggplot2", "dplyr", "tidyr", "readr", "stringr")
missing_pkgs  <- required_pkgs[!sapply(required_pkgs, requireNamespace, quietly = TRUE)]
if (length(missing_pkgs) > 0) {
  cat("FATAL: missing required package(s):", paste(missing_pkgs, collapse = ", "), "\n")
  quit(save = "no", status = 1)
}
suppressPackageStartupMessages({
  library(ggplot2)
  library(dplyr)
  library(tidyr)
  library(readr)
  library(stringr)
})

# --- 2. CLI ARGUMENTS ---------------------------------------------------------
args <- commandArgs(trailingOnly = TRUE)
EXPECTED_NARGS <- 3

if (length(args) != EXPECTED_NARGS) {
  cat("FATAL: expected", EXPECTED_NARGS, "arguments, got", length(args), "\n")
  cat("Usage: Rscript dbcan_new.R <DBCAN_SAMPLE_DIR> <OUTPUT_DIR> <SAMPLE_ID>\n")
  quit(save = "no", status = 1)
}

dbcan_sample_dir <- args[1]
output_dir       <- args[2]
sample_id        <- args[3]

# --- 3. PATHS & LOG SETUP -----------------------------------------------------
dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
plot_dir <- file.path(output_dir, "plots")
dir.create(plot_dir, recursive = TRUE, showWarnings = FALSE)

log_file <- file.path(output_dir, paste0(sample_id, "_dbcan_run.log"))
log_con  <- file(log_file, open = "wt")

log_msg <- function(...) {
  msg <- paste0("[", format(Sys.time(), "%Y-%m-%d %H:%M:%S"), "] ", paste0(..., collapse = " "))
  cat(msg, "\n")
  cat(msg, "\n", file = log_con, append = TRUE)
}

log_msg("=== dbcan_new.R started ===")
log_msg("Sample ID       : ", sample_id)
log_msg("dbCAN sample dir: ", dbcan_sample_dir)
log_msg("Output dir      : ", output_dir)
log_msg("Plot dir        : ", plot_dir)
log_msg("Log file        : ", log_file)

# --- 4. VALIDATE INPUT PATH ---------------------------------------------------
if (!dir.exists(dbcan_sample_dir)) {
  log_msg("FATAL: dbCAN sample directory does not exist: ", dbcan_sample_dir)
  close(log_con)
  quit(save = "no", status = 1)
}
dbcan_sample_dir <- normalizePath(dbcan_sample_dir, mustWork = TRUE)

# --- 5. SAVE HELPER (SVG + PDF per pipeline-wide output contract) -------------
save_plot <- function(plot_obj, filename_base, width = 14, height = 7) {
  svg_path <- file.path(plot_dir, paste0(filename_base, ".svg"))
  pdf_path <- file.path(plot_dir, paste0(filename_base, ".pdf"))
  ggsave(svg_path, plot = plot_obj, width = width, height = height, units = "in", dpi = 300)
  ggsave(pdf_path, plot = plot_obj, width = width, height = height, units = "in", dpi = 300)
  log_msg("Saved plot: ", svg_path)
  log_msg("Saved plot: ", pdf_path)
}

# --- 6. PUBLICATION THEME (fixed font/size/weight/colour contract) -----------
pub_theme <- theme_bw(base_size = 11) +
  theme(
    plot.title          = element_text(size = 18, face = "bold", colour = "black", hjust = 0),
    plot.subtitle       = element_text(size = 13, face = "bold", colour = "black", margin = margin(b = 8)),
    legend.title        = element_text(size = 12, face = "bold", colour = "black"),
    legend.text         = element_text(size = 12, face = "bold", colour = "black"),
    axis.text.x         = element_text(size = 13, face = "bold", colour = "black", angle = 45, hjust = 1),
    axis.text.y         = element_text(size = 13, face = "bold", colour = "black"),
    axis.title.x        = element_text(size = 15, face = "bold", colour = "black", margin = margin(t = 10)),
    axis.title.y        = element_text(size = 15, face = "bold", colour = "black", margin = margin(r = 10)),
    plot.caption        = element_text(size = 9, color = "#555555", hjust = 0, margin = margin(t = 8)),
    legend.position     = "right",
    panel.grid.major.x  = element_blank(),
    panel.grid.major.y  = element_blank(),
    panel.grid.minor    = element_blank(),
    plot.margin         = margin(15, 15, 15, 15)
  )

# --- 7. HELPER — PARSE ONE overview.txt ---------------------------------------
parse_overview <- function(filepath, mag_id) {
  raw <- readLines(filepath, warn = FALSE)
  raw <- raw[nchar(trimws(raw)) > 0]
  if (length(raw) < 2) return(NULL)

  header <- str_split(raw[1], "\t")[[1]]
  rows   <- lapply(raw[-1], function(x) str_split(x, "\t")[[1]])

  n <- length(header)
  rows <- lapply(rows, function(r) {
    length(r) <- n
    r[is.na(r)] <- "-"
    r
  })
  df <- as.data.frame(do.call(rbind, rows), stringsAsFactors = FALSE)
  colnames(df) <- trimws(header)

  required <- c("HMMER", "dbCAN_sub", "DIAMOND", "#ofTools")
  missing  <- setdiff(required, colnames(df))
  if (length(missing) > 0) {
    log_msg("  [SKIP] ", mag_id, " — missing columns: ", paste(missing, collapse = ", "))
    return(NULL)
  }

  df[["#ofTools"]] <- suppressWarnings(as.integer(df[["#ofTools"]]))
  df <- df[!is.na(df[["#ofTools"]]) & df[["#ofTools"]] >= 2, ]
  if (nrow(df) == 0) return(NULL)

  df$annotation <- NA_character_
  for (col in c("HMMER", "dbCAN_sub", "DIAMOND")) {
    mask <- is.na(df$annotation) | df$annotation == "-"
    df$annotation[mask] <- df[[col]][mask]
  }
  df <- df[!is.na(df$annotation) & df$annotation != "-", ]
  if (nrow(df) == 0) return(NULL)

  domains <- unlist(str_split(df$annotation, "\\+"))
  domains <- trimws(domains)
  domains <- domains[domains != "" & domains != "-"]

  domains <- str_remove(domains, "\\(\\d+-\\d+\\)")
  domains <- str_extract(domains, "[A-Za-z]+[0-9_]*[A-Za-z0-9]*")
  domains <- domains[!is.na(domains) & domains != ""]

  valid_classes <- c("GH", "GT", "CE", "AA", "CBM", "PL")
  classes <- str_extract(domains, paste0("^(", paste(valid_classes, collapse = "|"), ")"))

  keep <- !is.na(classes)
  if (sum(keep) == 0) return(NULL)

  data.frame(
    MAG        = mag_id,
    family     = domains[keep],
    cazy_class = classes[keep],
    stringsAsFactors = FALSE
  )
}

# --- 8. MAIN LOGIC (wrapped in tryCatch per pipeline error-handling contract) -
main <- function() {

  mag_folders <- list.dirs(dbcan_sample_dir, recursive = FALSE, full.names = TRUE)
  mag_folders <- mag_folders[nchar(basename(mag_folders)) > 0]
  log_msg("Found ", length(mag_folders), " MAG folders.")

  if (length(mag_folders) == 0) {
    stop("No MAG subdirectories found inside: ", dbcan_sample_dir)
  }

  all_data <- vector("list", length(mag_folders))
  for (i in seq_along(mag_folders)) {
    mag_path <- mag_folders[i]
    mag_id   <- basename(mag_path)
    ov_file  <- file.path(mag_path, "overview.txt")

    if (!file.exists(ov_file)) {
      log_msg("  [SKIP] No overview.txt in: ", mag_id)
      next
    }
    parsed <- tryCatch(
      parse_overview(ov_file, mag_id),
      error = function(e) {
        log_msg("  [WARN] Error parsing ", mag_id, ": ", conditionMessage(e))
        NULL
      }
    )
    if (!is.null(parsed) && nrow(parsed) > 0) {
      all_data[[i]] <- parsed
      log_msg("  [OK] ", mag_id, " — ", nrow(parsed), " domain hits")
    } else {
      log_msg("  [EMPTY] ", mag_id)
    }
  }

  combined <- bind_rows(all_data)

  # --- GRACEFUL FALLBACK: no CAZyme hits at all in the whole sample ---------
  if (is.null(combined) || nrow(combined) == 0) {
    log_msg("WARNING: No CAZyme hits passed the confidence filter for this sample.")
    log_msg("Rendering informative placeholder plot.")

    p_empty <- ggplot() +
      annotate("text", x = 0.5, y = 0.5,
               label = paste0(
                 "No CAZyme annotations detected with \u2265 2 tool support\n",
                 "Sample: ", sample_id, "\n\n",
                 "Possible reasons:\n",
                 "  \u2022 Low-complexity or degraded metagenome\n",
                 "  \u2022 Organisms lacking carbohydrate-active enzymes\n",
                 "  \u2022 Incomplete MAG assembly or gene prediction\n\n",
                 "This is biologically plausible for some environments."
               ),
               size = 5, hjust = 0.5, vjust = 0.5, color = "black", family = "sans", fontface = "bold") +
      theme_void() +
      labs(title    = "dbCAN CAZyme Annotation — No Data",
           subtitle = paste0("Sample ID: ", sample_id)) +
      theme(plot.title    = element_text(size = 18, face = "bold", colour = "black", hjust = 0),
            plot.subtitle = element_text(size = 13, face = "bold", colour = "black"))

    save_plot(p_empty, paste0(sample_id, "_dbcan_cazyme_composition"), width = 10, height = 6)
    log_msg("Placeholder plot saved. Exiting cleanly.")
    return(invisible(NULL))
  }

  # --- AGGREGATE — COUNT BY MAG x CAZyme CLASS ------------------------------
  valid_classes <- c("GH", "GT", "CE", "AA", "CBM", "PL")
  combined$cazy_class <- factor(combined$cazy_class, levels = valid_classes)

  agg <- combined %>%
    count(MAG, cazy_class, name = "count") %>%
    complete(MAG, cazy_class = factor(valid_classes, levels = valid_classes),
             fill = list(count = 0))

  mag_totals <- agg %>%
    group_by(MAG) %>%
    summarise(total = sum(count), .groups = "drop") %>%
    arrange(desc(total))

  mag_order <- mag_totals$MAG
  agg$MAG   <- factor(agg$MAG, levels = mag_order)

  n_zero_mags <- sum(mag_totals$total == 0)
  if (n_zero_mags > 0) {
    log_msg("Note: ", n_zero_mags,
            " MAG(s) have zero CAZyme hits across all six classes and will ",
            "appear as empty bars (kept intentionally, to preserve an honest MAG count).")
  }

  # --- SHORT, PIPELINE-AGNOSTIC MAG LABELS ----------------------------------
  # Every MAG folder name is reduced to a short "Bin##" label so the
  # x-axis never shows a full raw sample/MAG ID, regardless of naming style:
  #   - names containing "bin" (e.g. "<sample>_bin.85", "bin_012")  -> BinNN
  #   - any other naming style (e.g. "SRR24442558.096", "sampleX_040")
  #     -> the LAST numeric run in the name is used, labelled          -> BinNN
  #   - if no numeric run exists at all, a running index is assigned  -> BinNN
  mag_names <- as.character(mag_order)

  has_bin      <- str_detect(mag_names, "(?i)bin")
  bin_numbers  <- str_extract(str_extract(mag_names, "(?i)bin[._-]?(\\d+)"), "\\d+")
  other_numbers <- str_extract(mag_names, "(\\d+)(?!.*\\d)")  # last numeric run in the string

  raw_number <- ifelse(has_bin & !is.na(bin_numbers), bin_numbers, other_numbers)
  prefix     <- rep("Bin", length(mag_names))

  # Any MAG with no numeric run at all falls back to a sequential index,
  # never to the raw sample/MAG name.
  missing_idx <- is.na(raw_number)
  if (any(missing_idx)) {
    raw_number[missing_idx] <- as.character(which(missing_idx))
    log_msg("  [WARN] No numeric identifier found for ", sum(missing_idx),
            " MAG(s) — assigned a sequential Bin## label instead.")
  }

  pad_width    <- max(2, nchar(as.character(max(as.integer(raw_number), na.rm = TRUE))))
  short_labels <- paste0(prefix, formatC(as.integer(raw_number), width = pad_width, flag = "0"))

  # Guard against accidental label collisions (e.g. two MAGs both reducing to
  # "Bin40") by appending a disambiguating suffix if needed.
  if (any(duplicated(short_labels))) {
    short_labels <- make.unique(short_labels, sep = "-")
    log_msg("  [WARN] Duplicate short labels detected after abbreviation — disambiguated with a suffix.")
  }

  label_map <- setNames(short_labels, mag_names)

  # --- COLOUR PALETTE — UNCHANGED (kept exactly as originally specified) ---
  class_colours <- c(
    GH  = "#E41A1C",
    GT  = "#377EB8",
    CE  = "#4DAF4A",
    AA  = "#FF7F00",
    CBM = "#984EA3",
    PL  = "#A65628"
  )

  total_mags    <- length(unique(agg$MAG))
  total_domains <- nrow(combined)
  unique_fams   <- length(unique(combined$family))

  p <- ggplot(agg, aes(x = MAG, y = count, fill = cazy_class)) +
    geom_bar(stat = "identity", width = 0.75, colour = "black", linewidth = 0.3) +
    scale_x_discrete(labels = label_map) +
    scale_fill_manual(
      values = class_colours,
      name   = "CAZyme Class",
      labels = c(
        GH  = "GH — Glycoside Hydrolases",
        GT  = "GT — Glycosyltransferases",
        CE  = "CE — Carbohydrate Esterases",
        AA  = "AA — Auxiliary Activities",
        CBM = "CBM — Carbohydrate-Binding Modules",
        PL  = "PL — Polysaccharide Lyases"
      ),
      drop = FALSE
    ) +
    scale_y_continuous(expand = expansion(mult = c(0, 0.05))) +
    labs(
      title    = "CAZyme Family Composition per MAG",
      subtitle = paste0(
        "Sample ID: ", sample_id,
        "  |  MAGs: ", total_mags,
        "  |  Total domain hits: ", total_domains,
        "  |  Unique families: ", unique_fams,
        "  |  Confidence filter: \u2265 2 tools"
      ),
      x = "MAG",
      y = "CAZyme Domain Count"
    ) +
    pub_theme

  # --- DYNAMIC PLOT SIZING ---------------------------------------------------
  # Fixed width becomes cramped once a sample has many MAGs (e.g. 35-40+).
  # Scale width with MAG count (min 14in, ~0.42in per bar), and give height a
  # small bump too so bar/label proportions stay readable at larger widths.
  plot_width  <- max(14, round(total_mags * 0.42, 1))
  plot_height <- if (total_mags > 30) 8 else 7
  log_msg("Plot size: width = ", plot_width, "in, height = ", plot_height,
          "in (", total_mags, " MAGs)")

  save_plot(p, paste0(sample_id, "_dbcan_cazyme_composition"), width = plot_width, height = plot_height)
}

result <- tryCatch({
  main()
  0L
}, error = function(e) {
  log_msg("FATAL ERROR: ", conditionMessage(e))
  log_msg("Call: ", paste(deparse(conditionCall(e)), collapse = " "))
  1L
})

# --- 9. REPRODUCIBILITY / VALIDATION HOOK -------------------------------------
log_msg("--- Session info ---")
si <- capture.output(sessionInfo())
for (line in si) {
  cat(line, "\n", file = log_con, append = TRUE)
}

log_msg("=== dbcan_new.R finished with exit status ", result, " ===")
close(log_con)
quit(save = "no", status = result)

