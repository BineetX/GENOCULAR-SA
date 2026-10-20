#!/usr/bin/env python3

import pandas as pd
import numpy as np
import json
from pathlib import Path
import warnings

warnings.filterwarnings('ignore')

# ==================================================
# CONFIGURATION
# ==================================================
INPUT_FILE  = "interproscan_results.tsv"
OUTDIR      = "."

COLUMNS = [
    "protein_id", "md5", "seq_length", "database", "accession",
    "description", "start", "end", "evalue", "status", "date",
    "ipr_accession", "ipr_description", "go_terms"
]

def generate_interpro_jsons(input_file=INPUT_FILE, outdir=OUTDIR):
    input_path = Path(input_file)
    outdir_path = Path(outdir)
    outdir_path.mkdir(parents=True, exist_ok=True)
    
    if not input_path.exists():
        print(f"File not found: {input_file}")
        return

    print(f"Loading {input_file} ...")
    df = pd.read_csv(input_path, sep="\t", header=None, names=COLUMNS, low_memory=False)
    
    df["seq_length"] = pd.to_numeric(df["seq_length"], errors="coerce")
    df["start"]      = pd.to_numeric(df["start"],      errors="coerce")
    df["end"]        = pd.to_numeric(df["end"],        errors="coerce")
    df["evalue"]     = pd.to_numeric(df["evalue"],     errors="coerce")
    df_sig = df[df["status"] == "T"].copy()

    print(f"  Total hits: {len(df):,}")
    print(f"  Significant: {len(df_sig):,} (status='T')")

    df_ipr = df_sig[df_sig["ipr_accession"].notna() & (df_sig["ipr_accession"] != "-")].copy()

    # ==================================================
    # 1. DATABASE DISTRIBUTION (Bar Chart)
    # ==================================================
    db_counts = df_sig["database"].value_counts()
    
    payload_db = {
        "metadata": {"input": input_file, "total_significant_hits": len(df_sig)},
        "data": [{
            "x": db_counts.index.tolist(),
            "y": db_counts.values.tolist(),
            "type": "bar"
        }],
        "layout": {
            "title": "Database Distribution",
            "xaxis": {"title": "Database"},
            "yaxis": {"title": "Number of Hits"}
        }
    }
    with open(outdir_path / "interproscan_db_distribution.json", "w") as f:
        json.dump(payload_db, f, indent=4)

    # ==================================================
    # 2. PROTEIN LENGTH DISTRIBUTION (Histogram)
    # ==================================================
    prot_len = df.drop_duplicates("protein_id")["seq_length"].dropna().astype(float).values
    hist_counts_len, bin_edges_len = np.histogram(prot_len, bins=50)
    bin_centers_len = (bin_edges_len[:-1] + bin_edges_len[1:]) / 2

    payload_len = {
        "metadata": {"input": input_file, "median_len": float(np.median(prot_len))},
        "data": [{
            "x": bin_centers_len.tolist(),
            "y": hist_counts_len.tolist(),
            "type": "bar"
        }],
        "layout": {
            "title": "Protein Length Distribution",
            "xaxis": {"title": "Protein Length (aa)"},
            "yaxis": {"title": "Count"}
        }
    }
    with open(outdir_path / "interproscan_protein_length.json", "w") as f:
        json.dump(payload_len, f, indent=4)

    # ==================================================
    # 3. TOP 20 IPR ENTRIES (Horizontal Bar Chart)
    # ==================================================
    top_ipr = df_ipr["ipr_description"].value_counts().head(20)
    
    payload_ipr = {
        "metadata": {"input": input_file},
        "data": [{
            "y": top_ipr.index.tolist(),
            "x": top_ipr.values.tolist(),
            "type": "bar",
            "orientation": "h"
        }],
        "layout": {
            "title": "Top 20 InterPro Entries",
            "xaxis": {"title": "Number of Proteins"},
            "yaxis": {"title": "InterPro Description"}
        }
    }
    with open(outdir_path / "interproscan_top_ipr.json", "w") as f:
        json.dump(payload_ipr, f, indent=4)

    # ==================================================
    # 4. E-VALUE DISTRIBUTION (Log10 Histogram)
    # ==================================================
    evals = df_sig["evalue"].dropna().astype(float)
    log_evals = np.log10(evals[evals > 0] + 1e-300).values
    hist_counts_eval, bin_edges_eval = np.histogram(log_evals, bins=60)
    bin_centers_eval = (bin_edges_eval[:-1] + bin_edges_eval[1:]) / 2

    payload_evalue = {
        "metadata": {"input": input_file},
        "data": [{
            "x": bin_centers_eval.tolist(),
            "y": hist_counts_eval.tolist(),
            "type": "bar"
        }],
        "layout": {
            "title": "E-value Distribution",
            "xaxis": {"title": "log10(E-value)"},
            "yaxis": {"title": "Count"}
        }
    }
    with open(outdir_path / "interproscan_evalue_dist.json", "w") as f:
        json.dump(payload_evalue, f, indent=4)

    # ==================================================
    # 5. PROTEIN DOMAIN ARCHITECTURE (Gantt-style JSON)
    # ==================================================
    # Find top 20 proteins with the most unique domains
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

    payload_arch = {
        "metadata": {
            "input": input_file,
            "description": "Domain architecture for top 20 multi-domain proteins."
        },
        "data": architecture_data,
        "layout": {
            "title": "Domain Architecture (Top 20 Multi-Domain Proteins)",
            "xaxis": {"title": "Amino Acid Position"},
            "yaxis": {"title": "Protein ID"}
        }
    }
    with open(outdir_path / "interproscan_architecture.json", "w") as f:
        json.dump(payload_arch, f, indent=4)

    print("\nSuccessfully generated JSON files:")
    print("  - interproscan_db_distribution.json")
    print("  - interproscan_protein_length.json")
    print("  - interproscan_top_ipr.json")
    print("  - interproscan_evalue_dist.json")
    print("  - interproscan_architecture.json")


if __name__ == "__main__":
    generate_interpro_jsons()
