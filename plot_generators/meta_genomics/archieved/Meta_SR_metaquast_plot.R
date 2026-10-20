# =============================================================================
# metaquast_plot.R
# Cumulative contig length assembly curve with QUAST/metaQUAST QC annotations
# Pipeline: Metagenomics/WGS automated single-sample pipeline
# Assembler-agnostic: validated for short-read (MEGAHIT/metaSPAdes),
# long-read (Flye/metaFlye/Canu), and hybrid (Unicycler/SPAdes-hybrid) assemblies.
#
# EXPECTED CLI ARGUMENT ORDER (positional, via commandArgs):
#   arg1: FASTA_FILE   - full path to the sample's assembly FASTA file
#                        (.fasta/.fa/.fna, plain or gzip-compressed .gz)
#   arg2: QUAST_REPORT - full path to the sample's QUAST report.tsv file
#                        (single-assembly report only; see section 6c)
#   arg3: OUTPUT_DIR   - pipeline-provided output path (plots + log written here)
#   arg4: SAMPLE_ID    - sample identifier (passed explicitly, never parsed
#                        from a path string)
#
# Example invocation:
#   Rscript metaquast_plot.R <fasta_file> <quast_report> <output_dir> <sample_id>
#
# KEY DESIGN NOTES (read before modifying):
#   - QUAST/metaQUAST applies its own minimum-contig-length filter (commonly
#     500 bp, but configurable via --min-contig) before computing N50, L50,
#     L90, Total length, and # contigs. To keep the plotted cumulative curve
#     consistent with those statistics, this script does NOT re-derive a
#     length threshold. Instead it keeps the N longest contigs, where N is
#     QUAST's own reported "# contigs" value. Keeping the top-N-by-length
#     contigs is mathematically equivalent to applying whatever minimum
#     length cutoff QUAST used, without needing to know that cutoff.
#   - Header length tags differ by assembler (MEGAHIT: len=, Unicycler:
#     length=, Flye/Canu/metaFlye: no tag). All are handled; if no tag
#     matches on a sufficient fraction of headers, lengths are computed
#     directly from sequence content (vectorized, not a line-by-line loop).
#   - Gzip-compressed FASTA input (.gz) is supported transparently.
# =============================================================================

# --- 1. PACKAGES -------------------------------------------------------------
required_packages <- c("ggplot2", "dplyr", "readr", "stringr", "scales")
missing_packages <- required_packages[!vapply(required_packages,
                                               requireNamespace,
                                               logical(1), quietly = TRUE)]
if (length(missing_packages) > 0) {
  stop("Missing required package(s): ", paste(missing_packages, collapse = ", "),
       ". Install them before running this script.")
}
suppressPackageStartupMessages({
  library(ggplot2)
  library(dplyr)
  library(readr)
  library(stringr)
  library(scales)
})

# --- 2. COMMAND-LINE ARGUMENTS ------------------------------------------------
args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 4) {
  stop("Usage: Rscript cumulative.R <fasta_file> <quast_report> <output_dir> <sample_id>\n",
       "  Received ", length(args), " argument(s).")
}

fasta_file    <- args[1]
quast_report  <- args[2]
output_dir    <- args[3]
sample_id     <- args[4]

dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)

# --- 3. LOGGING SETUP ---------------------------------------------------------
log_file <- file.path(output_dir, paste0(sample_id, "_cumulative_run.log"))
log_con  <- file(log_file, open = "wt")

log_msg <- function(...) {
  msg <- paste0("[", format(Sys.time(), "%Y-%m-%d %H:%M:%S"), "] ", ...)
  cat(msg, "\n")
  cat(msg, "\n", file = log_con, append = TRUE)
}

log_msg("Script: cumulative.R")
log_msg("Sample ID: ", sample_id)
log_msg("Resolved fasta_file: ", fasta_file)
log_msg("Resolved quast_report: ", quast_report)
log_msg("Resolved output_dir: ", output_dir)

