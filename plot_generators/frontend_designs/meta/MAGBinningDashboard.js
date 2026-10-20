import React, { useEffect, useMemo, useState } from "react";
import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-dist-min";

const Plot = createPlotlyComponent(Plotly);

/**
 * MAGBinningDashboard
 * -------------------
 * Two-panel (MaxBin2 / MetaBAT2) binning-QC scatter: GC% vs coverage (log-x),
 * points coloured by GC (plasma) and sized by genome size, with per-panel
 * median crosshairs, ±2 SD outlier labels and a per-panel stats block.
 * Reads the JSON produced by binning_scatter_json.py.
 *
 * Layout: panels are stacked VERTICALLY (MaxBin2 on top, MetaBAT2 below),
 * each on its own y-axis but sharing one GC% range; the per-panel stats
 * blocks are rendered OUTSIDE the axes, to the right of each panel.
 *
 * Interactive extras over the static R plot:
 *   - hover shows bin id, coverage, GC%, genome size and contig count
 *   - toggle median crosshairs and outlier labels on/off
 *   - Plotly zoom/pan on the log axes; SVG export via the modebar
 *
 * Usage: <MAGBinningDashboard src="/mag_binning_plots_data.json" />
 */
export default function MAGBinningDashboard({
  src = "/mag_binning_plots_data.json",
}) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);
  const [showCross, setShowCross] = useState(true);
  const [showLabels, setShowLabels] = useState(true);

  useEffect(() => {
    let alive = true;
    const url = `${process.env.PUBLIC_URL || ""}${src}`;
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

  const font = { family: "Inter, Helvetica, Arial, sans-serif", color: "#0D1B2A" };
  const NAVY = "#1A237E";

  // vertical panel geometry (paper coords). Plot area ends at PLOT_R; the strip
  // to its right holds the per-panel stats boxes.
  const PLOT_R = 0.66;
  const ROW = {
    top: [0.58, 1.0], // y-domain of the top panel (MaxBin2)
    bot: [0.0, 0.4], // y-domain of the bottom panel (MetaBAT2)
  };

  const sizePx = useMemo(() => {
    if (!doc) return () => 8;
    const [minPx, maxPx] = doc.layout.size.range_px;
    const lo = doc.layout.size.ref_min;
    const hi = doc.layout.size.ref_max;
    return (mb) => {
      if (mb == null || hi <= lo) return minPx;
      const t = Math.min(1, Math.max(0, (mb - lo) / (hi - lo)));
      return minPx + (maxPx - minPx) * t;
    };
  }, [doc]);

  const figure = useMemo(() => {
    if (!doc) return null;
    const { meta, layout, panels } = doc;
    const [p1, p2] = layout.panels; // MaxBin2 (top), MetaBAT2 (bottom)
    const axisOf = { [p1]: "", [p2]: "2" }; // "" -> x/y, "2" -> x2/y2
    const domOf = { [p1]: ROW.top, [p2]: ROW.bot };

    // shared GC% y-range (matches R: max(0, min-5) .. min(100, max+5))
    const yLo = Math.max(0, layout.gc.range[0] - 5);
    const yHi = Math.min(100, layout.gc.range[1] + 5);

    const fmtCov = (v) => (v >= 1000 ? v.toExponential(2) : `${v}`);

    const mkTrace = (name, suffix) => {
      const pts = panels[name].points;
      return {
        type: "scattergl",
        mode: "markers",
        xaxis: "x" + suffix,
        yaxis: "y" + suffix,
        x: pts.map((p) => p.coverage),
        y: pts.map((p) => p.gc_pct),
        marker: {
          size: pts.map((p) => sizePx(p.genome_size_mb)),
          color: pts.map((p) => p.gc_pct),
          coloraxis: "coloraxis",
          line: { color: "rgba(255,255,255,0.9)", width: 0.6 },
          opacity: 0.85,
        },
        customdata: pts.map((p) => [
          p.bin_id,
          p.genome_size_mb == null ? "NA" : p.genome_size_mb,
          p.num_contigs == null ? "NA" : p.num_contigs,
        ]),
        hovertemplate:
          "<b>%{customdata[0]}</b><br>" +
          "Coverage: %{x:.2f}×<br>GC: %{y:.1f}%<br>" +
          "Genome size: %{customdata[1]} Mb<br>" +
          "Contigs: %{customdata[2]}<extra></extra>",
        showlegend: false,
      };
    };

    const traces = [mkTrace(p1, ""), mkTrace(p2, "2")];

    // ---- genome-size legend, drawn INSIDE the figure (hidden x3/y3 axes) so it
    // is captured on export and aligns in one column above the GC colorbar. The
    // old external <div> SVG was a flex sibling of <Plot> and never appeared in
    // the downloaded image. Bubble radii reuse sizePx so they match the plot.
    const sBreaks = layout.size.breaks;
    traces.push({
      type: "scatter", mode: "markers+text",
      xaxis: "x3", yaxis: "y3",
      x: sBreaks.map(() => 0.28),
      y: sBreaks.map((_, i) => i),
      marker: {
        size: sBreaks.map((b) => sizePx(b)),
        color: "#607D8B", line: { color: "#fff", width: 1 },
      },
      text: sBreaks.map((b) => `  ${b} Mb`),
      textposition: "middle right",
      textfont: { ...font, size: 11, color: "#37474F" },
      hoverinfo: "skip", showlegend: false,
    });

    // ---- shapes: panel header bars + median crosshairs ----
    const shapes = [];
    const headerBar = (suffix) => ({
      type: "rect",
      xref: "x" + suffix + " domain",
      yref: "y" + suffix + " domain",
      x0: 0, x1: 1, y0: 1.012, y1: 1.06,
      fillcolor: NAVY, line: { width: 0 },
    });
    shapes.push(headerBar(""), headerBar("2"));

    if (showCross) {
      [p1, p2].forEach((name) => {
        const s = axisOf[name];
        const ch = panels[name].crosshair;
        shapes.push({
          type: "line", xref: "x" + s + " domain", yref: "y" + s,
          x0: 0, x1: 1, y0: ch.med_gc, y1: ch.med_gc,
          line: { color: layout.crosshair_color, width: 1, dash: "dash" },
        });
        shapes.push({
          type: "line", xref: "x" + s, yref: "y" + s + " domain",
          x0: Math.log10(ch.med_cov), x1: Math.log10(ch.med_cov), y0: 0, y1: 1,
          line: { color: layout.crosshair_color, width: 1, dash: "dash" },
        });
      });
    }

    // ---- annotations: panel titles, stats blocks, outlier labels ----
    const annotations = [];
    [p1, p2].forEach((name) => {
      const s = axisOf[name];
      const dom = domOf[name];
      annotations.push({
        xref: "x" + s + " domain", yref: "y" + s + " domain",
        x: 0.5, y: 1.036, xanchor: "center", yanchor: "middle",
        text: `<b>${name}</b>`, showarrow: false,
        font: { ...font, size: 15, color: "#ffffff" },
      });
      const st = panels[name].stats;
      const statText = [
        `<b>Total recovered bins = ${st.n_bins}</b>`,
        `<b>Median GC = ${st.median_gc}%</b>`,
        `<b>Median Coverage = ${st.median_cov}×</b>`,
        `<b>Coverage Range = ${st.min_cov} – ${st.max_cov}×</b>`,
        `<b>Median Size = ${st.median_gs_mb} Mb</b>`,
        `<b>Total Contigs = ${st.total_contigs.toLocaleString()}</b>`,
      ].join("<br>");
      // stats block OUTSIDE the panel, to the right, aligned to its top edge
      annotations.push({
        xref: "paper", yref: "y" + s + " domain",
        x: PLOT_R + 0.02, y: 1.0, xanchor: "left", yanchor: "top",
        align: "left", text: statText, showarrow: false,
        font: { ...font, size: 10.5, color: NAVY },
        bgcolor: "rgba(255,255,255,0.96)",
        bordercolor: "#B0BEC5", borderwidth: 1, borderpad: 8,
      });

      if (showLabels) {
        panels[name].points
          .filter((p) => p.is_outlier)
          .forEach((p) => {
            annotations.push({
              xref: "x" + s, yref: "y" + s,
              x: Math.log10(p.coverage), y: p.gc_pct,
              text: p.label, showarrow: true,
              arrowcolor: "#455A64", arrowwidth: 1, arrowsize: 0.8,
              ax: 26, ay: 0, standoff: 4,
              bgcolor: "rgba(255,255,255,0.9)",
              bordercolor: "#B0BEC5", borderwidth: 0.6, borderpad: 2,
              font: { ...font, size: 10, color: "#212121" },
            });
          });
      }
    });

    const xAxisCommon = {
      type: "log", title: { text: "", font: { ...font, size: 13 } },
      // Force ONE labelled tick per power of ten (10, 100, 1000) on both panels.
      // Without this, Plotly auto-picks the log-tick mode per axis and, because
      // the panels have independent (free-x) ranges, labels one panel as 1·2·5
      // and the other as 1–9 — the non-uniform, cluttered look. dtick:1 (decades)
      // + unlabelled minor ticks matches the R figure and stays identical across
      // both panels regardless of their individual coverage ranges.
      dtick: 1,
      exponentformat: "none",    // plain 10 / 100 / 1000, never "1k" or 10^3
      minor: { ticks: "outside", ticklen: 3, tickcolor: "#B0BEC5", showgrid: false },
      tickfont: { ...font, size: 10 }, showgrid: true,
      gridcolor: "#ECEFF1", zeroline: false,
      linecolor: "#B0BEC5", mirror: true, ticks: "outside", tickcolor: "#B0BEC5",
    };
    const yAxisCommon = {
      title: { text: "GC Content (%)", font: { ...font, size: 14, color: NAVY } },
      range: [yLo, yHi], dtick: 10,
      tickfont: { ...font, size: 10 }, showgrid: true, gridcolor: "#ECEFF1",
      zeroline: false, linecolor: "#B0BEC5", mirror: true,
      ticks: "outside", tickcolor: "#B0BEC5",
    };

    const plotLayout = {
      title: {
        text:
          `<b>${meta.title}</b>` +
          `<br><span style="font-size:11px;color:#37474F">${meta.subtitle}</span>`,
        x: 0.01, xanchor: "left", font: { ...font, size: 19 },
      },
      font,
      paper_bgcolor: "#FAFAFA",
      plot_bgcolor: "#FFFFFF",
      height: 900,
      // both panels full plot-width; stacked on independent y-axes (free-x each)
      xaxis: { ...xAxisCommon, domain: [0.0, PLOT_R], anchor: "y" },
      yaxis: { ...yAxisCommon, domain: ROW.top, anchor: "x" },
      xaxis2: { ...xAxisCommon, domain: [0.0, PLOT_R], anchor: "y2" },
      yaxis2: { ...yAxisCommon, domain: ROW.bot, anchor: "x2" },
      coloraxis: {
        colorscale: layout.gc.colorscale,
        cmin: layout.gc.range[0], cmax: layout.gc.range[1],
        // GC colorbar sits in the LOWER half of the right-hand legend column,
        // with the genome-size legend stacked directly above it (x3/y3 axes).
        colorbar: {
          title: { text: "GC Content (%)", side: "top", font: { ...font, size: 11, color: NAVY } },
          x: 0.9, xanchor: "left",
          y: 0.28, yanchor: "bottom", len: 0.34, thickness: 12,
          ticksuffix: "%", tickfont: { ...font, size: 9 },
          outlinewidth: 0,
        },
      },
      // hidden axes hosting the genome-size bubble legend, positioned as a
      // narrow column above the colorbar (same x band, higher y band).
      xaxis3: {
        domain: [0.9, 0.99], range: [0, 1],
        visible: false, fixedrange: true, anchor: "y3",
      },
      yaxis3: {
        domain: [0.66, 0.9], range: [-0.6, layout.size.breaks.length - 0.4],
        visible: false, fixedrange: true, anchor: "x3",
      },
      shapes,
      annotations: [
        ...annotations,
        {
          xref: "paper", yref: "paper", x: PLOT_R / 2, y: -0.055,
          xanchor: "center", showarrow: false,
          text: `<b>Coverage / Abundance  (log\u2081\u2080 scale)</b>`,
          font: { ...font, size: 15, color: NAVY },
        },
        {
          xref: "paper", yref: "paper", x: 0, y: -0.1,
          xanchor: "left", showarrow: false,
          text: `<span style="color:#90A4AE;font-size:9px">${meta.caption}</span>`,
        },
        // genome-size legend title, sitting just above its bubble column
        {
          xref: "paper", yref: "paper", x: 0.9, y: 0.915,
          xanchor: "left", yanchor: "bottom", showarrow: false,
          text: `<b>${layout.size.label}</b>`,
          font: { ...font, size: 11, color: NAVY },
        },
      ],
      margin: { l: 66, r: 160, t: 130, b: 90 },
    };

    const config = {
      responsive: true, displaylogo: false,
      toImageButtonOptions: {
        format: "svg", filename: `${meta.sample_id}_binning_scatter`, scale: 2,
      },
      modeBarButtonsToRemove: ["lasso2d", "select2d"],
    };

    return { traces, plotLayout, config };
  }, [doc, showCross, showLabels, sizePx, font]);

  if (error)
    return (
      <div style={{ padding: 16, color: "#b00020", fontFamily: "sans-serif" }}>
        Failed to load plot: {error}
      </div>
    );
  if (!figure)
    return (
      <div style={{ padding: 16, color: "#666", fontFamily: "sans-serif" }}>
        Loading binning-QC scatter…
      </div>
    );

  const chk = (label, val, set) => (
    <label style={{ fontSize: 12, color: "#37474F", cursor: "pointer", marginRight: 16 }}>
      <input type="checkbox" checked={val} onChange={(e) => set(e.target.checked)}
             style={{ marginRight: 5, verticalAlign: "middle" }} />
      {label}
    </label>
  );

  // Both legends (genome-size bubbles + GC colorbar) now live INSIDE the Plot,
  // stacked in a right-hand column, so a single <Plot> export captures them.
  return (
    <div style={{ width: "100%", fontFamily: font.family }}>
      <div style={{ padding: "4px 0 8px 8px" }}>
        {chk("Median crosshairs", showCross, setShowCross)}
        {chk("Outlier labels", showLabels, setShowLabels)}
      </div>

      <Plot
        data={figure.traces}
        layout={figure.plotLayout}
        config={figure.config}
        style={{ width: "100%" }}
        useResizeHandler
      />
    </div>
  );
}
