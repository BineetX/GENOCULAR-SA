import React, { useEffect, useMemo, useState, useCallback } from "react";
import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-dist-min";

const Plot = createPlotlyComponent(Plotly);

/**
 * MAGDbcanDashboard
 * -----------------
 * Publication-ready, interactive stacked bar chart of dbCAN CAZyme family
 * composition per MAG. Reads the JSON produced by dbcan_cazyme_json.py.
 *
 * Features beyond the static R plot:
 *   - hover tooltip shows class name, count, and % of that MAG's total
 *   - click a legend item to toggle a CAZyme class on/off
 *   - total-count annotation above each bar
 *   - SVG export via Plotly modebar (publication vector output)
 *
 * Usage:
 *   <MAGDbcanDashboard src="/mag_dbcan_plots_data.json" />
 *
 * Props:
 *   src  JSON path relative to the app's public root.
 */
export default function MAGDbcanDashboard({
  src = "/mag_dbcan_plots_data.json",
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

  const figure = useMemo(() => {
    if (!doc) return null;

    const { meta, layout, mags } = doc;
    const colors = layout.colors;
    const labels = layout.labels;
    const stackOrder = layout.stack_order; // ["GH","GT","CE","AA","CBM","PL"]
    const binLabels = mags.map((m) => m.bin);

    // One stacked-bar trace per CAZyme class
    const traces = stackOrder.map((cls) => {
      const y = mags.map((m) => m.counts[cls] || 0);
      const pct = mags.map((m) =>
        m.total > 0
          ? (((m.counts[cls] || 0) / m.total) * 100).toFixed(1)
          : "0.0"
      );
      return {
        type: "bar",
        name: labels[cls] || cls,
        x: binLabels,
        y,
        customdata: pct,
        marker: {
          color: colors[cls],
          line: { color: "rgba(20,20,20,0.55)", width: 0.5 },
        },
        hovertemplate:
          `<b>${labels[cls] || cls}</b><br>` +
          `%{y} domains (%{customdata}%)<br>` +
          `%{x}<extra></extra>`,
      };
    });

    // Total-count annotations above each bar
    const totalAnnotations = mags.map((m) => ({
      x: m.bin,
      y: m.total,
      text: m.total.toString(),
      xanchor: "center",
      yanchor: "bottom",
      yshift: 3,
      showarrow: false,
      font: {
        size: 9,
        color: "#444",
        family: "Inter, Helvetica, Arial, sans-serif",
      },
    }));

    const font = {
      family: "Inter, Helvetica, Arial, sans-serif",
      color: "#1a1a1a",
    };

    const nMags = mags.length;
    const plotWidth = Math.max(700, nMags * 28 + 200);

    const plotLayout = {
      title: {
        text:
          `<b>${meta.title}</b>` +
          `<br><span style="font-size:12px;color:#666">` +
          `Sample ${meta.sample_id} · ${meta.n_mags} MAGs · ` +
          `${meta.total_domain_hits.toLocaleString()} domain hits · ` +
          `${meta.unique_families} families · filter: ${meta.confidence_filter}</span>`,
        x: 0.01,
        xanchor: "left",
        font: { ...font, size: 18 },
      },
      barmode: "stack",
      bargap: 0.2,
      font,
      paper_bgcolor: "#ffffff",
      plot_bgcolor: "#ffffff",
      width: plotWidth,
      height: 520,
      xaxis: {
        title: { text: "MAG", font: { ...font, size: 14 } },
        tickfont: { ...font, size: 11 },
        tickangle: -45,
        showgrid: false,
        ticks: "outside",
        tickcolor: "rgba(0,0,0,0.3)",
        categoryorder: "array",
        categoryarray: binLabels,
      },
      yaxis: {
        title: { text: "CAZyme Domain Count", font: { ...font, size: 14 } },
        tickfont: { ...font, size: 11 },
        showgrid: true,
        gridcolor: "rgba(0,0,0,0.06)",
        zeroline: true,
        zerolinecolor: "#ccc",
        rangemode: "tozero",
        ticks: "outside",
        tickcolor: "rgba(0,0,0,0.3)",
      },
      legend: {
        orientation: "v",
        x: 1.02,
        xanchor: "left",
        y: 1,
        yanchor: "top",
        font: { ...font, size: 12 },
        title: { text: "CAZyme Class", font: { ...font, size: 13 } },
        tracegroupgap: 4,
      },
      annotations: totalAnnotations,
      margin: { l: 64, r: 220, t: 88, b: 100 },
    };

    const config = {
      responsive: true,
      displaylogo: false,
      scrollZoom: false,
      toImageButtonOptions: {
        format: "svg",
        filename: `${meta.sample_id}_dbcan_cazyme_composition`,
        scale: 2,
      },
      modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"],
    };

    return { traces, plotLayout, config };
  }, [doc]);

  // --- horizontal scroll wrapper for many MAGs ---
  const wrapRef = React.useRef(null);
  const handleWheel = useCallback((e) => {
    if (wrapRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      wrapRef.current.scrollLeft += e.deltaY;
    }
  }, []);

  if (error)
    return (
      <div style={{ padding: 16, color: "#b00020", fontFamily: "sans-serif" }}>
        Failed to load plot: {error}
      </div>
    );
  if (!figure)
    return (
      <div style={{ padding: 16, color: "#666", fontFamily: "sans-serif" }}>
        Loading dbCAN CAZyme plot…
      </div>
    );

  return (
    <div
      ref={wrapRef}
      onWheel={handleWheel}
      style={{ overflowX: "auto", width: "100%" }}
    >
      <Plot
        data={figure.traces}
        layout={figure.plotLayout}
        config={figure.config}
        useResizeHandler={false}
      />
    </div>
  );
}
