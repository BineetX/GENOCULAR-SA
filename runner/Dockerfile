FROM ubuntu:24.04
WORKDIR /app
ENV DEBIAN_FRONTEND=noninteractive

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash ca-certificates curl git \
    bzip2 \
    openjdk-17-jre-headless \
    python3 python3-dev \
    build-essential pkg-config \
    fuse3 libfuse3-3 squashfs-tools \
    libseccomp2 uidmap \
    && rm -rf /var/lib/apt/lists/*


# ---- Install Miniforge (conda) ----
ARG MINIFORGE_VER=24.7.1-0
RUN curl -fsSL -o /tmp/miniforge.sh \
    https://github.com/conda-forge/miniforge/releases/download/${MINIFORGE_VER}/Miniforge3-Linux-x86_64.sh \
 && bash /tmp/miniforge.sh -b -p /opt/conda \
 && rm -f /tmp/miniforge.sh
ENV PATH=/opt/conda/bin:$PATH

# Faster solver + create env exactly where your code expects it
RUN conda config --system --set channel_priority strict \
 && conda install -y -n base -c conda-forge mamba \
 && mamba create -y -n snakemake python=3.11 pip \
 && conda clean -a -y

# Make this env the default runtime Python
ENV PATH=/opt/conda/envs/snakemake/bin:$PATH

# Install runner python deps into conda env
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -U pip setuptools wheel \
 && pip install --no-cache-dir -r /app/requirements.txt

# App code
COPY worker.py                  /app/worker.py
COPY tasks.py                   /app/tasks.py
COPY status_writer.py           /app/status_writer.py
COPY generate_analysis_assets.py /app/generate_analysis_assets.py
COPY updated_analysis_assets.py /app/updated_analysis_assets.py
COPY krona_analysis_assets.py /app/krona_analysis_assets.py
COPY run_job.py                 /app/run_job.py
COPY upload_results_to_minio.py /app/upload_results_to_minio.py
RUN chmod +x /app/run_job.py /app/upload_results_to_minio.py

# Ensure UID/GID exist
ARG JOB_UID=1001
ARG JOB_GID=1001
RUN set -eux; \
    getent group "${JOB_GID}" >/dev/null || groupadd -g "${JOB_GID}" runner; \
    getent passwd "${JOB_UID}" >/dev/null || useradd -u "${JOB_UID}" -g "${JOB_GID}" -M -s /usr/sbin/nologin runner

# Entrypoint
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
