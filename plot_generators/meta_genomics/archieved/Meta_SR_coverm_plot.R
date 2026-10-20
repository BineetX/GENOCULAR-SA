#!/usr/bin/env Rscript
# =============================================================================
# coverm_new.R
# Relative Abundance Visualization — CoverM + GTDB-Tk single-sample loader
# Pipeline: Metagenomics / WGS Automated Analysis (SLURM, single-sample stage)
#
# ── EXPECTED CLI ARGUMENT ORDER (positional, do not reorder) ────────────────
#   Rscript coverm_new.R \
#     <1: COVERAGE_TSV>   coverm coverage.tsv for this sample
#                         (columns: Genome, ..., "Relative Abundance (%)")
#     <2: OUTPUT_DIR>     pipeline-provided output directory (never hardcoded)
#     <3: BAC120_TSV>     gtdbtk.bac120.summary.tsv for this sample
#                         (may be a missing/empty file if no bacterial MAGs)
#     <4: AR53_TSV>       gtdbtk.ar53.summary.tsv for this sample
#                         (may be a missing/empty file if no archaeal MAGs)
#     <5: SAMPLE_ID>      sample identifier string (passed explicitly, never
#                         parsed from a path)
# =============================================================================

# ── 0. PACKAGES ───────────────────────────────────────────────────────────────
required_pkgs <- c("ggplot2", "dplyr", "tidyr", "readr", "stringr")

load_pkgs <- function(pkgs) {
  for (p in pkgs) {
    ok <- suppressWarnings(suppressPackageStartupMessages(
      require(p, character.only = TRUE, quietly = TRUE)
    ))
    if (!ok) {
      cat(sprintf("[FATAL] Required package '%s' is not installed or failed to load.\n", p))
      quit(status = 1)
    }
  }
}
load_pkgs(required_pkgs)

# ── 1. COMMAND-LINE ARGUMENTS ─────────────────────────────────────────────────
args <- commandArgs(trailingOnly = TRUE)

if (length(args) != 5) {
  cat("[FATAL] Usage: Rscript coverm_new.R <COVERAGE_TSV> <OUTPUT_DIR> <BAC120_TSV> <AR53_TSV> <SAMPLE_ID>\n")
  cat(sprintf("[FATAL] Received %d argument(s), expected 5.\n", length(args)))
  quit(status = 1)
}

coverage_tsv <- args[1]
output_dir   <- args[2]
bac120_tsv   <- args[3]
ar53_tsv     <- args[4]
sample_id    <- args[5]

dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)

log_file <- file.path(output_dir, paste0(sample_id, "_coverm_run.log"))
log_con  <- file(log_file, open = "wt")

log_msg <- function(...) {
  msg <- sprintf(...)
  line <- sprintf("[%s] %s", format(Sys.time(), "%Y-%m-%d %H:%M:%S"), msg)
  cat(line, "\n", file = log_con, append = TRUE)
  cat(line, "\n")
}

log_msg("=== coverm_new.R started ===")
log_msg("Script: coverm_new.R")
log_msg("Sample ID: %s", sample_id)
log_msg("Resolved COVERAGE_TSV: %s", coverage_tsv)
log_msg("Resolved OUTPUT_DIR:   %s", output_dir)
log_msg("Resolved BAC120_TSV:   %s", bac120_tsv)
log_msg("Resolved AR53_TSV:     %s", ar53_tsv)

# ── 2. HELPERS ────────────────────────────────────────────────────────────────
check_required_file <- function(path, label) {
  if (!file.exists(path)) {
    log_msg("[FATAL] Required input file missing (%s): %s", label, path)
    close(log_con)
    quit(status = 1)
  }
}

save_gg <- function(p, base_name, w, h) {
  svg_path <- file.path(output_dir, paste0(base_name, ".svg"))
  pdf_path <- file.path(output_dir, paste0(base_name, ".pdf"))
  ggsave(svg_path, plot = p, width = w, height = h, units = "in", dpi = 300, bg = "white")
  ggsave(pdf_path, plot = p, width = w, height = h, units = "in", dpi = 300, bg = "white")
  log_msg("Saved plot: %s", svg_path)
  log_msg("Saved plot: %s", pdf_path)
}

# ── 3. PUBLICATION THEME (fixed font/size/weight contract) ───────────────────
pub_theme <- theme(
  plot.title      = element_text(size = 18, color = "black", face = "bold", margin = margin(b = 6)),
  plot.subtitle   = element_text(size = 13, color = "black", face = "bold", margin = margin(b = 14)),
  legend.title    = element_text(size = 12, color = "black", face = "bold"),
  legend.text     = element_text(size = 12, color = "black", face = "bold"),
  axis.text.x     = element_text(size = 14, color = "black", face = "bold"),
  axis.text.y     = element_text(size = 14, color = "black", face = "bold", family = "mono"),
  axis.title.x    = element_text(size = 16, color = "black", face = "bold", margin = margin(t = 8)),
  axis.title.y    = element_text(size = 16, color = "black", face = "bold"),
  axis.line       = element_line(color = "black", linewidth = 0.3),
  panel.grid.major.y = element_blank(),
  panel.grid.major.x = element_line(color = "#DDDDDD", linewidth = 0.45),
  panel.grid.minor   = element_blank(),
  plot.background    = element_rect(fill = "white", color = NA),
  panel.background   = element_rect(fill = "white", color = NA)
)

