/**
 * Office 文档页（office-integration-plan.md §10 预览-only）：
 * 左侧项目内 Office 文件列表（repo.tree 按扩展名白名单过滤）+ 右侧 iframe 预览。
 * 预览渲染库内联在 sandbox iframe（opaque origin）文档内，与宿主零样式/异常交集；
 * 宿主只管列表、顶栏（体积/页数/外部打开）、加载态与错误兜底卡（§10.5）。
 * 编辑一律交给外部应用（shell.openPath）——页内不回写字节。
 * 字节通道：pdf/docx/pptx/xlsx/ods 走 file.readBinary（base64），csv/tsv 走 file.content（文本）。
 * iframe 容器/缩放档位与文件页画布查看器共用 officeDocPreview.tsx。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pageSdk, useAppState } from "../pageSdk";
import {
  formatSize, isTextChannelKind, officeExtLabel, officeKindOf, previewerOf,
} from "./officeShared";
import {
  PreviewFrame, ZOOM_STEPS, zoomStep,
  type Payload, type PreviewPhase, type PreviewRenderer,
} from "./officeDocPreview";
import { RefreshIcon } from "./filesIcons";
import { absPathOf } from "./filesPaths";

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
  const [phase, setPhase] = useState<PreviewPhase>("loading");
  const [payload, setPayload] = useState<Payload | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [width, setWidth] = useState(loadWidth);
  const [nonce, setNonce] = useState(0);
  const [zoom, setZoom] = useState(1);

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
    setZoom(1);
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
    if (active && repo) void pageSdk.call("shell.openPath", { path: absPathOf(repo.workDir, active), editor: true });
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
                <RefreshIcon />
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
                {phase !== "legacy" && phase !== "error" && (
                  <span className="office-zoom">
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
                  </span>
                )}
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
                  zoom={zoom}
                  onZoomDelta={(dir) => setZoom((z) => zoomStep(z, dir))}
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
