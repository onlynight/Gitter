import { useEffect, useRef, useState, type CSSProperties } from "react";
import { t } from "../state/store";

/**
 * 自绘下拉选择（与右键菜单 .ctxmenu 同视觉：panel2 实底 + 边框 + 阴影，磨砂材质下
 * 走弹出悬浮层实底规则）。原生 <select> 的弹出列表由 Chromium 按 select 底色绘制，
 * 磨砂窗口下无法做成实底/统一样式，故全部下拉一律使用本组件。
 * 触发器：无边框 + 右侧箭头 + hover 圆角底；弹层：键盘 ↑↓/Enter/Esc、外点关闭、
 * 选中项高亮并滚入视野、空间不足自动上翻。
 *
 * 可选扩展（创建分支起点选择器等大数据场景，ui-design create-branch-select）：
 * - searchable：弹层顶部搜索框，关键字「包含」匹配（大小写不敏感，命中高亮），
 *   pinned 项置顶且不受过滤；键盘搜索框内 ↑↓/Enter。
 * - tabs + activeTab + onTabChange：type tab（如 分支/标签），选项用 option.tab 归属；
 *   tab 标题实时显示各自命中数；打开弹层时自动定位到当前选中值所在 tab。
 * - option.group：同组连续渲染为粘性组头（空组不渲染）；option.pinned 项不进分组头。
 * - option.hint / option.badge：右侧短 SHA / 徽标；option.triggerBadge：触发器类型徽标。
 * - freeTextTab：指定某 tab 支持自由文本（如提交 id——无法枚举只能输入）：该 tab 下
 *   搜索框输入后回车/点击置顶的「使用：<kw>」项即采用输入值；值无对应选项时触发器
 *   直接显示原始值。
 */
export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  /** 分组头（同组连续渲染为一组）；缺省 = 不进分组 */
  group?: string;
  /** 右侧 hint（短 SHA 等，等宽字体） */
  hint?: string;
  /** 右侧徽标文字（如 tag） */
  badge?: string;
  /** 钉住：置顶显示且不受搜索过滤（仅 searchable 时有意义） */
  pinned?: boolean;
  /** 搜索附加匹配串（如 HEAD 项带上当前分支名） */
  keywords?: string;
  /** 所属 type tab（props.tabs 存在时必填） */
  tab?: string;
  /** 触发器类型徽标（选中后显示在名称前） */
  triggerBadge?: "tag" | "head" | "branch";
}

