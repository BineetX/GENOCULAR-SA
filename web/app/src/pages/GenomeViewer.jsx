import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { usePersistentState, useSessionState } from "../lib/usePersistentState.js";
import { apiJson } from "../lib/api.js";
import { useTheme } from "../lib/ThemeContext.jsx";
import {
  jobAccessFromInput,
  privateJobPath,
  registerJobAccessKey,
} from "../lib/jobAccess.js";
import AnalysisPlot, { PLOT_PALETTES, PUBLICATION_PALETTES } from "../components/AnalysisPlot.jsx";
import UpdatedDashboard, { UPDATED_DASHBOARD_RENDERERS } from "../components/updatedPlots/UpdatedDashboard.jsx";
import AnalysisReportExport from "../components/AnalysisReportExport.jsx";
import { ALLOWED_ANALYSIS_RENDERERS, isRedundantAnalysisSection } from "../lib/analysisRenderers.js";
import { needsReportCookieFallback, REPORT_COOKIE_FALLBACK } from "../lib/reportCompatibility.js";
import { motion as _motion } from "framer-motion";
import {
  FileUp,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Image as ImageIcon,
  FileJson as FileJsonIcon,
  SlidersHorizontal,
  Layers,
  Palette,
  X,
  Dna,
  Info,
  ChevronDown,
  ChevronUp,
  Minimize2,
  Search,
  ArrowRight,
  Link2,
  ShieldCheck,
} from "lucide-react";
import "cgview/dist/cgview.css";

const toolbarButtonClass =
  "inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-700 shadow-sm transition hover:-translate-y-px hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-sky-500/30 disabled:pointer-events-none disabled:opacity-40";

function ToggleControl({ label, description, checked, onChange }) {
  return (
    <label className="group flex cursor-pointer items-center justify-between gap-4 rounded-xl px-3 py-2.5 transition hover:bg-slate-50">
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-slate-800">{label}</span>
        {description && <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{description}</span>}
      </span>
      <span className="relative inline-flex shrink-0 items-center">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="h-6 w-11 rounded-full bg-slate-200 ring-1 ring-inset ring-slate-300 transition peer-checked:bg-sky-600 peer-checked:ring-sky-600 peer-focus-visible:ring-2 peer-focus-visible:ring-sky-500/40" />
        <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

function SegmentedControl({ label, value, options, onChange }) {
  return (
    <div className="space-y-2 px-3 py-2">
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1 ring-1 ring-inset ring-slate-200">
        {options.map((option) => {
          const active = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={`rounded-lg px-3 py-2 text-[12px] font-semibold transition focus:outline-none focus:ring-2 focus:ring-sky-500/30 ${
                active
                  ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200"
                  : "text-slate-500 hover:text-slate-800"
              }`}
              aria-pressed={active}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SelectControl({ label, value, onChange, children }) {
  return (
    <label className="flex items-center justify-between gap-4 px-3 py-2.5">
      <span className="text-[13px] font-semibold text-slate-800">{label}</span>
      <span className="relative">
        <select
          className="h-9 appearance-none rounded-xl border border-slate-200 bg-white py-1 pl-3 pr-9 text-[12px] font-semibold text-slate-700 shadow-sm outline-none transition hover:border-slate-300 focus:border-sky-400 focus:ring-2 focus:ring-sky-500/20"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
      </span>
    </label>
  );
}

function ControlSection({ icon, title, description, children }) {
  const iconElement = React.createElement(icon, { className: "h-4 w-4" });
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start gap-3 border-b border-slate-100 bg-slate-50/80 px-4 py-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white text-sky-700 shadow-sm ring-1 ring-slate-200">
          {iconElement}
        </span>
        <span>
          <span className="block text-[13px] font-bold text-slate-900">{title}</span>
          <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{description}</span>
        </span>
      </div>
      <div className="divide-y divide-slate-100 p-1.5">{children}</div>
    </section>
  );
}

/* ---------- UI defaults ---------- */
const DEFAULT_UI = {
  theme: "light",             // light | dark
  format: "circular",         // circular | linear
  showLabels: true,
  showShading: true,          // parsed path still handled via JSON build
  legendPos: "bottom-right",  // keep away from sticky header by default
  arrowLen: 0.30,             // 0.10 – 0.60 looks good
  showCDS: true,
  showTRNA: true,
  showRRNA: true,
  showGCContent: true,
  showGCSkew: true,
  plotThickness: 2,           // 1–4
};

/* Build a CGView config from current UI settings (used on initial load & rebuilds) */
function buildConfig(ui) {
  const isDark = ui.theme === "dark";
  const base = {
    settings: {
      backgroundColor: isDark ? "#0b0f19" : "#fbfdff",
      format: ui.format,                  // <-- important
      arrowHeadLength: ui.arrowLen,
    },
    annotation: {
      font: "Arial,plain,11",
      fontColor: isDark ? "#e2e8f0" : "#334155",
    },
    ruler: { font: "Arial,plain,11", color: isDark ? "#cbd5e1" : "#475569" },
    legend: {
      position: ui.legendPos,
      defaultFont: "Arial,plain,12",
      defaultFontColor: isDark ? "#e5e7eb" : "#111827",
      backgroundColor: isDark ? "rgba(15,23,42,0.90)" : "rgba(255,255,255,0.94)",
      items: [
        { name: "CDS",        swatchColor: isDark ? "rgba(96,165,250,0.72)" : "rgba(37,99,235,0.68)", decoration: "arrow" },
        { name: "tRNA",       swatchColor: isDark ? "rgba(216,180,254,0.72)" : "rgba(147,51,234,0.66)" },
        { name: "rRNA",       swatchColor: isDark ? "rgba(110,231,183,0.72)" : "rgba(5,150,105,0.68)" },
        { name: "GC Content", swatchColor: isDark ? "rgba(226,232,240,0.68)" : "rgba(71,85,105,0.62)" },
        { name: "GC Skew+",   swatchColor: "rgba(239,68,68,0.72)" },
        { name: "GC Skew−",   swatchColor: "rgba(14,165,233,0.72)" },
      ],
    },
    tracks: [],
  };

  if (ui.showGCContent) {
    base.tracks.push({
      name: "GC Content",
      thicknessRatio: ui.plotThickness,
      position: "inside",
      dataType: "plot",
      dataMethod: "sequence",
      dataKeys: "gc-content",
    });
  }
  if (ui.showGCSkew) {
    base.tracks.push({
      name: "GC Skew",
      thicknessRatio: ui.plotThickness,
      position: "inside",
      dataType: "plot",
      dataMethod: "sequence",
      dataKeys: "gc-skew",
    });
  }
  return base;
}

function findAssemblyGbk(items = []) {
  const exact =
    items.find((it) => /antismash_results\/contigs\.(gbk|gb|genbank)$/i.test(String(it?.key || ""))) ||
    items.find((it) => /antismash_results\/assembly\.gbk$/i.test(String(it?.key || ""))) ||
    items.find((it) => /assembly\.gbk$/i.test(String(it?.key || "")));
  if (exact) return exact;

  const antiSmashGbks = items.filter((it) =>
    /antismash_results\/.+\.(gbk|gb|genbank)$/i.test(String(it?.key || ""))
  );
  return antiSmashGbks[0] || null;
}

function findGenomeGbkItems(items = []) {
  // WGS antiSMASH writes one annotated whole-assembly file at this exact path.
  // Prefer it exclusively over Prokka and antiSMASH region files; those are
  // alternate/partial representations, not additional genomes.
  const antiSmashWgsAssemblies = items.filter((item) =>
    Boolean(item?.url) &&
    /antismash_results\/contigs\.(gbk|gb|genbank)$/i.test(String(item?.key || ""))
  );
  if (antiSmashWgsAssemblies.length) {
    return [...antiSmashWgsAssemblies].sort((a, b) =>
      String(a?.key || "").localeCompare(String(b?.key || ""))
    );
  }

  const candidates = items.filter((item) => {
    const key = String(item?.key || "");
    if (!/\.(gbk|gb|genbank)$/i.test(key) || !item?.url) return false;
    return (
      /antismash_results\/assembly\.(gbk|gb|genbank)$/i.test(key) ||
      /\/annotation\/prokka\//i.test(key) ||
      /\/prokka\/annotated_genome\.(gbk|gb|genbank)$/i.test(key)
    );
  });
  return [...candidates].sort((a, b) => {
    const aKey = String(a?.key || "");
    const bKey = String(b?.key || "");
    const priority = (key) => /antismash_results\/assembly\.gbk$/i.test(key) ? 0 : (/\/annotation\/prokka\//i.test(key) ? 1 : 2);
    return priority(aKey) - priority(bKey) || aKey.localeCompare(bKey);
  });
}

function genomeItemLabel(item) {
  const key = String(item?.key || "");
  const parts = key.split("/").filter(Boolean);
  const file = parts.at(-1) || "Genome";
  const parent = parts.at(-2) || "";
  return parent && !/^antismash_results$/i.test(parent) ? `${parent} · ${file}` : file;
}

function findAntiSmashIndex(items = []) {
  return items.find((it) => /antismash_results\/index\.html$/i.test(String(it?.key || ""))) || null;
}

function findNanoPlotIndex(items = []) {
  return items.find((it) => /nanoplot\/nanoplot-report\.html$/i.test(String(it?.key || ""))) || null;
}

function findCrisprPlot(items = []) {
  return items.find((it) => /crispr_output\/plot\.png$/i.test(String(it?.key || ""))) || null;
}

function findAnalysisIndex(items = []) {
  return items.find((it) => /analysis\/index\.json$/i.test(String(it?.key || ""))) || null;
}

const MAX_ANALYSIS_JSON_BYTES = 12 * 1024 * 1024;
const MAX_REPORT_GENBANK_BYTES = 64 * 1024 * 1024;
const MAX_REPORT_GENBANK_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_REPORT_GENOME_PNG_BYTES = 12 * 1024 * 1024;
const MAX_REPORT_GENOME_MAPS = 64;
const REPORT_GENOME_MAP_SIZE = 1200;
const ALLOWED_ANALYSIS_SECTION_TYPES = new Set(["html", "image", "file", "plotly"]);

function excludedGenomeFeatures(state) {
  const excluded = ["source", "exon"];
  if (!state.showCDS) excluded.push("CDS");
  if (!state.showTRNA) excluded.push("tRNA");
  if (!state.showRRNA) excluded.push("rRNA");
  return excluded;
}

function throwIfReportCancelled(signal) {
  if (signal?.aborted) throw new DOMException("PDF export cancelled", "AbortError");
}

function cgviewSequenceLength(json) {
  const sequence = json?.cgview?.sequence || json?.sequence;
  const directLength = Number(sequence?.length || sequence?.bpLength || 0);
  if (directLength > 0) return directLength;
  const contigLength = Array.isArray(sequence?.contigs)
    ? sequence.contigs.reduce((total, contig) => total + Math.max(0, Number(contig?.length || String(contig?.seq || "").length || 0)), 0)
    : 0;
  return contigLength || null;
}

async function canvasPngBytes(canvas, signal) {
  throwIfReportCancelled(signal);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error("The browser could not encode the genome map."));
    }, "image/png");
  });
  throwIfReportCancelled(signal);
  return new Uint8Array(await blob.arrayBuffer());
}

async function renderIsolatedGenomeMap({ CGView, CGParse, item, maxInputBytes = MAX_REPORT_GENBANK_BYTES, signal }) {
  throwIfReportCancelled(signal);
  const text = await fetchBoundedText(item.url, Math.min(MAX_REPORT_GENBANK_BYTES, maxInputBytes), "Genome file", signal);
  throwIfReportCancelled(signal);

  const reportUi = { ...DEFAULT_UI, theme: "light", format: "circular", legendPos: "bottom-right" };
  const sequenceFile = new CGParse.SequenceFile(text);
  const json = sequenceFile.toCGViewJSON({
    config: buildConfig(reportUi),
    excludeFeatures: excludedGenomeFeatures(reportUi),
    excludeQualifiers: ["translation"],
  });
  throwIfReportCancelled(signal);

  const host = document.createElement("div");
  host.id = `cgv-report-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
  Object.assign(host.style, {
    position: "fixed",
    left: "-100000px",
    top: "0",
    width: `${REPORT_GENOME_MAP_SIZE}px`,
    height: `${REPORT_GENOME_MAP_SIZE}px`,
    visibility: "hidden",
    pointerEvents: "none",
    contain: "strict",
  });
  document.body.appendChild(host);

  const capturedDocumentListeners = [];
  const originalAddEventListener = document.addEventListener;
  try {
    let viewer;
    try {
      document.addEventListener = function captureCgviewDocumentListener(type, listener, options) {
        if (type === "keypress") capturedDocumentListeners.push({ type, listener, options });
        return originalAddEventListener.call(this, type, listener, options);
      };
      viewer = new CGView.Viewer(`#${host.id}`, {
        width: REPORT_GENOME_MAP_SIZE,
        height: REPORT_GENOME_MAP_SIZE,
        allowDragAndDrop: false,
      });
    } finally {
      document.addEventListener = originalAddEventListener;
    }
    viewer.io.loadJSON(json);
    viewer.drawExport();
    viewer.fillBackground();
    viewer.legend.draw();
    viewer.captions().each((_index, caption) => caption.draw());
    throwIfReportCancelled(signal);

    const composite = document.createElement("canvas");
    composite.width = REPORT_GENOME_MAP_SIZE;
    composite.height = REPORT_GENOME_MAP_SIZE;
    const context = composite.getContext("2d", { alpha: false });
    if (!context) throw new Error("The browser could not create a genome-map export surface.");
    context.fillStyle = "#fbfdff";
    context.fillRect(0, 0, composite.width, composite.height);
    for (const layer of ["background", "map", "foreground", "canvas"]) {
      context.drawImage(viewer.canvas.node(layer), 0, 0, composite.width, composite.height);
    }

    return {
      title: genomeItemLabel(item),
      bpLength: cgviewSequenceLength(json),
      image: await canvasPngBytes(composite, signal),
      inputBytes: new Blob([text]).size,
    };
  } finally {
    document.addEventListener = originalAddEventListener;
    for (const { type, listener, options } of capturedDocumentListeners) {
      document.removeEventListener(type, listener, options);
    }
    host.remove();
  }
}

