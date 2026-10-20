# GENOCULAR portable deployment

This repository packages the GENOCULAR web application, API, workflow runner,
six WGS/metagenomics pipelines, PostgreSQL, Redis, S3-compatible object storage,
Ollama, and an Nginx LAN gateway as one Docker Compose deployment.

The package is independent of the source server. It does not contain live
secrets, user uploads, job output, PostgreSQL/MinIO state, licensed AIStor
material, or the 562 GiB reference-database tree.

## Supported host

- Linux x86-64
- Docker Engine with Docker Compose v2
- Python 3 and `curl` on the host
- At least 16 CPU cores and 64 GiB RAM recommended
- At least 1 TiB free storage recommended for databases, Conda environments,
  uploads, results, and temporary files
- Optional NVIDIA GPU plus NVIDIA Container Toolkit; CPU mode is supported but
  metagenomics and local AI inference are substantially slower

## First installation

1. Clone the repository and enter it.

2. Run configuration once. It creates `.env` with random private secrets and
   stops if Firebase values have not yet been supplied:

   ```bash
   ./Setup.sh --lan-host 192.168.1.50 --config-only
   ```

3. Edit `.env` and set the four required public Firebase Web values:
   `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
   `VITE_FIREBASE_PROJECT_ID`, and `VITE_FIREBASE_APP_ID`. In the Firebase
   console, enable Email/Password authentication and add the LAN hostname to
   Authorized domains. Alternatively, export those variables before the first
   Setup run.

4. Configure the reference-database source in `databases.env`. The recommended
   Google Drive service-account flow is documented in
   [docs/DATABASES.md](docs/DATABASES.md).

5. Run the complete installation:

   ```bash
   ./Setup.sh --lan-host 192.168.1.50 --gpu
   ```

   Use `--cpu` on a non-NVIDIA host. The first full run downloads hundreds of
   gigabytes of databases, builds many isolated Conda environments, builds the
   containers, and pulls Ollama models. Depending on the network and machine,
   this can take many hours.

6. Open `http://192.168.1.50:8080` from another computer on the LAN. The MinIO
   administration console is on port `9001` and uses the credentials in `.env`.

If the databases already exist locally, avoid a second 562 GiB copy:

```bash
./Setup.sh --lan-host 192.168.1.50 --database-path /data/dbs --gpu
```

## Setup options

```text
--lan-host IP_OR_DNS   LAN address advertised to browsers
--http-port PORT       Web/API port; default 8080
--console-port PORT    MinIO console port; default 9001
--gpu | --cpu          NVIDIA or CPU deployment
--database-path PATH   Use an existing database tree
--skip-databases       Skip download and validation
--skip-pipeline-envs   Skip Conda environment creation
--skip-models          Skip Ollama model downloads
--config-only          Validate configuration without changing containers
```

The skip flags are useful for development, but a deployment that skips
databases or pipeline environments cannot execute every analysis workflow.

## Day-to-day operations

Always use the wrapper so the configured CPU/GPU Compose files are selected:

```bash
./scripts/compose.sh ps
./scripts/compose.sh logs -f --tail=200
./scripts/compose.sh up -d
./scripts/compose.sh down
./scripts/healthcheck.sh
```

Rebuild only the web application after a frontend change:

```bash
./scripts/compose.sh up -d --build web nginx
```

Persistent PostgreSQL, MinIO, and Ollama state is stored in named Docker
volumes. Pipeline data, Conda environments, scratch data, and databases use the
paths configured by `GENOCULAR_*_ROOT` in `.env`. `docker compose down` keeps
all data; do not add `--volumes` unless permanent state should be deleted.

## Repository layout

- `api/` — FastAPI service and cleanup worker
- `web/` — React/Vite frontend and static runtime server
- `runner/` — RQ/Snakemake execution service
- `workflow/` — WGS and metagenomics workflows plus environment definitions
- `plot_generators/` — scientific result renderers
- `demo/fixtures/` — permanent demonstration output seeded into MinIO
- `infra/` — portable Nginx and Community MinIO images/configuration
- `scripts/` — configuration, database, environment, Compose, and health tools
- `compose.yml` / `compose.gpu.yml` — CPU base stack and NVIDIA override

## Security boundary

The default deployment is HTTP for a trusted local network. Do not expose ports
8080 or 9001 directly to the public internet. For internet access, terminate
TLS in a reviewed reverse proxy, restrict the MinIO console to administrators,
update the public URLs/CORS entries in `.env`, and rotate every generated
secret. Never commit `.env`, `databases.env`, or files under `secrets/`.

This snapshot intentionally has no inferred open-source licence. Before making
the GitHub repository public, confirm that the project owner has selected a
licence compatible with the application dependencies and MinIO's AGPL terms.

## Publishing to GitHub

The directory is initialized as a local Git repository by the packaging step.
After reviewing the licence and inserting the real external configuration on
the deployment host (not in Git), publish it to a new private repository:

```bash
git status
git remote add origin git@github.com:YOUR_ORG/genocular.git
git push -u origin main
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for architecture, Firebase, GPU,
network, and operational details.
