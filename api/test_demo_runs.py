import datetime as dt

from demo_runs import build_demo_snapshot, fixture_prefix, normalize_demo_profile


START = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
MANIFEST = {
    "is_demo": True,
    "demo_profile": "wgs:short",
    "demo_duration_seconds": 60,
}


def snapshot_at(seconds: int):
    return build_demo_snapshot(MANIFEST, START, now=START + dt.timedelta(seconds=seconds))


def test_demo_timeline_transitions():
    assert snapshot_at(0)["state"] == "queued"
    assert snapshot_at(10)["state"] == "running"
    assert snapshot_at(56)["message"].startswith("Finalizing")
    assert snapshot_at(60)["state"] == "done"
    assert snapshot_at(60)["completed"] == snapshot_at(60)["total"] == 27


def test_all_profile_forms_and_fixture_prefix():
    assert normalize_demo_profile("metagenomics_hybrid") == "metagenomics:hybrid"
    assert fixture_prefix("metagenomics:hybrid") == "profiles/metagenomics-hybrid/v1/"


def test_cancelled_demo_is_terminal():
    snap = build_demo_snapshot(MANIFEST, START, now=START, cancelled=True)
    assert snap["state"] == "cancelled"
    assert snap["is_demo"] is True
