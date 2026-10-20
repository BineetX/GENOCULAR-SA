import React, { useEffect, useMemo, useState } from "react";
import Plot from "../UpdatedPlot.jsx";



// module-scope so its identity is stable (keeps the jitter from reshuffling)
const FONT = { family: "Inter, Helvetica, Arial, sans-serif", color: "#000" };

/**
 * MAGMetaphlanDashboard
 * ---------------------
 * Phylum box plot of genus-level relative abundances (log y-axis). Each box is
 * PRE-COMPUTED on log10 values by metaphlan_lollipop_json.py and passed to
 * Plotly as explicit box statistics (q1/median/q3/lowerfence/upperfence in
 * percentage space) — so Plotly never recomputes quartiles on the raw skewed
 * percentages. Every genus is also shown as a jittered dot.
 *
 * Reads the JSON produced by metaphlan_lollipop_json.py (schema 2.0).
 *
 * Usage: <MAGMetaphlanDashboard src="/mag_metaphlan_plots_data.json" />
 */
export default function MAGMetaphlanDashboard({
  src = "/mag_metaphlan_plots_data.json",
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
    if (!doc || !Array.isArray(doc.phyla)) return null;
    const { meta, layout, phyla } = doc;
    const K = phyla.length;
    const st = layout.style || {};
    const axisLineW = st.axis_line_width ?? 1.2;
    const axisLineC = st.axis_line_color ?? "#000";
    const boxLineW = st.box_line_width ?? 1.3;
    const boxLineC = st.box_line_color ?? layout.box_line_color ?? "#222";
    const tickW = st.tick_font_bold ? "bold" : "normal";
    const tickC = st.tick_font_color ?? "#000";
    const tickX = st.tick_font_size_x ?? 11;
    const tickY = st.tick_font_size_y ?? 12;
    const showGrid = st.show_grid ?? true;

    // deterministic jitter (seeded per phylum index) so dots don't move on
    // re-render / resize. Simple LCG — no external dep.
    const jitter = (seed) => {
      let s = (seed * 9301 + 49297) % 233280;
      return () => {
        s = (s * 9301 + 49297) % 233280;
        return (s / 233280 - 0.5) * 0.5; // spread within ±0.25 of the category
      };
    };

    const traces = [];
    phyla.forEach((p, i) => {
      const b = p.box;

      // --- pre-computed box (one per phylum, positioned at numeric x = i) ---
      traces.push({
        type: "box",
        x: [i],
        q1: [b.q1], median: [b.median], q3: [b.q3],
        lowerfence: [b.lowerfence], upperfence: [b.upperfence],
        width: 0.6,
        fillcolor: p.color,
        line: { color: boxLineC, width: boxLineW },
        whiskerwidth: 0.5,
        hoverinfo: "skip",
        showlegend: false,
      });

      // --- every genus as a jittered dot over the box ---
      const j = jitter(i + 1);
      traces.push({
        type: "scatter",
        mode: "markers",
        x: p.genera.map(() => i + j()),
        y: p.genera.map((g) => g.abundance),
        text: p.genera.map((g) => g.name),
        customdata: p.genera.map(() => p.name),
        marker: {
          color: p.dot_color || p.color, size: 6, opacity: 0.9,
          line: { color: layout.marker_edge, width: 0.5 },
        },
        hovertemplate:
          "<b>%{text}</b><br>Abundance: %{y}%<br>Phylum: %{customdata}<extra></extra>",
        showlegend: false,
      });
    });

    const yLo = layout.y_range[0];
    const yHi = layout.y_range[1];

    const plotLayout = {
      title: {
        text:
          `<b>${meta.title}</b>` +
          `<br><span style="font-size:12px;color:#444">${meta.subtitle}</span>`,
        x: 0.5, xanchor: "center", font: { ...FONT, size: 17 },
      },
      font: FONT,
      paper_bgcolor: "#fff",
      plot_bgcolor: "#fff",
      height: 640,
      boxmode: "overlay",
      xaxis: {
        // numeric positions with phylum labels — lets the dots jitter within a
        // category (a true category axis can't offset points by a fraction).
        range: [-0.5, K - 0.5],
        tickmode: "array",
        tickvals: phyla.map((_, i) => i),
        ticktext: phyla.map((p) => p.label),
        tickfont: { ...FONT, size: tickX, color: tickC, weight: tickW },
        tickangle: -30,
        showgrid: false, zeroline: false,
        linecolor: axisLineC, linewidth: axisLineW,
        ticks: "outside", tickcolor: axisLineC, tickwidth: axisLineW,
      },
      yaxis: {
        title: { text: meta.y_title, font: { ...FONT, size: 16, color: tickC, weight: tickW } },
        type: "log",
        range: [Math.log10(yLo), Math.log10(yHi)],
        dtick: 1, exponentformat: "power",
        tickfont: { ...FONT, size: tickY, color: tickC, weight: tickW },
        showgrid: showGrid, gridcolor: "#e6e6e6", zeroline: false,
        minor: { showgrid: showGrid, gridcolor: "#f2f2f2" },
        linecolor: axisLineC, linewidth: axisLineW,
        ticks: "outside", tickcolor: axisLineC, tickwidth: axisLineW,
      },
      margin: { l: 78, r: 30, t: 74, b: 120 },
      showlegend: false,
    };

    const config = {
      responsive: true, displaylogo: false,
      toImageButtonOptions: {
        format: "svg", filename: `${meta.sample_id}_phylum_genus_boxplot`, scale: 2,
      },
      modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"],
    };

    return { traces, plotLayout, config };
  }, [doc]);

  if (error)
    return (
      <div style={{ padding: 16, color: "#b00020", fontFamily: "sans-serif" }}>
        Failed to load plot: {error}
      </div>
    );
  if (!figure)
    return (
      <div style={{ padding: 16, color: "#666", fontFamily: "sans-serif" }}>
        Loading genus box plot…
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
