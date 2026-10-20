#!/usr/bin/env python3
"""
RepeatMasker JSON Generator for long-read / short-read outputs.
Parses RepeatMasker .out and .tbl summary files and exports structured JSON for Next.js / D3.js visualization.
"""

import json
import re
import sys
import glob
from pathlib import Path
import pandas as pd
import numpy as np
import warnings

warnings.filterwarnings("ignore")

OUTDIR = "."

def ensure_dir(path):
    Path(path).mkdir(parents=True, exist_ok=True)

def simplify_class(x):
    x = str(x)
    if "Simple_repeat" in x:
        return "Simple repeats"
    elif "Low_complexity" in x:
        return "Low complexity"
    elif "Satellite" in x:
        return "Satellite"
    elif "LTR" in x:
        return "LTR"
    elif "LINE" in x:
        return "LINE"
    elif "SINE" in x:
        return "SINE"
    elif "DNA" in x:
        return "DNA"
    else:
        return "Other"

def generate_repeatmasker_json(outdir=OUTDIR):
    ensure_dir(outdir)
    outdir_path = Path(outdir)

    # 1. Auto-detect or accept CLI arguments for input files
    if len(sys.argv) >= 3:
        repeatmasker_out = Path(sys.argv[1])
        tbl_file = Path(sys.argv[2])
    else:
        out_files = glob.glob("*.out")
        tbl_files = glob.glob("*.tbl")
        if not out_files or not tbl_files:
            print("Error: Could not automatically find RepeatMasker .out and .tbl files.")
            return
        repeatmasker_out = Path(out_files[0])
        tbl_file = Path(tbl_files[0])

    print(f"Parsing RepeatMasker output: {repeatmasker_out.name}")
    print(f"Parsing summary table: {tbl_file.name}")

    # 2. Parse Statistics from .tbl file[cite: 5]
    genome_size = 0
    gc_content = 0.0
    masked_bp = 0
    masked_pct = 0.0

    with open(tbl_file) as f:
        for line in f:
            line = line.strip()
            if line.lower().startswith("total length:"):
                match = re.search(r'(\d+)\s+bp', line)
                if match:
                    genome_size = int(match.group(1))
            elif line.lower().startswith("gc level:"):
                match = re.search(r'([\d.]+)\s*%', line)
                if match:
                    gc_content = float(match.group(1))
            elif line.lower().startswith("bases masked:"):
                match = re.search(r'(\d+)\s+bp', line)
                if match:
                    masked_bp = int(match.group(1))
                match = re.search(r'\(\s*([\d.]+)\s*%\s*\)', line)
                if match:
                    masked_pct = float(match.group(1))

    # 3. Parse RepeatMasker Output (.out)[cite: 5]
    data = []
    with open(repeatmasker_out) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("SW") or line.startswith("score"):
                continue
            parts = line.split()
            try:
                divergence = float(parts[1])
                repeat_class = parts[10]
                data.append([divergence, repeat_class])
            except Exception:
                continue

    df = pd.DataFrame(data, columns=["Divergence", "Class"])
    df["Group"] = df["Class"].apply(simplify_class)

    # 4. Color Palette Mapping[cite: 5]
    palette = {
        "DNA"            : "#001F3F",
        "LINE"           : "#003F88",
        "LTR"            : "#0077B6",
        "SINE"           : "#00B4D8",
        "Satellite"      : "#0057B8",
        "Simple repeats" : "#006D77",
        "Low complexity" : "#F9C74F",
        "Other"          : "#6C757D"
    }

    groups = list(palette.keys())
    bins = np.arange(0, 51, 1)
    bin_centers = (bins[:-1] + bins[1:]) / 2

    chart_data = []
    for g in groups:
        subset = df[df["Group"] == g]["Divergence"].values
        if len(subset) > 0:
            hist_counts, _ = np.histogram(subset, bins=bins)
            chart_data.append({
                "name": g,
                "x": bin_centers.tolist(),
                "y": hist_counts.tolist(),
                "type": "bar",
                "marker": {"color": palette[g]}
            })

    # 5. Construct JSON Payload
    payload = {
        "metadata": {
            "input_out": repeatmasker_out.name,
            "input_tbl": tbl_file.name,
            "genome_size": genome_size,
            "gc_content": gc_content,
            "masked_bp": masked_bp,
            "masked_pct": masked_pct,
            "total_repeat_hits": int(len(df))
        },
        "data": chart_data,
        "layout": {
            "title": "Repeat Composition Landscape",
            "xaxis": {"title": "Sequence Divergence (%)"},
            "yaxis": {"title": "Number of Repeat Hits"},
            "barmode": "stack"
        }
    }

    out_json = outdir_path / "repeatmasker_landscape.json"
    with open(out_json, "w") as f:
        json.dump(payload, f, indent=4)

    print("\nRepeatMasker Statistics extracted:")
    print("-----------------------------------")
    print(f"Genome size : {genome_size:,} bp")
    print(f"GC content  : {gc_content:.2f}%")
    print(f"Masked DNA  : {masked_bp:,} bp")
    print(f"Masked (%)  : {masked_pct:.2f}%")
    print(f"Total hits  : {len(df):,}")
    print(f"\nSuccessfully generated: {out_json}")

if __name__ == "__main__":
    generate_repeatmasker_json()
