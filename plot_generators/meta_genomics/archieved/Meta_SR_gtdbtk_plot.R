#!/usr/bin/env Rscript
# krona_new.R
#
# Expected CLI argument order (positional, exactly 5 args):
#   1. BAC120_TSV   - path to gtdbtk.bac120.summary.tsv
#   2. AR53_TSV     - path to gtdbtk.ar53.summary.tsv (may be empty/header-only/missing)
#   3. OUTPUT_DIR   - directory to write html/txt/log outputs
#   4. SAMPLE_ID    - sample identifier string
#   5. KRONA_BIN_DIR - directory containing the ktImportText executable
#
# Invocation:
#   Rscript krona_new.R <BAC120_TSV> <AR53_TSV> <OUTPUT_DIR> <SAMPLE_ID> <KRONA_BIN_DIR>

suppressWarnings({
  args <- commandArgs(trailingOnly = TRUE)
})

# ---- basic arg validation (before logging is even set up) ----
if (length(args) != 5) {
  message(sprintf(
    "[FATAL] Expected exactly 5 positional arguments (BAC120_TSV, AR53_TSV, OUTPUT_DIR, SAMPLE_ID, KRONA_BIN_DIR), got %d.",
    length(args)
  ))
  quit(status = 1)
}

BAC120_TSV   <- args[1]
AR53_TSV     <- args[2]
OUTPUT_DIR   <- args[3]
SAMPLE_ID    <- args[4]
KRONA_BIN_DIR <- args[5]

# ---- logging setup ----
log_lines <- character(0)

log_msg <- function(level, ...) {
  ts <- format(Sys.time(), "%Y-%m-%d %H:%M:%S")
  line <- sprintf("[%s] [%s] %s", ts, level, paste0(..., collapse = ""))
  log_lines[[length(log_lines) + 1]] <<- line
  message(line)
}

# Ensure OUTPUT_DIR exists so we can at least attempt to write a log
if (!dir.exists(OUTPUT_DIR)) {
  ok <- tryCatch({
    dir.create(OUTPUT_DIR, recursive = TRUE)
    TRUE
  }, error = function(e) FALSE)
  if (!isTRUE(ok) || !dir.exists(OUTPUT_DIR)) {
    message(sprintf("[FATAL] OUTPUT_DIR '%s' does not exist and could not be created.", OUTPUT_DIR))
    quit(status = 1)
  }
}

log_file <- file.path(OUTPUT_DIR, paste0(SAMPLE_ID, "_gtdbtk_krona_run.log"))

flush_log <- function() {
  tryCatch({
    writeLines(log_lines, con = log_file)
  }, error = function(e) {
    message(sprintf("[WARN] Failed to write log file '%s': %s", log_file, conditionMessage(e)))
  })
}

exit_with_error <- function(msg) {
  log_msg("ERROR", msg)
  log_msg("INFO", "Script terminating with non-zero exit status.")
  log_msg("INFO", sprintf("Run end: %s", format(Sys.time(), "%Y-%m-%d %H:%M:%S")))
  flush_log()
  quit(status = 1)
}

log_msg("INFO", "Script: krona_new.R")
log_msg("INFO", sprintf("Run start: %s", format(Sys.time(), "%Y-%m-%d %H:%M:%S")))
log_msg("INFO", sprintf("Resolved BAC120_TSV: %s", BAC120_TSV))
log_msg("INFO", sprintf("Resolved AR53_TSV: %s", AR53_TSV))
log_msg("INFO", sprintf("Resolved OUTPUT_DIR: %s", OUTPUT_DIR))
log_msg("INFO", sprintf("Resolved SAMPLE_ID: %s", SAMPLE_ID))
log_msg("INFO", sprintf("Resolved KRONA_BIN_DIR: %s", KRONA_BIN_DIR))

# ---- dependency loading ----
required_pkgs <- c("dplyr", "tidyr", "readr", "stringr")
for (pkg in required_pkgs) {
  loaded <- suppressWarnings(suppressMessages(
    tryCatch({
      library(pkg, character.only = TRUE, quietly = TRUE)
      TRUE
    }, error = function(e) FALSE)
  ))
  if (!isTRUE(loaded)) {
    exit_with_error(sprintf(
      "Required package '%s' could not be loaded. Please ensure it is installed in the R environment.",
      pkg
    ))
  }
}
log_msg("INFO", sprintf("Successfully loaded required packages: %s", paste(required_pkgs, collapse = ", ")))

# ---- output paths ----
KRONA_HTML <- file.path(OUTPUT_DIR, paste0(SAMPLE_ID, "_gtdbtk_krona.html"))
KRONA_TXT  <- file.path(OUTPUT_DIR, paste0(SAMPLE_ID, "_gtdbtk_krona_input.txt"))

