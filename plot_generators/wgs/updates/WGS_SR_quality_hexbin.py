#!/usr/bin/env python3
"""Render observed short-read base-quality density from FASTQ records."""

import gzip
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def observed_points(paths, max_reads_per_file=3000):
    positions, quality = [], []
    read_count = 0
    for path in paths:
        opener = gzip.open if str(path).endswith(".gz") else open
        with opener(path, "rt", encoding="ascii", errors="replace") as handle:
            while read_count < max_reads_per_file * len(paths):
                header = handle.readline()
                if not header:
                    break
                sequence = handle.readline().rstrip("\r\n")
                handle.readline()
                phred = handle.readline().rstrip("\r\n")
                if not sequence or not phred:
                    break
                length = min(len(sequence), len(phred), 1000)
                positions.extend(range(1, length + 1))
                quality.extend(max(0, ord(char) - 33) for char in phred[:length])
                read_count += 1
                if read_count % max_reads_per_file == 0:
                    break
    return positions, quality, read_count


def main(argv):
    if len(argv) != 5:
        print("Usage: WGS_SR_quality_hexbin.py RAW_R1 RAW_R2 CLEAN_R1 CLEAN_R2 OUTPUT_SVG", file=sys.stderr)
        return 2
    paths = [Path(value) for value in argv[:4]]
    if any(not path.is_file() for path in paths):
        print("FASTQ input missing", file=sys.stderr)
        return 1
    output = Path(argv[4])
    output.parent.mkdir(parents=True, exist_ok=True)

    fig, axes = plt.subplots(1, 2, figsize=(12, 4.6), sharey=True, constrained_layout=True)
    for axis, files, title, cmap in (
        (axes[0], paths[:2], "Raw reads", "Greys"),
        (axes[1], paths[2:], "Filtered reads", "Blues"),
    ):
        x, y, reads = observed_points(files)
        if not x:
            print(f"No quality observations in {title}", file=sys.stderr)
            return 1
        density = axis.hexbin(x, y, gridsize=(55, 36), mincnt=1, cmap=cmap, linewidths=0)
        axis.set_title(f"{title} - {reads:,} reads sampled", fontsize=11, fontweight="bold", color="#183B5D")
        axis.set_xlabel("Base position", fontsize=10)
        axis.set_ylim(0, 45)
        axis.grid(axis="y", color="#E4EDF5", linewidth=0.6)
        fig.colorbar(density, ax=axis, label="Observed bases", fraction=0.05, pad=0.02)
    axes[0].set_ylabel("Phred quality score", fontsize=10)
    fig.patch.set_facecolor("white")
    fig.savefig(output, format="svg", dpi=180)
    plt.close(fig)
    print(f"Saved observed quality density to {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
