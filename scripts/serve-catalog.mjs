#!/usr/bin/env node
/**
 * 本地目录服务（extension-system-v2.md §16.6 G 阶段收口）：
 * 把一个包根目录变成 HTTP 注册表——GET /catalog.json（宿主同源校验清单）、
 * GET /packs/<dir>.gpk（zip 容器即时打包下载）、GET / 简易列表页。
 * 用法：node scripts/serve-catalog.mjs <包根目录> [端口=7788]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require_ = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "app");
const requireFromApp = createRequire(path.join(appRoot, "package.json"));
const { zipSync } = requireFromApp("fflate");
const { normalizeManifest } = requireFromApp("./dist/services/extensions/schema.js");

const root = process.argv[2];
const port = Number(process.argv[3] ?? 7788);
if (!root || !fs.existsSync(root)) {
  console.error("用法: node scripts/serve-catalog.mjs <包根目录> [端口]");
  process.exit(1);
}

function buildCatalog() {
  const entries = [];
  for (const dirName of fs.readdirSync(root).sort()) {
    const dir = path.join(root, dirName);
    let isDir = false;
    try { isDir = fs.statSync(dir).isDirectory(); } catch { continue; }
    if (!isDir) continue;
    const manifestPath = path.join(dir, "manifest.json");
    let raw = null;
    try { raw = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch { raw = null; }
    if (!raw) { entries.push({ dir: dirName, state: "error", reason: "manifest 读取失败" }); continue; }
    const norm = normalizeManifest(raw);
    if (!norm.ok) { entries.push({ dir: dirName, state: "error", reason: norm.reason }); continue; }
    const m = norm.manifest;
    entries.push({
      dir: dirName, id: m.id, name: m.name, version: m.version,
      description: m.description, download: `/packs/${dirName}.gpk`, state: "ok",
    });
  }
  return { generatedAt: new Date().toISOString(), packages: entries };
}

function packGpk(dirName) {
  const dir = path.join(root, path.basename(dirName).replace(/\.gpk$/, ""));
  const entries = {};
  const walk = (rel) => {
    for (const name of fs.readdirSync(path.join(dir, rel))) {
      const r = rel ? `${rel}/${name}` : name;
      const full = path.join(dir, r);
      if (fs.statSync(full).isDirectory()) walk(r);
      else entries[r] = new Uint8Array(fs.readFileSync(full));
    }
  };
  walk("");
  return zipSync(entries);
}

const server = http.createServer((req, res) => {
  const url = (req.url ?? "/").split("?")[0];
  if (url === "/catalog.json") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(buildCatalog()));
    return;
  }
  if (url.startsWith("/packs/") && url.endsWith(".gpk")) {
    try {
      const gpk = packGpk(path.basename(url));
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${path.basename(url)}"`);
      res.end(Buffer.from(gpk));
    } catch (e) {
      res.statusCode = 404;
      res.end(String(e));
    }
    return;
  }
  const cat = buildCatalog();
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<h1>Gitter 本地目录</h1><ul>${cat.packages.map((p) =>
    `<li><b>${p.name ?? p.dir}</b> ${p.state === "ok" ? `<a href="${p.download}">.gpk</a>` : `错误：${p.reason}`}</li>`).join("")}</ul>`);
});

server.listen(port, () => console.log(`目录服务: http://127.0.0.1:${port}/catalog.json（根: ${root}）`));
