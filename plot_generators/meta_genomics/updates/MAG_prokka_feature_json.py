#!/usr/bin/env python3
# ==============================================================================
# prokka_feature_json.py
#
# Python port of prokka_new.R. Parses Prokka per-MAG summary files for one
# metagenomic sample and emits a single plot-ready JSON document (consumed by
# the React/Plotly frontend). Pure standard library -- no pandas/numpy -- so it
# drops straight into a Nextflow process without a heavy conda/container image.
#
# EXPECTED CLI ARGUMENT ORDER (positional, exactly 3 -- matches the R script):
#   arg1: PROKKA_SAMPLE_DIR  - dir with one subfolder per MAG/bin, each holding a
#                              <mag_id>.txt Prokka summary
#   arg2: OUTPUT_DIR         - where the JSON (+ log, + optional TSV) is written
#   arg3: SAMPLE_ID          - sample identifier, used verbatim
#
# Usage:
#   python3 prokka_feature_json.py <PROKKA_SAMPLE_DIR> <OUTPUT_DIR> <SAMPLE_ID>
#
# Output:
#   <OUTPUT_DIR>/<SAMPLE_ID>_prokka_feature_composition.json   (frontend input)
#   <OUTPUT_DIR>/<SAMPLE_ID>_prokka_feature_composition_table.tsv
#   <OUTPUT_DIR>/<SAMPLE_ID>_prokka_run.log
# ==============================================================================

import os
import sys
import re
import csv
import json
import glob
import datetime

# ---- Constants (kept identical to the R implementation) ---------------------
FIELDS_OF_INTEREST = ["CDS", "gene", "tRNA", "rRNA", "tmRNA", "repeat_region"]

# Display names used on the plot (keys the frontend iterates over)
DISPLAY = {
    "CDS": "CDS",
    "other_genes": "Other/Pseudogenes",
    "tRNA": "tRNA",
    "rRNA": "rRNA",
    "tmRNA": "tmRNA",
    "repeat_region": "Repeat Regions",
}

FEATURE_COLORS = {
    "CDS": "#FFDC00",
    "Other/Pseudogenes": "#85144B",
    "tRNA": "#C2E7B9",
    "rRNA": "#FF4136",
    "tmRNA": "#001F3F",
    "Repeat Regions": "#0074D9",
}

# stacking order outward from the zero line, legend order (top->bottom)
RIGHT_ORDER  = ["CDS", "Other/Pseudogenes"]
LEFT_ORDER   = ["tmRNA", "rRNA", "Repeat Regions", "tRNA"]
LEGEND_ORDER = ["tRNA", "rRNA", "tmRNA", "Repeat Regions", "Other/Pseudogenes", "CDS"]

NICE_MULTIPLIERS = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10, 15, 20, 25, 50, 100, 250, 500, 1000]

SCHEMA_VERSION = "1.0"


# ---- Small logging helper (mirrors the R run log) ---------------------------
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


def parse_prokka_txt(txt_path):
    """Return a dict of the fields of interest, defaulting missing keys to 0."""
    result = {k: 0 for k in FIELDS_OF_INTEREST}
    try:
        with open(txt_path, "r", errors="replace") as fh:
            lines = fh.readlines()
    except Exception:
        return result

    for ln in lines:
        parts = ln.split(":", 1)
        if len(parts) == 2:
            key = parts[0].strip()
            raw = parts[1].strip()
            if key in FIELDS_OF_INTEREST:
                try:
                    result[key] = int(float(raw))
                except ValueError:
                    pass
    return result


def compute_scale_factor(right_max, left_raw_max):
    """Nearest 'nice' multiplier so the RNA/repeat side reads at ~65% of the
    gene side. Identical logic to the R script."""
    if left_raw_max <= 0 or right_max <= 0:
        return 1
    target = (right_max * 0.65) / left_raw_max
    if target <= 0:
        return 1
    return min(NICE_MULTIPLIERS, key=lambda m: abs(m - target))


