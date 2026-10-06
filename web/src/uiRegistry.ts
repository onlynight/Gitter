/**
 * 页面注册表（ui-pluginization-plan.md U1a，G1 缺口收口）：
 * App.tsx 的硬编码页面 switch、Sidebar NAV、Ctrl+1..9 快捷键、palette goto 全部改为
 * 由本注册表驱动。内置页面在模块加载时自举注册；外部页面经 window.GITTER_UI
 * （sdk.ts）在 loader 装载后注册。纯数据模块（无 React 依赖）。
 */

export interface UIPageDef {
  id: string;
  /** 内置页 = i18n 键（渲染层 t() 解析）；外部页 = 字面量标题 */
  titleKey?: string;
  title?: string;
  glyph?: string;
  svg?: string;
  /** 排序（侧边栏与 Ctrl+数字顺序）；内置 10..700，外部缺省 500 */
  order: number;
  source?: "builtin" | "package";
  packageId?: string;
  /** 外部页挂载器（loader 装载后由 GITTER_UI.registerPage 传入） */
  mount?: (container: HTMLElement, ctx: { repo: { workDir: string; name: string } | null; packageId: string }) => void | (() => void);
}

const defs = new Map<string, UIPageDef>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

export function registerUiPage(def: UIPageDef): void {
  const prev = defs.get(def.id);
  // 内置页不可被外部覆盖（宿主缺省提供者不可替换的底线）
  if (prev?.source === "builtin" && def.source === "package") return;
  defs.set(def.id, def);
  notify();
}

export function unregisterUiPagesByPackage(packageId: string): void {
  let changed = false;
  for (const [id, d] of defs) {
    if (d.source === "package" && d.packageId === packageId) {
      defs.delete(id);
      changed = true;
    }
  }
  if (changed) notify();
}

export function uiPage(id: string): UIPageDef | null {
  return defs.get(id) ?? null;
}

export function uiPages(): UIPageDef[] {
  return [...defs.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function onUiPagesChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** 内置页面自举（builtinPages 模块调用一次）。 */
export function registerBuiltinPages(list: UIPageDef[]): void {
  for (const d of list) defs.set(d.id, { ...d, source: "builtin" });
  notify();
}
