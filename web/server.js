// server.js
const http = require("http");
const { stat, realpath } = require("fs/promises");
const { createReadStream } = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const DIST = path.join(__dirname, "dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".webp": "image/webp",
  ".ico":  "image/x-icon",
  ".txt":  "text/plain; charset=utf-8",
  ".map":  "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
};

function sendFile(req, res, filePath, status = 200) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  res.writeHead(status, {
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": /\.(js|css|png|jpe?g|gif|svg|webp|woff2?)$/.test(ext)
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  });
  if (req.method === "HEAD") return res.end();
  const stream = createReadStream(filePath);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

async function handler(req, res) {
  try {
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405, { Allow: "GET, HEAD" });
      return res.end("Method Not Allowed");
    }
    const url = new URL(req.url, "http://localhost");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.includes("\0") || pathname.split("/").some(part => part.startsWith("."))) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    if (pathname === "/") pathname = "/index.html";

    const candidate = path.normalize(path.join(DIST, pathname));
    if (!candidate.startsWith(DIST + path.sep)) { res.writeHead(403); return res.end("Forbidden"); }

    try {
      const st = await stat(candidate);
      const resolved = await realpath(candidate);
      if (!resolved.startsWith(await realpath(DIST) + path.sep)) {
        res.writeHead(403);
        return res.end("Forbidden");
      }
      if (st.isFile()) return sendFile(req, res, candidate, 200);
    } catch { /* fall through */ }

    return sendFile(req, res, path.join(DIST, "index.html"), 200);
  } catch (e) {
    res.writeHead(e instanceof URIError ? 400 : 500, { "Content-Type": "text/plain" });
    res.end(e instanceof URIError ? "Bad Request" : "Internal Server Error");
  }
}

http.createServer(handler).listen(PORT, () => {
  console.log(`Web listening on http://0.0.0.0:${PORT}`);
});

