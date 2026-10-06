import { useEffect, useRef, useState, type ReactNode } from "react";
import { t } from "../state/store";

/** 自绘模态对话框（替代 ContentDialog）。Escape 关闭，Enter 确认（单输入场景）。 */
export function Modal(props: {
  title: string;
  children: ReactNode;
  confirmText: string;
  cancelText?: string;
  confirmDisabled?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal">
        <h3>{props.title}</h3>
        <div className="modal-body">{props.children}</div>
        <div className="modal-actions">
          <button className="tool-btn" onClick={props.onClose}>{props.cancelText ?? t("Common_Cancel")}</button>
          <button
            className={"tool-btn" + (props.danger ? "" : " primary")}
            style={props.danger ? { background: "var(--c-red)", color: "#fff", fontWeight: 600 } : undefined}
            disabled={props.confirmDisabled}
            onClick={props.onConfirm}
          >
            {props.confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export interface CtxMenuItem {
  label: string;
  action: () => void;
  sep?: boolean;
}

/** 轻量右键菜单：showMenu(e, items)。点击外部/Esc 关闭。 */
export function useContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: CtxMenuItem[] } | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const showMenu = (e: React.MouseEvent, items: CtxMenuItem[]) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const element = menu ? (
    <div className="ctxmenu" ref={ref} style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
      {menu.items.map((it, i) =>
        it.sep ? <div className="sep" key={i} /> : (
          <button key={i} onClick={() => { setMenu(null); it.action(); }}>{it.label}</button>
        ),
      )}
    </div>
  ) : null;

  return { showMenu, menuElement: element };
}

/**
 * 横幅（错误/transient/反馈），替代 InfoBar 与 TextBlock 横幅。可带动作按钮（如"设置上游并推送"）。
 * R2.1：可展开（长文本/detail 单行省略 → 展开 whole 内容）+ detail 可跳转
 * （onOpenDetail：如反馈文件路径 → 外部编辑器打开，点击直达具体问题）。
 */
export function Banner(props: {
  text: string;
  detail?: string;
  error?: boolean;
  onCopyDetail?: () => void;
  onClose?: () => void;
  actions?: { label: string; onClick: () => void }[];
  /** detail 可跳转时的动作（如文件路径 → shell.openPath editor:true）；提供后 detail 渲染为可点链接 */
  onOpenDetail?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const expandable = !!props.detail || props.text.length > 120;
  const clickable = !!props.onOpenDetail;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div className={"banner" + (props.error ? " error" : "")} style={open ? { alignItems: "flex-start" } : undefined}>
      {expandable && (
        <button
          className="tool-btn"
          style={{ padding: "0 2px", minWidth: 18 }}
          title={open ? t("Common_Collapse") : t("Common_Expand")}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "▾" : "▸"}
        </button>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="banner-text"
          style={open ? { whiteSpace: "normal", wordBreak: "break-word" } : undefined}
        >
          {props.text}
        </div>
        {props.detail && !open && (
          <div
            className={"banner-detail" + (clickable ? " clickable" : "")}
            style={{ maxHeight: 18, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            onClick={props.onOpenDetail}
            title={clickable ? t("Common_OpenDetails") : props.detail}
          >
            {props.detail}
          </div>
        )}
        {props.detail && open && (
          <div
            className={"banner-detail" + (clickable ? " clickable" : "")}
            style={{ maxHeight: 240, marginTop: 4 }}
            onClick={props.onOpenDetail}
            title={clickable ? t("Common_OpenDetails") : undefined}
          >
            {props.detail}
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none", alignSelf: open ? "flex-start" : undefined }}>
        {props.detail && props.onCopyDetail && (
          <button className="tool-btn" onClick={(e) => { stop(e); props.onCopyDetail!(); }}>{t("Common_CopyDetails")}</button>
        )}
        {props.actions?.map((a) => (
          <button key={a.label} className="tool-btn" onClick={a.onClick}>{a.label}</button>
        ))}
        {props.onClose && <button className="tool-btn" onClick={props.onClose}>✕</button>}
      </div>
    </div>
  );
}