export function Select<T extends string = string>(props: {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  style?: CSSProperties;
  className?: string;
  title?: string;
  disabled?: boolean;
  /** 弹层顶部搜索框（关键字包含匹配） */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** type tab 定义（option.tab 归属；命中数实时显示在 tab 上） */
  tabs?: { key: string; label: string }[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
  /** 过滤后无匹配的空态文案 */
  emptyText?: string;
  /** value 无匹配选项时的触发器占位文案 */
  placeholder?: string;
  /** 自由文本 tab：该 tab 下搜索框输入可经回车/置顶项直接采用（提交 id 等不可枚举值） */
  freeTextTab?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const [dropUp, setDropUp] = useState(false);
  const [kw, setKw] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const tabs = props.tabs;
  const activeTab = tabs ? (props.activeTab ?? tabs[0]?.key) : undefined;

  // ---- 过滤：tab 归属 + 关键字包含（pinned 豁免）----
  const matches = (o: SelectOption<T>) => {
    if (!kw) return true;
    if (o.pinned) return true;
    const hay = (o.label + " " + (o.keywords ?? "")).toLowerCase();
    return hay.includes(kw.toLowerCase());
  };
  const tabItems = (key: string) => props.options.filter((o) => o.tab === key && matches(o));
  const visible = tabs
    ? tabItems(activeTab ?? "")
    : props.options.filter(matches);

  // 自由文本态：当前 tab 支持且搜索框有输入 → 置顶「使用：<kw>」项 + 回车采用
  const freeText = !!(props.searchable && props.freeTextTab && activeTab === props.freeTextTab && kw.trim());

  // ---- 高亮：首个大小写不敏感命中片段（HTML 转义后注入 mark）----
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const highlight = (label: string) => {
    if (!kw) return esc(label);
    const i = label.toLowerCase().indexOf(kw.toLowerCase());
    if (i < 0) return esc(label);
    return esc(label.slice(0, i)) + "<mark>" + esc(label.slice(i, i + kw.length)) + "</mark>" + esc(label.slice(i + kw.length));
  };

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
    const idx = visible.findIndex((o) => o.value === props.value);
    setHi(idx);
    const el = wrapRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setDropUp(window.innerHeight - rect.bottom < 320 && rect.top > 320);
    }
    // 可搜索弹层：打开即聚焦搜索框
    if (props.searchable) searchRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const commit = (v: T) => { props.onChange(v); setOpen(false); setHi(-1); };
  const move = (d: number) => setHi((h) => {
    const n = visible.length;
    return n === 0 ? h : (((h ?? 0) + d) % n + n) % n;
  });

  // ---- 弹层列表渲染：自由文本项置顶 + pinned 置顶（不进组头）+ 分组 ----
  const renderItems = () => {
    let html = "";
    if (freeText) {
      html += `<button type="button" data-v="${esc(kw.trim())}" role="option" class="select-opt free"><span class="select-opt-check">→</span><span class="select-opt-label">${esc(t("Select_UseValue", kw.trim()))}</span></button>`;
    }
    for (const it of visible.filter((x) => x.pinned)) {
      const sel = it.value === props.value;
      html += itemHtml(it, sel);
    }
    let groups: { name: string; items: SelectOption<T>[] }[] = [];
    for (const it of visible.filter((x) => !x.pinned)) {
      const g = it.group;
      if (!g) { html += itemHtml(it, it.value === props.value); continue; }
      let bucket = groups.find((x) => x.name === g);
      if (!bucket) { bucket = { name: g, items: [] }; groups.push(bucket); }
      bucket.items.push(it);
    }
    for (const g of groups) {
      html += `<div class="select-group">${g.name} <span style="font-weight:400">· ${g.items.length}</span></div>`;
      for (const it of g.items) html += itemHtml(it, it.value === props.value);
    }
    if (visible.filter((x) => !x.pinned).length === 0 && visible.filter((x) => x.pinned).length === 0) {
      if (!freeText) html += `<div class="select-empty">${props.emptyText ?? t("Select_Empty")}</div>`;
    } else if (visible.length === 0) {
      // 只剩 pinned 项（分支 tab 搜索无命中）也要给空态提示
      html += `<div class="select-empty">${props.emptyText ?? t("Select_Empty")}</div>`;
    }
    return { __html: html };
  };

  const itemHtml = (it: SelectOption<T>, sel: boolean) => {
    const badge = it.badge ? `<span class="opt-badge">${esc(it.badge)}</span>` : "";
    const hint = it.hint ? `<span class="opt-hint">${esc(it.hint)}</span>` : "";
    return `<button type="button" data-v="${esc(it.value)}" role="option" aria-selected="${sel}" class="select-opt${sel ? " sel" : ""}${it === visible[hi] ? " hi" : ""}"><span class="select-opt-check">${sel ? "✓" : ""}</span><span class="select-opt-label">${highlight(it.label)}</span>${hint}${badge}</button>`;
  };

  // 触发器：当前值 → 选项；无匹配 → 占位文案
  const current = props.options.find((o) => o.value === props.value);
  const badgeText = current?.triggerBadge === "tag" ? "TAG" : current?.triggerBadge === "head" ? "HEAD" : current?.triggerBadge === "branch" ? t("Common_Branch") : "";

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
        onClick={() => {
          if (props.disabled) return;
          const next = !open;
          setOpen(next);
          setHi(-1);
          // 打开时 tab 跟随当前选中值所在类型
          if (next && tabs && props.onTabChange) {
            const cur = props.options.find((o) => o.value === props.value);
            if (cur?.tab && cur.tab !== activeTab) props.onTabChange(cur.tab);
          }
          if (next && props.searchable) setKw("");
        }}
        onKeyDown={(e) => {
          if (props.disabled) return;
          if (!open) {
            if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); setHi(-1); }
            return;
          }
          if (props.searchable) return; // 可搜索弹层的键盘在搜索框内处理
          if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
          else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
          else if (e.key === "Enter" && hi >= 0 && visible[hi]) { e.preventDefault(); commit(visible[hi].value); }
          else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
        }}
      >
        {current?.triggerBadge && badgeText ? (
          <span className={"trigger-badge" + (current.triggerBadge === "tag" ? " tag" : "")}>{badgeText}</span>
        ) : null}
        <span className="select-trigger-label">
          {current
            ? open ? highlight(current.label) : esc(current.label)
            : props.value
              ? props.value
              : props.placeholder
                ? <span className="placeholder">{props.placeholder}</span>
                : null}
        </span>
      </button>
      {open && (
        <div ref={listRef} className={"select-pop" + (dropUp ? " up" : "")} role="listbox">
          {props.searchable && (
            <div className="pop-search">
              <input
                ref={searchRef}
                value={kw}
                placeholder={props.searchPlaceholder ?? t("Select_SearchPlaceholder")}
                onChange={(e) => { setKw(e.target.value); setHi(-1); }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
                  else if (e.key === "Enter") {
                    e.preventDefault();
                    if (hi >= 0 && visible[hi]) commit(visible[hi].value);
                    else if (freeText) commit(kw.trim() as T);
                  }
                  else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
                }}
              />
            </div>
          )}
          {tabs && (
            <div className="pop-tabs">
              {tabs.map((tb) => {
                const n = props.options.filter((o) => o.tab === tb.key && matches(o)).length;
                return (
                  <button
                    type="button"
                    key={tb.key}
                    className={"pop-tab" + (tb.key === activeTab ? " active" : "")}
                    onClick={() => { props.onTabChange?.(tb.key); setHi(-1); }}
                  >
                    {tb.label} <span className="cnt">{n}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div
            className="pop-list"
            onClick={(e) => {
              const b = (e.target as HTMLElement).closest("[data-v]") as HTMLElement | null;
              if (b) commit(b.dataset.v as T);
            }}
            dangerouslySetInnerHTML={renderItems()}
          />
        </div>
      )}
    </div>
  );
}
