#!/bin/sh
set -eu
chown minio:minio /data
exec su-exec minio:minio /usr/local/bin/minio "$@"