// Older result manifests used one renderer per JSON file even when that file
// contains several scientifically distinct figures. Expand those legacy cards
// in the browser; new manifests emit these views explicitly.
const LEGACY_RENDERER_VIEWS = {
  fastp_qc: [
    ["fastp_quality", "Per-base read quality"],
    ["fastp_content", "Per-base nucleotide composition"],
    ["fastp_rates", "Q20 and Q30 quality rates"],
    ["fastp_retained", "Reads retained after filtering"],
  ],
  mapping_depth: [
    ["mapping_flagstat", "Read mapping summary"],
    ["mapping_depth", "Per-contig mapping depth"],
  ],
  mag_alpha: [
    ["mag_alpha_summary", "MAG alpha-diversity summary"],
    ["mag_rank_abundance", "MAG rank-abundance curve"],
  ],
  cctyper_synteny: [
    ["cctyper_subtypes", "CRISPR-Cas subtype distribution"],
    ["cctyper_genemap", "CRISPR-Cas genomic synteny maps"],
  ],
  metaphlan_species: [
    ["metaphlan_species", "MetaPhlAn species composition"],
    ["metaphlan_alpha_summary", "MetaPhlAn genus alpha diversity"],
  ],
};

const ANALYSIS_DASHBOARD_GROUPS = [
  {
    id: "read-quality",
    label: "Read quality & preprocessing",
    description: "Read retention, per-base composition, quality thresholds and long-read distributions.",
    renderers: ["fastp_qc", "fastp_quality", "fastp_content", "fastp_rates", "fastp_retained", "nanostat_qc"],
  },
  {
    id: "assembly-mapping",
    label: "Assembly & mapping",
    description: "Assembly contiguity, alignment yield, coverage distribution and sequencing depth.",
    renderers: ["metaquast_curve", "mapping_flagstat", "mapping_depth", "mapping_density", "nonpareil_curve"],
  },
  {
    id: "genome-quality",
    label: "Genome & MAG quality",
    description: "Completeness, contamination, chimerism and other quality evidence used to assess recovered genomes.",
    renderers: ["checkm2_quality", "gunc_sankey", "wgs_quality"],
  },
  {
    id: "taxonomy-ecology",
    label: "Taxonomy, abundance & diversity",
    description: "Taxonomic assignments, community composition, relative abundance and ecological diversity structure.",
    renderers: ["coverm_abundance", "mag_alpha", "mag_alpha_summary", "mag_rank_abundance", "gtdbtk_taxonomy", "metaphlan_species", "metaphlan_alpha_summary", "metaphlan_rank_abundance", "bracken_sunburst", "read_alpha"],
  },
  {
    id: "functional-annotation",
    label: "Functional annotation",
    description: "CAZymes, genes, pathways, resistance, repeats and protein-domain evidence.",
    renderers: ["dbcan_composition", "prokka_features", "hadeg_network", "meta_amr", "wgs_amr", "wgs_cazymes", "wgs_cog", "wgs_interpro", "wgs_kofam", "wgs_prokka", "wgs_repeats"],
  },
  {
    id: "crispr-mobile",
    label: "CRISPR-Cas, viral & mobile elements",
    description: "CRISPR-Cas locus architecture, subtype calls and viral sequence evidence.",
    renderers: ["cctyper_subtypes", "cctyper_genemap", "cctyper_synteny", "virsorter_scores"],
  },
  {
    id: "full-reports",
    label: "Full reports",
    description: "Complete workflow-generated HTML reports and downloadable result figures.",
    renderers: [],
  },
];

const UPDATED_DASHBOARD_GROUP = {
  wgs_preprocessing: "read-quality", wgs_lr_preprocessing: "read-quality", wgs_sr_hexbin_v2: "read-quality",
  mag_assembly_v2: "assembly-mapping", mag_binning_v2: "assembly-mapping", mag_nonpareil_v2: "assembly-mapping",
  wgs_quality_v2: "genome-quality", mag_busco_v2: "genome-quality", mag_barrnap_v2: "genome-quality",
  mag_metaphlan_v2: "taxonomy-ecology", mag_metaphlan_alpha_v2: "taxonomy-ecology", mag_metaphlan_rank_v2: "taxonomy-ecology",
  mag_virsorter_v2: "crispr-mobile",
};

const FULL_WIDTH_ANALYSIS_RENDERERS = new Set([
  "cctyper_genemap", "mapping_depth", "gtdbtk_taxonomy", "dbcan_composition",
  "prokka_features", "hadeg_network", "gunc_sankey", "meta_amr",
  "nanostat_qc", "fastp_quality", "fastp_content",
  "coverm_abundance", "metaphlan_species", "bracken_sunburst",
]);

