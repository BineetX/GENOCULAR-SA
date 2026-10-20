#!/usr/bin/env python3
# ==============================================================================
# assembly_contiguity_json.py
#
# Python port of metaquast_plot.R (MAG_HR ..._assembly__contiguity.R). Parses an
# assembly FASTA + a single-assembly QUAST report.tsv and emits a plot-ready JSON
# document describing the cumulative contig-length curve (log-x rank vs cumulative
# Mbp) with L50/L90 zones, N50/N90 crosshairs and the assembly-stats box, for the
# React/Plotly frontend.
#
# Pure standard library — no pandas/numpy/biopython — so it drops into a Nextflow
# process without a heavy image. Gzip FASTA is supported transparently.
#
# EXACT CLI ARGUMENT ORDER (unchanged from the R script):
#   arg1: FASTA_FILE     assembly FASTA (.fasta/.fa/.fna, optionally .gz)
#   arg2: QUAST_REPORT   single-assembly QUAST report.tsv (2-column metric/value)
#   arg3: OUTPUT_DIR     output directory for JSON + log
#   arg4: SAMPLE_ID      sample identifier string
#
# Usage:
#   python3 assembly_contiguity_json.py <FASTA> <QUAST_REPORT> <OUTPUT_DIR> <SAMPLE_ID>
#
# Output:
#   <OUTPUT_DIR>/mag_assembly_plots_data.json    (frontend input)
#   <OUTPUT_DIR>/<SAMPLE_ID>_cumulative_run.log
# ==============================================================================

import os
import re
import sys
import gzip
import json
import datetime

SCHEMA_VERSION = "1.0"
MAX_PLOT_POINTS = 3000  # matches the R downsampling target

ZONE_COLORS = {
    "Core (rank 1 to L50)": "#1A6B8A",
    "Mid (L50 to L90)": "#2EAA7E",
    "Tail (L90 to end)": "#C0433A",
}

_LEN_TAG = re.compile(r"(?<=[Ll]en)(?:gth)?=(\d+)")


class RunLog:
    def __init__(self, path):
        self._fh = open(path, "w")

    def __call__(self, *parts):
        stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        line = "[{}] {}".format(stamp, " ".join(str(p) for p in parts))
        print(line)
        self._fh.write(line + "\n")
        self._fh.flush()

    def close(self):
        try:
            self._fh.close()
        except Exception:
            pass


def open_fasta(path):
    if path.lower().endswith(".gz"):
        return gzip.open(path, "rt", errors="replace")
    return open(path, "r", errors="replace")


def parse_fasta_lengths(path, log):
    """Return list of contig lengths. Prefer len=/length= header tags; else count
    sequence characters per record (streaming, no whole-file list)."""
    headers = []
    header_tag_lengths = []
    seq_lengths = []
    cur = 0
    n_headers = 0
    with open_fasta(path) as fh:
        for line in fh:
            if line.startswith(">"):
                if n_headers > 0:
                    seq_lengths.append(cur)
                cur = 0
                n_headers += 1
                m = _LEN_TAG.search(line)
                header_tag_lengths.append(int(m.group(1)) if m else None)
            else:
                cur += len(line.strip())
        if n_headers > 0:
            seq_lengths.append(cur)

    log(f"  Total headers found: {n_headers}")
    if n_headers == 0:
        return []

    frac_tagged = sum(1 for t in header_tag_lengths if t is not None) / n_headers
    log(f"  Header-tag coverage: {frac_tagged*100:.1f}%")
    if frac_tagged >= 0.5:
        log("  Using header-tag lengths (sufficient coverage).")
        return [t for t in header_tag_lengths if t is not None]
    log("  Header-tag coverage insufficient. Using lengths computed from sequence content.")
    return [n for n in seq_lengths if n > 0]


def read_quast(path, log):
    rows = {}
    with open(path, "r", errors="replace") as fh:
        lines = [ln.rstrip("\n") for ln in fh if ln.strip()]
    # detect column count from the first data row
    for ln in lines:
        parts = ln.split("\t")
        if len(parts) != 2:
            if len(parts) > 2:
                raise RuntimeError(
                    f"QUAST report has {len(parts)} columns; expected exactly 2 "
                    "(metric, value). This looks like a comparative metaQUAST "
                    "report. Point this script at a single-assembly report.")
            continue
        rows.setdefault(parts[0].strip(), parts[1].strip())
    log(f"  QUAST metrics parsed: {len(rows)}")

    def get(pattern):
        rx = re.compile(pattern, re.IGNORECASE)
        for k, v in rows.items():
            if rx.search(k):
                try:
                    return float(v)
                except ValueError:
                    return None
        return None

    return {
        "n50": get(r"^N50$"), "n90": get(r"^N90$"),
        "l50": get(r"^L50$"), "l90": get(r"^L90$"),
        "largest": get(r"Largest contig"),
        "total_len_bp": get(r"^Total length$"),
        "gc_pct": get(r"GC"),
        "n_contigs": get(r"# contigs$"),
    }


