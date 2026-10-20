#!/usr/bin/env python3
# ==============================================================================
# virsorter2_json.py
#
# Python port of virsorter2_new.R (Plot 1).  Reads VirSorter2 final-viral-score
# (and boundary) TSVs for one sample and emits a single plot-ready JSON document
# describing the max_score distribution histogram coloured by viral group, for
# the React/Plotly frontend.
#
# Pure standard library — no pandas — so it drops into a Nextflow process
# without a heavy conda/container image.
#
# CLI ARGUMENTS — two accepted forms:
#
#   (A) DIRECTORY form (3 args, recommended — matches the rest of the pipeline):
#         python3 virsorter2_json.py <VIRSORTER2_DIR> <OUTPUT_DIR> <SAMPLE_ID>
#       where <VIRSORTER2_DIR> is the per-sample virsorter2 folder containing
#       final-viral-score.tsv and final-viral-boundary.tsv. The script locates
#       both TSVs inside it.
#
#   (B) EXPLICIT form (4 args, original order — unchanged from the R script):
#         python3 virsorter2_json.py <SCORE_TSV> <OUTPUT_DIR> <BOUNDARY_TSV> <SAMPLE_ID>
#       (If arg1 is a directory, the two TSVs are still resolved from inside it.)
#
# Output:
#   <OUTPUT_DIR>/mag_virsorter2_plots_data.json   (frontend input)
#   <OUTPUT_DIR>/<SAMPLE_ID>_virsorter2_run.log
#
# NOTE: sample_id is NOT rendered in the plot (title/subtitle/caption never
# include it); it is used only for the run-log filename and is carried in
# meta.sample_id for the frontend's export filename.
#
# Empty score file is a valid biological outcome (no viral sequences): the script
# logs it and writes an empty-but-valid JSON, exiting 0 (mirrors the R behaviour).
# ==============================================================================

import os
import sys
import csv
import json
import math
import datetime

SCHEMA_VERSION = "1.0"
BINWIDTH = 0.05

SCORE_FILENAME = "final-viral-score.tsv"
BOUNDARY_FILENAME = "final-viral-boundary.tsv"

KNOWN_GROUPS = ["dsDNAphage", "ssDNA", "RNA", "NCLDV", "lavidaviridae"]
GROUP_ORDER = KNOWN_GROUPS + ["Unclassified"]
PALETTE = {
    "dsDNAphage": "#E69F00", "ssDNA": "#56B4E9", "RNA": "#009E73",
    "NCLDV": "#D55E00", "lavidaviridae": "#CC79A7", "Unclassified": "#999999",
}


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
    with open(path, "r", errors="replace") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        return [dict(r) for r in reader], (reader.fieldnames or [])


def to_float(x):
    try:
        v = float(str(x).strip())
    except (ValueError, TypeError):
        return None
    # Reject NaN/inf: float("NaN") succeeds and is NOT None, so without this it
    # would slip past the None-guard and be written as the bare token `NaN`.
    # Python's json accepts that, but the browser's JSON.parse rejects it,
    # breaking the frontend fetch. Treat non-finite as missing (row dropped).
    if not math.isfinite(v):
        return None
    return v


def resolve_inputs(argv):
    """Map the accepted CLI forms onto (score_tsv, output_dir, boundary_tsv,
    sample_id). Returns None on an unusable argument count.

    Form A (3 args): <VIRSORTER2_DIR> <OUTPUT_DIR> <SAMPLE_ID>
    Form B (4 args): <SCORE_TSV|VIRSORTER2_DIR> <OUTPUT_DIR> <BOUNDARY_TSV> <SAMPLE_ID>
    In both, if the first argument is a directory, the two TSVs are resolved
    from the standard filenames inside it.
    """
    if len(argv) == 3:
        first, output_dir, sample_id = argv
        score_tsv = os.path.join(first, SCORE_FILENAME)
        boundary_tsv = os.path.join(first, BOUNDARY_FILENAME)
        return score_tsv, output_dir, boundary_tsv, sample_id

    if len(argv) == 4:
        first, output_dir, boundary_arg, sample_id = argv
        if os.path.isdir(first):
            score_tsv = os.path.join(first, SCORE_FILENAME)
            boundary_tsv = os.path.join(first, BOUNDARY_FILENAME)
        else:
            score_tsv, boundary_tsv = first, boundary_arg
        return score_tsv, output_dir, boundary_tsv, sample_id

    return None


