#!/usr/bin/env bash
set -euo pipefail

# Build isolated conda/mamba envs for UPDATED metagenomics 2026 pipelines.
#
# Default output root:
#   /data/genoverse/smk_envs_profiles/metagenomics/{short,long,hybrid}/tool_envs/<env-name>
#
# Usage:
#   bash workflow/UPDATE_2026/META/create_metagenomics_envs.sh
#   META_ENV_ROOT=/custom/path bash workflow/UPDATE_2026/META/create_metagenomics_envs.sh
#   bash workflow/UPDATE_2026/META/create_metagenomics_envs.sh short
#   bash workflow/UPDATE_2026/META/create_metagenomics_envs.sh --force-rebuild long hybrid
#   bash workflow/UPDATE_2026/META/create_metagenomics_envs.sh --check-only short

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

META_ENV_ROOT="${META_ENV_ROOT:-/data/genoverse/smk_envs_profiles/metagenomics}"
FORCE_REBUILD=0
CHECK_ONLY=0
BUILD_TMPDIR="${CONDA_ENV_BUILD_TMPDIR:-/data/genoverse/tmp/conda_build_tmp}"

if command -v mamba >/dev/null 2>&1; then
  CONDA_CMD="mamba"
elif command -v conda >/dev/null 2>&1; then
  CONDA_CMD="conda"
else
  echo "ERROR: neither mamba nor conda found in PATH" >&2
  exit 1
fi

declare -A MODE_SRC=(
  [short]="${SCRIPT_DIR}/Shortread"
  [long]="${SCRIPT_DIR}/Longread"
  [hybrid]="${SCRIPT_DIR}/Hybrid"
)

declare -A ENV_FILE_MAP=(
  [GENOVERSE_ENV_ABRICATE]="abricate-env.yml"
  [GENOVERSE_ENV_BINNING]="binning.yml"
  [GENOVERSE_ENV_SEMIBIN]="semibin-gpu.yml"
  [GENOVERSE_ENV_BUSCO]="busco.yml"
  [GENOVERSE_ENV_CCTYPER]="cctyper.yml"
  [GENOVERSE_ENV_CDHIT]="cdhit-env.yml"
  [GENOVERSE_ENV_CHECKM2]="checkm2_env.yml"
  [GENOVERSE_ENV_COVERM]="coverm-env.yml"
  [GENOVERSE_ENV_DBCAN]="dbcan.yml"
  [GENOVERSE_ENV_DREP]="drep_env.yml"
  [GENOVERSE_ENV_GTDBTK]="gtdbk_env.yml"
  [GENOVERSE_ENV_GUNC]="gunc_env.yml"
  [GENOVERSE_ENV_HADEG]="hadeg.yml"
  [GENOVERSE_ENV_KNEADDATA]="kneaddata_env.yml"
  [GENOVERSE_ENV_KRAKEN]="kraken2_env.yml"
  [GENOVERSE_ENV_MAPPING]="mapping_env.yml"
  [GENOVERSE_ENV_MARINE]="marine.yml"
  [GENOVERSE_ENV_MEDAKA]="medaka_env.yml"
  [GENOVERSE_ENV_METAFLYE]="metaflye_env.yml"
  [GENOVERSE_ENV_MEGAHIT]="megahit_env.yml"
  [GENOVERSE_ENV_METAPHLAN]="metaphlan_env.yml"
  [GENOVERSE_ENV_MULTIQC]="multiqc_env.yml"
  [GENOVERSE_ENV_NANOPLOT]="nanoplot.yml"
  [GENOVERSE_ENV_NONPAREIL]="nonpareil.yml"
  [GENOVERSE_ENV_OPERAMS]="operams.yml"
  [GENOVERSE_ENV_PROKKA]="prokka.yml"
  [GENOVERSE_ENV_QUAST]="quast.yml"
  [GENOVERSE_ENV_SALMON]="salmon-env.yml"
  [GENOVERSE_ENV_SEQKIT]="seqkit_env.yml"
  [GENOVERSE_ENV_VIRSORTER]="virsorter.yml"
)

