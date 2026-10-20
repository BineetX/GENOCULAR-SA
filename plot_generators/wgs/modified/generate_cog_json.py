#!/usr/bin/env python3
import argparse
import json
import logging
import os
import sys
import re
from pathlib import Path
from collections import Counter
import pandas as pd
import warnings

warnings.filterwarnings("ignore")

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

EC_MAPPING = {
    "1": "Oxidoreductases",
    "2": "Transferases",
    "3": "Hydrolases",
    "4": "Lyases",
    "5": "Isomerases",
    "6": "Ligases",
    "7": "Translocases"
}

def split_multi(val):
    if pd.isna(val):
        return []
    val = str(val).strip()
    if val == "-" or val == "":
        return []
    return [x.strip() for x in re.split(r"[;,|]", val) if x.strip()]

def detect_column(columns, candidates):
    lower_map = {c.lower(): c for c in columns}
    for cand in candidates:
        if cand.lower() in lower_map:
            return lower_map[cand.lower()]
    for c in columns:
        for cand in candidates:
            if cand.lower() in c.lower():
                return c
    return None

def read_annotations_file(path):
    lines = []
    with open(path) as fh:
        for line in fh:
            if line.startswith("##"):
                continue
            lines.append(line)
    
    if not lines:
        return pd.DataFrame()

    content = "".join(lines)
    if content.startswith("#"):
        content = content[1:]

    from io import StringIO
    df = pd.read_csv(StringIO(content), sep="\t", dtype=str)
    df.columns = [c.strip() for c in df.columns]
    return df.fillna("-")

def main():
    parser = argparse.ArgumentParser(description="eggNOG-mapper COG/EC/PFAM JSON Generator")
    parser.add_argument("emapper_annotations", help="Path to annotations.emapper.annotations")
    parser.add_argument("output_dir", help="Output directory")
    parser.add_argument("sample_id", help="Sample ID")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    
    log_file = os.path.join(args.output_dir, f"{args.sample_id}_cog_json.log")
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[logging.FileHandler(log_file), logging.StreamHandler(sys.stdout)]
    )
    
    logging.info(f"Started eggNOG-mapper processing for {args.sample_id}")
    
    if not os.path.exists(args.emapper_annotations):
        logging.error(f"Input file not found: {args.emapper_annotations}")
        sys.exit(1)
        
    df = read_annotations_file(args.emapper_annotations)
    if df.empty:
        logging.error("Empty annotations file.")
        sys.exit(1)
        
    # 1. COG Categories
    cog_col = detect_column(df.columns, ["COG_category", "COG"])
    cog_results = []
    if cog_col:
        cog_letters = []
        for val in df[cog_col]:
            if val != "-":
                for ch in str(val):
                    if ch.isalpha():
                        cog_letters.append(ch)
        cog_counts = Counter(cog_letters)
        
        group_order = [
            "Information storage & processing",
            "Cellular processes & signalling",
            "Metabolism",
            "Poorly characterized",
        ]
        
        for g in group_order:
            for letter, meta in COG_META.items():
                if meta[1] == g and cog_counts[letter] > 0:
                    cog_results.append({
                        "letter": letter,
                        "description": meta[0],
                        "class": meta[1],
                        "count": cog_counts[letter]
                    })
                    
    # 2. EC Enzymes
    ec_col = detect_column(df.columns, ["EC"])
    ec_results = []
    if ec_col:
        classes = []
        for val in df[ec_col]:
            for ec in split_multi(val):
                m = re.match(r"(\d)\.", ec)
                if m:
                    classes.append(m.group(1))
        
        ec_counts = Counter([EC_MAPPING[x] for x in classes if x in EC_MAPPING])
        ec_results = [{"enzyme_class": k, "count": v} for k, v in ec_counts.most_common()]
        
    # 3. PFAM Domains
    pfam_col = detect_column(df.columns, ["PFAMs", "PFAM"])
    pfam_results = []
    if pfam_col:
        domains = []
        for val in df[pfam_col]:
            domains += split_multi(val)
        pfam_counts = Counter(domains).most_common(20)
        pfam_results = [{"domain": k, "count": v} for k, v in pfam_counts]
        
    payload = {
        "sample_id": args.sample_id,
        "cog_categories": cog_results,
        "ec_enzymes": ec_results,
        "top_pfam_domains": pfam_results
    }
    
    json_path = os.path.join(args.output_dir, f"{args.sample_id}_emapper_summary.json")
    with open(json_path, "w") as f:
        json.dump(payload, f, indent=2)
        
    logging.info(f"Saved JSON data to {json_path}")
    logging.info("Completed successfully")

if __name__ == "__main__":
    main()
