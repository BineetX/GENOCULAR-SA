#!/usr/bin/env python3
# ==============================================================================
# hadeg_network_json.py
#
# Python port of network.R (v10.0). Parses HADEG proteinortho TSV files and the
# 7_All_pathways.csv pathway reference table, builds a 3-tier bipartite network
# (hub → gene → MAG), runs a pure-Python Fruchterman–Reingold layout, and emits
# a single plot-ready JSON for the React/Plotly frontend.
#
# Pure standard library — no pandas/numpy/igraph — so it drops into a Nextflow
# process without a heavy image.
#
# EXACT CLI ARGUMENT ORDER (matches the R script):
#   arg1: RESULTS_DIR   pipeline results root containing a "hadeg/" folder
#                        with one subfolder per sample, each containing
#                        Results_HADEG.proteinortho.tsv
#   arg2: OUTPUT_DIR    output directory for JSON + log
#   arg3: SAMPLE_ID     specific sample folder name under hadeg/, or "ALL"
#
# Usage:
#   python3 hadeg_network_json.py <RESULTS_DIR> <OUTPUT_DIR> <SAMPLE_ID>
#
# Output:
#   <OUTPUT_DIR>/mag_hadeg_plots_data.json   (frontend input)
#   <OUTPUT_DIR>/<SAMPLE_ID>_HADEG_network_run.log
# ==============================================================================

import csv
import datetime
import json
import math
import os
import random
import re
import sys

SCHEMA_VERSION = "1.0"

# ── Pathway colour palette & numbering (identical to R script) ────────────────

PATHWAY_COLORS = {
    "Alkane degradation":       "#D62828",
    "Alkene degradation":       "#7B2FBE",
    "Aromatic degradation":     "#E76F00",
    "Plastic degradation":      "#E9C46A",
    "Biosurfactant production": "#4CC9F0",
    "Other":                    "#AAAAAA",
}

PATHWAY_NUMBERS = {
    "Alkane degradation":       "1",
    "Alkene degradation":       "2",
    "Aromatic degradation":     "3",
    "Plastic degradation":      "4",
    "Biosurfactant production": "5",
    "Other":                    "0",
}

_COMPOUND_PATTERNS = [
    (re.compile(r"alkan",   re.I), "Alkane degradation"),
    (re.compile(r"alken",   re.I), "Alkene degradation"),
    (re.compile(r"aromat",  re.I), "Aromatic degradation"),
    (re.compile(r"plastic", re.I), "Plastic degradation"),
    (re.compile(r"biosur|surfact", re.I), "Biosurfactant production"),
]

