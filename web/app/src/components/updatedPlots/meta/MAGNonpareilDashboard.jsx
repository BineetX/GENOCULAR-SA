import React, { useEffect, useMemo, useState } from "react";
import Plot from "../UpdatedPlot.jsx";



/**
 * MAGNonpareilDashboard
 * ---------------------
 * Interactive Nonpareil rarefaction / coverage curve: observed rarefied coverage
 * points, the fitted sigmoidal model, the current-effort marker and the 95%
 * LRstar projection. Reads the JSON produced by nonpareil_json.py.
 *
 * Interactive extras over the static R plot:
 *   - hover shows sequencing effort (bp) and estimated coverage
 *   - toggle the current-effort line and the LRstar projection
 *   - log-x zoom/pan; SVG export via the modebar
 *
 * Usage: <MAGNonpareilDashboard src="/mag_nonpareil_plots_data.json" />
 */
export default function MAGNonpareilDashboard({
  src = "/mag_nonpareil_plots_data.json",
}) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);
  const [showCurrent, setShowCurrent] = useState(true);
  const [showProjection, setShowProjection] = useState(true);

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
    const { meta, layout, observed, model, markers } = doc;
    const col = layout.colors;
    const converged = meta.model_converged && model;

    const traces = [];

    traces.push({
      type: "scattergl",
      mode: "markers",
      name: "Observed coverage",
      x: observed.map((p) => p.x),
      y: observed.map((p) => p.y),
      marker: { color: col.observed, size: 5, opacity: 0.55 },
      hovertemplate: "Effort: %{x:.3s} bp<br>Coverage: %{y:.3f}<extra></extra>",
    });

    if (converged) {
      traces.push({
        type: "scatter",
        mode: "lines",
        name: "Fitted model",
        x: model.map((p) => p.x),
        y: model.map((p) => p.y),
        line: { color: col.model, width: 2.4 },
        hovertemplate: "Effort: %{x:.3s} bp<br>Model coverage: %{y:.3f}<extra></extra>",
      });
      if (showProjection && markers.lrstar) {
        traces.push({
          type: "scatter", mode: "markers",
          name: `LRstar (${Math.round(layout.star * 100)}%)`,
          x: [markers.lrstar.x], y: [markers.lrstar.y],
          marker: { symbol: "star", size: 15, color: col.projection,
                    line: { color: "#fff", width: 1 } },
          hovertemplate:
            `LRstar (${Math.round(layout.star * 100)}%)<br>` +
            "Effort: %{x:.3s} bp<br>Coverage: %{y:.2f}<extra></extra>",
        });
      }
    }

    // vertical / horizontal marker lines (log-x -> log10 coords for shapes)
    const shapes = [];
    const annotations = [];
    if (showCurrent && meta.current_effort_bp) {
      const lx = Math.log10(meta.current_effort_bp);
      shapes.push({
        type: "line", xref: "x", x0: lx, x1: lx, yref: "paper", y0: 0, y1: 1,
        line: { color: col.current, width: 2, dash: "solid" }, opacity: 0.8,
      });
      annotations.push({
        xref: "x", x: lx, yref: "paper", y: 1, yanchor: "bottom", xanchor: "left",
        text: "<b>Current effort</b>", showarrow: false,
        font: { ...font, size: 11, color: col.current },
      });
    }
    if (converged && showProjection && markers.lrstar) {
      shapes.push({
        type: "line", xref: "paper", x0: 0, x1: 1, yref: "y",
        y0: layout.star, y1: layout.star,
        line: { color: col.projection, width: 1.4, dash: "dash" },
      });
      const lx = Math.log10(markers.lrstar.x);
      shapes.push({
        type: "line", xref: "x", x0: lx, x1: lx, yref: "y", y0: 0, y1: layout.star,
        line: { color: col.projection, width: 1.4, dash: "dash" },
      });
    }

    const plotLayout = {
      title: {
        text:
          `<b>${meta.title}</b>` +
          `<br><span style="font-size:12px;color:#000">${meta.subtitle}</span>`,
        x: 0.02, xanchor: "left", font: { ...font, size: 17 },
      },
      font,
      paper_bgcolor: "#fff",
      plot_bgcolor: "#fff",
      height: 560,
      xaxis: {
        title: { text: meta.x_title, font: { ...font, size: 13 } },
        type: "log", exponentformat: "SI", ticksuffix: "bp",
        tickfont: { ...font, size: 11 }, showgrid: false,
        linecolor: "#000", linewidth: 0.7, ticks: "outside", tickcolor: "#000",
      },
      yaxis: {
        title: { text: meta.y_title, font: { ...font, size: 13 } },
        range: [0, 1.02], dtick: 0.25,
        tickfont: { ...font, size: 11 }, showgrid: false,
        linecolor: "#000", linewidth: 0.7, ticks: "outside", tickcolor: "#000",
      },
      legend: { orientation: "h", x: 0, y: -0.16, font: { ...font, size: 12 } },
      shapes, annotations,
      margin: { l: 64, r: 24, t: 74, b: 96 },
    };

    const config = {
      responsive: true, displaylogo: false,
      toImageButtonOptions: {
        format: "svg", filename: `${meta.sample_id}_nonpareil_coverage_curve`, scale: 2,
      },
      modeBarButtonsToRemove: ["lasso2d", "select2d"],
    };

    return { traces, plotLayout, config, converged };
  }, [doc, showCurrent, showProjection, font]);

  if (error)
    return (
      <div style={{ padding: 16, color: "#b00020", fontFamily: "sans-serif" }}>
        Failed to load plot: {error}
      </div>
    );
  if (!figure)
    return (
      <div style={{ padding: 16, color: "#666", fontFamily: "sans-serif" }}>
        Loading Nonpareil coverage curve…
      </div>
    );

  const chk = (label, val, set, disabled = false) => (
    <label style={{ fontSize: 12, color: disabled ? "#bbb" : "#37474F",
                    cursor: disabled ? "default" : "pointer", marginRight: 16 }}>
      <input type="checkbox" checked={val} disabled={disabled}
             onChange={(e) => set(e.target.checked)}
             style={{ marginRight: 5, verticalAlign: "middle" }} />
      {label}
    </label>
  );

  return (
    <div style={{ width: "100%", fontFamily: font.family }}>
      <div style={{ padding: "2px 0 6px 8px" }}>
        {chk("Current-effort line", showCurrent, setShowCurrent)}
        {chk("LRstar projection", showProjection, setShowProjection, !figure.converged)}
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
