#!/usr/bin/env python3

import argparse
from pathlib import Path
from collections import OrderedDict
import json

import numpy as np
import pandas as pd


# ==================================================
# ARGUMENTS
# ==================================================
def parse_args():
    parser = argparse.ArgumentParser(
        description="Convert Prokka annotated_genome.tsv into structured JSON files for Next.js and Plotly.js"
    )
    parser.add_argument(
        "-i", "--input",
        default="annotated_genome.tsv",
        help="Path to Prokka TSV file (default: annotated_genome.tsv)"
    )
    parser.add_argument(
        "-o", "--outdir",
        default=".",
        help="Output directory for JSON files (default: current directory)"
    )
    parser.add_argument(
        "--faa",
        default=None,
        help="Optional path to annotated_genome.faa for exact amino-acid lengths"
    )
    return parser.parse_args()


# ==================================================
# RESOLVE FILES
# ==================================================
def resolve_input_file(input_path_str):
    input_path = Path(input_path_str)

    if input_path.exists():
        return input_path.resolve()

    cwd_candidate = Path.cwd() / input_path_str
    if cwd_candidate.exists():
        return cwd_candidate.resolve()

    script_dir = Path(__file__).resolve().parent
    script_candidate = script_dir / input_path_str
    if script_candidate.exists():
        return script_candidate.resolve()

    raise FileNotFoundError(
        f"Could not find input file: {input_path_str}\n"
        f"Tried:\n"
        f"  - {input_path}\n"
        f"  - {cwd_candidate}\n"
        f"  - {script_candidate}"
    )


def resolve_optional_faa(tsv_file, faa_arg=None):
    if faa_arg:
        faa_path = Path(faa_arg)
        if faa_path.exists():
            return faa_path.resolve()
        raise FileNotFoundError(f"FAA file not found: {faa_arg}")

    candidate = tsv_file.with_suffix(".faa")
    if candidate.exists():
        return candidate.resolve()

    return None


# ==================================================
# DATA LOADING & LOGIC (From[cite: 1])
# ==================================================
def clean_columns(df):
    df.columns = [str(c).strip() for c in df.columns]
    return df


def function_status(product: str) -> str:
    p = str(product).strip().lower()
    if p == "" or p in {"unknown", "uncharacterized protein"}:
        return "Unknown function"
    if "hypothetical protein" in p:
        return "Hypothetical protein"
    return "Known function"


category_keywords = OrderedDict({
    "Iron ion homeostasis": [
        "iron", "ferric", "ferrous", "heme", "siderophore", "feo", "fur"
    ],
    "Oxidation-reduction process": [
        "oxidoreductase", "dehydrogenase", "reductase", "oxidase", "catalase",
        "peroxidase", "superoxide", "ferredoxin", "flavoprotein"
    ],
    "Cell division": [
        "cell division", "fts", "zap", "mreb", "minc", "mind", "sepa", "sepf"
    ],
    "DNA repair": [
        "dna repair", "rec", "ruv", "uvr", "mut", "lexa", "rad", "photolyase",
        "endonuclease", "excinuclease", "glycosylase"
    ],
    "Conjugation": [
        "conjug", "tra", "trb", "type iv secretion", "relaxase", "pilus assembly"
    ],
    "Resistance": [
        "resistance", "efflux", "multidrug", "beta-lactamase", "heavy metal",
        "copper resistance", "ars", "mer", "van", "tet"
    ],
    "Pathogenesis": [
        "virulence", "adhesin", "invasion", "toxin", "hemolysin", "pathogenicity"
    ],
    "DNA recombination": [
        "recombinase", "recombination", "resolvase", "site-specific recombination"
    ],
    "Transmembrane transport": [
        "transporter", "permease", "abc transporter", "symporter", "antiporter",
        "porin", "channel protein", "pump"
    ],
    "Transcription regulation": [
        "transcriptional regulator", "response regulator", "sigma factor",
        "repressor", "activator", "dna-binding", "two-component"
    ],
    "Transposition related": [
        "transposase", "insertion sequence", "mobile element", "integrase", "is element"
    ],
    "Metabolic process": [
        "synthetase", "synthase", "kinase", "isomerase", "hydrolase", "lyase",
        "transferase", "carboxylase", "ligase", "protease", "peptidase",
        "amidase", "phosphatase", "metalloenzyme"
    ]
})


