#!/usr/bin/env python3
"""Create or safely update GENOCULAR's local .env without printing secrets."""

from __future__ import annotations

import argparse
import os
import re
import secrets
import shutil
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
EXAMPLE_PATH = ROOT / ".env.example"
HOST_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$")


def parse_env(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def replace_values(text: str, updates: dict[str, str]) -> str:
    remaining = dict(updates)
    output: list[str] = []
    for line in text.splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key = line.split("=", 1)[0].strip()
            if key in remaining:
                output.append(f"{key}={remaining.pop(key)}")
                continue
        output.append(line)
    if remaining:
        output.append("")
        output.extend(f"{key}={value}" for key, value in remaining.items())
    return "\n".join(output) + "\n"


def random_secret() -> str:
    return secrets.token_urlsafe(48)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", required=True)
    parser.add_argument("--http-port", type=int, default=8080)
    parser.add_argument("--console-port", type=int, default=9001)
    parser.add_argument("--uid", type=int, default=os.getuid())
    parser.add_argument("--gid", type=int, default=os.getgid())
    parser.add_argument("--accelerator", choices=("cpu", "gpu"), default="cpu")
    parser.add_argument("--database-path")
    args = parser.parse_args()

    if not HOST_RE.fullmatch(args.host) or args.host == "0.0.0.0":
        raise SystemExit("--host must be a LAN IP address or DNS name, not 0.0.0.0")
    for name, port in (("HTTP", args.http_port), ("console", args.console_port)):
        if not 1 <= port <= 65535:
            raise SystemExit(f"{name} port is outside 1..65535")

    if not ENV_PATH.exists():
        if not EXAMPLE_PATH.is_file():
            raise SystemExit(f"Missing template: {EXAMPLE_PATH}")
        shutil.copyfile(EXAMPLE_PATH, ENV_PATH)

    text = ENV_PATH.read_text(encoding="utf-8")
    current = parse_env(text)
    origin = f"http://{args.host}:{args.http_port}"
    console_origin = f"http://{args.host}:{args.console_port}"
    updates = {
        "GENOCULAR_HOST": args.host,
        "GENOCULAR_HTTP_PORT": str(args.http_port),
        "GENOCULAR_MINIO_CONSOLE_PORT": str(args.console_port),
        "FRONTEND_URL": origin,
        "MINIO_PUBLIC_ENDPOINT": origin,
        "MINIO_CONSOLE_URL": console_origin,
        "CORS_ALLOWED_ORIGINS": origin,
        "JOB_UID": str(args.uid),
        "JOB_GID": str(args.gid),
        "GENOCULAR_ACCELERATOR": args.accelerator,
        "SEMIBIN_ENGINE": "gpu" if args.accelerator == "gpu" else "cpu",
    }
    if args.database_path:
        db_path = Path(args.database_path).expanduser()
        if not db_path.is_absolute():
            db_path = (Path.cwd() / db_path).resolve()
        updates["GENOCULAR_DB_ROOT"] = str(db_path)

    for key in ("POSTGRES_PASSWORD", "MINIO_ROOT_PASSWORD", "API_SECRET", "JOB_TOKEN_PEPPER"):
        if not current.get(key) or current[key].startswith("SETUP_") or current[key] == "CHANGE_ME":
            updates[key] = random_secret()

    # CI and unattended installs may provide public Firebase Web values through
    # the process environment. Never overwrite an already configured .env.
    for key in (
        "VITE_FIREBASE_API_KEY",
        "VITE_FIREBASE_AUTH_DOMAIN",
        "VITE_FIREBASE_PROJECT_ID",
        "VITE_FIREBASE_APP_ID",
        "VITE_FIREBASE_MESSAGING_SENDER_ID",
        "VITE_FIREBASE_MEASUREMENT_ID",
        "VITE_ADMIN_EMAIL",
    ):
        supplied = os.environ.get(key, "").strip()
        existing = current.get(key, "").strip()
        if supplied and (not existing or existing == "CHANGE_ME"):
            updates[key] = supplied

    updated = replace_values(text, updates)
    # Replace any template tokens left in URL-like values from an older copy.
    updated = updated.replace("SETUP_LAN_HOST", args.host)
    updated = updated.replace("SETUP_UID", str(args.uid))
    updated = updated.replace("SETUP_GID", str(args.gid))

    fd, temporary_name = tempfile.mkstemp(prefix=".env-", dir=ROOT, text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(updated)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary_name, 0o600)
        os.replace(temporary_name, ENV_PATH)
    finally:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass

    print(f"Configured {ENV_PATH} for {origin} ({args.accelerator})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
