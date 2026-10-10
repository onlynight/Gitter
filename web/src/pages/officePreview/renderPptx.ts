/**
 * pptx 预览试做（office-integration-plan.md §10.4 P2）：pptx-preview 渲染
 * （文本框/图片级保真，动画/SmartArt/主题不完整）。保真度人工验收不达标即
 * 把 pptx 归入 legacy（officeShared.ts 一处分派改动），不为 pptx 重演沉没成本。
 */
import { init } from "pptx-preview";

export async function renderPptx(
  root: HTMLElement,
  data: Uint8Array,
  _name: string,
): Promise<{ pages?: number }> {
  const host = document.createElement("div");
  host.className = "gpv-pptx";
  root.appendChild(host);
  const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const previewer = init(host, { width: Math.max(320, root.clientWidth - 32), mode: "list" });
  try {
    await previewer.preview(ab);
  } catch (e) {
    previewer.destroy();
    throw e;
  }
  return { pages: previewer.slideCount };
}
