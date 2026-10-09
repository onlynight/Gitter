/**
 * 文档注册表（终端页文档面板插件化，design/terminal-git-docs-mockup.html 实现落点）：
 * 外部页/包经 window.GITTER_UI.registerDoc 贡献 markdown 文档（终端页文档面板可读），
 * 内置 Git 命令手册（gitui.page.bash 自举注册）与第三方包走同一接缝。
 *
 * 同 id 三级覆盖（同 uiRegistry/agentUIRegistry 语义）：用户包 > 内置包 > 宿主缺省——
 * 用户包可整体替换内置手册（定制团队规范版）。
 * 纯数据模块；宿主 sdk.ts 安装到 GITTER_UI，页面包经 pageSdk（external/pageSurface）消费——
 * 页面产物不持有注册表副本（单源）。沙箱约束：内容一律走 renderMarkdown（html 关闭）渲染，
 * 文档源不落地 DOM 原文，禁止脚本注入面。
 */

export type DocTier = "host" | "builtin" | "user";

export interface DocDescriptor {
  /** 全局唯一 id（如 "builtin.git-commands"、"myplug.deploy-guide"；同 id 高层级覆盖） */
  id: string;
  /** 标题：字符串或惰性函数（后者每次取标题时求值，语言切换后自然更新） */
  title: string | (() => string);
  /** markdown 源（惰性取：同步字符串或 Promise——包资源/未来远程文档均可） */
  source: () => string | Promise<string>;
  /** 宿主装载（GITTER_UI.docTitle 按语言选译）；贡献者自绘标题可省略，回退 title */
  registryId?: string;
  /** 注册表标题多语言表（lang → 标题，缺省 "en"）；宿主 docTitle 按当前语言解析 */
  registryTitles?: Record<string, string>;
}

export interface DocEntry {
  doc: DocDescriptor;
  packageId: string;
  tier: DocTier;
}

const TIER_ORDER: Record<DocTier, number> = { host: 1, builtin: 2, user: 3 };

/** 包贡献文档标题多语言表（packageId → registryId → lang → 标题；宿主 docTitle 按语言解析） */
export const registryTitles = new Map<string, Map<string, Record<string, string>>>();

const entries = new Map<string, DocEntry>();
const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version++;
  for (const fn of listeners) fn();
}

/**
 * 注册/覆盖文档：同 id 仅当层级 ≥ 既有层级时生效（用户包可替换内置，反之忽略）。
 * 返回退订函数——调用方（如插件页卸载清理）可撤销本次注册。
 */
export function registerDoc(entry: DocEntry): () => void {
  const prev = entries.get(entry.doc.id);
  if (prev && TIER_ORDER[prev.tier] > TIER_ORDER[entry.tier]) return () => {};
  entries.set(entry.doc.id, entry);
  notify();
  const id = entry.doc.id;
  return () => unregisterDoc(id, entry.packageId);
}

export function unregisterDoc(id: string, packageId?: string): void {
  const cur = entries.get(id);
  if (!cur) return;
  if (packageId !== undefined && cur.packageId !== packageId) return;
  entries.delete(id);
  notify();
}

export function onDocsChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function docsVersion(): number {
  return version;
}

/** 解析后的文档清单（同 id 覆盖已完成；宿主/内置篇在前、用户篇在后，同级按注册序）。 */
export function docs(): DocEntry[] {
  return [...entries.values()].sort((a, b) =>
    TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);
}

/** 标题求值（字符串或惰性函数）。 */
export function docTitle(doc: DocDescriptor): string {
  return typeof doc.title === "function" ? doc.title() : doc.title;
}

/**
 * 注册表标题解析（宿主 GITTER_UI.docTitle 实现）：
 * 1. 带 registryId → 查贡献表（lang → en → 原样返回；键缺失时回退 doc.title，避免整篇标题空）；
 * 2. 未登记 → docTitle 兜底（贡献者自定义标题）。
 * 贡献表由 sdk 面随页面/文档注册写入（packageId + registryTitles），卸载时移除。
 */
export function docTitleI18n(packageId: string, lang: string, doc: DocDescriptor): string {
  const registryId = doc.registryId;
  if (registryId) {
    const table = registryTitles.get(packageId)?.get(registryId) ?? doc.registryTitles;
    if (table) {
      const v = table[lang] ?? table["en"] ?? table[Object.keys(table)[0]];
      if (v) return v;
    }
  }
  return docTitle(doc);
}
