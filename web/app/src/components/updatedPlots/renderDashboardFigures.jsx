import React from "react";
import { createRoot } from "react-dom/client";
import UpdatedDashboard from "./UpdatedDashboard.jsx";

function cancelled(signal) {
  if (signal?.aborted) throw new DOMException("PDF export cancelled.", "AbortError");
}

function cleanTitle(value) {
  const node = document.createElement("div");
  node.innerHTML = String(value || "");
  return (node.textContent || "").trim();
}

export async function renderUpdatedDashboardFigures(card, options = {}, signal) {
  if (typeof document === "undefined") throw new Error("Dashboard export requires a browser.");
  cancelled(signal);

  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-12000px;top:0;width:1120px;background:#fff;pointer-events:none;z-index:-1";
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(
    <UpdatedDashboard
      renderer={card.renderer}
      payload={card.payload}
      assetUrl={card.assetUrl}
      plotStyle={options.plotStyle}
      publicationPalette={options.publicationPalette}
    />
  );

  try {
    const started = Date.now();
    let plots = [];
    while (Date.now() - started < 25000) {
      cancelled(signal);
      plots = [...host.querySelectorAll(".js-plotly-plot")].filter((node) => node._fullLayout && node.data?.length);
      const expected = host.querySelectorAll("[data-updated-plot]").length;
      if (expected > 0 && plots.length >= expected) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    if (!plots.length) {
      const message = host.querySelector("[class*='rose-'],[style*='color: rgb(216, 0, 12)']")?.textContent;
      throw new Error(message?.trim() || "Updated dashboard did not render any figures.");
    }
    const plotlyModule = await import("plotly.js-dist-min");
    const Plotly = plotlyModule.default || plotlyModule;
    const figures = [];
    for (const plot of plots) {
      cancelled(signal);
      const title = cleanTitle(plot._fullLayout?.title?.text || plot.layout?.title?.text);
      const width = Math.min(1400, Math.max(900, plot.clientWidth || 1100));
      const height = Math.min(800, Math.max(350, plot.clientHeight || plot.layout?.height || 500));
      const image = await Plotly.toImage(plot, { format: "png", width, height, scale: 1.5 });
      figures.push({ title, image });
    }
    return figures;
  } finally {
    root.unmount();
    host.remove();
  }
}
