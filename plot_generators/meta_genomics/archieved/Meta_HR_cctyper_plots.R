#!/usr/bin/env Rscript
# ==============================================================================
# SCRIPT: cctyper_plots.R
# PURPOSE: Generate publication-ready CRISPR-Cas synteny and subtype distribution
#          plots from CCTyper metagenomic pipeline output.
#
# EXPECTED CLI ARGUMENT ORDER:
#   arg1: CCTYPER_SAMPLE_DIR (Path to sample-level CCTyper output directory)
#   arg2: OUTPUT_DIR         (Path to directory where plots/logs will be saved)
#   arg3: SAMPLE_ID          (Explicit sample identifier string)
#
# USAGE:
#   Rscript cctyper_plots.R <CCTYPER_SAMPLE_DIR> <OUTPUT_DIR> <SAMPLE_ID>
# ==============================================================================

# ------------------------------------------------------------------------------
# 0. DEPENDENCY LOADING & SAFE ATTACHMENT
# ------------------------------------------------------------------------------
safe_library <- function(pkg) {
  if (!requireNamespace(pkg, quietly = TRUE)) {
    stop(paste0("CRITICAL ERROR: Required R package '", pkg, "' is not installed."), call. = FALSE)
  }
  library(pkg, character.only = TRUE, quietly = TRUE)
}

safe_library("ggplot2")
safe_library("dplyr")
safe_library("tidyr")
safe_library("readr")
safe_library("gggenes")

# ------------------------------------------------------------------------------
# 1. ARGUMENT VALIDATION & LOGGING SETUP
# ------------------------------------------------------------------------------
args <- commandArgs(trailingOnly = TRUE)

if (length(args) != 3) {
  message("FATAL ERROR: Incorrect number of command-line arguments provided.")
  message("Expected exactly 3 arguments in the following order:")
  message("  1. CCTYPER_SAMPLE_DIR (Path to sample-level CCTyper folder)")
  message("  2. OUTPUT_DIR (Path to output directory for plots/logs)")
  message("  3. SAMPLE_ID (Explicit sample identifier)")
  quit(status = 1)
}

cctyper_sample_dir <- normalizePath(args[1], mustWork = FALSE)
output_dir         <- normalizePath(args[2], mustWork = FALSE)
sample_id          <- as.character(args[3])

if (!dir.exists(output_dir)) {
  dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
  if (!dir.exists(output_dir)) {
    stop(paste0("CRITICAL ERROR: Could not create OUTPUT_DIR: ", output_dir), call. = FALSE)
  }
}

log_file <- file.path(output_dir, paste0(sample_id, "_CCTyper_run.log"))

log_msg <- function(message_text, level = "INFO") {
  timestamp <- format(Sys.time(), "%Y-%m-%d %H:%M:%S")
  entry <- paste0("[", timestamp, "] [", level, "] ", message_text)
  cat(entry, "\n", file = log_file, append = TRUE)
  cat(entry, "\n")
}

# Initialize log
cat("", file = log_file, append = FALSE)
log_msg(paste0("Starting script: cctyper_plots.R"))
log_msg(paste0("CCTYPER_SAMPLE_DIR resolved to: ", cctyper_sample_dir))
log_msg(paste0("OUTPUT_DIR resolved to: ", output_dir))
log_msg(paste0("SAMPLE_ID resolved to: ", sample_id))

if (!dir.exists(cctyper_sample_dir)) {
  log_msg(paste0("CCTYPER_SAMPLE_DIR does not exist: ", cctyper_sample_dir), level = "ERROR")
  quit(status = 1)
}

# ------------------------------------------------------------------------------
# 2. TYPOGRAPHY & THEME SPECIFICATION (GLOBAL STANDARD C)
# ------------------------------------------------------------------------------
pub_theme <- theme_bw() +
  theme(
    plot.title       = element_text(size = 18, color = "black", face = "bold", margin = margin(b = 6)),
    plot.subtitle    = element_text(size = 13, color = "black", face = "bold", margin = margin(b = 12)),
    legend.text      = element_text(size = 12, color = "black", face = "bold"),
    legend.title     = element_text(size = 12, color = "black", face = "bold"),
    axis.text        = element_text(size = 14, color = "black", face = "bold"),
    axis.title       = element_text(size = 16, color = "black", face = "bold"),
    strip.text       = element_text(size = 12, color = "black", face = "bold"),
    strip.background = element_rect(fill = "grey90", color = "black"),
    panel.grid.minor = element_blank()
  )

