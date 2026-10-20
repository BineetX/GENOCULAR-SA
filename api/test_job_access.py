import asyncio
import datetime as dt
import unittest
from contextlib import contextmanager
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException, Response
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import main
import email_utils
from models import Base, Job, JobAccessGrant, JobStatus


class JobAccessTests(unittest.TestCase):
    def setUp(self):
        self.previous_pepper = main.JOB_TOKEN_PEPPER
        self.previous_runner_token = main.RUNNER_WEBHOOK_TOKEN
        self.previous_get_db = main.get_db
        main.JOB_TOKEN_PEPPER = b"test-only-pepper"
        main.RUNNER_WEBHOOK_TOKEN = b"test-runner-secret"
        engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()

    def tearDown(self):
        self.db.close()
        main.JOB_TOKEN_PEPPER = self.previous_pepper
        main.RUNNER_WEBHOOK_TOKEN = self.previous_runner_token
        main.get_db = self.previous_get_db

    def make_job(self, job_id="11111111-1111-4111-8111-111111111111"):
        job = Job(
            job_id=job_id,
            user_id=f"anonymous:{job_id}",
            sample="test",
            input_manifest={"access_mode": "job_capability"},
            raw_prefix=f"{job_id}/",
            results_prefix=f"{job_id}/",
            log_prefix=f"{job_id}/",
            status=JobStatus.queued,
        )
        self.db.add(job)
        self.db.flush()
        return job

    def test_owner_token_is_hashed_and_job_scoped(self):
        job = self.make_job()
        grant, token = main._issue_job_access_grant(self.db, job.job_id, scope="owner")
        self.db.commit()

        self.assertTrue(token.startswith("gja_"))
        self.assertNotEqual(grant.token_digest, token)
        self.assertIsNone(
            self.db.query(JobAccessGrant).filter_by(token_digest=token).one_or_none()
        )

        credential = {"kind": "capability", "token": token}
        authorized = main._assert_job_access(
            self.db, job.job_id, credential, required_scope="owner"
        )
        self.assertEqual(authorized.job_id, job.job_id)
        self.assertEqual(credential["scope"], "owner")

        grant_count = self.db.query(JobAccessGrant).count()
        submitter_url = main._submitter_job_url(self.db, job.job_id, credential)
        self.assertEqual(
            submitter_url,
            f"{main.FRONTEND_URL}/run?job_id={job.job_id}#access={token}",
        )
        self.assertEqual(self.db.query(JobAccessGrant).count(), grant_count)

        with self.assertRaises(HTTPException) as denied:
            main._assert_job_access(
                self.db,
                job.job_id,
                {"kind": "capability", "token": "gja_" + "x" * 43},
            )
        self.assertEqual(denied.exception.status_code, 404)

    def test_initialized_job_returns_expiry_after_session_close(self):
        job, expires_at, token = main._create_initialized_job(
            self.db,
            {"kind": "anonymous", "id": None, "email": None},
        )
        job_id = job.job_id
        self.db.close()

        self.assertTrue(token.startswith("gja_"))
        self.assertEqual(expires_at.tzinfo, dt.timezone.utc)
        self.assertGreater(expires_at, dt.datetime.now(dt.timezone.utc))
        self.assertTrue(job_id)

    def test_viewer_cannot_use_owner_actions(self):
        job = self.make_job()
        _, token = main._issue_job_access_grant(self.db, job.job_id, scope="viewer")
        self.db.commit()

        authorized = main._assert_job_access(
            self.db, job.job_id, {"kind": "capability", "token": token}
        )
        self.assertEqual(authorized.job_id, job.job_id)
        with self.assertRaises(HTTPException) as denied:
            main._assert_job_access(
                self.db,
                job.job_id,
                {"kind": "capability", "token": token},
                required_scope="owner",
            )
        self.assertEqual(denied.exception.status_code, 403)

    def test_expired_token_and_invalid_email_are_rejected(self):
        job = self.make_job()
        _, token = main._issue_job_access_grant(
            self.db,
            job.job_id,
            expires_at=dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=1),
        )
        self.db.commit()

        with self.assertRaises(HTTPException) as denied:
            main._assert_job_access(
                self.db, job.job_id, {"kind": "capability", "token": token}
            )
        self.assertEqual(denied.exception.status_code, 404)

        self.assertIsNone(main._normalize_optional_email(""))
        self.assertEqual(
            main._normalize_optional_email("researcher@example.org"),
            "researcher@example.org",
        )
        with self.assertRaises(HTTPException) as invalid_email:
            main._normalize_optional_email("not-an-email")
        self.assertEqual(invalid_email.exception.status_code, 400)

    def test_runner_notification_link_is_private_and_viewer_only(self):
        job = self.make_job()
        self.db.commit()

        @contextmanager
        def test_db():
            yield self.db

        main.get_db = test_db
        response = Response()
        created = main.create_notification_link(
            job.job_id,
            response,
            x_runner_token="test-runner-secret",
        )

        self.assertEqual(created.job_id, job.job_id)
        self.assertIn("#access=", created.private_path)
        self.assertEqual(response.headers["cache-control"], "no-store")
        access_key = created.private_path.split("#access=", 1)[1]
        self.assertTrue(access_key.startswith("gja_"))
        credential = {"kind": "capability", "token": access_key}
        main._assert_job_access(self.db, job.job_id, credential)
        self.assertEqual(credential["scope"], "viewer")
        with self.assertRaises(HTTPException) as denied:
            main.create_notification_link(
                job.job_id,
                Response(),
                x_runner_token="wrong-secret",
            )
        self.assertEqual(denied.exception.status_code, 403)

    def test_submission_email_preserves_private_access_link(self):
        job = self.make_job()
        job.user_email = "researcher@example.org"
        self.db.commit()
        private_url = (
            f"{main.FRONTEND_URL}/run?job_id={job.job_id}"
            "#access=gja_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"
        )

        with patch.object(email_utils, "_send_email") as send_email:
            email_utils.send_job_submitted_email(job, job_url_override=private_url)

        message = send_email.call_args.args[0]
        plain = message.get_body(preferencelist=("plain",)).get_content()
        html = message.get_body(preferencelist=("html",)).get_content()
        self.assertIn(private_url, plain)
        self.assertIn(f'href="{private_url}"', html)

    def test_mag_analysis_assets_include_genomes_without_raw_result_listing(self):
        job = self.make_job()
        _, token = main._issue_job_access_grant(self.db, job.job_id, scope="viewer")
        self.db.commit()

        @contextmanager
        def test_db():
            yield self.db

        main.get_db = test_db
        root = f"{job.job_id}/"
        analysis_key = root + "analysis/index.json"
        for mode, directory in (
            ("short", "MAG_shortread_results"),
            ("long", "longread_results"),
            ("hybrid", "hybrid_results"),
        ):
            with self.subTest(mode=mode):
                prefix = f"{root}{directory}/annotation/prokka/"
                genome_keys = [prefix + "sample/bin.01/bin.01.gbk", prefix + "sample/bin.02/bin.02.genbank"]
                objects = {
                    root + "analysis/": [{"Key": analysis_key}],
                    prefix: [{"Key": key} for key in genome_keys + [prefix + "sample/bin.01/bin.01.faa"]],
                }
                with (
                    patch.object(main, "_analysis_storage_for_job", return_value=("results", root, False)),
                    patch.object(main, "_get_json_bounded", return_value={"analysis_type": "metagenomics", "mode": mode, "sections": []}),
                    patch.object(main, "_list_prefix", side_effect=lambda bucket, path: objects[path]) as listing,
                    patch.object(main, "_presign", side_effect=lambda bucket, key, expires: "/signed/" + key),
                ):
                    result = main.list_analysis_assets(job.job_id, {"kind": "capability", "token": token})
                self.assertEqual({item.key for item in result.items}, {analysis_key, *genome_keys})
                self.assertTrue(all(item.url == "/signed/" + item.key for item in result.items))
                self.assertNotIn(root, [call.args[1] for call in listing.call_args_list])

    def test_analysis_assets_reject_invalid_access_before_reading_storage(self):
        job = self.make_job()
        self.db.commit()

        @contextmanager
        def test_db():
            yield self.db

        main.get_db = test_db
        with patch.object(main, "_analysis_storage_for_job") as storage:
            with self.assertRaises(HTTPException) as denied:
                main.list_analysis_assets(job.job_id, {"kind": "capability", "token": "gja_" + "x" * 43})
        self.assertEqual(denied.exception.status_code, 404)
        storage.assert_not_called()

    def test_canonical_analysis_root_does_not_scan_entire_job(self):
        job = self.make_job()
        with (
            patch.object(main, "_object_exists", return_value=True),
            patch.object(main, "_find_manifest_key") as scan,
        ):
            resolved = main._analysis_storage_for_job(job)
        self.assertEqual(resolved, (main.RESULTS_BUCKET, f"{job.job_id}/", False))
        scan.assert_not_called()

    def test_interpretation_queue_wait_returns_fallback_at_deadline(self):
        async def exercise():
            with (
                patch.object(main, "ANALYSIS_ASSISTANT_SEMAPHORE", asyncio.Semaphore(0)),
                patch.object(main, "ANALYSIS_ASSISTANT_TIMEOUT_SECONDS", 0.01),
                patch.object(main.httpx, "AsyncClient") as client,
            ):
                result = await main._call_analysis_model("test", {})
            self.assertIsNone(result)
            client.assert_not_called()

        asyncio.run(exercise())

    def test_summary_retries_after_model_recovery_instead_of_caching_fallback(self):
        job = self.make_job()
        _, token = main._issue_job_access_grant(self.db, job.job_id, scope="viewer")
        self.db.commit()

        @contextmanager
        def test_db():
            yield self.db

        main.get_db = test_db
        fact = {"id": "E-test", "label": "N50", "value": 1000, "title": "Assembly", "renderers": ["mag_assembly_v2"]}
        evidence = {"profile": "metagenomics:short", "sample": "test", "facts": [fact], "renderers": ["mag_assembly_v2"]}

        async def exercise():
            with (
                patch.object(main, "ANALYSIS_SUMMARY_CACHE", {}),
                patch.object(main, "_load_job_analysis_evidence", return_value=(evidence, "generation-1", [])),
                patch.object(main, "load_scientific_docs", return_value=("test-knowledge", [])),
                patch.object(main, "select_summary_evidence", return_value=[fact]),
                patch.object(main, "_call_analysis_model", new=AsyncMock(return_value=None)) as model,
                patch.object(main.time, "time", return_value=1000) as clock,
            ):
                first = await main.job_analysis_summary(job.job_id, {"kind": "capability", "token": token})
                self.assertFalse(first["grounded"])
                clock.return_value = 1031
                await main.job_analysis_summary(job.job_id, {"kind": "capability", "token": token})
                self.assertEqual(model.await_count, 2)
                clock.return_value = 1032
                await main.job_analysis_summary(job.job_id, {"kind": "capability", "token": token})
                self.assertEqual(model.await_count, 2)
                await main.job_analysis_summary(job.job_id, {"kind": "capability", "token": token}, retry=True)
                self.assertEqual(model.await_count, 3, "Retry bypasses a cached failed summary")

        asyncio.run(exercise())

    def test_concurrent_summary_viewers_share_work_and_survive_disconnect(self):
        job = self.make_job()
        _, token = main._issue_job_access_grant(self.db, job.job_id, scope="viewer")
        self.db.commit()

        @contextmanager
        def test_db():
            yield self.db

        main.get_db = test_db
        fact = {"id": "E-test", "label": "N50", "value": 1000, "title": "Assembly", "renderers": ["mag_assembly_v2"]}
        evidence = {"profile": "metagenomics:short", "sample": "test", "facts": [fact], "renderers": ["mag_assembly_v2"]}

        async def exercise():
            started, release = asyncio.Event(), asyncio.Event()

            async def generation(*args):
                started.set()
                await release.wait()
                return {"overview": "Assembly results were reviewed.", "assessment": "informative", "key_findings": [
                    {"title": "Assembly", "interpretation": "The reported N50 is 1000.", "confidence": "high", "evidence_ids": ["E-test"]}
                ], "limitations": [], "recommended_actions": []}

            with (
                patch.object(main, "ANALYSIS_SUMMARY_CACHE", {}),
                patch.object(main, "ANALYSIS_SUMMARY_IN_FLIGHT", {}),
                patch.object(main, "_load_job_analysis_evidence", return_value=(evidence, "generation-1", [])),
                patch.object(main, "load_scientific_docs", return_value=("test-knowledge", [])),
                patch.object(main, "select_summary_evidence", return_value=[fact]),
                patch.object(main, "_call_analysis_model", new=AsyncMock(side_effect=generation)) as model,
            ):
                first = asyncio.create_task(main.job_analysis_summary(job.job_id, {"kind": "capability", "token": token}))
                await started.wait()
                with self.assertRaises(HTTPException) as denied:
                    await main.job_analysis_summary(job.job_id, {"kind": "capability", "token": "gja_invalid"})
                self.assertEqual(denied.exception.status_code, 404)
                second = asyncio.create_task(main.job_analysis_summary(job.job_id, {"kind": "capability", "token": token}))
                await asyncio.sleep(0)
                first.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await first
                release.set()
                response = await second
                self.assertTrue(response["grounded"])
                self.assertEqual(model.await_count, 1)
                self.assertFalse(main.ANALYSIS_SUMMARY_IN_FLIGHT)
                await main.job_analysis_summary(job.job_id, {"kind": "capability", "token": token})
                self.assertEqual(model.await_count, 1, "The completed summary is cached")

        asyncio.run(exercise())


if __name__ == "__main__":
    unittest.main()
