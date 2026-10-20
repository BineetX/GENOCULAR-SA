#!/usr/bin/env python3
import argparse
import json
import logging
import os
import sys
import pandas as pd
import re
import ast

# Map specific Cas genes to functional modules
CAS_MODULE_PATTERNS = {
    "Adaptation": r"(cas1|cas2|cas4|csn2)",
    "Interference": r"(cas3|cas5|cas7|cas8|cas9|cas10|cas12|cas13|cas14|csm|cmr|cse|csy|csx|cpf1)",
    "Cas6": r"(cas6|cse3|cas6i|cas6e|cas6f)"
}

def classify_module(gene_name):
    gene_lower = str(gene_name).lower()
    if re.search(r"crispr|array|repeat", gene_lower):
        return "CRISPR array"
    for module, pattern in CAS_MODULE_PATTERNS.items():
        if re.search(pattern, gene_lower):
            return module
    return "Unknown"


def parse_list_cell(value):
    """Parse CCTyper's Python-list-like TSV cells without evaluating code."""
    if isinstance(value, (list, tuple)):
        return list(value)
    if pd.isna(value):
        return []
    text = str(value).strip()
    try:
        parsed = ast.literal_eval(text)
        return list(parsed) if isinstance(parsed, (list, tuple)) else [parsed]
    except (ValueError, SyntaxError):
        return [part.strip().strip("'\"") for part in text.strip("[]").split(",") if part.strip()]


def display_gene_name(raw_name):
    """Reduce a CCTyper HMM identifier to the familiar Cas-family label."""
    label = str(raw_name or "Unknown").strip()
    return label.split("_", 1)[0] or "Unknown"


def integer_or_none(value):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None

