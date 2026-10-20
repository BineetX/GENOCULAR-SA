import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { drawReportCover, formatDownloadDate, REPORT_FONT } from "./reportPresentation.js";

const { jsPDF } = createRequire(import.meta.url)("jspdf");
function reportDoc() {
  const doc = new jsPDF({ unit: "mm", format: "a4", putOnlyUsedFonts: true });
  for (const [weight, style] of [["Regular", "normal"], ["Bold", "bold"]]) {
    const filename = `NotoSans-${weight}.ttf`;
    const bytes = readFileSync(new URL(`../../public/report/fonts/${filename}`, import.meta.url));
    doc.addFileToVFS(filename, bytes.toString("base64"));
    doc.addFont(filename, REPORT_FONT, style);
  }
  const lines = [];
  const original = doc.text.bind(doc);
  doc.text = (text, x, y, options = {}) => {
    const values = Array.isArray(text) ? text : [text];
    values.forEach((value, index) => lines.push({
      value, x, y: y + index * doc.getFontSize() / doc.internal.scaleFactor * (options.lineHeightFactor || 1.15),
      width: doc.getTextWidth(value), align: options.align || "left",
    }));
    return original(text, x, y, options);
  };
  return { doc, lines };
}
const metadata = {
  sample: "SRR24442558",
  profile: "metagenomics · SR",
  submittedBy: "Research user",
  jobId: "30138ec2-ca00-4974-bc68-7289cbfc4394",
  analysisDate: "06-Oct-2026, 10:42:30 AM",
  downloadedDate: "06 Oct 2026",
};

test("download date follows the viewer's calendar date, including timezone boundaries", () => {
  const date = "2026-10-05T21:00:00Z";
  assert.equal(formatDownloadDate(date, "Asia/Kolkata"), "06 Oct 2026");
  assert.equal(formatDownloadDate(date, "UTC"), "05 Oct 2026");
  assert.equal(formatDownloadDate("invalid"), "Not recorded");
});

test("cover retains job identity and download date without schema text", () => {
  const { doc, lines } = reportDoc();
  drawReportCover(doc, metadata);
  const text = lines.map((line) => line.value).join("\n");
  assert.match(text, /GENOCULAR/);
  assert.ok(text.includes(metadata.jobId));
  assert.match(text, /DOWNLOADED\n06 Oct 2026/);
  assert.doesNotMatch(text, /schema|1\.0/i);
  assert.equal(doc.getFont().fontName, REPORT_FONT);
  assert.ok(lines.every((line) => line.align === "right" || line.x + line.width <= 189));
  assert.ok(lines.every((line) => line.y < 289));
});

test("long sample names and submitters wrap above the institutional footer", () => {
  const { doc, lines } = reportDoc();
  drawReportCover(doc, {
    ...metadata, sample: "W".repeat(120), submittedBy: "W".repeat(160), isDemo: true,
  });
  const footer = lines.findIndex((line) => line.value === "BRIC–Institute of Life Sciences");
  assert.ok(lines.slice(0, footer).every((line) => line.y < 265), "Cover metadata stays clear of the footer");
  assert.ok(lines.every((line) => line.align === "right" || line.x + line.width <= 189));
});
