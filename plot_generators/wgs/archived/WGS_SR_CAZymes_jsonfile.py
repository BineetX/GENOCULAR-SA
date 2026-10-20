#!/usr/bin/env python3

import pandas as pd
import json
from pathlib import Path
import glob
import re
import warnings

warnings.filterwarnings("ignore")

# =========================================================
# CONFIGURATION
# =========================================================
OUTDIR = "."

def ensure_dir(path):
    Path(path).mkdir(parents=True, exist_ok=True)

def extract_family(h):
    if pd.isna(h): 
        return None
    h = re.sub(r"\(.*?\)", "", str(h))
    for p in h.split("+"):
        m = re.match(r"([A-Za-z]+[0-9]+)", p.strip())
        if m: 
            return m.group(1)
    return None

def classify(f):
    for pre, cls in [("GH","GH"),("GT","GT"),("PL","PL"),
                     ("CE","CE"),("AA","AA"),("CBM","CBM")]:
        if f.startswith(pre): 
            return cls
    return "Others"

# =========================================================
# JSON GENERATOR
# =========================================================
def generate_cazymes_json():
    ensure_dir(OUTDIR)
    outdir_path = Path(OUTDIR)

    # 1. Locate overview.txt
    txt_files = glob.glob("overview.txt") + glob.glob("*overview*.txt")
    if not txt_files:
        print("Error: Could not find dbCAN overview.txt file in the current directory.")
        return

    input_file = txt_files[0]
    print(f"Reading CAZyme data from: {input_file}")

    try:
        df = pd.read_csv(input_file, sep="\t")
    except Exception as e:
        print(f"Error reading {input_file}: {e}")
        return

    # 2. Filter data
    tools_col_candidates = [c for c in df.columns if "Tools" in c or "ofTools" in c]
    hmmer_col_candidates = [c for c in df.columns if "HMMER" in c]

    if not tools_col_candidates or not hmmer_col_candidates:
        print("Error: Required columns ('Tools' or 'HMMER') not found in overview.txt.")
        return

    tools_col = tools_col_candidates[0]
    hmmer_col = hmmer_col_candidates[0]

    df = df[df[tools_col] >= 2].copy()
    df["Family"] = df[hmmer_col].apply(extract_family)
    df = df.dropna(subset=["Family"])

    df["Class"] = df["Family"].apply(classify)
    class_counts = df["Class"].value_counts()
    family_counts = df["Family"].value_counts().head(15)
    total_genes = int(len(df))

    if total_genes == 0:
        print("Warning: No valid CAZymes processed after filtering.")
        return

    # Full class names mapping matching your script
    class_full_names = {
        "GH": "Glycoside Hydrolases",
        "GT": "Glycosyl Transferases",
        "PL": "Polysaccharide Lyases",
        "CE": "Carbohydrate Esterases",
        "AA": "Auxiliary Activities",
        "CBM": "Carbohydrate-Binding Modules",
        "Others": "Others",
    }

    # Palette mapping for frontend synchronization
    palette = {
        "GH": "#E69F00",
        "GT": "#0072B2",
        "PL": "#CC79A7",
        "CE": "#009E73",
        "AA": "#56B4E9",
        "CBM": "#D55E00",
        "Others": "#999999",
    }

    # 3. Construct Donut Payload
    donut_labels = class_counts.index.tolist()
    donut_raw_counts = class_counts.values.tolist()
    donut_percentages = [round((val / total_genes) * 100, 2) for val in donut_raw_counts]
    donut_full_names = [class_full_names.get(lbl, lbl) for lbl in donut_labels]
    donut_colors = [palette.get(lbl, "#999999") for lbl in donut_labels]

    payload_donut = {
        "metadata": {
            "input": input_file,
            "total_cazyme_genes": total_genes,
            "description": "CAZyme Class Distribution (Donut Chart)"
        },
        "pie_chart": {
            "data": [{
                "labels": donut_labels,
                "full_names": donut_full_names,
                "values": donut_percentages,
                "raw_counts": donut_raw_counts,
                "colors": donut_colors,
                "type": "pie",
                "hole": 0.575
            }],
            "layout": {
                "title": "CAZyme Class Distribution"
            }
        }
    }

    out_donut = outdir_path / "cazyme_donut.json"
    with open(out_donut, "w") as f:
        json.dump(payload_donut, f, indent=4)
    print(f"Successfully generated: {out_donut}")

    # 4. Construct Barplot Payload (Top 15 Families)
    bar_families = family_counts.index.tolist()
    bar_counts = family_counts.values.tolist()

    payload_bar = {
        "metadata": {
            "input": input_file,
            "description": "Top 15 Most Abundant CAZyme Families"
        },
        "data": [{
            "x": bar_counts,
            "y": bar_families,
            "type": "bar",
            "orientation": "h",
            "marker": {
                "color": "#0072B2"
            }
        }],
        "layout": {
            "title": "Top 15 Most Abundant CAZyme Families",
            "xaxis": {"title": "Gene Count"},
            "yaxis": {"title": "CAZyme Family"}
        }
    }

    out_bar = outdir_path / "cazyme_barplot.json"
    with open(out_bar, "w") as f:
        json.dump(payload_bar, f, indent=4)
    print(f"Successfully generated: {out_bar}")

if __name__ == "__main__":
    generate_cazymes_json()
