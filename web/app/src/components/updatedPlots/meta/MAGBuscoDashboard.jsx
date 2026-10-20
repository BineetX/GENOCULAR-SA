import React, { useEffect, useMemo, useState } from "react";
import Plot from "../UpdatedPlot.jsx";



/**
 * MAGBuscoDashboard
 * -----------------
 * Interactive BUSCO completeness stacked-bar chart (per MAG) with styled
 * side-panel cards. Reads the JSON from busco_completeness_json.py.
 *
 * Interactive extras over the static R plot:
 *   - hover shows every category % for a MAG plus its completeness + tier
 *   - click a BUSCO-category swatch to toggle that layer on/off
 *   - HQ (90%) / MQ (50%) threshold lines, SVG export via the modebar
 *   - the ASCII side boxes are re-rendered as clean HTML cards
 *
 * Usage: <MAGBuscoDashboard src="/mag_busco_plots_data.json" />
 */
export default function MAGBuscoDashboard({ src = "/mag_busco_plots_data.json" }) {
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

  const font = useMemo(() => ({ family: "Inter, Helvetica, Arial, sans-serif", color: "#1A1A2E" }), []);

  const figure = useMemo(() => {
    if (!doc) return null;
    const { meta, layout, mags } = doc;
    const labels = mags.map((m) => m.mag_label);
    const key = { S: "S_pct", D: "D_pct", F: "F_pct", M: "M_pct" };

    // one trace per category, added bottom->top so single-copy (yellow) is on top
    const traces = layout.stack_order
      .map((cat) => ({
        type: "bar",
        name: layout.labels[cat],
        x: labels,
        y: mags.map((m) => m[key[cat]]),
        marker: { color: layout.colors[cat], line: { color: "black", width: 0.3 } },
        customdata: mags.map((m) => [m.complete_pct, m.tier, m.mag_id]),
        hovertemplate:
          `<b>%{customdata[2]}</b><br>${layout.labels[cat]}: %{y}%<br>` +
          `Completeness: %{customdata[0]}% (%{customdata[1]})<extra></extra>`,
        showlegend: true,
      }));

    const th = meta.thresholds;
    const nMags = mags.length;
    const xSize = nMags <= 15 ? 12 : nMags <= 30 ? 10 : nMags <= 50 ? 9 : 8;

    const plotLayout = {
      title: {
        text:
          `<b>${meta.title}</b>` +
          `<br><span style="font-size:12px;color:#111">${meta.subtitle}</span>`,
        x: 0.01, xanchor: "left", font: { ...font, size: 18 },
      },
      barmode: "stack",
      legend: { orientation: "h", y: 1.04, x: 0, yanchor: "bottom" },
      bargap: 0.28,
      font,
      paper_bgcolor: "#ffffff",
      plot_bgcolor: "#ffffff",
      height: 620,
      xaxis: {
        type: "category", categoryorder: "array", categoryarray: labels,
        tickangle: -45, tickfont: { ...font, size: xSize, color: "#000" },
        showgrid: false, ticks: "outside", tickcolor: "#000",
        linecolor: "#000", linewidth: 0.8,
      },
      yaxis: {
        title: { text: "BUSCO Gene Completeness (%)", font: { ...font, size: 13 } },
        range: [0, 100], dtick: 10,
        tickfont: { ...font, size: 11, color: "#000" },
        showgrid: true, gridcolor: "#eeeeee",
        linecolor: "#000", linewidth: 0.8, ticks: "outside", tickcolor: "#000",
      },
      shapes: [th.hq, th.mq].map((yv) => ({
        type: "line", xref: "paper", x0: 0, x1: 1, yref: "y", y0: yv, y1: yv,
        line: { color: "black", width: 1.6, dash: "dash" },
      })),
      annotations: [
        {
          xref: "paper", x: 0.99, yref: "y", y: th.hq + 3, xanchor: "right",
          text: `<b>${th.hq}% (HQ threshold)</b>`, showarrow: false,
          font: { ...font, size: 13, color: "#000" },
        },
        {
          xref: "paper", x: 0.99, yref: "y", y: th.mq + 3, xanchor: "right",
          text: `<b>${th.mq}% (MQ threshold)</b>`, showarrow: false,
          font: { ...font, size: 13, color: "#000" },
        },
        {
          xref: "paper", yref: "paper", x: 0, y: -0.24, xanchor: "left",
          showarrow: false,
          text: `<span style="color:#666;font-size:10px">${meta.caption}</span>`,
        },
      ],
      margin: { l: 60, r: 20, t: 80, b: 120 },
    };

    const config = {
      responsive: true, displaylogo: false,
      toImageButtonOptions: {
        format: "svg", filename: `busco_completeness_${meta.sample_id}`, scale: 2,
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
  if (!figure)
    return (
      <div style={{ padding: 16, color: "#666", fontFamily: "sans-serif" }}>
        Loading BUSCO completeness chart…
      </div>
    );

  const { tiers } = doc;

  return (
    <div style={{ width: "100%", fontFamily: font.family }}>
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        <Plot
          data={figure.traces}
          layout={figure.plotLayout}
          config={figure.config}
          style={{ width: "100%" }}
          useResizeHandler
        />
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-100 px-2 pt-3 text-xs text-slate-500">
        {[['High', tiers.high], ['Medium', tiers.medium], ['Low', tiers.low]].map(([label, count]) => (
          <span key={label}><span className="font-semibold text-slate-700">{count}</span> {label.toLowerCase()} completeness</span>
        ))}
      </div>
    </div>
  );
}
