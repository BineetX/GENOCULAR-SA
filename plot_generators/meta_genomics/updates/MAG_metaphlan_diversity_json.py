#!/usr/bin/env python3
# ==============================================================================
# metaphlan_diversity_json.py
#
# Python port of metaphlan_alpha_diversity.R. Parses a MetaPhlAn4 profile and
# emits one JSON document driving BOTH figures:
#   (1) genus-level alpha-diversity summary (Observed / Shannon H' / Simpson 1-D)
#   (2) genus-level rank-abundance (Whittaker) curve
# for the React/Plotly frontend.
#
# Pure standard library — no pandas/numpy — so it drops into a Nextflow process
# without a heavy image.
#
# EXACT CLI ARGUMENT ORDER (unchanged from the R script):
#   arg1: PROFILE_TXT   MetaPhlAn4 profile.txt (tab-separated, '#'-comment header)
#   arg2: OUTPUT_DIR    output directory for JSON + log
#   arg3: SAMPLE_ID     sample identifier string
#
# Usage:
#   python3 metaphlan_diversity_json.py <PROFILE_TXT> <OUTPUT_DIR> <SAMPLE_ID>
#
# Output:
#   <OUTPUT_DIR>/mag_metaphlan_diversity_plots_data.json   (frontend input)
#   <OUTPUT_DIR>/<SAMPLE_ID>_MetaPhlAn4_run.log
# ==============================================================================

import os
import sys
import math
import json
import datetime

SCHEMA_VERSION = "1.0"

METRIC_COLORS = {
    "observed": "#009E73",
    "shannon": "#0072B2",
    "simpson": "#D55E00",
}
RANK_COLOR = "#0072B2"
N_ANNOT_COLOR = "#4D4D4D"


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


