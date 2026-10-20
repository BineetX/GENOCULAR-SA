#!/usr/bin/env Rscript
# =============================================================================
# network.R (v10.1 — Single-Sample Pipeline Edition)
# HADEG Hydrocarbon Degradation Pathway Co-occurrence Network Plot
#
# SINGLE-SAMPLE ONLY: expects exactly one sample subfolder under
# <results_dir>/hadeg/. If more than one is found, the script fails loudly
# rather than silently combining or looping over samples.
#
# EXPECTED CLI ARGUMENT ORDER (do not reorder):
#   Rscript network.R <RESULTS_DIR> <OUTPUT_DIR> <SAMPLE_ID>
#
#   arg1: RESULTS_DIR  - pipeline results root containing a "hadeg/" folder
#                        with exactly one sample subfolder, which must
#                        contain Results_HADEG.proteinortho.tsv
#   arg2: OUTPUT_DIR   - pipeline-provided output path; the plot pair and the
#                        log file are written here (never hardcoded)
#   arg3: SAMPLE_ID    - the sample's display label used in the log filename
#                        and plot subtitle. If it differs from the detected
#                        hadeg/ subfolder name, that's logged as a warning
#                        and SAMPLE_ID is used only for labeling/log naming.
#
# One PNG + one SVG are written for the network plot (or for the
# no-hits / no-sample placeholder, if applicable).
# =============================================================================

# =============================================================================
# BLOCK 0 — LOGGING SETUP
# =============================================================================
LOG_LINES <- character(0)
SCRIPT_NAME <- "network.R"

log_msg <- function(...) {
  ts <- format(Sys.time(), "%Y-%m-%d %H:%M:%S")
  line <- paste0("[", ts, "] ", paste0(..., collapse = ""))
  LOG_LINES[[length(LOG_LINES) + 1]] <<- line
  message(line)
}

flush_log <- function(log_path) {
  tryCatch({
    writeLines(LOG_LINES, con = log_path)
  }, error = function(e) {
    message("[network.R] WARNING: could not write log file: ", e$message)
  })
}

fail_loudly <- function(msg, log_path = NULL) {
  full_msg <- paste0("[network.R] FATAL ERROR: ", msg)
  log_msg(full_msg)
  if (!is.null(log_path)) flush_log(log_path)
  quit(status = 1)
}

# =============================================================================
# BLOCK 1 — PACKAGE LOADING (defensive)
# =============================================================================
required_pkgs <- c("ggplot2", "dplyr", "tidyr", "readr", "stringr", "ggrepel", "scales", "svglite")

load_packages <- function(pkgs) {
  missing_pkgs <- pkgs[!sapply(pkgs, requireNamespace, quietly = TRUE)]
  if (length(missing_pkgs) > 0) {
    fail_loudly(paste0("Missing required R packages: ", paste(missing_pkgs, collapse = ", "),
                        ". Please install them before running this script."))
  }
  suppressPackageStartupMessages({
    library(ggplot2); library(dplyr); library(tidyr); library(readr)
    library(stringr); library(ggrepel); library(scales); library(svglite)
  })
  log_msg("All required packages loaded OK: ", paste(pkgs, collapse = ", "))
}
load_packages(required_pkgs)

# =============================================================================
# BLOCK 2 — COMMAND-LINE ARGUMENT PARSING (no hardcoded paths)
# =============================================================================
args <- commandArgs(trailingOnly = TRUE)

if (length(args) < 3) {
  fail_loudly(paste0(
    "Expected 3 arguments (RESULTS_DIR OUTPUT_DIR SAMPLE_ID), got ", length(args), ".\n",
    "Usage: Rscript network.R <results_dir> <output_dir> <sample_id|ALL>"
  ))
}

results_dir <- normalizePath(args[1], mustWork = FALSE)
output_dir  <- args[2]
sample_arg  <- args[3]

if (!dir.exists(results_dir)) {
  fail_loudly(paste0("results_dir not found: ", results_dir))
}

dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
if (!dir.exists(output_dir)) {
  fail_loudly(paste0("Could not create/access output_dir: ", output_dir))
}

