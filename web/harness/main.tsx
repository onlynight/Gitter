/**
 * 任务页视觉验收 harness（开发用，不随应用分发）：
 * stub window.GITTER_UI / window.GITTER_KIT（与宿主注入面同构）+ mock RPC 数据，
 * 直接装载构建产物 gitui.page.tasks/page.js，浏览器里截图检查亮/暗两档。
 */
import React from "react";
import { createRoot } from "react-dom/client";
import "../src/styles.css";
import { DiffView, Modal, renderMarkdown, Select, PageErrorBoundary } from "../src/kit/index.ts";

// ---------- 主题（tokens 抄 app/src/services/themes.ts BUILTIN） ----------
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

// ---------- mock 数据 ----------
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const TASK_BASE = {
  harnessFullId: "builtin.codex", worktreePath: "D:/Code/Gitter/.gitter/tasks/demo", externalSessionId: null,
  exitCode: null, modelRef: "glm-4.6", taskType: null, thinking: "medium" as const, queued: [], archived: false,
};
const MOCK_TASKS = [
  { ...TASK_BASE, taskId: "t1-working", title: "任务页执行过程替换为设计稿图标并修复发送按钮", branch: "task/fix-icons", baselineSha: "f752eca", state: "working" as const, createdAt: iso(-7_200_000), lastActiveAt: iso(-20_000), lastMessage: "正在修补 ToolCard 行首图标…", permissionMode: "default" as const },
  { ...TASK_BASE, taskId: "t2-done", title: "重构 ChangesTab 文件列表虚拟滚动", branch: "task/changes-virtual", baselineSha: "69c96fb", state: "completed" as const, createdAt: iso(-86_400_000), lastActiveAt: iso(-43_200_000), lastMessage: "已合并：虚拟滚动 + 溢出根治", permissionMode: "default" as const },
  { ...TASK_BASE, taskId: "t3-perm", title: "排查 release 包白屏（extraResources）", branch: "task/fix-release", baselineSha: "2f7d660", state: "awaiting-permission" as const, createdAt: iso(-3_600_000), lastActiveAt: iso(-60_000), lastMessage: "等待授权：terminal_run", permissionMode: "plan" as const },
  { ...TASK_BASE, taskId: "t4-failed", title: "为终端页增加多标签会话恢复", branch: "task/term-tabs", baselineSha: "108c7f4", state: "failed" as const, createdAt: iso(-172_800_000), lastActiveAt: iso(-100_000_000), lastMessage: "provider 超时，3 次重试失败", permissionMode: "default" as const },
];

const RICH_HISTORY = {
  hasMore: false,
  events: [
    { ts: iso(-3_600_000), actor: "human", kind: "text", text: "任务页面执行过程换成图标，顺便修一下发送/停止按钮在两档主题下看不见的问题。" },
    { ts: iso(-3_590_000), actor: "agent", kind: "event", event: { type: "status", phase: "thinking", summary: "组装上下文…" } },
    { ts: iso(-3_580_000), actor: "agent", kind: "event", event: { type: "output", stream: "assistant", text: "我先梳理**时间线渲染**的现有实现，再按设计稿逐项替换：\n\n1. 工具卡行首图标（按工具类别区分）\n2. 思考/状态行\n3. 发送与停止按钮（改用 Accent/OnAccent 令牌）" } },
    { ts: iso(-3_500_000), actor: "agent", kind: "event", event: { type: "tool", phase: "start", callId: "c1", name: "repo_grep", args: { pattern: "ToolCard" } } },
    { ts: iso(-3_490_000), actor: "agent", kind: "event", event: { type: "tool", phase: "end", callId: "c1", name: "repo_grep", result: "web/src/pages/TasksPage.tsx:243 function ToolCard()\nweb/src/pages/TasksPage.tsx:502 render tool", durationMs: 820 } },
    { ts: iso(-3_400_000), actor: "agent", kind: "event", event: { type: "tool", phase: "start", callId: "c2", name: "terminal_run", args: { command: "npm run build" } } },
    { ts: iso(-3_390_000), actor: "agent", kind: "event", event: { type: "output", stream: "tool", text: "vite v6.0.3 building for production...\n✓ built in 6.72s" } },
    { ts: iso(-3_380_000), actor: "agent", kind: "event", event: { type: "tool", phase: "end", callId: "c2", name: "terminal_run", result: "✓ built in 6.72s", durationMs: 7120 } },
    { ts: iso(-3_300_000), actor: "agent", kind: "event", event: { type: "tool", phase: "start", callId: "c3", name: "file_patch", args: { path: "web/src/pages/TasksPage.tsx" } } },
    { ts: iso(-3_290_000), actor: "agent", kind: "event", event: { type: "tool", phase: "end", callId: "c3", name: "file_patch", isError: true, result: "patch 应用失败：上下文行不匹配（第 261 行）", durationMs: 130 } },
    { ts: iso(-3_200_000), actor: "agent", kind: "event", event: { type: "file-change", path: "web/src/pages/TasksPage.tsx", kind: "modified", summary: "+18 −7" } },
    { ts: iso(-3_100_000), actor: "agent", kind: "event", event: { type: "todo", todos: [ { content: "时间线图标替换", status: "completed" }, { content: "发送/停止按钮令牌修复", status: "in_progress" }, { content: "任务列表精简 + 分叉/归档", status: "pending" } ] } },
    { ts: iso(-3_000_000), actor: "agent", kind: "event", event: { type: "subtask", subtaskId: "s1", name: "review", mode: "review", state: "running" } },
    { ts: iso(-2_900_000), actor: "agent", kind: "event", event: { type: "checkpoint", commitSha: "31338af9c2", summary: "checkpoint: 时间线图标替换完成" } },
    { ts: iso(-2_800_000), actor: "agent", kind: "event", event: { type: "permission", requestId: "p1", toolName: "terminal_run", title: "执行命令", command: "git push origin task/fix-icons", payload: { kind: "command", risk: "high", source: "内置" }, rememberable: true } },
    { ts: iso(-2_700_000), actor: "agent", kind: "event", event: { type: "turn-completed", usage: { input: 31200, output: 4300 } } },
    { ts: iso(-2_600_000), actor: "agent", kind: "event", event: { type: "log", level: "warn", text: "模型速率限制，退避 2s 重试" } },
  ],
};

