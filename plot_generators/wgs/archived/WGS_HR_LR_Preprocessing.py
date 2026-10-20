#!/usr/bin/env python3
"""
Long-read WGS preprocessing QC JSON Generator.
Auto-detects raw and filtered long-read FASTQ files in the current working directory,
computes metrics (lengths, N50, quality, GC, summary table), and exports to JSON.
"""

import gzip
import json
import re
import warnings
from datetime import datetime
from pathlib import Path
import numpy as np

warnings.filterwarnings("ignore")

def find_one(cwd, patterns, label):
    matches = set()
    for pat in patterns:
        matches.update(cwd.glob(pat))
        matches.update(cwd.glob(pat.upper()))
    matches = sorted(matches)
    if len(matches) == 0:
        raise FileNotFoundError(
            f"Could not find the {label} long-read FASTQ file in\n{cwd}\n"
            f"(looked for patterns like: {', '.join(patterns)})"
        )
    if len(matches) > 1:
        raise FileNotFoundError(
            f"Found more than one candidate {label} FASTQ file in\n{cwd}:\n  "
            + "\n  ".join(m.name for m in matches)
        )
    return matches[0]

def _opener(path):
    return gzip.open(path, "rt") if str(path).endswith(".gz") else open(path, "r")

def parse_fastq(path):
    lengths, quals, gc, times = [], [], [], []
    time_re = re.compile(r"start_time=([0-9T:\.\-Zz]+)")
    
    with _opener(path) as f:
        while True:
            header = f.readline()
            if not header:
                break
            seq = f.readline().rstrip("\n")
            f.readline()  # '+' separator
            qual = f.readline().rstrip("\n")
            if not seq or not qual:
                break
            n = len(seq)
            lengths.append(n)
            q = np.frombuffer(qual.encode("ascii"), dtype=np.uint8).astype(np.float64) - 33
            quals.append(float(q.mean()) if q.size else 0.0)
            if n:
                s = seq.upper()
                gc.append(100.0 * (s.count("G") + s.count("C")) / n)
            else:
                gc.append(0.0)
                
            # Parse timestamp if present
            m = time_re.search(header)
            if m:
                ts = m.group(1)
                if ts.endswith(("Z", "z")):
                    ts = ts[:-1] + "+00:00"
                try:
                    times.append(datetime.fromisoformat(ts))
                except ValueError:
                    times.append(None)
            else:
                times.append(None)
                
    return np.array(lengths), np.array(quals), np.array(gc), times

def n50(lengths):
    if len(lengths) == 0:
        return 0
    s = np.sort(lengths)[::-1]
    c = np.cumsum(s)
    return int(s[np.searchsorted(c, c[-1] / 2)])

def summarize(lengths, quals):
    return {
        "n_reads": int(len(lengths)),
        "total_bases": int(lengths.sum()) if len(lengths) else 0,
        "mean_len": float(lengths.mean()) if len(lengths) else 0.0,
        "median_len": float(np.median(lengths)) if len(lengths) else 0.0,
        "n50": n50(lengths),
        "mean_qual": float(quals.mean()) if len(quals) else 0.0,
        "median_qual": float(np.median(quals)) if len(quals) else 0.0,
    }

