import {
  PLOT_NOTES,
  renderAnalysisPlotToPng,
  summaryValues,
} from "../components/AnalysisPlot.jsx";
import { UPDATED_DASHBOARD_RENDERERS } from "../components/updatedPlots/UpdatedDashboard.jsx";
import { renderUpdatedDashboardFigures } from "../components/updatedPlots/renderDashboardFigures.jsx";
import { REPORT_FONT, REPORT_COLORS, drawReportCover, formatDownloadDate } from "./reportPresentation.js";

const MAX_FIGURES = 64;
const MAX_TABLE_ROWS = 250;
const MAX_TABLE_COLUMNS = 12;
const MAX_TABLE_CELLS = 20_000;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const DENSE_ARRAY_KEYS = {
  fastp_qc: new Set(["quality_curves", "content_curves"]),
  fastp_quality: new Set(["quality_curves", "content_curves"]),
  fastp_content: new Set(["quality_curves", "content_curves"]),
  fastp_rates: new Set(["quality_curves", "content_curves"]),
  fastp_retained: new Set(["quality_curves", "content_curves"]),
  metaquast_curve: new Set(["curve"]),
  mapping_flagstat: new Set(["plot_data"]),
  mapping_depth: new Set(["plot_data"]),
  mapping_density: new Set(["plot_data"]),
  mag_rank_abundance: new Set(["rank_abundance"]),
  read_alpha: new Set(["rank_abundance"]),
  metaphlan_rank_abundance: new Set(["genus_rank_abundance"]),
  nonpareil_curve: new Set(["observed", "fitted"]),
  wgs_repeats: new Set(["repeat_landscape", "divergence_bins"]),
};
const BLOCKED_KEY = /(sequence|translation|raw[_-]?read|authorization|token|password|secret|signed[_-]?url|html|svg|log)$/i;
const BLOCKED_ARTIFACT = /(^|\/)(logs?)(\/|$)|\.(?:log|fastq|fq|fasta|fna|fa|bam|sam)(?:\.gz)?$/i;

export function sanitizeReportText(value, maxLength = 320) {
  const printable = [...String(value ?? "")]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    })
    .join("");
  const text = printable
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, Math.max(1, maxLength));
}

export function sanitizeReportFilename(value) {
  const safe = sanitizeReportText(value, 100)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return safe || "genocular-analysis";
}

