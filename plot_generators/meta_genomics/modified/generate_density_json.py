#!/usr/bin/env python3
import argparse
import json
import logging
import os
import sys
import pandas as pd
import numpy as np
import re
from scipy.stats import gaussian_kde

CONTIG_PATTERNS = [r"^contigName$", r"^contig$", r"^contig_id$", r"^name$", r"^#rname$", r"^rname$"]
DEPTH_PATTERNS = [r"^totalAvgDepth$", r"^avg[_ ]?depth$", r"^meandepth$", r"\bmean$", r"\bmean[_ ]?depth\b", r"\bcoverage$", r"^depth$"]

def detect_column(cols, patterns):
    for pat in patterns:
        for c in cols:
            if re.search(pat, c, re.IGNORECASE):
                return c
    return None

def main():
    parser = argparse.ArgumentParser(description="Coverage Density JSON Generator")
    parser.add_argument("depth_txt", help="Path to depth table")
    parser.add_argument("output_dir", help="Output directory")
    parser.add_argument("sample_id", help="Sample ID")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    
    log_file = os.path.join(args.output_dir, f"{args.sample_id}_density_json.log")
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[logging.FileHandler(log_file), logging.StreamHandler(sys.stdout)]
    )
    
    logging.info(f"Started density processing for {args.sample_id}")
    
    if not os.path.exists(args.depth_txt):
        logging.error(f"Input file not found: {args.depth_txt}")
        sys.exit(1)
        
    df = pd.read_csv(args.depth_txt, sep='\t')
    
    contig_col = detect_column(df.columns, CONTIG_PATTERNS)
    depth_col = detect_column(df.columns, DEPTH_PATTERNS)
    
    if not contig_col or not depth_col:
        logging.error(f"Could not auto-detect columns. Available: {list(df.columns)}")
        sys.exit(1)
        
    df['totalAvgDepth'] = pd.to_numeric(df[depth_col], errors='coerce')
    df = df.dropna(subset=['totalAvgDepth'])
    
    if len(df) == 0:
        logging.error("No valid depth rows remaining.")
        sys.exit(1)
        
    log10_depth = np.log10(df['totalAvgDepth'] + 1)
    
    n_contigs = len(df)
    
    plot_data = []
    if n_contigs > 1 and np.std(log10_depth) > 0:
        try:
            kde = gaussian_kde(log10_depth, bw_method='scott')
            x_vals = np.linspace(0, max(5, np.ceil(np.max(log10_depth))), 500)
            y_vals = kde(x_vals)
            for x, y in zip(x_vals, y_vals):
                plot_data.append({"x": float(x), "y": float(y)})
        except Exception as e:
            logging.warning(f"KDE failed: {e}")
    
    payload = {
        "sample_id": args.sample_id,
        "summary": {
            "total_contigs": int(n_contigs)
        },
        "plot_data": plot_data
    }
    
    json_path = os.path.join(args.output_dir, f"{args.sample_id}_mapping_coverage_density.json")
    with open(json_path, 'w') as f:
        json.dump(payload, f, indent=2)
        
    logging.info(f"Saved JSON data to {json_path}")
    logging.info("Completed successfully")

if __name__ == "__main__":
    main()
