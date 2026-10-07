import { useRef, useState, type ReactNode } from "react";
import { updateSettings, useApp } from "../state/store";
import type { SettingsDTO } from "../bridge/types";

/**
 * 可拖拽分割容器（替代 WinUI 的 PaneDivider + 拖拽/持久化逻辑）：
 * 指针拖动实时更新两侧 fr 比例；拖动结束把比例持久化到 settings
 * （logSplitterFraction / changesSplitterFraction，跨会话回放）。
 * R0-6：persist 键从字面量联合开放为 string（插件页面可用自己的键命名空间）。
 */
export function SplitPane(props: {
  /** true = 上下分（行）；默认左右分（列） */
  vertical?: boolean;
  /** 持久化的设置字段（number 值）；null = 不持久化 */
  settingKey: string | null;
  /** 无持久化值时的初始比例（pane A 占比，0-1） */
  initial: number;
  min?: number;
  max?: number;
  a: ReactNode;
  b: ReactNode;
}) {
  const app = useApp();
  const min = props.min ?? 0.15;
  const max = props.max ?? 0.85;
  const saved = props.settingKey
    ? ((app.settings as unknown as Record<string, number | null> | null)?.[props.settingKey] ?? null)
    : null;
  const [fraction, setFraction] = useState(() => clamp(saved ?? props.initial, min, max));
  const containerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startFraction: number; startPos: number; size: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    drag.current = {
      startFraction: fraction,
      startPos: props.vertical ? e.clientY : e.clientX,
      size: props.vertical ? rect.height : rect.width,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    (e.target as HTMLElement).classList.add("dragging");
    document.body.style.userSelect = "none";
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.size === 0) return;
    const delta = (props.vertical ? e.clientY : e.clientX) - d.startPos;
    setFraction(clamp(d.startFraction + delta / d.size, min, max));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    (e.target as HTMLElement).classList.remove("dragging");
    document.body.style.userSelect = "";
    setFraction((f) => {
      if (props.settingKey) void updateSettings({ [props.settingKey]: f } as Partial<SettingsDTO>);
      return f;
    });
  };

  // 拖动期间用 state 驱动；渲染恒以 fr 表达，grid 自适应窗口缩放（对齐 WinUI"按比例回放"语义）
  return (
    <div
      ref={containerRef}
      className={"split " + (props.vertical ? "split-h" : "split-v")}
      style={{ ["--split-a" as string]: `${fraction}fr`, ["--split-b" as string]: `${1 - fraction}fr` }}
    >
      {props.a}
      <div
        className="splitter"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onLostPointerCapture={onPointerUp}
        onDoubleClick={() => {
          setFraction(clamp(props.initial, min, max));
          if (props.settingKey) void updateSettings({ [props.settingKey]: props.initial } as Partial<SettingsDTO>);
        }}
      />
      {props.b}
    </div>
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