# ── Built-in HADEG pathway reference table (from HADEG v2023-11-19) ──────────
# Embedded so the script works without the external 7_All_pathways.csv.
# Source: https://github.com/jarojasva/HADEG  Tables/7_All_pathways.csv
# 629 Protein_ID → Gene + Compound mappings covering all five degradation groups.
def _load_builtin_pathways():
    """Return the full HADEG pathway lookup as {Protein_ID: {Gene, Compound}}.
    629 entries covering Alkanes, Alkenes, Aromatics, Biosurfactants, Plastics."""
    # fmt: off
    return {
        "P12693": {"Gene": "AeAA_alkH_ald", "Compound": "A_Alkanes"},
        "Q00593": {"Gene": "AeAA_alkJ_adh", "Compound": "A_Alkanes"},
        "Q9WWW2": {"Gene": "AeAA_alkJ_adh", "Compound": "A_Alkanes"},
        "P17051": {"Gene": "AeAA_alkS", "Compound": "A_Alkanes"},
        "Q0VKZ4": {"Gene": "AeAA_alkS", "Compound": "A_Alkanes"},
        "Q9L4M7": {"Gene": "AeAA_alkS", "Compound": "A_Alkanes"},
        "O85764": {"Gene": "AeAA_ssuD", "Compound": "A_Alkanes"},
        "P40402": {"Gene": "AeAA_ssuD", "Compound": "A_Alkanes"},
        "Q9HYG2": {"Gene": "AeAA_ssuD", "Compound": "A_Alkanes"},
        "Q02UU0": {"Gene": "AeAB_ahpC", "Compound": "A_Alkanes"},
        "Q9I6Z2": {"Gene": "AeAB_ahpF", "Compound": "A_Alkanes"},
        "BAB33284.1": {"Gene": "AeAB_alkMa", "Compound": "A_Alkanes"},
        "BAB33287.1": {"Gene": "AeAB_alkMb", "Compound": "A_Alkanes"},
        "Q00595": {"Gene": "AeAC_alkL", "Compound": "A_Alkanes"},
        "Q0VTI9": {"Gene": "AeAC_alkN_mcp", "Compound": "A_Alkanes"},
        "Q9R9U8": {"Gene": "AeAC_alkN_mcp", "Compound": "A_Alkanes"},
        "P0A901": {"Gene": "AeAC_blc", "Compound": "A_Alkanes"},
        "Q08790": {"Gene": "AeAC_blc", "Compound": "A_Alkanes"},
        "P10384": {"Gene": "AeAC_FadL", "Compound": "A_Alkanes"},
        "A3U3H1": {"Gene": "AeAD_BVMO", "Compound": "A_Alkanes"},
        "A7HU16": {"Gene": "AeAD_BVMO", "Compound": "A_Alkanes"},
        "Q88J44": {"Gene": "AeAD_BVMO", "Compound": "A_Alkanes"},
        "Q93TJ5": {"Gene": "AeAD_BVMO", "Compound": "A_Alkanes"},
        "Q9I3H5": {"Gene": "AeAD_BVMO", "Compound": "A_Alkanes"},
        "U5S003": {"Gene": "AeAD_BVMO", "Compound": "A_Alkanes"},
        "Q0SJK9": {"Gene": "AeAD_prmA", "Compound": "A_Alkanes"},
        "Q768T5": {"Gene": "AeAD_prmA", "Compound": "A_Alkanes"},
        "Q0SJK8": {"Gene": "AeAD_prmB", "Compound": "A_Alkanes"},
        "Q768T4": {"Gene": "AeAD_prmB", "Compound": "A_Alkanes"},
        "Q0SJK7": {"Gene": "AeAD_prmC", "Compound": "A_Alkanes"},
        "Q768T3": {"Gene": "AeAD_prmC", "Compound": "A_Alkanes"},
        "Q0SJK6": {"Gene": "AeAD_prmD", "Compound": "A_Alkanes"},
        "Q768T2": {"Gene": "AeAD_prmD", "Compound": "A_Alkanes"},
        "C0LMW6": {"Gene": "AeAE_alkB", "Compound": "A_Alkanes"},
        "C3W4W7": {"Gene": "AeAE_alkB", "Compound": "A_Alkanes"},
        "D2JNY2": {"Gene": "AeAE_alkB", "Compound": "A_Alkanes"},
        "E7D4Q3": {"Gene": "AeAE_alkB", "Compound": "A_Alkanes"},
        "G1C7J8": {"Gene": "AeAE_alkB", "Compound": "A_Alkanes"},
        "G3EIL3": {"Gene": "AeAE_alkB", "Compound": "A_Alkanes"},
        "K0C9K7": {"Gene": "AeAE_alkB", "Compound": "A_Alkanes"},
        "O31250": {"Gene": "AeAE_alkB", "Compound": "A_Alkanes"},
        "P12691": {"Gene": "AeAE_alkB", "Compound": "A_Alkanes"},
        "Q08KE7": {"Gene": "AeAE_alkB", "Compound": "A_Alkanes"},
        "Q0VKZ3": {"Gene": "AeAE_alkB", "Compound": "A_Alkanes"},
        "Q0VTH3": {"Gene": "AeAE_alkB", "Compound": "A_Alkanes"},
        "Q6B431": {"Gene": "AeAE_alkB", "Compound": "A_Alkanes"},
        "Q6H941": {"Gene": "AeAE_alkB", "Compound": "A_Alkanes"},
        "Q93DM7": {"Gene": "AeAE_alkB", "Compound": "A_Alkanes"},
        "Q93DN5": {"Gene": "AeAE_alkB", "Compound": "A_Alkanes"},
        "Q93JS1": {"Gene": "AeAE_alkB", "Compound": "A_Alkanes"},
        "Q93JS2": {"Gene": "AeAE_alkB", "Compound": "A_Alkanes"},
        "Q93UQ1": {"Gene": "AeAE_alkB", "Compound": "A_Alkanes"},
        "Q9AE68": {"Gene": "AeAE_alkB", "Compound": "A_Alkanes"},
        "Q9AFD5": {"Gene": "AeAE_alkB", "Compound": "A_Alkanes"},
        "Q9I0R2": {"Gene": "AeAE_alkB", "Compound": "A_Alkanes"},
        "Q9WWW6": {"Gene": "AeAE_alkB", "Compound": "A_Alkanes"},
        "Q9XAU0": {"Gene": "AeAE_alkB", "Compound": "A_Alkanes"},
        "Q9XAV1": {"Gene": "AeAE_alkB", "Compound": "A_Alkanes"},
        "Q9XBM1": {"Gene": "AeAE_alkB", "Compound": "A_Alkanes"},
        "A5H9N6": {"Gene": "AeAE_almA", "Compound": "A_Alkanes"},
        "A5H9N8": {"Gene": "AeAE_almA", "Compound": "A_Alkanes"},
        "A5H9P0": {"Gene": "AeAE_almA", "Compound": "A_Alkanes"},
        "E3UUD9": {"Gene": "AeAE_almA", "Compound": "A_Alkanes"},
        "G1C7M4": {"Gene": "AeAE_almA", "Compound": "A_Alkanes"},
        "GOM1": {"Gene": "AeAE_almA", "Compound": "A_Alkanes"},
        "K0CFH5": {"Gene": "AeAE_almA", "Compound": "A_Alkanes"},
        "Q6F7T9": {"Gene": "AeAE_almA", "Compound": "A_Alkanes"},
        "Q8KQF0": {"Gene": "AeAE_bmoX", "Compound": "A_Alkanes"},
        "Q8KQE9": {"Gene": "AeAE_bmoY", "Compound": "A_Alkanes"},
        "Q8KQE7": {"Gene": "AeAE_bmoZ", "Compound": "A_Alkanes"},
        "P12015": {"Gene": "AeAE_CHMO", "Compound": "A_Alkanes"},
        "Q6TMA3": {"Gene": "AeAE_chnA", "Compound": "A_Alkanes"},
        "Q6RXW1": {"Gene": "AeAE_chnB", "Compound": "A_Alkanes"},
        "Q6RXW2": {"Gene": "AeAE_chnC", "Compound": "A_Alkanes"},
        "Q6RXW3": {"Gene": "AeAE_chnD", "Compound": "A_Alkanes"},
        "Q6RXW0": {"Gene": "AeAE_chnE", "Compound": "A_Alkanes"},
        "L7QFU8": {"Gene": "AeAE_CYP153", "Compound": "A_Alkanes"},
        "D0Q1H3": {"Gene": "AeAE_CYP450", "Compound": "A_Alkanes"},
        "P16496": {"Gene": "AeAE_CYP450", "Compound": "A_Alkanes"},
        "Q11ZY2": {"Gene": "AeAE_CYP450", "Compound": "A_Alkanes"},
        "Q6RCE3": {"Gene": "AeAE_CYP450", "Compound": "A_Alkanes"},
        "A4IU28": {"Gene": "AeAE_LadA", "Compound": "A_Alkanes"},
        "P27356": {"Gene": "AeAE_mmoB", "Compound": "A_Alkanes"},
        "Q53563": {"Gene": "AeAE_mmoC", "Compound": "A_Alkanes"},
        "P27353": {"Gene": "AeAE_mmoX", "Compound": "A_Alkanes"},
        "P27354": {"Gene": "AeAE_mmoY", "Compound": "A_Alkanes"},
        "P27355": {"Gene": "AeAE_mmoZ", "Compound": "A_Alkanes"},
        "Q607G3": {"Gene": "AeAE_pmoA1", "Compound": "A_Alkanes"},
        "P00272": {"Gene": "AeAE_rdx", "Compound": "A_Alkanes"},
        "P0A4E9": {"Gene": "AeAE_rdx", "Compound": "A_Alkanes"},
        "P0A4F1": {"Gene": "AeAE_rdx", "Compound": "A_Alkanes"},
        "P12692": {"Gene": "AeAE_rdx", "Compound": "A_Alkanes"},
        "P42453": {"Gene": "AeAE_rdx", "Compound": "A_Alkanes"},
        "Q0VKZ2": {"Gene": "AeAE_rdx", "Compound": "A_Alkanes"},
        "Q0VTA9": {"Gene": "AeAE_rdx", "Compound": "A_Alkanes"},
        "Q9HTK7": {"Gene": "AeAE_rdx", "Compound": "A_Alkanes"},
        "Q9HTK8": {"Gene": "AeAE_rdx", "Compound": "A_Alkanes"},
        "Q9WWW4": {"Gene": "AeAE_rdx", "Compound": "A_Alkanes"},
        "Q9WWW5": {"Gene": "AeAE_rdx", "Compound": "A_Alkanes"},
        "P17052": {"Gene": "AeAE_rdxR", "Compound": "A_Alkanes"},
        "Q0VTB0": {"Gene": "AeAE_rdxR", "Compound": "A_Alkanes"},
        "Q9HTK9": {"Gene": "AeAE_rdxR", "Compound": "A_Alkanes"},
        "Q9L4M8": {"Gene": "AeAE_rdxR", "Compound": "A_Alkanes"},
        "Q3YAT3": {"Gene": "AeBA_mpdB", "Compound": "B_Alkenes"},
        "Q3YAT5": {"Gene": "AeBA_mpdC", "Compound": "B_Alkenes"},
        "Q6XBI9": {"Gene": "AeBB_etnE", "Compound": "B_Alkenes"},
        "Q9RBP2": {"Gene": "AeBC_isoA", "Compound": "B_Alkenes"},
        "Q9RBP1": {"Gene": "AeBC_isoB", "Compound": "B_Alkenes"},
        "Q9RBP0": {"Gene": "AeBC_isoC", "Compound": "B_Alkenes"},
        "Q9RBN9": {"Gene": "AeBC_isoD", "Compound": "B_Alkenes"},
        "Q9RBN8": {"Gene": "AeBC_isoE", "Compound": "B_Alkenes"},
        "Q9RBN7": {"Gene": "AeBC_isoF", "Compound": "B_Alkenes"},
        "Q9RBP5": {"Gene": "AeBC_isoH", "Compound": "B_Alkenes"},
        "Q9RBP4": {"Gene": "AeBC_isoI", "Compound": "B_Alkenes"},
        "O87082": {"Gene": "AeBD_xamoA", "Compound": "B_Alkenes"},
        "Q9ZET6": {"Gene": "AeBD_xamoB", "Compound": "B_Alkenes"},
        "Q9ZET5": {"Gene": "AeBD_xamoC", "Compound": "B_Alkenes"},
        "Q9ZET4": {"Gene": "AeBD_xamoD", "Compound": "B_Alkenes"},
        "Q9ZET3": {"Gene": "AeBD_xamoE", "Compound": "B_Alkenes"},
        "A7IPX7": {"Gene": "AeBD_xamoF", "Compound": "B_Alkenes"},
        "Q56837": {"Gene": "AeBD_xecA", "Compound": "B_Alkenes"},
        "Q56839": {"Gene": "AeBD_xecC", "Compound": "B_Alkenes"},
        "Q56840": {"Gene": "AeBD_xecD", "Compound": "B_Alkenes"},
        "Q56841": {"Gene": "AeBD_xecE1", "Compound": "B_Alkenes"},
        "O52378": {"Gene": "AeCA_nagAa", "Compound": "C_Aromatics"},
        "O52381": {"Gene": "AeCA_nagAb", "Compound": "C_Aromatics"},
        "O52382": {"Gene": "AeCA_nagAc", "Compound": "C_Aromatics"},
        "O52383": {"Gene": "AeCA_nagAd", "Compound": "C_Aromatics"},
        "O52384": {"Gene": "AeCA_nagB", "Compound": "C_Aromatics"},
        "O33478": {"Gene": "AeCB_amnA", "Compound": "C_Aromatics"},
        "O33477": {"Gene": "AeCB_amnB", "Compound": "C_Aromatics"},
        "Q9KWS5": {"Gene": "AeCB_amnC", "Compound": "C_Aromatics"},
        "Q9KWS2": {"Gene": "AeCB_amnD", "Compound": "C_Aromatics"},
        "A4UVY1": {"Gene": "AeCC_nbaA", "Compound": "C_Aromatics"},
        "Q9HWT7": {"Gene": "AeCD_hpaB", "Compound": "C_Aromatics"},
        "Q57160": {"Gene": "AeCD_hpaB", "Compound": "C_Aromatics"},
        "Q9HWT6": {"Gene": "AeCD_hpaC", "Compound": "C_Aromatics"},
        "Q44249": {"Gene": "AeCE_atdA1", "Compound": "C_Aromatics"},
        "Q84BZ0": {"Gene": "AeCFI_andAa", "Compound": "C_Aromatics"},
        "Q84BZ1": {"Gene": "AeCFI_andAb", "Compound": "C_Aromatics"},
        "Q84BZ3": {"Gene": "AeCFI_andAc", "Compound": "C_Aromatics"},
        "Q84BZ2": {"Gene": "AeCFI_andAd", "Compound": "C_Aromatics"},
        "O85673": {"Gene": "AeCFI_antA", "Compound": "C_Aromatics"},
        "O85674": {"Gene": "AeCFI_antB", "Compound": "C_Aromatics"},
        "O85675": {"Gene": "AeCFI_antC", "Compound": "C_Aromatics"},
        "Q93FB8": {"Gene": "AeCFII_abmA", "Compound": "C_Aromatics"},
        "Q93FC0": {"Gene": "AeCFII_abmG1", "Compound": "C_Aromatics"},
        "Q93FB2": {"Gene": "AeCFII_abmG2", "Compound": "C_Aromatics"},
        "Q9I4X3": {"Gene": "AeCFII_pqsA", "Compound": "C_Aromatics"},
        "S6BVH5": {"Gene": "AeCFII_rauF", "Compound": "C_Aromatics"},
        "A4IT51": {"Gene": "AeCFIII_hpaH", "Compound": "C_Aromatics"},
        "Q07946": {"Gene": "AeCG_bedA", "Compound": "C_Aromatics"},
        "Q07947": {"Gene": "AeCG_bedB", "Compound": "C_Aromatics"},
        "Q07944": {"Gene": "AeCG_bedC1", "Compound": "C_Aromatics"},
        "Q07945": {"Gene": "AeCG_bedC2", "Compound": "C_Aromatics"},
        "F8J4S4": {"Gene": "AeCHI_benA", "Compound": "C_Aromatics"},
        "GOM3_benA": {"Gene": "AeCHI_benA", "Compound": "C_Aromatics"},
        "P07769": {"Gene": "AeCHI_benA", "Compound": "C_Aromatics"},
        "A0A7W5G636": {"Gene": "AeCHI_benB", "Compound": "C_Aromatics"},
        "GOM3_benB": {"Gene": "AeCHI_benB", "Compound": "C_Aromatics"},
        "P07770": {"Gene": "AeCHI_benB", "Compound": "C_Aromatics"},
        "GOM3_benC": {"Gene": "AeCHI_benC", "Compound": "C_Aromatics"},
        "P07771": {"Gene": "AeCHI_benC", "Compound": "C_Aromatics"},
        "GOM3_benD": {"Gene": "AeCHI_benD", "Compound": "C_Aromatics"},
        "P23102": {"Gene": "AeCHI_xylL", "Compound": "C_Aromatics"},
        "P23099": {"Gene": "AeCHI_xylX", "Compound": "C_Aromatics"},
        "P23100": {"Gene": "AeCHI_xylY", "Compound": "C_Aromatics"},
        "P23101": {"Gene": "AeCHI_xylZ", "Compound": "C_Aromatics"},
        "Q9AIX6": {"Gene": "AeCHII_boxA", "Compound": "C_Aromatics"},
        "Q9AIX7": {"Gene": "AeCHII_boxB", "Compound": "C_Aromatics"},
        "Q84HH6": {"Gene": "AeCHII_boxC", "Compound": "C_Aromatics"},
        "Q84HI0": {"Gene": "AeCHII_GI:23664434", "Compound": "C_Aromatics"},
        "P37333": {"Gene": "AeCI_bphA", "Compound": "C_Aromatics"},
        "Q52028": {"Gene": "AeCI_bphA", "Compound": "C_Aromatics"},
        "Q52438": {"Gene": "AeCI_bphA1", "Compound": "C_Aromatics"},
        "Q52439": {"Gene": "AeCI_bphA2", "Compound": "C_Aromatics"},
        "Q52440": {"Gene": "AeCI_bphA3", "Compound": "C_Aromatics"},
        "Q53122": {"Gene": "AeCI_bphAa", "Compound": "C_Aromatics"},
        "Q53123": {"Gene": "AeCI_bphAb", "Compound": "C_Aromatics"},
        "Q53124": {"Gene": "AeCI_bphAc", "Compound": "C_Aromatics"},
        "Q0S032": {"Gene": "AeCI_bphAd", "Compound": "C_Aromatics"},
        "P72220": {"Gene": "AeCI_bphB", "Compound": "C_Aromatics"},
        "P08694": {"Gene": "AeCI_bphB", "Compound": "C_Aromatics"},
        "P47227": {"Gene": "AeCI_bphB", "Compound": "C_Aromatics"},
        "P50206": {"Gene": "AeCI_bphB", "Compound": "C_Aromatics"},
        "P47228": {"Gene": "AeCI_bphC", "Compound": "C_Aromatics"},
        "P08695": {"Gene": "AeCI_bphC", "Compound": "C_Aromatics"},
        "P17297": {"Gene": "AeCI_bphC", "Compound": "C_Aromatics"},
        "Q52036": {"Gene": "AeCI_bphD", "Compound": "C_Aromatics"},
        "P17548": {"Gene": "AeCI_bphD", "Compound": "C_Aromatics"},
        "P47229": {"Gene": "AeCI_bphD", "Compound": "C_Aromatics"},
        "Q52011": {"Gene": "AeCI_bphD", "Compound": "C_Aromatics"},
        "P37334": {"Gene": "AeCI_bphE", "Compound": "C_Aromatics"},
        "Q46373": {"Gene": "AeCI_bphE", "Compound": "C_Aromatics"},
        "P37332": {"Gene": "AeCI_bphF", "Compound": "C_Aromatics"},
        "P51014": {"Gene": "AeCI_bphF", "Compound": "C_Aromatics"},
        "P37337": {"Gene": "AeCI_bphG", "Compound": "C_Aromatics"},
        "P51015": {"Gene": "AeCI_bphI", "Compound": "C_Aromatics"},
        "Q79AF6": {"Gene": "AeCI_bphJ", "Compound": "C_Aromatics"},
        "Q52039": {"Gene": "AeCI_bphX2", "Compound": "C_Aromatics"},
        "Q52040": {"Gene": "AeCI_bphX3", "Compound": "C_Aromatics"},
        "D5IGG0": {"Gene": "AeCJ_carAa", "Compound": "C_Aromatics"},
        "Q8G8B6": {"Gene": "AeCJ_carAa", "Compound": "C_Aromatics"},
        "D5IGG4": {"Gene": "AeCJ_carAc", "Compound": "C_Aromatics"},
        "Q8GI16": {"Gene": "AeCJ_carAc", "Compound": "C_Aromatics"},
        "Q9AQM4": {"Gene": "AeCJ_carC", "Compound": "C_Aromatics"},
        "P54721": {"Gene": "AeCKI_catE", "Compound": "C_Aromatics"},
        "P06622": {"Gene": "AeCKI_xylE", "Compound": "C_Aromatics"},
        "P23106": {"Gene": "AeCKI_xylF", "Compound": "C_Aromatics"},
        "P23105": {"Gene": "AeCKI_xylG", "Compound": "C_Aromatics"},
        "Q01468": {"Gene": "AeCKI_xylH", "Compound": "C_Aromatics"},
        "P49155": {"Gene": "AeCKI_xylI", "Compound": "C_Aromatics"},
        "P23107": {"Gene": "AeCKI_xylJ", "Compound": "C_Aromatics"},
        "P51019": {"Gene": "AeCKI_xylK", "Compound": "C_Aromatics"},
        "GOM3_catA": {"Gene": "AeCKII_catA", "Compound": "C_Aromatics"},
        "O33950": {"Gene": "AeCKII_catA", "Compound": "C_Aromatics"},
        "P86029": {"Gene": "AeCKII_catA", "Compound": "C_Aromatics"},
        "P95607": {"Gene": "AeCKII_catA", "Compound": "C_Aromatics"},
        "Q9AEQ0": {"Gene": "AeCKII_catA", "Compound": "C_Aromatics"},
        "GOM3_catB": {"Gene": "AeCKII_catB", "Compound": "C_Aromatics"},
        "P08310": {"Gene": "AeCKII_catB", "Compound": "C_Aromatics"},
        "F8J4S2": {"Gene": "AeCKII_catC", "Compound": "C_Aromatics"},
        "GOM3_catC": {"Gene": "AeCKII_catC", "Compound": "C_Aromatics"},
        "P00948": {"Gene": "AeCKII_catC", "Compound": "C_Aromatics"},
        "P20370": {"Gene": "AeCKII_pcaC", "Compound": "C_Aromatics"},
        "Q51956": {"Gene": "AeCKII_pcaF", "Compound": "C_Aromatics"},
        "P0A102": {"Gene": "AeCKII_pcaJ", "Compound": "C_Aromatics"},
        "Q52384": {"Gene": "AeCL_tcbAb", "Compound": "C_Aromatics"},
        "P11451": {"Gene": "AeCM_clcA", "Compound": "C_Aromatics"},
        "O67987": {"Gene": "AeCM_clcA", "Compound": "C_Aromatics"},
        "P27098": {"Gene": "AeCM_tcbC", "Compound": "C_Aromatics"},
        "P0A396": {"Gene": "AeCM_tfdC", "Compound": "C_Aromatics"},
        "P0A397": {"Gene": "AeCM_tfdC", "Compound": "C_Aromatics"},
        "P47243": {"Gene": "AeCN_dbfB", "Compound": "C_Aromatics"},
        "Q0ZIH5": {"Gene": "AeCO_dszC", "Compound": "C_Aromatics"},
        "Q93UV4": {"Gene": "AeCP_flnB", "Compound": "C_Aromatics"},
        "Q5NTE5": {"Gene": "AeCQ_desB", "Compound": "C_Aromatics"},
        "Q88JX5": {"Gene": "AeCQ_galA", "Compound": "C_Aromatics"},
        "Q88JX8": {"Gene": "AeCQ_galB", "Compound": "C_Aromatics"},
        "Q88JX9": {"Gene": "AeCQ_galC", "Compound": "C_Aromatics"},
        "Q88JY0": {"Gene": "AeCQ_galD", "Compound": "C_Aromatics"},
        "Q88JX6": {"Gene": "AeCQ_galP", "Compound": "C_Aromatics"},
        "Q88JX7": {"Gene": "AeCQ_galR", "Compound": "C_Aromatics"},
        "E8ZB61": {"Gene": "AeCQ_galT", "Compound": "C_Aromatics"},
        "O86041": {"Gene": "AeCRI_nagI", "Compound": "C_Aromatics"},
        "O86042": {"Gene": "AeCRI_nagK", "Compound": "C_Aromatics"},
        "GOM3_nagK": {"Gene": "AeCRI_nagK", "Compound": "C_Aromatics"},
        "O86043": {"Gene": "AeCRI_nagL", "Compound": "C_Aromatics"},
        "GOM3_nagL": {"Gene": "AeCRI_nagL", "Compound": "C_Aromatics"},
        "Q7X284": {"Gene": "AeCRI_sdgD", "Compound": "C_Aromatics"},
        "Q9F131": {"Gene": "AeCRI_xlnD", "Compound": "C_Aromatics"},
        "Q9S3U6": {"Gene": "AeCRI_xlnE", "Compound": "C_Aromatics"},
        "GOM3_xlnE": {"Gene": "AeCRI_xlnE", "Compound": "C_Aromatics"},
        "Q0QFQ2": {"Gene": "AeCRII_hbzE", "Compound": "C_Aromatics"},
        "Q0QFQ3": {"Gene": "AeCRII_hbzF", "Compound": "C_Aromatics"},
        "Q88E47": {"Gene": "AeCS_hmgA", "Compound": "C_Aromatics"},
        "B0T816": {"Gene": "AeCS_hmgA", "Compound": "C_Aromatics"},
        "B9JHZ9": {"Gene": "AeCS_hmgA", "Compound": "C_Aromatics"},
        "Q2NYM7": {"Gene": "AeCS_hmgA", "Compound": "C_Aromatics"},
        "Q4WHT9": {"Gene": "AeCS_hmgA", "Compound": "C_Aromatics"},
        "Q54QI4": {"Gene": "AeCS_hmgA", "Compound": "C_Aromatics"},
        "Q5RF05": {"Gene": "AeCS_hmgA", "Compound": "C_Aromatics"},
        "Q5WX50": {"Gene": "AeCS_hmgA", "Compound": "C_Aromatics"},
        "Q62I34": {"Gene": "AeCS_hmgA", "Compound": "C_Aromatics"},
        "Q6N0T9": {"Gene": "AeCS_hmgA", "Compound": "C_Aromatics"},
        "Q7WNZ3": {"Gene": "AeCS_hmgA", "Compound": "C_Aromatics"},
        "Q89XH1": {"Gene": "AeCS_hmgA", "Compound": "C_Aromatics"},
        "Q9VKJ0": {"Gene": "AeCS_hmgA", "Compound": "C_Aromatics"},
        "Q9X4F5": {"Gene": "AeCS_hmgA", "Compound": "C_Aromatics"},
        "Q9X4G0": {"Gene": "AeCS_hmgA", "Compound": "C_Aromatics"},
        "Q9Y041": {"Gene": "AeCS_hmgA", "Compound": "C_Aromatics"},
        "Q05353": {"Gene": "AeCT_hpcB", "Compound": "C_Aromatics"},
        "P42269": {"Gene": "AeCT_hpcC", "Compound": "C_Aromatics"},
        "Q05354": {"Gene": "AeCT_hpcD", "Compound": "C_Aromatics"},
        "P37352": {"Gene": "AeCT_hpcE", "Compound": "C_Aromatics"},
        "P42270": {"Gene": "AeCT_hpcG", "Compound": "C_Aromatics"},
        "Q47098": {"Gene": "AeCT_hpcH", "Compound": "C_Aromatics"},
        "P0A186": {"Gene": "AeCUI_doxA", "Compound": "C_Aromatics"},
        "P0A111": {"Gene": "AeCUI_doxB", "Compound": "C_Aromatics"},
        "P0A113": {"Gene": "AeCUI_doxD", "Compound": "C_Aromatics"},
        "P0A170": {"Gene": "AeCUI_doxE", "Compound": "C_Aromatics"},
        "P0A108": {"Gene": "AeCUI_doxG", "Compound": "C_Aromatics"},
        "Q9R9Y8": {"Gene": "AeCUI_nahB", "Compound": "C_Aromatics"},
        "P0A185": {"Gene": "AeCUII_ndoA_nahAB", "Compound": "C_Aromatics"},
        "P0A110": {"Gene": "AeCUII_ndoB_nahAC", "Compound": "C_Aromatics"},
        "P0A112": {"Gene": "AeCUII_ndoC_nahAD", "Compound": "C_Aromatics"},
        "Q52126": {"Gene": "AeCUII_ndoR_nahAA", "Compound": "C_Aromatics"},
        "Q7B7H7": {"Gene": "AeCUIII_nahC", "Compound": "C_Aromatics"},
        "Q51948": {"Gene": "AeCUIII_nahD", "Compound": "C_Aromatics"},
        "P0A144": {"Gene": "AeCUIII_nahE", "Compound": "C_Aromatics"},
        "P0A391": {"Gene": "AeCUIII_nahF", "Compound": "C_Aromatics"},
        "Q51973": {"Gene": "AeCV_cmtAa", "Compound": "C_Aromatics"},
        "Q51974": {"Gene": "AeCV_cmtAb", "Compound": "C_Aromatics"},
        "Q51975": {"Gene": "AeCV_cmtAc", "Compound": "C_Aromatics"},
        "Q51978": {"Gene": "AeCV_cmtAd", "Compound": "C_Aromatics"},
        "P0C622": {"Gene": "AeCV_cmtB", "Compound": "C_Aromatics"},
        "B0BK98": {"Gene": "AeCW_diox1", "Compound": "C_Aromatics"},
        "B0BK99": {"Gene": "AeCW_diox2", "Compound": "C_Aromatics"},
        "O24721": {"Gene": "AeCW_phdI", "Compound": "C_Aromatics"},
        "Q79EM8": {"Gene": "AeCW_phdJ", "Compound": "C_Aromatics"},
        "Q79EM7": {"Gene": "AeCW_phdK", "Compound": "C_Aromatics"},
        "Q9WXG7": {"Gene": "AeCW_phnB", "Compound": "C_Aromatics"},
        "P19729": {"Gene": "AeCX_dmpK", "Compound": "C_Aromatics"},
        "P19730": {"Gene": "AeCX_dmpL", "Compound": "C_Aromatics"},
        "P19731": {"Gene": "AeCX_dmpM", "Compound": "C_Aromatics"},
        "P19732": {"Gene": "AeCX_dmpN", "Compound": "C_Aromatics"},
        "P19733": {"Gene": "AeCX_dmpO", "Compound": "C_Aromatics"},
        "P19734": {"Gene": "AeCX_dmpP", "Compound": "C_Aromatics"},
        "P76077": {"Gene": "AeCY_paaA", "Compound": "C_Aromatics"},
        "P76078": {"Gene": "AeCY_paaB", "Compound": "C_Aromatics"},
        "P76079": {"Gene": "AeCY_paaC", "Compound": "C_Aromatics"},
        "P76080": {"Gene": "AeCY_paaD", "Compound": "C_Aromatics"},
        "P76081": {"Gene": "AeCY_paaE", "Compound": "C_Aromatics"},
        "O33469": {"Gene": "AeCY_paaK", "Compound": "C_Aromatics"},
        "P76085": {"Gene": "AeCY_paaK", "Compound": "C_Aromatics"},
        "ABG99212.1": {"Gene": "AeCZAI_padAa1", "Compound": "C_Aromatics"},
        "ABG99211.1": {"Gene": "AeCZAI_padAb1", "Compound": "C_Aromatics"},
        "Q68YB3": {"Gene": "AeCZAI_padAc1", "Compound": "C_Aromatics"},
        "ABG99207.1": {"Gene": "AeCZAI_padAd1", "Compound": "C_Aromatics"},
        "ABH00404.1": {"Gene": "AeCZAI_padB2", "Compound": "C_Aromatics"},
        "ABH00407.1": {"Gene": "AeCZAI_padC2", "Compound": "C_Aromatics"},
        "Q05182": {"Gene": "AeCZAII_pht2", "Compound": "C_Aromatics"},
        "Q05183": {"Gene": "AeCZAII_pht3", "Compound": "C_Aromatics"},
        "Q05184": {"Gene": "AeCZAII_pht4", "Compound": "C_Aromatics"},
        "Q05185": {"Gene": "AeCZAII_pht5", "Compound": "C_Aromatics"},
        "P22635": {"Gene": "AeCZBI_ligA", "Compound": "C_Aromatics"},
        "P22636": {"Gene": "AeCZBI_ligB", "Compound": "C_Aromatics"},
        "Q9KWL3": {"Gene": "AeCZBI_ligC", "Compound": "C_Aromatics"},
        "Q9AQI0": {"Gene": "AeCZBI_proA", "Compound": "C_Aromatics"},
        "Q75T27": {"Gene": "AeCZBI_proD", "Compound": "C_Aromatics"},
        "Q9AQI1": {"Gene": "AeCZBI_proH", "Compound": "C_Aromatics"},
        "Q75T30": {"Gene": "AeCZBI_proL", "Compound": "C_Aromatics"},
        "P32427": {"Gene": "AeCZBII_pcaB", "Compound": "C_Aromatics"},
        "GOM3_pcaB": {"Gene": "AeCZBII_pcaB", "Compound": "C_Aromatics"},
        "GOM3_pcaC": {"Gene": "AeCZBII_pcaC", "Compound": "C_Aromatics"},
        "Q88N36": {"Gene": "AeCZBII_pcaD", "Compound": "C_Aromatics"},
        "GOM3_pcaD": {"Gene": "AeCZBII_pcaD", "Compound": "C_Aromatics"},
        "GOM3_pcaF": {"Gene": "AeCZBII_pcaF", "Compound": "C_Aromatics"},
        "P00436": {"Gene": "AeCZBII_pcaG", "Compound": "C_Aromatics"},
        "P15109": {"Gene": "AeCZBII_pcaG", "Compound": "C_Aromatics"},
        "P20371": {"Gene": "AeCZBII_pcaG", "Compound": "C_Aromatics"},
        "GOM3_pcaG": {"Gene": "AeCZBII_pcaG", "Compound": "C_Aromatics"},
        "P00437": {"Gene": "AeCZBII_pcaH", "Compound": "C_Aromatics"},
        "P15110": {"Gene": "AeCZBII_pcaH", "Compound": "C_Aromatics"},
        "P20372": {"Gene": "AeCZBII_pcaH", "Compound": "C_Aromatics"},
        "GOM3_pcaH": {"Gene": "AeCZBII_pcaH", "Compound": "C_Aromatics"},
        "Q01103": {"Gene": "AeCZBII_pcaI", "Compound": "C_Aromatics"},
        "GOM3_pcaI": {"Gene": "AeCZBII_pcaI", "Compound": "C_Aromatics"},
        "GOM3_pcaJ": {"Gene": "AeCZBII_pcaJ", "Compound": "C_Aromatics"},
        "GOM3_pcaR": {"Gene": "AeCZBII_pcaR", "Compound": "C_Aromatics"},
        "C4TP01": {"Gene": "AeCZBIII_praA", "Compound": "C_Aromatics"},
        "C4TP02": {"Gene": "AeCZBIII_praB", "Compound": "C_Aromatics"},
        "C4TP07": {"Gene": "AeCZBIII_praC", "Compound": "C_Aromatics"},
        "C4TP06": {"Gene": "AeCZBIII_praD", "Compound": "C_Aromatics"},
        "C4TP08": {"Gene": "AeCZBIII_praH", "Compound": "C_Aromatics"},
        "A0A8F5VS38": {"Gene": "AeCZC_nidA", "Compound": "C_Aromatics"},
        "A0A8F5VT75": {"Gene": "AeCZC_nidB", "Compound": "C_Aromatics"},
        "I6VBV2": {"Gene": "AeCZC_pydA", "Compound": "C_Aromatics"},
        "I6V2D0": {"Gene": "AeCZC_pydB", "Compound": "C_Aromatics"},
        "P23262": {"Gene": "AeCZDI_nahG", "Compound": "C_Aromatics"},
        "Q9ZI64": {"Gene": "AeCZDI_nahW", "Compound": "C_Aromatics"},
        "Q0VH44": {"Gene": "AeCZDI_salA", "Compound": "C_Aromatics"},
        "O52379": {"Gene": "AeCZDII_nagG", "Compound": "C_Aromatics"},
        "O52380": {"Gene": "AeCZDII_nagH", "Compound": "C_Aromatics"},
        "P0CT50": {"Gene": "AeCZDIII_sdc", "Compound": "C_Aromatics"},
        "Q7X279": {"Gene": "AeCZDIV_sdgA", "Compound": "C_Aromatics"},
        "Q7X280": {"Gene": "AeCZDIV_sdgB", "Compound": "C_Aromatics"},
        "Q7X281": {"Gene": "AeCZDIV_sdgC", "Compound": "C_Aromatics"},
        "O06834": {"Gene": "AeCZE_styA", "Compound": "C_Aromatics"},
        "O33471": {"Gene": "AeCZE_styA", "Compound": "C_Aromatics"},
        "O06835": {"Gene": "AeCZE_styB", "Compound": "C_Aromatics"},
        "Q3C1E0": {"Gene": "AeCZF_tphA1I", "Compound": "C_Aromatics"},
        "Q3C1E3": {"Gene": "AeCZF_tphA2I", "Compound": "C_Aromatics"},
        "Q3C1E2": {"Gene": "AeCZF_tphA3I", "Compound": "C_Aromatics"},
        "Q3C1E1": {"Gene": "AeCZF_tphB", "Compound": "C_Aromatics"},
        "P39849": {"Gene": "AeCZGI_xylB", "Compound": "C_Aromatics"},
        "P43503": {"Gene": "AeCZGI_xylC", "Compound": "C_Aromatics"},
        "P21395": {"Gene": "AeCZGI_xylM", "Compound": "C_Aromatics"},
        "A3RJV6": {"Gene": "AeCZGII_dpgC", "Compound": "C_Aromatics"},
        "Q84DC3": {"Gene": "AeCZGII_mdlD", "Compound": "C_Aromatics"},
        "O52642": {"Gene": "AeCZGII_ntnC", "Compound": "C_Aromatics"},
        "Q59702": {"Gene": "AeCZGII_pchA", "Compound": "C_Aromatics"},
        "P09787": {"Gene": "AeCZGII_pchC", "Compound": "C_Aromatics"},
        "P09788": {"Gene": "AeCZGII_pchF", "Compound": "C_Aromatics"},
        "P00438": {"Gene": "AeCZGII_pobA", "Compound": "C_Aromatics"},
        "Q9R9T1": {"Gene": "AeCZGII_pobA", "Compound": "C_Aromatics"},
        "Q00456": {"Gene": "AeCZGII_tmoA", "Compound": "C_Aromatics"},
        "Q00457": {"Gene": "AeCZGII_tmoB", "Compound": "C_Aromatics"},
        "Q00458": {"Gene": "AeCZGII_tmoC", "Compound": "C_Aromatics"},
        "Q00459": {"Gene": "AeCZGII_tmoD", "Compound": "C_Aromatics"},
        "Q00460": {"Gene": "AeCZGII_tmoE", "Compound": "C_Aromatics"},
        "Q03304": {"Gene": "AeCZGII_tmoF", "Compound": "C_Aromatics"},
        "A5W4E9": {"Gene": "AeCZGII_todA", "Compound": "C_Aromatics"},
        "A5W4F0": {"Gene": "AeCZGII_todB", "Compound": "C_Aromatics"},
        "P13859": {"Gene": "AeCZGII_todD", "Compound": "C_Aromatics"},
        "P13453": {"Gene": "AeCZGII_todE", "Compound": "C_Aromatics"},
        "P23133": {"Gene": "AeCZGII_todF", "Compound": "C_Aromatics"},
        "Q9ANX4": {"Gene": "AeCZGII_tomA1", "Compound": "C_Aromatics"},
        "Q9ANX3": {"Gene": "AeCZGII_tomA2", "Compound": "C_Aromatics"},
        "Q8VSV8": {"Gene": "AeCZGII_tomA3", "Compound": "C_Aromatics"},
        "Q9ANX1": {"Gene": "AeCZGII_tomA4", "Compound": "C_Aromatics"},
        "Q9ANX0": {"Gene": "AeCZGII_tomA5", "Compound": "C_Aromatics"},
        "Q936V0": {"Gene": "AeDA_amsY", "Compound": "D_Biosurfactants"},
        "Q84BQ6": {"Gene": "AeDB_arfA", "Compound": "D_Biosurfactants"},
        "Q84BQ5": {"Gene": "AeDB_arfB", "Compound": "D_Biosurfactants"},
        "Q84BQ4": {"Gene": "AeDB_arfC", "Compound": "D_Biosurfactants"},
        "P0AAB2": {"Gene": "AeDC_wzb", "Compound": "D_Biosurfactants"},
        "P76387": {"Gene": "AeDC_wzc", "Compound": "D_Biosurfactants"},
        "Q9F4F7": {"Gene": "AeDD_ffp", "Compound": "D_Biosurfactants"},
        "P52754": {"Gene": "AeDE_hfb1", "Compound": "D_Biosurfactants"},
        "P79073": {"Gene": "AeDE_hfb2", "Compound": "D_Biosurfactants"},
        "BAB69698.1": {"Gene": "AeDF_ituA", "Compound": "D_Biosurfactants"},
        "BAB69699.1": {"Gene": "AeDF_ituB", "Compound": "D_Biosurfactants"},
        "BAB69700.1": {"Gene": "AeDF_ituC", "Compound": "D_Biosurfactants"},
        "BAB69697.1": {"Gene": "AeDF_ituD", "Compound": "D_Biosurfactants"},
        "S5ZJC7": {"Gene": "AeDG_sble", "Compound": "D_Biosurfactants"},
        "A0A0D1DZV5": {"Gene": "AeDH_emt1", "Compound": "D_Biosurfactants"},
        "Q9R9J1": {"Gene": "AeDI_mycA", "Compound": "D_Biosurfactants"},
        "Q9R9J0": {"Gene": "AeDI_mycB", "Compound": "D_Biosurfactants"},
        "Q9R9I9": {"Gene": "AeDI_mycC", "Compound": "D_Biosurfactants"},
        "P39845": {"Gene": "AeDJ_ppsA", "Compound": "D_Biosurfactants"},
        "P39846": {"Gene": "AeDJ_ppsB", "Compound": "D_Biosurfactants"},
        "P39847": {"Gene": "AeDJ_ppsC", "Compound": "D_Biosurfactants"},
        "P94459": {"Gene": "AeDJ_ppsD", "Compound": "D_Biosurfactants"},
        "O31827": {"Gene": "AeDJ_ppsE", "Compound": "D_Biosurfactants"},
        "Q51559": {"Gene": "AeDK_rhlA", "Compound": "D_Biosurfactants"},
        "AJK48831.1": {"Gene": "AeDK_rhlA", "Compound": "D_Biosurfactants"},
        "Q9HXE5": {"Gene": "AeDK_rhlB", "Compound": "D_Biosurfactants"},
        "Q9HYD1": {"Gene": "AeDK_rhlB", "Compound": "D_Biosurfactants"},
        "ADX31267.1": {"Gene": "AeDK_rhlB", "Compound": "D_Biosurfactants"},
        "Q9I4K5": {"Gene": "AeDK_rhlC", "Compound": "D_Biosurfactants"},
        "ADX31268.1": {"Gene": "AeDK_rhlC", "Compound": "D_Biosurfactants"},
        "P54292": {"Gene": "AeDK_rhlR", "Compound": "D_Biosurfactants"},
        "Q75PZ2": {"Gene": "AeDL_pswP", "Compound": "D_Biosurfactants"},
        "G0YF19": {"Gene": "AeDM_at", "Compound": "D_Biosurfactants"},
        "P39135": {"Gene": "AeDN_sfp", "Compound": "D_Biosurfactants"},
        "P27206": {"Gene": "AeDN_srfAA", "Compound": "D_Biosurfactants"},
        "Q04747": {"Gene": "AeDN_srfAB", "Compound": "D_Biosurfactants"},
        "GEN0105": {"Gene": "AeEA_GEN0105", "Compound": "E_Plastics"},
        "PElaccase": {"Gene": "AeEB_lac", "Compound": "E_Plastics"},
        "A0A0M4UPQ3": {"Gene": "AeEC_latA", "Compound": "E_Plastics"},
        "Q3L8N0": {"Gene": "AeEC_lcp", "Compound": "E_Plastics"},
        "A0A975YYR5": {"Gene": "AeEC_lcp", "Compound": "E_Plastics"},
        "A0A975YYT9": {"Gene": "AeEC_lcp", "Compound": "E_Plastics"},
        "H6N162": {"Gene": "AeEC_lcp", "Compound": "E_Plastics"},
        "H6N4Z1": {"Gene": "AeEC_lcp", "Compound": "E_Plastics"},
        "Q7X0P3": {"Gene": "AeEC_roxA", "Compound": "E_Plastics"},
        "A0A1S6Q8F9": {"Gene": "AeEC_roxB", "Compound": "E_Plastics"},
        "Q5YVW2": {"Gene": "AeED_NFA_28320", "Compound": "E_Plastics"},
        "P13397": {"Gene": "AeED_nylA", "Compound": "E_Plastics"},
        "P13398": {"Gene": "AeED_nylA", "Compound": "E_Plastics"},
        "P07061": {"Gene": "AeED_nylB", "Compound": "E_Plastics"},
        "Q14T91": {"Gene": "AeED_nylB", "Compound": "E_Plastics"},
        "Q14TA0": {"Gene": "AeED_nylB", "Compound": "E_Plastics"},
        "P14T92": {"Gene": "AeED_nylC", "Compound": "E_Plastics"},
        "Q1EPR4": {"Gene": "AeED_nylC", "Compound": "E_Plastics"},
        "Q1EPR5": {"Gene": "AeED_nylC", "Compound": "E_Plastics"},
        "Q79F77": {"Gene": "AeED_nylC", "Compound": "E_Plastics"},
        "Q588Z2": {"Gene": "AeEE_oph", "Compound": "E_Plastics"},
        "Q9LCQ7": {"Gene": "AeEE_pvaB", "Compound": "E_Plastics"},
        "P12625": {"Gene": "AeEFA_phaZ", "Compound": "E_Plastics"},
        "O05527": {"Gene": "AeEFA_phaZCac", "Compound": "E_Plastics"},
        "O82950": {"Gene": "AeEFA_phaZpst", "Compound": "E_Plastics"},
        "V5YU56": {"Gene": "AeEFB_hbd", "Compound": "E_Plastics"},
        "D3AU79": {"Gene": "AeEGA_CLOSTHATH_07193", "Compound": "E_Plastics"},
        "A0A145Z9W5": {"Gene": "AeEGA_est", "Compound": "E_Plastics"},
        "A0A1C9T772": {"Gene": "AeEGA_est", "Compound": "E_Plastics"},
        "A0A1C9T784": {"Gene": "AeEGA_est", "Compound": "E_Plastics"},
        "A0A1C9T7D1": {"Gene": "AeEGA_est", "Compound": "E_Plastics"},
        "A0A1C9T7D3": {"Gene": "AeEGA_est", "Compound": "E_Plastics"},
        "A0A1C9T7G6": {"Gene": "AeEGA_est", "Compound": "E_Plastics"},
        "A0A1C9T884": {"Gene": "AeEGA_est", "Compound": "E_Plastics"},
        "UPI000731EA1F": {"Gene": "AeEGA_est", "Compound": "E_Plastics"},
        "AKZ20828": {"Gene": "AeEGA_estA", "Compound": "E_Plastics"},
        "AKZ20829": {"Gene": "AeEGA_estA", "Compound": "E_Plastics"},
        "I9L7C1": {"Gene": "AeEGA_FB4_0780", "Compound": "E_Plastics"},
        "A0A1E1FNX8": {"Gene": "AeEGA_pbath", "Compound": "E_Plastics"},
        "A0A7I8E2Z4": {"Gene": "AeEGA_pbath", "Compound": "E_Plastics"},
        "W0TJ64": {"Gene": "AeEGB_cut190", "Compound": "E_Plastics"},
        "Q99174": {"Gene": "AeEHA_cut", "Compound": "E_Plastics"},
        "Q8RR62": {"Gene": "AeEHA_pbsA", "Compound": "E_Plastics"},
        "P52956": {"Gene": "AeEHB_cutL", "Compound": "E_Plastics"},
        "S6BC01": {"Gene": "AeEHC_PaCLE1", "Compound": "E_Plastics"},
        "A4UZ10": {"Gene": "AeEHD_plaM4", "Compound": "E_Plastics"},
        "A4UZ12": {"Gene": "AeEHD_plaM7", "Compound": "E_Plastics"},
        "A4UZ14": {"Gene": "AeEHE_plaM9", "Compound": "E_Plastics"},
        "P19833": {"Gene": "AeEHF_lip1", "Compound": "E_Plastics"},
        "Q874E9": {"Gene": "AeEHG_CLE1", "Compound": "E_Plastics"},
        "EF189714": {"Gene": "AeEIA_lipA", "Compound": "E_Plastics"},
        "Q0VLQ1": {"Gene": "AeEIB_ABO_2449", "Compound": "E_Plastics"},
        "Q0VQA3": {"Gene": "AeEIC_ABO_1197", "Compound": "E_Plastics"},
        "T1W006": {"Gene": "AeEIC_est", "Compound": "E_Plastics"},
        "Q6N9M9": {"Gene": "AeEIC_RPA1511", "Compound": "E_Plastics"},
        "Q0VQ49": {"Gene": "AeEID_estC", "Compound": "E_Plastics"},
        "Q9RHU4": {"Gene": "AeEJA_chi25", "Compound": "E_Plastics"},
        "Q96UT0": {"Gene": "AeEJA_cut2", "Compound": "E_Plastics"},
        "Q96US9": {"Gene": "AeEJA_cut3", "Compound": "E_Plastics"},
        "3GBS_A": {"Gene": "AeEJA_cutL", "Compound": "E_Plastics"},
        "F7IX06": {"Gene": "AeEJA_est2", "Compound": "E_Plastics"},
        "A0A679PDB4": {"Gene": "AeEJA_pclh", "Compound": "E_Plastics"},
        "B0FLR6": {"Gene": "AeEJA_PLAase2", "Compound": "E_Plastics"},
        "A0A0W0F4B8": {"Gene": "AeEJB_WG66_16246", "Compound": "E_Plastics"},
        "A0A0G3BI90": {"Gene": "AeEJC_AAW51_2473", "Compound": "E_Plastics"},
        "A0A1Z2SIQ1": {"Gene": "AeEJC_BSQ33_03270", "Compound": "E_Plastics"},
        "5AJH_A": {"Gene": "AeEJC_cut", "Compound": "E_Plastics"},
        "G9BY57": {"Gene": "AeEJC_cut", "Compound": "E_Plastics"},
        "E9KJL1": {"Gene": "AeEJC_cutA", "Compound": "E_Plastics"},
        "D4Q9N1": {"Gene": "AeEJC_est1", "Compound": "E_Plastics"},
        "R4YKL9": {"Gene": "AeEJC_lipA", "Compound": "E_Plastics"},
        "C3RYL0": {"Gene": "AeEJC_lipIAF5-2", "Compound": "E_Plastics"},
        "7NEI_B": {"Gene": "AeEJC_peth", "Compound": "E_Plastics"},
        "D1A2H1": {"Gene": "AeEJC_Tcur_0390", "Compound": "E_Plastics"},
        "WP_111881932.1": {"Gene": "AeEJD_est", "Compound": "E_Plastics"},
        "A0A0C1F4U8": {"Gene": "AeEJD_OA86_11720", "Compound": "E_Plastics"},
        "Q6UFW4": {"Gene": "AeEJE_phaZ", "Compound": "E_Plastics"},
        "A6WFI5": {"Gene": "AeEJF_cut", "Compound": "E_Plastics"},
        "A0A1M6F5V0": {"Gene": "AeEJG_SAMN04487908_10753", "Compound": "E_Plastics"},
        "Q02567": {"Gene": "AeEK_mnp1", "Compound": "E_Plastics"},
        "A9ZM00": {"Gene": "AeEL_pegA", "Compound": "E_Plastics"},
        "A9ZLZ8": {"Gene": "AeEL_pegC", "Compound": "E_Plastics"},
        "Q4W9V8": {"Gene": "AeEMA_AFUA_4G03560", "Compound": "E_Plastics"},
        "Q6A0I3": {"Gene": "AeEMA_bta2", "Compound": "E_Plastics"},
        "2FX5_A": {"Gene": "AeEMA_cut", "Compound": "E_Plastics"},
        "A0A075B5G4": {"Gene": "AeEMA_cut", "Compound": "E_Plastics"},
        "A0A031MKR8": {"Gene": "AeEMA_cut", "Compound": "E_Plastics"},
        "A0A1I6NU60": {"Gene": "AeEMA_cut", "Compound": "E_Plastics"},
        "A0A1T4KK94": {"Gene": "AeEMA_cut", "Compound": "E_Plastics"},
        "Q47RJ6": {"Gene": "AeEMA_cut", "Compound": "E_Plastics"},
        "Q47RJ7": {"Gene": "AeEMA_cut", "Compound": "E_Plastics"},
        "X0BTD8": {"Gene": "AeEMA_cut", "Compound": "E_Plastics"},
        "UPI00001688FB": {"Gene": "AeEMA_cut", "Compound": "E_Plastics"},
        "G8GER6": {"Gene": "AeEMA_cut_1", "Compound": "E_Plastics"},
        "ADV92528.1": {"Gene": "AeEMA_cut1", "Compound": "E_Plastics"},
        "E9LVH7": {"Gene": "AeEMA_cut1", "Compound": "E_Plastics"},
        "P00590": {"Gene": "AeEMA_cut1", "Compound": "E_Plastics"},
        "Q6A0I4": {"Gene": "AeEMA_cut2", "Compound": "E_Plastics"},
        "A0A1F4JXW8": {"Gene": "AeEMA_DLH", "Compound": "E_Plastics"},
        "A0A1W6L588": {"Gene": "AeEMA_DLH", "Compound": "E_Plastics"},
        "WP_085690612.1": {"Gene": "AeEMA_est", "Compound": "E_Plastics"},
        "W6R2Y2": {"Gene": "AeEMA_est", "Compound": "E_Plastics"},
        "A0A2H5Z9R5": {"Gene": "AeEMA_HRbin29_00073", "Compound": "E_Plastics"},
        "A0A0K8P8E7": {"Gene": "AeEMA_ISF6_0224", "Compound": "E_Plastics"},
        "A0A0K8P6T7": {"Gene": "AeEMA_ISF6_4831", "Compound": "E_Plastics"},
        "A0A1B0Z6Y3": {"Gene": "AeEMA_lip", "Compound": "E_Plastics"},
        "A0A078MGG8": {"Gene": "AeEMA_lip", "Compound": "E_Plastics"},
        "E8U721": {"Gene": "AeEMA_lip", "Compound": "E_Plastics"},
        "E9UPM2": {"Gene": "AeEMA_lip", "Compound": "E_Plastics"},
        "P41365": {"Gene": "AeEMA_lipB", "Compound": "E_Plastics"},
        "7CUV_A": {"Gene": "AeEMA_peth", "Compound": "E_Plastics"},
        "H6WX58": {"Gene": "AeEMA_peth", "Compound": "E_Plastics"},
        "LT571440": {"Gene": "AeEMA_peth", "Compound": "E_Plastics"},
        "LT571441": {"Gene": "AeEMA_peth", "Compound": "E_Plastics"},
        "LT571442": {"Gene": "AeEMA_peth", "Compound": "E_Plastics"},
        "LT571443": {"Gene": "AeEMA_peth", "Compound": "E_Plastics"},
        "LT571444": {"Gene": "AeEMA_peth", "Compound": "E_Plastics"},
        "LT571445": {"Gene": "AeEMA_peth", "Compound": "E_Plastics"},
        "7QJM": {"Gene": "AeEMA_peth", "Compound": "E_Plastics"},
        "E5BBQ2": {"Gene": "AeEMA_peth", "Compound": "E_Plastics"},
        "UPI00078146B5": {"Gene": "AeEMA_peth", "Compound": "E_Plastics"},
        "UPI000CEE1D89": {"Gene": "AeEMA_peth", "Compound": "E_Plastics"},
        "UPI0021FA591C": {"Gene": "AeEMA_peth", "Compound": "E_Plastics"},
        "UPI002203F04A": {"Gene": "AeEMA_peth", "Compound": "E_Plastics"},
        "UPI0024CD5ADA": {"Gene": "AeEMA_peth", "Compound": "E_Plastics"},
        "D7R6G8": {"Gene": "AeEMA_pnbA", "Compound": "E_Plastics"},
        "D1A9G5": {"Gene": "AeEMA_Tcur_1278", "Compound": "E_Plastics"},
        "A0A1W6L438": {"Gene": "AeEMA_DLH", "Compound": "E_Plastics"},
        "E9LVH8": {"Gene": "AeEMB_cut1", "Compound": "E_Plastics"},
        "E9LVH9": {"Gene": "AeEMB_cut2", "Compound": "E_Plastics"},
        "A0A1H6AD45": {"Gene": "AeEMC_peth", "Compound": "E_Plastics"},
        "Q0K9H3": {"Gene": "AeENA_phaZ2", "Compound": "E_Plastics"},
        "M9YBL3": {"Gene": "AeENB_AvCA6_03910", "Compound": "E_Plastics"},
        "Q9KIF2": {"Gene": "AeENB_fkbU", "Compound": "E_Plastics"},
        "Q52155": {"Gene": "AeENB_pDS-PS", "Compound": "E_Plastics"},
        "Q0KBZ6": {"Gene": "AeENB_phaY2", "Compound": "E_Plastics"},
        "A0A8W8": {"Gene": "AeENB_phaZ", "Compound": "E_Plastics"},
        "H6WL44": {"Gene": "AeENB_phaZ", "Compound": "E_Plastics"},
        "KFJ10595": {"Gene": "AeENB_phaZ", "Compound": "E_Plastics"},
        "O24719": {"Gene": "AeENB_phaZ", "Compound": "E_Plastics"},
        "P94146": {"Gene": "AeENB_phaZ", "Compound": "E_Plastics"},
        "Q5YEW3": {"Gene": "AeENB_phaZ", "Compound": "E_Plastics"},
        "Q71KW6": {"Gene": "AeENB_phaZ", "Compound": "E_Plastics"},
        "Q7WXF6": {"Gene": "AeENB_phaZ", "Compound": "E_Plastics"},
        "Q8GRC2": {"Gene": "AeENB_phaZ", "Compound": "E_Plastics"},
        "Q9LBN6": {"Gene": "AeENB_phaZ", "Compound": "E_Plastics"},
        "P52090": {"Gene": "AeENB_phaZ1", "Compound": "E_Plastics"},
        "Q0KCI0": {"Gene": "AeENB_phaZ1", "Compound": "E_Plastics"},
        "P72206": {"Gene": "AeENB_phaZ2", "Compound": "E_Plastics"},
        "Q0K7T2": {"Gene": "AeENB_phaZ2", "Compound": "E_Plastics"},
        "P72207": {"Gene": "AeENB_phaZ3", "Compound": "E_Plastics"},
        "Q0K4D5": {"Gene": "AeENB_phaZ3", "Compound": "E_Plastics"},
        "Q51870": {"Gene": "AeENB_phaZ4", "Compound": "E_Plastics"},
        "Q0K2G9": {"Gene": "AeENB_phaZ5", "Compound": "E_Plastics"},
        "Q51871": {"Gene": "AeENB_phaZ5", "Compound": "E_Plastics"},
        "Q0JZG9": {"Gene": "AeENB_phaZ6", "Compound": "E_Plastics"},
        "Q0JYJ1": {"Gene": "AeENB_phaZ7", "Compound": "E_Plastics"},
        "Q939Q9": {"Gene": "AeENB_phaZ7", "Compound": "E_Plastics"},
        "Q6MH49": {"Gene": "AeENB_phaZbd", "Compound": "E_Plastics"},
        "V5YT97": {"Gene": "AeENB_phaZc", "Compound": "E_Plastics"},
        "B2NHN2": {"Gene": "AeENB_phaZPfu", "Compound": "E_Plastics"},
        "Q3EMN2": {"Gene": "AeENB_RBTH_03267", "Compound": "E_Plastics"},
        "Q2RSX6": {"Gene": "AeENB_Rru_A1969", "Compound": "E_Plastics"},
        "B6UQD9": {"Gene": "AeENC_phaZd", "Compound": "E_Plastics"},
        "Q9ZNH8": {"Gene": "AeEND_phaZ", "Compound": "E_Plastics"},
        "Q51718": {"Gene": "AeENE_phaZ", "Compound": "E_Plastics"},
        "ALC24_4107": {"Gene": "AeEO_ALC24_4107", "Compound": "E_Plastics"},
        "Afu4g03560": {"Gene": "AeEO_phaZ", "Compound": "E_Plastics"},
        "T1W153": {"Gene": "AeEP_est", "Compound": "E_Plastics"},
        "W0M2H4": {"Gene": "AeEP_est", "Compound": "E_Plastics"},
        "Q83VD0": {"Gene": "AeEP_plaA", "Compound": "E_Plastics"},
        "B0FY08": {"Gene": "AeEP_PLAase3", "Compound": "E_Plastics"},
        "A4UZ11": {"Gene": "AeEP_plaM5", "Compound": "E_Plastics"},
        "P06873": {"Gene": "AeEP_PROK", "Compound": "E_Plastics"},
        "P29599": {"Gene": "AeEP_SUBB_LEDLE", "Compound": "E_Plastics"},
        "P00780": {"Gene": "AeEP_subC", "Compound": "E_Plastics"},
        "P29600": {"Gene": "AeEP_SUBS_LEDLE", "Compound": "E_Plastics"},
        "1AGY": {"Gene": "AeEQ_cut1", "Compound": "E_Plastics"},
        "Q9AHE8": {"Gene": "AeER_amdA", "Compound": "E_Plastics"},
        "WP_052671284.1": {"Gene": "AeER_est", "Compound": "E_Plastics"},
        "POM09750": {"Gene": "AeER_lip", "Compound": "E_Plastics"},
        "Q9WX47": {"Gene": "AeER_pudA", "Compound": "E_Plastics"},
        "A1Z374": {"Gene": "AeER_pueA", "Compound": "E_Plastics"},
        "Q4KBS6": {"Gene": "AeER_pueA", "Compound": "E_Plastics"},
        "Q9X3C0": {"Gene": "AeER_pueA", "Compound": "E_Plastics"},
        "Q4KBS3": {"Gene": "AeER_pueB", "Compound": "E_Plastics"},
        "Q9R9H2": {"Gene": "AeER_pueB", "Compound": "E_Plastics"},
        "Q9LAB9": {"Gene": "AeER_pulA", "Compound": "E_Plastics"},
        "A0A1B2N825": {"Gene": "AeES_BAY15_3292", "Compound": "E_Plastics"},
        "P77931": {"Gene": "AeES_pvaA", "Compound": "E_Plastics"},
        "Q588Z1": {"Gene": "AeES_pvaA", "Compound": "E_Plastics"},
    }
    # fmt: on

