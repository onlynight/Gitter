#!/usr/bin/env node
/**
 * markdown-preview 外部插件构建/安装：
 *   node plugins/markdown-preview/build.mjs            # 打包 main.js（esbuild 单文件 CJS）
 *   node plugins/markdown-preview/build.mjs --install  # 打包 + 复制 manifest/main.js 进用户插件根
 * 用户插件根 = %APPDATA%/<gitter-app|Gitter>/packages/<包 id>/（dev 进程 userData 用
 * gitter-app，打包版用 productName Gitter——按 settings.json 是否存在判定）。
 * 依赖（esbuild/markdown-it）从 web/node_modules 解析——插件目录自身零 node_modules。
 */
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..", "..", "web");
const req = createRequire(path.join(webRoot, "package.json"));
const esbuild = req("esbuild");

const manifest = JSON.parse(fs.readFileSync(path.join(here, "manifest.json"), "utf8"));
const outfile = path.join(here, "main.js");

await esbuild.build({
  entryPoints: [path.join(here, "src", "main.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  nodePaths: [path.join(webRoot, "node_modules")],
  sourcemap: false,
  logLevel: "info",
});

if (process.argv.includes("--install")) {
  const appData = process.env.APPDATA ?? path.join(process.env.HOME ?? "", "AppData", "Roaming");
  // 两个用户根都装：Electron userData 取 productName（Gitter，dev 与打包版同根），
  // gitter-app 为旧代码/无 productName 时期的遗留根（历史 settings 在此）——不猜测，都落
  const roots = ["Gitter", "gitter-app"].map((name) => path.join(appData, name, "packages"));
  for (const dest of roots) {
    fs.mkdirSync(path.join(dest, manifest.id), { recursive: true });
    fs.copyFileSync(path.join(here, "manifest.json"), path.join(dest, manifest.id, "manifest.json"));
    fs.copyFileSync(outfile, path.join(dest, manifest.id, "main.js"));
    console.log(`[markdown-preview] 已安装 → ${path.join(dest, manifest.id)}`);
  }
  console.log("[markdown-preview] 生效方式：重启应用，或 设置 → 扩展 将「允许代码插件」关→开（触发重装载）");
}
