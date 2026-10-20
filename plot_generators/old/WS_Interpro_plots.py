#!/usr/bin/env python3

import argparse
import re
from pathlib import Path
from collections import Counter

import pandas as pd
import matplotlib.pyplot as plt


# =========================================================
# ARGUMENTS
# =========================================================
def parse_args():
    parser = argparse.ArgumentParser(
        description="Generate improved InterProScan family plots with cleaned categories and richer subcategory breakdown."
    )
    parser.add_argument(
        "-i", "--input",
        default="interproscan_results.tsv",
        help="Path to InterProScan TSV file"
    )
    parser.add_argument(
        "-o", "--outdir",
        default="interpro_family_plots",
        help="Output directory"
    )
    parser.add_argument(
        "--top_n",
        type=int,
        default=10,
        help="Top N domain families / GO terms to display"
    )
    parser.add_argument(
        "--min_count",
        type=int,
        default=1,
        help="Minimum count required for a family to be plotted"
    )
    return parser.parse_args()


# =========================================================
# FILE RESOLUTION
# =========================================================
def resolve_input_file(input_path_str: str) -> Path:
    p = Path(input_path_str)

    if p.exists():
        return p.resolve()

    cwd_candidate = Path.cwd() / input_path_str
    if cwd_candidate.exists():
        return cwd_candidate.resolve()

    script_dir = Path(__file__).resolve().parent
    script_candidate = script_dir / input_path_str
    if script_candidate.exists():
        return script_candidate.resolve()

    raise FileNotFoundError(f"Could not find input file: {input_path_str}")


# =========================================================
# STYLE
# =========================================================
def set_style():
    plt.rcParams.update({
        "font.family": "DejaVu Sans",
        "font.size": 12,
        "font.weight": "bold",
        "axes.titlesize": 18,
        "axes.titleweight": "bold",
        "axes.labelsize": 15,
        "axes.labelweight": "bold",
        "xtick.labelsize": 12,
        "ytick.labelsize": 12,
        "text.color": "black",
        "axes.edgecolor": "black",
        "axes.linewidth": 1.5,
        "xtick.color": "black",
        "ytick.color": "black",
        "figure.facecolor": "white",
        "savefig.facecolor": "white",
        "legend.fontsize": 11
    })


def prettify_axis(ax, grid_axis="x"):
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_linewidth(1.4)
    ax.spines["bottom"].set_linewidth(1.4)
    ax.tick_params(colors="black", width=1.1)
    if grid_axis:
        ax.grid(axis=grid_axis, linestyle=(0, (3, 4)), linewidth=0.8, color="#BDBDBD", alpha=0.7)
        ax.set_axisbelow(True)


