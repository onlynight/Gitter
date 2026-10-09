/**
 * 宿主面实现的单一源（ui-full-pluginization-plan.md R2）：
 * PageSurface 的方法实现只有这一份——pageSdk（内置页，宿主内直连）与
 * window.GITTER_UI（外部页，经 caller 注入的 call/on）共用同一组实现，
 * 消除"内置面与外部面各自演化"的漂移。
 * 新增页面能力 = 扩展 PageSurface 接口 + 本文件实现 + gen-ui-sdk d.ts 同步。
 */
import { call, onEvent } from "./bridge/client";
import type { SettingsDTO, ThemeStateDTO } from "./bridge/types";
import {
  getState, navigate, notifyRepoChanged, onContextChanged, openSettings, pushToast, refreshCurrent,
  reapplyTheme, setSharedContext, setState, t, updateSettings, type PageKey,
} from "./state/store";
import { runCommand, type RunContext } from "./commands";
import { uiPages, uiPageProvidersFor } from "./uiRegistry";
import { agentUIRegistrations } from "./agentUIRegistry";
import {
  docTitle, docs as registryDocs, docsVersion as registryDocsVersion,
  onDocsChanged as registryOnDocsChanged, registerDoc as registryRegisterDoc,
  type DocDescriptor, type DocEntry,
} from "./docRegistry";
import { useSyncExternalStore } from "react";

/** 扩展管理树·页面节点（设置页"插件挂载树"数据面）：槽位 + 胜出提供者 + 同槽位替补。 */
export interface ExtTreeNodePage {
  slot: string;
  /** 胜出提供者注册 id（ext.<pkg>.<pid> 或内置槽位 id） */
  id: string;
  /** 内置页 = i18n 键；外部页 = 字面量（loader 已解析 %key%） */
  titleKey?: string;
  title?: string;
  /** 胜出提供者包 id（内置元数据未装载 = null） */
  packageId: string | null;
  isBuiltIn: boolean;
  source: "builtin" | "package";
  order: number;
  /** 同槽位竞争落败的提供者（"挂载到页面下"的替补包） */
  shadowed: { packageId: string; isBuiltIn: boolean }[];
}

/** 扩展管理树·agent UI 活跃注册（时间线渲染器 / 输入台 provider；消费方 = agent 时间线页）。 */
export interface ExtTreeAgentUIReg {
  packageId: string;
  tier: "host" | "builtin" | "user";
  renderers: number;
  providers: number;
}

export interface ExtTreeSnapshot {
  pages: ExtTreeNodePage[];
  agentUI: ExtTreeAgentUIReg[];
}

export interface PageSurface {
  /** 桥 RPC（权限域见 rpcScopes.ts；宿主内置页不受外部页权限过滤） */
  call<T = unknown>(method: string, params?: unknown): Promise<T>;
  /** 订阅宿主事件（按事件名；context.changed 走渲染层本地通道；回调参数以字面量类型标注） */
  on(method: string, cb: (params: never) => void): () => void;
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
  /** 仓库数据变更广播（改仓操作成功后调用）：各 git 页仅重拉数据，UI 态保留 */
  notifyRepoChanged(): void;
  /** 当前仓库 */
  repo(): { workDir: string; name: string } | null;
  /** 当前设置快照 */
  settings(): SettingsDTO | null;
  /** 当前主题状态（TerminalPage 等直读主题令牌的页面用） */
  theme(): ThemeStateDTO | null;
  /** 打开仓库（projects.open + 导航到 log + 刷新；Projects/Tasks/替换页用） */
  openRepo(path: string): Promise<void>;
  /** 关闭当前仓库（仓库被移除等场景） */
  closeRepo(): void;
  /** 设置更新（持久化 + 回写 + 主题/语言/差异模式按需重应用） */
  updateSettings(patch: Partial<SettingsDTO>): Promise<SettingsDTO>;
  /** 回写设置快照（settings.setAiKey 等专用 RPC 返回新快照后），随后可 reloadTheme */
  applySettings(s: SettingsDTO): void;
  /** 重取主题并落到 DOM（基于当前 store 设置） */
  reloadTheme(): Promise<void>;
  /** 清空设置页定位信号（SettingsPage 消费 settingsFocus 后） */
  clearSettingsFocus(): void;
  /** 共享上下文（U1b）读 */
  context(): { selectedFile: { path: string; staged: boolean; isNew: boolean; isConflict: boolean } | null; selectedCommitSha: string | null };
  /** 共享上下文（U1b）写 */
  setContext: typeof setSharedContext;
  /** 设置任务聚焦信号（Log 会话卡 → TasksPage） */
  focusTask(taskId: string): void;
  /** 清空任务聚焦信号（TasksPage 消费） */
  clearTaskFocus(): void;
  /** 命令执行唯一入口（面板/右键菜单/快捷键共用；外部页经 GITTER_UI.runCommand 消费） */
  runCommand(cmd: { id: string; title?: string; titleKey?: string }, ctx?: RunContext): Promise<void>;
  /** 扩展管理树快照（页面槽位 → 提供者/替补 + agent UI 注册；设置页"插件挂载树"消费） */
  extTree(): ExtTreeSnapshot;
  /** 贡献文档（终端页文档面板可读；同 id 用户包 > 内置包 > 宿主，返回退订函数） */
  registerDoc(def: DocDescriptor): () => void;
  /** 已注册文档清单（同 id 覆盖已解析；层级/归属包随条目返回） */
  docs(): DocEntry[];
  /** 文档注册表变化订阅 */
  onDocsChanged(cb: () => void): () => void;
  /** 文档注册表版本（React 响应式消费用） */
  docsVersion(): number;
}