RANK_PREFIXES <- c("d__", "p__", "c__", "o__", "f__", "g__", "s__")

# Parse a GTDB-Tk classification string into the 7 rank columns.
# Blank segments stay blank (never placeholder text).
parse_classification <- function(classification) {
  ranks <- rep(NA_character_, 7)
  if (is.na(classification) || !nzchar(classification)) {
    return(as.list(rep("", 7)))
  }
  parts <- strsplit(classification, ";", fixed = TRUE)[[1]]
  for (part in parts) {
    part <- trimws(part)
    for (i in seq_along(RANK_PREFIXES)) {
      prefix <- RANK_PREFIXES[i]
      if (startsWith(part, prefix)) {
        val <- substring(part, nchar(prefix) + 1)
        ranks[i] <- val
      }
    }
  }
  ranks[is.na(ranks)] <- ""
  as.list(ranks)
}

# Read a GTDB-Tk summary TSV and return a data frame of parsed rank columns,
# or NULL (with logging) if file missing / has zero data rows.
read_gtdbtk_summary <- function(path, domain_label, file_label) {
  if (!file.exists(path)) {
    log_msg("INFO", sprintf(
      "%s file '%s' does not exist. Treating as zero %s MAGs (this is expected/normal, not an error).",
      file_label, path, domain_label
    ))
    return(NULL)
  }

  df <- tryCatch({
    readr::read_tsv(path, col_types = readr::cols(.default = readr::col_character()), progress = FALSE)
  }, error = function(e) {
    log_msg("INFO", sprintf(
      "%s file '%s' could not be parsed as TSV (%s). Treating as zero %s MAGs.",
      file_label, path, conditionMessage(e), domain_label
    ))
    NULL
  })

  if (is.null(df) || nrow(df) == 0) {
    log_msg("INFO", sprintf(
      "%s file '%s' has 0 data rows after header. Treating as zero %s MAGs (expected/normal condition).",
      file_label, path, domain_label
    ))
    return(NULL)
  }

  if (!("classification" %in% colnames(df)) || !("user_genome" %in% colnames(df))) {
    log_msg("INFO", sprintf(
      "%s file '%s' is missing required column(s) 'user_genome'/'classification'. Treating as zero %s MAGs.",
      file_label, path, domain_label
    ))
    return(NULL)
  }

  log_msg("INFO", sprintf("%s file '%s': read %d data row(s).", file_label, path, nrow(df)))
  df
}

build_rows_for_file <- function(df) {
  if (is.null(df)) return(NULL)
  rows <- vector("list", nrow(df))
  for (i in seq_len(nrow(df))) {
    ranks <- parse_classification(df$classification[i])
    rows[[i]] <- data.frame(
      count   = 1L,
      Domain  = ranks[[1]],
      Phylum  = ranks[[2]],
      Class   = ranks[[3]],
      Order   = ranks[[4]],
      Family  = ranks[[5]],
      Genus   = ranks[[6]],
      Species = ranks[[7]],
      stringsAsFactors = FALSE
    )
  }
  dplyr::bind_rows(rows)
}

