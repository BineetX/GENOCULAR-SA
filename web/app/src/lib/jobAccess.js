const accessKeys = new Map();

const normalizeJobId = (value) => String(value || "").trim();
const normalizeAccessKey = (value) => String(value || "").trim();

const jobAccessUrlFields = [
  "analysis_url",
  "analysisUrl",
  "private_job_url",
  "privateJobUrl",
  "private_url",
  "privateUrl",
  "private_link",
  "privateLink",
  "job_url",
  "jobUrl",
  "private_path",
  "privatePath",
  "url",
];

function validJobId(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(normalizeJobId(value));
}

function validAccessKey(value) {
  const key = normalizeAccessKey(value);
  return key.startsWith("gja_") && key.length >= 40 && key.length <= 128;
}

function accessFromUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw, "https://genocular.invalid");
  } catch {
    return null;
  }
  const jobId = normalizeJobId(parsed.searchParams.get("job_id"));
  const fragment = new URLSearchParams(String(parsed.hash || "").replace(/^#/, ""));
  const accessKey = normalizeAccessKey(fragment.get("access"));
  if (!validJobId(jobId) || !validAccessKey(accessKey)) return null;
  return { jobId, accessKey };
}

function accessFromObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  for (const field of jobAccessUrlFields) {
    const parsed = accessFromUrl(value[field]);
    if (parsed) return parsed;
  }

  const jobId = normalizeJobId(value.job_id || value.jobId);
  const accessKey = normalizeAccessKey(value.access_key || value.accessKey);
  if (!validJobId(jobId) || !validAccessKey(accessKey)) return null;
  return { jobId, accessKey };
}

/** Parse a private job URL, JSON recovery document, or legacy text recovery file. */
export function jobAccessFromInput(value) {
  if (value && typeof value === "object") {
    const parsed = accessFromObject(value);
    if (parsed) return parsed;
    throw new Error("This file does not contain a valid private job link.");
  }

  const text = String(value || "").trim();
  if (!text) throw new Error("Enter a private job URL or select a recovery file.");

  if (text.startsWith("{")) {
    try {
      const parsed = accessFromObject(JSON.parse(text));
      if (parsed) return parsed;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("The selected recovery JSON is not valid.");
      }
      throw error;
    }
  }

  const direct = accessFromUrl(text);
  if (direct) return direct;

  const legacyLink = text.match(/^Private link:\s*(\S+)/im)?.[1];
  const legacy = accessFromUrl(legacyLink);
  if (legacy) return legacy;

  throw new Error("A valid private job URL must include both the job ID and access key.");
}

export function registerJobAccessKey(jobId, accessKey) {
  const id = normalizeJobId(jobId);
  const key = normalizeAccessKey(accessKey);
  if (!validJobId(id) || !validAccessKey(key)) return false;
  accessKeys.set(id, key);
  return true;
}

export function accessKeyFromFragment() {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""));
  return normalizeAccessKey(params.get("access"));
}

export function getJobAccessKey(jobId) {
  const id = normalizeJobId(jobId);
  if (!id) return "";
  const remembered = accessKeys.get(id);
  if (remembered) return remembered;

  if (typeof window !== "undefined") {
    const pageJobId = normalizeJobId(new URLSearchParams(window.location.search).get("job_id"));
    const fragmentKey = accessKeyFromFragment();
    if (pageJobId === id && registerJobAccessKey(id, fragmentKey)) {
      return fragmentKey;
    }
  }
  return "";
}

export function forgetJobAccessKey(jobId) {
  return accessKeys.delete(normalizeJobId(jobId));
}

export function jobIdFromApiPath(path) {
  const match = String(path || "").match(/^\/jobs\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

export function privateJobPath(jobId, accessKey, pathname = "/run") {
  const id = normalizeJobId(jobId);
  const key = normalizeAccessKey(accessKey || getJobAccessKey(id));
  if (!id || !key) return "";
  return `${pathname}?job_id=${encodeURIComponent(id)}#access=${encodeURIComponent(key)}`;
}

export function privateJobUrl(jobId, accessKey, pathname = "/run") {
  const path = privateJobPath(jobId, accessKey, pathname);
  if (!path || typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}

export async function copyTextToClipboard(value) {
  const text = String(value || "");
  if (!text) return false;

  // The modern Clipboard API is only exposed in secure contexts by most
  // browsers. GENOCULAR can still be reached through an HTTP development IP,
  // so retain a selection-based fallback for that case and for denied browser
  // permissions.
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the synchronous browser copy mechanism below.
    }
  }

  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    textarea.remove();
  }
  return copied;
}

export function replaceWithPrivateJobLocation(jobId, accessKey, pathname = "/run") {
  if (typeof window === "undefined") return;
  const path = privateJobPath(jobId, accessKey, pathname);
  if (!path) return;
  registerJobAccessKey(jobId, accessKey);
  window.history.replaceState(window.history.state, "", path);
}

export function privateAnalysisPath(jobId) {
  return privateJobPath(jobId, getJobAccessKey(jobId), "/analysis");
}

export function downloadJobRecoveryFile(jobId, expiresAt = "") {
  const accessKey = getJobAccessKey(jobId);
  const url = privateJobUrl(jobId, accessKey);
  if (!accessKey || !url || typeof document === "undefined") return false;
  const content = JSON.stringify({
    format: "genocular-job-recovery",
    version: 1,
    job_id: jobId,
    private_job_url: url,
    analysis_url: privateJobUrl(jobId, accessKey, "/analysis"),
    expires_at: expiresAt || null,
    warning: "Anyone with this file can access this job. Keep it confidential.",
  }, null, 2);
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = `genocular-job-${jobId}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
  return true;
}