function expandLegacyAnalysisCard(card) {
  const views = LEGACY_RENDERER_VIEWS[card?.renderer];
  if (!views || card?.type !== "plotly") return [card];
  return views
    .filter(([renderer]) => !renderer.startsWith("metaphlan_") || renderer === "metaphlan_species" || (card?.payload?.genus_metrics && card?.payload?.genus_rank_abundance))
    .map(([renderer, title], index) => ({ ...card, id: `${card.id}:${renderer}`, renderer, title, derivedView: true, viewOrder: index }));
}
function deduplicateAnalysisCards(cards = []) {
  const explicitRenderers = new Set(
    cards.filter((card) => card.type === "plotly" && !card.derivedView).map((card) => card.renderer)
  );
  const seen = new Set();
  return cards.filter((card) => {
    if (card.derivedView && explicitRenderers.has(card.renderer)) return false;
    const key = `${card.type}:${card.renderer || ""}:${card.path || card.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function analysisDashboardGroup(card) {
  if (card?.id === "gtdbtk_krona") return "taxonomy-ecology";
  if (card?.type !== "plotly") return "full-reports";
  if (UPDATED_DASHBOARD_GROUP[card.renderer]) return UPDATED_DASHBOARD_GROUP[card.renderer];
  return ANALYSIS_DASHBOARD_GROUPS.find((group) => group.renderers.includes(card?.renderer))?.id || "functional-annotation";
}

function groupAnalysisCards(cards = []) {
  return ANALYSIS_DASHBOARD_GROUPS.map((group) => ({
    ...group,
    cards: cards.filter((card) => analysisDashboardGroup(card) === group.id),
  })).filter((group) => group.cards.length > 0);
}

function AnalysisDashboardCard({ card, index = 0, expanded, forceFullWidth = false, onToggleExpanded, isDark, plotStyle, publicationPalette }) {
  const fullWidth = forceFullWidth || expanded || card.type !== "plotly" || FULL_WIDTH_ANALYSIS_RENDERERS.has(card.renderer) || UPDATED_DASHBOARD_RENDERERS.has(card.renderer);
  const publicationMode = plotStyle === "publication";
  const shellClass = isDark
    ? "border-slate-700 bg-slate-900 shadow-[0_18px_50px_-38px_rgba(0,0,0,0.8)]"
    : publicationMode
      ? "border-slate-200 bg-white shadow-[0_18px_50px_-38px_rgba(15,23,42,0.36)]"
      : "border-sky-100 bg-white shadow-[0_20px_55px_-40px_rgba(2,132,199,0.65)]";
  return (
    <_motion.article
      initial={{ opacity: 0, y: 18, scale: 0.992 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, amount: 0.08 }}
      transition={{ duration: 0.38, delay: Math.min(index % 2, 1) * 0.07, ease: "easeOut" }}
      className={`${fullWidth ? "2xl:col-span-2" : "2xl:col-span-1"} min-w-0 self-start overflow-hidden rounded-[20px] border ${shellClass}`}
      data-analysis-renderer={card.renderer || card.type}
    >
      <div className={`flex min-w-0 items-start justify-between gap-3 border-b px-4 py-3.5 sm:px-5 ${isDark ? "border-slate-800 bg-slate-900" : publicationMode ? "border-slate-100 bg-slate-50/55" : "border-sky-100/80 bg-gradient-to-r from-sky-50/65 via-white to-white"}`}>
        <div className="min-w-0">
          <h3 className={`text-[15px] font-bold tracking-tight ${isDark ? "text-slate-100" : "text-slate-950"}`}>{card.title}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {card.type === "plotly" && !UPDATED_DASHBOARD_RENDERERS.has(card.renderer) && (
            <button type="button" onClick={onToggleExpanded} className={`${isDark ? "border-slate-700 bg-slate-800 text-slate-300 hover:text-white" : publicationMode ? "border-slate-200 bg-white text-slate-500 hover:text-sky-800" : "border-sky-100 bg-white text-slate-500 hover:border-sky-300 hover:text-sky-700"} inline-flex h-8 w-8 items-center justify-center rounded-lg border shadow-sm transition`} aria-label={expanded ? `Restore ${card.title}` : `Expand ${card.title}`} aria-pressed={expanded}>
              {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          )}
          {card.type !== "plotly" && (
            <a href={card.url} target="_blank" rel="noreferrer" className={`${isDark ? "border-slate-700 bg-slate-800 text-slate-300 hover:text-white" : "border-slate-200 bg-white text-slate-500 hover:text-sky-800"} inline-flex h-8 items-center rounded-lg border px-2.5 text-[10px] font-semibold shadow-sm transition`}>
              Open report
            </a>
          )}
        </div>
      </div>
      <div className="min-w-0 p-3 sm:p-4">
        {card.type === "html" && card.srcDoc && (
          <iframe title={card.title} srcDoc={card.srcDoc} className="h-[720px] w-full rounded-xl border border-slate-200 bg-white shadow-inner" sandbox="allow-scripts" referrerPolicy="no-referrer" />
        )}
        {card.type === "html" && !card.srcDoc && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{card.error || "Could not render this HTML report."}</div>
        )}
        {card.type === "image" && (
          <a href={card.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
            <img src={card.url} alt={card.title} className="h-[520px] w-full bg-white object-contain" loading="lazy" />
          </a>
        )}
        {card.type === "plotly" && card.payload && !card.error && UPDATED_DASHBOARD_RENDERERS.has(card.renderer) && <UpdatedDashboard renderer={card.renderer} payload={card.payload} assetUrl={card.assetUrl} plotStyle={plotStyle} publicationPalette={publicationPalette} />}
        {card.type === "plotly" && card.payload && !card.error && !UPDATED_DASHBOARD_RENDERERS.has(card.renderer) && <AnalysisPlot renderer={card.renderer} payload={card.payload} expanded={expanded} plotStyle={plotStyle} publicationPalette={publicationPalette} showMetrics={!card.derivedView || card.viewOrder === 0} />}
        {card.type === "plotly" && (!card.payload || card.error) && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{card.error || "Could not load this interactive plot."}</div>
        )}
        {card.type !== "image" && card.type !== "html" && card.type !== "plotly" && (
          <div className="text-sm text-slate-500">This output is available through the report link above.</div>
        )}
      </div>
    </_motion.article>
  );
}

function AnalysisJobHeader({
  analysisIndex,
  analysisInterpretation,
  analysisInterpretationBusy,
  analysisCards,
  analysisCardsBusy,
  dashboardGroups,
  genomeMapCount,
  interactivePlotCount,
  jobId,
  isDark,
  loading,
  plotStyle,
  publicationPalette,
  renderGenomeMaps,
  submittedBy,
}) {
  return (
    <_motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: "easeOut" }}
      className={`overflow-visible rounded-[24px] border px-5 py-5 shadow-sm sm:px-6 ${isDark ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {analysisIndex?.analysis_type && <span className={`${isDark ? "bg-sky-950 text-sky-300" : "bg-sky-100 text-sky-800"} rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em]`}>{analysisIndex.analysis_type}</span>}
            {analysisIndex?.mode && <span className={`${isDark ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"} rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em]`}>{analysisIndex.mode} reads</span>}
            {analysisInterpretation?.is_demo && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-amber-800">Synthetic demo</span>}
          </div>
          <h2 className="truncate text-2xl font-bold tracking-tight">{analysisIndex?.sample || "Analysis results"}</h2>
          <p className={`mt-1 truncate font-mono text-[10px] ${isDark ? "text-slate-500" : "text-slate-400"}`}>Job {jobId}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className={`${isDark ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-50"} rounded-xl border px-3 py-2 text-center`}>
            <div className={`font-mono text-lg font-bold ${isDark ? "text-white" : "text-slate-900"}`}>{loading ? "—" : interactivePlotCount}</div>
            <div className={`${isDark ? "text-slate-500" : "text-slate-400"} text-[9px] uppercase tracking-wider`}>Plots</div>
          </div>
          <div className={`${isDark ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-50"} rounded-xl border px-3 py-2 text-center`}>
            <div className={`font-mono text-lg font-bold ${isDark ? "text-white" : "text-slate-900"}`}>{loading ? "—" : dashboardGroups.length}</div>
            <div className={`${isDark ? "text-slate-500" : "text-slate-400"} text-[9px] uppercase tracking-wider`}>Sections</div>
          </div>
          <AnalysisReportExport
            jobId={jobId}
            analysisIndex={analysisIndex}
            analysisCards={analysisCards}
            analysisInterpretation={analysisInterpretation}
            dashboardGroups={dashboardGroups}
            genomeMapCount={genomeMapCount}
            isDark={isDark}
            disabled={loading || analysisCardsBusy || analysisInterpretationBusy}
            plotStyle={plotStyle}
            publicationPalette={publicationPalette}
            renderGenomeMaps={renderGenomeMaps}
            submittedBy={submittedBy}
          />
        </div>
      </div>
    </_motion.div>
  );
}

function AnalysisInterpretationPanel({ result, busy, error, isDark, onRetry }) {
  const summary = result?.summary;
  const revealEvidence = (evidence) => {
    const renderer = String(evidence?.renderer || "").trim();
    if (!renderer) return;
    const escaped = window.CSS?.escape ? window.CSS.escape(renderer) : renderer.replace(/[^a-zA-Z0-9_-]/g, "");
    const target = document.querySelector(`[data-analysis-renderer="${escaped}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.animate?.(
      [
        { boxShadow: "0 0 0 0 rgba(14,165,233,0)" },
        { boxShadow: "0 0 0 5px rgba(14,165,233,0.28)" },
        { boxShadow: "0 0 0 0 rgba(14,165,233,0)" },
      ],
      { duration: 1400, easing: "ease-out" }
    );
  };

  if (busy) {
    return (
      <section
        className={`rounded-[22px] border p-4 sm:p-5 ${isDark ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-2.5">
          <span className={`h-4 w-4 animate-spin rounded-full border-2 ${isDark ? "border-slate-700 border-t-sky-400" : "border-slate-200 border-t-sky-600"}`} />
          <span className={`text-[13px] font-semibold ${isDark ? "text-slate-200" : "text-slate-800"}`}>Interpreting generated results…</span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3" aria-hidden="true">
          {[0, 1, 2].map((item) => (
            <div key={item} className={`animate-pulse rounded-xl p-3 ${isDark ? "bg-slate-800" : "bg-slate-50"}`}>
              <div className={`h-3 w-24 rounded ${isDark ? "bg-slate-700" : "bg-slate-200"}`} />
              <div className={`mt-3 h-12 rounded ${isDark ? "bg-slate-700/70" : "bg-slate-200/75"}`} />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (error || (result && (!result.grounded || !summary))) {
    return (
      <section className={`flex items-center justify-between gap-3 rounded-[22px] border px-4 py-3 sm:px-5 ${isDark ? "border-slate-700 bg-slate-900 text-slate-200" : "border-slate-200 bg-white text-slate-600"}`} role="status">
        <span className="text-[12px]">AI summary unavailable.</span>
        <button type="button" onClick={onRetry} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-sky-200 px-3 py-1.5 text-xs font-semibold text-sky-700 transition hover:bg-sky-50"><RotateCcw className="h-3 w-3" />Retry</button>
      </section>
    );
  }
  if (!result?.grounded || !summary) return null;
  const findings = Array.isArray(summary.key_findings) ? summary.key_findings : [];
  const limitations = Array.isArray(summary.limitations) ? summary.limitations : [];
  const actions = Array.isArray(summary.recommended_actions) ? summary.recommended_actions : [];

  return (
    <_motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`overflow-hidden rounded-[22px] border shadow-[0_18px_50px_-40px_rgba(15,23,42,0.45)] ${isDark ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}
    >
      <div className={`border-b px-4 py-4 sm:px-5 ${isDark ? "border-slate-700 bg-slate-800/60" : "border-slate-100 bg-slate-50/70"}`}>
        <h2 className="genocular-section-title">Results interpretation</h2>
        {summary.overview && <p className={`mt-2 max-w-5xl text-[12px] leading-5 ${isDark ? "text-slate-300" : "text-slate-600"}`}>{summary.overview}</p>}
      </div>

      {findings.length > 0 && (
        <div className="grid gap-3 p-4 md:grid-cols-2 sm:p-5">
          {findings.map((finding, index) => (
            <article key={`${finding.title}-${index}`} className={`rounded-xl border p-3.5 ${isDark ? "border-slate-700 bg-slate-800/55" : "border-slate-200 bg-slate-50/60"}`}>
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-[13px] font-bold">{finding.title}</h3>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase ${isDark ? "bg-slate-700 text-slate-300" : "bg-slate-200 text-slate-600"}`}>{finding.confidence}</span>
              </div>
              <p className={`mt-2 text-[11px] leading-5 ${isDark ? "text-slate-300" : "text-slate-600"}`}>{finding.interpretation}</p>
              {Array.isArray(finding.evidence) && finding.evidence.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {finding.evidence.map((evidence) => (
                    <button
                      key={evidence.id}
                      type="button"
                      onClick={() => revealEvidence(evidence)}
                      className={`max-w-full truncate rounded-full border px-2 py-1 text-[9px] font-semibold transition ${isDark ? "border-sky-800 bg-sky-950/60 text-sky-300 hover:bg-sky-900" : "border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100"}`}
                      title={`${evidence.title || "Result"}: ${evidence.label || evidence.id}`}
                    >
                      {evidence.title || evidence.label || "View evidence"}
                    </button>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {(limitations.length > 0 || actions.length > 0) && (
        <div className={`grid gap-4 border-t px-4 py-4 md:grid-cols-2 sm:px-5 ${isDark ? "border-slate-700" : "border-slate-100"}`}>
          {limitations.length > 0 && (
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-[0.12em]">Limitations</h3>
              <ul className={`mt-2 space-y-1.5 pl-4 text-[11px] leading-5 ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                {limitations.map((item, index) => <li key={index} className="list-disc">{item}</li>)}
              </ul>
            </div>
          )}
          {actions.length > 0 && (
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-[0.12em]">Recommended checks</h3>
              <ul className={`mt-2 space-y-1.5 pl-4 text-[11px] leading-5 ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                {actions.map((item, index) => <li key={index} className="list-disc">{item}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
      <div className={`border-t px-4 py-3 text-[10px] leading-4 sm:px-5 ${isDark ? "border-slate-700 bg-slate-950/40 text-slate-400" : "border-slate-100 bg-slate-50/50 text-slate-500"}`}>
        Generated result interpretation is not diagnostic or experimental validation. Open the linked plots and source tables before reporting conclusions.
      </div>
    </_motion.section>
  );
}

function isSafeAnalysisPath(value = "") {
  const path = String(value || "").trim();
  return Boolean(path) && !path.startsWith("/") && !path.split("/").includes("..") && !/[\\\0]/.test(path);
}

async function fetchBoundedJson(url, maxBytes = MAX_ANALYSIS_JSON_BYTES) {
  const text = await fetchBoundedText(url, maxBytes, "Analysis JSON");
  const payload = JSON.parse(text);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Analysis JSON must contain an object.");
  return payload;
}

async function fetchBoundedText(url, maxBytes, label = "File", signal) {
  const parsedUrl = new URL(url, window.location.origin);
  if (!new Set(["http:", "https:"]).has(parsedUrl.protocol)) throw new Error(`Blocked non-HTTP ${label.toLowerCase()} URL.`);
  const response = await fetch(parsedUrl.toString(), { credentials: "include", signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > maxBytes) throw new Error(`${label} exceeds the allowed size.`);
  const reader = response.body?.getReader();
  if (!reader) {
    const fallback = await response.arrayBuffer();
    if (fallback.byteLength > maxBytes) throw new Error(`${label} exceeds the allowed size.`);
    return new TextDecoder().decode(fallback);
  }
  const decoder = new TextDecoder();
  const chunks = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        throw new Error(`${label} exceeds the allowed size.`);
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
  } finally {
    reader.releaseLock();
  }
  return chunks.join("");
}

function isRelativeAssetRef(ref = "") {
  const s = String(ref || "").trim();
  if (!s) return false;
  if (s.startsWith("#")) return false;
  if (/^(https?:)?\/\//i.test(s)) return false;
  if (/^(data|mailto|tel|javascript):/i.test(s)) return false;
  return true;
}

function rewriteReportHtmlWithSignedAssets(html, reportKey, items = []) {
  const prefix = reportKey.slice(0, reportKey.lastIndexOf("/") + 1);
  const urlByRel = new Map();
  for (const it of items) {
    const key = String(it?.key || "");
    if (!key.startsWith(prefix)) continue;
    const rel = key.slice(prefix.length);
    if (!rel) continue;
    const signed = it?.url || "";
    if (!signed) continue;
    urlByRel.set(rel, signed);
    urlByRel.set(rel.replace(/^\.\/+/, ""), signed);
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  doc.querySelectorAll("iframe,object,embed").forEach((node) => node.remove());
  const baseEl = doc.querySelector("base") || doc.createElement("base");
  // srcDoc pages resolve relative/hash URLs against the parent page unless base is set.
  baseEl.setAttribute("href", "about:srcdoc");
  baseEl.setAttribute("target", "_self");
  if (!doc.querySelector("base") && doc.head) doc.head.prepend(baseEl);

  for (const n of doc.querySelectorAll("a[target], form[target], button[formtarget], input[formtarget], base[target]")) {
    if (n.hasAttribute("target")) n.setAttribute("target", "_self");
    if (n.hasAttribute("formtarget")) n.setAttribute("formtarget", "_self");
  }

  const attrs = ["href", "src", "poster", "data", "action", "formaction"];
  const allowedAssetUrls = new Set(urlByRel.values());
  for (const attr of attrs) {
    const nodes = doc.querySelectorAll(`[${attr}]`);
    for (const el of nodes) {
      const raw = el.getAttribute(attr) || "";
      if (attr === "href" && raw.startsWith("#")) {
        el.setAttribute(attr, `about:srcdoc${raw}`);
        continue;
      }
      if (!isRelativeAssetRef(raw)) {
        const allowedInline = /^(?:data:image\/|data:font\/|about:srcdoc)/i.test(raw);
        if (!allowedInline && !allowedAssetUrls.has(raw)) el.removeAttribute(attr);
        continue;
      }
      const relPath = new URL(raw, "http://local/").pathname.replace(/^\/+/, "");
      const signed = urlByRel.get(relPath) || urlByRel.get(relPath.replace(/^\.\/+/, ""));
      if (signed) {
        el.setAttribute(attr, signed);
      } else if (attr === "href" || attr === "action" || attr === "formaction") {
        // Avoid navigating to app routes from embedded reports.
        if (raw.startsWith("/")) {
          if (attr === "href") el.setAttribute(attr, "#");
          else el.removeAttribute(attr);
        }
      }
    }
  }

  const allowedOrigins = [...new Set([...allowedAssetUrls].map((value) => {
    try { return new URL(value).origin; } catch { return ""; }
  }).filter(Boolean))].join(" ");
  const csp = doc.createElement("meta");
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.setAttribute("content", [
    "default-src 'none'",
    `img-src data: blob: ${allowedOrigins}`,
    `style-src 'unsafe-inline' ${allowedOrigins}`,
    `script-src 'unsafe-inline' ${allowedOrigins}`,
    `font-src data: ${allowedOrigins}`,
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; "));
  if (doc.head) doc.head.prepend(csp);

  if (doc.head && needsReportCookieFallback(reportKey)) {
    const compatibility = doc.createElement("script");
    compatibility.textContent = REPORT_COOKIE_FALLBACK;
    const firstScript = doc.head.querySelector("script");
    if (firstScript) doc.head.insertBefore(compatibility, firstScript);
    else doc.head.appendChild(compatibility);
  }

  // Guard against form/link-driven navigation to app routes from embedded reports.
  const guard = doc.createElement("script");
  guard.textContent = `
    (function() {
      function isBlockedLocalPath(v) {
        var s = String(v || "").trim();
        if (!s) return true;
        return s.startsWith("/");
      }
      document.addEventListener("submit", function(ev) {
        var form = ev.target;
        if (!form || !form.getAttribute) return;
        var action = form.getAttribute("action");
        if (isBlockedLocalPath(action)) ev.preventDefault();
      }, true);
      document.addEventListener("click", function(ev) {
        var el = ev.target;
        if (!el || !el.closest) return;
        var a = el.closest("a[href]");
        if (!a) return;
        var href = a.getAttribute("href");
        if (isBlockedLocalPath(href)) ev.preventDefault();
      }, true);
    })();
  `;
  if (doc.body) doc.body.appendChild(guard);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

export default function GenomeViewer() {
  const { isDark } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const jobIdFromQuery = String(searchParams.get("job_id") || "").trim();
  const isAnalyzeLaunch = Boolean(jobIdFromQuery);
  const normalizedPathname = location.pathname.replace(/\/+$/, "") || "/";
  const isAnalysisRoute = normalizedPathname === "/analysis";
  const analysisRequestKey = isAnalyzeLaunch
    ? `${location.key || "default"}:${location.hash}:${jobIdFromQuery}`
    : "";
  const fileInputRef   = useRef(null);
  const jsonInputRef   = useRef(null);
  const jobRecoveryInputRef = useRef(null);
  const surfaceRef     = useRef(null);
  const viewerRef      = useRef(null);
  const CGViewRef      = useRef(null);
  const CGParseRef     = useRef(null);
  const lastJSONRef    = useRef(null);    // current map JSON (if any)
  const loadedViewerJSONRef = useRef(null);
  const lastViewerSizeRef = useRef({ width: 0, height: 0 });
  const originalTextRef= useRef("");      // original GenBank text for rebuilds
  const viewerIdRef    = useRef(`cgv-${Math.random().toString(36).slice(2)}`);

  const [ready, setReady]       = useState(false);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState(null);
  const [preloadNote, setPreloadNote] = useState("");
  const [controlsOpen, setControlsOpen] = useState(false);
  const [jobResultItems, setJobResultItems] = useState([]);
  const [crisprPlotItem, setCrisprPlotItem] = useState(null);
  const [antiSmashIndexItem, setAntiSmashIndexItem] = useState(null);
  const [antiSmashSrcDoc, setAntiSmashSrcDoc] = useState("");
  const [antiSmashBusy, setAntiSmashBusy] = useState(false);
  const [antiSmashError, setAntiSmashError] = useState("");
  const [nanoPlotIndexItem, setNanoPlotIndexItem] = useState(null);
  const [nanoPlotSrcDoc, setNanoPlotSrcDoc] = useState("");
  const [nanoPlotBusy, setNanoPlotBusy] = useState(false);
  const [nanoPlotError, setNanoPlotError] = useState("");
  const [analysisIndexItem, setAnalysisIndexItem] = useState(null);
  const [analysisIndex, setAnalysisIndex] = useState(null);
  const [analysisCards, setAnalysisCards] = useState([]);
  const [analysisCardsBusy, setAnalysisCardsBusy] = useState(false);
  const [analysisBootstrapBusy, setAnalysisBootstrapBusy] = useState(Boolean(jobIdFromQuery));
  const [analysisResolvedRequestKey, setAnalysisResolvedRequestKey] = useState("");
  const [analysisCardsError, setAnalysisCardsError] = useState("");
  const [analysisInterpretation, setAnalysisInterpretation] = useState(null);
  const [analysisInterpretationBusy, setAnalysisInterpretationBusy] = useState(false);
  const [analysisInterpretationError, setAnalysisInterpretationError] = useState("");
  const [analysisSummaryRetry, setAnalysisSummaryRetry] = useState(0);
  const [analysisSearch, setAnalysisSearch] = useState("");
  const [analysisPlotStyle, setAnalysisPlotStyle] = usePersistentState("analysis:plotStyle", "modern");
  const [analysisPublicationPalette, setAnalysisPublicationPalette] = usePersistentState("analysis:publicationPalette", "okabe_ito");
  const [expandedAnalysisCard, setExpandedAnalysisCard] = useState("");
  const [collapsedAnalysisGroups, setCollapsedAnalysisGroups] = useState({});
  const [selectedGenomeKey, setSelectedGenomeKey] = useState("");
  const [standaloneGenomeStarted, setStandaloneGenomeStarted] = useState(false);
  const [jobReference, setJobReference] = useState("");
  const [jobAccessError, setJobAccessError] = useState("");
  const [jobAccessBusy, setJobAccessBusy] = useState(false);
  const [jobRecoveryDragActive, setJobRecoveryDragActive] = useState(false);
  /*const [fileName, setFileName] = useState("");
  const [bpLength, setBpLength] = useState(null);
  const [ui, setUI]             = useState(DEFAULT_UI);*/
  const [fileName, setFileName] = usePersistentState("gv:fileName", "");
  const [bpLength, setBpLength] = usePersistentState("gv:bpLen", null);
  const [ui, setUI]             = usePersistentState("gv:ui", DEFAULT_UI);
  const [, setLastMapJSON] = useSessionState("gv:mapJSON", null);
  const lastAutoLoadedGenomeRef = useRef("");
  const genomeLoadControllerRef = useRef(null);
  const showAnalysisLanding = isAnalysisRoute && !isAnalyzeLaunch && !standaloneGenomeStarted;
  const showStandaloneViewer = !isAnalyzeLaunch && !showAnalysisLanding;

  useEffect(() => {
    if (isAnalysisRoute && !jobIdFromQuery) {
      setStandaloneGenomeStarted(false);
      setAnalysisResolvedRequestKey("");
    }
  }, [isAnalysisRoute, jobIdFromQuery]);

  const openAnalysisFromCredential = useCallback(async (input) => {
    setJobAccessError("");
    let credential;
    try {
      credential = jobAccessFromInput(input);
    } catch (accessError) {
      setJobAccessError(accessError?.message || "This private job reference is not valid.");
      return false;
    }

    setJobAccessBusy(true);
    try {
      await apiJson(`/jobs/${encodeURIComponent(credential.jobId)}/access`, {
        jobAccessKey: credential.accessKey,
      });
      registerJobAccessKey(credential.jobId, credential.accessKey);
      navigate(privateJobPath(credential.jobId, credential.accessKey, "/analysis"));
      return true;
    } catch (accessError) {
      const unavailable = accessError?.status === 403 || accessError?.status === 404;
      setJobAccessError(
        unavailable
          ? "This private job link is invalid, expired, or no longer available."
          : "The job could not be opened. Check your connection and try again."
      );
      return false;
    } finally {
      setJobAccessBusy(false);
    }
  }, [navigate]);

  const handleJobReferenceSubmit = useCallback((event) => {
    event.preventDefault();
    openAnalysisFromCredential(jobReference);
  }, [jobReference, openAnalysisFromCredential]);

  const loadJobRecoveryFile = useCallback(async (file) => {
    setJobAccessError("");
    if (!file) return;
    if (file.size > 1024 * 1024) {
      setJobAccessError("The recovery file is too large. Select the JSON file downloaded from this job.");
      return;
    }
    try {
      await openAnalysisFromCredential(await file.text());
    } catch {
      setJobAccessError("The recovery file could not be read.");
    }
  }, [openAnalysisFromCredential]);

  const handleJobRecoveryInput = useCallback((event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    loadJobRecoveryFile(file);
  }, [loadJobRecoveryFile]);

  

  /* ---------- Load libs ---------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [CGView, CGParse] = await Promise.all([import("cgview"), import("cgparse")]);
        if (cancelled) return;
        CGViewRef.current  = CGView;
        CGParseRef.current = CGParse;
        setReady(true);
      } catch (e) {
        setError(`Failed to initialize viewer: ${e?.message || e}`);
      }
    })();
    return () => { cancelled = true; try { viewerRef.current?.reset?.(); } catch { /* Viewer cleanup is best-effort. */ } };
  }, []);

  /* ---------- Keep the canvas size independent of page scroll and map zoom ---------- */
  const sizeSurfaceToViewport = useCallback(() => {
    if (!surfaceRef.current) return;
    surfaceRef.current.style.height = `${Math.max(360, Math.min(720, Math.floor(window.innerHeight * 0.72)))}px`;
  }, []);

  /* ---------- Create/resize/draw viewer (only when JSON exists) ---------- */
  const ensureViewer = useCallback(() => {
    if (!ready || !surfaceRef.current || !CGViewRef.current) return;
    const mountSel = `#${viewerIdRef.current}`;

    if (!lastJSONRef.current) {
      if (viewerRef.current) { try { viewerRef.current.reset?.(); } catch { /* Viewer reset is best-effort. */ } viewerRef.current = null; }
      loadedViewerJSONRef.current = null;
      lastViewerSizeRef.current = { width: 0, height: 0 };
      const mount = document.querySelector(mountSel);
      if (mount) mount.innerHTML = "";
      return;
    }

    const rect = surfaceRef.current.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));

    const sizeChanged = Math.abs(lastViewerSizeRef.current.width - width) > 1 || Math.abs(lastViewerSizeRef.current.height - height) > 1;
    let created = false;
    if (!viewerRef.current) {
      viewerRef.current = new CGViewRef.current.Viewer(mountSel, { width, height });
      created = true;
    } else if (sizeChanged && typeof viewerRef.current.resize === "function") {
      viewerRef.current.resize(width, height);
    }
    lastViewerSizeRef.current = { width, height };
    if (created || loadedViewerJSONRef.current !== lastJSONRef.current) {
      viewerRef.current.io.loadJSON(lastJSONRef.current);
      loadedViewerJSONRef.current = lastJSONRef.current;
      viewerRef.current.draw();
    } else if (sizeChanged) {
      viewerRef.current.draw();
    }
  }, [ready]);

  const clearAnalysisArtifacts = useCallback(() => {
    setJobResultItems([]);
    setCrisprPlotItem(null);
    setAntiSmashIndexItem(null);
    setAntiSmashSrcDoc("");
    setAntiSmashError("");
    setNanoPlotIndexItem(null);
    setNanoPlotSrcDoc("");
    setNanoPlotError("");
    setAnalysisIndexItem(null);
    setAnalysisIndex(null);
    setAnalysisCards([]);
    setAnalysisCardsBusy(false);
    setAnalysisCardsError("");
    setAnalysisInterpretation(null);
    setAnalysisInterpretationBusy(false);
    setAnalysisInterpretationError("");
    setAnalysisSearch("");
    setExpandedAnalysisCard("");
    setCollapsedAnalysisGroups({});
    setControlsOpen(false);
    setSelectedGenomeKey("");
  }, []);

  const clearRenderedGenome = useCallback(() => {
    lastJSONRef.current = null;
    originalTextRef.current = "";
    setFileName("");
    setBpLength(null);
    setLastMapJSON(null);
    if (viewerRef.current) {
      try { viewerRef.current.reset?.(); } catch { /* Viewer reset is best-effort. */ }
      viewerRef.current = null;
    }
    loadedViewerJSONRef.current = null;
    lastViewerSizeRef.current = { width: 0, height: 0 };
    const mount = document.getElementById(viewerIdRef.current);
    if (mount) mount.innerHTML = "";
  }, [setBpLength, setFileName, setLastMapJSON]);

  useEffect(() => {
    if (!ready) return;
    sizeSurfaceToViewport();
    const frame = window.requestAnimationFrame(ensureViewer);
    const onResize = () => {
      sizeSurfaceToViewport();
      window.requestAnimationFrame(ensureViewer);
    };
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(() => window.requestAnimationFrame(ensureViewer));
    if (surfaceRef.current) ro.observe(surfaceRef.current);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("resize", onResize); ro.disconnect(); };
  }, [ready, sizeSurfaceToViewport, ensureViewer]);

  useEffect(() => {
    lastAutoLoadedGenomeRef.current = "";
    genomeLoadControllerRef.current?.abort();
    genomeLoadControllerRef.current = null;
    setBusy(false);
    clearAnalysisArtifacts();
    if (isAnalyzeLaunch) {
      clearRenderedGenome();
      setPreloadNote("");
    }
  }, [isAnalyzeLaunch, clearAnalysisArtifacts, clearRenderedGenome]);

  useEffect(() => {
    if (!controlsOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setControlsOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [controlsOpen]);

  /* ---------- Live styling (no rebuild) ---------- */
  const applyLiveStyling = useCallback((nextUI) => {
    const v = viewerRef.current;
    const s = nextUI || ui;
    if (!v || !lastJSONRef.current) return;

    const isDark = s.theme === "dark";
    // Settings (+ format) and background
    v.settings.update({
      backgroundColor: isDark ? "#0b0f19" : "#fbfdff",
      format: s.format,                      // instant circular/linear switch
    });
    // Legend visibility & style
    v.legend.update({
      position: s.legendPos,
      defaultFont: "Arial,plain,12",
      defaultFontColor: isDark ? "#e5e7eb" : "#111827",
      backgroundColor: isDark ? "rgba(15,23,42,0.90)" : "rgba(255,255,255,0.94)",
    });
    // Ruler color for dark/light
    try { v.ruler.update({ font: "Arial,plain,11", color: isDark ? "#cbd5e1" : "#475569" }); } catch { /* Older CGView releases may not expose ruler.update. */ }
    // Labels on/off (annotation)
    try {
      v.annotation.update({
        visible: s.showLabels,
        font: "Arial,plain,11",
        fontColor: isDark ? "#e2e8f0" : "#334155",
      });
    } catch { /* Older CGView releases may not expose annotation.update. */ }
    v.draw();
  }, [ui]);

  /* ---------- Rebuild from original GenBank text ---------- */
  const rebuildFromUI = useCallback(() => {
    if (!originalTextRef.current || !CGParseRef.current) return;
    try {
      const seq = new CGParseRef.current.SequenceFile(originalTextRef.current);
      const json = seq.toCGViewJSON({
        config: buildConfig(ui),
        excludeFeatures: excludedGenomeFeatures(ui),
        excludeQualifiers: ["translation"],
      });
      lastJSONRef.current = json;
      setBpLength(cgviewSequenceLength(json));
      ensureViewer();
      // Apply live tweaks again (legend/ruler/theme might need reinforcing)
      applyLiveStyling();
    } catch (e) {
      setError(`Failed to rebuild: ${e?.message || e}`);
    }
  }, [ui, ensureViewer, applyLiveStyling, setBpLength]);

  /* ---------- Loaders ---------- */
  const loadGenbankText = useCallback(async (text, name = "") => {
    if (!ready || !CGParseRef.current) return;
    setBusy(true); setError(null);
    try {
      originalTextRef.current = text;
      const seq = new CGParseRef.current.SequenceFile(text);
      const json = seq.toCGViewJSON({
        config: buildConfig(ui),
        excludeFeatures: excludedGenomeFeatures(ui),
        excludeQualifiers: ["translation"],
      });
      lastJSONRef.current = json;
      sizeSurfaceToViewport();
      ensureViewer();
      // Apply live styling right after first draw
      applyLiveStyling();
      setFileName(name || "");
      setBpLength(cgviewSequenceLength(json));
      return true;
    } catch (e) {
      setError(`Failed to parse GenBank: ${e?.message || e}`);
      lastJSONRef.current = null; setFileName(""); setBpLength(null); ensureViewer();
      return false;
    } finally { setBusy(false); }
  }, [ready, ui, sizeSurfaceToViewport, ensureViewer, applyLiveStyling, setFileName, setBpLength]);

  const loadCGViewJSON = async (file) => {
    setBusy(true); setError(null);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      lastJSONRef.current = json;
      originalTextRef.current = ""; // unknown
      setFileName(file.name || "map.json");
      setBpLength(cgviewSequenceLength(json));
      sizeSurfaceToViewport(); ensureViewer();
      applyLiveStyling();
    } catch (e) {
      setError(`Invalid CGView JSON: ${e?.message || e}`);
    } finally { setBusy(false); }
  };

  /* ---------- Auto preload from job results ---------- */
  useEffect(() => {
    if (!jobIdFromQuery) return;
    let cancelled = false;
    const resultsController = new AbortController();
    genomeLoadControllerRef.current?.abort();
    genomeLoadControllerRef.current = null;
    setBusy(false);
    lastAutoLoadedGenomeRef.current = "";
    (async () => {
      setAnalysisResolvedRequestKey("");
      setAnalysisBootstrapBusy(true);
      setPreloadNote(`Loading analysis results for job ${jobIdFromQuery}...`);
      setError((current) => String(current || "").startsWith("Failed to initialize viewer:") ? current : null);
      clearAnalysisArtifacts();
      clearRenderedGenome();
      try {
        const jobResultsPath = "/jobs/" + encodeURIComponent(jobIdFromQuery);
        let items = [];
        try {
          const quick = await apiJson(jobResultsPath + "/analysis/assets", { signal: resultsController.signal });
          items = Array.isArray(quick?.items) ? quick.items : [];
          const index = findAnalysisIndex(items);
          if (index?.url) {
            const preview = await fetchBoundedJson(index.url, 1024 * 1024);
            if (String(preview?.analysis_type || "").toLowerCase() !== "metagenomics") items = [];
          } else {
            items = [];
          }
        } catch (quickError) {
          if (quickError?.name === "AbortError") throw quickError;
          items = [];
        }
        if (!items.length) {
          const full = await apiJson(jobResultsPath + "/results", { signal: resultsController.signal });
          items = Array.isArray(full?.items) ? full.items : [];
        }
        if (!cancelled) {
          setJobResultItems(items);
          setCrisprPlotItem(findCrisprPlot(items));
          setAntiSmashIndexItem(findAntiSmashIndex(items));
          setNanoPlotIndexItem(findNanoPlotIndex(items));
          setAnalysisIndexItem(findAnalysisIndex(items));
        }
        const target = findGenomeGbkItems(items)[0] || findAssemblyGbk(items);
        if (target?.key && !cancelled) setSelectedGenomeKey(target.key);
        if (!cancelled) {
          setPreloadNote(`Loaded analysis outputs for job ${jobIdFromQuery}.`);
        }
      } catch (e) {
        if (!cancelled) {
          clearRenderedGenome();
          setPreloadNote("");
          setError(`Could not load results for job ${jobIdFromQuery}: ${e?.message || e}`);
        }
      } finally {
        if (!cancelled) {
          setAnalysisResolvedRequestKey(analysisRequestKey);
          setAnalysisBootstrapBusy(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      resultsController.abort();
    };
  }, [jobIdFromQuery, analysisRequestKey, clearAnalysisArtifacts, clearRenderedGenome]);

  useEffect(() => {
    if (!isAnalyzeLaunch) return;
    if (analysisIndexItem) return;
    if (!antiSmashIndexItem?.url || !antiSmashIndexItem?.key) {
      setAntiSmashSrcDoc("");
      setAntiSmashError("");
      return;
    }

    let cancelled = false;
    (async () => {
      setAntiSmashBusy(true);
      setAntiSmashError("");
      try {
        const resp = await fetch(antiSmashIndexItem.url, { credentials: "include" });
        if (!resp.ok) throw new Error(`Failed to load antiSMASH report (HTTP ${resp.status}).`);
        const html = await resp.text();
        if (cancelled) return;

        setAntiSmashSrcDoc(
          rewriteReportHtmlWithSignedAssets(html, antiSmashIndexItem.key, jobResultItems)
        );
      } catch (e) {
        if (!cancelled) {
          setAntiSmashSrcDoc("");
          setAntiSmashError(e?.message || String(e));
        }
      } finally {
        if (!cancelled) setAntiSmashBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAnalyzeLaunch, analysisIndexItem, antiSmashIndexItem, jobResultItems]);

  useEffect(() => {
    if (!isAnalyzeLaunch) return;
    if (analysisIndexItem) return;
    if (!nanoPlotIndexItem?.url || !nanoPlotIndexItem?.key) {
      setNanoPlotSrcDoc("");
      setNanoPlotError("");
      return;
    }

    let cancelled = false;
    (async () => {
      setNanoPlotBusy(true);
      setNanoPlotError("");
      try {
        const resp = await fetch(nanoPlotIndexItem.url, { credentials: "include" });
        if (!resp.ok) throw new Error(`Failed to load NanoPlot report (HTTP ${resp.status}).`);
        const html = await resp.text();
        if (cancelled) return;
        setNanoPlotSrcDoc(
          rewriteReportHtmlWithSignedAssets(html, nanoPlotIndexItem.key, jobResultItems)
        );
      } catch (e) {
        if (!cancelled) {
          setNanoPlotSrcDoc("");
          setNanoPlotError(e?.message || String(e));
        }
      } finally {
        if (!cancelled) setNanoPlotBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAnalyzeLaunch, analysisIndexItem, nanoPlotIndexItem, jobResultItems]);

  useEffect(() => {
    if (!isAnalyzeLaunch) return;
    if (!analysisIndexItem?.url) {
      setAnalysisCards([]);
      setAnalysisCardsBusy(false);
      setAnalysisCardsError("");
      return;
    }

    let cancelled = false;
    const bySuffix = (relPath) => {
      const needle = `/${String(relPath || "").replace(/^\/+/, "")}`;
      return (
        jobResultItems.find((it) => String(it?.key || "").endsWith(needle)) ||
        jobResultItems.find((it) => String(it?.key || "") === String(relPath || ""))
      );
    };

    (async () => {
      setAnalysisCardsBusy(true);
      setAnalysisCardsError("");
      try {
        const idx = await fetchBoundedJson(analysisIndexItem.url, 1024 * 1024);
        if (cancelled) return;
        const originalSections = Array.isArray(idx?.sections) ? idx.sections : [];
        if (originalSections.length > 64) throw new Error("Analysis manifest contains too many sections.");
        const sections = originalSections.filter((section) => !isRedundantAnalysisSection(section));
        setAnalysisIndex({ ...idx, sections });
        const plotPayloadByKey = new Map();
        const cardGroups = await Promise.all(sections.map(async (sec) => {
          const relPath = String(sec?.path || "").trim();
          const sectionType = String(sec?.type || "file").toLowerCase();
          const renderer = String(sec?.renderer || sec?.id || "");
          if (!isSafeAnalysisPath(relPath)) throw new Error(`Unsafe analysis asset path: ${relPath || "<empty>"}`);
          if (!ALLOWED_ANALYSIS_SECTION_TYPES.has(sectionType)) throw new Error(`Unsupported analysis section type: ${sectionType}`);
          if (sectionType === "plotly" && !ALLOWED_ANALYSIS_RENDERERS.has(renderer)) throw new Error(`Unsupported analysis renderer: ${renderer}`);
          const item = bySuffix(relPath);
          if (!item?.url || !item?.key) return [];

          const card = {
            id: String(sec?.id || relPath),
            title: String(sec?.title || relPath.split("/").pop() || "Analysis"),
            type: sectionType,
            source: String(sec?.source || ""),
            path: relPath,
            url: item.url,
            key: item.key,
            assetUrl: isSafeAnalysisPath(String(sec?.asset_path || "")) ? bySuffix(sec.asset_path)?.url || "" : "",
            assetPath: isSafeAnalysisPath(String(sec?.asset_path || "")) ? String(sec.asset_path) : "",
            srcDoc: "",
            payload: null,
            renderer,
            dataRenderer: String(sec?.data_renderer || ""),
            error: "",
          };

          if (card.type === "html") {
            try {
              const html = await fetchBoundedText(item.url, MAX_ANALYSIS_JSON_BYTES, "Analysis HTML report");
              card.srcDoc = rewriteReportHtmlWithSignedAssets(html, item.key, jobResultItems);
              if (sec.data_path && isSafeAnalysisPath(sec.data_path)) {
                const dataItem = bySuffix(sec.data_path);
                if (dataItem?.url) card.payload = await fetchBoundedJson(dataItem.url);
              }
            } catch (e) {
              card.error = e?.message || String(e);
            }
          }

          if (card.type === "plotly") {
            try {
              let payloadPromise = plotPayloadByKey.get(item.key);
              if (!payloadPromise) {
                payloadPromise = fetchBoundedJson(item.url);
                plotPayloadByKey.set(item.key, payloadPromise);
              }
              card.payload = await payloadPromise;
              if (typeof card.payload?.sample_id !== "string") throw new Error("Plot JSON is missing its sample identifier.");
            } catch (e) {
              card.error = e?.message || String(e);
            }
          }

          return expandLegacyAnalysisCard(card);
        }));

        if (!cancelled) setAnalysisCards(deduplicateAnalysisCards(cardGroups.flat()));
      } catch (e) {
        if (!cancelled) {
          setAnalysisCards([]);
          setAnalysisCardsError(e?.message || String(e));
        }
      } finally {
        if (!cancelled) setAnalysisCardsBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAnalyzeLaunch, analysisIndexItem, jobResultItems]);

  useEffect(() => {
    if (!isAnalyzeLaunch || !jobIdFromQuery || !analysisIndex) return undefined;
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      setAnalysisInterpretationBusy(true);
      setAnalysisInterpretationError("");
      try {
        let response;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          response = await apiJson(
            `/jobs/${encodeURIComponent(jobIdFromQuery)}/analysis/summary${attempt || analysisSummaryRetry ? "?retry=true" : ""}`,
            { method: "POST", signal: controller.signal }
          );
          if (response?.grounded || !response?.evidence_count) break;
        }
        if (!cancelled) setAnalysisInterpretation(response);
      } catch (summaryError) {
        if (!cancelled && summaryError?.name !== "AbortError") {
          setAnalysisInterpretation(null);
          setAnalysisInterpretationError(summaryError?.message || String(summaryError));
        }
      } finally {
        if (!cancelled) setAnalysisInterpretationBusy(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isAnalyzeLaunch, jobIdFromQuery, analysisIndex, analysisSummaryRetry]);

  const loadGenomeResultItem = useCallback(async (key) => {
    const target = jobResultItems.find((item) => String(item?.key || "") === String(key || ""));
    if (!target?.url) return;
    genomeLoadControllerRef.current?.abort();
    const controller = new AbortController();
    genomeLoadControllerRef.current = controller;
    setBusy(true);
    setError(null);
    setPreloadNote(`Loading ${genomeItemLabel(target)}...`);
    try {
      const text = await fetchBoundedText(target.url, 256 * 1024 * 1024, "Genome file", controller.signal);
      if (genomeLoadControllerRef.current !== controller || controller.signal.aborted) return;
      const loaded = await loadGenbankText(text, target.key.split("/").pop() || "genome.gbk");
      if (genomeLoadControllerRef.current !== controller || controller.signal.aborted) return;
      if (!loaded) {
        setPreloadNote("");
        return;
      }
      setSelectedGenomeKey(target.key);
      setPreloadNote(`Loaded ${genomeItemLabel(target)}.`);
    } catch (loadError) {
      if (loadError?.name !== "AbortError" && genomeLoadControllerRef.current === controller) {
        setPreloadNote("");
        setError(`Could not load genome: ${loadError?.message || loadError}`);
      }
    } finally {
      if (genomeLoadControllerRef.current === controller) {
        genomeLoadControllerRef.current = null;
        setBusy(false);
      }
    }
  }, [jobResultItems, loadGenbankText]);

  useEffect(() => () => genomeLoadControllerRef.current?.abort(), []);

  useEffect(() => {
    if (!isAnalyzeLaunch || !ready || busy || lastJSONRef.current) return;
    const target = findGenomeGbkItems(jobResultItems)[0] || findAssemblyGbk(jobResultItems);
    if (!target?.key) return;
    const autoLoadToken = `${jobIdFromQuery}:${target.key}`;
    if (lastAutoLoadedGenomeRef.current === autoLoadToken) return;
    lastAutoLoadedGenomeRef.current = autoLoadToken;
    void loadGenomeResultItem(target.key);
  }, [isAnalyzeLaunch, ready, busy, jobResultItems, jobIdFromQuery, loadGenomeResultItem]);

  /* ---------- File helpers ---------- */
  const chooseFile  = () => {
    if (!ready) return;
    fileInputRef.current?.click();
  };
  const chooseJSON  = () => jsonInputRef.current?.click();
  const onFile      = async (f) => {
    if (!f) return;
    if (!ready || !CGParseRef.current) return;
    if (isAnalysisRoute && !isAnalyzeLaunch) setStandaloneGenomeStarted(true);
    setBusy(true);
    setError(null);
    try {
      const text = await f.text();
      await loadGenbankText(text, f.name);
    } catch (fileError) {
      setError(`Could not read genome file: ${fileError?.message || fileError}`);
      setBusy(false);
    }
  };
  const onFileInput = (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); };
  const onJSONInput = (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) loadCGViewJSON(f); };
  const onDrop      = (e) => {
    e.preventDefault();
    if (!ready) {
      setError("Genome viewer is still initializing. Please try again in a moment.");
      return;
    }
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    (/\.json$/i.test(f.name)) ? loadCGViewJSON(f) : onFile(f);
  };
  const onDragOver  = (e) => e.preventDefault();

  /* ---------- Controls ---------- */
  const clearAll  = () => {
    lastJSONRef.current = null; originalTextRef.current = "";
    try { viewerRef.current?.reset?.(); } catch { /* Viewer reset is best-effort. */ }
    viewerRef.current = null;
    const m = document.getElementById(viewerIdRef.current); if (m) m.innerHTML = "";
    setFileName(""); setBpLength(null); setError(null);
    setPreloadNote("");
    sizeSurfaceToViewport();
    if (isAnalysisRoute && !isAnalyzeLaunch) setStandaloneGenomeStarted(false);
  };
  const zoomIn    = () => { try { viewerRef.current?.zoomIn?.(1.6, { duration: 220 }); } catch { /* Ignore unsupported viewer actions. */ } };
  const zoomOut   = () => { try { viewerRef.current?.zoomOut?.(1.6, { duration: 220 }); } catch { /* Ignore unsupported viewer actions. */ } };
  const fitToView = () => { try { viewerRef.current?.reset?.(280); } catch { /* Ignore unsupported viewer actions. */ } };
  const exportPNG = () => {
    try {
      const H = 2600;
      const W = (viewerRef.current.width / viewerRef.current.height) * H;
      viewerRef.current.io.downloadImage(W, H, (fileName || "genome") + ".png");
    } catch { /* Image export errors are handled by CGView. */ }
  };
  const exportSVG = () => { try { viewerRef.current.io.downloadSVG((fileName || "genome") + ".svg"); } catch { /* SVG export errors are handled by CGView. */ } };
  const exportJSON = () => {
    try {
      const blob = new Blob([JSON.stringify(lastJSONRef.current, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = (fileName?.replace(/\.(gb|gbk|genbank)$/i,"") || "map") + ".cgview.json";
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch { /* JSON export is a best-effort browser download. */ }
  };

  /* ---------- UI change helpers ---------- */
  const setAndRebuild = (patch) => {
    // Use rebuild path only for things that need seq→JSON regeneration (tracks, filters, arrowLen...)
    setUI(prev => {
      const next = { ...prev, ...patch };
      setTimeout(() => { if (lastJSONRef.current && originalTextRef.current) rebuildFromUI(); else ensureViewer(); }, 0);
      return next;
    });
  };

  const setAndApplyLive = (patch) => {
    // For format, theme, legendPos, showLabels — avoid heavy rebuild
    setUI(prev => {
      const next = { ...prev, ...patch };
      setTimeout(() => applyLiveStyling(next), 0);
      return next;
    });
  };

  useEffect(() => {
    const nextTheme = isDark ? "dark" : "light";
    setUI(prev => {
      if (prev.theme === nextTheme) return prev;
      const next = { ...prev, theme: nextTheme };
      setTimeout(() => applyLiveStyling(next), 0);
      return next;
    });
  }, [isDark, setUI, applyLiveStyling]);

  /* =================== RENDER =================== */
  const hasMap = Boolean(lastJSONRef.current);
  const genomeGbkItems = useMemo(() => findGenomeGbkItems(jobResultItems), [jobResultItems]);
  const reportGenomeItems = useMemo(() => {
    if (genomeGbkItems.length) return genomeGbkItems;
    const fallback = findAssemblyGbk(jobResultItems);
    return fallback ? [fallback] : [];
  }, [genomeGbkItems, jobResultItems]);
  const assemblyGbkItem = genomeGbkItems.find((item) => item.key === selectedGenomeKey) || reportGenomeItems[0] || null;
  const analysisRequestResolved = isAnalyzeLaunch && analysisResolvedRequestKey === analysisRequestKey;
  const isMetagenomicsAnalysis =
    analysisRequestResolved && (
      String(analysisIndex?.analysis_type || "").toLowerCase() === "metagenomics" ||
      jobResultItems.some((item) => /\/MAG_shortread_results\//i.test(String(item?.key || "")))
    );
  const dashboardGroups = useMemo(() => groupAnalysisCards(analysisCards), [analysisCards]);
  const visibleDashboardGroups = useMemo(() => {
    const query = analysisSearch.trim().toLowerCase();
    if (!query) return dashboardGroups;
    return dashboardGroups
      .map((group) => ({
        ...group,
        cards: group.cards.filter((card) => [card.title, card.source, card.renderer, card.path].some((value) => String(value || "").toLowerCase().includes(query))),
      }))
      .filter((group) => group.cards.length);
  }, [analysisSearch, dashboardGroups]);
  const interactivePlotCount = analysisCards.filter((card) => card.type === "plotly").length;
  const showAnalysisLoading = isAnalyzeLaunch && (
    !analysisRequestResolved ||
    (!error && (
      analysisBootstrapBusy ||
      analysisCardsBusy ||
      (Boolean(analysisIndexItem) && !analysisIndex && !analysisCardsError)
    ))
  );
  const viewerVisible = !showAnalysisLanding && !(isAnalyzeLaunch && showAnalysisLoading);

  useEffect(() => {
    if (!ready || !viewerVisible) return undefined;
    let drawFrame = 0;
    const sizeFrame = window.requestAnimationFrame(() => {
      sizeSurfaceToViewport();
      drawFrame = window.requestAnimationFrame(ensureViewer);
    });
    return () => {
      window.cancelAnimationFrame(sizeFrame);
      if (drawFrame) window.cancelAnimationFrame(drawFrame);
    };
  }, [ready, viewerVisible, analysisInterpretationBusy, analysisInterpretation, analysisInterpretationError, sizeSurfaceToViewport, ensureViewer]);
  const renderGenomeMapsForReport = useCallback(async ({ signal, onProgress } = {}) => {
    if (!ready || !CGViewRef.current || !CGParseRef.current) {
      return { maps: [], warnings: ["Genome maps were unavailable because CGView was not ready."] };
    }

    const selectedItems = reportGenomeItems.slice(0, MAX_REPORT_GENOME_MAPS);
    const warnings = [];
    const maps = [];
    let totalInputBytes = 0;
    let totalImageBytes = 0;
    if (reportGenomeItems.length > selectedItems.length) {
      warnings.push(`${reportGenomeItems.length - selectedItems.length} genome maps exceeded the report safety limit and were not included.`);
    }

    for (const [index, item] of selectedItems.entries()) {
      throwIfReportCancelled(signal);
      const label = genomeItemLabel(item);
      onProgress?.({ current: index, total: selectedItems.length, label: `Rendering genome map ${index + 1} of ${selectedItems.length}: ${label}` });
      try {
        const remainingInputBytes = MAX_REPORT_GENBANK_TOTAL_BYTES - totalInputBytes;
        if (remainingInputBytes <= 0) {
          warnings.push("Remaining genome maps exceeded the combined report input limit and were not included.");
          break;
        }
        const map = await renderIsolatedGenomeMap({
          CGView: CGViewRef.current,
          CGParse: CGParseRef.current,
          item,
          maxInputBytes: remainingInputBytes,
          signal,
        });
        if (totalImageBytes + map.image.byteLength > MAX_REPORT_GENOME_PNG_BYTES) {
          warnings.push("Remaining genome maps exceeded the PDF image budget and were not included.");
          break;
        }
        totalInputBytes += map.inputBytes;
        totalImageBytes += map.image.byteLength;
        maps.push({ title: map.title, bpLength: map.bpLength, image: map.image });
      } catch (mapError) {
        if (mapError?.name === "AbortError") throw mapError;
        warnings.push(`${label}: ${mapError?.message || String(mapError)}`);
      }
      onProgress?.({ current: index + 1, total: selectedItems.length, label: `Rendered genome map ${Math.min(index + 1, selectedItems.length)} of ${selectedItems.length}` });
    }
    return { maps, warnings };
  }, [ready, reportGenomeItems]);
  const submittedBy = analysisInterpretation?.submitted_by || "Not recorded";

  return (
    <div className="genocular-analysis min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50 text-slate-900 antialiased">
      {/* Header */}
      <div
        className={
          `${isAnalyzeLaunch ? "" : "sticky top-0 z-30 backdrop-blur-xl"} border-b ${
            isDark ? "border-slate-800 bg-slate-950/95" : "border-slate-200/80 bg-white/95"
          }`
        }
      >
        <div className="flex w-full flex-col gap-4 px-4 py-8 sm:px-8 sm:flex-row sm:items-center sm:justify-between lg:px-14 xl:px-20">
          <div className="min-w-0">
              <h1 className={`genocular-page-title truncate ${isDark ? "!text-slate-100" : ""}`}>
                {showAnalysisLanding || (isAnalyzeLaunch && !analysisRequestResolved) ? "Analysis" : isMetagenomicsAnalysis ? "Metagenomics analysis" : "Genome analysis"}
              </h1>
              {showStandaloneViewer && (
                <p className={`genocular-page-subtitle truncate ${isDark ? "!text-slate-400" : ""}`}>
                  Load a GenBank or CGView JSON file to explore genome structure and composition.
                </p>
              )}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {showStandaloneViewer && (
              <>
                <button
                  type="button"
                  onClick={clearAll}
                  className={toolbarButtonClass}
                >
                  <RotateCcw className="h-4 w-4" />
                  Reset
                </button>
                <button
                  type="button"
                  onClick={chooseFile}
                  disabled={!ready || busy}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-slate-950 px-3.5 text-[13px] font-semibold text-white shadow-sm transition hover:-translate-y-px hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500/30 disabled:pointer-events-none disabled:opacity-45"
                >
                  <FileUp className="h-4 w-4" />
                  Upload Genome
                </button>
                <button
                  type="button"
                  onClick={chooseJSON}
                  className={toolbarButtonClass}
                >
                  <FileJsonIcon className="h-4 w-4" />
                  Open JSON
                </button>
              </>
            )}
            {showStandaloneViewer && (
              <button
                type="button"
                onClick={() => setControlsOpen(true)}
                className={`${toolbarButtonClass} border-sky-200 bg-sky-50 text-sky-800 hover:border-sky-300 hover:bg-sky-100 hover:text-sky-950`}
              >
                <SlidersHorizontal className="h-4 w-4" />
                Options
              </button>
            )}
            <input ref={fileInputRef} type="file" accept=".gb,.gbk,.genbank,.txt" className="hidden" onChange={onFileInput} />
            <input ref={jsonInputRef} type="file" accept=".json" className="hidden" onChange={onJSONInput} />
            <input ref={jobRecoveryInputRef} type="file" accept=".json,.txt,application/json,text/plain" className="hidden" onChange={handleJobRecoveryInput} />
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="w-full min-w-0 overflow-x-clip px-4 py-8 sm:px-8 lg:px-14 xl:px-20">
          <div className="flex min-w-0 flex-col gap-5">
            {showAnalysisLanding && (
              <section className="mx-auto w-full max-w-5xl space-y-5">
                <div className={`overflow-hidden rounded-[22px] border shadow-[0_20px_55px_-42px_rgba(15,23,42,0.45)] ${isDark ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
                  <div className={`border-b px-5 py-5 ${isDark ? "border-slate-800 bg-slate-900" : "border-slate-100 bg-slate-50/60"}`}>
                    <div className="flex min-w-0 items-center gap-3.5">
                      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${isDark ? "bg-sky-950 text-sky-300" : "bg-sky-100 text-sky-700"}`}>
                        <ShieldCheck className="h-5 w-5" />
                      </span>
                      <div>
                        <h2 className={`genocular-section-title ${isDark ? "!text-slate-100" : ""}`}>Open job analysis</h2>
                        <div className={`mt-1 text-[11px] font-medium ${isDark ? "text-slate-400" : "text-slate-500"}`}>Use a private job URL or recovery file.</div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4 p-4 sm:p-5">
                    <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
                      <form onSubmit={handleJobReferenceSubmit} className={`rounded-2xl border p-4 sm:p-5 ${isDark ? "border-slate-700 bg-slate-800/55" : "border-slate-200 bg-white"}`}>
                        <div className="flex items-start gap-3">
                          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${isDark ? "bg-slate-900 text-sky-300" : "bg-sky-50 text-sky-700"}`}><Link2 className="h-4 w-4" /></span>
                          <div>
                            <h3 className={`text-[13px] font-bold ${isDark ? "text-slate-100" : "text-slate-900"}`}>Private job URL</h3>
                          </div>
                        </div>
                        <label className="mt-4 block">
                          <span className="sr-only">Private job URL</span>
                          <input
                            type="text"
                            value={jobReference}
                            onChange={(event) => {
                              setJobReference(event.target.value);
                              setJobAccessError("");
                            }}
                            placeholder="https://…/run?job_id=…#access=…"
                            autoComplete="off"
                            spellCheck="false"
                            className={`h-11 w-full rounded-xl border px-3.5 font-mono text-[11px] outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 ${isDark ? "border-slate-700 bg-slate-950 text-slate-200 placeholder:text-slate-600" : "border-slate-200 bg-white text-slate-800 placeholder:text-slate-400"}`}
                          />
                        </label>
                        <button
                          type="submit"
                          disabled={jobAccessBusy || !jobReference.trim()}
                          className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-sky-700 px-4 text-[12px] font-bold text-white shadow-sm transition hover:-translate-y-px hover:bg-sky-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30 disabled:pointer-events-none disabled:opacity-45"
                        >
                          {jobAccessBusy ? "Checking access…" : "Open analysis"}
                          {!jobAccessBusy && <ArrowRight className="h-4 w-4" />}
                        </button>
                      </form>

                      <button
                        type="button"
                        disabled={jobAccessBusy}
                        onClick={() => jobRecoveryInputRef.current?.click()}
                        onDragEnter={(event) => { event.preventDefault(); setJobRecoveryDragActive(true); }}
                        onDragOver={(event) => { event.preventDefault(); setJobRecoveryDragActive(true); }}
                        onDragLeave={(event) => { event.preventDefault(); setJobRecoveryDragActive(false); }}
                        onDrop={(event) => {
                          event.preventDefault();
                          setJobRecoveryDragActive(false);
                          loadJobRecoveryFile(event.dataTransfer.files?.[0]);
                        }}
                        className={`group flex min-h-[170px] flex-col items-center justify-center rounded-2xl border border-dashed px-5 py-6 text-center transition focus:outline-none focus:ring-2 focus:ring-sky-500/30 disabled:pointer-events-none disabled:opacity-45 ${jobRecoveryDragActive ? "border-sky-400 bg-sky-50 ring-2 ring-sky-500/20" : isDark ? "border-slate-600 bg-slate-800/55 hover:border-sky-700 hover:bg-slate-800" : "border-slate-300 bg-slate-50/60 hover:border-sky-400 hover:bg-sky-50/60"}`}
                      >
                        <span className={`flex h-12 w-12 items-center justify-center rounded-2xl transition group-hover:-translate-y-0.5 ${isDark ? "bg-slate-900 text-cyan-300" : "bg-white text-cyan-700 shadow-sm ring-1 ring-slate-200"}`}><FileJsonIcon className="h-5 w-5" /></span>
                        <span className={`mt-3 text-[13px] font-bold ${isDark ? "text-slate-100" : "text-slate-900"}`}>{jobAccessBusy ? "Checking access…" : "Job recovery file"}</span>
                        <span className={`mt-1 text-[10px] ${isDark ? "text-slate-400" : "text-slate-500"}`}>JSON or legacy TXT</span>
                        <span className={`mt-3 rounded-lg border px-3 py-1.5 text-[10px] font-bold ${isDark ? "border-slate-700 bg-slate-900 text-sky-300" : "border-slate-200 bg-white text-sky-700"}`}>Choose file</span>
                      </button>
                    </div>

                    {jobAccessError && (
                      <div role="alert" aria-live="polite" className={`rounded-xl border px-4 py-3 text-[11px] font-medium ${isDark ? "border-rose-900 bg-rose-950/30 text-rose-200" : "border-rose-200 bg-rose-50 text-rose-700"}`}>{jobAccessError}</div>
                    )}

                  </div>
                </div>

                <div className="flex items-center gap-3" aria-hidden="true">
                  <span className={`h-px flex-1 ${isDark ? "bg-slate-800" : "bg-slate-200"}`} />
                  <span className={`text-[10px] font-bold uppercase tracking-[0.16em] ${isDark ? "text-slate-500" : "text-slate-400"}`}>or</span>
                  <span className={`h-px flex-1 ${isDark ? "bg-slate-800" : "bg-slate-200"}`} />
                </div>

                <div className={`flex flex-col items-start justify-between gap-4 rounded-[22px] border px-5 py-5 shadow-sm sm:flex-row sm:items-center ${isDark ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
                  <div className="flex min-w-0 items-center gap-3.5">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-600 to-cyan-500 text-white shadow-md shadow-sky-500/20"><Dna className="h-5 w-5" /></span>
                    <div>
                      <h2 className={`genocular-section-title ${isDark ? "!text-slate-100" : ""}`}>Visualize your genome</h2>
                      <div className={`mt-1 text-[10px] ${isDark ? "text-slate-400" : "text-slate-500"}`}>GenBank (.gb, .gbk, .genbank)</div>
                    </div>
                  </div>
                  <button type="button" onClick={chooseFile} disabled={!ready} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-sky-700 px-4 text-[12px] font-bold text-white shadow-sm transition hover:-translate-y-px hover:bg-sky-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30 disabled:pointer-events-none disabled:opacity-45">
                    <FileUp className="h-4 w-4" /> Upload Genome
                  </button>
                </div>
              </section>
            )}

            {!isAnalyzeLaunch && !showAnalysisLanding && (busy || preloadNote || error) && (
              <div className="order-0 space-y-2" aria-live="polite">
                {busy && <div className="rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-[12px] font-medium text-sky-800">Updating genome map…</div>}
                {preloadNote && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[12px] font-medium text-emerald-800">{preloadNote}</div>}
                {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12px] font-medium text-rose-800">{error}</div>}
              </div>
            )}
            {isAnalyzeLaunch && (
              <section className="min-w-0 space-y-4">
                <AnalysisJobHeader
                  analysisIndex={analysisRequestResolved ? analysisIndex : null}
                  analysisInterpretation={analysisRequestResolved ? analysisInterpretation : null}
                  analysisInterpretationBusy={analysisRequestResolved && analysisInterpretationBusy}
                  analysisCards={analysisRequestResolved ? analysisCards : []}
                  analysisCardsBusy={!analysisRequestResolved || analysisCardsBusy}
                  dashboardGroups={analysisRequestResolved ? dashboardGroups : []}
                  genomeMapCount={analysisRequestResolved ? reportGenomeItems.length : 0}
                  interactivePlotCount={analysisRequestResolved ? interactivePlotCount : 0}
                  jobId={jobIdFromQuery}
                  isDark={isDark}
                  loading={showAnalysisLoading}
                  plotStyle={analysisPlotStyle}
                  publicationPalette={analysisPublicationPalette}
                  renderGenomeMaps={renderGenomeMapsForReport}
                  submittedBy={submittedBy}
                />
                {showAnalysisLoading && (
                  <div
                    className={`relative overflow-hidden rounded-[24px] border px-6 py-9 shadow-[0_22px_60px_-44px_rgba(2,132,199,0.72)] ${
                      isDark
                        ? "border-slate-700 bg-slate-900 text-slate-100"
                        : "border-sky-100 bg-white text-slate-900"
                    }`}
                    role="status"
                    aria-live="polite"
                    aria-label="Loading analysis results"
                  >
                    <div
                      className={`pointer-events-none absolute inset-0 ${
                        isDark
                          ? "bg-[radial-gradient(circle_at_50%_32%,rgba(14,165,233,0.12),transparent_45%)]"
                          : "bg-[radial-gradient(circle_at_50%_32%,rgba(56,189,248,0.13),transparent_45%)]"
                      }`}
                      aria-hidden="true"
                    />
                    <div className="relative flex flex-col items-center justify-center text-center">
                      <div
                        className={`grid h-24 w-24 place-items-center rounded-full border shadow-sm ${
                          isDark
                            ? "border-slate-700 bg-slate-950/70"
                            : "border-sky-100 bg-white/90 shadow-sky-100/70"
                        }`}
                        aria-hidden="true"
                      >
                        <img
                          src="/genocular_loading_animation.svg"
                          alt=""
                          className="h-[4.5rem] w-[4.5rem]"
                        />
                      </div>
                      <span className="mt-4 text-[13px] font-semibold tracking-tight">Loading results</span>
                    </div>
                  </div>
                )}

                {analysisRequestResolved && !showAnalysisLoading && analysisIndex && (
                  <AnalysisInterpretationPanel
                    result={analysisInterpretation}
                    busy={analysisInterpretationBusy}
                    error={analysisInterpretationError}
                    isDark={isDark}
                    onRetry={() => setAnalysisSummaryRetry((count) => count + 1)}
                  />
                )}
              </section>
            )}
            {/* Viewer card */}
            <_motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={`${showAnalysisLanding || (isAnalyzeLaunch && showAnalysisLoading) ? "hidden" : ""} overflow-hidden rounded-[20px] border shadow-[0_18px_50px_-38px_rgba(15,23,42,0.45)] ${isDark ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}
            >
              {/* Toolbar */}
              <div className={`flex flex-col gap-4 border-b px-4 py-3.5 sm:px-5 lg:flex-row lg:items-center lg:justify-between ${isDark ? "border-slate-800 bg-slate-900" : "border-slate-100 bg-slate-50/55"}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${hasMap ? "bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]" : "bg-slate-300"}`} />
                    <h2 className={`genocular-section-title ${isDark ? "!text-slate-100" : ""}`}>Genome Map</h2>
                  </div>
                  <div className={`mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                    <span className={`max-w-[340px] truncate font-medium ${isDark ? "text-slate-300" : "text-slate-700"}`} title={fileName || "No file loaded"}>
                      {fileName || "No file loaded"}
                    </span>
                    <span className="hidden h-3 w-px bg-slate-300 sm:block" />
                    <span>{bpLength ? `${bpLength.toLocaleString()} base pairs` : "Genome length unavailable"}</span>
                    <span className="hidden h-3 w-px bg-slate-300 sm:block" />
                    <span className="capitalize">{ui.format} view</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {isAnalyzeLaunch && (
                    <button type="button" onClick={() => setControlsOpen(true)} className={`${isDark ? "border-slate-700 bg-slate-800 text-slate-300 hover:border-sky-700 hover:text-sky-300" : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-800"} inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-[11px] font-bold shadow-sm transition`}>
                      <SlidersHorizontal className="h-3.5 w-3.5" /> Options
                    </button>
                  )}
                  {isAnalyzeLaunch && genomeGbkItems.length > 1 && (
                    <label className="flex h-10 min-w-[240px] items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 text-[11px] font-semibold text-sky-900 shadow-sm">
                      <span className="shrink-0">Genome/MAG</span>
                      <select
                        value={selectedGenomeKey || assemblyGbkItem?.key || ""}
                        onChange={(event) => loadGenomeResultItem(event.target.value)}
                        disabled={busy}
                        className="min-w-0 flex-1 bg-transparent text-[11px] font-semibold text-slate-800 outline-none disabled:opacity-50"
                        aria-label="Select genome or MAG"
                      >
                        {genomeGbkItems.map((item) => (
                          <option key={item.key} value={item.key}>{genomeItemLabel(item)}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  <div className="flex items-center rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200" role="group" aria-label="Map navigation">
                    <button type="button" disabled={!hasMap} onClick={zoomOut} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 disabled:opacity-35" title="Zoom out">
                      <ZoomOut className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Out</span>
                    </button>
                    <button type="button" disabled={!hasMap} onClick={fitToView} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 disabled:opacity-35" title="Fit whole genome">
                      <Maximize2 className="h-3.5 w-3.5" /> Fit
                    </button>
                    <button type="button" disabled={!hasMap} onClick={zoomIn} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 disabled:opacity-35" title="Zoom in">
                      <ZoomIn className="h-3.5 w-3.5" /> <span className="hidden sm:inline">In</span>
                    </button>
                  </div>
                  <div className="flex items-center rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200" role="group" aria-label="Export map">
                    <button type="button" disabled={!hasMap} onClick={exportPNG} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 disabled:opacity-35" title="Export PNG image">
                      <ImageIcon className="h-3.5 w-3.5" /> PNG
                    </button>
                    <button type="button" disabled={!hasMap} onClick={exportSVG} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 disabled:opacity-35" title="Export SVG image">
                      <ImageIcon className="h-3.5 w-3.5" /> SVG
                    </button>
                    <button type="button" disabled={!hasMap} onClick={exportJSON} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 disabled:opacity-35" title="Export CGView JSON">
                      <FileJsonIcon className="h-3.5 w-3.5" /> JSON
                    </button>
                  </div>
                </div>
              </div>

              {/* Canvas surface */}
              <div className="relative">
                <div
                  ref={surfaceRef}
                  className="relative w-full min-w-0 overflow-hidden"
                  style={{ height: "clamp(360px, 72vh, 720px)", contain: "layout paint", background: ui.theme === "dark" ? "#0b0f19" : "#fbfdff" }}
                >
                  <div id={viewerIdRef.current} className="absolute inset-0 h-full w-full overflow-hidden" />
                </div>

                {busy && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/70 backdrop-blur-sm">
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-xl">
                      <div className="flex items-center gap-3 text-[13px] text-slate-700">
                        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" />
                        <span className="font-semibold">Rendering genome map…</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Drag & drop overlay (until a map is loaded) */}
                {!lastJSONRef.current && !isAnalyzeLaunch && (
                  <div
                    onDrop={onDrop}
                    onDragOver={onDragOver}
                    className="absolute inset-0 z-10 flex flex-col items-center justify-center border-2 border-dashed border-slate-300 bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.08),_transparent_42%),linear-gradient(to_bottom_right,#f8fafc,#ffffff,#ecfdf5)] px-6 text-center"
                  >
                    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-sky-700 shadow-lg ring-1 ring-slate-200">
                      <Dna className="h-6 w-6" />
                    </div>
                    <div className="text-base font-bold tracking-tight text-slate-900 sm:text-lg">Drop a genome file to begin</div>
                    <div className="mt-1.5 max-w-md text-[12px] leading-5 text-slate-500">Supports GenBank (.gb, .gbk, .genbank) and exported CGView JSON maps.</div>
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      <button type="button" onClick={chooseFile} disabled={!ready || busy} className="inline-flex h-9 items-center gap-2 rounded-xl bg-slate-950 px-3.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:pointer-events-none disabled:opacity-45">
                        <FileUp className="h-4 w-4" />
                        Upload Genome
                      </button>
                      <button type="button" onClick={chooseJSON} className={toolbarButtonClass}>
                        <FileJsonIcon className="h-4 w-4" />
                        Choose JSON
                      </button>
                    </div>
                  </div>
                )}
                {!lastJSONRef.current && isAnalyzeLaunch && (
                  <div className={`absolute inset-0 z-10 flex flex-col items-center justify-center border-2 border-dashed px-6 text-center ${isDark ? "border-slate-700 bg-slate-950" : "border-slate-300 bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.08),_transparent_42%),linear-gradient(to_bottom_right,#f8fafc,#ffffff,#ecfdf5)]"}`}>
                    <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-2xl shadow-sm ring-1 ${isDark ? "bg-slate-900 text-sky-400 ring-slate-700" : "bg-white text-sky-700 ring-slate-200"}`}><Dna className="h-5 w-5" /></div>
                    <div className={`text-base font-bold tracking-tight ${isDark ? "text-slate-100" : "text-slate-900"}`}>
                      {error ? "Genome map could not be loaded." : assemblyGbkItem ? "Preparing genome map…" : "No genome map is available for this run."}
                    </div>
                    {error && <div className={`mt-2 max-w-xl text-[11px] leading-5 ${isDark ? "text-rose-300" : "text-rose-700"}`}>{error}</div>}
                    {assemblyGbkItem?.key && (
                      <button type="button" onClick={() => loadGenomeResultItem(assemblyGbkItem.key)} disabled={busy} className="mt-4 inline-flex h-9 items-center gap-2 rounded-xl bg-sky-700 px-3.5 text-[12px] font-bold text-white shadow-sm transition hover:bg-sky-800 disabled:pointer-events-none disabled:opacity-45">
                        <Dna className="h-4 w-4" /> {error ? "Retry genome map" : "Load genome"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </_motion.div>

            {isAnalyzeLaunch && analysisRequestResolved && (
              <section className="min-w-0 space-y-4">
                {!analysisCardsBusy && analysisCardsError && (
                  <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700 shadow-sm">
                    {analysisCardsError}
                  </div>
                )}

                {!analysisCardsBusy && !analysisCardsError && analysisCards.length > 0 && (
                  <div className="min-w-0 space-y-6">
                    <div className={`sticky top-3 z-20 rounded-2xl border p-2 shadow-lg backdrop-blur-xl ${isDark ? "border-slate-700 bg-slate-900/95" : "border-slate-200 bg-white/95"}`}>
                      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                        <label className={`flex h-9 min-w-[230px] items-center gap-2 rounded-xl border px-3 lg:w-[280px] ${isDark ? "border-slate-700 bg-slate-800 text-slate-300" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
                          <Search className="h-3.5 w-3.5 shrink-0" />
                          <input value={analysisSearch} onChange={(event) => setAnalysisSearch(event.target.value)} placeholder="Find a plot, tool or result" className="min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-slate-400" />
                          {analysisSearch && <button type="button" onClick={() => setAnalysisSearch("")} className="rounded p-0.5 hover:bg-slate-200/60" aria-label="Clear result search"><X className="h-3 w-3" /></button>}
                        </label>
                        <div className={`flex shrink-0 items-center gap-1 rounded-xl border p-1 ${isDark ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-50"}`} role="group" aria-label="Plot style">
                          <Palette className={`mx-1 h-3.5 w-3.5 ${isDark ? "text-slate-400" : "text-slate-500"}`} aria-hidden="true" />
                          {[
                            ["modern", "Modern"],
                            ["publication", "Publication"],
                          ].map(([value, label]) => (
                            <button
                              key={value}
                              type="button"
                              onClick={() => setAnalysisPlotStyle(value)}
                              className={`h-7 rounded-lg px-2.5 text-[10px] font-bold transition ${analysisPlotStyle === value ? "bg-sky-600 text-white shadow-sm" : isDark ? "text-slate-300 hover:bg-slate-700" : "text-slate-600 hover:bg-white"}`}
                              aria-pressed={analysisPlotStyle === value}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        {analysisPlotStyle === "publication" && (
                          <select
                            value={analysisPublicationPalette}
                            onChange={(event) => setAnalysisPublicationPalette(event.target.value)}
                            className={`h-9 shrink-0 rounded-xl border px-2.5 text-[10px] font-bold outline-none transition focus:border-sky-500 ${isDark ? "border-slate-700 bg-slate-800 text-slate-200" : "border-slate-200 bg-white text-slate-700"}`}
                            aria-label="Publication color palette"
                          >
                            {PUBLICATION_PALETTES.map((paletteKey) => (
                              <option key={paletteKey} value={paletteKey}>{PLOT_PALETTES[paletteKey].label}</option>
                            ))}
                          </select>
                        )}
                        <nav className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5" aria-label="Analysis sections">
                          {visibleDashboardGroups.map((group) => (
                            <a key={group.id} href={`#analysis-${group.id}`} className={`${isDark ? "border-slate-700 bg-slate-800 text-slate-300 hover:border-sky-700 hover:text-sky-300" : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-800"} shrink-0 rounded-lg border px-2.5 py-2 text-[9px] font-bold transition`}>
                              {group.label} <span className="ml-1 opacity-60">{group.cards.length}</span>
                            </a>
                          ))}
                        </nav>
                      </div>
                    </div>
                    {visibleDashboardGroups.map((group) => {
                      const groupIndex = dashboardGroups.findIndex((candidate) => candidate.id === group.id);
                      const collapsed = !analysisSearch && Boolean(collapsedAnalysisGroups[group.id]);
                      const compactCards = group.cards.filter((card) => card.type === "plotly" && !FULL_WIDTH_ANALYSIS_RENDERERS.has(card.renderer) && !UPDATED_DASHBOARD_RENDERERS.has(card.renderer));
                      const unpairedCompactId = compactCards.length % 2 === 1
                        ? compactCards[compactCards.length - 1]?.id : "";
                      return (
                      <section key={group.id} id={`analysis-${group.id}`} className="min-w-0 scroll-mt-24 space-y-3">
                        <button type="button" onClick={() => setCollapsedAnalysisGroups((current) => ({ ...current, [group.id]: !current[group.id] }))} className="flex w-full items-start gap-3 rounded-xl px-1 py-1 text-left focus:outline-none focus:ring-2 focus:ring-sky-500/20" aria-expanded={!collapsed}>
                          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-sky-100 font-mono text-[11px] font-bold text-sky-800">{String(groupIndex + 1).padStart(2, "0")}</span>
                          <div className="min-w-0 flex-1">
                            <h2 className={`genocular-section-title ${isDark ? "!text-slate-100" : ""}`}>{group.label}</h2>
                          </div>
                          <span className={`${isDark ? "border-slate-700 bg-slate-800 text-slate-400" : "border-slate-200 bg-white text-slate-500"} mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border`}>{collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}</span>
                        </button>
                        {!collapsed && <div className="grid min-w-0 grid-flow-row-dense grid-cols-1 items-start gap-4 2xl:grid-cols-2">
                          {group.cards.map((card, cardIndex) => (
                            <AnalysisDashboardCard
                              key={card.id}
                              card={card}
                              index={cardIndex}
                              expanded={expandedAnalysisCard === card.id}
                              forceFullWidth={group.cards.length === 1 || card.id === unpairedCompactId}
                              onToggleExpanded={() => setExpandedAnalysisCard((current) => current === card.id ? "" : card.id)}
                              isDark={isDark}
                              plotStyle={analysisPlotStyle}
                              publicationPalette={analysisPublicationPalette}
                            />
                          ))}
                        </div>}
                      </section>
                    );})}
                    {analysisSearch && visibleDashboardGroups.length === 0 && (
                      <div className={`rounded-2xl border px-4 py-8 text-center text-[12px] ${isDark ? "border-slate-700 bg-slate-900 text-slate-400" : "border-slate-200 bg-white text-slate-500"}`}>No generated result matches “{analysisSearch}”.</div>
                    )}
                  </div>
                )}

                {!analysisCardsBusy && !analysisCardsError && analysisCards.length === 0 && !isMetagenomicsAnalysis && (
                  <>
                    {antiSmashIndexItem?.url && (
                      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-base font-semibold text-slate-900">antiSMASH Report</h3>
                          <p className="text-xs text-slate-500">
                            Rendered from <code>antismash_results/index.html</code>
                          </p>
                        </div>
                        <a
                          href={antiSmashIndexItem.url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                        >
                          Open full report
                        </a>
                      </div>
                      {antiSmashBusy && (
                        <div className="mt-3 flex items-center gap-2 text-sm text-slate-600">
                          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" />
                          Loading antiSMASH report...
                        </div>
                      )}
                      {!antiSmashBusy && antiSmashError && (
                        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
                          {antiSmashError}
                        </div>
                      )}
                      {!antiSmashBusy && !antiSmashError && antiSmashSrcDoc && (
                        <iframe
                          title="antiSMASH report"
                          srcDoc={antiSmashSrcDoc}
                          className="mt-3 h-[900px] w-full rounded-2xl border border-slate-200 bg-white shadow-inner"
                          sandbox="allow-scripts"
                          referrerPolicy="no-referrer"
                        />
                      )}
                      </div>
                    )}

                    {nanoPlotIndexItem?.url && (
                      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-base font-semibold text-slate-900">NanoPlot Report</h3>
                          <p className="text-xs text-slate-500">
                            Rendered from <code>nanoplot/NanoPlot-report.html</code>
                          </p>
                        </div>
                        <a
                          href={nanoPlotIndexItem.url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                        >
                          Open full report
                        </a>
                      </div>
                      {nanoPlotBusy && (
                        <div className="mt-3 flex items-center gap-2 text-sm text-slate-600">
                          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" />
                          Loading NanoPlot report...
                        </div>
                      )}
                      {!nanoPlotBusy && nanoPlotError && (
                        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
                          {nanoPlotError}
                        </div>
                      )}
                      {!nanoPlotBusy && !nanoPlotError && nanoPlotSrcDoc && (
                        <iframe
                          title="NanoPlot report"
                          srcDoc={nanoPlotSrcDoc}
                          className="mt-3 h-[900px] w-full rounded-2xl border border-slate-200 bg-white shadow-inner"
                          sandbox="allow-scripts"
                          referrerPolicy="no-referrer"
                        />
                      )}
                      </div>
                    )}

                    {crisprPlotItem?.url && (
                      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                        <h3 className="text-base font-semibold text-slate-900">CRISPR Plot</h3>
                        <p className="text-xs text-slate-500">
                          Rendered from <code>crispr_output/plot.png</code>
                        </p>
                        <a
                          href={crisprPlotItem.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 block overflow-hidden rounded-2xl border border-slate-200 bg-slate-50"
                        >
                          <img
                            src={crisprPlotItem.url}
                            alt="CRISPR plot"
                            className="h-[480px] w-full object-contain bg-white"
                            loading="lazy"
                          />
                        </a>
                      </div>
                    )}
                  </>
                )}
              </section>
            )}

            {/* Controls drawer */}
            {controlsOpen && (
              <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-labelledby="map-settings-title">
                <div
                  className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]"
                  onClick={() => setControlsOpen(false)}
                />
                <_motion.aside
                  initial={{ opacity: 0, x: 28 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.22, ease: "easeOut" }}
                  className="absolute right-0 top-0 z-[91] flex h-full w-full max-w-[430px] flex-col border-l border-slate-200 bg-slate-50 shadow-2xl"
                >
                  <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-sm">
                        <SlidersHorizontal className="h-4.5 w-4.5" />
                      </div>
                      <div>
                        <h2 id="map-settings-title" className="genocular-section-title">Options</h2>
                        <p className="mt-0.5 text-[11px] text-slate-500">Customize layout, features, and plots</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setControlsOpen(false)}
                      className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                      aria-label="Close controls"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex-1 space-y-4 overflow-y-auto p-4">
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Active genome</div>
                      <div className="mt-1.5 truncate text-[13px] font-bold text-slate-900" title={fileName || "No file loaded"}>{fileName || "No file loaded"}</div>
                      <div className="mt-1 text-[11px] text-slate-500">{bpLength ? `${bpLength.toLocaleString()} base pairs` : "Genome length unavailable"}</div>
                    </div>

                    <ControlSection
                      icon={Palette}
                      title="Display"
                      description="Adjust the canvas appearance and map layout."
                    >
                      <SegmentedControl
                        label="Canvas theme"
                        value={ui.theme}
                        options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]}
                        onChange={(theme) => setAndApplyLive({ theme })}
                      />
                      <SegmentedControl
                        label="Map layout"
                        value={ui.format}
                        options={[{ value: "circular", label: "Circular" }, { value: "linear", label: "Linear" }]}
                        onChange={(format) => setAndApplyLive({ format })}
                      />
                      <SelectControl
                        label="Legend position"
                        value={ui.legendPos}
                        onChange={(legendPos) => setAndApplyLive({ legendPos })}
                      >
                        <option value="bottom-right">Bottom right</option>
                        <option value="bottom-left">Bottom left</option>
                        <option value="top-right">Top right</option>
                        <option value="top-left">Top left</option>
                      </SelectControl>
                      <ToggleControl
                        label="Feature labels"
                        description="Show names next to annotated features."
                        checked={ui.showLabels}
                        onChange={(showLabels) => setAndApplyLive({ showLabels })}
                      />
                      <div className="px-3 py-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[13px] font-semibold text-slate-800">Arrow head length</span>
                          <span className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold tabular-nums text-slate-600">{Math.round(ui.arrowLen * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0.10"
                          max="0.60"
                          step="0.02"
                          value={ui.arrowLen}
                          onChange={(event) => setAndRebuild({ arrowLen: parseFloat(event.target.value) })}
                          className="mt-3 h-1.5 w-full cursor-pointer accent-sky-600"
                          aria-label="Arrow head length"
                        />
                      </div>
                    </ControlSection>

                    <ControlSection
                      icon={Layers}
                      title="Feature tracks"
                      description="Choose which genome annotations are visible."
                    >
                      <ToggleControl label="Coding sequences (CDS)" description="Protein-coding feature arrows." checked={ui.showCDS} onChange={(showCDS) => setAndRebuild({ showCDS })} />
                      <ToggleControl label="Transfer RNA (tRNA)" description="Transfer RNA annotations." checked={ui.showTRNA} onChange={(showTRNA) => setAndRebuild({ showTRNA })} />
                      <ToggleControl label="Ribosomal RNA (rRNA)" description="Ribosomal RNA annotations." checked={ui.showRRNA} onChange={(showRRNA) => setAndRebuild({ showRRNA })} />
                    </ControlSection>

                    <ControlSection
                      icon={SlidersHorizontal}
                      title="Composition plots"
                      description="Control sequence-derived GC visualizations."
                    >
                      <ToggleControl label="GC content" description="Local GC percentage across the genome." checked={ui.showGCContent} onChange={(showGCContent) => setAndRebuild({ showGCContent })} />
                      <ToggleControl label="GC skew" description="Positive and negative strand-bias signal." checked={ui.showGCSkew} onChange={(showGCSkew) => setAndRebuild({ showGCSkew })} />
                      <div className="px-3 py-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[13px] font-semibold text-slate-800">Plot thickness</span>
                          <span className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold tabular-nums text-slate-600">{ui.plotThickness.toFixed(1)}×</span>
                        </div>
                        <input
                          type="range"
                          min="1"
                          max="4"
                          step="0.5"
                          value={ui.plotThickness}
                          onChange={(event) => setAndRebuild({ plotThickness: parseFloat(event.target.value) })}
                          className="mt-3 h-1.5 w-full cursor-pointer accent-sky-600"
                          aria-label="Plot thickness"
                        />
                      </div>
                    </ControlSection>

                    <div className="flex items-start gap-2.5 rounded-2xl border border-sky-200 bg-sky-50 px-3.5 py-3 text-[11px] leading-5 text-sky-800">
                      <Info className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>Track changes rebuild the map from the loaded GenBank file. Display changes apply immediately.</span>
                    </div>
                  </div>

                  <div className="shrink-0 border-t border-slate-200 bg-white p-4">
                    <button
                      type="button"
                      onClick={() => setControlsOpen(false)}
                      className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-slate-950 px-4 text-[12px] font-bold text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500/30"
                    >
                      Done
                    </button>
                  </div>
                </_motion.aside>
              </div>
            )}
          </div>
      </main>
    </div>
  );
}
