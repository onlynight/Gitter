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

/** 横幅（错误/transient），替代 InfoBar 与 TextBlock 横幅。可带动作按钮（如"设置上游并推送"）。 */
export function Banner(props: {
  text: string;
  detail?: string;
  error?: boolean;
  onCopyDetail?: () => void;
  onClose?: () => void;
  actions?: { label: string; onClick: () => void }[];
}) {
  return (
    <div className={"banner" + (props.error ? " error" : "")}>
      <span className="banner-text">{props.text}</span>
      {props.detail && <span className="banner-detail">{props.detail}</span>}
      {props.onCopyDetail && (
        <button className="tool-btn" onClick={props.onCopyDetail}>{t("Common_CopyDetails")}</button>
      )}
      {props.actions?.map((a) => (
        <button key={a.label} className="tool-btn" onClick={a.onClick}>{a.label}</button>
      ))}
      {props.onClose && <button className="tool-btn" onClick={props.onClose}>✕</button>}
    </div>
  );
}
