#!/usr/bin/env python3
import argparse
import json
import logging
import os
import sys
from pathlib import Path
from collections import Counter
import pandas as pd
import warnings

warnings.filterwarnings("ignore")

FILES = {
    "CARD": "abricate_card.csv",
    "NCBI": "abricate_ncbi.csv",
    "PlasmidFinder": "abricate_plasmidfinder.csv",
    "ResFinder": "abricate_resfinder.csv",
    "VFDB": "abricate_vfdb.csv",
}

def load(input_dir, fname):
    path = os.path.join(input_dir, fname)
    if not os.path.exists(path):
        return None
    try:
        df = pd.read_csv(path, sep="\t")
        if len(df.columns) < 2:
            df = pd.read_csv(path, sep=",")
        df.columns = [c.strip().lstrip("#") for c in df.columns]
        return df
    except Exception as e:
        logging.error(f"Error reading {path}: {e}")
        return None

def split_classes(series):
    counter = Counter()
    for val in series.dropna():
        val = str(val).strip()
        if not val or val == "-":
            continue
        for cls in val.split(";"):
            cls = cls.strip()
            if cls:
                counter[cls.capitalize()] += 1
    return counter

def main():
    parser = argparse.ArgumentParser(description="AMR JSON Generator for WGS")
    parser.add_argument("input_dir", help="Directory containing abricate_*.csv files")
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
    
    data = {name: load(args.input_dir, fname) for name, fname in FILES.items()}
    
    hits_per_database = [{"database": name, "hits": len(df) if df is not None else 0} for name, df in data.items()]
    
    class_counter = Counter()
    for key in ("CARD", "NCBI", "ResFinder"):
        df = data.get(key)
        if df is not None and "RESISTANCE" in df.columns:
            class_counter.update(split_classes(df["RESISTANCE"]))
            
    top_classes = [{"resistance_class": x[0], "count": x[1]} for x in class_counter.most_common(10)]
    
    db_genes = {}
    for key, df in data.items():
        genes = []
        if df is not None and "GENE" in df.columns:
            for g in df["GENE"].dropna():
                g = str(g).strip()
                if g and g not in genes:
                    genes.append(g)
        db_genes[key] = {
            "total": len(genes),
            "genes": genes
        }
        
    payload = {
        "sample_id": args.sample_id,
        "hits_per_database": hits_per_database,
        "top_resistance_classes": top_classes,
        "database_genes": db_genes
    }
    
    json_path = os.path.join(args.output_dir, f"{args.sample_id}_amr_summary.json")
    with open(json_path, "w") as f:
        json.dump(payload, f, indent=2)
        
    logging.info(f"Saved JSON data to {json_path}")
    logging.info("Completed successfully")

if __name__ == "__main__":
    main()
