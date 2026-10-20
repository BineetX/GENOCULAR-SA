#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
lan_host=""
http_port=8080
console_port=9001
accelerator=auto
database_path=""
skip_databases=0
skip_pipeline_envs=0
skip_models=0
config_only=0

usage() {
  cat <<'EOF'
Usage: ./Setup.sh [options]

Options:
  --lan-host IP_OR_DNS       Address other LAN machines use (auto-detected)
  --http-port PORT           Web/API port (default: 8080)
  --console-port PORT        MinIO administration port (default: 9001)
  --gpu | --cpu              Select NVIDIA GPU or portable CPU mode (auto)
  --database-path PATH       Use an existing database tree; do not download it
  --skip-databases           Skip database download and validation
  --skip-pipeline-envs       Skip the long Conda environment build
  --skip-models              Do not pull Ollama models
  --config-only              Generate/validate configuration, then stop
  -h, --help                 Show this help

Firebase Web values may be exported as VITE_FIREBASE_* before the first run,
or entered in .env after Setup.sh creates it.
EOF
}

while (( $# )); do
  case "$1" in
    --lan-host) lan_host="${2:?--lan-host requires a value}"; shift 2 ;;
    --http-port) http_port="${2:?--http-port requires a value}"; shift 2 ;;
    --console-port) console_port="${2:?--console-port requires a value}"; shift 2 ;;
    --gpu) accelerator=gpu; shift ;;
    --cpu) accelerator=cpu; shift ;;
    --database-path) database_path="${2:?--database-path requires a value}"; shift 2 ;;
    --skip-databases) skip_databases=1; shift ;;
    --skip-pipeline-envs) skip_pipeline_envs=1; shift ;;
    --skip-models) skip_models=1; shift ;;
    --config-only) config_only=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

for command_name in python3 docker curl; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "ERROR: required command is missing: ${command_name}" >&2
    exit 1
  fi
done
if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: Docker Compose v2 is required (docker compose)." >&2
  exit 1
fi
if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
  echo "ERROR: the bundled bioinformatics environments currently support Linux x86_64 only." >&2
  exit 1
fi

if [[ -z "${lan_host}" ]]; then
  lan_host="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}')"
  if [[ -z "${lan_host}" ]]; then
    lan_host="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
fi
if [[ -z "${lan_host}" ]]; then
  echo "ERROR: could not detect a LAN address; pass --lan-host." >&2
  exit 1
fi

if [[ "${accelerator}" == "auto" ]]; then
  if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
    accelerator=gpu
  else
    accelerator=cpu
  fi
fi
if [[ "${accelerator}" == "gpu" ]] && ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "ERROR: --gpu requires a working NVIDIA driver and NVIDIA Container Toolkit." >&2
  exit 1
fi

configure=(python3 "${ROOT}/scripts/configure_env.py" --host "${lan_host}" --http-port "${http_port}" --console-port "${console_port}" --uid "$(id -u)" --gid "$(id -g)" --accelerator "${accelerator}")
[[ -n "${database_path}" ]] && configure+=(--database-path "${database_path}")
"${configure[@]}"

if [[ ! -f "${ROOT}/databases.env" ]]; then
  cp "${ROOT}/databases.env.example" "${ROOT}/databases.env"
  chmod 600 "${ROOT}/databases.env"
fi

if ! python3 "${ROOT}/scripts/validate_env.py"; then
  echo "Setup paused before downloading or building anything." >&2
  echo "Complete the Firebase Web configuration in ${ROOT}/.env, then rerun ./Setup.sh." >&2
  exit 2
fi

if (( config_only )); then
  "${ROOT}/scripts/compose.sh" config --quiet
  echo "Configuration is valid; no containers were changed."
  exit 0
fi

# shellcheck disable=SC1091
source "${ROOT}/.env"
for setting in GENOCULAR_DATA_ROOT GENOCULAR_TMP_ROOT GENOCULAR_SCRATCH_ROOT GENOCULAR_JOBQ_ROOT; do
  path="${!setting}"
  [[ "${path}" = /* ]] || path="${ROOT}/${path#./}"
  mkdir -p "${path}"
done

data_root="${GENOCULAR_DATA_ROOT}"
[[ "${data_root}" = /* ]] || data_root="${ROOT}/${data_root#./}"
mkdir -p \
  "${data_root}/jobs" \
  "${data_root}/tmp" \
  "${data_root}/conda_pkgs" \
  "${data_root}/smk_envs_v4/shared" \
  "${data_root}/smk_envs_profiles" \
  "${data_root}/home_runner"

if [[ -n "${database_path}" ]]; then
  DB_SOURCE=existing
  if grep -q '^DB_SOURCE=' "${ROOT}/databases.env"; then
    sed -i 's/^DB_SOURCE=.*/DB_SOURCE=existing/' "${ROOT}/databases.env"
  else
    printf '\nDB_SOURCE=existing\n' >> "${ROOT}/databases.env"
  fi
fi

if (( ! skip_databases )); then
  "${ROOT}/scripts/download_databases.sh"
else
  echo "WARNING: database download/validation skipped; analysis jobs may fail."
fi

"${ROOT}/scripts/compose.sh" build

if (( ! skip_pipeline_envs )); then
  "${ROOT}/scripts/build_pipeline_envs.sh" all
else
  echo "WARNING: pipeline environment build skipped; analysis jobs may fail."
fi

"${ROOT}/scripts/compose.sh" up -d

if (( ! skip_models )); then
  echo "Waiting for Ollama..."
  for _ in $(seq 1 60); do
    if "${ROOT}/scripts/compose.sh" exec -T ollama ollama list >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
  "${ROOT}/scripts/compose.sh" exec -T ollama ollama pull "${OLLAMA_MODEL}"
  if [[ "${ANALYSIS_ASSISTANT_MODEL}" != "${OLLAMA_MODEL}" ]]; then
    "${ROOT}/scripts/compose.sh" exec -T ollama ollama pull "${ANALYSIS_ASSISTANT_MODEL}"
  fi
fi

echo "Waiting for the web/API health checks..."
for attempt in $(seq 1 90); do
  if "${ROOT}/scripts/healthcheck.sh" >/dev/null 2>&1; then
    "${ROOT}/scripts/healthcheck.sh"
    echo "GENOCULAR is ready at ${FRONTEND_URL}"
    echo "MinIO administration is at ${MINIO_CONSOLE_URL}"
    exit 0
  fi
  if (( attempt == 90 )); then
    echo "ERROR: services did not become healthy. Inspect: ./scripts/compose.sh ps" >&2
    echo "Logs: ./scripts/compose.sh logs --tail=200" >&2
    exit 1
  fi
  sleep 2
done