# =========================================================
# LOAD TSV
# =========================================================
def load_interpro_tsv(tsv_file: Path) -> pd.DataFrame:
    cols = [
        "protein_accession",
        "sequence_md5",
        "sequence_length",
        "analysis",
        "signature_accession",
        "signature_description",
        "start",
        "end",
        "score",
        "status",
        "date",
        "interpro_accession",
        "interpro_description",
        "go_terms",
        "pathways"
    ]

    df = pd.read_csv(
        tsv_file,
        sep="\t",
        names=cols,
        comment="#",
        dtype=str
    )

    for c in ["sequence_length", "start", "end"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")

    for c in cols:
        df[c] = df[c].fillna("").astype(str).str.strip()

    return df


# =========================================================
# LABEL CLEANING / FAMILY COLLAPSING
# =========================================================
def normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", str(text)).strip()


def clean_family_name(name: str) -> str:

    name = normalize_space(name)
    low = name.lower()

    if not name or name in {"-", "na", "n/a", "none", "unclassified"}:
        return ""

    # ATPases
    if "aaa" in low:
        return "AAA+ ATPase family"

    if "p-loop ntpase" in low:
        return "P-loop NTPase family"

    # Proteases
    if "ftsh" in low or "m41" in low:
        return "FtsH / M41 metalloprotease family"

    if "protease" in low or "peptidase" in low:
        return "Protease / peptidase family"

    # Transport
    if "abc transporter" in low:
        return "ABC transporter family"

    if "major facilitator" in low or "mfs transporter" in low:
        return "MFS transporter family"

    if "permease" in low:
        return "Membrane permease family"

    # Enzymes
    if "dehydrogenase" in low:
        return "Dehydrogenase family"

    if "oxidoreductase" in low:
        return "Oxidoreductase family"

    if "hydrolase" in low:
        return "Hydrolase family"

    if "transferase" in low:
        return "Transferase family"

    if "ligase" in low:
        return "Ligase family"

    if "kinase" in low:
        return "Kinase family"

    if "isomerase" in low:
        return "Isomerase family"

    if "aldolase" in low:
        return "Aldolase family"

    # DNA / transcription
    if "helix-turn-helix" in low or "hth" in low:
        return "HTH transcription factor family"

    if "dna-binding" in low:
        return "DNA binding protein family"

    if "transcriptional regulator" in low:
        return "Regulatory protein family"

    # Ribosomal / translation
    if "ribosomal protein" in low:
        return "Ribosomal protein family"

    if "translation factor" in low:
        return "Translation factor family"

    # Redox
    if "thioredoxin" in low:
        return "Thioredoxin family"

    if "ferredoxin" in low:
        return "Ferredoxin family"

    # Chaperones
    if "chaperone" in low:
        return "Molecular chaperone family"

    # Membrane proteins
    if "membrane protein" in low:
        return "Membrane protein family"

    return name


def best_family_label(row: pd.Series) -> str:
    if row["interpro_description"]:
        x = clean_family_name(row["interpro_description"])
        if x:
            return x

    if row["signature_description"]:
        x = clean_family_name(row["signature_description"])
        if x:
            return x

    if row["interpro_accession"]:
        return row["interpro_accession"]

    if row["signature_accession"]:
        return row["signature_accession"]

    return ""


def add_annotation_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["family_label"] = df.apply(best_family_label, axis=1)
    df["analysis_clean"] = df["analysis"].replace("", "Unknown").str.upper()

    feature_key = df["interpro_accession"].replace("", pd.NA)
    fallback = df["signature_accession"].replace("", pd.NA)
    df["feature_key"] = feature_key.fillna(fallback)

    return df


# =========================================================
# GO TERM EXTRACTION
# =========================================================
GO_NAME_MAP = {
    "GO:0003674": "molecular function",
    "GO:0003824": "catalytic activity",
    "GO:0005488": "binding",
    "GO:0005524": "ATP binding",
    "GO:0016887": "ATP hydrolysis activity",
    "GO:0008152": "metabolic process",
    "GO:0009987": "cellular process",
    "GO:0016020": "membrane",
    "GO:0005737": "cytoplasm",
    "GO:0004222": "metalloendopeptidase activity",
}


def extract_go_counter(df: pd.DataFrame):
    go_counter = Counter()
    for field in df["go_terms"]:
        if not field or field == "-":
            continue
        for term in [x.strip() for x in str(field).split("|") if x.strip() and x.strip() != "-"]:
            if re.fullmatch(r"GO:\d{7}", term):
                go_counter[term] += 1
    return go_counter


# =========================================================
# PLOT 1: IMPROVED DOMAIN FAMILY SUBCATEGORY DISTRIBUTION
# =========================================================
def plot_domain_family_subcategory_distribution(df: pd.DataFrame, outdir: Path, top_n: int, min_count: int):
    counted = df.drop_duplicates(
        subset=["protein_accession", "feature_key", "family_label", "analysis_clean"]
    ).copy()

    # remove undefined / empty labels
    counted = counted[counted["family_label"].astype(str).str.strip() != ""]
    counted = counted[~counted["family_label"].isin(["-", "Unknown", "Unclassified"])]

    family_counts = counted["family_label"].value_counts()
    family_counts = family_counts[family_counts >= min_count]

    # ensure up to top_n informative categories
    selected_families = family_counts.head(top_n).index.tolist()

    if len(selected_families) == 0:
        print("No valid domain families found for plot 1.")
        return

    sub = counted[counted["family_label"].isin(selected_families)].copy()

    # remove noisy unknown sources
    sub = sub[sub["analysis_clean"].astype(str).str.strip() != ""]
    sub = sub[sub["analysis_clean"] != "UNKNOWN"]

    pivot = pd.crosstab(sub["family_label"], sub["analysis_clean"])
    pivot["TOTAL"] = pivot.sum(axis=1)
    pivot = pivot.sort_values("TOTAL", ascending=True).drop(columns="TOTAL")

    fig, ax = plt.subplots(figsize=(15, max(7, 0.7 * len(pivot))), dpi=600)

    colors = [
        "#1E88E5", "#FB8C00", "#43A047", "#8E24AA", "#E53935",
        "#00897B", "#6D4C41", "#FDD835", "#3949AB", "#D81B60",
        "#7CB342", "#5E35B1"
    ]

    pivot.plot(
        kind="barh",
        stacked=True,
        ax=ax,
        color=colors[:len(pivot.columns)],
        edgecolor="black",
        linewidth=0.8
    )

    totals = pivot.sum(axis=1)
    for i, total in enumerate(totals):
        ax.text(total + 0.2, i, str(int(total)),
                va="center", ha="left",
                fontsize=11, fontweight="bold", color="black")

    ax.set_title("Top domain families with InterPro member database breakdown")
    ax.set_xlabel("Number of proteins annotated")
    ax.set_ylabel("Domain family annotation")
    prettify_axis(ax, grid_axis="x")

    ax.legend(
        title="Annotation source",
        frameon=False,
        bbox_to_anchor=(1.02, 1),
        loc="upper left"
    )

    plt.tight_layout()
    plt.savefig(outdir / "01_domain_family_subcategory_distribution.png", dpi=600, bbox_inches="tight")
    plt.savefig(outdir / "01_domain_family_subcategory_distribution.pdf", dpi=600, bbox_inches="tight")
    plt.close()


# =========================================================
# PLOT 2: TOP SPECIFIC GO TERMS
# =========================================================
def plot_top_specific_go_terms(df: pd.DataFrame, outdir: Path, top_n: int):
    go_counter = extract_go_counter(df)

    if not go_counter:
        print("No GO annotations found for plot 2.")
        return

    counts = pd.Series(go_counter).sort_values(ascending=False).head(top_n).sort_values(ascending=True)
    labels = [f"{go} ({GO_NAME_MAP.get(go, 'specific term')})" for go in counts.index]

    fig, ax = plt.subplots(figsize=(13, 8), dpi=600)
    bars = ax.barh(labels, counts.values, color="#7CB342", edgecolor="black", linewidth=1.0)

    for b, v in zip(bars, counts.values):
        ax.text(v + 0.15, b.get_y() + b.get_height()/2, str(v),
                va="center", ha="left", fontsize=10, fontweight="bold", color="black")

    ax.set_title("Most frequent specific GO annotations")
    ax.set_xlabel("Count")
    ax.set_ylabel("GO term")
    prettify_axis(ax, grid_axis="x")

    plt.tight_layout()
    plt.savefig(outdir / "02_top_specific_go_terms.png", dpi=600, bbox_inches="tight")
    plt.savefig(outdir / "02_top_specific_go_terms.pdf", dpi=600, bbox_inches="tight")
    plt.close()


# =========================================================
# PLOT 3: ANNOTATION SOURCE CONTRIBUTION
# =========================================================
def plot_annotation_source_contribution(df: pd.DataFrame, outdir: Path):
    counted = df.drop_duplicates(subset=["protein_accession", "feature_key", "analysis_clean"]).copy()
    counted = counted[counted["analysis_clean"].astype(str).str.strip() != ""]
    counted = counted[counted["analysis_clean"] != "UNKNOWN"]

    source_counts = counted["analysis_clean"].value_counts().sort_values(ascending=True)

    if source_counts.empty:
        print("No annotation source data found for plot 3.")
        return

    fig, ax = plt.subplots(figsize=(11, 7), dpi=600)
    bars = ax.barh(source_counts.index, source_counts.values,
                   color="#29B6F6", edgecolor="black", linewidth=1.0)

    for b, v in zip(bars, source_counts.values):
        ax.text(v + 0.15, b.get_y() + b.get_height()/2, str(v),
                va="center", ha="left", fontsize=10, fontweight="bold", color="black")

    ax.set_title("Contribution of InterPro member databases")
    ax.set_xlabel("Number of protein annotations")
    ax.set_ylabel("Member database / source")
    prettify_axis(ax, grid_axis="x")

    plt.tight_layout()
    plt.savefig(outdir / "03_annotation_source_contribution.png", dpi=600, bbox_inches="tight")
    plt.savefig(outdir / "03_annotation_source_contribution.pdf", dpi=600, bbox_inches="tight")
    plt.close()


# =========================================================
# SUMMARY FILE
# =========================================================
def write_summary_file(df: pd.DataFrame, outdir: Path, top_n: int):
    counted = df.drop_duplicates(subset=["protein_accession", "feature_key", "family_label", "analysis_clean"]).copy()
    counted = counted[counted["family_label"].astype(str).str.strip() != ""]

    top_families = counted["family_label"].value_counts().head(top_n)
    source_counts = counted["analysis_clean"].value_counts()
    go_counter = extract_go_counter(df)
    top_go = pd.Series(go_counter).sort_values(ascending=False).head(top_n) if go_counter else pd.Series(dtype=int)

    summary_path = outdir / "interpro_interpretation_summary.txt"
    with open(summary_path, "w") as f:
        f.write("INTERPROSCAN SUMMARY\n")
        f.write("=" * 50 + "\n\n")
        f.write(f"Total annotation rows: {len(df)}\n")
        f.write(f"Proteins with at least one annotation: {df['protein_accession'].nunique()}\n\n")

        f.write("Top domain families:\n")
        for label, count in top_families.items():
            f.write(f"  - {label}: {count}\n")

        f.write("\nAnnotation source contribution:\n")
        for source, count in source_counts.items():
            f.write(f"  - {source}: {count}\n")

        if not top_go.empty:
            f.write("\nTop GO terms:\n")
            for go, count in top_go.items():
                f.write(f"  - {go} ({GO_NAME_MAP.get(go, 'specific term')}): {count}\n")


# =========================================================
# MAIN
# =========================================================
def main():
    args = parse_args()
    set_style()

    input_file = resolve_input_file(args.input)
    outdir = Path(args.outdir).resolve()
    outdir.mkdir(parents=True, exist_ok=True)

    print(f"Reading: {input_file}")
    print(f"Saving plots to: {outdir}")

    df = load_interpro_tsv(input_file)
    df = add_annotation_columns(df)

    plot_domain_family_subcategory_distribution(df, outdir, top_n=args.top_n, min_count=args.min_count)
    plot_top_specific_go_terms(df, outdir, top_n=args.top_n)
    plot_annotation_source_contribution(df, outdir)
    write_summary_file(df, outdir, top_n=args.top_n)

    print("Finished.")
    print("Created:")
    print("  01_domain_family_subcategory_distribution")
    print("  02_top_specific_go_terms")
    print("  03_annotation_source_contribution")
    print("  interpro_interpretation_summary.txt")


if __name__ == "__main__":
    main()
