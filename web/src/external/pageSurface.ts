/**
 * 外部页宿主面适配（ui-full-pluginization-plan.md R2b）：
 * 页面源码 import "../pageSdk" → 页面构建期映射到本模块（同一 PageSurface 接口，
 * 实现换成 window.GITTER_UI）。宿主把活 store 的读写与 caller 注入的桥调用
 * 全部收在 GITTER_UI 面——页面产物不打包任何宿主模块。
 */
import { useSyncExternalStore } from "react";
import type { PageSurface, ExtTreeSnapshot, ExtTreeNodePage, ExtTreeAgentUIReg } from "../surface";
import type { DocDescriptor, DocEntry } from "../docRegistry";
import type { AppState } from "../state/store";

function U(): NonNullable<Window["GITTER_UI"]> {
  const g = window.GITTER_UI;
  if (!g) throw new Error("GITTER_UI 未注入（外部页必须经宿主 pageLoader 装载）");
  return g;
}

/**
 * caller 身份捕获：本模块在入口脚本 eval 期被加载——此时 loader 的
 * beginExternalPackage 仍然生效（begin/end 之间），可取到本包的
 * packageId + manifest permissions。之后页面挂载/交互的全部 call 走
 * callWith(BOOT)：装载期模块变量早已重置，凭它调用会恒回退缺省权限
 * （terminal/extensions.admin/git.write 全被拒的事故根因，e2e-pages-check 金丝雀把关）。
 */
const BOOT = window.GITTER_UI?.getActiveCaller?.() ?? null;

export const pageSdk: PageSurface = {
  call: (method, params) => {
    const g = U();
    return (BOOT ? g.callWith(BOOT, method, params) : g.call(method, params)) as never;
  },
  on: (method, cb) => U().on(method, cb),
  t: (key, ...args) => U().t(key, ...args),
  navigate: (page) => U().navigate(page),
  openSettings: (section) => U().openSettings(section),
  toast: (title, body) => U().toast(title, body),
  refresh: () => U().refresh(),
  repo: () => U().repo(),
  settings: () => U().settings(),
  theme: () => U().theme(),
  openRepo: (path) => U().openRepo(path),
  closeRepo: () => U().closeRepo(),
  updateSettings: (patch) => U().updateSettings(patch),
  applySettings: (s) => U().applySettings(s),
  reloadTheme: () => U().reloadTheme(),
  clearSettingsFocus: () => U().clearSettingsFocus(),
  context: () => U().context(),
  setContext: (...a) => U().setContext(...a),
  focusTask: (taskId) => U().focusTask(taskId),
  clearTaskFocus: () => U().clearTaskFocus(),
  runCommand: (cmd, ctx) => U().runCommand(cmd, ctx),
  extTree: (): ExtTreeSnapshot => U().extTree(),
  registerDoc: (def) => U().registerDoc(def),
  docs: () => U().docs(),
  onDocsChanged: (cb) => U().onDocsChanged(cb),
  docsVersion: () => U().docsVersion(),
};

export type { PageSurface, ExtTreeSnapshot, ExtTreeNodePage, ExtTreeAgentUIReg };
export type { DocDescriptor, DocEntry, DocTier } from "../docRegistry";
export { docTitle } from "../docRegistry";

/** 文档清单响应式钩子（外部页用；宿主同型实现在 surface.ts——注册表单源在宿主 window 面）。 */
export function useDocs(): DocEntry[] {
  const g = U();
  useSyncExternalStore((cb) => g.onDocsChanged(cb), () => g.docsVersion());
  return g.docs();
}

/** React 响应式面：useSyncExternalStore 订阅宿主活 store（跨 React 实例安全的纯 JS 订阅）。 */
export function useAppState(): AppState {
  const g = U();
  return useSyncExternalStore(g.subscribeState, g.getState);
}

/** A4 会话卡联动：任务聚焦通道（Log 会话卡 → TasksPage 选中并消费）。 */
export function useTaskFocus(): [string | null, () => void] {
  const focusTaskId = useAppState().focusTaskId;
  const consume = () => pageSdk.clearTaskFocus();
  return [focusTaskId, consume];
}
