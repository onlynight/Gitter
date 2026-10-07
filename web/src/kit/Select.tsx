import { useEffect, useRef, useState, type CSSProperties } from "react";

/**
 * 自绘下拉选择（与右键菜单 .ctxmenu 同视觉：panel2 实底 + 边框 + 阴影，磨砂材质下
 * 走弹出悬浮层实底规则）。原生 <select> 的弹出列表由 Chromium 按 select 底色绘制，
 * 磨砂窗口下无法做成实底/统一样式，故全部下拉一律使用本组件。
 * 触发器：无边框 + 右侧箭头 + hover 圆角底；弹层：键盘 ↑↓/Enter/Esc、外点关闭、
 * 选中项高亮并滚入视野、空间不足自动上翻。
 */
export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
}

export function Select<T extends string = string>(props: {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  style?: CSSProperties;
  className?: string;
  title?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const [dropUp, setDropUp] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) { setOpen(false); setHi(-1); }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const idx = props.options.findIndex((o) => o.value === props.value);
    setHi(idx);
    const el = wrapRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setDropUp(window.innerHeight - rect.bottom < 264 && rect.top > 264);
    }
    const list = listRef.current;
    if (list && idx >= 0) (list.children[idx] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const commit = (v: T) => { props.onChange(v); setOpen(false); setHi(-1); };
  const move = (d: number) => setHi((h) => {
    const n = props.options.length;
    return n === 0 ? h : (((h ?? 0) + d) % n + n) % n;
  });

  return (
    <div
      ref={wrapRef}
      className={"select-wrap" + (props.className ? " " + props.className : "")}
      style={{ position: "relative", display: "inline-block", ...props.style }}
    >
      <button
        type="button"
        className="select-trigger"
        aria-expanded={open}
        title={props.title}
        disabled={props.disabled}
        onClick={() => { if (!props.disabled) { setOpen(!open); setHi(-1); } }}
        onKeyDown={(e) => {
          if (props.disabled) return;
          if (!open) {
            if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); }
            return;
          }
          if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
          else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
          else if (e.key === "Enter" && hi >= 0) { e.preventDefault(); commit(props.options[hi].value); }
          else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
        }}
      >
        <span className="select-trigger-label">{props.options.find((o) => o.value === props.value)?.label ?? props.value}</span>
      </button>
      {open && (
        <div ref={listRef} className={"select-pop" + (dropUp ? " up" : "")} role="listbox">
          {props.options.map((o, i) => (
            <button
              type="button"
              key={o.value}
              role="option"
              aria-selected={o.value === props.value}
              className={"select-opt" + (o.value === props.value ? " sel" : "") + (i === hi ? " hi" : "")}
              onMouseEnter={() => setHi(i)}
              onClick={() => commit(o.value)}
            >
              <span className="select-opt-check">{o.value === props.value ? "✓" : ""}</span>
              <span className="select-opt-label">{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
