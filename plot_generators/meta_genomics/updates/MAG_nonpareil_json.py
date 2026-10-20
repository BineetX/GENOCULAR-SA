#!/usr/bin/env python3
# ==============================================================================
# nonpareil_json.py
#
# Python port of nonpareil_coverage.R.  Reads a Nonpareil .npo redundancy table
# for one sample and emits a plot-ready JSON document (observed rarefied coverage
# points + fitted sigmoidal model + LRstar projection + current-effort marker)
# for the React/Plotly frontend.
#
# This is a faithful reimplementation of the relevant parts of the Nonpareil R
# package (Rodriguez-R et al. 2018, mSystems 3(3):e00039-18; GPL/Artistic-2.0),
# specifically Nonpareil.read_metadata / read_data / fit_model / f / antif, so
# that C, Nd (diversity) and LRstar match `Nonpareil.curve()` without needing R.
#
# Requires numpy + scipy (for the gamma-CDF model and weighted nonlinear fit) —
# both are standard in metagenomics analysis environments. Everything else is
# stdlib.
#
# EXACT CLI ARGUMENT ORDER (unchanged from the R script):
#   arg1: NPO_FILE     path to the Nonpareil .npo redundancy table
#   arg2: OUTPUT_DIR   output directory for JSON + log
#   arg3: SAMPLE_ID    sample identifier string
#
# Usage:
#   python3 nonpareil_json.py <NPO_FILE> <OUTPUT_DIR> <SAMPLE_ID>
#
# Output:
#   <OUTPUT_DIR>/mag_nonpareil_plots_data.json    (frontend input)
#   <OUTPUT_DIR>/<SAMPLE_ID>_Nonpareil_run.log
# ==============================================================================

import os
import sys
import json
import math
import datetime

try:
    import numpy as np
    from scipy.optimize import curve_fit
    from scipy.stats import gamma as _gamma
except ImportError as exc:  # pragma: no cover
    sys.stderr.write(f"[FATAL] numpy + scipy are required: {exc}\n")
    sys.exit(1)

SCHEMA_VERSION = "1.0"
STAR = 95  # objective coverage percentage (near-complete)

COLORS = {"observed": "#8C8C8C", "model": "#0072B2",
          "current": "#D55E00", "projection": "#009E73"}


class RunLog:
    def __init__(self, path):
        self._fh = open(path, "a")

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


# ---- Nonpareil model functions (ports of Nonpareil.f / Nonpareil.antif) -----
def nonpareil_f(x, a, b):
    """Projected model: pgamma(log1p(x), shape=a, rate=b)."""
    return _gamma.cdf(np.log1p(x), a, scale=1.0 / b)


def nonpareil_antif(y, a, b):
    """Inverse: exp(qgamma(y, shape=a, rate=b)) - 1."""
    return np.exp(_gamma.ppf(y, a, scale=1.0 / b)) - 1.0


# ---- .npo parsing (ports of read_metadata + read_data) ----------------------
def read_metadata(lines):
    meta = {}
    for ln in lines:
        if ln.startswith("# @"):
            body = ln[3:].strip()
            if ": " in body:
                k, v = body.split(": ", 1)
                meta[k.strip()] = v.strip()
    kernel = "alignment"
    log_sample = 0.0
    ksize = meta.get("ksize")
    if ksize is not None:
        try:
            kv = float(ksize)
            if 0 < kv < 1001:
                kernel = "kmer"
        except ValueError:
            pass
    if "divide" in meta:
        log_sample = float(meta["divide"])
    if "logsampling" in meta:
        log_sample = float(meta["logsampling"])

    L = float(meta["L"]) if "L" in meta else None
    R = float(meta["R"]) if "R" in meta else None
    if kernel == "kmer":
        overlap = 50.0
        AL = float(meta["AL"]) if "AL" in meta else L
    else:
        overlap = float(meta["overlap"]) if "overlap" in meta else None
        AL = L
    version = meta.get("version", "unknown")
    return {"kernel": kernel, "log_sample": log_sample, "L": L, "R": R,
            "overlap": overlap, "AL": AL, "version": version}


def coverage_factor(overlap):
    return 1.0 - math.exp(2.23e-2 * overlap - 3.5698)