def build_document(prokka_sample_dir, sample_id, log):
    # -- discover MAG subfolders --
    mag_dirs = sorted(
        d for d in glob.glob(os.path.join(prokka_sample_dir, "*")) if os.path.isdir(d)
    )
    log("STEP: Found {} candidate MAG subfolder(s).".format(len(mag_dirs)))

    records = []
    n_fallback = 0
    for mdir in mag_dirs:
        mag_id = os.path.basename(mdir.rstrip("/"))
        expected = os.path.join(mdir, mag_id + ".txt")
        txt_path = None

        if os.path.isfile(expected):
            txt_path = expected
        else:
            candidates = sorted(glob.glob(os.path.join(mdir, "*.txt")))
            if candidates:
                txt_path = candidates[0]
                n_fallback += 1
                log("WARNING: Expected summary missing for MAG '{}'. Falling back to '{}'."
                    .format(mag_id, os.path.basename(txt_path)))

        if txt_path is None:
            log("WARNING: No .txt summary for MAG '{}'. Skipping.".format(mag_id))
            continue

        parsed = parse_prokka_txt(txt_path)
        parsed["MAG_ID"] = mag_id
        parsed["other_genes"] = max(parsed["gene"] - parsed["CDS"], 0)
        records.append(parsed)

    log("STEP: Parsing complete. {} MAG(s) parsed. {} fallback(s).".format(len(records), n_fallback))

    # -- sort ascending by CDS, assign Bin labels ONCE --
    records.sort(key=lambda r: r["CDS"])
    n_bins = len(records)
    pad = 3 if n_bins > 99 else 2
    for i, r in enumerate(records, start=1):
        r["Bin_Label"] = "Bin{:0{w}d}".format(i, w=pad)

    # -- dual-scale multiplier --
    right_max = max((r["CDS"] + r["other_genes"] for r in records), default=0)
    left_raw_max = max((r["tRNA"] + r["rRNA"] + r["tmRNA"] + r["repeat_region"] for r in records),
                       default=0)
    scale_factor = compute_scale_factor(right_max, left_raw_max)
    log("STEP: scale_factor = {} (right_max={}, left_raw_max={}).".format(
        scale_factor, right_max, left_raw_max))

    # -- assemble bins with display-named counts (what the frontend loops over) --
    bins = []
    for r in records:
        counts = {
            "CDS": r["CDS"],
            "Other/Pseudogenes": r["other_genes"],
            "tRNA": r["tRNA"],
            "rRNA": r["rRNA"],
            "tmRNA": r["tmRNA"],
            "Repeat Regions": r["repeat_region"],
            "gene": r["gene"],
        }
        bins.append({"bin": r["Bin_Label"], "mag_id": r["MAG_ID"], "counts": counts})

    axis_title = ("\u25C4  Non-coding RNA & repeat features  (scaled \u00D7{})"
                  "      |      Protein-coding genes & pseudogenes  \u25BA".format(scale_factor))

    doc = {
        "meta": {
            "title": "Prokka Gene Feature Composition per MAG",
            "sample_id": sample_id,
            "n_bins": n_bins,
            "scale_factor": scale_factor,
            "schema_version": SCHEMA_VERSION,
            "generated_utc": datetime.datetime.now(datetime.timezone.utc)
                                       .strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "layout": {
            "colors": FEATURE_COLORS,
            "right_order": RIGHT_ORDER,
            "left_order": LEFT_ORDER,
            "legend_order": LEGEND_ORDER,
            "axis_title": axis_title,
        },
        "bins": bins,
    }
    return doc, records


def write_table(records, table_path):
    cols = ["Bin_Label", "MAG_ID", "CDS", "gene", "other_genes",
            "tRNA", "rRNA", "tmRNA", "repeat_region"]
    with open(table_path, "w", newline="") as fh:
        w = csv.writer(fh, delimiter="\t")
        w.writerow(cols)
        for r in records:
            w.writerow([r.get(c, "") for c in cols])


def main(argv):
    if len(argv) != 3:
        sys.stderr.write(
            "ERROR: Expected exactly 3 args (PROKKA_SAMPLE_DIR, OUTPUT_DIR, SAMPLE_ID), got {}.\n"
            "Usage: python3 prokka_feature_json.py <PROKKA_SAMPLE_DIR> <OUTPUT_DIR> <SAMPLE_ID>\n"
            .format(len(argv)))
        return 1

    prokka_sample_dir, output_dir, sample_id = argv
    os.makedirs(output_dir, exist_ok=True)

    log = RunLog(os.path.join(output_dir, sample_id + "_prokka_run.log"))
    log("=========================================================")
    log("Script: prokka_feature_json.py")
    log("Resolved PROKKA_SAMPLE_DIR:", os.path.abspath(prokka_sample_dir))
    log("Resolved OUTPUT_DIR:", os.path.abspath(output_dir))
    log("SAMPLE_ID:", sample_id)

    status = 0
    try:
        if not os.path.isdir(prokka_sample_dir):
            raise NotADirectoryError(
                "PROKKA_SAMPLE_DIR does not exist or is not a directory: '{}'."
                .format(prokka_sample_dir))
        log("STEP: Input directory validated.")

        doc, records = build_document(prokka_sample_dir, sample_id, log)

        json_path = os.path.join(output_dir, sample_id + "_prokka_feature_composition.json")
        with open(json_path, "w") as fh:
            json.dump(doc, fh, indent=2, ensure_ascii=False)
        log("STEP: JSON written:", json_path)

        table_path = os.path.join(output_dir, sample_id + "_prokka_feature_composition_table.tsv")
        write_table(records, table_path)
        log("STEP: Table written:", table_path, "(rows={})".format(len(records)))

    except Exception as exc:  # graceful failure, non-zero exit for Nextflow
        log("ERROR:", str(exc))
        status = 1
    finally:
        log("Run end")
        log("=========================================================")
        log.close()
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
