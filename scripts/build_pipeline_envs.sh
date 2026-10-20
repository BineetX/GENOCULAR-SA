#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
selection="${1:-all}"
case "${selection}" in
  all|wgs|metagenomics) ;;
  *) echo "Usage: $0 [all|wgs|metagenomics]" >&2; exit 2 ;;
esac

"${ROOT}/scripts/compose.sh" build runner

if [[ "${selection}" == "all" || "${selection}" == "wgs" ]]; then
  echo "Building WGS pipeline environments. This can take several hours."
  "${ROOT}/scripts/compose.sh" run --rm --no-deps --entrypoint /bin/bash runner \
    -lc 'WGS_ENV_ROOT=/data/genoverse/smk_envs_profiles/wgs bash /project/workflow/UPDATE_2026/WGS/create_wgs_envs.sh'
fi

if [[ "${selection}" == "all" || "${selection}" == "metagenomics" ]]; then
  accelerator="$(sed -n 's/^GENOCULAR_ACCELERATOR=//p' "${ROOT}/.env" | tail -n 1)"
  skip_gpu=0
  [[ "${accelerator}" == "cpu" ]] && skip_gpu=1
  echo "Building metagenomics pipeline environments. This can take several hours."
  "${ROOT}/scripts/compose.sh" run --rm --no-deps --entrypoint /bin/bash \
    -e SKIP_SEMIBIN_GPU="${skip_gpu}" runner \
    -lc 'META_ENV_ROOT=/data/genoverse/smk_envs_profiles/metagenomics bash /project/workflow/UPDATE_2026/META/create_metagenomics_envs.sh'
fi

echo "Pipeline environments are ready."