def read_data(rows, meta, correction_factor=True):
    """rows: list of 6-col numeric tuples. Returns dict with x.obs/x.adj/y.cov/..."""
    rows = sorted(rows, key=lambda r: r[0])
    a = np.array(rows, dtype=float)  # cols: effort, avg, sd, q1, med, q3
    x_obs = a[:, 0].copy()
    y_red = a[:, 1].copy()
    kappa = float(y_red[-1])

    cor_f = coverage_factor(meta["overlap"]) if (correction_factor and meta["overlap"] is not None) else 1.0
    # raise the redundancy summary columns (2..6) to the power cor_f -> coverage
    for i in range(1, 6):
        a[:, i] = np.power(a[:, i], cor_f)

    y_cov = a[:, 1]
    y_sd = a[:, 2]
    y_p50 = a[:, 4]
    C = float(y_cov[-1])

    # adjusted sequencing effort
    logx = np.log(x_obs)
    mx = logx.max()
    x_adj = np.exp(mx + (C ** 0.27) * (logx - mx))
    x_adj = x_adj * meta["AL"] * meta["R"] / x_adj.max()

    # consistency checks (mirrors the R warnings; not fatal here)
    consistent = True
    warnings = []
    mask = x_adj <= 0.5 * x_adj[-1]
    twenty = int(np.argmax(x_adj * mask)) if mask.any() else len(x_adj) - 1
    if y_p50[twenty] == 0:
        consistent = False
        warnings.append("Median of the curve is zero at 50% of the reads.")
    if kappa <= 1e-5:
        consistent = False
        warnings.append("Redundancy curve too low.")
    if y_cov[1] >= 1 - 1e-5:
        consistent = False
        warnings.append("Curve too steep.")
    if int(np.sum((y_cov > 0) & (y_cov < 0.9))) <= 10:
        consistent = False
        warnings.append("Insufficient resolution below 90% coverage.")

    return {"x_obs": x_obs, "x_adj": x_adj, "y_cov": y_cov, "y_sd": y_sd,
            "kappa": kappa, "C": C, "consistent": consistent, "warnings": warnings}


def fit_model(data, log_sample, log):
    """Port of Nonpareil.fit_model. Returns (has_model, a, b, diversity, LRstar, modelR)."""
    x = data["x_adj"]
    y = data["y_cov"]
    sd = data["y_sd"]
    sel = (y > 0) & (y < 0.9)
    xs, ys, sds = x[sel], y[sel], sd[sel]
    if xs.size < 3:
        log("WARNING: too few points (0<cov<0.9) to fit the model.")
        return (False, None, None, None, None, None)

    if log_sample == 0:
        weights_exp = [-1.1, -1.2, -0.9, -1.3, -1]
    else:
        weights_exp = [0, 1, -1, 1.3, -1.1, 1.5, -1.5, 3, -3]

    for we in weights_exp:
        # nls weight w = y.sd^we  ->  curve_fit sigma = w^(-1/2)
        with np.errstate(divide="ignore", invalid="ignore"):
            w = np.power(sds, we)
        sigma = np.where(w > 0, 1.0 / np.sqrt(w), np.inf)
        if not np.all(np.isfinite(sigma)):
            sigma = np.ones_like(ys)
        try:
            popt, _ = curve_fit(
                nonpareil_f, xs, ys, p0=[1.0, 0.1],
                bounds=([0, 0], [np.inf, np.inf]), sigma=sigma,
                maxfev=20000,
            )
            a, b = float(popt[0]), float(popt[1])
            pred = nonpareil_f(xs, a, b)
            if not np.all(np.isfinite(pred)):
                continue
            modelR = float(np.corrcoef(ys, pred)[0, 1])
            diversity = (a - 1.0) / b if a > 1 else 0.0
            LRstar = float(nonpareil_antif(STAR / 100.0, a, b))
            log(f"Model converged (weights.exp={we}). a={a:.4f} b={b:.4f} "
                f"modelR={modelR:.4f}")
            return (True, a, b, diversity, LRstar, modelR)
        except Exception as e:
            log(f"  fit attempt (weights.exp={we}) failed: {e}", )
            continue

    log("WARNING: sigmoidal model did not converge for any weights.exp.")
    return (False, None, None, None, None, None)


