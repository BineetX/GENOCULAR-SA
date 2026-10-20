import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileDown, LoaderCircle, X } from "lucide-react";
import { buildAnalysisPdf, downloadPdfBlob } from "../lib/analysisReport.js";
import { apiJson } from "../lib/api.js";

function progressPercent(progress) {
  if (progress?.stage === "finalizing") return 98;
  if (progress?.stage === "genome-maps") {
    if (!progress?.total) return 8;
    return Math.max(8, Math.min(31, Math.round((progress.current / progress.total) * 23) + 8));
  }
  if (progress?.stage === "composing") return 34;
  if (progress?.stage === "rendering") {
    if (!progress?.total) return 38;
    return Math.max(38, Math.min(94, Math.round((progress.current / progress.total) * 56) + 38));
  }
  if (!progress?.total) return progress?.stage === "starting" ? 4 : 0;
  return Math.max(6, Math.min(94, Math.round((progress.current / progress.total) * 88) + 6));
}

export default function AnalysisReportExport({
  jobId,
  analysisIndex,
  analysisCards,
  analysisInterpretation,
  dashboardGroups,
  genomeMapCount = 0,
  isDark = false,
  disabled = false,
  plotStyle = "modern",
  publicationPalette = "okabe_ito",
  renderGenomeMaps,
  submittedBy,
}) {
  const controllerRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const startExport = async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setError("");
    setComplete(null);
    setProgress({ stage: "starting", current: 0, total: 0, label: "Preparing report" });
    try {
      let jobSteps = null;
      let workflowWarning = "";
      try {
        jobSteps = await apiJson(`/jobs/${encodeURIComponent(jobId)}/steps`, { signal: controller.signal });
      } catch (stepsError) {
        if (stepsError?.name === "AbortError") throw stepsError;
        workflowWarning = `Workflow step history was unavailable: ${stepsError?.message || String(stepsError)}`;
      }
      let genomeMapResult = { maps: [], warnings: [] };
      if (genomeMapCount > 0 && renderGenomeMaps) {
        setProgress({ stage: "genome-maps", current: 0, total: genomeMapCount, label: `Rendering ${genomeMapCount} genome ${genomeMapCount === 1 ? "map" : "maps"}` });
        genomeMapResult = await renderGenomeMaps({
          signal: controller.signal,
          onProgress: (next) => setProgress({ stage: "genome-maps", ...next }),
        });
      }
      setProgress({ stage: "composing", current: 0, total: analysisCards?.length || 0, label: "Composing report" });
      const result = await buildAnalysisPdf({
        jobId,
        analysisIndex,
        analysisCards,
        analysisInterpretation,
        dashboardGroups,
        genomeMaps: genomeMapResult.maps,
        genomeMapWarnings: genomeMapResult.warnings,
        jobSteps,
        submittedBy,
        workflowWarning,
        plotStyle,
        publicationPalette,
        signal: controller.signal,
        onProgress: setProgress,
      });
      if (controller.signal.aborted) return;
      downloadPdfBlob(result.blob, result.filename);
      setComplete(result);
      setProgress(null);
    } catch (exportError) {
      if (controllerRef.current === controller && exportError?.name !== "AbortError") {
        setError(exportError?.message || String(exportError));
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setBusy(false);
      }
    }
  };

  const cancelExport = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setBusy(false);
    setProgress(null);
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={startExport}
        disabled={busy || disabled || !analysisCards?.length}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-sky-500 bg-gradient-to-r from-sky-600 to-cyan-600 px-4 text-[12px] font-bold text-white shadow-[0_10px_24px_-12px_rgba(2,132,199,0.9)] transition hover:-translate-y-px hover:from-sky-700 hover:to-cyan-700 hover:shadow-[0_12px_28px_-12px_rgba(2,132,199,0.95)] focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-45"
        aria-describedby={busy || error || complete ? "analysis-report-status" : undefined}
      >
        {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
        {busy ? "Building report" : "Export Detailed Report"}
      </button>

      {(busy || error || complete) && (
        <div
          id="analysis-report-status"
          className={`absolute right-0 top-12 z-30 w-[min(360px,calc(100vw-2rem))] rounded-2xl border p-3.5 shadow-xl ${
            isDark ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900"
          }`}
          role="status"
          aria-live="polite"
        >
          {busy && (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[12px] font-bold">Composing results report</div>
                  <div className={`mt-1 truncate text-[10px] ${isDark ? "text-slate-400" : "text-slate-500"}`} title={progress?.label}>
                    {progress?.label || "Preparing figures and tables"}
                  </div>
                </div>
                <button type="button" onClick={cancelExport} className={`rounded-lg p-1 ${isDark ? "text-slate-400 hover:bg-slate-800 hover:text-white" : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"}`} aria-label="Cancel PDF export">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className={`mt-3 h-1.5 overflow-hidden rounded-full ${isDark ? "bg-slate-800" : "bg-slate-100"}`}>
                <div className="h-full rounded-full bg-sky-500 transition-[width] duration-300" style={{ width: `${progressPercent(progress)}%` }} />
              </div>
              <div className={`mt-2 text-[9px] leading-4 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                Figures are rendered sequentially in this browser. No analysis data is uploaded to another service.
              </div>
            </>
          )}
          {!busy && error && (
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[12px] font-bold text-rose-600">PDF export could not finish</div>
                <div className={`mt-1 text-[10px] leading-4 ${isDark ? "text-slate-400" : "text-slate-600"}`}>{error}</div>
              </div>
              <button type="button" onClick={() => setError("")} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Dismiss export error"><X className="h-4 w-4" /></button>
            </div>
          )}
          {!busy && complete && (
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                <div>
                  <div className="text-[12px] font-bold">PDF downloaded</div>
                  <div className={`mt-1 text-[10px] ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                    {complete.pageCount} pages · {complete.figureCount} figures
                  </div>
                </div>
              </div>
              <button type="button" onClick={() => setComplete(null)} className={`rounded-lg p-1 ${isDark ? "text-slate-400 hover:bg-slate-800" : "text-slate-400 hover:bg-slate-100"}`} aria-label="Dismiss export confirmation"><X className="h-4 w-4" /></button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
