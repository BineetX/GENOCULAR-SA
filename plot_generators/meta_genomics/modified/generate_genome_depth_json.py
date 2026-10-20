#!/usr/bin/env python3
import argparse
import json
import logging
import os
import sys
import subprocess
import pandas as pd
import numpy as np

def run_flagstat(bam_path, output_dir, sample_id):
    fs_path = os.path.join(output_dir, f"{sample_id}.flagstat")
    if os.path.exists(fs_path):
        return fs_path
    
    try:
        with open(fs_path, 'w') as f:
            subprocess.run(["samtools", "flagstat", bam_path], stdout=f, check=True)
        return fs_path
    except Exception as e:
        logging.warning(f"Failed to run samtools flagstat: {e}")
        return None

def parse_flagstat(fs_path):
    if not fs_path or not os.path.exists(fs_path):
        return {}
        
    res = {}
    with open(fs_path, 'r') as f:
        for line in f:
            if "in total" in line:
                res["Total Reads"] = int(line.split()[0])
            elif "mapped (" in line:
                res["Mapped Reads"] = int(line.split()[0])
            elif "properly paired" in line:
                res["Properly Paired"] = int(line.split()[0])
            elif "singletons" in line:
                res["Singletons"] = int(line.split()[0])
                
    res["Unmapped Reads"] = res.get("Total Reads", 0) - res.get("Mapped Reads", 0)
    return res

def get_tier(depth):
    if depth < 5:
        return "Low (<5x)"
    elif depth < 20:
        return "Medium (5-20x)"
    else:
        return "High (>20x)"

def main():
    parser = argparse.ArgumentParser(description="Genome Depth JSON Generator")
    parser.add_argument("bam_path", help="Path to sorted BAM")
    parser.add_argument("output_dir", help="Output directory")
    parser.add_argument("sample_id", help="Sample ID")
    parser.add_argument("depth_file", nargs="?", help="Path to depth.txt")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    
    log_file = os.path.join(args.output_dir, f"{args.sample_id}_genome_depth_json.log")
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[logging.FileHandler(log_file), logging.StreamHandler(sys.stdout)]
    )
    
    logging.info(f"Started Genome Depth processing for {args.sample_id}")
    
    # 1. Flagstat
    fs_path = run_flagstat(args.bam_path, args.output_dir, args.sample_id)
    flagstat_data = parse_flagstat(fs_path)
    
    # 2. Depth File
    depth_file = args.depth_file
    if not depth_file:
        depth_file = os.path.join(os.path.dirname(args.bam_path), f"{args.sample_id}_depth.txt")
        
    contig_data = []
    tier_counts = {"Low (<5x)": 0, "Medium (5-20x)": 0, "High (>20x)": 0}
    high_var = 0
    total_valid = 0
    
    if os.path.exists(depth_file):
        df = pd.read_csv(depth_file, sep='\t')
        if len(df.columns) >= 3:
            df.rename(columns={df.columns[0]: 'contigName', df.columns[1]: 'contigLen', df.columns[2]: 'avgDepth'}, inplace=True)
            df['contigLen'] = pd.to_numeric(df['contigLen'], errors='coerce')
            df['avgDepth'] = pd.to_numeric(df['avgDepth'], errors='coerce')
            if len(df.columns) >= 5:
                df['depthVar'] = pd.to_numeric(df.iloc[:, 4], errors='coerce')
            else:
                df['depthVar'] = np.nan
                
            df = df.dropna(subset=['avgDepth', 'contigLen'])
            df = df[(df['avgDepth'] >= 0) & (df['contigLen'] > 0)]
            
            if len(df) > 0:
                df['Tier'] = df['avgDepth'].apply(get_tier)
                tier_counts = df['Tier'].value_counts().to_dict()
                
                # High variance check
                high_var = len(df[df['depthVar'] > 3 * df['avgDepth']])
                total_valid = len(df)
                
                # Cap for plotting
                depth_cap = df['avgDepth'].quantile(0.999)
                len_cap = df['contigLen'].quantile(0.999)
                df['avgDepth'] = df['avgDepth'].clip(upper=depth_cap)
                df['contigLen'] = df['contigLen'].clip(upper=len_cap)
                
                # Subsample if too large to avoid huge JSON (e.g. max 100k points for frontend)
                if len(df) > 100000:
                    df = df.sample(n=100000, random_state=42)
                    
                contig_data = df[['contigLen', 'avgDepth', 'Tier']].rename(columns={'contigLen': 'length', 'avgDepth': 'depth', 'Tier': 'tier'}).to_dict(orient='records')

    payload = {
        "sample_id": args.sample_id,
        "flagstat": flagstat_data,
        "depth_summary": {
            "total_contigs": total_valid,
            "tiers": tier_counts,
            "high_variance_contigs": high_var
        },
        "plot_data": contig_data
    }
    
    json_path = os.path.join(args.output_dir, f"{args.sample_id}_mapping_depth_profile.json")
    with open(json_path, 'w') as f:
        json.dump(payload, f, indent=2)
        
    logging.info(f"Saved JSON data to {json_path}")
    logging.info("Completed successfully")

if __name__ == "__main__":
    main()
