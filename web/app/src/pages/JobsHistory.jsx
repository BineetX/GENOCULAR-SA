import React, { useEffect, useMemo, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Archive, BarChart3, ChevronRight, Folder, FolderOpen } from "lucide-react";
import { useAuth } from "../auth/AuthProvider.jsx";
import { listJobs } from "../lib/jobStore.js";
import { apiJson } from "../lib/api.js";

const EXPLORER_RENDER_LIMIT = 500;

// Tiny helpers
const fmtTs = (ts) => {
  const numeric = typeof ts === "number" ? ts : Number(ts);
  const value = Number.isFinite(numeric) ? (Math.abs(numeric) < 1_000_000_000_000 ? numeric * 1000 : numeric) : ts;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString();
};
const basename = (p = "") => p.split("/").filter(Boolean).pop() || p;
const dirname = (p = "") => {
  const parts = String(p || "").split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
};
const prettyState = (s) => (s || "").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
const artifactRelativePath = (key = "", jobId = "") => {
  const parts = String(key || "").split("/").filter(Boolean);
  if (jobId && parts[0] === jobId) parts.shift();
  if (parts[0] === "OUTPUT") parts.shift();
  if (parts.length > 2 && !/\.[A-Za-z0-9]{1,8}$/.test(parts[0])) parts.shift();
  return parts.join("/") || String(key || "");
};
const artifactKind = (path = "") => {
  const name = basename(path).toLowerCase();
  if (/\.(html?)$/.test(name)) return "HTML report";
  if (/\.(png|jpe?g|svg|webp|gif)$/.test(name)) return "Image";
  if (/\.(fa|fasta|faa|fna|fastq|fq|gbk|gb|genbank)(\.gz)?$/.test(name)) return "Sequence";
  if (/\.(tsv|csv|txt|json|log|yaml|yml)$/.test(name)) return "Text/table";
  if (/\.(bam|bai|sam|vcf|gff|gff3|bed)$/.test(name)) return "Analysis file";
  return "File";
};
const buildFolderTree = (items = [], jobId = "") => {
  const root = {
    path: "",
    name: "All results",
    depth: 0,
    count: 0,
    children: new Map(),
  };

  items.forEach((item) => {
    const rel = artifactRelativePath(item.key, jobId);
    const parts = rel.split("/").filter(Boolean);
    const folderParts = parts.slice(0, -1);
    root.count += 1;

    let cursor = root;
    folderParts.forEach((name, idx) => {
      const path = folderParts.slice(0, idx + 1).join("/");
      if (!cursor.children.has(name)) {
        cursor.children.set(name, {
          path,
          name,
          depth: idx + 1,
          count: 0,
          children: new Map(),
        });
      }
      cursor = cursor.children.get(name);
      cursor.count += 1;
    });
  });

  const finalize = (node) => ({
    ...node,
    children: Array.from(node.children.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(finalize),
  });

  return finalize(root);
};
const flattenFolderTree = (root, expandedFolders = {}) => {
  if (!root) return [];
  const rows = [root];

  const walk = (nodes = []) => {
    nodes.forEach((node) => {
      rows.push(node);
      if (node.children.length && expandedFolders[node.path]) {
        walk(node.children);
      }
    });
  };

  walk(root.children);
  return rows;
};
const statusLabel = (s = "") => {
  const n = normalizeState(s);
  if (n === "completed") return "Completed with no errors";
  if (n === "failed") return "Failed";
  if (n === "running") return "Running";
  if (n === "queued") return "Queued";
  if (!s) return "Not checked";
  return prettyState(s);
};
const displaySample = (sampleId = "") => {
  const raw = String(sampleId || "").trim();
  if (!raw) return "Untitled submission";
  const n = raw.toLowerCase();
  // Hide generic placeholder names that are not informative in history cards.
  if (["sample", "sample1", "s1", "job1", "job"].includes(n)) return "Untitled submission";
  return raw;
};
const jobProfile = (row = {}) => {
  const stored = String(row.profile || "").trim().toLowerCase();
  if (stored.includes(":")) return stored;
  const analysis = row.analysisType === "metagenomics" ? "metagenomics" : row.analysisType === "wgs" ? "wgs" : "";
  const mode = ["short", "long", "hybrid"].includes(row.readMode) ? row.readMode : "";
  return analysis && mode ? `${analysis}:${mode}` : stored;
};
const profilePresentation = (row = {}) => {
  const [analysis, mode] = jobProfile(row).split(":");
  const isMeta = analysis === "metagenomics";
  const analysisLabel = isMeta ? "Metagenomics" : analysis === "wgs" ? "WGS" : "Workflow";
  const modeLabel = mode === "short" ? "Short reads" : mode === "long" ? "Long reads" : mode === "hybrid" ? "Hybrid reads" : "Profile unavailable";
  return {
    isMeta,
    label: `${analysisLabel} · ${modeLabel}`,
    card: isMeta ? "border-teal-200/90" : "border-sky-200/90",
    accent: isMeta ? "from-teal-500 via-emerald-500 to-cyan-500" : "from-sky-500 via-blue-500 to-indigo-500",
    glow: isMeta ? "bg-teal-100/55" : "bg-sky-100/55",
    badge: isMeta
      ? "border-teal-200 bg-teal-50 text-teal-800"
      : "border-sky-200 bg-sky-50 text-sky-800",
  };
};
const normalizeState = (s = "") => {
  const x = String(s || "").toLowerCase();
  if (!x) return "unknown";
  if (/(fail|error|cancel|abort)/.test(x)) return "failed";
  if (/(queue|queued|pending|wait)/.test(x)) return "queued";
  if (/(run|running|in[_-]?progress|active|start)/.test(x)) return "running";
  if (/(complete|completed|done|success|succeeded|finished|ok)/.test(x)) return "completed";
  return "unknown";
};
const isCompletedState = (s = "") => normalizeState(s) === "completed";
const statusTone = (state = "") => {
  const n = normalizeState(state);
  if (n === "failed") return "bg-rose-50 text-rose-700 ring-rose-200";
  if (n === "running" || n === "queued") return "bg-amber-50 text-amber-800 ring-amber-200";
  if (n === "completed") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  return "bg-slate-50 text-slate-700 ring-slate-200";
};
const statusBar = (state = "") => {
  const n = normalizeState(state);
  if (n === "failed") return "from-rose-400 to-rose-600";
  if (n === "running") return "from-sky-400 to-cyan-600";
  if (n === "queued") return "from-amber-300 to-amber-500";
  if (n === "completed") return "from-emerald-400 to-emerald-600";
  return "from-slate-200 to-slate-300";
};
const progressPercent = (st) => {
  if (!st) return 0;
  const state = normalizeState(st.state);
  const done = Number(st.completed || st.rail?.completed || 0);
  const total = Number(st.total || st.rail?.total || 0);
  if (state === "completed") return 100;
  if (total > 0) {
    const pct = Math.round((done / total) * 100);
    return Math.max(0, Math.min(100, pct));
  }
  if (state === "running") return 15;
  if (state === "queued") return 5;
  if (state === "failed") return 100;
  return 0;
};
const summaryCounts = (rows, statusMap) => {
  const out = { total: rows.length, running: 0, queued: 0, completed: 0, failed: 0, unknown: 0 };
  rows.forEach((r) => {
    const st = statusMap[r.jobId];
    const s = normalizeState(st?.state);
    if (s in out) out[s] += 1;
    else out.unknown += 1;
  });
  return out;
};

export default function JobsHistory() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();

  const [rows, setRows] = useState([]);
  const [statusMap, setStatusMap] = useState({});
  const [artifactsMap, setArtifactsMap] = useState({}); // jobId -> items[]
  const [retentionDays, setRetentionDays] = useState(30);

  // Artifacts panel state
  const [openJobId, setOpenJobId] = useState(null);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [explorerOrganizing, setExplorerOrganizing] = useState(false);
  const [folderTree, setFolderTree] = useState(null);
  const [selectedFolder, setSelectedFolder] = useState("");
  const [expandedFolders, setExpandedFolders] = useState({});
  const [selectedKeys, setSelectedKeys] = useState({}); // key -> true
  const [zipBusy, setZipBusy] = useState(false);
  const [zipProgress, setZipProgress] = useState({ done: 0, total: 0, file: "" });
  const [err, setErr] = useState(null);
  const [artifactQuery, setArtifactQuery] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [autoOpenedJobKey, setAutoOpenedJobKey] = useState("");

  useEffect(() => {
    let cancelled = false;
    let requestInFlight = false;
    const run = async (initial = false) => {
      if (!user?.uid) {
        setRows([]);
        return;
      }
      if (requestInFlight) return;
      requestInFlight = true;
      if (initial) setLoadingHistory(true);
      try {
        const res = await apiJson(`/user-jobs?user_id=${encodeURIComponent(user.uid)}`);
        if (cancelled) return;
        const jobs = Array.isArray(res?.jobs) ? res.jobs : [];
        setRows(jobs);
        setRetentionDays(Number(res?.retention_days || 30));
      } catch {
        if (!cancelled && initial) setRows(listJobs(user?.uid));
      } finally {
        requestInFlight = false;
        if (!cancelled && initial) setLoadingHistory(false);
      }
    };
    run(true);
    const timer = setInterval(() => run(false), 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user]);

  useEffect(() => {
    if (!rows.length) return;
    let active = true;
    const ids = rows.map((r) => r.jobId).filter(Boolean);
    const refresh = async () => {
      await Promise.all(
        ids.map(async (jobId) => {
          try {
            const s = await apiJson(`/jobs/${jobId}/status`);
            if (!active) return;
            setStatusMap((m) => ({ ...m, [jobId]: s }));
          } catch {
            // ignore transient
          }
        })
      );
    };
    refresh();
    const timer = setInterval(refresh, 10_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [rows]);

  async function openArtifactExplorer(jobId) {
    flushSync(() => {
      setOpenJobId(jobId);
      setExplorerOpen(false);
      setExplorerOrganizing(true);
      setFolderTree(null);
      setArtifactQuery("");
      setSelectedFolder("");
      setExpandedFolders({});
      setErr(null);
    });

    await new Promise((resolve) => {
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      } else {
        setTimeout(resolve, 0);
      }
    });

    let items = artifactsMap[jobId];
    if (!items) {
      try {
        const r = await apiJson(`/jobs/${jobId}/results`);
        items = r?.items || [];
        setArtifactsMap((m) => ({ ...m, [jobId]: items }));
      } catch (e) {
        setErr(`Failed to load results: ${e?.message || e}`);
        setExplorerOrganizing(false);
        return;
      }
    }

    const nextFolderTree = buildFolderTree(items, jobId);
    const sel = {};
    items.forEach((it) => (sel[it.key] = selectedKeys[it.key] ?? true));
    setOpenJobId(jobId);
    setFolderTree(nextFolderTree);
    setSelectedKeys(sel);
    setExplorerOpen(true);

    await new Promise((resolve) => {
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(resolve);
      } else {
        setTimeout(resolve, 0);
      }
    });

    setExplorerOrganizing(false);
  }

  useEffect(() => {
    const shouldOpenExplorer =
      location.state?.openArtifactExplorer === true ||
      searchParams.get("view") === "explorer";
    if (!shouldOpenExplorer) return;

    const requestedJobId =
      location.state?.jobId ||
      searchParams.get("job_id") ||
      searchParams.get("open_job") ||
      "";
    if (!requestedJobId || loadingHistory) return;

    const requestKey = `${requestedJobId}:${location.state?.openedAt || ""}:${location.key}`;
    if (autoOpenedJobKey === requestKey || explorerOrganizing) return;

    setAutoOpenedJobKey(requestKey);
    openArtifactExplorer(requestedJobId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    autoOpenedJobKey,
    loadingHistory,
    explorerOrganizing,
    location.key,
    location.search,
    location.state,
  ]);

  const openItems = useMemo(() => artifactsMap[openJobId] || [], [artifactsMap, openJobId]);
  const folderRows = useMemo(
    () => flattenFolderTree(folderTree, expandedFolders),
    [folderTree, expandedFolders]
  );
  const filteredItems = useMemo(() => {
    const q = artifactQuery.trim().toLowerCase();
    if (!q) return openItems;
    return openItems.filter((it) => {
      const rel = artifactRelativePath(it.key, openJobId).toLowerCase();
      const key = String(it.key || "").toLowerCase();
      const name = basename(rel).toLowerCase();
      return key.includes(q) || name.includes(q);
    });
  }, [openItems, openJobId, artifactQuery]);
  const explorerItems = useMemo(() => {
    return filteredItems.filter((it) => {
      if (!selectedFolder) return true;
      const folder = dirname(artifactRelativePath(it.key, openJobId));
      return folder === selectedFolder || folder.startsWith(`${selectedFolder}/`);
    });
  }, [filteredItems, openJobId, selectedFolder]);
  const visibleExplorerItems = useMemo(
    () => explorerItems.slice(0, EXPLORER_RENDER_LIMIT),
    [explorerItems]
  );
  const hiddenExplorerCount = Math.max(0, explorerItems.length - visibleExplorerItems.length);
  const selectedFolderLabel = selectedFolder || "All results";
  const allSelectedCount = useMemo(
    () => filteredItems.filter((it) => selectedKeys[it.key]).length,
    [filteredItems, selectedKeys]
  );
  const explorerSelectedCount = useMemo(
    () => explorerItems.filter((it) => selectedKeys[it.key]).length,
    [explorerItems, selectedKeys]
  );
  const stats = useMemo(() => summaryCounts(rows, statusMap), [rows, statusMap]);

  function toggleSelectAll(items = filteredItems) {
    const selectedCount = items.filter((it) => selectedKeys[it.key]).length;
    const allSelected = items.length > 0 && selectedCount === items.length;
    const next = { ...selectedKeys };
    items.forEach((it) => (next[it.key] = !allSelected));
    setSelectedKeys(next);
  }

  function toggleKey(k) {
    setSelectedKeys((m) => ({ ...m, [k]: !m[k] }));
  }

  function toggleFolder(path) {
    setExpandedFolders((current) => ({
      ...current,
      [path]: !current[path],
    }));
  }

  async function downloadZip(selectedOnly = true) {
    const items = openItems.filter((it) => (selectedOnly ? selectedKeys[it.key] : true));
    if (!items.length) return;
    setZipBusy(true);
    setErr(null);
    setZipProgress({ done: 0, total: items.length, file: "" });

    try {
      const [{ default: JSZip }, { saveAs }] = await Promise.all([
        import("jszip"),
        import("file-saver"),
      ]);
      const zip = new JSZip();

      // Stream each file into zip
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        setZipProgress({ done: i, total: items.length, file: basename(it.key) });

        // Fetch file (supports presigned S3/MinIO or same-origin URLs)
        const resp = await fetch(it.url, { credentials: "include" }).catch((e) => {
          throw new Error(`Fetch failed for ${it.key}: ${e.message || e}`);
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${it.key}`);

        // Use arrayBuffer to avoid memory spikes with very large files
        const ab = await resp.arrayBuffer();
        zip.file(artifactRelativePath(it.key, openJobId) || basename(it.key), ab);
      }

      setZipProgress({ done: items.length, total: items.length, file: "Zipping..." });
      const content = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      const zipName = `GENOCULAR_${openJobId}_${new Date().toISOString().slice(0,10)}.zip`;
      setZipProgress({ done: items.length, total: items.length, file: zipName });
      saveAs(content, zipName);
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setZipBusy(false);
      setZipProgress((p) => ({ ...p, file: "" }));
    }
  }

  return (
    <div className="genocular-jobs min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50">
      <div className="w-full px-4 sm:px-8 lg:px-14 xl:px-20 py-8 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="genocular-page-title">
              Previous Jobs
            </h1>
            <p className="genocular-page-subtitle">
              View run history, progress details, and generated results.
            </p>
          </div>
          <div className="rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs text-slate-600 shadow-sm">
            {rows.length} job{rows.length === 1 ? "" : "s"} retained for {retentionDays} days
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <StatPill label="Total" value={stats.total} tone="slate" />
          <StatPill label="Running" value={stats.running} tone="sky" />
          <StatPill label="Queued" value={stats.queued} tone="amber" />
          <StatPill label="Completed" value={stats.completed} tone="emerald" />
          <StatPill label="Failed" value={stats.failed} tone="rose" />
        </div>

        {loadingHistory && (
          <div className="text-xs text-slate-500">Loading job history from server…</div>
        )}

        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-gradient-to-br from-sky-50 via-white to-emerald-50 p-6">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-xl bg-sky-100 text-sky-600 flex items-center justify-center shadow-sm">
                <svg
                  viewBox="0 0 24 24"
                  className="h-6 w-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path d="M3 6.5h18" />
                  <path d="M7 6.5v11a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-11" />
                  <path d="M9.5 3.5h5a2 2 0 0 1 2 2v1H7.5v-1a2 2 0 0 1 2-2Z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-800">No jobs yet</h3>
                <p className="text-xs text-slate-600">
                  Submit a run from the pipeline page and it will appear here with status and outputs.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            {rows.map((r) => {
              const st = statusMap[r.jobId];
              const state = st?.state || r.state || "unknown";
              const human = statusLabel(state);
              const normalized = normalizeState(state);
              const tone = statusTone(state);
              const bar = statusBar(state);
              const progress = progressPercent(st);
              const canAnalyze = isCompletedState(state);
              const queuePos = Number.isInteger(st?.queue_position) ? st.queue_position : null;
              const queueText =
                queuePos === null || !["queued", "running"].includes(normalized)
                  ? null
                  : queuePos === 0
                    ? "Currently running"
                    : `Queue position: ${queuePos}`;
              const completedSteps = Number(st?.completed ?? st?.rail?.completed ?? 0);
              const totalSteps = Number(st?.total ?? st?.rail?.total ?? 0);
              const activeSteps = Array.isArray(st?.rail?.active)
                ? st.rail.active
                : Array.isArray(st?.rail?.steps)
                  ? st.rail.steps.filter((step) => normalizeState(step?.status) === "running")
                  : [];
              const activeStepNames = Array.from(new Set(activeSteps
                .map((step) => String(step?.name || step?.key || step?.id || "").trim())
                .filter(Boolean)));
              const message = String(st?.message || st?.rail?.message || "").trim();
              const showMessage = message && !(activeStepNames.length && /^running\s*:/i.test(message));
              const profile = profilePresentation(r);
              return (
                <article
                  key={r.jobId}
                  className={`group relative overflow-hidden rounded-3xl border bg-white shadow-[0_12px_35px_-28px_rgba(15,23,42,0.55)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_22px_45px_-28px_rgba(15,23,42,0.45)] ${profile.card}`}
                >
                  <div className={`absolute inset-y-0 left-0 w-1 bg-gradient-to-b ${profile.accent}`} />
                  <div className={`pointer-events-none absolute -right-14 -top-14 h-36 w-36 rounded-full blur-2xl ${profile.glow}`} />
                  <div className="relative p-5 sm:p-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${profile.badge}`}>
                            {profile.label}
                          </span>
                          {r.isDemo && (
                            <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700">
                              Demo
                            </span>
                          )}
                        </div>
                        <h2 className="mt-3 truncate text-xl font-semibold tracking-[-0.025em] text-slate-950">
                          {displaySample(r.sampleId)}
                        </h2>
                        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                          <span>Submitted {fmtTs(r.ts)}</span>
                          <span aria-hidden="true" className="text-slate-300">•</span>
                          <span className="max-w-full truncate font-mono text-[11px]" title={r.jobId}>
                            {r.jobId}
                          </span>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ring-1 ${tone}`}>
                          {human}
                        </span>
                        {queueText && (
                          <span className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ring-1 bg-sky-50 text-sky-700 ring-sky-200">
                            {queueText}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="mt-5 grid gap-5 border-t border-slate-100 pt-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                      <div className="min-w-0 space-y-2.5">
                        <div className="flex items-center justify-between text-[11px] text-slate-600">
                          <span className="font-medium">
                            {totalSteps > 0 ? `Steps ${completedSteps}/${totalSteps}` : "Progress"}
                          </span>
                          <span className="font-semibold text-slate-700">{progress}%</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-2 bg-gradient-to-r ${bar} transition-all duration-500`}
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                          {normalized === "running" && activeStepNames.map((name) => (
                            <span key={name} className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-sky-700">
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" />
                              {name}
                            </span>
                          ))}
                          {typeof st?.queued_ahead === "number" && st.queued_ahead > 0 && (
                            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">
                              Ahead: {st.queued_ahead}
                            </span>
                          )}
                          {normalized === "completed" && (
                            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">
                              Pipeline finished
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                        {canAnalyze && (
                          <button
                            onClick={() => navigate(`/analysis?job_id=${encodeURIComponent(r.jobId)}`)}
                            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_24px_-12px_rgba(5,150,105,0.9)] transition hover:-translate-y-0.5 hover:from-emerald-500 hover:to-teal-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
                            title="Open analysis"
                          >
                            <BarChart3 className="h-4 w-4" />
                            Analyze Results
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={() => navigate(`/run?job_id=${encodeURIComponent(r.jobId)}`)}
                          className="inline-flex min-h-10 items-center rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-800"
                          title="Open the full pipeline progress tree"
                        >
                          Progress Tree
                        </button>
                        <button
                          onClick={() => openArtifactExplorer(r.jobId)}
                          className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
                          title="Explore results folder-wise"
                        >
                          <FolderOpen className="h-4 w-4" />
                          Explore Results
                        </button>
                      </div>
                    </div>
                    {showMessage && (
                      <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        {message}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {typeof document !== "undefined" &&
          createPortal(
            <>
              {explorerOrganizing && (
	                <div className="genocular-artifact-organizing fixed left-0 top-0 z-[70] grid h-[100dvh] w-screen place-items-center overflow-hidden bg-slate-950/55 p-4 backdrop-blur-sm">
	                  <div className="genocular-artifact-organizing-card w-full max-w-md overflow-hidden rounded-3xl border border-white/20 bg-white shadow-2xl">
                    <div className="relative h-2 overflow-hidden bg-slate-100">
                      <div className="absolute inset-y-0 left-0 w-1/2 animate-[artifact-organize_1.2s_ease-in-out_infinite] bg-gradient-to-r from-slate-400 via-slate-500 to-slate-300" />
                    </div>
                    <div className="p-6 text-center">
                      <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-slate-50 text-slate-500 ring-1 ring-slate-200">
                        <Folder className="h-8 w-8 animate-[artifact-folder_1.4s_ease-in-out_infinite]" />
                      </div>
                      <div className="text-base font-semibold text-slate-900">
                        Organizing your results
                      </div>
                      <p className="mt-2 text-sm text-slate-600">
                        Building categories and tool folders for faster browsing.
                      </p>
                      <div className="mt-5 flex justify-center gap-1.5">
                        <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" />
                        <span className="h-2 w-2 animate-bounce rounded-full bg-slate-500 [animation-delay:120ms]" />
                        <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:240ms]" />
                      </div>
                    </div>
                    <style>{`
                      @keyframes artifact-organize {
                        0% { transform: translateX(-110%); }
                        50% { transform: translateX(65%); }
                        100% { transform: translateX(210%); }
                      }
                      @keyframes artifact-folder {
                        0%, 100% { transform: translateY(0); opacity: 0.78; }
                        50% { transform: translateY(-5px); opacity: 1; }
                      }
                    `}</style>
                  </div>
                </div>
              )}

              {openJobId && explorerOpen && !explorerOrganizing && (
	                <div className="genocular-artifact-explorer-overlay fixed left-0 top-0 z-[60] h-[100dvh] w-screen overflow-hidden bg-slate-950/55 p-3 backdrop-blur-sm sm:p-6">
	                  <div className="genocular-artifact-explorer mx-auto flex h-full max-h-full w-full max-w-7xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
	              <div className="genocular-artifact-explorer-header border-b border-slate-200 bg-gradient-to-r from-slate-50 via-white to-slate-50 p-4 sm:p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">Results Explorer</div>
                    <div className="mt-1 font-mono text-xs text-slate-700 break-all">{openJobId}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      Folder-wise view of {openItems.length} result file{openItems.length === 1 ? "" : "s"}.
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={artifactQuery}
                      onChange={(e) => setArtifactQuery(e.target.value)}
                      placeholder="Search file or folder…"
                      className="min-w-[220px] rounded-full border border-slate-200 bg-white px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                    <button
                      onClick={() => toggleSelectAll(explorerItems)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs hover:bg-slate-50"
                    >
                      {explorerSelectedCount === explorerItems.length ? "Unselect visible" : "Select visible"}
                    </button>
                    <button
                      disabled={zipBusy || allSelectedCount === 0}
                      onClick={() => downloadZip(true)}
                      className="rounded-full bg-slate-900 px-3 py-2 text-xs text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      Download selected
                    </button>
                    <button
                      onClick={() => setExplorerOpen(false)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs hover:bg-slate-50"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>

              {zipBusy && (
	                <div className="genocular-artifact-zip border-b border-slate-200 bg-slate-50 px-5 py-3">
                  <div className="mb-2 text-xs text-slate-700">
                    Zipping {zipProgress.done}/{zipProgress.total}
                    {zipProgress.file ? ` — ${zipProgress.file}` : ""}
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-2 bg-gradient-to-r from-sky-500 to-emerald-500"
                      style={{
                        width:
                          zipProgress.total > 0
                            ? `${Math.round((zipProgress.done / zipProgress.total) * 100)}%`
                            : "0%",
                      }}
                    />
                  </div>
                </div>
              )}

              {err && (
                <div className="border-b border-rose-200 bg-rose-50 px-5 py-2 text-xs text-rose-700">
                  {err}
                </div>
              )}

              <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(120px,28dvh)_minmax(0,1fr)] overflow-hidden lg:grid-cols-[320px_minmax(0,1fr)] lg:grid-rows-1">
	                <aside className="genocular-artifact-folders min-h-0 overflow-hidden border-b border-slate-200 bg-slate-50/70 lg:border-b-0 lg:border-r">
	                  <div className="genocular-artifact-folders-title border-b border-slate-200 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Folders
                  </div>
                  <div className="h-[calc(100%-41px)] overflow-auto p-2">
                    {folderRows.map((folder) => {
                      const canExpand = folder.depth > 0 && folder.children.length > 0;
                      const isExpanded = !!expandedFolders[folder.path];
                      const isSelected = selectedFolder === folder.path;
                      const levelLabel =
                        folder.depth === 0
                          ? "All"
                          : folder.depth === 1
                            ? "Category"
                            : folder.depth === 2
                              ? "Tool"
                              : "Folder";
                      const FolderIcon =
                        folder.depth === 0 ? Archive : isExpanded ? FolderOpen : Folder;

                      return (
                        <button
                          type="button"
                          key={folder.path || "__root__"}
                          onClick={() => {
                            setSelectedFolder(folder.path);
                            if (canExpand) toggleFolder(folder.path);
                          }}
	                          className={
	                            "genocular-artifact-folder-row mb-1 grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl px-3 py-2 text-left text-xs transition " +
	                            (isSelected
	                              ? "bg-sky-50 text-sky-800 ring-1 ring-sky-200"
	                              : "text-slate-700 hover:bg-white")
	                          }
	                          data-selected={isSelected ? "true" : "false"}
                          style={{ paddingLeft: `${6 + Math.min(folder.depth, 5) * 14}px` }}
                          title={folder.path || "All results"}
                        >
                          <span className="min-w-0">
                            <span className="flex min-w-0 items-center gap-2">
                              <FolderIcon className="h-4 w-4 shrink-0 text-slate-400" />
                              <span className="block truncate font-semibold">
                                {folder.name}
                              </span>
                            </span>
                            <span className="ml-6 block truncate text-[10px] text-slate-500">
                              {levelLabel}
                            </span>
                          </span>
                          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] text-slate-500 ring-1 ring-slate-200">
                            {folder.count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </aside>

	                <section className="genocular-artifact-files min-h-0 overflow-hidden flex flex-col">
	                  <div className="genocular-artifact-files-header border-b border-slate-200 px-4 py-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{selectedFolderLabel}</div>
                        <div className="text-xs text-slate-500">
                          Showing {explorerItems.length} file{explorerItems.length === 1 ? "" : "s"} · {explorerSelectedCount} selected in this folder/search
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">Open files in a new tab</span>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">Use checkboxes for ZIP export</span>
                      </div>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
                    {explorerItems.length === 0 ? (
                      <div className="p-8 text-sm text-slate-500">No results match this folder/search.</div>
                    ) : (
	                      <div className="genocular-artifact-file-list divide-y divide-slate-100">
                        {hiddenExplorerCount > 0 && (
                          <div className="bg-amber-50 px-4 py-3 text-xs text-amber-800">
                            Showing the first {visibleExplorerItems.length} files to keep the browser responsive.
                            Narrow the folder or search to view the remaining {hiddenExplorerCount}.
                          </div>
                        )}
                        {visibleExplorerItems.map((it) => {
                          const rel = artifactRelativePath(it.key, openJobId);
                          const folder = dirname(rel) || "Root";
                          return (
	                            <div key={it.key} className="genocular-artifact-file-row grid gap-3 p-4 hover:bg-slate-50 lg:grid-cols-[minmax(0,1fr)_130px_90px] lg:items-center">
                              <div className="flex min-w-0 items-start gap-3">
                                <input
                                  type="checkbox"
                                  className="mt-1"
                                  checked={!!selectedKeys[it.key]}
                                  onChange={() => toggleKey(it.key)}
                                />
                                <div className="min-w-0">
                                  <div className="font-mono text-xs font-medium text-slate-900 break-all">
                                    {basename(rel)}
                                  </div>
                                  <div className="mt-1 text-[11px] text-slate-500 break-all">{folder}</div>
                                  <div className="mt-1 text-[10px] text-slate-400 break-all">{it.key}</div>
                                </div>
                              </div>
                              <div className="text-xs text-slate-500">{artifactKind(rel)}</div>
                              <div className="flex gap-2 lg:justify-end">
                                <a
                                  href={it.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs text-sky-700 hover:bg-sky-100"
                                >
                                  Open
                                </a>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </div>
              )}
            </>,
            document.body
          )}
      </div>
    </div>
  );
}

function StatPill({ label, value, tone = "slate" }) {
  const toneMap = {
    slate: "bg-slate-50 border-slate-200 text-slate-700",
    sky: "bg-sky-50 border-sky-200 text-sky-700",
    amber: "bg-amber-50 border-amber-200 text-amber-700",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-700",
    rose: "bg-rose-50 border-rose-200 text-rose-700",
  };
  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneMap[tone] || toneMap.slate}`}>
      <div className="text-[11px] uppercase tracking-wide">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
