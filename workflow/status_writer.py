# /app/status_writer.py
import os, sys, json, pathlib, mimetypes, boto3, time
from botocore.config import Config
from urllib.parse import urlparse
from datetime import datetime

MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "http://minio:9000")
MINIO_ACCESS   = os.getenv("MINIO_ACCESS_KEY") or os.getenv("MINIO_ROOT_USER", "")
MINIO_SECRET   = os.getenv("MINIO_SECRET_KEY") or os.getenv("MINIO_ROOT_PASSWORD", "")
RAW_BUCKET     = os.getenv("RAW_BUCKET","raw")
RESULTS_BUCKET = os.getenv("RESULTS_BUCKET","results")
LOGS_BUCKET    = os.getenv("LOGS_BUCKET","logs")

s3 = boto3.client(
    "s3",
    endpoint_url=MINIO_ENDPOINT,
    aws_access_key_id=MINIO_ACCESS,
    aws_secret_access_key=MINIO_SECRET,
    config=Config(signature_version="s3v4", s3={"addressing_style":"path"}),
    region_name="us-east-1",
)

# ------------------------
# existing helpers
# ------------------------
def _s3_parse(s3url: str):
    # accepts s3://bucket/key  or raw/results/logs buckets by env
    if s3url.startswith("s3://"):
        u = urlparse(s3url)
        return u.netloc, u.path.lstrip("/")
    # fallback: treat as raw bucket key
    return RAW_BUCKET, s3url.lstrip("/")

def write_status(payload: dict):
    job_id = os.getenv("JOB_ID") or payload.get("job_id")
    if not job_id:
        return
    key = f"{job_id}/status.json"
    body = json.dumps(payload).encode("utf-8")
    s3.put_object(Bucket=LOGS_BUCKET, Key=key, Body=body, ContentType="application/json")

def cmd_upload_log(job_id: str, path: str):
    key = f"{job_id}/snakemake.log"
    with open(path, "rb") as f:
        s3.put_object(Bucket=LOGS_BUCKET, Key=key, Body=f, ContentType="text/plain; charset=utf-8")

def cmd_download(s3url: str, dest: str):
    b, k = _s3_parse(s3url)
    pathlib.Path(dest).parent.mkdir(parents=True, exist_ok=True)
    s3.download_file(b, k, dest)

def cmd_upload_tree(kind: str, job_id: str, root: str):
    bucket = RESULTS_BUCKET if kind == "results" else LOGS_BUCKET
    rootp = pathlib.Path(root)
    if not rootp.exists():
        return
    for p in rootp.rglob("*"):
        if p.is_file():
            rel = p.relative_to(rootp)
            key = f"{job_id}/{rel.as_posix()}"
            ctype, _ = mimetypes.guess_type(p.name)
            with open(p, "rb") as f:
                s3.put_object(Bucket=bucket, Key=key, Body=f, ContentType=ctype or "application/octet-stream")

# ------------------------
# NEW: step timeline helpers
# ------------------------
# Use your **rule names** as keys so calls like:
#   python /app/status_writer.py steps start <JOB_ID> trimmomatic "..."
# match exactly.
TOOL_ORDER = [
    "trimmomatic",
    "cutadapt_paired",
    "seqtk_trim",
    "bbduk",
    "spades",
    "prodigal",
    "prokka",
    "repeatmasker",
    "abricate",
    "kofamscan",
    "dbcan",
    "eggnog_mapper",
    "interproscan",
    "quast",
    "busco",
    "prepare_checkm_input",
    "checkm",
    "crispr",
    "antismash",
    "final_report",
    "manifest",
]

# Optional: nicer display names (fallbacks to key if missing)
FRIENDLY_NAMES = {
    "cutadapt_paired": "Cutadapt",
    "seqtk_trim": "Seqtk",
    "bbduk": "BBDuk",
    "spades": "SPAdes",
    "prodigal": "Prodigal",
    "prokka": "Prokka",
    "repeatmasker": "RepeatMasker",
    "abricate": "ABRicate",
    "kofamscan": "KofamScan",
    "dbcan": "dbCAN",
    "eggnog_mapper": "eggNOG-mapper",
    "interproscan": "InterProScan",
    "quast": "QUAST",
    "busco": "BUSCO",
    "prepare_checkm_input": "Prep CheckM",
    "checkm": "CheckM",
    "crispr": "CRISPRCasFinder",
    "antismash": "antiSMASH",
    "final_report": "Final Report",
    "manifest": "Manifest",
}

def _now_iso():
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"

def _steps_key(job_id: str) -> str:
    return f"{job_id}/steps.json"

def _steps_skeleton() -> dict:
    return {
        "state": "queued",
        "message": "",
        "completed": 0,
        "total": len(TOOL_ORDER),
        "steps": [
            {
                "key": k,
                "name": FRIENDLY_NAMES.get(k, k),
                "status": "queued",
                "outputs": []
            }
            for k in TOOL_ORDER
        ],
    }

def _steps_load(job_id: str) -> dict:
    """Load steps.json from LOGS_BUCKET; return skeleton if missing/invalid."""
    key = _steps_key(job_id)
    try:
        obj = s3.get_object(Bucket=LOGS_BUCKET, Key=key)
        return json.loads(obj["Body"].read())
    except Exception:
        return _steps_skeleton()

