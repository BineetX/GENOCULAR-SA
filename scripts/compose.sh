#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -f "${ROOT}/.env" ]]; then
  echo "ERROR: ${ROOT}/.env is missing; run ./Setup.sh first." >&2
  exit 1
fi

accelerator="$(sed -n 's/^GENOCULAR_ACCELERATOR=//p' "${ROOT}/.env" | tail -n 1)"
compose=(docker compose --project-directory "${ROOT}" --env-file "${ROOT}/.env" -f "${ROOT}/compose.yml")
if [[ "${accelerator}" == "gpu" ]]; then
  compose+=(-f "${ROOT}/compose.gpu.yml")
fi
exec "${compose[@]}" "$@"
