#!/usr/bin/env python3

import re
from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.patches import Patch, FancyBboxPatch

# =========================================================
# INPUT FILES (AUTO-DETECTION)
# =========================================================

from pathlib import Path

# Input files expected in the current working directory
checkm_file = Path("checkm.txt")
busco_file = Path("short_summary.txt")

# Output prefix
outprefix = "genome_quality_summary"

# Verify files exist
if not checkm_file.exists():
    raise FileNotFoundError(
        f"Cannot find '{checkm_file}' in:\n{Path.cwd()}"
    )

if not busco_file.exists():
    raise FileNotFoundError(
        f"Cannot find '{busco_file}' in:\n{Path.cwd()}"
    )

print("=" * 60)
print("Genome Quality Summary")
print("=" * 60)
print(f"CheckM file : {checkm_file}")
print(f"BUSCO file  : {busco_file}")
print()

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
        "axes.labelsize": 14,
        "axes.labelweight": "bold",
        "xtick.labelsize": 11,
        "ytick.labelsize": 11,
        "text.color": "black",
        "axes.edgecolor": "black",
        "axes.linewidth": 1.4,
        "xtick.color": "black",
        "ytick.color": "black",
        "figure.facecolor": "white",
        "savefig.facecolor": "white",
    })


# =========================================================
# HELPERS
# =========================================================
def fmt_mb(bp):
    return f"{bp / 1e6:.2f} Mb"


def fmt_kb(bp):
    return f"{bp / 1e3:.2f} kb"


def parse_numeric(value):
    value = str(value).replace(",", "").strip()
    try:
        if "." in value:
            return float(value)
        return int(value)
    except Exception:
        return value


def draw_metric_card(ax, xy, width, height, label, value, fc="#F6F8FA"):
    x, y = xy
    patch = FancyBboxPatch(
        (x, y), width, height,
        boxstyle="round,pad=0.01,rounding_size=0.02",
        linewidth=1.0, edgecolor="#444444", facecolor=fc,
        transform=ax.transAxes
    )
    ax.add_patch(patch)

    ax.text(
        x + 0.03, y + height / 2,
        label,
        transform=ax.transAxes,
        ha="left", va="center",
        fontsize=12.5, fontweight="bold", color="black"
    )
    ax.text(
        x + width - 0.03, y + height / 2,
        value,
        transform=ax.transAxes,
        ha="right", va="center",
        fontsize=12.5, fontweight="bold", color="black"
    )


# =========================================================
# PARSERS
# =========================================================
def load_checkm_summary(checkm_file):

    import pandas as pd

    df = pd.read_csv(checkm_file, sep="\t")

    row = df.iloc[0]

    return {
        "Bin Id": row["Bin Id"],
        "Marker lineage": row["Marker lineage"],
        "Completeness": float(row["Completeness"]),
        "Contamination": float(row["Contamination"]),
        "Strain heterogeneity": float(row["Strain heterogeneity"]),
        "Genome size (bp)": int(row["Genome size (bp)"]),
        "GC": float(row["GC"]),
        "Coding density": float(row["Coding density"]),
        "# contigs": int(row["# contigs"]),
        "N50 (contigs)": int(row["N50 (contigs)"]),
        "# predicted genes": int(row["# predicted genes"])
    }


def load_busco_summary(busco_file):
    text = Path(busco_file).read_text()

    m = re.search(
        r"C:(?P<C>\d+\.?\d*)%\[S:(?P<S>\d+\.?\d*)%,D:(?P<D>\d+\.?\d*)%\],F:(?P<F>\d+\.?\d*)%,M:(?P<M>\d+\.?\d*)%,n:(?P<n>\d+)",
        text
    )
    if not m:
        raise ValueError("Could not parse BUSCO summary.")

    return {
        "Complete": float(m.group("C")),
        "Single": float(m.group("S")),
        "Duplicated": float(m.group("D")),
        "Fragmented": float(m.group("F")),
        "Missing": float(m.group("M")),
        "n": int(m.group("n")),
    }