def empty_doc(sample_id):
    return {
        "meta": {
            "title": "VirSorter2 Score Distribution by Viral Group",
            "sample_id": sample_id,
            "subtitle": "Total sequences: 0",
            "caption": "No viral sequences were recovered for this sample.",
            "n_total": 0, "n_high_conf": 0, "n_mixed_conf": 0,
            "empty": True,
            "schema_version": SCHEMA_VERSION,
            "generated_utc": datetime.datetime.now(datetime.timezone.utc)
                                       .strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "layout": {
            "colors": PALETTE, "group_order": [], "binwidth": BINWIDTH,
            "x_range": [0, 1],
            "cutoffs": [
                {"value": 0.5, "label": "Sensitivity cutoff (0.5)", "dash": "dash"},
                {"value": 0.9, "label": "High-confidence cutoff (0.9)", "dash": "dot"},
            ],
            "x_title": "Maximum classifier score (max_score)",
            "y_title": "Number of sequences (count)",
        },
        "sequences": [],
    }


def build_document(score_tsv, boundary_tsv, sample_id, log):
    rows, header = read_tsv(score_tsv)
    log(f"STEP: read FINAL_VIRAL_SCORE_TSV. Row count = {len(rows)}, Column count = {len(header)}")

    # boundary TSV validated + logged, not plotted
    if boundary_tsv and os.path.isfile(boundary_tsv):
        brows, _ = read_tsv(boundary_tsv)
        log(f"STEP: read FINAL_VIRAL_BOUNDARY_TSV successfully. Row count = {len(brows)} "
            f"(not directly plotted).")
    else:
        log("WARNING: FINAL_VIRAL_BOUNDARY_TSV not found or not provided; continuing.")

    if not rows:
        log("RESULT: final-viral-score.tsv has zero rows. No viral sequences recovered.")
        return empty_doc(sample_id), True

    required = ["max_score", "max_score_group"]
    missing = [c for c in required if c not in header]
    if missing:
        raise RuntimeError(f"Malformed input: required column(s) missing: {missing}")

    # coerce max_score numeric; drop NAs
    seqs = []
    n_dropped = 0
    for r in rows:
        v = to_float(r.get("max_score"))
        if v is None:
            n_dropped += 1
            continue
        raw = (r.get("max_score_group") or "").strip()
        group = raw if raw in KNOWN_GROUPS else "Unclassified"
        seqs.append({"max_score": round(v, 4), "group": group})
    if n_dropped:
        log(f"WARNING: dropped {n_dropped} row(s) with non-numeric/NA max_score.")

    n_unexpected = sum(1 for s in seqs if s["group"] == "Unclassified")
    if n_unexpected:
        log(f"WARNING: {n_unexpected} row(s) had blank/unexpected max_score_group; "
            f"binned into 'Unclassified'.")

    if not seqs:
        log("RESULT: no valid rows after cleaning.")
        return empty_doc(sample_id), True

    total = len(seqs)
    n_high = sum(1 for s in seqs if s["max_score"] >= 0.9)
    n_mixed = sum(1 for s in seqs if 0.5 <= s["max_score"] <= 0.8)
    n_gap = sum(1 for s in seqs if 0.8 < s["max_score"] < 0.9)
    log(f"STEP: tiers — High(>=0.9)={n_high}; Mixed(0.5-0.8)={n_mixed}; "
        f"Gap(0.8-0.9)={n_gap}; Total={total}")

    present = [g for g in GROUP_ORDER if any(s["group"] == g for s in seqs)]

    doc = {
        "meta": {
            "title": "VirSorter2 Score Distribution by Viral Group",
            "sample_id": sample_id,
            "subtitle": f"Total sequences: {total}",
            "caption": (f"High-confidence (≥ 0.9): {n_high}  |  "
                        f"Mixed/moderate (0.5 - 0.8): {n_mixed}"),
            "n_total": total, "n_high_conf": n_high, "n_mixed_conf": n_mixed,
            "empty": False,
            "schema_version": SCHEMA_VERSION,
            "generated_utc": datetime.datetime.now(datetime.timezone.utc)
                                       .strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "layout": {
            "colors": PALETTE, "group_order": present, "binwidth": BINWIDTH,
            "x_range": [0, 1],
            "cutoffs": [
                {"value": 0.5, "label": "Sensitivity cutoff (0.5)", "dash": "dash"},
                {"value": 0.9, "label": "High-confidence cutoff (0.9)", "dash": "dot"},
            ],
            "x_title": "Maximum classifier score (max_score)",
            "y_title": "Number of sequences (count)",
        },
        "sequences": seqs,
    }
    return doc, False


def main(argv):
    resolved = resolve_inputs(argv)
    if resolved is None:
        sys.stderr.write(
            f"[FATAL] Expected 3 or 4 positional arguments, got {len(argv)}.\n"
            "Usage (directory form, recommended):\n"
            "  python3 virsorter2_json.py <VIRSORTER2_DIR> <OUTPUT_DIR> <SAMPLE_ID>\n"
            "Usage (explicit form):\n"
            "  python3 virsorter2_json.py <SCORE_TSV> <OUTPUT_DIR> <BOUNDARY_TSV> <SAMPLE_ID>\n")
        return 1

    score_tsv, output_dir, boundary_tsv, sample_id = resolved
    os.makedirs(output_dir, exist_ok=True)

    log = RunLog(os.path.join(output_dir, f"{sample_id}_virsorter2_run.log"))
    log("=== virsorter2_json.py run started ===")
    log("Sample ID:", sample_id)
    log("Score TSV:", score_tsv)
    log("Boundary TSV:", boundary_tsv)
    log("Output dir:", output_dir)

    status = 0
    try:
        if not os.path.isfile(score_tsv):
            raise FileNotFoundError(f"FINAL_VIRAL_SCORE_TSV does not exist: '{score_tsv}'")

        doc, is_empty = build_document(score_tsv, boundary_tsv, sample_id, log)

        json_path = os.path.join(output_dir, "mag_virsorter2_plots_data.json")
        with open(json_path, "w") as fh:
            # allow_nan=False -> raise on any NaN/inf rather than emit tokens the
            # browser's JSON.parse cannot read (guards against future leaks).
            json.dump(doc, fh, indent=2, ensure_ascii=False, allow_nan=False)
        log("STEP: JSON written ->", json_path)
        if is_empty:
            log("=== finished (no viral sequences; empty-but-valid JSON written) ===")
        else:
            log("=== virsorter2_json.py run finished successfully ===")

    except Exception as exc:
        log("[FATAL ERROR]", str(exc))
        status = 1
    finally:
        log.close()
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
