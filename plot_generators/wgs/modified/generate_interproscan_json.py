#!/usr/bin/env python3
import argparse
import json
import logging
import os
import sys
import numpy as np
import pandas as pd
import warnings

warnings.filterwarnings('ignore')

COLUMNS = [
    "protein_id", "md5", "seq_length", "database", "accession",
    "description", "start", "end", "evalue", "status", "date",
    "ipr_accession", "ipr_description", "go_terms"
]

def main():
    parser = argparse.ArgumentParser(description="InterProScan JSON Generator")
    parser.add_argument("interproscan_tsv", help="Path to interproscan_results.tsv")
    parser.add_argument("output_dir", help="Output directory")
    parser.add_argument("sample_id", help="Sample ID")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    
    log_file = os.path.join(args.output_dir, f"{args.sample_id}_interproscan_json.log")
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[logging.FileHandler(log_file), logging.StreamHandler(sys.stdout)]
    )
    
    logging.info(f"Started InterProScan processing for {args.sample_id}")
    
    if not os.path.exists(args.interproscan_tsv):
        logging.error(f"Input file not found: {args.interproscan_tsv}")
        sys.exit(1)
        
    df = pd.read_csv(args.interproscan_tsv, sep="\t", header=None, names=COLUMNS, low_memory=False)
    
    df["seq_length"] = pd.to_numeric(df["seq_length"], errors="coerce")
    df["start"]      = pd.to_numeric(df["start"],      errors="coerce")
    df["end"]        = pd.to_numeric(df["end"],         errors="coerce")
    df["evalue"]     = pd.to_numeric(df["evalue"],      errors="coerce")
    df_sig = df[df["status"] == "T"].copy()
    
    df_ipr = df_sig[df_sig["ipr_accession"].notna() & (df_sig["ipr_accession"] != "-")].copy()
    
    db_counts = df_sig["database"].value_counts()
    
    prot_len = df.drop_duplicates("protein_id")["seq_length"].dropna().astype(float).values
    hist_counts_len, bin_edges_len = np.histogram(prot_len, bins=50) if len(prot_len) > 0 else ([], [])
    bin_centers_len = (bin_edges_len[:-1] + bin_edges_len[1:]) / 2 if len(bin_edges_len) > 0 else []
    
    top_ipr = df_ipr["ipr_description"].value_counts().head(20)
    
    evals = df_sig["evalue"].dropna().astype(float)
    log_evals = np.log10(evals[evals > 0] + 1e-300).values if len(evals) > 0 else []
    hist_counts_eval, bin_edges_eval = np.histogram(log_evals, bins=60) if len(log_evals) > 0 else ([], [])
    bin_centers_eval = (bin_edges_eval[:-1] + bin_edges_eval[1:]) / 2 if len(bin_edges_eval) > 0 else []
    
    top_prots = (df_sig.groupby("protein_id")["ipr_accession"]
                 .nunique().sort_values(ascending=False).head(20).index.tolist())
                 
    architecture_data = []
    for prot in top_prots:
        sub = df_sig[df_sig["protein_id"] == prot]
        plen = float(sub["seq_length"].iloc[0]) if not sub.empty else 500.0
        
        domains = []
        for _, hit in sub.iterrows():
            desc = hit["ipr_description"] if hit["ipr_description"] not in (None, "-", float("nan")) else hit["description"]
            domains.append({
                "start": float(hit["start"]),
                "end": float(hit["end"]),
                "description": str(desc)
            })
            
        architecture_data.append({
            "protein_id": str(prot),
            "length": plen,
            "domains": domains
        })
        
    payload = {
        "sample_id": args.sample_id,
        "db_distribution": [{"database": k, "count": v} for k, v in db_counts.items()],
        "protein_length_distribution": {
            "counts": hist_counts_len.tolist() if len(hist_counts_len) > 0 else [],
            "bin_centers": bin_centers_len.tolist() if len(bin_centers_len) > 0 else []
        },
        "top_ipr_entries": [{"description": k, "count": v} for k, v in top_ipr.items()],
        "evalue_distribution": {
            "counts": hist_counts_eval.tolist() if len(hist_counts_eval) > 0 else [],
            "bin_centers": bin_centers_eval.tolist() if len(bin_centers_eval) > 0 else []
        },
        "domain_architecture": architecture_data
    }
    
    json_path = os.path.join(args.output_dir, f"{args.sample_id}_interproscan_summary.json")
    with open(json_path, "w") as f:
        json.dump(payload, f, indent=2)
        
    logging.info(f"Saved JSON data to {json_path}")
    logging.info("Completed successfully")

if __name__ == "__main__":
    main()
