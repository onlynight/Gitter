/**
 * 终端页视觉验收 harness（开发用，不随应用分发）：
 * stub window.GITTER_UI / window.GITTER_KIT（与宿主注入面同构）+ mock pty RPC，
 * 装载构建产物 gitui.page.bash/page.js，浏览器里验证 Git 文档面板
 * （开合/拖拽分栏/目录浮层/目录搜索/正文查找）与亮暗两档。
 */
import React from "react";
import { createRoot } from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import "../src/styles.css";
import { renderMarkdown } from "../src/kit/index.ts";

// ---------- 主题（tokens 抄 harness/main.tsx） ----------
const TOKEN_VARS: Record<string, string> = {
  Base: "--c-base", Panel: "--c-panel", Panel2: "--c-panel2", Hover: "--c-hover", Selected: "--c-selected",
  Border: "--c-border", BorderStrong: "--c-border-strong", Accent: "--c-accent",
  AccentHover: "--c-accent-hover", AccentPressed: "--c-accent-pressed", AccentSoft: "--c-accent-soft",
  OnAccent: "--c-on-accent", Text: "--c-text", Text2: "--c-text2", Text3: "--c-text3", Link: "--c-link",
  Green: "--c-green", Red: "--c-red", Amber: "--c-amber",
  ChipBlueBg: "--c-chip-blue-bg", ChipBlueFg: "--c-chip-blue-fg",
  ChipPurpleBg: "--c-chip-purple-bg", ChipPurpleFg: "--c-chip-purple-fg",
};
const PALETTES: Record<string, Record<string, string>> = {
  dark: {
    Base: "#14161B99", Panel: "#FFFFFF0A", Panel2: "#FFFFFF12", Hover: "#FFFFFF14", Selected: "#FFFFFF2B",
    Border: "#FFFFFF21", BorderStrong: "#FFFFFF40", Accent: "#EAEAEA", AccentHover: "#FFFFFF",
    AccentPressed: "#C9C9C9", AccentSoft: "#EAEAEA1F", OnAccent: "#14161B",
    Text: "#EAEAEA", Text2: "#A8B0BC", Text3: "#78828E", Link: "#6BABF5",
    Green: "#3FB950", Red: "#F0655A", Amber: "#E3B341",
    ChipBlueBg: "#25324480", ChipBlueFg: "#8DB8F5", ChipPurpleBg: "#2B244080", ChipPurpleFg: "#B9A3EC",
  },
  light: {
    Base: "#FFFFFF8C", Panel: "#F7F7F814", Panel2: "#EFEFF11F", Hover: "#EBEBEC40", Selected: "#E0E1E359",
    Border: "#E5E5E580", BorderStrong: "#D0D0D0B3", Accent: "#1B1B1B", AccentHover: "#000000",
    AccentPressed: "#3A3A3A", AccentSoft: "#1B1B1B14", OnAccent: "#FFFFFF",
    Text: "#1B1B1B", Text2: "#5C5C5C", Text3: "#8F8F8F", Link: "#0B6BCB",
    Green: "#1A7F37", Red: "#CF222E", Amber: "#BF8700",
    ChipBlueBg: "#DDF4FF66", ChipBlueFg: "#0B6BCB", ChipPurpleBg: "#FBEFFF66", ChipPurpleFg: "#8250DF",
  },
};
function applyTheme(base: "dark" | "light") {
  const root = document.documentElement;
  for (const [name, cssVar] of Object.entries(TOKEN_VARS)) {
    const v = PALETTES[base][name];
    if (v) root.style.setProperty(cssVar, v);
  }
  root.dataset.base = base;
  root.style.background = base === "dark" ? "#14161B" : "#f2f2f3";
}
(window as any).__applyTheme = applyTheme;

// ---------- mock ----------
const SETTINGS = {
  terminalShell: "powershell", terminalFollowRepo: false,
  terminalFontSize: 13, terminalFontFamily: "Cascadia Mono",
  terminalDocFraction: null as number | null,
};
const SESSIONS = new Map<string, { id: string; shellKind: string; running: boolean }>();

function mockRpc(method: string, params?: Record<string, unknown>): unknown {
  switch (method) {
    case "terminal.list":
      return [...SESSIONS.values()];
    case "terminal.ensure": {
      const id = String(params?.sessionId ?? "s1");
      const s = { id, shellKind: String(params?.shellKind ?? "powershell"), running: true };
      SESSIONS.set(id, s);
      return s;
    }
    case "terminal.write":
    case "terminal.resize":
    case "terminal.close":
      return {};
    case "settings.get":
      return SETTINGS;
    default:
      return {};
  }
}

