#!/usr/bin/env Rscript
# =============================================================================
# mapping.R  (v13 - Single-Sample Production Release, SVG+PDF output)
# Read Mapping Statistics & Contig Assembly Topology Visualisation Engine
# Pipeline: Metagenomics / WGS Automated Downstream Analysis Asset
#
# Data-type agnostic: operates on standard *.sorted.bam + samtools flagstat
# output and CoverM/MetaBAT-style *_depth.txt contig-depth tables. Nothing in
# the parsing or plotting logic is specific to short-read, long-read, or
# hybrid assemblies -- it only ever sees a BAM file and a depth table, so any
# upstream aligner (bwa-mem2, minimap2, etc.) that produces these two
# artefacts is supported without modification.
#
# -----------------------------------------------------------------------
# CLI ARGUMENT CONTRACT (positional, all required unless marked optional)
#   1) BAM_PATH     path to <sample>.sorted.bam  (must be indexed or plain;
#                    only samtools flagstat is run against it)
#   2) OUTPUT_DIR   pipeline-provided writable directory for plots + log
#                    (created if it does not exist)
#   3) SAMPLE_ID    explicit sample identifier used in filenames/titles
#                    (never parsed/guessed from a path string)
#   4) DEPTH_FILE   [optional] path to <sample>_depth.txt (CoverM/MetaBAT
#                    format: contigName, contigLen, avgDepth, ..., depthVar).
#                    If omitted, the script looks for
#                    "<dirname(BAM_PATH)>/<SAMPLE_ID>_depth.txt".
#
#   Example invocation:
#     Rscript mapping.R \
#       /data/sampleA/mapping/sampleA.sorted.bam \
#       /results/sampleA/figures \
#       sampleA \
#       /data/sampleA/mapping/sampleA_depth.txt
#
#   Output: for every figure "<base>" produced, both <base>.svg and
#           <base>.pdf are written to OUTPUT_DIR (no PNG output).
#
#   v13 CHANGELOG:
#     - Fixed "Depth Colour Codes" sidebar legend box being visually smaller
#       than its content due to aspect-ratio compression from plot_grid();
#       box bounds enlarged and coord_cartesian(clip = "off") added.
#     - Fixed "Structural Stability Risk" sidebar text colour (red -> black)
#       and fixed the long chimeric/repeat warning line being clipped at the
#       panel edge (explicit line-wrapping + clip = "off").
# -----------------------------------------------------------------------

# -- 0. ARGUMENT PARSING & VALIDATION (fail loudly, before anything else) ----
args <- commandArgs(trailingOnly = TRUE)

if (length(args) < 3) {
  message("[FATAL] Usage: Rscript mapping.R <BAM_PATH> <OUTPUT_DIR> <SAMPLE_ID> [DEPTH_FILE]")
  message(sprintf("[FATAL] Received %d argument(s): %s", length(args), paste(args, collapse = " | ")))
  quit(status = 1)
}

bam_path_raw   <- args[1]
output_dir_raw <- args[2]
sample_id      <- args[3]
depth_file_raw <- if (length(args) >= 4) args[4] else NA_character_

if (!file.exists(bam_path_raw)) {
  message(sprintf("[FATAL] BAM_PATH does not exist: %s", bam_path_raw))
  quit(status = 1)
}
if (nchar(sample_id) == 0) {
  message("[FATAL] SAMPLE_ID must be a non-empty string.")
  quit(status = 1)
}

dir.create(output_dir_raw, recursive = TRUE, showWarnings = FALSE)
if (!dir.exists(output_dir_raw)) {
  message(sprintf("[FATAL] OUTPUT_DIR could not be created/accessed: %s", output_dir_raw))
  quit(status = 1)
}

bam_path   <- normalizePath(bam_path_raw, mustWork = TRUE)
output_dir <- normalizePath(output_dir_raw, mustWork = TRUE)
plot_dir   <- output_dir
bam_dir    <- dirname(bam_path)