hadeg_base <- file.path(results_dir, "hadeg")
if (!dir.exists(hadeg_base)) {
  fail_loudly(paste0("hadeg/ folder not found under results_dir: ", hadeg_base))
}

plot_dir <- file.path(output_dir, "plots")
dir.create(plot_dir, recursive = TRUE, showWarnings = FALSE)

# log file name uses SAMPLE_ID when a single sample is requested, else "ALL"
log_sample_tag <- if (identical(sample_arg, "") || toupper(sample_arg) == "ALL") "ALL" else sample_arg
log_path <- file.path(output_dir, paste0(log_sample_tag, "_HADEG_network_run.log"))

log_msg("===== ", SCRIPT_NAME, " run started =====")
log_msg("Resolved results_dir : ", results_dir)
log_msg("Resolved output_dir  : ", output_dir)
log_msg("Resolved plot_dir    : ", plot_dir)
log_msg("Resolved hadeg_base  : ", hadeg_base)
log_msg("Requested sample_id  : ", sample_arg)

# =============================================================================
# BLOCK 3 — PATHWAY COLOR PALETTE & COMPOUND MAPPING
# =============================================================================
PATHWAY_COLORS <- c(
  "Alkane degradation"       = "#D62828",
  "Alkene degradation"       = "#7B2FBE",
  "Aromatic degradation"     = "#E76F00",
  "Plastic degradation"      = "#E9C46A",
  "Biosurfactant production" = "#4CC9F0",
  "Other"                    = "#AAAAAA"
)

PATHWAY_NUMBERS <- c(
  "Alkane degradation"       = "1",
  "Alkene degradation"       = "2",
  "Aromatic degradation"     = "3",
  "Plastic degradation"      = "4",
  "Biosurfactant production" = "5",
  "Other"                    = "0"
)

compound_to_group <- function(compound) {
  comp <- tolower(as.character(compound))
  dplyr::case_when(
    grepl("alkan",         comp) ~ "Alkane degradation",
    grepl("alken",         comp) ~ "Alkene degradation",
    grepl("aromat",        comp) ~ "Aromatic degradation",
    grepl("plastic",       comp) ~ "Plastic degradation",
    grepl("biosur|surfact", comp) ~ "Biosurfactant production",
    TRUE                         ~ "Other"
  )
}

# =============================================================================
# BLOCK 3b — PUBLICATION THEME (single reusable object, per pipeline standard)
# =============================================================================
pub_theme <- theme(
  plot.title      = element_text(size = 18, color = "black", face = "bold", hjust = 0.5),
  plot.subtitle   = element_text(size = 13, color = "black", face = "bold", hjust = 0.5),
  legend.text     = element_text(size = 12, color = "black", face = "bold"),
  legend.title    = element_text(size = 12, color = "black", face = "bold"),
  axis.text       = element_text(size = 14, color = "black", face = "bold"),
  axis.title      = element_text(size = 16, color = "black", face = "bold")
)

# =============================================================================
# BLOCK 4 — AUTO-LOCATE 7_All_pathways.csv
# =============================================================================
locate_pathways_csv <- function(results_dir) {
  candidate_dirs <- c(
    file.path(results_dir, "R_scripts"),
    file.path(dirname(results_dir), "HADEG", "Tables"),
    file.path(dirname(results_dir), "HADEG", "Scripts"),
    file.path(dirname(dirname(results_dir)), "HADEG", "Tables"),
    file.path(dirname(dirname(results_dir)), "HADEG", "Scripts"),
    results_dir
  )
  for (d in candidate_dirs) {
    if (!is.null(d) && nchar(d) > 0) {
      cand <- file.path(d, "7_All_pathways.csv")
      if (file.exists(cand)) return(cand)
    }
  }
  found <- list.files(results_dir, pattern = "7_All_pathways\\.csv$", recursive = TRUE, full.names = TRUE)
  if (length(found) > 0) return(found[1])
  return(NULL)
}
pathways_csv_path <- locate_pathways_csv(results_dir)

