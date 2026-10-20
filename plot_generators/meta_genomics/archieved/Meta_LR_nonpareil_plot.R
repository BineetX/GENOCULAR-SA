#!/usr/bin/env Rscript
# ==============================================================================
# nonpareil_coverage.R
#
# EXPECTED CLI ARGUMENT ORDER (positional, exactly as invoked by SLURM wrapper):
#   arg1 = NPO_FILE     : path to Nonpareil .npo redundancy table (single sample)
#   arg2 = OUTPUT_DIR   : path to directory where plots + log will be written
#   arg3 = SAMPLE_ID    : sample identifier string (used in filenames/subtitles)
#
# Example invocation:
#   Rscript nonpareil_coverage.R "/path/to/sample.npo" "/path/to/output_dir" "SAMPLE_01"
#
# Produces (in OUTPUT_DIR):
#   <SAMPLE_ID>_nonpareil_coverage_curve.svg
#   <SAMPLE_ID>_nonpareil_coverage_curve.pdf
#   <SAMPLE_ID>_Nonpareil_run.log
# ==============================================================================

## ---------------------------------------------------------------------------
## 0. ARGUMENT PARSING & VALIDATION
## ---------------------------------------------------------------------------
args <- commandArgs(trailingOnly = TRUE)

if (length(args) != 3) {
  message("ERROR: Expected exactly 3 arguments: NPO_FILE OUTPUT_DIR SAMPLE_ID")
  message("Usage: Rscript nonpareil_coverage.R <NPO_FILE> <OUTPUT_DIR> <SAMPLE_ID>")
  quit(status = 1)
}

NPO_FILE   <- args[1]
OUTPUT_DIR <- args[2]
SAMPLE_ID  <- args[3]

## Ensure output dir exists before we can even open a log file
if (!dir.exists(OUTPUT_DIR)) {
  ok <- tryCatch({
    dir.create(OUTPUT_DIR, recursive = TRUE)
    TRUE
  }, error = function(e) FALSE)
  if (!ok || !dir.exists(OUTPUT_DIR)) {
    message(sprintf("ERROR: OUTPUT_DIR '%s' does not exist and could not be created.", OUTPUT_DIR))
    quit(status = 1)
  }
}

LOG_FILE <- file.path(OUTPUT_DIR, paste0(SAMPLE_ID, "_Nonpareil_run.log"))

## ---------------------------------------------------------------------------
## 1. LOGGING HELPERS
## ---------------------------------------------------------------------------
log_con <- tryCatch(
  file(LOG_FILE, open = "a"),
  error = function(e) NULL
)

log_msg <- function(...) {
  msg <- sprintf("[%s] %s", format(Sys.time(), "%Y-%m-%d %H:%M:%S"), paste0(..., collapse = " "))
  cat(msg, "\n")
  if (!is.null(log_con)) {
    cat(msg, "\n", file = log_con, append = TRUE)
  }
}

log_msg("=== nonpareil_coverage.R started ===")
log_msg("Script: nonpareil_coverage.R")
log_msg(sprintf("Resolved NPO_FILE: %s", NPO_FILE))
log_msg(sprintf("Resolved OUTPUT_DIR: %s", OUTPUT_DIR))
log_msg(sprintf("SAMPLE_ID: %s", SAMPLE_ID))

## ---------------------------------------------------------------------------
## 2. SAFE PACKAGE LOADING
## ---------------------------------------------------------------------------
required_packages <- c("ggplot2", "dplyr", "tidyr", "readr", "Nonpareil")

load_package_safely <- function(pkg) {
  ok <- suppressWarnings(suppressMessages(
    requireNamespace(pkg, quietly = TRUE)
  ))
  if (!ok) {
    log_msg(sprintf("ERROR: Required package '%s' is not installed or failed to load.", pkg))
    return(FALSE)
  }
  attached <- tryCatch({
    suppressPackageStartupMessages(library(pkg, character.only = TRUE))
    TRUE
  }, error = function(e) {
    log_msg(sprintf("ERROR: Required package '%s' failed to attach: %s", pkg, conditionMessage(e)))
    FALSE
  })
  return(attached)
}

missing_or_failed <- character(0)
for (pkg in required_packages) {
  if (!load_package_safely(pkg)) {
    missing_or_failed <- c(missing_or_failed, pkg)
  }
}

