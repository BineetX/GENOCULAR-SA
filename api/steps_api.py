# api/steps_api.py
import os, json, time
from typing import Dict, Any, List, Optional

from fastapi import APIRouter, HTTPException
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

router = APIRouter()

# ---- S3 / MinIO client ----
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "http://minio:9000")
MINIO_ACCESS   = os.getenv("MINIO_ACCESS_KEY") or os.getenv("MINIO_ROOT_USER", "")
MINIO_SECRET   = os.getenv("MINIO_SECRET_KEY") or os.getenv("MINIO_ROOT_PASSWORD", "")
RAW_BUCKET     = os.getenv("RAW_BUCKET", "raw")
RESULTS_BUCKET = os.getenv("RESULTS_BUCKET", "results")
LOGS_BUCKET    = os.getenv("LOGS_BUCKET", "logs")

S3 = boto3.client(
    "s3",
    endpoint_url=MINIO_ENDPOINT,
    aws_access_key_id=MINIO_ACCESS,
    aws_secret_access_key=MINIO_SECRET,
    config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    region_name="us-east-1",
)

# ---- helpers ----
def _get_json(bucket: str, key: str) -> Optional[Dict[str, Any]]:
    try:
        obj = S3.get_object(Bucket=bucket, Key=key)
        return json.loads(obj["Body"].read())
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") in ("NoSuchKey", "404"):
            return None
        raise

def _list_prefix(bucket: str, prefix: str) -> List[Dict[str, Any]]:
    out, token = [], None
    while True:
        kw = {"Bucket": bucket, "Prefix": prefix}
        if token:
            kw["ContinuationToken"] = token
        resp = S3.list_objects_v2(**kw)
        out.extend(resp.get("Contents", []) or [])
        if resp.get("IsTruncated"):
            token = resp.get("NextContinuationToken")
            continue
        break
    return out

def _presign(bucket: str, key: str, expires: int = 3600) -> str:
    return S3.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=expires,
    )

# ---- public shape helpers (stable for frontend) ----
def _summarize_steps(steps_doc: Dict[str, Any]) -> Dict[str, Any]:
    steps = steps_doc.get("steps", [])
    # current = first running, else last done, else first queued
    current = next((s for s in steps if s.get("status") == "running"), None)
    if not current:
        done = [s for s in steps if s.get("status") in ("done", "skipped")]
        current = done[-1] if done else (steps[0] if steps else None)
    return {
        "state": steps_doc.get("state", "queued"),
        "message": steps_doc.get("message", ""),
        "completed": steps_doc.get("completed", 0),
        "total": steps_doc.get("total", len(steps)),
        "current": current,
        "steps": steps,
    }

# ---- endpoints ----

@router.get("/jobs/{job_id}/status")
def get_job_status(job_id: str) -> Dict[str, Any]:
    """
    Returns overall status (state/message) + a compact projection of the steps rail.
    Compatible with your existing frontend's polling.
    """
    status = _get_json(LOGS_BUCKET, f"{job_id}/status.json") or {"state": "unknown", "message": ""}
    steps  = _get_json(LOGS_BUCKET, f"{job_id}/steps.json") or {"steps": [], "state": "queued", "message": ""}

    rail = _summarize_steps(steps)
    # preserve legacy fields for your existing UI progress bar
    return {
        "state": status.get("state") or rail["state"],
        "message": status.get("message") or rail["message"],
        "completed": rail["completed"],
        "total": rail["total"],
        "rail": rail,  # new: frontend can read detailed tool list here
    }

@router.get("/jobs/{job_id}/steps")
def get_job_steps(job_id: str) -> Dict[str, Any]:
    """
    Full steps document for the horizontal tool rail.
    """
    steps = _get_json(LOGS_BUCKET, f"{job_id}/steps.json")
    if not steps:
        # Empty skeleton keeps UI happy even if job hasn't started
        steps = {"state": "queued", "message": "", "completed": 0, "total": 0, "steps": []}
    return _summarize_steps(steps)

@router.get("/jobs/{job_id}/results")
def get_job_results(job_id: str) -> Dict[str, Any]:
    """
    Resolves the manifest produced by the Snakefile and returns presigned URLs.
    It searches: results/{job_id}/**/manifest.json (first one found).
    """
    # Find a manifest.json under this job prefix
    candidates = [o["Key"] for o in _list_prefix(RESULTS_BUCKET, f"{job_id}/") if o["Key"].ends_with("manifest.json") or o["Key"].lower().endswith("/manifest.json")]
    if not candidates:
        # Fallback: brute find any manifest.json under prefix
        objs = _list_prefix(RESULTS_BUCKET, f"{job_id}/")
        for o in objs:
            if o["Key"].rsplit("/", 1)[-1] == "manifest.json":
                candidates.append(o["Key"])
                break

    if not candidates:
        # No results yet
        return {"items": []}

    manifest_key = candidates[0]
    manifest = _get_json(RESULTS_BUCKET, manifest_key) or {}

    artifacts = manifest.get("artifacts", [])
    items = []
    # Each artifact has {"name": relpath, "kind": ...}; build full key job_id/<rel>
    base_prefix = manifest_key.rsplit("/", 1)[0]  # .../<job_id>/OUTPUT/<sample>
    for art in artifacts:
        rel = art.get("name")
        if not rel:
            continue
        key = f"{base_prefix}/{rel}".replace("//", "/")
        try:
            url = _presign(RESULTS_BUCKET, key, expires=3600)
            items.append({"key": key, "url": url, "kind": art.get("kind", "file")})
        except ClientError:
            # skip missing objects silently
            continue

    return {"items": items}

