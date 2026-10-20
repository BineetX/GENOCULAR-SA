/* eslint-disable react-refresh/only-export-components -- report generation intentionally reuses the production figure builders */
import React, { useEffect, useMemo, useRef, useState } from "react";
import PlotControls from "./PlotControls.jsx";
import { copyPlotFigure, plotConfiguration } from "./plotControls.js";

export const PLOT_PALETTES = {
  modern: {
    label: "Modern",
    colors: ["#1D4ED8", "#0284C7", "#0EA5E9", "#06B6D4", "#0D9488", "#4F46E5", "#2563EB", "#0369A1", "#38BDF8", "#64748B"],
  },
  okabe_ito: {
    label: "Okabe–Ito",
    colors: ["#0072B2", "#E69F00", "#009E73", "#D55E00", "#CC79A7", "#56B4E9", "#F0E442", "#000000"],
  },
  paul_tol_bright: {
    label: "Paul Tol Bright",
    colors: ["#4477AA", "#EE6677", "#228833", "#CCBB44", "#66CCEE", "#AA3377", "#BBBBBB"],
  },
  tableau_10: {
    label: "Tableau 10",
    colors: ["#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F", "#EDC948", "#B07AA1", "#FF9DA7", "#9C755F", "#BAB0AC"],
  },
  colorbrewer_dark2: {
    label: "ColorBrewer Dark2",
    colors: ["#1B9E77", "#D95F02", "#7570B3", "#E7298A", "#66A61E", "#E6AB02", "#A6761D", "#666666"],
  },
};

export const PUBLICATION_PALETTES = ["okabe_ito", "paul_tol_bright", "tableau_10", "colorbrewer_dark2"];

function selectedPalette(options = {}) {
  if (options.plotStyle !== "publication") return PLOT_PALETTES.modern.colors;
  return PLOT_PALETTES[options.publicationPalette]?.colors || PLOT_PALETTES.okabe_ito.colors;
}

const COLORS = PLOT_PALETTES.okabe_ito.colors;
const STATE_COLORS = { Raw: "#E69F00", Clean: "#0072B2", Cleaned: "#0072B2", Filtered: "#0072B2" };
const BASE_COLORS = { A: "#009E73", C: "#0072B2", G: "#E69F00", T: "#D55E00", N: "#7F8C8D" };
const CCTYPER_MODULE_COLORS = {
  Adaptation: "#0072B2",
  Interference: "#E69F00",
  Cas6: "#D55E00",
  "CRISPR array": "#111827",
  Unknown: "#9CA3AF",
};
const ZONE_COLORS = {
  "High quality": "#4DAF4A",
  "Medium quality": "#FF8C00",
  "Low quality/discard": "#E41A1C",
  "Low (<5x)": "#7F8C8D",
  "Medium (5-20x)": "#56B4E9",
  "High (>20x)": "#0072B2",
  Pass: "#009E73",
  Fail: "#D55E00",
};

export const PLOT_NOTES = {
  fastp_qc: "Per-base quality and nucleotide composition before and after filtering.",
  fastp_quality: "Per-base Phred quality before and after filtering, with Q20 and Q30 references.",
  fastp_content: "Per-base nucleotide composition before and after filtering.",
  fastp_rates: "Whole-library Q20 and Q30 compliance before and after filtering.",
  fastp_retained: "Read retention after adapter trimming and quality filtering.",
  metaquast_curve: "Ranked contig-length distribution on logarithmic axes.",
  checkm2_quality: "MAG quality space with accepted completeness and contamination thresholds.",
  mapping_depth: "Per-contig length and mean coverage; dashed lines mark 5× and 20× depth.",
  mapping_flagstat: "Alignment yield, pairing and singleton counts from the final mapping.",
  mapping_density: "Kernel density estimate of log-transformed mean contig coverage.",
  coverm_abundance: "Relative abundance of recovered MAGs and the unassigned read fraction.",
  mag_alpha: "Whittaker rank-abundance curve; the log scale exposes rare MAGs.",
  mag_alpha_summary: "MAG richness, Shannon diversity, Gini-Simpson diversity and Pielou evenness.",
  mag_rank_abundance: "MAG Whittaker rank-abundance curve; the log scale exposes rare community members.",
  gtdbtk_taxonomy: "Hierarchical GTDB classification—click a sector to explore its descendants.",
  gunc_sankey: "Flow from inferred taxonomic level through failure mode to the GUNC decision.",
  cctyper_synteny: "Subtype distribution and paginated CRISPR-Cas locus architecture.",
  cctyper_subtypes: "CRISPR-Cas subtype calls separated by validated and putative loci.",
  cctyper_genemap: "Paginated CRISPR-Cas gene synteny maps with genomic coordinates and functional modules.",
  dbcan_composition: "CAZyme domains per MAG, grouped by canonical CAZy class.",
  prokka_features: "Protein-coding, RNA and repeat annotations per MAG.",
  hadeg_network: "Hydrocarbon degradation pathway–gene–MAG associations.",
  virsorter_scores: "Viral classifier scores with sensitivity and high-confidence cutoffs.",
  metaphlan_species: "Species-level community composition.",
  metaphlan_alpha_summary: "MetaPhlAn genus richness, Shannon diversity and Gini-Simpson diversity.",
  metaphlan_rank_abundance: "Genus-level Whittaker rank-abundance curve from the MetaPhlAn profile.",
  read_alpha: "Species rank-abundance curve with logarithmic relative abundance.",
  nonpareil_curve: "Observed and fitted sequencing-effort curve with the 95% coverage target.",
  nanostat_qc: "Raw and nanoq-filtered long-read yield and length metrics.",
};