def build_document(npo_file, sample_id, log):
    with open(npo_file, "r", errors="replace") as fh:
        raw = fh.readlines()

    meta = read_metadata(raw)
    log(f"Metadata: kernel={meta['kernel']} L={meta['L']} R={meta['R']} "
        f"overlap={meta['overlap']} AL={meta['AL']} version={meta['version']}")
    if meta["R"] is None or meta["L"] is None:
        raise RuntimeError("Missing required @L / @R metadata in .npo header.")

    # data rows: non-comment lines with >=6 numeric tab-separated columns
    rows = []
    for ln in raw:
        if ln.startswith("#") or not ln.strip():
            continue
        parts = ln.rstrip("\r\n").split("\t")
        if len(parts) < 6:
            continue
        try:
            rows.append(tuple(float(parts[i]) for i in range(6)))
        except ValueError:
            continue
    if not rows:
        raise RuntimeError("No usable 6-column data rows found in .npo.")
    log(f"Read {len(rows)} rarefaction rows from .npo.")

    data = read_data(rows, meta, correction_factor=True)
    log(f"kappa={data['kappa']:.4g} | C={data['C']:.4f} | "
        f"consistent={data['consistent']}")
    for w in data["warnings"]:
        log("CONSISTENCY:", w, )

    has_model, a, b, diversity, LRstar, modelR = fit_model(
        data, meta["log_sample"], log)

    x_adj = data["x_adj"]
    y_cov = data["y_cov"]
    current_effort_bp = float(np.max(x_adj))

    observed = [{"x": round(float(xi), 3), "y": round(float(yi), 5)}
                for xi, yi in zip(x_adj, y_cov)]

    model_pts = None
    LRstar_gbp = None
    if has_model:
        LRstar_gbp = LRstar / 1e9
        lo = max(float(np.min(x_adj)), 1e3)
        hi = max(float(np.max(x_adj)), LRstar) * 1.05
        xseq = np.exp(np.linspace(math.log(lo), math.log(hi), 500))
        yseq = nonpareil_f(xseq, a, b)
        model_pts = [{"x": round(float(xi), 3), "y": round(float(yi), 5)}
                     for xi, yi in zip(xseq, yseq)]
        log(f"Model: C={data['C']:.4f} Nd={diversity:.4f} "
            f"LRstar={LRstar:.4e} bp ({LRstar_gbp:.2f} Gbp)")

    if has_model:
        subtitle = (f"C = {data['C']:.3f} | Nd = {diversity:.3f} | "
                    f"LRstar (95%) = {LRstar_gbp:.2f} Gbp")
    else:
        subtitle = "Model did not converge: LRstar/diversity not estimable"

    doc = {
        "meta": {
            "title": "Nonpareil Rarefaction & Sequencing Coverage Curve",
            "sample_id": sample_id,
            # per request: the Sample ID segment is removed from the subtitle
            "subtitle": subtitle,
            "x_title": "Sequencing effort (bp, consistency-adjusted, log10 scale)",
            "y_title": "Estimated average coverage",
            "model_converged": bool(has_model),
            "C": round(data["C"], 4),
            "Nd": round(diversity, 4) if has_model else None,
            "LRstar_bp": LRstar if has_model else None,
            "LRstar_gbp": round(LRstar_gbp, 4) if has_model else None,
            "current_effort_bp": current_effort_bp,
            "star": STAR / 100.0,
            "schema_version": SCHEMA_VERSION,
            "generated_utc": datetime.datetime.now(datetime.timezone.utc)
                                       .strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "layout": {"colors": COLORS, "star": STAR / 100.0},
        "observed": observed,
        "model": model_pts,
        "markers": {
            "current_effort": {"x": current_effort_bp, "label": "Current effort"},
            "lrstar": ({"x": LRstar, "y": STAR / 100.0, "label": "LRstar (95%)"}
                       if has_model else None),
        },
    }
    return doc


def main(argv):
    if len(argv) != 3:
        sys.stderr.write(
            "ERROR: Expected exactly 3 arguments: NPO_FILE OUTPUT_DIR SAMPLE_ID\n"
            "Usage: python3 nonpareil_json.py <NPO_FILE> <OUTPUT_DIR> <SAMPLE_ID>\n")
        return 1

    npo_file, output_dir, sample_id = argv
    os.makedirs(output_dir, exist_ok=True)

    log = RunLog(os.path.join(output_dir, f"{sample_id}_Nonpareil_run.log"))
    log("=== nonpareil_json.py started ===")
    log("NPO_FILE:", npo_file)
    log("OUTPUT_DIR:", output_dir)
    log("SAMPLE_ID:", sample_id)

    status = 0
    try:
        if not os.path.isfile(npo_file):
            raise FileNotFoundError(f"Input NPO_FILE does not exist: {npo_file}")
        doc = build_document(npo_file, sample_id, log)
        json_path = os.path.join(output_dir, "mag_nonpareil_plots_data.json")
        with open(json_path, "w") as fh:
            json.dump(doc, fh, indent=2)
        log("JSON written ->", json_path)
        log("=== nonpareil_json.py completed successfully ===")
    except Exception as exc:
        log("ERROR:", str(exc))
        status = 1
    finally:
        log.close()
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
