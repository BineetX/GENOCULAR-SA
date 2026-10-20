#!/usr/bin/env python3
# ==============================================================================
# binning_scatter_json.py
#
# Python port of MAG_Binning_scatter_plot.R.  Parses MetaBAT2 and MaxBin2 binning
# outputs for one sample and emits a single plot-ready JSON document (two-panel
# GC% vs coverage scatter) consumed by the React/Plotly frontend.
#
# Pure standard library — no pandas/numpy/biopython — so it drops into a Nextflow
# process without a heavy conda/container image.
#
# INPUT CONTRACT (positional, exactly 3 — consistent with the other ports):
#   arg1: BINNING_SAMPLE_DIR - .../binning/<sample_id>, containing:
#            metabat2/<sample>_bin.BinInfo.txt  + per-bin .fa files
#            maxbin2/<sample>.summary           (or any *.summary)
#            maxbin2_contig2bin.tsv             (optional; for contig counts)
#   arg2: OUTPUT_DIR         - where JSON + log are written
#   arg3: SAMPLE_ID          - sample identifier, used verbatim
#   (The original R auto-detected the sample; here it is passed explicitly,
#    matching the prokka/dbcan/barrnap ports.)
#
# Usage:
#   python3 binning_scatter_json.py <BINNING_SAMPLE_DIR> <OUTPUT_DIR> <SAMPLE_ID>
#
# Output:
#   <OUTPUT_DIR>/mag_binning_plots_data.json          (frontend input)
#   <OUTPUT_DIR>/binning_scatter_data.tsv             (companion table)
#   <OUTPUT_DIR>/<SAMPLE_ID>_binning_run.log
# ==============================================================================

import os
import sys
import re
import csv
import json
import glob
import math
import statistics
import datetime

SCHEMA_VERSION = "1.0"
SD_THRESHOLD = 2.0
SIZE_RANGE_PX = [6, 32]

# plasma colour stops (matches ggplot viridis option="plasma")
PLASMA = [
    [0.0, "#0d0887"], [0.14, "#41049d"], [0.29, "#6a00a8"], [0.43, "#8f0da4"],
    [0.57, "#b12a90"], [0.71, "#cc4778"], [0.86, "#e16462"], [1.0, "#fca636"],
]


class RunLog:
    def __init__(self, path):
        self._fh = open(path, "w")

    def __call__(self, *parts):
        stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self._fh.write("[{}] {}\n".format(stamp, " ".join(str(p) for p in parts)))
        self._fh.flush()

    def close(self):
        try:
            self._fh.close()
        except Exception:
            pass


def read_tsv(path):
    """Read a headered TSV into (header_list, list_of_row_dicts)."""
    with open(path, "r", errors="replace") as fh:
        rows = [ln.rstrip("\r\n") for ln in fh if ln.strip()]
    if not rows:
        return [], []
    header = [h.strip() for h in rows[0].split("\t")]
    out = []
    for r in rows[1:]:
        parts = r.split("\t")
        parts = (parts + [""] * len(header))[:len(header)]
        out.append(dict(zip(header, parts)))
    return header, out


def find_col(header, *predicates):
    """Return the first header (original case) whose lowercase form satisfies
    any predicate. predicates are callables taking the lowercased name."""
    low = {h: h.strip().lower() for h in header}
    for pred in predicates:
        for h in header:
            if pred(low[h]):
                return h
    return None


def to_float(x):
    try:
        return float(str(x).replace("%", "").strip())
    except (ValueError, TypeError):
        return None


def to_int(x):
    try:
        return int(float(str(x).strip()))
    except (ValueError, TypeError):
        return None


def compute_gc_from_fasta(fa_path):
    try:
        with open(fa_path, "r", errors="replace") as fh:
            seq = "".join(ln.strip() for ln in fh if not ln.startswith(">")).upper()
    except Exception:
        return None
    gc = sum(seq.count(b) for b in ("G", "C"))
    tot = sum(seq.count(b) for b in ("A", "C", "G", "T"))
    if tot == 0:
        return None
    return round(gc / tot * 100.0, 2)


