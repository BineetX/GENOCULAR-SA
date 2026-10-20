#!/usr/bin/env bash
set -euo pipefail

# Build isolated conda/mamba envs for UPDATED WGS 2026 pipelines.
#
# Default output root:
#   /data/genoverse/smk_envs_profiles/wgs/{short,long,hybrid}/tool_envs/<env-name>
#
# Usage:
#   bash workflow/UPDATE_2026/WGS/create_wgs_envs.sh
#   WGS_ENV_ROOT=/custom/path bash workflow/UPDATE_2026/WGS/create_wgs_envs.sh
#   bash workflow/UPDATE_2026/WGS/create_wgs_envs.sh short
#   bash workflow/UPDATE_2026/WGS/create_wgs_envs.sh long hybrid
#   bash workflow/UPDATE_2026/WGS/create_wgs_envs.sh --force-rebuild short

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

WGS_ENV_ROOT="${WGS_ENV_ROOT:-/data/genoverse/smk_envs_profiles/wgs}"
LEGACY_ENV_DIR="${REPO_ROOT}/workflow/envs"
PREFER_LEGACY_YMLS="${PREFER_LEGACY_YMLS:-0}"
FORCE_REBUILD=0
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
  [GENOVERSE_ENV_ANTISMASH]="antismash8.yml"
  [GENOVERSE_ENV_BARRNAP]="barrnap.yml"
  [GENOVERSE_ENV_BUSCO]="busco.yml"
  [GENOVERSE_ENV_CCTYPER]="cctyper.yml"
  [GENOVERSE_ENV_CHECKM]="checkm.yml"
  [GENOVERSE_ENV_CUTADAPT]="cutadapt.yml"
  [GENOVERSE_ENV_DBCAN]="dbcan.yml"
  [GENOVERSE_ENV_EGGNOG]="eggnog-mapper.yml"
  [GENOVERSE_ENV_FASTANI]="fastani_env.yml"
  [GENOVERSE_ENV_FASTQC]="fastqc_env.yml"
  [GENOVERSE_ENV_FLYE]="flye.yml"
  [GENOVERSE_ENV_HADEG]="hadeg.yml"
  [GENOVERSE_ENV_INTERPROSCAN]="interproscan_env.yml"
  [GENOVERSE_ENV_KOFAMSCAN]="kofamscan_env.yml"
  [GENOVERSE_ENV_KRAKEN2]="kraken2_env.yml"
  [GENOVERSE_ENV_MARINE]="marine.yml"
  [GENOVERSE_ENV_NANOPLOT]="nanoplot.yml"
  [GENOVERSE_ENV_NCBI]="ncbi_env.yml"
  [GENOVERSE_ENV_PROKKA]="prokka.yml"
  [GENOVERSE_ENV_QUAST]="quast.yml"
  [GENOVERSE_ENV_RACON]="racon.yml"
  [GENOVERSE_ENV_UNICYCLER]="unicycler.yml"
)

