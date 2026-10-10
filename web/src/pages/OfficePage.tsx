/**
 * Office 文档页（office-integration-plan.md §10 预览-only）：
 * 左侧项目内 Office 文件列表（repo.tree 按扩展名白名单过滤）+ 右侧 iframe 预览。
 * 预览渲染库内联在 sandbox iframe（opaque origin）文档内，与宿主零样式/异常交集；
 * 宿主只管列表、顶栏（体积/页数/外部打开）、加载态与错误兜底卡（§10.5）。
 * 编辑一律交给外部应用（shell.openPath）——页内不回写字节。
 * 字节通道：pdf/docx/pptx/xlsx/ods 走 file.readBinary（base64），csv/tsv 走 file.content（文本）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pageSdk, useAppState } from "../pageSdk";
import {
  formatSize, isTextChannelKind, officeExtLabel, officeKindOf, previewerOf,
  type OfficeKind,
} from "./officeShared";
import previewRuntimeJs from "virtual:officePreviewRuntime";
import { IFRAME_CSS } from "./officePreview/iframeCss";

type PreviewRenderer = NonNullable<ReturnType<typeof previewerOf>>;
type Payload = { base64?: string; text?: string };
type Phase = "loading" | "rendering" | "ready" | "error" | "legacy";

const PREVIEW_MSG_SRC = "gitter-office-preview";

// srcdoc 静态拼装一次：内联样式 + 预览运行时（</script 转义防提前闭合标签）
const PREVIEW_JS = previewRuntimeJs.replace(/<\/script/gi, "<\\/script>");
const SRCDOC = `<!doctype html><html><head><meta charset="utf-8"><style>${IFRAME_CSS}</style></head><body><div id="gitter-preview-root"></div><script>${PREVIEW_JS}</script></body></html>`;

const SIDEBAR_KEY = "gitter.office.sidebar";
const SIDEBAR_DEFAULT = 248;
const SIDEBAR_MIN = 170;
const SIDEBAR_MAX = 420;

function loadWidth(): number {
  const raw = window.localStorage.getItem(SIDEBAR_KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n)) : SIDEBAR_DEFAULT;
}

export function OfficePage() {
  const repo = pageSdk.repo();
  const theme = useAppState().theme;
  const t = pageSdk.t;

  const [files, setFiles] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [payload, setPayload] = useState<Payload | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [width, setWidth] = useState(loadWidth);
  const [nonce, setNonce] = useState(0);

  const activeRef = useRef<string | null>(null);

  const kind = useMemo(() => (active ? officeKindOf(active) : null), [active]);
  const renderer = useMemo(() => (kind ? previewerOf(kind) : null), [kind]);
  // 主题背板标志（iframe 文档 chrome 两档；文档本体恒为白纸）
  const dark = (document.documentElement.getAttribute("data-base") ?? "dark") !== "light";
  void theme;

  const loadTree = useCallback(async () => {
    if (!repo) return;
    try {
      const r = await pageSdk.call<{ entries: { path: string; isDir: boolean }[] }>("repo.tree", { prefix: "", taskId: null });
      const list = (r.entries ?? [])
        .filter((e) => !e.isDir && officeKindOf(e.path) !== null)
        .map((e) => e.path)
        .sort();
      setFiles(list);
    } catch {
      setFiles([]);
    }
  }, [repo]);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  // 打开文件：stat（体积）→ 按类型读字节/文本；切换文件即丢弃上一份载荷（GC）
  const openFile = useCallback(async (path: string) => {
    if (activeRef.current === path) return;
    activeRef.current = path;
    setActive(path);
    setErrorMsg(null);
    setPageCount(null);
    setSize(null);
    setPayload(null);
    setNonce((n) => n + 1);
    const k = officeKindOf(path);
    if (k === null || k === "legacy") {
      setPhase("legacy");
      return;
    }
    setPhase("loading");
    try {
      const st = await pageSdk.call<{ size: number } | null>("file.stat", { path });
      if (activeRef.current !== path) return; // 已切走（竞态）
      setSize(st?.size ?? null);
      let p: Payload;
      if (isTextChannelKind(k)) {
        const r = await pageSdk.call<{ content: string; binary: boolean; truncated: boolean }>("file.content", { path });
        if (activeRef.current !== path) return;
        if (r.binary) throw new Error(t("Office_PreviewFailed"));
        if (r.truncated) throw new Error(t("Office_TooLarge"));
        p = { text: r.content };
      } else {
        const r = await pageSdk.call<{ base64: string; size: number; truncated: boolean } | null>("file.readBinary", { path });
        if (activeRef.current !== path) return;
        if (!r) throw new Error(t("Files_Missing"));
        if (r.truncated) throw new Error(t("Office_TooLarge"));
        p = { base64: r.base64 };
      }
      setPayload(p);
      setPhase("rendering");
    } catch (e) {
      if (activeRef.current !== path) return;
      setErrorMsg((e as Error).message);
      setPhase("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPreviewDone = useCallback((info: { pages?: number }) => {
    setPageCount(info.pages ?? null);
    setPhase("ready");
  }, []);

  const onPreviewError = useCallback((message: string) => {
    setErrorMsg(message);
    setPhase("error");
  }, []);

  // 重试：payload 不动，重挂 iframe（key 变化）走一遍 ready → render
  const retry = useCallback(() => {
    setErrorMsg(null);
    setPhase("rendering");
    setNonce((n) => n + 1);
  }, []);

  // 分栏拖拽（同 FilesPage：定宽 px，双击复位）
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const onGutterDown = useCallback((e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startW: width };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    (e.target as HTMLElement).classList.add("drag");
    document.body.style.userSelect = "none";
    e.preventDefault();
  }, [width]);
  const onGutterMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, d.startW + e.clientX - d.startX)));
  }, []);
  const onGutterUp = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    (e.target as HTMLElement).classList.remove("drag");
    document.body.style.userSelect = "";
    setWidth((w) => {
      window.localStorage.setItem(SIDEBAR_KEY, String(w));
      return w;
    });
  }, []);

  const nameOf = useCallback((p: string) => p.split("/").pop() ?? p, []);
  const dirOf = useCallback((p: string) => {
    const i = p.lastIndexOf("/");
    return i >= 0 ? p.slice(0, i) : "";
  }, []);
  const openExternal = useCallback(() => {
    if (active && repo) void pageSdk.call("shell.openPath", { path: `${repo.workDir}/${active}`, editor: true });
  }, [active, repo]);

  if (!repo) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
        <div style={{ textAlign: "center", opacity: 0.7 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
          <div>{t("Office_Empty")}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="files-split">
      <div className="files-side" style={{ width, flex: "none" }}>
        <div className="files-pane">
          <div className="files-head">
            <span className="cap">{t("Office_Title")}</span>
            <div className="files-hacts">
              <button className="files-ibtn" title={t("Office_Refresh")} onClick={() => void loadTree()}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2a6 6 0 1 0 5.65 4H12.4A4.8 4.8 0 1 1 12.2 5H9.5v1.6L6.3 4 9.5 1.4V3h2.7A6 6 0 0 0 8 2z" /></svg>
              </button>
            </div>
          </div>
          <div className="office-list">
            {files.length === 0 ? (
              <div className="files-empty">{t("Office_NoFiles")}</div>
            ) : files.map((p) => {
              const isActive = p === active;
              const k = officeKindOf(p);
              return (
                <div
                  key={p}
                  className={"office-row" + (isActive ? " active" : "")}
                  title={p}
                  onClick={() => void openFile(p)}
                >
                  <span className={"office-ext k-" + (k ?? "")}>{officeExtLabel(p)}</span>
                  <span className="office-nm">
                    <span className="nm">{nameOf(p)}</span>
                    {dirOf(p) && <span className="dir">{dirOf(p)}</span>}
                  </span>
                </div>
              );
            })}
          </div>
          {files.length > 0 && <div className="office-count">{t("Office_FileCount", files.length)}</div>}
        </div>
      </div>
      <div
        className="files-gutter"
        title={t("Files_GutterHint")}
        onPointerDown={onGutterDown}
        onPointerMove={onGutterMove}
        onPointerUp={onGutterUp}
        onLostPointerCapture={onGutterUp}
        onDoubleClick={() => {
          setWidth(SIDEBAR_DEFAULT);
          window.localStorage.setItem(SIDEBAR_KEY, String(SIDEBAR_DEFAULT));
        }}
      />
      <div className="files-main">
        {!active ? (
          <div className="office-welcome">
            <div className="edwm">GITTER</div>
            <div className="list">
              <div className="h">{t("Office_WelcomeTitle")}</div>
              <div className="wrow"><span className="nm2">{t("Office_WelcomeHint")}</span></div>
              <div className="wrow"><span className="nm2">{t("Office_PhaseNote")}</span></div>
            </div>
          </div>
        ) : (
          <>
            <div className="office-headbar">
              <span className="fico">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2.5h12v11H2v-11zm1.5 1.5v8h9v-8h-9zM5 6h6v1.2H5V6zm0 2.6h4v1.2H5V8.6z" /></svg>
              </span>
              <span className="nm" title={active}>{nameOf(active)}</span>
              <div className="right">
                {size != null && <span className="it">{formatSize(size)}</span>}
                {pageCount != null && <span className="it">{t("Office_PageCount", pageCount)}</span>}
                <button className="tool-btn" onClick={openExternal}>
                  {t("Office_ExternalOpen")}
                </button>
              </div>
            </div>
            <div className="office-canvas">
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
                  <div className="edwm">{kind ? officeExtLabel(active) : "FILE"}</div>
                  <div className="list" style={{ alignItems: "flex-start" }}>
                    <div className="h">{nameOf(active)}</div>
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
                  key={`${active}:${nonce}`}
                  path={active}
                  renderer={renderer}
                  name={nameOf(active)}
                  payload={payload}
                  dark={dark}
                  timeoutMessage={t("Office_PreviewTimeout")}
                  onDone={onPreviewDone}
                  onError={onPreviewError}
                />
              )}
              {(phase === "loading" || phase === "rendering") && (
                <div className="office-loading">{t("Office_Loading")}</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * sandbox iframe 预览容器：srcdoc 装静态运行时，postMessage 握手
 * （ready → render → done|error）。sandbox="allow-scripts"（无 allow-same-origin）
 * → opaque origin，iframe 内代码摸不到宿主 DOM/localStorage；超时兜底防挂死。
 */
function PreviewFrame(props: {
  path: string;
  renderer: PreviewRenderer;
  name: string;
  payload: Payload;
  dark: boolean;
  timeoutMessage: string;
  onDone: (info: { pages?: number; sheets?: string[] }) => void;
  onError: (message: string) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const sentRef = useRef(false);
  const settledRef = useRef(false);
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
  const timeoutMsgRef = useRef(props.timeoutMessage);
  timeoutMsgRef.current = props.timeoutMessage;

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
      const msg = ev.data as { source?: string; type?: string; message?: string; info?: { pages?: number; sheets?: string[] } };
      if (!msg || msg.source !== PREVIEW_MSG_SRC) return;
      if (msg.type === "ready" && !sentRef.current) {
        sentRef.current = true;
        iframeRef.current?.contentWindow?.postMessage({
          source: PREVIEW_MSG_SRC,
          type: "render",
          id: 1,
          renderer: rendererRef.current,
          name: nameRef.current,
          dark: darkRef.current,
          base64: payloadRef.current.base64,
          text: payloadRef.current.text,
        }, "*");
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
      srcDoc={SRCDOC}
    />
  );
}
