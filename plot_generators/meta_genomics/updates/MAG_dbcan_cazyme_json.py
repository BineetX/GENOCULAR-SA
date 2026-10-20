#!/usr/bin/env python3
# ==============================================================================
# dbcan_cazyme_json.py
#
# Python port of dbcan_new.R.  Parses dbCAN per-MAG overview.txt files for one
# metagenomic sample and emits a single plot-ready JSON document (consumed by the
# React/Plotly frontend).
#
# Pure standard library — no pandas/numpy — so it drops into a Nextflow process
# without a heavy conda/container image.
#
# EXPECTED CLI ARGUMENT ORDER (positional, exactly 3 — matches the R script):
#   arg1: DBCAN_SAMPLE_DIR  - dir with one subfolder per MAG, each containing an
#                             overview.txt from run_dbcan
#   arg2: OUTPUT_DIR        - where JSON + log are written
#   arg3: SAMPLE_ID         - sample identifier, used verbatim
#
# Usage:
#   python3 dbcan_cazyme_json.py <DBCAN_SAMPLE_DIR> <OUTPUT_DIR> <SAMPLE_ID>
#
# Output:
#   <OUTPUT_DIR>/mag_dbcan_plots_data.json   (frontend input)
#   <OUTPUT_DIR>/<SAMPLE_ID>_dbcan_run.log
# ==============================================================================

import os
import sys
import re
import csv
import json
import glob
import datetime

# ---- Constants (kept identical to the R implementation) ---------------------
VALID_CLASSES = ["GH", "GT", "CE", "AA", "CBM", "PL"]

CLASS_LABELS = {
    "GH":  "GH — Glycoside Hydrolases",
    "GT":  "GT — Glycosyltransferases",
    "CE":  "CE — Carbohydrate Esterases",
    "AA":  "AA — Auxiliary Activities",
    "CBM": "CBM — Carbohydrate-Binding Modules",
    "PL":  "PL — Polysaccharide Lyases",
}

CLASS_COLORS = {
    "GH":  "#E41A1C",
    "GT":  "#377EB8",
    "CE":  "#4DAF4A",
    "AA":  "#FF7F00",
    "CBM": "#984EA3",
    "PL":  "#A65628",
}

SCHEMA_VERSION = "1.0"

# regex used to strip coordinate suffixes like "(23-410)"
_COORD_RE = re.compile(r"\(\d+-\d+\)")
# regex to extract a clean domain name
_DOMAIN_RE = re.compile(r"[A-Za-z]+[0-9_]*[A-Za-z0-9]*")
# regex to extract leading CAZy class prefix
_CLASS_RE = re.compile(r"^(" + "|".join(VALID_CLASSES) + ")")


# ---- Small logging helper --------------------------------------------------
class RunLog:
    def __init__(self, path):
        self._fh = open(path, "w")

    def __call__(self, *parts):
        stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        line = "[{}] {}".format(stamp, " ".join(str(p) for p in parts))
        self._fh.write(line + "\n")
        self._fh.flush()

    def close(self):
        try:
            self._fh.close()
        except Exception:
            pass


# ---- Parse one overview.txt (mirrors the R parse_overview function) ---------
def parse_overview(filepath, mag_id, log):
    """Return a list of (family, cazy_class) tuples or None."""
    try:
        with open(filepath, "r", errors="replace") as fh:
            raw = [ln.rstrip("\n") for ln in fh if ln.strip()]
    except Exception as exc:
        log(f"  [WARN] Cannot read {filepath}: {exc}")
        return None

    if len(raw) < 2:
        return None

    header = raw[0].split("\t")
    header = [h.strip() for h in header]

    required = {"HMMER", "dbCAN_sub", "DIAMOND", "#ofTools"}
    if not required.issubset(set(header)):
        missing = required - set(header)
        log(f"  [SKIP] {mag_id} — missing columns: {', '.join(missing)}")
        return None

    col_idx = {h: i for i, h in enumerate(header)}
    n = len(header)

    results = []
    for row_str in raw[1:]:
        parts = row_str.split("\t")
        # pad short rows, trim long rows
        parts = (parts + ["-"] * n)[:n]

        # confidence filter: ≥ 2 tools
        try:
            n_tools = int(parts[col_idx["#ofTools"]])
        except (ValueError, IndexError):
            continue
        if n_tools < 2:
            continue

        # pick annotation: HMMER > dbCAN_sub > DIAMOND
        annotation = None
        for col in ("HMMER", "dbCAN_sub", "DIAMOND"):
            val = parts[col_idx[col]].strip()
            if val and val != "-":
                annotation = val
                break
        if not annotation:
            continue

        # split multi-domain annotations on "+"
        for domain_raw in annotation.split("+"):
            domain_raw = domain_raw.strip()
            if not domain_raw or domain_raw == "-":
                continue
            # strip coordinate suffix
            domain_raw = _COORD_RE.sub("", domain_raw)
            m = _DOMAIN_RE.match(domain_raw)
            if not m:
                continue
            domain = m.group(0)
            cm = _CLASS_RE.match(domain)
            if not cm:
                continue
            results.append((domain, cm.group(1)))

    return results if results else None


