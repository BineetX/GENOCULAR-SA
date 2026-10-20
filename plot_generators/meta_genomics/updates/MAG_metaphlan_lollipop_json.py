#!/usr/bin/env python3
# metaphlan_lollipop_json.py
# Emits a phylum box-plot JSON from a MetaPhlAn profile: one box per phylum
# (genus-abundance spread, computed on log10 values) plus every genus as a dot.
#
# Usage: python3 metaphlan_lollipop_json.py <PROFILE_TXT> <OUTPUT_DIR> <SAMPLE_ID>
# Output: <OUTPUT_DIR>/mag_metaphlan_plots_data.json + <SAMPLE_ID>_metaphlan_run.log

import os
import sys
import json
import math
import statistics
import datetime

SCHEMA_VERSION = "2.1"
TUKEY_K = 1.5
DOT_DARKEN = 0.65   # multiply each phylum colour toward black for the genus dots

TAB20 = [
    "#1f77b4", "#aec7e8", "#ff7f0e", "#ffbb78", "#2ca02c", "#98df8a",
    "#d62728", "#ff9896", "#9467bd", "#c5b0d5", "#8c564b", "#c49c94",
    "#e377c2", "#f7b6d2", "#7f7f7f", "#c7c7c7", "#bcbd22", "#dbdb8d",
    "#17becf", "#9edae5",
]

