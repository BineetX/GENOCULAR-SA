import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.lines import Line2D
from matplotlib.ticker import MultipleLocator
from pathlib import Path
import numpy as np
import os, warnings
warnings.filterwarnings("ignore")
from pathlib import Path

# ── rcParams ──────────────────────────────────────────────────────────────────
plt.rcParams.update({
    "font.family":        "sans-serif",
    "font.sans-serif":    ["Helvetica Neue", "Helvetica", "Arial", "DejaVu Sans"],
    "font.size":          11,
    "font.weight":        "bold",
    "axes.labelsize":     14,
    "axes.titlesize":     13,
    "axes.labelweight":   "bold",
    "axes.titleweight":   "bold",
    "axes.linewidth":     1.4,
    "axes.spines.top":    True,
    "axes.spines.right":  True,
    "xtick.major.width":  1.4,
    "ytick.major.width":  1.4,
    "xtick.minor.width":  0.9,
    "ytick.minor.width":  0.9,
    "xtick.major.size":   6,
    "ytick.major.size":   6,
    "xtick.minor.size":   3,
    "ytick.minor.size":   3,
    "xtick.direction":    "out",
    "ytick.direction":    "out",
    "xtick.labelsize":    11,
    "ytick.labelsize":    11,
    "xtick.major.pad":    4,
    "ytick.major.pad":    4,
    "legend.fontsize":    12,
    "legend.frameon":     False,
    "pdf.fonttype":       42,
    "ps.fonttype":        42,
    "savefig.dpi":        600,
})

# ── Palette ───────────────────────────────────────────────────────────────────
C_RAW        = "#D62728"   # vivid red
C_FILT       = "#1F77B4"   # vivid blue
C_ZONE_GOOD  = "#EAF7EA"
C_ZONE_OK    = "#FFFBEA"
C_ZONE_BAD   = "#FFF0F0"

# ── Parsers ───────────────────────────────────────────────────────────────────
def parse_fastqc(file):
    rows, inside = [], False
    with open(file) as f:
        for line in f:
            if line.startswith(">>Per base sequence quality"):
                inside = True; continue
            if line.startswith(">>END_MODULE"):
                inside = False
            if inside and not line.startswith("#"):
                p = line.strip().split()
                if len(p) >= 5:
                    rows.append({
                        "base":   p[0],
                        "mean":   float(p[1]),
                        "median": float(p[2]),
                        "lower":  float(p[3]),
                        "upper":  float(p[4]),
                    })
    return rows

def parse_gc(file):
    rows, inside = [], False
    with open(file) as f:
        for line in f:
            if line.startswith(">>Per sequence GC content"):
                inside = True; continue
            if line.startswith(">>END_MODULE"):
                inside = False
            if inside and not line.startswith("#"):
                p = line.strip().split()
                if len(p) == 2:
                    try: rows.append((float(p[0]), float(p[1])))
                    except: pass
    return rows

def combine(r1, r2):
    n = min(len(r1), len(r2))
    return [{
        "base":   r1[i]["base"],
        "mean":   (r1[i]["mean"]   + r2[i]["mean"])   / 2,
        "median": (r1[i]["median"] + r2[i]["median"]) / 2,
        "lower":  (r1[i]["lower"]  + r2[i]["lower"])  / 2,
        "upper":  (r1[i]["upper"]  + r2[i]["upper"])  / 2,
    } for i in range(n)]

def arr(d, k): return np.array([x[k] for x in d])

# ── Simulate ──────────────────────────────────────────────────────────────────
def sim_fastqc(n=150, raw=True, seed=0):
    rng = np.random.default_rng(seed)
    rows = []
    for i in range(n):
        pos = i + 1
        q = 36 - 0.012 * pos - 0.00015 * pos**2
        if raw:
            q -= max(0, 2.8 - pos * 0.12)
            q -= max(0, (pos - 125) * 0.07)
        else:
            if pos > 142: continue
            q = min(38, q + 0.6)
        med   = float(np.clip(q + rng.normal(0, 0.2), 10, 40))
        iqr   = float(np.clip(rng.normal(2.2 if raw else 1.5, 0.25), 0.8, 4))
        lower = float(np.clip(med - iqr * 0.65, 5, 40))
        upper = float(np.clip(med + iqr * 0.35, 5, 40))
        rows.append({"base": str(pos), "mean": med, "median": med,
                     "lower": lower, "upper": upper})
    return rows

def sim_gc(raw=True, seed=0):
    rng = np.random.default_rng(seed)
    x = np.arange(0, 101)
    sd = 10 if raw else 7
    y = np.exp(-0.5 * ((x - 55) / sd)**2)
    y = y / y.sum() * 1000 + np.abs(rng.normal(0, 0.4, 101))
    return list(zip(x.tolist(), y.tolist()))

