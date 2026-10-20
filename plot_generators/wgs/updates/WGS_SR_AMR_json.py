#!/usr/bin/env python3

import os
import sys
import json
from collections import Counter
import pandas as pd
import warnings
warnings.filterwarnings('ignore')

# ---------------------------------------------------------
# Configuration
# ---------------------------------------------------------
OUTPUT_JSON = "amr_plots_data.json"
INPUT_DIR = sys.argv[1] if len(sys.argv) > 1 else "."
FILES = {
    "CARD": "abricate_card.csv",
    "NCBI": "abricate_ncbi.csv",
    "PlasmidFinder": "abricate_plasmidfinder.csv",
    "ResFinder": "abricate_resfinder.csv",
    "VFDB": "abricate_vfdb.csv",
}

def load(fname):
    fname = os.path.join(INPUT_DIR, fname)
    if not os.path.exists(fname):
        print(f"  [skip] {fname} not found in current folder")
        return None
    df = pd.read_csv(fname, sep="\t")
    df.columns = [c.strip().lstrip("#") for c in df.columns]
    return df

def split_classes(series):
    counter = Counter()
    for val in series.dropna():
        val = str(val).strip()
        if not val:
            continue
        for cls in val.split(";"):
            cls = cls.strip()
            if cls:
                counter[cls.capitalize()] += 1
    return counter

print("Reading abricate tables from current directory...")
data = {name: load(fname) for name, fname in FILES.items()}

output_data = {}

# ---------------------------------------------------------
# Plot 1: Hits per database
# ---------------------------------------------------------
counts = {name: (len(df) if df is not None else 0) for name, df in data.items()}
output_data["hits_per_db"] = {
    "x": list(counts.keys()),
    "y": list(counts.values())
}

# ---------------------------------------------------------
# Plot 2: Top resistance classes
# ---------------------------------------------------------
class_counter = Counter()
for key in ("CARD", "NCBI", "ResFinder"):
    df = data.get(key)
    if df is not None and "RESISTANCE" in df.columns:
        class_counter.update(split_classes(df["RESISTANCE"]))

top_classes = class_counter.most_common(10)
if top_classes:
    labels, counts_b = zip(*top_classes)
    output_data["top_classes"] = {
        "y": list(labels)[::-1],  # Reverse for horizontal bar chart
        "x": list(counts_b)[::-1]
    }
else:
    output_data["top_classes"] = None

# ---------------------------------------------------------
# Tables: AMR genes detected (CARD, NCBI, VFDB, ResFinder)
# ---------------------------------------------------------
def get_gene_table_data(df, max_n=10):
    genes = []
    if df is not None and "GENE" in df.columns:
        for g in df["GENE"].dropna():
            g = str(g).strip()
            if g and g not in genes:
                genes.append(g)
    
    total = len(genes)
    shown = genes[:max_n]
    return {
        "total": total,
        "shown": shown,
        "truncated": total > max_n,
        "remainder": total - max_n
    }

output_data["gene_tables"] = {
    "CARD": get_gene_table_data(data.get("CARD")),
    "NCBI": get_gene_table_data(data.get("NCBI")),
    "VFDB": get_gene_table_data(data.get("VFDB")),
    "ResFinder": get_gene_table_data(data.get("ResFinder"))
}

# ---------------------------------------------------------
# Export to JSON
# ---------------------------------------------------------
with open(OUTPUT_JSON, "w") as f:
    json.dump(output_data, f)

print(f"Success! Data exported to {OUTPUT_JSON}")
