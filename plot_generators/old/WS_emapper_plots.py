#!/usr/bin/env python3

import argparse
import warnings
from pathlib import Path

import pandas as pd
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patheffects as pe
import matplotlib.colors as mcolors

warnings.filterwarnings("ignore")


def ensure_dir(path):
    Path(path).mkdir(parents=True, exist_ok=True)


def load_emapper_annotations(filepath):
    cols = [
        "query", "seed_ortholog", "evalue", "score", "eggNOG_OGs",
        "max_annot_lvl", "COG_category", "Description", "Preferred_name",
        "GOs", "EC", "KEGG_ko", "KEGG_Pathway", "KEGG_Module",
        "KEGG_Reaction", "KEGG_rclass", "BRITE", "KEGG_TC",
        "CAZy", "BiGG_Reaction", "PFAMs"
    ]
    df = pd.read_csv(filepath, sep="\t", comment="#", names=cols, dtype=str)
    return df.fillna("-")


def build_cog_counts(df):
    cog_letters = []
    for val in df["COG_category"].dropna():
        if val != "-":
            for ch in str(val):
                if ch.isalpha():
                    cog_letters.append(ch)

    if not cog_letters:
        return pd.Series(dtype=int)

    return pd.Series(cog_letters).value_counts()


def plot_cog_lollipop_grouped(df, outfile):
    cog_counts = build_cog_counts(df)

    if cog_counts.empty:
        print("No COG annotations found.")
        return

    # Standard COG super-category grouping
    COG_META = {
        "J": ("Translation, ribosomal structure & biogenesis", "Information storage & processing", "#1565C0", "#42A5F5"),
        "A": ("RNA processing & modification", "Information storage & processing", "#283593", "#5C6BC0"),
        "K": ("Transcription", "Information storage & processing", "#0277BD", "#29B6F6"),
        "L": ("Replication, recombination & repair", "Information storage & processing", "#00695C", "#26C6DA"),
        "B": ("Chromatin structure & dynamics", "Information storage & processing", "#1A237E", "#7986CB"),

        "D": ("Cell cycle control, cell division", "Cellular processes & signalling", "#B71C1C", "#EF5350"),
        "Y": ("Nuclear structure", "Cellular processes & signalling", "#880E4F", "#EC407A"),
        "V": ("Defense mechanisms", "Cellular processes & signalling", "#C62828", "#FF7043"),
        "T": ("Signal transduction mechanisms", "Cellular processes & signalling", "#E65100", "#FFA726"),
        "M": ("Cell wall / membrane / envelope biogenesis", "Cellular processes & signalling", "#F57F17", "#FFCA28"),
        "N": ("Cell motility", "Cellular processes & signalling", "#FF6F00", "#FFD54F"),
        "Z": ("Cytoskeleton", "Cellular processes & signalling", "#BF360C", "#FF8A65"),
        "W": ("Extracellular structures", "Cellular processes & signalling", "#6A1B9A", "#CE93D8"),
        "U": ("Intracellular trafficking, secretion", "Cellular processes & signalling", "#4A148C", "#AB47BC"),
        "O": ("Post-translational modification, turnover, chaperones", "Cellular processes & signalling", "#AD1457", "#F48FB1"),

        "C": ("Energy production & conversion", "Metabolism", "#1B5E20", "#66BB6A"),
        "G": ("Carbohydrate transport & metabolism", "Metabolism", "#2E7D32", "#A5D6A7"),
        "E": ("Amino acid transport & metabolism", "Metabolism", "#004D40", "#4DB6AC"),
        "F": ("Nucleotide transport & metabolism", "Metabolism", "#006064", "#80DEEA"),
        "H": ("Coenzyme transport & metabolism", "Metabolism", "#01579B", "#81D4FA"),
        "I": ("Lipid transport & metabolism", "Metabolism", "#0D47A1", "#64B5F6"),
        "P": ("Inorganic ion transport & metabolism", "Metabolism", "#1565C0", "#90CAF9"),
        "Q": ("Secondary metabolites biosynthesis, transport & catabolism", "Metabolism", "#00695C", "#B2DFDB"),

        "R": ("General function prediction only", "Poorly characterized", "#795548", "#BCAAA4"),
        "S": ("Function unknown", "Poorly characterized", "#4E342E", "#A1887F"),
    }

    GROUP_PALETTE = {
        "Information storage & processing": ("#1565C0", "#42A5F5"),
        "Cellular processes & signalling": ("#B71C1C", "#FF7043"),
        "Metabolism": ("#1B5E20", "#66BB6A"),
        "Poorly characterized": ("#4E342E", "#A1887F"),
    }

    group_order = [
        "Information storage & processing",
        "Cellular processes & signalling",
        "Metabolism",
        "Poorly characterized",
    ]

    present = [l for l in COG_META if l in cog_counts.index]
    if not present:
        print("No standard COG letters found.")
        return

    final_order = []
    for g in group_order:
        in_g = [(l, cog_counts[l]) for l in present if COG_META[l][1] == g]
        in_g.sort(key=lambda x: x[1])
        final_order.extend([x[0] for x in in_g])

    values_f = [int(cog_counts[l]) for l in final_order]
    dark_col = [COG_META[l][2] for l in final_order]
    lite_col = [COG_META[l][3] for l in final_order]
    groups_f = [COG_META[l][1] for l in final_order]
    labels_f = [COG_META[l][0] for l in final_order]
    pct_f = [v / sum(values_f) * 100 for v in values_f]

    n = len(final_order)
    y_pos = np.arange(n)
    max_val = max(values_f)

    fig, ax = plt.subplots(figsize=(24, 19))
    fig.patch.set_facecolor("#FFFFFF")
    ax.set_facecolor("#FFFFFF")

    GRID_COL = "#D0D7E2"
    TEXT_DARK = "#000000"

    step = max(10, int(np.ceil(max_val / 8 / 10.0) * 10))
    x_ticks = np.arange(0, max_val + step * 2, step)

    for xt in x_ticks:
        ax.axvline(xt, color=GRID_COL, linewidth=1.0, zorder=0, alpha=0.85)

    group_spans = {}
    for i, l in enumerate(final_order):
        g = groups_f[i]
        if g not in group_spans:
            group_spans[g] = [i, i]
        else:
            group_spans[g][1] = i

    for g, (s, e) in group_spans.items():
        dc, lc = GROUP_PALETTE[g]

        for row in range(s, e + 1):
            frac = (row - s) / max(1, e - s)
            rc = mcolors.to_rgba(lc, 0.03 + 0.015 * frac)
            ax.barh(row, max_val * 1.18, left=0, height=0.95, color=rc, zorder=1)

        for row in range(s, e + 1):
            ax.barh(
                row,
                max_val * 0.007,
                left=0,
                height=0.95,
                color=mcolors.to_rgba(dc, 0.95),
                zorder=5,
            )

        ax.axhline(s - 0.5, color=mcolors.to_rgba(dc, 0.28), linewidth=1.0, zorder=3)
        ax.axhline(e + 0.5, color=mcolors.to_rgba(dc, 0.28), linewidth=1.0, zorder=3)

    # glossy stems
    for yi, val, dc, lc in zip(y_pos, values_f, dark_col, lite_col):
        seg_n = max(30, int(val) // 3)
        xs = np.linspace(0, val, seg_n)
        alphas = np.linspace(0.10, 0.96, seg_n)

        for xi in range(len(xs) - 1):
            t = xi / len(xs)
            r1, g1, b1, _ = mcolors.to_rgba(lc)
            r2, g2, b2, _ = mcolors.to_rgba(dc)
            blended = (
                r1 + (r2 - r1) * t,
                g1 + (g2 - g1) * t,
                b1 + (b2 - b1) * t,
                1.0,
            )
            ax.plot(
                [xs[xi], xs[xi + 1]],
                [yi, yi],
                color=blended,
                linewidth=4.6,
                alpha=alphas[xi],
                solid_capstyle="round",
                zorder=2,
            )

        ax.plot(
            [0, val],
            [yi, yi],
            color=dc,
            linewidth=1.5,
            alpha=0.55,
            zorder=3,
            solid_capstyle="round",
        )

    # glossy dots
    for yi, val, dc, lc in zip(y_pos, values_f, dark_col, lite_col):
        ax.scatter(val + max_val * 0.003, yi - 0.08, s=820, color="#00000018", zorder=3, linewidths=0)
        ax.scatter(val, yi, s=1050, color=mcolors.to_rgba(lc, 0.14), zorder=4, linewidths=0)
        ax.scatter(val, yi, s=700, color=mcolors.to_rgba(lc, 0.24), zorder=4, linewidths=0)
        ax.scatter(val, yi, s=420, color=dc, zorder=5, edgecolors="white", linewidths=2.8)
        ax.scatter(val, yi, s=270, color=lc, zorder=6, linewidths=0)
        ax.scatter(val, yi, s=135, color=dc, zorder=7, linewidths=0, alpha=0.62)
        ax.scatter(val - max_val * 0.004, yi + 0.10, s=52, color="white", zorder=8, alpha=0.96, linewidths=0)
        ax.scatter(val - max_val * 0.002, yi + 0.05, s=20, color="white", zorder=9, alpha=0.74, linewidths=0)

    for yi, val, p in zip(y_pos, values_f, pct_f):
        ax.text(
            val + max_val * 0.022,
            yi + 0.12,
            f"{val:,}",
            va="center",
            ha="left",
            color=TEXT_DARK,
            fontsize=16,
            fontweight="bold",
            fontfamily="DejaVu Sans",
            zorder=10,
        )
        ax.text(
            val + max_val * 0.022,
            yi - 0.22,
            f"{p:.1f}%",
            va="center",
            ha="left",
            color=TEXT_DARK,
            fontsize=13,
            fontfamily="DejaVu Sans",
            fontstyle="italic",
            fontweight="bold",
            zorder=10,
        )

    ax.set_yticks(y_pos)
    ax.set_yticklabels([])

    for yi, l, lab, dc, lc in zip(y_pos, final_order, labels_f, dark_col, lite_col):
        badge_x = -max_val * 0.040

        ax.text(
            badge_x,
            yi,
            l,
            va="center",
            ha="center",
            color="#000000",
            fontsize=16,
            fontweight="bold",
            fontfamily="DejaVu Sans",
            bbox=dict(
                boxstyle="round,pad=0.42",
                facecolor=mcolors.to_rgba(lc, 0.34),
                edgecolor=mcolors.to_rgba(dc, 0.95),
                linewidth=2.2,
            ),
            zorder=9,
            path_effects=[pe.withStroke(linewidth=1.4, foreground="white")],
        )

        ax.text(
            badge_x - max_val * 0.018,
            yi,
            lab,
            va="center",
            ha="right",
            color=TEXT_DARK,
            fontsize=14,
            fontfamily="DejaVu Sans",
            fontweight="bold",
            zorder=9,
        )

    # right-side category labels
    group_x = max_val * 1.12
    for g, (s, e) in group_spans.items():
        dc, lc = GROUP_PALETTE[g]
        mid = (s + e) / 2

        ax.text(
            group_x,
            mid,
            g,
            rotation=90,
            va="center",
            ha="center",
            fontsize=16,
            fontweight="bold",
            color="#000000",
            fontfamily="DejaVu Sans",
            bbox=dict(
                boxstyle="round,pad=0.55",
                facecolor=mcolors.to_rgba(lc, 0.22),
                edgecolor=mcolors.to_rgba(dc, 0.85),
                linewidth=2.2,
            ),
            zorder=12,
        )

    for g, (s, e) in group_spans.items():
        dc, _ = GROUP_PALETTE[g]
        if s > 0:
            ax.axhline(
                s - 0.5,
                color=mcolors.to_rgba(dc, 0.48),
                linewidth=1.5,
                linestyle=(0, (6, 3)),
                zorder=3,
            )

    ax.set_xlim(-max_val * 0.36, max_val * 1.28)
    ax.set_ylim(-0.9, n - 0.1)
    ax.set_xlabel(
        "Number of Genes",
        color=TEXT_DARK,
        fontsize=17,
        fontfamily="DejaVu Sans",
        labelpad=16,
        fontweight="bold",
    )
    ax.tick_params(axis="x", colors=TEXT_DARK, labelsize=14, length=5, width=1.0)
    ax.tick_params(axis="y", length=0)
    ax.set_xticks(x_ticks)

    for spine in ax.spines.values():
        spine.set_visible(False)

    fig.text(
        0.08,
        0.965,
        "COG Functional Category Distribution",
        ha="left",
        va="top",
        fontsize=32,
        fontweight="bold",
        color=TEXT_DARK,
        fontfamily="DejaVu Sans",
        path_effects=[pe.withStroke(linewidth=6, foreground="white")],
    )

    fig.text(
        0.08,
        0.935,
        "Grouped into standard COG super-categories",
        ha="left",
        va="top",
        fontsize=15,
        fontweight="bold",
        color="#333333",
        fontfamily="DejaVu Sans",
    )

    underline_colors = ["#1565C0", "#B71C1C", "#1B5E20", "#4E342E"]
    for ui, uc in enumerate(underline_colors):
        x0 = 0.08 + ui * 0.19
        x1 = x0 + 0.18
        fig.add_artist(
            plt.Line2D(
                [x0, x1],
                [0.922, 0.922],
                transform=fig.transFigure,
                color=uc,
                linewidth=4.5,
                alpha=0.85,
                solid_capstyle="round",
            )
        )

    plt.tight_layout(rect=[0.0, 0.02, 1.0, 0.91])
    fig.savefig(outfile, dpi=300, bbox_inches="tight", facecolor="#FFFFFF")
    plt.close()
    print(f"Saved: {outfile}")


def main():
    parser = argparse.ArgumentParser(
        description="Beautiful grouped COG lollipop plot from eggNOG emapper annotations"
    )
    parser.add_argument("-a", "--annotations", required=True, help="Path to annotations.emapper.annotations")
    parser.add_argument("-o", "--outdir", default="emapper_beautiful_plots", help="Output directory")
    args = parser.parse_args()

    ensure_dir(args.outdir)

    print(f"Reading: {args.annotations}")
    df = load_emapper_annotations(args.annotations)

    outpath = Path(args.outdir) / "COG_lollipop_grouped.png"
    plot_cog_lollipop_grouped(df, outpath)

    print(f"Done. Plot saved in: {outpath}")


if __name__ == "__main__":
    main()
