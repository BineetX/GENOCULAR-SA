# GENOCULAR demonstration fixtures

Objects below `fixtures/profiles/<profile>/v1/` are seeded into the permanent
`demo-results` MinIO bucket by the `minio-setup` service. That bucket has no
expiry lifecycle. Normal `raw`, `results`, and `logs` retention does not apply.

The committed files are deliberately small starter placeholders so all six
demo buttons work immediately. Replace or extend them with curated outputs from
a successful, de-identified/public run before presenting the demo as a full
showcase.

Expected prefixes:

- `profiles/wgs-short/v1/`
- `profiles/wgs-long/v1/`
- `profiles/wgs-hybrid/v1/`
- `profiles/metagenomics-short/v1/`
- `profiles/metagenomics-long/v1/`
- `profiles/metagenomics-hybrid/v1/`

Keep normal tool folder names inside each prefix (for example `quast/`,
`multiqc/`, `analysis_plots/`, and `final_report/`). The existing frontend uses
those names to group artifacts with pipeline steps.

You can upload additional objects directly in the MinIO Console to the same
prefixes. Do not upload demonstration fixtures to the normal `results` bucket.
