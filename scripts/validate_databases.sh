#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -f "${ROOT}/.env" ]]; then
  echo "ERROR: .env is missing; run ./Setup.sh first." >&2
  exit 1
fi

db_setting="$(sed -n 's/^GENOCULAR_DB_ROOT=//p' "${ROOT}/.env" | tail -n 1)"
if [[ -z "${db_setting}" ]]; then
  echo "ERROR: GENOCULAR_DB_ROOT is empty." >&2
  exit 1
fi
if [[ "${db_setting}" = /* ]]; then
  db_root="${db_setting}"
else
  db_root="${ROOT}/${db_setting#./}"
fi

manifest="${ROOT}/config/required-databases.txt"
missing=()
while IFS= read -r relative || [[ -n "${relative}" ]]; do
  [[ -z "${relative}" || "${relative}" == \#* ]] && continue
  if [[ "${relative}" == */ ]]; then
    [[ -d "${db_root}/${relative%/}" ]] || missing+=("${relative}")
  else
    [[ -s "${db_root}/${relative}" ]] || missing+=("${relative}")
  fi
done < "${manifest}"

if (( ${#missing[@]} )); then
  echo "ERROR: database tree is incomplete at ${db_root}" >&2
  printf '  missing: %s\n' "${missing[@]}" >&2
  exit 1
fi

echo "Database validation passed: ${db_root}"
