#!/usr/bin/env python3
import argparse
import json
import logging
import os
import sys

def parse_prokka_txt(filepath):
    res = {"CDS": 0, "gene": 0, "tRNA": 0, "rRNA": 0, "tmRNA": 0, "repeat_region": 0}
    try:
        with open(filepath, 'r') as f:
            for line in f:
                parts = line.strip().split(":")
                if len(parts) == 2:
                    k = parts[0].strip()
                    if k in res:
                        try:
                            res[k] = int(parts[1].strip())
                        except ValueError:
                            pass
    except Exception as e:
        logging.warning(f"Failed to read {filepath}: {e}")
    return res

def main():
    parser = argparse.ArgumentParser(description="Prokka JSON Generator")
    parser.add_argument("prokka_sample_dir", help="Directory containing MAG subfolders")
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
    
    if not os.path.isdir(args.prokka_sample_dir):
        logging.error(f"Directory not found: {args.prokka_sample_dir}")
        sys.exit(1)
        
    mag_records = []
    
    for mag_dir in os.listdir(args.prokka_sample_dir):
        full_dir = os.path.join(args.prokka_sample_dir, mag_dir)
        if not os.path.isdir(full_dir): continue
        
        txt_path = os.path.join(full_dir, f"{mag_dir}.txt")
        if not os.path.exists(txt_path):
            cands = [f for f in os.listdir(full_dir) if f.endswith(".txt")]
            if cands:
                txt_path = os.path.join(full_dir, cands[0])
            else:
                continue
                
        parsed = parse_prokka_txt(txt_path)
        parsed["MAG_ID"] = mag_dir
        parsed["other_genes"] = max(parsed["gene"] - parsed["CDS"], 0)
        mag_records.append(parsed)
        
    # Sort ascending by CDS
    mag_records.sort(key=lambda x: x["CDS"])
    pad = 3 if len(mag_records) > 99 else 2
    for i, rec in enumerate(mag_records):
        rec["Bin_Label"] = f"Bin{str(i+1).zfill(pad)}"
        
    payload = {
        "sample_id": args.sample_id,
        "mags": mag_records
    }
    
    json_path = os.path.join(args.output_dir, f"{args.sample_id}_prokka_features.json")
    with open(json_path, 'w') as f:
        json.dump(payload, f, indent=2)
        
    logging.info(f"Saved JSON data to {json_path}")
    logging.info("Completed successfully")

if __name__ == "__main__":
    main()
