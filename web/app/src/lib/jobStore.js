import { apiJson } from "./api.js";

const LS_KEY_PREFIX = "genoverse_jobs_";

function lsKey(userId) {
  return `${LS_KEY_PREFIX}${userId || "anon"}`;
}

function safeParse(json, fallback) {
  if (!json) return fallback;
  try {
    const v = JSON.parse(json);
    if (!Array.isArray(v)) return fallback;
    return v;
  } catch {
    return fallback;
  }
}

/**
 * Read jobs from localStorage (fast, sync).
 * Shape: [{ jobId, sampleId, r1, r2, ts }, ...] newest first.
 *
 * This is treated as a cache; the server DB is the source of truth.
 * JobsHistory.jsx should usually call syncJobsFromServer() on mount
 * and then fall back to listJobs() if API fails.
 */
export function listJobs(userId) {
  if (!userId) return [];
  const raw = localStorage.getItem(lsKey(userId));
  return safeParse(raw, []).sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

/**
 * Write a job entry into localStorage (used immediately in UI).
 *
 * job: { jobId, sampleId, r1, r2, ts }
 */
export function saveJobLocal(userId, job) {
  if (!userId || !job?.jobId) return;
  const key = lsKey(userId);
  const existing = listJobs(userId).filter((j) => j.jobId !== job.jobId);
  const next = [{ ...job }, ...existing];
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch (e) {
    console.error("saveJobLocal: failed to write to localStorage", e);
  }
  return next;
}

/**
 * Sync jobs from server to localStorage.
 * Returns the array from server (same shape as used by JobsHistory).
 *
 * Server shape from /user-jobs:
 *   {
 *     jobs: [
 *       { jobId, userId, sampleId, r1, r2, ts },
 *       ...
 *     ]
 *   }
 */
export async function syncJobsFromServer(userId) {
  if (!userId) return [];
  try {
    const res = await apiJson(
      `/user-jobs?user_id=${encodeURIComponent(userId)}`
    );
    const jobs = Array.isArray(res?.jobs) ? res.jobs : [];
    // Persist in localStorage so JobsHistory.jsx can stay synchronous
    try {
      localStorage.setItem(lsKey(userId), JSON.stringify(jobs));
    } catch (e) {
      console.error("syncJobsFromServer: failed to write cache", e);
    }
    return jobs;
  } catch (e) {
    console.error("syncJobsFromServer failed", e);
    // Fallback to local cache
    return listJobs(userId);
  }
}

/**
 * Save job in both localStorage and server DB.
 * Called by UploadAndRun.jsx after /jobs/{jobId}/submit.
 *
 * job: { jobId, sampleId, r1, r2, ts }
 *
 * Backend endpoint: POST /user-jobs/register
 * Body:
 *   {
 *     job_id:   <uuid string>,
 *     user_id:  <firebase uid>,
 *     sample_id: <sample/job name>,
 *     r1_name:  <R1 filename>,
 *     r2_name:  <R2 filename>
 *   }
 */
export async function saveJob(userId, job) {
  if (!userId || !job?.jobId) return;

  // 1) Update local immediately (so UI is instant)
  saveJobLocal(userId, job);

  // 2) Best-effort sync to server (DB-backed job history)
  try {
    await apiJson("/user-jobs/register", {
      method: "POST",
      body: JSON.stringify({
        job_id: job.jobId,
        user_id: userId,
        sample_id: job.sampleId || "",
        r1_name: job.r1 || "",
        r2_name: job.r2 || "",
        r_long_name: job.rLong || "",
      }),
    });
  } catch (e) {
    console.error("saveJob remote register failed", e);
  }
}

/* ========================
   Global Upload State
   ======================== */

const uploadTasks = new Map();
const globalListeners = new Set();

function notifyGlobalListeners() {
  const allTasks = Array.from(uploadTasks.values()).map(snapshotUploadTask);
  globalListeners.forEach((listener) => listener(allTasks));
}

export function snapshotUploadTask(task) {
  if (!task) return null;
  return {
    jobId: task.jobId,
    sampleId: task.sampleId,
    analysisType: task.analysisType,
    readMode: task.readMode,
    profileKey: task.profileKey,
    status: task.status,
    error: task.error || "",
    r1Progress: task.r1Progress || { done: 0, total: 0 },
    r2Progress: task.r2Progress || { done: 0, total: 0 },
    rLongProgress: task.rLongProgress || { done: 0, total: 0 },
  };
}

export function ensureUploadTask(jobId, initial = {}) {
  const existing = uploadTasks.get(jobId);
  if (existing) {
    Object.assign(existing, initial);
    notifyGlobalListeners();
    return existing;
  }
  const task = {
    jobId,
    status: "uploading",
    error: "",
    listeners: new Set(),
    r1Progress: { done: 0, total: 0 },
    r2Progress: { done: 0, total: 0 },
    rLongProgress: { done: 0, total: 0 },
    ...initial,
  };
  uploadTasks.set(jobId, task);
  notifyGlobalListeners();
  return task;
}

export function updateUploadTask(jobId, patch) {
  const task = ensureUploadTask(jobId);
  Object.assign(task, patch);
  const snapshot = snapshotUploadTask(task);
  task.listeners.forEach((listener) => listener(snapshot));
  notifyGlobalListeners();
}

export function getUploadTaskSnapshot(jobId) {
  return snapshotUploadTask(uploadTasks.get(jobId));
}

export function getRawUploadTask(jobId) {
  return uploadTasks.get(jobId);
}

export function cancelUploadTask(jobId) {
  const task = uploadTasks.get(jobId);
  if (task) {
    task.cancelled = true;
    task?.controller?.abort?.();
  }
}

export function subscribeUploadTask(jobId, listener) {
  const task = uploadTasks.get(jobId);
  if (!task) return () => {};
  task.listeners.add(listener);
  listener(snapshotUploadTask(task));
  return () => task.listeners.delete(listener);
}

export function subscribeAllUploadTasks(listener) {
  globalListeners.add(listener);
  listener(Array.from(uploadTasks.values()).map(snapshotUploadTask));
  return () => globalListeners.delete(listener);
}

export const isClientUploadStatus = (value = "") =>
  value === "uploading" || value === "submitting" || value === "paused";
