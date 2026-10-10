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
 * 缩放（宿主顶栏为唯一事实源，iframe 里 Ctrl+滚轮只发请求）：
 *   宿主 → iframe  { source, type: "zoom", zoom }          —— 应用 CSS zoom（#root 内容层）
 *   iframe → 宿主  { source, type: "zoom-request", dir }   —— Ctrl+滚轮请求步进
 * pdf 额外经 session.setZoom 防抖重渲染画布（zoom×dpr 分辨率），保证放大后文字锐利。
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
  type: "render" | "zoom";
  id: number;
  renderer: Renderer;
  name: string;
  dark: boolean;
  base64?: string;
  text?: string;
  zoom?: number;
}

/** pdf 渲染会话（唯一支持位图级重缩放的渲染器） */
let session: { setZoom?: (z: number) => void } | null = null;
let currentZoom = 1;

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

async function render(msg: RenderMsg, content: HTMLElement): Promise<void> {
  if (rendered) return;
  rendered = true;
  if (msg.dark) document.body.classList.add("dark");
  let info: { pages?: number; sheets?: string[] } = {};
  switch (msg.renderer) {
    case "pdf":
      info = await renderPdf(content, b64ToBytes(msg.base64!), msg.name);
      session = info as unknown as { setZoom?: (z: number) => void };
      break;
    case "docx":
      info = await renderDocx(content, b64ToBytes(msg.base64!), msg.name);
      break;
    case "sheet":
      info = renderSheet(content, msg.base64 ? b64ToBytes(msg.base64) : (msg.text ?? ""), msg.name);
      break;
    case "pptx":
      info = await renderPptx(content, b64ToBytes(msg.base64!), msg.name);
      break;
  }
  // 渲染期间到来的缩放：CSS zoom 已即时生效，这里补上 pdf 的位图重渲染
  if (currentZoom !== 1) (info as { setZoom?: (z: number) => void }).setZoom?.(currentZoom);
  post({ type: "done", id: msg.id, info: { pages: info.pages, sheets: info.sheets } });
}

const root = document.getElementById(ROOT_ID) as HTMLElement;
/** 缩放作用域：root 只当滚动容器，内容层整体 CSS zoom（滚动条保持原尺寸） */
const content = document.createElement("div");
content.className = "gpv-content";
root.appendChild(content);

window.addEventListener("message", (ev) => {
  if (ev.source !== window.parent) return;
  const msg = ev.data as RenderMsg;
  if (!msg || msg.source !== SRC) return;
  if (msg.type === "render") {
    render(msg, content).catch((e) => {
      post({ type: "error", id: msg.id, message: (e as Error)?.message ?? String(e) });
    });
  } else if (msg.type === "zoom" && typeof msg.zoom === "number" && msg.zoom > 0) {
    currentZoom = msg.zoom;
    content.style.zoom = String(msg.zoom);
    session?.setZoom?.(msg.zoom);
  }
});

// Ctrl+滚轮缩放：拦在 iframe 内（阻断浏览器级整页缩放），宿主统一步进
window.addEventListener(
  "wheel",
  (ev) => {
    if (!ev.ctrlKey && !ev.metaKey) return;
    ev.preventDefault();
    post({ type: "zoom-request", dir: ev.deltaY < 0 ? 1 : -1 });
  },
  { passive: false },
);

post({ type: "ready" });