# =============================================================================
# BLOCK 5 — SAVE HELPER (PNG + SVG only, per pipeline standard)
# =============================================================================
save_plots <- function(p, filename_base, width = 18, height = 16) {
  png_path <- file.path(plot_dir, paste0(filename_base, ".png"))
  svg_path <- file.path(plot_dir, paste0(filename_base, ".svg"))

  tryCatch({
    ggsave(png_path, plot = p, width = width, height = height, dpi = 300, bg = "white")
    log_msg("Saved PNG: ", png_path)
  }, error = function(e) log_msg("ERROR saving PNG (", filename_base, "): ", e$message))

  tryCatch({
    ggsave(svg_path, plot = p, width = width, height = height, bg = "white", device = "svg")
    log_msg("Saved SVG: ", svg_path)
  }, error = function(e) log_msg("ERROR saving SVG (", filename_base, "): ", e$message))
}

# =============================================================================
# BLOCK 6 — PLACEHOLDER PLOT
# =============================================================================
make_placeholder <- function(title_text, body_text, filename_base) {
  p <- ggplot() +
    annotate("text", x = 0.5, y = 0.65, label = title_text, size = 6.5, fontface = "bold", color = "#2C3E50", hjust = 0.5) +
    annotate("text", x = 0.5, y = 0.35, label = body_text, size = 4.2, color = "#555555", hjust = 0.5, lineheight = 1.5) +
    xlim(0, 1) + ylim(0, 1) + theme_void() +
    theme(plot.background = element_rect(fill = "#F8F9FA", color = "#DEE2E6", linewidth = 1), margin = margin(30, 30, 30, 30))
  save_plots(p, filename_base, width = 14, height = 8)
}

# =============================================================================
# BLOCK 7 — CORE DATA PARSING (per sample)
# =============================================================================
parse_hadeg_sample <- function(sample_dir, sample_id, pathways_df) {
  tsv_path <- file.path(sample_dir, "Results_HADEG.proteinortho.tsv")
  if (!file.exists(tsv_path)) {
    log_msg("  [", sample_id, "] Results_HADEG.proteinortho.tsv not found, skipping: ", tsv_path)
    return(NULL)
  }

  raw <- tryCatch(read.table(tsv_path, header = TRUE, sep = "\t", comment.char = "", stringsAsFactors = FALSE, fill = TRUE, quote = ""), error = function(e) NULL)
  if (is.null(raw) || nrow(raw) == 0) {
    log_msg("  [", sample_id, "] Empty or unreadable input table.")
    return(NULL)
  }

  colnames(raw)[1:3] <- c("Species", "Genes", "Alg_Conn")
  hadeg_col <- grep("HADEG_protein_database", colnames(raw), value = TRUE)[1]
  all_faa   <- grep("\\.faa", colnames(raw), value = TRUE)
  mag_cols  <- setdiff(all_faa, hadeg_col)
  mag_labels <- mag_cols %>% str_remove("\\.faa$") %>% str_remove(paste0("^", sample_id, "[._]?"))

  if (length(mag_cols) == 0) {
    log_msg("  [", sample_id, "] No MAG (.faa) columns detected.")
    return(NULL)
  }
  annotated <- raw[raw[[hadeg_col]] != "*" & !is.na(raw[[hadeg_col]]), , drop = FALSE]
  if (nrow(annotated) == 0) {
    log_msg("  [", sample_id, "] No HADEG-annotated rows found (0 hits).")
    return(list(sample_id = sample_id, n_hits = 0, data = NULL, mag_cols = mag_cols, mag_labels = mag_labels))
  }

  annotated$Protein_ID <- sapply(annotated[[hadeg_col]], function(x) {
    str_split(str_split(as.character(x), ",")[[1]][1], "\\|")[[1]][1]
  })

  mag_mat   <- annotated[, mag_cols, drop = FALSE]
  pres_mat <- as.data.frame(ifelse(mag_mat == "*" | is.na(mag_mat), 0L, 1L))
  colnames(pres_mat) <- mag_labels

  result_df <- data.frame(Protein_ID = annotated$Protein_ID, stringsAsFactors = FALSE)
  result_df <- cbind(result_df, pres_mat)

  if (!is.null(pathways_df) && nrow(pathways_df) > 0) {
    pathways_df$Protein_ID <- trimws(pathways_df$Protein_ID)
    result_df$Protein_ID   <- trimws(result_df$Protein_ID)
    result_df <- dplyr::left_join(result_df, pathways_df, by = "Protein_ID")
    result_df$pathway_group <- compound_to_group(result_df$Compound)
    result_df$gene_label <- ifelse(!is.na(result_df$Gene) & nchar(trimws(result_df$Gene)) > 0, str_remove(result_df$Gene, "^[A-Za-z][a-z][A-Z][A-Za-z]_"), result_df$Protein_ID)
  } else {
    result_df$pathway_group <- "Other"
    result_df$gene_label    <- result_df$Protein_ID
  }

  log_msg("  [", sample_id, "] Parsed ", nrow(result_df), " HADEG-annotated ortholog groups across ", length(mag_labels), " MAGs.")
  list(sample_id = sample_id, n_hits = nrow(result_df), data = result_df, mag_cols = mag_cols, mag_labels = mag_labels)
}

