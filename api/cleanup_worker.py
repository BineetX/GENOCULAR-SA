"""Scheduled cleanup for GENOCULAR job storage.

This worker owns both MinIO and local job retention. It uses the jobs database
as the source of truth and Redis/RQ as a safety rail: queued or running RQ jobs
are never touched. API admission uses the same lock to prevent cleanup races.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import re
import shutil
import signal
import threading
import time
from typing import Iterable

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from redis import Redis
from rq import Queue, Worker
from rq.job import Job as RqJob
from rq.exceptions import NoSuchJobError
from rq.registry import DeferredJobRegistry, ScheduledJobRegistry, StartedJobRegistry

from db import get_db
from models import Job, JobStatus


UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
TERMINAL_STATUSES = {JobStatus.succeeded, JobStatus.failed, JobStatus.cancelled}
ACTIVE_RQ_STATES = {"queued", "started", "deferred", "scheduled"}


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _as_utc(value: dt.datetime | None) -> dt.datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=dt.timezone.utc)
    return value.astimezone(dt.timezone.utc)


def _safe_job_path(root: pathlib.Path, job_id: str) -> pathlib.Path | None:
    """Return a direct UUID-named child of root, rejecting symlinks."""
    if not UUID_RE.fullmatch(job_id):
        return None
    root = root.resolve()
    candidate = root / job_id
    if candidate.is_symlink():
        return None
    try:
        if candidate.resolve(strict=False).parent != root:
            return None
    except OSError:
        return None
    return candidate


def _safe_job_prefix(job_id: str, value: str | None) -> str | None:
    """Return a job-scoped object prefix, rejecting bucket-wide/foreign prefixes."""
    if not UUID_RE.fullmatch(job_id):
        return None
    prefix = f"{job_id}/" if value is None else str(value).strip().lstrip("/")
    if not prefix.startswith(f"{job_id}/"):
        return None
    return prefix


def _raw_source_ids(manifest: dict) -> set[str]:
    keys = [manifest.get(name) for name in ("r1_key", "r2_key", "r_long_key")]
    keys.extend(item.get("key") for item in manifest.get("files", []) if isinstance(item, dict))
    return {str(key).split("/", 1)[0] for key in keys if key and UUID_RE.fullmatch(str(key).split("/", 1)[0])}


def _tree_activity(path: pathlib.Path) -> dt.datetime:
    """Inspect every entry without following symlinks; errors fail closed."""
    latest = path.lstat().st_mtime
    def onerror(exc):
        raise exc
    for root, dirs, files in os.walk(path, followlinks=False, onerror=onerror):
        for name in dirs + files:
            item = pathlib.Path(root) / name
            if item.is_mount():
                raise ValueError(f"refusing nested mount: {item}")
            latest = max(latest, item.lstat().st_mtime)
    return dt.datetime.fromtimestamp(latest, dt.timezone.utc)


def _path_activity(path: pathlib.Path) -> dt.datetime | None:
    """Use inexpensive workspace markers instead of recursively walking outputs."""
    markers = [
        path,
        path / "config.json",
        path / "logs" / "snakemake.log",
        path / "OUTPUT",
    ]
    mtimes: list[float] = []
    for marker in markers:
        try:
            mtimes.append(marker.stat().st_mtime)
        except OSError:
            pass
    if not mtimes:
        return None
    return dt.datetime.fromtimestamp(max(mtimes), tz=dt.timezone.utc)


def _latest_activity(job: Job, paths: Iterable[pathlib.Path]) -> dt.datetime:
    values = [_as_utc(job.finished_at), _as_utc(job.started_at), _as_utc(job.created_at)]
    values.extend(_path_activity(path) for path in paths)
    return max(value for value in values if value is not None)


class CleanupWorker:
    def __init__(self, *, dry_run: bool = False) -> None:
        self.storage_retention_days = int(os.getenv("STORAGE_RETENTION_DAYS", "7"))
        self.local_retention_days = int(
            os.getenv("LOCAL_STORAGE_RETENTION_DAYS", str(self.storage_retention_days))
        )
        self.raw_retention_days = int(
            os.getenv("RAW_STORAGE_RETENTION_DAYS", str(self.storage_retention_days))
        )
        self.result_retention_days = int(
            os.getenv("RESULT_STORAGE_RETENTION_DAYS", str(self.storage_retention_days))
        )
        self.log_retention_days = int(
            os.getenv("LOG_STORAGE_RETENTION_DAYS", str(self.result_retention_days))
        )
        self.failed_retention_days = int(
            os.getenv("FAILED_STORAGE_RETENTION_DAYS", str(self.storage_retention_days))
        )
        self.abandoned_retention_days = int(
            os.getenv("ABANDONED_JOB_RETENTION_DAYS", str(self.storage_retention_days))
        )
        self.orphan_retention_days = int(
            os.getenv("ORPHAN_LOCAL_RETENTION_DAYS", str(max(self.local_retention_days, 1)))
        )
        for name, value in (
            ("STORAGE_RETENTION_DAYS", self.storage_retention_days),
            ("LOCAL_STORAGE_RETENTION_DAYS", self.local_retention_days),
            ("RAW_STORAGE_RETENTION_DAYS", self.raw_retention_days),
            ("RESULT_STORAGE_RETENTION_DAYS", self.result_retention_days),
            ("LOG_STORAGE_RETENTION_DAYS", self.log_retention_days),
            ("FAILED_STORAGE_RETENTION_DAYS", self.failed_retention_days),
            ("ABANDONED_JOB_RETENTION_DAYS", self.abandoned_retention_days),
            ("ORPHAN_LOCAL_RETENTION_DAYS", self.orphan_retention_days),
        ):
            if value < 0:
                raise ValueError(f"{name} must be zero or greater")
        self.interval_seconds = int(os.getenv("CLEANUP_INTERVAL_SECONDS", "21600"))
        self.multipart_days = max(1, int(os.getenv("MULTIPART_RETENTION_DAYS", "7")))
        self.dry_run = dry_run or _env_bool("CLEANUP_DRY_RUN")
        self.jobs_root = pathlib.Path(os.getenv("JOB_WORK_ROOT", "/data/genoverse/jobs"))
        self.scratch_root = pathlib.Path(os.getenv("SCRATCH_ROOT", "/scratch"))
        if str(self.jobs_root) != "/data/genoverse/jobs" or str(self.scratch_root) != "/scratch":
            raise ValueError("cleanup roots must be the deployment's dedicated job mounts")
        for root in (self.jobs_root, self.scratch_root):
            if not root.is_dir() or root.is_symlink() or root.resolve() != root:
                raise ValueError(f"unsafe or unavailable job root: {root}")
        self.redis = Redis.from_url(os.getenv("REDIS_URL", "redis://redis:6379/0"))
        self.queue_name = (os.getenv("RQ_QUEUE") or "default").strip()
        self.s3 = boto3.client(
            "s3",
            endpoint_url=os.getenv("MINIO_ENDPOINT", "http://minio:9000"),
            aws_access_key_id=os.getenv("MINIO_ACCESS_KEY") or os.getenv("MINIO_ROOT_USER"),
            aws_secret_access_key=os.getenv("MINIO_SECRET_KEY") or os.getenv("MINIO_ROOT_PASSWORD"),
            config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        )
        self.buckets = (
            os.getenv("RAW_BUCKET", "raw"),
            os.getenv("RESULTS_BUCKET", "results"),
            os.getenv("LOGS_BUCKET", "logs"),
        )

    def _rq_job(self, rq_job_id: str | None) -> RqJob | None:
        if not rq_job_id:
            return None
        try:
            return RqJob.fetch(rq_job_id, connection=self.redis)
        except NoSuchJobError:
            return None

    @staticmethod
    def _pipeline_id(rq_job: RqJob | None) -> str | None:
        if rq_job is None:
            return None
        kwargs = getattr(rq_job, "kwargs", {}) or {}
        value = kwargs.get("pipeline_job_id")
        return str(value) if value else None

    def _active_pipeline_ids(self) -> set[str]:
        rq_ids: set[str] = set(Queue(self.queue_name, connection=self.redis).get_job_ids())
        for registry_cls in (StartedJobRegistry, DeferredJobRegistry, ScheduledJobRegistry):
            registry = registry_cls(name=self.queue_name, connection=self.redis)
            # RQ 1.x get_job_ids() calls registry.cleanup(), which can change
            # queue state. Read its sorted set directly for a true dry-run.
            rq_ids.update(value.decode() if isinstance(value, bytes) else value
                          for value in self.redis.zrange(registry.key, 0, -1))
        for worker in Worker.all(connection=self.redis):
            current = worker.get_current_job_id()
            if current:
                rq_ids.add(current)

        active: set[str] = set()
        for rq_id in rq_ids:
            pipeline_id = self._pipeline_id(self._rq_job(rq_id))
            if pipeline_id:
                active.add(pipeline_id)
            else:
                raise RuntimeError("active RQ record cannot be mapped to a pipeline; cleanup refused")
        return active

    def _delete_prefix(self, bucket: str, prefix: str) -> int:
        deleted = 0
        paginator = self.s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            keys = [{"Key": obj["Key"]} for obj in page.get("Contents", []) if obj.get("Key")]
            for start in range(0, len(keys), 1000):
                batch = keys[start : start + 1000]
                if batch:
                    self._assert_lease()
                    response = self.s3.delete_objects(Bucket=bucket, Delete={"Objects": batch, "Quiet": True})
                    if response.get("Errors"):
                        raise RuntimeError(f"MinIO reported partial deletion failure in {bucket}")
                    deleted += len(batch)
        return deleted

    def _stored_terminal_status(self, job_id: str) -> tuple[JobStatus | None, str, dt.datetime | None]:
        try:
            response = self.s3.get_object(Bucket=self.buckets[2], Key=f"{job_id}/status.json")
            payload = json.loads(response["Body"].read())
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"NoSuchKey", "404"}:
                return None, "", None
            raise

        state = str(payload.get("state") or "").strip().lower()
        status = None
        if state in {"done", "success", "completed", "finished", "ok", "succeeded"}:
            status = JobStatus.succeeded
        elif state in {"failed", "error", "crashed", "aborted"}:
            status = JobStatus.failed
        elif state in {"cancelled", "canceled"}:
            status = JobStatus.cancelled
        modified = response.get("LastModified")
        return status, str(payload.get("message") or ""), _as_utc(modified)

    @staticmethod
    def _minio_targets(job: Job) -> dict[str, tuple[int, str, str]]:
        prefixes = {
            "raw": _safe_job_prefix(job.job_id, job.raw_prefix),
            "results": _safe_job_prefix(job.job_id, job.results_prefix),
            "logs": _safe_job_prefix(job.job_id, job.log_prefix),
        }
        invalid = [kind for kind, prefix in prefixes.items() if prefix is None]
        if invalid:
            raise ValueError(
                f"unsafe MinIO prefix for job={job.job_id}: {','.join(invalid)}"
            )
        return {
            "raw": (0, prefixes["raw"], "raw_storage_pruned_at"),
            "results": (1, prefixes["results"], "results_storage_pruned_at"),
            "logs": (2, prefixes["logs"], "log_storage_pruned_at"),
        }

    def _results_available(self, job: Job) -> bool:
        """Require analysis index and all local output sizes, not just one object."""
        if job.status != JobStatus.succeeded:
            return True
        prefix = _safe_job_prefix(job.job_id, job.results_prefix)
        if prefix is None:
            print(f"[cleanup][warn] unsafe results prefix for job={job.job_id}", flush=True)
            return False
        try:
            objects = {}
            for page in self.s3.get_paginator("list_objects_v2").paginate(Bucket=self.buckets[1], Prefix=prefix):
                objects.update({item["Key"]: item["Size"] for item in page.get("Contents", [])})
            if prefix + "analysis/index.json" not in objects:
                return False
            output = self.jobs_root / job.job_id / "OUTPUT"
            if not output.is_dir() or output.is_symlink():
                return False
            samples = list(output.iterdir())
            if len(samples) != 1 or not samples[0].is_dir() or samples[0].is_symlink():
                return False
            count = 0
            def onerror(exc):
                raise exc
            for directory, dirs, files in os.walk(samples[0], followlinks=False, onerror=onerror):
                for name in dirs:
                    child = pathlib.Path(directory) / name
                    if child.is_symlink() or child.is_mount():
                        return False
                for name in files:
                    local = pathlib.Path(directory) / name
                    if local.is_symlink() or not local.is_file():
                        return False
                    key = prefix + local.relative_to(samples[0]).as_posix()
                    if objects.get(key) != local.stat().st_size:
                        print(f"[cleanup][warn] unpublished/mismatched output: {local}", flush=True)
                        return False
                    count += 1
            return count > 0
        except Exception as exc:
            print(f"[cleanup][warn] cannot verify results for job={job.job_id}: {exc}", flush=True)
            return False

    def _published_analysis(self, job: Job) -> set[str] | None:
        """Verify the analysis contract before pruning ONLY reproducible inputs.

        This is deliberately weaker than the whole-workspace publication guard:
        unlisted assemblies, alignments and unknown files remain on local disk.
        None means failure; a set contains every explicitly referenced asset.
        """
        prefix = _safe_job_prefix(job.job_id, job.results_prefix)
        if job.status != JobStatus.succeeded or not prefix:
            return None
        try:
            state, _, _ = self._stored_terminal_status(job.job_id)
            if state != JobStatus.succeeded:
                return None
            response = self.s3.get_object(Bucket=self.buckets[1], Key=prefix + "analysis/index.json")
            body = response["Body"]
            try:
                data = body.read(12 * 1024 * 1024 + 1)
            finally:
                body.close()
            if len(data) > 12 * 1024 * 1024:
                return None
            index = json.loads(data)
            sections = index.get("sections")
            if index.get("job_id") != job.job_id or index.get("version") != 2:
                return None
            if not isinstance(sections, list) or not 1 <= len(sections) <= 64:
                return None
            required = {"analysis/index.json"}
            for section in sections:
                if not isinstance(section, dict) or not section.get("path"):
                    return None
                for field in ("path", "data_path"):
                    value = section.get(field)
                    if value is None and field == "data_path":
                        continue
                    if not isinstance(value, str) or not value or "\\" in value:
                        return None
                    path = pathlib.PurePosixPath(value)
                    if path.is_absolute() or any(p in {"", ".", ".."} for p in value.split("/")):
                        return None
                    required.add(value)
            for key in required:
                head = self.s3.head_object(Bucket=self.buckets[1], Key=prefix + key)
                if head["ContentLength"] <= 0:
                    return None
            return required
        except Exception as exc:
            print(f"[cleanup][warn] analysis validation failed job={job.job_id}: {type(exc).__name__}", flush=True)
            return None

    @staticmethod
    def _disposable_read(relative: pathlib.PurePosixPath) -> bool:
        """Only read files in known preprocessing directories, never assemblies."""
        parts = relative.parts
        if len(parts) < 3 or parts[0] not in {"MAG_shortread_results", "hybrid_results", "MAG_longread_results"}:
            return False
        return parts[1] in {"fastp", "kneaddata", "host_removal_sr", "host_removal_lr", "nanoq"} and relative.name.lower().endswith((".fastq", ".fq", ".fastq.gz", ".fq.gz"))

    def _prune_success_inputs(self, job: Job, required: set[str]) -> tuple[int, int, int]:
        """Remove scratch and explicit read intermediates; keep all other outputs.

        Called only under the admission/cleanup lease for inactive successful jobs.
        Do not mark local_storage_pruned_at: unpublished final files still exist.
        """
        candidates = []
        workspace = _safe_job_path(self.jobs_root, job.job_id)
        scratch = _safe_job_path(self.scratch_root, job.job_id)
        if workspace is None or scratch is None:
            raise ValueError("unsafe successful-job roots")
        output = workspace / "OUTPUT"
        if output.is_symlink():
            raise ValueError("symlink output root")
        if output.is_dir():
            samples = list(output.iterdir())
            if len(samples) != 1 or samples[0].is_symlink() or not samples[0].is_dir():
                raise ValueError("ambiguous output sample root")
            sample = samples[0]
            _tree_activity(workspace)  # Refuse mounts before any mutation.
            def onerror(exc):
                raise exc
            for directory, dirs, files in os.walk(sample, followlinks=False, onerror=onerror):
                dirs[:] = [name for name in dirs if not (pathlib.Path(directory) / name).is_symlink()]
                for name in files:
                    local = pathlib.Path(directory) / name
                    relative = local.relative_to(sample)
                    if not local.is_symlink() and local.is_file() and relative.as_posix() not in required and self._disposable_read(relative):
                        candidates.append(local)
        # A report referencing scratch inputs is not a completed input-free analysis.
        if any(key.startswith("inputs/") or self._disposable_read(pathlib.PurePosixPath(key)) for key in required):
            raise ValueError("analysis still references input/read artifacts")
        if scratch.exists():
            _tree_activity(scratch)
        remote_reads = []
        prefix = _safe_job_prefix(job.job_id, job.results_prefix)
        if not prefix:
            raise ValueError("unsafe results prefix")
        for page in self.s3.get_paginator("list_objects_v2").paginate(Bucket=self.buckets[1], Prefix=prefix):
            for obj in page.get("Contents", []):
                relative = obj["Key"][len(prefix):]
                if relative not in required and self._disposable_read(pathlib.PurePosixPath(relative)):
                    remote_reads.append(obj)
        size = sum(path.stat().st_size for path in candidates)
        remote_size = sum(obj["Size"] for obj in remote_reads)
        counts = (int(scratch.exists()), len(remote_reads), len(candidates))
        print(f"[cleanup] {'would prune' if self.dry_run else 'pruning'} verified-inputs job={job.job_id} read_files={len(candidates)} read_bytes={size} scratch={scratch.exists()} remote_read_files={len(remote_reads)} remote_read_bytes={remote_size}; other outputs retained", flush=True)
        if self.dry_run:
            return counts
        for start in range(0, len(remote_reads), 1000):
            self._assert_lease()
            result = self.s3.delete_objects(Bucket=self.buckets[1], Delete={"Objects": [{"Key": obj["Key"]} for obj in remote_reads[start:start + 1000]]})
            if result.get("Errors"):
                raise RuntimeError("partial processed-read deletion failure")
        for path in candidates:
            self._assert_lease()
            # No other writer is admitted under this lease; never follow links.
            if path.is_symlink() or sample.resolve() not in path.resolve().parents:
                raise ValueError("read target changed during cleanup")
            path.unlink()
        self._remove_tree(scratch)
        return counts

    def _remove_tree(self, path: pathlib.Path) -> bool:
        if path.parent not in (self.jobs_root, self.scratch_root) or _safe_job_path(path.parent, path.name) != path:
            raise ValueError(f"unsafe cleanup target: {path}")
        if not path.exists():
            return False
        if path.is_mount() or not shutil.rmtree.avoids_symlink_attacks:
            raise ValueError(f"unsafe recursive removal: {path}")
        _tree_activity(path)  # also refuses nested mounts
        self._assert_lease()
        shutil.rmtree(path)
        return True

    def _job_paths(self, job_id: str) -> list[pathlib.Path]:
        paths = []
        for root in (self.jobs_root, self.scratch_root):
            path = _safe_job_path(root, job_id)
            if path is not None:
                paths.append(path)
        return paths

    def _input_activity(self, job: Job) -> dt.datetime | None:
        """An old draft may still be uploading: include object and part writes."""
        prefix = _safe_job_prefix(job.job_id, job.raw_prefix)
        if prefix is None:
            raise ValueError("unsafe raw prefix while checking upload activity")
        latest = None
        def observe(value):
            nonlocal latest
            value = _as_utc(value)
            if value is not None and (latest is None or value > latest):
                latest = value
        bucket = self.buckets[0]
        for page in self.s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                observe(obj.get("LastModified"))
        for page in self.s3.get_paginator("list_multipart_uploads").paginate(Bucket=bucket, Prefix=prefix):
            for upload in page.get("Uploads", []):
                observe(upload.get("Initiated"))
                for parts in self.s3.get_paginator("list_parts").paginate(Bucket=bucket, Key=upload["Key"], UploadId=upload["UploadId"]):
                    for part in parts.get("Parts", []):
                        observe(part.get("LastModified"))
        return latest

    def _reconcile_job(
        self,
        job: Job,
        active_ids: set[str],
        cutoff: dt.datetime,
        paths: list[pathlib.Path],
    ) -> bool:
        if job.status in TERMINAL_STATUSES or job.job_id in active_ids:
            return False
        rq_job = self._rq_job(job.rq_job_id)
        rq_state = rq_job.get_status(refresh=True) if rq_job else None
        if rq_state in ACTIVE_RQ_STATES:
            return False

        activity = _latest_activity(job, paths)
        stored_status, stored_message, stored_finished_at = self._stored_terminal_status(job.job_id)
        rq_status = None
        if rq_state == "finished":
            rq_status = JobStatus.succeeded
        elif rq_state == "failed":
            rq_status = JobStatus.failed
        elif rq_state in {"stopped", "canceled", "cancelled"}:
            rq_status = JobStatus.cancelled

        inferred_status = rq_status or stored_status
        reason = f"rq={rq_state or 'missing'} stored={stored_status.value if stored_status else 'missing'}"
        if inferred_status is None:
            created_at = _as_utc(job.created_at) or _utcnow()
            # An absent Redis record is not proof a submitted/running process
            # has stopped (Redis is ephemeral). Only expire unsubmitted drafts.
            if job.rq_job_id or (job.input_manifest or {}).get("submitted_at") or job.status != JobStatus.queued:
                return False
            uploaded_at = self._input_activity(job)
            if uploaded_at:
                activity = max(activity, uploaded_at)
            if created_at >= cutoff or activity >= cutoff:
                return False
            inferred_status = JobStatus.failed
            reason += " abandoned=true"

        print(
            f"[cleanup] reconcile job={job.job_id} db={job.status.value} {reason} "
            f"as={inferred_status.value} last_activity={activity.isoformat()}",
            flush=True,
        )
        # Mutate the ORM object even in dry-run mode so eligibility is reported
        # accurately; the dry-run transaction is rolled back below.
        job.status = inferred_status
        job.finished_at = stored_finished_at or activity
        job.message = stored_message or job.message or "stale job reconciled by retention cleanup"
        return True

    def _terminal_and_inactive(self, job: Job, active_ids: set[str]) -> bool:
        return job.job_id not in active_ids and job.status in TERMINAL_STATUSES

    def _expired(
        self,
        job: Job,
        paths: list[pathlib.Path],
        cutoff: dt.datetime,
    ) -> bool:
        expiry_base = _as_utc(job.finished_at) or _latest_activity(job, paths)
        return expiry_base < cutoff

    def _eligible_local(
        self,
        job: Job,
        active_ids: set[str],
        cutoff: dt.datetime,
        paths: list[pathlib.Path],
    ) -> bool:
        if job.job_id in active_ids or job.status not in TERMINAL_STATUSES:
            return False
        if (job.input_manifest or {}).get("local_storage_pruned_at") and not any(
            path.exists() for path in paths
        ):
            return False
        return any(path.exists() for path in paths) and self._expired(job, paths, cutoff)

    def _eligible_minio_kinds(
        self,
        job: Job,
        active_ids: set[str],
        paths: list[pathlib.Path],
        cutoffs: dict[str, dt.datetime],
    ) -> list[str]:
        if not self._terminal_and_inactive(job, active_ids):
            return []
        manifest = job.input_manifest or {}
        if manifest.get("storage_pruned_at"):
            return []
        job_cutoffs = cutoffs
        if job.status in {JobStatus.failed, JobStatus.cancelled}:
            failed_cutoff = cutoffs["failed"]
            job_cutoffs = {kind: failed_cutoff for kind in ("raw", "results", "logs")}
        kinds: list[str] = []
        for kind, (_bucket_index, _prefix, marker) in self._minio_targets(job).items():
            if not manifest.get(marker) and self._expired(job, paths, job_cutoffs[kind]):
                kinds.append(kind)
        return kinds

    def _prune_job(
        self,
        job: Job,
        paths: list[pathlib.Path],
        *,
        minio_kinds: list[str],
        prune_local: bool,
    ) -> tuple[int, int]:
        manifest = dict(job.input_manifest or {})
        existing = [path for path in paths if path.exists()] if prune_local else []
        print(
            f"[cleanup] {'would prune' if self.dry_run else 'pruning'} job={job.job_id} "
            f"status={job.status.value} minio={','.join(minio_kinds) or 'none'} "
            f"paths={','.join(map(str, existing)) or 'none'}",
            flush=True,
        )
        if self.dry_run:
            return len(existing), 0

        objects = 0
        now = _utcnow().isoformat().replace("+00:00", "Z")
        targets = self._minio_targets(job)
        retention_by_kind = {
            "raw": self.raw_retention_days,
            "results": self.result_retention_days,
            "logs": self.log_retention_days,
        }
        if job.status in {JobStatus.failed, JobStatus.cancelled}:
            retention_by_kind = {kind: self.failed_retention_days for kind in retention_by_kind}
        for kind in minio_kinds:
            bucket_index, prefix, marker = targets[kind]
            deleted = self._delete_prefix(self.buckets[bucket_index], prefix)
            objects += deleted
            manifest[marker] = now
            manifest[f"{kind}_storage_pruned_objects"] = deleted
            manifest[f"{kind}_storage_retention_days"] = retention_by_kind[kind]

        if all(manifest.get(targets[kind][2]) for kind in targets):
            manifest["storage_pruned_at"] = now
            manifest["storage_pruned_objects"] = sum(
                int(manifest.get(f"{kind}_storage_pruned_objects") or 0) for kind in targets
            )
            manifest["storage_retention_days"] = self.result_retention_days

        removed = sum(1 for path in existing if self._remove_tree(path))
        if prune_local:
            manifest["local_storage_pruned_at"] = now
            manifest["local_storage_pruned_paths"] = [str(path) for path in existing]
            manifest["local_storage_retention_days"] = self.local_retention_days
        job.input_manifest = manifest
        return removed, objects

    def _prune_orphans(self, known_ids: set[str], active_ids: set[str], cutoff: dt.datetime) -> int:
        removed = 0
        candidate_ids: set[str] = set()
        for root in (self.jobs_root, self.scratch_root):
            try:
                candidate_ids.update(path.name for path in root.iterdir() if path.is_dir())
            except OSError as exc:
                print(f"[cleanup][warn] cannot scan {root}: {exc}", flush=True)

        for job_id in sorted(candidate_ids - known_ids - active_ids):
            if not UUID_RE.fullmatch(job_id):
                continue
            paths = self._job_paths(job_id)
            activity = max((_tree_activity(path) for path in paths if path.exists()), default=None)
            if activity is None or activity >= cutoff:
                continue
            print(
                f"[cleanup] {'would prune' if self.dry_run else 'pruning'} orphan={job_id} "
                f"last_activity={activity.isoformat()}",
                flush=True,
            )
            if not self.dry_run:
                removed += sum(1 for path in paths if self._remove_tree(path))
        return removed

    def _prune_multipart(self, protected_ids: set[str]) -> None:
        cutoff = _utcnow() - dt.timedelta(days=self.multipart_days)
        for bucket in self.buckets:
            for page in self.s3.get_paginator("list_multipart_uploads").paginate(Bucket=bucket):
                for upload in page.get("Uploads", []):
                    key, upload_id = upload["Key"], upload["UploadId"]
                    job_id = key.split("/", 1)[0]
                    if not UUID_RE.fullmatch(job_id) or job_id in protected_ids or upload["Initiated"] >= cutoff:
                        continue
                    parts = self.s3.get_paginator("list_parts").paginate(Bucket=bucket, Key=key, UploadId=upload_id)
                    if any(part["LastModified"] >= cutoff for page in parts for part in page.get("Parts", [])):
                        continue
                    print(f"[cleanup] {'would abort' if self.dry_run else 'aborting'} stale multipart bucket={bucket} job={job_id}", flush=True)
                    if not self.dry_run:
                        self._assert_lease()
                        self.s3.abort_multipart_upload(Bucket=bucket, Key=key, UploadId=upload_id)

    def run_once(self) -> None:
        # Both manual and scheduled invocations share a renewed lease. Losing
        # Redis or the lease stops further deletion rather than running unlocked.
        lock = self.redis.lock("genoverse:storage-cleanup", timeout=300, thread_local=False)
        if not lock.acquire(blocking=False):
            raise RuntimeError("job admission or another cleanup holds the maintenance lock")
        self._lease = lock
        stop_renewal = threading.Event()
        def renew():
            while not stop_renewal.wait(60):
                try:
                    lock.extend(300, replace_ttl=True)
                except Exception:
                    return
        thread = threading.Thread(target=renew, daemon=True)
        thread.start()
        try:
            self._run_once()
        finally:
            stop_renewal.set()
            thread.join(timeout=5)
            if lock.owned():
                lock.release()
            self._lease = None

    def _assert_lease(self) -> None:
        lease = getattr(self, "_lease", None)
        if lease is not None and not lease.owned():
            raise RuntimeError("maintenance lease lost; further deletion refused")

    def _run_once(self) -> None:
        now = _utcnow()
        abandoned_cutoff = now - dt.timedelta(days=self.abandoned_retention_days)
        local_cutoff = now - dt.timedelta(days=self.local_retention_days)
        orphan_cutoff = now - dt.timedelta(days=self.orphan_retention_days)
        minio_cutoffs = {
            "raw": now - dt.timedelta(days=self.raw_retention_days),
            "results": now - dt.timedelta(days=self.result_retention_days),
            "logs": now - dt.timedelta(days=self.log_retention_days),
            "failed": now - dt.timedelta(days=self.failed_retention_days),
        }
        active_ids = self._active_pipeline_ids()
        reconciled = pruned_jobs = removed_paths = deleted_objects = removed_reads = errors = 0

        with get_db() as db:
            jobs = db.query(Job).all()
            known_ids = {job.job_id for job in jobs}
            protected_sources = set()
            protected_multipart = set(active_ids)
            for row in jobs:
                if row.status not in TERMINAL_STATUSES or row.job_id in active_ids:
                    protected_sources.update(_raw_source_ids(row.input_manifest or {}))
                    protected_multipart.add(row.job_id)
            for job in jobs:
                try:
                    # Demo records reference permanent, shared fixtures and use
                    # a deliberately non-UUID id. They must never enter the
                    # destructive job-storage retention path.
                    if (job.input_manifest or {}).get("is_demo") is True:
                        continue
                    job_pruned = False
                    # Recheck between jobs: workers may have started since enumeration.
                    active_ids.update(self._active_pipeline_ids())
                    rq_job = self._rq_job(job.rq_job_id)
                    if rq_job and rq_job.get_status(refresh=True) in ACTIVE_RQ_STATES:
                        active_ids.add(job.job_id)
                    paths = self._job_paths(job.job_id)
                    if self._reconcile_job(job, active_ids, abandoned_cutoff, paths):
                        reconciled += 1
                    minio_kinds = self._eligible_minio_kinds(job, active_ids, paths, minio_cutoffs)
                    effective_local_cutoff = min(local_cutoff, minio_cutoffs["failed"]) if job.status in {JobStatus.failed, JobStatus.cancelled} else local_cutoff
                    prune_local = self._eligible_local(job, active_ids, effective_local_cutoff, paths)
                    if job.job_id in protected_sources:
                        minio_kinds = [kind for kind in minio_kinds if kind != "raw"]
                    if job.status == JobStatus.succeeded and (prune_local or minio_kinds):
                        # A DB success flag alone is not proof of completion.
                        # Hold inconsistent jobs even beyond seven days until
                        # their publication/status is repaired or cancellation
                        # is explicitly requested by their owner.
                        analysis = self._published_analysis(job)
                        if analysis is None:
                            print(f"[cleanup][warn] preserving ALL local/raw data job={job.job_id}; analysis incomplete or pipeline success unverified", flush=True)
                            prune_local = False
                            minio_kinds = []
                        elif not self._expired(job, paths, minio_cutoffs["results"]) and (prune_local or "raw" in minio_kinds):
                            if not self._results_available(job):
                                print(f"[cleanup] retaining unpublished/unknown local outputs job={job.job_id}", flush=True)
                                prune_local = False
                            if job.job_id not in protected_sources:
                                removed, objects, reads = self._prune_success_inputs(job, analysis)
                                removed_paths += removed
                                deleted_objects += objects
                                removed_reads += reads
                                job_pruned = bool(removed or objects or reads)
                    if minio_kinds or prune_local:
                        removed, objects = self._prune_job(
                            job,
                            paths,
                            minio_kinds=minio_kinds,
                            prune_local=prune_local,
                        )
                        removed_paths += removed
                        deleted_objects += objects
                        job_pruned = True
                    pruned_jobs += int(job_pruned)
                    if self.dry_run:
                        db.rollback()
                    else:
                        db.commit()
                except Exception as exc:
                    errors += 1
                    db.rollback()
                    print(f"[cleanup][error] job={job.job_id}: {exc}", flush=True)

        active_ids.update(self._active_pipeline_ids())
        orphan_paths = self._prune_orphans(known_ids, active_ids | protected_sources, orphan_cutoff)
        self._prune_multipart(protected_multipart | active_ids | protected_sources)
        print(
            f"[cleanup] complete dry_run={self.dry_run} active={len(active_ids)} "
            f"reconciled={reconciled} jobs={pruned_jobs} paths={removed_paths + orphan_paths} errors={errors} "
            f"objects={deleted_objects} read_files={removed_reads} local_cutoff={local_cutoff.isoformat()} "
            f"raw_cutoff={minio_cutoffs['raw'].isoformat()} "
            f"results_cutoff={minio_cutoffs['results'].isoformat()} "
            f"failed_cutoff={minio_cutoffs['failed'].isoformat()}",
            flush=True,
        )
        if errors:
            raise RuntimeError(f"{errors} job cleanup operations failed; inspect logs before retrying")

    def run_forever(self) -> None:
        stopping = False

        def stop(*_args) -> None:
            nonlocal stopping
            stopping = True

        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        while not stopping:
            try:
                self.run_once()
            except Exception as exc:
                print(f"[cleanup][error] cycle failed: {exc}", flush=True)
            for _ in range(self.interval_seconds):
                if stopping:
                    break
                time.sleep(1)


def main() -> None:
    parser = argparse.ArgumentParser(description="Clean expired GENOCULAR job storage")
    parser.add_argument("--once", action="store_true", help="run one cleanup cycle and exit")
    parser.add_argument("--dry-run", action="store_true", help="report candidates without changing anything")
    args = parser.parse_args()
    worker = CleanupWorker(dry_run=args.dry_run)
    if args.once:
        worker.run_once()
    else:
        worker.run_forever()


if __name__ == "__main__":
    main()
