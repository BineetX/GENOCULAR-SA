import React, { useEffect, useState } from "react";
import { subscribeAllUploadTasks, isClientUploadStatus } from "../lib/jobStore.js";
import { Loader2, AlertCircle } from "lucide-react";

export default function GlobalUploadProgress() {
  const [tasks, setTasks] = useState([]);

  useEffect(() => {
    return subscribeAllUploadTasks(setTasks);
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      const isUploading = tasks.some(t => t.status === "uploading" || t.status === "submitting");
      if (isUploading) {
        e.preventDefault();
        e.returnValue = "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [tasks]);

  const activeTasks = tasks.filter((t) => isClientUploadStatus(t.status) || t.status === "error");

  if (activeTasks.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-3 max-w-sm w-full pointer-events-none">
      {activeTasks.map((task) => {
        const total =
          (task.r1Progress?.total || 0) +
          (task.r2Progress?.total || 0) +
          (task.rLongProgress?.total || 0);
        const done =
          (task.r1Progress?.done || 0) +
          (task.r2Progress?.done || 0) +
          (task.rLongProgress?.done || 0);

        const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
        
        let statusIcon = <Loader2 className="w-5 h-5 text-sky-500 animate-spin" />;
        let statusText = "Uploading...";
        let barColor = "bg-sky-500";
        
        if (task.status === "submitting") {
          statusText = "Submitting job...";
        } else if (task.status === "paused") {
          statusIcon = <AlertCircle className="w-5 h-5 text-amber-500" />;
          statusText = "Paused";
          barColor = "bg-amber-500";
        } else if (task.status === "error") {
          statusIcon = <AlertCircle className="w-5 h-5 text-rose-500" />;
          statusText = "Upload Failed";
          barColor = "bg-rose-500";
        }

        return (
          <div
            key={task.jobId}
            className="bg-white border border-slate-200 shadow-xl rounded-xl p-4 flex flex-col gap-2 relative overflow-hidden pointer-events-auto"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                  {statusIcon}
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-slate-800 line-clamp-1">
                    {task.sampleId || "Unnamed Job"}
                  </span>
                  <span className="text-xs text-slate-500 font-medium">
                    {statusText}
                  </span>
                </div>
              </div>
              <span className="text-sm font-bold text-slate-700">{pct}%</span>
            </div>
            
            {task.error && (
              <p className="text-xs text-rose-600 font-medium break-words">
                {task.error}
              </p>
            )}

            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden mt-1">
              <div
                className={`h-full transition-all duration-300 ${barColor}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
