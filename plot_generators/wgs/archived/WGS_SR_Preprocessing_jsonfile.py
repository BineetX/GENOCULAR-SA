#!/usr/bin/env python3
"""
Preprocessing & FastQC QC JSON Generator.
Parses FastQC data files from 'fastqc_raw' and 'fastqc_clean' directories
and exports a structured JSON file for Next.js / D3.js frontend visualization.

Usage:
    python3 WGS_SR_Preprocessing_jsonfile.py
"""

import json
from pathlib import Path
import warnings

warnings.filterwarnings("ignore")

BASE_DIR = Path(__file__).resolve().parent

def find_fastqc(folder, read):
    """Automatically finds fastqc_data.txt for specified read type (R1/R2)."""
    base = BASE_DIR / folder
    if not base.exists():
        return None
    
    for d in base.iterdir():
        if d.is_dir() and d.name.endswith("_fastqc"):
            if f"_{read}_" in d.name or d.name.startswith(read):
                return d / "fastqc_data.txt"
    return None

def parse_fastqc(file_path):
    """Parses 'Per base sequence quality' module from fastqc_data.txt."""
    rows, inside = [], False
    if not file_path or not file_path.exists():
        return rows
        
    with open(file_path) as f:
        for line in f:
            if line.startswith(">>Per base sequence quality"):
                inside = True
                continue
            if line.startswith(">>END_MODULE"):
                inside = False
            if inside and not line.startswith("#"):
                p = line.strip().split()
                if len(p) >= 5:
                    rows.append({
                        "base": p[0],
                        "mean": float(p[1]),
                        "median": float(p[2]),
                        "lower": float(p[3]),
                        "upper": float(p[4]),
                    })
    return rows

def parse_gc(file_path):
    """Parses 'Per sequence GC content' module from fastqc_data.txt."""
    rows, inside = [], False
    if not file_path or not file_path.exists():
        return rows

    with open(file_path) as f:
        for line in f:
            if line.startswith(">>Per sequence GC content"):
                inside = True
                continue
            if line.startswith(">>END_MODULE"):
                inside = False
            if inside and not line.startswith("#"):
                p = line.strip().split()
                if len(p) == 2:
                    try:
                        rows.append({"gc": float(p[0]), "count": float(p[1])})
                    except ValueError:
                        pass
    return rows

def combine(r1, r2):
    """Combines R1 and R2 metrics position-wise."""
    if not r1 or not r2:
        return r1 if r1 else r2
    n = min(len(r1), len(r2))
    return [{
        "base": r1[i]["base"],
        "mean": (r1[i]["mean"] + r2[i]["mean"]) / 2,
        "median": (r1[i]["median"] + r2[i]["median"]) / 2,
        "lower": (r1[i]["lower"] + r2[i]["lower"]) / 2,
        "upper": (r1[i]["upper"] + r2[i]["upper"]) / 2,
    } for i in range(n)]

def generate_preprocessing_json(outdir="."):
    outdir_path = Path(outdir)
    outdir_path.mkdir(parents=True, exist_ok=True)

    paths = {
        "raw_r1": find_fastqc("fastqc_raw", "R1"),
        "raw_r2": find_fastqc("fastqc_raw", "R2"),
        "clean_r1": find_fastqc("fastqc_clean", "R1"),
        "clean_r2": find_fastqc("fastqc_clean", "R2"),
    }

    print("Parsing FastQC quality data...")
    raw_q_r1 = parse_fastqc(paths["raw_r1"])
    raw_q_r2 = parse_fastqc(paths["raw_r2"])
    clean_q_r1 = parse_fastqc(paths["clean_r1"])
    clean_q_r2 = parse_fastqc(paths["clean_r2"])

    raw_d = combine(raw_q_r1, raw_q_r2)
    clean_d = combine(clean_q_r1, clean_q_r2)

    raw_gc = parse_gc(paths["raw_r1"])
    clean_gc = parse_gc(paths["clean_r1"])

    # Normalize GC content fractions if available
    raw_gc_norm = []
    if raw_gc:
        total_raw_gc = sum(x["count"] for x in raw_gc)
        if total_raw_gc > 0:
            raw_gc_norm = [{"gc": x["gc"], "fraction": x["count"] / total_raw_gc} for x in raw_gc]

    clean_gc_norm = []
    if clean_gc:
        total_clean_gc = sum(x["count"] for x in clean_gc)
        if total_clean_gc > 0:
            clean_gc_norm = [{"gc": x["gc"], "fraction": x["count"] / total_clean_gc} for x in clean_gc]

    payload = {
        "metadata": {
            "description": "Per-base sequence quality and per-sequence GC content extracted from FastQC reports."
        },
        "per_base_quality": {
            "raw": raw_d,
            "trimmed": clean_d,
            "layout": {
                "title": "Per-base Sequence Quality",
                "xaxis": {"title": "Base position (bp)"},
                "yaxis": {"title": "Phred quality score"}
            }
        },
        "gc_content": {
            "raw": raw_gc_norm,
            "trimmed": clean_gc_norm,
            "layout": {
                "title": "Per-sequence GC Content",
                "xaxis": {"title": "GC content (%)"},
                "yaxis": {"title": "Fraction of reads"}
            }
        }
    }

    out_json = outdir_path / "preprocessing_qc.json"
    with open(out_json, "w") as f:
        json.dump(payload, f, indent=4)

    print(f"Successfully generated: {out_json}")

if __name__ == "__main__":
    generate_preprocessing_json()