def compound_to_group(compound):
    """Map a compound name to its pathway group via regex, matching the R logic."""
    if not compound:
        return "Other"
    for pat, grp in _COMPOUND_PATTERNS:
        if pat.search(compound):
            return grp
    return "Other"


# ── Logging ───────────────────────────────────────────────────────────────────

class RunLog:
    def __init__(self, path):
        self._fh = open(path, "w")

    def __call__(self, *parts):
        stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        line = "[{}] {}".format(stamp, " ".join(str(p) for p in parts))
        print(line)
        self._fh.write(line + "\n")
        self._fh.flush()

    def close(self):
        try:
            self._fh.close()
        except Exception:
            pass


# ── Auto-locate 7_All_pathways.csv (mirrors R Block 4) ───────────────────────

def locate_pathways_csv(results_dir):
    """Search candidate directories relative to results_dir for the pathway
    reference table, exactly matching the R script's search order."""
    parent = os.path.dirname(results_dir)
    grandparent = os.path.dirname(parent)
    candidate_dirs = [
        os.path.join(results_dir, "R_scripts"),
        os.path.join(parent, "HADEG", "Tables"),
        os.path.join(parent, "HADEG", "Scripts"),
        os.path.join(grandparent, "HADEG", "Tables"),
        os.path.join(grandparent, "HADEG", "Scripts"),
        results_dir,
    ]
    for d in candidate_dirs:
        cand = os.path.join(d, "7_All_pathways.csv")
        if os.path.isfile(cand):
            return cand
    # recursive fallback
    for root, _dirs, files in os.walk(results_dir):
        for fn in files:
            if fn == "7_All_pathways.csv":
                return os.path.join(root, fn)
    return None


