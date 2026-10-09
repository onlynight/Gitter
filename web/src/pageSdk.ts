/**
 * Page SDK v2（ui-pluginization-plan.md U4 + ui-full-pluginization-plan.md R0-5/R2）：
 * 内置页（宿主 bundle 内）消费的唯一宿主面——实现单一源于 surface.ts
 * （与 window.GITTER_UI 外部面同实现，仅 call/on 注入方式不同：无 __caller）。
 * 外部页构建时经构建别名把本模块映射到 external/pageSurface.ts（同一接口、window 实现）。
 */
import { call } from "./bridge/client";
import { useApp } from "./state/store";
import { hostSurface, onEvent, subscribeContextChanged, type PageSurface } from "./surface";

export type { PageSurface, ExtTreeSnapshot, ExtTreeNodePage, ExtTreeAgentUIReg } from "./surface";
export type { DocDescriptor, DocEntry, DocTier } from "./docRegistry";
export { docTitle, useDocs } from "./surface";

/** 单例 surface（函数内部动态读 store，无过期状态问题）。 */
export const pageSdk: PageSurface = hostSurface(
  call,
  (method, cb) => (method === "context.changed" ? subscribeContextChanged(cb as never) : onEvent(method, cb)),
);

/**
 * 当前语言（宿主 store；内置页直接读、外部页经 external/pageSurface 同型实现读 window 面）。
 * 未初始化时回退 "en"——与渲染层 t() 的中性语言一致。
 */
export function uiLang(): string {
  return useApp().i18n?.lang ?? "en";
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
 * 包贡献文档的多语言源（同 registryId 幂等——重复 eval 返回首次登记的函数）：
 * paths = lang → markdown 绝对路径（manifest.contributes.pages[].docs 经宿主 pageDocs 传入）；
 * fallback = 构建期打包的缺省源（en 篇兜底，保证缺语言篇时面板不空）。
 * 每次求值按当前语言取 paths[lang] ?? paths.en；读失败回退 fallback()。
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

/** React 响应式面（内置页在同树，直接复用宿主 store 响应性）。 */
export { useApp as useAppState };

/** A4 会话卡联动：任务聚焦通道（Log 会话卡 → TasksPage 选中并消费）。 */
export function useTaskFocus(): [string | null, () => void] {
  const focusTaskId = useApp().focusTaskId;
  const consume = () => pageSdk.clearTaskFocus();
  return [focusTaskId, consume];
}
