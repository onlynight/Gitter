import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * 浮动滚动区（Win11 覆盖式滚动条）：隐藏原生滚动条（其 gutter 会裁剪行背景、
 * 磨砂材质下形成右缘白板），渲染一条悬浮半透明滚动条——滚动/hover 时显现、
 * 800ms 无操作自动隐藏，支持拖拽直连。视觉随主题（--c-text3 半透明）。
 * 结构约束：滚动条必须是滚动元素（.scroll-area-view）的兄弟而非子节点——
 * 绝对定位子元素会跟随内容滚走（视觉位置 = top - scrollTop），指示条一滚就漂出可视区。
 */
export function ScrollArea(props: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** 暴露滚动元素给调用方（虚拟滚动等需要滚动元素的场合） */
  scrollRef?: { current: HTMLDivElement | null };
}) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [bar, setBar] = useState<{ top: number; height: number } | null>(null);
  const [scrolling, setScrolling] = useState(false);
  const hideTimer = useRef<number | null>(null);

  const update = () => {
    const el = innerRef.current;
    if (!el) return;
    if (el.scrollHeight <= el.clientHeight + 1) { setBar(null); return; }
    const track = el.clientHeight - 8;
    const h = Math.max(40, (track * el.clientHeight) / el.scrollHeight);
    const t = 4 + ((track - h) * el.scrollTop) / (el.scrollHeight - el.clientHeight);
    setBar({ top: t, height: h });
  };

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const onScroll = () => {
      update();
      setScrolling(true);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setScrolling(false), 800);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    update();
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setRefs = (el: HTMLDivElement | null) => {
    innerRef.current = el;
    if (props.scrollRef) props.scrollRef.current = el;
  };

  const startDrag = (e: React.PointerEvent) => {
    const el = innerRef.current;
    if (!el || !bar) return;
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startTop = el.scrollTop;
    const ratio = el.scrollHeight / el.clientHeight;
    const move = (ev: PointerEvent) => { el.scrollTop = startTop + (ev.clientY - startY) * ratio; };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      className={"scroll-area" + (scrolling ? " scrolling" : "") + (props.className ? " " + props.className : "")}
      style={props.style}
    >
      <div ref={setRefs} className="scroll-area-view">
        {props.children}
      </div>
      {bar && (
        <div
          className="scroll-area-bar"
          style={{ top: bar.top, height: bar.height }}
          onPointerDown={startDrag}
        />
      )}
    </div>
  );
}