# ---- SECTION A: MetaBAT2 ----------------------------------------------------
def parse_metabat2(metabat2_dir, sample_id, log):
    if not os.path.isdir(metabat2_dir):
        log("  [MetaBAT2] directory not found; skipping.")
        return []

    bininfo_path = os.path.join(metabat2_dir, sample_id + "_bin.BinInfo.txt")
    if not os.path.isfile(bininfo_path):
        cands = sorted(glob.glob(os.path.join(metabat2_dir, "*BinInfo*.txt")))
        bininfo_path = cands[0] if cands else None
    if not bininfo_path:
        log("  [MetaBAT2] no BinInfo.txt; skipping.")
        return []

    header, rows = read_tsv(bininfo_path)
    log(f"  [MetaBAT2] BinInfo header: {header}")
    if not rows:
        return []

    c_cov = find_col(header, lambda h: "cov" in h)
    c_len = find_col(header, lambda h: h == "totallength",
                     lambda h: "total" in h and "length" in h,
                     lambda h: h == "genomesize" or ("genome" in h and "size" in h))
    c_ctg = find_col(header, lambda h: "contig" in h)
    c_bin = find_col(header, lambda h: h == "binnum", lambda h: "bin" in h and "num" in h)
    log(f"  [MetaBAT2] mapping: coverage={c_cov}, size={c_len}, "
        f"contigs={c_ctg}, bin_num={c_bin}")

    # GC% from each .fa keyed by trailing bin number
    gc_by_bin = {}
    fa_files = sorted(glob.glob(os.path.join(metabat2_dir, "*.fa")))
    log(f"  [MetaBAT2] computing GC% for {len(fa_files)} bin FASTA(s)…")
    for f in fa_files:
        name = re.sub(r"\.fa$", "", os.path.basename(f))
        m = re.search(r"(?<=\.)(\d+)$", name)
        bn = int(m.group(1)) if m else None
        gc_by_bin[bn] = (name, compute_gc_from_fasta(f))

    records = []
    for r in rows:
        bin_num = to_int(r.get(c_bin)) if c_bin else None
        gc_entry = gc_by_bin.get(bin_num)
        bin_id = gc_entry[0] if gc_entry else (r.get(c_bin) or "bin")
        gc = gc_entry[1] if gc_entry else None
        cov = to_float(r.get(c_cov)) if c_cov else None
        size = to_int(r.get(c_len)) if c_len else None
        ctg = to_int(r.get(c_ctg)) if c_ctg else None
        records.append({
            "bin_id": str(bin_id), "binner": "MetaBAT2",
            "gc_pct": gc, "coverage": cov,
            "genome_size_mb": round(size / 1e6, 3) if size else None,
            "num_contigs": ctg,
        })
    log(f"  [MetaBAT2] parsed {len(records)} bins.")
    return records


# ---- SECTION B: MaxBin2 -----------------------------------------------------
def parse_maxbin2(maxbin2_dir, binning_sample_dir, sample_id, log):
    if not os.path.isdir(maxbin2_dir):
        log("  [MaxBin2] directory not found; skipping.")
        return []

    summary_path = os.path.join(maxbin2_dir, sample_id + ".summary")
    if not os.path.isfile(summary_path):
        cands = sorted(glob.glob(os.path.join(maxbin2_dir, "*.summary")))
        summary_path = cands[0] if cands else None
    if not summary_path:
        log("  [MaxBin2] no .summary; skipping.")
        return []

    header, rows = read_tsv(summary_path)
    log(f"  [MaxBin2] summary header: {header}")
    if not rows:
        return []

    c_id = find_col(header, lambda h: h in ("bin name", "bin.name", "bin_name"),
                    lambda h: "bin" in h and "name" in h)
    c_cov = find_col(header, lambda h: "abund" in h, lambda h: "cov" in h)
    c_size = find_col(header, lambda h: "genome" in h and "size" in h)
    c_gc = find_col(header, lambda h: h.startswith("gc") or "gc content" in h or "gc.content" in h)
    log(f"  [MaxBin2] mapping: bin_id={c_id}, coverage={c_cov}, "
        f"size={c_size}, gc={c_gc}")

    # contig counts from contig2bin
    contig_counts = {}
    c2b = os.path.join(binning_sample_dir, "maxbin2_contig2bin.tsv")
    if os.path.isfile(c2b):
        with open(c2b, "r", errors="replace") as fh:
            for ln in fh:
                if not ln.strip():
                    continue
                cols = ln.rstrip("\r\n").split("\t")
                if len(cols) >= 2:
                    bid = re.sub(r"\.fasta$", "", cols[1].strip())
                    contig_counts[bid] = contig_counts.get(bid, 0) + 1
        log(f"  [MaxBin2] contig2bin: counted contigs for {len(contig_counts)} bins.")

    records = []
    for r in rows:
        bin_id = re.sub(r"\.fasta$", "", (r.get(c_id) or "bin").strip()) if c_id else "bin"
        records.append({
            "bin_id": bin_id, "binner": "MaxBin2",
            "gc_pct": to_float(r.get(c_gc)) if c_gc else None,
            "coverage": to_float(r.get(c_cov)) if c_cov else None,
            "genome_size_mb": (round(to_float(r.get(c_size)) / 1e6, 3)
                               if c_size and to_float(r.get(c_size)) is not None else None),
            "num_contigs": contig_counts.get(bin_id),
        })
    log(f"  [MaxBin2] parsed {len(records)} bins.")
    return records


