import pandas as pd
import numpy as np
import json
import sys
import warnings
from collections import OrderedDict
warnings.filterwarnings('ignore')

INPUT_FILE = sys.argv[1] if len(sys.argv) > 1 else "annotated_genome.tsv"
OUTPUT_JSON = "prokka_plots_data.json"

# Categorization keywords
category_keywords = OrderedDict({
    "Iron ion homeostasis": ["iron", "ferric", "ferrous", "heme", "siderophore", "feo", "fur"],
    "Oxidation-reduction process": ["oxidoreductase", "dehydrogenase", "reductase", "oxidase", "catalase", "peroxidase", "superoxide", "ferredoxin", "flavoprotein"],
    "Cell division": ["cell division", "fts", "zap", "mreb", "minc", "mind", "sepa", "sepf"],
    "DNA repair": ["dna repair", "rec", "ruv", "uvr", "mut", "lexa", "rad", "photolyase", "endonuclease", "excinuclease", "glycosylase"],
    "Conjugation": ["conjug", "tra", "trb", "type iv secretion", "relaxase", "pilus assembly"],
    "Resistance": ["resistance", "efflux", "multidrug", "beta-lactamase", "heavy metal", "copper resistance", "ars", "mer", "van", "tet"],
    "Pathogenesis": ["virulence", "adhesin", "invasion", "toxin", "hemolysin", "pathogenicity"],
    "DNA recombination": ["recombinase", "recombination", "resolvase", "site-specific recombination"],
    "Transmembrane transport": ["transporter", "permease", "abc transporter", "symporter", "antiporter", "porin", "channel protein", "pump"],
    "Transcription regulation": ["transcriptional regulator", "response regulator", "sigma factor", "repressor", "activator", "dna-binding", "two-component"],
    "Transposition related": ["transposase", "insertion sequence", "mobile element", "integrase", "is element"],
    "Metabolic process": ["synthetase", "synthase", "kinase", "isomerase", "hydrolase", "lyase", "transferase", "carboxylase", "ligase", "protease", "peptidase", "amidase", "phosphatase", "metalloenzyme"]
})

def function_status(product):
    p = str(product).strip().lower()
    if p == "" or p in {"unknown", "uncharacterized protein"}: return "Unknown function"
    if "hypothetical protein" in p: return "Hypothetical protein"
    return "Known function"

def assign_category(product):
    p = str(product).strip().lower()
    if p == "" or p == "unknown" or "hypothetical protein" in p: return "Other"
    for cat, keywords in category_keywords.items():
        if any(kw in p for kw in keywords): return cat
    return "Other"

print(f"Processing {INPUT_FILE}...")
df = pd.read_csv(INPUT_FILE, sep="\t")
df.columns = [str(c).strip() for c in df.columns]

df["ftype"] = df["ftype"].astype(str).str.strip()
df["product"] = df["product"].fillna("").astype(str).str.strip()
if "len_bp" in df.columns:
    df["len_bp"] = pd.to_numeric(df["len_bp"], errors="coerce")

cds = df[df["ftype"].str.upper() == "CDS"].copy()
cds["function_status"] = cds["product"].apply(function_status)
cds["category"] = cds["product"].apply(assign_category)
if "len_bp" in cds.columns:
    cds["aa_len_est"] = (cds["len_bp"] / 3).round().astype(float)

output_data = {}

# Plot 1: Functional Summary (Bar + Pie)
ordered_categories = list(category_keywords.keys()) + ["Other"]
cat_counts = cds["category"].value_counts().reindex(ordered_categories, fill_value=0)
cat_percent = (cat_counts / len(cds) * 100).round(2).sort_values()
status_counts = cds["function_status"].value_counts().reindex(["Known function", "Unknown function", "Hypothetical protein"], fill_value=0)

output_data["plot1_functional"] = {
    "bar_x": cat_percent.index.tolist(),
    "bar_y": cat_percent.values.tolist(),
    "pie_labels": ["Known", "Unknown", "Hypothetical"],
    "pie_values": status_counts.values.tolist(),
    "total_cds": len(cds)
}

# Plot 2: Feature Composition
feature_counts = df["ftype"].astype(str).value_counts().sort_values(ascending=False)
feature_percent = (feature_counts / len(df) * 100).round(2)
output_data["plot2_features"] = {
    "x": feature_counts.index.tolist(),
    "y": feature_counts.values.tolist(),
    "text": [f"<b>{v}</b><br>({p}%)" for v, p in zip(feature_counts.values, feature_percent.values)]
}

# Plot 3: CDS Length Distribution (Pre-binned & conditionally generated)
if "len_bp" in cds.columns and not cds["len_bp"].dropna().empty:
    lengths = cds["len_bp"].dropna().astype(float)
    counts, bins = np.histogram(lengths, bins=35)
    output_data["plot3_cds_len"] = {
        "x": ((bins[:-1] + bins[1:]) / 2).tolist(),
        "y": counts.tolist(),
        "mean": float(np.mean(lengths)),
        "median": float(np.median(lengths))
    }
else:
    output_data["plot3_cds_len"] = None

# Plot 4: Protein Length Distribution (Pre-binned & conditionally generated)
if "aa_len_est" in cds.columns and not cds["aa_len_est"].dropna().empty:
    aa_lengths = cds["aa_len_est"].dropna().astype(float)
    counts_aa, bins_aa = np.histogram(aa_lengths, bins=35)
    output_data["plot4_prot_len"] = {
        "x": ((bins_aa[:-1] + bins_aa[1:]) / 2).tolist(),
        "y": counts_aa.tolist(),
        "mean": float(np.mean(aa_lengths)),
        "median": float(np.median(aa_lengths))
    }
else:
    output_data["plot4_prot_len"] = None

# Plot 5: Top Products
products = cds["product"].fillna("").astype(str).str.strip()
filtered = products[~products.str.lower().isin(["", "unknown", "uncharacterized protein", "hypothetical protein"])]
top_counts = filtered.value_counts().head(15).sort_values(ascending=True)
output_data["plot5_top_products"] = {
    "x": top_counts.values.tolist(),
    "y": top_counts.index.tolist()
}

with open(OUTPUT_JSON, "w") as f:
    json.dump(output_data, f)

print(f"Success! Data exported to {OUTPUT_JSON}")
