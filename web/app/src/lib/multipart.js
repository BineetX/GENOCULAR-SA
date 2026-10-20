// minimal, resilient multipart uploader using presigned part URLs
const API = import.meta.env.VITE_API_BASE || "/api";

export async function multipartUpload(file, jobId, {
  partSize = 32 * 1024 * 1024,   // 32 MiB
  concurrency = 4,
  onProgress = () => {},         // (uploadedParts, totalParts)
  signal,
} = {}) {

  // 1) create MPU
  const createResp = await fetch(`${API}/uploads/multipart/create`, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ filename: file.name, job_id: jobId }),
    signal,
  });
  if (!createResp.ok) throw new Error("mpu create failed");
  const { uploadId, key } = await createResp.json();

  // 2) slice file to parts
  const parts = [];
  for (let start = 0, pn = 1; start < file.size; start += partSize, pn++) {
    const end = Math.min(start + partSize, file.size);
    parts.push({ pn, start, end, blob: file.slice(start, end) });
  }

  // 3) sign all part numbers
  const partNums = parts.map(p => p.pn);
  const signResp = await fetch(`${API}/uploads/multipart/sign`, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ key, uploadId, parts: partNums }),
    signal,
  });
  if (!signResp.ok) throw new Error("mpu sign failed");
  const signed = await signResp.json();

  // 4) upload with N workers
  const completed = new Array(parts.length);
  let idx = 0, uploaded = 0;

  async function worker() {
    while (idx < parts.length) {
      const i = idx++;
      const p = parts[i];
      const url = signed.urls[p.pn];
      // retry a few times
      let tries = 0, done = false;
      while (!done && tries < 3) {
        tries++;
        try {
          const resp = await fetch(url, { method: "PUT", body: p.blob, signal });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const etag = resp.headers.get("etag");
          if (!etag) throw new Error("missing ETag");
          completed[i] = { ETag: etag, PartNumber: p.pn };
          uploaded++;
          onProgress(uploaded, parts.length);
          done = true;
        } catch (e) {
          if (tries >= 3) throw e;
          await new Promise(r => setTimeout(r, 1000 * tries));
        }
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  // 5) complete MPU
  const completeResp = await fetch(`${API}/uploads/multipart/complete`, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ key, uploadId, parts: completed }),
    signal,
  });
  if (!completeResp.ok) throw new Error("mpu complete failed");

  return { key };
}

