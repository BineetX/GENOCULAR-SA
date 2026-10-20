import React, { useEffect, useMemo, useState } from "react";
import Plot from "../UpdatedPlot.jsx";



/**
 * MAGBarrnapDashboard
 * -------------------
 * Publication-ready, interactive dot-matrix of rRNA gene copy number per MAG
 * (16S / 23S / 5S). Reads the JSON produced by barrnap_rrna_json.py.
 *
 * Interactive extras over the static R plot:
 *   - hover shows MAG, target, copy number and completeness
 *   - click a completeness swatch (Full / Partial / None) to toggle it on/off
 *   - graduated "Copy Number" size legend rendered as crisp SVG
 *   - SVG export via the Plotly modebar
 *
 * Usage:
 *   <MAGBarrnapDashboard src="/mag_barrnap_plots_data.json" />
 */
export default function MAGBarrnapDashboard({
  src = "/mag_barrnap_plots_data.json",
}) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);
  const [visible, setVisible] = useState({ Full: true, Partial: true, None: true });

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

  const font = useMemo(() => ({ family: "Inter, Helvetica, Arial, sans-serif", color: "#111111" }), []);

  // sqrt (area-proportional) size scaling shared by plot + legend
  const sizePx = useMemo(() => {
    if (!doc) return () => 0;
    const [minPx, maxPx] = doc.layout.size_range_px;
    const maxC = Math.max(doc.meta.max_count, 1);
    return (count) => {
      if (maxC <= 1 || count <= 1) return minPx;
      const t = (Math.sqrt(count) - 1) / (Math.sqrt(maxC) - 1);
      return minPx + (maxPx - minPx) * t;
    };
  }, [doc]);

  const figure = useMemo(() => {
    if (!doc) return null;
    const { meta, layout, mags, cells } = doc;
    // short display labels ("bin.85", ".011", …); full ids stay the category key
    const magLabels = doc.mag_labels || mags;

    // two-line y labels, 16S on top
    const yLabel = (t) =>
      (layout.target_labels[t] || t).replace(" (", "<br>(");
    const yCats = layout.targets.map(yLabel);            // [16S, 23S, 5S]
    const yCatsBottomUp = [...yCats].reverse();          // 16S ends on top

    const traces = [];

    // zero cells -> open gray rings (only if "None" visible)
    if (visible.None) {
      const z = cells.filter((c) => c.count === 0);
      traces.push({
        type: "scatter",
        mode: "markers",
        x: z.map((c) => c.mag),
        y: z.map((c) => yLabel(c.target)),
        marker: {
          size: 11,
          color: "#FFFFFF",
          line: { color: layout.outline.None, width: 1.2 },
        },
        customdata: z.map((c) => [layout.target_labels[c.target]]),
        hovertemplate: "%{x}<br>%{customdata[0]}<br>Not detected<extra></extra>",
        showlegend: false,
        hoverlabel: { bgcolor: "#fff" },
      });
    }

    // hit cells -> sized, coloured bubbles with the count inside
    ["Full", "Partial"].forEach((comp) => {
      if (!visible[comp]) return;
      const h = cells.filter((c) => c.count > 0 && c.completeness === comp);
      if (!h.length) return;
      traces.push({
        type: "scatter",
        mode: "markers+text",
        x: h.map((c) => c.mag),
        y: h.map((c) => yLabel(c.target)),
        text: h.map((c) => String(c.count)),
        textposition: "middle center",
        textfont: { size: 11, color: "#111", family: font.family },
        marker: {
          size: h.map((c) => sizePx(c.count)),
          color: layout.colors[comp],
          line: { color: layout.outline[comp], width: 1 },
        },
        customdata: h.map((c) => [
          layout.target_labels[c.target],
          layout.completeness_labels[comp],
          c.count,
        ]),
        hovertemplate:
          "%{x}<br>%{customdata[0]}<br>" +
          "Copy number: %{customdata[2]}<br>" +
          "%{customdata[1]}<extra></extra>",
        showlegend: false,
      });
    });

    const plotWidth = Math.max(760, mags.length * 34 + 200);

    const plotLayout = {
      title: {
        text:
          `<b>${meta.title}</b>` +
          `<br><span style="font-size:12px;color:#666">` +
          `${meta.n_mags} MAGs × ${meta.n_targets} rRNA targets · ` +
          `dots scaled to copy count</span>`,
        x: 0.01,
        xanchor: "left",
        font: { ...font, size: 18 },
      },
      font,
      paper_bgcolor: "#ffffff",
      plot_bgcolor: "#ffffff",
      width: plotWidth,
      height: 460,
      xaxis: {
        title: {
          text: "Metagenome-Assembled Genome (MAG) — sorted by 16S copy number (descending)",
          font: { ...font, size: 12 },
          standoff: 12,
        },
        type: "category",
        categoryorder: "array",
        categoryarray: mags,
        tickmode: "array",
        tickvals: mags.map((_, i) => i),   // category positions 0..n-1
        ticktext: magLabels,               // short labels shown; full ids stay in hover
        tickangle: -45,
        tickfont: { ...font, size: 9 },
        showgrid: true,
        gridcolor: "rgba(0,0,0,0.05)",
        ticks: "outside",
        tickcolor: "rgba(0,0,0,0.3)",
      },
      yaxis: {
        title: { text: "rRNA Gene Target", font: { ...font, size: 12 } },
        type: "category",
        categoryorder: "array",
        categoryarray: yCatsBottomUp,
        tickfont: { ...font, size: 11 },
        showgrid: true,
        gridcolor: "rgba(0,0,0,0.05)",
        automargin: true,
      },
      margin: { l: 120, r: 24, t: 84, b: 150 },
      annotations: [
        {
          x: 0,
          y: -0.42,
          xref: "paper",
          yref: "paper",
          xanchor: "left",
          showarrow: false,
          text: `<span style="color:#999;font-size:10px">${meta.source_line}</span>`,
        },
      ],
    };

    const config = {
      responsive: true,
      displaylogo: false,
      scrollZoom: false,
      toImageButtonOptions: {
        format: "svg",
        filename: `${meta.sample_id}_barrnap_rRNA_copy`,
        scale: 2,
      },
      modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"],
    };

    return { traces, plotLayout, config };
  }, [doc, visible, sizePx, font]);

  if (error)
    return (
      <div style={{ padding: 16, color: "#b00020", fontFamily: "sans-serif" }}>
        Failed to load plot: {error}
      </div>
    );
  if (!figure)
    return (
      <div style={{ padding: 16, color: "#666", fontFamily: "sans-serif" }}>
        Loading rRNA copy-number matrix…
      </div>
    );

  const { layout, meta } = doc;
  const toggle = (comp) => setVisible((v) => ({ ...v, [comp]: !v[comp] }));

  // ---- custom legends (right column) ----
  const swatch = (comp) => {
    const filled = comp !== "None";
    return (
      <div
        key={comp}
        onClick={() => toggle(comp)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: "pointer",
          opacity: visible[comp] ? 1 : 0.35,
          marginBottom: 6,
          userSelect: "none",
        }}
      >
        <svg width="20" height="20">
          <circle
            cx="10"
            cy="10"
            r="7"
            fill={filled ? layout.colors[comp] : "#FFFFFF"}
            stroke={layout.outline[comp]}
            strokeWidth="1.4"
          />
        </svg>
        <span style={{ fontSize: 12, fontFamily: font.family, color: "#111" }}>
          {layout.completeness_labels[comp]}
        </span>
      </div>
    );
  };

  const maxLegPx = sizePx(meta.max_count);

  return (
    <div style={{ display: "flex", alignItems: "flex-start", width: "100%" }}>
      <div style={{ overflowX: "auto", flex: "1 1 auto", minWidth: 0 }}>
        <Plot
          data={figure.traces}
          layout={figure.plotLayout}
          config={figure.config}
          useResizeHandler={false}
        />
      </div>

      <div
        style={{
          flex: "0 0 170px",
          paddingTop: 24,
          paddingLeft: 8,
          fontFamily: font.family,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: "#111" }}>
          Copy Number
        </div>
        <svg width="150" height={Math.ceil(maxLegPx) * layout.size_breaks.length + 20}>
          {(() => {
            let cy = 6;
            return layout.size_breaks.map((b) => {
              const r = sizePx(b) / 2;
              cy += r + 4;
              const row = (
                <g key={b}>
                  <circle
                    cx={maxLegPx / 2 + 2}
                    cy={cy}
                    r={r}
                    fill="#666666"
                    stroke="#444"
                    strokeWidth="0.8"
                  />
                  <text
                    x={maxLegPx + 14}
                    y={cy + 4}
                    fontSize="12"
                    fill="#111"
                  >
                    {b}
                  </text>
                </g>
              );
              cy += r + 6;
              return row;
            });
          })()}
        </svg>

        <div
          style={{
            fontWeight: 700,
            fontSize: 13,
            margin: "14px 0 8px",
            color: "#111",
          }}
        >
          Gene Completeness
        </div>
        {layout.completeness_order.map((c) => swatch(c))}
      </div>
    </div>
  );
}
