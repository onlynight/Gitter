/**
 * pdf 预览（office-integration-plan.md §10.4）：pdfjs-dist 逐页 canvas 渲染，
 * 适宽缩放（打开时按容器宽定一次，滚动翻页）。
 * worker：§10.5 的 sandbox iframe 是 opaque origin，Chromium 拒绝 module worker
 * （实测 onerror，pdf.js 回退 fake worker 拖累宿主主线程）——把 worker 产物整形为
 * classic 可解析后手动建 classic blob worker，经 workerPort 交给 pdf.js：
 *   1. `import.meta.url`（WASM 桩内）→ `self.location.href`（classic 等价物）；
 *   2. 尾部 `export{...}` 剥除（同语句已赋值 globalThis.pdfjsWorker，pdf.js 自会取用）。
 */
import * as pdfjs from "pdfjs-dist";
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

export async function renderPdf(
  root: HTMLElement,
  data: Uint8Array,
  _name: string,
): Promise<{ pages?: number }> {
  ensureWorker();
  const loadingTask = pdfjs.getDocument({ data });
  const doc = await loadingTask.promise;
  const col = document.createElement("div");
  col.className = "gpv-pdf";
  root.appendChild(col);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.max(0.1, (root.clientWidth - 48) / base.width);
      const vp = page.getViewport({ scale: scale * dpr });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      canvas.className = "gpv-pdf-page";
      canvas.style.width = `${Math.floor(vp.width / dpr)}px`;
      canvas.style.height = `${Math.floor(vp.height / dpr)}px`;
      col.appendChild(canvas);
      await page.render({ canvas, viewport: vp }).promise;
    }
  } finally {
    await loadingTask.destroy().catch(() => undefined);
  }
  return { pages: doc.numPages };
}
