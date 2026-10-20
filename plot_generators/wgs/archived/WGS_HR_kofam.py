#!/usr/bin/env python3
"""
KofamScan JSON Generator.
Parses kofamscan_results.tsv and outputs structured JSON files for Next.js / D3.js visualization.
"""

import json
import re
from pathlib import Path
import pandas as pd
import numpy as np
import warnings

warnings.filterwarnings("ignore")

INPUT_FILE = "kofamscan_results.tsv"
OUTDIR = "."

def ensure_dir(path):
    Path(path).mkdir(parents=True, exist_ok=True)

PATHWAY_KEYWORDS = {
    "Signal transduction":       ["two-component","signal","kinase","sensor","regulator","phospho"],
    "Metabolism":                ["dehydrogenase","synthase","synthetase","reductase","oxidase",
                                  "transferase","hydrolase","isomerase","lyase","ligase",
                                  "phosphorylase","carboxylase","oxidoreductase","EC:"],
    "Transport":                 ["transporter","ABC","permease","channel","pump","efflux",
                                  "uptake","import","export","MFS","PTS"],
    "DNA replication/repair":    ["DNA","helicase","gyrase","topoisomerase","recombinase",
                                  "repair","primase","polymerase","ligase","endonuclease"],
    "Transcription":             ["RNA polymerase","transcription","sigma","elongation","termination"],
    "Translation":               ["ribosom","tRNA","aminoacyl","translation","elongation factor",
                                  "initiation factor"],
    "Cell wall/membrane":        ["cell wall","peptidoglycan","murein","membrane","lipid",
                                  "fatty acid","phospholipid","LPS","teichoic"],
    "Protein processing":        ["protease","chaperone","heat shock","folding","ubiquitin",
                                  "degradation","peptidase","HSP"],
    "Energy metabolism":         ["ATP","ATPase","NADH","oxidative","electron","cytochrome",
                                  "respiration","photosynthesis","fermentation"],
    "Stress/Defense":            ["stress","resistance","antibiotic","toxin","antitoxin",
                                  "defense","immune","protection"],
}

def infer_category(definition):
    d = str(definition).lower()
    for cat, keywords in PATHWAY_KEYWORDS.items():
        if any(kw.lower() in d for kw in keywords):
            return cat
    return "Other"

def generate_kofam_json(input_file=INPUT_FILE, outdir=OUTDIR):
    ensure_dir(outdir)
    outdir_path = Path(outdir)
    input_path = Path(input_file)

    if not input_path.exists():
        print(f"Error: Could not find '{input_file}' in the current directory[cite: 2].")
        return

    print(f"Loading {input_file}[cite: 2]...")
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

    cols = ["gene","ko","threshold","score","evalue","definition"]
    df = pd.DataFrame(rows, columns=(cols + ["extra"])[:len(rows[0])] if rows else cols)
    df = df[cols[:len(df.columns)]].copy()
    df.columns = cols[:len(df.columns)]

    for c in ["threshold","score"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df["evalue"] = pd.to_numeric(df["evalue"], errors="coerce")

    df = df[df["ko"].str.match(r"^K\d{5}$", na=False)].copy()

    best = df.sort_values("score", ascending=False).drop_duplicates("gene").copy()
    best["category"] = best["definition"].apply(infer_category)

    df["pass"] = df["score"] >= df["threshold"]
    best["pass"] = best["score"] >= best["threshold"]

    # 1. Overview Payload
    hits_per_gene = df.groupby("gene")["ko"].count()
    max_hits = int(hits_per_gene.max()) if len(hits_per_gene) > 0 else 10
    bins_a = list(range(1, min(max_hits + 2, 30)))
    hist_a, _ = np.histogram(hits_per_gene, bins=bins_a)
    bin_centers_a = (np.array(bins_a[:-1]) + np.array(bins_a[1:])) / 2

    cat_counts = best["category"].value_counts()

    payload_overview = {
        "metadata": {
            "input": input_file,
            "total_ko_hits": int(len(df)),
            "unique_genes": int(df["gene"].nunique()),
            "best_hits_passing": int(best["pass"].sum())
        },
        "hits_per_gene": {
            "x": bin_centers_a.tolist(),
            "y": hist_a.tolist(),
            "median": float(hits_per_gene.median()) if len(hits_per_gene) > 0 else 0.0
        },
        "functional_categories": {
            "x": cat_counts.values.tolist(),
            "y": cat_counts.index.tolist()
        },
        "layout": {
            "title": "KofamScan Functional Annotation Overview"
        }
    }

    out_overview = outdir_path / "kofam_overview.json"
    with open(out_overview, "w") as f:
        json.dump(payload_overview, f, indent=4)
    print(f"Successfully generated: {out_overview}")

    # 2. Heatmap Payload (Top 30 genes x functional categories)[cite: 2]
    top_genes = best.nlargest(30, "score")["gene"].tolist()
    heat_df = best[best["gene"].isin(top_genes)][["gene","category","score","ko"]].copy()

    pivot = heat_df.pivot_table(index="gene", columns="category", values="score", aggfunc="max").fillna(0)
    pivot = pivot.loc[pivot.sum(axis=1).sort_values(ascending=True).index]

    payload_heatmap = {
        "metadata": {
            "input": input_file,
            "description": "KofamScan score for top 30 genes across functional categories[cite: 2]."
        },
        "data": [{
            "x": pivot.columns.tolist(),
            "y": pivot.index.tolist(),
            "z": pivot.values.tolist(),
            "type": "heatmap",
            "colorscale": "Blues"
        }],
        "layout": {
            "title": "KofamScan Score: Top 30 Genes",
            "xaxis": {"title": "Functional categories"},
            "yaxis": {"title": "Protein IDs"}
        }
    }

    out_heatmap = outdir_path / "kofam_heatmap.json"
    with open(out_heatmap, "w") as f:
        json.dump(payload_heatmap, f, indent=4)
    print(f"Successfully generated: {out_heatmap}")

if __name__ == "__main__":
    generate_kofam_json()