/**
 * 组装宿主面：call/on 由调用方注入——
 * - pageSdk（内置页）：桥直连，无 __caller；
 * - GITTER_UI（外部页）：callWithCaller 注入包身份与 manifest permissions，context.changed 走本地通道。
 * 其余方法全部读写宿主 store（活实例——外部页经 subscribeState/getState 获得同一响应源）。
 */
export function hostSurface(callFn: PageSurface["call"], onFn: PageSurface["on"]): PageSurface {
  return {
    call: callFn,
    on: onFn,
    t,
    navigate,
    openSettings,
    toast: (title, body) => pushToast(title, body ?? ""),
    refresh: refreshCurrent,
    notifyRepoChanged,
    repo: () => getState().repo,
    settings: () => getState().settings,
    theme: () => getState().theme,
    openRepo: async (path) => {
      // projects.open = repo.open + 记入项目列表（与 ProjectsPage 行为一致）
      const repo = await call<{ workDir: string; name: string }>("projects.open", { path });
      setState({ repo, page: "log" });
      refreshCurrent();
    },
    closeRepo: () => setState({ repo: null }),
    updateSettings: (patch) => updateSettings(patch),
    applySettings: (s) => setState({ settings: s }),
    reloadTheme: async () => {
      const settings = getState().settings;
      if (settings) await reapplyTheme(settings);
    },
    clearSettingsFocus: () => setState({ settingsFocus: null }),
    context: () => getState().context,
    setContext: setSharedContext,
    focusTask: (taskId) => setState({ focusTaskId: taskId }),
    clearTaskFocus: () => setState({ focusTaskId: null }),
    runCommand,
    extTree: (): ExtTreeSnapshot => ({
      pages: uiPages().map((d) => ({
        slot: d.slot ?? d.id,
        id: d.id,
        titleKey: d.titleKey,
        title: d.title,
        packageId: d.packageId ?? null,
        isBuiltIn: !!d.isBuiltInPackage,
        source: d.source ?? "builtin",
        order: d.order,
        shadowed: uiPageProvidersFor(d.slot ?? d.id)
          .filter((x) => x !== d && x.packageId && x.packageId !== d.packageId)
          .map((x) => ({ packageId: x.packageId!, isBuiltIn: !!x.isBuiltInPackage })),
      })),
      agentUI: agentUIRegistrations(),
    }),
    // 文档注册表：宿主直呼 = 宿主缺省层；sdk.ts 的 window 面按注入窗口归因 builtin/user
    registerDoc: (def) => registryRegisterDoc({ doc: def, packageId: "host", tier: "host" }),
    docs: registryDocs,
    onDocsChanged: registryOnDocsChanged,
    docsVersion: registryDocsVersion,
  };
}

/** 文档清单响应式钩子（内置页用；外部页同型实现在 external/pageSurface.ts）。 */
export function useDocs(): DocEntry[] {
  useSyncExternalStore(registryOnDocsChanged, registryDocsVersion);
  return registryDocs();
}

export type { DocDescriptor, DocEntry, DocTier } from "./docRegistry";
export { docTitle } from "./docRegistry";

/** context.changed 的统一订阅（渲染层本地 CustomEvent；store.setSharedContext 派发）。 */
export function subscribeContextChanged(cb: (context: unknown) => void): () => void {
  return onContextChanged(cb as never);
}

/** 桥事件订阅（open 域给 pageSdk 用）。 */
export { onEvent };
