#!/usr/bin/env python3

# =============================================================================
# dbCAN CAZyme Visualization — Nature / Science Standard  (Final v5)
# OUTPUT FILES:
#   cazyme_donut.png / .pdf
#   cazyme_barplot.png / .pdf
# =============================================================================

import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.ticker import MaxNLocator
import numpy as np
import re

# ── 1. Load & filter ──────────────────────────────────────────────────────────
input_file = "overview.txt"
df = pd.read_csv(input_file, sep="\t")
tools_col = [c for c in df.columns if "Tools" in c or "ofTools" in c][0]
hmmer_col  = [c for c in df.columns if "HMMER" in c][0]
df = df[df[tools_col] >= 2].copy()

def extract_family(h):
    if pd.isna(h): return None
    h = re.sub(r"\(.*?\)", "", str(h))
    for p in h.split("+"):
        m = re.match(r"([A-Za-z]+[0-9]+)", p.strip())
        if m: return m.group(1)
    return None

df["Family"] = df[hmmer_col].apply(extract_family)
df = df.dropna(subset=["Family"])

def classify(f):
    for pre, cls in [("GH","GH"),("GT","GT"),("PL","PL"),
                     ("CE","CE"),("AA","AA"),("CBM","CBM")]:
        if f.startswith(pre): return cls
    return "Others"

df["Class"]  = df["Family"].apply(classify)
class_counts  = df["Class"].value_counts()
family_counts = df["Family"].value_counts().head(15)
total = class_counts.sum()

# ── 2. Wong (2011) colorblind-safe palette — Nature/Cell Press standard ───────
PALETTE = {
    "GH":     "#E69F00",   # amber
    "GT":     "#0072B2",   # cobalt blue
    "PL":     "#CC79A7",   # rose pink
    "CE":     "#009E73",   # teal green
    "AA":     "#56B4E9",   # sky blue
    "CBM":    "#D55E00",   # vermillion
    "Others": "#999999",   # grey
}
CLASS_FULL = {
    "GH":     "Glycoside Hydrolases",
    "GT":     "Glycosyl Transferases",
    "PL":     "Polysaccharide Lyases",
    "CE":     "Carbohydrate Esterases",
    "AA":     "Auxiliary Activities",
    "CBM":    "Carbohydrate-Binding Modules",
    "Others": "Others",
}

plt.rcParams.update({
    "font.family": "DejaVu Sans",
    "font.size":   16,
    "figure.dpi":  150,
    "savefig.dpi": 600,
})

# =============================================================================
# PLOT 1 — DONUT CHART
# =============================================================================

fig = plt.figure(figsize=(20, 11), facecolor="white")
ax_pie = fig.add_axes([0.01, 0.04, 0.48, 0.90])
ax_leg = fig.add_axes([0.52, 0.03, 0.46, 0.94])
ax_pie.set_facecolor("white")
ax_leg.set_facecolor("white")
ax_leg.axis("off")

colors = [PALETTE[c] for c in class_counts.index]

# ── Donut wedges ──────────────────────────────────────────────────────────────
wedges, _ = ax_pie.pie(
    class_counts.values, labels=None, radius=1.0,
    startangle=90, counterclock=False, colors=colors,
    wedgeprops=dict(width=0.42, edgecolor="white", linewidth=3.0),
)
for w in wedges: w.set_zorder(3)

# Clean hole + thin accent rings
ax_pie.add_patch(plt.Circle((0,0), 0.575, color="white",  zorder=4))
ax_pie.add_patch(plt.Circle((0,0), 0.578, fill=False, edgecolor="#CCCCCC", linewidth=1.0, zorder=5))
ax_pie.add_patch(plt.Circle((0,0), 1.005, fill=False, edgecolor="#CCCCCC", linewidth=1.0, zorder=5))