def assign_category(product: str) -> str:
    p = str(product).strip().lower()
    if p == "" or p == "unknown" or "hypothetical protein" in p:
        return "Other"

    for category, keywords in category_keywords.items():
        for kw in keywords:
            if kw in p:
                return category
    return "Other"


def load_prokka_tsv(tsv_file):
    df = pd.read_csv(tsv_file, sep="\t")
    df = clean_columns(df)

    required_cols = {"ftype", "product"}
    missing = required_cols - set(df.columns)
    if missing:
        raise ValueError(
            f"Missing required columns in TSV: {', '.join(sorted(missing))}\n"
            f"Found columns: {', '.join(df.columns)}"
        )

    df["ftype"] = df["ftype"].astype(str).str.strip()
    df["product"] = df["product"].fillna("").astype(str).str.strip()

    if "len_bp" in df.columns:
        df["len_bp"] = pd.to_numeric(df["len_bp"], errors="coerce")

    cds = df[df["ftype"].str.upper() == "CDS"].copy()
    if cds.empty:
        raise ValueError("No CDS entries found in the 'ftype' column.")

    cds["function_status"] = cds["product"].apply(function_status)
    cds["category"] = cds["product"].apply(assign_category)

    if "len_bp" in cds.columns:
        cds["aa_len_est"] = (cds["len_bp"] / 3).round().astype("Int64")

    return df, cds


