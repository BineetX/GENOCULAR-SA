#!/usr/bin/env python3
"""
eggNOG-mapper EC Enzyme & PFAM Domain JSON Generator.
Parses annotations.emapper.annotations from the current directory and exports 
structured JSON files for Next.js / D3.js visualization.
"""

import re
import json
from pathlib import Path
from collections import Counter
import pandas as pd
import warnings

warnings.filterwarnings("ignore")

INPUT_FILE = "annotations.emapper.annotations"
OUTDIR = "."

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

def generate_ec_pfam_json(input_file=INPUT_FILE, outdir=OUTDIR):
    ensure_dir(outdir)
    outdir_path = Path(outdir)
    input_path = Path(input_file)

    if not input_path.exists():
        print(f"Error: Could not find '{input_file}' in the current directory.")
        return

    print(f"Reading: {input_file}")
    df = read_annotations_file(input_path)
    
    if df.empty:
        print("Empty annotations file.")
        return

    # ==========================================
    # 1. EC Enzyme Donut JSON
    # ==========================================
    ec_col = detect_column(df.columns, ["EC"])
    if ec_col is not None:
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
        if labels:
            counts = pd.Series(labels).value_counts()
            total_ec = int(counts.sum())
            pcts = [round((val / total_ec) * 100, 2) for val in counts.values]
            colors = [
                "#264653", "#2A9D8F", "#E9C46A", "#F4A261",
                "#E76F51", "#5E60CE", "#4EA8DE"
            ]

            payload_ec = {
                "metadata": {
                    "input": input_file,
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

            out_ec = outdir_path / "emapper_ec_enzymes.json"
            with open(out_ec, "w") as f:
                json.dump(payload_ec, f, indent=4)
            print(f"Successfully generated: {out_ec}")
    else:
        print("No EC column detected, skipping EC JSON.")

    # ==========================================
    # 2. PFAM Domain Lollipop JSON
    # ==========================================
    pfam_col = detect_column(df.columns, ["PFAMs", "PFAM"])
    if pfam_col is not None:
        domains = []
        for val in df[pfam_col]:
            domains += split_multi(val)

        if domains:
            counts = pd.Series(domains).value_counts().head(20).sort_values(ascending=True)

            payload_pfam = {
                "metadata": {
                    "input": input_file,
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

            out_pfam = outdir_path / "emapper_pfam_domains.json"
            with open(out_pfam, "w") as f:
                json.dump(payload_pfam, f, indent=4)
            print(f"Successfully generated: {out_pfam}")
    else:
        print("No PFAM column detected, skipping PFAM JSON.")

    print("Done. JSON files generated successfully.")

if __name__ == "__main__":
    generate_ec_pfam_json()
