#!/usr/bin/env python3
import argparse
import json
import logging
import os
import sys
import re

def parse_nanostat(filepath):
    parsed = {}
    if not os.path.exists(filepath):
        return parsed
    with open(filepath, 'r') as f:
        for line in f:
            line = line.strip()
            if not line: continue
            parts = re.split(r':\s*|\t+', line)
            if len(parts) >= 2:
                key = parts[0].strip().rstrip(':')
                val = parts[1].strip()
                parsed[key] = val
    return parsed

def get_metric(parsed, patterns):
    for pat in patterns:
        for k, v in parsed.items():
            if re.search(pat, k, re.IGNORECASE):
                v_clean = v.replace(",", "")
                m = re.search(r"[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?", v_clean)
                if m:
                    return float(m.group(0))
    return None

def extract_q(parsed):
    res = {}
    for k, v in parsed.items():
        m = re.search(r"Q[0-9]+", k, re.IGNORECASE)
        if m:
            q_label = m.group(0).upper()
            pct_val = None
            if "%" in v:
                m_pct = re.search(r"[0-9.]+(?=\s*%)", v)
                if m_pct: pct_val = float(m_pct.group(0))
            elif re.search(r"\([0-9.]+\s*%?\)", v):
                m_pct = re.search(r"(?<=\()[0-9.]+(?=\s*%?\))", v)
                if m_pct: pct_val = float(m_pct.group(0))
            else:
                v_clean = v.replace(",", "")
                m_num = re.search(r"[-+]?[0-9]*\.?[0-9]+", v_clean)
                if m_num:
                    num = float(m_num.group(0))
                    pct_val = num * 100 if 0 < num <= 1.0 else num
            if pct_val is not None:
                res[q_label] = pct_val
    return res

def main():
    parser = argparse.ArgumentParser(description="NanoStat JSON Generator")
    parser.add_argument("raw_tsv", help="NanoStat --tsv on raw reads")
    parser.add_argument("cleaned_tsv", help="NanoStat --tsv on cleaned reads")
    parser.add_argument("output_dir", help="Output directory")
    parser.add_argument("sample_id", help="Sample ID")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    
    log_file = os.path.join(args.output_dir, f"{args.sample_id}_nanostat_json.log")
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[logging.FileHandler(log_file), logging.StreamHandler(sys.stdout)]
    )
    
    logging.info(f"Started NanoStat processing for {args.sample_id}")
    
    raw = parse_nanostat(args.raw_tsv)
    cleaned = parse_nanostat(args.cleaned_tsv)
    
    raw_reads = get_metric(raw, [r"^number(\s|_)*of(\s|_)*reads$", r"^reads$"])
    cln_reads = get_metric(cleaned, [r"^number(\s|_)*of(\s|_)*reads$", r"^reads$"])
    
    raw_bases = get_metric(raw, [r"^total(\s|_)*bases$", r"^number(\s|_)*of(\s|_)*bases$"])
    cln_bases = get_metric(cleaned, [r"^total(\s|_)*bases$", r"^number(\s|_)*of(\s|_)*bases$"])
    
    raw_n50 = get_metric(raw, [r"^read(\s|_)*length(\s|_)*n50$", r"^n50$"])
    cln_n50 = get_metric(cleaned, [r"^read(\s|_)*length(\s|_)*n50$", r"^n50$"])
    
    raw_mq = get_metric(raw, [r"^mean(\s|_)*read(\s|_)*quality$", r"^mean(\s|_)*quality$", r"^mean(\s|_)*qual$"])
    cln_mq = get_metric(cleaned, [r"^mean(\s|_)*read(\s|_)*quality$", r"^mean(\s|_)*quality$", r"^mean(\s|_)*qual$"])
    
    raw_q = extract_q(raw)
    cln_q = extract_q(cleaned)
    
    common_q = sorted(list(set(raw_q.keys()) & set(cln_q.keys())), key=lambda x: int(x[1:]))
    
    q_data = []
    for q in common_q:
        q_data.append({
            "q_level": q,
            "raw": raw_q[q],
            "cleaned": cln_q[q]
        })
        
    payload = {
        "sample_id": args.sample_id,
        "yield_metrics": [
            {"metric": "Number of reads", "raw": raw_reads, "cleaned": cln_reads},
            {"metric": "Total bases (Gb)", "raw": raw_bases / 1e9 if raw_bases else None, "cleaned": cln_bases / 1e9 if cln_bases else None},
            {"metric": "N50 (bp)", "raw": raw_n50, "cleaned": cln_n50}
        ],
        "mean_quality": {
            "raw": raw_mq,
            "cleaned": cln_mq
        },
        "q_thresholds": q_data
    }
    
    json_path = os.path.join(args.output_dir, f"{args.sample_id}_nanostat_qc.json")
    with open(json_path, 'w') as f:
        json.dump(payload, f, indent=2)
        
    logging.info(f"Saved JSON data to {json_path}")
    logging.info("Completed successfully")

if __name__ == "__main__":
    main()