def load_pathways_csv(path, log):
    """Read 7_All_pathways.csv and return list of dicts with keys
    Protein_ID, Gene, Compound (at minimum)."""
    rows = []
    with open(path, newline="", errors="replace") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            rows.append(row)
    log(f"  Pathway reference loaded: {len(rows)} entries from {path}")
    return rows


# ── Parse HADEG proteinortho TSV (mirrors R Block 7) ─────────────────────────

def parse_hadeg_sample(sample_dir, sample_id, pathways_lookup, log):
    """Parse Results_HADEG.proteinortho.tsv for one sample.
    Returns dict with sample_id, n_hits, records (list of dicts), mag_labels."""
    tsv_path = os.path.join(sample_dir, "Results_HADEG.proteinortho.tsv")
    if not os.path.isfile(tsv_path):
        log(f"  [{sample_id}] Results_HADEG.proteinortho.tsv not found, skipping: {tsv_path}")
        return None

    with open(tsv_path, errors="replace") as fh:
        lines = [ln.rstrip("\n") for ln in fh if ln.strip()]
    if not lines:
        log(f"  [{sample_id}] Empty input table.")
        return None

    headers = lines[0].split("\t")
    # first three columns are Species, Genes, Alg_Conn
    # find the HADEG column and the MAG .faa columns
    hadeg_col_idx = None
    for i, h in enumerate(headers):
        if "HADEG_protein_database" in h:
            hadeg_col_idx = i
            break
    faa_indices = []
    faa_labels = []
    for i, h in enumerate(headers):
        if h.endswith(".faa") and i != hadeg_col_idx:
            faa_indices.append(i)
            label = re.sub(r"\.faa$", "", h)
            # strip sample_id prefix if present
            label = re.sub(r"^" + re.escape(sample_id) + r"[._]?", "", label)
            if not label:
                label = h.replace(".faa", "")
            faa_labels.append(label)

    if not faa_indices:
        log(f"  [{sample_id}] No MAG (.faa) columns detected.")
        return None
    if hadeg_col_idx is None:
        log(f"  [{sample_id}] No HADEG_protein_database column found.")
        return None

    records = []
    for line in lines[1:]:
        cols = line.split("\t")
        if len(cols) <= hadeg_col_idx:
            continue
        hadeg_val = cols[hadeg_col_idx].strip()
        if hadeg_val == "*" or not hadeg_val:
            continue

        # extract first Protein_ID
        first_entry = hadeg_val.split(",")[0].strip()
        protein_id = first_entry.split("|")[0].strip()

        # presence vector
        pres = {}
        for fi, fl in zip(faa_indices, faa_labels):
            val = cols[fi].strip() if fi < len(cols) else "*"
            pres[fl] = 0 if (val == "*" or not val) else 1

        # pathway annotation
        pathway_group = "Other"
        gene_label = protein_id
        if pathways_lookup:
            entry = pathways_lookup.get(protein_id.strip())
            if entry:
                pathway_group = compound_to_group(entry.get("Compound", ""))
                gene = entry.get("Gene", "")
                if gene and gene.strip():
                    # strip leading species prefix like AaCB_ from gene name
                    gene_label = re.sub(r"^[A-Za-z][a-z][A-Z][A-Za-z]_", "", gene.strip())
                else:
                    gene_label = protein_id

        records.append({
            "protein_id": protein_id,
            "gene_label": gene_label,
            "pathway_group": pathway_group,
            "presence": pres,
        })

    if not records:
        log(f"  [{sample_id}] No HADEG-annotated rows found (0 hits).")
        return {"sample_id": sample_id, "n_hits": 0, "records": None, "mag_labels": faa_labels}

    log(f"  [{sample_id}] Parsed {len(records)} HADEG-annotated ortholog groups across {len(faa_labels)} MAGs.")
    return {"sample_id": sample_id, "n_hits": len(records), "records": records, "mag_labels": faa_labels}