function colorWithAlpha(color, alpha) {
  const normalized = String(color || "").replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return `rgba(37,99,235,${alpha})`;
  const value = Number.parseInt(normalized, 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
}

function paletteScale(palette) {
  if (palette.length === 1) return [[0, palette[0]], [1, palette[0]]];
  return palette.map((color, index) => [index / (palette.length - 1), color]);
}

const MODERN_CONTINUOUS_SCALE = [
  [0, "#F0F7FF"], [0.2, "#CDEBFA"], [0.45, "#7DD3FC"],
  [0.7, "#0EA5E9"], [0.86, "#0369A1"], [1, "#123B6D"],
];

function themedTrace(trace, index, palette, options = {}) {
  const publication = options.plotStyle === "publication";
  const continuousScale = publication ? paletteScale(palette) : MODERN_CONTINUOUS_SCALE;
  const color = palette[index % palette.length];
  const marker = trace?.marker ? { ...trace.marker } : {};
  const supportsMarker = Boolean(trace?.marker) || ["bar", "scatter", "scattergl", "histogram", "box", "violin", "pie", "sunburst", "treemap"].includes(trace?.type);
  const line = trace?.line ? { ...trace.line } : null;
  const next = { ...trace };
  const markerColors = marker.color;

  if (supportsMarker && Array.isArray(markerColors)) {
    if (markerColors.every((value) => typeof value === "string")) {
      marker.color = markerColors.map((_, colorIndex) => palette[colorIndex % palette.length]);
    } else if (markerColors.some((value) => Number.isFinite(Number(value)))) {
      marker.colorscale = continuousScale;
    }
  } else if (supportsMarker) {
    marker.color = color;
  }

  if (!publication && supportsMarker && !["pie", "sunburst", "treemap"].includes(trace.type)) {
    marker.opacity = marker.opacity ?? 0.94;
    marker.line = { color: "rgba(255,255,255,0.88)", width: trace.type === "bar" ? 0.8 : 0.65, ...(marker.line || {}) };
  }

  if (trace.type === "heatmap" || trace.type === "contour") next.colorscale = continuousScale;
  if (line && trace.hoverinfo !== "skip") {
    line.color = color;
    if (!publication) line.width = Math.max(Number(line.width) || 0, 2.2);
  }
  if (trace.fill && trace.fill !== "none") next.fillcolor = colorWithAlpha(color, publication ? 0.16 : 0.12);

  if (supportsMarker && (trace.type === "sunburst" || trace.type === "pie" || trace.type === "treemap")) {
    const count = Math.max(trace.labels?.length || 0, trace.values?.length || 0);
    marker.color = Array.from({ length: count }, (_, colorIndex) => palette[colorIndex % palette.length]);
  }
  if (trace.type === "sankey") {
    const nodeCount = trace.node?.label?.length || 0;
    next.node = {
      ...(trace.node || {}),
      color: Array.from({ length: nodeCount }, (_, colorIndex) => palette[colorIndex % palette.length]),
    };
    next.link = {
      ...(trace.link || {}),
      color: (trace.link?.source || []).map((source) => colorWithAlpha(palette[Number(source) % palette.length], publication ? 0.24 : 0.18)),
    };
  }

  if (supportsMarker && Object.keys(marker).length) next.marker = marker;
  if (line) next.line = line;
  return next;
}

export function scientificFigure(figure, options = {}) {
  const source = figure || { data: [], layout: {} };
  const incoming = source.layout || {};
  const publication = options.plotStyle === "publication";
  const palette = selectedPalette(options);
  const axis = {
    automargin: true,
    showline: true,
    mirror: publication,
    linecolor: publication ? "#111827" : "#b8cbe0",
    linewidth: publication ? 1.15 : 1,
    ticks: "outside",
    tickcolor: publication ? "#111827" : "#94a3b8",
    ticklen: publication ? 5 : 4,
    tickfont: { size: publication ? 11 : 10.5, color: publication ? "#111827" : "#475569" },
    titlefont: { size: 12, color: publication ? "#111827" : "#24415f" },
    showgrid: true,
    gridcolor: publication ? "#d1d5db" : "#eaf1f7",
    gridwidth: 1,
    zeroline: false,
  };
  const layout = {
    autosize: true,
    height: incoming.height || 500,
    ...incoming,
    paper_bgcolor: "#ffffff",
    plot_bgcolor: publication ? "#ffffff" : "#f8fbfe",
    colorway: palette,
    font: {
      family: publication ? "Arial, Helvetica, sans-serif" : "Inter, ui-sans-serif, system-ui, sans-serif",
      color: publication ? "#111827" : "#334155",
      size: publication ? 11 : 12,
    },
    hovermode: incoming.hovermode || "closest",
    hoverlabel: {
      bgcolor: publication ? "#ffffff" : "#0b2545",
      bordercolor: publication ? "#111827" : "#38bdf8",
      font: { color: publication ? "#111827" : "#f8fafc", size: 12 },
    },
    transition: { duration: 220, easing: "cubic-in-out" },
    margin: { t: 38, r: 28, b: 72, l: 78, ...(incoming.margin || {}) },
    legend: {
      orientation: "h", x: 0, xanchor: "left", y: 1.12, yanchor: "bottom",
      font: { size: 10.5, color: publication ? "#111827" : "#334155" },
      bgcolor: publication ? "rgba(255,255,255,0.96)" : "rgba(255,255,255,0.82)",
      ...(incoming.legend || {}),
    },
  };
  for (const key of ["xaxis", "yaxis", "xaxis2", "yaxis2", "xaxis3", "yaxis3"]) {
    if (incoming[key] || key === "xaxis" || key === "yaxis") {
      layout[key] = { ...axis, ...(incoming[key] || {}) };
      layout[key].tickfont = { ...axis.tickfont, ...(incoming[key]?.tickfont || {}) };
      layout[key].titlefont = { ...axis.titlefont, ...(incoming[key]?.titlefont || {}) };
    }
  }
  return { ...source, data: (source.data || []).map((trace, index) => themedTrace(trace, index, palette, options)), layout };
}

function stableColor(label) {
  let hash = 0;
  for (const char of String(label || "")) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length];
}

function rowsBy(rows, key) {
  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const group = String(row?.[key] ?? "Unknown");
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group).push(row);
  }
  return grouped;
}

function barFigure(rows, categoryKey, valueKey, colorKey = null, orientation = "v") {
  const groups = colorKey ? rowsBy(rows, colorKey) : new Map([["Value", rows || []]]);
  return {
    data: [...groups.entries()].map(([name, values], index) => ({
      type: "bar",
      name,
      orientation,
      x: orientation === "h" ? values.map((row) => row?.[valueKey]) : values.map((row) => row?.[categoryKey]),
      y: orientation === "h" ? values.map((row) => row?.[categoryKey]) : values.map((row) => row?.[valueKey]),
      marker: { color: colorKey ? stableColor(name) : COLORS[index % COLORS.length], line: { color: "#ffffff", width: 0.7 } },
      hovertemplate: orientation === "h" ? "%{y}: %{x:.3g}<extra>%{fullData.name}</extra>" : "%{x}: %{y:.3g}<extra>%{fullData.name}</extra>",
    })),
    layout: { barmode: colorKey ? "stack" : "group", xaxis: { automargin: true }, yaxis: { automargin: true } },
  };
}

function taxonomySunburst(rows) {
  const ranks = ["Domain", "Phylum", "Class", "Order", "Family", "Genus", "Species"];
  const nodes = new Map();
  for (const row of rows || []) {
    let parent = "";
    let path = "";
    for (const rank of ranks) {
      const label = String(row?.[rank] || "Unclassified");
      path = path ? `${path}/${label}` : label;
      const node = nodes.get(path) || { id: path, label, parent, value: 0 };
      node.value += Number(row?.count || 0);
      nodes.set(path, node);
      parent = path;
    }
  }
  const values = [...nodes.values()];
  return {
    data: [{
      type: "sunburst",
      ids: values.map((node) => node.id),
      labels: values.map((node) => node.label),
      parents: values.map((node) => node.parent),
      values: values.map((node) => node.value),
      branchvalues: "total",
      maxdepth: 6,
      insidetextorientation: "radial",
      marker: {
        colors: values.map((node) => stableColor(node.id.split("/").slice(0, 2).join("/"))),
        line: { color: "#ffffff", width: 1 },
      },
      hovertemplate: "<b>%{label}</b><br>MAGs: %{value:,}<extra></extra>",
    }],
    layout: { height: 580, margin: { t: 18, r: 18, b: 18, l: 18 }, uniformtext: { minsize: 10, mode: "hide" } },
  };
}

function sankeyFigure(nodes, links) {
  return {
    data: [{
      type: "sankey",
      arrangement: "snap",
      node: {
        label: (nodes || []).map((node) => node?.name || node?.label || node?.id || "Unknown"),
        color: (nodes || []).map((node, index) => ZONE_COLORS[node?.node_group] || stableColor(node?.node_group || node?.name || index)),
        line: { color: "#ffffff", width: 1 },
        pad: 20,
        thickness: 20,
      },
      link: {
        source: (links || []).map((link) => Number(link?.source || 0)),
        target: (links || []).map((link) => Number(link?.target || 0)),
        value: (links || []).map((link) => Number(link?.value ?? link?.weight ?? 1)),
        customdata: (links || []).map((link) => link?.pct_of_total),
        color: (links || []).map((link) => /pass/i.test(String(link?.link_group)) && !/fail/i.test(String(link?.link_group)) ? "rgba(0,158,115,0.28)" : "rgba(213,94,0,0.26)"),
        hovertemplate: "%{source.label} → %{target.label}<br><b>%{value:,}</b> MAGs (%{customdata:.1f}%)<extra></extra>",
      },
    }],
    layout: { height: 540, margin: { t: 24, r: 24, b: 28, l: 24 } },
  };
}

