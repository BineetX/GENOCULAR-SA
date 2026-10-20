#!/usr/bin/env python3
import argparse
import json
import logging
import math
import os
import sys
import re

UNNAMED = re.compile(r"^(GGB|SGB|CFGB|FGB)\d+")

def parent_phylum(lineage):
    for tok in lineage:
        if tok.startswith("p__"):
            return tok.split("__", 1)[1].replace("_", " ")
    return "Unclassified"

def main():
    parser = argparse.ArgumentParser(description="MetaPhlAn JSON Generator")
    parser.add_argument("profile_txt", help="Path to MetaPhlAn profile.txt")
    parser.add_argument("output_dir", help="Output directory")
    parser.add_argument("sample_id", help="Sample ID")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    
    log_file = os.path.join(args.output_dir, f"{args.sample_id}_metaphlan_json.log")
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[logging.FileHandler(log_file), logging.StreamHandler(sys.stdout)]
    )
    
    logging.info(f"Started MetaPhlAn processing for {args.sample_id}")
    
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
                
            lineage = clade.split("|")
            level = lineage[-1].split("__")[0]
            name = lineage[-1].split("__", 1)[1].replace("_", " ")
            records.append({"level": level, "name": name, "abund": abund, "lineage": lineage})
            
    # Extract species
    species_named = [r for r in records if r["level"] == "s" and not UNNAMED.match(r["name"])]
    species_top20 = sorted(species_named, key=lambda r: -r["abund"])[:20]
    
    top_species = []
    for r in species_top20:
        top_species.append({
            "name": r["name"],
            "abund": r["abund"],
            "phylum": parent_phylum(r["lineage"])
        })

    # Genus-level ecological summaries used by the interactive dashboard.
    genera_named = [r for r in records if r["level"] == "g" and not UNNAMED.match(r["name"]) and r["abund"] > 0]
    genera_ranked = sorted(genera_named, key=lambda r: -r["abund"])
    total_genus_abund = sum(r["abund"] for r in genera_ranked)
    genus_proportions = [r["abund"] / total_genus_abund for r in genera_ranked] if total_genus_abund > 0 else []
    genus_metrics = {
        "observed": len(genera_ranked),
        "shannon": -sum(p * math.log(p) for p in genus_proportions if p > 0),
        "simpson": 1.0 - sum(p * p for p in genus_proportions),
    }
    genus_rank_abundance = [
        {"rank": index, "name": row["name"], "abundance": row["abund"]}
        for index, row in enumerate(genera_ranked, start=1)
    ]
        
    payload = {
        "sample_id": args.sample_id,
        "top_species": top_species,
        "genus_metrics": genus_metrics,
        "genus_rank_abundance": genus_rank_abundance,
    }
    
    json_path = os.path.join(args.output_dir, f"{args.sample_id}_metaphlan_species.json")
    with open(json_path, 'w') as f:
        json.dump(payload, f, indent=2)
        
    logging.info(f"Saved JSON data to {json_path}")
    logging.info("Completed successfully")

if __name__ == "__main__":
    main()
