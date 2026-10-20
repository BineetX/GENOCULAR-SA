#!/usr/bin/env python3

import gzip
import sys
import re
import json
import warnings
from datetime import datetime
from pathlib import Path
import numpy as np
from scipy.stats import gaussian_kde

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

warnings.filterwarnings("ignore")

# ── Nature/Science Standard rcParams for the SVG ─────────
plt.rcParams.update({
    "font.family": "sans-serif", "font.sans-serif": ["Arial", "Helvetica", "DejaVu Sans"],
    "font.size": 14, "font.weight": "bold", "text.color": "#1a1a1a",
    "axes.labelcolor": "#1a1a1a", "xtick.color": "#1a1a1a", "ytick.color": "#1a1a1a",
    "axes.labelsize": 15, "axes.titlesize": 15, "axes.labelweight": "bold", "axes.titleweight": "bold",
    "axes.linewidth": 1.4, "axes.spines.top": False, "axes.spines.right": False,
    "xtick.major.width": 1.4, "ytick.major.width": 1.4, "xtick.major.size": 6, "ytick.major.size": 6,
    "xtick.direction": "out", "ytick.direction": "out", "xtick.labelsize": 14, "ytick.labelsize": 14,
    "svg.fonttype": "none" # Ensures text is editable/crisp in SVG
})

# ── Parsers ───────────────────────────────────────────────────────────────────
def find_one(cwd, patterns, label):
    matches = set()
    for pat in patterns:
        matches.update(cwd.glob(pat))
        matches.update(cwd.glob(pat.upper()))
    matches = sorted(matches)
    if not matches:
        raise FileNotFoundError(f"Could not find the {label} long-read FASTQ file.")
    return matches[0]

TIME_RE = re.compile(r"start_time=([0-9T:\.\-Zz]+)")

def _parse_time(header):
    m = TIME_RE.search(header)
    if not m: return None
    ts = m.group(1)
    if ts.endswith(("Z", "z")): ts = ts[:-1] + "+00:00"
    try: return datetime.fromisoformat(ts)
    except ValueError: return None

def _opener(path):
    return gzip.open(path, "rt") if str(path).endswith(".gz") else open(path, "r")

def parse_fastq(path):
    lengths, quals, gc, times = [], [], [], []
    with _opener(path) as f:
        while True:
            header = f.readline()
            if not header: break
            seq = f.readline().rstrip("\n")
            f.readline()
            qual = f.readline().rstrip("\n")
            if not seq or not qual: break
            
            n = len(seq)
            lengths.append(n)
            
            q_raw = np.frombuffer(qual.encode("ascii"), dtype=np.uint8).astype(np.float64) - 33
            if q_raw.size:
                err_probs = 10.0 ** (-q_raw / 10.0)
                mean_err = max(err_probs.mean(), 1e-6)
                mean_q = -10.0 * np.log10(mean_err)
            else:
                mean_q = 0.0
                
            quals.append(mean_q)
            gc.append(100.0 * (seq.upper().count("G") + seq.upper().count("C")) / n if n else 0.0)
            times.append(_parse_time(header))
            
    return np.array(lengths), np.array(quals), np.array(gc), times

def n50(lengths):
    if len(lengths) == 0: return 0
    s = np.sort(lengths)[::-1]
    c = np.cumsum(s)
    return int(s[np.searchsorted(c, c[-1] / 2)])

def summarize(lengths, quals):
    return {
        "n_reads": len(lengths),
        "total_bases": int(lengths.sum()) if len(lengths) else 0,
        "mean_len": float(lengths.mean()) if len(lengths) else 0.0,
        "median_len": float(np.median(lengths)) if len(lengths) else 0.0,
        "n50": n50(lengths),
        "mean_qual": float(quals.mean()) if len(quals) else 0.0,
        "median_qual": float(np.median(quals)) if len(quals) else 0.0,
    }

cwd = Path.cwd()
raw_file = Path(sys.argv[1]) if len(sys.argv) > 1 else find_one(cwd, ["*_R0.fastq*", "*raw*.fastq*", "*raw*.fq*"], "raw")
filt_file = Path(sys.argv[2]) if len(sys.argv) > 2 else find_one(cwd, ["*_filtered.fastq*", "*filt*.fastq*", "*filt*.fq*"], "filtered")
SAMPLE = raw_file.stem.replace(".fastq", "").split("_R0")[0].split("_raw")[0]

print("[INFO] Parsing FASTQ files (this may take a moment)...")
raw_len, raw_qual, raw_gc, raw_times = parse_fastq(raw_file)
filt_len, filt_qual, filt_gc, filt_times = parse_fastq(filt_file)

raw_s = summarize(raw_len, raw_qual)
filt_s = summarize(filt_len, filt_qual)

# ── 1. Prepare JSON Data ──────────────────────────────────────────────────────
output_data = {
    "sample": SAMPLE,
    "summary": {
        "raw": {**raw_s, "mean_gc": float(raw_gc.mean()) if len(raw_gc) else 0.0},
        "filtered": {**filt_s, "mean_gc": float(filt_gc.mean()) if len(filt_gc) else 0.0}
    }
}