# ── Build network data (mirrors R Block 8) ────────────────────────────────────

def build_network_data(all_samples, multi_sample=False):
    """From parsed sample data, build combined long-format edges and node summaries."""
    combined = []  # list of (gene_label, pathway_group, mag_id)
    for sdata in all_samples:
        if not sdata or not sdata["records"]:
            continue
        sid = sdata["sample_id"]
        for rec in sdata["records"]:
            for mag, present in rec["presence"].items():
                if present:
                    mag_id = f"{sid}:{mag}" if multi_sample else mag
                    combined.append((rec["gene_label"], rec["pathway_group"], mag_id))

    if not combined:
        return None

    # gene_summary: gene_label -> {dom_group, total_mags}
    gene_mags = {}  # gene_label -> {group -> set(mag_ids)}
    for gl, pg, mid in combined:
        gene_mags.setdefault(gl, {}).setdefault(pg, set()).add(mid)
    gene_summary = {}
    for gl, grp_dict in gene_mags.items():
        dom_group = max(grp_dict, key=lambda g: len(grp_dict[g]))
        total_mags = len(set().union(*grp_dict.values()))
        gene_summary[gl] = {"dom_group": dom_group, "total_mags": total_mags}

    # mag_summary: mag_id -> {dom_group, total_genes}
    mag_genes = {}  # mag_id -> {group -> set(gene_labels)}
    for gl, pg, mid in combined:
        mag_genes.setdefault(mid, {}).setdefault(pg, set()).add(gl)
    mag_summary = {}
    for mid, grp_dict in mag_genes.items():
        dom_group = max(grp_dict, key=lambda g: len(grp_dict[g]))
        total_genes = len(set().union(*grp_dict.values()))
        mag_summary[mid] = {"dom_group": dom_group, "total_genes": total_genes}

    # active pathway groups
    active_groups = sorted(set(pg for _, pg, _ in combined) & set(PATHWAY_COLORS.keys()))

    return {
        "combined": combined,
        "gene_summary": gene_summary,
        "mag_summary": mag_summary,
        "active_groups": active_groups,
    }


