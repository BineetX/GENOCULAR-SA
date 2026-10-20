export const ALLOWED_ANALYSIS_RENDERERS = new Set([
  "fastp_qc", "fastp_quality", "fastp_content", "fastp_rates", "fastp_retained",
  "metaquast_curve", "checkm2_quality", "mapping_depth", "mapping_flagstat", "mapping_density",
  "coverm_abundance", "mag_alpha", "mag_alpha_summary", "mag_rank_abundance",
  "gtdbtk_taxonomy", "gunc_sankey", "cctyper_synteny", "cctyper_subtypes", "cctyper_genemap",
  "dbcan_composition", "prokka_features", "hadeg_network", "virsorter_scores",
  "metaphlan_species", "metaphlan_alpha_summary", "metaphlan_rank_abundance",
  "read_alpha", "nonpareil_curve", "nanostat_qc", "meta_amr", "bracken_sunburst", "wgs_amr",
  "wgs_cazymes", "wgs_quality", "wgs_cog", "wgs_interpro", "wgs_kofam",
  "wgs_prokka", "wgs_repeats",
  "wgs_preprocessing", "wgs_lr_preprocessing", "wgs_sr_hexbin_v2",
  "wgs_quality_v2", "wgs_prokka_v2", "wgs_interpro_v2", "wgs_kofam_v2",
  "wgs_cazymes_v2", "wgs_cog_v2", "wgs_amr_v2", "wgs_repeats_v2",
  "mag_assembly_v2", "mag_binning_v2", "mag_busco_v2", "mag_barrnap_v2",
  "mag_prokka_v2", "mag_dbcan_v2", "mag_hadeg_v2", "mag_metaphlan_v2",
  "mag_metaphlan_alpha_v2", "mag_metaphlan_rank_v2", "mag_virsorter_v2",
  "mag_nonpareil_v2",
]);
// Accepted for older bundles, but superseded by Read-based alpha diversity.
export function isRedundantAnalysisSection(section) {
  return ["mag_metaphlan_rank_v2", "metaphlan_rank_abundance"].includes(section?.renderer || section?.id);
}