def read_fasta_lengths(faa_file):
    lengths = []
    seq_len = 0

    with open(faa_file, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            if line.startswith(">"):
                if seq_len > 0:
                    lengths.append(seq_len)
                seq_len = 0
            else:
                seq_len += len(line)

    if seq_len > 0:
        lengths.append(seq_len)

    return lengths


# ==================================================
# JSON EXPORT FUNCTIONS (Plotly Schema Compatible)
# ==================================================

def export_functional_summary_json(cds, tsv_name, outdir):
    ordered_categories = list(category_keywords.keys()) + ["Other"]

    status_counts = cds["function_status"].value_counts().reindex(
        ["Known function", "Unknown function", "Hypothetical protein"],
        fill_value=0
    )
    cat_counts = cds["category"].value_counts().reindex(ordered_categories, fill_value=0)

    total_cds = len(cds)
    cat_percent = (cat_counts / total_cds * 100).round(2)
    status_percent = (status_counts / total_cds * 100).round(2)

    payload = {
        "metadata": {
            "input": tsv_name,
            "total_cds": total_cds,
            "description": "Functional overview and annotation status of coding sequences."
        },
        "bar_chart": {
            "data": [{
                "x": cat_percent.index.tolist(),
                "y": cat_percent.values.tolist(),
                "type": "bar",
                "marker": {"color": "#16a34a"}
            }],
            "layout": {
                "title": "Functional overview of Prokka-annotated coding sequences",
                "xaxis": {"title": "Category", "tickangle": -45},
                "yaxis": {"title": "Annotated CDS (%)"}
            }
        },
        "pie_chart": {
            "data": [{
                "labels": status_percent.index.tolist(),
                "values": status_percent.values.tolist(),
                "type": "pie",
                "hole": 0.55
            }],
            "layout": {
                "title": "Annotation Status"
            }
        }
    }

    out_json = outdir / "prokka_functional_summary.json"
    with open(out_json, "w") as f:
        json.dump(payload, f, indent=4)
    return out_json


def export_feature_composition_json(df, tsv_name, outdir):
    feature_counts = df["ftype"].astype(str).value_counts().sort_values(ascending=False)
    total_features = feature_counts.sum()
    feature_percent = (feature_counts / total_features * 100).round(2)

    payload = {
        "metadata": {
            "input": tsv_name,
            "total_features": int(total_features)
        },
        "data": [{
            "x": feature_counts.index.tolist(),
            "y": feature_counts.values.tolist(),
            "text": [f"{pct}%" for pct in feature_percent.values],
            "type": "bar",
            "marker": {"color": "#0284c7"}
        }],
        "layout": {
            "title": "Genome feature composition",
            "xaxis": {"title": "Feature type"},
            "yaxis": {"title": "Feature count"}
        }
    }

    out_json = outdir / "prokka_feature_composition.json"
    with open(out_json, "w") as f:
        json.dump(payload, f, indent=4)
    return out_json


def export_cds_length_json(cds, tsv_name, outdir):
    if "len_bp" not in cds.columns or cds["len_bp"].dropna().empty:
        return None

    lengths = cds["len_bp"].dropna().astype(float).values
    hist_counts, bin_edges = np.histogram(lengths, bins=35)
    bin_centers = (bin_edges[:-1] + bin_edges[1:]) / 2

    payload = {
        "metadata": {
            "input": tsv_name,
            "mean_len": float(np.mean(lengths)),
            "median_len": float(np.median(lengths)),
            "count": int(len(lengths))
        },
        "data": [{
            "x": bin_centers.tolist(),
            "y": hist_counts.tolist(),
            "type": "bar",
            "marker": {"color": "#7c3aed"}
        }],
        "layout": {
            "title": "CDS length distribution",
            "xaxis": {"title": "CDS length (bp)"},
            "yaxis": {"title": "Number of CDS"}
        }
    }

    out_json = outdir / "prokka_cds_length_distribution.json"
    with open(out_json, "w") as f:
        json.dump(payload, f, indent=4)
    return out_json


def export_protein_length_json(cds, faa_file, tsv_name, outdir):
    aa_lengths = None
    if faa_file is not None and faa_file.exists():
        aa_lengths = read_fasta_lengths(faa_file)
    elif "aa_len_est" in cds.columns and cds["aa_len_est"].dropna().any():
        aa_lengths = cds["aa_len_est"].dropna().astype(float).tolist()

    if not aa_lengths:
        return None

    arr_lengths = np.array(aa_lengths)
    hist_counts, bin_edges = np.histogram(arr_lengths, bins=35)
    bin_centers = (bin_edges[:-1] + bin_edges[1:]) / 2

    payload = {
        "metadata": {
            "input": tsv_name,
            "mean_len": float(np.mean(arr_lengths)),
            "median_len": float(np.median(arr_lengths)),
            "count": int(len(arr_lengths))
        },
        "data": [{
            "x": bin_centers.tolist(),
            "y": hist_counts.tolist(),
            "type": "bar",
            "marker": {"color": "#0d9488"}
        }],
        "layout": {
            "title": "Protein length distribution",
            "xaxis": {"title": "Protein length (aa)"},
            "yaxis": {"title": "Number of proteins"}
        }
    }

    out_json = outdir / "prokka_protein_length_distribution.json"
    with open(out_json, "w") as f:
        json.dump(payload, f, indent=4)
    return out_json


def export_top_products_json(cds, tsv_name, outdir, top_n=15):
    products = cds["product"].fillna("").astype(str).str.strip()
    filtered = products[
        ~products.str.lower().isin(["", "unknown", "uncharacterized protein", "hypothetical protein"])
    ]

    if filtered.empty:
        return None

    counts = filtered.value_counts().head(top_n).sort_values(ascending=True)

    payload = {
        "metadata": {
            "input": tsv_name,
            "top_n": top_n
        },
        "data": [{
            "y": counts.index.tolist(),
            "x": counts.values.tolist(),
            "type": "bar",
            "orientation": "h",
            "marker": {"color": "#ca8a04"}
        }],
        "layout": {
            "title": "Top annotated product names",
            "xaxis": {"title": "Count"},
            "yaxis": {"title": "Product annotation"}
        }
    }

    out_json = outdir / "prokka_top_product_annotations.json"
    with open(out_json, "w") as f:
        json.dump(payload, f, indent=4)
    return out_json


# ==================================================
# MAIN
# ==================================================
def main():
    args = parse_args()

    tsv_file = resolve_input_file(args.input)
    faa_file = resolve_optional_faa(tsv_file, args.faa)

    outdir = Path(args.outdir).resolve()
    outdir.mkdir(parents=True, exist_ok=True)

    print(f"Reading TSV: {tsv_file}")
    if faa_file:
        print(f"Using FAA:   {faa_file}")
    print(f"Output dir:  {outdir}")

    df, cds = load_prokka_tsv(tsv_file)

    outputs = [
        export_functional_summary_json(cds, tsv_file.name, outdir),
        export_feature_composition_json(df, tsv_file.name, outdir),
        export_cds_length_json(cds, tsv_file.name, outdir),
        export_protein_length_json(cds, faa_file, tsv_file.name, outdir),
        export_top_products_json(cds, tsv_file.name, outdir, top_n=15)
    ]

    print("\nSuccessfully generated JSON files for Next.js:")
    for f in outputs:
        if f is not None:
            print(f"  {f}")


if __name__ == "__main__":
    main()