# =============================================================================
# BLOCK 8 — BUILD COMBINED LONG-FORMAT DATA
# =============================================================================
build_network_data <- function(all_samples_data, multi_sample = FALSE) {
  combined_rows <- list()
  for (sdata in all_samples_data) {
    if (is.null(sdata) || is.null(sdata$data) || nrow(sdata$data) == 0) next
    df  <- sdata$data
    sid <- sdata$sample_id
    mag_cols_present <- intersect(sdata$mag_labels, colnames(df))
    if (length(mag_cols_present) == 0) next

    long_df <- df %>%
      select(Protein_ID, gene_label, pathway_group, all_of(mag_cols_present)) %>%
      pivot_longer(cols = all_of(mag_cols_present), names_to = "mag_id", values_to = "present") %>%
      filter(present > 0)

    if (multi_sample) long_df$mag_id <- paste0(sid, ":", long_df$mag_id)
    long_df$sample_id    <- sid
    combined_rows[[sid]] <- long_df
  }

  if (length(combined_rows) == 0) return(NULL)
  combined <- dplyr::bind_rows(combined_rows)
  if (nrow(combined) == 0) return(NULL)

  gene_summary <- combined %>%
    group_by(gene_label, pathway_group) %>%
    summarise(n_mags = n_distinct(mag_id), .groups = "drop") %>%
    group_by(gene_label) %>%
    mutate(dom_group = pathway_group[which.max(n_mags)], total_mags = sum(n_mags)) %>%
    ungroup() %>% distinct(gene_label, dom_group, total_mags)

  mag_summary <- combined %>%
    group_by(mag_id, pathway_group) %>%
    summarise(n_genes = n_distinct(gene_label), .groups = "drop") %>%
    group_by(mag_id) %>%
    mutate(dom_group = pathway_group[which.max(n_genes)], total_genes = sum(n_genes)) %>%
    ungroup() %>% distinct(mag_id, dom_group, total_genes)

  active_groups <- unique(combined$pathway_group)
  active_groups <- active_groups[active_groups %in% names(PATHWAY_COLORS)]

  list(combined = combined, gene_summary = gene_summary, mag_summary = mag_summary, active_groups = active_groups)
}