# ── 4. MAIN LOGIC (wrapped for defensive error handling) ──────────────────────
result <- tryCatch({

  check_required_file(coverage_tsv, "COVERAGE_TSV")
  log_msg("Reading coverage file...")

  cov_df <- read_tsv(coverage_tsv, col_types = cols(.default = "c"), show_col_types = FALSE)
  ra_col <- names(cov_df)[grepl("Relative Abundance", names(cov_df), fixed = TRUE)]
  if (length(ra_col) == 0) {
    stop(sprintf("No 'Relative Abundance' column found in %s", coverage_tsv))
  }

  cov_df <- cov_df %>%
    rename(Genome = 1, RelAbund = all_of(ra_col[1])) %>%
    mutate(RelAbund = as.numeric(RelAbund))

  log_msg("Coverage rows read: %d", nrow(cov_df))

  unmapped_ra <- cov_df %>% filter(Genome == "unmapped") %>% pull(RelAbund)
  unmapped_ra <- if (length(unmapped_ra) == 0) 0 else replace_na(unmapped_ra[1], 0)
  cov_mags    <- cov_df %>% filter(Genome != "unmapped")

  log_msg("MAGs detected (excluding unmapped row): %d", nrow(cov_mags))
  log_msg("Unmapped relative abundance: %.4f%%", unmapped_ra)

  # ── 4a. TAXONOMY (GTDB-Tk bac120 + ar53) ────────────────────────────────────
  read_gtdbtk_file <- function(path, label) {
    if (!file.exists(path) || file.info(path)$size == 0) {
      log_msg("Note: %s not found or empty (%s) — continuing without it.", label, path)
      return(NULL)
    }
    df <- tryCatch(read_tsv(path, col_types = cols(.default = "c"), show_col_types = FALSE),
                    error = function(e) NULL)
    if (is.null(df) || nrow(df) == 0) {
      log_msg("Note: %s parsed but contained 0 rows — continuing without it.", label)
      return(NULL)
    }
    gc <- names(df)[grepl("user_genome|Name|^Genome", names(df), ignore.case = TRUE)][1]
    cc <- names(df)[grepl("classification", names(df), ignore.case = TRUE)][1]
    if (is.na(gc) || is.na(cc)) {
      log_msg("Note: %s missing expected genome/classification columns — continuing without it.", label)
      return(NULL)
    }
    df %>%
      select(Genome = all_of(gc), Classification = all_of(cc)) %>%
      filter(!is.na(Classification), Classification != "")
  }

  tax_bac <- read_gtdbtk_file(bac120_tsv, "BAC120_TSV")
  tax_ar  <- read_gtdbtk_file(ar53_tsv, "AR53_TSV")

  if (is.null(tax_bac) && is.null(tax_ar)) {
    log_msg("Note: neither bacterial nor archaeal taxonomy available — Phylum will be 'Unknown Phylum' for all MAGs.")
    tax_all <- tibble(Genome = character(), Phylum = character())
  } else {
    tax_all <- bind_rows(tax_bac, tax_ar) %>% distinct(Genome, .keep_all = TRUE)

    parse_rank <- function(classification, prefix) {
      parts <- str_split(classification, ";")[[1]]
      hit   <- parts[grepl(paste0("^", prefix, "__"), parts)]
      if (length(hit) == 0) return("Unknown")
      str_remove(hit[1], paste0("^", prefix, "__"))
    }

    tax_all <- tax_all %>%
      rowwise() %>%
      mutate(Phylum = parse_rank(Classification, "p")) %>%
      ungroup() %>%
      mutate(Phylum = if_else(Phylum == "" | is.na(Phylum), "Unknown Phylum", Phylum)) %>%
      select(Genome, Phylum)
  }

  log_msg("Taxonomy records resolved: %d", nrow(tax_all))

  # ── 4b. JOIN COVERAGE + TAXONOMY ────────────────────────────────────────────
  mag_data <- cov_mags %>%
    left_join(tax_all, by = "Genome") %>%
    mutate(Phylum = replace_na(Phylum, "Unknown Phylum")) %>%
    arrange(desc(RelAbund))

  n_mags <- nrow(mag_data)
  log_msg("Final MAG table assembled: %d rows.", n_mags)

  # ── 4c. LABEL CONSTRUCTION ──────────────────────────────────────────────────
  # CHANGE 2: unify every entry under a single "Bin.<ID>" naming convention
  # (no mixed Bin.xx / MAG.xxx labelling).
  # CHANGE 3: pair each Bin ID with its Phylum (not Genus) for consistent
  # taxonomic display alongside every sample, since Genus is frequently
  # unresolved and was previously falling back to raw accession strings.
  # CHANGE 5: guard against duplicate Bin_ID+Phylum labels (can occur when
  # extract_bin_id() collapses two distinct genomes to the same numeric
  # suffix). Duplicated labels break factor() level uniqueness, so any
  # label that is not unique gets the original Genome name appended in
  # parentheses to disambiguate it. Unique labels are left untouched.
  extract_bin_id <- function(genome) {
    m <- str_extract(genome, "[0-9]+$")
    if (is.na(m)) genome else m
  }

  mag_data <- mag_data %>%
    rowwise() %>%
    mutate(
      Bin_ID = paste0("Bin.", extract_bin_id(Genome)),
      Label  = paste0(Bin_ID, " | ", Phylum)
    ) %>%
    ungroup() %>%
    mutate(
      dup_flag = duplicated(Label) | duplicated(Label, fromLast = TRUE)
    ) %>%
    mutate(
      Label = if_else(dup_flag, paste0(Label, " (", Genome, ")"), Label)
    ) %>%
    select(-dup_flag) %>%
    mutate(Label = factor(Label, levels = rev(Label)))

  bar_levels <- c(levels(mag_data$Label), "· Unmapped reads")

  unmapped_row <- tibble(
    Label    = factor("· Unmapped reads", levels = bar_levels),
    RelAbund = unmapped_ra,
    Phylum   = "Unmapped"
  )

  plot_df <- mag_data %>%
    mutate(Label = factor(as.character(Label), levels = bar_levels)) %>%
    select(Label, RelAbund, Phylum) %>%
    bind_rows(unmapped_row)

  # ── 4d. COLOUR PALETTE ──────────────────────────────────────────────────────
  phylum_palette <- c(
    "Pseudomonadota"    = "#4292C6",
    "Bacteroidota"      = "#4D9221",
    "Patescibacteriota" = "#440154",
    "Myxococcota_A"     = "#21908C",
    "Planctomycetota"   = "#084594",
    "Bdellovibrionota"  = "#C51B7D",
    "Verrucomicrobiota" = "#E9A3C9",
    "Unknown Phylum"    = "#9E9E9E",
    "Unmapped"          = "#FDE725"
  )

  # ── 4e. MAIN ABUNDANCE BAR PLOT (MIMAG / Completeness strips removed) ──────
  # CHANGE 1: only the relative-abundance bar plot is produced now.
  # CHANGE 4: axis lines (0.3, black, bold via theme) and bar outlines (0.3,
  # black) enforced below.
  p_bar <- ggplot(plot_df, aes(x = RelAbund, y = Label, fill = Phylum)) +
    geom_vline(xintercept = 0, linetype = "dashed", color = "#666666", linewidth = 0.7) +
    geom_col(width = 0.76, color = "black", linewidth = 0.3) +
    geom_text(aes(label = ifelse(!is.na(RelAbund) & RelAbund > 0, sprintf("%.2f%%", RelAbund), "")),
              hjust = -0.12, size = 6.0, color = "black", fontface = "bold") +
    scale_fill_manual(values = phylum_palette, name = "Phylum",
                      guide = guide_legend(
                        title.position = "top",
                        ncol = 1,
                        byrow = TRUE,
                        override.aes = list(width = unit(16, "pt"), height = unit(16, "pt"))
                      )) +
    scale_x_continuous(expand = expansion(mult = c(0, 0.16)), labels = function(x) paste0(x, "%")) +
    scale_y_discrete(limits = bar_levels) +
    labs(
      title    = "Community Biomass Profile & Relative Abundance",
      subtitle = sprintf("Sample ID: %s | %d MAGs recovered | Total Mapped: %.2f%% | Unmapped: %.2f%%",
                         sample_id, n_mags, sum(mag_data$RelAbund, na.rm = TRUE), unmapped_ra),
      x = "Relative Abundance (%)", y = NULL
    ) +
    pub_theme +
    theme(
      legend.position  = "right",
      legend.key.size  = unit(16, "pt"),
      legend.spacing.y = unit(2.5, "cm"),
      plot.margin      = margin(14, 10, 14, 4)
    )

  log_msg("Plot object constructed successfully.")

  plot_height <- max(8, 0.42 * length(bar_levels) + 3)
  save_gg(p_bar, paste0(sample_id, "_coverm_relative_abundance"), 16, plot_height)

  log_msg("Plot generation completed without errors.")
  TRUE

}, error = function(e) {
  log_msg("[FATAL] Unhandled error during script execution:")
  log_msg("[FATAL] %s", conditionMessage(e))
  log_msg("[FATAL] Call: %s", paste(deparse(conditionCall(e)), collapse = " "))
  FALSE
})

# ── 5. REPRODUCIBILITY FOOTER ─────────────────────────────────────────────────
log_msg("--- sessionInfo() ---")
si_lines <- capture.output(sessionInfo())
for (ln in si_lines) cat(ln, "\n", file = log_con, append = TRUE)

log_msg("=== coverm_new.R finished ===")
close(log_con)

if (!isTRUE(result)) {
  quit(status = 1)
} else {
  quit(status = 0)
}