# ── Load / simulate ───────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent

def find_fastqc(folder, read):
    base = BASE_DIR / folder

    files = [
        d / "fastqc_data.txt"
        for d in base.iterdir()
        if d.is_dir()
        and d.name.endswith("_fastqc")
        and f"_{read}" in d.name
    ]

    if len(files) == 0:
        raise FileNotFoundError(f"No {read} FastQC file found in {folder}")

    if len(files) > 1:
        raise RuntimeError(
            f"Multiple {read} FastQC directories found:\n" +
            "\n".join(str(f.parent.name) for f in files)
        )

    return files[0]

paths = {
    "raw_r1": find_fastqc("fastqc_raw","R1"),
    "raw_r2": find_fastqc("fastqc_raw","R2"),
    "clean_r1": find_fastqc("fastqc_trimmed","R1"),
    "clean_r2": find_fastqc("fastqc_trimmed","R2"),
}

# Check that all required FastQC files exist
for name, path in paths.items():
    if not path.exists():
        raise FileNotFoundError(f"Missing FastQC file: {path}")

print("[INFO] Using real FastQC data.")

# Read FastQC results
raw_d = combine(
    parse_fastqc(paths["raw_r1"]),
    parse_fastqc(paths["raw_r2"])
)

clean_d = combine(
    parse_fastqc(paths["clean_r1"]),
    parse_fastqc(paths["clean_r2"])
)

gc_raw = parse_gc(paths["raw_r1"])
gc_clean = parse_gc(paths["clean_r1"])

SIMULATED = False

OUTPUT_DIR = Path(__file__).resolve().parent
OUTPUT_DIR.mkdir(exist_ok=True)

x_r = np.arange(len(raw_d))
x_c = np.arange(len(clean_d))

handles_q = [
    mpatches.Patch(facecolor=C_RAW,  alpha=0.4, edgecolor=C_RAW,  lw=1.5,
                   label="Raw reads (IQR)"),
    mpatches.Patch(facecolor=C_FILT, alpha=0.4, edgecolor=C_FILT, lw=1.5,
                   label="Trimmed reads (IQR)"),
    Line2D([0],[0], color=C_RAW,  lw=2.5, label="Raw \u2014 median"),
    Line2D([0],[0], color=C_FILT, lw=2.5, label="Trimmed \u2014 median"),
]

def add_zones(ax, xmax):
    ax.axhspan(28, 42, color=C_ZONE_GOOD, zorder=0, lw=0)
    ax.axhspan(20, 28, color=C_ZONE_OK,   zorder=0, lw=0)
    ax.axhspan( 0, 20, color=C_ZONE_BAD,  zorder=0, lw=0)
    for q, lbl, col in [(35, "Good (Q\u226528)", "#2E7D32"),
                         (24, "Acceptable",       "#E65100"),
                         (10, "Poor (<Q20)",      "#C62828")]:
        ax.text(xmax + 1, q, lbl, fontsize=9, fontweight="bold",
                color=col, va="center", ha="left", clip_on=False)
    ax.axhline(28, lw=1.0, color="#aaaaaa", ls="--", zorder=1)
    ax.axhline(20, lw=1.0, color="#aaaaaa", ls="--", zorder=1)

def bold_ticks(ax):
    for lbl in ax.get_xticklabels() + ax.get_yticklabels():
        lbl.set_fontweight("bold")

def sim_note(fig):
    pass

# ══════════════════════════════════════════════════════════════════════════════
# PANEL B — Per-base sequence quality
# ══════════════════════════════════════════════════════════════════════════════
fig1, ax_q = plt.subplots(figsize=(6.5, 4.8))
fig1.subplots_adjust(left=0.12, right=0.75, top=0.87, bottom=0.14)

add_zones(ax_q, max(len(raw_d), len(clean_d)))

ax_q.fill_between(x_r, arr(raw_d,   "lower"), arr(raw_d,   "upper"),
                  color=C_RAW,  alpha=0.25, zorder=2, lw=0)
ax_q.fill_between(x_c, arr(clean_d, "lower"), arr(clean_d, "upper"),
                  color=C_FILT, alpha=0.28, zorder=2, lw=0)
ax_q.plot(x_r, arr(raw_d,   "median"), color=C_RAW,  lw=2.5, zorder=4)
ax_q.plot(x_c, arr(clean_d, "median"), color=C_FILT, lw=2.5, zorder=4)

ax_q.set_xlim(-1, max(len(raw_d), len(clean_d)) + 1)
ax_q.set_ylim(0, 42)
ax_q.set_xlabel("Base position (bp)", labelpad=6)
ax_q.set_ylabel("Phred quality score", labelpad=6)

