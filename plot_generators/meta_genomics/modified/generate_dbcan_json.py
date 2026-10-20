#!/usr/bin/env python3
import argparse
import json
import logging
import os
import sys
import pandas as pd
import re

VALID_CLASSES = ["GH", "GT", "CE", "AA", "CBM", "PL"]

def extract_bin_id(genome):
    m = re.search(r'[0-9]+$', str(genome))
    return f"Bin{int(m.group(0)):02d}" if m else str(genome)

def parse_overview(filepath, mag_id):
    if not os.path.exists(filepath):
        return []
        
    try:
        df = pd.read_csv(filepath, sep='\t')
        if "#ofTools" not in df.columns:
            return []
            
        df = df[pd.to_numeric(df["#ofTools"], errors='coerce') >= 2].copy()
        
        results = []
        for _, row in df.iterrows():
            ann = None
            for col in ["HMMER", "dbCAN_sub", "DIAMOND"]:
                if col in df.columns and pd.notna(row[col]) and row[col] != "-":
                    ann = str(row[col])
                    break
                    
            if not ann:
                continue
                
            domains = [d.strip() for d in ann.split("+") if d.strip() and d.strip() != "-"]
            for dom in domains:
                dom = re.sub(r'\(\d+-\d+\)', '', dom)
                m = re.match(r'[A-Za-z]+[0-9_]*[A-Za-z0-9]*', dom)
                if not m:
                    continue
                clean_dom = m.group(0)
                
                cazy_class = None
                for vc in VALID_CLASSES:
                    if clean_dom.startswith(vc):
                        cazy_class = vc
                        break
                        
                if cazy_class:
                    results.append({
                        "MAG": mag_id,
                        "family": clean_dom,
                        "cazy_class": cazy_class
                    })
        return results
    except Exception as e:
        logging.warning(f"Failed to parse {filepath}: {e}")
        return []

def main():
    parser = argparse.ArgumentParser(description="dbCAN JSON Generator")
    parser.add_argument("dbcan_sample_dir", help="Path to sample-level dbCAN folder")
    parser.add_argument("output_dir", help="Output directory")
    parser.add_argument("sample_id", help="Sample ID")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    
    log_file = os.path.join(args.output_dir, f"{args.sample_id}_dbcan_json.log")
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[logging.FileHandler(log_file), logging.StreamHandler(sys.stdout)]
    )
    
    logging.info(f"Started dbCAN processing for {args.sample_id}")
    
    if not os.path.isdir(args.dbcan_sample_dir):
        logging.error(f"dbCAN sample dir not found: {args.dbcan_sample_dir}")
        sys.exit(1)

    all_data = []
    
    mags = [d for d in os.listdir(args.dbcan_sample_dir) 
            if os.path.isdir(os.path.join(args.dbcan_sample_dir, d))]
            
    for mag_id in mags:
        ov_file = os.path.join(args.dbcan_sample_dir, mag_id, "overview.txt")
        parsed = parse_overview(ov_file, mag_id)
        all_data.extend(parsed)
        
    df = pd.DataFrame(all_data)
    
    if len(df) == 0:
        logging.warning("No CAZyme hits passed the filter.")
        total_mags = len(mags)
        total_domains = 0
        unique_fams = 0
        plot_data = []
    else:
        df['ShortMAG'] = df['MAG'].apply(extract_bin_id)
        # Handle duplicates in short names
        dup_mask = df.duplicated(subset=['ShortMAG'], keep=False)
        
        agg = df.groupby(['ShortMAG', 'cazy_class']).size().reset_index(name='count')
        plot_data = agg.rename(columns={'ShortMAG': 'mag'}).to_dict(orient='records')
        
        total_mags = df['MAG'].nunique()
        total_domains = len(df)
        unique_fams = df['family'].nunique()
        
    payload = {
        "sample_id": args.sample_id,
        "summary": {
            "mags_analyzed": int(total_mags),
            "total_domains": int(total_domains),
            "unique_families": int(unique_fams)
        },
        "plot_data": plot_data
    }
    
    json_path = os.path.join(args.output_dir, f"{args.sample_id}_dbcan_cazyme_composition.json")
    with open(json_path, 'w') as f:
        json.dump(payload, f, indent=2)
        
    logging.info(f"Saved JSON data to {json_path}")
    logging.info("Completed successfully")

if __name__ == "__main__":
    main()
