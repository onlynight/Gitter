import MarkdownIt from "markdown-it";

/**
 * Agent markdown 渲染（插件可扩展，agent-harness.md v3.0 §七时间线）：
 * - 默认：CommonMark + linkify + breaks；html 关闭（防注入；markdown-it 默认链接协议校验兜底，
 *   javascript: 等危险协议不会输出成链接）；
 * - 扩展点：registerMarkdownPlugin(fn)——任何 markdown-it 插件（表格/任务列表/脚注等生态件）
 *   渲染前注册即生效；宿主与扩展共用同一实例。
 * - 链接点击行为由容器统一接管（Electron 内交系统浏览器，webview 不跳转）。
 */

type MarkdownItInstance = InstanceType<typeof MarkdownIt>;
export type MarkdownPlugin = (md: MarkdownItInstance) => void;

const md: MarkdownItInstance = new MarkdownIt({ html: false, linkify: true, breaks: true });

const registered = new Set<MarkdownPlugin>();

/** 注册 markdown-it 插件（幂等）。 */
export function registerMarkdownPlugin(plugin: MarkdownPlugin): void {
  if (registered.has(plugin)) return;
  registered.add(plugin);
  md.use(plugin);
}

// 链接渲染：保留 href 供容器接管点击；不设 target（Electron 内由宿主开系统浏览器）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
md.renderer.rules.link_open = (tokens: any[], idx: number): string => {
  const token = tokens[idx];
  const i = token.attrIndex("href");
  const href = i >= 0 ? token.attrs![i][1] : "#";
  return `<a href="${md.utils.escapeHtml(href)}" class="md-link" title="${md.utils.escapeHtml(href)}">`;
};

/** markdown 文本 → 安全 HTML（供 .md-body 容器渲染）。 */
export function renderMarkdown(text: string): string {
  return md.render(text ?? "");
}
