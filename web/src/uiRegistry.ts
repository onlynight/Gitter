/**
 * 页面注册表·槽位-提供者模型（ui-full-pluginization-plan.md D1/D4，R0-2）：
 * App.tsx 的硬编码页面 switch、Sidebar NAV、Ctrl+1..9 快捷键、palette goto 全部由本注册表驱动。
 *
 * 三级提供者解析（同槽位竞争）：用户包 > 内置包 > 宿主内置组件。
 * - 宿主缺省提供者（builtinPages 自举 / 未来 gitui.page.* 内置包）不可卸载、只可被替换；
 * - 外部页贡献 slot 为自身 id 时是"新增槽位"，声明内置槽位 id（如 "log"）即"替换缺省提供者"；
 * - 惰性页面：loader 先登记元数据（侧栏立即可见），首次导航时注入脚本升级出 mount。
 *
 * 纯数据模块（无 React 依赖）。
 */

export interface UIPageDef {
  /** 注册 id：内置 = 槽位 id；外部 = ext.<pkg>.<pid>（全库唯一，重注册 = 幂等覆盖） */
  id: string;
  /** 竞争的槽位（缺省 = id）。导航/store.page 的键是槽位 id */
  slot?: string;
  /** 内置页 = i18n 键（渲染层 t() 解析）；外部页 = 字面量标题 */
  titleKey?: string;
  title?: string;
  glyph?: string;
  svg?: string;
  /** 排序（侧边栏与 Ctrl+数字顺序）；内置 10..700，外部缺省 500 */
  order: number;
  source?: "builtin" | "package";
  packageId?: string;
  /** 内置包提供者（信任随应用分发）与用户包提供者的分级依据（解析优先级） */
  isBuiltInPackage?: boolean;
  /** manifest 声明的权限域（loader 注入，__caller 强制依据；宿主内置组件页无此字段） */
  permissions?: string[];
  /** 惰性页面：元数据已登记、脚本未注入（首次导航时 loader 补装） */
  lazy?: boolean;
  /** 页面挂载器（loader 装载后由 GITTER_UI.registerPage 传入；内置组件页无此字段） */
  mount?: (container: HTMLElement, ctx: { repo: { workDir: string; name: string } | null; packageId: string }) => void | (() => void);
}

/** 提供者解析优先级：用户包（审核渠道门控）> 内置包（信任随分发）> 宿主内置。 */
function providerRank(d: UIPageDef): number {
  if (d.source === "package") return d.isBuiltInPackage ? 1 : 2;
  return 0;
}

const defs = new Map<string, UIPageDef>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

export function registerUiPage(def: UIPageDef): void {
  defs.set(def.id, def);
  notify();
}

/** loader 登记外部页元数据（幂等；脚本注册后同 id 覆盖升级出 mount）。 */
export function upsertExternalPageMeta(def: UIPageDef): void {
  defs.set(def.id, { ...defs.get(def.id), ...def, source: "package", mount: defs.get(def.id)?.mount });
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

/** 槽位 id：内置 = 注册 id；外部 = 显式 slot 或注册 id。 */
function slotOf(d: UIPageDef): string {
  return d.slot ?? d.id;
}

/** 槽位解析：取该槽位优先级最高的提供者（用户包 > 内置包 > 宿主内置）。 */
export function resolveUiPage(slot: string): UIPageDef | null {
  let winner: UIPageDef | null = null;
  for (const d of defs.values()) {
    if (slotOf(d) !== slot) continue;
    if (!winner || providerRank(d) > providerRank(winner)) winner = d;
  }
  return winner;
}

/** 该槽位是否有宿主内置提供者（判断"替换态"用）。 */
export function hasBuiltinProvider(slot: string): boolean {
  for (const d of defs.values()) {
    if (slotOf(d) === slot && d.source === "builtin") return true;
  }
  return false;
}

/** 全部槽位的胜出提供者（侧栏/快捷键/命令面板数据源；order 排序，settings 天然在末位）。 */
export function uiPages(): UIPageDef[] {
  const slots = new Map<string, UIPageDef>();
  for (const d of defs.values()) {
    const slot = slotOf(d);
    const cur = slots.get(slot);
    if (!cur || providerRank(d) > providerRank(cur)) slots.set(slot, d);
  }
  return [...slots.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function uiPage(id: string): UIPageDef | null {
  return defs.get(id) ?? null;
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
