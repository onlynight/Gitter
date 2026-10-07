#!/usr/bin/env node
/**
 * 生成默认扩展包（extension-system-v2.md §五"内置=同一格式自举"）：
 * 内置插件不是引擎私带数据，而是与用户包同一 manifest/目录格式的真实扩展包，
 * 走 PackageStore 同一条扫描/校验/启停路径。
 *
 * 产物（app/resources/packages/）：
 *  1. gitui.theme.dark / gitui.theme.light —— 由 resources/themes v1 包迁移为 v2，
 *     并按 grammar.ts 的 LEGACY_SCOPES 映射生成 tokenColors（TextMate 配色随主题包走）
 *  2. tm.* —— tm-themes（npm 数据包）策展主题包，wrapper ThemeDoc + 原 tokenColors
 *  3. gitui.tools.git —— L1 受限命令示例包（terminal.run 白名单动作）
 *
 * 幂等：每次运行清空重建生成目录。运行：node scripts/gen-default-packages.mjs
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = path.join(ROOT, "app");
// v1 主题源 = packages 内旧 id 目录（迁移后由清理段移除）
const PACKAGES = path.join(APP, "resources", "packages");
const TM_THEMES = path.join(APP, "node_modules", "tm-themes", "themes");

/** 与 app/src/services/extensions/grammar.ts LEGACY_SCOPES 保持一致。 */
const LEGACY_SCOPES = {
  keyword: "keyword",
  string: "string",
  comment: "comment",
  number: "constant.numeric",
  type: "entity.name.type",
  function: "entity.name.function",
  variable: "variable",
  operator: "keyword.operator",
  punctuation: "punctuation",
};

/** v2 主题包 → tm-themes 源文件（策展；tm-themes 共 65 个，可按需增补）。id 统一 theme. 前缀。 */
const TM_COLLECTION = [
  { file: "one-dark-pro.json", id: "theme.tm.one-dark-pro", name: "One Dark Pro" },
  { file: "dracula.json", id: "theme.tm.dracula", name: "Dracula" },
  { file: "nord.json", id: "theme.tm.nord", name: "Nord" },
  { file: "github-light.json", id: "theme.tm.github-light", name: "GitHub Light" },
  { file: "solarized-light.json", id: "theme.tm.solarized-light", name: "Solarized Light" },
];

function writePack(id, files) {
  const dir = path.join(PACKAGES, id);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n");
  }
  return dir;
}

// ---- 1. v1 内置主题 → v2 包（补 tokenColors）----
// id 规范（U 分类命名）：theme.gitui.dark / theme.tm.one-dark-pro / tools.gitui.git
// 旧 id → 新 id（与 app/src/services/extensions/store.ts LEGACY_ID_ALIASES 保持一致）
const LEGACY_THEME_IDS = {
  "gitui.theme.dark": "theme.gitui.dark",
  "gitui.theme.light": "theme.gitui.light",
};
function migrateLegacyTheme(dirName, manifestV1) {
  const id = LEGACY_THEME_IDS[manifestV1.id] ?? manifestV1.id;
  const themeDoc = JSON.parse(fs.readFileSync(path.join(PACKAGES, dirName, "theme", "theme.json"), "utf8"));
  const base = manifestV1.theme?.base === "light" ? "light" : "dark";
  // 由 syntax 语义键生成 tokenColors（TextMate 配色随主题包走，不再依赖主进程 legacy 兜底）
  const tokenColors = Object.entries(themeDoc.syntax ?? {})
    .filter(([key, color]) => LEGACY_SCOPES[key] && typeof color === "string" && color.startsWith("#"))
    .map(([key, color]) => ({ scope: LEGACY_SCOPES[key], settings: { foreground: color } }));
  const doc = { ...themeDoc, base, tokenColors };
  return writePack(id, {
    "manifest.json": {
      schemaVersion: 2,
      id,
      name: manifestV1.name ?? id,
      version: "2.0.0",
      description: manifestV1.description ?? null,
      contributes: { themes: [{ path: "theme/theme.json", base }] },
    },
    "theme/theme.json": doc,
  });
}

// ---- 2. tm-themes 策展主题包 ----
function generateTmThemePack(entry) {
  const src = JSON.parse(fs.readFileSync(path.join(TM_THEMES, entry.file), "utf8"));
  const base = src.type === "light" ? "light" : "dark";
  if (!Array.isArray(src.tokenColors) || src.tokenColors.length === 0) {
    throw new Error(`${entry.file} 缺少 tokenColors`);
  }
  return writePack(entry.id, {
    "manifest.json": {
      schemaVersion: 2,
      id: entry.id,
      name: entry.name,
      version: "1.0.0",
      description: `TextMate 主题（tm-themes 源：${src.name ?? entry.file}）；仅代码配色，应用界面跟随内置亮暗基座`,
      contributes: { themes: [{ path: "theme/theme.json", base }] },
    },
    // wrapper ThemeDoc：tm-themes 的 type→base，tokenColors 原样随包；tokens 留空 = UI 用内置基座
    "theme/theme.json": {
      id: entry.id,
      name: entry.name,
      base,
      inherits: null,
      tokens: {},
      tokenColors: src.tokenColors,
    },
  });
}

