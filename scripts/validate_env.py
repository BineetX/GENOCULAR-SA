#!/usr/bin/env python3
"""Validate local configuration without evaluating it as shell code."""

from __future__ import annotations

import sys
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if "=" not in line:
            raise ValueError(f"{path.name}:{number}: expected KEY=value")
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def main() -> int:
    if not ENV_PATH.is_file():
        print("ERROR: .env is missing; run ./Setup.sh", file=sys.stderr)
        return 1
    try:
        values = parse_env(ENV_PATH)
    except (OSError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    required = (
        "POSTGRES_PASSWORD",
        "MINIO_ROOT_PASSWORD",
        "API_SECRET",
        "JOB_TOKEN_PEPPER",
        "FRONTEND_URL",
        "MINIO_PUBLIC_ENDPOINT",
        "MINIO_CONSOLE_URL",
        "CORS_ALLOWED_ORIGINS",
        "GENOCULAR_DB_ROOT",
        "VITE_FIREBASE_API_KEY",
        "VITE_FIREBASE_AUTH_DOMAIN",
        "VITE_FIREBASE_PROJECT_ID",
        "VITE_FIREBASE_APP_ID",
    )
    errors: list[str] = []
    for key in required:
        value = values.get(key, "")
        if not value or "CHANGE_ME" in value or "SETUP_" in value:
            errors.append(f"{key} is not configured")

    for key in ("FRONTEND_URL", "MINIO_PUBLIC_ENDPOINT", "MINIO_CONSOLE_URL"):
        parsed = urlparse(values.get(key, ""))
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            errors.append(f"{key} must be an absolute http(s) URL")
        elif parsed.hostname == "0.0.0.0":
            errors.append(f"{key} must advertise a reachable IP/DNS name, not 0.0.0.0")

    for key in ("JOB_UID", "JOB_GID"):
        try:
            if int(values.get(key, "")) < 0:
                raise ValueError
        except ValueError:
            errors.append(f"{key} must be a non-negative integer")

    if values.get("GENOCULAR_ACCELERATOR") not in {"cpu", "gpu"}:
        errors.append("GENOCULAR_ACCELERATOR must be cpu or gpu")
    if values.get("SEMIBIN_ENGINE") not in {"cpu", "gpu", "auto"}:
        errors.append("SEMIBIN_ENGINE must be cpu, gpu, or auto")

    if errors:
        print("Configuration is incomplete:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        print("Edit .env or export the Firebase VITE_* values and rerun ./Setup.sh.", file=sys.stderr)
        return 1

    print("Environment configuration is valid.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
