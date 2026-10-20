#!/usr/bin/env python3
import argparse
import json
import logging
import os
import sys
import glob
import pandas as pd
import warnings

warnings.filterwarnings("ignore")

def load_summary(path):
    if not os.path.exists(path):
        return None
    try:
        df = pd.read_csv(path, sep="\t")
        df.columns = [c.strip().lstrip("#") for c in df.columns]
        return df
    except Exception as e:
        logging.error(f"Error reading {path}: {e}")
        return None

def main():
    parser = argparse.ArgumentParser(description="AMR JSON Generator for Metagenomics")
    parser.add_argument("input_dir", help="Directory containing abricate *_summary.tsv files")
    parser.add_argument("output_dir", help="Output directory")
    parser.add_argument("sample_id", help="Sample ID")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    
    log_file = os.path.join(args.output_dir, f"{args.sample_id}_amr_json.log")
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[logging.FileHandler(log_file), logging.StreamHandler(sys.stdout)]
    )
    
    logging.info(f"Started AMR processing for {args.sample_id}")
    
    summary_files = glob.glob(os.path.join(args.input_dir, "*_summary.tsv"))
    
    db_data = {}
    hits_per_database = []
    
    for path in summary_files:
        db_name = os.path.basename(path).replace("_summary.tsv", "")
        df = load_summary(path)
        if df is not None and not df.empty and "FILE" in df.columns and "NUM_FOUND" in df.columns:
            total_hits = int(df["NUM_FOUND"].sum())
            hits_per_database.append({"database": db_name, "hits": total_hits})
            
            # Prepare heatmap data
            mags = [os.path.basename(str(x)).replace(".fa", "").replace(".fasta", "") for x in df["FILE"].tolist()]
            genes = [c for c in df.columns if c not in ("FILE", "NUM_FOUND")]
            
            # Create a matrix where cell values are 1 if present (not ".") else 0
            matrix = []
            for _, row in df.iterrows():
                row_vals = []
                for g in genes:
                    val = str(row[g]).strip()
                    if val == "." or val == "NaN" or pd.isna(row[g]):
                        row_vals.append(0)
                    else:
                        row_vals.append(1)
                matrix.append(row_vals)
                
            db_data[db_name] = {
                "mags": mags,
                "genes": genes,
                "matrix": matrix
            }
            
    # Sort hits desc
    hits_per_database = sorted(hits_per_database, key=lambda x: x["hits"], reverse=True)
    
    payload = {
        "sample_id": args.sample_id,
        "hits_per_database": hits_per_database,
        "heatmap_data": db_data
    }
    
    json_path = os.path.join(args.output_dir, f"{args.sample_id}_amr_summary.json")
    with open(json_path, "w") as f:
        json.dump(payload, f, indent=2)
        
    logging.info(f"Saved JSON data to {json_path}")
    logging.info("Completed successfully")

if __name__ == "__main__":
    main()
