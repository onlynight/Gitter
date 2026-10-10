/**
 * Office 页 iframe 预览运行时（office-integration-plan.md §10.5）：
 * 本模块被 build-pages.mjs 单独构建为 minified IIFE，经 virtual:officePreviewRuntime
 * 内联进 office 页 page.js，页面运行时再写入 iframe srcdoc——预览库与全部样式只存在于
 * iframe 文档内（sandbox="allow-scripts"，opaque origin），无论渲染库往 document.head
 * 塞什么、抛什么异常，宿主文档零污染（§10.1 的 CSS 污染教训）。
 *
 * 协议（postMessage，targetOrigin "*"，载荷只有文档字节与状态，无敏感数据）：
 *   iframe → 宿主  { source, type: "ready" }
 *   宿主 → iframe  { source, type: "render", id, renderer, name, dark, base64?, text? }
 *   iframe → 宿主  { source, type: "done", id, info: { pages?, sheets? } }
 *                | { source, type: "error", id, message }
 */
import { renderPdf } from "./renderPdf";
import { renderDocx } from "./renderDocx";
import { renderSheet } from "./renderSheet";
import { renderPptx } from "./renderPptx";

const SRC = "gitter-office-preview";
const ROOT_ID = "gitter-preview-root";

type Renderer = "pdf" | "docx" | "sheet" | "pptx";

interface RenderMsg {
  source: string;
  type: "render";
  id: number;
  renderer: Renderer;
  name: string;
  dark: boolean;
  base64?: string;
  text?: string;
}

function post(msg: Record<string, unknown>): void {
  window.parent.postMessage({ source: SRC, ...msg }, "*");
}

/** 大文件分块 atob（单次 String.fromCharCode(...50MB) 会栈溢出）。 */
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 只允许一轮渲染（iframe 每文件重建，id 恒为 1；防御异常库内的怪异重入）。 */
let rendered = false;

async function render(msg: RenderMsg): Promise<void> {
  if (rendered) return;
  rendered = true;
  if (msg.dark) document.body.classList.add("dark");
  const root = document.getElementById(ROOT_ID) as HTMLElement;
  let info: { pages?: number; sheets?: string[] } = {};
  switch (msg.renderer) {
    case "pdf":
      info = await renderPdf(root, b64ToBytes(msg.base64!), msg.name);
      break;
    case "docx":
      info = await renderDocx(root, b64ToBytes(msg.base64!), msg.name);
      break;
    case "sheet":
      info = renderSheet(root, msg.base64 ? b64ToBytes(msg.base64) : (msg.text ?? ""), msg.name);
      break;
    case "pptx":
      info = await renderPptx(root, b64ToBytes(msg.base64!), msg.name);
      break;
  }
  post({ type: "done", id: msg.id, info });
}

window.addEventListener("message", (ev) => {
  if (ev.source !== window.parent) return;
  const msg = ev.data as RenderMsg;
  if (!msg || msg.source !== SRC || msg.type !== "render") return;
  render(msg).catch((e) => {
    post({ type: "error", id: msg.id, message: (e as Error)?.message ?? String(e) });
  });
});

post({ type: "ready" });
