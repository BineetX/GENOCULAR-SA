#!/usr/bin/env python3
import argparse
import json
import logging
import os
import sys
import gzip
import re
import pandas as pd
import numpy as np

def parse_quast(quast_report):
    res = {}
    if not os.path.exists(quast_report):
        return res
    try:
        df = pd.read_csv(quast_report, sep='\t', index_col=0)
        for m, v in df.iloc[:, 0].items():
            if pd.isna(v): continue
            m_lower = str(m).strip().lower()
            try:
                val = float(v)
            except ValueError:
                continue
                
            if m_lower == "n50": res['N50'] = val
            elif m_lower == "n90": res['N90'] = val
            elif m_lower == "l50": res['L50'] = val
            elif m_lower == "l90": res['L90'] = val
            elif "largest contig" in m_lower: res['Largest contig'] = val
            elif m_lower == "total length": res['Total length'] = val
            elif "gc" in m_lower: res['GC'] = val
            elif m_lower == "# contigs": res['# contigs'] = val
    except Exception as e:
        logging.warning(f"Error parsing quast report: {e}")
    return res

def get_fasta_lengths(fasta_path):
    lengths = []
    try:
        open_func = gzip.open if fasta_path.lower().endswith(".gz") else open
        with open_func(fasta_path, 'rt') as f:
            curr_len = 0
            for line in f:
                line = line.strip()
                if line.startswith(">"):
                    if curr_len > 0:
                        lengths.append(curr_len)
                        curr_len = 0
                else:
                    curr_len += len(line)
            if curr_len > 0:
                lengths.append(curr_len)
    except Exception as e:
        logging.warning(f"Error parsing fasta: {e}")
    return lengths

def main():
    parser = argparse.ArgumentParser(description="metaQUAST JSON Generator")
    parser.add_argument("fasta_file", help="Path to assembly FASTA")
    parser.add_argument("quast_report", help="Path to QUAST report.tsv")
    parser.add_argument("output_dir", help="Output directory")
    parser.add_argument("sample_id", help="Sample ID")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    
    log_file = os.path.join(args.output_dir, f"{args.sample_id}_metaquast_json.log")
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[logging.FileHandler(log_file), logging.StreamHandler(sys.stdout)]
    )
    
    logging.info(f"Started metaQUAST processing for {args.sample_id}")
    
    quast_stats = parse_quast(args.quast_report)
    n_contigs = int(quast_stats.get("# contigs", 0))
    l50 = int(quast_stats.get("L50", 0))
    l90 = int(quast_stats.get("L90", 0))
    
    lengths = get_fasta_lengths(args.fasta_file)
    lengths_sorted = sorted(lengths, reverse=True)
    
    if n_contigs > 0 and n_contigs <= len(lengths_sorted):
        lengths_sorted = lengths_sorted[:n_contigs]
        
    n_total = len(lengths_sorted)
    if n_total == 0:
        logging.error("No valid lengths found.")
        sys.exit(1)
        
    cumsum_bp = np.cumsum(lengths_sorted)
    
    # Subsampling logic to match R script
    keep_every = max(1, n_total // 3000)
    idx_core = list(range(0, n_total, keep_every))
    
    idx_l50 = list(range(max(0, l50 - 50), min(n_total, l50 + 50))) if l50 > 0 else []
    idx_l90 = list(range(max(0, l90 - 50), min(n_total, l90 + 50))) if l90 > 0 else []
    
    idx_head = list(range(0, min(500, n_total)))
    idx_tail = list(range(max(0, n_total - 500), n_total))
    
    keep_idx = sorted(list(set(idx_core + idx_l50 + idx_l90 + idx_head + idx_tail)))
    
    b2 = l50 if l50 > 0 else n_total * 0.12
    b3 = l90 if l90 > 0 else n_total * 0.57
    
    plot_data = []
    for i in keep_idx:
        rank = i + 1
        zone = "Core (rank 1 to L50)" if rank <= b2 else ("Mid (L50 to L90)" if rank <= b3 else "Tail (L90 to end)")
        plot_data.append({
            "rank": rank,
            "length_bp": int(lengths_sorted[i]),
            "cumsum_mbp": float(cumsum_bp[i] / 1e6),
            "zone": zone
        })
        
    payload = {
        "sample_id": args.sample_id,
        "stats": quast_stats,
        "curve": plot_data
    }
    
    json_path = os.path.join(args.output_dir, f"{args.sample_id}_metaquast_curve.json")
    with open(json_path, 'w') as f:
        json.dump(payload, f, indent=2)
        
    logging.info(f"Saved JSON data to {json_path}")
    logging.info("Completed successfully")

if __name__ == "__main__":
    main()
