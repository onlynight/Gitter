/**
 * Office 文档预览共享内核（office-integration-plan.md §10.5）：
 * iframe sandbox 预览容器（PreviewFrame）+ srcdoc 静态组装 + 缩放档位，
 * Office 页与文件页编辑器画布（OfficeDocViewer）共用同一实现。
 * 预览渲染库（GITTER_LIBS.officeview 库贡献，gitui.page.office/officeview.js）内联在
 * sandbox iframe（opaque origin）文档内，与宿主零样式/异常交集；
 * 宿主只管载荷加载（file.stat/readBinary）、加载态与错误兜底卡。
 * 编辑一律交给外部应用（shell.openPath）——页内不回写字节。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { pageSdk } from "../pageSdk";
import { formatSize, officeKindOf, previewerOf } from "./officeShared";
import { IFRAME_CSS } from "./officePreview/iframeCss";
import { absPathOf } from "./filesPaths";

export type PreviewRenderer = NonNullable<ReturnType<typeof previewerOf>>;
export type Payload = { base64?: string; text?: string };
export type PreviewPhase = "loading" | "rendering" | "ready" | "error" | "legacy";

export const PREVIEW_MSG_SRC = "gitter-office-preview";

/**
 * srcdoc 静态拼装（组件首渲染时执行一次）：内联样式 + 脚本序列（</script 转义防提前闭合标签）。
 * 脚本序来自 GITTER_LIBS.officeview.srcdocScripts()（S5）：chart 运行时在前（挂
 * self.GITTER_CHART 供 pptx 图表幻灯片；gitui.lib.chart 可选依赖——缺席时 wrapper 自动
 * 降级为只装预览运行时），预览运行时在后。运行时字符串来自 GITTER_LIBS.officeview 库
 * 贡献（office 包 officeview.js，S2 拆分）——loader 依赖序保证页面 entry 执行时库已就绪；
 * 在首次渲染时取值（而非模块顶层），缺库时异常落在渲染期，由槽位 ErrorBoundary 呈现
 * 错误卡而不是脚本静默半死。
 */
