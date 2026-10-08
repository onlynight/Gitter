// dev-only 静态服务：/packages/* → app/resources/packages，其余 → web/dist（mock 页面视觉验证用）；勿提交
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const PKG_ROOT = path.resolve("D:/Code/Gitter/app/resources/packages");
const DIST_ROOT = path.resolve("D:/Code/Gitter/web/dist");
const TYPES = { ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };

http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url ?? "/").split("?")[0]).replace(/^\/+/, "");
  const base = rel.startsWith("packages/") ? PKG_ROOT : DIST_ROOT;
  const sub = rel.startsWith("packages/") ? rel.slice("packages/".length) : rel;
  let abs = path.resolve(base, ...sub.split("/"));
  if (!abs.toLowerCase().startsWith(base.toLowerCase())) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) abs = path.join(abs, "index.html");
  fs.readFile(abs, (err, data) => {
    if (err) { res.writeHead(404); res.end(String(err)); return; }
    res.writeHead(200, { "Cache-Control": "no-store", "Content-Type": TYPES[path.extname(abs)] ?? "application/octet-stream" });
    res.end(data);
  });
}).listen(5210, () => console.log("mock-static on 5210"));
