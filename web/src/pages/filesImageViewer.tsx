/**
 * 文件页图片预览查看器（filesViewers 画布 seam 的图片适配器）：
 * 适配既有图片预览通道——file.readBinary（treex BINARY_IMAGE_EXTS 只读白名单，
 * 与任务面板预览同一 RPC）→ data URL → 原生 <img>；缩放档位/HUD/错误卡与
 * OfficeDocViewer 同一套样式语言（office-canvas 悬浮簇），只读不回写
 * （file.writeBinary 仍限 OOXML，编辑一律交外部应用）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { pageSdk } from "../pageSdk";
import { formatSize } from "./officeShared";
import { ZOOM_STEPS, zoomStep } from "./officeDocPreview";
import { absPathOf } from "./filesPaths";

/** 图片扩展名白名单（全小写含点）——与 treex BINARY_IMAGE_EXTS、任务面板 IMG_RE 同集 */
export const IMAGE_EXTS = [
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif", ".ico",
];

/** 扩展名 → data URL MIME（jpg/svg/ico 的规范写法；未知扩展兜底，交浏览器嗅探） */
export function imageMimeOf(path: string): string {
  const i = path.lastIndexOf(".");
  const ext = i >= 0 ? path.slice(i + 1).toLowerCase() : "";
  if (ext === "jpg") return "jpeg";
  if (ext === "svg") return "svg+xml";
  if (ext === "ico") return "x-icon";
  return ext || "octet-stream";
}

/** 缩放基于图片自然尺寸：fit = 完整放入画布的适配比例，显示尺寸 = 自然 × fit × zoom。
 *  比例由显式像素宽高保证（width% + max-height 钳制会拉变形），zoom=1 即适配窗口。 */
function fitScale(nat: { w: number; h: number }, stage: { w: number; h: number }): number {
  return Math.min(stage.w / nat.w, stage.h / nat.h);
}

/**
 * 图片画布查看器：填满编辑区画布（标签条/面包屑/页脚仍归 EditorPane），
 * 右上悬浮缩放簇 + 体积 + 外部打开。缩放语义与 office HUD 一致——100% = 适配画布，
 * 档位乘数作用于适配尺寸；放大超出画布可滚动（scrollbar-gutter 预留防抖动），
 * ≥3 档像素化显示便于查锯齿。key=path 重挂即换文件——载荷竞态用 stale 标记丢弃。
 */
