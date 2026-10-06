import { useSyncExternalStore } from "react";
import type { UIPageDef } from "../uiRegistry";
import { call } from "../bridge/client";
import type { SettingsDTO, ThemeStateDTO, I18nDTO } from "../bridge/types";

// 轻量全局 store（不引状态库）：emit + useSyncExternalStore。

export type PageKey = string; // 页面 id = 注册表键（内置 7 页 + 外部页 ext.<pkg>.<id>，ui-pluginization-plan.md U1a）

export interface AppState {
  booted: boolean;
  page: PageKey;
  repo: { workDir: string; name: string } | null;
  settings: SettingsDTO | null;
  theme: ThemeStateDTO | null;
  i18n: I18nDTO | null;
  maximized: boolean;
  /** 命令面板 → 页面命令路由（页面挂载时消费） */
  routedCommand: { id: string; ts: number } | null;
  /** F5 / 外部刷新信号 */
  refreshTick: number;
  /** 设置页定位（如 "git"：从错误横幅跳转后滚动到对应区块） */
  settingsFocus: string | null;
  /** L1 命令首跑确认（commands.exec confirm-required 的 GUI 侧，App 渲染 Modal） */
  commandConfirm: { id: string; title: string; filePath: string | null } | null;
  /** 插件通知 toast（ctx.ui.notify → ui.notify 事件） */
  toasts: { id: number; title: string; body: string }[];
  /** E 阶段面板插槽（ui.panels） */
  panels: { id: string; title: string; body: string }[];
  /** A4 Log 会话卡联动：聚焦任务卡（TasksPage 消费后清空） */
  focusTaskId: string | null;
  /** Agent 流式输出缓冲（agent.stream 事件，10s 无增量自动清空） */
  agentStreamText: string | null;
  /** U1 页面注册表快照（App/Sidebar 消费；由 uiRegistry 订阅同步） */
  pages: UIPageDef[];
  /** U1b 共享上下文（跨页联动与外部页读取；页面内仍可保局部镜像） */
  context: {
    selectedFile: { path: string; staged: boolean; isNew: boolean; isConflict: boolean } | null;
    selectedCommitSha: string | null;
  };
}

let state: AppState = {
  booted: false,
  page: "log",
  repo: null,
  settings: null,
  theme: null,
  i18n: null,
  maximized: false,
  routedCommand: null,
  refreshTick: 0,
  settingsFocus: null,
  commandConfirm: null,
  toasts: [],
  panels: [],
  focusTaskId: null,
  agentStreamText: null,
  pages: [],
  context: { selectedFile: null, selectedCommitSha: null },
};

/** 共享上下文补丁（页面向 store 镜像选中态）。 */
export function setSharedContext(patch: {
  selectedFile?: { path: string; staged: boolean; isNew: boolean; isConflict: boolean } | null;
  selectedCommitSha?: string | null;
}): void {
  setState({
    context: {
      selectedFile: patch.selectedFile !== undefined ? patch.selectedFile : getState().context.selectedFile,
      selectedCommitSha: patch.selectedCommitSha !== undefined ? patch.selectedCommitSha : getState().context.selectedCommitSha,
    },
  });
}

let streamClearTimer: ReturnType<typeof setTimeout> | null = null;

/** agent.stream 增量累积（App 监听调用），10s 无增量清空。 */
export function appendAgentStream(delta: string): void {
  const next = (getState().agentStreamText ?? "") + delta;
  setState({ agentStreamText: next });
  if (streamClearTimer) clearTimeout(streamClearTimer);
  streamClearTimer = setTimeout(() => setState({ agentStreamText: null }), 10_000);
}

let toastSeq = 0;

/** 插件通知（App 监听 ui.notify 事件调用），6s 自动消失。 */
export function pushToast(title: string, body: string): void {
  const id = ++toastSeq;
  setState({ toasts: [...getState().toasts, { id, title, body }] });
  setTimeout(() => {
    setState({ toasts: getState().toasts.filter((x) => x.id !== id) });
  }, 6000);
}

const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

export function useApp(): AppState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

export function navigate(page: PageKey) {
  if (state.page === page) return;
  setState({ page });
}

/** 跳到设置页并定位到某区块（如推送报 noUpstream → openSettings("git")）。 */
export function openSettings(section?: string) {
  setState({ page: "settings", settingsFocus: section ?? null });
}

/** F5 或手动刷新：tick 变化驱动当前页重载 */
export function refreshCurrent() {
  setState({ refreshTick: state.refreshTick + 1 });
}

export function routeCommand(id: string) {
  setState({ routedCommand: { id, ts: Date.now() }, page: pageForCommand(id) });
}

function pageForCommand(id: string): PageKey {
  if (id.startsWith("goto.")) return id.slice(5) as PageKey;
  if (id.startsWith("changes.") || id.startsWith("commit")) return "changes";
  if (id.startsWith("branches.")) return "branches";
  return state.page;
}

// ---- i18n / 主题便捷读取 ----

export function t(key: string, ...args: (string | number)[]): string {
  const dict = state.i18n?.strings;
  let s = dict?.[key] ?? key;
  args.forEach((a, i) => {
    s = s.replace(`{${i}}`, String(a));
  });
  return s;
}

const TOKEN_VARS: Record<string, string> = {
  Base: "--c-base", Panel: "--c-panel", Hover: "--c-hover", Selected: "--c-selected",
  Border: "--c-border", BorderStrong: "--c-border-strong", Accent: "--c-accent",
  AccentHover: "--c-accent-hover", AccentPressed: "--c-accent-pressed", AccentSoft: "--c-accent-soft",
  OnAccent: "--c-on-accent", Text: "--c-text", Text2: "--c-text2", Text3: "--c-text3",
  Green: "--c-green", Red: "--c-red", Amber: "--c-amber",
  ChipBlueBg: "--c-chip-blue-bg", ChipBlueFg: "--c-chip-blue-fg",
  ChipPurpleBg: "--c-chip-purple-bg", ChipPurpleFg: "--c-chip-purple-fg",
};

export function applyThemeToDom(theme: ThemeStateDTO) {
  const root = document.documentElement;
  for (const [name, cssVar] of Object.entries(TOKEN_VARS)) {
    const v = theme.tokens[name];
    if (v) root.style.setProperty(cssVar, v);
  }
  root.dataset.base = theme.base;
}

export function applyDiffModeToDom(mode: "sideBySide" | "inline") {
  document.documentElement.dataset.diff = mode === "inline" ? "inline" : "side";
}

/** 重取主题并落到 DOM（设置页/面板切换后调用）。 */
export async function reapplyTheme(settings: SettingsDTO) {
  const systemBase = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  const theme = await call<ThemeStateDTO>("themes.state", { systemBase });
  setState({ theme });
  applyThemeToDom(theme);
}

/** 重取语言字典（设置页/面板切换后调用）。 */
export async function reapplyLanguage(settings: SettingsDTO) {
  const i18n = await call<I18nDTO>("i18n.strings", {
    preference: settings.language,
    navigatorLanguage: navigator.language,
  });
  setState({ i18n });
}

/** 设置更新的唯一入口：持久化 + 回写 store + 按需重应用主题/语言/差异模式。 */
export async function updateSettings(patch: Partial<SettingsDTO>) {
  const next = await call<SettingsDTO>("settings.set", { patch });
  setState({ settings: next });
  if (patch.theme !== undefined || patch.themePackageId !== undefined) await reapplyTheme(next);
  if (patch.language !== undefined) await reapplyLanguage(next);
  if (patch.diffMode !== undefined) applyDiffModeToDom(next.diffMode);
  return next;
}