# ---- SECTION C-H: stats, outliers, document ---------------------------------
def panel_stats(points):
    covs = [p["coverage"] for p in points if p["coverage"]]
    gcs = [p["gc_pct"] for p in points if p["gc_pct"] is not None]
    sizes = [p["genome_size_mb"] for p in points if p["genome_size_mb"] is not None]
    ctgs = [p["num_contigs"] for p in points if p["num_contigs"] is not None]
    return {
        "n_bins": len(points),
        "median_gc": round(statistics.median(gcs), 1) if gcs else None,
        "median_cov": round(statistics.median(covs), 2) if covs else None,
        "min_cov": round(min(covs), 2) if covs else None,
        "max_cov": round(max(covs), 2) if covs else None,
        "median_gs_mb": round(statistics.median(sizes), 2) if sizes else None,
        "total_contigs": sum(ctgs) if ctgs else 0,
    }


def flag_outliers(points):
    logs = [math.log10(p["coverage"]) for p in points if p["coverage"] and p["coverage"] > 0]
    sizes = [p["genome_size_mb"] for p in points if p["genome_size_mb"] is not None]
    cov_mean = statistics.mean(logs) if logs else 0.0
    cov_sd = statistics.stdev(logs) if len(logs) > 1 else 0.0
    gs_mean = statistics.mean(sizes) if sizes else 0.0
    gs_sd = statistics.stdev(sizes) if len(sizes) > 1 else 0.0
    for p in points:
        out = False
        if p["coverage"] and p["coverage"] > 0 and cov_sd > 0:
            if abs(math.log10(p["coverage"]) - cov_mean) > SD_THRESHOLD * cov_sd:
                out = True
        if p["genome_size_mb"] is not None and gs_sd > 0:
            if abs(p["genome_size_mb"] - gs_mean) > SD_THRESHOLD * gs_sd:
                out = True
        p["is_outlier"] = out
        m = re.search(r"\d+$", p["bin_id"])
        p["label"] = "#" + m.group(0) if m else "#?"
    return points


