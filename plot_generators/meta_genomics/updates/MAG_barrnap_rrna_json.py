#!/usr/bin/env python3
# ==============================================================================
# barrnap_rrna_json.py
#
# Python port of MAG_Barrnap_rRNA_Copy.R.  Parses barrnap per-MAG rRNA GFF files
# for one sample and emits a single plot-ready JSON document (dot-matrix data)
# consumed by the React/Plotly frontend.
#
# Pure standard library — no pandas/numpy — so it drops into a Nextflow process
# without a heavy conda/container image.
#
# INPUT CONTRACT (positional, exactly 3 — consistent with the prokka/dbcan ports):
#   arg1: BARRNAP_SAMPLE_DIR - dir with one subfolder per MAG, each containing a
#                              <mag>_rrna.gff (barrnap combined GFF)
#   arg2: OUTPUT_DIR         - where JSON + log are written
#   arg3: SAMPLE_ID          - sample identifier, used verbatim
#   (The original R auto-detected the sample from results/barrnap/<sample>; here
#    the sample dir + id are passed explicitly, matching the other two scripts.)
#
# Usage:
#   python3 barrnap_rrna_json.py <BARRNAP_SAMPLE_DIR> <OUTPUT_DIR> <SAMPLE_ID>
#
# Output:
#   <OUTPUT_DIR>/mag_barrnap_plots_data.json   (frontend input)
#   <OUTPUT_DIR>/<SAMPLE_ID>_barrnap_run.log
# ==============================================================================

import os
import sys
import re
import json
import glob
import datetime

RNA_TYPES_ORDER = ["16S_rRNA", "23S_rRNA", "5S_rRNA"]
OVERLAP_THRESHOLD = 0.80

TARGET_LABELS = {
    "16S_rRNA": "16S rRNA (small subunit)",
    "23S_rRNA": "23S rRNA (large subunit)",
    "5S_rRNA":  "5S rRNA (large subunit)",
}
FILL_COLORS    = {"Full": "#56B4E9", "Partial": "#FFD700", "None": "#FFFFFF"}
OUTLINE_COLORS = {"Full": "#2E86C1", "Partial": "#D4AC0D", "None": "#CCCCCC"}
COMPLETENESS_LABELS = {
    "Full": "Full (\u2265 full-length)",
    "Partial": "Partial (< full-length)",
    "None": "None detected",
}

_NAME_RE = re.compile(r"(?<=Name=)[^;]+")

SCHEMA_VERSION = "1.0"


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


_LABEL_TAIL_RE = re.compile(
    r"(?i)((?:semibin|maxbin2?|metabat2?|concoct|vamb|bin)[._]?\d+)$"
)


