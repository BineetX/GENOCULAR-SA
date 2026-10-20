#!/usr/bin/env python3
import argparse
import json
import logging
import os
import sys

def main():
    parser = argparse.ArgumentParser(description="VirSorter2 JSON Generator")
    parser.add_argument("final_viral_score_tsv", help="Path to final-viral-score.tsv")
    parser.add_argument("output_dir", help="Output directory")
    parser.add_argument("final_viral_boundary_tsv", help="Path to final-viral-boundary.tsv")
    parser.add_argument("sample_id", help="Sample ID")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    
    log_file = os.path.join(args.output_dir, f"{args.sample_id}_virsorter2_json.log")
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[logging.FileHandler(log_file), logging.StreamHandler(sys.stdout)]
    )
    
    logging.info(f"Started VirSorter2 processing for {args.sample_id}")
    
    if not os.path.exists(args.final_viral_score_tsv):
        logging.error(f"Input file not found: {args.final_viral_score_tsv}")
        sys.exit(1)
        
    known_groups = {"dsDNAphage", "ssDNA", "RNA", "NCLDV", "lavidaviridae"}
    
    records = []
    high_conf = 0
    mixed_conf = 0
    gap_band = 0
    
    with open(args.final_viral_score_tsv, 'r') as f:
        header = f.readline().strip().split('\t')
        try:
            score_idx = header.index("max_score")
            group_idx = header.index("max_score_group")
        except ValueError:
            logging.error("Missing required columns in tsv")
            sys.exit(1)
            
        for line in f:
            parts = line.strip('\n').split('\t')
            if len(parts) <= max(score_idx, group_idx):
                continue
                
            try:
                score = float(parts[score_idx])
                import math
                if math.isnan(score):
                    continue
            except ValueError:
                continue
                
            group = parts[group_idx].strip()
            if group not in known_groups:
                group = "Unclassified"
                
            records.append({
                "score": score,
                "group": group
            })
            
            if score >= 0.9:
                high_conf += 1
            elif score >= 0.5 and score <= 0.8:
                mixed_conf += 1
            elif score > 0.8 and score < 0.9:
                gap_band += 1
                
    payload = {
        "sample_id": args.sample_id,
        "counts": {
            "total": len(records),
            "high_conf": high_conf,
            "mixed_conf": mixed_conf,
            "gap_band": gap_band
        },
        "records": records
    }
    
    json_path = os.path.join(args.output_dir, f"{args.sample_id}_virsorter2_scores.json")
    with open(json_path, 'w') as f:
        json.dump(payload, f, indent=2)
        
    logging.info(f"Saved JSON data to {json_path}")
    logging.info("Completed successfully")

if __name__ == "__main__":
    main()
