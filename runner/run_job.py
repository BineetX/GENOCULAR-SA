#!/opt/conda/envs/snakemake/bin/python
import os, json, sys, subprocess, pathlib, shlex, datetime

PY = "/opt/conda/envs/snakemake/bin/python"
STATUS_WRITER = "/app/status_writer.py"

# Where the Snakefile writes outputs/logs (BASE in config)
PIPELINE_BASE = os.getenv("PIPELINE_BASE", "/data/genoverse")

# Prefer a single source of truth for the working root.
# Keep your previous behavior by defaulting to /scratch.
WORK_ROOT = os.getenv("WORK_ROOT", os.getenv("SCRATCH_DIR", "/scratch"))

def emit(payload: dict):
    p = subprocess.Popen([PY, STATUS_WRITER], stdin=subprocess.PIPE, text=True)
    p.communicate(json.dumps(payload))

def s(k, d=""):
    v = os.environ.get(k, d)
    return "" if v is None else str(v)

def die(msg, code=1):
    emit({"state": "failed", "message": msg})
    sys.stderr.write(msg + "\n")
    sys.exit(code)

def stage_from_s3(s3url: str, dest: pathlib.Path) -> bool:
    p = subprocess.run(
        [PY, STATUS_WRITER, "download", s3url, str(dest)],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
    )
    return p.returncode == 0

def upload_dir_to_results(job_id: str, results_dir: pathlib.Path):
    subprocess.run([PY, STATUS_WRITER, "upload-tree", "results", job_id, str(results_dir)], check=False)

def upload_dir_to_logs(job_id: str, logs_dir: pathlib.Path):
    subprocess.run([PY, STATUS_WRITER, "upload-tree", "logs", job_id, str(logs_dir)], check=False)

def upload_log(job_id: str, log_file: pathlib.Path):
    subprocess.run([PY, STATUS_WRITER, "upload-log", job_id, str(log_file)], check=False)

# Step-timeline helpers
def steps_init(job_id: str, msg: str = "Pipeline starting"):
    subprocess.run([PY, STATUS_WRITER, "steps-init", job_id, msg], check=False)

def steps_message(job_id: str, msg: str):
    subprocess.run([PY, STATUS_WRITER, "steps", "message", job_id, "final_report", msg, "--msg", msg], check=False)

