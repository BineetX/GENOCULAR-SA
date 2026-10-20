"""
abricate_plots.py  –  Publication-quality AMR figures from Abricate CSVs
=========================================================================
Works beautifully even with sparse data (1-2 genes per isolate).

Four figures:
  Fig 1 – Top AMR genes         (ranked lollipop, coloured by resistance class)
  Fig 2 – Top resistance classes (donut + ranked bar combo)
  Fig 3 – Per-isolate gene presence (bubble/tile matrix)
  Fig 4 – Coverage vs Identity   (scatter + marginal density)

Usage
-----
  python abricate_plots.py                         # auto-detect in cwd
  python abricate_plots.py --indir /path/to/csvs
  python abricate_plots.py --files a.csv b.csv
  python abricate_plots.py --fmt png --dpi 600 --top 20

Output → ./abricate_figures/
"""

import argparse, sys, warnings
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import matplotlib.ticker as mticker
import matplotlib.colors as mcolors
from matplotlib.gridspec import GridSpec
from matplotlib.patheffects import withStroke
import numpy as np, pandas as pd

warnings.filterwarnings("ignore")

# ── Style ──────────────────────────────────────────────────────────────────────
RC = {
    "font.family":"sans-serif",
    "font.sans-serif":["DejaVu Sans","Helvetica Neue","Arial"],
    "font.size":8, "axes.titlesize":9, "axes.labelsize":8,
    "xtick.labelsize":7, "ytick.labelsize":7, "legend.fontsize":7,
    "axes.linewidth":0.8, "xtick.major.width":0.8, "ytick.major.width":0.8,
    "xtick.major.size":3, "ytick.major.size":3,
    "axes.spines.top":False, "axes.spines.right":False,
    "pdf.fonttype":42, "ps.fonttype":42,
    "savefig.bbox":"tight", "savefig.pad_inches":0.1,
    "axes.grid":False,
}

DB_COLORS = {
    "card":"#1F77B4","resfinder":"#D62728","ncbi":"#2CA02C",
    "plasmidfinder":"#FF7F0E","vfdb":"#9467BD",
    "argannot":"#8C564B","ecoh":"#E377C2",
}

# 15 distinct class colours (colorblind-friendlier palette)
CLASS_PAL = [
    "#4E79A7","#E15759","#76B7B2","#F28E2B","#59A14F",
    "#B07AA1","#EDC948","#FF9DA7","#9C755F","#BAB0AC",
    "#A0CBE8","#FFBE7D","#86BCB6","#8CD17D","#D4A6C8",
]

def db_color(db): return DB_COLORS.get(str(db).lower(),"#546E7A")

# ── Load ───────────────────────────────────────────────────────────────────────
def load_csvs(paths):
    frames=[]
    for p in paths:
        try:
            df=pd.read_csv(p,sep=",",low_memory=False)
            df.columns=[c.lstrip("#").strip() for c in df.columns]
            frames.append(df)
            print(f"    {Path(p).name:45s}  {len(df):>5} rows")
        except Exception as e:
            print(f"  [warn] {Path(p).name}: {e}")
    if not frames: sys.exit("  No valid CSV files found.")
    df=pd.concat(frames,ignore_index=True)
    df.columns=df.columns.str.upper().str.strip()
    rename={c:c.replace("%","PCT_").strip("_") for c in df.columns if "%" in c}
    df=df.rename(columns=rename)
    for col in ["PCT_COVERAGE","PCT_IDENTITY"]:
        if col not in df.columns: df[col]=np.nan
        df[col]=pd.to_numeric(df[col],errors="coerce")
    df["DATABASE"]=df["DATABASE"].str.lower().str.strip()
    df["GENE"]=df["GENE"].str.strip()
    df["RESISTANCE"]=(
        df.get("RESISTANCE",pd.Series(["Unknown"]*len(df)))
          .fillna("Unknown")
          .str.replace(r"[_/\\]"," ",regex=True).str.strip().str.title()
    )
    df["SAMPLE"]=df["FILE"].apply(lambda x: Path(str(x)).parent.parent.name)
    return df

