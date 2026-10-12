/**
 * 设置页视觉验收 harness（dev only, 不随应用发布）：
 * stub window.GITTER_UI / window.gitter（与宿主注入面同构）+ mock RPC
 * （themes.list / terminal.profiles / commands.list / extensions.list…），
 * 从源码装载 SettingsPage（不经页面包产物），浏览器里截图检查亮/暗两档。
 * 词条直接解析 app/resources/Strings.tsv（?raw 导入，缺词回退 key id）。
 */
import React from "react";
import { createRoot } from "react-dom/client";
import "../src/styles.css";
import stringsTsv from "../../app/resources/Strings.tsv?raw";
import { SettingsPage } from "../src/pages/SettingsPage";
import { setState } from "../src/state/store";

// ---------- theme（tokens 抄自 themes.ts BUILTIN） ----------
const TOKEN_VARS: Record<string, string> = {
  Base: "--c-base", Panel: "--c-panel", Panel2: "--c-panel2", Hover: "--c-hover", Selected: "--c-selected",
  Border: "--c-border", BorderStrong: "--c-border-strong", Accent: "--c-accent", AccentHover: "--c-accent-hover",
  AccentPressed: "--c-accent-pressed", AccentSoft: "--c-accent-soft", OnAccent: "--c-on-accent",
  Text: "--c-text", Text2: "--c-text2", Text3: "--c-text3", Link: "--c-link",
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
    root.style.setProperty(cssVar, PALETTES[base][name]);
  }
  root.style.setProperty("color-scheme", base);
  // BUILTIN token 是带 alpha 的叠加色，真应用底下有窗体材质打底；铺一层贴近材质的不透明底
  document.body.style.background = base === "light" ? "#F5F5F6" : "#17181D";
}

// ---------- i18n：解析 Strings.tsv（key \t en \t zh-Hans），全部词条可用 ----------
function parseStringsTsv(raw: string, lang: "en" | "zh-Hans"): Record<string, string> {
  const col = lang === "zh-Hans" ? 2 : 1;
  const dict: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const cols = line.split("\t");
    if (cols.length >= 3) dict[cols[0].trim()] = cols[col];
  }
  return dict;
}
const I18N = parseStringsTsv(stringsTsv, "zh-Hans");

// ---------- mock RPC ----------
const MOCK_COMMANDS = [
  { id: "goto.projects", titleKey: "Cmd_GotoProjects", categoryKey: "Cat_Nav", keyHint: "Ctrl+1", enabled: true },
  { id: "goto.log", titleKey: "Cmd_GotoLog", categoryKey: "Cat_Nav", keyHint: "Ctrl+2", enabled: true },
  { id: "goto.changes", titleKey: "Cmd_GotoChanges", categoryKey: "Cat_Nav", keyHint: "Ctrl+3", enabled: true },
  { id: "goto.branches", titleKey: "Cmd_GotoBranches", categoryKey: "Cat_Nav", keyHint: "Ctrl+4", enabled: true },
  { id: "goto.tasks", titleKey: "Cmd_GotoTasks", categoryKey: "Cat_Nav", keyHint: "Ctrl+5", enabled: true },
  { id: "goto.bash", titleKey: "Cmd_GotoTerminal", categoryKey: "Cat_Nav", keyHint: "Ctrl+6", enabled: true },
  { id: "goto.settings", titleKey: "Cmd_GotoSettings", categoryKey: "Cat_Nav", keyHint: "Ctrl+7", enabled: true },
  { id: "repo.refresh", titleKey: "Cmd_RefreshPage", categoryKey: "Cat_Repo", keyHint: "F5", enabled: true },
  { id: "commit", titleKey: "Cmd_Commit", categoryKey: "Cat_Commit", keyHint: "Ctrl+Enter", enabled: true },
  { id: "branches.create", titleKey: "Cmd_CreateBranch", categoryKey: "Cat_Branch", keyHint: "Ctrl+Shift+N", enabled: true },
  // 包贡献命令（分类 = 包名）
  { id: "ext.gitui.tools.demo.run", title: "Demo run", category: "tools.gitui.git", keyHint: "Ctrl+Alt+D", enabled: true },
  // when 未满足 → 置灰行
  { id: "changes.stageAll", titleKey: "Cmd_StageAll", categoryKey: "Cat_Commit", keyHint: "Ctrl+Shift+A", enabled: false },
];