depth_path <- if (!is.na(depth_file_raw)) {
  depth_file_raw
} else {
  file.path(bam_dir, paste0(sample_id, "_depth.txt"))
}

# -- 1. LOGGING SETUP ---------------------------------------------------------
log_file <- file.path(output_dir, paste0(sample_id, "_mapping_run.log"))

log_msg <- function(msg, level = "INFO") {
  ts   <- format(Sys.time(), "%Y-%m-%d %H:%M:%S")
  line <- sprintf("[%s] [%s] %s", ts, level, msg)
  cat(line, "\n", sep = "")
  cat(line, "\n", sep = "", file = log_file, append = TRUE)
}

log_msg(sprintf("=== mapping.R (single-sample) run started for sample: %s ===", sample_id))
log_msg(sprintf("BAM_PATH   : %s", bam_path))
log_msg(sprintf("OUTPUT_DIR : %s", output_dir))
log_msg(sprintf("DEPTH_FILE : %s", depth_path))

# -- 2. PACKAGES (defensive load) --------------------------------------------
# NOTE: svglite is required for ggsave(..., device = "svg") output.
required_pkgs <- c("ggplot2", "dplyr", "tidyr", "readr", "stringr",
                    "RColorBrewer", "viridis", "cowplot", "svglite")

missing_pkgs <- required_pkgs[!vapply(required_pkgs, requireNamespace, logical(1), quietly = TRUE)]
if (length(missing_pkgs) > 0) {
  log_msg(sprintf("Missing required R package(s): %s", paste(missing_pkgs, collapse = ", ")), "FATAL")
  quit(status = 1)
}
suppressPackageStartupMessages({
  library(ggplot2); library(dplyr); library(tidyr); library(readr)
  library(stringr); library(RColorBrewer); library(viridis); library(cowplot)
  library(svglite)
})
log_msg("All required packages loaded successfully.")

# -- 3. GRACEFUL FALLBACK HELPER ---------------------------------------------
make_placeholder <- function(msg) {
  ggplot() +
    annotate("text", x = 0.5, y = 0.5, label = msg,
             size = 6.0, hjust = 0.5, vjust = 0.5,
             color = "#37474F", fontface = "italic") +
    theme_void() +
    theme(plot.background = element_rect(fill = "#FAFAFA", color = NA))
}

# save_gg() writes <base>.svg and <base>.pdf (PNG output removed).
save_gg <- function(p, base, w, h) {
  out_ok <- tryCatch({
    ggsave(file.path(plot_dir, paste0(base, ".svg")), plot = p,
           width = w, height = h, dpi = 300, bg = "white", device = "svg")
    ggsave(file.path(plot_dir, paste0(base, ".pdf")), plot = p,
           width = w, height = h, bg = "white", device = "pdf")
    TRUE
  }, error = function(e) {
    log_msg(sprintf("Failed to save plot '%s': %s", base, conditionMessage(e)), "ERROR")
    FALSE
  })
  if (out_ok) log_msg(sprintf("Saved: %s.svg and %s.pdf", base, base))
  invisible(out_ok)
}

# -- 4. SAMTOOLS PATH RESOLUTION ----------------------------------------------
resolve_samtools <- function() {
  st <- Sys.which("samtools")
  if (nchar(st) > 0) return(st)
  fallback <- path.expand("~/.conda/envs/marine/bin/samtools")
  if (file.exists(fallback)) return(fallback)
  return(NULL)
}
samtools_bin <- resolve_samtools()
if (is.null(samtools_bin)) {
  log_msg("samtools binary not found on PATH or in fallback conda env; flagstat generation will be skipped if no pre-existing .flagstat file is present.", "WARN")
} else {
  log_msg(sprintf("Using samtools binary: %s", samtools_bin))
}

