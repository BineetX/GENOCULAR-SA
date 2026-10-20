import datetime as dt
import io
import json
import pathlib
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from cleanup_worker import CleanupWorker, _path_activity, _safe_job_path, _safe_job_prefix, _raw_source_ids
from models import JobStatus


JOB_ID = "123e4567-e89b-42d3-a456-426614174000"


class CleanupPathSafetyTests(unittest.TestCase):
    def test_accepts_direct_uuid_child(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            self.assertEqual(_safe_job_path(root, JOB_ID), root / JOB_ID)

    def test_rejects_non_uuid_and_symlink(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            self.assertIsNone(_safe_job_path(root, "../jobs"))
            target = root / "target"
            target.mkdir()
            (root / JOB_ID).symlink_to(target, target_is_directory=True)
            self.assertIsNone(_safe_job_path(root, JOB_ID))

    def test_activity_uses_log_marker(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / JOB_ID
            (path / "logs").mkdir(parents=True)
            log = path / "logs" / "snakemake.log"
            log.write_text("done\n")
            self.assertIsNotNone(_path_activity(path))

    def test_accepts_only_job_scoped_object_prefixes(self):
        self.assertEqual(_safe_job_prefix(JOB_ID, f"{JOB_ID}/"), f"{JOB_ID}/")
        self.assertEqual(_safe_job_prefix(JOB_ID, f"/{JOB_ID}/nested/"), f"{JOB_ID}/nested/")
        self.assertIsNone(_safe_job_prefix(JOB_ID, ""))
        self.assertIsNone(_safe_job_prefix(JOB_ID, "/"))
        self.assertIsNone(_safe_job_prefix(JOB_ID, "another-job/"))


class CleanupRetentionTests(unittest.TestCase):
    @staticmethod
    def _job(**overrides):
        now = dt.datetime.now(dt.timezone.utc)
        values = {
            "job_id": JOB_ID,
            "status": JobStatus.succeeded,
            "created_at": now - dt.timedelta(days=3),
            "started_at": now - dt.timedelta(days=3),
            "finished_at": now - dt.timedelta(days=2),
            "input_manifest": {},
            "raw_prefix": f"{JOB_ID}/",
            "results_prefix": f"{JOB_ID}/",
            "log_prefix": f"{JOB_ID}/",
        }
        values.update(overrides)
        return SimpleNamespace(**values)

    def test_raw_can_expire_before_results(self):
        worker = object.__new__(CleanupWorker)
        now = dt.datetime.now(dt.timezone.utc)
        cutoffs = {
            "raw": now - dt.timedelta(days=1),
            "results": now - dt.timedelta(days=7),
            "logs": now - dt.timedelta(days=7),
            "failed": now - dt.timedelta(days=1),
        }
        self.assertEqual(
            worker._eligible_minio_kinds(self._job(), set(), [], cutoffs),
            ["raw"],
        )

    def test_active_job_is_never_eligible(self):
        worker = object.__new__(CleanupWorker)
        now = dt.datetime.now(dt.timezone.utc)
        cutoffs = {kind: now for kind in ("raw", "results", "logs", "failed")}
        self.assertEqual(
            worker._eligible_minio_kinds(self._job(), {JOB_ID}, [], cutoffs),
            [],
        )

    def test_failed_job_uses_short_retention_for_every_minio_kind(self):
        worker = object.__new__(CleanupWorker)
        now = dt.datetime.now(dt.timezone.utc)
        cutoffs = {
            "raw": now - dt.timedelta(days=1),
            "results": now - dt.timedelta(days=7),
            "logs": now - dt.timedelta(days=7),
            "failed": now - dt.timedelta(days=1),
        }
        job = self._job(status=JobStatus.failed)
        self.assertEqual(
            worker._eligible_minio_kinds(job, set(), [], cutoffs),
            ["raw", "results", "logs"],
        )

    def test_successful_job_requires_published_results(self):
        worker = object.__new__(CleanupWorker)
        worker.s3 = MagicMock()
        worker.s3.get_paginator.return_value.paginate.return_value = [{}]
        worker.buckets = ("raw", "results", "logs")
        self.assertFalse(worker._results_available(self._job()))

    def test_partial_result_upload_is_not_enough_to_delete_workspace(self):
        with tempfile.TemporaryDirectory() as tmp:
            worker = object.__new__(CleanupWorker)
            worker.jobs_root = pathlib.Path(tmp)
            worker.buckets = ("raw", "results", "logs")
            output = worker.jobs_root / JOB_ID / "OUTPUT" / "sample"
            output.mkdir(parents=True)
            (output / "assembly.fa").write_text("ACGT")
            worker.s3 = MagicMock()
            paginator = worker.s3.get_paginator.return_value
            objects = [{"Key": f"{JOB_ID}/analysis/index.json", "Size": 10}]
            paginator.paginate.return_value = [{"Contents": objects}]
            self.assertFalse(worker._results_available(self._job()))
            objects.append({"Key": f"{JOB_ID}/assembly.fa", "Size": 3})
            self.assertFalse(worker._results_available(self._job()))
            objects[-1]["Size"] = 4
            self.assertTrue(worker._results_available(self._job()))

    def test_shared_raw_sources_are_detected(self):
        self.assertEqual(_raw_source_ids({"r1_key": f"{JOB_ID}/reads.fq", "files": [{"key": f"{JOB_ID}/reads2.fq"}]}), {JOB_ID})

    def test_partial_minio_delete_failure_is_not_counted_as_success(self):
        worker = object.__new__(CleanupWorker)
        worker.s3 = MagicMock()
        worker.s3.get_paginator.return_value.paginate.return_value = [{"Contents": [{"Key": f"{JOB_ID}/a"}]}]
        worker.s3.delete_objects.return_value = {"Errors": [{"Key": f"{JOB_ID}/a", "Code": "AccessDenied"}]}
        with self.assertRaises(RuntimeError):
            worker._delete_prefix("raw", f"{JOB_ID}/")

    def test_lost_maintenance_lease_stops_deletion(self):
        worker = object.__new__(CleanupWorker)
        worker._lease = MagicMock()
        worker._lease.owned.return_value = False
        worker.s3 = MagicMock()
        worker.s3.get_paginator.return_value.paginate.return_value = [{"Contents": [{"Key": f"{JOB_ID}/a"}]}]
        with self.assertRaises(RuntimeError):
            worker._delete_prefix("raw", f"{JOB_ID}/")
        worker.s3.delete_objects.assert_not_called()

    def test_old_draft_with_recent_upload_is_preserved(self):
        worker = object.__new__(CleanupWorker)
        job = self._job(status=JobStatus.queued, rq_job_id=None, finished_at=None)
        now = dt.datetime.now(dt.timezone.utc)
        with patch.object(worker, "_rq_job", return_value=None), patch.object(worker, "_stored_terminal_status", return_value=(None, "", None)), patch.object(worker, "_input_activity", return_value=now):
            self.assertFalse(worker._reconcile_job(job, set(), now - dt.timedelta(days=2), []))
        self.assertEqual(job.status, JobStatus.queued)

    def test_analysis_contract_fails_closed(self):
        worker = object.__new__(CleanupWorker)
        worker.buckets = ("raw", "results", "logs")
        worker.s3 = MagicMock()
        worker._stored_terminal_status = lambda _: (JobStatus.succeeded, "", None)
        payload = {"version": 2, "job_id": JOB_ID, "sections": [{"path": "analysis/report.html", "data_path": "analysis/data.json"}]}
        worker.s3.get_object.side_effect = lambda **_: {"Body": io.BytesIO(json.dumps(payload).encode())}
        worker.s3.head_object.return_value = {"ContentLength": 20}
        self.assertEqual(worker._published_analysis(self._job()), {"analysis/index.json", "analysis/report.html", "analysis/data.json"})
        for bad in ("../foreign", "/absolute", "analysis/../raw", "a\\b", "a//b", ""):
            payload["sections"][0]["path"] = bad
            self.assertIsNone(worker._published_analysis(self._job()))
        payload["sections"][0]["path"] = "analysis/report.html"
        payload["job_id"] = "another-job"
        self.assertIsNone(worker._published_analysis(self._job()))
        payload["job_id"] = JOB_ID
        worker.s3.head_object.return_value = {"ContentLength": 0}
        self.assertIsNone(worker._published_analysis(self._job()))
        worker._stored_terminal_status = lambda _: (None, "", None)
        self.assertIsNone(worker._published_analysis(self._job()))

    def test_inconsistent_success_is_preserved_even_after_seven_days(self):
        worker = object.__new__(CleanupWorker)
        for name in ("storage", "local", "raw", "result", "log", "failed", "abandoned", "orphan"):
            setattr(worker, name + "_retention_days", 7)
        worker.dry_run = True
        worker._active_pipeline_ids = MagicMock(return_value=set())
        worker._rq_job = MagicMock(return_value=None)
        worker._job_paths = MagicMock(return_value=[])
        worker._reconcile_job = MagicMock(return_value=False)
        worker._eligible_local = MagicMock(return_value=True)
        worker._published_analysis = MagicMock(return_value=None)
        worker._prune_job = MagicMock(return_value=(0, 0))
        worker._prune_orphans = MagicMock(return_value=0)
        worker._prune_multipart = MagicMock()
        job = self._job(rq_job_id=None, finished_at=dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=9))
        with patch("cleanup_worker.get_db") as session:
            session.return_value.__enter__.return_value.query.return_value.all.return_value = [job]
            worker._run_once()
        worker._prune_job.assert_not_called()

    def test_demo_job_never_enters_destructive_retention(self):
        worker = object.__new__(CleanupWorker)
        for name in ("storage", "local", "raw", "result", "log", "failed", "abandoned", "orphan"):
            setattr(worker, name + "_retention_days", 7)
        worker.dry_run = True
        worker._active_pipeline_ids = MagicMock(return_value=set())
        worker._job_paths = MagicMock()
        worker._reconcile_job = MagicMock()
        worker._prune_orphans = MagicMock(return_value=0)
        worker._prune_multipart = MagicMock()
        job = self._job(
            job_id=f"demo-{JOB_ID}",
            status=JobStatus.queued,
            rq_job_id=None,
            input_manifest={"is_demo": True},
        )
        with patch("cleanup_worker.get_db") as session:
            session.return_value.__enter__.return_value.query.return_value.all.return_value = [job]
            worker._run_once()
        worker._job_paths.assert_not_called()
        worker._reconcile_job.assert_not_called()

    def test_disposable_reads_are_narrowly_scoped(self):
        for path in ("MAG_shortread_results/fastp/reads.fastq", "hybrid_results/host_removal_sr/sample/r1.fq.gz"):
            self.assertTrue(CleanupWorker._disposable_read(pathlib.PurePosixPath(path)))
        for path in ("analysis/reads.fastq", "hybrid_results/assembly/final.contigs.fa", "hybrid_results/fastp/report.json", "unknown/fastp/r1.fastq", "hybrid_results/mapping/r1.bam"):
            self.assertFalse(CleanupWorker._disposable_read(pathlib.PurePosixPath(path)))

    def test_selective_pruning_preserves_unpublished_results_and_symlinks(self):
        with tempfile.TemporaryDirectory() as tmp:
            worker = object.__new__(CleanupWorker)
            worker.jobs_root = pathlib.Path(tmp) / "jobs"
            worker.scratch_root = pathlib.Path(tmp) / "scratch"
            worker.dry_run = True
            worker.buckets = ("raw", "results", "logs")
            worker.s3 = MagicMock()
            disposable = f"{JOB_ID}/hybrid_results/fastp/r1.fastq"
            worker.s3.get_paginator.return_value.paginate.return_value = [{"Contents": [
                {"Key": disposable, "Size": 5},
                {"Key": f"{JOB_ID}/hybrid_results/assembly/final.fa", "Size": 5}]}]
            worker.s3.delete_objects.return_value = {}
            sample = worker.jobs_root / JOB_ID / "OUTPUT" / "sample"
            reads = sample / "hybrid_results" / "fastp"
            reads.mkdir(parents=True)
            read = reads / "r1.fastq"
            read.write_text("reads")
            final = reads / "report.json"
            final.write_text("results")
            link = reads / "external.fastq"
            link.symlink_to(final)
            scratch = worker.scratch_root / JOB_ID
            scratch.mkdir(parents=True)
            (scratch / "raw.fastq").write_text("reads")
            worker._prune_success_inputs(self._job(), {"analysis/report.html"})
            self.assertTrue(read.exists())
            self.assertTrue(scratch.exists())
            worker.s3.delete_objects.assert_not_called()
            with self.assertRaises(ValueError):
                worker._prune_success_inputs(self._job(), {"inputs/reads.fastq"})
            worker.dry_run = False
            worker._prune_success_inputs(self._job(), {"analysis/report.html"})
            self.assertFalse(read.exists())
            self.assertFalse(scratch.exists())
            self.assertTrue(final.exists())
            self.assertTrue(link.is_symlink())
            worker.s3.delete_objects.assert_called_once_with(Bucket="results", Delete={"Objects": [{"Key": disposable}]})


if __name__ == "__main__":
    unittest.main()