function mockRpc(method: string, params?: Record<string, unknown>): unknown {
  switch (method) {
    case "themes.list": return [];
    case "terminal.profiles": return [
      { id: "powershell", name: "PowerShell", source: "builtin" },
      { id: "cmd", name: "CMD", source: "builtin" },
      { id: "bash", name: "Git Bash", source: "builtin" },
    ];
    case "app.gitVersion": return "git version 2.45.0 (harness mock)";
    case "extensions.list": return [];
    case "commands.list": return MOCK_COMMANDS;
    case "gitconfig.list": return {};
    case "remote.list": return [];
    case "models.list": return [];
    case "settings.get": return MOCK_SETTINGS;
    case "settings.rememberCommand": return { ok: true };
    case "ui.views": case "ui.panels": return [];
    case "agent.seams.audit": return null;
    default: return {};
  }
}

const MOCK_SETTINGS = {
  theme: "dark", themePackageId: null, language: "zh-Hans",
  projects: [], currentProjectPath: "D:\\Code\\Gitter",
  externalEditor: null, editorAutoSave: true,
  lspTypescript: false, lspTypescriptCommand: "", lspPython: false, lspPythonCommand: "",
  diffMode: "sideBySide", sidebarCollapsed: false, bashPath: null,
  terminalFontFamily: "Consolas", terminalFontSize: 13, terminalFollowRepo: true, terminalShell: "powershell",
  watchWorktree: true, autoFetch: true, autoFetchIntervalMinutes: 5,
  recentCommands: [], aiProvider: "off", aiEndpoint: null, aiModel: null, aiCliCommand: null,
  aiPrivacy: "metadataOnly", aiAppendTrailer: true, aiApiKeyProtected: null,
  safetyNet: "warn", mcpEnabled: true, logSplitterFraction: null, changesSplitterFraction: null,
  terminalDocFraction: null, packages: {}, confirmedCommands: [],
  allowCodePlugins: true, externalMcpEnabled: false,
  agentsCheckpoint: true, agentsOnExit: "terminate", agentRules: [],
  agentsCompaction: "auto", agentsCompactionPolicy: {},
  agentsPostTurnHooks: true, agentsNotify: true, agentsMaxSubagents: 3,
  agentsExternalMcpTools: false, agentsTaskWorktree: false,
} as const;

// ---------- GITTER_UI / gitter stub（与 harness/main.tsx 同构，子集） ----------
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
  repo: () => "D:\\Code\\Gitter", settings: () => MOCK_SETTINGS, theme: () => null,
  openRepo: () => {}, closeRepo: () => {}, updateSettings: () => {}, applySettings: () => {},
  reloadTheme: () => {}, clearSettingsFocus: () => {},
  context: () => ({}), setContext: () => {}, focusTask: () => {}, clearTaskFocus: () => {},
  runCommand: () => {}, extTree: () => ({ pages: [], agentUIReg: [] }),
};
// 源码直载：宿主 store 播种（settings 非空页面才渲染；i18n.strings 供 store 内 t() 查词典）
setState({ booted: true, repo: { workDir: "D:\\Code\\Gitter", name: "Gitter" }, i18n: { lang: "zh-Hans", strings: I18N }, settings: MOCK_SETTINGS as any });
(window as any).gitter = {
  invoke: async (method: string, params?: unknown) => ({ ok: true, data: mockRpc(method, params as Record<string, unknown>) }),
  onEvent: () => () => {},
  winAction: () => {},
  isMaximized: async () => false,
};

applyTheme("light");
// 渲染期异常外显（React commit 期错误走 window 事件，累积到 __errs 便于定位）
(window as any).__errs = [] as string[];
window.addEventListener("error", (e) => { (window as any).__errs.push(String(e.error?.stack ?? e.message)); });
window.addEventListener("unhandledrejection", (e) => { (window as any).__errs.push(String((e.reason as Error)?.stack ?? e.reason)); });

createRoot(document.getElementById("root")!).render(React.createElement(SettingsPage));

// 直落快捷键分类（截图验收用）
setTimeout(() => {
  for (const btn of document.querySelectorAll<HTMLButtonElement>(".settings-cat")) {
    if (btn.textContent?.includes(I18N.Settings_CatShortcuts)) { btn.click(); break; }
  }
}, 50);

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
