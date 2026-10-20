#!/usr/bin/env Rscript

# ==============================================================================
# SCRIPT: gunc_sankey.R
# PURPOSE: Flags genome bins likely to be chimeric/contaminated across taxonomic
#          clades and visualizes genome-level flows via a Sankey diagram.
#
# EXACT CLI ARGUMENT ORDER:
#   arg1: GUNC_MAXCSS_TSV  (Path to GUNC.{db}.maxCSS_level.tsv)
#   arg2: OUTPUT_DIR       (Path to output directory for figures + log)
#   arg3: SAMPLE_ID        (String identifier for the sample)
#
# INVOCATION EXAMPLE:
#   Rscript gunc_sankey.R \
#     /path/to/GUNC.progenomes_2.1.maxCSS_level.tsv \
#     /path/to/output_dir \
#     SAMPLE_ID_STRING
#
# MANDATORY DISCLAIMER:
# This Sankey is derived solely from GUNC.{db}.maxCSS_level.tsv (genome-level
# summary scores) and is NOT a reproduction of GUNC's native contig-level per-gene
# taxonomic-assignment Sankey (produced by `gunc plot`). Flows represent genome/bin
# counts across taxonomic_level -> CSS/contamination flag-combination -> pass.GUNC;
# reference representation score (RRS) is encoded as link opacity (a confidence
# modifier), not as an independent flag stage.
#
# ARCHITECTURAL NOTE ON PLOTTING STACK:
# This script uses networkD3::sankeyNetwork() (an htmlwidget-based true Sankey
# layout) rather than ggplot2/ggalluvial. This is a deliberate deviation from
# standard static ggplot2 plotting stacks because Sankey layout algorithms are not
# natively available in ggplot2, and networkD3 is the established R tool for this
# diagram type.
#
# CHANGELOG (this revision):
#   - HTML export uses htmltools::save_html(..., selfcontained = TRUE) (pandoc-
#     based) so the output is a single portable file with no accompanying lib/
#     directory. NOTE: htmlwidgets::saveWidget() was tried first but is NOT
#     valid here -- full_plot is a composite tagList (header + widget +
#     caption + table), not a bare "htmlwidget" object, and saveWidget() fails
#     on it with an opaque vector-allocation error. save_html() is the correct
#     function for composite pages and is used exclusively now. Its libdir
#     fallback (used only if pandoc/selfcontained is unavailable) must stay a
#     relative path inside OUTPUT_DIR -- htmltools rejects external paths like
#     tempdir() for libdir, which was a second bug fixed in this revision.
#   - Fixed a dplyr::count() argument collision (formal argument "name" cannot
#     be used both to select the grouping column and to rename the output
#     count column in the same call); per-node genome counts are now computed
#     with group_by(name = <column>) %>% summarise(n = n()) instead.
#   - webshot2 static export now checks for a usable Chromium/Chrome binary via
#     chromote BEFORE attempting to render, and logs an explicit, actionable
#     warning (rather than a bare failure) when headless Chrome is unavailable,
#     which is the near-universal cause of "no PDF/SVG produced" on HPC nodes.
#   - Sankey nodes are now labeled with genome COUNT and PERCENT OF TOTAL
#     directly in the plot (via htmlwidgets::onRender / D3 injection), so the
#     figure is self-explanatory without needing the log file open alongside it.
#   - A visible in-figure legend explains the Pass/Fail color coding and the
#     High/Low RRS opacity (confidence) coding, matching the Okabe-Ito
#     colourblind-safe palette already used in the links.
#   - Link/node tooltips now show genome count AND percent of the total plotted
#     genome set, not just a raw count, for easier scientific interpretation.
#   - A companion summary statistics table (per taxonomic_level: n genomes,
#     n pass, n fail, pass rate, n low-RRS) is written alongside the Sankey,
#     both as a TSV (machine-readable, reproducible) and embedded as an HTML
#     table beneath the figure (human-readable context a Sankey alone cannot
#     convey, e.g. exact pass rates and low-confidence-flag counts).
# ==============================================================================

