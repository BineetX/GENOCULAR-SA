import React, { useEffect, useMemo, useState } from "react";
import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-dist-min";

const Plot = createPlotlyComponent(Plotly);

/** wrap a label to ~width chars per line with <br> */
function wrap(text, width = 22) {
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > width) {
      lines.push(cur.trim());
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur.trim());
  return lines.join("<br>");
}

/**
 * MAGMetaphlanAlphaDashboard
 * --------------------------
 * Genus-level alpha-diversity summary: three metrics (Observed genera, Shannon
 * H', Simpson 1-D) as independent-scale faceted bars with value labels.
 * Reads the JSON produced by metaphlan_diversity_json.py (alpha_diversity block).
 *
 * Usage: <MAGMetaphlanAlphaDashboard src="/mag_metaphlan_diversity_plots_data.json" />
 */
export default function MAGMetaphlanAlphaDashboard({
  src = "/mag_metaphlan_diversity_plots_data.json",
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
    if (!doc) return null;
    const { meta } = doc;
    const { title, y_title, metrics } = doc.alpha_diversity;

    const n = metrics.length;
    const gap = 0.06;
    const w = (1 - gap * (n - 1)) / n;

    const traces = [];
    const annotations = [];
    const layoutAxes = {};

    metrics.forEach((m, i) => {
      const xkey = i === 0 ? "x" : `x${i + 1}`;
      const ykey = i === 0 ? "y" : `y${i + 1}`;
      const x0 = i * (w + gap);
      const x1 = x0 + w;

      traces.push({
        type: "bar",
        x: [m.label], y: [m.value],
        xaxis: xkey, yaxis: ykey,
        marker: { color: m.color, line: { color: "black", width: 0.6 } },
        width: 0.5,
        hovertemplate: `<b>${m.label}</b><br>${m.display}<extra></extra>`,
        showlegend: false,
      });

      layoutAxes[xkey === "x" ? "xaxis" : `xaxis${i + 1}`] = {
        domain: [x0, x1], anchor: ykey,
        showticklabels: false, ticks: "", showgrid: false,
        linecolor: "#000", linewidth: 0.7, zeroline: false,
      };
      layoutAxes[ykey === "y" ? "yaxis" : `yaxis${i + 1}`] = {
        anchor: xkey, range: [0, m.value * 1.18],
        title: i === 0 ? { text: y_title, font: { ...font, size: 14 } } : undefined,
        tickfont: { ...font, size: 12 }, showgrid: false,
        linecolor: "#000", linewidth: 0.7, ticks: "outside", tickcolor: "#000",
      };

      // facet strip title
      annotations.push({
        xref: `${xkey} domain`, yref: "paper", x: 0.5, y: 1.03,
        xanchor: "center", yanchor: "bottom", showarrow: false,
        text: `<b>${wrap(m.label, 22)}</b>`,
        font: { ...font, size: 12 },
      });
      // value label above the bar
      annotations.push({
        xref: xkey, yref: ykey, x: m.label, y: m.value,
        yshift: 10, xanchor: "center", yanchor: "bottom", showarrow: false,
        text: `<b>${m.display}</b>`, font: { ...font, size: 13 },
      });
    });

    const plotLayout = {
      title: {
        text:
          `<b>${title}</b>` +
          `<br><span style="font-size:12px;color:#000">${meta.subtitle}</span>`,
        x: 0.02, xanchor: "left", font: { ...font, size: 17 },
      },
      font,
      paper_bgcolor: "#fff", plot_bgcolor: "#fff",
      height: 460,
      annotations,
      margin: { l: 60, r: 20, t: 120, b: 30 },
      ...layoutAxes,
    };

    const config = {
      responsive: true, displaylogo: false,
      toImageButtonOptions: {
        format: "svg",
        filename: `${meta.sample_id}_MetaPhlAn4_genus_alpha_diversity_summary`,
        scale: 2,
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
        Loading alpha-diversity summary…
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