ENV_BUILD_ORDER=(
  GENOVERSE_ENV_MARINE
  GENOVERSE_ENV_KNEADDATA
  GENOVERSE_ENV_KRAKEN
  GENOVERSE_ENV_METAPHLAN
  GENOVERSE_ENV_MEGAHIT
  GENOVERSE_ENV_METAFLYE
  GENOVERSE_ENV_NANOPLOT
  GENOVERSE_ENV_OPERAMS
  GENOVERSE_ENV_SEQKIT
  GENOVERSE_ENV_MEDAKA
  GENOVERSE_ENV_MAPPING
  GENOVERSE_ENV_BINNING
  GENOVERSE_ENV_SEMIBIN
  GENOVERSE_ENV_CHECKM2
  GENOVERSE_ENV_BUSCO
  GENOVERSE_ENV_GUNC
  GENOVERSE_ENV_GTDBTK
  GENOVERSE_ENV_DREP
  GENOVERSE_ENV_PROKKA
  GENOVERSE_ENV_CCTYPER
  GENOVERSE_ENV_DBCAN
  GENOVERSE_ENV_ABRICATE
  GENOVERSE_ENV_VIRSORTER
  GENOVERSE_ENV_CDHIT
  GENOVERSE_ENV_SALMON
  GENOVERSE_ENV_COVERM
  GENOVERSE_ENV_MULTIQC
  GENOVERSE_ENV_NONPAREIL
  GENOVERSE_ENV_QUAST
  GENOVERSE_ENV_HADEG
)

declare -A REQUIRED_BINS=(
  [abricate-env]="abricate"
  [binning]="metabat2 run_MaxBin.pl DAS_Tool jgi_summarize_bam_contig_depths prodigal SemiBin2"
  [semibin-gpu]="SemiBin2 python"
  [busco]="busco diamond python"
  [cctyper]="cctyper"
  [cdhit-env]="cd-hit cd-hit-est featureCounts"
  [checkm2_env]="checkm2 diamond python"
  [coverm-env]="coverm"
  [dbcan]="run_dbcan"
  [drep_env]="dRep mash"
  [gtdbk_env]="gtdbtk"
  [gunc_env]="gunc"
  [hadeg]="proteinortho diamond python"
  [kneaddata_env]="kneaddata"
  [kraken2_env]="kraken2 bracken"
  [mapping_env]="bowtie2 bowtie2-build samtools"
  [marine]="fastp prodigal"
  [medaka_env]="medaka_consensus minimap2"
  [metaflye_env]="flye minimap2"
  [megahit_env]="megahit"
  [metaphlan_env]="metaphlan bowtie2"
  [multiqc_env]="multiqc"
  [nanoplot]="NanoStat nanoq"
  [nonpareil]="nonpareil"
  [operams]="perl R java samtools nucmer show-coords"
  [prokka]="prokka barrnap"
  [quast]="metaquast.py quast.py"
  [salmon-env]="salmon"
  [seqkit_env]="seqkit"
  [virsorter]="virsorter"
)

normalize_mode() {
  case "${1,,}" in
    short|shortread) echo "short" ;;
    long|longread) echo "long" ;;
    hybrid) echo "hybrid" ;;
    *)
      echo "ERROR: invalid mode '$1' (expected: short|long|hybrid)" >&2
      exit 2
      ;;
  esac
}

