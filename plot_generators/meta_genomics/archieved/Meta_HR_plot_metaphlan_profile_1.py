#!/usr/bin/env python3
"""
Nature/Cell/Science-standard visualization: 
  Species-level lollipop chart for top 20 named species (MetaPhlAn profile).
"""

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm
import matplotlib.ticker as mticker
import numpy as np
import re

# ---------------------------------------------------------------- style ----
for f in fm.fontManager.ttflist:
    if "carlito" in f.name.lower():
        plt.rcParams["font.family"] = "Carlito"
        break
else:
    plt.rcParams["font.family"] = "DejaVu Sans"

plt.rcParams.update({
    "font.size": 15,
    "axes.titlesize": 20,
    "axes.titleweight": "bold",
    "axes.labelsize": 17,
    "axes.labelweight": "bold",
    "xtick.labelsize": 13,
    "ytick.labelsize": 13,
    "axes.linewidth": 1.4,
    "text.color": "black",
    "axes.edgecolor": "black",
    "xtick.color": "black",
    "ytick.color": "black",
    "figure.facecolor": "white",
    "axes.facecolor": "white",
    "savefig.facecolor": "white",
})

INFILE = "SRR14300308_profile.txt"
SAMPLE = "SRR14300308"
UNNAMED = re.compile(r"^(GGB|SGB|CFGB|FGB)\d+")

# ---------------------------------------------------------------- parse ----
records = []
with open(INFILE) as fh:
    for line in fh:
        if line.startswith("#") or not line.strip():
            continue
        parts = line.rstrip("\n").split("\t")
        clade, abund = parts[0], float(parts[2])
        lineage = clade.split("|")
        level = lineage[-1].split("__")[0]
        name = lineage[-1].split("__", 1)[1].replace("_", " ")
        records.append({"level": level, "name": name, "abund": abund,
                         "lineage": lineage})

def by_level(lvl):
    return [r for r in records if r["level"] == lvl]

def parent_phylum(lineage):
    for tok in lineage:
        if tok.startswith("p__"):
            return tok.split("__", 1)[1].replace("_", " ")
    return "Unclassified"

def named_only(records_list):
    return [r for r in records_list if not UNNAMED.match(r["name"])]

# consistent phylum color map across all figures
phyla_all = sorted(by_level("p"), key=lambda r: -r["abund"])
cmap = matplotlib.colormaps.get_cmap("tab20").resampled(max(len(phyla_all), 1))
phylum_color = {r["name"]: cmap(i) for i, r in enumerate(phyla_all)}

def clean_axes(ax):
    for spine in ["top", "right"]:
        ax.spines[spine].set_visible(False)
    for spine in ["left", "bottom"]:
        ax.spines[spine].set_linewidth(1.4)
        ax.spines[spine].set_color("black")
    ax.tick_params(axis="both", colors="black", width=1.4, length=6)

# ============================== SPECIES — lollipop, top 20 named ==========
species_named = named_only(by_level("s"))
species_top20 = sorted(species_named, key=lambda r: -r["abund"])[:20][::-1]
names = [r["name"] for r in species_top20]
vals = [r["abund"] for r in species_top20]
colors = [phylum_color.get(parent_phylum(r["lineage"]), (0.6, 0.6, 0.6, 1.0))
          for r in species_top20]

fig, ax = plt.subplots(figsize=(12, 9.5))
y_pos = np.arange(len(species_top20))
ax.set_xscale("log")
ax.xaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{x:g}"))

xmin = min(vals) / 2
for y, v, c in zip(y_pos, vals, colors):
    ax.hlines(y, xmin, v, color=c, linewidth=3.2, zorder=2, alpha=0.9)
ax.scatter(vals, y_pos, s=170, color=colors, edgecolor="black", linewidth=1.3,
           zorder=3)

ax.set_yticks(y_pos)
ax.set_yticklabels(names, fontsize=13.5, fontweight="bold", fontstyle="italic")
ax.set_xlabel("Relative abundance (%)", fontsize=17, fontweight="bold", labelpad=10)
ax.set_title(f"Top 20 species — {SAMPLE}", fontsize=20, fontweight="bold", pad=16)
clean_axes(ax)
ax.set_ylim(-0.6, len(species_top20) - 0.4)
xmax = max(vals) * 3
ax.set_xlim(xmin, xmax)
for y, v in zip(y_pos, vals):
    label = f"{v:.3f}%" if v < 0.1 else f"{v:.2f}%"
    ax.text(v * 1.15, y, label, va="center", ha="left", fontsize=11.5,
            fontweight="bold", color="black", zorder=4)

present_phyla = []
seen = set()
for r in species_top20:
    p = parent_phylum(r["lineage"])
    if p not in seen:
        seen.add(p)
        present_phyla.append(p)
handles = [plt.Line2D([0], [0], marker="o", linestyle="", markersize=11,
                        markerfacecolor=phylum_color[p], markeredgecolor="black")
           for p in present_phyla]
ax.legend(handles, present_phyla, loc="lower right", frameon=False, fontsize=11,
          title="Phylum", title_fontsize=12, labelspacing=0.5)

fig.tight_layout()
fig.savefig("SRR14300308_species_lollipop.svg", dpi=600, bbox_inches="tight",
            facecolor="white")
plt.close(fig)
print("Saved SRR14300308_species_lollipop.svg")
