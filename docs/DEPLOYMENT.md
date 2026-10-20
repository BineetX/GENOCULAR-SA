# Deployment notes

## Service flow

```text
LAN browser :8080
        |
      Nginx ───── web (React static application)
        ├──────── api (FastAPI)
        └──────── MinIO S3 paths (/raw, /results, /demo-results)
                     |
API ─ PostgreSQL ─ Redis/RQ ─ runner ─ Snakemake/Conda ─ reference databases
 |                                  |
 └──────────── Ollama ──────────────┘
```

Nginx preserves the browser-facing Host header for S3 signatures. The API uses
the internal `minio:9000` endpoint for data access and the LAN URL when it signs
browser upload/download requests.

## Firebase

GENOCULAR verifies Firebase ID tokens using Google's published signing
certificates; no Firebase Admin private key is needed. Create a Firebase Web app
and copy its public configuration into `.env`. Enable Email/Password sign-in.
Google sign-in generally needs an authorized hostname and HTTPS; for a simple
HTTP private-IP deployment, use Email/Password or put GENOCULAR behind a local
DNS name and TLS proxy.

`VITE_ADMIN_EMAIL` controls which signed-in email is offered the frontend admin
navigation. Actual API administration also checks authenticated claims and LAN
access controls; use Firebase custom claims for production administration.

## CPU and GPU modes

`compose.yml` is CPU-compatible. `compose.gpu.yml` adds NVIDIA access to the
runner and Ollama and selects the GPU SemiBin engine. The setup script
auto-detects `nvidia-smi`, or the operator can force `--cpu`/`--gpu`.

GPU mode requires the NVIDIA driver and NVIDIA Container Toolkit on the Docker
host. Verify it before installation with:

```bash
docker run --rm --gpus all nvidia/cuda:12.9.1-base-ubuntu24.04 nvidia-smi
```

CPU mode skips the separate CUDA SemiBin environment. The hybrid metagenomics
workflow falls back to the CPU-capable binning environment.

## Storage

Named volumes hold PostgreSQL, MinIO objects, and Ollama models. Host bind paths
hold the much larger pipeline assets:

- `GENOCULAR_DB_ROOT` — read-only reference database tree
- `GENOCULAR_DATA_ROOT` — jobs, Conda packages/environments, runner home, queue
- `GENOCULAR_TMP_ROOT` — Apptainer/large temporary data
- `GENOCULAR_SCRATCH_ROOT` — active job staging and logs

Place these paths on a fast filesystem. The database snapshot alone is about
562 GiB; environment builds and concurrent jobs can require several hundred
additional gigabytes.

## LAN networking

`GENOCULAR_BIND_ADDRESS=0.0.0.0` listens on all host interfaces, while
`GENOCULAR_HOST` is the reachable address embedded in browser URLs. If the host
IP can change, reserve it in DHCP or use local DNS and pass that hostname to
`--lan-host`. Permit the configured HTTP port through the host firewall. Permit
the MinIO console port only from an administrator network.

Changing the host or port requires rerunning `Setup.sh --config-only`, then
rebuilding `web` because Firebase settings are Vite build arguments:

```bash
./Setup.sh --lan-host genocular.lab.local --http-port 8080 --config-only
./scripts/compose.sh up -d --build web api nginx
```

## Updates and recovery

Before updating, back up the named PostgreSQL and MinIO volumes and the host
paths. Do not use `docker compose down --volumes` during an ordinary update.
After pulling source changes, run `./Setup.sh` again; it preserves existing
secrets, downloaded files, named volumes, and valid Conda environments.

The MinIO server and command-line client are built from pinned upstream
Community source tags rather than the licensed AIStor image used on the source
server. Review and advance `MINIO_VERSION` and `MC_VERSION` deliberately, test
S3 presigned uploads/downloads, and retain a recoverable object-store backup
before upgrading them.
