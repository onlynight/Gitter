#!/usr/bin/env node
/**
 * Gitter 语法插件包构建器（tools/ide-extension）：
 * 把本目录下的 aura-vscode-extension / hat-vscode-extension 打成 .gpk（zip 容器，
 * extension-system-v2.md §六 gpk.ts：manifest.json 必须在压缩包根），并逐包用宿主同源
 * zod 校验（app/dist/services/extensions/schema.js）确认可被 PackageStore 装载。
 *
 * 设计边界（不要越过）：
 *  - 这里只出**静态资产 + Gitter manifest**；LSP 客户端、代码补全、诊断推送仍在上游
 *    VS Code 扩展（aura-vscode-extension/src/*.ts），Gitter 没有对位宿主能力，不复制。
 *  - 语法文件（syntaxes/*.tmLanguage.json）与上游**字节对齐**，避免双份漂移——
 *    上游改动需人工同步（本脚本会比对并告警）。
 *
 * 用法：
 *   node build-gitter-packages.mjs                    # 构建 + 校验，产出 dist/*.gpk
 *   node build-gitter-packages.mjs --no-verify        # 跳过 zod 校验（app 未编译时）
 *   node build-gitter-packages.mjs --check-sync       # 只比对语法与上游是否字节一致，不产出
 *   AURALANG_ROOT=/path/to/AuraLang/tools/ide-extension node build-gitter-packages.mjs
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(here, "..", "..", "app");
const requireFromApp = createRequire(path.join(APP_ROOT, "package.json"));
const { zipSync } = requireFromApp("fflate");

/** 上游 VS Code 扩展根（字节对齐基准；本机 AuraLang 检出）。 */
const UPSTREAM_ROOT = path.resolve(
  process.env.AURALANG_ROOT ?? path.join(here, "..", "..", "..", "AuraLang", "tools", "ide-extension"),
);

const PACKAGES = [
  { dir: "aura-vscode-extension", upstreamGrammar: "syntaxes/aura.tmLanguage.json" },
  { dir: "hat-vscode-extension", upstreamGrammar: "syntaxes/hat.tmLanguage.json" },
];

const args = new Set(process.argv.slice(2));
const DIST = path.join(here, "dist");
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

let exitCode = 0;

for (const pkg of PACKAGES) {
  const root = path.join(here, pkg.dir);
  const manifestPath = path.join(root, "manifest.json");

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (e) {
    console.error(`[FAIL] ${pkg.dir}: manifest.json 读取失败 — ${e.message}`);
    exitCode = 1;
    continue;
  }

  // 校验：manifest 声明的每个 grammar path 必须真存在于包目录
  // （PackageStore/GrammarService 会因文件缺失把该条静默降级到声明式引擎）
  for (const g of raw.contributes?.grammars ?? []) {
    if (!fs.existsSync(path.join(root, g.path))) {
      console.error(`[FAIL] ${pkg.dir}: manifest 声明的语法文件不存在 ${g.path}`);
      exitCode = 1;
    }
  }

  // 语法资产字节对齐检查（上游检出缺失只告警，不阻塞——CI 可能没有 AuraLang 检出）
  // 本仓与上游目录名相同，用 <upstreamRoot>/<dir>/<语法相对路径> 定位上游文件
  const localGrammar = path.join(root, pkg.upstreamGrammar);
  const upstreamGrammar = path.join(UPSTREAM_ROOT, pkg.dir, pkg.upstreamGrammar);
  if (!fs.existsSync(localGrammar)) {
    console.error(`[FAIL] ${pkg.dir}: 语法文件缺失 ${pkg.upstreamGrammar}`);
    exitCode = 1;
  } else if (fs.existsSync(upstreamGrammar)) {
    // 文本归一化比较（LF/CRLF 差异是各仓 core.autocrlf 造成的，对 TextMate 无语义）
    const norm = (buf) => buf.toString("utf8").replace(/\r\n/g, "\n");
    const a = norm(fs.readFileSync(localGrammar));
    const b = norm(fs.readFileSync(upstreamGrammar));
    const same = a === b;
    console.log(`[SYNC] ${pkg.dir}: 语法与上游 ${same ? "字节一致" : "已漂移"}`);
    // 只有 --check-sync 模式下漂移才阻塞；常规构建时上游检出可能已过期，仅告警
    if (!same && args.has("--check-sync")) exitCode = 1;
  } else {
    console.warn(`[WARN] ${pkg.dir}: 未找到上游检出 ${UPSTREAM_ROOT}，跳过字节对齐检查`);
  }

  if (args.has("--check-sync")) continue;

  // 打包：只收入 Gitter 装载需要的最小集合（manifest + 语法文件，路径与 manifest 声明一致）。
  // snippets/colors/language-configuration 是 VS Code 生态资产，Gitter 暂无对位宿主能力，
  // 保留在仓库供上游同步与文档，不打进 .gpk——避免包体虚胖且语义上给作者造成"已生效"误解。
  const manifestText = JSON.stringify(raw, null, 2) + "\n";
  const entries = {
    "manifest.json": new TextEncoder().encode(manifestText),
    [pkg.upstreamGrammar]: new Uint8Array(fs.readFileSync(localGrammar)),
    "README.md": new TextEncoder().encode(`# ${raw.id}

${raw.description ?? ""}

- 版本：${raw.version}
- 贡献：contributes.grammars（${raw.contributes.grammars.length} 项，kind=grammar / L1 纯数据）
- 语法来源：上游 AuraLang VS Code 扩展，字节对齐

## 安装

Gitter → 设置 → 扩展 → 导入扩展包，选择本 .gpk；或把解压后的目录拷进
\`<userData>/packages/<id>/\`（Windows 通常是 \`%APPDATA%/gitter/packages/\`).

安装后打开 \`${raw.contributes.grammars[0].extensions[0]}\` 文件，diff 与预览即按 TextMate 语法着色
（颜色由当前主题 tokenColors 提供，主题不含对应 scope 时回退正文色）。
`),
  };

  const buf = zipSync(entries);
  const outName = `${raw.id}-${raw.version}.gpk`;
  fs.writeFileSync(path.join(DIST, outName), buf);
  const sha = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
  console.log(`[OK]   ${outName}  ${buf.length} bytes  sha256:${sha}  entries=${Object.keys(entries).join(", ")}`);

  // 宿主同源 zod 校验（需先 npm run build 编译 app/dist）
  if (!args.has("--no-verify")) {
    try {
      const { normalizeManifest } = requireFromApp("./dist/services/extensions/schema.js");
      const norm = normalizeManifest(raw);
      if (!norm.ok) {
        console.error(`[FAIL] ${pkg.dir}: manifest 校验失败 — ${norm.reason}`);
        exitCode = 1;
      } else {
        const kinds = [];
        if (norm.manifest.contributes.grammars.length) kinds.push("grammar");
        console.log(`[OK]   ${pkg.dir}: 宿主校验通过（kinds=${kinds.join(",") || "-"}）`);
      }
    } catch (e) {
      console.warn(`[WARN] ${pkg.dir}: 宿主校验跳过（app/dist 未编译，先跑 npm run build）— ${e.message}`);
    }
  }
}

if (args.has("--check-sync")) {
  console.log(exitCode === 0 ? "\n语法资产与上游全部字节一致 ✓" : "\n存在语法漂移或缺失 ✗");
} else {
  console.log(exitCode === 0 ? `\n全部产出 → ${path.relative(process.cwd(), DIST)}` : "\n存在失败项 ✗");
}
process.exit(exitCode);
