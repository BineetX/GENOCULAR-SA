#!/usr/bin/env python3
"""
Prokka Annotation JSON Generator.
Parses Prokka TSV output and optional FAA files, computing feature counts, 
functional categories, annotation status, and top products for Next.js visualization.

Usage:
    python3 WGS_SR_Prokka_jsonfile.py -i annotated_genome.tsv -o .
"""

import argparse
import json
from pathlib import Path
from collections import OrderedDict
import numpy as np
import pandas as pd
import warnings

warnings.filterwarnings("ignore")

def parse_args():
    parser = argparse.ArgumentParser(description="Generate Prokka JSON summary files for Next.js frontend.")
    parser.add_argument("-i", "--input", default="annotated_genome.tsv", help="Path to Prokka TSV file")
    parser.add_argument("-o", "--outdir", default=".", help="Output directory for JSON files")
    parser.add_argument("--faa", default=None, help="Optional path to annotated_genome.faa")
    return parser.parse_args()

def clean_columns(df):
    df.columns = [str(c).strip() for c in df.columns]
    return df

def function_status(product: str) -> str:
    p = str(product).strip().lower()
    if p == "" or p in {"unknown", "uncharacterized protein"}:
        return "Unknown function"
    if "hypothetical protein" in p:
        return "Hypothetical protein"
    return "Known function"

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

def assign_category(product: str) -> str:
    p = str(product).strip().lower()
    if p == "" or p == "unknown" or "hypothetical protein" in p:
        return "Other"
    for category, keywords in category_keywords.items():
        for kw in keywords:
            if kw in p:
                return category
    return "Other"

def generate_prokka_json():
    args = parse_args()
    tsv_file = Path(args.input)
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    if not tsv_file.exists():
        print(f"Error: Input file not found: {tsv_file}")
        return

    print(f"Reading TSV: {tsv_file}")
    df = pd.read_csv(tsv_file, sep="\t")
    df = clean_columns(df)

    if "ftype" not in df.columns or "product" not in df.columns:
        print("Error: Required columns ('ftype', 'product') missing from TSV.")
        return

    df["ftype"] = df["ftype"].astype(str).str.strip()
    df["product"] = df["product"].fillna("").astype(str).str.strip()

    cds = df[df["ftype"].str.upper() == "CDS"].copy()
    if cds.empty:
        print("Error: No CDS entries found.")
        return

    cds["function_status"] = cds["product"].apply(function_status)
    cds["category"] = cds["product"].apply(assign_category)
    total_cds = int(len(cds))

    # ==========================================
    # 1. Feature Composition JSON
    # ==========================================
    feature_counts = df["ftype"].astype(str).value_counts()
    payload_features = {
        "metadata": {
            "input": tsv_file.name,
            "total_annotated_features": int(len(df)),
            "description": "Genome feature composition from Prokka annotation."
        },
        "data": [{
            "x": feature_counts.index.tolist(),
            "y": feature_counts.values.tolist(),
            "type": "bar",
            "marker": {"color": "#0ea5e9"}
        }],
        "layout": {
            "title": "Genome Feature Composition",
            "xaxis": {"title": "Feature type"},
            "yaxis": {"title": "Feature count"}
        }
    }
    with open(outdir / "prokka_feature_composition.json", "w") as f:
        json.dump(payload_features, f, indent=4)
    print("Generated: prokka_feature_composition.json")

    # ==========================================
    # 2. Functional Summary & Status JSON (Composite)
    # ==========================================
    ordered_categories = list(category_keywords.keys()) + ["Other"]
    status_counts = cds["function_status"].value_counts().reindex(
        ["Known function", "Unknown function", "Hypothetical protein"], fill_value=0
    )
    cat_counts = cds["category"].value_counts().reindex(ordered_categories, fill_value=0)

    cat_percent = (cat_counts / total_cds * 100).round(2)
    status_percent = (status_counts / total_cds * 100).round(2)

    payload_functional = {
        "metadata": {
            "input": tsv_file.name,
            "total_cds": total_cds,
            "description": "Functional summary and annotation status overview."
        },
        "bar_chart": {
            "data": [{
                "x": cat_percent.index.tolist(),
                "y": cat_percent.values.tolist(),
                "type": "bar",
                "marker": {"color": "#059669"}
            }],
            "layout": {
                "title": "Functional overview of Prokka-annotated coding sequences",
                "xaxis": {"title": "Functional Category"},
                "yaxis": {"title": "Annotated CDS (%)"}
            }
        },
        "pie_chart": {
            "data": [{
                "labels": status_percent.index.tolist(),
                "values": status_percent.values.tolist(),
                "type": "pie",
                "hole": 0.6
            }],
            "layout": {
                "title": "Annotation status"
            }
        }
    }
    with open(outdir / "prokka_functional_summary.json", "w") as f:
        json.dump(payload_functional, f, indent=4)
    print("Generated: prokka_functional_summary.json")

    # ==========================================
    # 3. Top Product Annotations JSON
    # ==========================================
    products = cds["product"].fillna("").astype(str).str.strip()
    filtered = products[
        ~products.str.lower().isin(["", "unknown", "uncharacterized protein", "hypothetical protein"])
    ]
    top_counts = filtered.value_counts().head(15).sort_values(ascending=True)

    payload_products = {
        "metadata": {
            "input": tsv_file.name,
            "description": "Top non-hypothetical product annotations."
        },
        "data": [{
            "y": top_counts.index.tolist(),
            "x": top_counts.values.tolist(),
            "orientation": "h",
            "type": "bar",
            "marker": {"color": "#3b82f6"}
        }],
        "layout": {
            "title": "Top Annotated Products",
            "xaxis": {"title": "Count"},
            "yaxis": {"title": "Product annotation"}
        }
    }
    with open(outdir / "prokka_top_product_annotations.json", "w") as f:
        json.dump(payload_products, f, indent=4)
    print("Generated: prokka_top_product_annotations.json")
    print("\nAll Prokka JSON files generated successfully.")

if __name__ == "__main__":
    generate_prokka_json()
