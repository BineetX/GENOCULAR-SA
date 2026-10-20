#!/usr/bin/env bash
set -euo pipefail

REMOTE_USER="${REMOTE_USER:-rashmi}"
REMOTE_HOST="${REMOTE_HOST:-192.168.12.60}"
DEST_ROOT="${DEST_ROOT:-/data/dbs}"
SSH_SOCKET="${TMPDIR:-/tmp}/genoverse-meta-db-${USER}.sock"

declare -A DATABASES=(
  [kneaddata_db]="/home/rashmi/kneaddata_db/"
  [metaphlan_db]="/home/rashmi/.conda/envs/metaphlan_env/lib/python3.10/site-packages/metaphlan/metaphlan_databases/"
  [checkm2]="/home/rashmi/checkm2_db/"
  [gtdbtk]="/home/rashmi/.conda/envs/gtdbk_env/share/gtdbtk-2.7.2/db/"
  [hadeg]="/home/rashmi/Marine/Data/metagenome_test/workflow/HADEG/"
  [OPERA-MS]="/home/rashmi/Marine/OPERA-MS/"
)

TRANSFER_ORDER=(
  kneaddata_db
  checkm2
  metaphlan_db
  gtdbtk
  hadeg
  OPERA-MS
)

if (( $# > 0 )); then
  TRANSFER_ORDER=("$@")
fi

cleanup() {
  ssh -S "${SSH_SOCKET}" -O exit "${REMOTE_USER}@${REMOTE_HOST}" >/dev/null 2>&1 || true
  rm -f "${SSH_SOCKET}"
}
trap cleanup EXIT INT TERM

if ! command -v rsync >/dev/null 2>&1; then
  echo "ERROR: rsync is not installed." >&2
  exit 1
fi

mkdir -p "${DEST_ROOT}"

echo "Opening SSH connection to ${REMOTE_USER}@${REMOTE_HOST}."
echo "Enter the remote password when prompted."
ssh \
  -M \
  -S "${SSH_SOCKET}" \
  -o ControlPersist=12h \
  -o ServerAliveInterval=60 \
  -o ServerAliveCountMax=10 \
  -o StrictHostKeyChecking=accept-new \
  -fN \
  "${REMOTE_USER}@${REMOTE_HOST}"

for database in "${TRANSFER_ORDER[@]}"; do
  if [[ -z "${DATABASES[$database]:-}" ]]; then
    echo "ERROR: unknown database '${database}'." >&2
    echo "Known databases: ${!DATABASES[*]}" >&2
    exit 1
  fi

  source_path="${DATABASES[$database]}"
  destination="${DEST_ROOT}/${database}"

  mkdir -p "${destination}"

  echo
  echo "================================================================"
  echo "Transferring ${database}"
  echo "Source:      ${REMOTE_USER}@${REMOTE_HOST}:${source_path}"
  echo "Destination: ${destination}/"
  echo "================================================================"

  rsync \
    --archive \
    --human-readable \
    --partial \
    --append-verify \
    --info=progress2,stats2 \
    --exclude=".DS_Store" \
    -e "ssh -S ${SSH_SOCKET}" \
    "${REMOTE_USER}@${REMOTE_HOST}:${source_path}" \
    "${destination}/"

  echo "Verifying ${database} with an rsync checksum dry-run..."
  verification="$(
    rsync \
      --archive \
      --checksum \
      --dry-run \
      --itemize-changes \
      --exclude=".DS_Store" \
      -e "ssh -S ${SSH_SOCKET}" \
      "${REMOTE_USER}@${REMOTE_HOST}:${source_path}" \
      "${destination}/"
  )"

  if [[ -n "${verification}" ]]; then
    echo "ERROR: verification found differences for ${database}:" >&2
    echo "${verification}" >&2
    exit 1
  fi

  du -sh "${destination}"
  echo "Verified: ${database}"
done

echo
echo "All missing Metagenomics databases were transferred successfully."
echo
echo "Pipeline database paths:"
echo "  KNEADDATA_DB=/dbs/kneaddata_db"
echo "  METAPHLAN_DB=/dbs/metaphlan_db"
echo "  CHECKM2_DB=/dbs/checkm2/CheckM2_database/uniref100.KO.1.dmnd"
echo "  GTDBTK_DATA_PATH=/dbs/gtdbtk"
echo "  HADEG_DB=/dbs/hadeg/HADEG_protein_database_231119.faa"
echo "  OPERAMS_BIN=/dbs/OPERA-MS/OPERA-MS.pl"
echo "  OPERAMS_DB=/dbs/OPERA-MS/OPERA-MS-DB"