# ── Center text ───────────────────────────────────────────────────────────────
ax_pie.text(0,  0.13, f"{len(df)}",  ha="center", va="center", zorder=6,
            fontsize=40, fontweight="bold", color="#111111")
ax_pie.text(0, -0.08, "CAZyme", ha="center", va="center", zorder=6,
            fontsize=18, fontweight="bold", color="#333333")
ax_pie.text(0, -0.26, "Genes",  ha="center", va="center", zorder=6,
            fontsize=18, fontweight="bold", color="#333333")
ax_pie.set_title("CAZyme Class Distribution",
                 fontsize=22, fontweight="bold", color="#111111", pad=30)
ax_pie.set_aspect("equal")

# ── Legend table ──────────────────────────────────────────────────────────────
T       = ax_leg.transAxes
n_cls   = len(class_counts)

X_SWATCH = 0.01;  SWATCH_W = 0.055
X_ABBR   = 0.09
X_NAME   = 0.20
X_N      = 0.68
X_PCT    = 0.78
X_BAR0   = 0.87;  BAR_W = 0.12

Y_TITLE  = 0.96
Y_RULE1  = 0.905
Y_SUBHDR = 0.895
Y_RULE2  = 0.858
Y_TOP    = 0.845
ROW_H    = (Y_TOP - 0.05) / n_cls

# Title
ax_leg.text(0.50, Y_TITLE, "CAZyme Classes",
            transform=T, ha="center", va="top",
            fontsize=20, fontweight="bold", color="#111111")
ax_leg.plot([0,1],[Y_RULE1,Y_RULE1], color="#888888", lw=1.5, transform=T, clip_on=False)

# Column headers
for (x, txt, ha) in [
    (X_NAME,            "CAZyme Class", "left"),
    (X_N,               "n",            "center"),
    (X_PCT,             "%",            "center"),
    (X_BAR0+BAR_W/2,    "Proportion",   "center"),
]:
    ax_leg.text(x, Y_SUBHDR, txt, transform=T, ha=ha, va="top",
                fontsize=15, fontweight="bold", color="#444444")

ax_leg.plot([0,1],[Y_RULE2,Y_RULE2], color="#BBBBBB", lw=0.9, transform=T, clip_on=False)

# Data rows
for k, (cls_name, count) in enumerate(class_counts.items()):
    pct   = count / total * 100
    color = PALETTE[cls_name]
    y_mid = Y_TOP - (k + 0.5) * ROW_H
    SWATCH_H = ROW_H * 0.46

    # Alternating row shading
    if k % 2 == 0:
        ax_leg.add_patch(mpatches.Rectangle(
            (-0.01, y_mid - ROW_H*0.50), 1.02, ROW_H,
            facecolor="#F5F7FA", edgecolor="none",
            transform=T, zorder=0, clip_on=False))

    # Swatch
    ax_leg.add_patch(mpatches.Rectangle(
        (X_SWATCH, y_mid - SWATCH_H/2), SWATCH_W, SWATCH_H,
        facecolor=color, edgecolor="none",
        transform=T, zorder=2, clip_on=False))

    # Abbreviation
    ax_leg.text(X_ABBR, y_mid, cls_name, transform=T, ha="left", va="center",
                fontsize=16, fontweight="bold", color=color)

    # Full name
    ax_leg.text(X_NAME, y_mid, CLASS_FULL[cls_name],
                transform=T, ha="left", va="center",
                fontsize=15, fontweight="bold", color="#111111")

    # Count
    ax_leg.text(X_N,   y_mid, f"{count}", transform=T, ha="center", va="center",
                fontsize=15, fontweight="bold", color="#222222")

    # Percentage
    ax_leg.text(X_PCT, y_mid, f"{pct:.1f}", transform=T, ha="center", va="center",
                fontsize=15, fontweight="bold", color="#222222")

    # Proportion bar
    bh = ROW_H * 0.30
    ax_leg.add_patch(mpatches.Rectangle(
        (X_BAR0, y_mid-bh/2), BAR_W, bh,
        facecolor="#E2E8F0", edgecolor="none",
        transform=T, zorder=1, clip_on=False))
    ax_leg.add_patch(mpatches.Rectangle(
        (X_BAR0, y_mid-bh/2), BAR_W*(pct/100), bh,
        facecolor=color, edgecolor="none", alpha=0.92,
        transform=T, zorder=2, clip_on=False))

    # Row separator
    sep_y = Y_TOP - (k+1)*ROW_H
    ax_leg.plot([0,1],[sep_y,sep_y], color="#DDDDDD", lw=0.6, transform=T, clip_on=False)