function humanize(value) {
  return sanitizeReportText(value, 120).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const REPORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatReportDateTime(value, fallback = "Not reported") {
  if (value == null || value === "") return fallback;
  const original = sanitizeReportText(value, 180);
  if (!original) return fallback;
  if (original === "—" || /^not (?:reported|recorded|available)$/i.test(original)) return original;

  const date = value instanceof Date ? value : new Date(original);
  if (Number.isNaN(date.getTime())) return original;

  const day = String(date.getDate()).padStart(2, "0");
  const month = REPORT_MONTHS[date.getMonth()];
  const year = String(date.getFullYear()).padStart(4, "0");
  const hour = date.getHours();
  const hour12 = String(hour % 12 || 12).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  const meridiem = hour >= 12 ? "PM" : "AM";
  return `${day}-${month}-${year}, ${hour12}:${minute}:${second} ${meridiem}`;
}

function safeCell(value) {
  if (value == null) return "—";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    return Math.abs(value) >= 1_000_000
      ? value.toLocaleString("en-US")
      : value.toLocaleString("en-US", { maximumFractionDigits: 5 });
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return `[${value.length} values]`;
  if (typeof value === "object") return `{${Object.keys(value).length} fields}`;
  return sanitizeReportText(value, 180);
}

function objectMetricRows(payload) {
  const keys = [
    "summary", "stats", "metrics", "diversity_indices", "depth_summary", "counts",
    "flagstat", "mean_quality", "checkm", "busco", "genus_metrics", "q_thresholds",
  ];
  const rows = [];
  const seen = new Set();
  for (const key of keys) {
    const value = payload?.[key];
    if (!value || Array.isArray(value) || typeof value !== "object") continue;
    for (const [metric, metricValue] of Object.entries(value)) {
      if (BLOCKED_KEY.test(metric) || seen.has(`${key}.${metric}`)) continue;
      if (!["string", "number", "boolean"].includes(typeof metricValue)) continue;
      rows.push([humanize(`${key} ${metric}`), safeCell(metricValue)]);
      seen.add(`${key}.${metric}`);
    }
  }
  for (const [label, value] of summaryValues(payload || {})) {
    const key = `summary.${label}`;
    if (seen.has(key) || BLOCKED_KEY.test(label)) continue;
    rows.push([humanize(label), safeCell(value)]);
    seen.add(key);
  }
  return rows.slice(0, 40);
}

function extractArrayTable(renderer, key, values, budget) {
  if (!Array.isArray(values) || !values.length || DENSE_ARRAY_KEYS[renderer]?.has(key)) return null;
  const objects = values.filter((row) => row && typeof row === "object" && !Array.isArray(row));
  if (!objects.length) return null;
  const columns = [];
  for (const row of objects.slice(0, 40)) {
    for (const column of Object.keys(row)) {
      if (columns.includes(column) || BLOCKED_KEY.test(column)) continue;
      columns.push(column);
      if (columns.length >= MAX_TABLE_COLUMNS) break;
    }
    if (columns.length >= MAX_TABLE_COLUMNS) break;
  }
  if (!columns.length) return null;
  const remainingRows = Math.floor(Math.max(0, MAX_TABLE_CELLS - budget.cells) / columns.length);
  const rowLimit = Math.min(MAX_TABLE_ROWS, objects.length, remainingRows);
  if (rowLimit <= 0) return null;
  const rows = objects.slice(0, rowLimit).map((row) => columns.map((column) => safeCell(row[column])));
  budget.cells += rows.length * columns.length;
  return {
    title: humanize(key),
    columns: columns.map(humanize),
    rows,
    totalRows: objects.length,
    truncated: rowLimit < objects.length,
  };
}

function extractHtmlTables(card, budget) {
  if (card?.type !== "html" || !card?.srcDoc || typeof DOMParser === "undefined") return [];
  const parsed = new DOMParser().parseFromString(String(card.srcDoc).slice(0, MAX_IMAGE_BYTES), "text/html");
  const tables = [];
  for (const [tableIndex, tableNode] of [...parsed.querySelectorAll("table")].slice(0, 8).entries()) {
    const rowNodes = [...tableNode.querySelectorAll("tr")];
    if (!rowNodes.length) continue;
    const firstCells = [...rowNodes[0].querySelectorAll("th,td")].slice(0, MAX_TABLE_COLUMNS);
    if (!firstCells.length) continue;
    const hasHeader = firstCells.some((cell) => cell.tagName === "TH");
    const columns = firstCells.map((cell, index) => sanitizeReportText(cell.textContent, 120) || `Column ${index + 1}`);
    const dataNodes = hasHeader ? rowNodes.slice(1) : rowNodes;
    const remainingRows = Math.floor(Math.max(0, MAX_TABLE_CELLS - budget.cells) / columns.length);
    const rowLimit = Math.min(MAX_TABLE_ROWS, dataNodes.length, remainingRows);
    if (rowLimit <= 0) break;
    const rows = dataNodes.slice(0, rowLimit).map((row) => {
      const cells = [...row.querySelectorAll(":scope > th, :scope > td")].slice(0, columns.length);
      return columns.map((_, index) => sanitizeReportText(cells[index]?.textContent, 180) || "—");
    });
    budget.cells += rows.length * columns.length;
    const caption = tableNode.querySelector("caption")?.textContent;
    tables.push({
      title: sanitizeReportText(caption, 120) || `${card.title} · table ${tableIndex + 1}`,
      columns,
      rows,
      totalRows: dataNodes.length,
      truncated: rowLimit < dataNodes.length,
    });
  }
  return tables;
}

export function extractReportTables(card, budget = { cells: 0 }) {
  const payload = card?.payload || {};
  const tables = [];
  const metrics = objectMetricRows(payload);
  if (metrics.length) {
    budget.cells += metrics.length * 2;
    tables.push({ title: "Reported metrics", columns: ["Metric", "Value"], rows: metrics, totalRows: metrics.length, truncated: false });
  }
  for (const [key, value] of Object.entries(payload)) {
    const table = extractArrayTable(card?.renderer, key, value, budget);
    if (table) tables.push(table);
    if (budget.cells >= MAX_TABLE_CELLS) break;
  }
  return tables;
}

function plotVariants(cards) {
  const variants = [];
  for (const card of cards || []) {
    if (card?.error) continue;
    if (card?.renderer === "wgs_sr_hexbin_v2" && card?.assetUrl) {
      variants.push({ ...card, url: card.assetUrl, path: card.assetPath, reportTitle: card.title, reportOptions: {}, staticImage: true });
    } else if (card?.type === "image" && card?.url) {
      variants.push({ ...card, reportTitle: card.title, reportOptions: {}, staticImage: true });
    } else if (card?.type !== "plotly" || !card?.payload) {
      continue;
    } else if (card.renderer === "cctyper_genemap") {
      const loci = [...new Set((card.payload?.genes_synteny || []).map((row) => String(row?.Locus_ID || "")))].filter(Boolean);
      const pages = Math.max(1, Math.ceil(loci.length / 10));
      for (let page = 0; page < pages; page += 1) {
        variants.push({
          ...card,
          reportTitle: loci.length ? `${card.title} · loci ${page * 10 + 1}–${Math.min((page + 1) * 10, loci.length)}` : card.title,
          reportOptions: { cctyperPage: page, cctyperView: "synteny" },
        });
      }
    } else {
      variants.push({ ...card, reportTitle: card.title, reportOptions: {} });
    }
    if (card.renderer === "wgs_lr_preprocessing" && card.assetUrl && card.assetPath) {
      variants.push({
        ...card, url: card.assetUrl, path: card.assetPath,
        reportTitle: `${card.title} · length–quality density`,
        reportOptions: {}, staticImage: true,
      });
    }
    if (variants.length >= MAX_FIGURES) break;
  }
  return variants.slice(0, MAX_FIGURES);
}

async function readBoundedResponse(response, maxBytes, signal) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error(`Static result image exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB export limit.`);
  const reader = response.body?.getReader();
  if (!reader) {
    const fallback = await response.arrayBuffer();
    if (fallback.byteLength > maxBytes) throw new Error("Static result image exceeds the export limit.");
    return new Uint8Array(fallback);
  }
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      throwIfCancelled(signal);
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("Static result image exceeds the export limit.");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function sanitizedSvgBlob(bytes) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const parsed = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = parsed.documentElement;
  if (root.localName !== "svg" || parsed.querySelector("parsererror")) throw new Error("Static SVG result is invalid.");
  parsed.querySelectorAll("script,foreignObject,iframe,object,embed,audio,video").forEach((node) => node.remove());
  parsed.querySelectorAll("*").forEach((node) => {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = String(attribute.value || "").trim();
      if (name.startsWith("on")) node.removeAttribute(attribute.name);
      if (["href", "xlink:href", "src"].includes(name) && value && !value.startsWith("#")) node.removeAttribute(attribute.name);
      if (name === "style" && /(?:url\s*\((?!\s*["']?#)|@import)/i.test(value)) node.removeAttribute(attribute.name);
    }
  });
  parsed.querySelectorAll("style").forEach((node) => {
    node.textContent = String(node.textContent || "")
      .replace(/@import[^;]+;/gi, "")
      .replace(/url\s*\((?!\s*["']?#)[^)]+\)/gi, "none");
  });
  return new Blob([new XMLSerializer().serializeToString(root)], { type: "image/svg+xml" });
}

async function renderStaticImageToPng(card, signal) {
  throwIfCancelled(signal);
  const path = String(card?.path || "").toLowerCase();
  if (!/\.(?:png|jpe?g|webp|svg)$/.test(path)) throw new Error("Only PNG, JPEG, WebP, and sanitized SVG figures can be exported.");
  const response = await fetch(card.url, { credentials: "include", signal, redirect: "error" });
  if (!response.ok) throw new Error(`Static result image returned HTTP ${response.status}.`);
  const bytes = await readBoundedResponse(response, MAX_IMAGE_BYTES, signal);
  const blob = path.endsWith(".svg")
    ? sanitizedSvgBlob(bytes)
    : new Blob([bytes], { type: response.headers.get("content-type") || "application/octet-stream" });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;
    await image.decode();
    throwIfCancelled(signal);
    const naturalWidth = Math.max(1, image.naturalWidth || image.width);
    const naturalHeight = Math.max(1, image.naturalHeight || image.height);
    const scale = Math.min(1, 1800 / naturalWidth, 1200 / naturalHeight, Math.sqrt(6_000_000 / (naturalWidth * naturalHeight)));
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("The browser could not create an image export surface.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/png", 0.94);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function throwIfCancelled(signal) {
  if (signal?.aborted) throw new DOMException("PDF export cancelled", "AbortError");
}

async function loadReportFonts(doc, signal) {
  const fonts = await Promise.all(["Regular", "Bold"].map(async (weight) => {
    const filename = `NotoSans-${weight}.ttf`;
    const response = await fetch(`/report/fonts/${filename}`, { signal, redirect: "error" });
    if (!response.ok) throw new Error("Report fonts could not be loaded. Please retry the export.");
    const bytes = await readBoundedResponse(response, 1024 * 1024, signal);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    }
    return { filename, data: btoa(binary), style: weight === "Bold" ? "bold" : "normal" };
  }));
  throwIfCancelled(signal);
  for (const font of fonts) {
    doc.addFileToVFS(font.filename, font.data);
    doc.addFont(font.filename, REPORT_FONT, font.style);
  }
}

function uniqueCards(cards) {
  const seen = new Set();
  return (cards || []).filter((card) => {
    const key = String(card?.path || card?.id || "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function buildAnalysisPdf({
  jobId,
  analysisIndex,
  analysisCards,
  analysisInterpretation,
  dashboardGroups,
  genomeMaps = [],
  genomeMapWarnings = [],
  jobSteps,
  submittedBy,
  workflowWarning,
  plotStyle = "modern",
  publicationPalette = "okabe_ito",
  signal,
  onProgress,
}) {
  const [{ jsPDF }, autoTableModule] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const autoTable = autoTableModule.autoTable || autoTableModule.default;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true, putOnlyUsedFonts: true });
  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 16;
  const contentWidth = pageWidth - margin * 2;
  const { navy, blue, slate, pale } = REPORT_COLORS;
  const sample = sanitizeReportText(analysisIndex?.sample || "Analysis", 120);
  const profile = `${sanitizeReportText(analysisIndex?.analysis_type || "", 40)} · ${sanitizeReportText(analysisIndex?.mode || "", 40)}`.replace(/^ · | · $/g, "");
  const summary = analysisInterpretation?.grounded ? analysisInterpretation?.summary : null;
  const provenance = analysisInterpretation?.provenance || {};
  const reportSubmitter = sanitizeReportText(submittedBy || "Not recorded", 160);
  onProgress?.({ stage: "composing", current: 0, total: 0, label: "Preparing report" });
  const [, reportLogo] = await Promise.all([
    loadReportFonts(doc, signal),
    renderStaticImageToPng({ path: "genocular_logo.svg", url: "/genocular_logo.svg" }, signal),
  ]);
  doc.setProperties({
    title: `${sample} — Genomic Analysis Results`,
    subject: `Workflow results for job ${sanitizeReportText(jobId, 90)}`,
    author: "GENOCULAR",
    creator: "GENOCULAR",
    keywords: "genomics, metagenomics, workflow results, scientific report",
  });
  doc.setLanguage?.("en-US");
  doc.viewerPreferences?.({ DisplayDocTitle: true, FitWindow: true });
  const warnings = [];
  if (workflowWarning) warnings.push(sanitizeReportText(workflowWarning, 600));
  for (const warning of genomeMapWarnings || []) {
    const cleaned = sanitizeReportText(warning, 600);
    if (cleaned) warnings.push(cleaned);
  }
  let y = margin;

  const addPage = () => {
    doc.addPage();
    y = 18;
  };
  const ensureSpace = (height) => {
    if (y + height > pageHeight - 18) addPage();
  };
  const addHeading = (text, level = 1) => {
    const size = level === 1 ? 17 : level === 2 ? 13 : 10;
    doc.setFont(REPORT_FONT, "bold");
    doc.setFontSize(size);
    doc.setTextColor(...(level === 1 ? navy : blue));
    const lines = doc.splitTextToSize(sanitizeReportText(text, 180), contentWidth);
    const lineHeight = size * 0.44;
    const before = level === 1 ? 5 : 2;
    ensureSpace(before + lines.length * lineHeight + 5);
    if (y > 18) y += before;
    doc.text(lines, margin, y, { lineHeightFactor: 1.25 });
    y += lines.length * lineHeight + 3;
  };
  const addParagraph = (text, options = {}) => {
    const cleaned = sanitizeReportText(text, options.maxLength || 2200);
    if (!cleaned) return;
    const x = Number.isFinite(options.x) ? options.x : margin;
    doc.setFont(REPORT_FONT, options.bold ? "bold" : "normal");
    doc.setFontSize(options.size || 9.5);
    doc.setTextColor(...(options.color || slate));
    const lines = doc.splitTextToSize(cleaned, options.width || contentWidth - (x - margin));
    const lineHeight = options.lineHeight || (options.size || 9.5) * 0.46;
    ensureSpace(lines.length * lineHeight + 2);
    doc.text(lines, x, y, { lineHeightFactor: 1.25 });
    y += lines.length * lineHeight + (options.after ?? 3);
  };
  const addTable = (table, sourcePath = "") => {
    if (!table?.rows?.length) return;
    ensureSpace(24);
    doc.setFont(REPORT_FONT, "bold");
    doc.setFontSize(9);
    doc.setTextColor(...navy);
    const titleLines = doc.splitTextToSize(sanitizeReportText(table.title, 140), contentWidth);
    ensureSpace(titleLines.length * 4.2 + 20);
    doc.text(titleLines, margin, y, { lineHeightFactor: 1.25 });
    y += titleLines.length * 4.2;
    autoTable(doc, {
      startY: y,
      head: [table.columns],
      body: table.rows,
      theme: "grid",
      margin: { left: margin, right: margin, top: 18, bottom: 18 },
      styles: { font: REPORT_FONT, fontSize: table.columns.length > 6 ? 7 : 8, cellPadding: 2, lineColor: REPORT_COLORS.line, lineWidth: 0.1, textColor: slate, overflow: "linebreak" },
      headStyles: { fillColor: navy, textColor: [255, 255, 255], fontStyle: "bold", fontSize: table.columns.length > 6 ? 7 : 8 },
      alternateRowStyles: { fillColor: pale },
      showHead: "everyPage",
      rowPageBreak: "avoid",
    });
    y = (doc.lastAutoTable?.finalY || y) + 4;
    if (table.truncated) {
      addParagraph(`Showing ${table.rows.length.toLocaleString()} of ${table.totalRows.toLocaleString()} rows. Complete data: ${sourcePath}`, { size: 7.5, color: [100, 116, 139], maxLength: 600 });
      warnings.push(`${table.title} was limited to ${table.rows.length} of ${table.totalRows} rows.`);
    }
  };

  // Reserve the first page; draw its download date once every figure is ready.
  addPage();
  if (summary) {
    addHeading("Executive summary");
    if (summary.overview) addParagraph(summary.overview, { size: 10, color: navy });
  }
  if (Array.isArray(summary?.key_findings) && summary.key_findings.length) {
    summary.key_findings.forEach((finding, index) => {
      addHeading(`${index + 1}. ${finding.title}`, 2);
      addParagraph(finding.interpretation);
      const evidence = (finding.evidence || []).map((item) => `${item.title || item.label}: ${safeCell(item.value)}`).join(" · ");
      if (evidence) addParagraph(`Evidence: ${evidence}`, { size: 7.5, color: [100, 116, 139], maxLength: 900 });
    });
  }
  if (summary?.limitations?.length) {
    addHeading("Limitations", 2);
    summary.limitations.forEach((item) => addParagraph(`• ${item}`, { size: 8.5 }));
  }
  if (summary?.recommended_actions?.length) {
    addHeading("Recommended checks", 2);
    summary.recommended_actions.forEach((item) => addParagraph(`• ${item}`, { size: 8.5 }));
  }

  addHeading("Report contents");
  const contentRows = (dashboardGroups || []).map((group, index) => [String(index + 1), sanitizeReportText(group.label, 100), String(group.cards?.length || 0)]);
  addTable({ title: "Scientific sections", columns: ["No.", "Section", "Views"], rows: contentRows, totalRows: contentRows.length, truncated: false });

  addHeading("Methods and provenance");
  const provenanceRows = [
    ["Job ID", jobId || "Not reported"],
    ["Workflow profile", analysisInterpretation?.profile || profile || "Not reported"],
    ["Job status", provenance.status || "Not reported"],
    ["Submitted", formatReportDateTime(provenance.created_at)],
    ["Started", formatReportDateTime(provenance.started_at)],
    ["Finished", formatReportDateTime(provenance.finished_at)],
    ["Analysis generated", formatReportDateTime(analysisInterpretation?.analysis_generated_at || analysisIndex?.generated_at)],
    ["Narrative engine", analysisInterpretation?.model || "Not reported"],
    ["Scientific knowledge version", analysisInterpretation?.knowledge_version || "Not reported"],
  ].map(([label, value]) => [label, sanitizeReportText(value, 180)]);
  addTable({ title: "Run provenance", columns: ["Field", "Value"], rows: provenanceRows, totalRows: provenanceRows.length, truncated: false });
  const workflowRows = (jobSteps?.steps || []).slice(0, 100).map((step, index) => [
    String(index + 1),
    sanitizeReportText(step?.label || step?.name || step?.title || step?.id || "Workflow step", 120),
    sanitizeReportText(step?.status || "Not reported", 40),
    formatReportDateTime(step?.startedAt || step?.started_at, "—"),
    formatReportDateTime(step?.endedAt || step?.finishedAt || step?.ended_at, "—"),
  ]);
  if (workflowRows.length) {
    addTable({ title: "Workflow execution", columns: ["No.", "Step", "Status", "Started", "Finished"], rows: workflowRows, totalRows: jobSteps.steps.length, truncated: workflowRows.length < jobSteps.steps.length });
  }
  const methodRows = uniqueCards(analysisCards).filter((card) => !BLOCKED_ARTIFACT.test(String(card?.path || ""))).slice(0, 64).map((card) => [
    sanitizeReportText(card.title, 100),
    sanitizeReportText(card.source || "Workflow output", 60),
    sanitizeReportText(card.renderer || card.type, 60),
    sanitizeReportText(card.path, 160),
  ]);
  addTable({ title: "Generated result modules", columns: ["Result", "Source", "Renderer", "Result file"], rows: methodRows, totalRows: methodRows.length, truncated: false });

  const validGenomeMaps = (genomeMaps || []).filter((map) => map?.image);
  if (validGenomeMaps.length) {
    for (const [index, map] of validGenomeMaps.entries()) {
      addPage();
      addHeading(index === 0 ? "Genome maps" : `Genome maps · ${index + 1} of ${validGenomeMaps.length}`);
      addHeading(`Genome map ${index + 1} of ${validGenomeMaps.length} — ${sanitizeReportText(map.title || `Genome ${index + 1}`, 140)}`, 2);
      try {
        const properties = doc.getImageProperties(map.image);
        const maxHeight = pageHeight - y - 34;
        const ratio = Math.min(contentWidth / properties.width, maxHeight / properties.height);
        const width = properties.width * ratio;
        const height = properties.height * ratio;
        doc.addImage(map.image, "PNG", margin + (contentWidth - width) / 2, y, width, height, undefined, "FAST");
        y += height + 5;
        if (map.bpLength) addParagraph(`Genome length: ${Number(map.bpLength).toLocaleString("en-US")} bp`, { size: 8, color: [100, 116, 139] });
      } catch (mapError) {
        warnings.push(`${map.title || `Genome ${index + 1}`}: ${mapError?.message || String(mapError)}`);
        addParagraph("This genome map could not be placed in the PDF.", { color: [185, 28, 28] });
      }
    }
  }

  const variants = plotVariants(analysisCards);
  const availableFigureCount = (analysisCards || []).filter((card) => !card?.error && ((card?.type === "plotly" && card?.payload) || (card?.type === "image" && card?.url))).length;
  if (availableFigureCount > MAX_FIGURES) {
    warnings.push(`The report figure safety limit is ${MAX_FIGURES}; ${availableFigureCount - MAX_FIGURES} additional views remain available in the interactive dashboard.`);
  }
  const budget = { cells: 0 };
  const tablePaths = new Set();
  let figureNumber = 0;
  let sectionNumber = 0;
  onProgress?.({ stage: "composing", current: 0, total: variants.length, label: "Preparing result figures" });

  for (const group of dashboardGroups || []) {
    throwIfCancelled(signal);
    const groupIds = new Set((group.cards || []).map((card) => card.id));
    const groupVariants = variants.filter((card) => groupIds.has(card.id));
    if (!groupVariants.length && !(group.cards || []).length) continue;
    sectionNumber += 1;
    addPage();
    addHeading(`${sectionNumber}. ${group.label}`);
    addParagraph(group.description, { size: 8.5 });

    for (const card of groupVariants) {
      throwIfCancelled(signal);
      onProgress?.({ stage: "rendering", current: Math.min(variants.length, figureNumber + 1), total: variants.length, label: card.reportTitle });
      let figures = [];
      let renderError = null;
      try {
        if (card.staticImage) {
          figures = [{ image: await renderStaticImageToPng(card, signal) }];
        } else if (UPDATED_DASHBOARD_RENDERERS.has(card.renderer)) {
          figures = await renderUpdatedDashboardFigures(card, { plotStyle, publicationPalette }, signal);
        } else {
          figures = [{ image: await renderAnalysisPlotToPng(card.renderer, card.payload, {
            ...(card.reportOptions || {}), plotStyle, publicationPalette,
          }) }];
        }
      } catch (error) {
        renderError = error;
        warnings.push(`${card.reportTitle}: ${error?.message || String(error)}`);
      }
      if (renderError || !figures.length) {
        figureNumber += 1;
        ensureSpace(24);
        addHeading(`Figure ${figureNumber}. ${card.reportTitle}`, 2);
        addParagraph("This figure could not be rendered; its metrics and source file are retained below.", { color: [185, 28, 28] });
      }
      for (const [panelIndex, figure] of figures.entries()) {
        if (figureNumber >= MAX_FIGURES) break;
        throwIfCancelled(signal);
        figureNumber += 1;
        ensureSpace(126);
        const suffix = figure.title ? ` · ${figure.title}` : figures.length > 1 ? ` · panel ${panelIndex + 1}` : "";
        addHeading(`Figure ${figureNumber}. ${card.reportTitle}${suffix}`, 2);
        try {
          const properties = doc.getImageProperties(figure.image);
          const ratio = Math.min(contentWidth / properties.width, 102 / properties.height);
          const width = properties.width * ratio;
          const height = properties.height * ratio;
          doc.addImage(figure.image, "PNG", margin + (contentWidth - width) / 2, y, width, height, undefined, "FAST");
          y += height + 4;
        } catch (error) {
          warnings.push(`${card.reportTitle}: ${error?.message || String(error)}`);
          addParagraph("This figure could not be placed in the PDF.", { color: [185, 28, 28] });
        }
      }
      if (!UPDATED_DASHBOARD_RENDERERS.has(card.renderer)) {
        addParagraph(PLOT_NOTES[card.renderer] || "Workflow-generated result figure.", { size: 7.5, color: [100, 116, 139] });
      }
      addParagraph(`Source: ${card.source || "workflow output"}`, { size: 7, color: [100, 116, 139], maxLength: 240 });

      if (!card.staticImage && !tablePaths.has(card.path)) {
        tablePaths.add(card.path);
        const tables = extractReportTables(card, budget);
        for (const table of tables) addTable(table, card.path);
      }
    }

    for (const card of group.cards || []) {
      if (card.type === "plotly" || card.type === "image") continue;
      addHeading(card.title, 2);
      addParagraph(`Supporting ${card.type || "file"} report: ${card.path}`, { size: 8 });
      if (card.type === "html" && !tablePaths.has(card.path)) {
        tablePaths.add(card.path);
        if (card.payload) {
          for (const table of extractReportTables({ ...card, renderer: card.dataRenderer }, budget)) addTable(table, card.path);
        }
        for (const table of extractHtmlTables(card, budget)) addTable(table, card.path);
      }
    }
  }

  addPage();
  addHeading("Scientific guidance and references");
  const guidance = Array.isArray(analysisInterpretation?.guidance) ? analysisInterpretation.guidance : [];
  if (guidance.length) {
    guidance.forEach((entry, index) => {
      addHeading(`${index + 1}. ${entry.title || entry.id}`, 2);
      (entry.sources || []).forEach((source) => {
        const url = sanitizeReportText(source, 400);
        let linkUrl = "";
        try {
          const parsed = new URL(url);
          if (parsed.protocol === "https:") linkUrl = parsed.toString();
        } catch { /* Invalid references are printed as text, never activated. */ }
        ensureSpace(6);
        doc.setFont(REPORT_FONT, "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(...(linkUrl ? blue : slate));
        const line = doc.splitTextToSize(url, contentWidth)[0];
        if (linkUrl) doc.textWithLink(line, margin, y, { url: linkUrl });
        else doc.text(line, margin, y);
        y += 5;
      });
    });
  } else {
    addParagraph("No curated guidance references were returned with this summary.");
  }

  if (warnings.length) {
    addHeading("Export notes", 2);
    warnings.slice(0, 30).forEach((warning) => addParagraph(`• ${warning}`, { size: 7.5 }));
  }

  addPage();
  addHeading("Interpretation notice");
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.25);
  doc.roundedRect(margin, y, contentWidth, 58, 3, 3, "FD");
  y += 10;
  addParagraph("This report summarizes computationally generated results. Database and homology hits indicate genomic potential, not expression, phenotype, activity, pathogenicity, clinical resistance, diagnosis, or treatment relevance. Absence of detection is not proof of biological absence. Confirm important conclusions using source outputs, controls, appropriate comparative design, and domain-specific validation.", { x: margin + 10, size: 9, color: navy, width: contentWidth - 20, lineHeight: 5, after: 0 });

  const institutionalCreditY = pageHeight - 36;
  doc.setDrawColor(...blue);
  doc.setLineWidth(0.6);
  doc.line(margin, institutionalCreditY - 8, margin + 34, institutionalCreditY - 8);
  doc.setFont(REPORT_FONT, "bold");
  doc.setFontSize(9);
  doc.setTextColor(...navy);
  doc.text("Generated by GENOCULAR", margin, institutionalCreditY);
  doc.setFont(REPORT_FONT, "normal");
  doc.setFontSize(8);
  doc.setTextColor(...slate);
  doc.text("BRIC-Institute of Life Sciences, Bhubaneswar", margin, institutionalCreditY + 6);

  onProgress?.({ stage: "finalizing", current: variants.length, total: variants.length, label: "Finalizing PDF" });
  const downloadedAt = new Date();
  const downloadedDate = formatDownloadDate(downloadedAt);
  doc.setCreationDate(downloadedAt);
  doc.setPage(1);
  drawReportCover(doc, {
    sample,
    profile,
    submittedBy: reportSubmitter,
    jobId: sanitizeReportText(jobId, 90),
    analysisDate: formatReportDateTime(analysisIndex?.generated_at),
    downloadedDate,
    logo: reportLogo,
    isDemo: analysisInterpretation?.is_demo || analysisIndex?.demo,
  });
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    if (page > 1) {
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, 11, pageWidth - margin, 11);
      doc.setFont(REPORT_FONT, "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(...slate);
      doc.text("GENOCULAR · Results Report", margin, 8);
      doc.setFont(REPORT_FONT, "normal");
      let headerSample = sample;
      while (doc.getTextWidth(headerSample) > 80 && headerSample.length > 1) {
        headerSample = headerSample.slice(0, -2).trimEnd() + "…";
      }
      doc.text(headerSample, pageWidth - margin, 8, { align: "right" });
      doc.line(margin, pageHeight - 11, pageWidth - margin, pageHeight - 11);
      doc.text(`Page ${page} of ${pageCount}`, pageWidth - margin, pageHeight - 7, { align: "right" });
      doc.text(`Job ${sanitizeReportText(jobId, 50)}`, margin, pageHeight - 7);
      doc.setFontSize(7);
      doc.text(`Downloaded ${downloadedDate}`, 153, pageHeight - 7, { align: "right" });
    }
    if (analysisInterpretation?.is_demo || analysisIndex?.demo) {
      doc.setFont(REPORT_FONT, "bold");
      doc.setFontSize(32);
      doc.setTextColor(254, 226, 226);
      doc.text("SYNTHETIC DEMO", pageWidth / 2, pageHeight / 2, { align: "center", angle: 35 });
    }
  }

  throwIfCancelled(signal);
  const blob = doc.output("blob");
  if (blob.size > MAX_PDF_BYTES) throw new Error(`The generated PDF is ${(blob.size / 1024 / 1024).toFixed(1)} MB, above the 25 MB safety limit.`);
  const filename = `${sanitizeReportFilename(sample)}-${sanitizeReportFilename(jobId)}-results.pdf`;
  return { blob, filename, pageCount, figureCount: figureNumber + validGenomeMaps.length, warnings };
}

export function downloadPdfBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
