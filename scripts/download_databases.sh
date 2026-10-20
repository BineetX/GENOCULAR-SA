#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${ROOT}/databases.env"
if [[ ! -f "${CONFIG}" ]]; then
  echo "ERROR: ${CONFIG} is missing. Copy databases.env.example and configure it." >&2
  exit 1
fi
if [[ ! -f "${ROOT}/.env" ]]; then
  echo "ERROR: ${ROOT}/.env is missing; run ./Setup.sh first." >&2
  exit 1
fi

# These files are local administrator-controlled configuration.
# shellcheck disable=SC1091
source "${ROOT}/.env"
# shellcheck disable=SC1090
source "${CONFIG}"

db_setting="${GENOCULAR_DB_ROOT:-./data/databases}"
if [[ "${db_setting}" = /* ]]; then
  db_root="${db_setting}"
else
  db_root="${ROOT}/${db_setting#./}"
fi
mkdir -p "${db_root}"

case "${DB_SOURCE:-}" in
  existing)
    echo "Using existing database directory: ${db_root}"
    ;;

  google-drive-folder)
    : "${GDRIVE_FOLDER_ID:?Set GDRIVE_FOLDER_ID in databases.env}"
    : "${GDRIVE_SERVICE_ACCOUNT_JSON:?Set GDRIVE_SERVICE_ACCOUNT_JSON in databases.env}"
    if [[ "${GDRIVE_FOLDER_ID}" == "CHANGE_ME" ]]; then
      echo "ERROR: set GDRIVE_FOLDER_ID in databases.env." >&2
      exit 1
    fi
    credential="${GDRIVE_SERVICE_ACCOUNT_JSON}"
    [[ "${credential}" = /* ]] || credential="${ROOT}/${credential#./}"
    if [[ ! -f "${credential}" ]]; then
      echo "ERROR: Google service-account JSON not found: ${credential}" >&2
      exit 1
    fi
    echo "Synchronizing Google Drive folder into ${db_root} (existing files are retained)..."
    docker run --rm --user "$(id -u):$(id -g)" \
      -e RCLONE_CONFIG_GDRIVE_TYPE=drive \
      -e RCLONE_CONFIG_GDRIVE_SCOPE=drive.readonly \
      -e RCLONE_CONFIG_GDRIVE_ROOT_FOLDER_ID="${GDRIVE_FOLDER_ID}" \
      -e RCLONE_CONFIG_GDRIVE_SERVICE_ACCOUNT_FILE=/run/secrets/gdrive.json \
      -v "${credential}:/run/secrets/gdrive.json:ro" \
      -v "${db_root}:/data" \
      "${RCLONE_IMAGE:-rclone/rclone:1.71.2}" \
      copy gdrive: /data --progress --create-empty-src-dirs \
      --transfers "${RCLONE_TRANSFERS:-4}" --checkers "${RCLONE_CHECKERS:-8}" \
      --retries 10 --low-level-retries 20
    ;;

  google-drive-public-folder)
    : "${GDRIVE_PUBLIC_FOLDER_URL:?Set GDRIVE_PUBLIC_FOLDER_URL in databases.env}"
    if [[ "${GDRIVE_PUBLIC_FOLDER_URL}" == *CHANGE_ME* ]]; then
      echo "ERROR: set GDRIVE_PUBLIC_FOLDER_URL in databases.env." >&2
      exit 1
    fi
    echo "Downloading public Google Drive folder into ${db_root}..."
    docker run --rm --user "$(id -u):$(id -g)" \
      -e HOME=/tmp -e GDRIVE_URL="${GDRIVE_PUBLIC_FOLDER_URL}" \
      -v "${db_root}:/data" \
      "${GDOWN_IMAGE:-python:3.12-slim}" \
      sh -lc 'python -m pip install --disable-pip-version-check --no-cache-dir --target /tmp/gdownlib gdown==5.2.0 >/dev/null && PYTHONPATH=/tmp/gdownlib python -m gdown --folder --remaining-ok "$GDRIVE_URL" -O /data'
    ;;

  *)
    echo "ERROR: DB_SOURCE must be existing, google-drive-folder, or google-drive-public-folder." >&2
    exit 1
    ;;
esac

exec "${ROOT}/scripts/validate_databases.sh"
