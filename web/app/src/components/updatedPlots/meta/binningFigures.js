export function buildBinningFigures(doc, { showCross = true, showLabels = false } = {}) {
  const { layout, panels } = doc;
  const names = layout.panels.filter((name) => panels[name]);
  const coverages = names.flatMap((name) => panels[name].points.map((point) => point.coverage)).filter((value) => Number.isFinite(value) && value > 0);
  const xRange = coverages.length ? [Math.log10(Math.min(...coverages)) - 0.18, Math.log10(Math.max(...coverages)) + 0.18] : [0, 1];
  const yRange = [Math.max(0, layout.gc.range[0] - 4), Math.min(100, layout.gc.range[1] + 4)];
  const sizePx = (value) => {
    const { range_px: [min, max], ref_min: low, ref_max: high } = layout.size;
    return high > low && value != null ? min + (max - min) * Math.max(0, Math.min(1, (value - low) / (high - low))) : min;
  };

  return names.map((name) => {
    const { points, stats, crosshair } = panels[name];
    const shapes = [];
    if (showCross && crosshair) {
      if (Number.isFinite(crosshair.med_gc)) shapes.push({ type: "line", xref: "x domain", yref: "y", x0: 0, x1: 1, y0: crosshair.med_gc, y1: crosshair.med_gc, line: { color: "#64748b", width: 1, dash: "dot" } });
      if (crosshair.med_cov > 0) shapes.push({ type: "line", xref: "x", yref: "y domain", x0: crosshair.med_cov, x1: crosshair.med_cov, y0: 0, y1: 1, line: { color: "#64748b", width: 1, dash: "dot" } });
    }
    const annotations = [{
      xref: "paper", yref: "paper", x: 0, y: 1.005, xanchor: "left", yanchor: "bottom", showarrow: false,
      text: `Median GC ${stats.median_gc}% · Coverage ${stats.median_cov}×`, font: { size: 10, color: "#64748b" },
    }, {
      xref: "paper", yref: "paper", x: 0.5, y: 0.17, showarrow: false,
      text: "Genome size (Mb)", font: { size: 10, color: "#475569" },
    }];
    if (showLabels) points.filter((point) => point.is_outlier && point.coverage > 0).forEach((point, index) => {
      annotations.push({ xref: "x", yref: "y", x: Math.log10(point.coverage), y: point.gc_pct,
        text: point.label, showarrow: true, ax: point.coverage > 10 ** ((xRange[0] + xRange[1]) / 2) ? -28 : 28,
        ay: [-24, 24, -42][index % 3], arrowhead: 0, arrowwidth: 0.7, arrowcolor: "#94a3b8",
        bgcolor: "rgba(255,255,255,0.92)", borderpad: 2, font: { size: 9, color: "#475569" } });
    });
    const breaks = layout.size.breaks;
    return {
      name, stats, panelTitle: `${name} · ${stats.n_bins} bins`,
      config: { toImageButtonOptions: { filename: `${doc.meta.sample_id}_${name}_binning` } },
      data: [{
        type: points.length > 3000 ? "scattergl" : "scatter", mode: "markers",
        x: points.map((point) => point.coverage), y: points.map((point) => point.gc_pct),
        marker: { size: points.map((point) => sizePx(point.genome_size_mb)), color: points.map((point) => point.gc_pct),
          cmin: layout.gc.range[0], cmax: layout.gc.range[1], colorscale: layout.gc.colorscale, showscale: true,
          colorbar: { title: { text: "GC (%)", font: { size: 10 } }, x: 1.02, y: 0.67, len: 0.66, thickness: 10,
            ticksuffix: "%", tickfont: { size: 10 }, outlinewidth: 0 },
          opacity: 0.88, line: { color: "#8da5bb", width: 0.7 } },
        customdata: points.map((point) => [point.bin_id, point.genome_size_mb ?? "N/A", point.num_contigs ?? "N/A"]),
        hovertemplate: "<b>%{customdata[0]}</b><br>Coverage: %{x:.2f}×<br>GC: %{y:.1f}%<br>Genome size: %{customdata[1]} Mb<br>Contigs: %{customdata[2]}<extra></extra>",
        showlegend: false,
      }, {
        type: "scatter", mode: "markers", xaxis: "x2", yaxis: "y2",
        x: breaks.map((_, index) => (index + 0.5) / breaks.length), y: breaks.map(() => 0.85),
        marker: { size: breaks.map(sizePx), color: "#64748b", line: { color: "#fff", width: 0.8 } },
        hoverinfo: "skip", showlegend: false, cliponaxis: false,
      }, {
        type: "scatter", mode: "text", xaxis: "x2", yaxis: "y2",
        x: breaks.map((_, index) => (index + 0.5) / breaks.length), y: breaks.map(() => 0.05),
        text: breaks.map(String), textfont: { size: 10, color: "#475569" },
        hoverinfo: "skip", showlegend: false, cliponaxis: false,
      }],
      layout: {
        height: 510, margin: { l: 60, r: 70, t: 52, b: 24 },
        xaxis: { type: "log", range: xRange, dtick: 1, tickformat: "~s", anchor: "y", domain: [0, 1],
          title: { text: "Coverage (×, log₁₀)", standoff: 10 }, showgrid: true, gridcolor: "#edf2f7" },
        yaxis: { range: yRange, domain: [0.34, 1], anchor: "x", dtick: 10,
          title: { text: "GC content (%)", standoff: 8 }, showgrid: true, gridcolor: "#edf2f7" },
        xaxis2: { domain: [0, 1], range: [0, 1], visible: false, fixedrange: true, anchor: "y2" },
        yaxis2: { domain: [0.02, 0.1], range: [0, 1], visible: false, fixedrange: true, anchor: "x2" },
        showlegend: false, shapes, annotations,
      },
    };
  });
}
