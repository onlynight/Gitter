/**
 * Office 文档页（office-integration-plan.md §10 预览-only 骨架）：
 * 左侧项目内 Office 文件列表（repo.tree 按扩展名白名单过滤）+ 右侧预览区。
 * 本提交为骨架：列表 + 顶栏（用外部程序打开）+ 预览兜底卡；
 * 各格式页内预览按 §10.6 分阶段接入（iframe 文档隔离，pdf/docx/xlsx·ods/csv·tsv，pptx 试做）。
 * 编辑一律交给外部应用（shell.openPath）——页内不回写字节。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pageSdk, useAppState } from "../pageSdk";
import { officeExtLabel, officeKindOf } from "./officeShared";

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
  const [width, setWidth] = useState(loadWidth);

  const activeRef = useRef<string | null>(null);
  activeRef.current = active;

  const kind = useMemo(() => (active ? officeKindOf(active) : null), [active]);
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
                  onClick={() => setActive(p)}
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
                <button className="tool-btn" onClick={openExternal}>
                  {t("Office_ExternalOpen")}
                </button>
              </div>
            </div>
            <div className="office-canvas">
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
            </div>
          </>
        )}
      </div>
    </div>
  );
}
