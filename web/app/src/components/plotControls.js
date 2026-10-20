export function plotConfiguration(config = {}) {
  return {
    responsive: true,
    scrollZoom: false,
    ...config,
    displayModeBar: false,
    displaylogo: false,
    showTips: false,
  };
}

// Plotly mutates its inputs during interaction; retain an untouched reset figure.
export function copyPlotFigure(figure) {
  return structuredClone(figure);
}

export function plotDownloadOptions(format, filename, height) {
  return {
    format,
    filename: String(filename || "analysis-plot").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180),
    width: 1400,
    height: Math.min(1200, Math.max(440, Number(height) || 600)),
    scale: format === "png" ? 2 : 1,
  };
}

export function supportsPlotNavigation(figure) {
  const types = new Set(["scatter", "scattergl", "bar", "histogram", "box", "violin", "heatmap", "contour", "histogram2d", "histogram2dcontour"]);
  return (figure?.data || []).some((trace) => types.has(trace.type || "scatter"));
}
