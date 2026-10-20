#!/usr/bin/env python3
import argparse
import json
import logging
import os
import sys
import pandas as pd

def main():
    parser = argparse.ArgumentParser(description="Bracken JSON Generator")
    parser.add_argument("bracken_report", help="Path to bracken report (.bracken)")
    parser.add_argument("output_dir", help="Output directory")
    parser.add_argument("sample_id", help="Sample ID")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    
    log_file = os.path.join(args.output_dir, f"{args.sample_id}_bracken_json.log")
    logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s', handlers=[logging.FileHandler(log_file), logging.StreamHandler(sys.stdout)])
    
    logging.info(f"Started Bracken processing for {args.sample_id}")
    
    if not os.path.exists(args.bracken_report):
        logging.error(f"File not found: {args.bracken_report}")
        sys.exit(1)
        
    df = pd.read_csv(args.bracken_report, sep="\t")
    
    # We expect columns: name, taxonomy_id, taxonomy_lvl, kraken_assigned_reads, added_reads, new_est_reads, fraction_total_reads
    if "name" not in df.columns or "fraction_total_reads" not in df.columns:
        logging.error("Invalid Bracken report format.")
        sys.exit(1)
        
    df = df.sort_values(by="fraction_total_reads", ascending=False)
    
    labels = []
    parents = []
    values = []
    
    labels.append("Community")
    parents.append("")
    values.append(1.0) # Root node value
    
    total_fraction = 0.0
    for _, row in df.iterrows():
        frac = row["fraction_total_reads"]
        if frac >= 0.01:  # Only species >= 1% abundance
            labels.append(row["name"])
            parents.append("Community")
            values.append(frac)
            total_fraction += frac
            
    other_fraction = 1.0 - total_fraction
    if other_fraction > 0.005:
        labels.append("Other (<1%)")
        parents.append("Community")
        values.append(other_fraction)
        
    payload = {
        "sample_id": args.sample_id,
        "sunburst": {
            "labels": labels,
            "parents": parents,
            "values": values
        }
    }
    
    json_path = os.path.join(args.output_dir, f"{args.sample_id}_bracken_abundance.json")
    with open(json_path, "w") as f:
        json.dump(payload, f, indent=2)
        
    logging.info(f"Saved JSON data to {json_path}")

if __name__ == "__main__":
    main()
