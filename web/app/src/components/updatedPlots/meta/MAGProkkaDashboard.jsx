import React, { useEffect, useMemo, useState } from "react";
import Plot from "../UpdatedPlot.jsx";

// Factory pattern: bypasses the broken internal `plotly.js/dist/plotly` import
// in react-plotly.js that fails under webpack 5 strict ESM resolution.


/**
 * MAGProkkaDashboard
 * ------------------
 * Publication-ready, diverging (population-pyramid) stacked horizontal bar chart
 * of Prokka gene-feature composition per MAG. Reads the JSON produced by
 * prokka_feature_json.py (place it in the CRA /public folder).
 *
 * Usage:
 *   <MAGProkkaDashboard src="/mag_prokka_plots_data.json" />
 *
 * Props:
 *   src       JSON path relative to the app's public root.
 *   rowHeight px per bin row (default 22).
 */
export default function MAGProkkaDashboard({
  src = "/mag_prokka_plots_data.json",
  rowHeight = 22,
}) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    const url = src;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load ${url} (HTTP ${r.status})`);
        return r.json();
      })
      .then((d) => alive && setDoc(d))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [src]);

  const figure = useMemo(() => {
    if (!doc) return null;

    const { meta, layout, bins } = doc;
    const scale = meta.scale_factor || 1;
    const colors = layout.colors;
    const binLabels = bins.map((b) => b.bin);
    const legendRank = Object.fromEntries(
      (layout.legend_order || []).map((f, i) => [f, i])
    );

    // Horizontal-bar trace per feature. Left features negated & scaled;
    // customdata carries the REAL count for hover display.
    const makeTrace = (feature, side) => {
      const raw = bins.map((b) => b.counts[feature] || 0);
      const x = raw.map((v) => (side === "left" ? -v * scale : v));
      return {
        type: "bar",
        orientation: "h",
        name: feature,
        y: binLabels,
        x,
        customdata: raw,
        marker: {
          color: colors[feature],
          line: { color: "rgba(20,20,20,0.55)", width: 0.5 },
        },
        legendrank: legendRank[feature] ?? 99,
        hovertemplate:
          `<b>${feature}</b><br>%{customdata:,} features` +
          `<br>%{y}<extra></extra>`,
      };
    };

    // Stack order = zero line outward: earlier traces sit nearest zero.
    const traces = [
      ...layout.right_order.map((f) => makeTrace(f, "right")),
      ...layout.left_order.map((f) => makeTrace(f, "left")),
    ];

    // ---- axis extents & absolute-value ticks -------------------------------
    const rightMax = Math.max(
      1,
      ...bins.map(
        (b) => (b.counts["CDS"] || 0) + (b.counts["Other/Pseudogenes"] || 0)
      )
    );
    const leftScaledMax = Math.max(
      1,
      ...bins.map(
        (b) =>
          ((b.counts["tRNA"] || 0) +
            (b.counts["rRNA"] || 0) +
            (b.counts["tmRNA"] || 0) +
            (b.counts["Repeat Regions"] || 0)) *
          scale
      )
    );
    const upper = rightMax * 1.12;
    const lower = -leftScaledMax * 1.05;

    const niceStep = (span, target = 7) => {
      const raw = span / target;
      const mag = Math.pow(10, Math.floor(Math.log10(raw)));
      const n = raw / mag;
      const nice = n >= 7.5 ? 10 : n >= 3.5 ? 5 : n >= 1.5 ? 2 : 1;
      return nice * mag;
    };
    const step = niceStep(upper - lower);
    const tickvals = [];
    for (let v = 0; v <= upper; v += step) tickvals.push(v);
    for (let v = -step; v >= lower; v -= step) tickvals.push(v);
    tickvals.sort((a, b) => a - b);
    const ticktext = tickvals.map((v) => Math.abs(v).toLocaleString());

    // ---- CDS count labels at right bar ends --------------------------------
    const cdsAnnotations = bins.map((b) => ({
      x: (b.counts["CDS"] || 0) + (b.counts["Other/Pseudogenes"] || 0),
      y: b.bin,
      text: (b.counts["CDS"] || 0).toLocaleString(),
      xanchor: "left",
      yanchor: "middle",
      xshift: 4,
      showarrow: false,
      font: {
        size: 10,
        color: "#333",
        family: "Inter, Helvetica, Arial, sans-serif",
      },
    }));

    const font = {
      family: "Inter, Helvetica, Arial, sans-serif",
      color: "#1a1a1a",
    };

    const plotLayout = {
      title: {
        text:
          `<b>${meta.title}</b>` +
          `<br><span style="font-size:12px;color:#666">` +
          `Sample ${meta.sample_id} · ${meta.n_bins} MAGs</span>`,
        x: 0.01,
        xanchor: "left",
        font: { ...font, size: 19 },
      },
      barmode: "relative",
      bargap: 0.18,
      font,
      paper_bgcolor: "#ffffff",
      plot_bgcolor: "#ffffff",
      xaxis: {
        title: { text: layout.axis_title, font: { ...font, size: 13 } },
        range: [lower, upper],
        tickvals,
        ticktext,
        tickfont: { ...font, size: 11 },
        showgrid: true,
        gridcolor: "rgba(0,0,0,0.06)",
        zeroline: true,
        zerolinecolor: "#111",
        zerolinewidth: 1.4,
        ticks: "outside",
        tickcolor: "rgba(0,0,0,0.4)",
      },
      yaxis: {
        categoryorder: "array",
        categoryarray: binLabels,
        tickfont: { ...font, size: 11 },
        showgrid: false,
        ticks: "outside",
        tickcolor: "rgba(0,0,0,0.4)",
        automargin: true,
      },
      legend: {
        orientation: "h",
        traceorder: "normal",
        x: 0.5,
        xanchor: "center",
        y: 1.02,
        yanchor: "bottom",
        font: { ...font, size: 12 },
        title: { text: "" },
      },
      annotations: cdsAnnotations,
      margin: { l: 64, r: 28, t: 96, b: 76 },
      height: Math.max(420, meta.n_bins * rowHeight + 190),
    };

    const config = {
      responsive: true,
      displaylogo: false,
      toImageButtonOptions: {
        format: "svg",
        filename: `${meta.sample_id}_prokka_feature_composition`,
        scale: 2,
      },
      modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"],
    };

    return { traces, plotLayout, config };
  }, [doc, rowHeight]);

  if (error)
    return (
      <div style={{ padding: 16, color: "#b00020", fontFamily: "sans-serif" }}>
        Failed to load plot: {error}
      </div>
    );
  if (!figure)
    return (
      <div style={{ padding: 16, color: "#666", fontFamily: "sans-serif" }}>
        Loading Prokka feature plot…
      </div>
    );

  return (
    <Plot
      data={figure.traces}
      layout={figure.plotLayout}
      config={figure.config}
      style={{ width: "100%" }}
      useResizeHandler
    />
  );
}
