#!/usr/bin/env python3
"""
eggNOG-mapper COG Grouped Functional Category JSON Generator.
Parses annotations.emapper.annotations and exports structured JSON for Next.js / D3.js visualization.
"""

import argparse
import warnings
from pathlib import Path
import json
import pandas as pd
import numpy as np

warnings.filterwarnings("ignore")

def ensure_dir(path):
    Path(path).mkdir(parents=True, exist_ok=True)

def load_emapper_annotations(filepath):
    cols = [
        "query", "seed_ortholog", "evalue", "score", "eggNOG_OGs",
        "max_annot_lvl", "COG_category", "Description", "Preferred_name",
        "GOs", "EC", "KEGG_ko", "KEGG_Pathway", "KEGG_Module",
        "KEGG_Reaction", "KEGG_rclass", "BRITE", "KEGG_TC",
        "CAZy", "BiGG_Reaction", "PFAMs"
    ]
    df = pd.read_csv(filepath, sep="\t", comment="#", names=cols, dtype=str)
    return df.fillna("-")

def build_cog_counts(df):
    cog_letters = []
    for val in df["COG_category"].dropna():
        if val != "-":
            for ch in str(val):
                if ch.isalpha():
                    cog_letters.append(ch)

    if not cog_letters:
        return pd.Series(dtype=int)

    return pd.Series(cog_letters).value_counts()

def generate_cog_json():
    parser = argparse.ArgumentParser(description="Generate COG JSON summary files from eggNOG-mapper annotations.")
    parser.add_argument("-a", "--annotations", default="annotations.emapper.annotations", help="Path to annotations.emapper.annotations")
    parser.add_argument("-o", "--outdir", default=".", help="Output directory")
    args = parser.parse_args()

    ensure_dir(args.outdir)
    outdir_path = Path(args.outdir)
    input_path = Path(args.annotations)

    if not input_path.exists():
        print(f"Error: Could not find annotations file: {input_path}")
        return

    print(f"Reading: {input_path}")
    df = load_emapper_annotations(input_path)
    cog_counts = build_cog_counts(df)

    if cog_counts.empty:
        print("No COG annotations found.")
        return

    COG_META = {
        "J": ("Translation, ribosomal structure & biogenesis", "Information storage & processing", "#1565C0", "#42A5F5"),
        "A": ("RNA processing & modification", "Information storage & processing", "#283593", "#5C6BC0"),
        "K": ("Transcription", "Information storage & processing", "#0277BD", "#29B6F6"),
        "L": ("Replication, recombination & repair", "Information storage & processing", "#00695C", "#26C6DA"),
        "B": ("Chromatin structure & dynamics", "Information storage & processing", "#1A237E", "#7986CB"),

        "D": ("Cell cycle control, cell division", "Cellular processes & signalling", "#B71C1C", "#EF5350"),
        "Y": ("Nuclear structure", "Cellular processes & signalling", "#880E4F", "#EC407A"),
        "V": ("Defense mechanisms", "Cellular processes & signalling", "#C62828", "#FF7043"),
        "T": ("Signal transduction mechanisms", "Cellular processes & signalling", "#E65100", "#FFA726"),
        "M": ("Cell wall / membrane / envelope biogenesis", "Cellular processes & signalling", "#F57F17", "#FFCA28"),
        "N": ("Cell motility", "Cellular processes & signalling", "#FF6F00", "#FFD54F"),
        "Z": ("Cytoskeleton", "Cellular processes & signalling", "#BF360C", "#FF8A65"),
        "W": ("Extracellular structures", "Cellular processes & signalling", "#6A1B9A", "#CE93D8"),
        "U": ("Intracellular trafficking, secretion", "Cellular processes & signalling", "#4A148C", "#AB47BC"),
        "O": ("Post-translational modification, turnover, chaperones", "Cellular processes & signalling", "#AD1457", "#F48FB1"),

        "C": ("Energy production & conversion", "Metabolism", "#1B5E20", "#66BB6A"),
        "G": ("Carbohydrate transport & metabolism", "Metabolism", "#2E7D32", "#A5D6A7"),
        "E": ("Amino acid transport & metabolism", "Metabolism", "#004D40", "#4DB6AC"),
        "F": ("Nucleotide transport & metabolism", "Metabolism", "#006064", "#80DEEA"),
        "H": ("Coenzyme transport & metabolism", "Metabolism", "#01579B", "#81D4FA"),
        "I": ("Lipid transport & metabolism", "Metabolism", "#0D47A1", "#64B5F6"),
        "P": ("Inorganic ion transport & metabolism", "Metabolism", "#1565C0", "#90CAF9"),
        "Q": ("Secondary metabolites biosynthesis, transport & catabolism", "Metabolism", "#00695C", "#B2DFDB"),

        "R": ("General function prediction only", "Poorly characterized", "#795548", "#BCAAA4"),
        "S": ("Function unknown", "Poorly characterized", "#4E342E", "#A1887F"),
    }

    group_order = [
        "Information storage & processing",
        "Cellular processes & signalling",
        "Metabolism",
        "Poorly characterized",
    ]

    present = [l for l in COG_META if l in cog_counts.index]
    if not present:
        print("No standard COG letters found.")
        return

    final_order = []
    for g in group_order:
        in_g = [(l, cog_counts[l]) for l in present if COG_META[l][1] == g]
        in_g.sort(key=lambda x: x[1])
        final_order.extend([x[0] for x in in_g])

    values_f = [int(cog_counts[l]) for l in final_order]
    dark_col = [COG_META[l][2] for l in final_order]
    groups_f = [COG_META[l][1] for l in final_order]
    labels_f = [COG_META[l][0] for l in final_order]
    total_cogs = sum(values_f)
    pct_f = [round((v / total_cogs) * 100, 2) for v in values_f] if total_cogs > 0 else []

    payload = {
        "metadata": {
            "input": input_path.name,
            "total_cog_assignments": int(total_cogs),
            "description": "COG Functional Category Distribution mapped from eggNOG-mapper."
        },
        "data": [{
            "x": values_f,
            "y": labels_f,
            "text": final_order,
            "customdata": groups_f,
            "percentages": pct_f,
            "type": "bar",
            "orientation": "h",
            "marker": {
                "color": dark_col
            }
        }],
        "layout": {
            "title": "COG Functional Category Distribution",
            "xaxis": {"title": "Number of Genes"},
            "yaxis": {"title": "COG Description"}
        }
    }

    out_json = outdir_path / "emapper_cog_distribution.json"
    with open(out_json, "w") as f:
        json.dump(payload, f, indent=4)

    print(f"Total COG assignments: {total_cogs:,}")
    print(f"Successfully generated: {out_json}")

if __name__ == "__main__":
    generate_cog_json()
