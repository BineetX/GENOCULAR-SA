#!/usr/bin/env python3

import re
import json
import sys
from pathlib import Path
import warnings
warnings.filterwarnings('ignore')

# =========================================================
# AUTO-DISCOVERY
# =========================================================
def get_default_checkm():
    p = Path("checkm_output/checkm.txt")
    if p.exists(): return str(p)
    return "checkm_summary.tsv"

def get_default_busco():
    p = Path("busco/WGS_SR_SRR27033667_busco_output/short_summary.txt")
    if p.exists(): return str(p)
    busco_dir = Path("busco")
    if busco_dir.exists():
        for f in busco_dir.rglob("short_summary.txt"):
            return str(f)
    return "short_summary.txt"

checkm_file = sys.argv[1] if len(sys.argv) > 1 else get_default_checkm()
busco_file = sys.argv[2] if len(sys.argv) > 2 else get_default_busco()
OUTPUT_JSON = "wgssr_checkmbusco_data.json"

print(f"Parsing CheckM: {checkm_file}")
print(f"Parsing BUSCO: {busco_file}")

def parse_numeric(value):
    value = str(value).replace(",", "").strip()
    try:
        return float(value) if "." in value else int(value)
    except Exception:
        return value

# =========================================================
# PARSE CHECKM
# =========================================================
checkm_data = {}
try:
    lines = []
    with open(checkm_file, "r") as f:
        for line in f:
            if line.strip() and not set(line.strip()) <= {"-"}:
                lines.append(line.rstrip("\n"))
    
    if len(lines) >= 2:
        headers = lines[0].split('\t')
        values = lines[1].split('\t')
        if len(headers) != len(values) or len(headers) == 1:
            headers = re.split(r"\s{2,}", lines[0].strip())
            values = re.split(r"\s{2,}", lines[1].strip())
            
        checkm_data = {h: parse_numeric(v) for h, v in zip(headers, values)}
except FileNotFoundError:
    print(f"Warning: {checkm_file} not found.")

# =========================================================
# PARSE BUSCO
# =========================================================
busco_data = {}
busco_summary_str = ""
try:
    text = Path(busco_file).read_text()
    m = re.search(r"C:(?P<C>\d+\.?\d*)%\[S:(?P<S>\d+\.?\d*)%,D:(?P<D>\d+\.?\d*)%\],F:(?P<F>\d+\.?\d*)%,M:(?P<M>\d+\.?\d*)%,n:(?P<n>\d+)", text)
    if m:
        busco_data = {
            "Complete": float(m.group("C")),
            "Single": float(m.group("S")),
            "Duplicated": float(m.group("D")),
            "Fragmented": float(m.group("F")),
            "Missing": float(m.group("M")),
            "n": int(m.group("n"))
        }
        busco_summary_str = f"C:{busco_data['Complete']:.1f}% [S:{busco_data['Single']:.1f}%, D:{busco_data['Duplicated']:.1f}%], F:{busco_data['Fragmented']:.1f}%, M:{busco_data['Missing']:.1f}%, n:{busco_data['n']}"
except FileNotFoundError:
    print(f"Warning: {busco_file} not found.")

# =========================================================
# FORMAT JSON
# =========================================================
isolate_name = str(checkm_data.get("Bin Id", "Isolate"))
completeness = float(checkm_data.get("Completeness", 0))
contamination = float(checkm_data.get("Contamination", 0))
residual = max(0, 100 - completeness - contamination)

output_data = {
    "isolate_name": isolate_name,
    "busco": {
        "single": busco_data.get("Single", 0),
        "duplicated": busco_data.get("Duplicated", 0),
        "fragmented": busco_data.get("Fragmented", 0),
        "missing": busco_data.get("Missing", 0),
        "summary_string": busco_summary_str
    },
    "checkm": {
        "completeness": completeness,
        "contamination": contamination,
        "residual": residual,
        "heterogeneity": float(checkm_data.get("Strain heterogeneity", 0))
    },
    "stats": [
        {"label": "Marker lineage", "value": str(checkm_data.get("Marker lineage", "NA"))},
        {"label": "Genome size", "value": f"{(int(checkm_data.get('Genome size (bp)', 0)) / 1e6):.2f} Mb"},
        {"label": "GC content", "value": f"{float(checkm_data.get('GC', 0)):.2f}%"},
        {"label": "Coding density", "value": f"{float(checkm_data.get('Coding density', 0)):.2f}%"},
        {"label": "N50", "value": f"{(int(checkm_data.get('N50 (contigs)', checkm_data.get('N50 (scaffolds)', 0))) / 1e3):.2f} kb"},
        {"label": "Contigs", "value": f"{int(checkm_data.get('# contigs', 0)):,}"},
        {"label": "Predicted genes", "value": f"{int(checkm_data.get('# predicted genes', 0)):,}"}
    ]
}

with open(OUTPUT_JSON, "w") as f:
    json.dump(output_data, f)

print(f"Success! Data exported to {OUTPUT_JSON}")