# --- 0. DEPENDENCY LOADING & SAFEGUARDING ---
load_safe <- function(pkg) {
  if (!requireNamespace(pkg, quietly = TRUE)) {
    stop(paste0("CRITICAL ERROR: Package '", pkg, "' is required but not installed."), call. = FALSE)
  }
  suppressPackageStartupMessages(library(pkg, character.only = TRUE))
}

load_safe("readr")
load_safe("dplyr")
load_safe("tidyr")
load_safe("networkD3")
load_safe("htmlwidgets")
load_safe("htmltools")
load_safe("webshot2")

# --- 1. ARGUMENT PARSING & PATH VALIDATION ---
args <- commandArgs(trailingOnly = TRUE)

if (length(args) != 3) {
  cat("CRITICAL ERROR: Expected exactly 3 positional arguments.\n", file = stderr())
  cat("Usage: Rscript gunc_sankey.R <GUNC_MAXCSS_TSV> <OUTPUT_DIR> <SAMPLE_ID>\n", file = stderr())
  quit(status = 1)
}

GUNC_MAXCSS_TSV <- args[1]
OUTPUT_DIR      <- args[2]
SAMPLE_ID       <- args[3]

if (!dir.exists(OUTPUT_DIR)) {
  dir.create(OUTPUT_DIR, recursive = TRUE, showWarnings = FALSE)
}

log_file <- file.path(OUTPUT_DIR, paste0(SAMPLE_ID, "_GUNC_run.log"))

log_msg <- function(msg, level = "INFO") {
  timestamp <- format(Sys.time(), "%Y-%m-%d %H:%M:%S")
  formatted <- sprintf("[%s] [%s] %s", timestamp, level, msg)
  cat(formatted, "\n")
  cat(formatted, "\n", file = log_file, append = TRUE)
}

# Initialize log
cat("", file = log_file, append = FALSE)
log_msg("=== STARTING GUNC SANKEY GENERATION PIPELINE ===")
log_msg(paste0("Script Name: gunc_sankey.R"))
log_msg(paste0("GUNC_MAXCSS_TSV Input Path: ", GUNC_MAXCSS_TSV))
log_msg(paste0("OUTPUT_DIR Path: ", OUTPUT_DIR))
log_msg(paste0("SAMPLE_ID: ", SAMPLE_ID))
log_msg("MANDATORY DISCLAIMER: This Sankey is derived solely from GUNC.{db}.maxCSS_level.tsv (genome-level summary scores) and is NOT a reproduction of GUNC's native contig-level per-gene taxonomic-assignment Sankey (produced by `gunc plot`). Flows represent genome/bin counts across taxonomic_level -> CSS/contamination flag-combination -> pass.GUNC; reference representation score (RRS) is encoded as link opacity (a confidence modifier), not as an independent flag stage.")

if (!file.exists(GUNC_MAXCSS_TSV)) {
  err_msg <- paste0("Input file does not exist: ", GUNC_MAXCSS_TSV)
  log_msg(err_msg, level = "ERROR")
  stop(err_msg, call. = FALSE)
}

