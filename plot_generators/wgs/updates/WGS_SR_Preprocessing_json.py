#!/usr/bin/env python3

import os
import zipfile
import json
import warnings
from pathlib import Path
import numpy as np

warnings.filterwarnings("ignore")

# ── Parsers ───────────────────────────────────────────────────────────────────
def parse_fastqc(file):
    rows, inside = [], False
    with open(file) as f:
        for line in f:
            if line.startswith(">>Per base sequence quality"): inside = True; continue
            if line.startswith(">>END_MODULE"): inside = False
            if inside and not line.startswith("#"):
                p = line.strip().split()
                if len(p) >= 5:
                    rows.append({"base": p[0], "mean": float(p[1]), "median": float(p[2]), "lower": float(p[3]), "upper": float(p[4])})
    return rows

def parse_gc(file):
    rows, inside = [], False
    with open(file) as f:
        for line in f:
            if line.startswith(">>Per sequence GC content"): inside = True; continue
            if line.startswith(">>END_MODULE"): inside = False
            if inside and not line.startswith("#"):
                p = line.strip().split()
                if len(p) == 2:
                    try: rows.append((float(p[0]), float(p[1])))
                    except: pass
    return rows

def parse_per_sequence_quality(file):
    rows, inside = [], False
    with open(file) as f:
        for line in f:
            if line.startswith(">>Per sequence quality scores"): inside = True; continue
            if line.startswith(">>END_MODULE"): inside = False
            if inside and not line.startswith("#"):
                p = line.strip().split()
                if len(p) == 2:
                    try: rows.append((float(p[0]), float(p[1])))
                    except: pass
    return rows

def combine(r1, r2):
    n = min(len(r1), len(r2))
    return [{"base": r1[i]["base"], "mean": (r1[i]["mean"] + r2[i]["mean"])/2, "median": (r1[i]["median"] + r2[i]["median"])/2, "lower": (r1[i]["lower"] + r2[i]["lower"])/2, "upper": (r1[i]["upper"] + r2[i]["upper"])/2} for i in range(n)]

def combine_density(r1, r2):
    d1, d2 = dict(r1), dict(r2)
    all_q = sorted(list(set(d1.keys()).union(set(d2.keys()))))
    q_out, count_out = [], []
    for q in all_q:
        q_out.append(q)
        count_out.append((d1.get(q, 0.0) + d2.get(q, 0.0)) / 2.0)
    return np.array(q_out), np.array(count_out)

def arr(d, k): 
    return np.array([x[k] for x in d]).tolist()

# ── Directory Management ──────────────────────────────────────────────────────
BASE_DIR = Path(os.environ.get("GENOCULAR_INPUT_ROOT", Path(__file__).resolve().parent))

def ensure_unzipped(folder_path):
    if not folder_path.exists(): return
    for item in folder_path.glob("*.zip"):
        expected_dir = folder_path / item.stem
        if not expected_dir.exists():
            print(f"[INFO] Unzipping {item.name} in {folder_path.name}...")
            with zipfile.ZipFile(item, 'r') as zip_ref: zip_ref.extractall(folder_path)

def find_fastqc(folder, read):
    base = BASE_DIR / folder
    if not base.exists(): raise FileNotFoundError(f"Directory not found: {base}")
    ensure_unzipped(base)
        
    files = []
    num = "1" if "1" in read else "2"
    for d in base.iterdir():
        if d.is_dir() and d.name.endswith("_fastqc"):
            if any(x in d.name for x in [f"_{read}_", f"_{read}.", f"_{num}_", f"{read}_", f"{num}_"]):
                data_file = d / "fastqc_data.txt"
                if data_file.exists(): files.append(data_file)

    if not files:
        raise FileNotFoundError(f"No {read} FastQC file found in {folder}.")
    return files[0]

paths = {
    "raw_r1": find_fastqc("fastqc_raw", "R1"),
    "raw_r2": find_fastqc("fastqc_raw", "R2"),
    "clean_r1": find_fastqc("fastqc_trimmed", "R1"), 
    "clean_r2": find_fastqc("fastqc_trimmed", "R2"),
}

print("[INFO] Loading short-read FastQC data...")

raw_d = combine(parse_fastqc(paths["raw_r1"]), parse_fastqc(paths["raw_r2"]))
clean_d = combine(parse_fastqc(paths["clean_r1"]), parse_fastqc(paths["clean_r2"]))

gc_raw = parse_gc(paths["raw_r1"])
gc_clean = parse_gc(paths["clean_r1"])

seq_q_raw_r1 = parse_per_sequence_quality(paths["raw_r1"])
seq_q_raw_r2 = parse_per_sequence_quality(paths["raw_r2"])
seq_q_clean_r1 = parse_per_sequence_quality(paths["clean_r1"])
seq_q_clean_r2 = parse_per_sequence_quality(paths["clean_r2"])

q_raw_x, q_raw_y = combine_density(seq_q_raw_r1, seq_q_raw_r2)
q_clean_x, q_clean_y = combine_density(seq_q_clean_r1, seq_q_clean_r2)

# Normalize distributions
raw_q_norm = (q_raw_y / q_raw_y.sum()) if q_raw_y.sum() else q_raw_y
clean_q_norm = (q_clean_y / q_clean_y.sum()) if q_clean_y.sum() else q_clean_y

gc_ry = np.array([v[1] for v in gc_raw])
gc_cy = np.array([v[1] for v in gc_clean])
gc_ry_n = (gc_ry / gc_ry.sum()) if gc_ry.sum() else gc_ry
gc_cy_n = (gc_cy / gc_cy.sum()) if gc_cy.sum() else gc_cy

# Generate tick labels exactly matching the Matplotlib logic
xtick_pos = np.linspace(0, len(raw_d) - 1, 6).astype(int).tolist()
xtick_labels = [str(i) for i in np.linspace(1, len(raw_d), 6).astype(int).tolist()]

output_data = {
    "per_base": {
        "x": list(range(len(raw_d))),
        "x_clean": list(range(len(clean_d))),
        "xtick_pos": xtick_pos,
        "xtick_labels": xtick_labels,
        "raw_median": arr(raw_d, "median"),
        "raw_lower": arr(raw_d, "lower"),
        "raw_upper": arr(raw_d, "upper"),
        "clean_median": arr(clean_d, "median"),
        "clean_lower": arr(clean_d, "lower"),
        "clean_upper": arr(clean_d, "upper"),
    },
    "gc_content": {
        "raw_x": [v[0] for v in gc_raw],
        "raw_y": gc_ry_n.tolist(),
        "clean_x": [v[0] for v in gc_clean],
        "clean_y": gc_cy_n.tolist(),
    },
    "read_quality": {
        "raw_x": q_raw_x.tolist(),
        "raw_y": raw_q_norm.tolist(),
        "clean_x": q_clean_x.tolist(),
        "clean_y": clean_q_norm.tolist(),
    }
}

OUTPUT_JSON = "wgs_preprocessing_data.json"
with open(OUTPUT_JSON, "w") as f:
    json.dump(output_data, f)

print(f"[SUCCESS] Exported JSON to {OUTPUT_JSON}")
