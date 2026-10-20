"""Expose the GTDB-Tk Krona report without a second taxonomy plot."""
import csv
import os
import shutil
import subprocess
from collections import Counter
from pathlib import Path


def integrate_gtdb_krona(out_root, sample, tool_env_root, sections, generator_runs):
    out_root = Path(out_root)
    reports = sorted(out_root.glob("**/*gtdb*krona*.html"))
    if not reports:
        reports = sorted(out_root.glob("**/gtdbtk/**/*krona*.html"))
    report = next((path for path in reports if path.is_file() and path.stat().st_size), None)
    if report is None:
        summaries = sorted(out_root.glob("**/gtdbtk/**/gtdbtk.*.summary.tsv"))
        counts = Counter()
        genomes = set()
        for summary in summaries:
            with summary.open(encoding="utf-8", newline="") as handle:
                for row in csv.DictReader(handle, delimiter="\t"):
                    genome = row.get("user_genome")
                    if not genome or genome in genomes:
                        continue
                    genomes.add(genome)
                    lineage = []
                    for rank in str(row.get("classification") or "").split(";"):
                        label = rank.partition("__")[2].strip() if "__" in rank else rank.strip()
                        if not label or label.lower() in {"n/a", "unclassified", "unclassified bacteria", "unclassified archaea"}:
                            break
                        lineage.append(label)
                    counts[tuple(lineage) or ("Unclassified",)] += 1
        if not counts:
            return
        candidates = [Path(tool_env_root) / "metaphlan_env/bin/ktImportText"] if tool_env_root else []
        if tool_env_root:
            candidates.extend(Path(tool_env_root).parents[1] / mode / "tool_envs/metaphlan_env/bin/ktImportText"
                              for mode in ("short", "long", "hybrid"))
        executable = next((str(path) for path in candidates if path.is_file()), shutil.which("ktImportText"))
        if not executable:
            generator_runs.append({"name": "gtdbtk_krona", "rc": 1, "log": "KronaTools ktImportText is unavailable"})
            return
        directory = out_root / "analysis/reports"
        directory.mkdir(parents=True, exist_ok=True)
        source = directory / f"{sample}_gtdbtk_krona_input.txt"
        source.write_text("".join(f"{count}\t" + "\t".join(lineage) + "\n" for lineage, count in sorted(counts.items())), encoding="utf-8")
        report = directory / f"{sample}_gtdbtk_krona.html"
        temporary = report.with_suffix(".html.tmp")
        env = os.environ.copy()
        env["PATH"] = str(Path(executable).parent) + os.pathsep + env.get("PATH", "")
        try:
            result = subprocess.run([executable, "-o", str(temporary), "-n", "GTDB-Tk", str(source)],
                                    env=env, capture_output=True, text=True, timeout=120)
            generator_runs.append({"name": "gtdbtk_krona", "rc": result.returncode, "log": (result.stdout + result.stderr)[-4000:]})
            if result.returncode or not temporary.is_file() or not temporary.stat().st_size:
                return
            os.replace(temporary, report)
        except (OSError, subprocess.TimeoutExpired) as exc:
            generator_runs.append({"name": "gtdbtk_krona", "rc": 1, "log": str(exc)})
            return
    previous = next((section for section in sections if section.get("renderer") == "gtdbtk_taxonomy" or section.get("id") == "gtdbtk_krona"), {})
    sections[:] = [section for section in sections if section.get("renderer") != "gtdbtk_taxonomy" and section.get("id") != "gtdbtk_krona"]
    section = {"id": "gtdbtk_krona", "title": "GTDB-Tk taxonomy", "type": "html",
               "path": report.relative_to(out_root).as_posix(), "source": "gtdbtk", "order": 170}
    data_path = previous.get("data_path") or (previous.get("path") if previous.get("type") != "html" else None)
    if data_path:
        section["data_path"] = data_path
        section["data_renderer"] = "gtdbtk_taxonomy"
    sections.append(section)