# --- 2. MAIN PROCESSING PIPELINE WITHIN TRYCATCH ---
tryCatch({
  log_msg("Step 1: Reading input TSV file...")

  # Read strict 13-column format defensively
  col_specs <- cols(
    genome = col_character(),
    n_genes_called = col_double(),
    n_genes_mapped = col_double(),
    n_contigs = col_double(),
    taxonomic_level = col_character(),
    proportion_genes_retained_in_major_clades = col_double(),
    genes_retained_index = col_double(),
    clade_separation_score = col_double(),
    contamination_portion = col_double(),
    n_effective_surplus_clades = col_double(),
    mean_hit_identity = col_double(),
    reference_representation_score = col_double(),
    pass.GUNC = col_character()
  )

  raw_df <- read_tsv(GUNC_MAXCSS_TSV, col_types = col_specs, show_col_types = FALSE)
  log_msg(paste0("Total rows read from input TSV: ", nrow(raw_df)))

  if (nrow(raw_df) == 0) {
    stop("Input TSV is empty (0 rows). Cannot generate Sankey diagram.", call. = FALSE)
  }

  # Defensive normalization of pass.GUNC format
  raw_pass_vals <- unique(raw_df$pass.GUNC)
  log_msg(paste0("Detected raw pass.GUNC values in file: ", paste(raw_pass_vals, collapse = ", ")))

  # Step 2: Filtering missing essential metrics
  log_msg("Step 2: Checking for missing/NA values in columns 8, 9, 12...")
  na_mask <- is.na(raw_df$clade_separation_score) |
             is.na(raw_df$contamination_portion) |
             is.na(raw_df$reference_representation_score)

  if (any(na_mask)) {
    excluded_rows <- raw_df[na_mask, ]
    for (i in seq_len(nrow(excluded_rows))) {
      g_id <- excluded_rows$genome[i]
      reasons <- c()
      if (is.na(excluded_rows$clade_separation_score[i])) reasons <- c(reasons, "clade_separation_score is NA")
      if (is.na(excluded_rows$contamination_portion[i])) reasons <- c(reasons, "contamination_portion is NA")
      if (is.na(excluded_rows$reference_representation_score[i])) reasons <- c(reasons, "reference_representation_score is NA")
      log_msg(sprintf("Excluding genome '%s': %s", g_id, paste(reasons, collapse = "; ")), level = "WARNING")
    }
  }

  df <- raw_df[!na_mask, ]
  log_msg(paste0("Total rows remaining after NA filtering: ", nrow(df), " (excluded: ", sum(na_mask), ")"))

  if (nrow(df) == 0) {
    stop("No valid genomes remaining after filtering NAs. Cannot proceed.", call. = FALSE)
  }

  # Step 3: Deriving flags, pass status, and RRS status
  log_msg("Step 3: Deriving Stage 1/2/3 labels and RRS confidence modifiers...")

  df <- df %>%
    mutate(
      # Normalize Stage 3 pass status
      stage3_pass = case_when(
        toupper(as.character(pass.GUNC)) %in% c("TRUE", "T", "1", "PASS") ~ "Pass",
        toupper(as.character(pass.GUNC)) %in% c("FALSE", "F", "0", "FAIL") ~ "Fail",
        TRUE ~ "Fail"
      ),
      # Derive binary flags
      css_flag = clade_separation_score > 0.45,
      contam_flag = contamination_portion > 0.05,
      # Stage 2 label
      stage2_comb = case_when(
        css_flag & contam_flag ~ "CSS+Contam",
        css_flag ~ "CSS only",
        contam_flag ~ "Contam only",
        TRUE ~ "None"
      ),
      # RRS Status
      rrs_high = reference_representation_score > 0.5,
      rrs_status = ifelse(rrs_high, "High RRS", "Low RRS")
    )

  n_total <- nrow(df)
  n_low_rrs <- sum(!df$rrs_high)
  log_msg(paste0("RRS check: Found ", n_low_rrs, " Low-RRS genome(s) (<=0.5) out of ", n_total, "."))
  log_msg("NOTE ON RRS CONFIDENCE: Low-RRS genomes' CSS and contamination flags carry reduced confidence per Orakov et al. 2021 (Genome Biology 22:178). RRS is encoded as link opacity rather than an independent flag stage.")

  # Step 4: Link aggregation (taxonomic_level -> flag-combination -> pass.GUNC split by rrs_status)
  log_msg("Step 4: Aggregating paths into distinct links...")

  # Capture order of first appearance for taxonomic_level (Stage 1 nodes)
  tax_levels_ordered <- unique(df$taxonomic_level)

  # Stage 2 nodes in canonical flag order
  stage2_levels <- c("None", "CSS only", "Contam only", "CSS+Contam")
  stage2_levels <- stage2_levels[stage2_levels %in% unique(df$stage2_comb)]

  # Stage 3 nodes
  stage3_levels <- c("Pass", "Fail")
  stage3_levels <- stage3_levels[stage3_levels %in% unique(df$stage3_pass)]

  # Link aggregation: Stage 1 -> Stage 2
  links_s1_s2 <- df %>%
    group_by(source_name = taxonomic_level, target_name = stage2_comb, rrs_status, stage3_pass) %>%
    summarise(value = n(), .groups = "drop")

  # Link aggregation: Stage 2 -> Stage 3
  links_s2_s3 <- df %>%
    group_by(source_name = stage2_comb, target_name = stage3_pass, rrs_status, stage3_pass) %>%
    summarise(value = n(), .groups = "drop")

  raw_links <- bind_rows(links_s1_s2, links_s2_s3)

  # Step 5: Node list construction & 0-based indexing
  log_msg("Step 5: Building nodes and indexed links for networkD3...")

  all_node_names <- c(tax_levels_ordered, stage2_levels, stage3_levels)

  # Per-node genome counts, computed independently for each stage so that a
  # node reused across stages (should not happen given disjoint label sets,
  # but guarded regardless) still gets a scientifically correct count: the
  # number of genomes actually assigned that node's category, not a sum over
  # both incoming and outgoing links (which would double count).
  stage1_counts <- df %>% group_by(name = taxonomic_level) %>% summarise(n = n(), .groups = "drop")
  stage2_counts <- df %>% group_by(name = stage2_comb) %>% summarise(n = n(), .groups = "drop")
  stage3_counts <- df %>% group_by(name = stage3_pass) %>% summarise(n = n(), .groups = "drop")
  node_counts <- bind_rows(stage1_counts, stage2_counts, stage3_counts) %>%
    distinct(name, .keep_all = TRUE)

  nodes_df <- data.frame(
    name = all_node_names,
    stringsAsFactors = FALSE
  ) %>%
    left_join(node_counts, by = "name") %>%
    mutate(
      n = ifelse(is.na(n), 0L, n),
      pct = round(100 * n / n_total, 1),
      # Label shown on the plot: "Name (n, pct%)" — makes the figure
      # self-explanatory without needing to open the log file.
      display_label = sprintf("%s (n=%d, %s%%)", name, n, formatC(pct, format = "f", digits = 1)),
      node_group = case_when(
        name == "Pass" ~ "Pass",
        name == "Fail" ~ "Fail",
        TRUE ~ "Default"
      )
    )

  links_df <- raw_links %>%
    mutate(
      source = match(source_name, nodes_df$name) - 1L,
      target = match(target_name, nodes_df$name) - 1L,
      pct_of_total = round(100 * value / n_total, 1),
      link_group = case_when(
        stage3_pass == "Pass" & rrs_status == "High RRS" ~ "Pass_High",
        stage3_pass == "Pass" & rrs_status == "Low RRS"  ~ "Pass_Low",
        stage3_pass == "Fail" & rrs_status == "High RRS" ~ "Fail_High",
        stage3_pass == "Fail" & rrs_status == "Low RRS"  ~ "Fail_Low",
        TRUE ~ "Pass_High"
      )
    )

  log_msg(paste0("Total nodes constructed: ", nrow(nodes_df)))
  log_msg(paste0("Total links constructed: ", nrow(links_df)))

  # Step 5b: Per-taxonomic-level summary statistics table (scientific context
  # that a Sankey diagram alone cannot convey precisely: exact pass rates and
  # low-confidence-flag burden per clade level).
  log_msg("Step 5b: Computing per-taxonomic-level summary statistics table...")

  summary_stats <- df %>%
    group_by(taxonomic_level) %>%
    summarise(
      n_genomes = n(),
      n_pass = sum(stage3_pass == "Pass"),
      n_fail = sum(stage3_pass == "Fail"),
      pass_rate_pct = round(100 * n_pass / n_genomes, 1),
      n_low_rrs = sum(!rrs_high),
      low_rrs_rate_pct = round(100 * n_low_rrs / n_genomes, 1),
      .groups = "drop"
    ) %>%
    arrange(match(taxonomic_level, tax_levels_ordered))

  summary_tsv_path <- file.path(OUTPUT_DIR, paste0(SAMPLE_ID, "_gunc_summary_stats.tsv"))
  write_tsv(summary_stats, summary_tsv_path)
  log_msg(paste0("SUCCESS: Summary statistics TSV saved -> ", summary_tsv_path))

  # Step 6: Color scales and CSS styling compliance (Section C)
  log_msg("Step 6: Configuring Okabe-Ito palettes and CSS typography compliance...")

  # Okabe-Ito colors: Pass = Bluish Green (#009E73), Fail = Vermilion (#D55E00), Default node = Grey (#999999)
  # High RRS alpha = 0.80 (hex CC), Low RRS alpha = 0.35 (hex 59)
  color_scale_js <- "d3.scaleOrdinal()
    .domain(['Pass', 'Fail', 'Default', 'Pass_High', 'Pass_Low', 'Fail_High', 'Fail_Low'])
    .range([
      '#009E73', '#D55E00', '#999999',
      '#009E73CC', '#009E7359',
      '#D55E00CC', '#D55E0059'
    ])"

  # Generate true Sankey diagram
  sankey_widget <- networkD3::sankeyNetwork(
    Links = links_df,
    Nodes = nodes_df,
    Source = "source",
    Target = "target",
    Value = "value",
    NodeID = "display_label",
    NodeGroup = "node_group",
    LinkGroup = "link_group",
    colourScale = color_scale_js,
    fontSize = 12,
    fontFamily = "sans-serif",
    nodeWidth = 25,
    nodePadding = 15,
    margin = list(top = 20, right = 40, bottom = 20, left = 40),
    iterations = 0 # Preserve first-encountered ordering without automatic re-sorting
  )

  # Step 6b: Inject percent-of-total into the default D3 link tooltips, since
  # networkD3's built-in tooltip only shows the raw genome count. This is done
  # via onRender so the interactive HTML remains scientifically precise
  # (count AND proportion) without altering the underlying node/link data.
  # NOTE: keying this lookup by "source|target" node-index would collide,
  # because a single taxonomic_level can have multiple PARALLEL links to the
  # same downstream node (split by rrs_status/stage3_pass), so several link
  # rows legitimately share one source/target pair. Indexing by link ORDER
  # instead is collision-proof: sankeyNetwork() preserves the row order of
  # links_df when building the underlying D3 link array, so pctArray[i]
  # matches DOM link element i 1:1.
  pct_lookup_js <- paste0(
    "var pctArray = [", paste(links_df$pct_of_total, collapse = ", "), "];"
  )

  sankey_widget <- htmlwidgets::onRender(sankey_widget, paste0("
    function(el, x) {
      ", pct_lookup_js, "
      d3.select(el).selectAll('.link')
        .append('title')
        .text(function(d, i) {
          var pct = pctArray[i];
          var pctText = (pct !== undefined) ? (' (' + pct + '% of all genomes)') : '';
          return d.source.name + ' -> ' + d.target.name + ': ' + d.value + ' genome(s)' + pctText;
        });
    }
  "))

  # Section C Compliance CSS Injection:
  # Title: 18px black bold; Context/Subtitle: 13px black bold; Node/Link labels: 12px black bold
  section_c_css <- "
    .gunc-header-title {
      font-family: sans-serif;
      font-size: 18px;
      font-weight: bold;
      color: #000000;
      margin: 0 0 4px 0;
      padding: 0;
    }
    .gunc-header-subtitle {
      font-family: sans-serif;
      font-size: 13px;
      font-weight: bold;
      color: #000000;
      margin: 0 0 15px 0;
      padding: 0;
    }
    .node text {
      font-family: sans-serif !important;
      font-size: 12px !important;
      font-weight: bold !important;
      fill: #000000 !important;
    }
    .gunc-legend {
      font-family: sans-serif;
      font-size: 12px;
      color: #000000;
      margin: 10px 0 15px 0;
      display: flex;
      flex-wrap: wrap;
      gap: 18px;
      align-items: center;
    }
    .gunc-legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .gunc-legend-swatch {
      width: 14px;
      height: 14px;
      display: inline-block;
      border: 1px solid #444444;
    }
    .gunc-caption {
      font-family: sans-serif;
      font-size: 11px;
      color: #333333;
      margin-top: 10px;
      max-width: 900px;
      line-height: 1.4;
    }
    .gunc-summary-table {
      font-family: sans-serif;
      font-size: 12px;
      color: #000000;
      border-collapse: collapse;
      margin-top: 20px;
    }
    .gunc-summary-table th, .gunc-summary-table td {
      border: 1px solid #999999;
      padding: 4px 10px;
      text-align: right;
    }
    .gunc-summary-table th {
      background-color: #eeeeee;
      text-align: center;
    }
    .gunc-summary-table td:first-child, .gunc-summary-table th:first-child {
      text-align: left;
    }
    .gunc-summary-title {
      font-family: sans-serif;
      font-size: 13px;
      font-weight: bold;
      color: #000000;
      margin-top: 22px;
    }
  "

  # Section D Subtitle Formatting
  n_pass_total <- sum(df$stage3_pass == "Pass")
  n_fail_total <- sum(df$stage3_pass == "Fail")
  overall_pass_rate <- round(100 * n_pass_total / n_total, 1)

  subtitle_text <- paste0(
    "Sample ID: ", SAMPLE_ID,
    " | Genomes/bins plotted: ", n_total,
    " | Pass: ", n_pass_total, " (", formatC(overall_pass_rate, format = "f", digits = 1), "%)",
    " | Fail: ", n_fail_total,
    " | Low-RRS: ", n_low_rrs, " (", formatC(round(100 * n_low_rrs / n_total, 1), format = "f", digits = 1), "%)"
  )

  # In-figure legend (color = Pass/Fail, opacity = RRS confidence) so the
  # encoding is explained on the figure itself rather than only in the log.
  legend_html <- htmltools::tags$div(
    class = "gunc-legend",
    htmltools::tags$div(class = "gunc-legend-item",
      htmltools::tags$span(class = "gunc-legend-swatch", style = "background-color:#009E73;"),
      "Pass"
    ),
    htmltools::tags$div(class = "gunc-legend-item",
      htmltools::tags$span(class = "gunc-legend-swatch", style = "background-color:#D55E00;"),
      "Fail"
    ),
    htmltools::tags$div(class = "gunc-legend-item",
      htmltools::tags$span(class = "gunc-legend-swatch", style = "background-color:#666666; opacity:0.80;"),
      "High RRS (>0.5) \u2014 flag confidence: standard"
    ),
    htmltools::tags$div(class = "gunc-legend-item",
      htmltools::tags$span(class = "gunc-legend-swatch", style = "background-color:#666666; opacity:0.35;"),
      "Low RRS (\u22640.5) \u2014 flag confidence: reduced"
    )
  )

  caption_html <- htmltools::tags$div(
    class = "gunc-caption",
    htmltools::HTML(
      "Flows represent genome/bin counts from taxonomic_level (Stage 1) through CSS/contamination
      flag-combination (Stage 2; CSS threshold &gt;0.45, contamination threshold &gt;0.05) to the final
      pass.GUNC outcome (Stage 3). Link opacity encodes Reference Representation Score (RRS) status
      as a confidence modifier on the CSS/contamination flags, per Orakov et al. 2021, Genome Biology
      22:178 \u2014 it is not an independent classification stage. This diagram summarizes genome-level
      maxCSS scores only and is not GUNC's native contig-level taxonomic-assignment Sankey."
    )
  )

  header_html <- htmltools::tags$div(
    htmltools::tags$style(htmltools::HTML(section_c_css)),
    htmltools::tags$div(class = "gunc-header-title", "GUNC Genome Chimerism & Contamination Flow"),
    htmltools::tags$div(class = "gunc-header-subtitle", subtitle_text),
    legend_html
  )

  # Human-readable summary table embedded beneath the Sankey, giving exact
  # per-clade pass rates and low-RRS burden that the diagram alone cannot
  # convey precisely.
  summary_table_rows <- lapply(seq_len(nrow(summary_stats)), function(i) {
    row <- summary_stats[i, ]
    htmltools::tags$tr(
      htmltools::tags$td(row$taxonomic_level),
      htmltools::tags$td(row$n_genomes),
      htmltools::tags$td(row$n_pass),
      htmltools::tags$td(row$n_fail),
      htmltools::tags$td(paste0(formatC(row$pass_rate_pct, format = "f", digits = 1), "%")),
      htmltools::tags$td(row$n_low_rrs),
      htmltools::tags$td(paste0(formatC(row$low_rrs_rate_pct, format = "f", digits = 1), "%"))
    )
  })

  summary_table_html <- htmltools::tags$div(
    htmltools::tags$div(class = "gunc-summary-title", "Per-Taxonomic-Level Summary Statistics"),
    htmltools::tags$table(
      class = "gunc-summary-table",
      htmltools::tags$tr(
        htmltools::tags$th("Taxonomic Level"),
        htmltools::tags$th("N Genomes"),
        htmltools::tags$th("N Pass"),
        htmltools::tags$th("N Fail"),
        htmltools::tags$th("Pass Rate"),
        htmltools::tags$th("N Low-RRS"),
        htmltools::tags$th("Low-RRS Rate")
      ),
      summary_table_rows
    )
  )

  # Combine header, sankey widget, caption, and summary table into a single
  # browsable HTML page.
  full_plot <- htmltools::browsable(
    htmltools::tagList(
      header_html,
      sankey_widget,
      caption_html,
      summary_table_html
    )
  )

  # Step 7: Save primary self-contained interactive HTML.
  #
  # IMPORTANT: full_plot is a browsable(tagList(...)) composite page (header +
  # sankey widget + caption + summary table) -- it is NOT an object of class
  # "htmlwidget". htmlwidgets::saveWidget() is built specifically for a single
  # bare htmlwidget object and is the wrong tool for a composite tagList; it
  # errors internally in non-obvious ways ("invalid type/length (symbol/0) in
  # vector allocation") when given one. htmltools::save_html() is the correct
  # function for composite pages, and it supports selfcontained=TRUE (pandoc-
  # based) to embed all JS/CSS assets into a single file with no lib/ folder.
  #
  # Also: htmltools::save_html()'s `libdir` argument (used when selfcontained
  # export is unavailable) MUST be a relative path/descendant of the directory
  # containing `file` -- it will refuse an external path such as tempdir().
  # The fallback below therefore always uses a plain relative "lib" directory
  # inside OUTPUT_DIR, which is the only form htmltools accepts.
  log_msg("Step 7: Saving primary interactive HTML...")
  html_out_path <- file.path(OUTPUT_DIR, paste0(SAMPLE_ID, "_gunc_sankey.html"))

  pandoc_available <- nzchar(Sys.which("pandoc"))
  if (!pandoc_available) {
    log_msg("pandoc not found on PATH; selfcontained=TRUE export is unavailable. Falling back to save_html() with a 'lib' subfolder inside OUTPUT_DIR (dependency assets will be kept alongside the HTML, not embedded).", level = "WARNING")
  }

  save_ok <- tryCatch({
    if (pandoc_available) {
      htmltools::save_html(full_plot, file = html_out_path, selfcontained = TRUE)
    } else {
      htmltools::save_html(full_plot, file = html_out_path, libdir = "lib")
    }
    TRUE
  }, error = function(e) {
    log_msg(paste0("selfcontained HTML export failed (", e$message, "); retrying with a 'lib' subfolder inside OUTPUT_DIR (non-selfcontained, but reliable)."), level = "WARNING")
    htmltools::save_html(full_plot, file = html_out_path, libdir = "lib")
    TRUE
  })

  if (file.exists(html_out_path)) {
    log_msg(paste0("SUCCESS: HTML interactive plot saved -> ", html_out_path))
  } else {
    stop("Failed to generate primary HTML output file.", call. = FALSE)
  }

  # Report whether a lib/ dependency directory exists alongside the HTML, and
  # why -- either pandoc/selfcontained export was unavailable/failed (expected,
  # not an error condition) or something else is worth investigating.
  stray_lib_dir <- file.path(OUTPUT_DIR, "lib")
  if (dir.exists(stray_lib_dir)) {
    log_msg(paste0("NOTE: A 'lib' directory is present at ", stray_lib_dir, " because selfcontained (pandoc-embedded) export was unavailable or failed -- see WARNING above. The HTML file depends on this folder to render correctly; keep them together, or install pandoc on this node to enable true single-file export."), level = "WARNING")
  } else {
    log_msg("Confirmed: selfcontained export succeeded, no 'lib' dependency directory was created.")
  }

  # Step 8: Static export (PDF and SVG/PNG fallback) via webshot2
  log_msg("Step 8: Rendering static exports (PDF / SVG) via webshot2...")

  pdf_out_path <- file.path(OUTPUT_DIR, paste0(SAMPLE_ID, "_gunc_sankey.pdf"))
  svg_out_path <- file.path(OUTPUT_DIR, paste0(SAMPLE_ID, "_gunc_sankey.svg"))

  # Define static dimensions equivalent to 10 x 7 inches at 300 DPI
  w_px <- 1000
  h_px <- 700

  # Pre-flight check: webshot2/chromote requires a discoverable Chromium/Chrome
  # binary. On HPC compute nodes this is the single most common reason static
  # export silently produces nothing. Check explicitly and log an actionable
  # message instead of letting the export attempts fail with an opaque error.
  chrome_ok <- FALSE
  chrome_path_msg <- ""
  if (requireNamespace("chromote", quietly = TRUE)) {
    chrome_path_result <- tryCatch(chromote::find_chrome(), error = function(e) NA_character_)
    if (!is.na(chrome_path_result) && nzchar(chrome_path_result)) {
      chrome_ok <- TRUE
      chrome_path_msg <- chrome_path_result
    }
  }

  if (!chrome_ok) {
    log_msg("Headless Chromium/Chrome was NOT found on this system (checked via chromote::find_chrome()). This is the standard reason webshot2 fails to produce PDF/SVG on HPC/Slurm nodes. Static export will be skipped. To fix: (1) load/install a system Chrome or Chromium module and ensure it is on PATH, or (2) set the path explicitly with chromote::set_chrome_path('/path/to/chrome') before running this script, or (3) request that your cluster admin install Chromium as an environment module.", level = "WARNING")
  } else {
    log_msg(paste0("Headless Chrome found at: ", chrome_path_msg))

    # Attempt PDF export
    tryCatch({
      webshot2::webshot(
        url = html_out_path,
        file = pdf_out_path,
        vwidth = w_px,
        vheight = h_px,
        delay = 0.5
      )
      if (file.exists(pdf_out_path)) {
        log_msg(paste0("SUCCESS: PDF static plot saved -> ", pdf_out_path))
      }
    }, error = function(e) {
      log_msg(paste0("WARNING: PDF static export failed: ", e$message), level = "WARNING")
    })

    # Attempt SVG export (with clean PNG fallback logging if true SVG isn't supported)
    tryCatch({
      webshot2::webshot(
        url = html_out_path,
        file = svg_out_path,
        vwidth = w_px,
        vheight = h_px,
        delay = 0.5
      )
      if (file.exists(svg_out_path)) {
        log_msg(paste0("SUCCESS: SVG static plot saved -> ", svg_out_path))
      }
    }, error = function(e) {
      log_msg(paste0("SVG export not directly supported by rendering engine: ", e$message), level = "WARNING")
      png_fallback_path <- file.path(OUTPUT_DIR, paste0(SAMPLE_ID, "_GUNC_sankey_fallback.png"))
      log_msg(paste0("Falling back to high-resolution PNG export -> ", png_fallback_path), level = "WARNING")

      tryCatch({
        webshot2::webshot(
          url = html_out_path,
          file = png_fallback_path,
          vwidth = w_px,
          vheight = h_px,
          delay = 0.5,
          zoom = 3 # High resolution
        )
        log_msg(paste0("SUCCESS: Fallback PNG saved -> ", png_fallback_path))
      }, error = function(e2) {
        log_msg(paste0("WARNING: Fallback PNG export also failed: ", e2$message), level = "WARNING")
      })
    })
  }

  log_msg("=== PIPELINE EXECUTION COMPLETED SUCCESSFULLY ===")

}, error = function(e) {
  log_msg(paste0("FATAL ERROR IN SCRIPT EXECUTION: ", e$message), level = "ERROR")

  # Print session info to log on error for debugging
  cat("--- SYSTEM & SESSION ERROR SUMMARY ---\n", file = log_file, append = TRUE)
  capture.output(sessionInfo(), file = log_file, append = TRUE)

  stop(e)
})

# --- 3. REPRODUCIBILITY SESSION SUMMARY LOGGING ---
cat("--- REPRODUCIBILITY SESSION SUMMARY ---\n", file = log_file, append = TRUE)
capture.output(sessionInfo(), file = log_file, append = TRUE)

quit(status = 0)
