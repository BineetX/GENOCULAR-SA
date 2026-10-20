import React, { useEffect, useMemo, useState, useCallback } from "react";
import Plot from "../UpdatedPlot.jsx";



/**
 * MAGHadegDashboard
 * -----------------
 * Interactive Plotly force-directed network for HADEG hydrocarbon-degradation
 * pathway co-occurrence. Reads JSON produced by hadeg_network_json.py (place
 * it in the CRA /public folder as mag_hadeg_plots_data.json).
 *
 * Features:
 *   - Hub (numbered squares), gene (larger circles), MAG (smaller circles)
 *   - Edges coloured by pathway group
 *   - Toggle visibility of node types (hub / gene / MAG)
 *   - Hover tooltips on nodes & edges
 *   - Legend at bottom, column-wise layout
 *   - No caption text (removed per modification #1)
 *   - SVG export via Plotly modebar
 *
 * Usage:
 *   <MAGHadegDashboard src="/mag_hadeg_plots_data.json" />
 */
export default function MAGHadegDashboard({
  src = "/mag_hadeg_plots_data.json",
}) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);
  const [showHubs, setShowHubs] = useState(true);
  const [showGenes, setShowGenes] = useState(true);
  const [showMags, setShowMags] = useState(true);

  /* ---- fetch JSON ---- */
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

  /* ---- helpers ---- */
  const visibleTypes = useMemo(() => {
    const s = new Set();
    if (showHubs) s.add("hub");
    if (showGenes) s.add("gene");
    if (showMags) s.add("mag");
    return s;
  }, [showHubs, showGenes, showMags]);

  /* ---- build Plotly figure ---- */
  const figure = useMemo(() => {
    if (!doc) return null;

    const { nodes, edges, pathway_colors, pathway_numbers, meta } = doc;

    /* --- collect visible node IDs for edge filtering --- */
    const visibleNodeIds = new Set(
      nodes.filter((n) => visibleTypes.has(n.node_type)).map((n) => n.id)
    );

    /* --- edge traces: one trace per pathway group for legend control --- */
    const edgesByGroup = {};
    edges.forEach((e) => {
      /* show edge only if both endpoints visible */
      if (!visibleNodeIds.has(e.from) && !visibleNodeIds.has(e.to)) return;
      /* for gene_mag edges, both must be visible */
      if (e.edge_type === "gene_mag") {
        if (!visibleNodeIds.has(e.from) || !visibleNodeIds.has(e.to)) return;
      }
      /* for hub_gene, hub or gene must be visible */
      if (e.edge_type === "hub_gene") {
        if (!visibleNodeIds.has(e.from) && !visibleNodeIds.has(e.to)) return;
      }
      const grp = e.color_group;
      if (!edgesByGroup[grp]) edgesByGroup[grp] = [];
      edgesByGroup[grp].push(e);
    });

    const traces = [];

    /* Draw edges as individual line segments with null separators */
    Object.entries(edgesByGroup).forEach(([grp, grpEdges]) => {
      const xs = [];
      const ys = [];
      grpEdges.forEach((e) => {
        xs.push(e.x0, e.x1, null);
        ys.push(e.y0, e.y1, null);
      });
      traces.push({
        x: xs,
        y: ys,
        mode: "lines",
        type: "scatter",
        line: {
          color: pathway_colors[grp] || "#AAAAAA",
          width: 1.2,
        },
        opacity: 0.45,
        hoverinfo: "skip",
        showlegend: false,
        name: `${grp} edges`,
      });
    });

    /* --- node traces: separate by type × group for styling --- */

    /* Hub nodes: numbered squares */
    const hubNodes = nodes.filter(
      (n) => n.node_type === "hub" && visibleTypes.has("hub")
    );
    if (hubNodes.length > 0) {
      traces.push({
        x: hubNodes.map((n) => n.x),
        y: hubNodes.map((n) => n.y),
        mode: "markers+text",
        type: "scatter",
        marker: {
          symbol: "square",
          size: hubNodes.map((n) => n.node_size * 3.2),
          color: hubNodes.map(
            (n) => pathway_colors[n.dom_group] || "#AAAAAA"
          ),
          line: { color: "#222", width: 2 },
        },
        text: hubNodes.map((n) => pathway_numbers[n.dom_group] || "0"),
        textfont: {
          size: 14,
          color: "#fff",
          family: "Arial Black, Arial, sans-serif",
        },
        textposition: "middle center",
        hoverinfo: "text",
        hovertext: hubNodes.map(
          (n) =>
            `<b>${n.label}</b><br>Type: Pathway Group Hub<br>Number: ${
              pathway_numbers[n.dom_group] || "0"
            }`
        ),
        showlegend: false,
        name: "Pathway Hubs",
      });
    }

    /* Gene nodes: larger circles, grouped by pathway for legend */
    const geneNodes = nodes.filter(
      (n) => n.node_type === "gene" && visibleTypes.has("gene")
    );
    const genesByGroup = {};
    geneNodes.forEach((n) => {
      if (!genesByGroup[n.dom_group]) genesByGroup[n.dom_group] = [];
      genesByGroup[n.dom_group].push(n);
    });

    /* track which groups we've shown in legend */
    const legendShown = new Set();

    Object.entries(genesByGroup).forEach(([grp, grpNodes]) => {
      const showInLegend = !legendShown.has(grp);
      if (showInLegend) legendShown.add(grp);
      traces.push({
        x: grpNodes.map((n) => n.x),
        y: grpNodes.map((n) => n.y),
        mode: "markers+text",
        type: "scatter",
        marker: {
          symbol: "circle",
          size: grpNodes.map((n) => n.node_size * 2.8),
          color: pathway_colors[grp] || "#AAAAAA",
          line: { color: "#333", width: 1.2 },
          opacity: 0.88,
        },
        text: grpNodes.map((n) => n.label),
        textfont: { size: 8.5, color: "#333", family: "Arial, sans-serif" },
        textposition: "top center",
        hoverinfo: "text",
        hovertext: grpNodes.map(
          (n) =>
            `<b>${n.label}</b><br>Type: Gene<br>Pathway: ${n.dom_group}<br>Relative size: ${n.node_size.toFixed(
              1
            )}`
        ),
        showlegend: showInLegend,
        legendgroup: grp,
        name: grp,
      });
    });

    /* MAG nodes: smaller circles */
    const magNodes = nodes.filter(
      (n) => n.node_type === "mag" && visibleTypes.has("mag")
    );
    const magsByGroup = {};
    magNodes.forEach((n) => {
      if (!magsByGroup[n.dom_group]) magsByGroup[n.dom_group] = [];
      magsByGroup[n.dom_group].push(n);
    });

    Object.entries(magsByGroup).forEach(([grp, grpNodes]) => {
      const showInLegend = !legendShown.has(grp);
      if (showInLegend) legendShown.add(grp);
      traces.push({
        x: grpNodes.map((n) => n.x),
        y: grpNodes.map((n) => n.y),
        mode: "markers+text",
        type: "scatter",
        marker: {
          symbol: "circle",
          size: grpNodes.map((n) => n.node_size * 2.2),
          color: pathway_colors[grp] || "#AAAAAA",
          line: { color: "#555", width: 0.8 },
          opacity: 0.75,
        },
        text: grpNodes.map((n) => n.label),
        textfont: {
          size: 7.5,
          color: "#555",
          family: "Arial, sans-serif",
        },
        textposition: "bottom center",
        hoverinfo: "text",
        hovertext: grpNodes.map(
          (n) =>
            `<b>${n.label}</b><br>Type: MAG<br>Dominant pathway: ${n.dom_group}<br>Relative size: ${n.node_size.toFixed(
              1
            )}`
        ),
        showlegend: showInLegend,
        legendgroup: grp,
        name: grp,
      });
    });

    /* --- layout --- */
    const layout = {
      title: {
        text: `<b>${meta.title}</b><br><span style="font-size:13px;color:#444">${meta.subtitle}</span>`,
        font: { size: 18, color: "#111", family: "Arial, sans-serif" },
        x: 0.5,
        xanchor: "center",
        y: 0.97,
      },
      xaxis: {
        visible: false,
        showgrid: false,
        zeroline: false,
        scaleanchor: "y",
        scaleratio: 1,
      },
      yaxis: {
        visible: false,
        showgrid: false,
        zeroline: false,
      },
      hovermode: "closest",
      dragmode: "pan",
      plot_bgcolor: "#FAFAFA",
      paper_bgcolor: "#fff",
      margin: { t: 80, b: 120, l: 30, r: 30 },
      legend: {
        orientation: "h",
        x: 0.5,
        xanchor: "center",
        y: -0.08,
        yanchor: "top",
        font: { size: 12, color: "#333", family: "Arial, sans-serif" },
        bgcolor: "rgba(255,255,255,0.9)",
        bordercolor: "#ccc",
        borderwidth: 1,
        tracegroupgap: 5,
        itemwidth: 30,
      },
      /* no caption/annotations at bottom (modification #1) */
      annotations: [],
      width: 1050,
      height: 850,
    };

    const config = {
      displayModeBar: true,
      displaylogo: false,
      toImageButtonOptions: {
        format: "svg",
        filename: `HADEG_network_${meta.sample_id}`,
        width: 1400,
        height: 1100,
      },
      modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"],
      scrollZoom: true,
    };

    return { data: traces, layout, config };
  }, [doc, visibleTypes]);

  /* ---- toggle handler ---- */
  const Toggle = useCallback(
    ({ label, checked, onChange }) => (
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          cursor: "pointer",
          padding: "4px 14px",
          borderRadius: 20,
          background: checked ? "#e8f4fd" : "#f5f5f5",
          border: `1.5px solid ${checked ? "#0072B2" : "#ccc"}`,
          fontWeight: 600,
          fontSize: 13,
          color: checked ? "#0072B2" : "#888",
          transition: "all 0.15s",
          userSelect: "none",
        }}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={onChange}
          style={{ display: "none" }}
        />
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: 4,
            border: `2px solid ${checked ? "#0072B2" : "#bbb"}`,
            background: checked ? "#0072B2" : "#fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            color: "#fff",
            transition: "all 0.15s",
          }}
        >
          {checked ? "✓" : ""}
        </span>
        {label}
      </label>
    ),
    []
  );

  /* ---- render ---- */
  if (error)
    return (
      <div
        style={{
          padding: 32,
          color: "#b00",
          fontFamily: "monospace",
          fontSize: 15,
        }}
      >
        ⚠ Failed to load HADEG network data: {error}
      </div>
    );
  if (!doc)
    return (
      <div
        style={{
          padding: 32,
          color: "#666",
          fontSize: 15,
        }}
      >
        Loading HADEG network data…
      </div>
    );

  const { stats } = doc;

  return (
    <div
      style={{
        maxWidth: 1100,
        margin: "0 auto",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      {/* --- summary cards --- */}
      <div
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          justifyContent: "center",
          marginBottom: 10,
          marginTop: 12,
        }}
      >
        {[
          { label: "MAGs", value: stats.n_mags, bg: "#E3F2FD", fg: "#0D47A1" },
          {
            label: "Genes Detected",
            value: stats.n_genes,
            bg: "#FFF3E0",
            fg: "#E65100",
          },
          {
            label: "Pathway Groups",
            value: stats.n_groups,
            bg: "#E8F5E9",
            fg: "#1B5E20",
          },
          {
            label: "Ortholog Hits",
            value: stats.total_hits,
            bg: "#F3E5F5",
            fg: "#4A148C",
          },
        ].map((c) => (
          <div
            key={c.label}
            style={{
              background: c.bg,
              borderRadius: 10,
              padding: "10px 22px",
              textAlign: "center",
              minWidth: 120,
              boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
            }}
          >
            <div style={{ fontSize: 26, fontWeight: 800, color: c.fg }}>
              {c.value}
            </div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: c.fg,
                opacity: 0.8,
                marginTop: 2,
              }}
            >
              {c.label}
            </div>
          </div>
        ))}
      </div>

      {/* --- toggle bar --- */}
      <div
        style={{
          display: "flex",
          gap: 10,
          justifyContent: "center",
          marginBottom: 8,
          flexWrap: "wrap",
        }}
      >
        <Toggle
          label="Hub Nodes"
          checked={showHubs}
          onChange={() => setShowHubs((v) => !v)}
        />
        <Toggle
          label="Gene Nodes"
          checked={showGenes}
          onChange={() => setShowGenes((v) => !v)}
        />
        <Toggle
          label="MAG Nodes"
          checked={showMags}
          onChange={() => setShowMags((v) => !v)}
        />
      </div>

      {/* --- network legend key --- */}
      <div
        style={{
          display: "flex",
          gap: 18,
          justifyContent: "center",
          marginBottom: 6,
          fontSize: 12,
          color: "#555",
          fontWeight: 600,
          flexWrap: "wrap",
        }}
      >
        <span>
          <span
            style={{
              display: "inline-block",
              width: 14,
              height: 14,
              background: "#888",
              borderRadius: 2,
              verticalAlign: "middle",
              marginRight: 4,
              border: "1.5px solid #222",
            }}
          />
          Numbered Square = Pathway Hub
        </span>
        <span>
          <span
            style={{
              display: "inline-block",
              width: 14,
              height: 14,
              background: "#888",
              borderRadius: "50%",
              verticalAlign: "middle",
              marginRight: 4,
              border: "1.5px solid #333",
            }}
          />
          Larger ● = Gene
        </span>
        <span>
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              background: "#aaa",
              borderRadius: "50%",
              verticalAlign: "middle",
              marginRight: 4,
              border: "1px solid #555",
            }}
          />
          Smaller ● = MAG
        </span>
      </div>

      {/* --- plot --- */}
      <div
        style={{
          overflowX: "auto",
          border: "1px solid #e0e0e0",
          borderRadius: 8,
          background: "#fff",
        }}
      >
        {figure && (
          <Plot
            data={figure.data}
            layout={figure.layout}
            config={figure.config}
            useResizeHandler
            style={{ width: "100%", minWidth: 900 }}
          />
        )}
      </div>

      {/* --- active pathway groups --- */}
      <div
        style={{
          display: "flex",
          gap: 14,
          justifyContent: "center",
          marginTop: 12,
          flexWrap: "wrap",
        }}
      >
        {(stats.active_groups || []).map((grp) => (
          <div
            key={grp}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              fontWeight: 600,
              color: "#333",
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 16,
                height: 16,
                borderRadius: 3,
                background: doc.pathway_colors[grp] || "#aaa",
                border: "1px solid #555",
              }}
            />
            {grp} ({doc.pathway_numbers[grp] || "0"})
          </div>
        ))}
      </div>
    </div>
  );
}
