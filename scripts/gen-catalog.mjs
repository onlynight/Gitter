#!/usr/bin/env node
/**
 * 本地目录清单生成器（extension-system-v2.md §16.6 G 阶段 catalog 的宿主侧）：
 * 扫描一个包根目录，逐包走宿主同源 zod 校验（dist 里的 normalizeManifest），
 * 产出 catalog.json（id/名称/版本/kinds/权限/校验和/装载状态）——供目录站聚合或人工审阅。
 * 用法：node scripts/gen-catalog.mjs <包根目录> [输出 catalog.json]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as crypto from "node:crypto";

const require_ = createRequire(import.meta.url);
const root = process.argv[2];
if (!root || !fs.existsSync(root)) {
  console.error("用法: node scripts/gen-catalog.mjs <包根目录> [输出文件]");
  process.exit(1);
}
const out = process.argv[3] ?? path.join(root, "catalog.json");
const here = path.dirname(fileURLToPath(import.meta.url));
const { normalizeManifest } = require_(path.resolve(here, "../app/dist/services/extensions/schema.js"));

const entries = [];
for (const dirName of fs.readdirSync(root).sort()) {
  const dir = path.join(root, dirName);
  let isDir = false;
  try { isDir = fs.statSync(dir).isDirectory(); } catch { continue; }
  if (!isDir) continue;
  const manifestPath = path.join(dir, "manifest.json");
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch { raw = null; }
  const manifestBytes = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath) : Buffer.alloc(0);
  const checksum = "sha256:" + crypto.createHash("sha256").update(manifestBytes).digest("hex").slice(0, 16);
  if (!raw) {
    entries.push({ dir: dirName, state: "error", reason: "manifest 读取失败", checksum });
    continue;
  }
  const norm = normalizeManifest(raw);
  if (!norm.ok) {
    entries.push({ dir: dirName, state: "error", reason: norm.reason, checksum });
    continue;
  }
  const m = norm.manifest;
  const kinds = [];
  if (m.contributes.themes.length) kinds.push("theme");
  if (m.contributes.grammars.length) kinds.push("grammar");
  if (m.contributes.commands.length) kinds.push("commands");
  if (m.contributes.configuration.length) kinds.push("configuration");
  if (m.contributes.skills.length) kinds.push("skills");
  if (m.entry) kinds.push(m.entrySandbox === "utility" ? "code:l3" : "code:l2");
  entries.push({
    dir: dirName, id: m.id, name: m.name, version: m.version,
    description: m.description, kinds, permissions: m.permissions,
    apiVersion: m.apiVersion, engines: m.engines, checksum, state: "ok",
  });
}
fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), packages: entries }, null, 2) + "\n");
const bad = entries.filter((e) => e.state !== "ok").length;
console.log(`catalog 生成完毕：${entries.length} 个包（${entries.length - bad} ok / ${bad} error）→ ${out}`);
