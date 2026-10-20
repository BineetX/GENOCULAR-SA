#!/usr/bin/env python3
import argparse
import json
import logging
import os
import sys
import pandas as pd

def determine_zone(row):
    comp = row['Completeness']
    cont = row['Contamination']
    if comp >= 90 and cont < 5:
        return "High quality"
    elif comp >= 50 and cont < 10:
        return "Medium quality"
    else:
        return "Low quality/discard"

def main():
    parser = argparse.ArgumentParser(description="CheckM2 Quality Scatter JSON Generator")
    parser.add_argument("quality_report_tsv", help="Path to CheckM2 quality_report.tsv")
    parser.add_argument("output_dir", help="Output directory")
    parser.add_argument("sample_id", help="Sample ID")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    
    log_file = os.path.join(args.output_dir, f"{args.sample_id}_checkm2_json.log")
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[logging.FileHandler(log_file), logging.StreamHandler(sys.stdout)]
    )
    
    logging.info(f"Started CheckM2 processing for {args.sample_id}")
    
    if not os.path.exists(args.quality_report_tsv):
        logging.error(f"Input file not found: {args.quality_report_tsv}")
        sys.exit(1)
        
    df = pd.read_csv(args.quality_report_tsv, sep='\t')
    
    required_cols = ["Name", "Completeness", "Contamination"]
    missing = [c for c in required_cols if c not in df.columns]
    if missing:
        logging.error(f"Missing required columns: {', '.join(missing)}")
        sys.exit(1)
        
    df_clean = df.dropna(subset=["Completeness", "Contamination"]).copy()
    
    if len(df_clean) == 0:
        logging.error("Zero valid rows remain after NA filtering.")
        sys.exit(1)
        
    df_clean['Zone'] = df_clean.apply(determine_zone, axis=1)
    
    zone_counts = df_clean['Zone'].value_counts().to_dict()
    n_high = zone_counts.get("High quality", 0)
    n_med = zone_counts.get("Medium quality", 0)
    n_low = zone_counts.get("Low quality/discard", 0)
    
    payload = {
        "sample_id": args.sample_id,
        "summary": {
            "mags_assessed": len(df_clean),
            "zone_counts": {
                "High quality": int(n_high),
                "Medium quality": int(n_med),
                "Low quality/discard": int(n_low)
            }
        },
        "plot_data": df_clean[["Name", "Completeness", "Contamination", "Zone"]].to_dict(orient='records')
    }
    
    json_path = os.path.join(args.output_dir, f"{args.sample_id}_checkm2_quality.json")
    with open(json_path, 'w') as f:
        json.dump(payload, f, indent=2)
        
    logging.info(f"Saved JSON data to {json_path}")
    logging.info("Completed successfully")

if __name__ == "__main__":
    main()
