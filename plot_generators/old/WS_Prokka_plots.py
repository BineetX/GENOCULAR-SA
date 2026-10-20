#!/usr/bin/env python3

import argparse
from pathlib import Path
from collections import OrderedDict

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from matplotlib import cm
from mpl_toolkits.axes_grid1.inset_locator import inset_axes


# ==================================================
# ARGUMENTS
# ==================================================
def parse_args():
    parser = argparse.ArgumentParser(
        description="Generate bold, publication-style multi-panel Prokka plots from annotated_genome.tsv"
    )
    parser.add_argument(
        "-i", "--input",
        default="annotated_genome.tsv",
        help="Path to Prokka TSV file (default: annotated_genome.tsv)"
    )
    parser.add_argument(
        "-o", "--outdir",
        default=".",
        help="Output directory for plots (default: current directory)"
    )
    parser.add_argument(
        "--faa",
        default=None,
        help="Optional path to annotated_genome.faa for exact amino-acid lengths"
    )
    return parser.parse_args()


# ==================================================
# RESOLVE FILES
# ==================================================
def resolve_input_file(input_path_str):
    input_path = Path(input_path_str)

    if input_path.exists():
        return input_path.resolve()

    cwd_candidate = Path.cwd() / input_path_str
    if cwd_candidate.exists():
        return cwd_candidate.resolve()

    script_dir = Path(__file__).resolve().parent
    script_candidate = script_dir / input_path_str
    if script_candidate.exists():
        return script_candidate.resolve()

    raise FileNotFoundError(
        f"Could not find input file: {input_path_str}\n"
        f"Tried:\n"
        f"  - {input_path}\n"
        f"  - {cwd_candidate}\n"
        f"  - {script_candidate}"
    )


def resolve_optional_faa(tsv_file, faa_arg=None):
    if faa_arg:
        faa_path = Path(faa_arg)
        if faa_path.exists():
            return faa_path.resolve()
        raise FileNotFoundError(f"FAA file not found: {faa_arg}")

    candidate = tsv_file.with_suffix(".faa")
    if candidate.exists():
        return candidate.resolve()

    return None


# ==================================================
# STYLE
# ==================================================
def set_plot_style():
    plt.rcParams.update({
        "font.family": "DejaVu Sans",
        "font.size": 14,
        "font.weight": "bold",
        "axes.titlesize": 20,
        "axes.titleweight": "bold",
        "axes.labelsize": 16,
        "axes.labelweight": "bold",
        "xtick.labelsize": 13,
        "ytick.labelsize": 13,
        "xtick.color": "black",
        "ytick.color": "black",
        "text.color": "black",
        "axes.facecolor": "white",
        "figure.facecolor": "white",
        "savefig.facecolor": "white",
        "axes.edgecolor": "black",
        "axes.linewidth": 1.5,
        "legend.fontsize": 12,
        "legend.title_fontsize": 12
    })


def prettify_axis(ax, ygrid=True):
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_color("black")
    ax.spines["bottom"].set_color("black")
    ax.spines["left"].set_linewidth(1.5)
    ax.spines["bottom"].set_linewidth(1.5)
    ax.tick_params(colors="black", width=1.5, labelcolor="black")
    if ygrid:
        ax.yaxis.grid(True, linestyle=(0, (3, 4)), linewidth=1.0, color="#bdbdbd", alpha=0.9)
        ax.set_axisbelow(True)


def gradient_colors(n, cmap_name="viridis", start=0.15, end=0.9):
    cmap = cm.get_cmap(cmap_name)
    if n == 1:
        return [cmap((start + end) / 2)]
    vals = np.linspace(start, end, n)
    return [cmap(v) for v in vals]


def add_bar_labels(ax, bars, values, fmt="{:.1f}", suffix="", fontsize=12):
    if len(values) == 0:
        return
    y_max = max(values)
    offset = max(y_max * 0.02, 0.5)
    for b, v in zip(bars, values):
        if v <= 0:
            continue
        ax.text(
            b.get_x() + b.get_width() / 2,
            b.get_height() + offset,
            f"{fmt.format(v)}{suffix}",
            ha="center",
            va="bottom",
            fontsize=fontsize,
            color="black",
            fontweight="bold"
        )


# ==================================================
# DATA LOADING
# ==================================================
def clean_columns(df):
    df.columns = [str(c).strip() for c in df.columns]
    return df


def function_status(product: str) -> str:
    p = str(product).strip().lower()
    if p == "" or p in {"unknown", "uncharacterized protein"}:
        return "Unknown function"
    if "hypothetical protein" in p:
        return "Hypothetical protein"
    return "Known function"


