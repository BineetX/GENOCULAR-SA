import pandas as pd
import numpy as np
import json
import sys
import warnings
warnings.filterwarnings('ignore')

INPUT_FILE = sys.argv[1] if len(sys.argv) > 1 else "interproscan_results.tsv"
OUTPUT_JSON = "interproscan_plots_data.json"

COLUMNS = [
    "protein_id", "md5", "seq_length", "database", "accession",
    "description", "start", "end", "evalue", "status", "date",
    "ipr_accession", "ipr_description", "go_terms"
]

print(f"Loading {INPUT_FILE} ...")
try:
    df = pd.read_csv(INPUT_FILE, sep="\t", header=None, names=COLUMNS, low_memory=False)
except FileNotFoundError:
    print(f"Error: {INPUT_FILE} not found.")
    exit(1)

df["seq_length"] = pd.to_numeric(df["seq_length"], errors="coerce")
df["start"]      = pd.to_numeric(df["start"], errors="coerce")
df["end"]        = pd.to_numeric(df["end"], errors="coerce")
df["evalue"]     = pd.to_numeric(df["evalue"], errors="coerce")
df_sig = df[df["status"] == "T"].copy()

output_data = {}

# ---------------------------------------------------------
# Plot 1a: Database Distribution
# ---------------------------------------------------------
db_counts = df_sig["database"].value_counts()
output_data["plot1a_db"] = {
    "x": db_counts.index.tolist(),
    "y": db_counts.values.tolist()
}

# ---------------------------------------------------------
# Plot 1b: Protein Length Distribution (Pre-binned)
# ---------------------------------------------------------
prot_len = df.drop_duplicates("protein_id")["seq_length"].dropna().astype(float)
counts_len, bins_len = np.histogram(prot_len, bins=50)
output_data["plot1b_len"] = {
    "x": ((bins_len[:-1] + bins_len[1:]) / 2).tolist(),
    "y": counts_len.tolist(),
    "median": float(np.median(prot_len))
}

# ---------------------------------------------------------
# Plot 1c: Top 20 InterPro Entries
# ---------------------------------------------------------
df_ipr = df_sig[df_sig["ipr_accession"].notna() & (df_sig["ipr_accession"] != "-")].copy()
top_ipr = df_ipr["ipr_description"].value_counts().head(20)
output_data["plot1c_ipr"] = {
    "x": top_ipr.values.tolist(),
    "y": top_ipr.index.tolist()
}

# ---------------------------------------------------------
# Plot 1d: E-value Distribution (Pre-binned)
# ---------------------------------------------------------
evals = df_sig["evalue"].dropna()
pos_evals = evals[evals > 0]
if not pos_evals.empty:
    log_evals = np.log10(pos_evals + 1e-300)
    counts_ev, bins_ev = np.histogram(log_evals, bins=60)
    output_data["plot1d_eval"] = {
        "x": ((bins_ev[:-1] + bins_ev[1:]) / 2).tolist(),
        "y": counts_ev.tolist()
    }
else:
    output_data["plot1d_eval"] = None

# ---------------------------------------------------------
# Plot 2: Domain Architecture (Top 20 Multi-domain Proteins)
# ---------------------------------------------------------
top_prots = (df_sig.groupby("protein_id")["ipr_accession"]
             .nunique().sort_values(ascending=False).head(20).index.tolist())

domains_list = []
prot_lengths = []
unique_domains = set()

for i, prot in enumerate(reversed(top_prots)):
    sub = df_sig[df_sig["protein_id"] == prot]
    plen = float(sub["seq_length"].iloc[0]) if not sub.empty else 500.0
    prot_lengths.append(plen)
    
    for _, hit in sub.iterrows():
        desc = hit["ipr_description"] if pd.notna(hit["ipr_description"]) and hit["ipr_description"] != "-" else hit["description"]
        desc_str = str(desc).strip()
        if desc_str and desc_str != "nan":
            unique_domains.add(desc_str)
            domains_list.append({
                "prot_idx": i,
                "start": float(hit["start"]),
                "end": float(hit["end"]),
                "desc": desc_str
            })

output_data["plot2_arch"] = {
    "proteins": list(reversed(top_prots)),  # Kept in y-axis order
    "lengths": prot_lengths,
    "domains": domains_list,
    "unique_domains": list(unique_domains)
}

# Write to JSON
with open(OUTPUT_JSON, "w") as f:
    json.dump(output_data, f)

print(f"Success! Data exported to {OUTPUT_JSON}")
