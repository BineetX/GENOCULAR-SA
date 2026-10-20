#!/usr/bin/env python3
import argparse
import json
import logging
import os
import sys
import pandas as pd

def main():
    parser = argparse.ArgumentParser(description="GUNC JSON Generator")
    parser.add_argument("gunc_tsv", help="Path to GUNC.maxCSS_level.tsv")
    parser.add_argument("output_dir", help="Output directory")
    parser.add_argument("sample_id", help="Sample ID")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    
    log_file = os.path.join(args.output_dir, f"{args.sample_id}_gunc_json.log")
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[logging.FileHandler(log_file), logging.StreamHandler(sys.stdout)]
    )
    
    logging.info(f"Started GUNC processing for {args.sample_id}")
    
    if not os.path.exists(args.gunc_tsv):
        logging.error(f"Input file not found: {args.gunc_tsv}")
        sys.exit(1)
        
    df = pd.read_csv(args.gunc_tsv, sep='\t')
    
    if len(df) == 0:
        logging.error("Input TSV is empty.")
        sys.exit(1)
        
    df = df.dropna(subset=['clade_separation_score', 'contamination_portion', 'reference_representation_score'])
    if len(df) == 0:
        logging.error("No valid genomes remaining after NA filter.")
        sys.exit(1)
        
    # Derive flags
    df['pass.GUNC'] = df['pass.GUNC'].astype(str).str.upper()
    df['stage3_pass'] = df['pass.GUNC'].apply(lambda x: "Pass" if x in ["TRUE", "T", "1", "PASS"] else "Fail")
    
    df['css_flag'] = df['clade_separation_score'] > 0.45
    df['contam_flag'] = df['contamination_portion'] > 0.05
    
    def get_stage2(row):
        if row['css_flag'] and row['contam_flag']: return "CSS+Contam"
        if row['css_flag']: return "CSS only"
        if row['contam_flag']: return "Contam only"
        return "None"
        
    df['stage2_comb'] = df.apply(get_stage2, axis=1)
    df['rrs_high'] = df['reference_representation_score'] > 0.5
    df['rrs_status'] = df['rrs_high'].apply(lambda x: "High RRS" if x else "Low RRS")
    
    n_total = len(df)
    n_low_rrs = len(df[~df['rrs_high']])
    
    tax_levels_ordered = df['taxonomic_level'].unique().tolist()
    stage2_levels = ["None", "CSS only", "Contam only", "CSS+Contam"]
    stage2_levels = [s for s in stage2_levels if s in df['stage2_comb'].unique()]
    stage3_levels = ["Pass", "Fail"]
    stage3_levels = [s for s in stage3_levels if s in df['stage3_pass'].unique()]
    
    # Aggregation S1 -> S2
    links_s1_s2 = df.groupby(['taxonomic_level', 'stage2_comb', 'rrs_status', 'stage3_pass']).size().reset_index(name='value')
    links_s1_s2.rename(columns={'taxonomic_level': 'source_name', 'stage2_comb': 'target_name'}, inplace=True)
    
    # Aggregation S2 -> S3
    links_s2_s3 = df.groupby(['stage2_comb', 'stage3_pass', 'rrs_status']).size().reset_index(name='value')
    links_s2_s3.rename(columns={'stage2_comb': 'source_name', 'stage3_pass': 'target_name'}, inplace=True)
    links_s2_s3['stage3_pass'] = links_s2_s3['target_name']
    
    raw_links = pd.concat([links_s1_s2, links_s2_s3], ignore_index=True)
    
    all_node_names = tax_levels_ordered + stage2_levels + stage3_levels
    nodes_df = pd.DataFrame({"name": all_node_names})
    
    s1_counts = df.groupby('taxonomic_level').size().reset_index(name='n').rename(columns={'taxonomic_level': 'name'})
    s2_counts = df.groupby('stage2_comb').size().reset_index(name='n').rename(columns={'stage2_comb': 'name'})
    s3_counts = df.groupby('stage3_pass').size().reset_index(name='n').rename(columns={'stage3_pass': 'name'})
    
    node_counts = pd.concat([s1_counts, s2_counts, s3_counts]).drop_duplicates(subset=['name'])
    nodes_df = nodes_df.merge(node_counts, on='name', how='left').fillna(0)
    
    nodes_df['pct'] = round(100 * nodes_df['n'] / n_total, 1)
    
    def get_node_group(n):
        if n == "Pass": return "Pass"
        if n == "Fail": return "Fail"
        return "Default"
    nodes_df['node_group'] = nodes_df['name'].apply(get_node_group)
    
    # Links
    name_to_idx = {name: i for i, name in enumerate(nodes_df['name'])}
    
    raw_links['source'] = raw_links['source_name'].map(name_to_idx)
    raw_links['target'] = raw_links['target_name'].map(name_to_idx)
    raw_links['pct_of_total'] = round(100 * raw_links['value'] / n_total, 1)
    
    def get_link_group(row):
        st3 = row['stage3_pass']
        rrs = row['rrs_status']
        if st3 == "Pass" and rrs == "High RRS": return "Pass_High"
        if st3 == "Pass" and rrs == "Low RRS": return "Pass_Low"
        if st3 == "Fail" and rrs == "High RRS": return "Fail_High"
        if st3 == "Fail" and rrs == "Low RRS": return "Fail_Low"
        return "Pass_High"
        
    raw_links['link_group'] = raw_links.apply(get_link_group, axis=1)
    
    # Summary stats per tax level
    def summarize(g):
        return pd.Series({
            'n_genomes': len(g),
            'n_pass': (g['stage3_pass'] == 'Pass').sum(),
            'n_fail': (g['stage3_pass'] == 'Fail').sum(),
            'pass_rate_pct': round(100 * (g['stage3_pass'] == 'Pass').sum() / len(g), 1),
            'n_low_rrs': (~g['rrs_high']).sum(),
            'low_rrs_rate_pct': round(100 * (~g['rrs_high']).sum() / len(g), 1)
        })
        
    summary_stats = df.groupby('taxonomic_level').apply(summarize).reset_index()
    summary_stats['taxonomic_level'] = pd.Categorical(summary_stats['taxonomic_level'], categories=tax_levels_ordered, ordered=True)
    summary_stats = summary_stats.sort_values('taxonomic_level')
    
    payload = {
        "sample_id": args.sample_id,
        "summary": {
            "n_total": int(n_total),
            "n_pass": int((df['stage3_pass'] == 'Pass').sum()),
            "n_fail": int((df['stage3_pass'] == 'Fail').sum()),
            "n_low_rrs": int(n_low_rrs)
        },
        "sankey": {
            "nodes": nodes_df.to_dict(orient='records'),
            "links": raw_links[['source', 'target', 'value', 'pct_of_total', 'link_group']].to_dict(orient='records')
        },
        "summary_table": summary_stats.to_dict(orient='records')
    }
    
    json_path = os.path.join(args.output_dir, f"{args.sample_id}_gunc_sankey.json")
    with open(json_path, 'w') as f:
        json.dump(payload, f, indent=2)
        
    logging.info(f"Saved JSON data to {json_path}")
    logging.info("Completed successfully")

if __name__ == "__main__":
    main()
