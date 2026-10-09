// dev-only 静态服务：design/ 设计稿目录（视觉评审用）；用后即关
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("D:/Code/Gitter/design");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };

http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url ?? "/").split("?")[0]).replace(/^\/+/, "") || "branch-graph-mockup.html";
  const abs = path.resolve(ROOT, ...rel.split("/"));
  if (!abs.toLowerCase().startsWith(ROOT.toLowerCase())) { res.writeHead(403); res.end(); return; }
  fs.readFile(abs, (err, data) => {
    if (err) { res.writeHead(404); res.end(String(err)); return; }
    res.writeHead(200, { "Cache-Control": "no-store", "Content-Type": TYPES[path.extname(abs)] ?? "application/octet-stream" });
    res.end(data);
  });
}).listen(5212, () => console.log("design mock on 5212"));
