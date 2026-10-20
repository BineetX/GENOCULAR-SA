#!/usr/bin/env python3

import re
import json
import argparse
from pathlib import Path
import glob
import warnings

warnings.filterwarnings("ignore")

# =========================================================
# CONFIGURATION
# =========================================================
OUTDIR = "."

def ensure_dir(path):
    Path(path).mkdir(parents=True, exist_ok=True)

def parse_numeric(value):
    value = str(value).replace(",", "").strip()
    try:
        if "." in value:
            return float(value)
        return int(value)
    except Exception:
        return value

def fmt_mb(bp):
    return f"{bp / 1e6:.2f} Mb"

def fmt_kb(bp):
    return f"{bp / 1e3:.2f} kb"

# =========================================================
# PARSERS
# =========================================================
def load_checkm_summary(checkm_file):
    lines = []
    with open(checkm_file, "r") as f:
        for line in f:
            if line.strip() and not set(line.strip()) <= {"-"}:
                lines.append(line.rstrip("\n"))

    if len(lines) < 2:
        print("Warning: Could not parse CheckM summary file.")
        return {}

    headers = re.split(r"\s{2,}", lines[0].strip())
    values = re.split(r"\s{2,}", lines[1].strip())

    if len(headers) != len(values):
        print(f"Warning: Header/data mismatch in CheckM file: {len(headers)} headers vs {len(values)} values")
        return {}

    return {h: parse_numeric(v) for h, v in zip(headers, values)}

def load_busco_summary(busco_file):
    text = Path(busco_file).read_text()
    m = re.search(
        r"C:(?P<C>\d+\.?\d*)%\[S:(?P<S>\d+\.?\d*)%,D:(?P<D>\d+\.?\d*)%\],F:(?P<F>\d+\.?\d*)%,M:(?P<M>\d+\.?\d*)%,n:(?P<n>\d+)",
        text
    )
    if not m:
        print("Warning: Could not parse BUSCO summary.")
        return {}

    return {
        "Complete": float(m.group("C")),
        "Single": float(m.group("S")),
        "Duplicated": float(m.group("D")),
        "Fragmented": float(m.group("F")),
        "Missing": float(m.group("M")),
        "n": int(m.group("n")),
    }

# =========================================================
# JSON GENERATOR
# =========================================================
def generate_quality_json():
    ensure_dir(OUTDIR)
    outdir_path = Path(OUTDIR)

    # 1. Auto-detect files if not explicitly provided
    checkm_files = glob.glob("checkm_summary.tsv") + glob.glob("checkm*.tsv")
    busco_files = glob.glob("*busco*.txt")

    if not checkm_files or not busco_files:
        print("Error: Could not find CheckM (.tsv) or BUSCO (.txt) files in the current directory.")
        return

    checkm_file = checkm_files[0]
    busco_file = busco_files[0]

    print(f"Parsing CheckM: {checkm_file}")
    print(f"Parsing BUSCO: {busco_file}")

    checkm = load_checkm_summary(checkm_file)
    busco = load_busco_summary(busco_file)

    if not checkm or not busco:
        print("Error: Parsing failed. JSON not generated.")
        return

    # 2. Extract Data
    isolate_name = str(checkm.get("Bin Id", "Isolate"))
    marker_lineage = str(checkm.get("Marker lineage", "NA"))
    completeness = float(checkm.get("Completeness", 0))
    contamination = float(checkm.get("Contamination", 0))
    heterogeneity = float(checkm.get("Strain heterogeneity", 0))
    genome_size = int(checkm.get("Genome size (bp)", 0))
    gc = float(checkm.get("GC", 0))
    coding_density = float(checkm.get("Coding density", 0))
    n50 = int(checkm.get("N50 (contigs)", checkm.get("N50 (scaffolds)", 0)))
    contigs = int(checkm.get("# contigs", 0))
    genes = int(checkm.get("# predicted genes", 0))

    residual = max(0, 100 - completeness - contamination)

    # 3. Build JSON Payload
    payload = {
        "metadata": {
            "isolate_name": isolate_name,
            "description": "Genome assembly quality assessment using BUSCO and CheckM."
        },
        "busco_chart": {
            "data": [
                {"name": "Complete and single-copy", "x": [busco.get("Single", 0)], "y": [isolate_name], "type": "bar", "orientation": "h", "marker": {"color": "#5DADE2"}},
                {"name": "Complete and duplicated", "x": [busco.get("Duplicated", 0)], "y": [isolate_name], "type": "bar", "orientation": "h", "marker": {"color": "#2E86C1"}},
                {"name": "Fragmented", "x": [busco.get("Fragmented", 0)], "y": [isolate_name], "type": "bar", "orientation": "h", "marker": {"color": "#E8DA3C"}},
                {"name": "Missing", "x": [busco.get("Missing", 0)], "y": [isolate_name], "type": "bar", "orientation": "h", "marker": {"color": "#F04B46"}}
            ],
            "layout": {
                "title": "BUSCO Assessment",
                "xaxis": {"title": "% BUSCOs"},
                "barmode": "stack",
                "annotations": [
                    {"text": f"C:{busco.get('Complete', 0)}% [S:{busco.get('Single', 0)}%, D:{busco.get('Duplicated', 0)}%], F:{busco.get('Fragmented', 0)}%, M:{busco.get('Missing', 0)}%, n:{busco.get('n', 0)}"}
                ]
            }
        },
        "checkm_chart": {
            "data": [
                {"name": "Completeness", "x": [completeness], "y": [isolate_name], "type": "bar", "orientation": "h", "marker": {"color": "#A7D07C"}},
                {"name": "Contamination", "x": [contamination], "y": [isolate_name], "type": "bar", "orientation": "h", "marker": {"color": "#F0B35F"}},
                {"name": "Residual", "x": [residual], "y": [isolate_name], "type": "bar", "orientation": "h", "marker": {"color": "#7A7A7A"}}
            ],
            "heterogeneity": {
                "value": heterogeneity,
                "color": "#9FD3E6",
                "label": f"Strain heterogeneity: {heterogeneity:.2f}%"
            },
            "layout": {
                "title": "CheckM Genome Quality",
                "xaxis": {"title": "Quality profile (%)"},
                "barmode": "stack"
            }
        },
        "assembly_stats": [
            {"label": "Marker lineage", "value": marker_lineage},
            {"label": "Genome size", "value": fmt_mb(genome_size)},
            {"label": "GC content", "value": f"{gc:.2f}%"},
            {"label": "Coding density", "value": f"{coding_density:.2f}%"},
            {"label": "N50", "value": fmt_kb(n50)},
            {"label": "Contigs", "value": f"{contigs:,}"},
            {"label": "Predicted genes", "value": f"{genes:,}"}
        ]
    }

    out_json = outdir_path / "genome_quality_summary.json"
    with open(out_json, "w") as f:
        json.dump(payload, f, indent=4)
        
    print(f"Successfully generated: {out_json}")

if __name__ == "__main__":
    generate_quality_json()
