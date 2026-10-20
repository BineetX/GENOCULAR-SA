import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * UploadAndRun.jsx
 * - Uses VITE_API_BASE (default '/api')
 * - Multipart upload (50MB chunks, concurrency=4)
 * - Presign via /uploads/multipart/{create,sign,complete}
 * - Submit via /jobs/{jobId}/submit and poll /jobs/{jobId}/status + /jobs/{jobId}/results
 */

const API_BASE = import.meta.env.VITE_API_BASE || "/api";
const CHUNK_SIZE = 50 * 1024 * 1024; // 50 MB
const CONCURRENCY = 4;

function uuid4() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch (_) {}
  // Fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Slice a File into [start, end) chunks with 1-based partNumbers */
function planParts(file, chunkSize = CHUNK_SIZE) {
  const parts = [];
  const total = file.size;
  let offset = 0;
  let partNumber = 1;
  while (offset < total) {
    const end = Math.min(offset + chunkSize, total);
    parts.push({ partNumber, start: offset, end, size: end - offset });
    offset = end;
    partNumber += 1;
  }
  return parts;
}

async function apiJson(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} — ${t}`);
  }
  return res.json();
}

/** Upload one file via MPU (create → sign → PUT parts → complete). Returns { key } */
async function uploadFileMultipart({ file, jobId, onProgress }) {
  const filename = file.name;
  const parts = planParts(file);
  const totalBytes = file.size;
  let uploadedBytes = 0;

  // 1) create
  const created = await apiJson(`/uploads/multipart/create`, {
    method: "POST",
    body: JSON.stringify({ filename, job_id: jobId }),
  });
  const uploadId = created.uploadId;
  const key = created.key;

  // 2) sign (get all part URLs)
  const partNumbers = parts.map((p) => p.partNumber);
  const signed = await apiJson(`/uploads/multipart/sign`, {
    method: "POST",
    body: JSON.stringify({ key, uploadId, parts: partNumbers }),
  });
  const urlMap = signed.urls; // { "1": "https://..." , ... }

  // 3) upload with limited concurrency
  const results = new Array(parts.length);
  let inFlight = 0;
  let cursor = 0;

  const next = async () => {
    if (cursor >= parts.length) return;
    const i = cursor++;
    const { partNumber, start, end } = parts[i];
    const url = urlMap[String(partNumber)];
    const blob = file.slice(start, end);

    inFlight++;
    try {
      const res = await fetch(url, { method: "PUT", body: blob });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Part ${partNumber} PUT failed: ${res.status} ${res.statusText} — ${txt}`);
      }
      const etagHeader = res.headers.get("ETag") || res.headers.get("etag");
      if (!etagHeader) throw new Error(`Part ${partNumber} missing ETag`);

      // MinIO usually returns quotes — keep as-is (S3 v4 accepts quoted ETag for CompleteMultipartUpload)
      const ETag = etagHeader;

      uploadedBytes += blob.size;
      onProgress?.(uploadedBytes, totalBytes);
      results[i] = { ETag, PartNumber: partNumber };
    } finally {
      inFlight--;
      if (cursor < parts.length) {
        await next();
      }
    }
  };

  const starters = [];
  for (let k = 0; k < Math.min(CONCURRENCY, parts.length); k++) starters.push(next());
  await Promise.all(starters);

  // 4) complete
  const completedParts = results
    .slice()
    .filter(Boolean)
    .sort((a, b) => a.PartNumber - b.PartNumber);
  if (completedParts.length !== parts.length) {
    throw new Error("Multipart upload incomplete: some parts failed.");
  }

  await apiJson(`/uploads/multipart/complete`, {
    method: "POST",
    body: JSON.stringify({ key, uploadId, parts: completedParts }),
  });

  return { key };
}

