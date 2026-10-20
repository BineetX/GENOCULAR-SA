import assert from "node:assert/strict";
import test from "node:test";
import { buildBinningFigures } from "./binningFigures.js";

const panel = (coverage) => ({ stats: { n_bins: 1, median_gc: 50, median_cov: coverage, median_gs_mb: 2, total_contigs: 100 },
  crosshair: { med_gc: 50, med_cov: coverage }, points: [{ bin_id: "bin", coverage, gc_pct: 50, genome_size_mb: 2, num_contigs: 100, is_outlier: true, label: "bin" }] });
const fixture = { meta: { sample_id: "sample" }, layout: { panels: ["MaxBin2", "MetaBAT2"], gc: { range: [30, 70], colorscale: "Blues" }, size: { range_px: [6, 32], ref_min: 1, ref_max: 8, breaks: [2, 4, 6, 8] } },
  panels: { MaxBin2: panel(10), MetaBAT2: panel(100) } };

test("binners share axes, colors and bubble sizes without dropping bins", () => {
  const figures = buildBinningFigures(fixture);
  assert.equal(figures.length, 2);
  assert.deepEqual(figures[0].layout.xaxis.range, figures[1].layout.xaxis.range);
  assert.deepEqual(figures[0].layout.yaxis.range, figures[1].layout.yaxis.range);
  assert.deepEqual(figures[0].data[0].marker.size, figures[1].data[0].marker.size);
  assert.equal(figures[0].data[0].marker.showscale, true);
  assert.equal(figures[0].data[0].x.length, 1);
  assert.equal(figures[1].data[0].x.length, 1);
  assert.deepEqual(figures[0].data[2].text, ["2", "4", "6", "8"]);
  assert.ok(figures[0].data[2].y.every((value) => value >= 0 && value <= 1));
  assert.notEqual(figures[0].config.toImageButtonOptions.filename, figures[1].config.toImageButtonOptions.filename);
});

test("log-axis median shapes use coverage units and labels remain optional", () => {
  const figures = buildBinningFigures(fixture);
  assert.equal(figures[0].layout.shapes.find((shape) => shape.xref === "x").x0, 10);
  assert.equal(figures[0].layout.annotations.filter((annotation) => annotation.showarrow).length, 0);
  assert.equal(buildBinningFigures(fixture, { showLabels: true })[0].layout.annotations.filter((annotation) => annotation.showarrow).length, 1);
  assert.equal(buildBinningFigures(fixture, { showCross: false })[0].layout.shapes.length, 0);
});
