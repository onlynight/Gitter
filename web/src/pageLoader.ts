import { call } from "./bridge/client";
import { beginExternalPackage, endExternalPackage } from "./sdk";
import { unregisterAgentUI } from "./agentUIRegistry";
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
  /** 文档多语言表（lang → markdown 绝对路径）；null = 该页未声明多语言文档 */
  docs: Record<string, string> | null;
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

/** 注入中的包（并发去重：同一包的两个 ensure 同时到达 → 只注入一次）。 */
const injecting = new Map<string, Promise<void>>();

/** 注入一个包的入口脚本（幂等：已装载跳过；并发场景共享同一 in-flight promise）。 */
async function injectPackage(m: ExternalPageInfo): Promise<void> {
  if (loadedPackages.has(m.packageId)) return;
  const inflight = injecting.get(m.packageId);
  if (inflight) return inflight;
  const job = doInjectPackage(m);
  injecting.set(m.packageId, job);
  try {
    await job;
  } finally {
    injecting.delete(m.packageId);
  }
}

async function doInjectPackage(m: ExternalPageInfo): Promise<void> {
  if (loadedPackages.has(m.packageId)) return;
  if (m.styles.length > 0) injectStyles(m.packageId, m.styles);
  try {
    beginExternalPackage(m.packageId, m.permissions, m.isBuiltIn, { docs: m.docs });
    await injectScript(fileUrl(m.entryAbs));
    loadedPackages.add(m.packageId);
  } finally {
    endExternalPackage();
  }
}

/** 彻底清空外部页（热重载走差量同步 doLoadExternalPages，不经过这里）。 */
export function unloadExternalPages(): void {
  for (const pkg of new Set(metas.map((m) => m.packageId))) {
    unregisterUiPagesByPackage(pkg);
    removeStyles(pkg);
    unregisterAgentUI(pkg); // agent UI 贡献（时间线渲染器/composer provider）随包注销
  }
  metas = [];
  loadedPackages.clear();
}

/** reload 串行化：extensions.changed 与语言切换可能几乎同时各触发一次 reload——
 * 并发 = 第二次 unload 清掉第一次刚注入的注册面 → 脚本重复执行/注册表 BROKEN
 * （压力探针实锤：slots 全变 "builtin"）。进行中的 reload 完成后，后续调用以最新参数重跑一次。 */
let reloadInFlight = false;
let reloadQueued: { allowCode: boolean; lang?: string } | null = null;

/**
 * App 装配与 extensions.changed 热刷新时调用：全量重同步外部页（串行化 + 差量）。
 * 差量同步（对 全清重建 的替代，热重载竞态的根治）：
 *   - 新清单里的页面：登记元数据（幂等合并，mount 保留）；
 *   - 清单里消失的包：才注销（连带样式）；
 *   - "已挂载或已装载"的包：若 entryAbs 未变，脚本不重注入（注册表原样保留，零闪动）；
 *     entryAbs 变了（包内容更新）才重注入。
 * 旧"unload→重登记→按 visited 补注入"的问题：三步间任何异步窗口都可能把 mount 抹掉
 * 而不再补——页面卡"…"（切语言/插件启停后部分页面打不开）或导航项只剩包名。
 * 返回成功登记的页面数（桥不可用 = 0）。
 */
export async function loadExternalPages(allowCode: boolean, lang?: string): Promise<number> {
  if (reloadInFlight) {
    reloadQueued = { allowCode, lang };
    return -1; // 已有 reload 在跑，其结束后按最新参数重跑
  }
  reloadInFlight = true;
  try {
    let last: { allowCode: boolean; lang?: string } = { allowCode, lang };
    for (;;) {
      const r = await doLoadExternalPages(last.allowCode, last.lang);
      if (!reloadQueued) return r;
      last = reloadQueued;
      reloadQueued = null;
    }
  } finally {
    reloadInFlight = false;
  }
}

async function doLoadExternalPages(allowCode: boolean, lang?: string): Promise<number> {
  let list: ExternalPageInfo[] = [];
  try {
    list = await call<ExternalPageInfo[]>("extensions.pages", { lang: lang ?? null });
  } catch {
    return 0;
  }
  const prevMetaById = new Map(metas.map((m) => [m.id, m]));
  const nextIds = new Set(list.map((m) => m.id));
  // 差量：注销清单里消失的包（页面 + 样式 + agent UI 贡献 + 装载标记）
  for (const prev of metas) {
    if (!nextIds.has(prev.id)) {
      unregisterUiPagesByPackage(prev.packageId);
      removeStyles(prev.packageId);
      unregisterAgentUI(prev.packageId);
      loadedPackages.delete(prev.packageId);
    }
  }
  metas = list;
  let ok = 0;
  for (const m of list) {
    upsertExternalPageMeta(metaToDef(m));
    const prev = prevMetaById.get(m.id);
    const entryChanged = !prev || prev.entryAbs !== m.entryAbs;
    const wasLoaded = loadedPackages.has(m.packageId);
    if (!entryChanged && wasLoaded) {
      ok++; // 未变化：注册表与脚本原样保留（已 mount 页面零闪动，不再有任何清空窗口）
      continue;
    }
    if (m.lazy && !entryChanged && !wasLoaded) continue; // 从未装载的惰性页：维持首次导航注入
    try {
      if (wasLoaded) loadedPackages.delete(m.packageId); // 包内容更新：强制重注入（入口幂等清旧 root）
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

/** 惰性页首次导航：注入入口脚本；脚本 registerPage 后注册表 notify 驱动重渲染。
 * 竞态保护：热重载（unloadExternalPages）进行中导航到惰性页时 metas 为空——
 * 直接返回 false 会让页面永久卡在"…"占位（曾致切语言/插件启停后部分页面打不开），
 * 这里兜底直查宿主 extensions.pages 并登记后再注入。 */
export async function ensureExternalPageLoaded(slot: string): Promise<boolean> {
  let m = metas.find((x) => x.slot === slot || x.id === slot);
  if (!m) {
    try {
      const list = await call<ExternalPageInfo[]>("extensions.pages", { lang: null });
      metas = list;
      for (const it of list) upsertExternalPageMeta(metaToDef(it));
      m = list.find((x) => x.slot === slot || x.id === slot);
    } catch {
      return false; // 桥不可用：PageOutlet 的重试路径接管
    }
    if (!m) return false;
  }
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
 * 槽位回落（迁移期 = 宿主内置组件；R9 后 = 不可用卡），失败原因在控制台可见。
 * 热重载竞态保护：若注册表里该页已是带 mount 的终态（脚本其实装载过），不覆盖。 */
function markLoadFailed(m: ExternalPageInfo): void {
  const cur = uiPage(m.id);
  if (cur?.mount) return;
  upsertExternalPageMeta({ ...metaToDef(m), lazy: false });
}