ENV_BUILD_ORDER=(
  GENOVERSE_ENV_MARINE
  GENOVERSE_ENV_FASTQC
  GENOVERSE_ENV_KRAKEN2
  GENOVERSE_ENV_CUTADAPT
  GENOVERSE_ENV_PROKKA
  GENOVERSE_ENV_QUAST
  GENOVERSE_ENV_BUSCO
  GENOVERSE_ENV_CHECKM
  GENOVERSE_ENV_ABRICATE
  GENOVERSE_ENV_KOFAMSCAN
  GENOVERSE_ENV_DBCAN
  GENOVERSE_ENV_EGGNOG
  GENOVERSE_ENV_ANTISMASH
  GENOVERSE_ENV_HADEG
  GENOVERSE_ENV_BARRNAP
  GENOVERSE_ENV_FASTANI
  GENOVERSE_ENV_CCTYPER
  GENOVERSE_ENV_NCBI
  GENOVERSE_ENV_NANOPLOT
  GENOVERSE_ENV_FLYE
  GENOVERSE_ENV_RACON
  GENOVERSE_ENV_UNICYCLER
  GENOVERSE_ENV_INTERPROSCAN
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

resolve_yaml() {
  local mode_src="$1"
  local yaml_name="$2"
  if [[ "${PREFER_LEGACY_YMLS}" == "1" ]]; then
    if [[ -f "${LEGACY_ENV_DIR}/${yaml_name}" ]]; then
      echo "${LEGACY_ENV_DIR}/${yaml_name}"
      return
    fi
    if [[ -f "${mode_src}/${yaml_name}" ]]; then
      echo "${mode_src}/${yaml_name}"
      return
    fi
    echo ""
    return
  fi

  if [[ -f "${mode_src}/${yaml_name}" ]]; then
    echo "${mode_src}/${yaml_name}"
    return
  fi
  if [[ -f "${LEGACY_ENV_DIR}/${yaml_name}" ]]; then
    # fallback for env files not present in a specific mode folder
    echo "${LEGACY_ENV_DIR}/${yaml_name}"
    return
  fi
  echo ""
}

create_env() {
  local prefix="$1"
  local yaml_path="$2"

  mkdir -p "${BUILD_TMPDIR}"

  if (
    cd "${BUILD_TMPDIR}"
    TMPDIR="${BUILD_TMPDIR}" TMP="${BUILD_TMPDIR}" TEMP="${BUILD_TMPDIR}" "${CONDA_CMD}" env create \
      --prefix "${prefix}" \
      --file "${yaml_path}" \
      --yes \
      --channel-priority flexible
  ); then
    return 0
  fi

  if [[ "${CONDA_CMD}" != "conda" ]] && command -v conda >/dev/null 2>&1; then
    echo "Retrying with classic conda solver: ${prefix}" >&2
    (
      cd "${BUILD_TMPDIR}"
      TMPDIR="${BUILD_TMPDIR}" TMP="${BUILD_TMPDIR}" TEMP="${BUILD_TMPDIR}" CONDA_SOLVER=classic conda env create \
        --prefix "${prefix}" \
        --file "${yaml_path}" \
        --yes
    )
    return $?
  fi

  return 1
}

is_valid_env_prefix() {
  local prefix="$1"
  [[ -f "${prefix}/conda-meta/history" ]] || return 1
  if [[ "${prefix}" == */cctyper ]] && [[ ! -x "${prefix}/bin/python" ]]; then
    return 1
  fi
  if [[ -x "${prefix}/bin/python" ]]; then
    "${prefix}/bin/python" -c "import pyexpat" >/dev/null 2>&1 || return 1
  fi
  return 0
}

build_mode() {
  local mode="$1"
  local src_dir="${MODE_SRC[$mode]}"
  local out_dir="${WGS_ENV_ROOT}/${mode}/tool_envs"
  local -a failed_envs=()
  local built_count=0
  local skipped_count=0

  mkdir -p "${out_dir}"

  echo ""
  echo "=== Building WGS envs for mode: ${mode} ==="
  echo "source: ${src_dir}"
  echo "target: ${out_dir}"

  local env_var
  for env_var in "${ENV_BUILD_ORDER[@]}"; do
    local yaml_name="${ENV_FILE_MAP[$env_var]}"
    local yaml_path
    yaml_path="$(resolve_yaml "${src_dir}" "${yaml_name}")"

    if [[ -z "${yaml_path}" ]]; then
      continue
    fi

    local env_name="${yaml_name%.yml}"
    local prefix="${out_dir}/${env_name}"

    if [[ ! -r "${yaml_path}" ]]; then
      failed_envs+=("${env_name}")
      echo "[${mode}] FAILED: ${env_name} (yaml not readable: ${yaml_path})" >&2
      continue
    fi

    if [[ -d "${prefix}" ]] && [[ "${FORCE_REBUILD}" != "1" ]]; then
      if is_valid_env_prefix "${prefix}"; then
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
    built_count=$((built_count + 1))
  done

  local exports_file="${out_dir}/exports.sh"
  {
    echo "# Auto-generated by create_wgs_envs.sh"
    echo "# shellcheck shell=bash"
    local env_var
    for env_var in "${!ENV_FILE_MAP[@]}"; do
      local env_name="${ENV_FILE_MAP[$env_var]%.yml}"
      local prefix="${out_dir}/${env_name}"
      if [[ -d "${prefix}" ]]; then
        echo "export ${env_var}='${prefix}'"
      fi
    done
    echo "export SHARED_CONDA_PREFIX='${out_dir}'"
  } > "${exports_file}"

  echo "[${mode}] wrote ${exports_file}"
  echo "[${mode}] summary: built=${built_count} skipped=${skipped_count} failed=${#failed_envs[@]}"

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
echo "Done. WGS env root: ${WGS_ENV_ROOT}"

if [[ "${#FAILED_MODES[@]}" -gt 0 ]]; then
  echo "Modes with failures: ${FAILED_MODES[*]}" >&2
  exit 1
fi