is_valid_env_prefix() {
  local prefix="$1"
  local env_name="${2:-}"
  [[ -f "${prefix}/conda-meta/history" ]] || return 1
  if [[ "${prefix}" == */cctyper ]] && [[ ! -x "${prefix}/bin/python" ]]; then
    return 1
  fi
  if [[ -x "${prefix}/bin/python" ]]; then
    "${prefix}/bin/python" -c "import pyexpat" >/dev/null 2>&1 || return 1
  fi
  if [[ -n "${env_name}" && -n "${REQUIRED_BINS[$env_name]:-}" ]]; then
    local bin_name
    for bin_name in ${REQUIRED_BINS[$env_name]}; do
      [[ -x "${prefix}/bin/${bin_name}" ]] || return 1
    done
  fi
  if [[ "${env_name}" == "metaphlan_env" ]]; then
    local read_fastx
    read_fastx="$(find "${prefix}/lib" -path "*/site-packages/metaphlan/utils/read_fastx.py" -print -quit 2>/dev/null || true)"
    [[ -n "${read_fastx}" && -x "${read_fastx}" ]] || return 1
  fi
  if [[ "${env_name}" == "operams" ]]; then
    "${prefix}/bin/perl" -MSwitch -MFile::Which -MStatistics::Basic -MStatistics::R -e 1 \
      >/dev/null 2>&1 || return 1
    [[ -e "${prefix}/lib/libnsl.so.1" ]] || return 1
    [[ -f "${prefix}/share/opera-ms/OPERA-MS.pl" ]] || return 1
  fi
  if [[ "${env_name}" == "drep_env" ]]; then
    "${prefix}/bin/python" -c \
      'import pandas; assert int(pandas.__version__.split(".")[0]) < 3' \
      >/dev/null 2>&1 || return 1
    if [[ ! -x "${prefix}/bin/skani" && ! -x "${prefix}/bin/fastANI" && ! -x "${prefix}/bin/nucmer" ]]; then
      return 1
    fi
  fi
  if [[ "${env_name}" == "semibin-gpu" ]]; then
    "${prefix}/bin/python" -c \
      'import torch; assert torch.version.cuda, "SemiBin GPU environment resolved a CPU-only PyTorch build"' \
      >/dev/null 2>&1 || return 1
  fi
  if [[ "${env_name}" == "hadeg" ]]; then
    local diamond_version
    diamond_version="$("${prefix}/bin/diamond" version 2>/dev/null | awk '{print $NF}')"
    [[ "${diamond_version}" == "2.2.4" ]] || return 1
  fi
  if [[ "${env_name}" == "quast" ]]; then
    local quast_makeblastdb
    quast_makeblastdb="$(find "${prefix}" -type f -path '*/quast_libs/blast/makeblastdb' -print -quit 2>/dev/null || true)"
    if [[ -z "${quast_makeblastdb}" ]] && [[ -x "${prefix}/bin/makeblastdb" ]]; then
      quast_makeblastdb="${prefix}/bin/makeblastdb"
    fi
    [[ -n "${quast_makeblastdb}" ]] || return 1
    LD_LIBRARY_PATH="${prefix}/lib:${LD_LIBRARY_PATH:-}" "${quast_makeblastdb}" -version \
      >/dev/null 2>&1 || return 1
  fi
  return 0
}

repair_env_prefix() {
  local prefix="$1"
  local env_name="$2"

  if [[ "${env_name}" == "metaphlan_env" ]]; then
    local read_fastx
    read_fastx="$(find "${prefix}/lib" -path "*/site-packages/metaphlan/utils/read_fastx.py" -print -quit 2>/dev/null || true)"
    if [[ -n "${read_fastx}" ]]; then
      chmod +x "${read_fastx}"
    fi
  fi
  if [[ "${env_name}" == "operams" ]] && [[ ! -e "${prefix}/lib/libnsl.so.1" ]]; then
    local libnsl3
    libnsl3="$(find "${prefix}/lib" -maxdepth 1 -name 'libnsl.so.3*' -print -quit 2>/dev/null || true)"
    if [[ -n "${libnsl3}" ]]; then
      ln -s "$(basename "${libnsl3}")" "${prefix}/lib/libnsl.so.1"
    fi
  fi
  if [[ "${env_name}" == "operams" ]] && \
     ! "${prefix}/bin/perl" -MSwitch -MFile::Which -MStatistics::Basic -MStatistics::R -e 1 \
       >/dev/null 2>&1; then
    echo "[operams] Installing required Perl modules with cpanm"
    PATH="${prefix}/bin:${PATH}" PERL_MM_USE_DEFAULT=1 "${prefix}/bin/cpanm" --notest \
      Switch File::Which Statistics::Basic Statistics::R
  fi
  if [[ "${env_name}" == "operams" ]]; then
    local opera_source="${OPERAMS_SOURCE:-}"
    if [[ -z "${opera_source}" ]]; then
      if [[ -d /dbs/OPERA-MS ]]; then
        opera_source=/dbs/OPERA-MS
      elif [[ -d /data/dbs/OPERA-MS ]]; then
        opera_source=/data/dbs/OPERA-MS
      fi
    fi
    local opera_runtime="${prefix}/share/opera-ms"
    if [[ -n "${opera_source}" ]] && [[ ! -f "${opera_runtime}/OPERA-MS.pl" ]]; then
      echo "[operams] Creating writable runtime copy from ${opera_source}"
      mkdir -p "${opera_runtime}"
      local opera_item
      for opera_item in OPERA-MS.pl OPERA-MS-UTILS.py OPERA-LG SIGMA SHORT_READ_ANALYSIS bin src_utils tools_opera_ms; do
        [[ -e "${opera_source}/${opera_item}" ]] && cp -a "${opera_source}/${opera_item}" "${opera_runtime}/"
      done
    fi
    if [[ -d "${opera_runtime}/tools_opera_ms" ]]; then
      ln -sfn "${prefix}/bin/perl" "${opera_runtime}/tools_opera_ms/perl"
      ln -sfn "${prefix}/bin/samtools" "${opera_runtime}/tools_opera_ms/samtools"
      ln -sfn "${prefix}/bin/nucmer" "${opera_runtime}/tools_opera_ms/MUMmer3.23/nucmer"
      ln -sfn "${prefix}/bin/show-coords" "${opera_runtime}/tools_opera_ms/MUMmer3.23/show-coords"
    fi
  fi
}

