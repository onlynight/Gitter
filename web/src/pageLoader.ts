import { call } from "./bridge/client";
import { beginExternalPackage, endExternalPackage } from "./sdk";
import { uiPage, unregisterUiPagesByPackage, upsertExternalPageMeta, type UIPageDef } from "./uiRegistry";

/**
 * 外部页面装载器（ui-pluginization-plan.md U1c + ui-full-pluginization-plan.md R0-7）：
 * 从扩展包清单（contributes.pages）读取渲染层入口（经典 script，非 module）：
 * 1. 元数据先行——loader 把清单登记进 uiRegistry（侧栏/快捷键立即可见，含惰性页）；
 * 2. 非惰性页启动即注入 <script src="file://…">，脚本同步调 GITTER_UI.registerPage 出 mount；
 * 3. 惰性页（内置页面包）首次导航到该槽位时经 ensureExternalPageLoaded 注入；
 * 4. 包集合变化（extensions.changed）经 reloadExternalPages 全量重同步（注销→移除样式→重登记）。
 *
 * 信任门（R0/A3 门分离）：bridge 侧已按"内置包恒返回、用户包受 allowCodePlugins 门控"过滤，
 * loader 不再重复判门——内置页面包（未来 gitui.page.*）不受用户代码门影响。
 */

export interface ExternalPageInfo {
  id: string; // ext.<pkg>.<pid>
  slot: string; // 竞争槽位（缺省 = id）
  title: string;
  entryAbs: string; // 绝对路径（loader 转 file:// URL）
  packageId: string;
  permissions: string[]; // manifest 声明（__caller 强制依据，页面脚本不可自报）
  styles: string[]; // 绝对路径
  lazy: boolean;
  isBuiltIn: boolean;
  icon: string | null; // Segoe Fluent 字形
  svg: string | null; // 16×16 SVG path（侧栏图标第二形态）
}

let metas: ExternalPageInfo[] = [];
const loadedPackages = new Set<string>();
const styleEls = new Map<string, HTMLLinkElement[]>();

function fileUrl(absPath: string): string {
  const norm = absPath.replace(/\\/g, "/");
  return norm.startsWith("file:") ? norm : `file:///${norm.replace(/^\/+/, "")}`;
}

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`外部页面脚本加载失败: ${src}`));
    document.head.appendChild(el);
  });
}

function injectStyles(packageId: string, styles: string[]): void {
  const els: HTMLLinkElement[] = [];
  for (const href of styles) {
    const el = document.createElement("link");
    el.rel = "stylesheet";
    el.href = fileUrl(href);
    document.head.appendChild(el);
    els.push(el);
  }
  styleEls.set(packageId, els);
}

function removeStyles(packageId: string): void {
  for (const el of styleEls.get(packageId) ?? []) el.remove();
  styleEls.delete(packageId);
}

function metaToDef(m: ExternalPageInfo): UIPageDef {
  return {
    id: m.id,
    slot: m.slot,
    title: m.title,
    glyph: m.icon ?? undefined,
    svg: m.svg ?? undefined,
    packageId: m.packageId,
    isBuiltInPackage: m.isBuiltIn,
    permissions: m.permissions,
    lazy: m.lazy,
    // 顺序继承同槽位的内置身份登记（builtinPages 10..700）——包 manifest 不带 order，
    // 硬编码会让全部槽位塌缩到同一序（导航/快捷键顺序即乱）
    order: uiPage(m.slot)?.order ?? 500,
    source: "package",
  };
}

/** 注入一个包的入口脚本（幂等：已装载跳过）。 */
async function injectPackage(m: ExternalPageInfo): Promise<void> {
  if (loadedPackages.has(m.packageId)) return;
  if (m.styles.length > 0) injectStyles(m.packageId, m.styles);
  try {
    beginExternalPackage(m.packageId, m.permissions);
    await injectScript(fileUrl(m.entryAbs));
    loadedPackages.add(m.packageId);
  } finally {
    endExternalPackage();
  }
}

/** 注销全部外部页（脚本不可撤销——重新注入即重新执行；样式随包移除）。 */
export function unloadExternalPages(): void {
  for (const pkg of new Set(metas.map((m) => m.packageId))) {
    unregisterUiPagesByPackage(pkg);
    removeStyles(pkg);
  }
  metas = [];
  loadedPackages.clear();
}

/**
 * App 装配与 extensions.changed 热刷新时调用：全量重同步外部页。
 * 返回成功登记的页面数（桥不可用 = 0）。
 */
export async function loadExternalPages(allowCode: boolean, lang?: string): Promise<number> {
  unloadExternalPages();
  let list: ExternalPageInfo[] = [];
  try {
    list = await call<ExternalPageInfo[]>("extensions.pages", { lang: lang ?? null });
  } catch {
    return 0;
  }
  metas = list;
  for (const m of list) upsertExternalPageMeta(metaToDef(m));
  let ok = 0;
  for (const m of list) {
    if (m.lazy) continue; // 首次导航时经 ensureExternalPageLoaded 注入
    try {
      await injectPackage(m);
      ok++;
    } catch (e) {
      console.warn(`[pages] ${m.id} 装载失败:`, (e as Error).message);
      markLoadFailed(m);
    }
  }
  return ok;
}

/** extensions.changed 携带的最新门态下重同步。 */
export function reloadExternalPages(allowCode: boolean, lang?: string): Promise<number> {
  return loadExternalPages(allowCode, lang);
}

/** 惰性页首次导航：注入入口脚本；脚本 registerPage 后注册表 notify 驱动重渲染。 */
export async function ensureExternalPageLoaded(slot: string): Promise<boolean> {
  const m = metas.find((x) => x.slot === slot || x.id === slot);
  if (!m) return false;
  try {
    await injectPackage(m);
    return true;
  } catch (e) {
    console.warn(`[pages] ${m.id} 惰性装载失败:`, (e as Error).message);
    markLoadFailed(m);
    return false;
  }
}

/** 装载失败：把该页从"惰性待装"降级为"已终态无 mount"——PageOutlet 不再重试，
 * 槽位回落（迁移期 = 宿主内置组件；R9 后 = 不可用卡），失败原因在控制台可见。 */
function markLoadFailed(m: ExternalPageInfo): void {
  upsertExternalPageMeta({ ...metaToDef(m), lazy: false });
}
