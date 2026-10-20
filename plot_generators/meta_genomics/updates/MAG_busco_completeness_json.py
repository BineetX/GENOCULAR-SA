#!/usr/bin/env python3
# ==============================================================================
# busco_completeness_json.py
#
# Python port of MAG_BUSCO_PLOT.R.  Parses BUSCO short_summary.specific.*.txt
# files (one per MAG) for a sample and emits a single plot-ready JSON document
# (stacked completeness bars + side-panel info) for the React/Plotly frontend.
#
# Pure standard library — no pandas — so it drops into a Nextflow process without
# a heavy conda/container image.
#
# INPUT CONTRACT (positional; 3 required, 4th optional):
#   arg1: BUSCO_FILTERED_SAMPLE_DIR - results/busco_filtered/<sample_id>, one
#            subfolder per MAG, each holding a short_summary.specific.*.txt
#   arg2: OUTPUT_DIR                - where JSON + log are written
#   arg3: SAMPLE_ID                 - sample identifier, used verbatim
#   arg4: BUSCO_RAW_SAMPLE_DIR      - (optional) results/busco/<sample_id>, used
#            only for the dropped-MAG audit. If omitted, Raw MAGs = N/A.
#
# Usage:
#   python3 busco_completeness_json.py <FILTERED_SAMPLE_DIR> <OUTPUT_DIR> <SAMPLE_ID> [RAW_SAMPLE_DIR]
#
# Output:
#   <OUTPUT_DIR>/mag_busco_plots_data.json   (frontend input)
#   <OUTPUT_DIR>/<SAMPLE_ID>_busco_run.log
# ==============================================================================

import os
import sys
import re
import json
import glob
import datetime

SCHEMA_VERSION = "1.0"

COLORS = {"S": "#FFD700", "D": "#98FB98", "F": "#87CEEB", "M": "#084594"}
LABELS = {
    "S": "Complete (Single-copy)",
    "D": "Complete (Duplicated)",
    "F": "Fragmented",
    "M": "Missing",
}
STACK_ORDER = ["M", "F", "D", "S"]     # bottom -> top (yellow S on top -> 100%)
LEGEND_ORDER = ["S", "D", "F", "M"]    # legend display order (top -> bottom)

_DIR_JUNK_RE = re.compile(r"\.(done|tsv|json|txt)$")
_SUMMARY_RE = re.compile(r"^short_summary\.specific\..*\.txt$")

# trailing binner+number token, used to build uniform short MAG labels
_LABEL_TAIL_RE = re.compile(
    r"(?i)((?:semibin|maxbin2?|metabat2?|concoct|vamb|bin)[._]?\d+)$"
)


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


def list_mag_dirs(sample_dir):
    if not os.path.isdir(sample_dir):
        return []
    out = []
    for name in sorted(os.listdir(sample_dir)):
        full = os.path.join(sample_dir, name)
        if os.path.isdir(full) and not _DIR_JUNK_RE.search(name):
            out.append(full)
    return out


def _extract_leading_int(line):
    m = re.match(r"\s*(\d+)", line)
    return int(m.group(1)) if m else None