# =========================================================
# FIGURE
# =========================================================
def make_figure(checkm, busco, outprefix):
    isolate_name = str(checkm.get("Bin Id", "Isolate"))

    marker_lineage = str(checkm.get("Marker lineage", "NA"))
    completeness = float(checkm.get("Completeness", 0))
    contamination = float(checkm.get("Contamination", 0))
    heterogeneity = float(checkm.get("Strain heterogeneity", 0))
    genome_size = int(checkm.get("Genome size (bp)", 0))
    gc = float(checkm.get("GC", 0))
    coding_density = float(checkm.get("Coding density", 0))
    n50 = int(checkm.get("N50 (contigs)", checkm.get("N50 (scaffolds)", 0)))
    contigs = int(checkm.get("# contigs", 0))
    genes = int(checkm.get("# predicted genes", 0))

    busco_complete = busco["Complete"]
    busco_single = busco["Single"]
    busco_dup = busco["Duplicated"]
    busco_frag = busco["Fragmented"]
    busco_missing = busco["Missing"]
    busco_n = busco["n"]

    set_style()

    fig = plt.figure(figsize=(14.5, 8.8), dpi=600, constrained_layout=True)
    gs = fig.add_gridspec(
        2, 2,
        height_ratios=[1.0, 1.2],
        width_ratios=[1.15, 1.0]
    )

    ax_busco = fig.add_subplot(gs[0, :])
    ax_checkm = fig.add_subplot(gs[1, 0])
    ax_stats = fig.add_subplot(gs[1, 1])

    fig.suptitle(
        f"Genome Quality Summary: {isolate_name}",
        fontsize=22, fontweight="bold", color="black"
    )

    # -----------------------------------------------------
    # A. BUSCO
    # -----------------------------------------------------
    busco_colors = {
        "single": "#5DADE2",
        "duplicated": "#2E86C1",
        "fragmented": "#E8DA3C",
        "missing": "#F04B46"
    }

    left = 0
    for value, color in [
        (busco_single, busco_colors["single"]),
        (busco_dup, busco_colors["duplicated"]),
        (busco_frag, busco_colors["fragmented"]),
        (busco_missing, busco_colors["missing"]),
    ]:
        ax_busco.barh(
            0, value, left=left, height=0.38,
            color=color, edgecolor="white", linewidth=2
        )
        left += value

    ax_busco.set_xlim(0, 100)
    ax_busco.set_ylim(-0.55, 0.55)
    ax_busco.set_yticks([0])
    ax_busco.set_yticklabels([isolate_name], fontsize=14, fontweight="bold")
    ax_busco.set_xlabel("% BUSCOs", fontsize=15, fontweight="bold")
    ax_busco.set_title("BUSCO Assessment", pad=12)

    ax_busco.grid(axis="x", linestyle=(0, (2.5, 4)), linewidth=0.9, color="#BDBDBD", alpha=0.8)
    ax_busco.set_axisbelow(True)
    ax_busco.spines["top"].set_visible(False)
    ax_busco.spines["right"].set_visible(False)
    ax_busco.tick_params(axis="y", length=0)

    busco_legend = [
        Patch(facecolor=busco_colors["single"], label="Complete and single-copy"),
        Patch(facecolor=busco_colors["duplicated"], label="Complete and duplicated"),
        Patch(facecolor=busco_colors["fragmented"], label="Fragmented"),
        Patch(facecolor=busco_colors["missing"], label="Missing"),
    ]
    leg1 = ax_busco.legend(
        handles=busco_legend,
        loc="upper right",
        frameon=False,
        ncol=2,
        fontsize=11.5,
        handlelength=1.3,
        columnspacing=1.2
    )
    for t in leg1.get_texts():
        t.set_fontweight("bold")

    busco_summary = (
        f"C:{busco_complete:.1f}% [S:{busco_single:.1f}%, D:{busco_dup:.1f}%], "
        f"F:{busco_frag:.1f}%, M:{busco_missing:.1f}%, n:{busco_n}"
    )
    ax_busco.text(
        0.5, -0.32,
        busco_summary,
        transform=ax_busco.transAxes,
        ha="center", va="top",
        fontsize=13, fontweight="bold", color="black"
    )

    ax_busco.text(-0.06, 1.08, "A", transform=ax_busco.transAxes,
                  fontsize=20, fontweight="bold")

    # -----------------------------------------------------
    # B. CheckM
    # -----------------------------------------------------
    q_colors = {
        "comp": "#A7D07C",
        "contam": "#F0B35F",
        "hetero": "#9FD3E6",
        "residual": "#7A7A7A"
    }

    # Only completeness and contamination are stacked on the 0–100 bar.
    # Strain heterogeneity is not additive with these, so it is shown separately.
    residual = max(0, 100 - completeness - contamination)

    left = 0
    for value, color in [
        (completeness, q_colors["comp"]),
        (contamination, q_colors["contam"]),
        (residual, q_colors["residual"]),
    ]:
        if value > 0:
            ax_checkm.barh(
                0, value, left=left, height=0.36,
                color=color, edgecolor="white", linewidth=2
            )
            left += value

    ax_checkm.set_xlim(0, 100)
    ax_checkm.set_ylim(-0.55, 1.05)
    ax_checkm.set_yticks([0])
    ax_checkm.set_yticklabels([isolate_name], fontsize=13, fontweight="bold")
    ax_checkm.set_xlabel("Quality profile (%)", fontsize=15, fontweight="bold")
    ax_checkm.set_title("CheckM Genome Quality", pad=10)

    ax_checkm.grid(axis="x", linestyle=(0, (2.5, 4)), linewidth=0.9, color="#BDBDBD", alpha=0.8)
    ax_checkm.set_axisbelow(True)
    ax_checkm.spines["top"].set_visible(False)
    ax_checkm.spines["right"].set_visible(False)
    ax_checkm.tick_params(axis="y", length=0)

    # Labels above the bar
    ax_checkm.text(
        18, 0.48,
        f"Completeness\n{completeness:.2f}%",
        ha="center", va="bottom",
        fontsize=12, fontweight="bold", color="black"
    )
    ax_checkm.text(
        58, 0.48,
        f"Contamination\n{contamination:.2f}%",
        ha="center", va="bottom",
        fontsize=12, fontweight="bold", color="black"
    )

    # Separate heterogeneity indicator
    hetero_x = min(heterogeneity, 100)
    ax_checkm.scatter(
        hetero_x, 0.78,
        s=180, color=q_colors["hetero"], edgecolor="black", linewidth=1.2, zorder=5
    )
    ax_checkm.text(
        hetero_x + 4, 0.78,
        f"Strain heterogeneity: {heterogeneity:.2f}%",
        ha="left", va="center",
        fontsize=12, fontweight="bold", color="black"
    )

    leg2 = ax_checkm.legend(
        handles=[
            Patch(facecolor=q_colors["comp"], edgecolor="#666666", label="Completeness"),
            Patch(facecolor=q_colors["contam"], edgecolor="#666666", label="Contamination"),
            Patch(facecolor=q_colors["residual"], edgecolor="#666666", label="Residual"),
        ],
        loc="lower center",
        bbox_to_anchor=(0.5, -0.38),
        ncol=4,
        frameon=False,
        fontsize=10.8,
        handlelength=1.3,
        columnspacing=1.2
    )
    for t in leg2.get_texts():
        t.set_fontweight("bold")

    ax_checkm.text(-0.10, 1.08, "B", transform=ax_checkm.transAxes,
                   fontsize=20, fontweight="bold")

    # -----------------------------------------------------
    # C. Stats
    # -----------------------------------------------------
    ax_stats.axis("off")
    ax_stats.set_title("Assembly and Genome Statistics", pad=10)

    stats = [
        ("Marker lineage", marker_lineage),
        ("Genome size", fmt_mb(genome_size)),
        ("GC content", f"{gc:.2f}%"),
        ("Coding density", f"{coding_density:.2f}%"),
        ("N50", fmt_kb(n50)),
        ("Contigs", f"{contigs:,}"),
        ("Predicted genes", f"{genes:,}")
    ]

    y = 0.88
    h = 0.09
    gap = 0.022
    colors = ["#F8F8F8", "#EDF3F8"]

    for i, (label, value) in enumerate(stats):
        draw_metric_card(
            ax_stats,
            xy=(0.03, y - h),
            width=0.94,
            height=h,
            label=label,
            value=value,
            fc=colors[i % 2]
        )
        y -= (h + gap)

    ax_stats.text(-0.08, 1.08, "C", transform=ax_stats.transAxes,
                  fontsize=20, fontweight="bold")

    png = f"{outprefix}.png"
    pdf = f"{outprefix}.pdf"
    plt.savefig(png, dpi=600, bbox_inches="tight")
    plt.savefig(pdf, dpi=600, bbox_inches="tight")
    plt.show()

    print(f"Saved: {png}")
    print(f"Saved: {pdf}")


# =========================================================
# MAIN
# =========================================================

def main():

    checkm = load_checkm_summary(checkm_file)

    busco = load_busco_summary(busco_file)

    make_figure(
        checkm,
        busco,
        outprefix
    )


if __name__ == "__main__":
    main()


