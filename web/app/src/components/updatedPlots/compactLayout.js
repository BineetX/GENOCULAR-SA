const plainText = (value) => String(value || "").replace(/<[^>]*>/g, "").trim();

// Keep scientific annotations and subplot labels, but not standalone-app chrome.
export function compactLayout(layout = {}, { renderer = "", sample = "", captions = [], plotStyle = "modern", panelTitle = "" } = {}) {
  const next = { ...layout };
  const meta = renderer.startsWith("mag_");
  const originalTitle = typeof layout.title === "string" ? layout.title : layout.title?.text;
  let title = plainText(String(originalTitle || "").split(/<br\s*\/?\s*>/i)[0]);
  if (sample) title = title.replace(`: ${sample}`, "").replace(` — ${sample}`, "");
  if (meta) title = panelTitle; // Keep only distinct scientific panel labels.
  next.title = { text: title, x: 0, xanchor: "left", font: { size: 14, color: "#334155" } };
  const captionTexts = captions.map(plainText).filter(Boolean);
  next.annotations = (layout.annotations || []).filter((annotation) =>
    !captionTexts.includes(plainText(annotation.text))
  );
  const removedFooter = next.annotations.length !== (layout.annotations || []).length;
  const abovePanel = next.annotations.some((annotation) =>
    /^(paper|[xy]\d* domain)$/.test(annotation.yref || "") && annotation.y > 1
  );
  const oldMargin = layout.margin || {};
  const aboveLegend = layout.legend?.orientation === "h" && layout.legend?.y >= 1;
  const top = title || abovePanel || aboveLegend ? 52 : 24;
  next.margin = { ...oldMargin, t: top, b: removedFooter ? Math.min(oldMargin.b || 60, 76) : oldMargin.b || 60 };
  if (layout.height) {
    const reclaimed = Math.max(0, (oldMargin.t || top) - top) + Math.max(0, (oldMargin.b || 60) - next.margin.b);
    next.height = Math.max(320, layout.height - reclaimed);
  }
  if (plotStyle === "modern") {
    const family = "Inter, ui-sans-serif, system-ui, sans-serif";
    for (const [key, axis] of Object.entries(layout)) {
      if (!/^[xy]axis\d*$/.test(key)) continue;
      const title = typeof axis.title === "string" ? { text: axis.title } : axis.title || {};
      next[key] = { ...axis, linewidth: 1, ticklen: 4,
        linecolor: "#b8cbe0", tickcolor: "#94a3b8",
        tickfont: { ...axis.tickfont, family, size: Math.min(axis.tickfont?.size || 11, 12), color: "#475569", weight: "normal" },
        title: { ...title, text: plainText(title.text), font: { family, size: 12, color: "#334155" } },
        titlefont: { family, size: 12, color: "#334155" },
      };
    }
    next.legend = { ...layout.legend, font: { family, size: 11, color: "#475569" },
      title: { ...layout.legend?.title, font: { family, size: 11, color: "#334155" } } };
  }
  return next;
}