export default function UploadAndRun() {
  const [sampleId, setSampleId] = useState("S1");
  const [fileR1, setFileR1] = useState(null);
  const [fileR2, setFileR2] = useState(null);

  const [status, setStatus] = useState("idle"); // idle | uploading | submitting | polling | done | error
  const [jobId, setJobId] = useState("");
  const [error, setError] = useState("");

  // progress
  const [r1Progress, setR1Progress] = useState({ done: 0, total: 0 });
  const [r2Progress, setR2Progress] = useState({ done: 0, total: 0 });
  const totalBytes = (fileR1?.size || 0) + (fileR2?.size || 0);
  const totalDone = r1Progress.done + r2Progress.done;

  // results + status polling
  const [results, setResults] = useState([]);
  const pollTimer = useRef(null);
  const statusTimer = useRef(null);
  const [jobState, setJobState] = useState("queued");
  const [jobCompleted, setJobCompleted] = useState(0);
  const [jobTotal, setJobTotal] = useState(0);
  const [jobMsg, setJobMsg] = useState("");

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
      if (statusTimer.current) clearInterval(statusTimer.current);
    };
  }, []);

  const canRun = useMemo(
    () => sampleId && fileR1 && fileR2 && status !== "uploading" && status !== "submitting",
    [sampleId, fileR1, fileR2, status]
  );

  const resetAll = () => {
    setSampleId("S1");
    setFileR1(null);
    setFileR2(null);
    setR1Progress({ done: 0, total: 0 });
    setR2Progress({ done: 0, total: 0 });
    setResults([]);
    setError("");
    setStatus("idle");
    setJobId("");
    setJobState("queued");
    setJobCompleted(0);
    setJobTotal(0);
    setJobMsg("");
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    if (statusTimer.current) {
      clearInterval(statusTimer.current);
      statusTimer.current = null;
    }
  };

  const handleRun = async () => {
    if (!fileR1 || !fileR2) return;
    setError("");
    const newJobId = uuid4();
    setJobId(newJobId);
    setStatus("uploading");

    try {
      // R1
      setR1Progress({ done: 0, total: fileR1.size });
      const r1 = await uploadFileMultipart({
        file: fileR1,
        jobId: newJobId,
        onProgress: (done, total) => setR1Progress({ done, total }),
      });

      // R2
      setR2Progress({ done: 0, total: fileR2.size });
      const r2 = await uploadFileMultipart({
        file: fileR2,
        jobId: newJobId,
        onProgress: (done, total) => setR2Progress({ done, total }),
      });

      // Submit
      setStatus("submitting");
      await apiJson(`/jobs/${newJobId}/submit`, {
        method: "POST",
        body: JSON.stringify({
          sample: sampleId,
          r1_key: r1.key,
          r2_key: r2.key,
        }),
      });

      // Start polling
      setStatus("polling");

      const pollResults = async () => {
        try {
          const res = await apiJson(`/jobs/${newJobId}/results`);
          const items = res.items || [];
          setResults(items);
          if (items.length > 0) {
            setStatus("done");
            if (pollTimer.current) {
              clearInterval(pollTimer.current);
              pollTimer.current = null;
            }
            if (statusTimer.current) {
              clearInterval(statusTimer.current);
              statusTimer.current = null;
            }
          }
        } catch (e) {
          console.warn("results poll error:", e);
        }
      };

      const pollStatus = async () => {
        try {
          const s = await apiJson(`/jobs/${newJobId}/status`);
          setJobState(s.state || "unknown");
          setJobCompleted(s.completed ?? 0);
          setJobTotal(s.total ?? 0);
          setJobMsg(s.message || "");
          if (s.state === "done" || s.state === "failed") {
            if (statusTimer.current) {
              clearInterval(statusTimer.current);
              statusTimer.current = null;
            }
            if (s.state === "failed") {
              setStatus("error");
              setError(s.message || "Pipeline failed.");
            }
          }
        } catch (e) {
          console.warn("status poll error:", e);
        }
      };

      await Promise.all([pollResults(), pollStatus()]);
      if (!pollTimer.current) pollTimer.current = setInterval(pollResults, 10000);
      if (!statusTimer.current) statusTimer.current = setInterval(pollStatus, 5000);
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
      setStatus("error");
    }
  };

  const fmtBytes = (n) => {
    if (!n && n !== 0) return "-";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `${v.toFixed(v < 10 && i > 0 ? 2 : 0)} ${units[i]}`;
  };

  const pct = (done, total) => (total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0);

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">GENOCULAR Pipeline</h1>

      <div className="space-y-4 border rounded-xl p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="flex flex-col">
            <span className="text-sm font-medium">Sample ID</span>
            <input
              className="mt-1 rounded border p-2"
              value={sampleId}
              onChange={(e) => setSampleId(e.target.value)}
              placeholder="e.g. S1"
            />
          </label>

          <label className="flex flex-col md:col-span-1">
            <span className="text-sm font-medium">Upload R1 (.fastq/.fq/.gz)</span>
            <input
              className="mt-1"
              type="file"
              accept=".fastq,.fq,.fastq.gz,.fq.gz,.gz"
              onChange={(e) => setFileR1(e.target.files?.[0] || null)}
            />
            {fileR1 && (
              <small className="text-gray-600 mt-1 block">
                {fileR1.name} — {fmtBytes(fileR1.size)}
              </small>
            )}
          </label>

          <label className="flex flex-col md:col-span-1">
            <span className="text-sm font-medium">Upload R2 (.fastq/.fq/.gz)</span>
            <input
              className="mt-1"
              type="file"
              accept=".fastq,.fq,.fastq.gz,.fq.gz,.gz"
              onChange={(e) => setFileR2(e.target.files?.[0] || null)}
            />
            {fileR2 && (
              <small className="text-gray-600 mt-1 block">
                {fileR2.name} — {fmtBytes(fileR2.size)}
              </small>
            )}
          </label>
        </div>

        <div className="flex gap-3">
          <button
            className={`px-4 py-2 rounded text-white ${
              canRun ? "bg-blue-600 hover:bg-blue-700" : "bg-gray-400 cursor-not-allowed"
            }`}
            onClick={handleRun}
            disabled={!canRun}
          >
            Run pipeline
          </button>
          <button
            className="px-4 py-2 rounded border hover:bg-gray-50"
            onClick={resetAll}
            disabled={status === "uploading" || status === "submitting"}
          >
            Reset
          </button>
        </div>

        <div className="text-sm">
          <div>
            <strong>Status:</strong>{" "}
            <span className={status === "error" ? "text-red-600" : ""}>{status}</span>{" "}
            {jobId ? (
              <>
                &nbsp;&nbsp; <strong>Job:</strong> <code>{jobId}</code>
              </>
            ) : null}
          </div>
          {error ? (
            <div className="mt-2 p-2 border border-red-300 rounded text-red-700 bg-red-50 break-words">
              {error}
            </div>
          ) : null}
        </div>

        {/* Progress bars */}
        {fileR1 && (
          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span>R1: {fileR1.name}</span>
              <span>
                {fmtBytes(r1Progress.done)} / {fmtBytes(r1Progress.total)} (
                {pct(r1Progress.done, r1Progress.total)}%)
              </span>
            </div>
            <div className="w-full h-2 bg-gray-200 rounded">
              <div
                className="h-2 bg-blue-600 rounded"
                style={{ width: `${pct(r1Progress.done, r1Progress.total)}%` }}
              />
            </div>
          </div>
        )}

        {fileR2 && (
          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span>R2: {fileR2.name}</span>
              <span>
                {fmtBytes(r2Progress.done)} / {fmtBytes(r2Progress.total)} (
                {pct(r2Progress.done, r2Progress.total)}%)
              </span>
            </div>
            <div className="w-full h-2 bg-gray-200 rounded">
              <div
                className="h-2 bg-green-600 rounded"
                style={{ width: `${pct(r2Progress.done, r2Progress.total)}%` }}
              />
            </div>
          </div>
        )}

        {(fileR1 || fileR2) && (
          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span>Total</span>
              <span>
                {fmtBytes(totalDone)} / {fmtBytes(totalBytes)} ({pct(totalDone, totalBytes)}%)
              </span>
            </div>
            <div className="w-full h-2 bg-gray-200 rounded">
              <div
                className="h-2 bg-purple-600 rounded"
                style={{ width: `${pct(totalDone, totalBytes)}%` }}
              />
            </div>
          </div>
        )}

        {/* Pipeline status (from /jobs/:id/status) */}
        {jobId ? (
          <div className="mt-3 space-y-1 text-sm">
            <div>
              <strong>Pipeline:</strong> {jobState}
              {jobMsg ? (
                <>
                  {" "}
                  — <span className="text-gray-600">{jobMsg}</span>
                </>
              ) : null}
            </div>
            <div className="w-full h-2 bg-gray-200 rounded">
              <div
                className="h-2 bg-indigo-600 rounded"
                style={{
                  width:
                    jobTotal > 0
                      ? `${Math.min(100, Math.round((jobCompleted / jobTotal) * 100))}%`
                      : "0%",
                }}
              />
            </div>
            <div className="flex justify-between">
              <span>
                {jobCompleted} / {jobTotal} jobs
              </span>
              <span>
                {jobTotal > 0
                  ? `${Math.min(100, Math.round((jobCompleted / jobTotal) * 100))}%`
                  : "-"}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {/* Results */}
      <div className="border rounded-xl p-4 space-y-3">
        <h2 className="font-semibold">Results</h2>
        {results.length === 0 ? (
          <div className="text-sm text-gray-600">
            {status === "polling"
              ? "Waiting for outputs… (we check every 10 seconds)"
              : "No results yet."}
          </div>
        ) : (
          <ul className="list-disc pl-5 space-y-1">
            {results.map((it) => (
              <li key={it.key}>
                <a
                  className="text-blue-600 hover:underline break-all"
                  href={it.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {it.key}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