# =============================================================================
# MAIN PIPELINE (wrapped for defensive execution)
# =============================================================================
main <- function() {

  # -- 5. FLAGSTAT GENERATION & PARSING (single sample) ----------------------
  # NOTE: flagstat output is written to OUTPUT_DIR (writable), not next to the
  # BAM, since BAM_DIR is frequently a read-only input mount in HPC pipelines.
  generate_flagstat <- function(bam_path, sid) {
    out_path <- file.path(output_dir, paste0(sid, ".flagstat"))
    if (file.exists(out_path)) {
      log_msg(sprintf("Existing flagstat file found, reusing: %s", out_path))
      return(out_path)
    }
    if (is.null(samtools_bin)) {
      log_msg("Cannot generate flagstat: samtools not available.", "WARN")
      return(NULL)
    }
    log_msg(sprintf("Running samtools flagstat on: %s", bam_path))
    ret <- system2(samtools_bin, args = c("flagstat", shQuote(bam_path)),
                    stdout = out_path, stderr = FALSE)
    if (ret != 0 || !file.exists(out_path)) {
      log_msg(sprintf("samtools flagstat failed (exit code %s) for %s", ret, bam_path), "ERROR")
      return(NULL)
    }
    out_path
  }

  parse_flagstat <- function(flagstat_path, sid) {
    if (is.null(flagstat_path) || !file.exists(flagstat_path)) return(NULL)
    lines <- readLines(flagstat_path, warn = FALSE)

    extract_count <- function(pattern) {
      hit <- lines[grepl(pattern, lines, fixed = TRUE)]
      if (length(hit) == 0) return(NA_real_)
      as.numeric(str_extract(hit[1], "^[0-9]+"))
    }

    total         <- extract_count("in total")
    mapped        <- extract_count("mapped (")
    properly_pair <- extract_count("properly paired")
    singletons    <- extract_count("singletons")
    unmapped      <- replace_na(total, 0) - replace_na(mapped, 0)

    tibble(
      Sample = sid, `Total Reads` = total, `Mapped Reads` = mapped,
      `Properly Paired` = properly_pair, `Singletons` = singletons, `Unmapped Reads` = unmapped
    )
  }

  fs_path <- generate_flagstat(bam_path, sample_id)
  flagstat_df <- parse_flagstat(fs_path, sample_id)
  if (is.null(flagstat_df)) flagstat_df <- tibble()
  log_msg(sprintf("Flagstat parsing complete. Rows parsed: %d", nrow(flagstat_df)))

  # =============================================================================
  # FLAGSTAT PLOTTING SYSTEM
  # =============================================================================
  if (nrow(flagstat_df) == 0) {
    log_msg("No flagstat data available; writing placeholder plot.", "WARN")
    p_ph <- make_placeholder(sprintf("Flagstat data unavailable for sample: %s", sample_id))
    save_gg(p_ph, "mapping_flagstat", 20, 12)
  } else {

    metric_palette <- c(
      "Total Reads"      = "#37474F", "Mapped Reads"     = "#1565C0",
      "Properly Paired"  = "#2DC653", "Singletons"       = "#E07B39",
      "Unmapped Reads"   = "#E63946"
    )

    flagstat_long <- flagstat_df %>%
      pivot_longer(-Sample, names_to = "Metric", values_to = "Count") %>%
      mutate(Metric = factor(Metric, levels = names(metric_palette))) %>%
      group_by(Sample) %>%
      mutate(
        TotalPool = Count[Metric == "Total Reads"],
        Pct = round(Count / TotalPool * 100, 2),
        CountLabel = sprintf("%.2fM", Count / 1e6),
        BarLabel = if_else(Metric == "Total Reads", CountLabel, sprintf("%s\n(%s%%)", CountLabel, Pct)),
        PlotCount = case_when(
          Metric == "Unmapped Reads" ~ Count / 1e6,
          Metric == "Properly Paired" ~ pmax(Count / 1e6, max(Count / 1e6) * 0.022),
          TRUE ~ Count / 1e6
        )
      ) %>%
      ungroup()

    p_flagstat <- ggplot(flagstat_long, aes(x = Metric, y = PlotCount, fill = Metric)) +
      geom_col(position = position_dodge(width = 0.8), width = 0.72, color = "black", linewidth = 0.8) +
      geom_text(aes(label = BarLabel, y = PlotCount), position = position_dodge(width = 0.8), vjust = -0.35, size = 4.8, fontface = "bold", color = "black") +
      scale_fill_manual(values = metric_palette, name = "Alignment Metrics") +
      scale_y_continuous(expand = expansion(mult = c(0, 0.16)), labels = function(x) paste0(x, "M")) +
      labs(
        title = "Read Mapping Quality Statistics Summary",
        subtitle = sprintf("Sample Profile: %s  |  Total Sequencing Yield: %s reads", flagstat_df$Sample[1], format(flagstat_df$`Total Reads`[1], big.mark=",")),
        x = "Alignment Data Class",
        y = "Absolute Read Depth (Millions of Reads)"
      ) +
      theme_minimal(base_size = 14) +
      theme(
        plot.title = element_text(face = "bold", size = 22, color = "black", margin = margin(b = 6)),
        plot.subtitle = element_text(face = "bold", size = 14, color = "#555555", margin = margin(b = 14)),
        axis.text.x = element_text(size = 16, face = "bold", color = "black"),
        axis.text.y = element_text(size = 16, face = "bold", color = "black"),
        axis.title.x = element_text(size = 16, face = "bold", color = "black", margin = margin(t = 10)),
        axis.title.y = element_text(size = 16, face = "bold", color = "black", margin = margin(r = 10)),
        axis.line = element_line(color = "black", linewidth = 1.2),
        panel.grid.major.x = element_blank(),
        panel.grid.major.y = element_line(color = "#E0E0E0", linewidth = 0.5),
        panel.grid.minor = element_blank(),
        legend.position = "bottom",
        legend.title = element_text(face = "bold", size = 14),
        legend.text = element_text(face = "bold", size = 14),
        plot.background = element_rect(fill = "white", color = NA),
        panel.background = element_rect(fill = "white", color = NA),
        plot.margin = margin(16, 16, 16, 16)
      )

    log_msg("Saving mapping_flagstat bar chart.")
    save_gg(p_flagstat, "mapping_flagstat", 20, 12)
  }

  # -- 10. DEPTH PROFILE -- READ & PARSE depth file ---------------------------
  read_depth <- function(sid, dpath) {
    if (!file.exists(dpath)) {
      log_msg(sprintf("Depth file not found: %s", dpath), "WARN")
      return(NULL)
    }
    df <- tryCatch(
      read_tsv(dpath, col_types = cols(.default = "d", contigName = "c"), show_col_types = FALSE),
      error = function(e) {
        log_msg(sprintf("Failed to parse depth file '%s': %s", dpath, conditionMessage(e)), "ERROR")
        NULL
      }
    )
    if (is.null(df) || ncol(df) < 3) return(NULL)
    out <- tibble(Sample = sid, contigName = df[[1]], contigLen = as.numeric(df[[2]]), avgDepth = as.numeric(df[[3]]))
    if (ncol(df) >= 5) out$depthVar <- as.numeric(df[[5]]) else out$depthVar <- NA_real_
    out %>% filter(!is.na(avgDepth), avgDepth >= 0, contigLen > 0)
  }

  depth_all <- read_depth(sample_id, depth_path)
  if (is.null(depth_all)) depth_all <- tibble()
  log_msg(sprintf("Depth table parsing complete. Contigs parsed: %d", nrow(depth_all)))

  if (nrow(depth_all) == 0) {
    log_msg("No contig depth data available; writing placeholder plot.", "WARN")
    p_ph <- make_placeholder(sprintf("No contig depth statistics available for sample: %s", sample_id))
    save_gg(p_ph, "mapping_depth_profile", 20, 16)
    return(invisible(NULL))
  }

  # -- 11. DEPTH TIER CONFIGURATION --------------------------------------------
  depth_all <- depth_all %>%
    mutate(
      DepthTier = case_when(avgDepth < 5 ~ "Low (<5x)", avgDepth < 20 ~ "Medium (5-20x)", TRUE ~ "High (>20x)"),
      DepthTier = factor(DepthTier, levels = c("Low (<5x)", "Medium (5-20x)", "High (>20x)"))
    )

  tier_colors <- c("Low (<5x)" = "#E63946", "Medium (5-20x)" = "#F4A261", "High (>20x)" = "#2DC653")

  # =============================================================================
  # FLOATING INFOGRAPHIC COMPONENTS
  # =============================================================================

  build_p_hist_panel <- function(df) {
    med_depth <- median(df$avgDepth, na.rm = TRUE)
    n_contigs <- nrow(df)

    ggplot(df, aes(x = avgDepth + 0.01, fill = DepthTier)) +
      geom_histogram(bins = 80, color = "white", linewidth = 0.25, alpha = 0.92) +
      geom_vline(xintercept = 5,  linetype = "dashed", color = "black", linewidth = 1.2) +
      geom_vline(xintercept = 20, linetype = "dashed", color = "black", linewidth = 1.2) +
      geom_vline(xintercept = med_depth, linetype = "solid", color = "#1565C0", linewidth = 1.2) +

      scale_x_log10(limits = c(0.1, 1200), breaks = c(0.1, 1, 5, 10, 20, 50, 100, 500, 1000), labels = function(x) paste0(x, "x")) +
      scale_fill_manual(values = tier_colors, guide = "none") +
      scale_y_continuous(limits = c(0, 13500), labels = function(x) format(x, big.mark = ","), expand = c(0, 0)) +
      labs(
        title = "Per-Contig Mean Coverage Depth Distribution",
        subtitle = sprintf("Assembly Landscape Look-up  |  Total Elements: %s contigs", format(n_contigs, big.mark=",")),
        x = "Mean Sequence Coverage Depth (log10 scale)", y = "Number of Contigs"
      ) +
      theme_minimal(base_size = 14) +
      theme(
        plot.title = element_text(face = "bold", size = 20, color = "black", margin = margin(b = 4)),
        plot.subtitle = element_text(face = "bold", size = 13, color = "#555555", margin = margin(b = 10)),
        axis.text.x = element_text(size = 16, face = "bold", color = "black"),
        axis.text.y = element_text(size = 16, face = "bold", color = "black"),
        axis.title = element_text(size = 16, face = "bold", color = "black"),
        axis.line = element_line(color = "black", linewidth = 1.2),
        panel.grid.minor = element_blank(), panel.grid.major = element_line(color = "#EEEEEE", linewidth = 0.45),
        plot.margin = margin(20, 10, 20, 10)
      )
  }

  # ---------------------------------------------------------------------------
  # FIX (v13): "Depth Colour Codes" box enlarged to fully contain its content
  # regardless of the aspect-ratio compression introduced by plot_grid(), and
  # clip = "off" added so nothing is cut at the panel boundary.
  # ---------------------------------------------------------------------------
  build_hist_sidebar_cards <- function(df) {
    tier_pct <- df %>% count(DepthTier) %>% mutate(Pct = round(n / sum(n) * 100, 1))
    tier_label <- paste(sapply(levels(df$DepthTier), function(t) {
      row <- tier_pct[tier_pct$DepthTier == t, ]
      val <- if (nrow(row) == 0) "0.0%" else paste0(row$Pct, "%")
      sprintf(" - %s: %s", t, val)
    }), collapse = "\n")

    card_text <- sprintf("Assembly Tier Split\n%s", tier_label)

    ggplot() +
      annotate("label", x = 0.5, y = 0.86, label = card_text, size = 5.4, fontface = "bold",
               fill = "white", color = "black", label.size = 1.5, label.padding = unit(0.8, "lines")) +

      # Enlarged legend box (was ymin=0.22, ymax=0.62 -> now spans more
      # vertical room so the title + 3 swatch rows never overflow it)
      annotate("rect", xmin = 0.06, xmax = 0.94, ymin = 0.10, ymax = 0.60, fill = "white", color = "black", linewidth = 1.0) +
      annotate("text", x = 0.5, y = 0.54, label = "Depth Colour Codes", size = 5.6, fontface = "bold", color = "black") +

      annotate("rect", xmin = 0.14, xmax = 0.25, ymin = 0.415, ymax = 0.465, fill = "#E63946") +
      annotate("text", x = 0.29, y = 0.44, label = "Low Depth (<5x)", size = 5.2, fontface = "bold", hjust = 0) +

      annotate("rect", xmin = 0.14, xmax = 0.25, ymin = 0.305, ymax = 0.355, fill = "#F4A261") +
      annotate("text", x = 0.29, y = 0.33, label = "Medium Depth (5-20x)", size = 5.2, fontface = "bold", hjust = 0) +

      annotate("rect", xmin = 0.14, xmax = 0.25, ymin = 0.195, ymax = 0.245, fill = "#2DC653") +
      annotate("text", x = 0.29, y = 0.22, label = "High Depth (>20x)", size = 5.2, fontface = "bold", hjust = 0) +

      scale_x_continuous(limits = c(0, 1)) + scale_y_continuous(limits = c(0, 1)) +
      coord_cartesian(clip = "off") +
      theme_void() +
      theme(plot.margin = margin(l = 5, r = 5, t = 5, b = 5))
  }

  build_p_hex_panel <- function(df) {
    depth_cap <- quantile(df$avgDepth, 0.999, na.rm = TRUE)
    len_cap   <- quantile(df$contigLen, 0.999, na.rm = TRUE)
    df_plot   <- df %>% filter(avgDepth > 0, contigLen > 0) %>% mutate(avgDepth_capped = pmin(avgDepth, depth_cap), contigLen_capped = pmin(contigLen, len_cap))

    p <- ggplot(df_plot, aes(x = contigLen_capped, y = avgDepth_capped)) +
      geom_hex(bins = 75, aes(fill = after_stat(log10(count + 1)))) +
      geom_hline(yintercept = 5,  linetype = "dashed", color = "#5D4037", linewidth = 0.9, alpha = 0.85) +
      geom_hline(yintercept = 20, linetype = "dashed", color = "#5D4037", linewidth = 0.9, alpha = 0.85) +
      annotate("text", x = 1100, y = 5,  label = "5x threshold", hjust = 0, vjust = -0.5, color = "#1B5E20", size = 4.2, fontface = "bold") +
      annotate("text", x = 1100, y = 20, label = "20x threshold", hjust = 0, vjust = -0.5, color = "#1B5E20", size = 4.2, fontface = "bold") +
      scale_x_log10(limits = c(900, 110000), breaks = c(1000, 2000, 5000, 10000, 50000, 100000), labels = function(x) { ifelse(x >= 1000, paste0(round(x / 1000, 0), "kb"), paste0(x, "bp")) }) +
      scale_y_log10(limits = c(0.8, 550), breaks = c(1, 5, 10, 20, 50, 100, 500), labels = function(x) paste0(x, "x")) +
      scale_fill_viridis_c(option = "plasma", name = "log10(Contig count + 1)", guide = guide_colorbar(title.position = "top", barwidth = unit(6.0, "cm"), barheight = unit(0.4, "cm"), ticks.colour = "black")) +
      labs(
        title = "Contig Sequence Length vs. Mean Coverage Depth Topology",
        subtitle = "Hex-bin density landscape architecture mapping  |  log10 coordinates",
        x = "Contig Basepair Sizing Length (log10 scale)", y = "Mean Sequence Coverage Depth (log10 scale)"
      ) +
      theme_minimal(base_size = 14) +
      theme(
        plot.title = element_text(face = "bold", size = 20, color = "black", margin = margin(b = 4)),
        plot.subtitle = element_text(face = "bold", size = 13, color = "#555555", margin = margin(b = 10)),
        axis.text.x = element_text(size = 18, face = "bold", color = "black"),
        axis.text.y = element_text(size = 16, face = "bold", color = "black"),
        axis.title = element_text(size = 16, face = "bold", color = "black"),
        axis.line = element_line(color = "black", linewidth = 1.2),
        panel.grid.minor = element_blank(), panel.grid.major = element_line(color = "#EEEEEE", linewidth = 0.45),
        legend.position = "bottom", legend.title = element_text(face = "bold", size = 12), legend.text = element_text(face = "bold", size = 11),
        plot.margin = margin(10, 10, 10, 10)
      )
    p
  }

  # ---------------------------------------------------------------------------
  # FIX (v13): text colour changed red -> black, and the long chimeric/repeat
  # warning line is now explicitly wrapped so it can no longer be truncated
  # at the panel edge ("RNING] Potential chimeric/repeat reg" bug). Also added
  # clip = "off" as a second layer of protection against edge clipping.
  # ---------------------------------------------------------------------------
  build_hex_sidebar_cards <- function(df) {
    valid <- df %>% filter(!is.na(depthVar), !is.na(avgDepth), avgDepth > 0)
    if (nrow(valid) == 0 || all(is.na(df$depthVar))) {
      var_text <- "Depth variance data not available"
    } else {
      n_highvar <- sum(valid$depthVar > 3 * valid$avgDepth, na.rm = TRUE)
      var_text <- sprintf(
        "Structural Stability Risk\n - High-variance contigs:\n   %s / %s (%.2f%%)\n   [depth-var > 3 x mean depth]\n\nWarning: Potential\nchimeric/repeat regions.",
        format(n_highvar, big.mark=","), format(nrow(valid), big.mark=","), (n_highvar / nrow(valid) * 100)
      )
    }

    ggplot() +
      annotate("label", x = 0.5, y = 0.5, label = var_text, size = 5.2, fontface = "bold",
               fill = "white", color = "black", label.size = 1.5, label.padding = unit(0.8, "lines")) +
      scale_x_continuous(limits = c(0, 1)) + scale_y_continuous(limits = c(0, 1)) +
      coord_cartesian(clip = "off") +
      theme_void() +
      theme(plot.margin = margin(l = 5, r = 5, t = 5, b = 5))
  }

  # -- 15. CANVAS ASSEMBLY (single-sample path) --------------------------------
  df_single <- depth_all

  p_top_graph   <- build_p_hist_panel(df_single)
  p_top_sidebar <- build_hist_sidebar_cards(df_single)

  p_bot_graph   <- build_p_hex_panel(df_single)
  p_bot_sidebar <- build_hex_sidebar_cards(df_single)

  row_top <- plot_grid(p_top_graph, p_top_sidebar, nrow = 1, rel_widths = c(0.76, 0.24))
  row_bot <- plot_grid(p_bot_graph, p_bot_sidebar, nrow = 1, rel_widths = c(0.76, 0.24))

  unified_depth_profile <- plot_grid(
    row_top, row_bot,
    nrow = 2, align = "v", axis = "lr",
    rel_heights = c(0.49, 0.51),
    labels = c("C", "D"), label_size = 18, label_fontface = "bold"
  )

  log_msg("Saving mapping_depth_profile composite figure.")
  save_gg(unified_depth_profile, "mapping_depth_profile", 20, 16)

  invisible(NULL)
}

# -- 16. DEFENSIVE EXECUTION WRAPPER ------------------------------------------
exit_status <- tryCatch({
  main()
  0L
}, error = function(e) {
  log_msg(sprintf("Unhandled error during execution: %s", conditionMessage(e)), "FATAL")
  log_msg(paste(capture.output(print(sys.calls())), collapse = "\n"), "TRACE")
  1L
})

# -- 17. REPRODUCIBILITY FOOTER ------------------------------------------------
log_msg("--- sessionInfo() ---")
cat(paste(capture.output(sessionInfo()), collapse = "\n"), "\n", file = log_file, append = TRUE)
log_msg(sprintf("=== mapping.R run finished for sample: %s (exit status %d) ===", sample_id, exit_status))

quit(status = exit_status)
