import React, { useEffect, useMemo, useState } from "react";
import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-dist-min";

const Plot = createPlotlyComponent(Plotly);

/**
 * MAGVirsorterDashboard
 * ---------------------
 * Interactive stacked histogram of VirSorter2 max_score coloured by viral group,
 * with sensitivity (0.5) and high-confidence (0.9) cutoff lines. Reads the JSON
 * produced by virsorter2_json.py.
 *
 * Interactive extras over the static R plot:
 *   - hover shows the score-bin range, group and sequence count
 *   - click a group in the legend to toggle it (native Plotly)
 *   - zoom/pan; SVG export via the modebar
 *
 * Usage: <MAGVirsorterDashboard src="/mag_virsorter2_plots_data.json" />
 */
export default function MAGVirsorterDashboard({
  src = "/mag_virsorter2_plots_data.json",
}) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);

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

  const font = { family: "Inter, Helvetica, Arial, sans-serif", color: "#000" };

  const figure = useMemo(() => {
    if (!doc || doc.meta.empty) return null;
    const { meta, layout, sequences } = doc;
    const bw = layout.binwidth;

    // one histogram trace per group (same bins) -> stacked
    const traces = layout.group_order.map((grp) => {
      const xs = sequences.filter((s) => s.group === grp).map((s) => s.max_score);
      return {
        type: "histogram",
        name: grp,
        x: xs,
        xbins: { start: layout.x_range[0], end: layout.x_range[1] + 1e-9, size: bw },
        marker: { color: layout.colors[grp], line: { color: "black", width: 0.3 } },
        opacity: 0.9,
        hovertemplate:
          `<b>${grp}</b><br>score %{x}<br>count: %{y}<extra></extra>`,
      };
    });

    const cutShapes = layout.cutoffs.map((c) => ({
      type: "line", xref: "x", x0: c.value, x1: c.value,
      yref: "paper", y0: 0, y1: 1,
      line: { color: "#333", width: 1.4, dash: c.dash },
    }));

    const cutAnnos = layout.cutoffs.map((c) => ({
      x: c.value, xref: "x", y: 0.98, yref: "paper",
      xanchor: "right", yanchor: "top", textangle: -90,
      text: `<b>${c.label}</b>`, showarrow: false,
      font: { ...font, size: 11, color: "#333" },
    }));

    const plotLayout = {
      title: {
        text:
          `<b>${meta.title}</b>` +
          `<br><span style="font-size:12px;color:#000">${meta.subtitle}</span>`,
        x: 0.02, xanchor: "left", font: { ...font, size: 17 },
      },
      barmode: "stack",
      bargap: 0.02,
      font,
      paper_bgcolor: "#fff",
      plot_bgcolor: "#fff",
      height: 540,
      xaxis: {
        title: { text: layout.x_title, font: { ...font, size: 14 } },
        range: [layout.x_range[0], layout.x_range[1]], dtick: 0.1,
        tickfont: { ...font, size: 12 }, showgrid: false,
        linecolor: "#000", linewidth: 0.8, ticks: "outside", tickcolor: "#000",
      },
      yaxis: {
        title: { text: layout.y_title, font: { ...font, size: 14 } },
        tickfont: { ...font, size: 12 }, showgrid: false, rangemode: "tozero",
        linecolor: "#000", linewidth: 0.8, ticks: "outside", tickcolor: "#000",
      },
      legend: {
        title: { text: "Viral group", font: { ...font, size: 12 } },
        font: { ...font, size: 12 }, x: 1.02, xanchor: "left", y: 1, yanchor: "top",
      },
      shapes: cutShapes,
      annotations: [
        ...cutAnnos,
        {
          xref: "paper", yref: "paper", x: 0.02, y: -0.16, xanchor: "left",
          showarrow: false,
          text: `<b>${meta.caption}</b>`,
          font: { ...font, size: 12, color: "#000" },
        },
      ],
      margin: { l: 64, r: 150, t: 74, b: 84 },
    };

    const config = {
      responsive: true, displaylogo: false,
      toImageButtonOptions: {
        format: "svg", filename: `${meta.sample_id}_virsorter2_score_distribution`, scale: 2,
      },
      modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"],
    };

    return { traces, plotLayout, config };
  }, [doc, font]);

  if (error)
    return (
      <div style={{ padding: 16, color: "#b00020", fontFamily: "sans-serif" }}>
        Failed to load plot: {error}
      </div>
    );
  if (!doc)
    return (
      <div style={{ padding: 16, color: "#666", fontFamily: "sans-serif" }}>
        Loading VirSorter2 score distribution…
      </div>
    );

  // empty biological outcome
  if (doc.meta.empty)
    return (
      <div style={{ fontFamily: font.family, padding: 24 }}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>
          {doc.meta.title}
        </div>
        <div style={{ padding: 20, border: "1px solid #FFC107", background: "#FFF3CD",
                      borderRadius: 8, color: "#856404", maxWidth: 560 }}>
          No viral sequences were recovered for sample <b>{doc.meta.sample_id}</b>.
          This is a valid biological outcome, not a pipeline error.
        </div>
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
