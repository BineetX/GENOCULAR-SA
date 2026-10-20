#!/usr/bin/env python3
import argparse
import json
import logging
import os
import sys
import math

def main():
    parser = argparse.ArgumentParser(description="Read-based Alpha Diversity JSON Generator")
    parser.add_argument("profile_txt", help="Path to MetaPhlAn profile.txt")
    parser.add_argument("output_dir", help="Output directory")
    parser.add_argument("sample_id", help="Sample ID")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    
    log_file = os.path.join(args.output_dir, f"{args.sample_id}_read_based_alpha_json.log")
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[logging.FileHandler(log_file), logging.StreamHandler(sys.stdout)]
    )
    
    logging.info(f"Started Read-based Alpha Diversity processing for {args.sample_id}")
    
    if not os.path.exists(args.profile_txt):
        logging.error(f"Input file not found: {args.profile_txt}")
        sys.exit(1)
        
    records = []
    with open(args.profile_txt) as fh:
        for line in fh:
            if line.startswith("#") or not line.strip():
                continue
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3: continue
            clade = parts[0]
            try:
                abund = float(parts[2])
            except ValueError:
                continue
                
            last_seg = clade.split("|")[-1]
            if last_seg == "UNCLASSIFIED" or clade == "UNCLASSIFIED":
                continue
                
            if last_seg.startswith("g__"):
                records.append(abund)
                
    if not records:
        logging.error("No genus-level (g__) rows found in PROFILE_TXT.")
        sys.exit(1)
        
    total_abund = sum(records)
    scale_detected = 100.0 if abs(total_abund - 100) <= abs(total_abund - 1) else 1.0
    
    p_i_all = [x / scale_detected for x in records]
    p_i = [p for p in p_i_all if p > 0]
    
    shannon = -sum(p * math.log(p) for p in p_i)
    simpson = 1 - sum(p * p for p in p_i)
    observed = len(p_i)
    
    abund_pcts = [x / scale_detected * 100 for x in records if x > 0]
    abund_pcts.sort(reverse=True)
    
    rank_abundance = [{"rank": i + 1, "abundance": pct} for i, pct in enumerate(abund_pcts)]
    
    payload = {
        "sample_id": args.sample_id,
        "metrics": {
            "observed": observed,
            "shannon": shannon,
            "simpson": simpson
        },
        "rank_abundance": rank_abundance
    }
    
    json_path = os.path.join(args.output_dir, f"{args.sample_id}_read_based_alpha_diversity.json")
    with open(json_path, 'w') as f:
        json.dump(payload, f, indent=2)
        
    logging.info(f"Saved JSON data to {json_path}")
    logging.info("Completed successfully")

if __name__ == "__main__":
    main()