export function ImageFileViewer(props: { path: string }) {
  const t = pageSdk.t;
  const repo = pageSdk.repo();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [stage, setStage] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [nonce, setNonce] = useState(0);
  const [errorMsg, setError] = useState<string | null>(null);
  const phase: "loading" | "ready" | "error" = errorMsg ? "error" : dataUrl ? "ready" : "loading";

  const name = props.path.split("/").pop() ?? props.path;

  // 打开/重试：stat（体积）+ readBinary（base64）并行；超 50MB 后端 truncated
  useEffect(() => {
    let stale = false;
    setDataUrl(null);
    setNatural(null);
    setSize(null);
    setZoom(1);
    (async () => {
      try {
        const [st, r] = await Promise.all([
          pageSdk.call<{ size: number } | null>("file.stat", { path: props.path }),
          pageSdk.call<{ base64: string; size: number; truncated: boolean } | null>(
            "file.readBinary", { path: props.path }),
        ]);
        if (stale) return;
        if (!r) throw new Error(t("Files_Missing"));
        if (r.truncated) throw new Error(t("Files_ImgTooLarge"));
        setSize(st?.size ?? r.size);
        setDataUrl(`data:image/${imageMimeOf(props.path)};base64,${r.base64}`);
      } catch (e) {
        if (stale) return;
        setError((e as Error).message);
      }
    })();
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.path, nonce]);

  // 画布尺寸：面板拖宽/窗口缩放跟随（RO 初次 observe 必回调一次，首测即得）
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setStage((prev) => {
        const next = { w: el.clientWidth, h: el.clientHeight };
        return prev && prev.w === next.w && prev.h === next.h ? prev : next;
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [dataUrl]);

  const onImgLoad = useCallback((e: { currentTarget: HTMLImageElement }) => {
    const img = e.currentTarget;
    setNatural((prev) => {
      const next = { w: img.naturalWidth || 1, h: img.naturalHeight || 1 };
      return prev && prev.w === next.w && prev.h === next.h ? prev : next;
    });
  }, []);

  // data URL 解码可能快于 React 事件委托挂载——load 已错过时 ref 回调补读 complete 态
  const imgRef = useCallback((el: HTMLImageElement | null) => {
    if (el && el.complete && el.naturalWidth > 0) {
      setNatural((prev) => {
        const next = { w: el.naturalWidth, h: el.naturalHeight };
        return prev && prev.w === next.w && prev.h === next.h ? prev : next;
      });
    }
  }, []);

  const openExternal = useCallback(() => {
    if (repo) void pageSdk.call("shell.openPath", { path: absPathOf(repo.workDir, props.path) });
  }, [repo, props.path]);

  // 显式像素尺寸（未测得前先按 CSS max 双向 100% 适配，测到即换算——避免首帧塌陷）
  const disp = natural && stage
    ? (() => {
      const scale = fitScale(natural, stage) * zoom;
      return { w: Math.max(1, Math.round(natural.w * scale)), h: Math.max(1, Math.round(natural.h * scale)) };
    })()
    : null;
  const pixelated = zoom >= 3 ? "pixelated" : undefined;

  return (
    <div className="office-canvas" style={{ position: "absolute", inset: 0 }}>
      {phase === "error" ? (
        <div className="office-welcome">
          <div className="edwm">!</div>
          <div className="list" style={{ alignItems: "flex-start" }}>
            <div className="h">{t("Files_ImgFailed")}</div>
            <div className="wrow" style={{ height: "auto", whiteSpace: "normal" }}>
              <span className="nm2">{errorMsg}</span>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="tool-btn primary" onClick={() => setError(null)}>{t("Files_Retry")}</button>
              <button className="tool-btn" onClick={openExternal}>{t("Files_ExternalOpen")}</button>
            </div>
          </div>
        </div>
      ) : dataUrl ? (
        <div className="imgview-stage imgview-checker" ref={stageRef}>
          {disp ? (
            <div className="imgview-frame" style={{ width: disp.w, height: disp.h }}>
              <img ref={imgRef} src={dataUrl} alt={name} onLoad={onImgLoad} style={{ imageRendering: pixelated }} />
            </div>
          ) : (
            <img className="imgview-fit" ref={imgRef} src={dataUrl} alt={name} onLoad={onImgLoad} />
          )}
        </div>
      ) : null}
      {phase === "loading" && <div className="office-loading">Loading…</div>}
      {phase === "ready" && (
        <div className="ed-office-hud">
          {size != null && <span className="it">{formatSize(size)}</span>}
          <button
            className="files-ibtn"
            title={t("Files_ZoomOut")}
            disabled={zoom <= ZOOM_STEPS[0]}
            onClick={() => setZoom((z) => zoomStep(z, -1))}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.4" fill="none"><path d="M1.5 6h9" /></svg>
          </button>
          <button className="office-zoom-pct" title={t("Files_ZoomReset")} onClick={() => setZoom(1)}>
            {Math.round(zoom * 100)}%
          </button>
          <button
            className="files-ibtn"
            title={t("Files_ZoomIn")}
            disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
            onClick={() => setZoom((z) => zoomStep(z, 1))}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.4" fill="none"><path d="M6 1.5v9M1.5 6h9" /></svg>
          </button>
          <button className="files-ibtn" title={t("Files_ExternalOpen")} onClick={openExternal}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M6.5 3.5H4A1.5 1.5 0 0 0 2.5 5v7A1.5 1.5 0 0 0 4 13.5h7a1.5 1.5 0 0 0 1.5-1.5V9.5M9 2.5h4.5V7M13 3 7.5 8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