function hadegNetworkFigure(payload) {
  const nodes = payload?.network?.nodes || payload?.nodes || [];
  const edges = payload?.network?.edges || payload?.edges || [];
  const columns = ["hub", "gene", "mag"];
  const xByType = { hub: 0, gene: 1, mag: 2 };
  const positions = new Map();
  for (const type of columns) {
    const members = nodes
      .filter((node) => String(node?.type || "gene").toLowerCase() === type)
      .sort((a, b) => String(a?.label || a?.id).localeCompare(String(b?.label || b?.id)));
    members.forEach((node, index) => positions.set(String(node.id), {
      x: xByType[type],
      y: members.length <= 1 ? 0.5 : 1 - index / (members.length - 1),
      type,
    }));
  }

  const edgeX = [];
  const edgeY = [];
  for (const edge of edges) {
    const source = positions.get(String(edge?.source));
    const target = positions.get(String(edge?.target));
    if (!source || !target) continue;
    edgeX.push(source.x, target.x, null);
    edgeY.push(source.y, target.y, null);
  }
  const data = [{
    type: "scattergl", mode: "lines", x: edgeX, y: edgeY,
    line: { color: "rgba(100,116,139,0.22)", width: 1 },
    hoverinfo: "skip", showlegend: false,
  }];
  for (const type of columns) {
    const members = nodes.filter((node) => positions.get(String(node?.id))?.type === type);
    if (!members.length) continue;
    data.push({
      type: "scattergl",
      mode: type === "gene" ? "markers" : "markers+text",
      name: type === "mag" ? "MAG" : type[0].toUpperCase() + type.slice(1),
      x: members.map((node) => positions.get(String(node.id)).x),
      y: members.map((node) => positions.get(String(node.id)).y),
      text: members.map((node) => node?.label || node?.id),
      textposition: type === "hub" ? "middle left" : "middle right",
      textfont: { size: 10, color: "#334155" },
      customdata: members.map((node) => [node?.label || node?.id, node?.group || "Unclassified", Number(node?.size || 1)]),
      marker: {
        color: members.map((node) => type === "mag" ? "#D55E00" : type === "hub" ? "#E69F00" : stableColor(node?.group)),
        size: members.map((node) => type === "gene" ? Math.min(11, 4 + Math.sqrt(Number(node?.size || 1)) * 2) : Math.min(24, 10 + Math.sqrt(Number(node?.size || 1)) * 2)),
        opacity: type === "gene" ? 0.76 : 0.92,
        line: { color: "#ffffff", width: 1 },
      },
      hovertemplate: "<b>%{customdata[0]}</b><br>Group: %{customdata[1]}<br>Connections: %{customdata[2]:,}<extra>%{fullData.name}</extra>",
    });
  }
  return {
    data,
    layout: {
      height: 660,
      margin: { t: 58, r: 96, b: 36, l: 96 },
      xaxis: { visible: false, range: [-0.18, 2.18], fixedrange: true },
      yaxis: { visible: false, range: [-0.04, 1.04], fixedrange: true },
      annotations: [
        { x: 0, y: 1.06, text: "Pathway", showarrow: false, font: { size: 12, color: "#334155" } },
        { x: 1, y: 1.06, text: "Genes", showarrow: false, font: { size: 12, color: "#334155" } },
        { x: 2, y: 1.06, text: "MAGs", showarrow: false, font: { size: 12, color: "#334155" } },
      ],
    },
  };
}

