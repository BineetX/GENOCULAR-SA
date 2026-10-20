#!/usr/bin/env python3

import argparse
import re
from pathlib import Path
from collections import Counter

import pandas as pd
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patheffects as pe


# =========================================================
# helpers
# =========================================================

def ensure_dir(path):
    Path(path).mkdir(parents=True, exist_ok=True)


def split_multi(val):
    if pd.isna(val):
        return []
    val = str(val).strip()
    if val == "-" or val == "":
        return []
    return [x.strip() for x in re.split(r"[;,|]", val) if x.strip()]


def detect_column(columns, candidates):

    lower_map = {c.lower(): c for c in columns}

    for cand in candidates:
        if cand.lower() in lower_map:
            return lower_map[cand.lower()]

    for c in columns:
        for cand in candidates:
            if cand.lower() in c.lower():
                return c

    return None


def read_annotations_file(path):

    lines = []

    with open(path) as fh:
        for line in fh:
            if line.startswith("##"):
                continue
            lines.append(line)

    content = "".join(lines)

    if content.startswith("#"):
        content = content[1:]

    from io import StringIO

    df = pd.read_csv(StringIO(content), sep="\t", dtype=str)
    df.columns = [c.strip() for c in df.columns]

    return df.fillna("-")


# =========================================================
# EC enzyme donut plot
# =========================================================

def plot_ec_donut(df, outdir):

    ec_col = detect_column(df.columns, ["EC"])

    if ec_col is None:
        print("No EC column detected")
        return

    classes = []

    for val in df[ec_col]:

        for ec in split_multi(val):

            m = re.match(r"(\d)\.", ec)

            if m:
                classes.append(m.group(1))

    mapping = {
        "1": "Oxidoreductases",
        "2": "Transferases",
        "3": "Hydrolases",
        "4": "Lyases",
        "5": "Isomerases",
        "6": "Ligases",
        "7": "Translocases"
    }

    labels = [mapping[x] for x in classes if x in mapping]

    counts = pd.Series(labels).value_counts()

    colors = [
        "#264653",
        "#2A9D8F",
        "#E9C46A",
        "#F4A261",
        "#E76F51",
        "#5E60CE",
        "#4EA8DE"
    ]

    fig, ax = plt.subplots(figsize=(8,8))

    wedges, texts, autotexts = ax.pie(
        counts,
        autopct="%1.1f%%",
        startangle=90,
        colors=colors,
        wedgeprops=dict(width=0.35, edgecolor="white"),
        pctdistance=0.82
    )

    for t in autotexts:
        t.set_fontsize(12)
        t.set_weight("bold")

    ax.set_title(
        "EC Enzyme Classification",
        fontsize=18,
        weight="bold"
    )

    ax.legend(
        wedges,
        counts.index,
        title="Enzyme Class",
        loc="center left",
        bbox_to_anchor=(1,0.5)
    )

    plt.tight_layout()

    outfile = Path(outdir) / "EC_enzyme_donut.png"

    plt.savefig(outfile, dpi=300, bbox_inches="tight")
    plt.close()

    print("Saved:", outfile)


# =========================================================
# PFAM domain lollipop plot
# =========================================================

def plot_pfam_lollipop(df, outdir):

    pfam_col = detect_column(df.columns, ["PFAMs","PFAM"])

    if pfam_col is None:
        print("No PFAM column detected")
        return

    domains = []

    for val in df[pfam_col]:
        domains += split_multi(val)

    counts = pd.Series(domains).value_counts().head(20)

    y = np.arange(len(counts))

    fig, ax = plt.subplots(figsize=(10,8))

    ax.hlines(
        y,
        xmin=0,
        xmax=counts.values,
        color="#6C8EBF",
        linewidth=4,
        alpha=0.7
    )

    ax.scatter(
        counts.values,
        y,
        s=350,
        color="#264653",
        edgecolor="white",
        linewidth=2,
        zorder=3
    )

    ax.set_yticks(y)
    ax.set_yticklabels(counts.index, fontsize=10)

    ax.set_xlabel("Gene Count", fontsize=13, weight="bold")

    ax.set_title(
        "Top PFAM Domain Families",
        fontsize=18,
        weight="bold"
    )

    ax.grid(axis="x", linestyle="--", alpha=0.3)

    for spine in ax.spines.values():
        spine.set_visible(False)

    plt.tight_layout()

    outfile = Path(outdir) / "PFAM_domain_lollipop.png"

    plt.savefig(outfile, dpi=300, bbox_inches="tight")

    plt.close()

    print("Saved:", outfile)


# =========================================================
# main
# =========================================================

def main():

    parser = argparse.ArgumentParser()

    parser.add_argument(
        "-a",
        "--annotations",
        required=True
    )

    parser.add_argument(
        "-o",
        "--outdir",
        default="emapper_beautiful_plots"
    )

    args = parser.parse_args()

    ensure_dir(args.outdir)

    df = read_annotations_file(args.annotations)

    plot_ec_donut(df, args.outdir)

    plot_pfam_lollipop(df, args.outdir)

    print("Done.")


if __name__ == "__main__":
    main()
