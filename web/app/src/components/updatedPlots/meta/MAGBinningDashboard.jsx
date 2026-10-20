import React, { useEffect, useMemo, useState } from "react";
import Plot from "../UpdatedPlot.jsx";
import { buildBinningFigures } from "./binningFigures.js";

export default function MAGBinningDashboard({ src }) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState("");
  const [showCross, setShowCross] = useState(true);
  const [showLabels, setShowLabels] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(src, { signal: controller.signal }).then((response) => {
      if (!response.ok) throw new Error("Could not load binning results.");
      return response.json();
    }).then(setDoc).catch((cause) => {
      if (cause.name !== "AbortError") setError(cause.message);
    });
    return () => controller.abort();
  }, [src]);
  const figures = useMemo(() => doc ? buildBinningFigures(doc, { showCross, showLabels }) : [], [doc, showCross, showLabels]);
  if (error) return <div className="p-3 text-xs text-rose-700">{error}</div>;
  if (!doc) return <div className="h-96 animate-pulse rounded-xl bg-slate-50" />;

  return (
    <div className="w-full">
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-2 px-1 text-xs text-slate-600">
        <label className="inline-flex cursor-pointer items-center gap-2"><input type="checkbox" checked={showCross} onChange={(event) => setShowCross(event.target.checked)} className="accent-sky-600" />Median crosshairs</label>
        <label className="inline-flex cursor-pointer items-center gap-2"><input type="checkbox" checked={showLabels} onChange={(event) => setShowLabels(event.target.checked)} className="accent-sky-600" />Outlier labels</label>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2" data-binning-panels>
        {figures.map((figure) => (
          <div key={figure.name} className="min-w-0 overflow-hidden rounded-xl border border-slate-100 bg-white px-2 pt-2" data-binning-panel={figure.name}>
            <Plot data={figure.data} layout={figure.layout} config={figure.config} panelTitle={figure.panelTitle} />
            <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 border-t border-slate-100 px-2 py-2.5 text-[10px] text-slate-500">
              <span>Median size <span className="font-semibold text-slate-700">{figure.stats.median_gs_mb} Mb</span></span>
              <span><span className="font-semibold text-slate-700">{figure.stats.total_contigs.toLocaleString()}</span> contigs</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
