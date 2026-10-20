#!/usr/bin/env python3
"""
eggNOG-mapper EC Enzyme & PFAM Domain JSON Generator for long-read / short-read outputs.
Parses annotations.emapper.annotations and exports structured JSON files for Next.js / D3.js visualization.
"""

import re
import json
from pathlib import Path
from collections import Counter
import pandas as pd
import warnings

warnings.filterwarnings("ignore")

# =========================================================
# CONFIGURATION
# =========================================================
INPUT_FILE = "annotations.emapper.annotations"
OUTDIR = "."

# =========================================================
# HELPERS
# =========================================================
def ensure_dir(path):
    Path(path).mkdir(parents=True, exist_ok=True)

def split_multi(val):
    if pd.isna(val):
        return []
    val = str(val).strip()
    if val == "-" or val == "":
        return []
    return [x.strip() for x in re.split(r"[;,|]", val) if x.strip()]

def detect_column(columns, candidates):
    lower_map = {c.lower(): c for c in columns}
    for cand in candidates:
        if cand.lower() in lower_map:
            return lower_map[cand.lower()]
    for c in columns:
        for cand in candidates:
            if cand.lower() in c.lower():
                return c
    return None

def read_annotations_file(path):
    lines = []
    with open(path) as fh:
        for line in fh:
            if line.startswith("##"):
                continue
            lines.append(line)
    
    if not lines:
        return pd.DataFrame()

    content = "".join(lines)
    if content.startswith("#"):
        content = content[1:]

    from io import StringIO
    df = pd.read_csv(StringIO(content), sep="\t", dtype=str)
    df.columns = [c.strip() for c in df.columns]

    return df.fillna("-")

# =========================================================
# JSON GENERATORS
# =========================================================
def generate_ec_donut_json(df, outdir):
    ec_col = detect_column(df.columns, ["EC"])
    if ec_col is None:
        print("No EC column detected, skipping EC JSON.")
        return

    classes = []
    for val in df[ec_col]:
        for ec in split_multi(val):
            m = re.match(r"(\d)\.", ec)
            if m:
                classes.append(m.group(1))

    mapping = {
        "1": "Oxidoreductases",
        "2": "Transferases",
        "3": "Hydrolases",
        "4": "Lyases",
        "5": "Isomerases",
        "6": "Ligases",
        "7": "Translocases"
    }

    labels = [mapping[x] for x in classes if x in mapping]
    if not labels:
        print("No valid EC numbers parsed.")
        return

    counts = pd.Series(labels).value_counts()
    total_ec = int(counts.sum())
    pcts = [round((val / total_ec) * 100, 2) for val in counts.values]
    colors = [
        "#264653", "#2A9D8F", "#E9C46A", "#F4A261",
        "#E76F51", "#5E60CE", "#4EA8DE"
    ]

    payload = {
        "metadata": {
            "input": INPUT_FILE,
            "total_ec_assignments": total_ec,
            "description": "Enzyme Commission (EC) Classification based on first digit."
        },
        "pie_chart": {
            "data": [{
                "labels": counts.index.tolist(),
                "values": pcts,
                "raw_counts": counts.values.tolist(),
                "colors": colors[:len(counts)],
                "type": "pie",
                "hole": 0.35
            }],
            "layout": {
                "title": "EC Enzyme Classification"
            }
        }
    }

    outfile = Path(outdir) / "emapper_ec_enzymes.json"
    with open(outfile, "w") as f:
        json.dump(payload, f, indent=4)
    print(f"Successfully generated: {outfile}")

def generate_pfam_lollipop_json(df, outdir):
    pfam_col = detect_column(df.columns, ["PFAMs", "PFAM"])
    if pfam_col is None:
        print("No PFAM column detected, skipping PFAM JSON.")
        return

    domains = []
    for val in df[pfam_col]:
        domains += split_multi(val)

    if not domains:
        print("No PFAM domains parsed.")
        return

    counts = pd.Series(domains).value_counts().head(20).sort_values(ascending=True)

    payload = {
        "metadata": {
            "input": INPUT_FILE,
            "description": "Top 20 PFAM Domain Families."
        },
        "data": [{
            "x": counts.values.tolist(),
            "y": counts.index.tolist(),
            "type": "bar",
            "orientation": "h",
            "marker": {
                "color": "#264653"
            }
        }],
        "layout": {
            "title": "Top PFAM Domain Families",
            "xaxis": {"title": "Gene Count"},
            "yaxis": {"title": "PFAM Domain"}
        }
    }

    outfile = Path(outdir) / "emapper_pfam_domains.json"
    with open(outfile, "w") as f:
        json.dump(payload, f, indent=4)
    print(f"Successfully generated: {outfile}")

def main():
    ensure_dir(OUTDIR)
    
    input_path = Path(INPUT_FILE)
    if not input_path.exists():
        print(f"Error: Could not find '{INPUT_FILE}' in the current directory.")
        return

    print(f"Reading: {INPUT_FILE}")
    df = read_annotations_file(input_path)
    
    if df.empty:
        print("Empty annotations file.")
        return

    generate_ec_donut_json(df, OUTDIR)
    generate_pfam_lollipop_json(df, OUTDIR)
    
    print("Done. JSON files generated successfully.")

if __name__ == "__main__":
    main()
