"""Pure helpers for GENOCULAR's clock-driven demonstration runs."""

from __future__ import annotations

import datetime as dt
import math
from typing import Any, Dict


DEMO_DURATION_SECONDS = 60
DEMO_FIXTURE_VERSION = "v1"

DEMO_PROFILES: Dict[str, Dict[str, Any]] = {
    "wgs:short": {
        "label": "WGS · Short Reads",
        "slug": "wgs-short",
        "sample": "DEMO_ECOLI_SHORT",
        "total_steps": 27,
    },
    "wgs:long": {
        "label": "WGS · Long Reads",
        "slug": "wgs-long",
        "sample": "DEMO_ECOLI_LONG",
        "total_steps": 27,
    },
    "wgs:hybrid": {
        "label": "WGS · Hybrid",
        "slug": "wgs-hybrid",
        "sample": "DEMO_ECOLI_HYBRID",
        "total_steps": 32,
    },
    "metagenomics:short": {
        "label": "Metagenomics · Short Reads",
        "slug": "metagenomics-short",
        "sample": "DEMO_COMMUNITY_SHORT",
        "total_steps": 50,
    },
    "metagenomics:long": {
        "label": "Metagenomics · Long Reads",
        "slug": "metagenomics-long",
        "sample": "DEMO_COMMUNITY_LONG",
        "total_steps": 48,
    },
    "metagenomics:hybrid": {
        "label": "Metagenomics · Hybrid",
        "slug": "metagenomics-hybrid",
        "sample": "DEMO_COMMUNITY_HYBRID",
        "total_steps": 53,
    },
}


def normalize_demo_profile(value: Any) -> str:
    raw = str(value or "").strip().lower().replace("_", ":").replace("/", ":")
    return raw if raw in DEMO_PROFILES else ""


def is_demo_manifest(value: Any) -> bool:
    return isinstance(value, dict) and value.get("is_demo") is True


def fixture_prefix(profile: str, version: str = DEMO_FIXTURE_VERSION) -> str:
    config = DEMO_PROFILES[profile]
    safe_version = str(version or DEMO_FIXTURE_VERSION).strip().strip("/")
    return f"profiles/{config['slug']}/{safe_version}/"


def _as_utc(value: dt.datetime) -> dt.datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=dt.timezone.utc)
    return value.astimezone(dt.timezone.utc)


def build_demo_snapshot(
    manifest: Dict[str, Any],
    started_at: dt.datetime,
    *,
    now: dt.datetime | None = None,
    cancelled: bool = False,
) -> Dict[str, Any]:
    """Build status/rail data solely from start time; no worker is required."""
    profile = normalize_demo_profile(manifest.get("demo_profile") or manifest.get("pipeline_profile"))
    if not profile:
        raise ValueError("invalid demo profile")

    config = DEMO_PROFILES[profile]
    duration = int(manifest.get("demo_duration_seconds") or DEMO_DURATION_SECONDS)
    duration = max(10, min(duration, 300))
    current_time = _as_utc(now or dt.datetime.now(dt.timezone.utc))
    started = _as_utc(started_at)
    elapsed = max(0.0, (current_time - started).total_seconds())
    total = int(config["total_steps"])

    if cancelled:
        state = "cancelled"
        completed = min(total, max(0, int(manifest.get("demo_completed_steps") or 0)))
        message = "Demonstration cancelled. No scientific analysis was performed."
    elif elapsed < 4:
        state = "queued"
        completed = 0
        message = "Preparing synthetic demonstration inputs"
    elif elapsed < duration - 5:
        state = "running"
        work_span = max(1.0, float(duration - 9))
        fraction = min(1.0, max(0.0, (elapsed - 4.0) / work_span))
        completed = min(total - 1, int(math.floor(fraction * total)))
        message = f"Simulating analysis step {completed + 1} of {total}"
    elif elapsed < duration:
        state = "running"
        completed = total
        message = "Finalizing demonstration plots, interpretation, and report"
    else:
        state = "done"
        completed = total
        message = "Demonstration completed using example data"

    rail = {
        "profile": profile,
        "state": state,
        "message": message,
        "completed": completed,
        "total": total,
        # The frontend already owns the canonical six profile orders and can
        # synthesize step states from these counters without duplicating them.
        "steps": [],
    }
    return {
        "state": state,
        "completed": completed,
        "total": total,
        "message": message,
        "updated_at": current_time.timestamp(),
        "rail": rail,
        "queue_position": None,
        "queued_ahead": 0,
        "queue_depth": 0,
        "is_demo": True,
        "demo_duration_seconds": duration,
        "elapsed_seconds": min(duration, int(elapsed)),
    }
