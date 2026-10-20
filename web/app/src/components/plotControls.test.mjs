import assert from "node:assert/strict";
import test from "node:test";
import { copyPlotFigure, plotConfiguration, plotDownloadOptions, supportsPlotNavigation } from "./plotControls.js";

test("native toolbar stays disabled even if a dashboard enables it", () => {
  const config = plotConfiguration({ displayModeBar: true, displaylogo: true, scrollZoom: true });
  assert.equal(config.displayModeBar, false);
  assert.equal(config.displaylogo, false);
  assert.equal(config.scrollZoom, true);
});

test("interactive mutations do not change the reset baseline", () => {
  const figure = { data: [{ type: "bar", y: [1, 2] }], layout: { xaxis: { range: [0, 10] } } };
  const copy = copyPlotFigure(figure);
  copy.data[0].visible = "legendonly";
  copy.layout.xaxis.range[0] = 5;
  assert.equal(figure.data[0].visible, undefined);
  assert.deepEqual(figure.layout.xaxis.range, [0, 10]);
});

test("exports use safe filenames, vector SVG and high-resolution PNG", () => {
  assert.equal(plotDownloadOptions("png", "sample/plot", 500).filename, "sample_plot");
  assert.equal(plotDownloadOptions("png", "sample", 500).scale, 2);
  assert.equal(plotDownloadOptions("svg", "sample", 500).scale, 1);
});

test("zoom and pan appear only for compatible plots", () => {
  assert.equal(supportsPlotNavigation({ data: [{ type: "bar" }] }), true);
  assert.equal(supportsPlotNavigation({ data: [{ type: "scatter" }] }), true);
  assert.equal(supportsPlotNavigation({ data: [{ type: "sunburst" }] }), false);
  assert.equal(supportsPlotNavigation({ data: [{ type: "sankey" }] }), false);
});
