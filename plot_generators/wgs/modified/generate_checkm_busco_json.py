#!/usr/bin/env python3
import argparse
import json
import logging
import os
import sys
import re
import pandas as pd

def parse_busco(busco_file):
    if not os.path.exists(busco_file):
        return None
        
    try:
        with open(busco_file, 'r') as f:
            text = f.read()
            
        m = re.search(
            r"C:(?P<C>\d+\.?\d*)%\[S:(?P<S>\d+\.?\d*)%,D:(?P<D>\d+\.?\d*)%\],F:(?P<F>\d+\.?\d*)%,M:(?P<M>\d+\.?\d*)%,n:(?P<n>\d+)",
            text
        )
        if not m:
            return None
            
        return {
            "complete": float(m.group("C")),
            "single": float(m.group("S")),
            "duplicated": float(m.group("D")),
            "fragmented": float(m.group("F")),
            "missing": float(m.group("M")),
            "total_buscos": int(m.group("n"))
        }
    except Exception as e:
        logging.error(f"Error parsing BUSCO: {e}")
        return None

def parse_checkm(checkm_file):
    if not os.path.exists(checkm_file):
        return None
        
    try:
        df = pd.read_csv(checkm_file, sep="\t")
        if df.empty:
            return None
            
        row = df.iloc[0]
        return {
            "bin_id": str(row.get("Bin Id", "")),
            "marker_lineage": str(row.get("Marker lineage", "")),
            "completeness": float(row.get("Completeness", 0)),
            "contamination": float(row.get("Contamination", 0)),
            "strain_heterogeneity": float(row.get("Strain heterogeneity", 0)),
            "genome_size_bp": int(row.get("Genome size (bp)", 0)),
            "gc_content": float(row.get("GC", 0)),
            "coding_density": float(row.get("Coding density", 0)),
            "num_contigs": int(row.get("# contigs", 0)),
            "n50": int(row.get("N50 (contigs)", row.get("N50 (scaffolds)", 0))),
            "predicted_genes": int(row.get("# predicted genes", 0))
        }
    except Exception as e:
        logging.error(f"Error parsing CheckM: {e}")
        return None

def main():
    parser = argparse.ArgumentParser(description="CheckM and BUSCO JSON Generator")
    parser.add_argument("checkm_txt", help="Path to checkm.txt")
    parser.add_argument("busco_txt", help="Path to BUSCO short_summary.txt")
    parser.add_argument("output_dir", help="Output directory")
    parser.add_argument("sample_id", help="Sample ID")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    
    log_file = os.path.join(args.output_dir, f"{args.sample_id}_checkm_busco_json.log")
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[logging.FileHandler(log_file), logging.StreamHandler(sys.stdout)]
    )
    
    logging.info(f"Started CheckM/BUSCO processing for {args.sample_id}")
    
    checkm_data = parse_checkm(args.checkm_txt)
    busco_data = parse_busco(args.busco_txt)
    
    payload = {
        "sample_id": args.sample_id,
        "checkm": checkm_data,
        "busco": busco_data
    }
    
    json_path = os.path.join(args.output_dir, f"{args.sample_id}_checkm_busco_summary.json")
    with open(json_path, "w") as f:
        json.dump(payload, f, indent=2)
        
    logging.info(f"Saved JSON data to {json_path}")
    logging.info("Completed successfully")

if __name__ == "__main__":
    main()
