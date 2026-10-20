import React, { useState } from "react";
import { Hand, RotateCcw, ZoomIn } from "lucide-react";
import { copyPlotFigure, plotDownloadOptions, supportsPlotNavigation } from "./plotControls.js";

export default function PlotControls({ plotRef, plotlyRef, figure, config, disabled = false, publication = false, filename }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [interaction, setInteraction] = useState(null);
  const mode = interaction?.figure === figure ? interaction.mode : figure.layout?.dragmode || "zoom";
  const buttonClass = "inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2 text-[11px] font-semibold text-slate-600 transition hover:bg-white hover:text-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:pointer-events-none disabled:opacity-40";

  async function run(action) {
    if (disabled || busy || !plotRef.current || !plotlyRef.current) return;
    setBusy(true);
    setError("");
    try { await action(plotlyRef.current, plotRef.current); }
    catch (cause) { setError(cause?.message || "Plot action failed."); }
    finally { setBusy(false); }
  }

  function setMode(nextMode) {
    return run(async (plotly, node) => {
      await plotly.relayout(node, { dragmode: nextMode });
      setInteraction({ figure, mode: nextMode });
    });
  }

  function reset() {
    return run(async (plotly, node) => {
      const original = copyPlotFigure(figure);
      await plotly.react(node, original.data, original.layout, config);
      setInteraction(null);
    });
  }

  function download(format) {
    return run((plotly, node) => plotly.downloadImage(node, plotDownloadOptions(format, filename, node.clientHeight || figure.layout?.height)));
  }

  return (
    <div className="relative shrink-0" data-plot-controls>
      <div className={`inline-flex items-center gap-0.5 rounded-lg border p-0.5 ${publication ? "border-slate-200 bg-slate-50" : "border-sky-100 bg-sky-50/50"}`} role="group" aria-label="Plot actions" aria-busy={busy}>
        {supportsPlotNavigation(figure) && <>
          <button type="button" onClick={() => setMode("zoom")} disabled={disabled || busy} className={`${buttonClass} ${mode === "zoom" ? "bg-white text-sky-700 shadow-sm" : ""}`} title="Zoom selection" aria-label="Zoom selection" aria-pressed={mode === "zoom"}><ZoomIn className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={() => setMode("pan")} disabled={disabled || busy} className={`${buttonClass} ${mode === "pan" ? "bg-white text-sky-700 shadow-sm" : ""}`} title="Pan plot" aria-label="Pan plot" aria-pressed={mode === "pan"}><Hand className="h-3.5 w-3.5" /></button>
          <span className="mx-0.5 h-3.5 w-px bg-slate-200" aria-hidden="true" />
        </>}
        <button type="button" onClick={reset} disabled={disabled || busy} className={buttonClass} title="Reset plot"><RotateCcw className="h-3 w-3" />Reset</button>
        <button type="button" onClick={() => download("svg")} disabled={disabled || busy} className={buttonClass} title="Download SVG">SVG</button>
        <button type="button" onClick={() => download("png")} disabled={disabled || busy} className={buttonClass} title="Download PNG">PNG</button>
      </div>
      {error && <div role="alert" className="absolute right-0 top-full z-20 mt-1 max-w-64 rounded-lg border border-rose-200 bg-white p-2 text-xs text-rose-700 shadow-sm">{error}</div>}
    </div>
  );
}