# ------------------------------------------------------------------------------
# 3. LOOKUP TABLES & PALETTES
# ------------------------------------------------------------------------------
# Map specific Cas genes to functional modules (unanchored regex to match CCTyper HMM strings)
cas_module_patterns <- list(
  "Adaptation"   = "(cas1|cas2|cas4|csn2)",
  "Interference" = "(cas3|cas5|cas7|cas8|cas9|cas10|cas12|cas13|cas14|csm|cmr|cse|csy|csx|cpf1)",
  "Cas6"         = "(cas6|cse3|cas6i|cas6e|cas6f)"
)

# Fixed CCTyper-consistent color palette
cctyper_module_palette <- c(
  "Adaptation"   = "blue",
  "Interference" = "gold",
  "Cas6"         = "red",
  "Unknown"      = "grey70",
  "CRISPR array" = "black"
)

# ------------------------------------------------------------------------------
# 4. MAIN WORKFLOW WRAPPED IN TRYCATCH (GLOBAL STANDARD B)
# ------------------------------------------------------------------------------
tryCatch({
  
  # Step 1: Enumerate subdirectories
  all_dirs <- list.dirs(cctyper_sample_dir, full.names = TRUE, recursive = FALSE)
  log_msg(paste0("Found ", length(all_dirs), " immediate subdirectories in CCTYPER_SAMPLE_DIR."))
  
  if (length(all_dirs) == 0) {
    log_msg("No locus subdirectories found. Skipping plotting.", level = "WARN")
    log_msg("cctyper_plots.R completed successfully (zero loci).")
    quit(status = 0)
  }

  # Step 2: Probe subdirectory contents and classify loci
  locus_class <- character(length(all_dirs))
  names(locus_class) <- basename(all_dirs)
  
  operon_data_list <- list()
  genes_data_list  <- list()
  
  for (d in all_dirs) {
    loc_id <- basename(d)
    operon_file          <- file.path(d, "cas_operons.tab")
    operon_putative_file <- file.path(d, "cas_operons_putative.tab")
    genes_file           <- file.path(d, "genes.tab")
    
    # Check operon tables
    has_operon <- file.exists(operon_file)
    has_putative <- file.exists(operon_putative_file)
    
    if (has_operon) {
      locus_class[loc_id] <- "validated"
      df_op <- read_tsv(operon_file, show_col_types = FALSE)
      if (nrow(df_op) > 0) {
        # Standardize expected columns defensively
        col_names <- colnames(df_op)
        sub_col  <- col_names[grepl("subtype|prediction|type", col_names, ignore.case = TRUE)][1]
        prob_col <- col_names[grepl("prob|score|conf", col_names, ignore.case = TRUE)][1]
        
        df_clean <- df_op %>%
          transmute(
            Locus_ID = loc_id,
            Prediction = if (!is.na(sub_col)) as.character(.data[[sub_col]]) else "Unknown",
            Probability = if (!is.na(prob_col)) as.numeric(.data[[prob_col]]) else 1.0,
            Status = "Validated"
          )
        operon_data_list[[loc_id]] <- df_clean
      }
    } else if (has_putative) {
      locus_class[loc_id] <- "putative_only"
      df_op <- read_tsv(operon_putative_file, show_col_types = FALSE)
      if (nrow(df_op) > 0) {
        col_names <- colnames(df_op)
        sub_col  <- col_names[grepl("subtype|prediction|type", col_names, ignore.case = TRUE)][1]
        prob_col <- col_names[grepl("prob|score|conf", col_names, ignore.case = TRUE)][1]
        
        df_clean <- df_op %>%
          transmute(
            Locus_ID = loc_id,
            Prediction = if (!is.na(sub_col)) as.character(.data[[sub_col]]) else "Unknown",
            Probability = if (!is.na(prob_col)) as.numeric(.data[[prob_col]]) else 1.0,
            Status = "Putative-only"
          )
        operon_data_list[[loc_id]] <- df_clean
      }
    } else {
      locus_class[loc_id] <- "array_only"
    }
    
    # Check genes.tab for Plot 1 (only if locus is validated or putative_only)
    if (locus_class[loc_id] %in% c("validated", "putative_only")) {
      if (file.exists(genes_file)) {
        df_g <- read_tsv(genes_file, show_col_types = FALSE)
        if (nrow(df_g) > 0) {
          col_names <- colnames(df_g)
          start_col  <- col_names[grepl("^start$", col_names, ignore.case = TRUE)][1]
          end_col    <- col_names[grepl("^end$", col_names, ignore.case = TRUE)][1]
          strand_col <- col_names[grepl("^strand$", col_names, ignore.case = TRUE)][1]
          
          # Prioritize CCTyper HMM match columns before falling back to generic names
          gene_col   <- col_names[grepl("^Hmm$|^Pos_hmm$|^Best_hit$|hmm|hit|gene|name", col_names, ignore.case = TRUE)][1]

          if (!is.na(start_col) && !is.na(end_col)) {
            df_g_clean <- df_g %>%
              transmute(
                Locus_ID = loc_id,
                Start    = as.numeric(.data[[start_col]]),
                End      = as.numeric(.data[[end_col]]),
                Strand   = if (!is.na(strand_col)) as.character(.data[[strand_col]]) else "1",
                Gene     = if (!is.na(gene_col)) as.character(.data[[gene_col]]) else "Unknown"
              )
            genes_data_list[[loc_id]] <- df_g_clean
          } else {
            log_msg(paste0("Locus ", loc_id, " genes.tab missing Start/End coordinate columns. Skipping for Plot 1."), level = "WARN")
          }
        }
      } else {
        log_msg(paste0("Locus ", loc_id, " is ", locus_class[loc_id], " but lacks genes.tab. Skipping for Plot 1."), level = "WARN")
      }
    }
  }

  # Log locus classification counts
  count_val <- sum(locus_class == "validated")
  count_put <- sum(locus_class == "putative_only")
  count_arr <- sum(locus_class == "array_only")
  
  log_msg(paste0("Locus classification counts — Validated: ", count_val,
                 ", Putative-only: ", count_put,
                 ", Array-only: ", count_arr))

  # Early exit check if ZERO operons detected across whole sample
  if ((count_val + count_put) == 0) {
    log_msg("No CRISPR-Cas operons detected for this sample", level = "INFO")
    log_msg("Skipping plot generation. Executing normal clean exit.")
    quit(status = 0)
  }

  # ----------------------------------------------------------------------------
  # PLOT 1: Per-locus gene-map (synteny) diagram
  # ----------------------------------------------------------------------------
  log_msg("Starting PLOT 1 generation (synteny gene-map)...")
  
  if (length(genes_data_list) > 0) {
    df_genes <- bind_rows(genes_data_list)
    
    # Derive Module column safely using unanchored matching
    df_genes <- df_genes %>%
      mutate(
        gene_lower = tolower(Gene),
        Module = case_when(
          grepl("crispr|array|repeat", gene_lower) ~ "CRISPR array",
          grepl(cas_module_patterns[["Adaptation"]], gene_lower) ~ "Adaptation",
          grepl(cas_module_patterns[["Interference"]], gene_lower) ~ "Interference",
          grepl(cas_module_patterns[["Cas6"]], gene_lower) ~ "Cas6",
          TRUE ~ "Unknown"
        ),
        # Direction for gggenes arrow (-1, 1, or 0 for array block)
        Direction = case_when(
          Module == "CRISPR array" ~ 0,
          Strand %in% c("-", "-1", "reverse") ~ -1,
          TRUE ~ 1
        ),
        Module = factor(Module, levels = names(cctyper_module_palette))
      )

    unique_loci <- unique(df_genes$Locus_ID)
    total_loci <- length(unique_loci)
    loci_per_page <- 12
    total_pages <- ceiling(total_loci / loci_per_page)
    
    log_msg(paste0("Plot 1: Rendering ", total_loci, " locus synteny maps across ", total_pages, " page(s)."))

    for (pg in seq_len(total_pages)) {
      start_idx <- (pg - 1) * loci_per_page + 1
      end_idx   <- min(pg * loci_per_page, total_loci)
      page_loci <- unique_loci[start_idx:end_idx]
      
      df_page <- df_genes %>% filter(Locus_ID %in% page_loci)
      
      # Subtitle per Global Standard D
      subtitle_text <- paste0("Sample ID: ", sample_id, " | Loci displayed: ", start_idx, "-", end_idx, " of ", total_loci)
      
      # Build plot
      p1 <- ggplot(df_page, aes(xmin = Start, xmax = End, y = Locus_ID, fill = Module)) +
        geom_gene_arrow(aes(forward = Direction == 1),
                        arrowhead_height = unit(4, "mm"),
                        arrowhead_width  = unit(3, "mm"),
                        size = 0.5) +
        facet_wrap(~ Locus_ID, ncol = 1, scales = "free") +
        scale_fill_manual(values = cctyper_module_palette, drop = FALSE) +
        labs(
          title = "CRISPR-Cas Genomic Synteny Map",
          subtitle = subtitle_text,
          x = "Contig Coordinate (bp)",
          y = "Locus Identifier",
          fill = "Module"
        ) +
        pub_theme +
        theme(
          axis.text.y = element_blank(),
          axis.ticks.y = element_blank(),
          legend.position = "bottom"
        )
      
      base_filename <- paste0(sample_id, "_CCTyper_genemap_page", pg)
      svg_path <- file.path(output_dir, paste0(base_filename, ".svg"))
      pdf_path <- file.path(output_dir, paste0(base_filename, ".pdf"))
      
      ggsave(svg_path, plot = p1, width = 10, height = min(11, 3 + 0.6 * length(page_loci)), units = "in", dpi = 300)
      ggsave(pdf_path, plot = p1, width = 10, height = min(11, 3 + 0.6 * length(page_loci)), units = "in", dpi = 300)
      
      log_msg(paste0("Saved Plot 1 page ", pg, " -> ", svg_path))
      log_msg(paste0("Saved Plot 1 page ", pg, " -> ", pdf_path))
    }
  } else {
    log_msg("No loci contained a valid genes.tab file. Skipping PLOT 1.", level = "WARN")
  }

  # ----------------------------------------------------------------------------
  # PLOT 2: Sample-wide CRISPR-Cas subtype distribution
  # ----------------------------------------------------------------------------
  log_msg("Starting PLOT 2 generation (subtype distribution)...")
  
  df_operons <- bind_rows(operon_data_list)
  
  if (nrow(df_operons) > 0) {
    # Aggregate data and flag low confidence (<0.75 per spec)
    df_plot2 <- df_operons %>%
      mutate(
        Prediction = ifelse(is.na(Prediction) | Prediction == "", "Unspecified", Prediction),
        Confidence_Class = ifelse(Probability < 0.75, "Uncertain (P < 0.75)", "Confident (P >= 0.75)"),
        Status = factor(Status, levels = c("Validated", "Putative-only"))
      )
    
    total_operon_loci <- length(unique(df_plot2$Locus_ID))
    subtitle_text2 <- paste0("Sample ID: ", sample_id, " | Total operons analyzed: ", total_operon_loci)
    
    # Subtype status fill palette
    status_palette <- c("Validated" = "#2c3e50", "Putative-only" = "#e67e22")
    alpha_map      <- c("Confident (P >= 0.75)" = 1.0, "Uncertain (P < 0.75)" = 0.4)
    
    p2 <- ggplot(df_plot2, aes(x = Prediction, fill = Status, alpha = Confidence_Class)) +
      geom_bar(stat = "count", position = position_stack(reverse = TRUE), color = "black", linewidth = 0.3) +
      coord_flip() +
      scale_fill_manual(values = status_palette) +
      scale_alpha_manual(values = alpha_map) +
      labs(
        title = "CRISPR-Cas Subtype Distribution",
        subtitle = subtitle_text2,
        x = "Subtype Prediction",
        y = "Locus Count",
        fill = "Locus Status",
        alpha = "Call Confidence"
      ) +
      pub_theme +
      theme(
        legend.position = "right",
        panel.grid.major.y = element_blank()
      )
    
    base_filename2 <- paste0(sample_id, "_CCTyper_subtype_distribution")
    svg_path2 <- file.path(output_dir, paste0(base_filename2, ".svg"))
    pdf_path2 <- file.path(output_dir, paste0(base_filename2, ".pdf"))
    
    ggsave(svg_path2, plot = p2, width = 10, height = 7, units = "in", dpi = 300)
    ggsave(pdf_path2, plot = p2, width = 10, height = 7, units = "in", dpi = 300)
    
    log_msg(paste0("Saved Plot 2 -> ", svg_path2))
    log_msg(paste0("Saved Plot 2 -> ", pdf_path2))
  } else {
    log_msg("No operon data available to generate PLOT 2.", level = "WARN")
  }

  # ----------------------------------------------------------------------------
  # 5. REPRODUCIBILITY SUMMARY & EXIT
  # ----------------------------------------------------------------------------
  log_msg("Writing R sessionInfo summary to log for reproducibility audit.")
  cat("====================================================================\n", file = log_file, append = TRUE)
  cat("SESSION INFO AUDIT SUMMARY:\n", file = log_file, append = TRUE)
  capture.output(sessionInfo(), file = log_file, append = TRUE)
  cat("====================================================================\n", file = log_file, append = TRUE)

  log_msg("cctyper_plots.R completed successfully.")
  quit(status = 0)

}, error = function(e) {
  # Defensive global error catcher (Global Standard B)
  log_msg(paste0("FATAL ERROR: ", conditionMessage(e)), level = "CRITICAL")
  log_msg(paste0("Error occurred around call: ", deparse(conditionCall(e))), level = "CRITICAL")
  quit(status = 1)
})