# ── Build nodes & edges (mirrors R Block 10) ──────────────────────────────────

def _rescale(values, lo, hi):
    """Linearly rescale a list of numbers to [lo, hi]."""
    if not values:
        return []
    vmin = min(values)
    vmax = max(values)
    rng = vmax - vmin
    if rng == 0:
        mid = (lo + hi) / 2.0
        return [mid] * len(values)
    return [lo + (v - vmin) / rng * (hi - lo) for v in values]


def build_plot_data(net_data):
    """Build node and edge lists from network data."""
    gene_summary = net_data["gene_summary"]
    mag_summary = net_data["mag_summary"]
    active_groups = net_data["active_groups"]
    combined = net_data["combined"]

    nodes = []
    # hub nodes
    for grp in active_groups:
        nodes.append({
            "id": grp,
            "node_type": "hub",
            "dom_group": grp,
            "node_size": 8.0,
            "label": grp,
        })

    # gene nodes
    gene_labels = sorted(gene_summary.keys())
    gene_total_mags = [gene_summary[gl]["total_mags"] for gl in gene_labels]
    gene_sizes = _rescale(gene_total_mags, 4.0, 8.0)
    for gl, sz in zip(gene_labels, gene_sizes):
        nodes.append({
            "id": gl,
            "node_type": "gene",
            "dom_group": gene_summary[gl]["dom_group"],
            "node_size": sz,
            "label": gl,
        })

    # mag nodes
    mag_ids = sorted(mag_summary.keys())
    mag_total_genes = [mag_summary[m]["total_genes"] for m in mag_ids]
    mag_sizes = _rescale(mag_total_genes, 3.0, 6.5)
    for mid, sz in zip(mag_ids, mag_sizes):
        nodes.append({
            "id": mid,
            "node_type": "mag",
            "dom_group": mag_summary[mid]["dom_group"],
            "node_size": sz,
            "label": mid,
        })

    node_ids = {n["id"] for n in nodes}

    # hub → gene edges
    hub_gene_pairs = set()
    for gl, pg, _ in combined:
        if pg in active_groups:
            hub_gene_pairs.add((pg, gl))
    edges = []
    for frm, to in sorted(hub_gene_pairs):
        if frm in node_ids and to in node_ids:
            edges.append({
                "from": frm, "to": to,
                "edge_type": "hub_gene",
                "color_group": frm,
                "weight": 1.0,
            })

    # gene → MAG edges
    gene_mag_weight = {}
    for gl, pg, mid in combined:
        key = (gl, mid)
        gene_mag_weight.setdefault(key, {"weight": 0, "group": pg})
        gene_mag_weight[key]["weight"] += 1
    for (gl, mid), info in sorted(gene_mag_weight.items()):
        if gl in node_ids and mid in node_ids:
            edges.append({
                "from": gl, "to": mid,
                "edge_type": "gene_mag",
                "color_group": info["group"],
                "weight": info["weight"],
            })

    return {"nodes": nodes, "edges": edges, "hub_ids": active_groups}