# A. Read Length Distribution (Log Bins)
all_len = np.concatenate([a for a in (raw_len, filt_len) if len(a)])
lo = max(1, int(all_len.min())) if len(all_len) else 1
hi = int(all_len.max()) if len(all_len) else 10
bins = np.logspace(np.log10(lo), np.log10(max(hi, lo + 1)), 60)

raw_counts, _ = np.histogram(raw_len, bins=bins)
filt_counts, _ = np.histogram(filt_len, bins=bins)
bin_centers = np.sqrt(bins[:-1] * bins[1:])

output_data["length_dist"] = {
    "x": bin_centers.tolist(),
    "raw_y": raw_counts.tolist(),
    "filt_y": filt_counts.tolist()
}

# B. GC Content Density (KDE)
x_grid = np.linspace(0, 100, 500)
if len(raw_gc) > 1 and len(filt_gc) > 1:
    output_data["gc_density"] = {
        "x": x_grid.tolist(),
        "raw_y": gaussian_kde(raw_gc, bw_method="scott")(x_grid).tolist(),
        "filt_y": gaussian_kde(filt_gc, bw_method="scott")(x_grid).tolist()
    }

# C. Quality Violins (Downsample to max 5000 points to keep JSON lightweight)
np.random.seed(42)
raw_q_down = np.random.choice(raw_qual, min(5000, len(raw_qual)), replace=False) if len(raw_qual) else []
filt_q_down = np.random.choice(filt_qual, min(5000, len(filt_qual)), replace=False) if len(filt_qual) else []

output_data["quality_violin"] = {
    "raw_quals": raw_q_down.tolist(),
    "filt_quals": filt_q_down.tolist(),
    "raw_q30_pct": round((raw_qual >= 30).mean() * 100, 1) if len(raw_qual) else 0,
    "filt_q30_pct": round((filt_qual >= 30).mean() * 100, 1) if len(filt_qual) else 0
}

# D. Yield Over Time
def yield_over_time(lengths, times):
    pairs = [(t, l) for t, l in zip(times, lengths) if t is not None]
    if len(pairs) < max(10, 0.5 * len(lengths)): return None, None
    pairs.sort(key=lambda p: p[0])
    t0 = pairs[0][0]
    hours = np.array([(t - t0).total_seconds() / 3600.0 for t, _ in pairs])
    bases = np.cumsum(np.array([l for _, l in pairs]))
    # Downsample yield curve to 500 points
    idx = np.linspace(0, len(hours)-1, min(500, len(hours))).astype(int)
    return hours[idx].tolist(), bases[idx].tolist()

r_hrs, r_bases = yield_over_time(raw_len, raw_times)
f_hrs, f_bases = yield_over_time(filt_len, filt_times)
output_data["yield_time"] = {"raw_x": r_hrs, "raw_y": r_bases, "filt_x": f_hrs, "filt_y": f_bases}

# Export JSON
JSON_OUT = cwd / "wgs_lr_preprocessing_data.json"
with open(JSON_OUT, "w") as f:
    json.dump(output_data, f)
print(f"[SUCCESS] Exported JSON to {JSON_OUT.name}")

# ── 2. Generate SVG for Hexbin Plot ───────────────────────────────────────────
print("[INFO] Rendering Hexbin SVG...")
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5), sharey=True)
fig.subplots_adjust(wspace=0.25)

len_lo = max(1, int(all_len.min())) if len(all_len) else 1
len_hi = int(all_len.max()) if len(all_len) else 10

for ax, lens, quals, label, cmap in (
    (ax1, raw_len, raw_qual, f"Raw (n={raw_s['n_reads']:,})", "Reds"),
    (ax2, filt_len, filt_qual, f"Filtered (n={filt_s['n_reads']:,})", "Blues"),
):
    if len(lens):
        hb = ax.hexbin(lens, quals, gridsize=40, xscale="log", cmap=cmap, mincnt=1, linewidths=0, edgecolors="none")
        cb = fig.colorbar(hb, ax=ax, fraction=0.046, pad=0.04)
        cb.set_label("Read count", fontweight="bold", fontsize=13, labelpad=8)
        cb.outline.set_visible(False)
        
    ax.set_xlim(len_lo, max(len_hi, len_lo + 1))
    ax.set_ylim(0, 60)
    ax.set_xlabel("Read length (bp)", labelpad=6)
    ax.set_title(label, fontsize=14, fontweight="bold", pad=12)
    ax.minorticks_off()

ax1.set_ylabel("Mean per-read Phred quality score", labelpad=6)

SVG_OUT = cwd / "LengthQuality_Density_WGS_LR.svg"
fig.savefig(SVG_OUT, format="svg", bbox_inches="tight", transparent=True)
plt.close(fig)
print(f"[SUCCESS] Exported SVG Hexbin to {SVG_OUT.name}")
