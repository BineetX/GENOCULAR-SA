import React, { useEffect, useMemo, useState } from "react";
import Plot from "../UpdatedPlot.jsx";



/**
 * MAGMetaphlanRankDashboard
 * -------------------------
 * Genus-level rank-abundance (Whittaker) curve: relative abundance (log10 y)
 * vs genus rank, with a dashed line + "N = <n> genera" annotation at the tail.
 * Reads the JSON produced by metaphlan_diversity_json.py (rank_abundance block).
 *
 * Interactive extras over the static R plot:
 *   - hover shows rank, genus name and relative abundance
 *   - log-y zoom/pan; SVG export via the modebar
 *
 * Usage: <MAGMetaphlanRankDashboard src="/mag_metaphlan_diversity_plots_data.json" />
 */
export default function MAGMetaphlanRankDashboard({
  src = "/mag_metaphlan_diversity_plots_data.json",
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

  const font = useMemo(() => ({ family: "Inter, Helvetica, Arial, sans-serif", color: "#000" }), []);

  const figure = useMemo(() => {
    if (!doc) return null;
    const { meta } = doc;
    const ra = doc.rank_abundance;
    const pts = ra.points;
    const xs = pts.map((p) => p.rank);
    const ys = pts.map((p) => p.abundance);
    const names = pts.map((p) => p.name || `rank ${p.rank}`);

    const minA = Math.min(...ys);
    const maxA = Math.max(...ys);
    // N-annotation y (near the tail's upper side), matching the R placement
    const nLabelY = Math.pow(
      10,
      Math.log10(maxA) - 0.15 * (Math.log10(maxA) - Math.log10(minA))
    );

    const traces = [{
      type: "scatter", mode: "lines+markers",
      x: xs, y: ys,
      customdata: names,
      line: { color: ra.color, width: 1.8 },
      marker: { color: ra.color, size: 6, line: { color: ra.color, width: 0.5 } },
      hovertemplate:
        "Rank %{x}<br><b>%{customdata}</b><br>Abundance: %{y}%<extra></extra>",
      showlegend: false,
    }];

    const plotLayout = {
      title: {
        text:
          `<b>${ra.title}</b>` +
          `<br><span style="font-size:12px;color:#000">${meta.subtitle}</span>`,
        x: 0.02, xanchor: "left", font: { ...font, size: 17 },
      },
      font,
      paper_bgcolor: "#fff", plot_bgcolor: "#fff",
      height: 520,
      xaxis: {
        title: { text: ra.x_title, font: { ...font, size: 14 } },
        tickfont: { ...font, size: 12 }, showgrid: false, zeroline: false,
        linecolor: "#000", linewidth: 0.7, ticks: "outside", tickcolor: "#000",
      },
      yaxis: {
        title: { text: ra.y_title, font: { ...font, size: 14 } },
        type: "log", tickformat: ".0e",
        tickfont: { ...font, size: 12 }, showgrid: false,
        linecolor: "#000", linewidth: 0.7, ticks: "outside", tickcolor: "#000",
      },
      shapes: [{
        type: "line", xref: "x", x0: ra.n_plotted, x1: ra.n_plotted,
        yref: "paper", y0: 0, y1: 1,
        line: { color: ra.n_annotation_color, width: 1, dash: "dash" },
      }],
      annotations: [{
        xref: "x", yref: "y", x: ra.n_plotted, y: Math.log10(nLabelY),
        xanchor: "right", showarrow: false,
        text: `<b>N = ${ra.n_plotted} genera</b>`,
        font: { ...font, size: 13, color: ra.n_annotation_color },
      }],
      margin: { l: 74, r: 24, t: 74, b: 64 },
    };

    const config = {
      responsive: true, displaylogo: false,
      toImageButtonOptions: {
        format: "svg",
        filename: `${meta.sample_id}_MetaPhlAn4_genus_rank_abundance_curve`,
        scale: 2,
      },
      modeBarButtonsToRemove: ["lasso2d", "select2d"],
    };

    return { traces, plotLayout, config };
  }, [doc, font]);

  if (error)
    return (
      <div style={{ padding: 16, color: "#b00020", fontFamily: "sans-serif" }}>
        Failed to load plot: {error}
      </div>
    );
  if (!figure)
    return (
      <div style={{ padding: 16, color: "#666", fontFamily: "sans-serif" }}>
        Loading rank-abundance curve…
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
