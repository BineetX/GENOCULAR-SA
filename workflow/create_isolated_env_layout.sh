#!/usr/bin/env bash
set -euo pipefail

# Creates profile-isolated conda roots to avoid cross-pipeline conflicts.
#
# Layout:
#   /data/genoverse/smk_envs_profiles/<analysis>/<mode>/snakemake_conda
#   /data/genoverse/smk_envs_profiles/<analysis>/<mode>/tool_envs
#
# Usage:
#   bash workflow/create_isolated_env_layout.sh
#   bash workflow/create_isolated_env_layout.sh --build-wgs
#   bash workflow/create_isolated_env_layout.sh --build-metagenomics
#   bash workflow/create_isolated_env_layout.sh --build-all
#   GENOVERSE_PROFILE_ENVS_ROOT=/custom/root bash workflow/create_isolated_env_layout.sh --build-wgs

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${GENOVERSE_PROFILE_ENVS_ROOT:-/data/genoverse/smk_envs_profiles}"
BUILD_WGS=0
BUILD_META=0
FORCE_REBUILD=0

for arg in "$@"; do
  case "$arg" in
    --build-wgs)
      BUILD_WGS=1
      ;;
    --build-metagenomics)
      BUILD_META=1
      ;;
    --build-all)
      BUILD_WGS=1
      BUILD_META=1
      ;;
    --force-rebuild)
      FORCE_REBUILD=1
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: $0 [--build-wgs] [--build-metagenomics] [--build-all] [--force-rebuild]" >&2
      exit 2
      ;;
  esac
done

for analysis in wgs metagenomics; do
  for mode in short long hybrid; do
    mkdir -p "${ROOT}/${analysis}/${mode}/snakemake_conda"
  done
done

for mode in short long hybrid; do
  mkdir -p "${ROOT}/wgs/${mode}/tool_envs"
  mkdir -p "${ROOT}/metagenomics/${mode}/tool_envs"
done

echo "Created isolated env layout under: ${ROOT}"

if [[ "${BUILD_WGS}" == "1" ]]; then
  echo "Building WGS tool envs (short/long/hybrid) ..."
  wgs_extra=()
  if [[ "${FORCE_REBUILD}" == "1" ]]; then
    wgs_extra+=(--force-rebuild)
  fi
  WGS_ENV_ROOT="${ROOT}/wgs" bash "${SCRIPT_DIR}/UPDATE_2026/WGS/create_wgs_envs.sh" "${wgs_extra[@]}" short long hybrid
fi

if [[ "${BUILD_META}" == "1" ]]; then
  echo "Building metagenomics tool envs (short/long/hybrid) ..."
  meta_extra=()
  if [[ "${FORCE_REBUILD}" == "1" ]]; then
    meta_extra+=(--force-rebuild)
  fi
  META_ENV_ROOT="${ROOT}/metagenomics" bash "${SCRIPT_DIR}/UPDATE_2026/META/create_metagenomics_envs.sh" "${meta_extra[@]}" short long hybrid
fi
