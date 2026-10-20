#!/usr/bin/env python3

import pandas as pd
import numpy as np
import json
from pathlib import Path
import warnings

warnings.filterwarnings('ignore')

# ==================================================
# CONFIGURATION & CATEGORY MAPPING
# ==================================================
INPUT_FILE = "kofamscan_results.tsv"
OUTDIR     = "."

PATHWAY_KEYWORDS = {
    "Signal transduction":    ["two-component","signal","kinase","sensor","regulator","phospho"],
    "Metabolism":             ["dehydrogenase","synthase","synthetase","reductase","oxidase",
                               "transferase","hydrolase","isomerase","lyase","ligase",
                               "phosphorylase","carboxylase","oxidoreductase","EC:"],
    "Transport":              ["transporter","ABC","permease","channel","pump","efflux",
                               "uptake","import","export","MFS","PTS"],
    "DNA replication/repair": ["DNA","helicase","gyrase","topoisomerase","recombinase",
                               "repair","primase","polymerase","ligase","endonuclease"],
    "Transcription":          ["RNA polymerase","transcription","sigma","elongation","termination"],
    "Translation":            ["ribosom","tRNA","aminoacyl","translation","elongation factor",
                               "initiation factor"],
    "Cell wall/membrane":     ["cell wall","peptidoglycan","murein","membrane","lipid",
                               "fatty acid","phospholipid","LPS","teichoic"],
    "Protein processing":     ["protease","chaperone","heat shock","folding","ubiquitin",
                               "degradation","peptidase","HSP"],
    "Energy metabolism":      ["ATP","ATPase","NADH","oxidative","electron","cytochrome",
                               "respiration","photosynthesis","fermentation"],
    "Stress/Defense":         ["stress","resistance","antibiotic","toxin","antitoxin",
                               "defense","immune","protection"],
}

def infer_category(definition):
    d = str(definition).lower()
    for cat, keywords in PATHWAY_KEYWORDS.items():
        if any(kw.lower() in d for kw in keywords):
            return cat
    return "Other"

