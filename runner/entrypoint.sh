#!/usr/bin/env sh
set -eu

echo "GENOCULAR runner starting…"

# Defaults (overridden by compose env if set)
: "${SCRATCH_DIR:=/scratch}"
: "${APPTAINER_CACHEDIR:=/data/tmp/apptainer_cache}"
: "${APPTAINER_TMPDIR:=/data/tmp/apptainer_tmp}"
: "${PIPELINE_BASE:=/data/genoverse}"
: "${HOME:=/data/genoverse/home_runner}"
mkdir -p "$HOME" "$HOME/.conda" "$HOME/.ncbi" "$HOME/.cache" "$HOME/.config" "$HOME/.local/share" || true


mkdir -p "$SCRATCH_DIR" "$APPTAINER_CACHEDIR" "$APPTAINER_TMPDIR" || true

# Apptainer sanity checks — pipelines run directly when it is not installed.
if command -v apptainer >/dev/null 2>&1; then
  apptainer --version || echo "WARN: apptainer --version failed (non-fatal)"
  if [ "$(id -u)" -eq 0 ]; then
    mkdir -p /var/lib/apptainer/mnt/session /var/cache/apptainer
    chown -R "$(id -u)":"$(id -g)" /var/lib/apptainer /var/cache/apptainer
  fi
else
  echo "INFO: apptainer not installed; using the runner tool environments directly"
fi

# Show effective user (helpful for debugging)
id || true

# Start the RQ worker (uses venv python if PATH is set in Dockerfile)
exec python /app/worker.py
