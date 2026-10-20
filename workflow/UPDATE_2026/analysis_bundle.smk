"""Shared terminal rule that turns completed pipeline results into validated UI assets.

The including Snakefile must define ANALYSIS_TYPE, ANALYSIS_MODE,
ANALYSIS_ROOT_PATTERN, ANALYSIS_SAMPLE, and ANALYSIS_PREREQUISITES.
"""

import os as _analysis_os
import sys as _analysis_sys

_ANALYSIS_GENERATOR = _analysis_os.environ.get(
    "ANALYSIS_ASSETS_SCRIPT",
    "/project/runner/generate_analysis_assets.py",
)
_ANALYSIS_PLOT_GENERATORS = _analysis_os.environ.get(
    "PLOT_GENERATORS_DIR",
    "/project/plot_generators",
)


rule analysis_plots:
    input:
        ANALYSIS_PREREQUISITES
    output:
        index = f"{ANALYSIS_ROOT_PATTERN}/analysis/index.json"
    params:
        out_root = lambda wildcards: ANALYSIS_ROOT_PATTERN.format(
            sample=getattr(wildcards, "sample", ANALYSIS_SAMPLE)
        ),
        sample = lambda wildcards: getattr(wildcards, "sample", ANALYSIS_SAMPLE),
        analysis = ANALYSIS_TYPE,
        mode = ANALYSIS_MODE,
        job_id = str(config.get("JOB_ID", "")),
        generator = _ANALYSIS_GENERATOR,
        plot_generators = _ANALYSIS_PLOT_GENERATORS,
        tool_env_root = _analysis_os.environ.get("SHARED_CONDA_PREFIX", ""),
        python = _analysis_sys.executable
    log:
        f"{ANALYSIS_ROOT_PATTERN}/analysis/generation.log"
    threads: 1
    shell:
        r"""
        set -euo pipefail
        mkdir -p "$(dirname {output.index:q})"
        {params.python:q} {params.generator:q} \
          --out-root {params.out_root:q} \
          --analysis {params.analysis:q} \
          --mode {params.mode:q} \
          --job-id {params.job_id:q} \
          --sample {params.sample:q} \
          --plot-generators-dir {params.plot_generators:q} \
          --tool-env-root {params.tool_env_root:q} \
          2>&1 | tee {log:q}
        test -s {output.index:q}
        """