# ── Fruchterman–Reingold layout (mirrors R Block 9) ───────────────────────────

def fr_layout(node_ids, edges, hub_ids, n_iter=220, seed=42):
    """Pure-Python Fruchterman–Reingold force-directed layout.
    Returns dict: node_id -> (x, y)."""
    rng = random.Random(seed)
    n = len(node_ids)
    if n == 0:
        return {}

    id_list = list(node_ids)
    idx = {nid: i for i, nid in enumerate(id_list)}
    pos = [[0.0, 0.0] for _ in range(n)]

    # initialise hub positions on a circle
    hub_valid = [h for h in hub_ids if h in idx]
    n_hubs = len(hub_valid)
    if n_hubs > 0:
        for i, h in enumerate(hub_valid):
            angle = 2 * math.pi * i / n_hubs
            pos[idx[h]] = [math.cos(angle) * 0.55, math.sin(angle) * 0.55]

    hub_set = set(hub_valid)
    non_hub = [nid for nid in id_list if nid not in hub_set]
    for nid in non_hub:
        r = math.sqrt(rng.random()) * 0.45
        theta = rng.uniform(0, 2 * math.pi)
        pos[idx[nid]] = [r * math.cos(theta), r * math.sin(theta)]

    # filter edges to those with both endpoints present
    edge_pairs = [(idx[e["from"]], idx[e["to"]]) for e in edges
                  if e["from"] in idx and e["to"] in idx]

    if not edge_pairs or n <= 1:
        return {nid: tuple(pos[idx[nid]]) for nid in id_list}

    k = math.sqrt(1.0 / n)
    W = 1.0
    temp_init = 0.12
    non_hub_indices = set(idx[nid] for nid in non_hub)

    for it in range(1, n_iter + 1):
        temp = temp_init * (1.0 - it / n_iter)
        disp = [[0.0, 0.0] for _ in range(n)]

        # repulsive forces
        for i in range(n - 1):
            for j in range(i + 1, n):
                dx = pos[i][0] - pos[j][0]
                dy = pos[i][1] - pos[j][1]
                dist = max(math.sqrt(dx * dx + dy * dy), 1e-6)
                f_r = k * k / dist
                ux, uy = dx / dist, dy / dist
                disp[i][0] += ux * f_r
                disp[i][1] += uy * f_r
                disp[j][0] -= ux * f_r
                disp[j][1] -= uy * f_r

        # attractive forces
        for ei, ej in edge_pairs:
            dx = pos[ei][0] - pos[ej][0]
            dy = pos[ei][1] - pos[ej][1]
            dist = max(math.sqrt(dx * dx + dy * dy), 1e-6)
            f_a = dist * dist / k
            ux, uy = dx / dist, dy / dist
            disp[ei][0] -= ux * f_a
            disp[ei][1] -= uy * f_a
            disp[ej][0] += ux * f_a
            disp[ej][1] += uy * f_a

        # apply displacements (non-hub only)
        for ni in non_hub_indices:
            d_norm = max(math.sqrt(disp[ni][0] ** 2 + disp[ni][1] ** 2), 1e-6)
            scale = min(d_norm, temp) / d_norm
            pos[ni][0] += disp[ni][0] * scale
            pos[ni][1] += disp[ni][1] * scale
            pos[ni][0] = max(-W, min(W, pos[ni][0]))
            pos[ni][1] = max(-W, min(W, pos[ni][1]))

    return {nid: (round(pos[idx[nid]][0], 6), round(pos[idx[nid]][1], 6))
            for nid in id_list}