# Style values consumed by the frontend. Line widths are px (~0.7 mm and
# ~0.4 mm at 96 dpi); grid off; tick labels enlarged and bold black.
STYLE = {
    "show_grid": False,
    "axis_line_width": 2.6,
    "axis_line_color": "#000000",
    "box_line_width": 1.5,
    "box_line_color": "#000000",
    "tick_font_size_x": 13,
    "tick_font_size_y": 14,
    "tick_font_color": "#000000",
    "tick_font_bold": True,
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


def darken(hex_color, factor=DOT_DARKEN):
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    r, g, b = (max(0, min(255, round(c * factor))) for c in (r, g, b))
    return f"#{r:02x}{g:02x}{b:02x}"


def parse_profile(path, log):
    records = []
    n_bad = 0
    with open(path, "r", errors="replace") as fh:
        for line in fh:
            if line.startswith("#") or not line.strip():
                continue
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3:
                continue
            clade = parts[0]
            try:
                abund = float(parts[2])
            except ValueError:
                n_bad += 1
                continue
            lineage = clade.split("|")
            last = lineage[-1]
            if "__" not in last:
                continue
            level = last.split("__")[0]
            name = last.split("__", 1)[1].replace("_", " ")
            records.append({"level": level, "name": name,
                            "abund": abund, "lineage": lineage})
    if n_bad:
        log(f"[WARN] skipped {n_bad} row(s) with non-numeric relative_abundance.")
    log(f"Parsed {len(records)} clade rows.")
    return records


def parent_phylum(lineage):
    for tok in lineage:
        if tok.startswith("p__"):
            return tok.split("__", 1)[1].replace("_", " ")
    return "Unclassified"


def log_box_stats(abunds):
    # Five-number summary + Tukey fences on log10 values, returned in both
    # log10 and back-transformed % space. Inclusive quartiles match Plotly.
    vals = sorted(v for v in abunds if v > 0)
    logs = [math.log10(v) for v in vals]
    if len(logs) >= 2:
        q1, q2, q3 = statistics.quantiles(logs, n=4, method="inclusive")
    else:
        q1 = q2 = q3 = logs[0]
    iqr = q3 - q1
    within = [x for x in logs if q1 - TUKEY_K * iqr <= x <= q3 + TUKEY_K * iqr]
    w_lo = min(within) if within else q1
    w_hi = max(within) if within else q3

    lin = lambda x: 10 ** x
    return {
        "q1": round(lin(q1), 6),
        "median": round(lin(q2), 6),
        "q3": round(lin(q3), 6),
        "lowerfence": round(lin(w_lo), 6),
        "upperfence": round(lin(w_hi), 6),
        "log10": {
            "q1": round(q1, 6), "median": round(q2, 6), "q3": round(q3, 6),
            "iqr": round(iqr, 6),
            "lowerfence": round(w_lo, 6), "upperfence": round(w_hi, 6),
        },
    }


def build_document(profile_path, sample_id, log):
    records = parse_profile(profile_path, log)

    genus_rows = [r for r in records if r["level"] == "g" and r["abund"] > 0]
    log(f"Genus-level rows with abundance > 0: {len(genus_rows)}")
    if not genus_rows:
        raise RuntimeError("No genus-level (g__) rows found in profile.")

    by_phylum = {}
    for r in genus_rows:
        by_phylum.setdefault(parent_phylum(r["lineage"]), []).append(r)

    # order: genus count desc, then total phylum abundance desc, then name
    def phylum_total(ph):
        return sum(r["abund"] for r in by_phylum[ph])

    order = sorted(by_phylum.keys(),
                   key=lambda ph: (-len(by_phylum[ph]), -phylum_total(ph), ph))

    phyla = []
    for i, ph in enumerate(order):
        rows = sorted(by_phylum[ph], key=lambda r: -r["abund"])
        box = log_box_stats([r["abund"] for r in rows])
        color = TAB20[i % len(TAB20)]
        phyla.append({
            "name": ph,
            "n_genera": len(rows),
            "label": f"<b>{ph}<br>(n = {len(rows)})</b>",
            "color": color,
            "dot_color": darken(color),
            "box": {k: box[k] for k in
                    ("q1", "median", "q3", "lowerfence", "upperfence")},
            "log10_box": box["log10"],
            "genera": [{"name": r["name"], "abundance": round(r["abund"], 6)}
                       for r in rows],
        })
        lb = box["log10"]
        log(f"  [{ph}] n={len(rows)}  log10 Q1/Med/Q3={lb['q1']}/{lb['median']}/{lb['q3']}"
            f"  ->  % {box['q1']}-{box['q3']} (median {box['median']})")

    all_ab = [r["abund"] for r in genus_rows]

    return {
        "meta": {
            "title": "Genus-level relative abundances grouped by parent phylum",
            "subtitle": ("each dot = one genus/GGB  ·  box = spread of genera "
                         "within the phylum  ·  box statistics computed on log10"),
            "sample_id": sample_id,
            "y_title": "Genus relative abundance (%) — log scale",
            "n_phyla": len(phyla),
            "n_genera_total": len(genus_rows),
            "schema_version": SCHEMA_VERSION,
            "generated_utc": datetime.datetime.now(datetime.timezone.utc)
                                       .strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "layout": {
            "y_log": True,
            "y_range": [round(min(all_ab) / 2.0, 8), round(max(all_ab) * 3.0, 6)],
            "box_line_color": STYLE["box_line_color"],
            "marker_edge": "#000000",
            "tukey_k": TUKEY_K,
            "style": STYLE,
        },
        "phyla": phyla,
    }


def main(argv):
    if len(argv) != 3:
        sys.stderr.write(
            f"ERROR: Expected 3 args (PROFILE_TXT, OUTPUT_DIR, SAMPLE_ID), got {len(argv)}.\n"
            "Usage: python3 metaphlan_lollipop_json.py <PROFILE_TXT> <OUTPUT_DIR> <SAMPLE_ID>\n")
        return 1

    profile_path, output_dir, sample_id = argv
    os.makedirs(output_dir, exist_ok=True)

    log = RunLog(os.path.join(output_dir, f"{sample_id}_metaphlan_run.log"))
    log("=== metaphlan phylum box-plot JSON started ===")
    log("Profile:", profile_path)
    log("Output dir:", output_dir)
    log("Sample ID:", sample_id)

    status = 0
    try:
        if not os.path.isfile(profile_path):
            raise FileNotFoundError(f"PROFILE_TXT does not exist: {profile_path}")
        doc = build_document(profile_path, sample_id, log)
        json_path = os.path.join(output_dir, "mag_metaphlan_plots_data.json")
        with open(json_path, "w") as fh:
            json.dump(doc, fh, indent=2, ensure_ascii=False, allow_nan=False)
        log("JSON written ->", json_path)
        log(f"Phyla: {doc['meta']['n_phyla']}, genera total: {doc['meta']['n_genera_total']}")
        log("=== completed successfully ===")
    except Exception as exc:
        log("ERROR:", str(exc))
        status = 1
    finally:
        log.close()
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
