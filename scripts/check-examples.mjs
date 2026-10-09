#!/usr/bin/env node
/**
 * examples/ 校验：走真实的 normalizeManifest（app/dist/services/extensions/schema.js），
 * 不是另写一份规则。同时检查目录名 === manifest.id、i18n 语言识别、
 * 以及 L2/L3 entry 的导出形态是否合法。
 *
 * 用法：node scripts/check-examples.mjs
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// import.meta.url → 绝对路径（win32 下需 fileURLToPath，不能用 .pathname：会得到 /d/Code/...）
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const examplesRoot = path.join(repoRoot, "examples");
const distDir = path.join(repoRoot, "app", "dist");

if (!fs.existsSync(distDir)) {
  console.error("✗ app/dist 不存在——请先 `npm run build`（在 app/ 下）");
  process.exit(1);
}

// 复用宿主校验器（CJS）——require 走 app/ 的 node_modules
const requireApp = createRequire(path.join(repoRoot, "app", "package.json"));
let normalizeManifest;
try {
  ({ normalizeManifest } = requireApp(path.join(distDir, "services", "extensions", "schema.js")));
} catch (e) {
  console.error("✗ 无法加载宿主校验器:", e.message);
  process.exit(1);
}

const ID_RE = /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/;
const KNOWN_LANGS = new Set(["en", "zh-Hans"]);
const HOST_ACTIONS = new Set(["terminal.run", "shell.openPath", "shell.reveal", "repo.refresh", "agent.task.create", "agent.task.resume"]);

// 内置文案表（app/resources/Strings.tsv）：manifest 的 %key% 也可引用宿主内置键，
// 渲染层 t() 按 lang → en → 原样解析，不走包 i18n 目录。
const BUILTIN_KEYS = new Set();
try {
  for (const line of fs.readFileSync(path.join(repoRoot, "app", "resources", "Strings.tsv"), "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const k = line.split("\t")[0].trim().replace(/\./g, "_");
    if (k) BUILTIN_KEYS.add(k);
  }
} catch {
  warnMsg("无法读取 app/resources/Strings.tsv——内置 %key% 引用将全部判为缺失");
}

const ok = [];
const fail = [];
const warn = [];
function check(cond, good, bad) { if (cond) ok.push(good); else fail.push(bad); }
function warnMsg(m) { warn.push(m); }

let dirs = [];
try {
  dirs = fs.readdirSync(examplesRoot).filter((d) => fs.statSync(path.join(examplesRoot, d)).isDirectory()).sort();
} catch {
  console.error("✗ 未找到 examples/ 目录");
  process.exit(1);
}
check(dirs.length > 0, `发现 ${dirs.length} 个示例目录`, "examples/ 下没有任何目录");

for (const dir of dirs) {
  const pkgDir = path.join(examplesRoot, dir);
  const manifestPath = path.join(pkgDir, "manifest.json");
  const tag = `[${dir}]`;

  // 1. manifest.json 存在
  let raw;
  if (!fs.existsSync(manifestPath)) {
    fail.push(`${tag} 缺少 manifest.json`);
    continue;
  }
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (e) {
    fail.push(`${tag} manifest.json 不是合法 JSON: ${e.message}`);
    continue;
  }

  // 2. 目录名 === manifest.id
  check(dir === raw.id, `${tag} 目录名与 id 一致`, `${tag} 目录名 "${dir}" ≠ manifest.id "${raw.id}"`);

  // 3. 走真实 zod 校验器
  const result = normalizeManifest(raw);
  if (!result.ok) {
    fail.push(`${tag} manifest 校验失败: ${result.reason}`);
    continue;
  }
  const m = result.manifest;
  check(m.schemaVersion === 2, `${tag} schemaVersion=2 ✓`, `${tag} schemaVersion 非 2`);
  check(ID_RE.test(m.id), `${tag} id 反向域名 ✓`, `${tag} id 非反向域名: ${m.id}`);

  // 4. entry 文件存在 + 导出形态
  if (m.entry) {
    const entryPath = path.join(pkgDir, m.entry);
    if (!fs.existsSync(entryPath)) {
      fail.push(`${tag} entry "${m.entry}" 文件不存在`);
    } else {
      let src;
      try {
        src = fs.readFileSync(entryPath, "utf8");
      } catch (e) {
        fail.push(`${tag} entry 不可读: ${e.message}`);
        src = "";
      }
      const isL3 = m.entrySandbox === "utility";
      if (isL3) {
        check(/require\s*\(\s*["']?sdkDir/.test(src) || /connectL3/.test(src),
          `${tag} L3 入口使用 connectL3 ✓`,
          `${tag} L3 入口未使用 connectL3（应 require(sdkDir + "/services/extensions/l3-child")）`);
        check(Array.isArray(m.permissions) && m.permissions.length > 0,
          `${tag} L3 权限清单非空 ✓`,
          `${tag} L3 插件应声明非空 permissions`);
        const PERMS = new Set(["storage", "notify", "events", "git.read", "tools", "statusbar", "webview"]);
        const bad = m.permissions.filter((p) => !PERMS.has(p));
        check(bad.length === 0, `${tag} L3 权限名全部合法 ✓`, `${tag} 非法权限: ${bad.join(", ")}`);
      } else {
        const hasExport = /module\.exports\s*=/.test(src);
        const hasConnectL3 = /connectL3/.test(src);
        check(hasExport, `${tag} L2 入口导出 module.exports ✓`, `${tag} L2 入口未导出 module.exports`);
        check(!hasConnectL3, `${tag} L2 入口未误用 connectL3 ✓`, `${tag} L2 入口不应调用 connectL3`);
      }
      check(!/^import\s/m.test(src) && !/^export\s/m.test(src),
        `${tag} 入口为 CJS（无 ES module 语法）✓`,
        `${tag} 入口含 import/export——宿主 require 会失败`);
      check(!src.includes("require(\"electron\")") && !src.includes("require('electron')") &&
            !src.includes("require(\"@electron/remote\")") && !src.includes("require('@electron/remote')"),
        `${tag} 入口未直接依赖 electron API ✓`,
        `${tag} 入口不应直接 require electron/@electron/remote（插件跑在宿主主进程，无 electron 导出）`);
      // 语法校验：Function 构造器只 parse 不执行（宿主 require 会立即执行，故此处只做 parse）
      try {
        // eslint-disable-next-line no-new-func
        new Function(src);
        check(true, `${tag} 入口 JS 语法合法 ✓`);
      } catch (e) {
        fail.push(`${tag} 入口 JS 语法错误: ${e.message}`);
      }
    }
  } else {
    check(m.contributes && Object.values(m.contributes).some((v) => Array.isArray(v) && v.length > 0),
      `${tag} L1 数据包贡献非空 ✓`,
      `${tag} 无 entry 且 contributes 全空——导入会被拒`);
  }

  // 5. 贡献点字段抽查
  const c = m.contributes ?? {};
  for (const cmd of c.commands ?? []) {
    check(HOST_ACTIONS.has(cmd.action),
      `${tag} 命令 ${cmd.id} 动作在白名单 ✓`,
      `${tag} 命令 ${cmd.id} 动作 "${cmd.action}" 不在宿主白名单`);
    if (cmd.when) check(cmd.when.length <= 200, `${tag} 命令 ${cmd.id} when 长度合规 ✓`, `${tag} 命令 ${cmd.id} when 超长`);
  }
  for (const tt of c.taskTypes ?? []) {
    check(typeof tt.promptTemplate === "string" && tt.promptTemplate.includes("{input}"),
      `${tag} taskType ${tt.id} 含 {input} ✓`,
      `${tag} taskType ${tt.id} promptTemplate 缺 {input}`);
  }
  for (const s of c.subagentPresets ?? []) {
    if (s.timeoutMs !== null && s.timeoutMs !== undefined) {
      check(s.timeoutMs >= 30000 && s.timeoutMs <= 1800000,
        `${tag} subagentPreset ${s.id} timeoutMs 在范围内 ✓`,
        `${tag} subagentPreset ${s.id} timeoutMs=${s.timeoutMs} 超出 30000..1800000`);
    }
  }
  for (const cs of c.contextFiles ?? []) {
    if (cs.capChars !== null && cs.capChars !== undefined) {
      check(cs.capChars >= 100 && cs.capChars <= 16000,
        `${tag} contextFile capChars 在范围内 ✓`,
        `${tag} contextFile capChars=${cs.capChars} 超出 100..16000`);
    }
  }
  for (const ap of c.agentPermissionRules ?? []) {
    check(ap.effect === "deny", `${tag} agentPermissionRule effect=deny ✓`, `${tag} agentPermissionRule effect 必须是 deny`);
  }
  for (const ms of c.mcpServers ?? []) {
    check(ms.transport === "stdio", `${tag} mcpServer ${ms.id} transport=stdio ✓`, `${tag} mcpServer transport 只能是 stdio`);
  }
  if ((c.themes ?? []).length > 1) {
    const ids = (c.themes).map((t) => t.id ?? "");
    const bases = (c.themes).map((t) => t.base ?? "dark");
    check(ids.every(Boolean) && new Set(ids).size === ids.length,
      `${tag} 多主题包 id 唯一且非空 ✓`,
      `${tag} 多主题包每项必须有唯一 id`);
    check(new Set(bases).size === bases.length,
      `${tag} 多主题包 base 一亮一暗 ✓`,
      `${tag} 多主题包 base 重复`);
  }
  // pages
  for (const p of c.pages ?? []) {
    const entryPath = path.join(pkgDir, p.entry);
    check(fs.existsSync(entryPath), `${tag} 页面 entry ${p.entry} 存在 ✓`, `${tag} 页面 entry "${p.entry}" 不存在`);
    if (fs.existsSync(entryPath)) {
      const psrc = fs.readFileSync(entryPath, "utf8");
      // 页面必须是经典 IIFE，非 ES module
      check(!/^import\s/m.test(psrc) && !/^export\s/m.test(psrc),
        `${tag} 页面入口为经典 script ✓`,
        `${tag} 页面入口含 import/export——经典 script 无法使用`);
      check(/registerPage\s*\(/.test(psrc),
        `${tag} 页面调用 GITTER_UI.registerPage ✓`,
        `${tag} 页面未调用 window.GITTER_UI.registerPage`);
      check(/GITTER_KIT/.test(psrc),
        `${tag} 页面消费 window.GITTER_KIT ✓`,
        `${tag} 页面未消费 window.GITTER_KIT（React 单实例）`);
      try {
        // eslint-disable-next-line no-new-func
        new Function(psrc);
        check(true, `${tag} 页面 JS 语法合法 ✓`);
      } catch (e) {
        fail.push(`${tag} 页面 JS 语法错误: ${e.message}`);
      }
    }
    for (const s of p.styles ?? []) {
      check(fs.existsSync(path.join(pkgDir, s)), `${tag} 页面样式 ${s} 存在 ✓`, `${tag} 页面样式 "${s}" 不存在`);
    }
    const SCOPE_NAMES = new Set(["open","git.read","git.write","settings.write","agent.run","agent.config",
      "extensions.admin","terminal","ai.invoke","approval","window"]);
    const bad = (p.permissions ?? []).filter((x) => !SCOPE_NAMES.has(x));
    check(bad.length === 0, `${tag} 页面权限域全部合法 ✓`, `${tag} 页面非法权限域: ${bad.join(", ")}`);
  }

  // 6. i18n 语言识别 + %key% 引用完整性
  const i18nDir = path.join(pkgDir, "i18n");
  if (fs.existsSync(i18nDir)) {
    const files = fs.readdirSync(i18nDir);
    for (const f of files) {
      const lang = f.replace(/\.json$/i, "");
      if (!f.endsWith(".json")) continue;
      if (!KNOWN_LANGS.has(lang)) {
        warnMsg(`${tag} i18n/${f} 语言不被识别（仅 en / zh-Hans）——将静默忽略`);
        continue;
      }
      try {
        JSON.parse(fs.readFileSync(path.join(i18nDir, f), "utf8"));
      } catch (e) {
        fail.push(`${tag} i18n/${f} 不是合法 JSON: ${e.message}`);
      }
    }
    // %key% 引用必须能在 zh-Hans 或 en 里找到
    const dicts = {};
    for (const lang of KNOWN_LANGS) {
      const p = path.join(i18nDir, `${lang}.json`);
      if (fs.existsSync(p)) {
        try { dicts[lang] = JSON.parse(fs.readFileSync(p, "utf8")); } catch { /* already reported */ }
      }
    }
    const allKeys = new Set([...Object.keys(dicts.en ?? {}), ...Object.keys(dicts["zh-Hans"] ?? {})]);
    // 内置键（app/resources/Strings.tsv，如 %Nav_Dashboard%）由渲染层 t() 解析，不走包 i18n——
    // 解析顺序是 lang → en → 原样，故仅当内置表也没有时才报缺失。
    for (const k of BUILTIN_KEYS) allKeys.add(k);
    const refs = [];
    for (const cmd of c.commands ?? []) refs.push(...String(cmd.title).matchAll(/%(.+)%/g).map((x) => x[1]));
    for (const p of c.pages ?? []) refs.push(...String(p.title).matchAll(/%(.+)%/g).map((x) => x[1]));
    for (const r of c.menus ?? []) void r; // menus 用 command id，不用 %key%
    const missing = [...new Set(refs)].filter((k) => !allKeys.has(k));
    check(missing.length === 0,
      `${tag} %key% 引用全部可解析 ✓`,
      `${tag} %key% 引用缺失: ${missing.join(", ")}`);
  }

  // 7. engines / apiVersion
  check(m.apiVersion === null || m.apiVersion <= 3,
    `${tag} apiVersion ≤ 3 ✓`,
    `${tag} apiVersion=${m.apiVersion} 超出宿主支持（当前 3）`);
  if (m.engines && m.engines.gitter) {
    warnMsg(`${tag} engines.gitter="${m.engines.gitter}"（校验器不解析 semver，仅做存在性检查）`);
  }

  console.log(`✓ ${tag}`);
}

console.log("");
console.log(`通过 ${ok.length} 项检查`);
if (warn.length) {
  console.log(`\n警告 ${warn.length} 条：`);
  for (const w of warn) console.log(`  ⚠ ${w}`);
}
if (fail.length) {
  console.log(`\n失败 ${fail.length} 项：`);
  for (const f of fail) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\n全部示例 manifest 通过宿主校验器 ✓");