# =============================================================================
# BLOCK 9 — PURE-R FRUCHTERMAN-REINGOLD LAYOUT
# =============================================================================
fr_layout <- function(node_ids, edges_df, hub_ids, n_iter = 220, seed = 42) {
  set.seed(seed)
  n <- length(node_ids)
  if (n == 0) return(data.frame(node = character(0), x = numeric(0), y = numeric(0)))

  pos <- matrix(0.0, nrow = n, ncol = 2, dimnames = list(node_ids, c("x", "y")))
  hub_ids_valid <- intersect(hub_ids, node_ids)
  n_hubs <- length(hub_ids_valid)

  if (n_hubs > 0) {
    angles <- seq(0, 2 * pi, length.out = n_hubs + 1)[seq_len(n_hubs)]
    for (i in seq_along(hub_ids_valid)) {
      pos[hub_ids_valid[i], ] <- c(cos(angles[i]), sin(angles[i])) * 0.55
    }
  }

  non_hub <- setdiff(node_ids, hub_ids_valid)
  for (nd in non_hub) {
    r     <- sqrt(runif(1)) * 0.45
    theta <- runif(1, 0, 2 * pi)
    pos[nd, ] <- c(r * cos(theta), r * sin(theta))
  }

  if (nrow(edges_df) == 0 || n <= 1) {
    return(data.frame(node = node_ids, x = pos[, 1], y = pos[, 2], stringsAsFactors = FALSE))
  }

  edges_df <- edges_df[edges_df$from %in% node_ids & edges_df$to %in% node_ids, , drop = FALSE]
  k <- sqrt(1.0 / n)
  W <- 1.0
  temp_init <- 0.12

  for (iter in seq_len(n_iter)) {
    temp <- temp_init * (1.0 - iter / n_iter)
    disp <- matrix(0.0, nrow = n, ncol = 2, dimnames = list(node_ids, NULL))

    for (i in seq_len(n - 1)) {
      ni <- node_ids[i]
      for (j in (i + 1):n) {
        nj    <- node_ids[j]
        delta <- pos[ni, ] - pos[nj, ]
        dist  <- max(sqrt(sum(delta^2)), 1e-6)
        f_r   <- k^2 / dist
        unit  <- delta / dist
        disp[ni, ] <- disp[ni, ] + unit * f_r
        disp[nj, ] <- disp[nj, ] - unit * f_r
      }
    }

    for (e in seq_len(nrow(edges_df))) {
      ni    <- edges_df$from[e]
      nj    <- edges_df$to[e]
      delta <- pos[ni, ] - pos[nj, ]
      dist  <- max(sqrt(sum(delta^2)), 1e-6)
      f_a   <- dist^2 / k
      unit  <- delta / dist
      disp[ni, ] <- disp[ni, ] - unit * f_a
      disp[nj, ] <- disp[nj, ] + unit * f_a
    }

    for (nd in non_hub) {
      d_norm <- max(sqrt(sum(disp[nd, ]^2)), 1e-6)
      move   <- disp[nd, ] / d_norm * min(d_norm, temp)
      pos[nd, ] <- pos[nd, ] + move
      pos[nd, 1] <- max(-W, min(W, pos[nd, 1]))
      pos[nd, 2] <- max(-W, min(W, pos[nd, 2]))
    }
  }

  data.frame(node = node_ids, x = pos[, 1], y = pos[, 2], stringsAsFactors = FALSE)
}

# =============================================================================
# BLOCK 10 — ASSEMBLE NODE & EDGE DATA FRAMES
# =============================================================================
build_plot_data <- function(net_data) {
  combined      <- net_data$combined
  gene_summary  <- net_data$gene_summary
  mag_summary   <- net_data$mag_summary
  active_groups <- net_data$active_groups

  hub_nodes <- data.frame(
    node      = active_groups,
    node_type = "hub",
    dom_group = active_groups,
    node_size = 8.0,
    label     = active_groups,
    stringsAsFactors = FALSE
  )

  gene_nodes <- gene_summary %>%
    mutate(node      = gene_label,
           node_type = "gene",
           node_size = scales::rescale(total_mags, to = c(4.0, 8.0)),
           label     = gene_label) %>%
    select(node, node_type, dom_group, node_size, label)

  mag_nodes <- mag_summary %>%
    mutate(node      = mag_id,
           node_type = "mag",
           node_size = scales::rescale(total_genes, to = c(3.0, 6.5)),
           label     = mag_id) %>%
    select(node, node_type, dom_group, node_size, label)

  all_nodes <- dplyr::bind_rows(hub_nodes, gene_nodes, mag_nodes) %>% distinct(node, .keep_all = TRUE)

  hub_gene_edges <- combined %>%
    select(gene_label, pathway_group) %>% distinct() %>%
    filter(pathway_group %in% active_groups) %>%
    rename(from = pathway_group, to = gene_label) %>%
    mutate(edge_type   = "hub_gene", color_group = from, weight      = 1.0)

  gene_mag_edges <- combined %>%
    group_by(gene_label, mag_id, pathway_group) %>%
    summarise(weight = sum(present, na.rm = TRUE), .groups = "drop") %>%
    rename(from = gene_label, to = mag_id, color_group = pathway_group) %>%
    mutate(edge_type = "gene_mag")

  all_edges <- dplyr::bind_rows(hub_gene_edges, gene_mag_edges) %>% filter(from %in% all_nodes$node, to %in% all_nodes$node)

  list(nodes   = all_nodes, edges   = all_edges, hub_ids = active_groups)
}