# REMOVE minor ticks completely
ax_q.minorticks_off()

# Uniform X-axis ticks
xtick_pos = np.linspace(0, len(raw_d) - 1, 6).astype(int)
xtick_labels = [str(i) for i in np.linspace(1, len(raw_d), 6).astype(int)]

ax_q.set_xticks(xtick_pos)
ax_q.set_xticklabels(xtick_labels, fontweight="bold")

# Uniform Y-axis ticks
ax_q.set_yticks(np.arange(0, 41, 5))
ax_q.set_yticklabels([str(i) for i in range(0, 41, 5)],
                     fontweight="bold")

leg_q = ax_q.legend(handles=handles_q, loc="lower left", ncol=1,
                    handlelength=1.8, handletextpad=0.5, borderpad=0.7)
for t in leg_q.get_texts():
    t.set_fontweight("bold")

ax_q.text(-0.13, 1.06, "b", transform=ax_q.transAxes,
          fontsize=15, fontweight="bold", va="bottom", ha="left")
fig1.suptitle("Per-base sequence quality: SRR27033667",
              fontsize=13, fontweight="bold", y=0.97)
sim_note(fig1)
bold_ticks(ax_q)

OUTPUT_DIR = Path(__file__).resolve().parent
OUTPUT_DIR.mkdir(exist_ok=True)

fig1.savefig(OUTPUT_DIR / "Per-base_Phred_QS_WGS_SR.png",
             dpi=600, bbox_inches="tight")
print("Saved: Per-base_Phred_QS_WGS_SR.png")
plt.close(fig1)

# ══════════════════════════════════════════════════════════════════════════════
# PANEL C — GC content
# ══════════════════════════════════════════════════════════════════════════════
gc_rx = np.array([v[0] for v in gc_raw])
gc_ry = np.array([v[1] for v in gc_raw])
gc_cx = np.array([v[0] for v in gc_clean])
gc_cy = np.array([v[1] for v in gc_clean])

gc_ry_n = gc_ry / gc_ry.sum()
gc_cy_n = gc_cy / gc_cy.sum()
ymax_gc = max(gc_ry_n.max(), gc_cy_n.max()) * 1.15

fig2, ax_gc = plt.subplots(figsize=(6.5, 4.8))
fig2.subplots_adjust(left=0.14, right=0.97, top=0.87, bottom=0.14)

ax_gc.fill_between(gc_rx, gc_ry_n, color=C_RAW,  alpha=0.25, lw=0)
ax_gc.fill_between(gc_cx, gc_cy_n, color=C_FILT, alpha=0.28, lw=0)
ax_gc.plot(gc_rx, gc_ry_n, color=C_RAW,  lw=2.5, label="Raw reads")
ax_gc.plot(gc_cx, gc_cy_n, color=C_FILT, lw=2.5, label="Trimmed reads")

ax_gc.set_xlabel("GC content (%)", labelpad=6)
ax_gc.set_ylabel("Fraction of reads", labelpad=6)
ax_gc.set_xlim(0, 100)
ax_gc.set_ylim(0, ymax_gc)

# Complete x-ticks
ax_gc.set_xticks([0, 20, 40, 60, 80, 100])
ax_gc.set_xticklabels(["0", "20", "40", "60", "80", "100"], fontweight="bold")

# Complete y-ticks — 5 evenly spaced
# Remove all minor ticks
ax_gc.minorticks_off()

# Uniform X-axis ticks
ax_gc.set_xticks([0, 20, 40, 60, 80, 100])
ax_gc.set_xticklabels(["0", "20", "40", "60", "80", "100"],
                      fontweight="bold")

# Uniform Y-axis ticks
yticks = np.linspace(0, ymax_gc, 6)

ax_gc.set_yticks(yticks)
ax_gc.set_yticklabels([f"{t:.3f}" for t in yticks],
                      fontweight="bold")

leg_gc = ax_gc.legend(loc="upper left", handlelength=1.8,
                      handletextpad=0.5, borderpad=0.7)
for t in leg_gc.get_texts():
    t.set_fontweight("bold")

ax_gc.text(-0.14, 1.06, "c", transform=ax_gc.transAxes,
           fontsize=15, fontweight="bold", va="bottom", ha="left")
fig2.suptitle("Per-sequence GC content: SRR27033667",
              fontsize=13, fontweight="bold", y=0.97)
sim_note(fig2)
bold_ticks(ax_gc)

fig2.savefig(OUTPUT_DIR / "WGS_GC_Distribution_SR.png",
             dpi=600, bbox_inches="tight")
print("Saved: WGS_GC_Distribution_SR.png")
plt.close(fig2)
