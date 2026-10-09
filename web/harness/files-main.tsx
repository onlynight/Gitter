/**
 * Files 页视觉验收 harness（dev only, 不随应用发布）：
 * stub window.GITTER_UI / window.GITTER_KIT（与宿主注入面同构）+ mock RPC
 * （repo.tree / file.content / file.write / shell.*），装载构建产物
 * gitui.page.files/page.js（Monaco 已整包内联，无需额外 stub）。
 *
 * 关键 gap 补齐（旧 P2 计划 5.2）：notifyRepoChanged 实现为 repoChangedTick 递增
 * + 快照整体替换 + 订阅者通知（React #185 稳定性约束），让树刷新链路在 harness 可测。
 * Monaco 主题从 theme() 的 syntax 表映射（与宿主 DiffView 同源），亮暗切换经
 * __applyTheme / 底部按钮验证 defineTheme 重应用。
 */
import React from "react";
import { createRoot } from "react-dom/client";
import "../src/styles.css";
import * as KIT from "../src/kit/index.ts";

// ---------- theme（tokens 抄自 harness/main.tsx） ----------
const TOKEN_VARS: Record<string, string> = {
  Base: "--c-base", Panel: "--c-panel", Panel2: "--c-panel2", Hover: "--c-hover", Selected: "--c-selected",
  Border: "--c-border", BorderStrong: "--c-border-strong", Accent: "--c-accent",
  AccentHover: "--c-accent-hover", AccentPressed: "--c-accent-pressed", AccentSoft: "--c-accent-soft",
  OnAccent: "--c-on-accent", Text: "--c-text", Text2: "--c-text2", Text3: "--c-text3", Link: "--c-link",
  Green: "--c-green", Red: "--c-red", Amber: "--c-amber",
};
const PALETTES: Record<string, Record<string, string>> = {
  dark: {
    Base: "#14161B99", Panel: "#FFFFFF0A", Panel2: "#FFFFFF12", Hover: "#FFFFFF14", Selected: "#FFFFFF2B",
    Border: "#FFFFFF21", BorderStrong: "#FFFFFF40", Accent: "#EAEAEA", AccentHover: "#FFFFFF",
    AccentPressed: "#C9C9C9", AccentSoft: "#EAEAEA1F", OnAccent: "#14161B",
    Text: "#EAEAEA", Text2: "#A8B0BC", Text3: "#78828E", Link: "#6BABF5",
    Green: "#3FB950", Red: "#F0655A", Amber: "#E3B341",
  },
  light: {
    Base: "#FFFFFF8C", Panel: "#F7F7F814", Panel2: "#EFEFF11F", Hover: "#EBEBEC40", Selected: "#E0E1E359",
    Border: "#E5E5E580", BorderStrong: "#D0D0D0B3", Accent: "#1B1B1B", AccentHover: "#000000",
    AccentPressed: "#3A3A3A", AccentSoft: "#1B1B1B14", OnAccent: "#FFFFFF",
    Text: "#1B1B1B", Text2: "#5C5C5C", Text3: "#8F8F8F", Link: "#0B6BCB",
    Green: "#1A7F37", Red: "#CF222E", Amber: "#BF8700",
  },
};
/** syntax 表（themes.ts BUILTIN_SYNTAX 同形，Monaco 主题映射的映射源）。 */
const SYNTAX: Record<string, string> = {
  keyword: "#C792EA", string: "#C3E88D", comment: "#5C6773", number: "#F78C6C",
  type: "#FFCB6B", function: "#82AAFF", variable: "#EEFFFF", operator: "#89DDFF", punctuation: "#A6ACCD",
};
const TOKENS: Record<string, string> = { Base: "#14161B99", Text: "#EAEAEA", Text2: "#A8B0BC", Text3: "#78828E", Accent: "#6BABF5" };