result <- tryCatch({

  # --- BAC120: existence is mandatory ---
  if (!file.exists(BAC120_TSV)) {
    exit_with_error(sprintf("BAC120_TSV '%s' does not exist. This file is required.", BAC120_TSV))
  }

  bac_df <- read_gtdbtk_summary(BAC120_TSV, "Bacteria", "BAC120_TSV")
  ar_df  <- read_gtdbtk_summary(AR53_TSV, "Archaea", "AR53_TSV")

  bac_rows <- build_rows_for_file(bac_df)
  ar_rows  <- build_rows_for_file(ar_df)

  bac_n <- if (is.null(bac_rows)) 0L else nrow(bac_rows)
  ar_n  <- if (is.null(ar_rows)) 0L else nrow(ar_rows)

  log_msg("INFO", sprintf("Bacterial MAG rows parsed from BAC120_TSV: %d", bac_n))
  log_msg("INFO", sprintf("Archaeal MAG rows parsed from AR53_TSV: %d", ar_n))

  combined <- dplyr::bind_rows(bac_rows, ar_rows)

  if (nrow(combined) == 0) {
    log_msg("WARN", paste0(
      "Both BAC120_TSV and AR53_TSV yielded zero usable classification rows. ",
      "Producing a minimal placeholder Krona input so downstream QC still finds valid output files."
    ))
    combined <- data.frame(
      count = 1L, Domain = "", Phylum = "", Class = "", Order = "",
      Family = "", Genus = "", Species = "",
      stringsAsFactors = FALSE
    )
  }

  n_mags_written <- nrow(combined)
  log_msg("INFO", sprintf("Total MAG rows to be written to Krona input file: %d", n_mags_written))

  # --- write companion intermediate txt file (tab-separated, no header) ---
  tryCatch({
    readr::write_tsv(combined, KRONA_TXT, col_names = FALSE)
  }, error = function(e) {
    exit_with_error(sprintf("Failed to write Krona input file '%s': %s", KRONA_TXT, conditionMessage(e)))
  })
  log_msg("INFO", sprintf("Wrote Krona-format input file: %s", KRONA_TXT))

  # --- verify ktImportText binary ---
  ktimporttext_bin <- file.path(KRONA_BIN_DIR, "ktImportText")
  if (!file.exists(ktimporttext_bin)) {
    exit_with_error(sprintf(
      "ktImportText binary not found at expected path '%s' (constructed from KRONA_BIN_DIR='%s'). Check that KRONA_BIN_DIR points to a valid Krona bin directory.",
      ktimporttext_bin, KRONA_BIN_DIR
    ))
  }
  if (file.access(ktimporttext_bin, mode = 1) != 0) {
    exit_with_error(sprintf(
      "ktImportText binary at '%s' exists but is not executable. Check file permissions.",
      ktimporttext_bin
    ))
  }

  # --- clean Krona plot title ---
  # ktImportText uses a lightweight custom option parser that does NOT
  # accept GNU-style --flag=value long options (confirmed: it logs
  # "Unknown option: out"/"Unknown option: name" and exits 0 without
  # producing output). Use short -o/-n form. Also avoid ':' and '|' in the
  # title text, since Krona's positional-argument parser splits on ':' for
  # file:datasetName syntax and a stray ':' in the name value can cause it
  # to be misparsed downstream.
  krona_title <- paste0(SAMPLE_ID, "_GTDBtk_Taxonomic_Composition")
  krona_title <- gsub("[:|]", "_", krona_title)

  ktimporttext_args <- c(
    "-o", KRONA_HTML,
    "-n", krona_title,
    KRONA_TXT
  )

  log_msg("INFO", sprintf(
    "ktImportText command: %s %s",
    ktimporttext_bin,
    paste(shQuote(ktimporttext_args), collapse = " ")
  ))

  kt_output <- tryCatch({
    system2(
      command = ktimporttext_bin,
      args = ktimporttext_args,
      stdout = TRUE,
      stderr = TRUE
    )
  }, error = function(e) {
    exit_with_error(sprintf("system2() call to ktImportText failed to launch: %s", conditionMessage(e)))
  })

  kt_status <- attr(kt_output, "status")
  if (is.null(kt_status)) kt_status <- 0L

  log_msg("INFO", "ktImportText stdout/stderr (combined):")
  if (length(kt_output) == 0) {
    log_msg("INFO", "  <no output captured>")
  } else {
    for (ln in kt_output) log_msg("INFO", paste0("  ", ln))
  }
  log_msg("INFO", sprintf("ktImportText exit status: %d", kt_status))

  if (kt_status != 0) {
    exit_with_error(sprintf(
      "ktImportText exited with non-zero status %d. See captured output above for details.",
      kt_status
    ))
  }

  if (!file.exists(KRONA_HTML)) {
    exit_with_error(sprintf(
      "ktImportText reported success (exit status 0) but expected output HTML '%s' was not found.",
      KRONA_HTML
    ))
  }

  log_msg("INFO", sprintf("Successfully produced Krona HTML: %s", KRONA_HTML))

  # --- reproducibility / validation hook ---
  log_msg("INFO", "---- sessionInfo() ----")
  session_info_lines <- capture.output(print(sessionInfo()))
  for (ln in session_info_lines) log_msg("INFO", paste0("  ", ln))

  log_msg("INFO", "---- ktImportText version/help output ----")
  kt_help <- tryCatch({
    system2(
      command = ktimporttext_bin,
      args = character(0),
      stdout = TRUE,
      stderr = TRUE
    )
  }, error = function(e) {
    paste0("<could not retrieve ktImportText help/version output: ", conditionMessage(e), ">")
  })
  if (length(kt_help) == 0) {
    log_msg("INFO", "  <no help/version output captured>")
  } else {
    for (ln in kt_help) log_msg("INFO", paste0("  ", ln))
  }

  TRUE
}, error = function(e) {
  log_msg("ERROR", sprintf("Unhandled error during script execution: %s", conditionMessage(e)))
  FALSE
})

if (!isTRUE(result)) {
  log_msg("INFO", sprintf("Run end: %s", format(Sys.time(), "%Y-%m-%d %H:%M:%S")))
  flush_log()
  quit(status = 1)
}

log_msg("INFO", sprintf("Run end: %s", format(Sys.time(), "%Y-%m-%d %H:%M:%S")))
flush_log()
quit(status = 0)