function buildSrcdoc(): string {
  const lib = (window as unknown as { GITTER_LIBS?: Record<string, unknown> }).GITTER_LIBS?.officeview as
    | { runtimeJs?: unknown; srcdocScripts?: () => unknown[] }
    | undefined;
  if (typeof lib?.runtimeJs !== "string" || !lib.runtimeJs) {
    throw new Error("GITTER_LIBS.officeview 未注册——officeview 库（gitui.page.office）未装载");
  }
  const scripts = typeof lib.srcdocScripts === "function" ? lib.srcdocScripts() : [lib.runtimeJs];
  const body = scripts
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .map((s) => `<script>${s.replace(/<\/script/gi, "<\\/script>")}<\/script>`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>${IFRAME_CSS}</style></head><body><div id="gitter-preview-root"></div>${body}</body></html>`;
}

/** 缩放档位（宿主为唯一事实源；iframe 里 Ctrl+滚轮只发步进请求） */
export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3, 4];

export function zoomStep(z: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > z + 1e-9) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  return [...ZOOM_STEPS].reverse().find((s) => s < z - 1e-9) ?? ZOOM_STEPS[0];
}

/**
 * sandbox iframe 预览容器：srcdoc 装静态运行时，postMessage 握手
 * （ready → render → done|error）。sandbox="allow-scripts"（无 allow-same-origin）
 * → opaque origin，iframe 内代码摸不到宿主 DOM/localStorage；超时兜底防挂死。
 * 缩放：宿主是唯一事实源——zoom 变化即下行 {type:"zoom"}；iframe 内
 * Ctrl+滚轮上行 {type:"zoom-request"} 步进请求。
 */
export function PreviewFrame(props: {
  path: string;
  renderer: PreviewRenderer;
  name: string;
  payload: Payload;
  dark: boolean;
  zoom: number;
  onZoomDelta: (dir: 1 | -1) => void;
  timeoutMessage: string;
  onDone: (info: { pages?: number; sheets?: string[] }) => void;
  onError: (message: string) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const sentRef = useRef(false);
  const settledRef = useRef(false);
  // srcdoc 只拼装一次（运行时字符串 ~3.5MB，转义 + 模板拼接不为重复渲染买单）
  const [srcdoc] = useState(buildSrcdoc);
  const onDoneRef = useRef(props.onDone);
  onDoneRef.current = props.onDone;
  const onErrorRef = useRef(props.onError);
  onErrorRef.current = props.onError;
  const rendererRef = useRef(props.renderer);
  rendererRef.current = props.renderer;
  const nameRef = useRef(props.name);
  nameRef.current = props.name;
  const payloadRef = useRef(props.payload);
  payloadRef.current = props.payload;
  const darkRef = useRef(props.dark);
  darkRef.current = props.dark;
  const zoomRef = useRef(props.zoom);
  zoomRef.current = props.zoom;
  const onZoomDeltaRef = useRef(props.onZoomDelta);
  onZoomDeltaRef.current = props.onZoomDelta;
  const timeoutMsgRef = useRef(props.timeoutMessage);
  timeoutMsgRef.current = props.timeoutMessage;

  // zoom 下行（ready 前不发——ready 握手时会带当前值）
  useEffect(() => {
    if (sentRef.current && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        { source: PREVIEW_MSG_SRC, type: "zoom", zoom: props.zoom }, "*");
    }
  }, [props.zoom]);

  useEffect(() => {
    sentRef.current = false;
    settledRef.current = false;
    const timer = window.setTimeout(() => {
      if (!settledRef.current) {
        settledRef.current = true;
        onErrorRef.current(timeoutMsgRef.current);
      }
    }, 30000);
    const handler = (ev: MessageEvent) => {
      if (ev.source !== iframeRef.current?.contentWindow) return;
      const msg = ev.data as { source?: string; type?: string; message?: string; dir?: number; info?: { pages?: number; sheets?: string[] } };
      if (!msg || msg.source !== PREVIEW_MSG_SRC) return;
      if (msg.type === "ready" && !sentRef.current) {
        sentRef.current = true;
        const win = iframeRef.current?.contentWindow;
        if (win) {
          win.postMessage({
            source: PREVIEW_MSG_SRC,
            type: "render",
            id: 1,
            renderer: rendererRef.current,
            name: nameRef.current,
            dark: darkRef.current,
            base64: payloadRef.current.base64,
            text: payloadRef.current.text,
          }, "*");
          // 渲染消息后补发当前缩放（打开即缩放过的场景：重试/快速操作）
          if (zoomRef.current !== 1) {
            win.postMessage({ source: PREVIEW_MSG_SRC, type: "zoom", zoom: zoomRef.current }, "*");
          }
        }
        return;
      }
      // zoom 步进请求不受 settled 限制（done 之后仍可缩放）
      if (msg.type === "zoom-request") {
        onZoomDeltaRef.current(msg.dir != null && msg.dir < 0 ? -1 : 1);
        return;
      }
      if (settledRef.current) return;
      if (msg.type === "done") {
        settledRef.current = true;
        window.clearTimeout(timer);
        onDoneRef.current(msg.info ?? {});
      } else if (msg.type === "error") {
        settledRef.current = true;
        window.clearTimeout(timer);
        onErrorRef.current(String(msg.message ?? "preview error"));
      }
    };
    window.addEventListener("message", handler);
    return () => {
      window.removeEventListener("message", handler);
      window.clearTimeout(timer);
    };
  }, [props.path]);

  return (
    <iframe
      ref={iframeRef}
      className="office-preview-frame"
      sandbox="allow-scripts"
      title={props.name}
      srcDoc={srcdoc}
      onLoad={() => {
        // 与 externalPreview 同款保险：Electron 44.x 下 opaque origin srcdoc frame 加载后
        // 可能永不首帧（白屏）——display 切换 + 层提升强制合成器呈现；已呈现时仅多一次重排。
        const f = iframeRef.current;
        if (f) {
          f.style.display = "none";
          void f.offsetHeight;
          f.style.display = "";
          f.style.transform = "translateZ(0)";
        }
      }}
    />
  );
}

/** 读文档载荷：stat（体积）→ file.readBinary（base64，50MB 上限，超限 truncated） */
async function loadBinaryPayload(path: string): Promise<{ payload: Payload; size: number | null }> {
  const st = await pageSdk.call<{ size: number } | null>("file.stat", { path });
  const r = await pageSdk.call<{ base64: string; size: number; truncated: boolean } | null>("file.readBinary", { path });
  if (!r) throw new Error(pageSdk.t("Files_Missing"));
  if (r.truncated) throw new Error(pageSdk.t("Office_TooLarge"));
  return { payload: { base64: r.base64 }, size: st?.size ?? null };
}

/**
 * 文件页编辑器画布版 Office 预览（filesViewers 注册的查看器实现）：
 * 填满编辑区画布（标签条/面包屑/页脚仍归 EditorPane），右上悬浮缩放簇 +
 * 页数/体积 + 外部打开；加载/错误兜底卡与 Office 页同一套样式语言。
 * key=path 重挂即换文件——载荷竞态用 stale 标记丢弃迟到响应。
 */
export function OfficeDocViewer(props: { path: string }) {
  const t = pageSdk.t;
  const repo = pageSdk.repo();
  // 主题背板标志（iframe 文档 chrome 两档；文档本体恒为白纸）
  const dark = (document.documentElement.getAttribute("data-base") ?? "dark") !== "light";

  const [phase, setPhase] = useState<PreviewPhase>("loading");
  const [payload, setPayload] = useState<Payload | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [nonce, setNonce] = useState(0);
  const [errorMsg, setError] = useState<string | null>(null);

  const kind = officeKindOf(props.path);
  const renderer = kind ? previewerOf(kind) : null;
  const name = props.path.split("/").pop() ?? props.path;

  // 打开/重试：读载荷（binary 通道；本查看器只接二进制白名单，csv/tsv 留在 Monaco 文本流）
  useEffect(() => {
    let stale = false;
    setPhase("loading");
    setPayload(null);
    setPageCount(null);
    setSize(null);
    setZoom(1);
    (async () => {
      try {
        const { payload: p, size: s } = await loadBinaryPayload(props.path);
        if (stale) return;
        setPayload(p);
        setSize(s);
        setPhase("rendering");
      } catch (e) {
        if (stale) return;
        setPhase("error");
        setError((e as Error).message);
      }
    })();
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.path, nonce]);

  const onDone = useCallback((info: { pages?: number }) => {
    setPageCount(info.pages ?? null);
    setPhase("ready");
  }, []);
  const onError = useCallback((message: string) => {
    setError(message);
    setPhase("error");
  }, []);
  const retry = useCallback(() => {
    setError(null);
    setPhase("rendering");
    setNonce((n) => n + 1);
  }, []);
  const openExternal = useCallback(() => {
    if (repo) void pageSdk.call("shell.openPath", { path: absPathOf(repo.workDir, props.path), editor: true });
  }, [repo, props.path]);

  return (
    <div className="office-canvas" style={{ position: "absolute", inset: 0 }}>
      {phase === "error" ? (
        <div className="office-welcome">
          <div className="edwm">!</div>
          <div className="list" style={{ alignItems: "flex-start" }}>
            <div className="h">{t("Office_PreviewFailed")}</div>
            <div className="wrow" style={{ height: "auto", whiteSpace: "normal" }}>
              <span className="nm2">{errorMsg}</span>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="tool-btn primary" onClick={retry}>{t("Office_Retry")}</button>
              <button className="tool-btn" onClick={openExternal}>{t("Office_ExternalOpen")}</button>
            </div>
          </div>
        </div>
      ) : phase === "legacy" || !payload || !renderer ? (
        <div className="office-welcome">
          <div className="edwm">{name}</div>
          <div className="list" style={{ alignItems: "flex-start" }}>
            <div className="h">{name}</div>
            <div className="wrow" style={{ height: "auto", whiteSpace: "normal" }}>
              <span className="nm2">{t("Office_PreviewUnavailable")}</span>
            </div>
            <button className="tool-btn primary" style={{ marginTop: 10 }} onClick={openExternal}>
              {t("Office_ExternalOpen")}
            </button>
          </div>
        </div>
      ) : (
        <PreviewFrame
          key={`${props.path}:${nonce}`}
          path={props.path}
          renderer={renderer}
          name={name}
          payload={payload}
          dark={dark}
          zoom={zoom}
          onZoomDelta={(dir) => setZoom((z) => zoomStep(z, dir))}
          timeoutMessage={t("Office_PreviewTimeout")}
          onDone={onDone}
          onError={onError}
        />
      )}
      {(phase === "loading" || phase === "rendering") && (
        <div className="office-loading">{t("Office_Loading")}</div>
      )}
      {phase === "ready" && (
        <div className="ed-office-hud">
          {pageCount != null && <span className="it">{t("Office_PageCount", pageCount)}</span>}
          {size != null && <span className="it">{formatSize(size)}</span>}
          <button
            className="files-ibtn"
            title={t("Office_ZoomOut")}
            disabled={zoom <= ZOOM_STEPS[0]}
            onClick={() => setZoom((z) => zoomStep(z, -1))}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.4" fill="none"><path d="M1.5 6h9" /></svg>
          </button>
          <button className="office-zoom-pct" title={t("Office_ZoomReset")} onClick={() => setZoom(1)}>
            {Math.round(zoom * 100)}%
          </button>
          <button
            className="files-ibtn"
            title={t("Office_ZoomIn")}
            disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
            onClick={() => setZoom((z) => zoomStep(z, 1))}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.4" fill="none"><path d="M6 1.5v9M1.5 6h9" /></svg>
          </button>
          <button className="files-ibtn" title={t("Office_ExternalOpen")} onClick={openExternal}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M6.5 3.5H4A1.5 1.5 0 0 0 2.5 5v7A1.5 1.5 0 0 0 4 13.5h7a1.5 1.5 0 0 0 1.5-1.5V9.5M9 2.5h4.5V7M13 3 7.5 8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