export function buildFigure(renderer, payload, options = {}) {
  const compact = { margin: { t: 20, r: 25, b: 65, l: 70 }, hovermode: "closest" };

  if (["fastp_qc", "fastp_quality", "fastp_content", "fastp_rates", "fastp_retained"].includes(renderer)) {
    if (renderer === "fastp_rates") {
      const summary = payload?.summary || {};
      return {
        data: [
          { type: "bar", name: "Raw", x: ["Q20 rate", "Q30 rate"], y: [Number(summary.q20_raw || 0), Number(summary.q30_raw || 0)], marker: { color: STATE_COLORS.Raw, line: { color: "#ffffff", width: 0.8 } }, texttemplate: "%{y:.2f}%", textposition: "outside", cliponaxis: false, hovertemplate: "%{x}<br><b>%{y:.3f}%</b><extra>Raw</extra>" },
          { type: "bar", name: "Filtered", x: ["Q20 rate", "Q30 rate"], y: [Number(summary.q20_clean || 0), Number(summary.q30_clean || 0)], marker: { color: STATE_COLORS.Filtered, line: { color: "#ffffff", width: 0.8 } }, texttemplate: "%{y:.2f}%", textposition: "outside", cliponaxis: false, hovertemplate: "%{x}<br><b>%{y:.3f}%</b><extra>Filtered</extra>" },
        ],
        layout: { ...compact, barmode: "group", bargap: 0.28, xaxis: { title: "Quality threshold" }, yaxis: { title: "Percentage of bases (%)", range: [0, 105] } },
      };
    }
    if (renderer === "fastp_retained") {
      const summary = payload?.summary || {};
      const raw = Number(summary.tot_reads_before || 0);
      const filtered = Number(summary.tot_reads_clean || 0);
      return {
        data: [{ type: "bar", x: ["Raw reads", "Filtered reads"], y: [raw, filtered], marker: { color: [STATE_COLORS.Raw, STATE_COLORS.Filtered], line: { color: "#ffffff", width: 0.8 } }, text: [raw, filtered].map((value) => value.toLocaleString()), textposition: "outside", cliponaxis: false, hovertemplate: "%{x}<br><b>%{y:,}</b><extra></extra>" }],
        layout: { ...compact, showlegend: false, bargap: 0.38, xaxis: { title: "Read state" }, yaxis: { title: "Total read count", rangemode: "tozero", tickformat: "~s" } },
      };
    }
    const showContent = renderer === "fastp_content" || (renderer === "fastp_qc" && options.fastpView === "content");
    if (showContent) {
      const selectedRead = options.fastpRead || "R1";
      const selected = (payload?.content_curves || []).filter((row) => String(row?.read) === selectedRead);
      const traces = [];
      for (const [base, rows] of rowsBy(selected, "base")) {
        for (const [state, values] of rowsBy(rows, "state")) {
          const raw = /raw/i.test(state);
          traces.push({
            type: "scattergl", mode: "lines", name: `${base} · ${state}`,
            x: values.map((row) => row.position), y: values.map((row) => row.content),
            line: { color: BASE_COLORS[base] || stableColor(base), width: raw ? 1.5 : 2.4, dash: raw ? "dot" : "solid" },
            opacity: raw ? 0.65 : 0.95,
            hovertemplate: `Read ${selectedRead}<br>Position %{x:,}<br>${base}: <b>%{y:.2f}%</b><extra>${state}</extra>`,
          });
        }
      }
      return { data: traces, layout: { ...compact, hovermode: "x unified", xaxis: { title: "Read position (bp)" }, yaxis: { title: "Base content (%)", rangemode: "tozero" } } };
    }
    const grouped = rowsBy(payload?.quality_curves, "read");
    const traces = [];
    for (const [read, rows] of grouped) {
      for (const [state, values] of rowsBy(rows, "state")) {
        const cleaned = /clean|filter/i.test(state);
        traces.push({
          type: "scattergl", mode: "lines", name: `${read} · ${state}`,
          x: values.map((r) => r.position), y: values.map((r) => r.mean_quality),
          line: { color: STATE_COLORS[state] || (cleaned ? COLORS[0] : COLORS[1]), width: cleaned ? 2.5 : 1.7, dash: String(read).toUpperCase() === "R2" ? "dash" : "solid" },
          opacity: cleaned ? 0.96 : 0.78,
          hovertemplate: `${read} · ${state}<br>Position %{x:,}<br><b>Q%{y:.2f}</b><extra></extra>`,
        });
      }
    }
    return {
      data: traces,
      layout: {
        ...compact, hovermode: "x unified", xaxis: { title: "Read position (bp)" }, yaxis: { title: "Mean Phred quality score", rangemode: "tozero" },
        shapes: [20, 30].map((quality) => ({ type: "line", xref: "paper", x0: 0, x1: 1, y0: quality, y1: quality, line: { color: quality === 30 ? "#009E73" : "#E69F00", width: 1, dash: "dot" } })),
        annotations: [
          { xref: "paper", x: 1, y: 20, text: "Q20", showarrow: false, xanchor: "right", yshift: 9, font: { size: 10, color: "#A16207" } },
          { xref: "paper", x: 1, y: 30, text: "Q30", showarrow: false, xanchor: "right", yshift: 9, font: { size: 10, color: "#047857" } },
        ],
      },
    };
  }
  if (renderer === "metaquast_curve") {
    const traces = [...rowsBy(payload?.curve || [], "zone")].map(([zone, rows], index) => ({
      type: "scattergl", mode: "lines", name: zone,
      x: rows.map((r) => r.rank), y: rows.map((r) => r.length_bp),
      customdata: rows.map((r) => r.cumsum_mbp), line: { color: index === 0 ? "#1A6B8A" : "#6A3C2A", width: 2.4 },
      hovertemplate: "Rank %{x:,}<br><b>%{y:,} bp</b><br>Cumulative: %{customdata:.2f} Mbp<extra>%{fullData.name}</extra>",
    }));
    const n50 = Number(payload?.stats?.N50 || 0);
    return { data: traces, layout: { ...compact, xaxis: { title: "Contig rank", type: "log" }, yaxis: { title: "Contig length (bp)", type: "log" }, shapes: n50 > 0 ? [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: n50, y1: n50, line: { color: "#C0433A", width: 1.2, dash: "dash" } }] : [] } };
  }
  if (renderer === "checkm2_quality") {
    const traces = [...rowsBy(payload?.plot_data, "Zone")].map(([zone, rows]) => ({ type: "scatter", mode: "markers", name: `${zone} (n=${rows.length})`, x: rows.map((r) => r.Completeness), y: rows.map((r) => r.Contamination), text: rows.map((r) => r.Name), marker: { color: ZONE_COLORS[zone] || COLORS[0], size: 10, opacity: 0.9, line: { color: "#111827", width: 0.7 } }, hovertemplate: "<b>%{text}</b><br>Completeness %{x:.2f}%<br>Contamination %{y:.2f}%<extra>%{fullData.name}</extra>" }));
    const threshold = { color: "#64748B", width: 1, dash: "dash" };
    return { data: traces, layout: { ...compact, xaxis: { title: "Completeness (%)", range: [0, 102] }, yaxis: { title: "Contamination (%)", rangemode: "tozero" }, shapes: [{ type: "line", x0: 50, x1: 50, yref: "paper", y0: 0, y1: 1, line: threshold }, { type: "line", x0: 90, x1: 90, yref: "paper", y0: 0, y1: 1, line: threshold }, { type: "line", y0: 5, y1: 5, xref: "paper", x0: 0, x1: 1, line: threshold }, { type: "line", y0: 10, y1: 10, xref: "paper", x0: 0, x1: 1, line: threshold }] } };
  }
  if (renderer === "mapping_flagstat") {
    const stats = payload?.flagstat || {};
    const total = Number(stats["Total Reads"] || 0);
    const mapped = Number(stats["Mapped Reads"] || 0);
    const labels = ["Total reads", "Mapped reads", "Properly paired", "Singletons", "Unmapped reads"];
    const values = [total, mapped, Number(stats["Properly Paired"] || 0), Number(stats.Singletons || 0), Math.max(0, total - mapped)];
    return {
      data: [{
        type: "bar", orientation: "h", y: labels, x: values,
        marker: { color: ["#37474F", "#1565C0", "#2DC653", "#E07B39", "#E63946"], line: { color: "#ffffff", width: 0.8 } },
        customdata: values.map((value) => total > 0 ? value / total * 100 : 0),
        text: values.map((value) => value.toLocaleString()), textposition: "outside", cliponaxis: false,
        hovertemplate: "%{y}<br><b>%{x:,}</b> reads<br>%{customdata:.2f}% of total<extra></extra>",
      }],
      layout: { ...compact, height: 480, showlegend: false, xaxis: { title: "Absolute read count", rangemode: "tozero", tickformat: "~s" }, yaxis: { title: "Alignment metric", autorange: "reversed", showgrid: false }, margin: { t: 20, r: 70, b: 65, l: 125 } },
    };
  }
  if (renderer === "mapping_depth") {
    const traces = [...rowsBy(payload?.plot_data, "tier")].map(([tier, rows]) => ({ type: "scattergl", mode: "markers", name: `${tier} (n=${rows.length.toLocaleString()})`, x: rows.map((r) => r.length), y: rows.map((r) => r.depth), marker: { color: ZONE_COLORS[tier] || COLORS[0], size: 6, opacity: 0.64 }, hovertemplate: "Length %{x:,.0f} bp<br>Depth <b>%{y:.2f}×</b><extra>%{fullData.name}</extra>" }));
    return { data: traces, layout: { ...compact, xaxis: { title: "Contig length (bp, log scale)", type: "log" }, yaxis: { title: "Mean coverage depth (×, log scale)", type: "log" }, shapes: [5, 20].map((depth) => ({ type: "line", xref: "paper", x0: 0, x1: 1, y0: depth, y1: depth, line: { color: depth === 5 ? "#7F8C8D" : "#0072B2", width: 1.2, dash: "dash" } })) } };
  }
  if (renderer === "mapping_density") {
    return { data: [{ type: "scatter", mode: "lines", fill: "tozeroy", x: (payload?.plot_data || []).map((r) => r.x), y: (payload?.plot_data || []).map((r) => r.y), line: { color: "#4682B4", width: 2.5 }, fillcolor: "rgba(70,130,180,0.18)", hovertemplate: "log10(depth + 1): %{x:.3f}<br>Density: <b>%{y:.4g}</b><extra></extra>" }], layout: { ...compact, showlegend: false, xaxis: { title: "log10(average depth + 1)" }, yaxis: { title: "Density", rangemode: "tozero" } } };
  }
  if (renderer === "coverm_abundance") {
    const rows = [...(payload?.plot_data || [])].sort((a, b) => Number(b.rel_abund || 0) - Number(a.rel_abund || 0));
    const figure = barFigure(rows, "label", "rel_abund", "phylum", "h");
    return { ...figure, layout: { ...compact, height: Math.max(500, rows.length * 34 + 150), barmode: "stack", xaxis: { title: "Relative abundance (%)", rangemode: "tozero" }, yaxis: { categoryorder: "array", categoryarray: rows.map((row) => row.label).reverse(), showgrid: false } } };
  }
  if (renderer === "mag_alpha_summary") {
    const metrics = payload?.diversity_indices || {};
    const labels = ["MAG richness", "Shannon H′", "Gini-Simpson 1-D", "Pielou J′"];
    const values = [Number(metrics.richness_S || 0), Number(metrics.shannon_H || 0), Number(metrics.simpson_1D || 0), Number(metrics.pielou_J || 0)];
    return {
      data: [{ type: "bar", x: labels, y: values, marker: { color: ["#009E73", "#0072B2", "#D55E00", "#6F4E7C"], line: { color: "#ffffff", width: 0.8 } }, text: values.map((value) => value.toLocaleString(undefined, { maximumFractionDigits: 3 })), textposition: "outside", cliponaxis: false, hovertemplate: "%{x}<br><b>%{y:.4g}</b><extra></extra>" }],
      layout: { ...compact, showlegend: false, bargap: 0.35, xaxis: { title: "Diversity metric", tickangle: -16 }, yaxis: { title: "Diversity value", rangemode: "tozero" } },
    };
  }
  if (["mag_alpha", "mag_rank_abundance"].includes(renderer)) {
    return { data: [{ type: "scatter", mode: "lines+markers", x: (payload?.rank_abundance || []).map((r) => r.Rank), y: (payload?.rank_abundance || []).map((r) => r.renorm_abund_pct), line: { color: "#1F78B4", width: 2.4 }, marker: { color: "#ffffff", line: { color: "#1F78B4", width: 1.5 }, size: 7 }, hovertemplate: "Rank %{x:,}<br><b>%{y:.4f}%</b><extra></extra>" }], layout: { ...compact, showlegend: false, xaxis: { title: "Species/MAG rank" }, yaxis: { title: "Relative abundance (%, log scale)", type: "log" } } };
  }
  if (renderer === "gtdbtk_taxonomy") return taxonomySunburst(payload?.taxonomy_data || []);
  if (renderer === "bracken_sunburst") {
    const data = payload?.sunburst || { labels: [], parents: [], values: [] };
    return {
      data: [{
        type: "sunburst",
        ids: data.labels,
        labels: data.labels,
        parents: data.parents,
        values: data.values,
        branchvalues: "total",
        insidetextorientation: "radial",
        marker: { colors: data.labels.map(label => stableColor(label)), line: { color: "#ffffff", width: 1 } },
        hovertemplate: "<b>%{label}</b><br>Abundance: %{value:.2%}<extra></extra>"
      }],
      layout: { ...compact, height: 580, margin: { t: 18, r: 18, b: 18, l: 18 } }
    };
  }
  if (renderer === "meta_amr") {
    const dbData = payload?.heatmap_data || {};
    const dbs = Object.keys(dbData);
    if (dbs.length > 0) {
      const db = dbs[0];
      const data = dbData[db];
      return {
        data: [{
          type: "heatmap",
          x: data.genes,
          y: data.mags,
          z: data.matrix,
          colorscale: [[0, "#f8fafc"], [1, "#ef4444"]],
          showscale: false,
          hovertemplate: "MAG: %{y}<br>Gene: %{x}<br>Detected: %{z}<extra></extra>"
        }],
        layout: { 
          ...compact, 
          height: Math.max(400, (data.mags.length || 0) * 25 + 150),
          title: `AMR Hits (${db})`,
          xaxis: { title: "Resistance Gene", tickangle: -45, automargin: true },
          yaxis: { title: "MAG", automargin: true }
        }
      };
    }
    return { ...barFigure(payload?.hits_per_database || [], "database", "hits"), layout: { ...compact, xaxis: { title: "Database" }, yaxis: { title: "Detected hits", rangemode: "tozero" } } };
  }
  if (renderer === "gunc_sankey") return sankeyFigure(payload?.sankey?.nodes || [], payload?.sankey?.links || []);
  if (["cctyper_synteny", "cctyper_subtypes", "cctyper_genemap"].includes(renderer)) {
    const showSynteny = renderer === "cctyper_genemap" || (renderer === "cctyper_synteny" && options.cctyperView === "synteny");
    if (!showSynteny) {
      const counts = new Map();
      for (const row of payload?.operons || []) {
        const prediction = String(row?.Prediction || "Ambiguous");
        const status = String(row?.Status || "Unspecified");
        const key = `${prediction}\u0000${status}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      const predictions = [...new Set([...counts.keys()].map((key) => key.split("\u0000")[0]))];
      predictions.sort((a, b) => [...counts].filter(([key]) => key.startsWith(`${b}\u0000`)).reduce((sum, [, value]) => sum + value, 0) - [...counts].filter(([key]) => key.startsWith(`${a}\u0000`)).reduce((sum, [, value]) => sum + value, 0));
      const statuses = [...new Set([...counts.keys()].map((key) => key.split("\u0000")[1]))];
      const traces = statuses.map((status) => ({ type: "bar", orientation: "h", name: status, y: predictions, x: predictions.map((prediction) => counts.get(`${prediction}\u0000${status}`) || 0), marker: { color: /valid/i.test(status) ? "#0072B2" : "#E69F00", line: { color: "#ffffff", width: 0.8 } }, hovertemplate: "%{y}<br><b>%{x:,}</b> loci<extra>%{fullData.name}</extra>" }));
      return { data: traces, layout: { ...compact, height: Math.max(500, predictions.length * 34 + 170), barmode: "stack", xaxis: { title: "Locus count", rangemode: "tozero" }, yaxis: { title: "Subtype prediction", autorange: "reversed", showgrid: false } } };
    }
    const allLocusIds = [...new Set((payload?.genes_synteny || []).map((row) => String(row.Locus_ID)))];
    const pageSize = 10;
    const locusIds = allLocusIds.slice(Number(options.cctyperPage || 0) * pageSize, (Number(options.cctyperPage || 0) + 1) * pageSize);
    const genes = (payload?.genes_synteny || [])
      .filter((row) => locusIds.includes(String(row.Locus_ID)))
      .filter((row) => Number.isFinite(Number(row.Start)) && Number.isFinite(Number(row.End)))
      .slice(0, 3000);
    const yByLocus = new Map(locusIds.map((locus, index) => [locus, index]));
    const starts = genes.map((row) => Math.min(Number(row.Start), Number(row.End)));
    const ends = genes.map((row) => Math.max(Number(row.Start), Number(row.End)));
    const minX = starts.length ? Math.min(...starts) : 0;
    const maxX = ends.length ? Math.max(...ends) : 1;
    const span = Math.max(1, maxX - minX);
    const traces = [];
    const labelAnnotations = [];

    for (const [module, rows] of rowsBy(genes, "Module")) {
      const polygonX = [];
      const polygonY = [];
      const centerX = [];
      const centerY = [];
      const customdata = [];
      for (const row of rows) {
        const start = Math.min(Number(row.Start), Number(row.End));
        const end = Math.max(Number(row.Start), Number(row.End));
        const length = Math.max(1, end - start);
        const y = yByLocus.get(String(row.Locus_ID));
        if (y == null) continue;
        const halfHeight = module === "CRISPR array" ? 0.19 : 0.27;
        const direction = Number(row.Direction || row.Strand || 0);
        const head = Math.min(length * 0.32, Math.max(28, span * 0.012));
        let xPoints;
        if (direction < 0) {
          xPoints = [end, start + head, start, start + head, end, end];
        } else if (direction > 0) {
          xPoints = [start, end - head, end, end - head, start, start];
        } else {
          xPoints = [start, end, end, start, start];
        }
        const yPoints = direction === 0
          ? [y - halfHeight, y - halfHeight, y + halfHeight, y + halfHeight, y - halfHeight]
          : [y - halfHeight, y - halfHeight, y, y + halfHeight, y + halfHeight, y - halfHeight];
        polygonX.push(...xPoints, null);
        polygonY.push(...yPoints, null);
        centerX.push((start + end) / 2);
        centerY.push(y);
        customdata.push([row.Gene || "Unknown", row.Strand, start, end, row.Contig || ""]);
        if (genes.length <= 90 || module === "CRISPR array") {
          labelAnnotations.push({
            x: (start + end) / 2,
            y: y - 0.34,
            text: String(row.Gene || "Unknown"),
            showarrow: false,
            textangle: -28,
            font: { size: 8, color: "#475569" },
            xanchor: "center",
            yanchor: "bottom",
          });
        }
      }
      const color = CCTYPER_MODULE_COLORS[module] || stableColor(module);
      traces.push({
        type: "scatter", mode: "lines", name: module,
        x: polygonX, y: polygonY, fill: "toself", fillcolor: color,
        line: { color: "#ffffff", width: 0.8 }, hoverinfo: "skip",
      });
      traces.push({
        type: "scatter", mode: "markers", name: `${module} details`, showlegend: false,
        x: centerX, y: centerY, customdata,
        marker: { size: 18, color: "rgba(0,0,0,0.001)" },
        hovertemplate: "<b>%{customdata[0]}</b><br>%{customdata[4]}<br>%{customdata[2]:,}–%{customdata[3]:,} bp · strand %{customdata[1]}<extra>" + module + "</extra>",
      });
    }

    const padding = Math.max(100, span * 0.035);
    return {
      data: traces,
      layout: {
        ...compact,
        height: Math.max(560, locusIds.length * 76 + 175),
        hovermode: "closest",
        xaxis: { title: "Contig coordinate (bp)", range: [Math.max(0, minX - padding), maxX + padding], tickformat: "~s" },
        yaxis: { tickmode: "array", tickvals: locusIds.map((_, index) => index), ticktext: locusIds, range: [locusIds.length - 0.55, -0.75], showgrid: false, automargin: true },
        margin: { t: 58, r: 32, b: 72, l: 205 },
        shapes: locusIds.map((_, index) => ({ type: "line", x0: minX, x1: maxX, y0: index, y1: index, line: { color: "#cbd5e1", width: 1.2 }, layer: "below" })),
        annotations: labelAnnotations,
      },
    };
  }
  if (renderer === "dbcan_composition") return { ...barFigure(payload?.plot_data || [], "mag", "count", "cazy_class"), layout: { ...compact, barmode: "stack", xaxis: { title: "MAG" }, yaxis: { title: "CAZyme domains", rangemode: "tozero" } } };
  if (renderer === "prokka_features") {
    const rows = payload?.mags || [];
    const structural = ["tRNA", "rRNA", "tmRNA", "repeat_region", "other_genes"];
    const data = [{ type: "bar", name: "CDS", x: rows.map((r) => r.Bin_Label), y: rows.map((r) => Number(r.CDS || 0)), customdata: rows.map((r) => r.MAG_ID), marker: { color: "#0072B2", line: { color: "#ffffff", width: 0.7 } }, hovertemplate: "%{customdata}<br><b>%{y:,}</b> CDS<extra></extra>" }];
    data.push(...structural.map((feature) => ({ type: "bar", name: feature.replaceAll("_", " "), x: rows.map((r) => r.Bin_Label), y: rows.map((r) => Number(r[feature] || 0)), xaxis: "x2", yaxis: "y2", customdata: rows.map((r) => r.MAG_ID), marker: { color: stableColor(feature), line: { color: "#ffffff", width: 0.7 } }, hovertemplate: "%{customdata}<br>%{fullData.name}: <b>%{y:,}</b><extra></extra>" })));
    return { data, layout: { ...compact, height: 650, grid: { rows: 2, columns: 1, pattern: "independent", roworder: "top to bottom", ygap: 0.22 }, barmode: "stack", xaxis: { showticklabels: false }, yaxis: { title: "Protein-coding genes" }, xaxis2: { title: "MAG", tickangle: rows.length > 12 ? -45 : 0 }, yaxis2: { title: "RNA / repeat features" } } };
  }
  if (renderer === "hadeg_network") {
    return hadegNetworkFigure(payload);
  }
  if (renderer === "virsorter_scores") {
    const traces = [...rowsBy(payload?.records, "group")].map(([group, rows]) => ({ type: "histogram", name: group, x: rows.map((r) => r.score), opacity: 0.78, autobinx: false, xbins: { start: 0, end: 1, size: 0.05 }, marker: { color: stableColor(group), line: { color: "#ffffff", width: 0.7 } } }));
    return { data: traces, layout: { ...compact, barmode: "stack", bargap: 0.04, xaxis: { title: "Maximum classifier score", range: [0, 1] }, yaxis: { title: "Number of sequences", rangemode: "tozero" }, shapes: [{ type: "line", x0: 0.5, x1: 0.5, yref: "paper", y0: 0, y1: 1, line: { color: "#E69F00", dash: "dash", width: 1.3 } }, { type: "line", x0: 0.9, x1: 0.9, yref: "paper", y0: 0, y1: 1, line: { color: "#009E73", dash: "dash", width: 1.3 } }] } };
  }
  if (renderer === "metaphlan_alpha_summary") {
    const metrics = payload?.genus_metrics || {};
    const labels = ["Observed genera", "Shannon H′", "Gini-Simpson 1-D"];
    const values = [Number(metrics.observed || 0), Number(metrics.shannon || 0), Number(metrics.simpson || 0)];
    return {
      data: [{ type: "bar", x: labels, y: values, marker: { color: ["#009E73", "#0072B2", "#D55E00"], line: { color: "#ffffff", width: 0.8 } }, text: values.map((value) => value.toLocaleString(undefined, { maximumFractionDigits: 3 })), textposition: "outside", cliponaxis: false, hovertemplate: "%{x}<br><b>%{y:.4g}</b><extra></extra>" }],
      layout: { ...compact, showlegend: false, bargap: 0.38, xaxis: { title: "Genus-level diversity metric", tickangle: -12 }, yaxis: { title: "Diversity value", rangemode: "tozero" } },
    };
  }
  if (renderer === "metaphlan_rank_abundance") {
    const rows = payload?.genus_rank_abundance || [];
    return {
      data: [{ type: "scatter", mode: "lines+markers", x: rows.map((row) => row.rank), y: rows.map((row) => row.abundance), customdata: rows.map((row) => row.name), line: { color: "#0072B2", width: 2.4 }, marker: { color: "#0072B2", size: 5 }, hovertemplate: "Rank %{x:,}<br><b>%{y:.5f}%</b><br>%{customdata}<extra></extra>" }],
      layout: { ...compact, showlegend: false, xaxis: { title: "Genus rank (1 = most abundant)" }, yaxis: { title: "Relative abundance (%, log scale)", type: "log" } },
    };
  }
  if (renderer === "metaphlan_species") {
    const rows = [...(payload?.top_species || [])].sort((a, b) => Number(a.abund || 0) - Number(b.abund || 0));
    const shapes = rows.map((row) => ({ type: "line", x0: 0, x1: Number(row.abund || 0), y0: row.name, y1: row.name, line: { color: "#cbd5e1", width: 2 } }));
    const traces = [...rowsBy(rows, "phylum")].map(([phylum, values]) => ({ type: "scatter", mode: "markers", name: phylum, x: values.map((row) => row.abund), y: values.map((row) => row.name), marker: { color: stableColor(phylum), size: 11, line: { color: "#ffffff", width: 1 } }, hovertemplate: "<b>%{y}</b><br>%{x:.4f}%<extra>%{fullData.name}</extra>" }));
    return { data: traces, layout: { ...compact, height: Math.max(500, rows.length * 35 + 150), shapes, xaxis: { title: "Relative abundance (%)", rangemode: "tozero" }, yaxis: { title: "Species", showgrid: false } } };
  }
  if (renderer === "read_alpha") {
    return { data: [{ type: "scatter", mode: "lines+markers", x: (payload?.rank_abundance || []).map((r) => r.rank), y: (payload?.rank_abundance || []).map((r) => r.abundance), line: { color: "#0072B2", width: 2.4 }, marker: { color: "#0072B2", size: 6 }, hovertemplate: "Rank %{x:,}<br><b>%{y:.5f}%</b><extra></extra>" }], layout: { ...compact, showlegend: false, xaxis: { title: "Species rank (1 = most abundant)" }, yaxis: { title: "Relative abundance (%, log scale)", type: "log" } } };
  }
  if (renderer === "nonpareil_curve") {
    const observed = (payload?.observed || []).filter((r) => Number(r.x) > 0);
    const fitted = (payload?.fitted || []).filter((r) => Number(r.x) > 0);
    return { data: [{ type: "scatter", mode: "markers", name: "Observed", x: observed.map((r) => r.x), y: observed.map((r) => r.y), marker: { color: "#8C8C8C", size: 6, opacity: 0.72 } }, { type: "scatter", mode: "lines", name: "Fitted model", x: fitted.map((r) => r.x), y: fitted.map((r) => r.y), line: { color: "#009E73", width: 3 } }], layout: { ...compact, xaxis: { title: "Sequencing effort (bp, log scale)", type: "log" }, yaxis: { title: "Estimated average coverage", range: [0, 1.02] }, shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 0.95, y1: 0.95, line: { color: "#D55E00", width: 1.2, dash: "dash" } }] } };
  }
  if (renderer === "nanostat_qc") {
    const rows = (payload?.yield_metrics || []).filter((row) => row.raw != null || row.cleaned != null);
    const data = rows.map((row, index) => ({
      type: "bar", x: ["Raw", "Filtered"], y: [Number(row.raw || 0), Number(row.cleaned || 0)],
      marker: { color: [STATE_COLORS.Raw, STATE_COLORS.Filtered], line: { color: "#ffffff", width: 1 } },
      text: [row.raw, row.cleaned].map((value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })), textposition: "outside", cliponaxis: false,
      showlegend: false, xaxis: index === 0 ? "x" : `x${index + 1}`, yaxis: index === 0 ? "y" : `y${index + 1}`,
      hovertemplate: `%{x}<br><b>%{y:,.4g}</b><extra>${row.metric}</extra>`,
    }));
    const layout = { ...compact, grid: { rows: 1, columns: Math.max(rows.length, 1), pattern: "independent", xgap: 0.12 }, bargap: 0.35, annotations: rows.map((row, index) => ({ xref: index === 0 ? "x domain" : `x${index + 1} domain`, yref: "paper", x: 0.5, y: 1.06, text: row.metric, showarrow: false, font: { size: 12, color: "#334155" } })) };
    rows.forEach((row, index) => {
      layout[index === 0 ? "xaxis" : `xaxis${index + 1}`] = { showgrid: false };
      layout[index === 0 ? "yaxis" : `yaxis${index + 1}`] = { title: row.metric, rangemode: "tozero" };
    });
    return { data, layout };
  }
  if (renderer === "wgs_amr") return { ...barFigure(payload?.hits_per_database || [], "database", "hits"), layout: { ...compact, xaxis: { title: "Database" }, yaxis: { title: "Detected hits", rangemode: "tozero" } } };
  if (renderer === "wgs_cazymes") return { ...barFigure(payload?.class_counts || [], "class", "count"), layout: { ...compact, xaxis: { title: "CAZyme class" }, yaxis: { title: "Genes", rangemode: "tozero" } } };
  if (renderer === "wgs_quality") {
    const checkm = payload?.checkm || {};
    const busco = payload?.busco || {};
    const labels = ["CheckM completeness", "CheckM contamination", "BUSCO complete", "BUSCO fragmented", "BUSCO missing"];
    const values = [checkm.completeness, checkm.contamination, busco.complete, busco.fragmented, busco.missing].map((v) => Number(v || 0));
    return { data: [{ type: "bar", x: labels, y: values, marker: { color: [COLORS[1], COLORS[4], COLORS[0], COLORS[2], "#94a3b8"] }, hovertemplate: "%{x}<br>%{y:.2f}%<extra></extra>" }], layout: { ...compact, xaxis: { automargin: true }, yaxis: { title: "Percent", range: [0, 102] }, showlegend: false } };
  }
  if (renderer === "wgs_cog") return { ...barFigure(payload?.cog_categories || [], "letter", "count", "class"), layout: { ...compact, barmode: "stack", xaxis: { title: "COG category" }, yaxis: { title: "Proteins", rangemode: "tozero" } } };
  if (renderer === "wgs_interpro") return { ...barFigure(payload?.db_distribution || [], "database", "count"), layout: { ...compact, xaxis: { title: "Annotation database", automargin: true }, yaxis: { title: "Matches", rangemode: "tozero" } } };
  if (renderer === "wgs_kofam") return { ...barFigure(payload?.functional_categories || [], "category", "count", null, "h"), layout: { ...compact, xaxis: { title: "KO hits" }, yaxis: { automargin: true, autorange: "reversed" } } };
  if (renderer === "wgs_prokka") return { ...barFigure(payload?.functional_categories || [], "category", "count", null, "h"), layout: { ...compact, xaxis: { title: "CDS count" }, yaxis: { automargin: true, autorange: "reversed" } } };
  if (renderer === "wgs_repeats") {
    const x = payload?.divergence_bins || [];
    const traces = (payload?.repeat_landscape || []).map((row, index) => ({ type: "bar", name: row.group, x, y: row.counts || [], marker: { color: COLORS[index % COLORS.length] } }));
    return { data: traces, layout: { ...compact, barmode: "stack", xaxis: { title: "Kimura divergence (%)" }, yaxis: { title: "Repeat hits", rangemode: "tozero" } } };
  }
  return { data: [], layout: compact };
}

export function summaryValues(payload) {
  const sources = [payload?.summary, payload?.stats, payload?.metrics, payload?.diversity_indices, payload?.depth_summary, payload?.counts, payload?.flagstat];
  const values = [];
  const seen = new Set();
  for (const source of sources) {
    for (const [label, value] of Object.entries(source || {})) {
      if (seen.has(label) || !["string", "number", "boolean"].includes(typeof value)) continue;
      values.push([label, value]);
      seen.add(label);
      if (values.length >= 8) return values;
    }
  }
  return values;
}

function metricValue(value) {
  if (typeof value !== "number") return String(value);
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1_000_000) return value.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 2 });
  return value.toLocaleString(undefined, { maximumFractionDigits: Math.abs(value) < 10 ? 3 : 2 });
}

let plotlyModulePromise;

async function loadPlotly() {
  if (!plotlyModulePromise) {
    plotlyModulePromise = import("plotly.js-dist-min").then((module) => module.default || module);
  }
  return plotlyModulePromise;
}

export async function renderAnalysisPlotToPng(renderer, payload, options = {}) {
  const plotly = await loadPlotly();
  const width = Math.max(760, Math.min(Number(options.width || 1180), 1600));
  const height = Math.max(440, Math.min(Number(options.height || 650), 1000));
  const figure = scientificFigure(buildFigure(renderer, payload || {}, options), options);
  if (!figure?.data?.length) throw new Error("This result contains no plottable records.");
  const node = document.createElement("div");
  node.setAttribute("aria-hidden", "true");
  Object.assign(node.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: `${width}px`,
    height: `${height}px`,
    background: "#ffffff",
    pointerEvents: "none",
  });
  document.body.appendChild(node);
  try {
    await plotly.newPlot(
      node,
      figure.data,
      { ...figure.layout, width, height, autosize: false, paper_bgcolor: "#ffffff", plot_bgcolor: "#ffffff" },
      { staticPlot: true, displayModeBar: false, responsive: false }
    );
    return await plotly.toImage(node, { format: "png", width, height, scale: 1 });
  } finally {
    plotly.purge(node);
    node.remove();
  }
}

export default function AnalysisPlot({ renderer, payload, expanded = false, plotStyle = "modern", publicationPalette = "okabe_ito", showMetrics = true }) {
  const shellRef = useRef(null);
  const plotRef = useRef(null);
  const [error, setError] = useState("");
  const [nearViewport, setNearViewport] = useState(false);
  const [rendering, setRendering] = useState(true);
  const [fastpView, setFastpView] = useState("quality");
  const [fastpRead, setFastpRead] = useState("R1");
  const [cctyperView, setCctyperView] = useState("summary");
  const [cctyperPage, setCctyperPage] = useState(0);
  const reads = useMemo(() => [...new Set((payload?.content_curves || []).map((row) => String(row.read)))], [payload]);
  const cctyperLoci = useMemo(() => [...new Set((payload?.genes_synteny || []).map((row) => String(row.Locus_ID)))], [payload]);
  const cctyperPages = Math.max(1, Math.ceil(cctyperLoci.length / 10));
  const options = useMemo(
    () => ({ fastpView, fastpRead, cctyperView, cctyperPage, plotStyle, publicationPalette }),
    [fastpView, fastpRead, cctyperView, cctyperPage, plotStyle, publicationPalette]
  );
  const figure = useMemo(() => scientificFigure(buildFigure(renderer, payload || {}, options), options), [renderer, payload, options]);
  const metrics = useMemo(() => summaryValues(payload), [payload]);
  const plotHeight = Math.max(expanded ? 560 : 440, Number(figure?.layout?.height || (expanded ? 580 : 480)));
  const publicationMode = plotStyle === "publication";
  const plotConfig = useMemo(() => plotConfiguration({ doubleClick: "reset+autosize" }), []);
  const plotlyRef = useRef(null);

  useEffect(() => {
    setFastpView("quality");
    setFastpRead("R1");
    setCctyperView("summary");
    setCctyperPage(0);
    setError("");
    setRendering(true);
  }, [renderer, payload?.sample_id]);

  useEffect(() => {
    const node = shellRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setNearViewport(true);
        observer.disconnect();
      }
    }, { rootMargin: "900px 0px", threshold: 0.01 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let plotly;
    const plotNode = plotRef.current;
    if (!nearViewport || !plotNode) return undefined;
    setRendering(true);
    (async () => {
      try {
        plotly = await loadPlotly();
        plotlyRef.current = plotly;
        if (cancelled || !plotNode) return;
        if (!figure.data.length) throw new Error("This result contains no plottable records.");
        const original = copyPlotFigure(figure);
        await plotly.react(
          plotNode,
          original.data,
          original.layout,
          plotConfig
        );
        if (!cancelled) setError("");
      } catch (plotError) {
        if (!cancelled) setError(plotError?.message || String(plotError));
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => {
      cancelled = true;
      if (plotly && plotNode) plotly.purge(plotNode);
      if (plotlyRef.current === plotly) plotlyRef.current = null;
    };
  }, [figure, nearViewport, renderer, plotConfig]);

  return (
    <div ref={shellRef} className="min-w-0 max-w-full">
      <div className={`mb-3 flex justify-end border-b pb-3 ${publicationMode ? "border-slate-200" : "border-sky-100/80"}`}>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {renderer === "fastp_qc" && (
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1" role="group" aria-label="fastp plot view">
              {[{ id: "quality", label: "Quality" }, { id: "content", label: "Base content" }].map((option) => (
                <button key={option.id} type="button" onClick={() => setFastpView(option.id)} className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${fastpView === option.id ? "bg-white text-sky-800 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-800"}`}>{option.label}</button>
              ))}
            </div>
          )}
          {((renderer === "fastp_qc" && fastpView === "content") || renderer === "fastp_content") && reads.length > 1 && (
            <select value={fastpRead} onChange={(event) => setFastpRead(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 outline-none focus:border-sky-400" aria-label="Select read for base-content plot">
              {reads.map((read) => <option key={read} value={read}>{read}</option>)}
            </select>
          )}
          {renderer === "cctyper_synteny" && (
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1" role="group" aria-label="CRISPR-Cas plot view">
              {[{ id: "summary", label: "Subtype summary" }, { id: "synteny", label: "Gene maps" }].map((option) => (
                <button key={option.id} type="button" onClick={() => setCctyperView(option.id)} className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${cctyperView === option.id ? "bg-white text-sky-800 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-800"}`}>{option.label}</button>
              ))}
            </div>
          )}
          {((renderer === "cctyper_synteny" && cctyperView === "synteny") || renderer === "cctyper_genemap") && cctyperPages > 1 && (
            <select value={cctyperPage} onChange={(event) => setCctyperPage(Number(event.target.value))} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 outline-none focus:border-sky-400" aria-label="Select CRISPR-Cas locus page">
              {Array.from({ length: cctyperPages }, (_, index) => <option key={index} value={index}>Loci {index * 10 + 1}–{Math.min((index + 1) * 10, cctyperLoci.length)}</option>)}
            </select>
          )}
          <PlotControls plotRef={plotRef} plotlyRef={plotlyRef} figure={figure} config={plotConfig} disabled={rendering || Boolean(error)} publication={publicationMode} filename={renderer || "analysis-plot"} />
        </div>
      </div>
      {showMetrics && metrics.length > 0 && (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {metrics.map(([label, value]) => (
            <div key={label} className={`min-w-0 rounded-xl border px-3 py-2.5 ${publicationMode ? "border-slate-200 bg-white" : "border-sky-100 bg-gradient-to-br from-white to-sky-50/75 shadow-[0_8px_22px_-20px_rgba(2,132,199,0.8)]"}`}>
              <div className="truncate text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400" title={label.replaceAll("_", " ")}>{label.replaceAll("_", " ")}</div>
              <div className="mt-1 truncate font-mono text-[13px] font-semibold tabular-nums text-slate-800" title={String(value)}>{metricValue(value)}</div>
            </div>
          ))}
        </div>
      )}
      <div className={`relative min-w-0 max-w-full overflow-hidden rounded-xl border bg-white ${publicationMode ? "border-slate-300 shadow-none" : "border-sky-100 shadow-[0_16px_42px_-30px_rgba(2,132,199,0.65)]"}`} style={{ minHeight: plotHeight, touchAction: "pan-y", contain: "layout paint" }}>
        {error && <div className="absolute inset-x-3 top-3 z-10 rounded-xl border border-rose-200 bg-rose-50/95 p-3 text-xs text-rose-700 shadow-sm">{error}</div>}
        {!nearViewport && (
          <div className="absolute inset-0 z-10 overflow-hidden bg-gradient-to-br from-slate-50 via-white to-sky-50/60 p-8" aria-label="Visualization queued">
            <div className="h-full animate-pulse rounded-xl border border-slate-200/80 bg-white/65 p-6">
              <div className="h-3 w-32 rounded bg-slate-200" />
              <div className="mt-8 h-[70%] rounded-lg bg-[linear-gradient(to_right,transparent_49%,rgba(148,163,184,0.16)_50%),linear-gradient(to_bottom,transparent_49%,rgba(148,163,184,0.16)_50%)] bg-[size:48px_48px]" />
            </div>
          </div>
        )}
        {nearViewport && rendering && !error && (
          <div className="absolute inset-0 z-10 overflow-hidden bg-white/94 p-8">
            <div className="h-full animate-pulse rounded-xl border border-slate-200/80 bg-slate-50/70 p-6">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-slate-500">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-200 border-t-sky-600" />
                Preparing visualization…
              </div>
              <div className="mt-8 h-[70%] rounded-lg bg-[linear-gradient(to_right,transparent_49%,rgba(148,163,184,0.16)_50%),linear-gradient(to_bottom,transparent_49%,rgba(148,163,184,0.16)_50%)] bg-[size:48px_48px]" />
            </div>
          </div>
        )}
        <div ref={plotRef} className="min-w-0 max-w-full" style={{ height: plotHeight }} role="img" aria-label={`${renderer} interactive plot`} />
      </div>
    </div>
  );
}