# --- 4. SAVE HELPER -----------------------------------------------------------
save_plot <- function(plot_obj, filename_base, width = 14, height = 8) {
  svg_path <- file.path(output_dir, paste0(filename_base, ".svg"))
  pdf_path <- file.path(output_dir, paste0(filename_base, ".pdf"))
  ggsave(svg_path, plot = plot_obj, width = width, height = height,
         units = "in", dpi = 300)
  ggsave(pdf_path, plot = plot_obj, width = width, height = height,
         units = "in", dpi = 300)
  log_msg("Saved plot: ", svg_path)
  log_msg("Saved plot: ", pdf_path)
}

# --- 5. PUBLICATION THEME (fixed typography contract) -------------------------
pub_theme <- theme_bw(base_size = 12) +
  theme(
    plot.title           = element_text(size = 18, face = "bold", colour = "black"),
    plot.subtitle        = element_text(size = 13, face = "bold", colour = "black",
                                         margin = margin(b = 6)),
    axis.title.x         = element_text(size = 16, face = "bold", colour = "black",
                                         margin = margin(t = 8)),
    axis.title.y         = element_text(size = 16, face = "bold", colour = "black",
                                         margin = margin(r = 8)),
    axis.text            = element_text(size = 14, face = "bold", colour = "black"),
    legend.title          = element_text(size = 12, face = "bold", colour = "black"),
    legend.text           = element_text(size = 12, face = "bold", colour = "black"),
    legend.key.height     = unit(0.4, "cm"),
    legend.key.width      = unit(1.2, "cm"),
    legend.position       = "bottom",
    panel.grid.major      = element_blank(),
    panel.grid.minor      = element_blank(),
    plot.margin           = margin(12, 16, 10, 12)
  )

# --- 6. HELPER: open a FASTA connection transparently (plain or gzip) ---------
open_fasta_connection <- function(path) {
  if (grepl("\\.gz$", path, ignore.case = TRUE)) {
    gzfile(path, open = "rt")
  } else {
    file(path, open = "rt")
  }
}

