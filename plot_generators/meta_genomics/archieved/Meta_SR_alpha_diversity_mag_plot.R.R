#!/usr/bin/env Rscript
# ============================================================================
# mag_alpha_diversity.R
#
# Expected CLI argument order (positional, exactly 3 args):
#   1. COVERM_GENOME_TSV  - path to CoverM genome relative-abundance TSV
#                            (MAG x sample table, includes an "Unmapped" row)
#   2. OUTPUT_DIR         - path to directory where figures + log are written
#   3. SAMPLE_ID          - sample identifier string
#
# Invocation:
#   Rscript mag_alpha_diversity.R \
#     /path/to/coverm_genome_relative_abundance.tsv \
#     /path/to/output_dir \
#     SAMPLE01
# ============================================================================

## ---------------------------------------------------------------------------
## 0. ARGUMENT PARSING & VALIDATION
## ---------------------------------------------------------------------------
args <- commandArgs(trailingOnly = TRUE)

if (length(args) != 3) {
  message("[FATAL] Expected exactly 3 arguments: COVERM_GENOME_TSV OUTPUT_DIR SAMPLE_ID")
  message(sprintf("[FATAL] Received %d argument(s): %s", length(args), paste(args, collapse = " ")))
  quit(status = 1)
}

coverm_tsv  <- args[1]
output_dir  <- args[2]
sample_id   <- args[3]

if (!dir.exists(output_dir)) {
  dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
}

log_file <- file.path(output_dir, paste0(sample_id, "_mag_alpha_diversity_run.log"))

log_msg <- function(...) {
  msg <- paste0("[", format(Sys.time(), "%Y-%m-%d %H:%M:%S"), "] ", paste0(..., collapse = " "))
  cat(msg, "\n", file = log_file, append = TRUE)
}

log_msg("=== mag_alpha_diversity.R started ===")
log_msg("Script: mag_alpha_diversity.R")
log_msg("Resolved COVERM_GENOME_TSV: ", normalizePath(coverm_tsv, mustWork = FALSE))
log_msg("Resolved OUTPUT_DIR: ", normalizePath(output_dir, mustWork = FALSE))
log_msg("SAMPLE_ID: ", sample_id)

## ---------------------------------------------------------------------------
## 1. DEPENDENCIES
## ---------------------------------------------------------------------------
required_pkgs <- c("ggplot2", "dplyr", "tidyr", "readr", "vegan", "scales", "svglite")

load_pkg <- function(pkg) {
  ok <- suppressWarnings(suppressMessages(requireNamespace(pkg, quietly = TRUE)))
  if (!ok) {
    log_msg("[FATAL] Required package '", pkg, "' is not installed.")
    message(sprintf("[FATAL] Required package '%s' is not installed.", pkg))
    quit(status = 1)
  }
  suppressPackageStartupMessages(library(pkg, character.only = TRUE))
  log_msg("Loaded package: ", pkg, " (version ", as.character(utils::packageVersion(pkg)), ")")
}

for (p in required_pkgs) load_pkg(p)

## ---------------------------------------------------------------------------
## 2. REUSABLE PUBLICATION THEME (Section C typography spec)
## ---------------------------------------------------------------------------
pub_theme <- theme_bw() +
  theme(
    plot.title      = element_text(size = 18, color = "black", face = "bold"),
    plot.subtitle   = element_text(size = 13, color = "black", face = "bold"),
    legend.text     = element_text(size = 12, color = "black", face = "bold"),
    legend.title    = element_text(size = 12, color = "black", face = "bold"),
    axis.text       = element_text(size = 14, color = "black", face = "bold"),
    axis.title      = element_text(size = 16, color = "black", face = "bold"),
    strip.text      = element_text(size = 12, color = "black", face = "bold", lineheight = 0.85),
    strip.background = element_rect(fill = "grey90", color = "black"),
    strip.clip      = "off",
    panel.grid.major = element_blank(),
    panel.grid.minor = element_blank(),
    panel.border     = element_rect(color = "black", fill = NA, linewidth = 0.6),
    axis.line        = element_line(color = "black", linewidth = 0.4),
    axis.ticks       = element_line(color = "black", linewidth = 0.4),
    panel.spacing    = unit(1.1, "lines")
  )

