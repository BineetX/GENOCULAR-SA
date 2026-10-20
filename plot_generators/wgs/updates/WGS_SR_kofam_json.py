import pandas as pd
import numpy as np
import json
import sys
import warnings
warnings.filterwarnings('ignore')

INPUT_FILE = sys.argv[1] if len(sys.argv) > 1 else "kofamscan_results.tsv"
OUTPUT_JSON = "kofam_plots_data.json"

PATHWAY_KEYWORDS = {
    "Signal transduction": ["two-component","signal","kinase","sensor","regulator","phospho"],
    "Metabolism": ["dehydrogenase","synthase","synthetase","reductase","oxidase","transferase","hydrolase","isomerase","lyase","ligase","phosphorylase","carboxylase","oxidoreductase","EC:"],
    "Transport": ["transporter","ABC","permease","channel","pump","efflux","uptake","import","export","MFS","PTS"],
    "DNA replication/repair": ["DNA","helicase","gyrase","topoisomerase","recombinase","repair","primase","polymerase","ligase","endonuclease"],
    "Transcription": ["RNA polymerase","transcription","sigma","elongation","termination"],
    "Translation": ["ribosom","tRNA","aminoacyl","translation","elongation factor","initiation factor"],
    "Cell wall/membrane": ["cell wall","peptidoglycan","murein","membrane","lipid","fatty acid","phospholipid","LPS","teichoic"],
    "Protein processing": ["protease","chaperone","heat shock","folding","ubiquitin","degradation","peptidase","HSP"],
    "Energy metabolism": ["ATP","ATPase","NADH","oxidative","electron","cytochrome","respiration","photosynthesis","fermentation"],
    "Stress/Defense": ["stress","resistance","antibiotic","toxin","antitoxin","defense","immune","protection"],
}

def infer_category(definition):
    d = str(definition).lower()
    for cat, keywords in PATHWAY_KEYWORDS.items():
        if any(kw.lower() in d for kw in keywords):
            return cat
    return "Other"

rows = []
with open(INPUT_FILE, "r") as fh:
    for line in fh:
        if line.startswith("##") or not line.strip(): continue
        parts = line.lstrip().split("\t")
        if parts[0].strip() in ("*", ""): parts = parts[1:]
        if len(parts) >= 6: rows.append(parts[:7])

cols = ["gene","ko","threshold","score","evalue","definition"]
df = pd.DataFrame(rows, columns=(cols + ["extra"])[:len(rows[0])] if rows else cols)[cols]
for c in ["threshold","score"]: df[c] = pd.to_numeric(df[c], errors="coerce")
df["evalue"] = pd.to_numeric(df["evalue"], errors="coerce")
df = df[df["ko"].str.match(r"^K\d{5}$", na=False)].copy()

best = df.sort_values("score", ascending=False).drop_duplicates("gene").copy()
best["category"] = best["definition"].apply(infer_category)
df["pass"] = df["score"] >= df["threshold"]

output_data = {}

# Plot 1: Pre-calculated counts
hits_per_gene = df.groupby("gene")["ko"].count()
hits_counts = hits_per_gene.value_counts().sort_index()
output_data["plot1_ko_hits"] = {
    "x": hits_counts.index.tolist(),
    "y": hits_counts.values.tolist(),
    "median": float(hits_per_gene.median())
}

# Plot 2: Pre-binned histogram 
all_scores = df["score"].dropna()
scores_pass = df[df["pass"]]["score"].dropna()
scores_fail = df[~df["pass"]]["score"].dropna()
bins_b = np.linspace(all_scores.min(), all_scores.max(), 55)
fail_counts, _ = np.histogram(scores_fail, bins=bins_b)
pass_counts, _ = np.histogram(scores_pass, bins=bins_b)
bin_centers_b = (bins_b[:-1] + bins_b[1:]) / 2

output_data["plot2_score_dist"] = {
    "x": bin_centers_b.tolist(),
    "fail_y": fail_counts.tolist(),
    "pass_y": pass_counts.tolist(),
    "fail_count": len(scores_fail),
    "pass_count": len(scores_pass)
}

# Plot 3: Pre-binned E-values
pos_e = df["evalue"].dropna()
pos_e = pos_e[pos_e > 0]
if len(pos_e) > 0:
    counts_c, bins_c = np.histogram(np.log10(pos_e), bins=60)
    output_data["plot3_evalue_dist"] = {
        "x": ((bins_c[:-1] + bins_c[1:]) / 2).tolist(),
        "y": counts_c.tolist(),
        "threshold_line": np.log10(1e-5)
    }

# Plot 4: Categories
cat_counts = best["category"].value_counts()
output_data["plot4_categories"] = {
    "y": cat_counts.index.tolist(),
    "x": cat_counts.values.tolist()
}

# Plot 5: Heatmap
top_genes = best.nlargest(30, "score")["gene"].tolist()
pivot = best[best["gene"].isin(top_genes)][["gene","category","score"]].pivot_table(
    index="gene", columns="category", values="score", aggfunc="max").fillna(0)
pivot = pivot.loc[pivot.sum(axis=1).sort_values(ascending=True).index]

output_data["plot5_heatmap"] = {
    "x": pivot.columns.tolist(),
    "y": pivot.index.tolist(),
    "z": pivot.values.tolist()
}

with open(OUTPUT_JSON, "w") as f:
    json.dump(output_data, f)
