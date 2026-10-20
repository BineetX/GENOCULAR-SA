#!/usr/bin/env python3
"""Run the published HADEG Proteinortho workflow with resumable alignment work.

Proteinortho step 2 is isolated because it launches the DIAMOND pairwise
comparisons.  Completed comparisons are retained with ``-keep``.  If the
comparison cache stops changing, the entire Proteinortho process group is
terminated and only unfinished comparisons are retried.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
from typing import Sequence


MINIMUM_DIAMOND_VERSION = (2, 1, 20)


def log(message: str) -> None:
    print(f"[HADEG] {message}", file=sys.stderr, flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--proteinortho", required=True)
    parser.add_argument("--diamond", required=True)
    parser.add_argument("--workdir", required=True)
    parser.add_argument("--project", default="Results_HADEG")
    parser.add_argument("--threads", type=int, required=True)
    parser.add_argument("--stall-seconds", type=int, default=900)
    parser.add_argument("--max-attempts", type=int, default=3)
    parser.add_argument("--step-timeout-seconds", type=int, default=3600)
    parser.add_argument("fastas", nargs="+")
    args = parser.parse_args()

    if len(args.fastas) < 2:
        parser.error("at least two FAA files are required")
    if args.threads < 1:
        parser.error("--threads must be positive")
    if args.stall_seconds < 30:
        parser.error("--stall-seconds must be at least 30")
    if args.max_attempts < 1:
        parser.error("--max-attempts must be positive")
    if args.step_timeout_seconds < 60:
        parser.error("--step-timeout-seconds must be at least 60")
    return args


def executable_version(binary: str, label: str) -> tuple[str, tuple[int, ...]]:
    command = [binary, "version"] if label == "DIAMOND" else [binary, "--version"]
    completed = subprocess.run(
        command,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    output = completed.stdout.strip()
    match = re.search(r"(\d+)\.(\d+)\.(\d+)", output)
    if not match:
        raise RuntimeError(f"could not determine {label} version from: {output!r}")
    return output, tuple(int(part) for part in match.groups())


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def terminate_process_group(process: subprocess.Popen, grace_seconds: int = 10) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return

    deadline = time.monotonic() + grace_seconds
    while process.poll() is None and time.monotonic() < deadline:
        time.sleep(0.2)
    if process.poll() is None:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass


def run_bounded(command: Sequence[str], cwd: Path, env: dict[str, str], timeout: int) -> None:
    process = subprocess.Popen(command, cwd=cwd, env=env, start_new_session=True)
    try:
        return_code = process.wait(timeout=timeout)
    except BaseException:
        terminate_process_group(process)
        raise
    if return_code != 0:
        raise subprocess.CalledProcessError(return_code, command)


def cache_snapshot(blast_dir: Path) -> tuple[int, int, int, int]:
    final_count = 0
    temporary_count = 0
    total_size = 0
    newest_mtime_ns = 0
    if not blast_dir.exists():
        return final_count, temporary_count, total_size, newest_mtime_ns

    for path in blast_dir.iterdir():
        if not path.is_file() or not (path.name.endswith(".diamond") or path.name.endswith(".tmp")):
            continue
        try:
            stat = path.stat()
        except FileNotFoundError:
            continue
        total_size += stat.st_size
        newest_mtime_ns = max(newest_mtime_ns, stat.st_mtime_ns)
        if path.name.endswith(".diamond"):
            final_count += 1
        else:
            temporary_count += 1
    return final_count, temporary_count, total_size, newest_mtime_ns


def remove_temporary_outputs(blast_dir: Path) -> None:
    if not blast_dir.exists():
        return
    for path in blast_dir.glob("*.tmp"):
        try:
            path.unlink()
        except FileNotFoundError:
            pass


def run_alignment_step(
    command: Sequence[str],
    cwd: Path,
    env: dict[str, str],
    blast_dir: Path,
    expected_comparisons: int,
    stall_seconds: int,
    max_attempts: int,
) -> None:
    for attempt in range(1, max_attempts + 1):
        remove_temporary_outputs(blast_dir)
        initial = cache_snapshot(blast_dir)
        log(
            f"pairwise step attempt {attempt}/{max_attempts}; "
            f"reusing {initial[0]}/{expected_comparisons} completed comparisons"
        )
        process = subprocess.Popen(command, cwd=cwd, env=env, start_new_session=True)
        last_snapshot = initial
        last_activity = time.monotonic()
        last_reported_count = initial[0]
        stalled = False

        try:
            while True:
                return_code = process.poll()
                snapshot = cache_snapshot(blast_dir)
                if snapshot != last_snapshot:
                    last_snapshot = snapshot
                    last_activity = time.monotonic()
                if snapshot[0] != last_reported_count:
                    last_reported_count = snapshot[0]
                    log(f"pairwise comparisons {snapshot[0]}/{expected_comparisons}")

                if return_code is not None:
                    if return_code == 0:
                        if snapshot[0] != expected_comparisons:
                            raise RuntimeError(
                                "Proteinortho step 2 exited successfully but produced "
                                f"{snapshot[0]}/{expected_comparisons} cached comparisons"
                            )
                        return
                    break

                if time.monotonic() - last_activity >= stall_seconds:
                    stalled = True
                    log(
                        f"no pairwise output changed for {stall_seconds} seconds; "
                        "terminating the stalled Proteinortho process group"
                    )
                    terminate_process_group(process)
                    break
                time.sleep(5)
        except BaseException:
            terminate_process_group(process)
            raise

        if attempt == max_attempts:
            reason = "stalled" if stalled else f"exited with code {process.returncode}"
            raise RuntimeError(
                f"Proteinortho pairwise step {reason} after {max_attempts} attempts"
            )
        log("retrying only unfinished pairwise comparisons")


def atomic_write_json(path: Path, document: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def interrupt_handler(signum: int, _frame) -> None:
    raise InterruptedError(f"received signal {signum}")


def main() -> int:
    args = parse_args()
    signal.signal(signal.SIGTERM, interrupt_handler)
    signal.signal(signal.SIGINT, interrupt_handler)

    workdir = Path(args.workdir).resolve()
    workdir.mkdir(parents=True, exist_ok=True)
    fastas = [Path(path).resolve() for path in args.fastas]
    for fasta in fastas:
        if not fasta.is_file() or fasta.stat().st_size == 0:
            raise FileNotFoundError(f"FAA input is missing or empty: {fasta}")

    proteinortho_output, proteinortho_version = executable_version(
        args.proteinortho, "Proteinortho"
    )
    diamond_output, diamond_version = executable_version(args.diamond, "DIAMOND")
    if diamond_version < MINIMUM_DIAMOND_VERSION:
        required = ".".join(str(part) for part in MINIMUM_DIAMOND_VERSION)
        installed = ".".join(str(part) for part in diamond_version)
        raise RuntimeError(
            f"DIAMOND {installed} is unsafe for HADEG because earlier releases can deadlock; "
            f"version {required} or newer is required"
        )

    env = os.environ.copy()
    env["PATH"] = str(Path(args.diamond).resolve().parent) + os.pathsep + env.get("PATH", "")
    expected_comparisons = len(fastas) * (len(fastas) - 1) // 2
    cache_dir = workdir / f"proteinortho_cache_{args.project}"
    blast_dir = cache_dir / "blastfiles"
    output_tsv = workdir / f"{args.project}.proteinortho.tsv"
    if output_tsv.exists():
        output_tsv.unlink()

    common = [
        args.proteinortho,
        *(str(path) for path in fastas),
        "-identity=50",
        "-conn=0.3",
        "-synteny=0",
        f"-project={args.project}",
        "-p=diamond",
        f"-cpus={args.threads}",
        "-keep",
    ]

    log(f"Proteinortho version: {proteinortho_output}")
    log(f"DIAMOND version: {diamond_output}")
    log(
        f"running the published HADEG parameters for {len(fastas) - 1} MAG(s); "
        f"{expected_comparisons} pairwise comparisons"
    )
    log("step 1/3: preparing DIAMOND indices")
    run_bounded(
        [*common, "-step=1"],
        workdir,
        env,
        args.step_timeout_seconds,
    )

    log("step 2/3: calculating reciprocal protein similarities")
    run_alignment_step(
        [*common, "-step=2"],
        workdir,
        env,
        blast_dir,
        expected_comparisons,
        args.stall_seconds,
        args.max_attempts,
    )

    log("step 3/3: clustering putative co-orthologous groups")
    run_bounded(
        [*common, "-step=3"],
        workdir,
        env,
        args.step_timeout_seconds,
    )
    if not output_tsv.is_file() or output_tsv.stat().st_size == 0:
        raise RuntimeError(f"Proteinortho did not produce a non-empty result: {output_tsv}")

    metadata = {
        "schema_version": 1,
        "method": "HADEG Proteinortho orthology analysis",
        "parameters": {
            "identity": 50,
            "connectivity": 0.3,
            "synteny": 0,
            "search_backend": "diamond",
        },
        "proteinortho_version": ".".join(str(part) for part in proteinortho_version),
        "diamond_version": ".".join(str(part) for part in diamond_version),
        "hadeg_database": fastas[0].name,
        "hadeg_database_sha256": sha256_file(fastas[0]),
        "proteome_count": len(fastas) - 1,
        "pairwise_comparisons": expected_comparisons,
    }
    atomic_write_json(workdir / f"{args.project}.runtime.json", metadata)
    log(f"completed: {output_tsv}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        log(f"ERROR: {exc}")
        raise