# =============================================================================
# BLOCK 11 — RUN LAYOUT & MERGE COORDINATES
# =============================================================================
run_layout <- function(plot_data, n_iter = 250) {
  nodes   <- plot_data$nodes
  edges   <- plot_data$edges
  hub_ids <- plot_data$hub_ids
  layout_df <- fr_layout(node_ids = nodes$node, edges_df = edges[, c("from", "to")], hub_ids  = hub_ids, n_iter   = n_iter, seed   = 42)

  nodes_xy <- dplyr::left_join(nodes, layout_df, by = "node")
  from_xy <- layout_df %>% rename(from = node, x = x, y = y)
  to_xy   <- layout_df %>% rename(to   = node, xend = x, yend = y)
  edges_xy <- edges %>% dplyr::left_join(from_xy, by = "from") %>% dplyr::left_join(to_xy,   by = "to")

  list(nodes_xy = nodes_xy, edges_xy = edges_xy)
}

# =============================================================================
# BLOCK 12 — BUILD GGPLOT NETWORK
# =============================================================================
build_network_plot <- function(layout_data, net_data, sample_label, n_mags, n_genes, n_groups, total_hits) {
  nodes_xy <- layout_data$nodes_xy
  edges_xy <- layout_data$edges_xy

  nodes_xy$x    <- nodes_xy$x * 1.8
  nodes_xy$y    <- nodes_xy$y * 1.8
  edges_xy$x    <- edges_xy$x * 1.8
  edges_xy$y    <- edges_xy$y * 1.8
  edges_xy$xend <- edges_xy$xend * 1.8
  edges_xy$yend <- edges_xy$yend * 1.8

  hubs  <- nodes_xy %>% filter(node_type == "hub")
  genes <- nodes_xy %>% filter(node_type == "gene")
  mags  <- nodes_xy %>% filter(node_type == "mag")

  edges_xy$lwd_val <- ifelse(
    edges_xy$edge_type == "hub_gene",
    1.4,
    scales::rescale(ifelse(is.na(edges_xy$weight), 1, edges_xy$weight), to = c(0.85, 2.0))
  )

  discovered_groups <- unique(nodes_xy$dom_group)
  current_palette   <- PATHWAY_COLORS[names(PATHWAY_COLORS) %in% discovered_groups]
  current_numbers   <- PATHWAY_NUMBERS[names(PATHWAY_NUMBERS) %in% discovered_groups]

  # Subtitle composed explicitly per pipeline standard — no raw variable dumps.
  subtitle_text <- paste0(
    "Sample ID: ", sample_label,
    " | ", n_mags, " MAGs | ", n_genes, " detected genes | ",
    n_groups, " pathway groups | ", total_hits, " ortholog groups with HADEG hits"
  )

  p <- ggplot() +
    geom_segment(
      data = edges_xy %>% filter(edge_type == "gene_mag"),
      aes(x = x, y = y, xend = xend, yend = yend, color = color_group, linewidth = lwd_val),
      alpha = 0.28, show.legend = FALSE
    ) +
    geom_segment(
      data = edges_xy %>% filter(edge_type == "hub_gene"),
      aes(x = x, y = y, xend = xend, yend = yend, color = color_group),
      linewidth = 1.35, alpha = 0.52, show.legend = FALSE
    ) +
    scale_color_manual(values = current_palette, guide = "none") +
    scale_linewidth_continuous(range = c(0.8, 2.2), guide = "none") +
    geom_point(
      data = mags,
      aes(x = x, y = y, fill = dom_group, size = node_size),
      shape = 21, color = "grey30", stroke = 0.7, alpha = 0.65
    ) +
    geom_point(
      data = genes,
      aes(x = x, y = y, fill = dom_group, size = node_size),
      shape = 21, color = "grey15", stroke = 0.9, alpha = 0.90
    ) +
    geom_point(
      data = hubs,
      aes(x = x, y = y, fill = dom_group),
      shape = 22, size = 22, color = "black", stroke = 2.0, alpha = 1.0
    ) +
    geom_label(
      data = hubs,
      aes(x = x, y = y, label = current_numbers[node]),
      size = 6.0, fontface = "bold",
      fill = "white", color = "black",
      label.size = 0.5, label.padding = unit(0.20, "lines"), alpha = 0.95
    ) +
    geom_text_repel(
      data = genes,
      aes(x = x, y = y, label = label),
      size = 4.2, fontface = "bold", color = "black",
      max.overlaps = Inf, box.padding = 0.9,
      point.padding = 0.8, segment.size = 0.4,
      segment.alpha = 0.5, force = 35, min.segment.length = 0.2,
      nudge_x = 0.05, nudge_y = 0.05,
      show.legend = FALSE, seed = 42
    ) +
    geom_text_repel(
      data = mags,
      aes(x = x, y = y, label = label),
      size = 4.2, color = "black", fontface = "bold",
      max.overlaps = Inf, box.padding = 0.9,
      point.padding = 0.8, segment.size = 0.4,
      segment.alpha = 0.5, force = 35, min.segment.length = 0.2,
      nudge_x = 0.05, nudge_y = 0.05,
      show.legend = FALSE, seed = 43
    ) +
    scale_fill_manual(
      name   = "Groups",
      values = current_palette,
      breaks = names(current_palette),
      labels = paste0(current_numbers, " -> ", names(current_palette)),
      guide  = guide_legend(
        override.aes = list(shape = 21, size = 13, stroke = 1, fill = current_palette),
        title.theme  = element_text(face = "bold", size = 15),
        label.theme  = element_text(face = "bold", size = 15)
      )
    ) +
    scale_size_continuous(range = c(3.5, 12), guide = "none") +
    theme_void() +
    theme(
      plot.title      = element_text(face = "bold", size = 26, hjust = 0.5),
      plot.subtitle   = element_text(face = "bold", size = 16, hjust = 0.5),
      plot.caption    = element_text(size = 8, color = "grey50", hjust = 0),
      legend.position = c(0.85, 0.95),
      legend.justification = c("right", "top"),
      legend.key.size = unit(1.0, "lines"),
      plot.margin     = margin(20, 20, 20, 20)
    ) +
    labs(
      title    = "Hydrocarbon Degradation Pathway Co-occurrence Network",
      subtitle = subtitle_text,
      caption  = "Numbered Squares = pathway group hubs | Larger circles = genes (proportional to MAG prevalence) | Smaller circles = MAGs (proportional to gene richness) | Layout: Fruchterman-Reingold"
    )

  return(p)
}