category_keywords = OrderedDict({
    "Iron ion homeostasis": [
        "iron", "ferric", "ferrous", "heme", "siderophore", "feo", "fur"
    ],
    "Oxidation-reduction process": [
        "oxidoreductase", "dehydrogenase", "reductase", "oxidase", "catalase",
        "peroxidase", "superoxide", "ferredoxin", "flavoprotein"
    ],
    "Cell division": [
        "cell division", "fts", "zap", "mreb", "minc", "mind", "sepa", "sepf"
    ],
    "DNA repair": [
        "dna repair", "rec", "ruv", "uvr", "mut", "lexa", "rad", "photolyase",
        "endonuclease", "excinuclease", "glycosylase"
    ],
    "Conjugation": [
        "conjug", "tra", "trb", "type iv secretion", "relaxase", "pilus assembly"
    ],
    "Resistance": [
        "resistance", "efflux", "multidrug", "beta-lactamase", "heavy metal",
        "copper resistance", "ars", "mer", "van", "tet"
    ],
    "Pathogenesis": [
        "virulence", "adhesin", "invasion", "toxin", "hemolysin", "pathogenicity"
    ],
    "DNA recombination": [
        "recombinase", "recombination", "resolvase", "site-specific recombination"
    ],
    "Transmembrane transport": [
        "transporter", "permease", "abc transporter", "symporter", "antiporter",
        "porin", "channel protein", "pump"
    ],
    "Transcription regulation": [
        "transcriptional regulator", "response regulator", "sigma factor",
        "repressor", "activator", "dna-binding", "two-component"
    ],
    "Transposition related": [
        "transposase", "insertion sequence", "mobile element", "integrase", "is element"
    ],
    "Metabolic process": [
        "synthetase", "synthase", "kinase", "isomerase", "hydrolase", "lyase",
        "transferase", "carboxylase", "ligase", "protease", "peptidase",
        "amidase", "phosphatase", "metalloenzyme"
    ]
})


def assign_category(product: str) -> str:
    p = str(product).strip().lower()
    if p == "" or p == "unknown" or "hypothetical protein" in p:
        return "Other"

    for category, keywords in category_keywords.items():
        for kw in keywords:
            if kw in p:
                return category
    return "Other"


def load_prokka_tsv(tsv_file):
    df = pd.read_csv(tsv_file, sep="\t")
    df = clean_columns(df)

    required_cols = {"ftype", "product"}
    missing = required_cols - set(df.columns)
    if missing:
        raise ValueError(
            f"Missing required columns in TSV: {', '.join(sorted(missing))}\n"
            f"Found columns: {', '.join(df.columns)}"
        )

    df["ftype"] = df["ftype"].astype(str).str.strip()
    df["product"] = df["product"].fillna("").astype(str).str.strip()

    if "len_bp" in df.columns:
        df["len_bp"] = pd.to_numeric(df["len_bp"], errors="coerce")

    cds = df[df["ftype"].str.upper() == "CDS"].copy()
    if cds.empty:
        raise ValueError("No CDS entries found in the 'ftype' column.")

    cds["function_status"] = cds["product"].apply(function_status)
    cds["category"] = cds["product"].apply(assign_category)

    if "len_bp" in cds.columns:
        cds["aa_len_est"] = (cds["len_bp"] / 3).round().astype("Int64")

    return df, cds