def downsample_indices(n_total, l50, l90):
    """Reproduce the R keep-index logic: core stride + L50/L90 neighbourhoods +
    head + tail, unioned and sorted (1-based ranks)."""
    keep = set()
    step = max(1, n_total // MAX_PLOT_POINTS)
    keep.update(range(1, n_total + 1, step))
    for lx in (l50, l90):
        if lx and 1 <= lx <= n_total:
            lx = int(lx)
            keep.update(range(max(1, lx - 50), min(n_total, lx + 50) + 1))
    keep.update(range(1, min(500, n_total) + 1))
    keep.update(range(max(1, n_total - 500), n_total + 1))
    return sorted(keep)


def build_document(fasta_file, quast_report, sample_id, log):
    log("Reading FASTA (gzip-aware)...")
    lengths = parse_fasta_lengths(fasta_file, log)
    if not lengths:
        raise RuntimeError("No contig lengths parsed from FASTA.")
    log(f"  Parsed {len(lengths)} contig lengths.")

    log("Parsing QUAST report...")
    q = read_quast(quast_report, log)
    log(f"  N50={q['n50']} N90={q['n90']} L50={q['l50']} L90={q['l90']} "
        f"Largest={q['largest']} Total={q['total_len_bp']} GC={q['gc_pct']} "
        f"#contigs={q['n_contigs']}")

    lengths.sort(reverse=True)
    n_all = len(lengths)
    n_contigs = q["n_contigs"]
    if n_contigs and 0 < n_contigs <= n_all:
        n = int(n_contigs)
        if n < n_all:
            log(f"  FASTA has {n_all} contigs; QUAST reports {n}. Restricting to "
                f"the {n} longest to match QUAST statistics.")
        lengths = lengths[:n]
    else:
        log("  QUAST '# contigs' unavailable/inconsistent; using all FASTA contigs.")

    n_total = len(lengths)
    # cumulative sum (bp -> Mbp)
    cum = []
    running = 0
    for L in lengths:
        running += L
        cum.append(running)
    total_assembly_mbp = running / 1e6

    keep = downsample_indices(n_total, q["l50"], q["l90"])
    curve = [{"rank": r, "cumsum_mbp": round(cum[r - 1] / 1e6, 4)} for r in keep]
    log(f"  Downsampled to {len(curve)} plotting points from {n_total} contigs.")

    l50 = int(q["l50"]) if q["l50"] else None
    l90 = int(q["l90"]) if q["l90"] else None

    def bp(v):
        return f"{int(round(v)):,}" if v is not None else "NA"

    vlines = []
    if l50:
        vlines.append({"x": l50, "color": "#1A3A5C",
                       "label": f"N50 = {bp(q['n50'])} bp (L50 = {bp(l50)})"})
    if l90:
        vlines.append({"x": l90, "color": "#6A3C2A",
                       "label": f"N90 = {bp(q['n90'])} bp (L90 = {bp(l90)})"})

    subtitle = (f"Sample ID: {sample_id} | "
                f"Total assembly: {total_assembly_mbp:.2f} Mbp | "
                f"{bp(n_contigs) if n_contigs else n_total} contigs")

    return {
        "meta": {
            "title": "Cumulative Contig Length Assembly Curve",
            "sample_id": sample_id,
            "subtitle": subtitle,
            "x_title": "Contig Rank (log10 scale, sorted by decreasing length)",
            "y_title": "Cumulative Assembly Size (Mbp)",
            "schema_version": SCHEMA_VERSION,
            "generated_utc": datetime.datetime.now(datetime.timezone.utc)
                                       .strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "stats": {
            "total_length_mbp": round(q["total_len_bp"] / 1e6, 2) if q["total_len_bp"] else None,
            "total_assembly_mbp": round(total_assembly_mbp, 2),
            "n_contigs": int(n_contigs) if n_contigs else n_total,
            "largest_contig_bp": int(q["largest"]) if q["largest"] else None,
            "n50_bp": int(q["n50"]) if q["n50"] else None,
            "n90_bp": int(q["n90"]) if q["n90"] else None,
            "l50": l50, "l90": l90,
            "gc_pct": round(q["gc_pct"], 2) if q["gc_pct"] else None,
        },
        "layout": {
            "x_log": True,
            "zone_colors": ZONE_COLORS,
            "zone_breaks": {"l50": l50 or int(n_total * 0.12),
                            "l90": l90 or int(n_total * 0.57), "end": n_total},
            "vlines": vlines,
        },
        "curve": curve,
    }


def main(argv):
    if len(argv) != 4:
        sys.stderr.write(
            f"ERROR: Expected 4 args (FASTA, QUAST_REPORT, OUTPUT_DIR, SAMPLE_ID), got {len(argv)}.\n"
            "Usage: python3 assembly_contiguity_json.py <FASTA> <QUAST_REPORT> <OUTPUT_DIR> <SAMPLE_ID>\n")
        return 1

    fasta_file, quast_report, output_dir, sample_id = argv
    os.makedirs(output_dir, exist_ok=True)

    log = RunLog(os.path.join(output_dir, f"{sample_id}_cumulative_run.log"))
    log("Script: assembly_contiguity_json.py")
    log("Sample ID:", sample_id)
    log("FASTA:", fasta_file)
    log("QUAST report:", quast_report)
    log("Output dir:", output_dir)

    status = 0
    try:
        if not os.path.isfile(fasta_file):
            raise FileNotFoundError(f"Assembly FASTA does not exist: {fasta_file}")
        if not os.path.isfile(quast_report):
            raise FileNotFoundError(f"QUAST report does not exist: {quast_report}")
        doc = build_document(fasta_file, quast_report, sample_id, log)
        json_path = os.path.join(output_dir, "mag_assembly_plots_data.json")
        with open(json_path, "w") as fh:
            json.dump(doc, fh, indent=2, ensure_ascii=False)
        log("JSON written ->", json_path)
        log("Script completed successfully.")
    except Exception as exc:
        log("ERROR:", str(exc))
        status = 1
    finally:
        log.close()
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