def _steps_write(job_id: str, payload: dict):
    s3.put_object(
        Bucket=LOGS_BUCKET,
        Key=_steps_key(job_id),
        Body=json.dumps(payload).encode("utf-8"),
        ContentType="application/json",
    )

def _steps_set_state(doc: dict):
    done = sum(1 for s in doc["steps"] if s.get("status") in ("done","skipped"))
    doc["completed"] = done
    doc["total"] = len(doc["steps"])
    if any(s.get("status") == "failed" for s in doc["steps"]):
        doc["state"] = "failed"
    elif done == len(doc["steps"]):
        doc["state"] = "done"
    elif any(s.get("status") == "running" for s in doc["steps"]):
        doc["state"] = "running"
    else:
        doc["state"] = "queued"

def _steps_upsert(doc: dict, key: str) -> dict:
    for s in doc["steps"]:
        if s["key"] == key:
            return s
    s = {"key": key, "name": FRIENDLY_NAMES.get(key, key), "status": "queued", "outputs": []}
    doc["steps"].append(s)
    doc["total"] = len(doc["steps"])
    return s

def cmd_steps_init(job_id: str, message: str = "Pipeline starting"):
    d = _steps_skeleton()
    d["state"] = "running"
    d["message"] = message
    _steps_set_state(d)
    _steps_write(job_id, d)

def cmd_steps_event(action: str, job_id: str, step_key: str, summary: str = "", msg: str = ""):
    d = _steps_load(job_id)
    s = _steps_upsert(d, step_key)

    if action == "start":
        s["status"]    = "running"
        s["startedAt"] = _now_iso()
        if summary: s["summary"] = summary
        if msg:      d["message"] = msg
    elif action == "done":
        s["status"]  = "done"
        s["endedAt"] = _now_iso()
        if summary: s["summary"] = summary
    elif action == "fail":
        s["status"]  = "failed"
        s["endedAt"] = _now_iso()
        if summary: s["summary"] = summary
        d["message"] = msg or f"{step_key} failed"
    elif action == "skip":
        s["status"]  = "skipped"
        s["endedAt"] = _now_iso()
        if summary: s["summary"] = summary
    elif action == "message":
        d["message"] = msg or summary
    else:
        print(f"unknown steps action: {action}", file=sys.stderr)
        sys.exit(2)

    _steps_set_state(d)
    _steps_write(job_id, d)

# ------------------------
# CLI
# ------------------------
def _parse_steps_args(rest):
    """
    Parse:
      steps-init <job_id> [message...]
      steps <action> <job_id> <step_key> [summary words ...] [--msg MESSAGE...]
    """
    if not rest:
        print("usage:\n  status_writer.py steps-init <job_id> [message]\n"
              "  status_writer.py steps <start|done|fail|skip|message> <job_id> <step_key> [summary] [--msg TEXT]",
              file=sys.stderr)
        sys.exit(2)

    sub = rest[0]

    if sub == "steps-init":
        if len(rest) < 2:
            print("usage: status_writer.py steps-init <job_id> [message]", file=sys.stderr)
            sys.exit(2)
        job_id = rest[1]
        message = " ".join(rest[2:]) if len(rest) > 2 else "Pipeline starting"
        cmd_steps_init(job_id, message)
        return True

    if sub == "steps":
        if len(rest) < 4:
            print("usage: status_writer.py steps <action> <job_id> <step_key> [summary] [--msg TEXT]", file=sys.stderr)
            sys.exit(2)
        action  = rest[1]
        job_id  = rest[2]
        step    = rest[3]

        # parse optional [summary words ...] and optional --msg
        summary_parts = []
        msg = ""
        i = 4
        while i < len(rest):
            if rest[i] == "--msg":
                msg = " ".join(rest[i+1:]) if i+1 < len(rest) else ""
                break
            summary_parts.append(rest[i])
            i += 1
        summary = " ".join(summary_parts).strip()

        cmd_steps_event(action, job_id, step, summary, msg)
        return True

    return False

def main():
    args = sys.argv
    if len(args) == 1:
        # read JSON from stdin and write status.json
        payload = json.load(sys.stdin)
        write_status(payload)
        return

    # NEW: handle step timeline commands first
    if _parse_steps_args(args[1:]):
        return

    # legacy/other commands
    cmd = args[1]
    if cmd == "upload-log":
        if len(args) != 4:
            print("usage: status_writer.py upload-log <job_id> <path>", file=sys.stderr)
            sys.exit(2)
        _, _, job_id, path = args
        cmd_upload_log(job_id, path)

    elif cmd == "upload-tree":
        if len(args) != 5:
            print("usage: status_writer.py upload-tree <results|logs> <job_id> <root>", file=sys.stderr)
            sys.exit(2)
        _, _, kind, job_id, root = args
        cmd_upload_tree(kind, job_id, root)

    elif cmd == "download":
        if len(args) != 4:
            print("usage: status_writer.py download <s3url> <dest>", file=sys.stderr)
            sys.exit(2)
        _, _, s3url, dest = args
        cmd_download(s3url, dest)

    else:
        print(f"unknown command: {cmd}", file=sys.stderr)
        sys.exit(2)

if __name__ == "__main__":
    main()