def parse_mag_busco(mag_dir, log):
    mag_name = os.path.basename(mag_dir.rstrip("/"))
    summaries = [f for f in sorted(glob.glob(os.path.join(mag_dir, "*.txt")))
                 if _SUMMARY_RE.match(os.path.basename(f))]
    if not summaries:
        log(f"  [SKIP] {mag_name} — no short_summary.specific.*.txt")
        return None

    try:
        with open(summaries[0], "r", errors="replace") as fh:
            lines = fh.readlines()
    except Exception as exc:
        log(f"  [WARN] {mag_name} — cannot read summary: {exc}")
        return None
    if not lines:
        return None

    # lineage + marker count
    lineage, n_markers = "unknown", None
    for ln in lines:
        if "lineage dataset is:" in ln:
            m = re.search(r"is:\s+([^\s(]+)", ln)
            if m:
                lineage = m.group(1)
            m2 = re.search(r"number of BUSCOs:\s+(\d+)", ln)
            if m2:
                n_markers = int(m2.group(1))
            break
    if n_markers is None:  # fallback: "Total BUSCO groups searched"
        for ln in lines:
            if "Total BUSCO groups searched" in ln:
                n_markers = _extract_leading_int(ln)
                break
    if not n_markers:
        log(f"  [SKIP] {mag_name} — no marker count found")
        return None

    version = "unknown"
    for ln in lines:
        if "BUSCO version is:" in ln:
            m = re.search(r"BUSCO version is:\s+([\d.]+)", ln)
            if m:
                version = m.group(1)
            break

    def count_for(substr):
        for ln in lines:
            if substr in ln:
                return _extract_leading_int(ln)
        return None

    S = count_for("Complete and single-copy BUSCOs")
    D = count_for("Complete and duplicated BUSCOs")
    F = count_for("Fragmented BUSCOs")
    M = count_for("Missing BUSCOs")
    if None in (S, D, F, M):
        log(f"  [SKIP] {mag_name} — incomplete S/D/F/M counts")
        return None

    r = lambda x: round(x / n_markers * 100.0, 2)
    return {
        "MAG": mag_name,
        "S_pct": r(S), "D_pct": r(D), "F_pct": r(F), "M_pct": r(M),
        "n_markers": n_markers, "lineage": lineage, "busco_version": version,
        "complete_pct": round((S + D) / n_markers * 100.0, 2),
    }


def make_label(mag, sample_id):
    """Short, uniform display label: keep ONLY the binner+number token, dropping
    any assembly/sample-id prefix. MAG names come in two unrelated shapes —
    MetaBAT-style 'Meta_HR_SRR14300309_bin.112' and SemiBin-style 'SemiBin_14'
    (the latter carries no sample prefix at all), so stripping sample_id can't
    make them uniform. Instead, anchor on the trailing binner token:
      'Meta_HR_SRR14300309_bin.112' -> 'bin.112'
      'SemiBin_14'                  -> 'SemiBin_14'
    Falls back to sample-id prefix stripping for any other shape."""
    m = _LABEL_TAIL_RE.search(mag)
    if m:
        return m.group(1)
    lbl = re.sub(r"^" + re.escape(sample_id) + r"[._]?", "", mag)
    return lbl if lbl.startswith("bin") else "." + lbl


def dropped_audit(raw_sample_dir, filtered_dirs, sample_id):
    filtered = {os.path.basename(d.rstrip("/")) for d in filtered_dirs}
    if raw_sample_dir and os.path.isdir(raw_sample_dir):
        raw = {os.path.basename(d.rstrip("/")) for d in list_mag_dirs(raw_sample_dir)}
        dropped = sorted(raw - filtered)
        n_raw = len(raw)
    else:
        dropped, n_raw = [], None
    return {"n_raw": n_raw, "n_filtered": len(filtered), "dropped": dropped}