# --- 7. MAIN LOGIC (wrapped in tryCatch) --------------------------------------
main <- function() {

  # --- 7a. Validate input files exist -----------------------------------------
  if (!file.exists(fasta_file)) {
    stop("Assembly FASTA file does not exist: ", fasta_file)
  }
  log_msg("Using FASTA: ", fasta_file)

  if (!file.exists(quast_report)) {
    stop("QUAST report.tsv does not exist: ", quast_report)
  }
  log_msg("Using QUAST report: ", quast_report)

  # --- 7b. Read FASTA once (handles plain or .gz transparently) ---------------
  log_msg("Reading FASTA (gzip-aware)...")
  con <- open_fasta_connection(fasta_file)
  all_lines <- readLines(con, warn = FALSE)
  close(con)
  log_msg("  Total lines read: ", length(all_lines))

  is_header   <- startsWith(all_lines, ">")
  header_idx  <- which(is_header)
  n_headers   <- length(header_idx)
  log_msg("  Total headers found: ", n_headers)

  if (n_headers == 0) {
    log_msg("  No FASTA headers found - producing placeholder plot.")
    p_empty <- ggplot() +
      annotate("text", x = 0.5, y = 0.5, size = 5,
               label = "No contig headers could be parsed from the assembly FASTA.") +
      theme_void()
    save_plot(p_empty, paste0(sample_id, "_assembly_quast"), width = 10, height = 6)
    return(invisible(NULL))
  }

  header_lines <- all_lines[header_idx]

  # --- 7c. Try assembler-specific header length tags first --------------------
  # MEGAHIT / SPAdes-style: len=1234   |   Unicycler-style: length=1234
  log_msg("Attempting header-tag length parsing (len=/length=)...")
  len_tag      <- str_extract(header_lines, "(?<=[Ll]en(?:gth)?=)\\d+")
  lengths_tag  <- suppressWarnings(as.integer(len_tag))
  frac_tagged  <- sum(!is.na(lengths_tag)) / n_headers
  log_msg(sprintf("  Header-tag coverage: %.1f%%", frac_tagged * 100))

  if (frac_tagged >= 0.5) {
    log_msg("  Using header-tag lengths (sufficient coverage).")
    lengths_numeric <- lengths_tag[!is.na(lengths_tag)]
  } else {
    # --- 7d. Fallback: compute lengths directly from sequence content ---------
    # Vectorized: no assembler tag (typical of Flye/metaFlye/Canu output).
    # Avoids a one-line-at-a-time read loop, which does not scale to
    # short-read/hybrid assemblies with 10^4-10^6 contigs.
    log_msg("  Header-tag coverage insufficient. Computing lengths from sequence content (vectorized).")

    seg_id <- cumsum(is_header)                 # group id per line: which contig it belongs to
    seq_lines_mask <- !is_header
    seq_lengths_by_line <- nchar(trimws(all_lines))
    seq_lengths_by_line[is_header] <- 0L

    # Sum sequence-line lengths within each contig group; result is ordered
    # by group id 1..n_headers, matching header order in the file.
    lengths_numeric <- as.integer(tapply(seq_lengths_by_line, seg_id, sum))
    lengths_numeric <- lengths_numeric[lengths_numeric > 0]
  }
  log_msg("  Parsed ", length(lengths_numeric), " contig lengths.")

  if (length(lengths_numeric) == 0) {
    log_msg("  No contig lengths parsed - producing placeholder plot.")
    p_empty <- ggplot() +
      annotate("text", x = 0.5, y = 0.5, size = 5,
               label = "No contig lengths could be parsed from the assembly FASTA.") +
      theme_void()
    save_plot(p_empty, paste0(sample_id, "_assembly_quast"), width = 10, height = 6)
    return(invisible(NULL))
  }

  # --- 7e. Parse QUAST statistics ---------------------------------------------
  log_msg("Parsing QUAST report...")
  quast_raw <- read_tsv(quast_report, col_names = FALSE, show_col_types = FALSE,
                         comment = "")

  # Guard: this script expects a SINGLE-assembly report.tsv (2 columns:
  # metric, value). metaQUAST comparative reports (multiple assemblies
  # scored side by side, e.g. short vs long vs hybrid of the same sample)
  # produce >2 columns and must not be silently misparsed.
  if (ncol(quast_raw) != 2) {
    stop("QUAST report has ", ncol(quast_raw), " columns; expected exactly 2 ",
         "(metric, value). This looks like a multi-assembly/comparative ",
         "metaQUAST report.tsv (one column per assembly). Point this script ",
         "at a single-assembly report, or run metaQUAST per-assembly instead.")
  }
  colnames(quast_raw) <- c("metric", "value")
  quast_raw <- quast_raw %>% filter(!is.na(value))

  get_quast <- function(pattern, df = quast_raw) {
    row <- df %>% filter(str_detect(metric, regex(pattern, ignore_case = TRUE))) %>% slice(1)
    if (nrow(row) == 0) return(NA_real_)
    suppressWarnings(as.numeric(row$value))
  }

  n50          <- get_quast("^N50$")
  n90          <- get_quast("^N90$")
  l50          <- get_quast("^L50$")
  l90          <- get_quast("^L90$")
  largest      <- get_quast("Largest contig")
  total_len_bp <- get_quast("^Total length$")
  gc_pct       <- get_quast("GC")
  n_contigs    <- get_quast("# contigs$")

  log_msg(sprintf("  N50=%s  N90=%s  L50=%s  L90=%s  Largest=%s  Total=%.1f Mbp  GC=%.2f%%",
                   n50, n90, l50, l90, largest, total_len_bp / 1e6, gc_pct))

  # --- 7f. Reconcile FASTA-derived contigs with QUAST's filtered contig set ---
  # QUAST applies its own min-contig-length threshold before computing all
  # statistics above. Rather than guessing that threshold, keep the N
  # longest FASTA contigs, where N = QUAST's own "# contigs" count. This is
  # equivalent to applying QUAST's cutoff and keeps curve/statistics consistent
  # across short-read (many small contigs), long-read (few large contigs),
  # and hybrid assemblies alike.
  lengths_sorted_all <- sort(lengths_numeric, decreasing = TRUE)

  if (!is.na(n_contigs) && n_contigs > 0 && n_contigs <= length(lengths_sorted_all)) {
    if (n_contigs < length(lengths_sorted_all)) {
      log_msg(sprintf(
        "  FASTA contains %d contigs; QUAST reports %d after its min-length filter. ",
        length(lengths_sorted_all), as.integer(n_contigs)),
        "Restricting curve to the ", as.integer(n_contigs),
        " longest contigs to match QUAST statistics.")
    }
    lengths_sorted <- lengths_sorted_all[seq_len(as.integer(n_contigs))]
  } else {
    log_msg("  QUAST '# contigs' unavailable or inconsistent with FASTA; ",
            "using all FASTA-derived contigs unfiltered (statistics/curve ",
            "may not agree exactly).")
    lengths_sorted <- lengths_sorted_all
  }

  # --- 7g. Build cumulative curve data ----------------------------------------
  log_msg("Building cumulative curve...")
  n_total        <- length(lengths_sorted)
  total_assembly <- sum(as.numeric(lengths_sorted))

  cumsum_bp <- cumsum(as.numeric(lengths_sorted))
  rank_vec  <- seq_len(n_total)

  keep_every <- max(1L, floor(n_total / 3000))
  idx_core   <- seq(1, n_total, by = keep_every)

  idx_l50 <- if (!is.na(l50)) seq(max(1, l50 - 50), min(n_total, l50 + 50)) else integer(0)
  idx_l90 <- if (!is.na(l90)) seq(max(1, l90 - 50), min(n_total, l90 + 50)) else integer(0)

  idx_head <- seq(1, min(500, n_total))
  idx_tail <- seq(max(1, n_total - 500), n_total)
  keep_idx <- sort(unique(c(idx_core, idx_l50, idx_l90, idx_head, idx_tail)))

  curve_df <- data.frame(
    rank       = rank_vec[keep_idx],
    length_bp  = lengths_sorted[keep_idx],
    cumsum_mbp = cumsum_bp[keep_idx] / 1e6
  )
  log_msg("  Downsampled to ", nrow(curve_df), " plotting points from ", n_total, " contigs.")

  # --- 7h. Colour gradient zones -----------------------------------------------
  zone_breaks <- c(1, if (!is.na(l50)) l50 else n_total * 0.12,
                       if (!is.na(l90)) l90 else n_total * 0.57,
                       n_total)
  curve_df <- curve_df %>%
    mutate(zone = case_when(
      rank <= zone_breaks[2] ~ "Core (rank 1 to L50)",
      rank <= zone_breaks[3] ~ "Mid (L50 to L90)",
      TRUE                   ~ "Tail (L90 to end)"
    ))
  zone_colours <- c(
    "Core (rank 1 to L50)" = "#1A6B8A",
    "Mid (L50 to L90)"     = "#2EAA7E",
    "Tail (L90 to end)"    = "#C0433A"
  )

  # --- 7i. Annotation data frames ----------------------------------------------
  vlines_df <- data.frame(
    xint  = c(if (!is.na(l50)) l50 else NA, if (!is.na(l90)) l90 else NA),
    label = c(sprintf("N50 = %s bp\n(L50 = %s)", format(round(n50), big.mark = ","), format(round(l50), big.mark = ",")),
              sprintf("N90 = %s bp\n(L90 = %s)", format(round(n90), big.mark = ","), format(round(l90), big.mark = ","))),
    col   = c("#1A3A5C", "#6A3C2A")
  ) %>% filter(!is.na(xint))

  cum_at_l50 <- if (!is.na(l50)) cumsum_bp[min(l50, n_total)] / 1e6 else NA
  cum_at_l90 <- if (!is.na(l90)) cumsum_bp[min(l90, n_total)] / 1e6 else NA

  hlines_df <- data.frame(
    yint = c(cum_at_l50, cum_at_l90),
    col  = c("#1A3A5C", "#6A3C2A")
  ) %>% filter(!is.na(yint))

  stats_label <- paste0(
    "Assembly Statistics\n",
    "-----------------------------\n",
    sprintf("Total length  : %.2f Mbp\n", total_len_bp / 1e6),
    sprintf("# Contigs     : %s\n", format(round(n_contigs), big.mark = ",")),
    sprintf("Largest contig: %s bp\n", format(round(largest), big.mark = ",")),
    sprintf("N50           : %s bp\n", format(round(n50), big.mark = ",")),
    sprintf("N90           : %s bp\n", format(round(n90), big.mark = ",")),
    sprintf("GC (%%)        : %.2f%%", gc_pct)
  )

  # --- 7j. Build plot ------------------------------------------------------
  log_msg("Building plot...")

  p <- ggplot(curve_df, aes(x = rank, y = cumsum_mbp, colour = zone)) +
    geom_area(aes(fill = zone), alpha = 0.12, colour = NA) +
    geom_line(linewidth = 1.0) +
    { if (nrow(vlines_df) > 0)
        geom_vline(data = vlines_df, aes(xintercept = xint, colour = NULL),
                   colour = vlines_df$col, linetype = "dashed", linewidth = 0.75)
    } +
    { if (nrow(hlines_df) > 0)
        geom_hline(data = hlines_df, aes(yintercept = yint, colour = NULL),
                   colour = hlines_df$col, linetype = "dashed", linewidth = 0.55, alpha = 0.7)
    } +
    { if (nrow(vlines_df) > 0)
        geom_label(data = vlines_df,
                   aes(x = xint, y = total_assembly / 1e6 * 0.20,
                       label = label, colour = NULL),
                   fill = "white", colour = vlines_df$col,
                   size = 3.1, fontface = "bold", label.size = 0.3,
                   hjust = -0.08, lineheight = 1.1)
    } +
    annotate("label", x = 1, y = total_assembly / 1e6 * 0.97,
             label = stats_label, hjust = 0, vjust = 1,
             size = 3.2, fontface = "bold", family = "mono",
             colour = "black", fill = "#F5F8FA",
             label.size = 0.4, lineheight = 1.25) +
    scale_x_log10(
      labels = label_comma(),
      breaks = 10^(0:6),
      minor_breaks = NULL,
      expand = expansion(mult = c(0.01, 0.05))
    ) +
    scale_y_continuous(
      labels = function(x) sprintf("%.0f Mbp", x),
      expand = expansion(mult = c(0, 0.04))
    ) +
    scale_colour_manual(values = zone_colours, name = "Assembly Zone") +
    scale_fill_manual(values = zone_colours, name = "Assembly Zone") +
    labs(
      title    = "Cumulative Contig Length Assembly Curve",
      subtitle = paste0("Sample ID: ", sample_id,
                         " | Total assembly: ", sprintf("%.2f Mbp", total_assembly / 1e6),
                         " | ", format(round(n_contigs), big.mark = ","), " contigs"),
      x        = "Contig Rank (log10 scale, sorted by decreasing length)",
      y        = "Cumulative Assembly Size (Mbp)"
    ) +
    pub_theme

  # --- 7k. Save --------------------------------------------------------------
  save_plot(p, paste0(sample_id, "_assembly_quast"), width = 14, height = 8)
}

# --- 8. RUN WITH ERROR HANDLING ------------------------------------------------
result <- tryCatch({
  main()
  log_msg("Script completed successfully.")
  0
}, error = function(e) {
  log_msg("ERROR: ", conditionMessage(e))
  1
})

# --- 9. REPRODUCIBILITY / VALIDATION HOOK --------------------------------------
log_msg("---- sessionInfo() ----")
cat(capture.output(sessionInfo()), sep = "\n", file = log_con, append = TRUE)
log_msg("Log written to: ", log_file)
close(log_con)

quit(save = "no", status = result)

