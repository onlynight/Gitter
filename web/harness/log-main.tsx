/**
 * Log 页视觉验收 harness（dev only, 不随应用发布）：
 * stub window.GITTER_UI / window.gitter + mock RPC（log.branches / log.query /
 * log.detail / log.fileDiffFull / log.fileDiff / changes.headInfo），
 * 直接从源码装载 LogPage。验收点：右侧分割线拖拽、超长 commit body 的滚动收纳。
 */
import React from "react";
import { createRoot } from "react-dom/client";
import "../src/styles.css";
import { LogPage } from "../src/pages/LogPage";
import { setState } from "../src/state/store";
// MonacoDiffView 需要 GITTER_LIBS.monaco（log 页 manifest dependencies，loader 先注入）。
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
const HUGE_BODY = Array.from({ length: 40 }, (_, i) =>
  `第 ${i + 1} 行：log 页右半部分布局验收——超长提交说明（commit body）不设滚动上限时会把下方文件列表与 diff 全部挤出可视区。`.repeat(2),
).join("\n");

function mkCommit(i: number, body?: string) {
  const day = 1760000000 - i * 86400;
  return {
    sha: `sha${String(i).padStart(3, "0")}`,
    shortSha: `sha${String(i).padStart(3, "0")}`.slice(0, 7),
    subject: i === 0 ? "feat(diff): diff 渲染迁移 Monaco DiffEditor（超长 body 验收样本）" : `commit #${i}：示例提交主题`,
    body: body ?? "",
    author: "wyndam",
    authorEmail: "wyndam@example.com",
    authorDate: day,
    committerDate: day,
    parents: i < 29 ? [`sha${String(i + 1).padStart(3, "0")}`] : [],
    refs: i === 0 ? [{ name: "dev", isTag: false }] : [],
    assistedBy: [],
    sessionId: null,
  };
}
const COMMITS = [mkCommit(0, HUGE_BODY), ...Array.from({ length: 29 }, (_, i) => mkCommit(i + 1))];

const FILES = [
  { path: "app/src/bridge.ts", statusCode: "M", added: 80, deleted: 15 },
  { path: "web/src/styles.css", statusCode: "M", added: 7, deleted: 2 },
];
const FULL_DIFF = {
  path: "app/src/bridge.ts", isBinary: false, tooLarge: false,
  original: 'import * as a from "./a";\nconst old = 1;\n',
  modified: 'import * as a from "./a";\nimport * as b from "./b";\nconst now = 2;\n',
  hunks: [{ oldStart: 1, oldCount: 2, newStart: 1, newCount: 3 }],
};

// ---------- mock RPC ----------
function mockRpc(method: string, params?: Record<string, unknown>) {
  switch (method) {
    case "log.branches": return { current: "dev", names: ["dev", "master"] };
    case "log.query": return { commits: COMMITS.slice(Number(params?.skip ?? 0)), hasMore: false };
    case "log.detail": return { commit: COMMITS[0], files: FILES };
    case "log.fileDiffFull": return FULL_DIFF;
    case "log.fileDiff": return { path: FULL_DIFF.path, oldPath: FULL_DIFF.path, isBinary: false, isNew: false, isDeleted: false, isRenamed: false, hunks: [], addedLines: 3, deletedLines: 1, oldEndsWithNewline: true, newEndsWithNewline: true };
    case "changes.headInfo": return null;
    case "changes.state": return { workDir: "D:\\Code\\Gitter", changes: [], staged: [], unversioned: [], conflicts: [], branch: "dev", ahead: 0, behind: 0 };
    default: return {};
  }
}

// ---------- i18n（缺词回退 key id） ----------
const I18N: Record<string, string> = {
  Log_BranchFilter: "分支", Log_SearchPlaceholder: "搜索提交…", Log_SelectCommitHint: "选择提交查看详情",
  Log_NoFiles: "（无文件变更）", Log_EmptyRepo: "（空仓库）", Log_LoadMoreHint: "继续加载",
  Common_Loading: "加载中…", Log_ComparingWith: "与 {0} 对比",
};

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

createRoot(document.getElementById("root")!).render(React.createElement(LogPage));

const bar = document.createElement("div");
bar.className = "theme-switch";
for (const b of ["dark", "light"]) {
  const btn = document.createElement("button");
  btn.textContent = b;
  btn.className = "tool-btn";
  btn.onclick = () => applyTheme(b as "dark" | "light");
  bar.appendChild(btn);
}
document.body.appendChild(bar);
