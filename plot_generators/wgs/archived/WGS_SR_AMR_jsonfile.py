#!/usr/bin/env python3
"""
AMR Summary JSON Generator for Abricate outputs.
Processes 5 CSV files from the current directory and exports a structured JSON file
for Next.js / D3.js frontend visualization.

Usage:
    python3 WGS_SR_AMR_jsonfile.py
"""

import os
import json
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

def load(fname):
    if not os.path.exists(fname):
        print(f"  [skip] {fname} not found in current folder")
        return None
    try:
        df = pd.read_csv(fname, sep="\t")
        if len(df.columns) < 2:
            df = pd.read_csv(fname, sep=",")
        df.columns = [c.strip().lstrip("#") for c in df.columns]
        return df
    except Exception as e:
        print(f"  [error] reading {fname}: {e}")
        return None

def split_classes(series):
    """Split ';'-delimited resistance-class strings into a flat Counter."""
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

def generate_amr_json(outdir="."):
    outdir_path = Path(outdir)
    outdir_path.mkdir(parents=True, exist_ok=True)

    print("Reading abricate tables from current directory...")
    data = {name: load(fname) for name, fname in FILES.items()}

    # 1. Panel A Data: Hits per database
    counts = {name: (len(df) if df is not None else 0) for name, df in data.items()}
    names = list(counts.keys())
    vals = [counts[n] for n in names]

    # 2. Panel B Data: Top resistance drug classes
    class_counter = Counter()
    for key in ("CARD", "NCBI", "ResFinder"):
        df = data.get(key)
        if df is not None and "RESISTANCE" in df.columns:
            class_counter.update(split_classes(df["RESISTANCE"]))
    top_classes = class_counter.most_common(10)
    class_labels = [x[0] for x in top_classes]
    class_vals = [x[1] for x in top_classes]

    # 3. Panels C Data: Unique genes detected per database
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
        "metadata": {
            "description": "Consolidated Antimicrobial Resistance (AMR) and Virulence summary from Abricate outputs."
        },
        "hits_per_database": {
            "data": [{
                "x": names,
                "y": vals,
                "type": "bar",
                "marker": {"color": ["#E64B35", "#4DBBD5", "#00A087", "#3C5488", "#F39B7F"]}
            }],
            "layout": {
                "title": "Hits per Database",
                "xaxis": {"title": "Database"},
                "yaxis": {"title": "Number of Hits"}
            }
        },
        "top_resistance_classes": {
            "data": [{
                "x": class_vals,
                "y": class_labels,
                "type": "bar",
                "orientation": "h",
                "marker": {"color": "#4DBBD5"}
            }],
            "layout": {
                "title": "Top Resistance Classes",
                "xaxis": {"title": "Gene Count"},
                "yaxis": {"title": "Resistance Class"}
            }
        },
        "database_gene_tables": db_genes
    }

    out_json = outdir_path / "amr_summary.json"
    with open(out_json, "w") as f:
        json.dump(payload, f, indent=4)

    print(f"Successfully generated: {out_json}")

if __name__ == "__main__":
    generate_amr_json()
