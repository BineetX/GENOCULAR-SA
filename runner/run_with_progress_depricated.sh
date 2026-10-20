#!/usr/bin/env bash
set -euo pipefail

JOB_JSON="${1:?json path}"
JOB_ID="${JOB_ID:?set by worker}"
SCRATCH="${SCRATCH_DIR:-/scratch}/$JOB_ID"
mkdir -p "$SCRATCH/inputs" /data/tmp

# read payload
sample=$(jq -r '.sample' "$JOB_JSON")
r1_s3=$(jq -r '.r1' "$JOB_JSON")
r2_s3=$(jq -r '.r2' "$JOB_JSON")

# status helper (writes logs/<job_id>/status.json)
status() {
python - "$@" <<'PY'
import os, json, boto3
jid = os.environ["JOB_ID"]
bucket = os.environ.get("LOGS_BUCKET","logs")
endpoint=os.environ["MINIO_ENDPOINT"]; ak=os.environ["MINIO_ACCESS_KEY"]; sk=os.environ["MINIO_SECRET_KEY"]
s3 = boto3.client("s3", endpoint_url=endpoint, aws_access_key_id=ak, aws_secret_access_key=sk,
                  config=boto3.session.Config(signature_version="s3v4", s3={"addressing_style":"path"}),
                  region_name="us-east-1")
st = {"state": os.environ.get("STATE","running"),
      "completed": int(os.environ.get("DONE","0")),
      "total": int(os.environ.get("TOTAL","0")),
      "message": os.environ.get("MSG","")}
s3.put_object(Bucket=bucket, Key=f"{jid}/status.json", Body=json.dumps(st).encode("utf-8"),
              ContentType="application/json")
print(st)
PY
}

export STATE=running DONE=0 TOTAL=4 MSG="staging inputs"; status

# download inputs from MinIO to local scratch
python - "$SCRATCH" "$r1_s3" "$r2_s3" <<'PY'
import os, sys, boto3, urllib.parse
dst=sys.argv[1]; r1=sys.argv[2]; r2=sys.argv[3]
ep=os.environ["MINIO_ENDPOINT"]; ak=os.environ["MINIO_ACCESS_KEY"]; sk=os.environ["MINIO_SECRET_KEY"]
s3=boto3.client("s3",endpoint_url=ep,aws_access_key_id=ak,aws_secret_access_key=sk,
                config=boto3.session.Config(signature_version="s3v4", s3={'addressing_style':'path'}),
                region_name="us-east-1")
def fetch(u):
  assert u.startswith("s3://")
  _,rest=u.split("s3://",1)
  b, k = rest.split("/",1)
  fn = os.path.join(dst,"inputs",os.path.basename(k))
  s3.download_file(b, k, fn)
  return fn
print(fetch(r1))
print(fetch(r2))
PY

# write config.yaml for snakemake
cat > "$SCRATCH/config.yaml" <<EOF
sample: $sample
R1: $SCRATCH/inputs/$(basename "$r1_s3")
R2: $SCRATCH/inputs/$(basename "$r2_s3")
JOB_ID: $JOB_ID
BASE: /data/genoverse
EOF

export DONE=1 MSG="snakemake starting"; status

# run snakemake in apptainer (shared conda prefix is reused across jobs)
apptainer exec \
  --bind /data:/data \
  --bind /project:/project:ro \
  "${SNAKEMAKE_SIF:?}" \
  env CONDA_PKGS_DIRS=/data/genoverse/conda_pkgs TMPDIR=/data/tmp TMP=/data/tmp \
  snakemake \
    --snakefile "${SNAKEFILE_PATH:?}" \
    --use-conda \
    --conda-frontend conda \
    --conda-prefix "${SHARED_CONDA_PREFIX:?}" \
    --directory "$SCRATCH" \
    --cores "${SNAKEMAKE_CORES:-8}" \
    --configfile "$SCRATCH/config.yaml"

export DONE=3 MSG="uploading results"; status

# (optional) upload results to results/<job_id>/ using boto3 if your Snakefile wrote to local disk
# If your Snakefile already writes to s3://results/<job_id>/..., skip this step.

export STATE=finished DONE=4 MSG="done"; status

