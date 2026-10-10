/**
 * pdf 预览（office-integration-plan.md §10.4）：pdfjs-dist 逐页 canvas 渲染，
 * 适宽缩放（打开时按容器宽定一次，滚动翻页）。
 * worker：§10.5 的 sandbox iframe 是 opaque origin，Chromium 拒绝 module worker
 * （实测 onerror，pdf.js 回退 fake worker 拖累宿主主线程）——把 worker 产物整形为
 * classic 可解析后手动建 classic blob worker，经 workerPort 交给 pdf.js：
 *   1. `import.meta.url`（WASM 桩内）→ `self.location.href`（classic 等价物）；
 *   2. 尾部 `export{...}` 剥除（同语句已赋值 globalThis.pdfjsWorker，pdf.js 自会取用）。
 * 缩放：宿主把内容层 CSS zoom 即时生效；本渲染器另经 setZoom 防抖重渲染画布
 * （位图 = 适宽 × zoom × dpr，CSS 尺寸不变），放大后文字保持锐利。
 */
import * as pdfjs from "pdfjs-dist";
import type { PDFPageProxy } from "pdfjs-dist";
import rawWorkerCode from "pdfjs-dist/build/pdf.worker.min.mjs?raw";

const workerCode = rawWorkerCode
  .replace(/import\.meta\.url/g, "self.location.href")
  .replace(/export\s*\{[^}]*\}\s*;?\s*$/, ";");

let workerReady = false;

function ensureWorker(): void {
  if (workerReady) return;
  const blob = new Blob([workerCode], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  pdfjs.GlobalWorkerOptions.workerPort = new Worker(url, { type: "classic" });
  workerReady = true;
}

/** 按（适宽 scale × zoom × dpr）画一页；CSS 尺寸恒为适宽像素，缩放交给内容层 zoom */
async function paint(
  page: PDFPageProxy,
  scale: number,
  zoom: number,
  dpr: number,
  cssW: number,
  cssH: number,
): Promise<HTMLCanvasElement> {
  const vp = page.getViewport({ scale: scale * zoom * dpr });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  canvas.className = "gpv-pdf-page";
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  await page.render({ canvas, viewport: vp }).promise;
  return canvas;
}

export async function renderPdf(
  root: HTMLElement,
  data: Uint8Array,
  _name: string,
): Promise<{ pages?: number; setZoom?: (z: number) => void }> {
  ensureWorker();
  const loadingTask = pdfjs.getDocument({ data });
  const doc = await loadingTask.promise;
  const col = document.createElement("div");
  col.className = "gpv-pdf";
  root.appendChild(col);
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  // 首轮适宽渲染；记录每页的 scale 与 CSS 尺寸供 setZoom 重渲染
  const entries: { page: PDFPageProxy; scale: number; cssW: number; cssH: number }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.max(0.1, (root.clientWidth - 48) / base.width);
    const cssW = Math.floor(base.width * scale);
    const cssH = Math.floor(base.height * scale);
    entries.push({ page, scale, cssW, cssH });
    col.appendChild(await paint(page, scale, 1, dpr, cssW, cssH));
  }

  let rerenderSeq = 0;
  let debounceTimer = 0;
  const setZoom = (zoom: number) => {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      const seq = ++rerenderSeq;
      void (async () => {
        for (let i = 0; i < entries.length; i++) {
          if (seq !== rerenderSeq) return; // 期间又有新缩放，放弃本轮
          const e = entries[i];
          const canvas = await paint(e.page, e.scale, zoom, dpr, e.cssW, e.cssH);
          if (seq !== rerenderSeq) return;
          col.replaceChild(canvas, col.children[i]);
        }
      })().catch(() => undefined);
    }, 250);
  };

  return { pages: doc.numPages, setZoom };
}