def generate_kofam_jsons(input_file=INPUT_FILE, outdir=OUTDIR):
    input_path = Path(input_file)
    outdir_path = Path(outdir)
    outdir_path.mkdir(parents=True, exist_ok=True)
    
    if not input_path.exists():
        print(f"File not found: {input_file}")
        return

    print(f"Loading {input_file} ...")
    
    # 1. Parse TSV
    rows = []
    with open(input_path, "r") as fh:
        for line in fh:
            line = line.rstrip("\n")
            if line.startswith("##") or line.strip() == "":
                continue
            line = line.lstrip()
            parts = line.split("\t")
            if len(parts) < 6:
                continue
            if parts[0].strip() in ("*", ""):
                parts = parts[1:]
            if len(parts) < 6:
                continue
            rows.append(parts[:7])

    cols = ["gene", "ko", "threshold", "score", "evalue", "definition"]
    df = pd.DataFrame(rows, columns=(cols + ["extra"])[:len(rows[0])] if rows else cols)
    df = df[cols[:len(df.columns)]].copy()
    df.columns = cols[:len(df.columns)]

    # 2. Coerce Data Types
    for c in ["threshold", "score"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df["evalue"] = pd.to_numeric(df["evalue"], errors="coerce")
    df = df[df["ko"].str.match(r"^K\d{5}$", na=False)].copy()

    # Best hit per gene = highest score
    best = df.sort_values("score", ascending=False).drop_duplicates("gene").copy()
    best["category"] = best["definition"].apply(infer_category)

    # Pass/fail threshold
    df["pass"] = df["score"] >= df["threshold"]
    best["pass"] = best["score"] >= best["threshold"]

    print(f"  Total KO hits   : {len(df):,}")
    print(f"  Unique genes    : {df['gene'].nunique():,}")
    print(f"  Best hits ≥ thr : {best['pass'].sum():,}")

    # ==================================================
    # JSON 1: KO hits per gene (Distribution)
    # ==================================================
    hits_per_gene = df.groupby("gene")["ko"].count()
    hist_counts_hits, bin_edges_hits = np.histogram(hits_per_gene, bins=range(1, min(hits_per_gene.max() + 2, 30)))
    bin_centers_hits = (bin_edges_hits[:-1] + bin_edges_hits[1:]) / 2

    payload_hits = {
        "metadata": {"input": input_file, "median_hits": float(hits_per_gene.median())},
        "data": [{
            "x": bin_centers_hits.tolist(),
            "y": hist_counts_hits.tolist(),
            "type": "bar",
            "marker": {"color": "#3C5488"}
        }],
        "layout": {
            "title": "KO Hits per Gene",
            "xaxis": {"title": "Number of KO Hits"},
            "yaxis": {"title": "Number of Genes"}
        }
    }
    with open(outdir_path / "kofam_hits_per_gene.json", "w") as f:
        json.dump(payload_hits, f, indent=4)

    # ==================================================
    # JSON 2: Score Distribution (Pass vs Fail)
    # ==================================================
    scores_pass = df[df["pass"]]["score"].dropna().values
    scores_fail = df[~df["pass"]]["score"].dropna().values
    all_scores = df["score"].dropna().values
    
    # Use common bins for both passing and failing scores
    bins_b = np.linspace(all_scores.min(), all_scores.max(), 55)
    counts_pass, _ = np.histogram(scores_pass, bins=bins_b)
    counts_fail, _ = np.histogram(scores_fail, bins=bins_b)
    bin_centers_scores = (bins_b[:-1] + bins_b[1:]) / 2

    payload_scores = {
        "metadata": {"input": input_file, "pass_count": len(scores_pass), "fail_count": len(scores_fail)},
        "data": [
            {
                "name": "Below Threshold",
                "x": bin_centers_scores.tolist(),
                "y": counts_fail.tolist(),
                "type": "bar",
                "marker": {"color": "#E64B35"}
            },
            {
                "name": "Above Threshold",
                "x": bin_centers_scores.tolist(),
                "y": counts_pass.tolist(),
                "type": "bar",
                "marker": {"color": "#00A087"}
            }
        ],
        "layout": {
            "title": "KofamScan Score Distribution",
            "xaxis": {"title": "KofamScan Score"},
            "yaxis": {"title": "Count"},
            "barmode": "stack"
        }
    }
    with open(outdir_path / "kofam_score_distribution.json", "w") as f:
        json.dump(payload_scores, f, indent=4)

    # ==================================================
    # JSON 3: E-value Distribution (log10)
    # ==================================================
    pos_e = df["evalue"].dropna()
    pos_e = pos_e[pos_e > 0].values
    
    if len(pos_e) > 0:
        log_e = np.log10(pos_e)
        hist_counts_eval, bin_edges_eval = np.histogram(log_e, bins=60)
        bin_centers_eval = (bin_edges_eval[:-1] + bin_edges_eval[1:]) / 2

        payload_eval = {
            "metadata": {"input": input_file},
            "data": [{
                "x": bin_centers_eval.tolist(),
                "y": hist_counts_eval.tolist(),
                "type": "bar",
                "marker": {"color": "#4DBBD5"}
            }],
            "layout": {
                "title": "E-value Distribution",
                "xaxis": {"title": "log10(E-value)"},
                "yaxis": {"title": "Count"}
            }
        }
        with open(outdir_path / "kofam_evalue_distribution.json", "w") as f:
            json.dump(payload_eval, f, indent=4)

    # ==================================================
    # JSON 4: Functional Category Distribution
    # ==================================================
    cat_counts = best["category"].value_counts().sort_values(ascending=True)
    
    payload_cats = {
        "metadata": {"input": input_file},
        "data": [{
            "y": cat_counts.index.tolist(),
            "x": cat_counts.values.tolist(),
            "type": "bar",
            "orientation": "h"
        }],
        "layout": {
            "title": "Functional Category (Best KO Hit)",
            "xaxis": {"title": "Number of Genes"},
            "yaxis": {"title": "Category"}
        }
    }
    with open(outdir_path / "kofam_functional_categories.json", "w") as f:
        json.dump(payload_cats, f, indent=4)

    # ==================================================
    # JSON 5: Heatmap (Top 30 Genes x Categories)
    # ==================================================
    top_genes = best.nlargest(30, "score")["gene"].tolist()
    heat_df = best[best["gene"].isin(top_genes)][["gene", "category", "score"]].copy()

    # Pivot to Matrix
    pivot = heat_df.pivot_table(index="gene", columns="category", values="score", aggfunc="max").fillna(0)
    pivot = pivot.loc[pivot.sum(axis=1).sort_values(ascending=True).index]

    # Convert to standard lists for JSON export
    x_categories = pivot.columns.tolist()
    y_genes = pivot.index.tolist()
    z_scores = pivot.values.tolist()

    payload_heatmap = {
        "metadata": {"input": input_file, "description": "Top 30 genes by KofamScan score across categories."},
        "data": [{
            "x": x_categories,
            "y": y_genes,
            "z": z_scores,
            "type": "heatmap",
            "colorscale": "Blues"
        }],
        "layout": {
            "title": "KofamScan Score: Top 30 Genes",
            "xaxis": {"title": "Functional Categories"},
            "yaxis": {"title": "Protein IDs"}
        }
    }
    with open(outdir_path / "kofam_heatmap.json", "w") as f:
        json.dump(payload_heatmap, f, indent=4)

    print("\nSuccessfully generated JSON files:")
    print("  - kofam_hits_per_gene.json")
    print("  - kofam_score_distribution.json")
    print("  - kofam_evalue_distribution.json")
    print("  - kofam_functional_categories.json")
    print("  - kofam_heatmap.json")

if __name__ == "__main__":
    generate_kofam_jsons()
