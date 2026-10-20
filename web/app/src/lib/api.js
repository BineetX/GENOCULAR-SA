// web/app/src/lib/api.js
import { auth } from "./firebase.js";
import { getJobAccessKey, jobIdFromApiPath } from "./jobAccess.js";

export const API_BASE = import.meta.env.VITE_API_BASE || "/api";

/** Build headers with Firebase ID token (if logged in) */
async function authHeader(path, explicitJobAccessKey = "") {
  const h = { "Content-Type": "application/json" };
  const jobId = jobIdFromApiPath(path);
  const jobAccessKey = explicitJobAccessKey || getJobAccessKey(jobId);
  if (jobAccessKey) {
    h.Authorization = `JobAccess ${jobAccessKey}`;
    return h;
  }
  const u = auth.currentUser;
  if (u) {
    const tok = await u.getIdToken();
    h.Authorization = `Bearer ${tok}`;
  }
  return h;
}

/** Generic JSON fetch using API_BASE and auto Bearer token */
export async function apiJson(path, options = {}) {
  const { jobAccessKey = "", ...fetchOptions } = options;
  const headers = await authHeader(path, jobAccessKey);
  const res = await fetch(`${API_BASE}${path}`, {
    ...fetchOptions,
    headers: { ...headers, ...(fetchOptions.headers || {}) },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    const error = new Error(`${res.status} ${res.statusText} — ${t}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

/** Text fetch with the same authenticated, API_BASE-scoped transport. */
export async function apiText(path, options = {}) {
  const { jobAccessKey = "", ...fetchOptions } = options;
  const headers = await authHeader(path, jobAccessKey);
  const res = await fetch(`${API_BASE}${path}`, {
    ...fetchOptions,
    headers: { ...headers, ...(fetchOptions.headers || {}) },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} — ${t}`);
  }
  return res.text();
}

/** ===== Your existing helpers, now routed via apiJson ===== */

export async function initUpload(filename, contentType = "application/octet-stream") {
  return apiJson(`/jobs/upload-init`, {
    method: "POST",
    body: JSON.stringify({ filename, content_type: contentType }),
  }); // -> { job_id, object_key, url, headers }
}

export async function submitJob(jobId, sample = "S1") {
  return apiJson(`/jobs/${jobId}/submit`, {
    method: "POST",
    body: JSON.stringify({ sample }),
  });
}

export function openEvents(jobId, onMessage) {
  // NOTE: EventSource cannot send Authorization headers.
  // If your backend requires auth here, use a token query (?token=) or switch to a WebSocket.
  const ev = new EventSource(`${API_BASE}/jobs/${jobId}/events`);
  ev.onmessage = (e) => {
    try { onMessage(JSON.parse(e.data)); } catch { /* ignore */ }
  };
  return ev; // caller should ev.close() when done
}

export async function getStatus(jobId) {
  return apiJson(`/jobs/${jobId}/status`);
}

export async function listArtifacts(jobId) {
  return apiJson(`/jobs/${jobId}/artifacts`); // -> { job_id, artifacts: [{name,key}] }
}

export async function getArtifactUrl(jobId, key) {
  const u = new URL(`${API_BASE}/jobs/${jobId}/artifact-url`, window.location.origin);
  u.searchParams.set("key", key);
  const headers = await authHeader(`/jobs/${jobId}/artifact-url`);
  const r = await fetch(u.toString(), { headers });
  if (!r.ok) throw new Error(`Could not load the result file (${r.status})`);
  return r.json(); // { url }
}