def generate_longread_qc_json(outdir="."):
    cwd = Path.cwd()
    outdir_path = Path(outdir)
    outdir_path.mkdir(parents=True, exist_ok=True)

    raw_file = find_one(
        cwd,
        ["*_R0.fastq", "*_R0.fastq.gz", "*_R0.fq", "*_R0.fq.gz", "*raw*.fastq", "*raw*.fastq.gz", "*raw*.fq", "*raw*.fq.gz"],
        "raw",
    )
    filt_file = find_one(
        cwd,
        ["*_filtered.fastq", "*_filtered.fastq.gz", "*_filtered.fq", "*_filtered.fq.gz", "*filt*.fastq", "*filt*.fastq.gz", "*filt*.fq", "*filt*.fq.gz"],
        "filtered",
    )

    print(f"Parsing raw long reads: {raw_file.name}")
    raw_len, raw_qual, raw_gc, raw_times = parse_fastq(raw_file)
    print(f"Parsing filtered long reads: {filt_file.name}")
    filt_len, filt_qual, filt_gc, filt_times = parse_fastq(filt_file)

    raw_s = summarize(raw_len, raw_qual)
    filt_s = summarize(filt_len, filt_qual)

    sample_name = raw_file.stem.replace(".fastq", "").split("_R0")[0].split("_raw")[0]

    # Histogram data for read lengths (log scale bins)
    all_len = np.concatenate([a for a in (raw_len, filt_len) if len(a)])
    lo = max(1, int(all_len.min())) if len(all_len) else 1
    hi = int(all_len.max()) if len(all_len) else 10
    bins_len = np.logspace(np.log10(lo), np.log10(max(hi, lo + 1)), 60)
    
    raw_hist_len, _ = np.histogram(raw_len, bins=bins_len)
    filt_hist_len, _ = np.histogram(filt_len, bins=bins_len)
    bin_centers_len = (bins_len[:-1] + bins_len[1:]) / 2

    # Histogram data for qualities
    qmax = max(5.0, float(np.ceil(np.concatenate([a for a in (raw_qual, filt_qual) if len(a)]).max()))) if len(raw_len) or len(filt_len) else 30.0
    bins_q = np.linspace(0, qmax, 61)
    raw_hist_q, _ = np.histogram(raw_qual, bins=bins_q)
    filt_hist_q, _ = np.histogram(filt_qual, bins=bins_q)
    bin_centers_q = (bins_q[:-1] + bins_q[1:]) / 2

    # Histogram data for GC content
    bins_gc = np.linspace(0, 100, 51)
    raw_hist_gc, _ = np.histogram(raw_gc, bins=bins_gc)
    filt_hist_gc, _ = np.histogram(filt_gc, bins=bins_gc)
    bin_centers_gc = (bins_gc[:-1] + bins_gc[1:]) / 2

    raw_gc_mean = float(raw_gc.mean()) if len(raw_gc) else 0.0
    filt_gc_mean = float(filt_gc.mean()) if len(filt_gc) else 0.0

    # Optional sequencing yield over time calculation
    def yield_over_time(lengths, times):
        pairs = [(t, l) for t, l in zip(times, lengths) if t is not None]
        if len(pairs) < max(10, 0.5 * len(lengths)):
            return None
        pairs.sort(key=lambda p: p[0])
        t0 = pairs[0][0]
        hours = np.array([(t - t0).total_seconds() / 3600.0 for t, _ in pairs])
        bases = np.array([l for _, l in pairs])
        return hours.tolist(), np.cumsum(bases).tolist()

    raw_ty = yield_over_time(raw_len, raw_times)
    filt_ty = yield_over_time(filt_len, filt_times)

    yield_data = None
    if raw_ty is not None or filt_ty is not None:
        yield_data = {
            "raw": {"hours": raw_ty[0], "cumulative_bases": raw_ty[1]} if raw_ty else None,
            "filtered": {"hours": filt_ty[0], "cumulative_bases": filt_ty[1]} if filt_ty else None
        }

    payload = {
        "metadata": {
            "sample": sample_name,
            "description": "Long-read WGS preprocessing QC metrics (raw vs filtered)[cite: 7]."
        },
        "read_length_distribution": {
            "data": [
                {"name": "Raw reads", "x": bin_centers_len.tolist(), "y": raw_hist_len.tolist(), "type": "bar", "marker": {"color": "#D62728"}},
                {"name": "Filtered reads", "x": bin_centers_len.tolist(), "y": filt_hist_len.tolist(), "type": "bar", "marker": {"color": "#1F77B4"}}
            ],
            "n50": {"raw": raw_s["n50"], "filtered": filt_s["n50"]},
            "layout": {"title": f"Read length distribution: {sample_name}", "xaxis": {"title": "Read length (bp)", "type": "log"}, "yaxis": {"title": "Read count"}}
        },
        "read_quality_distribution": {
            "data": [
                {"name": "Raw reads", "x": bin_centers_q.tolist(), "y": raw_hist_q.tolist(), "type": "bar", "marker": {"color": "#D62728"}},
                {"name": "Filtered reads", "x": bin_centers_q.tolist(), "y": filt_hist_q.tolist(), "type": "bar", "marker": {"color": "#1F77B4"}}
            ],
            "mean_quality": {"raw": raw_s["mean_qual"], "filtered": filt_s["mean_qual"]},
            "layout": {"title": f"Per-read quality distribution: {sample_name}", "xaxis": {"title": "Mean per-read Phred quality score"}, "yaxis": {"title": "Read count"}}
        },
        "gc_content_distribution": {
            "data": [
                {"name": "Raw reads", "x": bin_centers_gc.tolist(), "y": raw_hist_gc.tolist(), "type": "bar", "marker": {"color": "#D62728"}},
                {"name": "Filtered reads", "x": bin_centers_gc.tolist(), "y": filt_hist_gc.tolist(), "type": "bar", "marker": {"color": "#1F77B4"}}
            ],
            "layout": {"title": f"Per-read GC content distribution: {sample_name}", "xaxis": {"title": "GC content (%)"}, "yaxis": {"title": "Read count"}}
        },
        "sequencing_yield_over_time": yield_data,
        "summary_statistics": [
            {"metric": "Reads", "raw": f"{raw_s['n_reads']:,}", "filtered": f"{filt_s['n_reads']:,}"},
            {"metric": "Total bases", "raw": f"{raw_s['total_bases']:,}", "filtered": f"{filt_s['total_bases']:,}"},
            {"metric": "N50 (bp)", "raw": f"{raw_s['n50']:,}", "filtered": f"{filt_s['n50']:,}"},
            {"metric": "Mean length (bp)", "raw": f"{raw_s['mean_len']:.0f}", "filtered": f"{filt_s['mean_len']:.0f}"},
            {"metric": "Median length (bp)", "raw": f"{raw_s['median_len']:.0f}", "filtered": f"{filt_s['median_len']:.0f}"},
            {"metric": "Mean quality (Q)", "raw": f"{raw_s['mean_qual']:.1f}", "filtered": f"{filt_s['mean_qual']:.1f}"},
            {"metric": "Median quality (Q)", "raw": f"{raw_s['median_qual']:.1f}", "filtered": f"{filt_s['median_qual']:.1f}"},
            {"metric": "Mean GC (%)", "raw": f"{raw_gc_mean:.1f}", "filtered": f"{filt_gc_mean:.1f}"}
        ]
    }

    out_json = outdir_path / "long_read_preprocessing_qc.json"
    with open(out_json, "w") as f:
        json.dump(payload, f, indent=4)
    print(f"Successfully generated: {out_json}")

if __name__ == "__main__":
    generate_longread_qc_json()
