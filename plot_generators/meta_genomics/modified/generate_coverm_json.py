#!/usr/bin/env python3
import argparse
import json
import logging
import os
import sys
import pandas as pd
import re

def parse_phylum(classification_str):
    if pd.isna(classification_str) or not classification_str:
        return "Unknown Phylum"
    parts = str(classification_str).split(";")
    for part in parts:
        if part.startswith("p__"):
            phylum = part.replace("p__", "").strip()
            return phylum if phylum else "Unknown Phylum"
    return "Unknown Phylum"

def extract_bin_id(genome):
    m = re.search(r'[0-9]+$', str(genome))
    return f"Bin.{m.group(0)}" if m else str(genome)

def read_gtdb(path):
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        return pd.DataFrame()
    try:
        df = pd.read_csv(path, sep='\t')
        if len(df) == 0:
            return pd.DataFrame()
            
        genome_col = next((c for c in df.columns if re.search(r'user_genome|Name|^Genome', c, re.I)), None)
        class_col = next((c for c in df.columns if 'classification' in c.lower()), None)
        
        if genome_col and class_col:
            df = df[[genome_col, class_col]].rename(columns={genome_col: 'Genome', class_col: 'Classification'})
            df = df[df['Classification'].notna() & (df['Classification'] != "")]
            return df
    except Exception as e:
        logging.warning(f"Failed to read {path}: {e}")
    return pd.DataFrame()

def main():
    parser = argparse.ArgumentParser(description="CoverM JSON Generator")
    parser.add_argument("coverage_tsv", help="CoverM coverage.tsv")
    parser.add_argument("output_dir", help="Output directory")
    parser.add_argument("bac120_tsv", help="GTDB-Tk bac120.summary.tsv")
    parser.add_argument("ar53_tsv", help="GTDB-Tk ar53.summary.tsv")
    parser.add_argument("sample_id", help="Sample ID")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    
    log_file = os.path.join(args.output_dir, f"{args.sample_id}_coverm_json.log")
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[logging.FileHandler(log_file), logging.StreamHandler(sys.stdout)]
    )
    
    logging.info(f"Started CoverM processing for {args.sample_id}")
    
    if not os.path.exists(args.coverage_tsv):
        logging.error(f"Input file not found: {args.coverage_tsv}")
        sys.exit(1)
        
    cov_df = pd.read_csv(args.coverage_tsv, sep='\t')
    ra_col = next((c for c in cov_df.columns if "Relative Abundance" in c), None)
    if not ra_col:
        logging.error("No 'Relative Abundance' column found.")
        sys.exit(1)
        
    cov_df = cov_df.rename(columns={cov_df.columns[0]: 'Genome', ra_col: 'RelAbund'})
    cov_df['RelAbund'] = pd.to_numeric(cov_df['RelAbund'], errors='coerce')
    
    is_unmapped = cov_df['Genome'].astype(str).str.lower() == 'unmapped'
    unmapped_ra = cov_df.loc[is_unmapped, 'RelAbund'].sum() if is_unmapped.any() else 0.0
    
    cov_mags = cov_df[~is_unmapped].copy()
    
    tax_bac = read_gtdb(args.bac120_tsv)
    tax_ar = read_gtdb(args.ar53_tsv)
    
    tax_all = pd.concat([tax_bac, tax_ar]).drop_duplicates(subset=['Genome'])
    
    if len(tax_all) > 0:
        tax_all['Phylum'] = tax_all['Classification'].apply(parse_phylum)
    else:
        tax_all = pd.DataFrame(columns=['Genome', 'Phylum'])
        
    mag_data = cov_mags.merge(tax_all[['Genome', 'Phylum']], on='Genome', how='left')
    mag_data['Phylum'] = mag_data['Phylum'].fillna("Unknown Phylum")
    mag_data = mag_data.sort_values(by='RelAbund', ascending=False)
    
    mag_data['Bin_ID'] = mag_data['Genome'].apply(extract_bin_id)
    mag_data['Label'] = mag_data['Bin_ID'] + " | " + mag_data['Phylum']
    
    # Handle duplicates
    dup_mask = mag_data.duplicated(subset=['Label'], keep=False)
    mag_data.loc[dup_mask, 'Label'] = mag_data.loc[dup_mask, 'Label'] + " (" + mag_data.loc[dup_mask, 'Genome'] + ")"
    
    plot_data = []
    # Add MAGs
    for _, row in mag_data.iterrows():
        plot_data.append({
            "label": row['Label'],
            "rel_abund": float(row['RelAbund']) if pd.notna(row['RelAbund']) else 0.0,
            "phylum": row['Phylum']
        })
        
    # Add Unmapped
    plot_data.append({
        "label": "· Unmapped reads",
        "rel_abund": float(unmapped_ra),
        "phylum": "Unmapped"
    })
    
    payload = {
        "sample_id": args.sample_id,
        "summary": {
            "mags_recovered": len(mag_data),
            "total_mapped": float(mag_data['RelAbund'].sum()),
            "unmapped_ra": float(unmapped_ra)
        },
        "plot_data": plot_data
    }
    
    json_path = os.path.join(args.output_dir, f"{args.sample_id}_coverm_relative_abundance.json")
    with open(json_path, 'w') as f:
        json.dump(payload, f, indent=2)
        
    logging.info(f"Saved JSON data to {json_path}")
    logging.info("Completed successfully")

if __name__ == "__main__":
    main()
