#!/usr/bin/env python3
import argparse
import json
import logging
import os
import sys
import re
import glob
from pathlib import Path
import pandas as pd
import numpy as np
import warnings

warnings.filterwarnings("ignore")

def simplify_class(x):
    x = str(x)
    if "Simple_repeat" in x:
        return "Simple repeats"
    elif "Low_complexity" in x:
        return "Low complexity"
    elif "Satellite" in x:
        return "Satellite"
    elif "LTR" in x:
        return "LTR"
    elif "LINE" in x:
        return "LINE"
    elif "SINE" in x:
        return "SINE"
    elif "DNA" in x:
        return "DNA"
    else:
        return "Other"

def main():
    parser = argparse.ArgumentParser(description="RepeatMasker JSON Generator for WGS")
    parser.add_argument("input_dir", help="Directory containing RepeatMasker .out and .tbl files")
    parser.add_argument("output_dir", help="Output directory")
    parser.add_argument("sample_id", help="Sample ID")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    
    log_file = os.path.join(args.output_dir, f"{args.sample_id}_repeatmasker_json.log")
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[logging.FileHandler(log_file), logging.StreamHandler(sys.stdout)]
    )
    
    logging.info(f"Started RepeatMasker processing for {args.sample_id}")
    
    out_files = glob.glob(os.path.join(args.input_dir, "*.out"))
    tbl_files = glob.glob(os.path.join(args.input_dir, "*.tbl"))
    
    if not out_files or not tbl_files:
        logging.error("Could not find RepeatMasker .out and .tbl files in input directory.")
        sys.exit(1)
        
    repeatmasker_out = Path(out_files[0])
    tbl_file = Path(tbl_files[0])
    
    genome_size = 0
    gc_content = 0.0
    masked_bp = 0
    masked_pct = 0.0

    with open(tbl_file) as f:
        for line in f:
            line = line.strip()
            if line.lower().startswith("total length:"):
                match = re.search(r'(\d+)\s+bp', line)
                if match:
                    genome_size = int(match.group(1))
            elif line.lower().startswith("gc level:"):
                match = re.search(r'([\d.]+)\s*%', line)
                if match:
                    gc_content = float(match.group(1))
            elif line.lower().startswith("bases masked:"):
                match = re.search(r'(\d+)\s+bp', line)
                if match:
                    masked_bp = int(match.group(1))
                match = re.search(r'\(\s*([\d.]+)\s*%\s*\)', line)
                if match:
                    masked_pct = float(match.group(1))

    data = []
    with open(repeatmasker_out) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("SW") or line.startswith("score"):
                continue
            parts = line.split()
            if len(parts) > 10:
                try:
                    divergence = float(parts[1])
                    repeat_class = parts[10]
                    data.append([divergence, repeat_class])
                except Exception:
                    continue

    df = pd.DataFrame(data, columns=["Divergence", "Class"])
    df["Group"] = df["Class"].apply(simplify_class)

    groups = ["DNA", "LINE", "LTR", "SINE", "Satellite", "Simple repeats", "Low complexity", "Other"]
    bins = np.arange(0, 51, 1)
    bin_centers = (bins[:-1] + bins[1:]) / 2

    chart_data = []
    for g in groups:
        subset = df[df["Group"] == g]["Divergence"].values
        if len(subset) > 0:
            hist_counts, _ = np.histogram(subset, bins=bins)
            chart_data.append({
                "group": g,
                "counts": hist_counts.tolist(),
            })
        else:
            chart_data.append({
                "group": g,
                "counts": [0] * len(bin_centers)
            })

    payload = {
        "sample_id": args.sample_id,
        "genome_size": genome_size,
        "gc_content": gc_content,
        "masked_bp": masked_bp,
        "masked_pct": masked_pct,
        "total_repeat_hits": int(len(df)),
        "divergence_bins": bin_centers.tolist(),
        "repeat_landscape": chart_data
    }

    json_path = os.path.join(args.output_dir, f"{args.sample_id}_repeatmasker_summary.json")
    with open(json_path, "w") as f:
        json.dump(payload, f, indent=2)
        
    logging.info(f"Saved JSON data to {json_path}")
    logging.info("Completed successfully")

if __name__ == "__main__":
    main()