if (length(missing_or_failed) > 0) {
  log_msg(sprintf(
    "ERROR: The following required package(s) could not be loaded: %s. Halting script.",
    paste(missing_or_failed, collapse = ", ")
  ))
  log_msg("=== nonpareil_coverage.R terminated with errors ===")
  if (!is.null(log_con)) close(log_con)
  quit(status = 1)
}

log_msg("All required packages loaded successfully: ", paste(required_packages, collapse = ", "))

## ---------------------------------------------------------------------------
## 3. GLOBAL TYPOGRAPHY THEME (apply to every plot)
## ---------------------------------------------------------------------------
pub_theme <- theme_bw(base_size = 14) +
  theme(
    plot.title       = element_text(size = 18, color = "black", face = "bold"),
    plot.subtitle    = element_text(size = 13, color = "black", face = "bold"),
    legend.text      = element_text(size = 12, color = "black", face = "bold"),
    legend.title     = element_text(size = 12, color = "black", face = "bold"),
    axis.text        = element_text(size = 14, color = "black", face = "bold"),
    axis.title       = element_text(size = 16, color = "black", face = "bold"),
    # No background grid lines of any kind.
    panel.grid.major = element_blank(),
    panel.grid.minor = element_blank(),
    # Visible black axis bar lines and tick marks on both axes.
    panel.border     = element_blank(),
    axis.line        = element_line(color = "black", linewidth = 0.6),
    axis.ticks       = element_line(color = "black", linewidth = 0.6)
  )

## ---------------------------------------------------------------------------
## 4. COLOR PALETTE (Okabe-Ito inspired, colorblind-safe)
## ---------------------------------------------------------------------------
COL_OBSERVED   <- "grey55"       # observed rarefied redundancy points
COL_MODEL      <- "#0072B2"      # fitted sigmoidal model curve (dark blue)
COL_CURRENT    <- "#D55E00"      # current sequencing effort vertical line (vermillion)
COL_PROJECTION <- "#009E73"      # 95% LRstar projection (bluish green)