ACCENT_COLOR <- "#1F78B4"  # flat accent color for single-sample plots

## ---------------------------------------------------------------------------
## 3. MAIN LOGIC (wrapped in tryCatch)
## ---------------------------------------------------------------------------
main <- function() {

  ## --- 3.1 File existence check -------------------------------------------
  if (!file.exists(coverm_tsv)) {
    stop(sprintf("Input file does not exist: %s", coverm_tsv))
  }
  log_msg("Step: file existence check passed for COVERM_GENOME_TSV")

  ## --- 3.2 Read input -------------------------------------------------------
  raw_tbl <- readr::read_tsv(coverm_tsv, show_col_types = FALSE)
  log_msg("Step: file read complete. Raw row count = ", nrow(raw_tbl),
          " | columns = ", paste(colnames(raw_tbl), collapse = ", "))

  if (ncol(raw_tbl) < 2) {
    stop("Input table must have at least 2 columns (genome/bin ID + one abundance column).")
  }

  genome_col <- colnames(raw_tbl)[1]
  # First numeric column is treated as the relative-abundance column for this sample
  numeric_cols <- names(raw_tbl)[vapply(raw_tbl, is.numeric, logical(1))]
  if (length(numeric_cols) < 1) {
    stop("No numeric relative-abundance column found in input table.")
  }
  abund_col <- numeric_cols[1]
  log_msg("Using genome/bin ID column: '", genome_col, "'")
  log_msg("Using relative-abundance column: '", abund_col, "'")

  raw_mag_count <- nrow(raw_tbl)

  ## --- 3.3 Identify and remove "Unmapped" row (case-insensitive) -----------
  is_unmapped <- tolower(trimws(as.character(raw_tbl[[genome_col]]))) == "unmapped"
  n_unmapped_rows <- sum(is_unmapped)

  unmapped_abund_sum <- if (n_unmapped_rows > 0) {
    sum(raw_tbl[[abund_col]][is_unmapped], na.rm = TRUE)
  } else {
    0
  }

  retained_tbl <- raw_tbl[!is_unmapped, , drop = FALSE]
  log_msg("Step: Unmapped-row removal complete. Rows matched as 'Unmapped' = ",
          n_unmapped_rows, " | Rows retained = ", nrow(retained_tbl))

  if (n_unmapped_rows == 0) {
    log_msg("[WARNING] No 'Unmapped' row was found in the input table. ",
            "% Mapped/Recovered will be computed as 100% by definition, which is ",
            "biologically implausible for a real metagenome and usually indicates ",
            "the input file is not CoverM's relative_abundance-mode output with an ",
            "Unmapped row (e.g. a coverage/depth table was supplied instead). ",
            "Verify the CoverM run/method used to generate this input file.")
  }

  retained_mag_count <- nrow(retained_tbl)

  if (retained_mag_count == 0) {
    stop("Zero MAG rows remain after removing 'Unmapped' row(s). Cannot compute diversity on an empty vector.")
  }

  ## --- 3.4 Compute % Mapped/Recovered (PRE-renormalization) ----------------
  total_abund_raw <- sum(raw_tbl[[abund_col]], na.rm = TRUE)
  retained_abund_raw_sum <- sum(retained_tbl[[abund_col]], na.rm = TRUE)

  pct_mapped <- if (total_abund_raw > 0) {
    (retained_abund_raw_sum / total_abund_raw) * 100
  } else {
    log_msg("[WARNING] Total raw abundance sum is 0; % Mapped/Recovered set to NA.")
    NA_real_
  }
  log_msg("Step: % Mapped/Recovered computed (pre-renormalization) = ", round(pct_mapped, 4), "%")

  ## --- 3.5 Renormalize retained MAG abundances to sum to 100% --------------
  if (retained_abund_raw_sum <= 0) {
    stop("Sum of retained MAG relative abundances is <= 0; cannot renormalize.")
  }
  retained_tbl$renorm_abund_pct <- (retained_tbl[[abund_col]] / retained_abund_raw_sum) * 100
  log_msg("Step: renormalization complete. Sum of renormalized abundances = ",
          round(sum(retained_tbl$renorm_abund_pct), 6), "%")

  ## --- 3.6 Diversity index calculations (on renormalized, MAG-only vector) -
  abund_vec <- retained_tbl$renorm_abund_pct
  abund_prop <- abund_vec / sum(abund_vec)  # proportions for vegan

  richness_S <- retained_mag_count

  shannon_H <- as.numeric(vegan::diversity(matrix(abund_prop, nrow = 1), index = "shannon"))
  simpson_1D <- as.numeric(vegan::diversity(matrix(abund_prop, nrow = 1), index = "simpson"))

  if (richness_S == 1) {
    log_msg("[WARNING] Richness S = 1 -> ln(S) = 0; Pielou's evenness set to NA to avoid divide-by-zero.")
    pielou_J <- NA_real_
  } else {
    pielou_J <- shannon_H / log(richness_S)
  }

  log_msg("Step: diversity index calculation complete. Richness(S)=", richness_S,
          " Shannon(H')=", round(shannon_H, 6),
          " GiniSimpson(1-D)=", round(simpson_1D, 6),
          " Pielou(J')=", ifelse(is.na(pielou_J), "NA", round(pielou_J, 6)))

  ## --- 3.7 Shared index labels ------------------------------------------
  index_levels <- c("MAG Richness (S)", "Shannon Diversity Index (H\u2032)",
                     "Gini-Simpson Index (1\u2212D)", "Pielou's Evenness (J\u2032 = H\u2032/ln S)")

  ## ---------------------------------------------------------------------------
  ## 4. PLOT 1: Richness + Shannon + Simpson + Evenness panel (4-panel facet)
  ## ---------------------------------------------------------------------------
  index_df <- data.frame(
    SampleID = sample_id,
    Index = factor(index_levels, levels = index_levels),
    Value = c(richness_S, shannon_H, simpson_1D, pielou_J),
    stringsAsFactors = FALSE
  )

  subtitle_txt <- paste0("Sample ID: ", sample_id, " | Mapped: ",
                          ifelse(is.na(pct_mapped), "NA", sprintf("%.2f", pct_mapped)), "%")

  # Fixed y-axis limits per index, per explicit request -- NOT data-driven,
  # same range every run regardless of sample:
  #   - Richness:  0 to 50
  #   - Shannon:   0 to 5
  #   - Simpson:   0 to 1 (its true theoretical bound)
  #   - Evenness:  0 to 1 (its true theoretical bound)
  RICHNESS_YMAX <- 50
  SHANNON_YMAX  <- 5

  if (richness_S > RICHNESS_YMAX) {
    log_msg("[WARNING] Observed Richness (", richness_S, ") exceeds the fixed y-axis ",
            "cap of ", RICHNESS_YMAX, "; the bar/label will be clipped in Plot 1. ",
            "Raise RICHNESS_YMAX in the script if richer samples are expected.")
  }
  if (!is.na(shannon_H) && shannon_H > SHANNON_YMAX) {
    log_msg("[WARNING] Observed Shannon H' (", round(shannon_H, 4), ") exceeds the fixed ",
            "y-axis cap of ", SHANNON_YMAX, "; the bar/label will be clipped in Plot 1. ",
            "Raise SHANNON_YMAX in the script if higher-diversity samples are expected.")
  }

  ylim_lookup <- data.frame(
    Index = levels(index_df$Index),
    ymin = c(0, 0, 0, 0),
    ymax = c(RICHNESS_YMAX, SHANNON_YMAX, 1, 1),
    stringsAsFactors = FALSE
  )

  # Explicit per-panel y-axis breaks. ggplot's default "pretty" break
  # algorithm chose a 0.3-step pattern for the 0-1 Simpson/Evenness panels
  # (0.0, 0.3, 0.6, 0.9) that stops one step short of the actual 1.0 ceiling --
  # so, unlike the Richness panel (0..50) and Shannon panel (0..5), which both
  # correctly land on their own upper bound, Simpson/Evenness never printed a
  # labeled "1.0" tick. Since scales = "free_y" gives each facet its own
  # panel range (matching the fixed ymax set above), a single breaks function
  # can select the right step size per panel from that range and guarantee
  # every panel's true ceiling is always a labeled tick.
  fixed_axis_breaks <- function(limits) {
    upper <- limits[2]
    if (upper <= 1.5) {
      seq(0, 1, by = 0.25)      # Simpson / Evenness: 0, 0.25, 0.5, 0.75, 1.00
    } else if (upper <= 6) {
      seq(0, SHANNON_YMAX, by = 1)    # Shannon: 0..5
    } else {
      seq(0, RICHNESS_YMAX, by = 10)  # Richness: 0..50
    }
  }
  ylim_df <- rbind(
    data.frame(SampleID = sample_id, Index = factor(ylim_lookup$Index, levels = levels(index_df$Index)),
               Value = ylim_lookup$ymin),
    data.frame(SampleID = sample_id, Index = factor(ylim_lookup$Index, levels = levels(index_df$Index)),
               Value = ylim_lookup$ymax)
  )

  index_df$Label <- ifelse(is.na(index_df$Value), "NA", sprintf("%.2f", index_df$Value))

  # Single-sample case: bar shows the observed value visually, with the exact
  # number printed above it. No point marker (removed per request — the bar
  # top itself is the visual indicator, the printed number is the precise
  # value). No bootstrap/resampling involved — single, real, deterministically
  # computed value per index.
  plot1 <- ggplot(index_df, aes(x = SampleID, y = Value)) +
    geom_blank(data = ylim_df, aes(x = SampleID, y = Value)) +
    geom_col(fill = ACCENT_COLOR, width = 0.5, color = "black", linewidth = 0.4, na.rm = TRUE) +
    geom_text(aes(label = Label), vjust = -0.9, size = 4.2, fontface = "bold", na.rm = TRUE) +
    facet_wrap(~ Index, scales = "free_y", ncol = 2,
               labeller = label_wrap_gen(width = 20)) +
    # Zero expansion on the lower side only, so the bar base sits flush on the
    # x-axis line with no gap (matches the read-based reference figure, where
    # the bar rectangle's bottom edge and the axis line are the same
    # coordinate). Upper side keeps headroom for the printed value label.
    scale_y_continuous(breaks = fixed_axis_breaks, expand = expansion(mult = c(0, 0.12))) +
    labs(
      title = "MAG-based Alpha Diversity",
      subtitle = subtitle_txt,
      x = NULL,
      y = "Value"
    ) +
    pub_theme +
    # Sample ID already appears once in the subtitle; repeating it as an x-axis
    # tick label under every bar is redundant, so the x-axis text/ticks/title
    # are suppressed here (matches the read-based reference figure, which also
    # carries no per-bar sample text — only the shared subtitle line).
    theme(
      axis.text.x  = element_blank(),
      axis.ticks.x = element_blank(),
      axis.title.x = element_blank()
    )

  ggsave(file.path(output_dir, paste0(sample_id, "_mag_alpha_diversity_panel.svg")),
         plot = plot1, width = 10, height = 9, units = "in", dpi = 300, device = svglite::svglite)
  ggsave(file.path(output_dir, paste0(sample_id, "_mag_alpha_diversity_panel.pdf")),
         plot = plot1, width = 10, height = 9, units = "in", dpi = 300, device = cairo_pdf)
  log_msg("Step: Plot 1 (alpha diversity panel) generated and saved (svg + pdf), ",
          "with FIXED y-axis limits (Richness 0-", RICHNESS_YMAX, ", Shannon 0-", SHANNON_YMAX,
          ", Simpson 0-1, Evenness 0-1 -- same range every run, not data-driven) AND explicit ",
          "per-panel breaks so every panel's true ceiling (50, 5, 1.0, 1.0) is always a labeled ",
          "tick -- fixes the earlier gap where Simpson/Evenness never printed a visible '1.0' tick. ",
          "Also: wrapped/uncropped facet titles in a 2x2 grid, cleaned gridlines, cairo-based devices ",
          "for correct Unicode glyph rendering, bars zero-anchored flush to the x-axis, point markers ",
          "removed, and the redundant per-bar Sample ID x-axis text/title suppressed. Bootstrap ",
          "resampling remains entirely removed.")

  ## ---------------------------------------------------------------------------
  ## 5. PLOT 2: Rank-Abundance (Whittaker) Curve
  ## ---------------------------------------------------------------------------
  rank_df <- retained_tbl %>%
    dplyr::arrange(dplyr::desc(renorm_abund_pct)) %>%
    dplyr::mutate(Rank = dplyr::row_number()) %>%
    dplyr::select(Rank, RelAbundPct = renorm_abund_pct)

  plot2_subtitle <- paste0("Sample ID: ", sample_id, " | n = ", retained_mag_count, " MAGs")

  # Y-axis breaks: FIXED, evenly-spaced decade breaks (every 1.0 log10 unit:
  # ...,0.001, 0.01, 0.1, 1, 10, 100, 1000,...). This is intentionally NOT
  # data-driven and NOT a 1-2-5 pattern: a 1-2-5 pattern has unequal spacing
  # in log10 space (the 1->2 step is a much smaller log-distance than the
  # 2->5 step), and computing breaks from each sample's own min/max would
  # produce a different tick set per sample -- making figures from different
  # samples visually inconsistent and harder to compare side by side. Using
  # the same fixed, evenly log10-spaced break generator every run guarantees
  # identical tick methodology and even visual spacing across all samples;
  # ggplot only draws whichever of these fall inside a given sample's actual
  # axis range, so no sample loses resolution -- the break RULE stays fixed
  # even though which ticks are visible naturally varies with the data.
  y_breaks <- 10^seq(-4, 4, by = 1)
  log_msg("Step: Plot 2 y-axis uses fixed, evenly log10-spaced decade breaks ",
          "(rule: 10^seq(-4,4,by=1)); ggplot displays only those within this ",
          "sample's data range: [", round(min(rank_df$RelAbundPct, na.rm = TRUE), 4),
          ", ", round(max(rank_df$RelAbundPct, na.rm = TRUE), 4), "].")

  max_rank <- max(rank_df$Rank, na.rm = TRUE)
  # X-axis breaks: standard "pretty" round-number integer intervals (e.g. 0,
  # 5, 10, 15, 20, 25...) via scales::breaks_pretty(), applied plainly and
  # consistently regardless of sample -- rather than an ad hoc per-sample
  # step size. NOTE: rank 1 and the final rank are intentionally NOT force-
  # anchored onto the axis anymore -- doing so created an uneven trailing
  # interval (e.g. ...25,30,35,38 -- a short final gap of 3 next to gaps of
  # 5). Plain pretty breaks keep every interval evenly spaced, matching
  # standard practice (this mirrors the read-based reference figure, which
  # also uses even 0/25/50/75 spacing without force-including its own max
  # rank of 92).
  log_msg("Step: Plot 2 x-axis uses plain scales::breaks_pretty() integer ",
          "breaks, evenly spaced, not anchored to rank 1 or max rank. Max rank = ", max_rank)

  plot2 <- ggplot(rank_df, aes(x = Rank, y = RelAbundPct)) +
    geom_vline(xintercept = max_rank, color = "grey40", linetype = "dashed", linewidth = 0.6) +
    geom_line(color = ACCENT_COLOR, linewidth = 0.8, na.rm = TRUE) +
    geom_point(color = ACCENT_COLOR, size = 2, na.rm = TRUE) +
    annotate("text", x = max_rank, y = max(rank_df$RelAbundPct, na.rm = TRUE),
             label = paste0("N = ", max_rank, " MAGs"), color = "grey30",
             fontface = "bold", size = 4.2, hjust = 1.05, vjust = 0) +
    scale_y_log10(
      breaks = y_breaks,
      labels = scales::label_number(drop0trailing = TRUE)
    ) +
    scale_x_continuous(breaks = scales::breaks_pretty(n = 6)) +
    labs(
      title = "Rank-Abundance (Whittaker) Curve",
      subtitle = plot2_subtitle,
      x = "Species/MAG Rank",
      y = "Relative Abundance (%)"
    ) +
    pub_theme
    # NOTE: minor gridlines were previously added here to aid reading the log
    # y-axis, but they carried no printed value -- a reader could see a
    # reference line near the low-abundance tail with no way to know whether
    # it represented 0.3%, 0.5%, or something else. An unlabeled reference
    # line implies a precision it doesn't deliver, so it has been removed
    # entirely rather than left in an under-informative state. The curve
    # remains fully readable against the labeled major decade breaks alone.

  ggsave(file.path(output_dir, paste0(sample_id, "_mag_rank_abundance_curve.svg")),
         plot = plot2, width = 10, height = 7, units = "in", dpi = 300, device = svglite::svglite)
  ggsave(file.path(output_dir, paste0(sample_id, "_mag_rank_abundance_curve.pdf")),
         plot = plot2, width = 10, height = 7, units = "in", dpi = 300, device = cairo_pdf)
  log_msg("Step: Plot 2 (rank-abundance curve) generated and saved (svg + pdf), ",
          "with fixed evenly-spaced log10 decade y-axis breaks, plain evenly-spaced pretty-integer ",
          "x-axis breaks (no forced endpoint anchoring), a dashed threshold line + 'N = ", max_rank,
          " MAGs' label marking the total MAG count at its true rank position. Unlabeled minor ",
          "gridlines have been removed (they implied precision they did not carry).")

  ## ---------------------------------------------------------------------------
  ## 6. Summary counts
  ## ---------------------------------------------------------------------------
  log_msg("Summary: raw_mag_row_count=", raw_mag_count,
          " retained_mag_count=", retained_mag_count,
          " pct_mapped=", ifelse(is.na(pct_mapped), "NA", round(pct_mapped, 4)))

  invisible(TRUE)
}

