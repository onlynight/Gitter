/**
 * 任务详情「改动」tab 视觉验收 harness（dev only）：
 * stub + mock（agent.task.files / diffFull / diffText / diff / restore），
 * 直接从源码装载 ChangesTab。验收点：monaco diff 在「自适应滚动列」里的高度
 * 收纳（网格行 minmax(0,1fr) + flex 列 + wrapper）与折叠/着色。
 */
import React from "react";
import { createRoot } from "react-dom/client";
import "../src/styles.css";
import { ChangesTab } from "../src/pages/TaskDetailPages";
import { setState } from "../src/state/store";
// MonacoDiffView 需要 GITTER_LIBS.monaco（log/detail 页 manifest dependencies，loader 先注入）。
// harness 同构装载：?raw 取产物原文 → Blob URL 经典脚本执行（import 产物本体会让 vite
// 对 11.9MB 做 transform，既慢又会踩 babel 解析边缘）
const monacoSrc: string = (await import("../../app/resources/packages/gitui.lib.monaco/monaco.js?raw")).default;
{
  const url = URL.createObjectURL(new Blob([monacoSrc], { type: "text/javascript" }));
  await new Promise<void>((ok, bad) => {
    const el = document.createElement("script");
    el.src = url;
    el.onload = () => ok();
    el.onerror = () => bad(new Error("monaco 库装载失败"));
    document.head.appendChild(el);
  });
}

// ---------- theme（tokens 抄自 themes.ts BUILTIN） ----------
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
function applyTheme(base: "dark" | "light") {
  const root = document.documentElement;
  for (const [name, cssVar] of Object.entries(TOKEN_VARS)) {
    root.style.setProperty(cssVar, PALETTES[base][name]);
  }
  root.style.setProperty("color-scheme", base);
  document.body.style.background = base === "light" ? "#F5F5F6" : "#17181D";
}

// ---------- mock 数据 ----------
// 大 diff：original 200 行，modified = 前 40 行改写 + 460 行新增 + 余下原行
const ORIGINAL = Array.from({ length: 200 }, (_, i) => `original line ${i + 1} — const value${i} = ${i} * 2;`).join("\n");
const MODIFIED = [
  ...Array.from({ length: 40 }, (_, i) => `modified line ${i + 1} — const changed${i} = ${i} * 3; // 改写块`),
  ...Array.from({ length: 460 }, (_, i) => `appended line ${i + 1} — export const generated${i} = ${i}; // 新增块`),
  ...Array.from({ length: 160 }, (_, i) => `original line ${i + 41} — const value${i + 40} = ${i + 40} * 2;`),
].join("\n");

const FULL = {
  path: "app/resources/packages/gitui.page.changes/page.js",
  isBinary: false,
  tooLarge: false,
  original: ORIGINAL,
  modified: MODIFIED,
  hunks: [{ oldStart: 1, oldCount: 200, newStart: 1, newCount: 660 }],
};

// ---------- mock RPC ----------
function mockRpc(method: string) {
  switch (method) {
    case "agent.task.files":
      return [{ path: FULL.path, kind: "modified", added: 482, deleted: 35 }];
    case "agent.task.diffFull":
      return FULL;
    case "agent.task.diffText":
      return "--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n-old\n+new\n";
    case "agent.task.diff":
      return [{ path: FULL.path, oldPath: FULL.path, isBinary: false, isNew: false, isDeleted: false, isRenamed: false, hunks: [], addedLines: 482, deletedLines: 35, oldEndsWithNewline: true, newEndsWithNewline: true }];
    case "agent.task.restore":
      return {};
    default:
      return {};
  }
}

// ---------- i18n（缺词回退 key id） ----------
const I18N: Record<string, string> = { Common_Loading: "加载中…" };

// ---------- GITTER_UI / gitter stub（与 changes-main 同构） ----------
(window as any).GITTER_UI = {
  getActiveCaller: () => null,
  call: (method: string, params?: Record<string, unknown>) => Promise.resolve(mockRpc(method, params)),
  callWith: (_boot: unknown, method: string, params?: Record<string, unknown>) => Promise.resolve(mockRpc(method, params)),
  on: (_method: string, _cb: (p: unknown) => void) => () => {},
  t: (key: string, ...args: unknown[]) => {
    let s = I18N[key] ?? key;
    args.forEach((a, i) => { s = s.replace(`{${i}}`, String(a)); });
    return s;
  },
  navigate: () => {}, openSettings: () => {}, toast: () => {}, refresh: () => {}, notifyRepoChanged: () => {},
  repo: () => "D:\\Code\\Gitter", settings: () => ({ diffMode: "sideBySide" }), theme: () => null,
  openRepo: () => {}, closeRepo: () => {}, updateSettings: () => {}, applySettings: () => {},
  reloadTheme: () => {}, clearSettingsFocus: () => {},
  context: () => ({}), setContext: () => {}, focusTask: () => {}, clearTaskFocus: () => {},
  runCommand: () => {}, extTree: () => ({ pages: [], agentUIReg: [] }),
};
setState({
  booted: true,
  repo: { workDir: "D:\\Code\\Gitter", name: "Gitter" },
  i18n: { lang: "zh-Hans", strings: I18N },
  settings: { diffMode: "sideBySide" } as never,
  theme: {
    base: "light", activeId: "harness-builtin", material: "none", themeId: "light",
    tokens: {}, diff: {}, terminal: {},
    syntax: {
      keyword: "#569CD6", string: "#6A9955", comment: "#6A9955", number: "#B5CEA8",
      type: "#4EC9B0", function: "#DCDCAA", variable: "#9CDCFE", operator: "#D4D4D4", punctuation: "#D4D4D4",
    },
  },
});
(window as any).gitter = {
  invoke: async (method: string, params?: unknown) => ({ ok: true, data: mockRpc(method, params as Record<string, unknown>) }),
  onEvent: () => () => {},
  winAction: () => {},
  isMaximized: async () => false,
};

applyTheme("light");
(window as any).__errs = [] as string[];
window.addEventListener("error", (e) => { (window as any).__errs.push(String(e.error?.stack ?? e.message)); });
window.addEventListener("unhandledrejection", (e) => { (window as any).__errs.push(String((e.reason as Error)?.stack ?? e.reason)); });

createRoot(document.getElementById("root")!).render(
  React.createElement(
    "div",
    { style: { height: "100%", display: "flex", flexDirection: "column" } },
    React.createElement(ChangesTab, {
      taskId: "task-1",
      worktreePath: "D:\\Code\\Gitter",
      baselineSha: "sha-base000000",
      initialFile: FULL.path,
      branch: "dev",
      tick: 0,
      onReloadAgents: async () => {},
      setError: () => {},
      onCount: () => {},
    }),
  ),
);