def main():
    parser = argparse.ArgumentParser(description="CCTyper JSON Generator")
    parser.add_argument("cctyper_sample_dir", help="Path to sample-level CCTyper folder")
    parser.add_argument("output_dir", help="Output directory")
    parser.add_argument("sample_id", help="Sample ID")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    
    log_file = os.path.join(args.output_dir, f"{args.sample_id}_cctyper_json.log")
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[logging.FileHandler(log_file), logging.StreamHandler(sys.stdout)]
    )
    
    logging.info(f"Started CCTyper processing for {args.sample_id}")
    
    if not os.path.isdir(args.cctyper_sample_dir):
        logging.error(f"CCTyper sample dir not found: {args.cctyper_sample_dir}")
        sys.exit(1)

    operon_data = []
    genes_data = []

    loci_dirs = [d for d in os.listdir(args.cctyper_sample_dir) 
                 if os.path.isdir(os.path.join(args.cctyper_sample_dir, d))]
    
    for loc_id in loci_dirs:
        loc_dir = os.path.join(args.cctyper_sample_dir, loc_id)
        operon_file = os.path.join(loc_dir, "cas_operons.tab")
        putative_file = os.path.join(loc_dir, "cas_operons_putative.tab")
        genes_file = os.path.join(loc_dir, "genes.tab")
        
        crispr_file = os.path.join(loc_dir, "crisprs_all.tab")

        gene_lookup = {}
        if os.path.exists(genes_file):
            try:
                df_genes = pd.read_csv(genes_file, sep='\t')
                for _, gene_row in df_genes.iterrows():
                    contig = str(gene_row.get("Contig", ""))
                    position = integer_or_none(gene_row.get("Pos"))
                    if contig and position is not None:
                        gene_lookup[(contig, position)] = gene_row
            except Exception as e:
                logging.error(f"Error indexing genes for {loc_id}: {e}")

        crispr_rows = []
        if os.path.exists(crispr_file):
            try:
                crispr_rows = pd.read_csv(crispr_file, sep='\t').to_dict("records")
            except Exception as e:
                logging.error(f"Error parsing CRISPR arrays for {loc_id}: {e}")

        # A MAG can contain both validated and putative operons. Preserve both,
        # and use the operon ID (not just the MAG directory) as the plotted locus.
        for target_op_file, status in ((operon_file, "Validated"), (putative_file, "Putative-only")):
            if not os.path.exists(target_op_file):
                continue
            try:
                df_op = pd.read_csv(target_op_file, sep='\t')
                if df_op.empty:
                    continue
                sub_col = next((c for c in df_op.columns if re.search(r"^Prediction$|subtype|type", c, re.I)), None)
                score_col = next((c for c in df_op.columns if re.search(r"^Best_score$|prob|score|conf", c, re.I)), None)

                for row_index, row in df_op.iterrows():
                    contig = str(row.get("Contig", "Unknown"))
                    operon_id = str(row.get("Operon", f"operon-{row_index + 1}"))
                    locus_id = f"{loc_id} · {operon_id}"
                    pred = str(row[sub_col]) if sub_col and pd.notna(row[sub_col]) else "Unknown"
                    score = float(row[score_col]) if score_col and pd.notna(row[score_col]) else 0.0
                    operon_start = integer_or_none(row.get("Start"))
                    operon_end = integer_or_none(row.get("End"))
                    operon_data.append({
                        "Locus_ID": locus_id,
                        "MAG_ID": loc_id,
                        "Contig": contig,
                        "Operon": operon_id,
                        "Prediction": pred,
                        "Score": score,
                        "Probability": score,
                        "Status": status,
                        "Start": operon_start,
                        "End": operon_end,
                    })

                    raw_genes = parse_list_cell(row.get("Genes"))
                    positions = parse_list_cell(row.get("Positions"))
                    for raw_gene, raw_position in zip(raw_genes, positions):
                        position = integer_or_none(raw_position)
                        source_gene = gene_lookup.get((contig, position))
                        if source_gene is None:
                            logging.warning("No genes.tab row for %s position %s", operon_id, raw_position)
                            continue
                        gene_name = display_gene_name(raw_gene)
                        strand = str(source_gene.get("Strand", "1"))
                        start = integer_or_none(source_gene.get("Start"))
                        end = integer_or_none(source_gene.get("End"))
                        if start is None or end is None:
                            continue
                        module = classify_module(gene_name)
                        genes_data.append({
                            "Locus_ID": locus_id,
                            "MAG_ID": loc_id,
                            "Contig": contig,
                            "Operon": operon_id,
                            "Start": start,
                            "End": end,
                            "Strand": strand,
                            "Gene": gene_name,
                            "Gene_HMM": str(raw_gene),
                            "Module": module,
                            "Direction": -1 if strand.lower() in ["-", "-1", "reverse"] else 1,
                        })

                    # Include CRISPR arrays on the same contig when they fall in
                    # or immediately beside the operon context (10 kb flanks).
                    if operon_start is not None and operon_end is not None:
                        for array in crispr_rows:
                            array_start = integer_or_none(array.get("Start"))
                            array_end = integer_or_none(array.get("End"))
                            if (
                                str(array.get("Contig", "")) != contig
                                or array_start is None
                                or array_end is None
                                or array_end < operon_start - 10_000
                                or array_start > operon_end + 10_000
                            ):
                                continue
                            genes_data.append({
                                "Locus_ID": locus_id,
                                "MAG_ID": loc_id,
                                "Contig": contig,
                                "Operon": operon_id,
                                "Start": array_start,
                                "End": array_end,
                                "Strand": "0",
                                "Gene": str(array.get("CRISPR", "CRISPR array")),
                                "Module": "CRISPR array",
                                "Direction": 0,
                            })
            except Exception as e:
                logging.error(f"Error parsing operons for {loc_id} ({status}): {e}")

    payload = {
        "sample_id": args.sample_id,
        "operons": operon_data,
        "genes_synteny": genes_data
    }
    
    json_path = os.path.join(args.output_dir, f"{args.sample_id}_cctyper_annotation.json")
    with open(json_path, 'w') as f:
        json.dump(payload, f, indent=2)
        
    logging.info(f"Saved JSON data to {json_path}")
    logging.info("Completed successfully")

if __name__ == "__main__":
    main()