def build_document(profile_txt, sample_id, log):
    with open(profile_txt, "r", errors="replace") as fh:
        raw = fh.readlines()
    data_lines = [ln.rstrip("\n") for ln in raw
                  if not ln.startswith("#") and ln.strip()]
    log(f"Total lines: {len(raw)} | data lines: {len(data_lines)}")
    if not data_lines:
        raise RuntimeError("No data rows after filtering '#' header lines.")

    parsed = []
    n_bad = 0
    for ln in data_lines:
        parts = ln.split("\t")
        if len(parts) < 3:
            continue
        clade = parts[0]
        try:
            ab = float(parts[2])
        except ValueError:
            n_bad += 1
            continue
        parsed.append({"clade": clade, "abund": ab,
                       "last_seg": clade.split("|")[-1]})
    if n_bad:
        log(f"[WARN] dropped {n_bad} row(s) with non-numeric relative_abundance.")

    # exclude UNCLASSIFIED
    before = len(parsed)
    parsed = [r for r in parsed
              if r["last_seg"] != "UNCLASSIFIED" and r["clade"] != "UNCLASSIFIED"]
    if before - len(parsed):
        log(f"Excluded {before - len(parsed)} UNCLASSIFIED row(s).")

    # genus-level rows
    genus = [r for r in parsed if r["last_seg"].startswith("g__")]
    log(f"Genus-level rows: {len(genus)}")
    if not genus:
        raise RuntimeError("No genus-level (g__) rows found.")

    abund = [r["abund"] for r in genus]
    total = sum(abund)
    scale = 100 if abs(total - 100) <= abs(total - 1) else 1
    log(f"Genus abundance sum={round(total,4)} | detected scale={scale}")
    dev = abs(total - scale) / scale * 100
    if dev > 1:
        log(f"[WARN] abundance sum deviates from {scale} by {round(dev,2)}%.")

    # proportions (sum to 1) for diversity math
    p_all = [a / scale for a in abund]
    p = [x for x in p_all if x > 0]

    shannon = -sum(x * math.log(x) for x in p)   # natural log
    simpson = 1 - sum(x * x for x in p)           # Gini-Simpson
    observed = len(p)
    n_genera = observed
    log(f"Shannon(H',ln)={round(shannon,4)} Simpson(1-D)={round(simpson,4)} "
        f"Observed={observed}")

    # percent values for plotting
    genus_pct = []
    for r in genus:
        pct = r["abund"] / scale * 100.0
        genus_pct.append({"name": r["last_seg"].split("__", 1)[1].replace("_", " "),
                          "pct": pct})

    # rank-abundance: pct>0, sorted desc
    ra = [g for g in genus_pct if g["pct"] > 0]
    ra.sort(key=lambda g: -g["pct"])
    points = [{"rank": i + 1, "abundance": round(g["pct"], 5), "name": g["name"]}
              for i, g in enumerate(ra)]
    log(f"Rank-abundance: N={len(points)} | "
        f"max={round(points[0]['abundance'],5) if points else 0}% | "
        f"min={round(points[-1]['abundance'],6) if points else 0}%")

    subtitle = f"Genera detected: {n_genera}"  # Sample ID removed per request

    return {
        "meta": {
            "sample_id": sample_id,
            "n_genera": n_genera,
            "subtitle": subtitle,
            "schema_version": SCHEMA_VERSION,
            "generated_utc": datetime.datetime.now(datetime.timezone.utc)
                                       .strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "alpha_diversity": {
            "title": "MetaPhlAn4 Genus-Level Alpha Diversity Summary",
            "y_title": "Diversity Value",
            "metrics": [
                {"key": "observed", "label": "Observed Genera",
                 "value": observed, "display": str(observed),
                 "color": METRIC_COLORS["observed"]},
                {"key": "shannon",
                 "label": "Shannon Diversity Index (H', natural log)",
                 "value": round(shannon, 4), "display": f"H' = {shannon:.2f}",
                 "color": METRIC_COLORS["shannon"]},
                {"key": "simpson",
                 "label": "Simpson's Diversity Index (1-D)",
                 "value": round(simpson, 4), "display": f"1-D = {simpson:.2f}",
                 "color": METRIC_COLORS["simpson"]},
            ],
        },
        "rank_abundance": {
            "title": "MetaPhlAn4 Genus-Level Rank-Abundance (Whittaker) Curve",
            "x_title": "Genus Rank (1 = most abundant)",
            "y_title": "Relative Abundance (%, log10 scale)",
            "color": RANK_COLOR,
            "n_annotation_color": N_ANNOT_COLOR,
            "n_plotted": len(points),
            "points": points,
        },
    }


def main(argv):
    if len(argv) != 3:
        sys.stderr.write(
            f"[FATAL] Expected exactly 3 arguments (PROFILE_TXT, OUTPUT_DIR, SAMPLE_ID), got {len(argv)}.\n"
            "Usage: python3 metaphlan_diversity_json.py <PROFILE_TXT> <OUTPUT_DIR> <SAMPLE_ID>\n")
        return 1

    profile_txt, output_dir, sample_id = argv
    os.makedirs(output_dir, exist_ok=True)

    log = RunLog(os.path.join(output_dir, f"{sample_id}_MetaPhlAn4_run.log"))
    log("==== metaphlan_diversity_json.py START ====")
    log("PROFILE_TXT:", profile_txt)
    log("OUTPUT_DIR:", output_dir)
    log("SAMPLE_ID:", sample_id)

    status = 0
    try:
        if not os.path.isfile(profile_txt):
            raise FileNotFoundError(f"Input profile does not exist: {profile_txt}")
        doc = build_document(profile_txt, sample_id, log)
        json_path = os.path.join(output_dir, "mag_metaphlan_diversity_plots_data.json")
        with open(json_path, "w") as fh:
            json.dump(doc, fh, indent=2, ensure_ascii=False)
        log("JSON written ->", json_path)
        log("==== END (success) ====")
    except Exception as exc:
        log("[FATAL ERROR]", str(exc))
        status = 1
    finally:
        log.close()
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