def build_document(filtered_sample_dir, sample_id, raw_sample_dir, log):
    mag_dirs = list_mag_dirs(filtered_sample_dir)
    log(f"Found {len(mag_dirs)} MAG folders.")
    if not mag_dirs:
        raise RuntimeError(f"No MAG subdirectories in {filtered_sample_dir}")

    parsed = []
    for d in mag_dirs:
        rec = parse_mag_busco(d, log)
        if rec:
            parsed.append(rec)
            log(f"  [OK] {rec['MAG']} — complete={rec['complete_pct']}% "
                f"(S={rec['S_pct']}, D={rec['D_pct']}, F={rec['F_pct']}, M={rec['M_pct']})")
    if not parsed:
        raise RuntimeError("No MAG produced a valid BUSCO summary.")

    # sort by completeness descending (highest-completeness MAG leftmost)
    parsed.sort(key=lambda p: p["complete_pct"], reverse=True)

    # consensus dataset metadata (mode)
    def mode(vals):
        counts = {}
        for v in vals:
            counts[v] = counts.get(v, 0) + 1
        return max(counts, key=counts.get)

    lineage_val = mode([p["lineage"] for p in parsed])
    version_val = mode([p["busco_version"] for p in parsed])
    n_markers_val = mode([p["n_markers"] for p in parsed])

    n_high = sum(1 for p in parsed if p["complete_pct"] >= 90)
    n_med = sum(1 for p in parsed if 50 <= p["complete_pct"] < 90)
    n_low = sum(1 for p in parsed if p["complete_pct"] < 50)

    audit = dropped_audit(raw_sample_dir, mag_dirs, sample_id)

    mags = []
    for p in parsed:
        tier = ("High" if p["complete_pct"] >= 90
                else "Medium" if p["complete_pct"] >= 50 else "Low")
        mags.append({
            "mag_label": make_label(p["MAG"], sample_id),
            "mag_id": p["MAG"],
            "S_pct": p["S_pct"], "D_pct": p["D_pct"],
            "F_pct": p["F_pct"], "M_pct": p["M_pct"],
            "complete_pct": p["complete_pct"], "tier": tier,
        })

    dropped_short = [make_label(d, sample_id) for d in audit["dropped"]]

    return {
        "meta": {
            "title": "BUSCO — MAG Gene Completeness Assessment",
            "sample_id": sample_id,
            "lineage": lineage_val,
            "n_markers": n_markers_val,
            "busco_version": version_val,
            "n_mags": len(parsed),
            "subtitle": (f"Lineage: {lineage_val} "
                         f"(n={n_markers_val} markers)  |  {len(parsed)} MAGs assessed"),
            "caption": "",
            "thresholds": {"hq": 90, "mq": 50},
            "schema_version": SCHEMA_VERSION,
            "generated_utc": datetime.datetime.now(datetime.timezone.utc)
                                       .strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "tiers": {
            "high": n_high, "medium": n_med, "low": n_low, "total": len(parsed),
            "definitions": {"high": "≥ 90%", "medium": "50–90%", "low": "< 50%"},
        },
        "audit": {
            "n_raw": audit["n_raw"],
            "n_filtered": audit["n_filtered"],
            "n_excluded": len(audit["dropped"]),
            "excluded_ids": dropped_short,
        },
        "layout": {
            "colors": COLORS, "labels": LABELS,
            "stack_order": STACK_ORDER, "legend_order": LEGEND_ORDER,
        },
        "mags": mags,
    }


def main(argv):
    if len(argv) not in (3, 4):
        sys.stderr.write(
            "ERROR: Expected 3 or 4 args "
            "(FILTERED_SAMPLE_DIR, OUTPUT_DIR, SAMPLE_ID[, RAW_SAMPLE_DIR]), "
            f"got {len(argv)}.\n"
            "Usage: python3 busco_completeness_json.py "
            "<FILTERED_SAMPLE_DIR> <OUTPUT_DIR> <SAMPLE_ID> [RAW_SAMPLE_DIR]\n")
        return 1

    filtered_sample_dir, output_dir, sample_id = argv[:3]
    raw_sample_dir = argv[3] if len(argv) == 4 else None
    os.makedirs(output_dir, exist_ok=True)

    log = RunLog(os.path.join(output_dir, f"{sample_id}_busco_run.log"))
    log("=== busco_completeness_json.py started ===")
    log("Sample ID:", sample_id)
    log("Filtered sample dir:", os.path.abspath(filtered_sample_dir))
    log("Raw sample dir:", os.path.abspath(raw_sample_dir) if raw_sample_dir else "N/A")
    log("Output dir:", os.path.abspath(output_dir))

    status = 0
    try:
        if not os.path.isdir(filtered_sample_dir):
            raise NotADirectoryError(
                f"FILTERED_SAMPLE_DIR does not exist: '{filtered_sample_dir}'")
        log("STEP: Input directory validated.")

        doc = build_document(filtered_sample_dir, sample_id, raw_sample_dir, log)

        json_path = os.path.join(output_dir, "mag_busco_plots_data.json")
        with open(json_path, "w") as fh:
            json.dump(doc, fh, indent=2, ensure_ascii=False)
        log("STEP: JSON written:", json_path)
        log(f"STEP: {doc['meta']['n_mags']} MAGs — High={doc['tiers']['high']}, "
            f"Medium={doc['tiers']['medium']}, Low={doc['tiers']['low']}")

    except Exception as exc:
        log("ERROR:", str(exc))
        status = 1
    finally:
        log(f"=== busco_completeness_json.py finished with exit status {status} ===")
        log.close()
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