def save_fig(fig,outdir,name,fmt,dpi):
    path=outdir/f"{name}.{fmt}"
    fig.savefig(path,format=fmt,dpi=dpi)
    print(f"  ✓  {path.name}")
    plt.close(fig)

def class_color_map(classes):
    return {cls:CLASS_PAL[i%len(CLASS_PAL)] for i,cls in enumerate(sorted(set(classes)))}


# ═══════════════════════════════════════════════════════════════════════════════
# Fig 1 – Lollipop: top AMR genes coloured by resistance class
# ═══════════════════════════════════════════════════════════════════════════════
def fig_top_genes(df,outdir,fmt,dpi,top):
    counts = df.groupby(["GENE","RESISTANCE"]).size().reset_index(name="n")
    counts = counts.sort_values("n",ascending=False).drop_duplicates("GENE").head(top)
    counts = counts.sort_values("n").reset_index(drop=True)
    n      = len(counts)

    cmap   = class_color_map(counts["RESISTANCE"])
    colors = [cmap[r] for r in counts["RESISTANCE"]]

    fig_h  = max(4, n*0.42+1.2)
    fig,ax = plt.subplots(figsize=(6.5,fig_h))

    y = np.arange(n)
    # stem lines
    ax.hlines(y, 0, counts["n"], colors="#cccccc", linewidth=1.2, zorder=1)
    # dots
    ax.scatter(counts["n"], y, color=colors, s=90, zorder=3,
               edgecolors="white", linewidths=0.6)
    # count labels
    for i,(val,col) in enumerate(zip(counts["n"],colors)):
        ax.text(val+0.05, i, str(int(val)), va="center",
                fontsize=6.5, color="#333333", fontweight="500")

    # alternating row shading
    for i in range(n):
        if i%2==0:
            ax.axhspan(i-0.42, i+0.42, color="#f5f5f5", zorder=0)

    ax.set_yticks(y)
    ax.set_yticklabels(counts["GENE"], fontsize=7)
    ax.set_xlabel("Number of occurrences across all isolates")
    ax.set_title(f"Top {n} AMR Genes", fontweight="bold", pad=8)
    ax.xaxis.set_major_locator(mticker.MaxNLocator(integer=True, nbins=6))
    ax.set_xlim(-0.3, counts["n"].max()*1.18)
    ax.set_ylim(-0.7, n-0.3)
    ax.spines["left"].set_visible(False)
    ax.tick_params(left=False)

    # legend for resistance classes
    handles=[mpatches.Patch(color=c,label=cls,alpha=0.9)
             for cls,c in sorted(cmap.items()) if cls in counts["RESISTANCE"].values]
    ax.legend(handles=handles,title="Resistance class",title_fontsize=7,
              loc="lower right",frameon=False,fontsize=6.5,handlelength=1.2,
              ncol=max(1,len(handles)//8))

    fig.tight_layout()
    save_fig(fig,outdir,"01_top_amr_genes",fmt,dpi)


# ═══════════════════════════════════════════════════════════════════════════════
# Fig 2 – Donut (class share) + ranked horizontal bar (class count)
# ═══════════════════════════════════════════════════════════════════════════════
def fig_top_classes(df,outdir,fmt,dpi,top):
    class_counts = df["RESISTANCE"].value_counts().head(top)
    n      = len(class_counts)
    cmap   = class_color_map(class_counts.index)
    colors = [cmap[c] for c in class_counts.index]

    fig    = plt.figure(figsize=(10,max(3.5,n*0.38+1.5)))
    gs     = GridSpec(1,3,figure=fig,width_ratios=[1,0.08,2.2],wspace=0.05)
    ax_d   = fig.add_subplot(gs[0])   # donut
    ax_b   = fig.add_subplot(gs[2])   # bar

    # ── donut ──
    wedge_props=dict(width=0.45,edgecolor="white",linewidth=0.8)
    wedges,_=ax_d.pie(class_counts.values,colors=colors,
                       wedgeprops=wedge_props,startangle=90,
                       counterclock=False)
    total=class_counts.sum()
    ax_d.text(0,0,f"{total}\ngenes",ha="center",va="center",
              fontsize=9,fontweight="bold",color="#333333",linespacing=1.4)
    ax_d.set_title("Class distribution",fontweight="bold",pad=6)

    # ── horizontal bar ──
    y      = np.arange(n)[::-1]   # largest at top
    bar_h  = 0.62
    for i in range(n):
        if i%2==0:
            ax_b.barh(y[i],9999,height=bar_h+0.38,color="#f5f5f5",zorder=0,left=0)

    bars=ax_b.barh(y,class_counts.values,height=bar_h,
                   color=colors,edgecolor="white",linewidth=0.5,
                   alpha=0.92,zorder=2)
    for bar,val,cls in zip(bars,class_counts.values,class_counts.index):
        pct=val/total*100
        ax_b.text(val+0.1, bar.get_y()+bar.get_height()/2,
                  f"{int(val)}  ({pct:.1f}%)",
                  va="center",fontsize=6.5,color="#333333")

    ax_b.set_yticks(y)
    ax_b.set_yticklabels(class_counts.index,fontsize=7)
    ax_b.set_xlabel("Gene occurrences")
    ax_b.set_title(f"Top {n} Resistance Classes",fontweight="bold",pad=6)
    ax_b.xaxis.set_major_locator(mticker.MaxNLocator(integer=True,nbins=5))
    ax_b.set_xlim(0,class_counts.max()*1.28)
    ax_b.set_axisbelow(True)
    ax_b.spines["left"].set_visible(False)
    ax_b.tick_params(left=False)

    fig.tight_layout()
    save_fig(fig,outdir,"02_top_resistance_classes",fmt,dpi)


# ═══════════════════════════════════════════════════════════════════════════════
# Fig 3 – Isolate × Gene bubble/tile matrix  ← KEY for sparse data
# Shows EVERY isolate even if it has only 1 gene; dots sized by %identity
# ═══════════════════════════════════════════════════════════════════════════════
def fig_isolate_matrix(df,outdir,fmt,dpi,top):
    # pick top genes by prevalence
    top_genes = df["GENE"].value_counts().head(top).index.tolist()
    sub = df[df["GENE"].isin(top_genes)].copy()

    samples = sorted(sub["SAMPLE"].unique())
    genes   = top_genes[::-1]   # highest prevalence at top of y-axis
    n_s, n_g = len(samples), len(genes)

    s_idx = {s:i for i,s in enumerate(samples)}
    g_idx = {g:i for i,g in enumerate(genes)}

    cmap    = class_color_map(df["RESISTANCE"].unique())
    # gene→class lookup
    gene_cls = df.drop_duplicates("GENE").set_index("GENE")["RESISTANCE"].to_dict()

    fig_w = max(6, n_s*0.55+2)
    fig_h = max(3, n_g*0.45+1.5)
    fig,ax = plt.subplots(figsize=(fig_w,fig_h))

    # light grid
    for i in range(n_g):
        ax.axhline(i, color="#e8e8e8", lw=0.5, zorder=0)
    for j in range(n_s):
        ax.axvline(j, color="#e8e8e8", lw=0.5, zorder=0)

    # empty circles (gene not detected)
    for i in range(n_g):
        for j in range(n_s):
            ax.scatter(j, i, s=80, color="none",
                       edgecolors="#dddddd", linewidths=0.6, zorder=1)

    # filled bubbles sized by %identity
    pe=[withStroke(linewidth=1.5,foreground="white")]
    for _,row in sub.iterrows():
        xi = s_idx[row["SAMPLE"]]
        yi = g_idx[row["GENE"]]
        pct_id = row["PCT_IDENTITY"] if not pd.isna(row["PCT_IDENTITY"]) else 85
        size   = 30 + (pct_id/100)*110   # 30–140
        color  = cmap.get(gene_cls.get(row["GENE"],"Unknown"),"#888888")
        ax.scatter(xi, yi, s=size, color=color, alpha=0.85,
                   edgecolors="white", linewidths=0.5, zorder=3)
        # tiny identity label inside bubble
        ax.text(xi, yi, f"{pct_id:.0f}",
                ha="center", va="center", fontsize=4.5,
                color="white", fontweight="bold",
                path_effects=pe, zorder=4)

    ax.set_xticks(range(n_s))
    ax.set_xticklabels(samples, rotation=40, ha="right", fontsize=7)
    ax.set_yticks(range(n_g))
    ax.set_yticklabels(genes, fontsize=7)
    ax.set_xlim(-0.6, n_s-0.4)
    ax.set_ylim(-0.6, n_g-0.4)
    ax.set_xlabel("Isolate", labelpad=5)
    ax.set_ylabel("AMR Gene", labelpad=5)
    ax.set_title("Isolate × Gene Detection Matrix\n"
                 "(bubble size & colour = % identity; open circle = absent)",
                 fontweight="bold", pad=8, fontsize=9)

    # class legend
    present_classes = sorted({gene_cls.get(g,"Unknown") for g in genes})
    handles=[mpatches.Patch(color=cmap.get(c,"#888"),label=c,alpha=0.88)
             for c in present_classes]
    ax.legend(handles=handles,title="Resistance class",title_fontsize=7,
              loc="upper right",bbox_to_anchor=(1.01,1),
              frameon=False,fontsize=6.5,handlelength=1.2)

    # size legend
    for pct,label in [(80,"80%"),(90,"90%"),(100,"100%")]:
        sz = 30+(pct/100)*110
        ax.scatter([],[],s=sz,color="#999999",alpha=0.7,
                   edgecolors="white",label=f"%ID {label}")
    ax.legend(handles=handles+
              [mpatches.Patch(color="#999",alpha=0,label="— % Identity —")]+
              [plt.scatter([],[],s=30+(p/100)*110,color="#999",alpha=0.7,
                           edgecolors="white")
               for p in [80,90,100]],
              labels=[c for c in present_classes]+
                     ["— % Identity —","80%","90%","100%"],
              title_fontsize=7,loc="upper right",
              bbox_to_anchor=(1.0,1.02),frameon=False,
              fontsize=6.5,handlelength=1.2)

    fig.tight_layout()
    save_fig(fig,outdir,"03_isolate_gene_matrix",fmt,dpi)


# ═══════════════════════════════════════════════════════════════════════════════
# Fig 4 – Coverage × Identity scatter + marginal histograms
# ═══════════════════════════════════════════════════════════════════════════════
def fig_coverage_identity(df,outdir,fmt,dpi,top):
    sub=df.dropna(subset=["PCT_COVERAGE","PCT_IDENTITY"]).copy()
    if sub.empty:
        print("  [skip] No numeric %Coverage/%Identity values."); return

    dbs=sorted(sub["DATABASE"].unique())
    cmap_cls=class_color_map(sub["RESISTANCE"].unique())
    pe=[withStroke(linewidth=2,foreground="white")]

    fig=plt.figure(figsize=(6.5,6.2))
    gs=fig.add_gridspec(2,2,width_ratios=[4,1],height_ratios=[1,4],
                        hspace=0.04,wspace=0.04)
    ax     =fig.add_subplot(gs[1,0])
    ax_top =fig.add_subplot(gs[0,0],sharex=ax)
    ax_side=fig.add_subplot(gs[1,1],sharey=ax)

    # colour points by resistance class (more informative than database)
    for cls,grp in sub.groupby("RESISTANCE"):
        col=cmap_cls.get(cls,"#888888")
        ax.scatter(grp["PCT_COVERAGE"],grp["PCT_IDENTITY"],
                   c=col,alpha=0.72,s=28,
                   edgecolors="white",linewidths=0.4,
                   label=cls,zorder=3,
                   rasterized=(len(grp)>500))

    # quality thresholds
    ax.axvline(80,color="#cccccc",lw=0.8,ls="--",zorder=1)
    ax.axhline(80,color="#cccccc",lw=0.8,ls="--",zorder=1)
    ax.text(80.6,1,"80% coverage",fontsize=5.5,color="#aaaaaa",va="bottom")
    ax.text(1,80.6,"80% identity",fontsize=5.5,color="#aaaaaa",va="bottom")

    # label top genes
    top_genes=df["GENE"].value_counts().head(top//2).index.tolist()
    seen=set()
    for _,row in sub[sub["GENE"].isin(top_genes)].iterrows():
        g=row["GENE"]
        if g not in seen:
            ax.text(row["PCT_COVERAGE"]+0.5,row["PCT_IDENTITY"]+0.4,
                    g,fontsize=5,color="#333333",
                    path_effects=pe,zorder=5)
            seen.add(g)

    ax.set_xlim(-2,103); ax.set_ylim(-2,103)
    ax.set_xlabel("% Coverage"); ax.set_ylabel("% Nucleotide Identity")

    classes_present=sorted(sub["RESISTANCE"].unique())
    handles=[mpatches.Patch(color=cmap_cls.get(c,"#888"),label=c,alpha=0.88)
             for c in classes_present]
    ax.legend(handles=handles,title="Resistance class",title_fontsize=7,
              loc="lower right",frameon=False,fontsize=6,handlelength=1,
              ncol=max(1,len(handles)//8))

    bins=np.linspace(0,100,26)
    for cls,grp in sub.groupby("RESISTANCE"):
        col=cmap_cls.get(cls,"#888888")
        ax_top.hist(grp["PCT_COVERAGE"],bins=bins,color=col,alpha=0.55,linewidth=0)
        ax_side.hist(grp["PCT_IDENTITY"],bins=bins,color=col,alpha=0.55,
                     linewidth=0,orientation="horizontal")

    for axx in [ax_top,ax_side]:
        axx.spines["top"].set_visible(False)
        axx.spines["right"].set_visible(False)
        axx.tick_params(labelsize=6)
    ax_top.set_ylabel("Count",fontsize=6)
    ax_side.set_xlabel("Count",fontsize=6)
    plt.setp(ax_top.get_xticklabels(),visible=False)
    plt.setp(ax_side.get_yticklabels(),visible=False)

    fig.suptitle("Gene %Coverage vs. %Nucleotide Identity",
                 fontweight="bold",fontsize=9,y=0.99)
    save_fig(fig,outdir,"04_coverage_identity",fmt,dpi)


# ── CLI ────────────────────────────────────────────────────────────────────────
def main():
    ap=argparse.ArgumentParser(description="Publication AMR figures from Abricate CSV")
    ap.add_argument("--indir",default=".",
                    help="Directory with abricate_*.csv (default: cwd)")
    ap.add_argument("--files",nargs="+",
                    help="Explicit CSV paths (overrides --indir)")
    ap.add_argument("--outdir",default="abricate_figures",
                    help="Output directory (default: ./abricate_figures/)")
    ap.add_argument("--fmt",default="pdf",choices=["pdf","png","svg","eps"])
    ap.add_argument("--dpi",default=300,type=int)
    ap.add_argument("--top",default=20,type=int,
                    help="Top-N genes/classes to display (default: 20)")
    args=ap.parse_args()

    if args.files: paths=[Path(f) for f in args.files]
    else:
        indir=Path(args.indir)
        paths=sorted(indir.glob("abricate_*.csv"))
        if not paths: paths=sorted(indir.glob("*.csv"))
    if not paths: sys.exit(f"  No CSV files found in '{args.indir}'.")

    print(f"\n  Loading {len(paths)} file(s):")
    plt.rcParams.update(RC)
    df=load_csvs(paths)
    print(f"\n  {len(df):,} hits | {df['DATABASE'].nunique()} DB | "
          f"{df['GENE'].nunique()} genes | "
          f"{df['SAMPLE'].nunique()} isolates | "
          f"{df['RESISTANCE'].nunique()} classes\n")

    outdir=Path(args.outdir)
    outdir.mkdir(parents=True,exist_ok=True)
    print("  Generating figures …")
    fig_top_genes(df,outdir,args.fmt,args.dpi,args.top)
    fig_top_classes(df,outdir,args.fmt,args.dpi,args.top)
    fig_isolate_matrix(df,outdir,args.fmt,args.dpi,args.top)
    fig_coverage_identity(df,outdir,args.fmt,args.dpi,args.top)
    print(f"\n  Done → {outdir}/\n")

if __name__=="__main__":
    main()
