#!/usr/bin/env python
import os
import mimetypes
from pathlib import Path
from urllib.parse import urlparse

from minio import Minio

# Root where jobs live inside runner container
JOBS_ROOT = Path(os.environ.get("JOBS_ROOT", "/data/genoverse/jobs")).resolve()

# Bucket for pipeline outputs
RESULTS_BUCKET = os.environ.get("MINIO_RESULTS_BUCKET", "results")


def make_minio_client() -> Minio:
    """
    Create a MinIO client. Use the SAME endpoint/creds
    you already use for uploads.
    """
    endpoint_value = os.environ.get("MINIO_ENDPOINT", "minio:9000")
    parsed = urlparse(endpoint_value if "://" in endpoint_value else f"//{endpoint_value}")
    endpoint = parsed.netloc or parsed.path
    access_key = os.environ["MINIO_ACCESS_KEY"]
    secret_key = os.environ["MINIO_SECRET_KEY"]
    secure = os.environ.get("MINIO_USE_SSL", str(parsed.scheme == "https")).lower() == "true"

    return Minio(
        endpoint=endpoint,
        access_key=access_key,
        secret_key=secret_key,
        secure=secure,
    )


def upload_results_for_job(job_id: str, subdir: str = "", sample: str = "") -> None:
    client = make_minio_client()

    # Ensure bucket exists
    if not client.bucket_exists(RESULTS_BUCKET):
        client.make_bucket(RESULTS_BUCKET)

    job_output = JOBS_ROOT / job_id / "OUTPUT"
    if not job_output.is_dir():
        print(f"[upload_results] No OUTPUT dir for job={job_id} at {job_output}")
        return

    object_root = (job_output / sample).resolve() if sample else job_output
    upload_root = (object_root / subdir).resolve() if subdir else object_root
    if job_output not in upload_root.parents and upload_root != job_output:
        raise ValueError("subdir must stay inside the job OUTPUT directory")
    if not upload_root.is_dir():
        print(f"[upload_results] No upload directory for job={job_id} at {upload_root}")
        return

    print(f"[upload_results] Uploading artifacts from {upload_root}")

    for root, _, files in os.walk(upload_root):
        for fname in files:
            full = Path(root) / fname
            rel = full.relative_to(object_root)  # e.g. "analysis/index.json"

            # MinIO object key: <JOB_ID>/<relative path>
            key = f"{job_id}/{rel.as_posix()}"

            content_type = (
                mimetypes.guess_type(str(full))[0] or "application/octet-stream"
            )

            print(f"[upload_results] -> {RESULTS_BUCKET}/{key}")
            client.fput_object(
                bucket_name=RESULTS_BUCKET,
                object_name=key,
                file_path=str(full),
                content_type=content_type,
            )


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Upload a job's output artifacts to MinIO.")
    parser.add_argument("job_id")
    parser.add_argument("--subdir", default="", help="Upload only this OUTPUT-relative directory, preserving object keys")
    parser.add_argument("--sample", default="", help="Use OUTPUT/<sample> as the object-key root")
    args = parser.parse_args()
    upload_results_for_job(args.job_id, args.subdir, args.sample)