# ── Build the JSON document ───────────────────────────────────────────────────

def build_document(results_dir, sample_id, log):
    hadeg_base = os.path.join(results_dir, "hadeg")
    if not os.path.isdir(hadeg_base):
        raise FileNotFoundError(f"hadeg/ folder not found under results_dir: {hadeg_base}")

    # locate pathways CSV
    pathways_csv_path = locate_pathways_csv(results_dir)
    pathways_lookup = {}
    if pathways_csv_path:
        log("Reading pathway reference table:", pathways_csv_path)
        rows = load_pathways_csv(pathways_csv_path, log)
        for row in rows:
            pid = row.get("Protein_ID", "").strip()
            if pid:
                pathways_lookup[pid] = row
    else:
        log("No 7_All_pathways.csv found; using built-in HADEG pathway table (629 entries).")
        builtin = _load_builtin_pathways()
        for pid, info in builtin.items():
            pathways_lookup[pid] = {"Protein_ID": pid, "Gene": info["Gene"], "Compound": info["Compound"]}

    # discover sample directories
    all_sample_dirs = sorted([
        os.path.join(hadeg_base, d)
        for d in os.listdir(hadeg_base)
        if os.path.isdir(os.path.join(hadeg_base, d))
        and not re.search(r"cache|tmp|temp", d, re.I)
    ])
    if not all_sample_dirs:
        raise FileNotFoundError(f"No sample directories found under {hadeg_base}")

    requested_all = (sample_id == "" or sample_id.upper() == "ALL")
    if not requested_all:
        matched = [d for d in all_sample_dirs if os.path.basename(d) == sample_id]
        if not matched:
            avail = ", ".join(os.path.basename(d) for d in all_sample_dirs)
            raise FileNotFoundError(
                f"Requested sample_id '{sample_id}' not found under {hadeg_base}. Available: {avail}")
        sample_dirs = matched
        log(f"Running in single-sample mode for: {sample_id}")
    else:
        sample_dirs = all_sample_dirs
        log(f"Running in ALL-sample mode: {len(sample_dirs)} sample folder(s) found.")

    sample_ids = [os.path.basename(d) for d in sample_dirs]
    multi_sample = len(sample_ids) > 1

    # parse all samples
    all_samples = []
    for sd, sid in zip(sample_dirs, sample_ids):
        parsed = parse_hadeg_sample(sd, sid, pathways_lookup, log)
        all_samples.append(parsed)

    total_hits = sum(s["n_hits"] for s in all_samples if s)
    if total_hits == 0:
        raise RuntimeError("Total HADEG hits across requested sample(s): 0.")

    # build network
    net_data = build_network_data(all_samples, multi_sample=multi_sample)
    if not net_data:
        raise RuntimeError("No network data could be constructed.")

    plot_data = build_plot_data(net_data)
    n_mag_nodes = sum(1 for n in plot_data["nodes"] if n["node_type"] == "mag")
    n_gene_nodes = sum(1 for n in plot_data["nodes"] if n["node_type"] == "gene")
    n_groups = len(net_data["active_groups"])

    log(f"Network: {n_mag_nodes} MAG nodes, {n_gene_nodes} gene nodes, "
        f"{n_groups} pathway groups, {total_hits} ortholog groups, "
        f"{len(plot_data['edges'])} edges")

    # run layout
    all_node_ids = [n["id"] for n in plot_data["nodes"]]
    log("Running Fruchterman-Reingold layout (n_iter=250)...")
    positions = fr_layout(all_node_ids, plot_data["edges"],
                          plot_data["hub_ids"], n_iter=250, seed=42)

    # scale positions for better visual spread (matches R ×1.8 factor)
    for nid in positions:
        x, y = positions[nid]
        positions[nid] = (round(x * 1.8, 6), round(y * 1.8, 6))

    # compose sample label
    sample_label = (f"{len(sample_ids)} samples" if multi_sample
                    else sample_ids[0])

    # subtitle WITHOUT Sample ID (modification #3)
    subtitle = (f"{n_mag_nodes} MAGs | {n_gene_nodes} detected genes | "
                f"{n_groups} pathway groups | {total_hits} ortholog groups with HADEG hits")

    # active palette
    active_palette = {g: PATHWAY_COLORS[g] for g in net_data["active_groups"]
                      if g in PATHWAY_COLORS}
    active_numbers = {g: PATHWAY_NUMBERS[g] for g in net_data["active_groups"]
                      if g in PATHWAY_NUMBERS}

    # build JSON nodes
    json_nodes = []
    for n in plot_data["nodes"]:
        px, py = positions.get(n["id"], (0, 0))
        json_nodes.append({
            "id": n["id"],
            "label": n["label"],
            "node_type": n["node_type"],
            "dom_group": n["dom_group"],
            "node_size": round(n["node_size"], 2),
            "x": px,
            "y": py,
        })

    # build JSON edges with coordinates
    json_edges = []
    for e in plot_data["edges"]:
        fx, fy = positions.get(e["from"], (0, 0))
        tx, ty = positions.get(e["to"], (0, 0))
        json_edges.append({
            "from": e["from"],
            "to": e["to"],
            "edge_type": e["edge_type"],
            "color_group": e["color_group"],
            "weight": e["weight"],
            "x0": fx, "y0": fy,
            "x1": tx, "y1": ty,
        })

    # rescale edge line widths for JSON
    gene_mag_weights = [e["weight"] for e in json_edges if e["edge_type"] == "gene_mag"]
    if gene_mag_weights:
        w_min = min(gene_mag_weights)
        w_max = max(gene_mag_weights)
        w_rng = w_max - w_min if w_max != w_min else 1
        for e in json_edges:
            if e["edge_type"] == "gene_mag":
                e["line_width"] = round(0.85 + (e["weight"] - w_min) / w_rng * 1.15, 2)
            else:
                e["line_width"] = 1.4

    doc = {
        "meta": {
            "title": "Hydrocarbon Degradation Pathway Co-occurrence Network",
            "sample_id": sample_label,
            "subtitle": subtitle,
            "schema_version": SCHEMA_VERSION,
            "generated_utc": datetime.datetime.now(datetime.timezone.utc)
                                    .strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "pathway_colors": active_palette,
        "pathway_numbers": active_numbers,
        "nodes": json_nodes,
        "edges": json_edges,
        "stats": {
            "n_mags": n_mag_nodes,
            "n_genes": n_gene_nodes,
            "n_groups": n_groups,
            "total_hits": total_hits,
            "active_groups": net_data["active_groups"],
        },
    }

    return doc


# ── Main ──────────────────────────────────────────────────────────────────────

def main(argv):
    if len(argv) != 3:
        sys.stderr.write(
            f"ERROR: Expected 3 args (RESULTS_DIR, OUTPUT_DIR, SAMPLE_ID), got {len(argv)}.\n"
            "Usage: python3 hadeg_network_json.py <RESULTS_DIR> <OUTPUT_DIR> <SAMPLE_ID>\n")
        return 1

    results_dir, output_dir, sample_id = argv
    os.makedirs(output_dir, exist_ok=True)

    log_tag = sample_id if sample_id and sample_id.upper() != "ALL" else "ALL"
    log = RunLog(os.path.join(output_dir, f"{log_tag}_HADEG_network_run.log"))
    log("Script: hadeg_network_json.py")
    log("Results dir:", results_dir)
    log("Output dir:", output_dir)
    log("Sample ID:", sample_id)

    status = 0
    try:
        if not os.path.isdir(results_dir):
            raise FileNotFoundError(f"results_dir not found: {results_dir}")

        doc = build_document(results_dir, sample_id, log)
        json_path = os.path.join(output_dir, "mag_hadeg_plots_data.json")
        with open(json_path, "w") as fh:
            json.dump(doc, fh, indent=2, ensure_ascii=False)
        log("JSON written ->", json_path)
        log("Script completed successfully.")
    except Exception as exc:
        log("ERROR:", str(exc))
        status = 1
    finally:
        log.close()
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