const I18N: Record<string, string> = {
  Terminal_Restart: "重启",
  Terminal_CopyHint: "Ctrl+Shift+C 复制 · Ctrl+Shift+V 粘贴",
  Terminal_NewTab: "新建标签（{0}）",
  Terminal_NewTabProfile: "选择配置文件新建",
  Terminal_ProfileDefault: "默认",
  Terminal_Close: "关闭",
  Terminal_EmptyHint: "＋ 打开新终端",
  Terminal_DocTitle: "Git 命令手册",
  Terminal_DocClosePanel: "关闭文档面板",
  Terminal_DocToc: "目录",
  Terminal_DocTocSearch: "搜索目录标题…",
  Terminal_DocTocEmpty: "无匹配章节",
  Terminal_DocTocEmptyHint: "换个关键字试试",
  Terminal_DocSections: "共 {0} 个章节",
  Terminal_DocSectionsHit: "{0} / {1} 个章节",
  Terminal_DocFind: "搜索文档内容",
  Terminal_DocFindPlaceholder: "搜索文档内容…",
  Terminal_DocFindPrev: "上一个（Shift+Enter）",
  Terminal_DocFindNext: "下一个（Enter）",
  Terminal_DocFindClose: "关闭查找（Esc）",
  Terminal_DocResize: "拖动调整宽度 · 双击恢复默认",
};

const listeners: Record<string, ((p: unknown) => void)[]> = {};
(window as any).__emit = (method: string, payload?: unknown) => {
  for (const cb of listeners[method] ?? []) cb(payload);
};

// 调试用错误边界：直接吐 stack
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
  renderMarkdown, PageErrorBoundary: DebugBoundary,
};

(window as any).GITTER_UI = {
  getActiveCaller: () => null,
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
  navigate: () => {}, openSettings: () => {}, toast: () => {}, refresh: () => {},
  repo: () => null,
  settings: () => SETTINGS,
  theme: () => null,
  openRepo: () => {}, closeRepo: () => {},
  updateSettings: (patch: Record<string, unknown>) => {
    Object.assign(SETTINGS, patch);
    (window as any).__lastSettingsPatch = patch;
    console.info("[harness] settings.set", patch);
    return Promise.resolve(SETTINGS);
  },
  applySettings: () => {}, reloadTheme: () => {}, clearSettingsFocus: () => {},
  context: () => ({ selectedFile: null, selectedCommitSha: null }), setContext: () => {},
  focusTask: () => {}, clearTaskFocus: () => {},
  runCommand: () => {}, extTree: () => ({ pages: [], agentUIReg: [] }),
  subscribeState: (cb: () => void) => {
    const s = (window as any).__stateSubs ??= new Set<() => void>();
    s.add(cb);
    return () => s.delete(cb);
  },
  // 快照必须引用稳定：每次返回新对象会让 useSyncExternalStore 无限重渲染（React #185）
  getState: () => ((window as any).__state ??= { repo: null, refreshTick: 0, focusTaskId: null }),
  registerPage: (_meta: unknown, mount: (c: HTMLElement) => () => void) => { (window as any).__mountPage = mount; },
  registerAgentUI: () => {},
  resolveTimelineRenderer: () => null,
  composerProviders: () => [],
  onAgentUIChanged: () => () => {},
  agentUIVersion: () => 0,
};

applyTheme("dark");

// ---------- 装载页面产物 ----------
await import("../../app/resources/packages/gitui.page.bash/page.js");

const mount = (window as any).__mountPage as (c: HTMLElement) => () => void;
const container = document.getElementById("root")!;
mount(container);

// 终端假输出（等 xterm 实例建立后写入）
setTimeout(() => {
  const text = [
    "Git Bash on Windows · harness mock",
    "",
    "wyndam@win32 MINGW64 D:\\Code\\Gitter (dev)",
    "$ git status --short",
    " M app/resources/Strings.tsv",
    "",
    "$ ",
  ].join("\r\n");
  (window as any).__emit("terminal.data", { id: [...SESSIONS.keys()][0], b64: btoa(unescape(encodeURIComponent(text))) });
}, 600);

// 主题切换按钮（截图两档用）
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