// 生成更早的历史事件（分页演示用）：每批 12 条，模拟多轮对话
function genOlderHistory(batch: number): typeof RICH_HISTORY.events {
  const events = [];
  const base = -2_600_000 - batch * 20 * 60_000;
  for (let i = 0; i < 12; i++) {
    const ts = base + i * 60_000;
    if (i % 4 === 0) events.push({ ts: iso(ts), actor: "human", kind: "text", text: `（更早）第 ${batch} 批 · ${i}：继续下一步调研` });
    else if (i % 4 === 2) events.push({ ts: iso(ts), actor: "agent", kind: "event", event: { type: "output", stream: "assistant", text: `（更早）第 ${batch} 批 · ${i}：已完成 ${i} 步分析，正在继续…` } });
    else if (i % 4 === 3) events.push({ ts: iso(ts), actor: "agent", kind: "event", event: { type: "tool", phase: "end", callId: `old-${batch}-${i}`, name: "repo_grep", result: `found ${i}`, durationMs: 100 } });
  }
  return events;
}

// 全量历史：更早批次在前，最新批次在后
const ALL_HISTORY: typeof RICH_HISTORY.events = [
  ...genOlderHistory(10),
  ...genOlderHistory(9),
  ...genOlderHistory(8),
  ...genOlderHistory(7),
  ...genOlderHistory(6),
  ...genOlderHistory(5),
  ...genOlderHistory(4),
  ...genOlderHistory(3),
  ...genOlderHistory(2),
  ...genOlderHistory(1),
  ...RICH_HISTORY.events,
];

function mockRpc(method: string, params?: Record<string, unknown>): unknown {
  if (method === "agent.task.history") {
    // 分页：limit 条 + hasMore 指示；before 之前的数据返回同一段（harness 演示用）
    const all = ALL_HISTORY;
    const limit = (params?.limit as number) ?? 100;
    const before = params?.before as string | undefined;
    if (!before) {
      return { events: all.slice(-limit), hasMore: all.length > limit };
    }
    const idx = all.findIndex((e) => e.ts === before);
    if (idx <= 0) return { events: [], hasMore: false };
    const slice = all.slice(Math.max(0, idx - limit), idx);
    return { events: slice, hasMore: slice.length > 0 && idx - limit > 0 };
  }
  switch (method) {
    case "tasks.list": return [];
    case "agents.list": return [{ id: "builtin.codex", name: "Codex", detect: { available: true } }];
    case "agent.tasks": return MOCK_TASKS;
    case "agent.taskTypes.list": return [];
    case "models.list": return [
      { id: "glm-4.6", name: "GLM-4.6", configured: true, isDefault: true, capabilities: { vision: true } },
      { id: "gpt-5", name: "GPT-5", configured: true, isDefault: false, capabilities: { vision: false } },
    ];
    case "commands.list": return [];
    case "settings.get": return { agentsMaxSubagents: 3 };
    case "agent.task.history": return RICH_HISTORY;
    case "agent.context.stats": return { estTokens: 48_300, contextWindow: 200_000, budget: 180_000, ratio: 0.24, breakdown: { system: 2_100, messages: 44_200, reserved: 2_000 }, compactions: 1, totalInput: 152_340, totalOutput: 32_880, lastOutput: 2_412, tokPerSec: 41, cacheHitRate: 0.67 };
    case "agent.task.checkpoints": return [];
    case "agent.task.files": return [];
    case "repo.files": return [
      "web/src/pages/TasksPage.tsx", "web/src/styles.css", "web/harness/main.tsx",
      "app/main.ts", "app/preload.ts", "package.json",
    ].filter((f) => !params.query || f.toLowerCase().includes(String(params.query).toLowerCase()));
    default: return {};
  }
}

