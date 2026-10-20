#!/usr/bin/env python3

import re
import json
import sys
from pathlib import Path
import pandas as pd
import warnings
warnings.filterwarnings('ignore')

INPUT_FILE = sys.argv[1] if len(sys.argv) > 1 else "annotations.emapper.annotations"
OUTPUT_JSON = "emapper_plots_data.json"

print(f"Parsing {INPUT_FILE}...")

def load_emapper_annotations(filepath):
    cols = [
        "query", "seed_ortholog", "evalue", "score", "eggNOG_OGs",
        "max_annot_lvl", "COG_category", "Description", "Preferred_name",
        "GOs", "EC", "KEGG_ko", "KEGG_Pathway", "KEGG_Module",
        "KEGG_Reaction", "KEGG_rclass", "BRITE", "KEGG_TC",
        "CAZy", "BiGG_Reaction", "PFAMs"
    ]
    try:
        df = pd.read_csv(filepath, sep="\t", comment="#", names=cols, dtype=str)
        return df.fillna("-")
    except FileNotFoundError:
        print(f"Error: {filepath} not found.")
        exit(1)

df = load_emapper_annotations(INPUT_FILE)
output_data = {}

def split_multi(val):
    if pd.isna(val) or val == "-" or str(val).strip() == "":
        return []
    return [x.strip() for x in re.split(r"[;,|]", str(val)) if x.strip()]

# ---------------------------------------------------------
# 1. EC Enzyme Donut Plot Data
# ---------------------------------------------------------
ec_classes = []
for val in df["EC"]:
    for ec in split_multi(val):
        m = re.match(r"(\d)\.", ec)
        if m:
            ec_classes.append(m.group(1))

ec_mapping = {
    "1": "Oxidoreductases", "2": "Transferases", "3": "Hydrolases",
    "4": "Lyases", "5": "Isomerases", "6": "Ligases", "7": "Translocases"
}
ec_labels = [ec_mapping[x] for x in ec_classes if x in ec_mapping]
ec_counts = pd.Series(ec_labels).value_counts()

output_data["ec_donut"] = {
    "labels": ec_counts.index.tolist(),
    "values": ec_counts.values.tolist()
}

# ---------------------------------------------------------
# 2. PFAM Domain Data
# ---------------------------------------------------------
domains = []
for val in df["PFAMs"]:
    domains += split_multi(val)

pfam_counts = pd.Series(domains).value_counts().head(20)
output_data["pfam_lollipop"] = {
    "y": pfam_counts.index.tolist()[::-1],  # Reverse for bottom-to-top plotting
    "x": pfam_counts.values.tolist()[::-1]
}

# ---------------------------------------------------------
# 3. COG Grouped Data
# ---------------------------------------------------------
cog_letters = []
for val in df["COG_category"]:
    if val != "-":
        for ch in str(val):
            if ch.isalpha():
                cog_letters.append(ch)

cog_counts = pd.Series(cog_letters).value_counts()

COG_META = {
    "J": ("Translation, ribosomal structure & biogenesis", "Information storage & processing"),
    "A": ("RNA processing & modification", "Information storage & processing"),
    "K": ("Transcription", "Information storage & processing"),
    "L": ("Replication, recombination & repair", "Information storage & processing"),
    "B": ("Chromatin structure & dynamics", "Information storage & processing"),
    "D": ("Cell cycle control, cell division", "Cellular processes & signalling"),
    "Y": ("Nuclear structure", "Cellular processes & signalling"),
    "V": ("Defense mechanisms", "Cellular processes & signalling"),
    "T": ("Signal transduction mechanisms", "Cellular processes & signalling"),
    "M": ("Cell wall / membrane / envelope biogenesis", "Cellular processes & signalling"),
    "N": ("Cell motility", "Cellular processes & signalling"),
    "Z": ("Cytoskeleton", "Cellular processes & signalling"),
    "W": ("Extracellular structures", "Cellular processes & signalling"),
    "U": ("Intracellular trafficking, secretion", "Cellular processes & signalling"),
    "O": ("Post-translational modification, turnover, chaperones", "Cellular processes & signalling"),
    "C": ("Energy production & conversion", "Metabolism"),
    "G": ("Carbohydrate transport & metabolism", "Metabolism"),
    "E": ("Amino acid transport & metabolism", "Metabolism"),
    "F": ("Nucleotide transport & metabolism", "Metabolism"),
    "H": ("Coenzyme transport & metabolism", "Metabolism"),
    "I": ("Lipid transport & metabolism", "Metabolism"),
    "P": ("Inorganic ion transport & metabolism", "Metabolism"),
    "Q": ("Secondary metabolites biosynthesis, transport & catabolism", "Metabolism"),
    "R": ("General function prediction only", "Poorly characterized"),
    "S": ("Function unknown", "Poorly characterized"),
}

group_order = [
    "Information storage & processing",
    "Cellular processes & signalling",
    "Metabolism",
    "Poorly characterized",
]

present = [l for l in COG_META if l in cog_counts.index]
final_cogs = []
total_cogs = int(cog_counts.sum())

for g in group_order[::-1]:  # Reverse so bottom groups plot first
    in_g = [(l, cog_counts[l]) for l in present if COG_META[l][1] == g]
    in_g.sort(key=lambda x: x[1])  # Sort ascending within group
    for l, count in in_g:
        final_cogs.append({
            "letter": l,
            "description": COG_META[l][0],
            "super_category": g,
            "count": int(count),
            "percentage": round(count / total_cogs * 100, 1)
        })

output_data["cog_lollipop"] = {
    "cogs": final_cogs,
    "super_categories": group_order[::-1]
}

# ---------------------------------------------------------
# Export to JSON
# ---------------------------------------------------------
with open(OUTPUT_JSON, "w") as f:
    json.dump(output_data, f)

print(f"Success! Data exported to {OUTPUT_JSON}")
