/**
 * Page SDK v1（ui-pluginization-plan.md U4）：
 * 页面可消费的唯一宿主面——内置页与外部页（window.GITTER_UI 同一契约）共用。
 * 新增页面能力 = 扩展本接口 + 同步 gen-ui-sdk.mjs 的 d.ts 面。
 */
import { call, onEvent } from "./bridge/client";
import {
  getState, navigate, openSettings, pushToast, refreshCurrent,
  setSharedContext, setState, t, useApp, type PageKey,
} from "./state/store";

export interface PageSurface {
  /** 桥 RPC（权限域见 rpcScopes.ts；宿主内置页不受外部页权限过滤） */
  call<T = unknown>(method: string, params?: unknown): Promise<T>;
  /** 订阅宿主事件（按事件名） */
  on(method: string, cb: (params: unknown) => void): () => void;
  /** i18n */
  t(key: string, ...args: (string | number)[]): string;
  /** 导航 */
  navigate(page: PageKey): void;
  /** 打开设置页并定位区块 */
  openSettings(section?: string): void;
  /** 通知 toast */
  toast(title: string, body?: string): void;
  /** 触发全局刷新（F5 语义） */
  refresh(): void;
  /** 当前仓库 */
  repo(): { workDir: string; name: string } | null;
  /** 当前设置快照 */
  settings(): import("./bridge/types").SettingsDTO | null;
  /** 共享上下文（U1b）读 */
  context(): { selectedFile: { path: string; staged: boolean; isNew: boolean; isConflict: boolean } | null; selectedCommitSha: string | null };
  /** 共享上下文（U1b）写 */
  setContext: typeof setSharedContext;
}

export function pageSurface(): PageSurface {
  return {
    call: (method, params) => call(method, params),
    on: (method, cb) => onEvent(method, cb as never),
    t,
    navigate,
    openSettings,
    toast: (title, body) => pushToast(title, body ?? ""),
    refresh: refreshCurrent,
    repo: () => getState().repo,
    settings: () => getState().settings,
    context: () => getState().context,
    setContext: setSharedContext,
  };
}

/** 单例 surface（函数内部动态读 store，无过期状态问题）。 */
export const pageSdk: PageSurface = pageSurface();

/** React 响应式面（内置页在同树，直接复用宿主 store 响应性）。 */
export { useApp as useAppState };

/** A4 会话卡联动：任务聚焦通道（Log 会话卡 → TasksPage 选中并消费）。 */
export function useTaskFocus(): [string | null, () => void] {
  const focusTaskId = useApp().focusTaskId;
  const consume = () => setState({ focusTaskId: null });
  return [focusTaskId, consume];
}