create_env() {
  local prefix="$1"
  local yaml_path="$2"
  local -a build_env=(env)

  # The builder container may not expose the GPU until Compose is recreated.
  # Pin the solver virtual CUDA version so it selects the intended packages;
  # runtime GPU visibility is verified separately after the runner restart.
  if [[ "$(basename "${yaml_path}")" == "semibin-gpu.yml" ]]; then
    build_env+=("CONDA_OVERRIDE_CUDA=${SEMIBIN_CUDA_VERSION:-12.9}")
  fi

  mkdir -p "${BUILD_TMPDIR}"
  local staged_yaml="${BUILD_TMPDIR}/meta_$(basename "${prefix}")_$(basename "${yaml_path}")"
  cp "${yaml_path}" "${staged_yaml}"

  if (
    cd "${BUILD_TMPDIR}"
    "${build_env[@]}" TMPDIR="${BUILD_TMPDIR}" TMP="${BUILD_TMPDIR}" TEMP="${BUILD_TMPDIR}" "${CONDA_CMD}" env create \
      --prefix "${prefix}" \
      --file "${staged_yaml}" \
      --yes \
      --channel-priority flexible
  ); then
    return 0
  fi

  if [[ "${CONDA_CMD}" != "conda" ]] && command -v conda >/dev/null 2>&1; then
    echo "Retrying with classic conda solver: ${prefix}" >&2
    (
      cd "${BUILD_TMPDIR}"
      "${build_env[@]}" TMPDIR="${BUILD_TMPDIR}" TMP="${BUILD_TMPDIR}" TEMP="${BUILD_TMPDIR}" CONDA_SOLVER=classic conda env create \
        --prefix "${prefix}" \
        --file "${staged_yaml}" \
        --yes
    )
    return $?
  fi

  return 1
}

