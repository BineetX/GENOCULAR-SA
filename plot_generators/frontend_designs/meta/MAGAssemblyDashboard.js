import React, { useEffect, useMemo, useState } from "react";
import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-dist-min";

const Plot = createPlotlyComponent(Plotly);

/**
 * MAGAssemblyDashboard
 * --------------------
 * Interactive cumulative contig-length assembly curve (log-x rank vs cumulative
 * Mbp), coloured by L50/L90 zone, with N50/N90 crosshairs, a stats box and a
 * shaded area under the curve. Reads the JSON from assembly_contiguity_json.py.
 *
 * Interactive extras over the static R plot:
 *   - hover shows contig rank and cumulative assembly size
 *   - toggle N50/N90 crosshairs and the L50/L90 zone shading
 *   - log-x zoom/pan; SVG export via the modebar
 *
 * Usage: <MAGAssemblyDashboard src="/mag_assembly_plots_data.json" />
 */
export default function MAGAssemblyDashboard({
  src = "/mag_assembly_plots_data.json",
}) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);
  const [showLines, setShowLines] = useState(true);
  const [showZones, setShowZones] = useState(true);

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
    const { meta, stats, layout, curve } = doc;
    const zc = layout.zone_colors;
    const zoneNames = Object.keys(zc);
    const l50 = layout.zone_breaks.l50;
    const l90 = layout.zone_breaks.l90;

    const zoneOf = (rank) =>
      rank <= l50 ? zoneNames[0] : rank <= l90 ? zoneNames[1] : zoneNames[2];

    // split the curve into 3 contiguous zone segments (share boundary points)
    const traces = [];
    zoneNames.forEach((zn, zi) => {
      const seg = curve.filter((p) => {
        const z = zoneOf(p.rank);
        if (z === zn) return true;
        return false;
      });
      // include the first point of the next zone as a bridge so the line is continuous
      if (zi < 2) {
        const nextFirst = curve.find((p) => zoneOf(p.rank) === zoneNames[zi + 1]);
        if (nextFirst) seg.push(nextFirst);
      }
      seg.sort((a, b) => a.rank - b.rank);
      if (!seg.length) return;
      traces.push({
        type: "scatter", mode: "lines",
        name: zn, legendgroup: zn,
        x: seg.map((p) => p.rank),
        y: seg.map((p) => p.cumsum_mbp),
        line: { color: zc[zn], width: 2.4 },
        fill: showZones ? "tozeroy" : "none",
        fillcolor: showZones ? hexA(zc[zn], 0.12) : undefined,
        hovertemplate: `<b>${zn}</b><br>Rank %{x:,}<br>Cumulative: %{y:.2f} Mbp<extra></extra>`,
      });
    });

    const shapes = [];
    const annotations = [];
    if (showLines) {
      layout.vlines.forEach((v) => {
        shapes.push({
          type: "line", xref: "x", x0: Math.log10(v.x), x1: Math.log10(v.x),
          yref: "paper", y0: 0, y1: 1,
          line: { color: v.color, width: 1.4, dash: "dash" },
        });
        annotations.push({
          xref: "x", x: Math.log10(v.x), yref: "paper", y: 0.16,
          xanchor: "left", yanchor: "middle", align: "left",
          text: `<b>${v.label.replace(" (", "<br>(")}</b>`,
          showarrow: false, bgcolor: "rgba(255,255,255,0.85)",
          bordercolor: v.color, borderwidth: 1, borderpad: 3,
          font: { ...font, size: 10, color: v.color },
        });
      });
    }

    // stats box (top-left)
    const S = (v, suf = "") => (v == null ? "NA" : `${v.toLocaleString()}${suf}`);
    const statsText = [
      "<b>Assembly Statistics</b>",
      `Total length : ${S(stats.total_length_mbp)} Mbp`,
      `# Contigs : ${S(stats.n_contigs)}`,
      `Largest contig: ${S(stats.largest_contig_bp)} bp`,
      `N50 : ${S(stats.n50_bp)} bp`,
      `N90 : ${S(stats.n90_bp)} bp`,
      `GC (%) : ${S(stats.gc_pct)}%`,
    ].join("<br>");
    annotations.push({
      xref: "paper", yref: "paper", x: 0.01, y: 0.98,
      xanchor: "left", yanchor: "top", align: "left",
      text: statsText, showarrow: false,
      bgcolor: "#F5F8FA", bordercolor: "#888", borderwidth: 1, borderpad: 8,
      font: { family: "monospace", size: 11, color: "#000" },
    });

    const plotLayout = {
      title: {
        text:
          `<b>${meta.title}</b>` +
          `<br><span style="font-size:12px;color:#000">${meta.subtitle}</span>`,
        x: 0.02, xanchor: "left", font: { ...font, size: 17 },
      },
      font,
      paper_bgcolor: "#fff", plot_bgcolor: "#fff",
      height: 560,
      xaxis: {
        title: { text: meta.x_title, font: { ...font, size: 14 } },
        type: "log", tickformat: ",d",
        tickfont: { ...font, size: 11 }, showgrid: false,
        linecolor: "#000", linewidth: 1.2, ticks: "outside", tickcolor: "#000",
      },
      yaxis: {
        title: { text: meta.y_title, font: { ...font, size: 14 } },
        ticksuffix: " Mbp", rangemode: "tozero",
        tickfont: { ...font, size: 11 }, showgrid: false,
        linecolor: "#000", linewidth: 1.2, ticks: "outside", tickcolor: "#000",
      },
      legend: {
        title: { text: "Assembly Zone", font: { ...font, size: 12 } },
        orientation: "h", x: 0.5, xanchor: "center", y: -0.16,
        font: { ...font, size: 11 },
      },
      shapes, annotations,
      margin: { l: 70, r: 24, t: 74, b: 90 },
    };

    const config = {
      responsive: true, displaylogo: false,
      toImageButtonOptions: {
        format: "svg", filename: `${meta.sample_id}_assembly_quast`, scale: 2,
      },
      modeBarButtonsToRemove: ["lasso2d", "select2d"],
    };

    return { traces, plotLayout, config };
  }, [doc, showLines, showZones, font]);

  if (error)
    return (
      <div style={{ padding: 16, color: "#b00020", fontFamily: "sans-serif" }}>
        Failed to load plot: {error}
      </div>
    );
  if (!figure)
    return (
      <div style={{ padding: 16, color: "#666", fontFamily: "sans-serif" }}>
        Loading assembly curve…
      </div>
    );

  const chk = (label, val, set) => (
    <label style={{ fontSize: 12, color: "#37474F", cursor: "pointer", marginRight: 16 }}>
      <input type="checkbox" checked={val} onChange={(e) => set(e.target.checked)}
             style={{ marginRight: 5, verticalAlign: "middle" }} />
      {label}
    </label>
  );

  return (
    <div style={{ width: "100%", fontFamily: font.family }}>
      <div style={{ padding: "2px 0 6px 8px" }}>
        {chk("N50 / N90 crosshairs", showLines, setShowLines)}
        {chk("L50 / L90 zone shading", showZones, setShowZones)}
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

/** #RRGGBB + alpha -> rgba() */
function hexA(hex, a) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
