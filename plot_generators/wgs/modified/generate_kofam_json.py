#!/usr/bin/env python3
import argparse
import json
import logging
import os
import sys
import numpy as np
import pandas as pd
import warnings

warnings.filterwarnings("ignore")

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

def main():
    parser = argparse.ArgumentParser(description="KofamScan JSON Generator")
    parser.add_argument("kofamscan_tsv", help="Path to kofamscan_results.tsv")
    parser.add_argument("output_dir", help="Output directory")
    parser.add_argument("sample_id", help="Sample ID")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    
    log_file = os.path.join(args.output_dir, f"{args.sample_id}_kofam_json.log")
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[logging.FileHandler(log_file), logging.StreamHandler(sys.stdout)]
    )
    
    logging.info(f"Started KofamScan processing for {args.sample_id}")
    
    if not os.path.exists(args.kofamscan_tsv):
        logging.error(f"Input file not found: {args.kofamscan_tsv}")
        sys.exit(1)
        
    rows = []
    with open(args.kofamscan_tsv, "r") as fh:
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
    
    hits_per_gene = df.groupby("gene")["ko"].count()
    max_hits = int(hits_per_gene.max()) if len(hits_per_gene) > 0 else 10
    bins_a = list(range(1, min(max_hits + 2, 30)))
    hist_a, _ = np.histogram(hits_per_gene, bins=bins_a) if len(hits_per_gene) > 0 else ([], [])
    bin_centers_a = (np.array(bins_a[:-1]) + np.array(bins_a[1:])) / 2 if len(bins_a) > 1 else []
    
    cat_counts = best["category"].value_counts()
    
    top_genes = best.nlargest(30, "score")["gene"].tolist()
    heat_df = best[best["gene"].isin(top_genes)][["gene","category","score","ko"]].copy()
    
    pivot = heat_df.pivot_table(index="gene", columns="category", values="score", aggfunc="max").fillna(0)
    if not pivot.empty:
        pivot = pivot.loc[pivot.sum(axis=1).sort_values(ascending=True).index]
        
    payload = {
        "sample_id": args.sample_id,
        "hits_per_gene_distribution": {
            "counts": hist_a.tolist() if len(hist_a) > 0 else [],
            "bin_centers": bin_centers_a.tolist() if len(bin_centers_a) > 0 else [],
            "median": float(hits_per_gene.median()) if len(hits_per_gene) > 0 else 0.0
        },
        "functional_categories": [{"category": k, "count": v} for k, v in cat_counts.items()],
        "top_genes_heatmap": {
            "genes": pivot.index.tolist() if not pivot.empty else [],
            "categories": pivot.columns.tolist() if not pivot.empty else [],
            "scores": pivot.values.tolist() if not pivot.empty else []
        }
    }
    
    json_path = os.path.join(args.output_dir, f"{args.sample_id}_kofam_summary.json")
    with open(json_path, "w") as f:
        json.dump(payload, f, indent=2)
        
    logging.info(f"Saved JSON data to {json_path}")
    logging.info("Completed successfully")

if __name__ == "__main__":
    main()
