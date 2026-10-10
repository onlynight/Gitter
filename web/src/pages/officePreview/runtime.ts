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
 *   宿主 → iframe  { source, type: "zoom", zoom }          —— 内容层 transform: scale(z)
 *   iframe → 宿主  { source, type: "zoom-request", dir }   —— Ctrl+滚轮请求步进
 * 用 transform 而非 CSS zoom：pptx-preview 等库内部自带 transform: scale（origin 0 0），
 * 祖先 CSS zoom 与后代 transform 组合会撕裂渲染（实测白带/残条）；两个 transform
 * 线性复合无此问题，且变换后包围盒计入滚动范围（四格式实测 sl+cw=sw、st+ch=sh）。
 * pdf 额外经 session.setZoom 防抖重渲染画布（zoom×dpr 分辨率），保证放大后文字锐利。
 * 验收钩子：{ source, type: "scroll-debug", to?: {sl, st} } → 带 to 则先滚到该位置
 * （缺省滚到右/下极限）并回包 { type: "scroll-debug", m: { sw,sh,sl,st,cw,ch,bboxW,bboxH } }
 * ——沙箱 iframe 进不去 executeJavaScript，缩放滚动可达性/中心锚定验收（§10.7）经此取数。
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
  type: "render" | "zoom" | "scroll-debug";
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
  // 渲染期间到来的缩放：transform 已即时生效，这里补上 pdf 的位图重渲染；
  // 内容自然宽在异步渲染中增长（pdf 逐页挂载），完成后重算居中位移
  if (currentZoom !== 1) (info as { setZoom?: (z: number) => void }).setZoom?.(currentZoom);
  applyZoomLayout();
  post({ type: "done", id: msg.id, info: { pages: info.pages, sheets: info.sheets } });
}

const root = document.getElementById(ROOT_ID) as HTMLElement;
/** 缩放作用域：root 只当滚动容器，内容层整体 transform 缩放（滚动条保持原尺寸） */
const content = document.createElement("div");
content.className = "gpv-content";
root.appendChild(content);

/**
 * 缩放布局：translateX(X) scale(z)。缩小（视觉宽 < 视口）时 X 居中内容——
 * 文档缩小后左右居中而非贴左；放大（溢出）时 X=0，左锚增长不留左侧死区。
 * X 计入中心锚定（ax = offsetLeft + xShift）与滚动范围（变换包围盒计入）。
 */
let xShift = 0;
function applyZoomLayout(): void {
  const w = content.offsetWidth; // 布局宽（transform 不影响），≥ 视口（min-width:100%）
  xShift = Math.max(0, (root.clientWidth - w * currentZoom) / 2);
  content.style.transform =
    currentZoom === 1 && xShift === 0 ? "" : `translateX(${xShift}px) scale(${currentZoom})`;
}

// 宿主布局变化（分栏拖拽/窗口缩放）→ 重算居中位移
let resizeTimer = 0;
window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(applyZoomLayout, 120);
});

window.addEventListener("message", (ev) => {
  if (ev.source !== window.parent) return;
  const msg = ev.data as RenderMsg;
  if (!msg || msg.source !== SRC) return;
  if (msg.type === "render") {
    render(msg, content).catch((e) => {
      post({ type: "error", id: msg.id, message: (e as Error)?.message ?? String(e) });
    });
  } else if (msg.type === "zoom" && typeof msg.zoom === "number" && msg.zoom > 0) {
    // 以显示区中心为锚点缩放：先记下当前视口中心的内容坐标，应用新缩放后把它放回中心，
    // 用户阅读位置不跳（transform-origin 固定 0 0，锚定全靠滚动补偿；ax 含居中位移 xShift）。
    const z1 = msg.zoom;
    const ax = content.offsetLeft + xShift;
    const ay = content.offsetTop;
    const cx = (root.scrollLeft + root.clientWidth / 2 - ax) / currentZoom;
    const cy = (root.scrollTop + root.clientHeight / 2 - ay) / currentZoom;
    currentZoom = z1;
    applyZoomLayout();
    root.scrollLeft = Math.max(0, cx * z1 + content.offsetLeft + xShift - root.clientWidth / 2);
    root.scrollTop = Math.max(0, cy * z1 + ay - root.clientHeight / 2);
    session?.setZoom?.(z1);
  } else if (msg.type === "scroll-debug") {
    // 可带 to: {sl, st}——只滚到指定位置（缺省滚到右/下极限）
    const to = (msg as { to?: { sl?: number; st?: number } }).to;
    if (to) {
      if (to.sl != null) root.scrollLeft = to.sl;
      if (to.st != null) root.scrollTop = to.st;
    } else {
      root.scrollLeft = 1e6;
      root.scrollTop = 1e6;
    }
    window.setTimeout(() => {
      const bbox = content.getBoundingClientRect();
      post({
        type: "scroll-debug",
        m: {
          sw: root.scrollWidth, sh: root.scrollHeight,
          sl: root.scrollLeft, st: root.scrollTop,
          cw: root.clientWidth, ch: root.clientHeight,
          bboxW: Math.round(bbox.width), bboxH: Math.round(bbox.height),
          bboxL: Math.round(bbox.left),
        },
      });
    }, 150);
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
