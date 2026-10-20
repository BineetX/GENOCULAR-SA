#!/usr/bin/env python3
import argparse
import json
import logging
import os
import sys
import subprocess
import tempfile

def main():
    parser = argparse.ArgumentParser(description="Nonpareil JSON Generator")
    parser.add_argument("npo_file", help="Path to .npo file")
    parser.add_argument("output_dir", help="Output directory")
    parser.add_argument("sample_id", help="Sample ID")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    
    log_file = os.path.join(args.output_dir, f"{args.sample_id}_nonpareil_json.log")
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[logging.FileHandler(log_file), logging.StreamHandler(sys.stdout)]
    )
    
    logging.info(f"Started Nonpareil processing for {args.sample_id}")
    
    if not os.path.exists(args.npo_file):
        logging.error(f"Input file not found: {args.npo_file}")
        sys.exit(1)
        
    json_path = os.path.join(args.output_dir, f"{args.sample_id}_nonpareil_curve.json")
    
    r_code = f"""
    suppressPackageStartupMessages({{
      library(Nonpareil)
      library(jsonlite)
    }})
    
    np <- tryCatch({{
      Nonpareil.curve("{args.npo_file}", plot = FALSE, enforce.consistency = TRUE)
    }}, error = function(e) NULL)
    
    if (is.null(np)) {{
      write(toJSON(list(error = "Failed to run Nonpareil.curve")), "{json_path}")
      quit(status = 1)
    }}
    
    x_adj <- as.numeric(np@x.adj)
    y_cov <- as.numeric(np@y.cov)
    
    model_converged <- FALSE
    if (isTRUE(np@has.model) && !is.null(np@modelR) && !is.na(np@modelR) && !is.na(np@C) && !is.na(np@diversity) && !is.na(np@LRstar)) {{
      model_converged <- TRUE
    }}
    
    current_effort <- max(x_adj, na.rm = TRUE)
    
    fitted_x <- numeric(0)
    fitted_y <- numeric(0)
    
    if (model_converged) {{
      upper_bound <- max(max(x_adj, na.rm=TRUE), np@LRstar, na.rm=TRUE)
      fitted_x <- exp(seq(log(max(min(x_adj, na.rm=TRUE), 1e3)), log(upper_bound * 1.05), length.out = 300))
      pred <- NULL
      if (!is.null(np@model)) {{
        pred <- tryCatch(predict(np@model, newdata = data.frame(x = fitted_x)), error=function(e) NULL)
      }}
      if (is.null(pred)) {{
        pred <- tryCatch(predict(np, fitted_x), error=function(e) NULL)
      }}
      if (!is.null(pred)) {{
        fitted_y <- as.numeric(pred)
      }} else {{
        fitted_x <- numeric(0)
      }}
    }}
    
    out <- list(
      sample_id = "{args.sample_id}",
      model_converged = model_converged,
      current_effort = current_effort,
      metrics = list(
        C = if(model_converged) np@C else NA,
        diversity = if(model_converged) np@diversity else NA,
        LRstar = if(model_converged) np@LRstar else NA
      ),
      observed = data.frame(x = x_adj, y = y_cov),
      fitted = if(length(fitted_x) > 0) data.frame(x = fitted_x, y = fitted_y) else list()
    )
    
    write(toJSON(out, auto_unbox = TRUE, dataframe = "rows"), "{json_path}")
    """
    
    with tempfile.NamedTemporaryFile(mode='w', suffix='.R', delete=False) as f:
        f.write(r_code)
        temp_r = f.name
        
    try:
        subprocess.run(["Rscript", temp_r], check=True, capture_output=True, text=True)
        logging.info(f"Saved JSON data to {json_path}")
    except subprocess.CalledProcessError as e:
        logging.error(f"Rscript failed: {e.stderr}")
    finally:
        if os.path.exists(temp_r):
            os.remove(temp_r)
            
    logging.info("Completed successfully")

if __name__ == "__main__":
    main()
