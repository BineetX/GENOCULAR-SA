import React, { useEffect, useMemo, useState } from "react";
import { apiJson, apiText } from "../lib/api.js";
import { motion as Motion } from "framer-motion";
import { useAuth } from "../auth/AuthProvider.jsx";
import { copyTextToClipboard } from "../lib/jobAccess.js";

const STATUS_COLORS = {
  running: "bg-sky-50 text-sky-700 border-sky-200",
  queued: "bg-amber-50 text-amber-700 border-amber-200",
  done: "bg-emerald-50 text-emerald-700 border-emerald-200",
  failed: "bg-rose-50 text-rose-700 border-rose-200",
  cancelled: "bg-slate-100 text-slate-600 border-slate-300",
  unknown: "bg-slate-50 text-slate-600 border-slate-200",
};

const STATUS_BADGE = {
  running: "bg-sky-50 text-sky-700 border border-sky-200",
  queued: "bg-amber-50 text-amber-700 border border-amber-200",
  done: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  failed: "bg-rose-50 text-rose-700 border border-rose-200",
  cancelled: "bg-slate-100 text-slate-600 border border-slate-300",
  unknown: "bg-slate-50 text-slate-600 border border-slate-200",
};

function fmtTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  return d.toLocaleString();
}

function fmtDuration(start, end) {
  if (!start || !end) return "—";
  const ms = (end - start) * 1000;
  if (ms <= 0) return "0 s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fmtBytes(value) {
  if (!Number.isFinite(value)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let size = Math.max(value, 0);
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const digits = size >= 100 || unit === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(digits)} ${units[unit]}`;
}

function fmtPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "—";
}

function fmtUptime(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function normalizeState(s) {
  const x = String(s || "").toLowerCase();
  if (/(cancel)/.test(x)) return "cancelled";
  if (/(success|complete|completed|done|finished|ok)/.test(x)) return "done";
  if (/(run|running|active|in[_-]?progress|working)/.test(x)) return "running";
  if (/(fail|error|crash|abort)/.test(x)) return "failed";
  if (/(queue|queued|pending|waiting)/.test(x)) return "queued";
  return "unknown";
}

export default function AdminDashboard() {
  // Use central auth provider (with custom claims)
  const { user, loading: authLoading, isAdmin, role } = useAuth();

  // Data
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const [systemDetails, setSystemDetails] = useState(null);
  const [systemLoading, setSystemLoading] = useState(false);
  const [systemError, setSystemError] = useState("");

  // UI state
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedJob, setSelectedJob] = useState(null);
  const [selectedDetails, setSelectedDetails] = useState(null);
  const [selectedLog, setSelectedLog] = useState("");
  const [logError, setLogError] = useState("");
  const [detailsTab, setDetailsTab] = useState("overview");
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [loadingLog, setLoadingLog] = useState(false);
  const [cancelBusyId, setCancelBusyId] = useState(null);
  const [viewerLinkBusyId, setViewerLinkBusyId] = useState(null);
  const [viewerLinkDialog, setViewerLinkDialog] = useState(null);
  const [retryBusyId, setRetryBusyId] = useState(null);
  const [retryDialogJob, setRetryDialogJob] = useState(null);
  const [retryReason, setRetryReason] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);

  // ---------------------------
  // Fetch jobs list (admin API)
  // ---------------------------
  useEffect(() => {
    if (!isAdmin) return; // Only admins fetch admin data
    let cancelled = false;

    async function fetchJobs() {
      setLoading(true);
      setError("");
      try {
        // Expected API shape:
        // GET /admin/jobs -> { items: [...], stats: { total, running, queued, done, failed } }
        const res = await apiJson("/admin/jobs");
        if (cancelled) return;

        const items = Array.isArray(res.items) ? res.items : [];

        const withNorm = items.map(j => ({
          ...j,
          stateNorm: normalizeState(j.state),
        }));

        setJobs(withNorm);
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    // initial load
    fetchJobs();

    const id = setInterval(() => {
      fetchJobs();
    }, 15000); // auto-refresh every 15s

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isAdmin, refreshTick]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;

    async function fetchSystemDetails() {
      setSystemLoading(true);
      setSystemError("");
      try {
        const res = await apiJson("/admin/system");
        if (!cancelled) setSystemDetails(res);
      } catch (e) {
        if (!cancelled) setSystemError(e?.message || String(e));
      } finally {
        if (!cancelled) setSystemLoading(false);
      }
    }

    fetchSystemDetails();
    const id = setInterval(fetchSystemDetails, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isAdmin, refreshTick]);

  // ---------------------------
  // Stats derived from the live jobs list (never drifts out of
  // sync with the table, unlike a separately-fetched stats object)
  // ---------------------------
  const stats = useMemo(() => {
    const s = {
      total: jobs.length,
      running: 0,
      queued: 0,
      done: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const j of jobs) {
      if (s[j.stateNorm] !== undefined) s[j.stateNorm] += 1;
    }
    return s;
  }, [jobs]);

  // ---------------------------
  // Filtered jobs
  // ---------------------------
  const filteredJobs = useMemo(() => {
    let out = jobs;
    if (statusFilter !== "all") {
      out = out.filter(j => j.stateNorm === statusFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter(j => {
        return (
          (j.job_id || "").toLowerCase().includes(q) ||
          (j.sample || "").toLowerCase().includes(q) ||
          (j.user_id || "").toLowerCase().includes(q) ||
          (j.user_email || "").toLowerCase().includes(q)
        );
      });
    }
    return out;
  }, [jobs, statusFilter, search]);

  // ---------------------------
  // Load job details on select
  // ---------------------------
  async function handleSelectJob(job, initialTab = "overview") {
    setSelectedJob(job);
    setSelectedDetails(null);
    setSelectedLog("");
    setLogError("");
    setDetailsTab(initialTab);
    setLoadingDetails(true);
    setLoadingLog(true);
    try {
      const [detailsResult, logResult] = await Promise.allSettled([
        apiJson(`/admin/jobs/${job.job_id}`),
        apiText(`/admin/jobs/${job.job_id}/log`),
      ]);

      if (detailsResult.status === "fulfilled") {
        setSelectedDetails(detailsResult.value);
      } else {
        setSelectedDetails({
          error: detailsResult.reason?.message || String(detailsResult.reason),
        });
      }

      if (logResult.status === "fulfilled") {
        setSelectedLog(logResult.value);
      } else {
        setLogError(logResult.reason?.message || String(logResult.reason));
      }
    } finally {
      setLoadingDetails(false);
      setLoadingLog(false);
    }
  }

  async function refreshSelectedLog() {
    if (!selectedJob?.job_id) return;
    setLoadingLog(true);
    setLogError("");
    try {
      setSelectedLog(await apiText(`/admin/jobs/${selectedJob.job_id}/log`));
    } catch (e) {
      setLogError(e?.message || String(e));
    } finally {
      setLoadingLog(false);
    }
  }

  async function copySelectedLog() {
    if (!selectedLog) return;
    try {
      await navigator.clipboard.writeText(selectedLog);
      setToast({ type: "success", text: "Log copied to clipboard." });
    } catch {
      setToast({ type: "error", text: "Could not copy the log." });
    }
  }

  function downloadSelectedLog() {
    if (!selectedJob?.job_id || !selectedLog) return;
    const url = URL.createObjectURL(new Blob([selectedLog], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedJob.job_id}-snakemake.log`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function copyViewerLink(url = viewerLinkDialog?.url) {
    const copied = await copyTextToClipboard(url);
    setToast(
      copied
        ? { type: "success", text: "Viewer link copied." }
        : { type: "error", text: "Could not copy the viewer link." }
    );
  }

  async function handleGenerateViewerLink(job) {
    if (!job?.job_id) return;
    setViewerLinkBusyId(job.job_id);
    try {
      const result = await apiJson(
        `/admin/jobs/${encodeURIComponent(job.job_id)}/viewer-link`,
        { method: "POST" }
      );
      const privatePath = String(result?.private_path || "");
      if (!privatePath.startsWith("/run?") || !privatePath.includes("#access=")) {
        throw new Error("The server returned an invalid viewer link.");
      }
      const url = new URL(privatePath, window.location.origin).toString();
      setViewerLinkDialog({
        jobId: job.job_id,
        sample: job.sample || "",
        url,
        expiresAt: result.expires_at || "",
      });
      const copied = await copyTextToClipboard(url);
      setToast({
        type: "success",
        text: copied ? "Viewer link generated and copied." : "Viewer link generated.",
      });
    } catch (e) {
      const message = e?.message || String(e);
      setToast({ type: "error", text: `Could not generate viewer link. ${message}` });
    } finally {
      setViewerLinkBusyId(null);
    }
  }

  // ---------------------------
  // Cancel job
  // ---------------------------
  async function handleCancel(job) {
    if (!job?.job_id) return;
    if (
      !window.confirm(
        `Cancel job ${job.job_id}? This cannot be undone.`
      )
    ) {
      return;
    }
    setCancelBusyId(job.job_id);
    setError("");
    try {
      await apiJson(`/admin/jobs/${job.job_id}/cancel`, {
        method: "POST",
      });

      // Reflect the cancellation immediately instead of waiting up to 15s
      // for the next /admin/jobs poll — this is what actually drives the
      // status badge and the Cancel button's disabled state.
      setJobs(prev =>
        prev.map(j =>
          j.job_id === job.job_id
            ? { ...j, stateNorm: "cancelled", state: "cancelled" }
            : j
        )
      );
      setSelectedJob(prev =>
        prev?.job_id === job.job_id
          ? { ...prev, stateNorm: "cancelled", state: "cancelled" }
          : prev
      );
      setSelectedDetails(prev =>
        prev
          ? {
              ...prev,
              status: {
                ...(prev.status || {}),
                message: "Cancellation requested by admin.",
              },
              job: {
                ...(prev.job || {}),
                state: "cancelled",
                message: "Cancellation requested by admin.",
              },
            }
          : prev
      );
      setToast({ type: "success", text: `Job ${job.job_id} cancelled.` });
    } catch (e) {
      setError(e?.message || String(e));
      setToast({ type: "error", text: `Failed to cancel ${job.job_id}.` });
    } finally {
      setCancelBusyId(null);
    }
  }

  function openRetryDialog(job) {
    if (!job?.job_id || job.stateNorm !== "failed") return;
    setRetryReason("");
    setRetryDialogJob(job);
  }

  function closeRetryDialog() {
    if (retryBusyId) return;
    setRetryDialogJob(null);
    setRetryReason("");
  }

  async function handleRetry() {
    const job = retryDialogJob;
    if (!job?.job_id) return;

    setRetryBusyId(job.job_id);
    setError("");
    try {
      const result = await apiJson(`/admin/jobs/${job.job_id}/retry`, {
        method: "POST",
        body: JSON.stringify({ reason: retryReason.trim() || null }),
      });

      setJobs(prev =>
        prev.map(item =>
          item.job_id === job.job_id
            ? {
                ...item,
                last_retry_job_id: result.job_id,
                last_retry_state: "queued",
              }
            : item
        )
      );
      setSelectedJob(prev =>
        prev?.job_id === job.job_id
          ? {
              ...prev,
              last_retry_job_id: result.job_id,
              last_retry_state: "queued",
            }
          : prev
      );
      setSelectedDetails(prev =>
        prev?.job?.job_id === job.job_id
          ? {
              ...prev,
              job: {
                ...prev.job,
                last_retry_job_id: result.job_id,
              },
            }
          : prev
      );
      setRetryDialogJob(null);
      setRetryReason("");
      setToast({
        type: "success",
        text: `Retry queued as ${result.job_id} for ${job.user_email || job.user_id || "the original user"}.`,
      });
      setRefreshTick(tick => tick + 1);
    } catch (e) {
      const message = e?.message || String(e);
      setError(message);
      setToast({ type: "error", text: `Could not retry ${job.job_id}. ${message}` });
    } finally {
      setRetryBusyId(null);
    }
  }

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  // ---------------------------
  // Guards
  // ---------------------------
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-700">
        <div className="text-sm">Checking permissions…</div>
      </div>
    );
  }

  if (!user || !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-800">
        <div className="max-w-md text-center space-y-3">
          <h1 className="genocular-page-title">Not authorized</h1>
          <p className="text-sm text-slate-600">
            This area is restricted to GENOCULAR administrators. If you believe
            this is a mistake, please contact the system administrator.
          </p>
        </div>
      </div>
    );
  }

  // ---------------------------
  // Main UI
  // ---------------------------
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="w-full px-4 sm:px-8 lg:px-14 xl:px-20 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="genocular-page-title">
              GENOCULAR Admin Console
            </h1>
            <p className="genocular-page-subtitle">
              Monitor and manage all pipeline jobs across users in real time.
            </p>
          </div>
          <div className="text-xs text-right text-slate-500">
            <div>Signed in as</div>
            <div className="font-medium text-slate-800">
              {user?.email || user?.uid || "unknown"}
            </div>
            <div className="uppercase tracking-wide text-[10px] mt-1 inline-flex px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              ADMIN{role ? ` (${role})` : ""}
            </div>
          </div>
        </div>

        {/* Stats cards */}
        <Motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
        >
          <StatCard
            label="Total jobs"
            value={stats.total}
            badge="All time"
            gradient="from-slate-600 to-slate-400"
          />
          <StatCard
            label="Running"
            value={stats.running}
            badge="Active"
            gradient="from-sky-500 to-cyan-500"
          />
          <StatCard
            label="Queued"
            value={stats.queued}
            badge="Waiting"
            gradient="from-amber-500 to-orange-500"
          />
          <StatCard
            label="Failed"
            value={stats.failed}
            badge="Attention"
            gradient="from-rose-500 to-fuchsia-600"
          />
          <StatCard
            label="Cancelled"
            value={stats.cancelled}
            badge="Stopped by admin"
            gradient="from-slate-500 to-slate-400"
          />
        </Motion.div>

        {/* Server storage and details */}
        <Motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-3xl border border-slate-200 bg-white/90 shadow-[0_18px_50px_-30px_rgba(15,23,42,0.18)] backdrop-blur p-4 space-y-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Server capacity
              </h2>
              <p className="text-xs text-slate-500">
                Storage, memory and runtime details from the server.
              </p>
            </div>
            <div className="text-[11px] text-slate-500">
              {systemLoading
                ? "Refreshing…"
                : systemDetails?.generated_at
                ? `Updated ${fmtTime(systemDetails.generated_at)}`
                : "Not loaded"}
            </div>
          </div>

          {systemError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">
              {systemError}
            </div>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {(systemDetails?.storage || []).map(item => (
                  <StorageCard key={`${item.label}:${item.path}`} item={item} />
                ))}
                {!systemDetails?.storage?.length && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-500">
                    Storage details are loading.
                  </div>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <SystemMetric
                  label="Host"
                  value={systemDetails?.host?.hostname || "—"}
                  subvalue={systemDetails?.host?.platform || "—"}
                />
                <SystemMetric
                  label="CPU cores"
                  value={systemDetails?.host?.cpu_count ?? "—"}
                  subvalue={
                    systemDetails?.host?.load_average
                      ? `Load ${systemDetails.host.load_average
                          .map(n => Number(n).toFixed(2))
                          .join(" / ")}`
                      : "Load —"
                  }
                />
                <SystemMetric
                  label="Memory"
                  value={fmtBytes(systemDetails?.memory?.available_bytes)}
                  subvalue={`${fmtPercent(
                    systemDetails?.memory?.used_percent
                  )} RAM used of ${fmtBytes(systemDetails?.memory?.total_bytes)}`}
                />
                <SystemMetric
                  label="Uptime"
                  value={fmtUptime(systemDetails?.host?.uptime_seconds)}
                  subvalue={`Queue ${systemDetails?.services?.queue || "—"}`}
                />
              </div>
            </>
          )}
        </Motion.div>

        {toast && (
          <div
            className={`rounded-2xl border px-4 py-2.5 text-xs font-medium ${
              toast.type === "success"
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-rose-50 text-rose-700 border-rose-200"
            }`}
          >
            {toast.text}
          </div>
        )}

        {/* Controls + layout */}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,2.1fr)_minmax(0,1.4fr)] items-start">
          {/* Jobs table */}
          <Motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-3xl border border-slate-200 bg-white/90 shadow-[0_18px_50px_-30px_rgba(15,23,42,0.18)] backdrop-blur"
          >
            {/* Filters */}
            <div className="p-4 border-b border-slate-200 flex flex-wrap gap-3 items-center justify-between">
              <div className="flex flex-wrap gap-2 items-center">
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                  className="text-xs rounded-full border border-slate-300 px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="all">All statuses</option>
                  <option value="running">Running</option>
                  <option value="queued">Queued</option>
                  <option value="done">Done</option>
                  <option value="failed">Failed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
                <button
                  onClick={() => setRefreshTick(t => t + 1)}
                  className="text-xs px-3 py-1.5 rounded-full border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 flex items-center gap-2"
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.45)]" />
                  Refresh
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search by job id, sample, user…"
                  className="text-xs rounded-full border border-slate-300 px-3 py-1.5 bg-slate-50 text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 min-w-[200px]"
                />
              </div>
            </div>

            {/* Table */}
            <div className="overflow-auto max-h-[520px]">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                  <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2 text-left">Job</th>
                    <th className="px-3 py-2 text-left">Sample</th>
                    <th className="px-3 py-2 text-left">User</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Created</th>
                    <th className="px-3 py-2 text-left">Runtime</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && jobs.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-6 text-center text-slate-400"
                      >
                        Loading jobs…
                      </td>
                    </tr>
                  ) : filteredJobs.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-6 text-center text-slate-400"
                      >
                        No jobs match the current filter.
                      </td>
                    </tr>
                  ) : (
                    filteredJobs.map(job => {
                      const stateNorm = job.stateNorm;
                      const lastRetryState = normalizeState(job.last_retry_state);
                      const retryBlocked = ["queued", "running", "done"].includes(lastRetryState);
                      const rowCls =
                        STATUS_COLORS[stateNorm] || STATUS_COLORS.unknown;
                      return (
                        <tr
                          key={job.job_id}
                          className={`border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors ${
                            selectedJob?.job_id === job.job_id
                              ? "bg-sky-50/60 ring-1 ring-sky-200/60"
                              : ""
                          }`}
                          onClick={() => handleSelectJob(job)}
                        >
                          <td className="px-3 py-2 max-w-[130px]">
                            <div className="truncate font-mono text-[11px] text-slate-800">{job.job_id}</div>
                            {job.retry_of && (
                              <div className="mt-0.5 truncate text-[9px] text-cyan-700">
                                Retry {job.retry_attempt ? `#${job.retry_attempt}` : ""} of {job.retry_of}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-slate-800 max-w-[120px] truncate">
                            {job.sample || "—"}
                          </td>
                          <td className="px-3 py-2 text-slate-500 max-w-[120px] truncate">
                            {job.user_email || job.user_id || "—"}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] ${
                                rowCls || ""
                              }`}
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
                              <span className="capitalize">
                                {stateNorm || "unknown"}
                              </span>
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-500">
                            {fmtTime(job.created_at)}
                          </td>
                          <td className="px-3 py-2 text-slate-500">
                            {fmtDuration(job.started_at, job.finished_at)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="inline-flex gap-1">
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  handleGenerateViewerLink(job);
                                }}
                                disabled={viewerLinkBusyId === job.job_id}
                                className="px-2 py-1 rounded-full border border-sky-200 bg-sky-50 text-[11px] text-sky-800 hover:bg-sky-100 disabled:cursor-wait disabled:opacity-60"
                                title="Generate a read-only viewer link"
                              >
                                {viewerLinkBusyId === job.job_id ? "Generating&" : "Viewer link"}
                              </button>
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  handleSelectJob(job, "logs");
                                }}
                                className="px-2 py-1 rounded-full border border-slate-200 text-[11px] text-slate-700 hover:bg-slate-50"
                              >
                                Log
                              </button>
                              {stateNorm === "failed" && (
                                <button
                                  onClick={e => {
                                    e.stopPropagation();
                                    openRetryDialog(job);
                                  }}
                                  disabled={retryBusyId === job.job_id || retryBlocked}
                                  className="px-2 py-1 rounded-full border border-cyan-200 bg-cyan-50 text-[11px] text-cyan-800 hover:bg-cyan-100 disabled:opacity-60 disabled:cursor-not-allowed"
                                  title={retryBlocked && job.last_retry_job_id ? `Latest retry: ${job.last_retry_job_id}` : undefined}
                                >
                                  {retryBusyId === job.job_id
                                    ? "Queuing…"
                                    : lastRetryState === "done"
                                    ? "Retried"
                                    : retryBlocked
                                    ? "Retry queued"
                                    : "Retry"}
                                </button>
                              )}
                              {["running", "queued"].includes(stateNorm) && (
                                <button
                                  onClick={e => {
                                    e.stopPropagation();
                                    handleCancel(job);
                                  }}
                                  disabled={cancelBusyId === job.job_id}
                                  className="px-2 py-1 rounded-full border border-rose-200 text-[11px] text-rose-700 hover:bg-rose-50 disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                  {cancelBusyId === job.job_id ? "Cancelling…" : "Cancel"}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {error && (
              <div className="px-4 py-3 border-t border-rose-200 bg-rose-50 text-[11px] text-rose-700">
                {error}
              </div>
            )}
          </Motion.div>

          {/* Details pane */}
          <Motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-3xl border border-slate-200 bg-white/90 shadow-[0_18px_50px_-30px_rgba(15,23,42,0.18)] backdrop-blur overflow-hidden"
          >
            <div className="p-4 flex items-center justify-between gap-2 border-b border-slate-200">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Job details
                </h2>
                <p className="text-xs text-slate-500">
                  Admin-only metadata, inputs, steps and execution logs.
                </p>
              </div>
              {selectedJob && (
                <span
                  className={`inline-flex items-center px-2 py-1 rounded-full text-[11px] ${
                    STATUS_BADGE[selectedJob.stateNorm] ||
                    STATUS_BADGE.unknown
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70 mr-1" />
                  {selectedJob.stateNorm || "unknown"}
                </span>
              )}
            </div>

            {!selectedJob ? (
              <div className="p-6 text-xs text-slate-500">
                Select a job from the left panel to inspect its details.
              </div>
            ) : (
              <>
                <div className="px-4 pt-3 flex gap-1 overflow-x-auto">
                  {["overview", "inputs", "steps", "logs"].map(tab => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setDetailsTab(tab)}
                      className={`px-3 py-1.5 rounded-full text-[11px] font-medium capitalize transition-colors ${
                        detailsTab === tab
                          ? "bg-slate-900 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                <div className="p-4 min-h-[390px] max-h-[620px] overflow-auto">
                  {loadingDetails && !selectedDetails ? (
                    <div className="text-xs text-slate-500">Loading complete job record…</div>
                  ) : selectedDetails?.error ? (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 break-words">
                      {selectedDetails.error}
                    </div>
                  ) : detailsTab === "overview" ? (
                    <div className="space-y-3 text-xs">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
                        <div className="text-[10px] uppercase tracking-wide text-slate-500">Job ID</div>
                        <div className="mt-1 font-mono text-[11px] text-slate-900 break-all">
                          {selectedDetails?.job?.job_id || selectedJob.job_id}
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-3">
                          <DetailField label="Sample" value={selectedDetails?.job?.sample || "—"} />
                          <DetailField label="Profile" value={selectedDetails?.job?.profile || "—"} />
                          <DetailField label="User email" value={selectedDetails?.job?.user_email || "—"} />
                          <DetailField label="User UID" value={selectedDetails?.job?.user_id || "—"} />
                          <DetailField label="Tenant" value={selectedDetails?.job?.tenant_id || "—"} />
                          <DetailField label="Database state" value={selectedDetails?.job?.db_state || "—"} />
                          <DetailField label="Created" value={fmtTime(selectedDetails?.job?.created_at)} />
                          <DetailField label="Started" value={fmtTime(selectedDetails?.job?.started_at)} />
                          <DetailField label="Finished" value={fmtTime(selectedDetails?.job?.finished_at)} />
                          <DetailField
                            label="Runtime"
                            value={fmtDuration(selectedDetails?.job?.started_at, selectedDetails?.job?.finished_at)}
                          />
                          <DetailField label="RQ job ID" value={selectedDetails?.job?.rq_job_id || "—"} />
                          <DetailField label="RQ state" value={selectedDetails?.job?.rq_state || "—"} />
                          {selectedDetails?.job?.retry?.source_job_id && (
                            <DetailField label="Retry of" value={selectedDetails.job.retry.source_job_id} />
                          )}
                          {selectedDetails?.job?.retry?.attempt && (
                            <DetailField label="Retry attempt" value={`#${selectedDetails.job.retry.attempt}`} />
                          )}
                          {selectedDetails?.job?.last_retry_job_id && (
                            <DetailField label="Latest retry" value={selectedDetails.job.last_retry_job_id} />
                          )}
                          <DetailField
                            label="Queue position"
                            value={selectedDetails?.queue?.queue_position ?? "—"}
                          />
                          <DetailField
                            label="Queued ahead"
                            value={selectedDetails?.queue?.queued_ahead ?? "—"}
                          />
                        </div>
                      </div>

                      {(selectedDetails?.job?.message || selectedDetails?.job?.error_text) && (
                        <div className="space-y-2">
                          {selectedDetails?.job?.message && (
                            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-700 break-words">
                              <span className="font-semibold text-slate-900">Message: </span>
                              {selectedDetails.job.message}
                            </div>
                          )}
                          {selectedDetails?.job?.error_text && (
                            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 font-mono text-[10px] text-rose-700 whitespace-pre-wrap break-words">
                              {selectedDetails.job.error_text}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="rounded-2xl border border-slate-200 overflow-hidden">
                        <div className="px-3 py-2 bg-slate-50 text-[11px] font-semibold text-slate-800">Storage</div>
                        {Object.entries(selectedDetails?.storage || {}).map(([name, item]) => (
                          <div key={name} className="px-3 py-2 border-t border-slate-100">
                            <div className="flex items-center justify-between gap-3">
                              <span className="capitalize font-medium text-slate-800">{name}</span>
                              <span className="text-[10px] text-slate-500">
                                {item?.object_count ?? "—"}{item?.inventory_truncated ? "+" : ""} objects · {fmtBytes(item?.total_bytes)}
                              </span>
                            </div>
                            <div className="mt-1 font-mono text-[10px] text-slate-500 break-all">
                              {item?.bucket}/{item?.prefix}
                            </div>
                            {item?.error && <div className="mt-1 text-[10px] text-rose-600">{item.error}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : detailsTab === "inputs" ? (
                    <div className="space-y-3">
                      <div>
                        <div className="text-xs font-semibold text-slate-900">Uploaded inputs</div>
                        <div className="mt-2 space-y-2">
                          {selectedDetails?.job?.input_files?.length ? (
                            selectedDetails.job.input_files.map((file, index) => (
                              <div key={`${file.key}:${index}`} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="text-[11px] font-medium text-slate-900 break-all">{file.name}</div>
                                    <div className="mt-1 font-mono text-[10px] text-slate-500 break-all">{file.key}</div>
                                  </div>
                                  <span className="shrink-0 rounded-full bg-white border border-slate-200 px-2 py-0.5 text-[10px] text-slate-600">
                                    {file.role || file.type || "input"}
                                  </span>
                                </div>
                                <div className="mt-2 text-[10px] text-slate-500">
                                  {fmtBytes(file.size)}{file.reused ? " · reused input" : ""}
                                  {file.source_job_id ? ` · source ${file.source_job_id}` : ""}
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="text-[11px] text-slate-500">No normalized input file records.</div>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-slate-900">Full input manifest</div>
                        <pre className="mt-2 max-h-72 overflow-auto rounded-xl bg-slate-950 p-3 font-mono text-[10px] leading-relaxed text-slate-200 whitespace-pre-wrap break-words">
                          {JSON.stringify(selectedDetails?.job?.input_manifest || {}, null, 2)}
                        </pre>
                      </div>
                    </div>
                  ) : detailsTab === "steps" ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>{selectedDetails?.steps?.completed ?? 0} of {selectedDetails?.steps?.total ?? 0} complete</span>
                        <span className="capitalize">{selectedDetails?.steps?.state || "unknown"}</span>
                      </div>
                      {selectedDetails?.steps?.steps?.length ? (
                        selectedDetails.steps.steps.map((step, index) => (
                          <div key={step.key || index} className="rounded-xl border border-slate-200 bg-white p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-[11px] font-medium text-slate-900">
                                  {index + 1}. {step.name || step.key || "Pipeline step"}
                                </div>
                                {(step.summary || step.message) && (
                                  <div className="mt-1 text-[10px] text-slate-500 break-words">
                                    {step.summary || step.message}
                                  </div>
                                )}
                              </div>
                              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] capitalize ${
                                STATUS_COLORS[normalizeState(step.status)] || STATUS_COLORS.unknown
                              }`}>
                                {step.status || "queued"}
                              </span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-[11px] text-slate-500">No step details available yet.</div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold text-slate-900">Snakemake execution log</div>
                          <div className="text-[10px] text-slate-500">Authenticated admin access; never exposed as a public URL.</div>
                        </div>
                        <div className="flex gap-1">
                          <button type="button" onClick={refreshSelectedLog} disabled={loadingLog} className="px-2.5 py-1 rounded-full border border-slate-200 text-[10px] text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                            {loadingLog ? "Refreshing…" : "Refresh"}
                          </button>
                          <button type="button" onClick={copySelectedLog} disabled={!selectedLog} className="px-2.5 py-1 rounded-full border border-slate-200 text-[10px] text-slate-700 hover:bg-slate-50 disabled:opacity-50">Copy</button>
                          <button type="button" onClick={downloadSelectedLog} disabled={!selectedLog} className="px-2.5 py-1 rounded-full border border-slate-200 text-[10px] text-slate-700 hover:bg-slate-50 disabled:opacity-50">Download</button>
                        </div>
                      </div>
                      {logError && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] text-amber-700 break-words">{logError}</div>
                      )}
                      <pre className="h-96 overflow-auto rounded-xl bg-slate-950 p-3 font-mono text-[10px] leading-relaxed text-emerald-100 whitespace-pre-wrap break-words">
                        {selectedLog || (loadingLog ? "Loading log…" : "No Snakemake log is available yet.")}
                      </pre>
                      {!!selectedDetails?.storage?.logs?.objects?.length && (
                        <div className="rounded-xl border border-slate-200 overflow-hidden">
                          <div className="bg-slate-50 px-3 py-2 text-[10px] font-semibold text-slate-700">Stored log objects</div>
                          {selectedDetails.storage.logs.objects.map(file => (
                            <div key={file.key} className="flex items-center justify-between gap-3 border-t border-slate-100 px-3 py-2 text-[10px]">
                              <span className="font-mono text-slate-600 break-all">{file.key}</span>
                              <span className="shrink-0 text-slate-400">{fmtBytes(file.size)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="border-t border-slate-200 bg-slate-50/70 px-4 py-3 flex justify-between items-center text-xs">
                  <span className="text-[10px] text-slate-500">
                    {loadingDetails ? "Refreshing details…" : "Admin access only"}
                  </span>
                  {selectedJob.stateNorm === "failed" ? (
                    <button
                      onClick={() => openRetryDialog(selectedJob)}
                      disabled={
                        retryBusyId === selectedJob.job_id ||
                        ["queued", "running", "done"].includes(
                          normalizeState(selectedJob.last_retry_state)
                        )
                      }
                      className="px-3 py-1.5 rounded-full border border-cyan-200 bg-cyan-50 text-cyan-800 hover:bg-cyan-100 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {retryBusyId === selectedJob.job_id
                        ? "Queuing retry…"
                        : ["queued", "running"].includes(normalizeState(selectedJob.last_retry_state))
                        ? "Retry already queued"
                        : normalizeState(selectedJob.last_retry_state) === "done"
                        ? "Retry completed"
                        : "Retry for user"}
                    </button>
                  ) : ["running", "queued"].includes(selectedJob.stateNorm) ? (
                    <button
                      onClick={() => handleCancel(selectedJob)}
                      disabled={cancelBusyId === selectedJob.job_id}
                      className="px-3 py-1.5 rounded-full border border-rose-200 text-rose-700 bg-rose-50 hover:bg-rose-100 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {cancelBusyId === selectedJob.job_id ? "Cancelling…" : "Cancel job"}
                    </button>
                  ) : (
                    <span className="text-[10px] text-slate-400">No actions available</span>
                  )}
                </div>
              </>
            )}
          </Motion.div>
        </div>
      </div>

      {viewerLinkDialog && (
        <div
          className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/55 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-viewer-link-title"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setViewerLinkDialog(null);
          }}
        >
          <div className="w-full max-w-xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Read-only access
                </div>
                <h2 id="admin-viewer-link-title" className="mt-1 text-lg font-semibold text-slate-950">
                  Viewer link
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setViewerLinkDialog(null)}
                className="grid h-8 w-8 place-items-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50"
                aria-label="Close viewer link dialog"
              >
                �
              </button>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
                <DetailField label="Job ID" value={viewerLinkDialog.jobId} />
                <DetailField label="Sample" value={viewerLinkDialog.sample || ""} />
              </div>
              <input
                type="text"
                readOnly
                value={viewerLinkDialog.url}
                onFocus={event => event.currentTarget.select()}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-mono text-[11px] text-slate-800 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                aria-label="Generated viewer link"
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
                <span>Anyone with this link can view the job.</span>
                {viewerLinkDialog.expiresAt && (
                  <span>Expires {new Date(viewerLinkDialog.expiresAt).toLocaleString()}</span>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
              <button
                type="button"
                onClick={() => setViewerLinkDialog(null)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => copyViewerLink()}
                className="rounded-xl bg-sky-700 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-sky-800"
              >
                Copy link
              </button>
            </div>
          </div>
        </div>
      )}

      {retryDialogJob && (
        <div
          className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/55 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-retry-title"
          onMouseDown={event => {
            if (event.target === event.currentTarget) closeRetryDialog();
          }}
        >
          <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-700">
                    Admin action
                  </div>
                  <h2 id="admin-retry-title" className="mt-1 text-lg font-semibold text-slate-950">
                    Retry failed job for its owner
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={closeRetryDialog}
                  disabled={Boolean(retryBusyId)}
                  className="grid h-8 w-8 place-items-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                  aria-label="Close retry dialog"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
                <DetailField label="Failed job" value={retryDialogJob.job_id} />
                <DetailField label="Sample" value={retryDialogJob.sample || "—"} />
                <DetailField label="Owner" value={retryDialogJob.user_email || retryDialogJob.user_id || "—"} />
                <DetailField label="Pipeline" value={retryDialogJob.profile || "—"} />
              </div>

              <div className="rounded-2xl border border-cyan-200 bg-cyan-50/70 px-4 py-3 text-xs leading-5 text-cyan-950">
                A new job ID will be created. The failed job and its logs remain unchanged, retained FASTQ files are reused, and the new run stays owned by the original user.
              </div>

              <label className="block">
                <span className="text-xs font-medium text-slate-800">Administrative note <span className="font-normal text-slate-400">(optional)</span></span>
                <textarea
                  value={retryReason}
                  onChange={event => setRetryReason(event.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="For example: workflow issue corrected; retry approved."
                  className="mt-2 w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs text-slate-800 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                />
                <span className="mt-1 block text-right text-[10px] text-slate-400">{retryReason.length}/500</span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
              <button
                type="button"
                onClick={closeRetryDialog}
                disabled={Boolean(retryBusyId)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Keep failed job
              </button>
              <button
                type="button"
                onClick={handleRetry}
                disabled={Boolean(retryBusyId)}
                className="rounded-xl bg-cyan-700 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-cyan-800 disabled:cursor-wait disabled:opacity-60"
              >
                {retryBusyId ? "Creating retry…" : "Create retry"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, badge, gradient }) {
  return (
    <Motion.div
      whileHover={{ y: -2, scale: 1.01 }}
      className="rounded-3xl border border-slate-200 bg-white/90 overflow-hidden shadow-[0_18px_50px_-30px_rgba(15,23,42,0.18)] backdrop-blur flex"
    >
      <div className="flex-1 p-4">
        <div className="text-[11px] uppercase tracking-wide text-slate-500">
          {label}
        </div>
        <div className="mt-1 text-2xl font-semibold text-slate-900">
          {value}
        </div>
        <div className="mt-2 inline-flex items-center rounded-full bg-slate-50 border border-slate-200 px-2 py-1 text-[11px] text-slate-600">
          {badge}
        </div>
      </div>
      <div
        className={`w-20 md:w-24 bg-gradient-to-b ${gradient} flex items-center justify-center text-white text-xs`}
      >
        <span className="rotate-90 md:rotate-0">GENOCULAR</span>
      </div>
    </Motion.div>
  );
}

function DetailField({ label, value }) {
  return (
    <div>
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="text-[11px] text-slate-800">{value}</div>
    </div>
  );
}

function StorageCard({ item }) {
  const usedPercent = Number.isFinite(item?.used_percent) ? item.used_percent : 0;
  const barClass =
    usedPercent >= 90
      ? "bg-rose-500"
      : usedPercent >= 75
      ? "bg-amber-500"
      : "bg-emerald-500";

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium text-slate-900 capitalize">
            {String(item?.label || "storage").replace(/_/g, " ")}
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-slate-500 break-all">
            {item?.path || "—"}
          </div>
        </div>
        <div className="text-right">
          <div className="font-semibold text-slate-900">
            {item?.error
              ? "—"
              : item?.directory_bytes == null
              ? "Timed out"
              : fmtBytes(item?.directory_bytes)}
          </div>
          <div className="text-[10px] text-slate-500">folder size</div>
        </div>
      </div>

      {item?.error ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          {item.error}
        </div>
      ) : (
        <>
          <div className="mt-3 h-2 rounded-full bg-white border border-slate-200 overflow-hidden">
            <div
              className={`h-full ${barClass}`}
              style={{ width: `${Math.min(Math.max(usedPercent, 0), 100)}%` }}
            />
          </div>
          <div className="mt-1 text-[10px] text-slate-500">
            Filesystem usage: {fmtPercent(item?.used_percent)}
            {item?.device_id ? ` · device ${item.device_id}` : ""}
          </div>
          {item?.directory_note && (
            <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
              {item.directory_note}
            </div>
          )}
          <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
            <DetailField
              label="Folder"
              value={
                item?.directory_bytes == null
                  ? "Timed out"
                  : fmtBytes(item?.directory_bytes)
              }
            />
            <DetailField label="Disk free" value={fmtBytes(item?.available_bytes)} />
            <DetailField label="Disk total" value={fmtBytes(item?.total_bytes)} />
          </div>
        </>
      )}
    </div>
  );
}

function SystemMetric({ label, value, subvalue }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-slate-900 break-words">
        {value}
      </div>
      <div className="mt-1 text-[11px] text-slate-500 break-words">
        {subvalue}
      </div>
    </div>
  );
}