build_mode() {
  local mode="$1"
  local src_dir="${MODE_SRC[$mode]}"
  local out_dir="${META_ENV_ROOT}/${mode}/tool_envs"
  local -a failed_envs=()
  local -a missing_envs=()
  local built_count=0
  local skipped_count=0
  local valid_count=0

  mkdir -p "${out_dir}"

  echo ""
  echo "=== Building metagenomics envs for mode: ${mode} ==="
  echo "source: ${src_dir}"
  echo "target: ${out_dir}"

  local env_var
  for env_var in "${ENV_BUILD_ORDER[@]}"; do
    if [[ "${env_var}" == "GENOVERSE_ENV_SEMIBIN" ]] && [[ "${SKIP_SEMIBIN_GPU:-0}" == "1" ]]; then
      echo "[${mode}] SKIP: semibin-gpu (CPU deployment)"
      skipped_count=$((skipped_count + 1))
      continue
    fi
    local yaml_name="${ENV_FILE_MAP[$env_var]}"
    local yaml_path="${src_dir}/${yaml_name}"
    local env_name="${yaml_name%.yml}"
    local prefix="${out_dir}/${env_name}"

    if [[ ! -f "${yaml_path}" ]]; then
      missing_envs+=("${env_name}")
      continue
    fi

    if [[ ! -r "${yaml_path}" ]]; then
      failed_envs+=("${env_name}")
      echo "[${mode}] FAILED: ${env_name} (yaml not readable: ${yaml_path})" >&2
      continue
    fi

    if [[ "${CHECK_ONLY}" == "1" ]]; then
      if is_valid_env_prefix "${prefix}" "${env_name}"; then
        echo "[${mode}] OK: ${env_name}"
        valid_count=$((valid_count + 1))
      else
        echo "[${mode}] MISSING/INVALID: ${env_name}" >&2
        failed_envs+=("${env_name}")
      fi
      continue
    fi

    if [[ -d "${prefix}" ]] && [[ "${FORCE_REBUILD}" != "1" ]]; then
      repair_env_prefix "${prefix}" "${env_name}"
      if is_valid_env_prefix "${prefix}" "${env_name}"; then
        echo "[${mode}] SKIP: ${env_name} (already exists)"
        skipped_count=$((skipped_count + 1))
        continue
      fi
      echo "[${mode}] WARN: ${env_name} exists but looks incomplete; rebuilding"
      rm -rf "${prefix}"
    elif [[ -d "${prefix}" ]] && [[ "${FORCE_REBUILD}" == "1" ]]; then
      echo "[${mode}] REBUILD: ${env_name}"
      rm -rf "${prefix}"
    fi

    echo "[${mode}] BUILD: ${env_name} <= ${yaml_path}"
    if ! create_env "${prefix}" "${yaml_path}"; then
      rm -rf "${prefix}"
      failed_envs+=("${env_name}")
      echo "[${mode}] FAILED: ${env_name}" >&2
      continue
    fi
    repair_env_prefix "${prefix}" "${env_name}"
    if ! is_valid_env_prefix "${prefix}" "${env_name}"; then
      rm -rf "${prefix}"
      failed_envs+=("${env_name}")
      echo "[${mode}] FAILED: ${env_name} (created env missing required binaries)" >&2
      continue
    fi
    built_count=$((built_count + 1))
  done

  if [[ "${CHECK_ONLY}" != "1" ]]; then
    local exports_file="${out_dir}/exports.sh"
    {
      echo "# Auto-generated by create_metagenomics_envs.sh"
      echo "# shellcheck shell=bash"
      local env_var
      for env_var in "${!ENV_FILE_MAP[@]}"; do
        local yaml_name="${ENV_FILE_MAP[$env_var]}"
        local env_name="${yaml_name%.yml}"
        local prefix="${out_dir}/${env_name}"
        if [[ -d "${prefix}" ]]; then
          echo "export ${env_var}='${prefix}'"
        fi
      done
      echo "export SHARED_CONDA_PREFIX='${out_dir}'"
    } > "${exports_file}"

    echo "[${mode}] wrote ${exports_file}"
  fi
  echo "[${mode}] summary: built=${built_count} skipped=${skipped_count} valid=${valid_count} failed=${#failed_envs[@]}"
  if [[ "${#missing_envs[@]}" -gt 0 ]]; then
    echo "[${mode}] skipped absent YAMLs: ${missing_envs[*]}"
  fi

  if [[ "${#failed_envs[@]}" -gt 0 ]]; then
    echo "[${mode}] env creation failures: ${failed_envs[*]}" >&2
    return 1
  fi

  return 0
}

declare -a REQUESTED_MODES=()
for raw in "$@"; do
  case "$raw" in
    --force-rebuild)
      FORCE_REBUILD=1
      ;;
    --check-only)
      CHECK_ONLY=1
      ;;
    *)
      REQUESTED_MODES+=("$(normalize_mode "${raw}")")
      ;;
  esac
done

if [[ "${#REQUESTED_MODES[@]}" -eq 0 ]]; then
  REQUESTED_MODES=(short long hybrid)
fi

declare -a FAILED_MODES=()
for mode in "${REQUESTED_MODES[@]}"; do
  if ! build_mode "${mode}"; then
    FAILED_MODES+=("${mode}")
  fi
done

echo ""
echo "Done. Metagenomics env root: ${META_ENV_ROOT}"

if [[ "${#FAILED_MODES[@]}" -gt 0 ]]; then
  echo "Modes with failures: ${FAILED_MODES[*]}" >&2
  exit 1
fi