# ==================================================
# FASTA PARSER FOR EXACT AA LENGTHS
# ==================================================
def read_fasta_lengths(faa_file):
    lengths = []
    seq_len = 0

    with open(faa_file, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            if line.startswith(">"):
                if seq_len > 0:
                    lengths.append(seq_len)
                seq_len = 0
            else:
                seq_len += len(line)

    if seq_len > 0:
        lengths.append(seq_len)

    return lengths


# ==================================================
# PLOT 1: FUNCTIONAL SUMMARY
# ==================================================
def plot_functional_summary(cds, tsv_name, outdir):
    ordered_categories = list(category_keywords.keys()) + ["Other"]

    status_counts = cds["function_status"].value_counts().reindex(
        ["Known function", "Unknown function", "Hypothetical protein"],
        fill_value=0
    )
    cat_counts = cds["category"].value_counts().reindex(ordered_categories, fill_value=0)

    total_cds = len(cds)
    cat_percent = (cat_counts / total_cds * 100).round(2)
    status_percent = (status_counts / total_cds * 100).round(2)
    cat_percent = cat_percent.sort_values()

    fig, ax = plt.subplots(figsize=(16, 9), dpi=600)
    colors = gradient_colors(len(cat_percent), cmap_name="YlGn", start=0.35, end=0.9)

    bars = ax.bar(
        np.arange(len(cat_percent)),
        cat_percent.values,
        color=colors,
        edgecolor="black",
        linewidth=1.3,
        width=0.7,
        zorder=3
    )

    add_bar_labels(ax, bars, cat_percent.values, fmt="{:.1f}", suffix="%")

    ax.set_xticks(np.arange(len(cat_percent)))
    ax.set_xticklabels(cat_percent.index, rotation=58, ha="right", fontweight="bold", color="black")
    ax.set_ylabel("Annotated CDS (%)", color="black", fontweight="bold", fontsize=16)
    ax.set_title(
        "Functional overview of Prokka-annotated coding sequences",
        pad=18,
        fontweight="bold",
        fontsize=20,
        color="black"
    )
    ax.set_ylim(0, max(cat_percent.values) + 10)

    prettify_axis(ax, ygrid=True)
    ax.yaxis.tick_right()
    ax.yaxis.set_label_position("right")
    ax.spines["left"].set_visible(False)
    ax.spines["right"].set_visible(True)
    ax.spines["right"].set_color("black")
    ax.spines["right"].set_linewidth(1.5)

    axins = inset_axes(ax, width="35%", height="78%", loc="upper left", borderpad=1.2)
    pie_colors = ["#22c55e", "#d9d9d9", "#facc15"]
    pie_labels = [
        f"Known\n{status_percent['Known function']:.1f}%",
        f"Unknown\n{status_percent['Unknown function']:.1f}%",
        f"Hypothetical\n{status_percent['Hypothetical protein']:.1f}%"
    ]

    _, texts = axins.pie(
        status_counts.values,
        labels=pie_labels,
        colors=pie_colors,
        startangle=90,
        counterclock=False,
        labeldistance=1.08,
        wedgeprops=dict(width=0.55, edgecolor="white", linewidth=2)
    )

    for t in texts:
        t.set_fontsize(11)
        t.set_color("black")
        t.set_fontweight("bold")

    axins.text(
        0, 0, "CDS\nstatus",
        ha="center", va="center",
        fontsize=13, fontweight="bold", color="black"
    )
    axins.set_title("Annotation status", fontsize=14, pad=8, fontweight="bold", color="black")

    fig.text(
        0.015, 0.02,
        f"Input: {tsv_name} | Total CDS: {total_cds} | Functional grouping based on Prokka product keywords.",
        fontsize=12, color="black", fontweight="bold"
    )

    plt.tight_layout(rect=[0, 0.05, 1, 1])
    out_png = outdir / "prokka_functional_summary_dynamic.png"
    out_pdf = outdir / "prokka_functional_summary_dynamic.pdf"
    plt.savefig(out_png, dpi=600, bbox_inches="tight")
    plt.savefig(out_pdf, dpi=600, bbox_inches="tight")
    plt.close()

    return out_png, out_pdf


# ==================================================
# PLOT 2: FEATURE COMPOSITION
# ==================================================
def plot_feature_composition(df, tsv_name, outdir):
    feature_counts = df["ftype"].astype(str).value_counts().sort_values(ascending=False)
    total_features = feature_counts.sum()
    feature_percent = (feature_counts / total_features * 100).round(2)

    fig, ax = plt.subplots(figsize=(10.5, 6.5), dpi=600)
    colors = gradient_colors(len(feature_counts), cmap_name="PuBu", start=0.35, end=0.9)

    bars = ax.bar(
        feature_counts.index,
        feature_counts.values,
        color=colors,
        edgecolor="black",
        linewidth=1.3,
        width=0.66,
        zorder=3
    )

    y_max = feature_counts.max()
    offset = max(y_max * 0.025, 1)

    for b, count, pct in zip(bars, feature_counts.values, feature_percent.values):
        ax.text(
            b.get_x() + b.get_width() / 2,
            b.get_height() + offset,
            f"{count}\n({pct:.1f}%)",
            ha="center",
            va="bottom",
            fontsize=11,
            color="black",
            fontweight="bold"
        )

    ax.set_ylabel("Feature count", fontweight="bold", fontsize=16, color="black")
    ax.set_xlabel("Feature type", fontweight="bold", fontsize=16, color="black")
    ax.set_title(
        "Genome feature composition from Prokka annotation",
        weight="bold", fontsize=20, pad=14, color="black"
    )

    plt.setp(ax.get_xticklabels(), rotation=28, ha="right", fontweight="bold", color="black")
    prettify_axis(ax, ygrid=True)

    fig.text(
        0.015, 0.02,
        f"Input: {tsv_name} | Total annotated features: {len(df)}",
        fontsize=12, color="black", fontweight="bold"
    )

    plt.tight_layout(rect=[0, 0.05, 1, 1])
    out_png = outdir / "prokka_feature_composition_dynamic.png"
    out_pdf = outdir / "prokka_feature_composition_dynamic.pdf"
    plt.savefig(out_png, dpi=600, bbox_inches="tight")
    plt.savefig(out_pdf, dpi=600, bbox_inches="tight")
    plt.close()

    return out_png, out_pdf


# ==================================================
# PLOT 3: CDS LENGTH DISTRIBUTION
# ==================================================
def plot_cds_length_distribution(cds, tsv_name, outdir):
    if "len_bp" not in cds.columns or cds["len_bp"].dropna().empty:
        return None, None

    lengths = cds["len_bp"].dropna().astype(float)

    fig, ax = plt.subplots(figsize=(10.5, 6.5), dpi=600)
    _, _, patches = ax.hist(lengths, bins=35, edgecolor="white", linewidth=1.0)

    hist_colors = gradient_colors(len(patches), cmap_name="magma", start=0.2, end=0.85)
    for patch, c in zip(patches, hist_colors):
        patch.set_facecolor(c)

    median_len = np.median(lengths)
    mean_len = np.mean(lengths)

    ax.axvline(mean_len, color="#0f766e", linestyle="--", linewidth=2.5, label=f"Mean = {mean_len:.1f} bp")
    ax.axvline(median_len, color="#b91c1c", linestyle="-.", linewidth=2.5, label=f"Median = {median_len:.1f} bp")

    ax.set_title("CDS length distribution", fontweight="bold", fontsize=20, color="black", pad=14)
    ax.set_xlabel("CDS length (bp)", fontweight="bold", fontsize=16, color="black")
    ax.set_ylabel("Number of CDS", fontweight="bold", fontsize=16, color="black")
    prettify_axis(ax, ygrid=True)

    legend = ax.legend(frameon=False)
    for text in legend.get_texts():
        text.set_fontweight("bold")
        text.set_color("black")

    fig.text(
        0.015, 0.02,
        f"Input: {tsv_name} | CDS with length data: {len(lengths)}",
        fontsize=12, color="black", fontweight="bold"
    )

    plt.tight_layout(rect=[0, 0.05, 1, 1])
    out_png = outdir / "prokka_cds_length_distribution.png"
    out_pdf = outdir / "prokka_cds_length_distribution.pdf"
    plt.savefig(out_png, dpi=600, bbox_inches="tight")
    plt.savefig(out_pdf, dpi=600, bbox_inches="tight")
    plt.close()

    return out_png, out_pdf


# ==================================================
# PLOT 4: PROTEIN LENGTH DISTRIBUTION
# ==================================================
def plot_protein_length_distribution(cds, faa_file, tsv_name, outdir):
    aa_lengths = None
    label_note = ""

    if faa_file is not None and faa_file.exists():
        aa_lengths = read_fasta_lengths(faa_file)
        label_note = f"Exact protein lengths from {faa_file.name}"
    elif "aa_len_est" in cds.columns and cds["aa_len_est"].dropna().any():
        aa_lengths = cds["aa_len_est"].dropna().astype(float).tolist()
        label_note = "Approximate amino-acid lengths estimated from len_bp / 3"
    else:
        return None, None

    fig, ax = plt.subplots(figsize=(10.5, 6.5), dpi=600)
    _, _, patches = ax.hist(aa_lengths, bins=35, edgecolor="white", linewidth=1.0)

    hist_colors = gradient_colors(len(patches), cmap_name="plasma", start=0.15, end=0.9)
    for patch, c in zip(patches, hist_colors):
        patch.set_facecolor(c)

    median_len = np.median(aa_lengths)
    mean_len = np.mean(aa_lengths)

    ax.axvline(mean_len, color="#0369a1", linestyle="--", linewidth=2.5, label=f"Mean = {mean_len:.1f} aa")
    ax.axvline(median_len, color="#7c3aed", linestyle="-.", linewidth=2.5, label=f"Median = {median_len:.1f} aa")

    ax.set_title("Protein length distribution", fontweight="bold", fontsize=20, color="black", pad=14)
    ax.set_xlabel("Protein length (aa)", fontweight="bold", fontsize=16, color="black")
    ax.set_ylabel("Number of proteins", fontweight="bold", fontsize=16, color="black")
    prettify_axis(ax, ygrid=True)

    legend = ax.legend(frameon=False)
    for text in legend.get_texts():
        text.set_fontweight("bold")
        text.set_color("black")

    fig.text(
        0.015, 0.02,
        f"Input: {tsv_name} | {label_note}",
        fontsize=12, color="black", fontweight="bold"
    )

    plt.tight_layout(rect=[0, 0.05, 1, 1])
    out_png = outdir / "prokka_protein_length_distribution.png"
    out_pdf = outdir / "prokka_protein_length_distribution.pdf"
    plt.savefig(out_png, dpi=600, bbox_inches="tight")
    plt.savefig(out_pdf, dpi=600, bbox_inches="tight")
    plt.close()

    return out_png, out_pdf


# ==================================================
# PLOT 5: TOP PRODUCT ANNOTATIONS
# ==================================================
def plot_top_products(cds, tsv_name, outdir, top_n=15):
    products = cds["product"].fillna("").astype(str).str.strip()

    filtered = products[
        ~products.str.lower().isin(["", "unknown", "uncharacterized protein", "hypothetical protein"])
    ]

    if filtered.empty:
        return None, None

    counts = filtered.value_counts().head(top_n).sort_values(ascending=True)

    fig, ax = plt.subplots(figsize=(12, 8), dpi=600)
    colors = gradient_colors(len(counts), cmap_name="cividis", start=0.2, end=0.9)

    bars = ax.barh(
        counts.index,
        counts.values,
        color=colors,
        edgecolor="black",
        linewidth=1.2
    )

    x_max = counts.max()
    offset = max(x_max * 0.02, 0.5)

    for b, v in zip(bars, counts.values):
        ax.text(
            b.get_width() + offset,
            b.get_y() + b.get_height() / 2,
            str(v),
            va="center",
            ha="left",
            fontsize=11,
            color="black",
            fontweight="bold"
        )

    ax.set_title("Top annotated product names", fontweight="bold", fontsize=20, color="black", pad=14)
    ax.set_xlabel("Count", fontweight="bold", fontsize=16, color="black")
    ax.set_ylabel("Product annotation", fontweight="bold", fontsize=16, color="black")
    prettify_axis(ax, ygrid=False)
    ax.xaxis.grid(True, linestyle=(0, (3, 4)), linewidth=1.0, color="#bdbdbd", alpha=0.9)
    ax.set_axisbelow(True)

    plt.setp(ax.get_yticklabels(), fontweight="bold", color="black")
    plt.setp(ax.get_xticklabels(), fontweight="bold", color="black")

    fig.text(
        0.015, 0.02,
        f"Input: {tsv_name} | Top {min(top_n, len(counts))} non-hypothetical product annotations",
        fontsize=12, color="black", fontweight="bold"
    )

    plt.tight_layout(rect=[0, 0.05, 1, 1])
    out_png = outdir / "prokka_top_product_annotations.png"
    out_pdf = outdir / "prokka_top_product_annotations.pdf"
    plt.savefig(out_png, dpi=600, bbox_inches="tight")
    plt.savefig(out_pdf, dpi=600, bbox_inches="tight")
    plt.close()

    return out_png, out_pdf


# ==================================================
# MAIN
# ==================================================
def main():
    args = parse_args()
    set_plot_style()

    tsv_file = resolve_input_file(args.input)
    faa_file = resolve_optional_faa(tsv_file, args.faa)

    outdir = Path(args.outdir).resolve()
    outdir.mkdir(parents=True, exist_ok=True)

    print(f"Reading TSV: {tsv_file}")
    if faa_file:
        print(f"Using FAA:   {faa_file}")
    else:
        print("FAA file not found; amino-acid plot will use estimated length if possible.")
    print(f"Output dir:  {outdir}")

    df, cds = load_prokka_tsv(tsv_file)

    outputs = []
    outputs.extend(plot_functional_summary(cds, tsv_file.name, outdir))
    outputs.extend(plot_feature_composition(df, tsv_file.name, outdir))
    outputs.extend(plot_cds_length_distribution(cds, tsv_file.name, outdir))
    outputs.extend(plot_protein_length_distribution(cds, faa_file, tsv_file.name, outdir))
    outputs.extend(plot_top_products(cds, tsv_file.name, outdir, top_n=15))

    print("\nSaved files:")
    for f in outputs:
        if f is not None:
            print(f"  {f}")


if __name__ == "__main__":
    main()