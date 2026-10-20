#!/usr/bin/env python3

import pandas as pd
import numpy as np
import json
import sys
import re
from pathlib import Path
import warnings
warnings.filterwarnings('ignore')

# Handle arguments - CHANGED DEFAULT FILES TO MATCH YOUR DIRECTORY
out_file = sys.argv[1] if len(sys.argv) > 1 else "contigs.fasta.out"
tbl_file = sys.argv[2] if len(sys.argv) > 2 else "contigs.fasta.tbl"
OUTPUT_JSON = "repeatmasker_plots_data.json"

print(f"Parsing {tbl_file} and {out_file}...")

# ---------------------------------------------------------
# 1. Parse .tbl File for Statistics
# ---------------------------------------------------------
stats = {
    "genome_size": 0,
    "gc_content": 0.0,
    "masked_bp": 0,
    "masked_pct": 0.0,
    "repeat_hits": 0
}

try:
    with open(tbl_file, 'r') as f:
        for line in f:
            line = line.strip().lower()
            if line.startswith("total length:"):
                match = re.search(r'(\d+)\s+bp', line)
                if match: stats["genome_size"] = int(match.group(1))
            elif line.startswith("gc level:"):
                match = re.search(r'([\d.]+)\s*%', line)
                if match: stats["gc_content"] = float(match.group(1))
            elif line.startswith("bases masked:"):
                match_bp = re.search(r'(\d+)\s+bp', line)
                if match_bp: stats["masked_bp"] = int(match_bp.group(1))
                match_pct = re.search(r'\(\s*([\d.]+)\s*%\s*\)', line)
                if match_pct: stats["masked_pct"] = float(match_pct.group(1))
except FileNotFoundError:
    print(f"Warning: {tbl_file} not found. Stats will be 0.")

# ---------------------------------------------------------
# 2. Parse .out File for Divergence Landscape
# ---------------------------------------------------------
data = []
try:
    with open(out_file, 'r') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("SW") or line.startswith("score"):
                continue
            parts = line.split()
            try:
                divergence = float(parts[1])
                repeat_class = parts[10]
                data.append([divergence, repeat_class])
            except:
                continue
except FileNotFoundError:
    print(f"Error: {out_file} not found. Cannot generate landscape.")
    exit(1)

df = pd.DataFrame(data, columns=["Divergence", "Class"])
stats["repeat_hits"] = len(df)

# Simplify Classes
def simplify(x):
    x = str(x)
    if "Simple_repeat" in x: return "Simple repeats"
    elif "Low_complexity" in x: return "Low complexity"
    elif "Satellite" in x: return "Satellite"
    elif "LTR" in x: return "LTR"
    elif "LINE" in x: return "LINE"
    elif "SINE" in x: return "SINE"
    elif "DNA" in x: return "DNA"
    else: return "Other"

df["Group"] = df["Class"].apply(simplify)

# ---------------------------------------------------------
# 3. Pre-bin Histogram Data for Lightweight JSON
# ---------------------------------------------------------
# We use bins from 0 to 50 with step 1, exactly like the Matplotlib script
bins = np.arange(0, 51, 1)
bin_centers = (bins[:-1] + 0.5).tolist()

group_counts = {}
groups = ["DNA", "LINE", "LTR", "SINE", "Satellite", "Simple repeats", "Low complexity", "Other"]

for g in groups:
    subset = df[df["Group"] == g]["Divergence"]
    if len(subset) > 0:
        counts, _ = np.histogram(subset, bins=bins)
        group_counts[g] = counts.tolist()

output_data = {
    "stats": stats,
    "landscape": {
        "x": bin_centers,
        "groups": group_counts
    }
}

# Write to JSON
with open(OUTPUT_JSON, "w") as f:
    json.dump(output_data, f)

print(f"Success! Data exported to {OUTPUT_JSON}")