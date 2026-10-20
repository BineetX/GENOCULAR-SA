const API = import.meta.env.VITE_API_BASE || "/api";

export async function multipartUpload(file, jobId, {
  partSize = 32 * 1024 * 1024,  // 32 MiB
  concurrency = 4,
  maxRetries = 3,
  signal,
} = {}) {
  // 1) Create MPU
  const create = await fetch(`${API}/uploads/multipart/create`, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ filename: file.name, job_id: jobId }),
    signal,
  }).then(r => r.json());
  const { uploadId, key } = create;

  // 2) Build parts
  const parts = [];
  for (let start = 0, pn = 1; start < file.size; start += partSize, pn++) {
    const end = Math.min(start + partSize, file.size);
    parts.push({ pn, start, end, blob: file.slice(start, end) });
  }

  // 3) Sign all parts
  const partNums = parts.map(p => p.pn);
  const signed = await fetch(`${API}/uploads/multipart/sign`, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ key, uploadId, parts: partNums }),
    signal,
  }).then(r => r.json());

  // 4) Upload with concurrency & retry
  const completed = new Array(parts.length);
  let idx = 0;
  async function worker() {
    while (idx < parts.length) {
      const i = idx++;
      const p = parts[i];
      const url = signed.urls[p.pn];
      let attempt = 0, ok = false, etag = null, lastErr = null;
      while (!ok && attempt < maxRetries) {
        attempt++;
        try {
          const resp = await fetch(url, { method: "PUT", body: p.blob, signal });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          etag = resp.headers.get("etag");
          if (!etag) throw new Error("missing ETag");
          ok = true;
        } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 1000*attempt)); }
      }
      if (!ok) throw lastErr || new Error("upload failed");
      completed[i] = { ETag: etag, PartNumber: p.pn };
    }
  }
  await Promise.all(Array.from({length: concurrency}, worker));

  // 5) Complete MPU
  await fetch(`${API}/uploads/multipart/complete`, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ key, uploadId, parts: completed }),
    signal,
  }).then(r => { if (!r.ok) throw new Error("complete failed"); });

  return { key, jobId };
}

