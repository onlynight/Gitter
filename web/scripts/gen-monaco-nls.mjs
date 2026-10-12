#!/usr/bin/env node
/**
 * Monaco 中文语言包生成器（lang.monaco.zhcn，插件形式交付——不内置进编辑器库）：
 * 扫描 monaco-editor ESM 源码的全部 localize/localize2 调用（module+key 定序 → 稳定索引），
 * 译文取 microsoft/vscode-loc 的 zh-hans 语言包（contents[模块路径][key]），产物为
 * lang.monaco.zhcn/nls.js——设置 _VSCODE_NLS_MESSAGES/_LANGUAGE 全局表（Monaco 官方
 * NLS 编译形态 localize(索引, 英文兜底) 的运行时查表通道）。
 *
 * 用法：node scripts/gen-monaco-nls.mjs [--pack <main.i18n.json 路径>]
 *   · --pack 缺省时从 CDN 拉取 vscode-loc main 分支（需网络；已存在临时缓存则复用）
 *   · Monaco 升级后必须重跑（索引随版本变化；buildMonacoLib 有同频断言兜底）
 * 译文键缺口/语言包未覆盖的模块自动回落英文（表内 null 洞 → nls.lookupMessage 走兜底）。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const packagesRoot = path.resolve(webRoot, "..", "app", "resources", "packages");
const MONACO_ESM_ROOT = path.join(webRoot, "node_modules", "monaco-editor", "esm");
const PACK_CACHE = path.join(here, "monaco-nls", "_vscode-zh-main.i18n.json");
const PACK_URL = "https://cdn.jsdelivr.net/gh/microsoft/vscode-loc@main/i18n/vscode-language-pack-zh-hans/translations/main.i18n.json";
const OUT_PKG = path.join(packagesRoot, "lang.monaco.zhcn");

/**
 * monaco localize 调用首参匹配（gen 与 buildMonacoLib 共用同一形态——索引稳定性依赖两者一致）：
 *   localize({ key: 'miCut', comment: ['&& denotes a mnemonic'] }, "Cu&&t")
 *   localize('some.key', "English")            ——字符串键形态
 * 组：1=函数名(localize|localize2) 2/3=对象键引号+键 4/5=字符串键引号+键
 */
export const NLS_CALL_RE = /(?<![A-Za-z0-9_$])(localize2?)\(\s*(?:\{\s*key:\s*(['"])([^'"]+)\2\s*,?\s*(?:comment:\s*\[[^\]]*\]\s*)?\}|(['"])([^'"]+)\4)\s*,/g;

/**
 * 定序扫描 monaco ESM 全部 localize 调用（目录字典序 + 文件内出现序）→ 稳定索引表。
 * 返回 { list: [{ module, key }], indexOf: Map<`${module}\u0000${key}`, idx> }。
 * buildMonacoLib 的改写与语言包 nls.js 的表共用此序——改扫描逻辑必须两处同步重跑。
 */
export function scanMonacoNls(monacoEsmRoot = MONACO_ESM_ROOT) {
  const list = [];
  const indexOf = new Map();
  const walk = (dir, module) => {
    const names = fs.readdirSync(dir).sort();
    for (const name of names) {
      const abs = path.join(dir, name);
      const st = fs.statSync(abs);
      if (st.isDirectory()) {
        walk(abs, module ? `${module}/${name}` : name);
      } else if (name.endsWith(".js")) {
        const modulePath = module ? `${module}/${name.replace(/\.js$/, "")}` : name.replace(/\.js$/, "");
        const contents = fs.readFileSync(abs, "utf8");
        for (const m of contents.matchAll(NLS_CALL_RE)) {
          const key = m[3] ?? m[5];
          const k = `${modulePath}\u0000${key}`;
          if (!indexOf.has(k)) {
            indexOf.set(k, list.length);
            list.push({ module: modulePath, key });
          }
        }
      }
    }
  };
  walk(monacoEsmRoot, "");
  return { list, indexOf };
}

function monacoVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(webRoot, "package.json"), "utf8"));
  return String(pkg.dependencies?.["monaco-editor"] ?? "").replace(/^[^\d]*/, "");
}

async function loadPack(explicit) {
  if (explicit) return JSON.parse(fs.readFileSync(explicit, "utf8"));
  if (fs.existsSync(PACK_CACHE)) {
    process.stdout.write(`[monaco-nls] 复用缓存语言包 ${PACK_CACHE}\n`);
    return JSON.parse(fs.readFileSync(PACK_CACHE, "utf8"));
  }
  process.stdout.write(`[monaco-nls] 拉取 vscode-loc zh-hans（${PACK_URL}）…\n`);
  const res = await fetch(PACK_URL);
  if (!res.ok) throw new Error(`语言包下载失败：HTTP ${res.status}——可手动下载后 --pack 指定`);
  const text = await res.text();
  fs.mkdirSync(path.dirname(PACK_CACHE), { recursive: true });
  fs.writeFileSync(PACK_CACHE, text, "utf8");
  return JSON.parse(text);
}

async function main() {
  const packArgIdx = process.argv.indexOf("--pack");
  const packPath = packArgIdx >= 0 ? process.argv[packArgIdx + 1] : undefined;
  const ver = monacoVersion();
  const { list } = scanMonacoNls();
  const pack = await loadPack(packPath);
  const contents = pack.contents ?? pack;

  const messages = new Array(list.length); // 稀疏：无译文 → 洞 → JSON 序列化为 null → 英文兜底
  let translated = 0;
  for (let i = 0; i < list.length; i++) {
    const { module, key } = list[i];
    const mod = contents[module];
    const zh = typeof mod === "string" ? mod : mod?.[key];
    if (typeof zh === "string" && zh.length > 0) {
      messages[i] = zh;
      translated++;
    }
  }
  const coverage = ((translated / list.length) * 100).toFixed(1);

  fs.mkdirSync(OUT_PKG, { recursive: true });
  const header =
    `/* 本文件由 web/scripts/gen-monaco-nls.mjs 生成——勿手改。` +
    `monaco-editor ${ver} · localize 条目 ${list.length} · 中文覆盖 ${translated}（${coverage}%）。` +
    `译文源 microsoft/vscode-loc（zh-hans）。Monaco 升级后重跑本脚本再生成；` +
    `须先于 gitui.lib.monaco 注入（gitui.page.files 可选依赖声明序保证）。机制：` +
    `Monaco 编译形态 localize(索引, 英文兜底) 运行时查 _VSCODE_NLS_MESSAGES[idx]，缺条目回落英文。 */\n`;
  const body =
    `(function (w) {\n` +
    `  w._VSCODE_NLS_LANGUAGE = "zh-cn";\n` +
    `  w._VSCODE_NLS_MESSAGES = ${JSON.stringify(messages)};\n` +
    `  w.GITTER_LIBS = w.GITTER_LIBS || {};\n` +
    `  w.GITTER_LIBS.monacoNlsZhCn = { language: "zh-cn", entries: ${list.length}, translated: ${translated} };\n` +
    `})(window);\n`;
  fs.writeFileSync(path.join(OUT_PKG, "nls.js"), header + body, "utf8");
  fs.writeFileSync(
    path.join(OUT_PKG, "nls.meta.json"),
    JSON.stringify({ monacoVersion: ver, indexes: list.length, translated, coverage }, null, 2) + "\n",
    "utf8",
  );
  process.stdout.write(`[monaco-nls] lang.monaco.zhcn/nls.js ✓ 条目 ${list.length} · 中文 ${translated}（${coverage}%）\n`);
}

await main();