// ---- 2b. 安全网调试规则包（PR-1：数据包规则恒 warning，blocked 裁决权在宿主） ----
// ---- 2b. 安全网调试规则包（PR-1：数据包规则恒 warning，blocked 裁决权在宿主） ----
function generateSafetyDebugPack() {
  const manifest = {
    schemaVersion: 2,
    id: "safety.gitui.debug",
    name: "调试残留检测",
    version: "1.0.0",
    description: "检测 console.log / debugger / breakpoint 等调试残留（warning 档）",
    contributes: {
      safetyRules: [
        { id: "js-console", pattern: "\bconsole\.(?:log|debug)\s*\(\s*|\bdebugger\s*;", flags: "", message: "JS/TS 调试输出残留", fileExts: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"] },
      ],
    },
  };
  return writePack("safety.gitui.debug", {
    "manifest.json": JSON.stringify(manifest, null, 2) + "\n",
  });
}

// ---- 2c. 提交规范技能包（PR-3：skills 数据接缝） ----
function generateCommitStyleSkillPack() {
  const manifest = {
    schemaVersion: 2,
    id: "skill.gitui.commit-style",
    name: "提交规范",
    version: "1.0.0",
    description: "Conventional Commit 规范技能（Agent 循环注入系统提示）",
    contributes: {
      skills: [{
        id: "conventional",
        name: "Conventional Commit 规范",
        description: "生成提交信息时遵循 Conventional Commit 规范",
        instructions: [
          "生成提交信息时严格遵循以下规范：",
          "- 格式：type(scope): subject（type = feat|fix|docs|test|build|chore|refactor）",
          "- Subject ≤ 72 字符，祈使语气，不以句号结尾",
          "- Body（可选）与 Subject 之间空一行，每行 ≤ 72 字符",
          "- 参考仓库最近提交的风格与语言",
        ].join("\n"),
        tools: [],
      }],
    },
  };
  return writePack("skill.gitui.commit-style", {
    "manifest.json": JSON.stringify(manifest, null, 2) + "\n",
  });
}

// ---- 3. Git 维护工具 L1 命令包 ----
function generateGitToolsPack() {
  return writePack("tools.gitui.git", {
    "manifest.json": {
      schemaVersion: 2,
      id: "tools.gitui.git",
      name: "Git 维护工具",
      version: "1.0.0",
      description: "常用仓库维护命令（L1 受限命令，在当前仓库终端执行）",
      contributes: {
        commands: [
          { id: "count", title: "统计提交数量 (rev-list --count)", when: "repoOpen", action: "terminal.run", args: { command: "git rev-list --count HEAD" } },
          { id: "prune", title: "Fetch 并清理失效远程分支 (--prune)", when: "repoOpen", action: "terminal.run", args: { command: "git fetch --prune" } },
          { id: "gc", title: "Git GC（仓库瘦身，大仓库可能耗时）", when: "repoOpen", action: "terminal.run", args: { command: "git gc" } },
        ],
      },
    },
  });
}

// ---- main ----
fs.mkdirSync(PACKAGES, { recursive: true });
const generated = [];


let legacyManifests = [];
try {
  legacyManifests = fs.readdirSync(PACKAGES).filter((d) => fs.existsSync(path.join(PACKAGES, d, "theme", "theme.json")) && !/^(theme|tools)\./.test(d)).map((d) => ({
    dirName: d,
    manifest: JSON.parse(fs.readFileSync(path.join(PACKAGES, d, "manifest.json"), "utf8")),
  }));
} catch { /* 目录不存在则跳过迁移 */ }
for (const { dirName, manifest } of legacyManifests) {
  generated.push(path.basename(migrateLegacyTheme(dirName, manifest)));
}
for (const entry of TM_COLLECTION) {
  generated.push(path.basename(generateTmThemePack(entry)));
}
generated.push(path.basename(generateGitToolsPack()));
generated.push(path.basename(generateSafetyDebugPack()));
generated.push(path.basename(generateCommitStyleSkillPack()));

// 遗留 id 目录清理（历史命名 gitui.theme.* / tm.* / gitui.tools.* → 新 scheme）
const LEGACY_GENERATED_DIRS = [
  "gitui.theme.dark", "gitui.theme.light",
  "tm.one-dark-pro", "tm.dracula", "tm.nord", "tm.github-light", "tm.solarized-light",
  "gitui.tools.git",
];
for (const d of LEGACY_GENERATED_DIRS) {
  fs.rmSync(path.join(PACKAGES, d), { recursive: true, force: true });
}

console.log(`默认扩展包生成完毕（${generated.length} 个）→ app/resources/packages/`);
for (const g of generated) console.log("  -", g);
