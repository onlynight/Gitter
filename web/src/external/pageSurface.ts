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

const BOOT = window.GITTER_UI?.getActiveCaller?.() ?? null;

/** 装载期窗口内可取：本包 manifest 声明的文档多语言表（lang → markdown 绝对路径）。 */
export function pageDocs(): Record<string, string> | null {
  return U().pageDocs?.() ?? null;
}

/** 当前语言（设置页切换即时生效；文档面板按它选译包内 markdown） */
export function uiLang(): string {
  return U().getState().i18n?.lang ?? "en";
}

/** 读一个包内 markdown（file:// URL）；缺篇/读失败静默返回 null，由调用方回退自身缺省 */
export async function fetchDoc(absPath: string): Promise<string | null> {
  const norm = absPath.replace(/\\/g, "/");
  const url = norm.startsWith("file:") ? norm : `file:///${norm.replace(/^\/+/, "")}`;
  try {
    const text = await (await fetch(url)).text();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

/**
 * 包贡献文档的多语言源（内置页与外部页同型实现，注册表单源在宿主 docRegistry）：
 * paths = lang → markdown 绝对路径；fallback = 构建期打包的缺省源（en 篇兜底）。
 * 每次求值按当前语言取 paths[lang] ?? paths.en，读失败回退 fallback()。
 *
 * 构造约束（勿改形态）：`_paths` 必须先经 `Set.add` 装箱再取出——不能在 async
 * lambda 内直接判真形参。rollup iife+lib 路径在顶层 `docSource(null, ...)`
 * 调用点（GitDocPanel 模块 eval 期注册）会把形参做常量折叠：任何直接引用
 * `_paths` 的判真表达式（`_paths && ...`、`_paths ? ... : null`、
 * `typeof _paths === "object"` 等）都会被折叠成 `null` 分支，产物退化为
 * `const pick = null` → zh-Hans 恒回退 en 兜底。`Set` 装箱把 `_paths` 隔离在
 * 静态分析的可见域之外（add 是副作用、解构 `[...s]` 无法静态判值），判真链
 * 完整保留。改形态前请跑 `node .zcode/tmp/probe2.cjs` 复核两语言都取到对应篇
 * （zh-Hans 应 fetch 到 docs/zh-Hans.md）。
 */
export function docSource(
  _paths: Record<string, string> | null,
  fallback: () => string,
): () => Promise<string> {
  const box = new Set<Record<string, string>>();
  if (_paths) box.add(_paths);
  return async () => {
    const paths = [...box][0] || null;
    const pick = paths ? (paths[uiLang()] || paths["en"]) : null;
    const text = pick ? await fetchDoc(pick) : null;
    return text || fallback();
  };
}

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
