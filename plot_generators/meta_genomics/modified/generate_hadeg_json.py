#!/usr/bin/env python3
import argparse
import json
import logging
import os
import sys
import pandas as pd
import numpy as np

PATHWAY_COLORS = {
    "Alkane degradation": "#D62828",
    "Alkene degradation": "#7B2FBE",
    "Aromatic degradation": "#E76F00",
    "Plastic degradation": "#E9C46A",
    "Biosurfactant production": "#4CC9F0",
    "Other": "#AAAAAA"
}

def compound_to_group(comp):
    if pd.isna(comp): return "Other"
    comp = str(comp).lower()
    if "alkan" in comp: return "Alkane degradation"
    if "alken" in comp: return "Alkene degradation"
    if "aromat" in comp: return "Aromatic degradation"
    if "plastic" in comp: return "Plastic degradation"
    if "biosur" in comp or "surfact" in comp: return "Biosurfactant production"
    return "Other"

def locate_pathways_csv(results_dir):
    candidates = [
        os.path.join(results_dir, "R_scripts"),
        os.path.join(os.path.dirname(results_dir), "HADEG", "Tables"),
        os.path.join(os.path.dirname(results_dir), "HADEG", "Scripts"),
        os.path.join(os.path.dirname(os.path.dirname(results_dir)), "HADEG", "Tables"),
        os.path.join(os.path.dirname(os.path.dirname(results_dir)), "HADEG", "Scripts"),
        results_dir
    ]
    for d in candidates:
        cand = os.path.join(d, "7_All_pathways.csv")
        if os.path.exists(cand):
            return cand
    for root, dirs, files in os.walk(results_dir):
        if "7_All_pathways.csv" in files:
            return os.path.join(root, "7_All_pathways.csv")
    return None

