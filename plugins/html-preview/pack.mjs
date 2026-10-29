#!/usr/bin/env node
/**
 * html-preview 分发包（.gpk）打包：
 *   node plugins/html-preview/pack.mjs            # 先跑 build.mjs（重打 main.js）再打 .gpk
 *   node plugins/html-preview/pack.mjs --no-build # 跳过 esbuild，直接打现有 main.js
 * 产物：plugins/html-preview/dist/com.gitter.html-preview-<version>.gpk（发布单位）
 * .gpk = fflate zip 容器（extension-system-v2.md §五）：manifest.json 位于 zip 根，导入时解包到
 * userData/packages/<id>/（gpk.ts importGpkFile）。用户安装：Gitter → 设置 → 扩展 → 导入扩展包。
 * 依赖（fflate）从 app/node_modules 解析——插件目录自身零 node_modules。
 */
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..", "app");
const req = createRequire(path.join(appRoot, "package.json"));
const { zipSync } = req("fflate");

if (!process.argv.includes("--no-build")) {
  const { spawnSync } = await import("node:child_process");
  const build = spawnSync(process.execPath, [path.join(here, "build.mjs")], { stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(here, "manifest.json"), "utf8"));
const outDir = path.join(here, "dist");
fs.mkdirSync(outDir, { recursive: true });
const outfile = path.join(outDir, `${manifest.id}-${manifest.version}.gpk`);

// 只收入 Gitter 装载需要的最小集合：manifest + entry（main.js）。源码/打包脚本/README 不打进
// .gpk——避免包体虚胖且语义上给作者造成"已生效"误解（同 tools/ide-extension 打包约定）。
const FILES = ["manifest.json", manifest.entry];
const entries = {};
for (const rel of FILES) {
  const full = path.join(here, rel);
  if (!fs.existsSync(full)) throw new Error(`[html-preview] 打包缺文件：${rel}`);
  entries[rel] = new Uint8Array(fs.readFileSync(full));
}

const gpk = zipSync(entries);
fs.writeFileSync(outfile, Buffer.from(gpk));
console.log(`[html-preview] 已打包 → ${path.relative(process.cwd(), outfile)} (${(gpk.length / 1024).toFixed(1)} KB)`);
console.log("[html-preview] 发布：把该 .gpk 发给用户 → Gitter 设置 → 扩展 → 导入扩展包");
