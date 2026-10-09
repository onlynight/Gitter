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
  /** 覆盖默认 440px 宽度（多列/多行表单用） */
  width?: number | string;
  /** 附加类名（如 .modal-wide：放宽内边距与圆角） */
  className?: string;
  /** 标题栏右侧内容（如探测状态徽标） */
  titleAside?: ReactNode;
  /** 替换确认/取消按钮内容（如图标 √/×）；悬停提示仍用 confirmText/cancelText */
  confirmContent?: ReactNode;
  cancelContent?: ReactNode;
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
      <div className={"modal" + (props.className ? " " + props.className : "")} style={props.width ? { width: props.width } : undefined}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <h3 style={{ flex: 1, minWidth: 0 }}>{props.title}</h3>
          {props.titleAside}
        </div>
        <div className="modal-body">{props.children}</div>
        <div className="modal-actions">
          <button className="tool-btn" title={props.cancelText ?? t("Common_Cancel")} aria-label={props.cancelText ?? t("Common_Cancel")}
            style={props.cancelContent ? { minWidth: 28, padding: 0 } : undefined}
            onClick={props.onClose}>{props.cancelContent ?? props.cancelText ?? t("Common_Cancel")}</button>
          <button
            className={"tool-btn" + (props.danger ? "" : " primary")}
            style={props.danger
              ? { background: "var(--c-red)", color: "#fff", fontWeight: 600 }
              : (props.confirmContent ? { minWidth: 28, padding: 0 } : undefined)}
            title={props.confirmText} aria-label={props.confirmText}
            disabled={props.confirmDisabled}
            onClick={props.onConfirm}
          >
            {props.confirmContent ?? props.confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export interface CtxMenuItem {
  /** sep 项可省略 */
  label?: string;
  action?: () => void;
  sep?: boolean;
  /** 左侧图标（可选，16px 线性 SVG） */
  icon?: ReactNode;
  /** 右侧键位提示（可选，等宽小字） */
  hint?: string;
  disabled?: boolean;
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
          <button
            key={i}
            className={it.disabled ? "dis" : undefined}
            disabled={it.disabled}
            onClick={() => {
              if (it.disabled) return;
              setMenu(null);
              it.action?.();
            }}
          >
            {it.icon ? <span className="ico">{it.icon}</span> : null}
            <span className="lb">{it.label}</span>
            {it.hint ? <span className="hint">{it.hint}</span> : null}
          </button>
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