## ---------------------------------------------------------------------------
## 5. MAIN LOGIC (wrapped in tryCatch)
## ---------------------------------------------------------------------------
main <- function() {

  ## -- 5.1 Input validation ---------------------------------------------
  if (!file.exists(NPO_FILE)) {
    stop(sprintf("Input NPO_FILE does not exist or is not readable: %s", NPO_FILE))
  }
  log_msg(sprintf("Confirmed NPO_FILE exists: %s", NPO_FILE))

  ## -- 5.2 Run Nonpareil.curve() (single-sample only) ---------------------
  log_msg("Step: Running Nonpareil.curve() on the .npo file (enforce.consistency = TRUE)...")

  np <- tryCatch({
    # Suppress the base-R plotting device; we only need the returned object
    grDevices::pdf(file = NULL)
    on.exit(try(grDevices::dev.off(), silent = TRUE), add = TRUE)
    Nonpareil::Nonpareil.curve(
      NPO_FILE,
      plot = FALSE,
      enforce.consistency = TRUE
    )
  }, error = function(e) {
    log_msg(sprintf("ERROR while running Nonpareil.curve(): %s", conditionMessage(e)))
    NULL
  })

  if (is.null(np)) {
    stop("Nonpareil.curve() failed to return a valid object. Cannot proceed with plotting.")
  }
  log_msg("Nonpareil.curve() completed. Extracting model data.")

  ## -- 5.3 Extract core coordinates & metrics -----------------------------
  ## NOTE: Nonpareil.Curve is an S4 object -> use @slot access, not $name.
  ## IMPORTANT: the fitted nls model (np@model) is fit on x.adj (the
  ## consistency-adjusted sequencing effort), NOT x.obs (raw observed effort).
  ## Confirmed empirically: formula is y ~ Nonpareil.f(x, a, b), and plotting
  ## observed points against x.obs while predicting against x.adj produced a
  ## curve that did not track the data (two orders of magnitude off). Both
  ## slots are length-matched to y.cov (one row per rarefaction sample), so we
  ## consistently use x.adj for both the observed points AND the model curve.
  x_vals <- tryCatch(np@x.adj, error = function(e) NULL)
  y_vals <- tryCatch(np@y.cov, error = function(e) NULL)
  x_vals_raw <- tryCatch(np@x.obs, error = function(e) NULL)  # kept for reference/logging only

  if (is.null(x_vals) || is.null(y_vals) || length(x_vals) == 0 || length(y_vals) == 0) {
    stop("Nonpareil object does not contain usable x/y redundancy coordinates (np@x.adj / np@y.cov).")
  }
  log_msg(sprintf("Extracted %d observed redundancy data points (np@x.adj, np@y.cov).", length(x_vals)))

  observed_df <- data.frame(x = x_vals, y = y_vals)

  ## -- 5.4 Determine model convergence -------------------------------------
  has_model_flag <- tryCatch(np@has.model, error = function(e) FALSE)
  model_r <- tryCatch(np@modelR, error = function(e) NA)
  C_val         <- tryCatch(np@C, error = function(e) NA)
  diversity_val <- tryCatch(np@diversity, error = function(e) NA)
  LRstar_val    <- tryCatch(np@LRstar, error = function(e) NA)

  model_converged <- isTRUE(has_model_flag) &&
                      !is.null(model_r) && !is.na(model_r) &&
                      is.numeric(model_r) && length(model_r) == 1 &&
                      !is.na(C_val) && !is.na(diversity_val) && !is.na(LRstar_val)

  if (!model_converged) {
    log_msg("WARNING: Sigmoidal model fitting did not converge (np$modelR invalid/NA), ",
            "or one or more of C / diversity / LRstar is NA. LRstar and diversity could ",
            "not be reliably estimated for this sample. Proceeding with observed data ",
            "points only; fitted curve and projection lines will be omitted.")
  } else {
    log_msg(sprintf(
      "Model converged. C = %.4f | Diversity (Nd) = %.4f | LRstar = %.4e bp",
      C_val, diversity_val, LRstar_val
    ))
  }

  ## -- 5.5 Current sequencing effort (max observed x, adjusted scale) -----
  ## The vertical marker must be drawn on the same x scale as the plotted
  ## points/curve (x.adj), otherwise it will visually misalign with the data.
  current_effort_bp <- suppressWarnings(max(x_vals, na.rm = TRUE))
  current_effort_bp_raw <- suppressWarnings(max(x_vals_raw, na.rm = TRUE))
  if (!is.finite(current_effort_bp)) {
    log_msg("WARNING: Could not determine current sequencing effort from np@x.adj; skipping current-effort marker.")
    current_effort_bp <- NA
  } else {
    log_msg(sprintf(
      "Current achieved sequencing effort: %.4e bp (raw, np@x.obs) | %.4e bp (consistency-adjusted, np@x.adj, used for plotting)",
      current_effort_bp_raw, current_effort_bp
    ))
  }

  ## -- 5.6 Build fitted model curve (only if converged) --------------------
  fitted_df <- NULL
  LRstar_gbp <- NA

  if (model_converged) {
    fitted_df <- tryCatch({
      x_range <- range(x_vals, na.rm = TRUE)
      # Extend the model curve a bit beyond current effort toward LRstar if available
      upper_bound <- max(x_range[2], LRstar_val, na.rm = TRUE)
      x_seq <- exp(seq(log(max(x_range[1], 1e3)), log(upper_bound * 1.05), length.out = 500))

      ## np@model holds the fitted nls model object (when has.model == TRUE).
      fitted_y <- NULL
      model_obj <- tryCatch(np@model, error = function(e) NULL)

      if (!is.null(model_obj)) {
        fitted_y <- tryCatch({
          predict(model_obj, newdata = data.frame(x = x_seq))
        }, error = function(e) NULL)
      }

      if (is.null(fitted_y)) {
        # Fallback: Nonpareil provides a predict method for its S4 curve objects.
        fitted_y <- tryCatch({
          predict(np, x_seq)
        }, error = function(e) NULL)
      }

      if (is.null(fitted_y)) {
        NULL
      } else {
        data.frame(x = x_seq, y = fitted_y)
      }
    }, error = function(e) {
      log_msg(sprintf("WARNING: Could not construct fitted model curve for plotting: %s", conditionMessage(e)))
      NULL
    })

    if (is.null(fitted_df)) {
      log_msg("WARNING: Fitted sigmoidal curve unavailable for plotting; will show observed points only, ",
              "but converged metrics (C, Nd, LRstar) will still be reported in the subtitle.")
    }

    LRstar_gbp <- LRstar_val / 1e9
  }

  ## -- 5.7 Compose subtitle (deliberate, deterministic — no raw dumps) -----
  if (model_converged) {
    subtitle_text <- paste0(
      "Sample ID: ", SAMPLE_ID,
      " | C = ", sprintf("%.3f", C_val),
      " | Nd = ", sprintf("%.3f", diversity_val),
      " | LRstar (95%) = ", sprintf("%.2f", LRstar_gbp), " Gbp"
    )
  } else {
    subtitle_text <- paste0(
      "Sample ID: ", SAMPLE_ID,
      " | Model did not converge: LRstar/diversity not estimable"
    )
  }
  log_msg(sprintf("Composed plot subtitle: '%s'", subtitle_text))

  ## -- 5.8 Build the ggplot ------------------------------------------------
  log_msg("Step: Building ggplot2 visualization.")

  p <- ggplot() +
    geom_point(
      data = observed_df,
      aes(x = x, y = y),
      color = COL_OBSERVED, alpha = 0.5, size = 1.6
    ) +
    scale_x_log10(labels = scales::label_number(scale_cut = scales::cut_short_scale())) +
    coord_cartesian(ylim = c(0, 1.02)) +
    labs(
      title = "Nonpareil Rarefaction & Sequencing Coverage Curve",
      subtitle = subtitle_text,
      x = "Sequencing effort (bp, consistency-adjusted, log10 scale)",
      y = "Estimated average coverage"
    ) +
    pub_theme

  if (model_converged && !is.null(fitted_df)) {
    p <- p +
      geom_line(
        data = fitted_df,
        aes(x = x, y = y),
        color = COL_MODEL, linewidth = 1.1
      ) +
      geom_hline(
        yintercept = 0.95,
        linetype = "dashed", color = COL_PROJECTION, linewidth = 0.7
      ) +
      geom_vline(
        xintercept = LRstar_val,
        linetype = "dashed", color = COL_PROJECTION, linewidth = 0.7
      ) +
      annotate(
        "point", x = LRstar_val, y = 0.95,
        shape = 8, size = 3.5, color = COL_PROJECTION, stroke = 1.2
      )
  }

  if (!is.na(current_effort_bp)) {
    p <- p +
      geom_vline(
        xintercept = current_effort_bp,
        linetype = "solid", color = COL_CURRENT, linewidth = 0.9, alpha = 0.8
      )
  }

  log_msg("ggplot2 object constructed successfully.")

  ## -- 5.9 Save plots (SVG + PDF) -------------------------------------------
  svg_path <- file.path(OUTPUT_DIR, paste0(SAMPLE_ID, "_nonpareil_coverage_curve.svg"))
  pdf_path <- file.path(OUTPUT_DIR, paste0(SAMPLE_ID, "_nonpareil_coverage_curve.pdf"))

  log_msg(sprintf("Step: Saving plot to %s", svg_path))
  ggsave(filename = svg_path, plot = p, width = 10, height = 7, units = "in", dpi = 300)

  log_msg(sprintf("Step: Saving plot to %s", pdf_path))
  ggsave(filename = pdf_path, plot = p, width = 10, height = 7, units = "in", dpi = 300)

  log_msg("Both SVG and PDF outputs saved successfully.")

  invisible(list(svg = svg_path, pdf = pdf_path, converged = model_converged))
}

## ---------------------------------------------------------------------------
## 6. EXECUTE MAIN WITH TOP-LEVEL ERROR HANDLING
## ---------------------------------------------------------------------------
result <- tryCatch({
  main()
}, error = function(e) {
  log_msg("ERROR: Script failed with the following error condition:")
  log_msg(sprintf("  Message: %s", conditionMessage(e)))
  log_msg(sprintf("  Call: %s", paste(deparse(conditionCall(e)), collapse = " ")))
  NULL
})

## ---------------------------------------------------------------------------
## 7. REPRODUCIBILITY / VALIDATION HOOK
## ---------------------------------------------------------------------------
log_msg("---- sessionInfo() for reproducibility ----")
session_lines <- capture.output(print(sessionInfo()))
for (line in session_lines) {
  log_msg(line)
}
log_msg("---- end sessionInfo() ----")

if (is.null(result)) {
  log_msg("=== nonpareil_coverage.R terminated with errors ===")
  if (!is.null(log_con)) close(log_con)
  quit(status = 1)
} else {
  log_msg("=== nonpareil_coverage.R completed successfully ===")
  if (!is.null(log_con)) close(log_con)
  quit(status = 0)
}