# =============================================================================
# BLOCK 13 — SUMMARY STATISTICS PRINTER
# =============================================================================
print_summary <- function(all_samples_data, net_data) {
  log_msg("===== HADEG NETWORK -- ANALYSIS SUMMARY =====")
  for (sdata in all_samples_data) {
    if (is.null(sdata)) next
    log_msg("Sample: ", sdata$sample_id)
    if (is.null(sdata$data) || sdata$n_hits == 0) next
    log_msg("  Ortholog groups with HADEG annotation : ", sdata$n_hits)
    mag_hits <- sum(colSums(sdata$data[, sdata$mag_labels, drop = FALSE] > 0) > 0)
    log_msg("  MAGs with >= 1 HADEG hit              : ", mag_hits, " / ", length(sdata$mag_labels))
  }
}

# =============================================================================
# BLOCK 14 — MAIN EXECUTION (single-sample only)
# =============================================================================
main <- function() {
  pathways_df     <- NULL
  PATHWAYS_LOADED <- FALSE

  if (!is.null(pathways_csv_path) && file.exists(pathways_csv_path)) {
    log_msg("Reading pathway reference table: ", pathways_csv_path)
    pathways_df <- tryCatch(read_csv(pathways_csv_path, show_col_types = FALSE), error = function(e) NULL)
    if (!is.null(pathways_df) && nrow(pathways_df) > 0) {
      PATHWAYS_LOADED <- TRUE
      log_msg("Pathway reference loaded: ", nrow(pathways_df), " entries")
    }
  } else {
    log_msg("No 7_All_pathways.csv reference table found; pathway_group will default to 'Other' for all genes.")
  }

  all_sample_dirs <- list.dirs(hadeg_base, recursive = FALSE, full.names = TRUE)
  all_sample_dirs <- all_sample_dirs[!grepl("cache|tmp|temp", basename(all_sample_dirs), ignore.case = TRUE)]

  if (length(all_sample_dirs) == 0) {
    log_msg("No sample directory found under hadeg/.")
    make_placeholder("HADEG Network Plot -- No Sample Detected", "Expected standard subfolder structure mapping missing files.", "hadeg_network_no_sample")
    flush_log(log_path)
    stop("[HADEG Network] No sample directory found.")
  }

  if (length(all_sample_dirs) > 1) {
    fail_loudly(paste0(
      "This script is single-sample only, but ", length(all_sample_dirs),
      " folders were found under ", hadeg_base, ": ",
      paste(basename(all_sample_dirs), collapse = ", "),
      ". Point results_dir at a single-sample results tree (remove stale/extra sample folders)."
    ), log_path)
  }

  sample_dir <- all_sample_dirs[1]
  sample_id  <- basename(sample_dir)

  sample_id_requested <- !(identical(sample_arg, "") || toupper(sample_arg) == "ALL")
  if (sample_id_requested && !identical(sample_arg, sample_id)) {
    log_msg("WARNING: SAMPLE_ID arg ('", sample_arg, "') does not match detected sample folder name ('",
            sample_id, "'). Proceeding with the detected folder; using '", sample_arg, "' as the display label.")
    sample_id <- sample_arg
  }

  log_msg("Processing single sample: ", sample_id)
  sdata <- parse_hadeg_sample(sample_dir = sample_dir, sample_id = sample_id, pathways_df = pathways_df)

  if (is.null(sdata) || is.null(sdata$data) || sdata$n_hits == 0) {
    log_msg("Total HADEG hits for sample '", sample_id, "': 0.")
    make_placeholder("HADEG Network -- No Hydrocarbon Degradation Genes Detected",
                      paste0("Sample ID: ", sample_id, " — no hydrocarbon-degrading genes identified."),
                      paste0("hadeg_network_", sample_id, "_no_hits"))
    return(invisible(NULL))
  }

  net_data <- build_network_data(list(sdata), multi_sample = FALSE)
  if (is.null(net_data)) {
    log_msg("No network could be built from parsed data for sample '", sample_id, "'.")
    return(invisible(NULL))
  }

  print_summary(list(sdata), net_data)
  plot_data <- build_plot_data(net_data)

  log_msg("Running Fruchterman-Reingold layout (n_iter = 250)...")
  layout_dat <- run_layout(plot_data, n_iter = 250)

  p <- build_network_plot(
    layout_data  = layout_dat,
    net_data     = net_data,
    sample_label = sample_id,
    n_mags       = sum(plot_data$nodes$node_type == "mag"),
    n_genes      = sum(plot_data$nodes$node_type == "gene"),
    n_groups     = length(net_data$active_groups),
    total_hits   = sdata$n_hits
  )

  fname <- paste0("hadeg_network_", sample_id)
  log_msg("Saving network plot: ", fname)
  save_plots(p, fname, width = 18, height = 16)

  log_msg("[HADEG Network] Processing complete.")
}

# =============================================================================
# BLOCK 15 — RUN WITH TOP-LEVEL ERROR HANDLING + REPRODUCIBILITY LOG
# =============================================================================
tryCatch({
  main()
  log_msg("===== sessionInfo() =====")
  LOG_LINES[[length(LOG_LINES) + 1]] <<- paste(capture.output(sessionInfo()), collapse = "\n")
  log_msg("===== ", SCRIPT_NAME, " run completed successfully =====")
  flush_log(log_path)
}, error = function(e) {
  log_msg("UNCAUGHT ERROR: ", conditionMessage(e))
  log_msg("Call: ", paste(deparse(conditionCall(e)), collapse = " "))
  flush_log(log_path)
  quit(status = 1)
})