def main():
    if len(sys.argv) != 2:
        die("usage: run_job.py /path/to/job.json")

    job_json = pathlib.Path(sys.argv[1]).resolve()
    with open(job_json) as f:
        job = json.load(f)

    job_id = job.get("job_id") or die("missing job_id")
    sample = job.get("sample", "")
    r1, r2 = job.get("r1"), job.get("r2")
    if not r1 or not r2:
        die("missing r1/r2")

    snakefile = pathlib.Path(s("SNAKEFILE_PATH", "/project/workflow/GenoVerse"))

    # === Working layout (keep what you were doing: /scratch by default) ===
    scratch = pathlib.Path(WORK_ROOT) / job_id
    inputs  = scratch / "inputs"
    work_logs = scratch / "logs"         # driver log dir
    results_dir = scratch / "results"    # optional local drop before upload (your Snakefile writes to PIPELINE_BASE)
    for d in (inputs, work_logs, results_dir):
        d.mkdir(parents=True, exist_ok=True)

    snakemake_log = work_logs / "snakemake.log"

    steps_init(job_id, "Pipeline starting")

    # 1) Stage inputs
    emit({"state": "running", "message": "staging inputs", "completed": 0, "total": 1})
    loc_r1 = inputs / pathlib.Path(r1).name
    loc_r2 = inputs / pathlib.Path(r2).name
    ok1 = stage_from_s3(r1, loc_r1)
    ok2 = stage_from_s3(r2, loc_r2)
    if not (ok1 and ok2):
        die("staging failed")

    # 2) Build config.json (what your Snakefile requires)
    cfg = {
        "sample": sample,
        "R1": str(loc_r1),
        "R2": str(loc_r2),
        "JOB_ID": job_id,
        "BASE": PIPELINE_BASE,
    }
    cfg_path = scratch / "config.json"
    cfg_path.write_text(json.dumps(cfg, indent=2))

    # 3) Decide how to run Snakemake:
    #    - If SNAKEMAKE_SIF is set, run via Apptainer and bind WORK_ROOT + /data + /project + /dbs.
    #    - Else run directly (your previous behavior).
    sif = os.getenv("SNAKEMAKE_SIF", "").strip()
    conda_prefix = os.getenv("SHARED_CONDA_PREFIX", "/data/genoverse/smk_envs_v4/shared")
    cores = os.getenv("SNAKEMAKE_CORES", "8")
    latency = os.getenv("SNAKEMAKE_LATENCY", "180")
    conda_frontend = os.getenv("SNAKEMAKE_CONDA_FRONTEND", "").strip()

    if sif:
        # Apptainer path + binds
        apptainer_bin = os.getenv("APPTAINER_BIN", "/usr/bin/apptainer")
        if not pathlib.Path(apptainer_bin).exists():
            apptainer_bin = "apptainer"

        # Base binds; include WORK_ROOT so /scratch/<JOB> is visible inside the SIF
        binds = [
            "/data:/data",
            "/project:/project:ro",
            "/data/dbs:/dbs:ro",
            f"{WORK_ROOT}:{WORK_ROOT}"
        ]
        # Allow additional binds via env
        extra = os.getenv("APPTAINER_BINDPATH", "").strip()
        if extra:
            binds.extend([b for b in extra.split(",") if b.strip()])

        env_prefix = [
            "env",
            f"CONDA_PKGS_DIRS={PIPELINE_BASE}/conda_pkgs",
            "TMPDIR=/data/tmp",
            "TMP=/data/tmp",
        ]
        cmd = [
            apptainer_bin, "exec",
            "--no-mount", "proc,sys", 
            "--bind", ",".join(binds),
            sif,
            *env_prefix,
            "snakemake",
            "--snakefile", str(snakefile),
            "--use-conda",
            "--conda-frontend", conda_frontend or "conda",
            "--conda-prefix", conda_prefix,
            "--directory", str(scratch),
            "--cores", str(cores),
            "--printshellcmds",
            "--nolock",
            "--latency-wait", str(latency),
            "--configfile", str(cfg_path),
            "--keep-going",
            "--rerun-incomplete",
        ]
    else:
        # Direct run (your previous flow)
        cmd = [
            "snakemake",
            "-s", str(snakefile),
            "--configfile", str(cfg_path),
            "--latency-wait", str(latency),
            "--cores", str(cores),
            "--printshellcmds",
            "--keep-going",
            "--rerun-incomplete",
            "--use-conda",
        ]
        if conda_frontend:
            cmd += ["--conda-frontend", conda_frontend]
        # CWD ensures relative paths are local to this job
        # (we still pass --configfile with absolute path for clarity)

    emit({"state": "running", "message": "snakemake starting", "completed": 0, "total": 1})
    with open(snakemake_log, "w") as lf:
        lf.write(f"[{datetime.datetime.utcnow().isoformat()}Z] job={job_id} sample={sample}\n")
        lf.write(f"[cfg]\n{json.dumps(cfg, indent=2)}\n")
        lf.write(f"[cmd] {' '.join(shlex.quote(x) for x in cmd)}\n")
        proc = subprocess.run(cmd, cwd=str(scratch), stdout=lf, stderr=subprocess.STDOUT, text=True)
    rc = proc.returncode

    # 4) Upload runner log
    upload_log(job_id, snakemake_log)

    # 5) Upload pipeline outputs and rule logs written by the Snakefile
    out_root = pathlib.Path(PIPELINE_BASE).expanduser().resolve() / "jobs" / job_id / "OUTPUT" / sample
    snake_logs_dir = out_root / "logs"
    if snake_logs_dir.exists():
        upload_dir_to_logs(job_id, snake_logs_dir)
    if out_root.exists():
        upload_dir_to_results(job_id, out_root)

    # 6) Final status + rail message
    if rc == 0:
        emit({"state": "succeeded", "message": f"snakemake rc={rc}", "completed": 1, "total": 1})
        steps_message(job_id, "Pipeline complete")
    else:
        emit({"state": "failed", "message": f"snakemake rc={rc}", "completed": 1, "total": 1})
        steps_message(job_id, f"Pipeline failed (rc={rc})")
    sys.exit(rc)

if __name__ == "__main__":
    main()

