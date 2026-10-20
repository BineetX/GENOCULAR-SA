#!/usr/bin/env python3
import argparse
import json
import logging
import os
import sys

def parse_quality(block, state_label, read_label):
    if not block or "quality_curves" not in block or "mean" not in block["quality_curves"]:
        return []
    vals = block["quality_curves"]["mean"]
    return [{"position": i+1, "mean_quality": float(v), "state": state_label, "read": read_label} 
            for i, v in enumerate(vals)]

def parse_content(block, state_label, read_label):
    if not block or "content_curves" not in block:
        return []
    cc = block["content_curves"]
    res = []
    for b in ["A", "T", "C", "G", "N"]:
        if b in cc:
            for i, v in enumerate(cc[b]):
                res.append({"position": i+1, "content": float(v) * 100, "base": b, "state": state_label, "read": read_label})
    return res

def main():
    parser = argparse.ArgumentParser(description="fastp JSON Generator")
    parser.add_argument("fastp_json", help="Path to fastp.json")
    parser.add_argument("output_dir", help="Output directory")
    parser.add_argument("sample_id", help="Sample ID")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    
    log_file = os.path.join(args.output_dir, f"{args.sample_id}_fastp_json.log")
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[logging.FileHandler(log_file), logging.StreamHandler(sys.stdout)]
    )
    
    logging.info(f"Started fastp processing for {args.sample_id}")
    
    if not os.path.exists(args.fastp_json):
        logging.error(f"Input file not found: {args.fastp_json}")
        sys.exit(1)
        
    with open(args.fastp_json, 'r') as f:
        try:
            j = json.load(f)
        except Exception as e:
            logging.error(f"Error parsing json: {e}")
            sys.exit(1)
            
    if "summary" not in j or "before_filtering" not in j["summary"]:
        logging.error("Missing summary block in json")
        sys.exit(1)
        
    sum_b = j["summary"]["before_filtering"]
    sum_a = j["summary"]["after_filtering"]
    
    tot_reads_b = sum_b.get("total_reads", 0)
    tot_reads_a = sum_a.get("total_reads", 0)
    
    def get_rate(block, key):
        val = block.get(key, 0)
        return val * 100 if val <= 1.0 else val
        
    q20_b = get_rate(sum_b, "q20_rate")
    q20_a = get_rate(sum_a, "q20_rate")
    q30_b = get_rate(sum_b, "q30_rate")
    q30_a = get_rate(sum_a, "q30_rate")
    
    qc_data = []
    cc_data = []
    
    is_paired = "read2_before_filtering" in j
    
    r1_raw = j.get("read1_before_filtering")
    r1_clean = j.get("read1_after_filtering")
    qc_data.extend(parse_quality(r1_raw, "Raw", "R1"))
    qc_data.extend(parse_quality(r1_clean, "Cleaned", "R1"))
    cc_data.extend(parse_content(r1_raw, "Raw", "R1"))
    cc_data.extend(parse_content(r1_clean, "Cleaned", "R1"))
    
    if is_paired:
        r2_raw = j.get("read2_before_filtering")
        r2_clean = j.get("read2_after_filtering")
        qc_data.extend(parse_quality(r2_raw, "Raw", "R2"))
        qc_data.extend(parse_quality(r2_clean, "Cleaned", "R2"))
        cc_data.extend(parse_content(r2_raw, "Raw", "R2"))
        cc_data.extend(parse_content(r2_clean, "Cleaned", "R2"))
        
    payload = {
        "sample_id": args.sample_id,
        "is_paired": is_paired,
        "summary": {
            "tot_reads_before": tot_reads_b,
            "tot_reads_clean": tot_reads_a,
            "q20_raw": q20_b,
            "q20_clean": q20_a,
            "q30_raw": q30_b,
            "q30_clean": q30_a
        },
        "quality_curves": qc_data,
        "content_curves": cc_data
    }
    
    json_path = os.path.join(args.output_dir, f"{args.sample_id}_fastp_qc.json")
    with open(json_path, 'w') as f:
        json.dump(payload, f, indent=2)
        
    logging.info(f"Saved JSON data to {json_path}")
    logging.info("Completed successfully")

if __name__ == "__main__":
    main()
