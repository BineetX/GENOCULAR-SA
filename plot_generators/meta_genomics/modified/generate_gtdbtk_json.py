#!/usr/bin/env python3
import argparse
import json
import logging
import os
import sys
import pandas as pd

RANK_PREFIXES = ["d__", "p__", "c__", "o__", "f__", "g__", "s__"]
RANK_NAMES = ["Domain", "Phylum", "Class", "Order", "Family", "Genus", "Species"]

def parse_classification(cls_str):
    ranks = {r: "Unknown" for r in RANK_NAMES}
    if pd.isna(cls_str) or not cls_str:
        return ranks
        
    parts = cls_str.split(';')
    for part in parts:
        part = part.strip()
        for i, prefix in enumerate(RANK_PREFIXES):
            if part.startswith(prefix):
                val = part[len(prefix):]
                if val:
                    ranks[RANK_NAMES[i]] = val
                break
    return ranks

def read_gtdbtk(path):
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        return pd.DataFrame()
    try:
        df = pd.read_csv(path, sep='\t')
        if len(df) == 0:
            return pd.DataFrame()
        if "classification" not in df.columns or "user_genome" not in df.columns:
            return pd.DataFrame()
        return df
    except Exception as e:
        logging.warning(f"Failed to read {path}: {e}")
        return pd.DataFrame()

def main():
    parser = argparse.ArgumentParser(description="GTDB-Tk JSON Generator")
    parser.add_argument("bac120_tsv", help="GTDB-Tk bac120.summary.tsv")
    parser.add_argument("ar53_tsv", help="GTDB-Tk ar53.summary.tsv")
    parser.add_argument("output_dir", help="Output directory")
    parser.add_argument("sample_id", help="Sample ID")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    
    log_file = os.path.join(args.output_dir, f"{args.sample_id}_gtdbtk_json.log")
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[logging.FileHandler(log_file), logging.StreamHandler(sys.stdout)]
    )
    
    logging.info(f"Started GTDB-Tk processing for {args.sample_id}")
    
    bac_df = read_gtdbtk(args.bac120_tsv)
    ar_df = read_gtdbtk(args.ar53_tsv)
    
    combined = pd.concat([bac_df, ar_df], ignore_index=True)
    
    parsed_rows = []
    for _, row in combined.iterrows():
        ranks = parse_classification(row.get('classification', ''))
        ranks['user_genome'] = row['user_genome']
        parsed_rows.append(ranks)
        
    if not parsed_rows:
        logging.warning("No GTDB-Tk classifications found.")
        payload = {
            "sample_id": args.sample_id,
            "summary": {"total_mags": 0, "bacteria": 0, "archaea": 0},
            "taxonomy_data": []
        }
    else:
        df_parsed = pd.DataFrame(parsed_rows)
        # Aggregate by taxonomy path
        group_cols = RANK_NAMES
        agg_df = df_parsed.groupby(group_cols).size().reset_index(name='count')
        
        bac_count = len(df_parsed[df_parsed['Domain'] == 'Bacteria'])
        ar_count = len(df_parsed[df_parsed['Domain'] == 'Archaea'])
        
        payload = {
            "sample_id": args.sample_id,
            "summary": {
                "total_mags": len(df_parsed),
                "bacteria": bac_count,
                "archaea": ar_count
            },
            "taxonomy_data": agg_df.to_dict(orient='records')
        }
        
    json_path = os.path.join(args.output_dir, f"{args.sample_id}_gtdbtk_taxonomy.json")
    with open(json_path, 'w') as f:
        json.dump(payload, f, indent=2)
        
    logging.info(f"Saved JSON data to {json_path}")
    logging.info("Completed successfully")

if __name__ == "__main__":
    main()