# Bottom rule + total row
bot_y = Y_TOP - n_cls * ROW_H
ax_leg.plot([0,1],[bot_y-0.002, bot_y-0.002], color="#888888", lw=1.2, transform=T, clip_on=False)
for (x, txt, ha) in [
    (X_NAME,  "Total",   "left"),
    (X_N,     f"{total}","center"),
    (X_PCT,   "100.0",   "center"),
]:
    ax_leg.text(x, bot_y - 0.032, txt, transform=T, ha=ha, va="top",
                fontsize=15, fontweight="bold", color="#111111")

ax_leg.set_xlim(0, 1)
ax_leg.set_ylim(0, 1)

plt.savefig("cazyme_donut.png",  dpi=600, bbox_inches="tight", facecolor="white")
plt.savefig("cazyme_donut.pdf",  bbox_inches="tight",          facecolor="white")
plt.close(fig)
print("Saved cazyme_donut.png / .pdf")

# =============================================================================
# PLOT 2 — HORIZONTAL BARPLOT
# =============================================================================

fig2, ax2 = plt.subplots(figsize=(12, 9), facecolor="white")
ax2.set_facecolor("white")

n = len(family_counts)
cmap    = matplotlib.colormaps.get_cmap("YlGnBu_r").resampled(n)
bcolors = [cmap(i / (n-1)) for i in range(n)][::-1]

ax2.barh(np.arange(n), family_counts.values,
         color=bcolors, edgecolor="white", linewidth=0.8, height=0.72)

x_max = family_counts.values.max()
for i, v in enumerate(family_counts.values):
    ax2.text(v + x_max*0.012, i, str(v),
             va="center", ha="left",
             fontsize=15, fontweight="bold", color="#222222")

ax2.set_yticks(np.arange(n))
ax2.set_yticklabels(family_counts.index, fontsize=15, fontweight="bold")
ax2.set_xlabel("Gene Count", fontsize=17, fontweight="bold", labelpad=8)
ax2.set_ylabel("CAZyme Family", fontsize=17, fontweight="bold", labelpad=8)
ax2.set_title("Top 15 Most Abundant CAZyme Families",
              fontsize=22, fontweight="bold", pad=18)

ax2.tick_params(axis="x", labelsize=15)
for lbl in ax2.get_xticklabels(): lbl.set_fontweight("bold")

ax2.set_xlim(0, x_max * 1.16)
ax2.invert_yaxis()
ax2.xaxis.set_major_locator(MaxNLocator(integer=True, nbins=6))
ax2.grid(axis="x", linestyle="--", linewidth=0.7, alpha=0.45, color="#aaaaaa")
ax2.set_axisbelow(True)

import seaborn as sns
sns.despine(ax=ax2, right=True, top=True)
ax2.spines["left"].set_linewidth(1.2)
ax2.spines["bottom"].set_linewidth(1.2)

plt.tight_layout()
plt.savefig("cazyme_barplot.png", dpi=600, bbox_inches="tight", facecolor="white")
plt.savefig("cazyme_barplot.pdf", bbox_inches="tight",          facecolor="white")
plt.close(fig2)
print("Saved cazyme_barplot.png / .pdf")

print("\nAll done — 4 files written.")
