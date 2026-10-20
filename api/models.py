import uuid
import datetime as dt
import enum
import os

from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import String, Text, JSON, Enum, DateTime, Index, ForeignKey

TENANT_ID = os.getenv("TENANT_ID", "cbb")


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy models."""
    pass


class JobStatus(str, enum.Enum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"


class Job(Base):
    """
    Persistent job record for:
      - per-user history
      - admin dashboard
      - cancel / status inspection

    `job_id` is the externally-visible pipeline job id (the UUID you generate
    on the client and pass to /jobs/{job_id}/...).

    `id` is an internal surrogate primary key.
    """

    __tablename__ = "jobs"

    # Internal PK (surrogate)
    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )

    # Public pipeline job id (what frontend uses in URLs)
    job_id: Mapped[str] = mapped_column(
        String(64),
        unique=True,
        index=True,
        doc="Pipeline job id used in API paths (/jobs/{job_id}).",
    )

    # Multi-tenant support
    tenant_id: Mapped[str] = mapped_column(
        String(32),
        default=TENANT_ID,
        index=True,
    )

    # Who submitted the job (Firebase uid or email)
    user_id: Mapped[str] = mapped_column(
        String(128),
        index=True,
    )

    # email address to notify for this job
    user_email: Mapped[str | None] = mapped_column(
        String(256),
        nullable=True,
        doc="Email address to notify on job submit/complete.",
    )

    # Optional human-readable sample / job name (e.g. ILSM1213)
    sample: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
    )

    # Timestamps
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: dt.datetime.now(dt.timezone.utc),
    )
    started_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    finished_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Status + short message
    status: Mapped[JobStatus] = mapped_column(
        Enum(JobStatus),
        default=JobStatus.queued,
        index=True,
    )
    message: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        doc="Short human-readable status message.",
    )

    # Input description (filenames, sizes, etc.) – optional but usually filled
    input_manifest: Mapped[dict] = mapped_column(
        JSON,
        doc="JSON manifest of inputs (R1/R2 etc.).",
    )

    # Storage layout (MinIO / S3 prefixes)
    raw_prefix: Mapped[str] = mapped_column(
        Text,
        doc="Prefix in RAW bucket where original uploads live.",
    )
    results_prefix: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        doc="Prefix in RESULTS bucket where pipeline outputs are written.",
    )
    log_prefix: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        doc="Prefix in LOGS bucket for this job (snakemake.log, status.json, steps.json).",
    )

    # RQ job id (so admin cancel can talk directly to RQ)
    rq_job_id: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        index=True,
        doc="Underlying RQ job id (if known).",
    )

    # Longer error text if something exploded
    error_text: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        doc="Full error text / traceback, if captured.",
    )

    __table_args__ = (
        Index("ix_jobs_tenant_user", "tenant_id", "user_id"),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Job job_id={self.job_id} user_id={self.user_id} status={self.status}>"


class JobAccessGrant(Base):
    """Hashed, job-scoped capability used for account-free access."""

    __tablename__ = "job_access_grants"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    job_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("jobs.job_id", ondelete="CASCADE"),
        index=True,
    )
    token_digest: Mapped[str] = mapped_column(
        String(64),
        unique=True,
        index=True,
    )
    scope: Mapped[str] = mapped_column(
        String(16),
        default="owner",
    )
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: dt.datetime.now(dt.timezone.utc),
    )
    expires_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True),
        index=True,
    )
    revoked_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_used_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    __table_args__ = (
        Index("ix_job_access_grants_job_scope", "job_id", "scope"),
    )