def make_label(mag, sample_id):
    """Short, uniform display label: keep ONLY the binner+number token, dropping
    any assembly/sample-id prefix. MAG names here come in two unrelated shapes —
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


def find_gff(mag_dir, mag_id):
    """Locate <mag>_rrna.gff, else any *_rrna.gff excluding _arc/_bac variants."""
    expected = os.path.join(mag_dir, mag_id + "_rrna.gff")
    if os.path.isfile(expected):
        return expected
    cands = sorted(glob.glob(os.path.join(mag_dir, "*_rrna.gff")))
    cands = [c for c in cands if not re.search(r"_rrna_(arc|bac)\.gff$", c)]
    return cands[0] if cands else None


def dedup_overlap(records, threshold=OVERLAP_THRESHOLD):
    """Greedy longest-first dedup: drop a record whose overlap with an already
    kept record exceeds `threshold` of the shorter record's length. Faithful to
    the R dedup_overlap() applied per (contig, rna_type) group."""
    if not records:
        return []
    ordered = sorted(records, key=lambda r: r["length"], reverse=True)
    kept = []
    for rec in ordered:
        overlaps = False
        for k in kept:
            ov_start = max(rec["start"], k["start"])
            ov_end = min(rec["end"], k["end"])
            ov_len = max(0, ov_end - ov_start + 1)
            min_len = min(rec["length"], k["length"])
            if min_len > 0 and ov_len / min_len > threshold:
                overlaps = True
                break
        if not overlaps:
            kept.append(rec)
    return kept


def parse_gff(gff_file, mag_id, log):
    """Return list of records {contig, start, end, length, rna_type, is_full}."""
    try:
        with open(gff_file, "r", errors="replace") as fh:
            lines = [ln.rstrip("\r\n") for ln in fh
                     if ln.strip() and not ln.startswith("#")]
    except Exception as exc:
        log(f"  [WARN] Cannot read {gff_file}: {exc}")
        return []

    records = []
    for ln in lines:
        cols = ln.split("\t")
        if len(cols) < 9:
            continue
        contig, _src, _feat, start, end = cols[0], cols[1], cols[2], cols[3], cols[4]
        attributes = cols[8]
        try:
            start_i = int(start)
            end_i = int(end)
        except ValueError:
            continue
        m = _NAME_RE.search(attributes)
        if not m:
            continue
        rna_type = m.group(0).strip()
        if rna_type not in RNA_TYPES_ORDER:
            continue
        records.append({
            "contig": contig,
            "start": start_i,
            "end": end_i,
            "length": end_i - start_i + 1,
            "rna_type": rna_type,
            "is_full": ("partial" not in attributes.lower()),
        })
    return records


def summarise_mag(records):
    """Per rna_type: count (after dedup) + completeness (Full if any full)."""
    # group by (contig, rna_type), dedup within group
    groups = {}
    for r in records:
        groups.setdefault((r["contig"], r["rna_type"]), []).append(r)

    deduped = []
    for recs in groups.values():
        deduped.extend(dedup_overlap(recs))

    summary = {}
    for t in RNA_TYPES_ORDER:
        recs = [r for r in deduped if r["rna_type"] == t]
        if recs:
            summary[t] = {
                "count": len(recs),
                "completeness": "Full" if any(r["is_full"] for r in recs) else "Partial",
            }
        else:
            summary[t] = {"count": 0, "completeness": "None"}
    return summary


def build_document(barrnap_sample_dir, sample_id, log):
    mag_dirs = sorted(
        d for d in glob.glob(os.path.join(barrnap_sample_dir, "*")) if os.path.isdir(d)
    )
    log(f"Found {len(mag_dirs)} MAG folders.")
    if not mag_dirs:
        raise RuntimeError(f"No MAG subdirectories in {barrnap_sample_dir}")

    per_mag = {}  # mag_id -> {target: {count, completeness}}
    for mdir in mag_dirs:
        mag_id = os.path.basename(mdir.rstrip("/"))
        gff = find_gff(mdir, mag_id)
        if gff is None:
            log(f"  [NONE] {mag_id} — no *_rrna.gff; all targets set to 0")
            per_mag[mag_id] = {t: {"count": 0, "completeness": "None"}
                               for t in RNA_TYPES_ORDER}
            continue
        recs = parse_gff(gff, mag_id, log)
        summary = summarise_mag(recs)
        per_mag[mag_id] = summary
        hits = sum(v["count"] for v in summary.values())
        log(f"  [OK] {mag_id} — {len(recs)} raw rRNA feature(s), "
            f"{hits} after 80%-overlap dedup "
            f"(16S={summary['16S_rRNA']['count']}, "
            f"23S={summary['23S_rRNA']['count']}, "
            f"5S={summary['5S_rRNA']['count']})")

    # sort MAGs by 16S count descending, tie-break by name (matches R)
    mag_ids = sorted(per_mag.keys(),
                     key=lambda m: (-per_mag[m]["16S_rRNA"]["count"], m))
    mag_labels = [make_label(m, sample_id) for m in mag_ids]

    cells = []
    for t in RNA_TYPES_ORDER:
        for mag in mag_ids:
            s = per_mag[mag][t]
            cells.append({"mag": mag, "mag_label": make_label(mag, sample_id),
                          "target": t,
                          "count": s["count"], "completeness": s["completeness"]})

    max_count = max((c["count"] for c in cells), default=0)
    breaks = sorted({1, 2, 4} |
                    ({6} if max_count >= 6 else set()) |
                    ({8} if max_count >= 8 else set()) |
                    {max_count})
    breaks = [b for b in breaks if 1 <= b <= max(max_count, 1)]

    return {
        "meta": {
            "title": "rRNA Gene Copy Number per MAG",
            "sample_id": sample_id,
            "subtitle": (f"{len(mag_ids)} MAGs \u00D7 {len(RNA_TYPES_ORDER)} "
                         "rRNA targets  |  Dots scaled to copy count"),
            "n_mags": len(mag_ids),
            "n_targets": len(RNA_TYPES_ORDER),
            "max_count": max_count,
            "schema_version": SCHEMA_VERSION,
            "generated_utc": datetime.datetime.now(datetime.timezone.utc)
                                       .strftime("%Y-%m-%dT%H:%M:%SZ"),
            "source_line": "",
        },
        "layout": {
            "targets": RNA_TYPES_ORDER,
            "target_labels": TARGET_LABELS,
            "colors": FILL_COLORS,
            "outline": OUTLINE_COLORS,
            "completeness_order": ["Full", "Partial", "None"],
            "completeness_labels": COMPLETENESS_LABELS,
            "size_breaks": breaks,
            "size_range_px": [18, 48],
        },
        "mags": mag_ids,
        "mag_labels": mag_labels,
        "cells": cells,
    }


def main(argv):
    if len(argv) != 3:
        sys.stderr.write(
            f"ERROR: Expected 3 args (BARRNAP_SAMPLE_DIR, OUTPUT_DIR, SAMPLE_ID), got {len(argv)}.\n"
            "Usage: python3 barrnap_rrna_json.py <BARRNAP_SAMPLE_DIR> <OUTPUT_DIR> <SAMPLE_ID>\n")
        return 1

    barrnap_sample_dir, output_dir, sample_id = argv
    os.makedirs(output_dir, exist_ok=True)

    log = RunLog(os.path.join(output_dir, f"{sample_id}_barrnap_run.log"))
    log("=== barrnap_rrna_json.py started ===")
    log("Sample ID:", sample_id)
    log("barrnap sample dir:", os.path.abspath(barrnap_sample_dir))
    log("Output dir:", os.path.abspath(output_dir))

    status = 0
    try:
        if not os.path.isdir(barrnap_sample_dir):
            raise NotADirectoryError(
                f"BARRNAP_SAMPLE_DIR does not exist: '{barrnap_sample_dir}'")
        log("STEP: Input directory validated.")

        doc = build_document(barrnap_sample_dir, sample_id, log)

        total = sum(c["count"] for c in doc["cells"])
        if total == 0:
            log("WARNING: No rRNA genes detected across any MAG. Writing an "
                "empty-but-valid document (frontend shows an all-absent grid).")

        json_path = os.path.join(output_dir, "mag_barrnap_plots_data.json")
        with open(json_path, "w") as fh:
            json.dump(doc, fh, indent=2, ensure_ascii=False)
        log("STEP: JSON written:", json_path)
        log(f"STEP: {doc['meta']['n_mags']} MAGs, total rRNA copies = {total}, "
            f"max copy number = {doc['meta']['max_count']}")

    except Exception as exc:
        log("ERROR:", str(exc))
        status = 1
    finally:
        log(f"=== barrnap_rrna_json.py finished with exit status {status} ===")
        log.close()
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
