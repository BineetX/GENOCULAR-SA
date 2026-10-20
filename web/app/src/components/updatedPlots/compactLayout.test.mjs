import assert from "node:assert/strict";
import test from "node:test";
import { compactLayout } from "./compactLayout.js";

test("removes duplicate meta title and footer, retaining metrics and axis labels", () => {
  const layout = { title: { text: "<b>BUSCO</b><br>Sample" }, height: 620,
    margin: { t: 80, b: 120 }, annotations: [
      { text: "<span>Source: BUSCO</span>", y: -0.24, yref: "paper" },
      { text: "90%", y: 93, yref: "y" },
      { text: "Coverage", y: -0.055, yref: "paper" },
    ] };
  const result = compactLayout(layout, { renderer: "mag_busco_v2", captions: ["Source: BUSCO"] });
  assert.equal(result.title.text, "");
  assert.equal(result.annotations.length, 2);
  assert.equal(result.height, 520);
  assert.equal(layout.annotations.length, 3);
});

test("retains unique WGS panel titles but omits repeated sample and subtitle", () => {
  const result = compactLayout({ title: "<b>Feature types: sample</b><br>Long subtitle" }, { renderer: "wgs_prokka_v2", sample: "sample" });
  assert.equal(result.title.text, "Feature types");
});

test("reserves room for scientific subplot headings", () => {
  const result = compactLayout({ annotations: [{ yref: "y2 domain", y: 1.036, text: "Binner" }] }, { renderer: "mag_binning_v2" });
  assert.equal(result.margin.t, 52);
});

test("retains distinct binner titles and keeps assembly legends above axes", () => {
  assert.equal(compactLayout({}, { renderer: "mag_binning_v2", panelTitle: "MaxBin2" }).title.text, "MaxBin2");
  const result = compactLayout({ legend: { orientation: "h", y: 1.03 }, margin: { b: 64 } }, { renderer: "mag_assembly_v2" });
  assert.equal(result.margin.t, 52);
  assert.equal(result.margin.b, 64);
});
