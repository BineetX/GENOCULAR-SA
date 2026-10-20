#!/usr/bin/env python3
import argparse
import json
import logging
import os
import sys
import re
from pathlib import Path
import pandas as pd
import warnings

warnings.filterwarnings("ignore")

def extract_family(h):
    if pd.isna(h): 
        return None
    h = re.sub(r"\(.*?\)", "", str(h))
    for p in h.split("+"):
        m = re.match(r"([A-Za-z]+[0-9]+)", p.strip())
        if m: 
            return m.group(1)
    return None

def classify(f):
    for pre, cls in [("GH","GH"),("GT","GT"),("PL","PL"),
                     ("CE","CE"),("AA","AA"),("CBM","CBM")]:
        if f.startswith(pre): 
            return cls
    return "Others"

def main():
    parser = argparse.ArgumentParser(description="CAZymes JSON Generator for WGS")
    parser.add_argument("overview_txt", help="Path to dbCAN overview.txt")
    parser.add_argument("output_dir", help="Output directory")
    parser.add_argument("sample_id", help="Sample ID")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    
    log_file = os.path.join(args.output_dir, f"{args.sample_id}_cazymes_json.log")
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[logging.FileHandler(log_file), logging.StreamHandler(sys.stdout)]
    )
    
    logging.info(f"Started CAZymes processing for {args.sample_id}")
    
    if not os.path.exists(args.overview_txt):
        logging.error(f"Input file not found: {args.overview_txt}")
        sys.exit(1)
        
    try:
        df = pd.read_csv(args.overview_txt, sep="\t")
    except Exception as e:
        logging.error(f"Error reading {args.overview_txt}: {e}")
        sys.exit(1)

    tools_col_candidates = [c for c in df.columns if "Tools" in c or "ofTools" in c]
    hmmer_col_candidates = [c for c in df.columns if "HMMER" in c]

    if not tools_col_candidates or not hmmer_col_candidates:
        logging.error("Required columns ('Tools' or 'HMMER') not found in overview.txt.")
        sys.exit(1)

    tools_col = tools_col_candidates[0]
    hmmer_col = hmmer_col_candidates[0]

    # Filter for hits supported by at least 2 tools
    df = df[df[tools_col] >= 2].copy()
    df["Family"] = df[hmmer_col].apply(extract_family)
    df = df.dropna(subset=["Family"])

    df["Class"] = df["Family"].apply(classify)
    class_counts = df["Class"].value_counts().to_dict()
    
    # Top 15 families
    family_counts = df["Family"].value_counts().head(15).to_dict()
    total_genes = int(len(df))

    payload = {
        "sample_id": args.sample_id,
        "total_cazyme_genes": total_genes,
        "class_counts": [{"class": k, "count": v} for k, v in class_counts.items()],
        "top_families": [{"family": k, "count": v} for k, v in family_counts.items()]
    }

    json_path = os.path.join(args.output_dir, f"{args.sample_id}_cazymes_summary.json")
    with open(json_path, "w") as f:
        json.dump(payload, f, indent=2)
        
    logging.info(f"Saved JSON data to {json_path}")
    logging.info("Completed successfully")

if __name__ == "__main__":
    main()
