#!/usr/bin/env python3
import argparse
import json
import logging
import os
import sys
from collections import OrderedDict
import pandas as pd
import warnings

warnings.filterwarnings("ignore")

CATEGORY_KEYWORDS = OrderedDict({
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

def function_status(product: str) -> str:
    p = str(product).strip().lower()
    if p == "" or p in {"unknown", "uncharacterized protein"}:
        return "Unknown function"
    if "hypothetical protein" in p:
        return "Hypothetical protein"
    return "Known function"

def assign_category(product: str) -> str:
    p = str(product).strip().lower()
    if p == "" or p == "unknown" or "hypothetical protein" in p:
        return "Other"
    for category, keywords in CATEGORY_KEYWORDS.items():
        for kw in keywords:
            if kw in p:
                return category
    return "Other"

def main():
    parser = argparse.ArgumentParser(description="Prokka JSON Generator for WGS")
    parser.add_argument("prokka_tsv", help="Path to annotated_genome.tsv")
    parser.add_argument("output_dir", help="Output directory")
    parser.add_argument("sample_id", help="Sample ID")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    
    log_file = os.path.join(args.output_dir, f"{args.sample_id}_prokka_json.log")
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[logging.FileHandler(log_file), logging.StreamHandler(sys.stdout)]
    )
    
    logging.info(f"Started Prokka processing for {args.sample_id}")
    
    if not os.path.exists(args.prokka_tsv):
        logging.error(f"Input file not found: {args.prokka_tsv}")
        sys.exit(1)
        
    df = pd.read_csv(args.prokka_tsv, sep="\t")
    df.columns = [str(c).strip() for c in df.columns]
    
    if "ftype" not in df.columns or "product" not in df.columns:
        logging.error("Required columns ('ftype', 'product') missing from TSV.")
        sys.exit(1)
        
    df["ftype"] = df["ftype"].astype(str).str.strip()
    df["product"] = df["product"].fillna("").astype(str).str.strip()
    
    cds = df[df["ftype"].str.upper() == "CDS"].copy()
    if cds.empty:
        logging.error("No CDS entries found.")
        sys.exit(1)
        
    cds["function_status"] = cds["product"].apply(function_status)
    cds["category"] = cds["product"].apply(assign_category)
    total_cds = int(len(cds))
    
    feature_counts = df["ftype"].astype(str).value_counts()
    
    ordered_categories = list(CATEGORY_KEYWORDS.keys()) + ["Other"]
    status_counts = cds["function_status"].value_counts().reindex(
        ["Known function", "Unknown function", "Hypothetical protein"], fill_value=0
    )
    cat_counts = cds["category"].value_counts().reindex(ordered_categories, fill_value=0)
    
    products = cds["product"].fillna("").astype(str).str.strip()
    filtered = products[
        ~products.str.lower().isin(["", "unknown", "uncharacterized protein", "hypothetical protein"])
    ]
    top_counts = filtered.value_counts().head(15)
    
    payload = {
        "sample_id": args.sample_id,
        "total_cds": total_cds,
        "total_features": int(len(df)),
        "feature_composition": [{"feature": k, "count": v} for k, v in feature_counts.items()],
        "functional_categories": [{"category": k, "count": v} for k, v in cat_counts.items()],
        "annotation_status": [{"status": k, "count": v} for k, v in status_counts.items()],
        "top_products": [{"product": k, "count": v} for k, v in top_counts.items()]
    }
    
    json_path = os.path.join(args.output_dir, f"{args.sample_id}_prokka_summary.json")
    with open(json_path, "w") as f:
        json.dump(payload, f, indent=2)
        
    logging.info(f"Saved JSON data to {json_path}")
    logging.info("Completed successfully")

if __name__ == "__main__":
    main()