## ---------------------------------------------------------------------------
## 7. RUN MAIN WITH ERROR HANDLING
## ---------------------------------------------------------------------------
result <- withCallingHandlers(
  tryCatch(
    {
      main()
      TRUE
    },
    error = function(e) {
      log_msg("[FATAL ERROR] ", conditionMessage(e))
      log_msg("[FATAL ERROR] Call: ", paste(deparse(conditionCall(e)), collapse = " "))
      message(sprintf("[FATAL ERROR] %s", conditionMessage(e)))
      FALSE
    }
  ),
  warning = function(w) {
    log_msg("[WARNING] ", conditionMessage(w))
    invokeRestart("muffleWarning")
  }
)

## ---------------------------------------------------------------------------
## 8. REPRODUCIBILITY / VALIDATION HOOK
## ---------------------------------------------------------------------------
log_msg("--- sessionInfo() ---")
si <- sessionInfo()
log_msg("R version: ", si$R.version$version.string)
pkg_versions <- vapply(required_pkgs, function(p) as.character(utils::packageVersion(p)), character(1))
for (i in seq_along(required_pkgs)) {
  log_msg("Package version: ", required_pkgs[i], " = ", pkg_versions[i])
}
log_msg("=== mag_alpha_diversity.R finished (success=", isTRUE(result), ") ===")

if (!isTRUE(result)) {
  quit(status = 1)
} else {
  quit(status = 0)
}
