/**
 * docx 预览（office-integration-plan.md §10.4）：docx-preview 版式保真渲染到 DOM
 * （分页/表格/图片/页眉页脚）。样式注入 iframe 文档 head（隔离），wrapper 灰底
 * 由 iframe 级 CSS 覆写为透明以贴合宿主主题背板。
 */
import { renderAsync } from "docx-preview";

export async function renderDocx(
  root: HTMLElement,
  data: Uint8Array,
  _name: string,
): Promise<{ pages?: number }> {
  const host = document.createElement("div");
  host.className = "gpv-docx";
  root.appendChild(host);
  await renderAsync(data, host, undefined, {
    inWrapper: true,
    ignoreWidth: false,
    ignoreHeight: false,
    breakPages: true,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
    ignoreFonts: false,
  });
  return {};
}
