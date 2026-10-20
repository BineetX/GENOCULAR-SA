"""Portable GENOCULAR MinIO client."""
import os
from minio import Minio

# Bucket with pipeline outputs
RESULTS_BUCKET = os.getenv("MINIO_RESULTS_BUCKET", "results")

# Internal endpoint: how the API container talks to MinIO (Docker network)
MINIO_ENDPOINT_INTERNAL = os.getenv("MINIO_ENDPOINT_INTERNAL", os.getenv("MINIO_ENDPOINT", "minio:9000"))

# External endpoint: how the BROWSER reaches MinIO (via Nginx / host)
# Example: "genoverse.local:9000" (CHANGE THIS IN docker-compose for api)
MINIO_ENDPOINT_EXTERNAL = os.getenv("MINIO_ENDPOINT_EXTERNAL", MINIO_ENDPOINT_INTERNAL)

MINIO_USE_SSL = os.getenv("MINIO_USE_SSL", "false").lower() == "true"


def get_minio_client() -> Minio:
    """
    MinIO client used by the API to list objects & generate presigned URLs.
    Uses the INTERNAL endpoint (minio:9000).
    """
    access_key = os.environ["MINIO_ACCESS_KEY"]
    secret_key = os.environ["MINIO_SECRET_KEY"]

    return Minio(
        endpoint=MINIO_ENDPOINT_INTERNAL,
        access_key=access_key,
        secret_key=secret_key,
        secure=MINIO_USE_SSL,
    )