const I18N: Record<string, string> = {
  Common_NoProjectSelected: "未选择项目",
  Agents_EmptyHint: "暂无任务——上方输入目标即可创建",
  Agents_TimelineEmpty: "暂无消息",
  Agents_ModelMissing: "未检测到可用模型",
  Agents_OpenSettings: "打开设置",
  Agents_ComposePlaceholder: "描述你的目标…",
  Agents_TargetHint: "任务在独立 worktree 分支执行",
  Agents_TaskType: "任务类型", Agents_TaskTypeFree: "自由任务",
  Agents_Model: "模型", Agents_ModelDefault: "默认模型",
  Agents_Thinking: "思考深度",
  Agents_ThinkingHigh: "思考·高", Agents_ThinkingMedium: "思考·中", Agents_ThinkingLow: "思考·低", Agents_ThinkingOff: "思考·关",
};

// ---------- GITTER_KIT / GITTER_UI stub ----------
// 调试用错误边界：直接吐 stack，比生产 PageErrorBoundary 好定位
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
  DiffView, Modal, renderMarkdown, Select, PageErrorBoundary: DebugBoundary,
};

const renderers: { blockKind: string; render: (p: unknown) => unknown }[] = [];
// 事件订阅注册表：window.__emit(method, payload) 可模拟宿主广播（实时更新验证）
const listeners: Record<string, ((p: unknown) => void)[]> = {};
(window as any).__emit = (method: string, payload?: unknown) => {
  for (const cb of listeners[method] ?? []) cb(payload);
};
(window as any).__setTasks = (patcher: (tasks: unknown[]) => void) => {
  patcher(MOCK_TASKS);
  (window as any).__emit("agent.tasks.changed", {});
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
  navigate: () => {}, openSettings: () => {}, toast: () => {}, refresh: () => {}, notifyRepoChanged: () => {},
  repo: () => "D:\\Code\\Gitter", settings: () => ({}), theme: () => null,
  openRepo: () => {}, closeRepo: () => {}, updateSettings: () => {}, applySettings: () => {},
  reloadTheme: () => {}, clearSettingsFocus: () => {},
  context: () => ({}), setContext: () => {}, focusTask: () => {}, clearTaskFocus: () => {},
  runCommand: () => {}, extTree: () => ({ pages: [], agentUIReg: [] }),
  subscribeState: (cb: () => void) => { const s = (window as any).__stateSubs ??= new Set<() => void>(); s.add(cb); return () => s.delete(cb); },
  getState: () => (window as any).__state ??= { repo: "D:\\Code\\Gitter", refreshTick: 0, focusTaskId: null },
  registerPage: (_meta: unknown, mount: (c: HTMLElement) => () => void) => { (window as any).__mountPage = mount; },
  registerAgentUI: (reg: { timelineRenderers?: typeof renderers }) => { for (const r of reg.timelineRenderers ?? []) renderers.push(r); },
  resolveTimelineRenderer: (_tool: string | undefined, blockKind: string) => renderers.find((r) => r.blockKind === blockKind) ?? null,
  composerProviders: () => [{
    prefix: "@", label: "文件",
    source: async (query: string) => {
      const files = await Promise.resolve(mockRpc("repo.files", { query })) as string[];
      return files.map((f) => ({ label: f, insert: f }));
    },
  }],
  onAgentUIChanged: () => () => {},
  agentUIVersion: () => 0,
};

applyTheme("dark");

// ---------- 装载页面产物 ----------
await import("../../app/resources/packages/gitui.page.tasks/page.js");

const mount = (window as any).__mountPage as (c: HTMLElement) => () => void;
const container = document.getElementById("root")!;
mount(container);

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