def main():
    parser = argparse.ArgumentParser(description="HADEG JSON Generator")
    parser.add_argument("results_dir", help="Results dir containing hadeg/<sample>")
    parser.add_argument("output_dir", help="Output directory")
    parser.add_argument("sample_id", help="Sample ID")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    
    log_file = os.path.join(args.output_dir, f"{args.sample_id}_hadeg_json.log")
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[logging.FileHandler(log_file), logging.StreamHandler(sys.stdout)]
    )
    
    logging.info(f"Started HADEG processing for {args.sample_id}")
    
    sample_dir = os.path.join(args.results_dir, "hadeg", args.sample_id)
    if not os.path.exists(sample_dir):
        # Fallback to finding single dir
        hadeg_base = os.path.join(args.results_dir, "hadeg")
        if os.path.exists(hadeg_base):
            subdirs = [d for d in os.listdir(hadeg_base) if os.path.isdir(os.path.join(hadeg_base, d))]
            if len(subdirs) == 1:
                sample_dir = os.path.join(hadeg_base, subdirs[0])
                
    tsv_path = os.path.join(sample_dir, "Results_HADEG.proteinortho.tsv")
    if not os.path.exists(tsv_path):
        logging.error(f"Input file not found: {tsv_path}")
        sys.exit(1)
        
    try:
        raw = pd.read_csv(tsv_path, sep='\t', dtype=str, na_values=['', 'NA'])
    except Exception as e:
        logging.error(f"Error reading tsv: {e}")
        sys.exit(1)
        
    if len(raw) == 0:
        logging.error("Empty input table.")
        sys.exit(1)
        
    cols = list(raw.columns)
    hadeg_col = next((c for c in cols if "HADEG_protein_database" in c), None)
    if not hadeg_col:
        logging.error("No HADEG column found.")
        sys.exit(1)
        
    mag_cols = [c for c in cols if c.endswith(".faa") and c != hadeg_col]
    mag_labels = [c.replace(".faa", "").replace(args.sample_id + "_", "").replace(args.sample_id + ".", "") for c in mag_cols]
    
    annotated = raw[(raw[hadeg_col] != "*") & (raw[hadeg_col].notna())].copy()
    if len(annotated) == 0:
        logging.info("No HADEG hits found.")
        payload = {"sample_id": args.sample_id, "nodes": [], "edges": []}
        json_path = os.path.join(args.output_dir, f"{args.sample_id}_hadeg_network.json")
        with open(json_path, 'w') as f: json.dump(payload, f)
        sys.exit(0)
        
    annotated['Protein_ID'] = annotated[hadeg_col].apply(lambda x: str(x).split(',')[0].split('|')[0])
    
    pres_mat = annotated[mag_cols].applymap(lambda x: 0 if x == "*" or pd.isna(x) else 1)
    pres_mat.columns = mag_labels
    
    result_df = pd.DataFrame({'Protein_ID': annotated['Protein_ID']})
    result_df = pd.concat([result_df, pres_mat], axis=1)
    
    pathways_csv = locate_pathways_csv(args.results_dir)
    if pathways_csv and os.path.exists(pathways_csv):
        pathways_df = pd.read_csv(pathways_csv)
        pathways_df['Protein_ID'] = pathways_df['Protein_ID'].astype(str).str.strip()
        result_df['Protein_ID'] = result_df['Protein_ID'].astype(str).str.strip()
        result_df = result_df.merge(pathways_df, on='Protein_ID', how='left')
        result_df['pathway_group'] = result_df['Compound'].apply(compound_to_group)
        result_df['gene_label'] = result_df.apply(lambda r: str(r['Gene']).split('_', 1)[-1] if pd.notna(r.get('Gene')) and r.get('Gene') else r['Protein_ID'], axis=1)
    else:
        result_df['pathway_group'] = "Other"
        result_df['gene_label'] = result_df['Protein_ID']
        
    long_df = pd.melt(result_df, id_vars=['Protein_ID', 'gene_label', 'pathway_group'], value_vars=mag_labels, var_name='mag_id', value_name='present')
    long_df = long_df[long_df['present'] > 0]
    
    if len(long_df) == 0:
        payload = {"sample_id": args.sample_id, "nodes": [], "edges": []}
        json_path = os.path.join(args.output_dir, f"{args.sample_id}_hadeg_network.json")
        with open(json_path, 'w') as f: json.dump(payload, f)
        sys.exit(0)
        
    gene_summary = long_df.groupby(['gene_label', 'pathway_group']).agg(n_mags=('mag_id', 'nunique')).reset_index()
    idx = gene_summary.groupby('gene_label')['n_mags'].idxmax()
    gene_summary_dom = gene_summary.loc[idx]
    gene_summary_dom['total_mags'] = gene_summary.groupby('gene_label')['n_mags'].transform('sum')
    
    mag_summary = long_df.groupby(['mag_id', 'pathway_group']).agg(n_genes=('gene_label', 'nunique')).reset_index()
    idx = mag_summary.groupby('mag_id')['n_genes'].idxmax()
    mag_summary_dom = mag_summary.loc[idx]
    mag_summary_dom['total_genes'] = mag_summary.groupby('mag_id')['n_genes'].transform('sum')
    
    active_groups = [g for g in long_df['pathway_group'].unique() if g in PATHWAY_COLORS]
    
    nodes = []
    edges = []
    
    for g in active_groups:
        nodes.append({"id": g, "type": "hub", "group": g, "size": 8.0, "label": g})
        
    for _, row in gene_summary_dom.iterrows():
        nodes.append({"id": row['gene_label'], "type": "gene", "group": row['pathway_group'], "size": float(row['total_mags']), "label": row['gene_label']})
        
    for _, row in mag_summary_dom.iterrows():
        nodes.append({"id": row['mag_id'], "type": "mag", "group": row['pathway_group'], "size": float(row['total_genes']), "label": row['mag_id']})
        
    hub_gene = long_df[['gene_label', 'pathway_group']].drop_duplicates()
    hub_gene = hub_gene[hub_gene['pathway_group'].isin(active_groups)]
    for _, row in hub_gene.iterrows():
        edges.append({"source": row['pathway_group'], "target": row['gene_label'], "type": "hub_gene", "color_group": row['pathway_group'], "weight": 1.0})
        
    gene_mag = long_df.groupby(['gene_label', 'mag_id', 'pathway_group'])['present'].sum().reset_index()
    for _, row in gene_mag.iterrows():
        edges.append({"source": row['gene_label'], "target": row['mag_id'], "type": "gene_mag", "color_group": row['pathway_group'], "weight": float(row['present'])})
        
    payload = {
        "sample_id": args.sample_id,
        "summary": {
            "n_hits": len(result_df),
            "n_mags": len(mag_labels),
            "n_genes": len(gene_summary_dom)
        },
        "network": {
            "nodes": nodes,
            "edges": edges
        }
    }
    
    json_path = os.path.join(args.output_dir, f"{args.sample_id}_hadeg_network.json")
    with open(json_path, 'w') as f:
        json.dump(payload, f, indent=2)
        
    logging.info(f"Saved JSON data to {json_path}")
    logging.info("Completed successfully")

if __name__ == "__main__":
    main()
