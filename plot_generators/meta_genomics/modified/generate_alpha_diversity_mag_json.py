#!/usr/bin/env python3
import argparse
import json
import logging
import os
import sys
import numpy as np
import pandas as pd

def compute_diversity(abundances):
    """Compute Shannon, Simpson, Pielou, and Richness from abundances."""
    total = np.sum(abundances)
    if total <= 0:
        return 0, 0, 0, 0
    
    p = abundances / total
    p = p[p > 0]  # Remove zeros
    
    richness = len(p)
    if richness == 0:
        return 0, 0, 0, 0
        
    shannon = -np.sum(p * np.log(p))
    simpson = 1.0 - np.sum(p ** 2)
    
    if richness > 1:
        pielou = shannon / np.log(richness)
    else:
        pielou = None
        
    return richness, shannon, simpson, pielou

def main():
    parser = argparse.ArgumentParser(description="MAG Alpha Diversity JSON Generator")
    parser.add_argument("coverm_tsv", help="Path to CoverM genome relative abundance TSV")
    parser.add_argument("output_dir", help="Output directory")
    parser.add_argument("sample_id", help="Sample ID")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    
    # Configure logging
    log_file = os.path.join(args.output_dir, f"{args.sample_id}_mag_alpha_diversity.log")
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[logging.FileHandler(log_file), logging.StreamHandler(sys.stdout)]
    )
    
    logging.info(f"Started Alpha Diversity processing for {args.sample_id}")
    
    if not os.path.exists(args.coverm_tsv):
        logging.error(f"Input file not found: {args.coverm_tsv}")
        sys.exit(1)
        
    df = pd.read_csv(args.coverm_tsv, sep='\t')
    if df.shape[1] < 2:
        logging.error("Input table must have at least 2 columns")
        sys.exit(1)
        
    genome_col = df.columns[0]
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    if len(numeric_cols) == 0:
        logging.error("No numeric columns found")
        sys.exit(1)
        
    abund_col = numeric_cols[0]
    
    # Handle Unmapped
    is_unmapped = df[genome_col].astype(str).str.strip().str.lower() == "unmapped"
    total_raw_abund = df[abund_col].sum()
    
    df_retained = df[~is_unmapped].copy()
    retained_abund_sum = df_retained[abund_col].sum()
    
    pct_mapped = float((retained_abund_sum / total_raw_abund * 100)) if total_raw_abund > 0 else None
    
    if len(df_retained) == 0:
        logging.error("Zero MAG rows remain after removing 'Unmapped'")
        sys.exit(1)
        
    # Renormalize
    df_retained['renorm_abund_pct'] = (df_retained[abund_col] / retained_abund_sum) * 100
    
    # Diversity
    richness, shannon, simpson, pielou = compute_diversity(df_retained['renorm_abund_pct'].values)
    
    # Rank abundance data
    df_retained = df_retained.sort_values(by='renorm_abund_pct', ascending=False).reset_index(drop=True)
    df_retained['Rank'] = df_retained.index + 1
    
    # Build JSON payload
    payload = {
        "sample_id": args.sample_id,
        "pct_mapped": pct_mapped,
        "diversity_indices": {
            "richness_S": float(richness),
            "shannon_H": float(shannon),
            "simpson_1D": float(simpson),
            "pielou_J": float(pielou) if pielou is not None else None
        },
        "rank_abundance": df_retained[['Rank', 'renorm_abund_pct']].to_dict(orient='records')
    }
    
    json_path = os.path.join(args.output_dir, f"{args.sample_id}_mag_alpha_diversity.json")
    with open(json_path, 'w') as f:
        json.dump(payload, f, indent=2)
        
    logging.info(f"Saved JSON data to {json_path}")
    logging.info("Completed successfully")

if __name__ == "__main__":
    main()
