export const REPORT_FONT = "NotoSans";
export const REPORT_COLORS = {
  navy: [19, 42, 66],
  blue: [37, 117, 183],
  slate: [76, 94, 113],
  muted: [111, 128, 146],
  line: [222, 231, 239],
  pale: [246, 249, 252],
};

export function formatDownloadDate(value = new Date(), timeZone) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric", ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

// Called at finalization so the date reflects the completed download, not the
// start of a potentially long figure-rendering pass.
export function drawReportCover(doc, {
  sample, profile, submittedBy, jobId, analysisDate, downloadedDate, logo, isDemo,
}) {
  const { navy, blue, slate, muted, line, pale } = REPORT_COLORS;
  const left = 22;
  const width = 166;
  let fieldSize = 9.5;
  let fieldLineHeight = 4.7;
  const setType = (size, style = "normal", color = navy) => {
    doc.setFont(REPORT_FONT, style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.setCharSpace(0);
  };
  const label = (text, x, y) => {
    setType(7.5, "bold", muted);
    doc.setCharSpace(0.35);
    doc.text(text.toUpperCase(), x, y);
    doc.setCharSpace(0);
  };
  const field = (title, value, x, y, fieldWidth) => {
    label(title, x, y);
    setType(fieldSize);
    const lines = doc.splitTextToSize(String(value || "Not reported"), fieldWidth);
    doc.text(lines, x, y + 6, { lineHeightFactor: 1.4 });
    return 7 + lines.length * fieldLineHeight;
  };

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, 210, 297, "F");
  doc.setFillColor(...blue);
  doc.rect(0, 0, 210, 2.5, "F");
  if (logo) doc.addImage(logo, "PNG", left, 23, 18, 18.35, "genocular-brand", "FAST");
  const brandX = logo ? 45 : left;
  setType(19, "bold");
  doc.setCharSpace(0.8);
  doc.text("GENOCULAR", brandX, 34);
  label("Analysis report", brandX, 41);

  setType(32, "bold");
  doc.text("Genomic analysis", left, 82);
  setType(32, "normal");
  doc.text("Results report", left, 99);
  doc.setDrawColor(...blue);
  doc.setLineWidth(1.2);
  doc.line(left, 112, left + 24, 112);

  label("Sample", left, 129);
  let sampleSize = 14;
  let sampleLines;
  let panelY;
  const inset = left + 9;
  const rightColumn = 111;
  const columnWidth = 68;

  // Measure wrapped metadata before drawing the panel to keep long names safe.
  let firstRowHeight;
  let jobHeight;
  let panelHeight;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    setType(sampleSize, "bold");
    sampleLines = doc.splitTextToSize(sample, width);
    panelY = 139 + sampleLines.length * sampleSize * 0.46 + 10;
    setType(fieldSize);
    firstRowHeight = 7 + Math.max(
      doc.splitTextToSize(profile || "Not reported", columnWidth).length,
      doc.splitTextToSize(submittedBy, columnWidth).length,
    ) * fieldLineHeight;
    jobHeight = 7 + doc.splitTextToSize(jobId || "Not reported", width - 18).length * fieldLineHeight;
    const dateHeight = 7 + Math.max(
      doc.splitTextToSize(analysisDate, columnWidth).length,
      doc.splitTextToSize(downloadedDate, columnWidth).length,
    ) * fieldLineHeight;
    panelHeight = 24 + firstRowHeight + jobHeight + dateHeight;
    if (panelY + panelHeight <= (isDemo ? 252 : 259)) break;
    sampleSize -= 0.5;
    fieldSize -= 0.4;
    fieldLineHeight = fieldSize * 0.49;
  }
  setType(sampleSize, "bold");
  doc.text(sampleLines, left, 139, { lineHeightFactor: 1.3 });
  doc.setFillColor(...pale);
  doc.setDrawColor(...line);
  doc.setLineWidth(0.25);
  doc.roundedRect(left, panelY, width, panelHeight, 3, 3, "FD");
  let rowY = panelY + 10;
  field("Workflow", profile, inset, rowY, columnWidth);
  field("Submitted by", submittedBy, rightColumn, rowY, columnWidth);
  rowY += firstRowHeight + 5;
  field("Job ID", jobId, inset, rowY, width - 18);
  rowY += jobHeight + 4;
  doc.setDrawColor(...line);
  doc.line(inset, rowY, left + width - 9, rowY);
  rowY += 7;
  field("Analysis generated", analysisDate, inset, rowY, columnWidth);
  field("Downloaded", downloadedDate, rightColumn, rowY, columnWidth);

  if (isDemo) {
    setType(8, "bold", [161, 98, 7]);
    doc.text("SYNTHETIC DEMONSTRATION DATA — NOT FOR SCIENTIFIC USE", left, panelY + panelHeight + 10);
  }
  doc.setDrawColor(...line);
  doc.line(left, 267, left + width, 267);
  setType(9, "bold");
  doc.text("BRIC–Institute of Life Sciences", left, 277);
  setType(8, "normal", slate);
  doc.text("Bhubaneswar, India", left, 283);
  setType(8, "normal", muted);
  doc.text("GENOCULAR", left + width, 283, { align: "right" });
}
