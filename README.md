# GENOCULAR

GENOCULAR is a self-hosted web platform for microbial whole-genome sequencing
(WGS) and shotgun metagenomics. It takes raw short-read, long-read, or hybrid
FASTQ data through reproducible Snakemake workflows and presents progress,
downloadable results, interactive plots, reports, and local AI-assisted result
interpretation in a browser.

This repository is a portable Docker Compose deployment. It packages the web
application, API, workflow runner, six analysis profiles, object and relational
storage, queueing, local language models, and a LAN-facing reverse proxy.

> **Important:** this repository does not include the approximately 562 GiB
> reference-database tree, Firebase configuration, credentials, user uploads,
> previous job results, or persistent service state. Those are configured or
> created on the deployment host.

## Contents

- [What GENOCULAR provides](#what-genocular-provides)
- [Analysis profiles](#analysis-profiles)
- [Architecture](#architecture)
- [System requirements](#system-requirements)
- [Before installation](#before-installation)
- [First installation](#first-installation)
- [Setup options](#setup-options)
- [Configuration reference](#configuration-reference)
- [Using GENOCULAR](#using-genocular)
- [Day-to-day operations](#day-to-day-operations)
- [Storage, retention, and backups](#storage-retention-and-backups)
- [Updating an installation](#updating-an-installation)
- [Troubleshooting](#troubleshooting)
- [Security notes](#security-notes)
- [Repository layout](#repository-layout)
- [Development checks](#development-checks)
- [Licence and redistribution](#licence-and-redistribution)

## What GENOCULAR provides

- Guided submission of isolate WGS and metagenomics jobs from a browser.
- Short-read, long-read, and hybrid workflows with profile-specific inputs.
- Resumable browser uploads to S3-compatible storage.
- Queue-backed job execution with step-by-step progress and logs.
- Quality control, assembly, annotation, taxonomy, functional profiling, and
  other profile-dependent analyses.
- Organized result downloads, scientific plots, reports, and genome/MAG
  analysis views.
- Firebase authentication for account-linked history and private capability
  links for individual jobs.
- Local Ollama models for the general assistant and scientific result
  interpretation; sequence data does not need to be sent to a hosted LLM.
- Six lightweight demonstration profiles that work without running the real
  bioinformatics pipelines.
- CPU-only operation and an optional NVIDIA GPU mode.

GENOCULAR is intended to make established bioinformatics workflows easier to
operate and inspect. Its output is not a substitute for experimental
validation, expert review, or an appropriate clinical workflow.

## Analysis profiles

Choose an analysis type and read technology in the submission screen. FASTQ
and gzip-compressed FASTQ files are accepted by the workflow runner and are
validated before analysis begins.

| Profile | Required input | Intended use | Typical result categories |
| --- | --- | --- | --- |
| WGS · Short | Paired R1 and R2 files | Microbial isolate sequencing with Illumina-style reads | Read QC, short-read assembly, genome QC, annotation, resistance/virulence screening, functional analysis, reports |
| WGS · Long | One long-read file | Isolate sequencing with Oxford Nanopore or PacBio-style reads | Long-read QC/filtering, assembly and polishing, genome QC, annotation, functional analysis, reports |
| WGS · Hybrid | R1, R2, and one long-read file | Isolate assembly using short-read accuracy and long-read continuity | Hybrid assembly/polishing plus the WGS downstream analyses |
| Metagenomics · Short | Paired R1 and R2 files | Shotgun communities sequenced with short reads | QC, host decontamination, taxonomic profiling, assembly, binning, MAG QC/taxonomy, annotation, abundance, reports |
| Metagenomics · Long | One long-read file | Shotgun communities sequenced with long reads | Long-read QC/decontamination, assembly, binning, MAG analysis, annotation, abundance, reports |
| Metagenomics · Hybrid | R1, R2, and one long-read file | Communities with matching short- and long-read data | Hybrid assembly, mapping/binning, MAG QC/taxonomy, annotation, abundance, reports |

The exact tools and step graph differ by profile. The web application shows the
selected graph before submission and records the status of each step while the
job runs.

## Architecture

```text
LAN browser
    |
    | HTTP :8080 (default)
    v
  Nginx
    |-- React/Vite web application
    |-- FastAPI under /api
    `-- proxied MinIO object paths
             |
             +-------------------- MinIO
             |                      raw inputs, results, logs, demos
             |
          FastAPI
             |-- PostgreSQL         job and access metadata
             |-- Redis/RQ -------- runner
             |                       `-- Snakemake + isolated Conda envs
             `-- Ollama             local assistant/interpretation models
```

The deployment contains these Compose services:

| Service | Purpose |
| --- | --- |
| `nginx` | Single browser-facing gateway for the web UI, API, and signed object requests |
| `web` | Built React/Vite frontend served by a small runtime container |
| `api` | FastAPI service for uploads, jobs, access control, results, and assistants |
| `postgres` / `db-init` | Persistent application metadata and one-shot schema initialization |
| `redis` | RQ queue and coordination state |
| `runner` | FASTQ staging, validation, Snakemake execution, and result publication |
| `minio` / `minio-setup` | S3-compatible object storage, bucket creation, and demo fixture seeding |
| `ollama` | Local model serving |
| `cleanup` | Scheduled reconciliation and retention enforcement |

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for additional implementation and
networking notes.

## System requirements

### Required

- Linux on x86-64. The bundled bioinformatics environments currently do not
  support macOS, Windows, ARM, or AArch64 hosts.
- Docker Engine with the Compose v2 plugin (`docker compose`).
- Permission to use the Docker daemon.
- Python 3 and `curl` on the host.
- A stable LAN IP address or DNS name reachable by user browsers.
- Free TCP ports for the web gateway and MinIO console. Defaults are `8080` and
  `9001`.
- A Firebase project with a Web app and Email/Password authentication enabled.
- Access to the GENOCULAR reference-database tree, either in an existing local
  directory or through a configured Google Drive source.

### Recommended capacity

- 16 or more CPU cores.
- 64 GiB or more RAM.
- At least 1 TiB of fast local storage for the 562 GiB database snapshot,
  Conda environments, temporary files, uploads, and results.
- An NVIDIA GPU and NVIDIA Container Toolkit for faster compatible pipeline
  steps and local model inference.

CPU mode is fully supported, but metagenomics workflows and local AI inference
can be substantially slower. Actual resource use depends on read depth,
community complexity, enabled modules, and concurrent jobs.

Confirm the required host tools before starting:

```bash
docker --version
docker compose version
python3 --version
curl --version
```

For GPU mode, verify Docker GPU access separately:

```bash
docker run --rm --gpus all nvidia/cuda:12.9.1-base-ubuntu24.04 nvidia-smi
```

## Before installation

Prepare these three values or services first.

### 1. A reachable host name

Choose the IP address or DNS name that other computers will use, for example
`192.168.1.50` or `genocular.lab.local`. Do not use `0.0.0.0`: that is a bind
address, not a browser-reachable address. A DHCP reservation or local DNS entry
prevents links and signed upload URLs from breaking when an address changes.

### 2. Firebase Web configuration

In the Firebase console:

1. Create or select a project.
2. Register a Web app.
3. Enable **Authentication > Sign-in method > Email/Password**.
4. Add the GENOCULAR IP address or DNS name to **Authentication > Settings >
   Authorized domains**.
5. Record the Web app's API key, auth domain, project ID, and app ID.

GENOCULAR verifies Firebase ID tokens with Google's published signing
certificates. A Firebase Admin service-account key is not required. The
`VITE_FIREBASE_*` Web values are public application identifiers, but the same
`.env` file also contains private server credentials and must not be committed.

Google sign-in normally requires a suitable authorized hostname and HTTPS. For
a simple private-IP HTTP deployment, Email/Password is the most direct option.

### 3. Reference databases

The database snapshot is deliberately excluded from Git. Choose one source:

- **Existing directory:** mount a complete local database tree read-only with
  `--database-path`.
- **Private Google Drive folder:** recommended for distributing the full tree;
  it uses a service account and a resumable `rclone` container.
- **Public Google Drive folder:** suitable for smaller public trees; it uses
  `gdown`.

The directory must contain the contents of `dbs` itself, such as `adapters/`,
`kraken2_db/`, and `gtdbtk/`, rather than an additional outer `dbs/` directory.
See [docs/DATABASES.md](docs/DATABASES.md) for complete setup instructions and
[config/required-databases.txt](config/required-databases.txt) for the markers
validated by the installer.

## First installation

### 1. Clone and enter the repository

```bash
git clone YOUR_REPOSITORY_URL genocular
cd genocular
```

### 2. Generate local configuration

Run the setup script in configuration-only mode. Pass the address selected
above:

```bash
./Setup.sh --lan-host 192.168.1.50 --config-only
```

On a fresh checkout, this command:

- creates `.env` from `.env.example`;
- generates independent random PostgreSQL, MinIO, API, and job-token secrets;
- records the current user's UID/GID for bind-mounted files;
- configures browser-facing URLs and ports;
- auto-detects CPU/GPU mode unless one is specified; and
- creates `databases.env` from `databases.env.example`.

The first run is expected to stop with exit code `2` if Firebase values are
still `CHANGE_ME`. It pauses before downloading databases, building images, or
starting containers.

### 3. Add Firebase values

Edit `.env` and replace these four required values:

```dotenv
VITE_FIREBASE_API_KEY=your_web_api_key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_APP_ID=your_web_app_id
```

The messaging sender ID, measurement ID, and admin email are optional. For an
unattended first configuration, the required `VITE_FIREBASE_*` values can be
exported before running `Setup.sh`; existing configured values are not
overwritten.

### 4. Configure the database source

For a private Google Drive folder, edit `databases.env`:

```dotenv
DB_SOURCE=google-drive-folder
GDRIVE_FOLDER_ID=the_folder_id_from_the_drive_url
GDRIVE_SERVICE_ACCOUNT_JSON=./secrets/google-drive-service-account.json
```

Create the ignored local secrets directory:

```bash
mkdir -p secrets
chmod 700 secrets
```

Place the service-account JSON at the configured path, then restrict the local
configuration files:

```bash
chmod 600 databases.env secrets/google-drive-service-account.json
```

If the database tree already exists locally, no download configuration is
needed; pass its absolute path during the full setup in the next step.

### 5. Validate configuration

```bash
./Setup.sh --lan-host 192.168.1.50 --config-only
```

A successful check prints:

```text
Environment configuration is valid.
Configuration is valid; no containers were changed.
```

### 6. Run the full installation

Choose one of the following commands.

NVIDIA GPU host:

```bash
./Setup.sh --lan-host 192.168.1.50 --gpu
```

CPU-only host:

```bash
./Setup.sh --lan-host 192.168.1.50 --cpu
```

Host with an existing database tree:

```bash
./Setup.sh \
  --lan-host 192.168.1.50 \
  --database-path /data/dbs \
  --gpu
```

The complete first run can take hours. On the first run it downloads and validates all the required reference data, builds the application images, creates Conda environments for the all the 6 snakemake pipeline profiles, starts the stack, pulls the models, and waits for health checks. The database transfers and environment setup are designed to be rerun. Existing downloaded files, generated secrets, named volumes, and valid environments are preserved in your local machine.

### 7. Open and verify the deployment

From a browser on the LAN, open:

```text
http://192.168.1.50:8080
```

The MinIO administrator console is available at:

```text
http://192.168.1.50:9001
```

Use `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` from `.env` for the console.
Then run the command-line health check:

```bash
./scripts/healthcheck.sh
```

It checks the Compose service state, Nginx, the API, and MinIO.

## Setup options

Run `./Setup.sh --help` to see the current list.

| Option | Meaning |
| --- | --- |
| `--lan-host IP_OR_DNS` | Address advertised to browsers; auto-detected when omitted |
| `--http-port PORT` | Browser-facing web/API port; default `8080` |
| `--console-port PORT` | MinIO administration port; default `9001` |
| `--gpu` | Require NVIDIA mode; setup fails if `nvidia-smi` is unavailable |
| `--cpu` | Force portable CPU mode |
| `--database-path PATH` | Use an existing reference-database tree without copying it |
| `--skip-databases` | Skip database download and validation |
| `--skip-pipeline-envs` | Skip the long Conda environment build |
| `--skip-models` | Do not pull Ollama models |
| `--config-only` | Generate and validate configuration without changing containers |
| `-h`, `--help` | Show usage information |

The skip flags are useful for staged installs and application development. A
deployment that skips databases or pipeline environments can start, but it
cannot successfully execute every analysis profile.

## Configuration reference

### Core `.env` settings

`Setup.sh` manages the most important entries. Review these groups when moving
the installation or changing its capacity.

| Setting | Purpose |
| --- | --- |
| `GENOCULAR_HOST` | Reachable LAN IP/DNS name embedded in browser URLs |
| `GENOCULAR_BIND_ADDRESS` | Host interface to listen on; default `0.0.0.0` |
| `GENOCULAR_HTTP_PORT` | Nginx web/API port |
| `GENOCULAR_MINIO_CONSOLE_PORT` | MinIO administrator console port |
| `FRONTEND_URL` | Canonical browser URL used in links and notifications |
| `MINIO_PUBLIC_ENDPOINT` | Browser-reachable endpoint used for signed object requests |
| `CORS_ALLOWED_ORIGINS` | Origins allowed to call the API and MinIO proxy |
| `GENOCULAR_ACCELERATOR` | `cpu` or `gpu`; also controls the Compose override |
| `SNAKEMAKE_CORES` | Maximum CPU cores advertised to Snakemake; default `8` |
| `SNAKEMAKE_GPUS` | GPU resources advertised to Snakemake; default `1` |
| `OLLAMA_MODEL` | General local assistant model; default `llama3.2` |
| `ANALYSIS_ASSISTANT_MODEL` | Scientific interpretation model; default `gemma4:12b` |
| `ASSISTANT_RAG_ONLY` | Set to `1` to use retrieved documentation without general LLM generation |

If SMTP is not required, leave `SMTP_HOST` empty. Otherwise configure
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_USE_TLS`, and
`SMTP_FROM` for job notifications.

### Host storage paths

Paths may be absolute or relative to the repository:

| Setting | Contents | Container access |
| --- | --- | --- |
| `GENOCULAR_DB_ROOT` | Reference databases | Read-only |
| `GENOCULAR_DATA_ROOT` | Jobs, Conda packages/environments, runner home, queue data | Read/write for the runner |
| `GENOCULAR_TMP_ROOT` | Apptainer cache and large temporary files | Read/write |
| `GENOCULAR_SCRATCH_ROOT` | Active job staging and workflow logs | Read/write |
| `GENOCULAR_JOBQ_ROOT` | Job status/queue exchange files | API and runner |

Use fast local storage with ample inode and free-space capacity. Avoid slow or
unreliable network filesystems for active workflow scratch space.

### Runtime limits

The Compose file provides these defaults, which can be overridden by adding
the same keys to `.env`:

| Setting | Default | Meaning |
| --- | ---: | --- |
| `MAX_UPLOAD_FILE_BYTES` | `107374182400` | Maximum size of each uploaded file (100 GiB) |
| `MAX_UPLOAD_FILES_PER_JOB` | `3` | Maximum number of files in one job |
| `UPLOAD_SESSION_TTL_SECONDS` | `604800` | Incomplete upload session lifetime (7 days) |
| `WGS_JOB_TIMEOUT_SECONDS` | `86400` | WGS queue job timeout (24 hours) |
| `METAGENOMICS_JOB_TIMEOUT_SECONDS` | `172800` | Metagenomics queue job timeout (48 hours) |
| `ANONYMOUS_JOB_INIT_LIMIT_PER_HOUR` | `20` | Per-client anonymous job initialization limit |

After changing `.env`, recreate the affected services:

```bash
./scripts/compose.sh up -d
```

### Changing the host name or port

Rerun configuration and rebuild the frontend because the Firebase Web values
and API base are compiled into the Vite bundle:

```bash
./Setup.sh \
  --lan-host genocular.lab.local \
  --http-port 8080 \
  --config-only

./scripts/compose.sh up -d --build web api nginx
```

Update Firebase Authorized domains and the host firewall at the same time.

## Using GENOCULAR

### Demonstration mode

We have also kep six demo dummy runs which play a one-minute demostartion run, clock-driven example using small synthetic fixtures in `demo/fixtures/`. They do not execute Snakemake or the
underlying scientific tools. Demo output is useful for checking navigation and
presentation, but it must not be used for scientific interpretation.

See [demo/README.md](demo/README.md) to replace or extend the fixtures with
curated, de-identified output.

### Running a real analysis

1. Open **Submit Analysis Run**.
2. Select WGS or Metagenomics.
3. Select Short, Long, or Hybrid reads.
4. Enter a job name and choose the required FASTQ files.
5. Optionally adjust profile-specific settings.
6. Upload and submit the job.
7. Keep the private job link, monitor the step graph, and review logs if a step
   fails.
8. Download important outputs before the configured retention period expires.

Interrupted uploads can resume after the same local files are selected again.
Completed uploads may also be reusable while their raw objects remain within
the deployment's retention policy.

Jobs are immutable after submission. To change inputs, the profile, or
settings, submit a new job. Authorized administrators can retry eligible failed
jobs while retained inputs are still available; a retry creates a new job ID
instead of modifying the failed job.

## Day-to-day operations

Always use `scripts/compose.sh`. It loads `.env` and automatically includes
`compose.gpu.yml` when `GENOCULAR_ACCELERATOR=gpu`.

```bash
# Show containers and health
./scripts/compose.sh ps

# Check the public endpoints and MinIO
./scripts/healthcheck.sh

# Follow all logs
./scripts/compose.sh logs -f --tail=200

# Follow the API and workflow runner only
./scripts/compose.sh logs -f --tail=200 api runner

# Start or reconcile the stack
./scripts/compose.sh up -d

# Stop containers while preserving data
./scripts/compose.sh down
```

Rebuild only what changed:

```bash
# Frontend change
./scripts/compose.sh up -d --build web nginx

# API or cleanup-worker change
./scripts/compose.sh up -d --build api db-init cleanup

# Runner image change
./scripts/compose.sh up -d --build runner
```

Rebuild workflow environments independently when environment definitions
change:

```bash
./scripts/build_pipeline_envs.sh all
./scripts/build_pipeline_envs.sh wgs
./scripts/build_pipeline_envs.sh metagenomics
```

Each environment build can take several hours.

## Storage, retention, and backups

### Persistent storage

Docker named volumes hold:

- `postgres_data` — job, account-link, and access metadata;
- `minio_data` — uploaded objects, results, logs, and demo objects; and
- `ollama_data` — downloaded local models.

The large workflow directories use the `GENOCULAR_*_ROOT` host paths described
above. `docker compose down` preserves both named volumes and bind-mounted data.

> **Do not run** `docker compose down --volumes` during ordinary maintenance.
> It deletes named PostgreSQL, MinIO, and Ollama state.

### Default retention policy

The cleanup service runs every 6 hours by default. Values can be overridden in
`.env` before recreating the services.

| Setting | Default | Applies to |
| --- | ---: | --- |
| `RAW_STORAGE_RETENTION_DAYS` | `0` | Uploaded raw objects after an eligible terminal job |
| `LOCAL_STORAGE_RETENTION_DAYS` | `0` | Local completed-job work directories |
| `RESULT_STORAGE_RETENTION_DAYS` | `7` | Successful result objects |
| `LOG_STORAGE_RETENTION_DAYS` | `7` | Successful job logs |
| `FAILED_STORAGE_RETENTION_DAYS` | `1` | Raw, result, log, and local data for failed/cancelled jobs |
| `ABANDONED_JOB_RETENTION_DAYS` | `2` | Stale non-terminal job reconciliation |
| `ORPHAN_LOCAL_RETENTION_DAYS` | `7` | Unreferenced local job directories |
| `MULTIPART_RETENTION_DAYS` | `7` | Incomplete multipart uploads |
| `CLEANUP_INTERVAL_SECONDS` | `21600` | Cleanup loop interval (6 hours) |

**Zero means eligible immediately at the next safe cleanup pass; it does not
mean “retain forever.”** Active jobs, shared reusable inputs, demos, and
incompletely published successful jobs have additional protection checks.

If the deployment must retain raw inputs or local workspaces, set explicit
positive values, for example:

```dotenv
RAW_STORAGE_RETENTION_DAYS=14
LOCAL_STORAGE_RETENTION_DAYS=7
RESULT_STORAGE_RETENTION_DAYS=30
LOG_STORAGE_RETENTION_DAYS=30
```

Then recreate the API and cleanup services:

```bash
./scripts/compose.sh up -d --force-recreate api cleanup
```

### Backups

Before an update or storage change, back up all of the following as one
consistent recovery set:

- the PostgreSQL named volume or a database dump;
- the MinIO named volume or a verified bucket-level copy;
- `.env`, `databases.env`, and administrator-controlled files in `secrets/`;
- each configured `GENOCULAR_*_ROOT` directory; and
- any curated demo fixtures or local workflow changes.

Keep backups outside the deployment's active storage and test restoration. In
particular, retain a recoverable object-store backup before changing MinIO
versions.

## Updating an installation

1. Back up persistent state and configuration.
2. Review local changes with `git status`.
3. Pull or apply the new repository version.
4. Review changes to `.env.example`, `databases.env.example`, Compose files,
   workflow environment definitions, and the database manifest.
5. Rerun the same setup command used for installation.
6. Run `./scripts/healthcheck.sh` and inspect service logs.

`Setup.sh` preserves existing configured secrets, database files, named
volumes, and valid pipeline environments. It is safe to rerun after an
interrupted download or build.

MinIO Community server and client images are built from the pinned source tags
in `MINIO_VERSION` and `MC_VERSION`. Advance these deliberately and test signed
uploads/downloads after upgrading.

## Troubleshooting

### Setup reports incomplete Firebase configuration

This is expected on the first configuration-only run. Fill the four required
`VITE_FIREBASE_*` values in `.env`, confirm the host is in Firebase Authorized
domains, and rerun:

```bash
./Setup.sh --lan-host 192.168.1.50 --config-only
```

### Database validation reports missing paths

Validate directly to see every missing marker:

```bash
./scripts/validate_databases.sh
```

Confirm `GENOCULAR_DB_ROOT` points to the directory containing the database
contents, not its parent. A trailing marker ending in `/` must be a directory;
other markers must be non-empty files. Resume the configured download with:

```bash
./scripts/download_databases.sh
```

### GPU mode is rejected or containers cannot see the GPU

Run `nvidia-smi` on the host and the Docker GPU test from
[System requirements](#system-requirements). Install or repair NVIDIA
Container Toolkit, then rerun setup with `--gpu`. Use `--cpu` if the host should
not expose a GPU.

### Services start but health checks fail

```bash
./scripts/compose.sh ps
./scripts/compose.sh logs --tail=200 nginx web api postgres redis minio ollama
./scripts/healthcheck.sh
```

Look for the first unhealthy dependency rather than only the Nginx error.
Database initialization, MinIO bucket setup, and the API must complete before
the gateway becomes healthy.

### The site works locally but not from another computer

- Confirm `GENOCULAR_HOST` is a reachable address, not `localhost` or
  `0.0.0.0`.
- Confirm `GENOCULAR_BIND_ADDRESS=0.0.0.0` unless intentionally restricted.
- Allow the configured HTTP port through the host firewall.
- Ensure the browser uses the same host and port recorded in `FRONTEND_URL`.
- Reconfigure and rebuild the frontend after changing an address or port.

### Login fails or Firebase rejects the domain

Enable Email/Password sign-in, add the exact IP/DNS name to Firebase Authorized
domains, and verify the four Web app values. Because the values are Vite build
arguments, rebuild `web` after editing them.

### Uploads fail after changing the host name

`FRONTEND_URL`, `MINIO_PUBLIC_ENDPOINT`, `MINIO_CONSOLE_URL`, and
`CORS_ALLOWED_ORIGINS` must agree with the browser-facing host and ports. Rerun
`Setup.sh --config-only`, then rebuild `web`, `api`, and `nginx`.

### A workflow fails immediately with permission errors

`JOB_UID` and `JOB_GID` should match the host account that owns the configured
data, temporary, scratch, and job-queue directories. Rerun configuration as
that account and correct ownership of only those deployment directories.

### A workflow is missing an executable, environment, or database

Do not rely on skip flags for a production analysis host. Rebuild the relevant
environment group and revalidate databases:

```bash
./scripts/build_pipeline_envs.sh all
./scripts/validate_databases.sh
```

### The host is low on disk space

Check both host paths and Docker storage:

```bash
df -h
docker system df
```

Review the retention policy and old backups before removing anything. Do not
delete named volumes or active job directories as an ad hoc cleanup method.

## Security notes

The default deployment serves plain HTTP and is designed for a trusted local
network.

- Do not expose ports `8080` or `9001` directly to the public internet.
- For remote access, terminate TLS in a reviewed reverse proxy, update public
  URLs and CORS settings, and rebuild the frontend.
- Restrict the MinIO console to administrators.
- Treat private job links like passwords; anyone holding a valid capability
  link may have the access it grants.
- Rotate generated secrets if `.env` or a backup is exposed.
- Never commit `.env`, `databases.env`, service-account JSON, keys, user data,
  or generated results. The provided `.gitignore` excludes the standard local
  paths, but operators remain responsible for reviewing commits.
- Keep the host, Docker Engine, base images, workflow tools, and Firebase
  project maintained and monitored.

## Repository layout

```text
.
|-- api/                    FastAPI application, DB models, cleanup worker, tests
|-- config/                 Required-database manifest
|-- demo/fixtures/          Small permanent demonstration outputs
|-- docs/                   Deployment and database documentation
|-- infra/                  Nginx and Community MinIO build/configuration
|-- plot_generators/        WGS and metagenomics scientific renderers
|-- runner/                 RQ worker, Snakemake launcher, asset generation
|-- scripts/                Setup, validation, Compose, database, and health tools
|-- web/app/                React/Vite frontend source
|-- workflow/               Six workflows and their environment definitions
|-- compose.yml             CPU-compatible base stack
|-- compose.gpu.yml         NVIDIA override for runner and Ollama
|-- .env.example            Local deployment configuration template
|-- databases.env.example   Reference-database source template
`-- Setup.sh                Idempotent configuration and installation entry point
```

`SOURCE_SNAPSHOT.md` records how this portable tree was produced and what was
intentionally excluded.

## Development checks

For frontend-only work, use the Node version represented by the Docker build
(Node 24) and run:

```bash
cd web/app
npm ci
npm run lint
npm run build
```

The API and runner tests use Python's `unittest` style, with some plain test
functions also present. Run the relevant test files in an environment with the
corresponding `api/requirements.txt` or `runner/requirements.txt` installed.
For an integration check, build the changed services and finish with:

```bash
./scripts/compose.sh config --quiet
./scripts/healthcheck.sh
```

Do not use real credentials, user sequencing data, or the production object
store for development tests.

## Licence and redistribution

This snapshot intentionally does not include a project licence. Do not assume
permission to copy, modify, or redistribute it beyond the rights granted by the
copyright holders. Before publishing the repository, the project owner should
select a licence compatible with the application dependencies, bioinformatics
tools, reference databases, and MinIO Community's AGPL terms.

The portable package uses pinned MinIO Community source builds and does not
contain licensed AIStor material.

 