def build_document(binning_sample_dir, sample_id, log):
    metabat2 = parse_metabat2(os.path.join(binning_sample_dir, "metabat2"), sample_id, log)
    maxbin2 = parse_maxbin2(os.path.join(binning_sample_dir, "maxbin2"),
                            binning_sample_dir, sample_id, log)

    # combine + validate (require gc, coverage>0)
    def clean(recs):
        return [r for r in recs
                if r["gc_pct"] is not None and r["coverage"] and r["coverage"] > 0]

    panels_pts = {"MaxBin2": clean(maxbin2), "MetaBAT2": clean(metabat2)}
    all_pts = panels_pts["MaxBin2"] + panels_pts["MetaBAT2"]
    if not all_pts:
        raise RuntimeError("No valid bins parsed from either binner.")

    gc_vals = [p["gc_pct"] for p in all_pts]
    size_vals = [p["genome_size_mb"] for p in all_pts if p["genome_size_mb"] is not None]
    gc_range = [math.floor(min(gc_vals)), math.ceil(max(gc_vals))]
    size_min, size_max = (min(size_vals), max(size_vals)) if size_vals else (0, 1)

    panels = {}
    for name in ("MaxBin2", "MetaBAT2"):
        pts = flag_outliers(panels_pts[name])
        st = panel_stats(pts)
        panels[name] = {
            "stats": st,
            "crosshair": {"med_gc": st["median_gc"], "med_cov": st["median_cov"]},
            "points": [{
                "bin_id": p["bin_id"], "label": p["label"],
                "gc_pct": p["gc_pct"], "coverage": p["coverage"],
                "genome_size_mb": p["genome_size_mb"],
                "num_contigs": p["num_contigs"], "is_outlier": p["is_outlier"],
            } for p in pts],
        }
        log(f"  [{name}] {st['n_bins']} bins, "
            f"{sum(1 for p in pts if p['is_outlier'])} outliers flagged.")

    # nice size-legend breaks (2-4 round values within range)
    def size_breaks(lo, hi):
        span = hi - lo or 1
        raw = span / 3
        mag = 10 ** math.floor(math.log10(raw)) if raw > 0 else 1
        step = (1 if raw / mag < 1.5 else 2 if raw / mag < 3.5 else 5) * mag
        b, v = [], math.ceil(lo / step) * step
        while v <= hi and len(b) < 5:
            b.append(round(v, 2)); v += step
        return b or [round(hi, 2)]

    return {
        "meta": {
            "title": "Binning QC — GC% vs Coverage",
            "sample_id": sample_id,
            "subtitle": ("Each point = one bin  •  colour = GC content  •  "
                         "size = genome size  •  dashed crosshairs = per-panel medians  •  "
                         "labelled points = \u00B12 SD outliers"),
            "caption": "",
            "schema_version": SCHEMA_VERSION,
            "generated_utc": datetime.datetime.now(datetime.timezone.utc)
                                       .strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "layout": {
            "panels": ["MaxBin2", "MetaBAT2"],   # render order: index 0 = TOP panel
            "arrangement": "vertical",           # frontend hint: stack panels in rows
            "stats_placement": "outside_right",  # frontend hint: stats boxes outside axes
            "gc": {"colorscale": PLASMA, "range": gc_range, "label": "GC Content (%)"},
            "size": {"range_px": SIZE_RANGE_PX, "ref_min": round(size_min, 2),
                     "ref_max": round(size_max, 2), "breaks": size_breaks(size_min, size_max),
                     "label": "Genome Size (Mb)"},
            "crosshair_color": "#B0BEC5",
            "panel_header_bg": "#1A237E",
            "x_log": True,
        },
        "panels": panels,
    }


def write_tsv(doc, path):
    cols = ["bin_id", "binner", "gc_pct", "coverage", "genome_size_mb",
            "num_contigs", "is_outlier"]
    with open(path, "w", newline="") as fh:
        w = csv.writer(fh, delimiter="\t")
        w.writerow(cols)
        for name in doc["layout"]["panels"]:
            for p in doc["panels"][name]["points"]:
                w.writerow([p["bin_id"], name, p["gc_pct"], p["coverage"],
                            p["genome_size_mb"], p["num_contigs"], p["is_outlier"]])


def main(argv):
    if len(argv) != 3:
        sys.stderr.write(
            f"ERROR: Expected 3 args (BINNING_SAMPLE_DIR, OUTPUT_DIR, SAMPLE_ID), got {len(argv)}.\n"
            "Usage: python3 binning_scatter_json.py <BINNING_SAMPLE_DIR> <OUTPUT_DIR> <SAMPLE_ID>\n")
        return 1

    binning_sample_dir, output_dir, sample_id = argv
    os.makedirs(output_dir, exist_ok=True)

    log = RunLog(os.path.join(output_dir, f"{sample_id}_binning_run.log"))
    log("=== binning_scatter_json.py started ===")
    log("Sample ID:", sample_id)
    log("Binning sample dir:", os.path.abspath(binning_sample_dir))
    log("Output dir:", os.path.abspath(output_dir))

    status = 0
    try:
        if not os.path.isdir(binning_sample_dir):
            raise NotADirectoryError(
                f"BINNING_SAMPLE_DIR does not exist: '{binning_sample_dir}'")
        log("STEP: Input directory validated.")

        doc = build_document(binning_sample_dir, sample_id, log)

        json_path = os.path.join(output_dir, "mag_binning_plots_data.json")
        with open(json_path, "w") as fh:
            json.dump(doc, fh, indent=2, ensure_ascii=False)
        log("STEP: JSON written:", json_path)

        tsv_path = os.path.join(output_dir, "binning_scatter_data.tsv")
        write_tsv(doc, tsv_path)
        log("STEP: companion TSV written:", tsv_path)

    except Exception as exc:
        log("ERROR:", str(exc))
        status = 1
    finally:
        log(f"=== binning_scatter_json.py finished with exit status {status} ===")
        log.close()
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
