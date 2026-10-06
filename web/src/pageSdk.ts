/**
 * Page SDK v2（ui-pluginization-plan.md U4 + ui-full-pluginization-plan.md R0-5/R2）：
 * 内置页（宿主 bundle 内）消费的唯一宿主面——实现单一源于 surface.ts
 * （与 window.GITTER_UI 外部面同实现，仅 call/on 注入方式不同：无 __caller）。
 * 外部页构建时经构建别名把本模块映射到 external/pageSurface.ts（同一接口、window 实现）。
 */
import { call } from "./bridge/client";
import { useApp } from "./state/store";
import { hostSurface, onEvent, subscribeContextChanged, type PageSurface } from "./surface";

export type { PageSurface } from "./surface";

/** 单例 surface（函数内部动态读 store，无过期状态问题）。 */
export const pageSdk: PageSurface = hostSurface(
  call,
  (method, cb) => (method === "context.changed" ? subscribeContextChanged(cb as never) : onEvent(method, cb)),
);

/** React 响应式面（内置页在同树，直接复用宿主 store 响应性）。 */
export { useApp as useAppState };

/** A4 会话卡联动：任务聚焦通道（Log 会话卡 → TasksPage 选中并消费）。 */
export function useTaskFocus(): [string | null, () => void] {
  const focusTaskId = useApp().focusTaskId;
  const consume = () => pageSdk.clearTaskFocus();
  return [focusTaskId, consume];
}