# ---- Build short bin labels (mirrors the R label logic) ---------------------
def make_short_labels(mag_names):
    """Convert raw MAG folder names to short BinNN labels."""
    _bin_re = re.compile(r"(?i)bin[._-]?(\d+)")
    _last_num_re = re.compile(r"(\d+)(?!.*\d)")

    raw_numbers = []
    for name in mag_names:
        m = _bin_re.search(name)
        if m:
            raw_numbers.append(m.group(1))
        else:
            m2 = _last_num_re.search(name)
            raw_numbers.append(m2.group(1) if m2 else None)

    # fallback: sequential index for names without any number
    for i, rn in enumerate(raw_numbers):
        if rn is None:
            raw_numbers[i] = str(i + 1)

    pad = max(2, max(len(str(int(n))) for n in raw_numbers))
    labels = ["Bin{:0{w}d}".format(int(n), w=pad) for n in raw_numbers]

    # disambiguate collisions
    seen = {}
    for i, lbl in enumerate(labels):
        if lbl in seen:
            seen[lbl] += 1
            labels[i] = f"{lbl}-{seen[lbl]}"
        else:
            seen[lbl] = 0

    return labels


# ---- Build the JSON document ------------------------------------------------
def build_document(dbcan_sample_dir, sample_id, log):
    mag_dirs = sorted(
        d for d in glob.glob(os.path.join(dbcan_sample_dir, "*")) if os.path.isdir(d)
    )
    log(f"Found {len(mag_dirs)} MAG folders.")
    if not mag_dirs:
        raise RuntimeError(f"No MAG subdirectories in {dbcan_sample_dir}")

    # parse each MAG's overview.txt
    mag_data = {}  # mag_id -> list of (family, cazy_class)
    for mdir in mag_dirs:
        mag_id = os.path.basename(mdir.rstrip("/"))
        ov_file = os.path.join(mdir, "overview.txt")
        if not os.path.isfile(ov_file):
            log(f"  [SKIP] No overview.txt in: {mag_id}")
            continue
        try:
            hits = parse_overview(ov_file, mag_id, log)
        except Exception as exc:
            log(f"  [WARN] Error parsing {mag_id}: {exc}")
            continue
        if hits:
            mag_data[mag_id] = hits
            log(f"  [OK] {mag_id} — {len(hits)} domain hits")
        else:
            log(f"  [EMPTY] {mag_id}")

    if not mag_data:
        log("WARNING: No CAZyme hits passed the confidence filter.")
        # return empty-but-valid document
        return {
            "meta": _meta(sample_id, 0, 0, 0),
            "layout": _layout(),
            "mags": [],
        }

    # aggregate: count per (MAG, cazy_class)
    all_families = set()
    mag_rows = []
    for mag_id, hits in mag_data.items():
        counts = {c: 0 for c in VALID_CLASSES}
        for family, cls in hits:
            counts[cls] += 1
            all_families.add(family)
        total = sum(counts.values())
        mag_rows.append({"mag_id": mag_id, "counts": counts, "total": total})

    # sort descending by total (matches R: arrange(desc(total)))
    mag_rows.sort(key=lambda r: r["total"], reverse=True)

    # make short bin labels from the mag_ids in sorted order
    ordered_mag_ids = [r["mag_id"] for r in mag_rows]
    short_labels = make_short_labels(ordered_mag_ids)

    total_domain_hits = sum(r["total"] for r in mag_rows)
    mags = []
    for r, lbl in zip(mag_rows, short_labels):
        mags.append({
            "bin": lbl,
            "mag_id": r["mag_id"],
            "counts": r["counts"],
            "total": r["total"],
        })

    return {
        "meta": _meta(sample_id, len(mags), total_domain_hits, len(all_families)),
        "layout": _layout(),
        "mags": mags,
    }


def _meta(sample_id, n_mags, total_hits, unique_fams):
    return {
        "title": "CAZyme Family Composition per MAG",
        "sample_id": sample_id,
        "n_mags": n_mags,
        "total_domain_hits": total_hits,
        "unique_families": unique_fams,
        "confidence_filter": "\u2265 2 tools",
        "schema_version": SCHEMA_VERSION,
        "generated_utc": datetime.datetime.now(datetime.timezone.utc)
                                   .strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def _layout():
    return {
        "colors": CLASS_COLORS,
        "labels": CLASS_LABELS,
        "stack_order": VALID_CLASSES,
    }


# ---- Main -------------------------------------------------------------------
def main(argv):
    if len(argv) != 3:
        sys.stderr.write(
            f"ERROR: Expected 3 args (DBCAN_SAMPLE_DIR, OUTPUT_DIR, SAMPLE_ID), got {len(argv)}.\n"
            "Usage: python3 dbcan_cazyme_json.py <DBCAN_SAMPLE_DIR> <OUTPUT_DIR> <SAMPLE_ID>\n")
        return 1

    dbcan_sample_dir, output_dir, sample_id = argv
    os.makedirs(output_dir, exist_ok=True)

    log = RunLog(os.path.join(output_dir, f"{sample_id}_dbcan_run.log"))
    log("=== dbcan_cazyme_json.py started ===")
    log("Sample ID:", sample_id)
    log("dbCAN sample dir:", os.path.abspath(dbcan_sample_dir))
    log("Output dir:", os.path.abspath(output_dir))

    status = 0
    try:
        if not os.path.isdir(dbcan_sample_dir):
            raise NotADirectoryError(
                f"DBCAN_SAMPLE_DIR does not exist: '{dbcan_sample_dir}'")
        log("STEP: Input directory validated.")

        doc = build_document(dbcan_sample_dir, sample_id, log)

        json_path = os.path.join(output_dir, "mag_dbcan_plots_data.json")
        with open(json_path, "w") as fh:
            json.dump(doc, fh, indent=2, ensure_ascii=False)
        log("STEP: JSON written:", json_path)

    except Exception as exc:
        log("ERROR:", str(exc))
        status = 1
    finally:
        log(f"=== dbcan_cazyme_json.py finished with exit status {status} ===")
        log.close()
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
