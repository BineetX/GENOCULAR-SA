#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
frontend="$(sed -n 's/^FRONTEND_URL=//p' "${ROOT}/.env" | tail -n 1)"

"${ROOT}/scripts/compose.sh" ps
curl -fsS "${frontend}/healthz" >/dev/null
curl -fsS "${frontend}/api/health" >/dev/null
"${ROOT}/scripts/compose.sh" exec -T minio curl -fsS http://127.0.0.1:9000/minio/health/live >/dev/null
echo "GENOCULAR health checks passed: ${frontend}"