let themeBase: "dark" | "light" = "dark";
function currentTheme() {
  return {
    base: themeBase,
    tokens: themeBase === "dark" ? TOKENS : { Base: "#FFFFFF", Text: "#1B1B1B", Text2: "#5C5C5C", Text3: "#8F8F8F", Accent: "#0B6BCB" },
    syntax: SYNTAX,
  };
}
function applyTheme(base: "dark" | "light") {
  themeBase = base;
  const root = document.documentElement;
  for (const [name, cssVar] of Object.entries(TOKEN_VARS)) {
    const v = PALETTES[base][name];
    if (v) root.style.setProperty(cssVar, v);
  }
  root.dataset.base = base;
  root.style.background = base === "dark" ? "#14161B" : "#f2f2f3";
  // 主题状态整体替换 + 订阅者通知 → FilesMonacoEditor 的 useAppState().theme 重应用 defineTheme
  replaceState({ theme: currentTheme() });
}
(window as any).__applyTheme = applyTheme;

// ---------- mock 数据 ----------
const FILES: Record<string, string> = {
  "src/app.ts": 'import { boot } from "./boot";\n\n// 应用入口\nexport function main(): void {\n  boot({ debug: true, name: "demo" });\n}\n\nconst answer: number = 42;\n',
  "src/boot.ts": 'export function boot(opts: { debug: boolean; name?: string }): void {\n  if (opts.debug) console.log("boot", opts.name ?? "");\n}\n',
  "README.md": "# demo\n\n示例仓库，用于 files 页视觉验收。\n",
  "package.json": '{\n  "name": "demo",\n  "version": "0.1.0"\n}\n',
};
const MTIMES = new Map<string, number>(Object.keys(FILES).map((p) => [p, 1728460000000 + p.length * 37]));
const TREE_ENTRIES = [
  { path: "src", isDir: true, status: null, touchedByAgent: false },
  { path: "src/mod0", isDir: true, status: null, touchedByAgent: false },
  { path: "src/mod1", isDir: true, status: null, touchedByAgent: false },
  { path: "src/mod10", isDir: true, status: null, touchedByAgent: false },
  { path: "src/mod11", isDir: true, status: null, touchedByAgent: false },
  { path: "src/mod2", isDir: true, status: null, touchedByAgent: false },
  { path: "src/mod3", isDir: true, status: null, touchedByAgent: false },
  { path: "src/mod4", isDir: true, status: null, touchedByAgent: false },
  { path: "src/mod5", isDir: true, status: null, touchedByAgent: false },
  { path: "src/mod6", isDir: true, status: null, touchedByAgent: false },
  { path: "src/mod7", isDir: true, status: null, touchedByAgent: false },
  { path: "src/mod8", isDir: true, status: null, touchedByAgent: false },
  { path: "src/mod9", isDir: true, status: null, touchedByAgent: false },
  { path: "src/app.ts", isDir: false, status: "M", touchedByAgent: true },
  { path: "src/boot.ts", isDir: false, status: "M", touchedByAgent: false },
  { path: "src/mod0/file0.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod1/file1.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod2/file2.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod3/file3.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod4/file4.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod5/file5.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod6/file6.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod7/file7.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod8/file8.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod9/file9.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod10/file10.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod11/file11.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod0/file12.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod1/file13.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod2/file14.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod3/file15.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod4/file16.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod5/file17.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod6/file18.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod7/file19.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod8/file20.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod9/file21.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod10/file22.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod11/file23.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod0/file24.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod1/file25.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod2/file26.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod3/file27.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod4/file28.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod5/file29.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod6/file30.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod7/file31.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod8/file32.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod9/file33.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod10/file34.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod11/file35.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod0/file36.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod1/file37.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod2/file38.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod3/file39.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod4/file40.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod5/file41.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod6/file42.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod7/file43.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod8/file44.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod9/file45.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod10/file46.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod11/file47.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod0/file48.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod1/file49.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod2/file50.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod3/file51.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod4/file52.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod5/file53.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod6/file54.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod7/file55.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod8/file56.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod9/file57.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod10/file58.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod11/file59.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod0/file60.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod1/file61.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod2/file62.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod3/file63.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod4/file64.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod5/file65.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod6/file66.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod7/file67.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod8/file68.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod9/file69.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod10/file70.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod11/file71.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod0/file72.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod1/file73.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod2/file74.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod3/file75.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod4/file76.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod5/file77.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod6/file78.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod7/file79.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod8/file80.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod9/file81.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod10/file82.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod11/file83.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod0/file84.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod1/file85.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod2/file86.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod3/file87.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod4/file88.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod5/file89.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod6/file90.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod7/file91.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod8/file92.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod9/file93.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod10/file94.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod11/file95.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod0/file96.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod1/file97.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod2/file98.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod3/file99.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod4/file100.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod5/file101.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod6/file102.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod7/file103.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod8/file104.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod9/file105.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod10/file106.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod11/file107.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod0/file108.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod1/file109.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod2/file110.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod3/file111.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod4/file112.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod5/file113.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod6/file114.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod7/file115.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod8/file116.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod9/file117.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod10/file118.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod11/file119.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod0/file120.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod1/file121.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod2/file122.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod3/file123.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod4/file124.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod5/file125.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod6/file126.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod7/file127.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod8/file128.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod9/file129.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod10/file130.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod11/file131.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod0/file132.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod1/file133.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod2/file134.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod3/file135.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod4/file136.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod5/file137.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod6/file138.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod7/file139.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod8/file140.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod9/file141.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod10/file142.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod11/file143.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod0/file144.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod1/file145.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod2/file146.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod3/file147.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod4/file148.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod5/file149.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod6/file150.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod7/file151.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod8/file152.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod9/file153.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod10/file154.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod11/file155.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod0/file156.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod1/file157.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod2/file158.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod3/file159.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod4/file160.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod5/file161.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod6/file162.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod7/file163.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod8/file164.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod9/file165.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod10/file166.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod11/file167.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod0/file168.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod1/file169.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod2/file170.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod3/file171.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod4/file172.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod5/file173.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod6/file174.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod7/file175.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod8/file176.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod9/file177.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod10/file178.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "src/mod11/file179.ts", isDir: false, status: null, touchedByAgent: false },
  { path: "README.md", isDir: false, status: "A", touchedByAgent: false },
  { path: "package.json", isDir: false, status: "?", touchedByAgent: false },
];
const SETTINGS: Record<string, unknown> = { editorAutoSave: true, language: "zh-Hans" };

let lastWritten: { path: string; content: string } | null = null;

function mockRpc(method: string, params?: Record<string, unknown>): unknown {
  switch (method) {
    case "repo.tree":
      return { entries: TREE_ENTRIES, hasMore: false };
    case "file.content": {
      const p = String(params?.path ?? "");
      const content = FILES[p];
      if (content === undefined) return null;
      return { content, encoding: "utf8", eol: "lf", size: content.length, mtime: MTIMES.get(p) ?? 0, binary: false, truncated: false, revision: "worktree" };
    }
    case "file.write": {
      const p = String(params?.path ?? "");
      const content = String(params?.content ?? "");
      FILES[p] = content;
      MTIMES.set(p, (MTIMES.get(p) ?? 0) + 1);
      lastWritten = { path: p, content };
      (window as any).__lastWrite = lastWritten; // 截图/断言钩子
      return { ok: true, size: content.length, mtime: MTIMES.get(p) ?? 0 };
    }
    case "settings.get":
      return SETTINGS;
    case "lsp.status":
      return [];
    case "shell.openPath":
    case "shell.reveal":
      (window as any).__lastShellCall = method;
      return {};
    default:
      return {};
  }
}

const I18N: Record<string, string> = {
  Nav_Files: "文件",
  Files_Title: "项目文件",
  Files_Empty: "无文件——请先打开一个仓库",
  Files_SearchPlaceholder: "搜索文件…",
  Files_FilterGit: "按 git 状态",
  Files_FilterAgent: "按 agent 回合",
  Files_FilterAll: "全部文件",
  Files_TreeHint: "点击文件开始编辑",
  Files_OpenInEditor: "在外部编辑器打开",
  Files_RevealInExplorer: "在文件管理器中显示",
  Files_ShowDiff: "查看差异",
  Files_ModeChanges: "变更",
  Files_ModeAgent: "回合",
  Files_ModeAll: "全部",
  Files_FilterToggle: "筛选",
  Files_FilterMatches: "{0} 个匹配",
  Files_Refresh: "刷新",
  Files_CollapseAll: "全部折叠",
  Files_QuickOpen: "转到文件…",
  Files_TreeOpen: "打开",
  Files_CopyPath: "复制路径",
  Files_CopyRelPath: "复制相对路径",
  Files_AgentTouched: "本回合 agent 改动",
  Files_NoMatch: "无匹配文件",
  Files_Missing: "文件不存在或无法读取",
  Files_StatusTitle: "Git 状态",
  Files_GutterHint: "拖拽调整宽度（双击复位）",
  Editor_Saving: "保存中…",
  Editor_Saved: "已保存",
  Editor_SaveFailed: "保存失败",
  Editor_ErrorBinary: "无法编辑二进制文件",
  Editor_ErrorConflict: "文件被外部修改，重新加载还是覆盖？",
  Editor_Reload: "重新加载",
  Editor_Overwrite: "覆盖",
  Editor_Unsaved: "有未保存的更改",
  Editor_UnsavedTitle: "未保存的更改",
  Editor_UnsavedBody: "是否要在关闭前保存对「{0}」的更改？",
  Editor_DontSave: "不保存",
  Editor_Save: "保存",
  Editor_ConflictTitle: "检测到文件冲突",
  Editor_ConflictBody: "「{0}」在磁盘上已被外部修改。覆盖保存将丢失磁盘上的最新内容。",
  Editor_ErrorTruncated: "文件过大，仅显示部分内容",
  Editor_Problems: "{0} 错误 {1} 警告",
  Editor_ProblemsTitle: "问题",
  Editor_Indent: "缩进",
  Editor_Spaces: "空格: {0}",
  Editor_Split: "分屏编辑",
  Editor_WelcomeTitle: "开始",
  Editor_WelcomeOpen: "打开文件",
  Editor_WelcomeTree: "文件树",
  Editor_WelcomeChanges: "查看 Git 变更",
  Editor_WelcomeExternal: "在外部编辑器中打开项目",
  Editor_TabClose: "关闭标签",
  Editor_TabCloseOthers: "关闭其他",
  Editor_TabCloseRight: "关闭右侧标签",
  Editor_TabCloseAll: "关闭所有",
  Editor_KeptDirty: "{0} 个未保存标签已保留",
  Common_Cancel: "取消",
  Common_Close: "关闭",
  Common_Choose: "选择",
  Common_More: "更多操作…",
};

const listeners: Record<string, ((p: unknown) => void)[]> = {};
(window as any).__emit = (method: string, payload?: unknown) => {
  for (const cb of listeners[method] ?? []) cb(payload);
};

// Debug error boundary（栈直接可见）
class DebugBoundary extends React.Component<{ children?: React.ReactNode }, { err: Error | null }> {
  state: { err: Error | null } = { err: null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  render() {
    if (this.state.err) {
      return React.createElement("pre", { style: { color: "#f0655a", whiteSpace: "pre-wrap", padding: 20, fontSize: 12 } }, String((this.state.err as Error).stack ?? this.state.err));
    }
    return this.props.children;
  }
}

(window as any).GITTER_KIT = {
  React,
  ReactDOM: (await import("react-dom")),
  ReactDOMClient: (await import("react-dom/client")),
  ReactJSXRuntime: (await import("react/jsx-runtime")),
  ...KIT,
  PageErrorBoundary: DebugBoundary,
};

// ---------- 状态快照（repoChangedTick 递增 + 整快照替换——React #185 稳定性） ----------
let state: Record<string, unknown> = {
  repo: { workDir: "D:/demo-project", name: "demo-project" },
  settings: SETTINGS,
  theme: currentTheme(),
  repoChangedTick: 0,
  refreshTick: 0,
  focusTaskId: null,
  i18n: { lang: "zh-Hans", strings: {} },
};
const stateSubs = new Set<() => void>();
function replaceState(patch: Record<string, unknown>) {
  state = { ...state, ...patch }; // 整快照替换，原地改属性不触发 useSyncExternalStore
  for (const cb of stateSubs) cb();
}

(window as any).GITTER_UI = {
  getActiveCaller: () => null,
  pageDocs: () => null,
  call: (method: string, params?: Record<string, unknown>) => Promise.resolve(mockRpc(method, params)),
  callWith: (_boot: unknown, method: string, params?: Record<string, unknown>) => Promise.resolve(mockRpc(method, params)),
  on: (method: string, cb: (p: unknown) => void) => {
    (listeners[method] ??= []).push(cb);
    return () => { const a = listeners[method] ?? []; const i = a.indexOf(cb); if (i >= 0) a.splice(i, 1); };
  },
  t: (key: string, ...args: unknown[]) => {
    let s = I18N[key] ?? key;
    args.forEach((a, i) => { s = s.replace(`{${i}}`, String(a)); });
    return s;
  },
  navigate: () => {}, openSettings: () => {},
  toast: (title: string, body?: string) => { (window as any).__lastToast = { title, body }; console.info("[harness] toast:", title, body); },
  refresh: () => {},
  // 树刷新链路：repoChangedTick 递增（快照替换），FilesPage 消费
  notifyRepoChanged: () => replaceState({ repoChangedTick: (state.repoChangedTick as number) + 1 }),
  repo: () => state.repo,
  settings: () => SETTINGS,
  theme: () => currentTheme(),
  openRepo: () => {}, closeRepo: () => {},
  updateSettings: (patch: Record<string, unknown>) => { Object.assign(SETTINGS, patch); return Promise.resolve(SETTINGS); },
  applySettings: () => {}, reloadTheme: () => {}, clearSettingsFocus: () => {},
  context: () => ({ selectedFile: null, selectedCommitSha: null }), setContext: () => {},
  focusTask: () => {}, clearTaskFocus: () => {},
  runCommand: () => {}, extTree: () => ({ pages: [], agentUIReg: [] }),
  registerDoc: () => () => {}, unregisterDoc: () => {},
  docs: () => [], docTitle: (d: { title: unknown }) => d.title, onDocsChanged: () => () => {}, docsVersion: () => 0,
  subscribeState: (cb: () => void) => {
    stateSubs.add(cb);
    return () => stateSubs.delete(cb);
  },
  getState: () => state, // 引用稳定：仅在 replaceState 时整体换新
  registerPage: (_meta: unknown, mount: (c: HTMLElement) => () => void) => { (window as any).__mountPage = mount; },
  registerAgentUI: () => {},
  resolveTimelineRenderer: () => null,
  composerProviders: () => [],
  onAgentUIChanged: () => () => {},
  agentUIVersion: () => 0,
};

applyTheme("dark");

// ---------- 装载构建产物并挂载 ----------
await import("../../app/resources/packages/gitui.page.files/page.js");

const mount = (window as any).__mountPage as (c: HTMLElement) => () => void;
const container = document.getElementById("root")!;
mount(container);

// 自动打开一个文件（截图/交互验证直接可见编辑器：Monaco + 状态栏 + 脏标记链路）
setTimeout(() => {
  const rows = [...container.querySelectorAll("div")].filter((d) => d.textContent === "app.ts" && d.children.length === 0);
  const target = rows.find((d) => (d.parentElement?.textContent ?? "").includes("app.ts")) ?? rows[0];
  target?.click();
}, 400);

// 亮暗切换按钮（Monaco defineTheme 重应用验证）
const switcher = document.createElement("div");
switcher.className = "theme-switch";
switcher.innerHTML = `<button onclick="(window.__applyTheme)('dark')">暗</button><button onclick="(window.__applyTheme)('light')">亮</button>`;
document.body.appendChild(switcher);
