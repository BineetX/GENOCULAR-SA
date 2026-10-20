#!/usr/bin/env python3

import pandas as pd
import numpy as np
import json
import re
import sys
import warnings
warnings.filterwarnings('ignore')

INPUT_FILE = sys.argv[1] if len(sys.argv) > 1 else "overview.txt"
OUTPUT_JSON = "cazyme_plots_data.json"

print(f"Parsing {INPUT_FILE}...")

try:
    df = pd.read_csv(INPUT_FILE, sep="\t")
except FileNotFoundError:
    print(f"Error: {INPUT_FILE} not found. Please ensure it is in the directory.")
    exit(1)

# Find relevant columns dynamically
tools_col = [c for c in df.columns if "Tools" in c or "ofTools" in c][0]
hmmer_col = [c for c in df.columns if "HMMER" in c][0]

# Filter for genes identified by at least 2 tools
df = df[df[tools_col] >= 2].copy()

def extract_family(h):
    if pd.isna(h): return None
    h = re.sub(r"\(.*?\)", "", str(h))
    for p in h.split("+"):
        m = re.match(r"([A-Za-z]+[0-9]+)", p.strip())
        if m: return m.group(1)
    return None

df["Family"] = df[hmmer_col].apply(extract_family)
df = df.dropna(subset=["Family"])

def classify(f):
    for pre, cls in [("GH","GH"), ("GT","GT"), ("PL","PL"), ("CE","CE"), ("AA","AA"), ("CBM","CBM")]:
        if f.startswith(pre): return cls
    return "Others"

df["Class"] = df["Family"].apply(classify)

# Calculate distributions
class_counts = df["Class"].value_counts()
family_counts = df["Family"].value_counts().head(15)
total = int(class_counts.sum())

CLASS_FULL = {
    "GH": "Glycoside Hydrolases",
    "GT": "Glycosyl Transferases",
    "PL": "Polysaccharide Lyases",
    "CE": "Carbohydrate Esterases",
    "AA": "Auxiliary Activities",
    "CBM": "Carbohydrate-Binding Modules",
    "Others": "Others"
}

# Format for JSON
donut_data = []
for cls_name, count in class_counts.items():
    donut_data.append({
        "class": cls_name,
        "full_name": CLASS_FULL.get(cls_name, "Others"),
        "count": int(count),
        "percentage": round((count / total) * 100, 1)
    })

output_data = {
    "total_genes": total,
    "donut": donut_data,
    "barplot": {
        "y": family_counts.index.tolist(),
        "x": family_counts.values.tolist()
    }
}

# Write to JSON
with open(OUTPUT_JSON, "w") as f:
    json.dump(output_data, f)

print(f"Success! Data exported to {OUTPUT_JSON}")