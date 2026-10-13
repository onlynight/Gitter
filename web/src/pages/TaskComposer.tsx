/**
 * 任务页 composer（ZCode 中央输入框形态）：输入框 + 底部工具条（+ 附件 / 访问控制 /
 * 模型 / 思考深度 / 统计栏）与 @/斜杠弹层。由 TasksPage 消费。
 */
import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { call } from "../bridge/client";
import type { AgentContextStatsDTO } from "../bridge/types";
import { TlIcon, type TlIconName } from "./taskIcons";
import type { ComposerMentionProviderDef, TimelineCardCtx } from "../external/agentUIShim";

export function MentionPopover(props: {
  mention: { start: number; prefix: string; query: string } | null;
  items: { label: string; insert: string }[];
  onPick: (insert: string) => void;
  selectedIndex: number;
  onSelect: (idx: number) => void;
}) {
  const { mention, items, onPick, onSelect } = props;
  if (!mention || items.length === 0) return null;
  const sel = Math.max(0, Math.min(props.selectedIndex, items.length - 1));
  return (
    <div className="mention-pop" style={{ position: "absolute", bottom: "100%", left: 0, right: 0, marginBottom: 10, maxHeight: 180, overflowY: "auto", border: "1px solid var(--c-border)", borderRadius: 8, zIndex: 20 }}>
      {items.map((it, i) => (
        <div key={it.label}
          ref={(el) => { if (el && i === sel) el.scrollIntoView({ block: "nearest" }); }}
          style={{
            padding: "4px 10px", fontSize: 12, cursor: "pointer", borderRadius: 6,
            background: i === sel ? "var(--c-selected)" : "transparent",
            color: i === sel ? "var(--c-text)" : "var(--c-text2)",
          }}
          onMouseEnter={() => onSelect(i)}
          onMouseDown={(e) => { e.preventDefault(); onPick(it.insert); }}>
          {it.label}
        </div>
      ))}
    </div>
  );
}

/** 斜杠命令弹出层（输入 / 后自动出现，过滤匹配的命令列表）。 */
export function SlashPopover(props: {
  open: boolean;
  items: { name: string; hint: string; insert: string }[];
  onPick: (insert: string) => void;
  selectedIndex: number;
  onSelect: (idx: number) => void;
}) {
  if (!props.open || props.items.length === 0) return null;
  const sel = Math.max(0, Math.min(props.selectedIndex, props.items.length - 1));
  return (
    <div className="mention-pop" style={{ position: "absolute", bottom: "100%", left: 0, right: 0, marginBottom: 10, maxHeight: 240, overflowY: "auto", border: "1px solid var(--c-border)", borderRadius: 8, zIndex: 20 }}>
      {props.items.map((it, i) => (
        <div key={it.name}
          ref={(el) => { if (el && i === sel) el.scrollIntoView({ block: "nearest" }); }}
          style={{
            padding: "5px 10px", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, borderRadius: 6,
            background: i === sel ? "var(--c-selected)" : "transparent",
          }}
          onMouseEnter={() => props.onSelect(i)}
          onMouseDown={(e) => { e.preventDefault(); props.onPick(it.insert); }}>
          <span style={{ fontFamily: "var(--mono, monospace)", color: "var(--c-text)", fontWeight: 600, flex: "none" }}>{it.name}</span>
          <span style={{ color: "var(--c-text3)", fontSize: 11 }}>{it.hint}</span>
        </div>
      ))}
    </div>
  );
}


export const MODE_ORDER: ("plan" | "default" | "yolo")[] = ["plan", "default", "yolo"];
export const MODE_META: Record<string, { label: string; color: string }> = {
  plan: { label: "◇ 计划", color: "var(--c-chip-purple-fg, #b490ff)" },
  default: { label: "● 默认", color: "var(--c-text3)" },
  yolo: { label: "⚡ 完全访问", color: "var(--c-red)" },
};
export const THINKING_META: Record<"off" | "low" | "medium" | "high", { label: string; hint: string }> = {
  off: { label: "思考·关", hint: "跳过推理，响应最快" },
  low: { label: "思考·低", hint: "轻量推理，适合明确指令" },
  medium: { label: "思考·中", hint: "平衡推理与速度（默认）" },
  high: { label: "思考·高", hint: "深度推理，适合复杂设计" },
};


export interface ModelGroupVM {
  id: string;
  name: string;
  hint?: string;
  members: { id: string; name: string; sub?: string }[];
}

/** composer 底部工具条弹出菜单（ZCode 形态）：向上展开，点击外部/Esc 收起。
 * open 为 null 表示关闭；动画由 .comp-pop.open 的 opacity+transform 过渡负责。 */
export function CompPopover(props: {
  open: boolean;
  anchor: "left" | "right";
  /** 加宽变体（默认宽度的 2 倍）：内容多的面板用，如 + 附件/命令 */
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // 动态高度：向上展开的弹层按「视口顶 → 弹层底」的可用空间收顶（上限 320px），内容超高内部滚动
  const [maxH, setMaxH] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    // 关闭时不重置 maxHeight：收起动画期间保持原限高，否则高内容弹层（+ 附件/命令的
    // 宽版菜单，限高 320 内部滚动）会在淡出前瞬间撑回全内容高度——「先变大再消失」。
    // 重新打开时下方 measure() 会按当前视口重测（useLayoutEffect 先于绘制，无闪烁）。
    if (!props.open) return;
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setMaxH(Math.max(160, Math.min(320, r.bottom - 12)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [props.open]);
  useEffect(() => {
    if (!props.open) return;
    const h = (e: MouseEvent) => {
      // 点在切换钮（comp-item/comp-stats）上时不在此处关闭：交给钮的 click toggle，
      // 否则 mousedown 先关、click 再开 =「再点一下又展开了」
      const t = e.target as HTMLElement | null;
      if (ref.current && !ref.current.contains(t) && !t?.closest(".comp-item, .comp-stats")) props.onClose();
    };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); props.onClose(); } };
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [props.open, props.onClose]);
  return (
    <div ref={ref} className={"comp-pop" + (props.open ? " open" : "") + (props.wide ? " wide" : "") + (props.anchor === "right" ? " right" : "")}
      style={{ maxHeight: maxH, overflowY: maxH !== undefined ? "auto" : undefined }} aria-hidden={!props.open}>
      {props.children}
    </div>
  );
}

/** 工具条单条菜单项：当前项打勾，其余行只给背景反馈 */
export function CompOption(props: {
  icon?: TlIconName;
  color?: string;
  name: string;
  sub?: string;
  on: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  const { icon, color, name, sub, on, disabled, onSelect } = props;
  return (
    <div className={"comp-opt" + (on ? " on" : "") + (disabled ? "" : "")}
      style={disabled ? { opacity: 0.45, cursor: "default" } : undefined}
      onClick={() => { if (!disabled) onSelect(); }}>
      {icon ? <TlIcon name={icon} size={13} color={color} /> : <span style={{ width: 13, flex: "none" }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="comp-opt-name">{name}</div>
        {sub ? <div className="comp-opt-sub">{sub}</div> : null}
      </div>
      {on && <TlIcon name="check-circle" size={13} className="comp-check" color="var(--c-green)" />}
    </div>
  );
}

/** 任务页底部 composer（ZCode 中央输入框形态）——对话与新任务两处共用同一套工具条。
 * 工具条：+ 附件 / 访问控制（审批模式）/ 模型 / 思考深度 / 上下文用量 / 发送·停止。
 * 四个下拉均为真实功能入口（写回 agent.task.setMode / setModel / 续跑切换思考深度 / 上下文明细）。
 * forwardRef：React ≤18 不把 ref 作为 prop 传函数组件，自动增高与外部 focus 都依赖它。 */
export type ComposerProps = {
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  minH?: number;
  maxH: number;
  autoFocus?: boolean;
  busy: boolean;
  sending: boolean;
  canSend: boolean;
  sendTitle: string;
  onStop: () => void;
  onSend: () => void;
  mode: "plan" | "default" | "yolo";
  onMode: (m: "plan" | "default" | "yolo") => void;
  modeDisabled?: boolean;
  modeLabel: string;
  /** 两级模型选择：一级供应商（用户分组/包档案），二级组内具体模型 */
  groups: ModelGroupVM[];
  model: string;
  onModel: (id: string) => void;
  modelDisabled?: boolean;
  thinking: "off" | "low" | "medium" | "high";
  onThinking: (v: "off" | "low" | "medium" | "high") => void;
  stats: AgentContextStatsDTO | null;
  attachments?: { name: string; dataUrl: string; onRemove: () => void }[];
  attachmentHint?: string;
  onAttachImage: () => void;
  slash?: { name: string; hint: string; insert: string }[];
  onPickSlash: (insert: string) => void;
  children?: ReactNode;
};

export const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(function Composer(props, ref) {
  const { value, onChange, onKeyDown, placeholder, maxH } = props;
  const [open, setOpen] = useState<"" | "plus" | "mode" | "model" | "think" | "stats">("");
  const toggle = (k: typeof open) => setOpen((o) => (o === k ? "" : k));
  // 两级模型选择：modelNav = 当前二级面板的供应商分组 id（"" = 一级列表；面板收起即复位）
  const [modelNav, setModelNav] = useState("");
  useEffect(() => { if (open !== "model") setModelNav(""); }, [open]);
  // 自动增高：随内容长高，封顶后内部滚动；清空自动回落
  useEffect(() => {
    const el = typeof ref === "function" ? null : ref?.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, maxH) + "px";
  }, [value, maxH]);
  const pick = <T,>(v: T, set: (x: T) => void) => { set(v); setOpen(""); };

  // 当前选中项定位（跨分组找叶节点）：组名 · 模型名（单模型组只显示模型名）
  const curHit = (() => {
    for (const g of props.groups) {
      const mem = g.members.find((x) => x.id === props.model);
      if (mem) return { g, mem };
    }
    return null;
  })();

  const s = props.stats;
  const pct = s ? Math.round(s.ratio * 100) : 0;
  const pctColor = s ? (pct > 92 ? "var(--c-red)" : pct > 80 ? "var(--c-amber)" : "var(--c-text3)") : "var(--c-text3)";
  const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : `${n}`);

  return (
    <div className="composer-box" style={{ position: "relative" }}>
      {props.attachments && props.attachments.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
          {props.attachments.map((img, i) => (
            <div key={`${img.name}:${i}`} style={{ position: "relative" }}>
              <img src={img.dataUrl} alt={img.name} style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 8, border: "1px solid var(--c-border)" }} />
              <button className="tool-btn" title="移除" style={{ position: "absolute", top: -6, right: -6, padding: "0 5px", fontSize: 10 }} onClick={img.onRemove}>✕</button>
            </div>
          ))}
          {props.attachmentHint ? <span className="hint" style={{ alignSelf: "center" }}>{props.attachmentHint}</span> : null}
        </div>
      )}
      {props.children}
      <textarea
        ref={ref}
        className="composer-input"
        rows={1}
        autoFocus={props.autoFocus}
        style={{ minHeight: props.minH ?? 24 }}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => {
          const files = [...e.clipboardData.files];
          if (files.some((f) => f.type.startsWith("image/"))) { e.preventDefault(); props.onAttachImage(); }
        }}
        onDrop={(e) => {
          const files = [...e.dataTransfer.files];
          if (files.some((f) => f.type.startsWith("image/"))) { e.preventDefault(); props.onAttachImage(); }
        }}
        onKeyDown={onKeyDown}
      />
      <div className="comp-bar">
        {/* + 附件：图片选择器 + 内置斜杠命令快速注入 */}
        <span style={{ position: "relative", display: "inline-flex" }}>
          <button className="comp-item" title="附加附件 / 命令" aria-haspopup="menu" aria-expanded={open === "plus"}
            style={{ padding: "0 7px" }} onClick={() => toggle("plus")}>
            <TlIcon name="plus" size={14} />
          </button>
          <CompPopover open={open === "plus"} wide anchor="left" onClose={() => setOpen("")}>
            <div className="comp-pop-head">附件</div>
            <div className="comp-opt" onClick={() => { props.onAttachImage(); setOpen(""); }}>
              <TlIcon name="file" size={13} color="var(--c-text2)" />
              <span className="comp-opt-name">添加图片</span>
              <span className="comp-opt-sub">最多 4 张 · 4MB</span>
            </div>
            {props.slash && props.slash.length > 0 && (
              <>
                <div className="comp-pop-sep" />
                <div className="comp-pop-head">命令（插入输入框）</div>
                {props.slash.slice(0, 14).map((c) => (
                  <div key={c.name} className="comp-opt" onClick={() => { props.onPickSlash?.(c.insert); setOpen(""); }}>
                    <span style={{ fontFamily: "var(--mono, monospace)", color: "var(--c-text)", fontSize: 12 }}>{c.name}</span>
                    <span className="comp-opt-sub">{c.hint}</span>
                  </div>
                ))}
              </>
            )}
          </CompPopover>
        </span>

        {/* 访问控制：权限模式（计划 / 默认 / 完全访问） */}
        <span style={{ position: "relative", display: "inline-flex" }}>
          <button className="comp-item" title="访问控制（Shift+Tab 循环）" aria-haspopup="menu" aria-expanded={open === "mode"}
            onClick={() => toggle("mode")} disabled={props.modeDisabled}>
            {props.mode === "yolo" ? <TlIcon name="bolt" size={13} color="var(--c-red)" />
              : props.mode === "plan" ? <TlIcon name="plan" size={13} color="var(--c-chip-purple-fg, #b490ff)" />
                : <TlIcon name="shield" size={13} color="var(--c-text2)" />}
            <span className="comp-label">{props.modeLabel}</span>
            <TlIcon name="chevron-down" size={10} className={"comp-chev" + (open === "mode" ? " open" : "")} />
          </button>
          <CompPopover open={open === "mode"} anchor="left" onClose={() => setOpen("")}>
            <div className="comp-pop-head">访问控制</div>
            {(MODE_ORDER as ("plan" | "default" | "yolo")[]).map((m) => (
              <CompOption key={m} on={props.mode === m} onSelect={() => pick(m, props.onMode)}
                icon={m === "yolo" ? "bolt" : m === "plan" ? "plan" : "shield"}
                color={MODE_META[m].color}
                name={MODE_META[m].label.replace(/^[●◆◇⚡]\s*/, "")}
                sub={m === "plan" ? "只读调研，出计划待批准" : m === "yolo" ? "全部放行不再询问，仅不确定时提问" : "自动执行，仅高危命令需确认"} />
            ))}
          </CompPopover>
        </span>

        {/* 模型 */}
        <span style={{ position: "relative", display: "inline-flex" }}>
          <button className="comp-item" title="模型档案" aria-haspopup="menu" aria-expanded={open === "model"}
            onClick={() => toggle("model")} disabled={props.modelDisabled}>
            <TlIcon name="sparkle" size={13} color="var(--c-text2)" />
            <span className="comp-label">{curHit
              ? (curHit.g.members.length > 1 ? `${curHit.g.name} · ${curHit.mem.name}` : curHit.mem.name)
              : (props.model || "默认模型")}</span>
            <TlIcon name="chevron-down" size={10} className={"comp-chev" + (open === "model" ? " open" : "")} />
          </button>
          <CompPopover open={open === "model"} anchor="left" onClose={() => setOpen("")}>
            {modelNav ? (() => {
              // 二级面板：具体模型列表（头部返回一级供应商列表）
              const g = props.groups.find((x) => x.id === modelNav);
              if (!g) return null;
              return (
                <>
                  <div className="comp-opt comp-group" role="button" tabIndex={0} aria-label={g.name}
                    onClick={() => setModelNav("")}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setModelNav(""); } }}>
                    <TlIcon name="chevron-right" size={11} style={{ transform: "rotate(180deg)" }} color="var(--c-text3)" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="comp-opt-name">{g.name}</div>
                      {g.hint ? <div className="comp-opt-sub">{g.hint}</div> : null}
                    </div>
                    <span className="comp-count">{g.members.length}</span>
                  </div>
                  {g.members.map((mem) => (
                    <CompOption key={mem.id} on={mem.id === props.model} onSelect={() => pick(mem.id, props.onModel)}
                      name={mem.name} sub={mem.sub} />
                  ))}
                </>
              );
            })() : (
              // 一级面板：供应商列表；单模型档案直接选中，多模型进入二级
              <>
                <div className="comp-pop-head">模型</div>
                {props.groups.map((g) => {
                  if (g.members.length > 1) {
                    return (
                      <div key={g.id} className="comp-opt comp-group" role="button" tabIndex={0}
                        aria-haspopup="menu" aria-label={g.name}
                        onClick={() => setModelNav(g.id)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setModelNav(g.id); } }}>
                        <TlIcon name="sparkle" size={13} color="var(--c-text2)" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="comp-opt-name">{g.name}</div>
                          {g.hint ? <div className="comp-opt-sub">{g.hint}</div> : null}
                        </div>
                        <span className="comp-count">{g.members.length}</span>
                        <TlIcon name="chevron-right" size={10} color="var(--c-text3)" />
                      </div>
                    );
                  }
                  const mem = g.members[0];
                  return (
                    <CompOption key={g.id} on={mem.id === props.model} onSelect={() => pick(mem.id, props.onModel)}
                      icon="sparkle" color="var(--c-text2)" name={g.name} sub={g.hint ?? mem.sub} />
                  );
                })}
              </>
            )}
          </CompPopover>
        </span>

        {/* 思考深度 */}
        <span style={{ position: "relative", display: "inline-flex" }}>
          <button className="comp-item" title="思考深度" aria-haspopup="menu" aria-expanded={open === "think"} onClick={() => toggle("think")}>
            <TlIcon name="bulb" size={13} color="var(--c-text2)" />
            <span className="comp-label">{THINKING_META[props.thinking].label}</span>
            <TlIcon name="chevron-down" size={10} className={"comp-chev" + (open === "think" ? " open" : "")} />
          </button>
          <CompPopover open={open === "think"} anchor="left" onClose={() => setOpen("")}>
            <div className="comp-pop-head">思考深度</div>
            {(["off", "low", "medium", "high"] as const).map((v) => (
              <CompOption key={v} on={v === props.thinking} onSelect={() => pick(v, props.onThinking)}
                icon="sparkle" color={v === "off" ? "var(--c-text3)" : "var(--c-amber)"}
                name={THINKING_META[v].label} sub={THINKING_META[v].hint} />
            ))}
          </CompPopover>
        </span>

        <span style={{ flex: 1 }} />
        {/* busy 且输入框有内容 = 排队/插话发送（点击发送钮不再误触停止）；空输入时才是停止钮 */}
        {(() => {
          const isStop = props.busy && !props.canSend;
          return (
            <button className="comp-send" title={props.sendTitle} disabled={!props.canSend && !props.busy} onClick={() => (isStop ? props.onStop() : props.onSend())}>
              <TlIcon name={isStop ? "stop" : "send"} size={13} />
            </button>
          );
        })()}
      </div>
      {/* 统计栏（DeepSeek 式）：上下文容量 / token 用量 / 速度 / 缓存命中率，点击展开明细。
          新任务页与空会话（无消息、无用量记录）不显示整栏——避免一排「—」和多余分割线。 */}
      {s && (s.estTokens > 0 || s.totalInput != null) && (
      <span className="comp-stats-row">
        {/* 内层 shrink-wrap 作为弹层定位锚：弹层右缘对齐箭头右缘，箭头跟在内容后 */}
        <span style={{ position: "relative", display: "inline-flex" }}>
        <button type="button" className="comp-stats" title="用量明细" aria-haspopup="menu" aria-expanded={open === "stats"} onClick={() => toggle("stats")}>
          <span className="comp-stats-bar"><i style={{ width: `${Math.min(100, pct)}%`, background: pctColor }} /></span>
          <span className="comp-stats-item">上下文 <b>{s ? `${fmtK(s.estTokens)} / ${fmtK(s.contextWindow)}` : "—"}</b>{s ? ` · ${pct}%` : ""}</span>
          <span className="comp-stats-item">输入 <b>{s?.totalInput != null ? fmtK(s.totalInput) : "—"}</b></span>
          <span className="comp-stats-item">输出 <b>{s?.totalOutput != null ? fmtK(s.totalOutput) : "—"}</b></span>
          <span className="comp-stats-item"><b>{s?.tokPerSec != null ? `${s.tokPerSec} tok/s` : "—"}</b></span>
          <span className="comp-stats-item">缓存 <b>{s?.cacheHitRate != null ? `${Math.round(s.cacheHitRate * 100)}%` : "—"}</b></span>
          <TlIcon name="chevron-down" size={10} className={"comp-chev" + (open === "stats" ? " open" : "")} />
        </button>
        <CompPopover open={open === "stats"} anchor="right" onClose={() => setOpen("")}>
          <div className="comp-pop-head">用量明细</div>
          {s ? (
            <>
              <div className="comp-ctx-row"><span>上下文窗口</span><b>{fmtK(s.contextWindow)} · {pct}%</b></div>
              <div className="comp-ctx-row"><span>系统提示</span><b>{Math.round(s.breakdown.system)} tok</b></div>
              <div className="comp-ctx-row"><span>历史消息</span><b>{Math.round(s.breakdown.messages)} tok</b></div>
              <div className="comp-ctx-row"><span>预留输出</span><b>{Math.round(s.breakdown.reserved)} tok</b></div>
              <div className="comp-pop-sep" />
              <div className="comp-ctx-row"><span>剩余预算</span><b>{fmtK(s.budget)}</b></div>
              <div className="comp-ctx-row"><span>累计输入</span><b>{s.totalInput != null ? `${s.totalInput.toLocaleString()} tok` : "—"}</b></div>
              <div className="comp-ctx-row"><span>累计输出</span><b>{s.totalOutput != null ? `${s.totalOutput.toLocaleString()} tok` : "—"}</b></div>
              <div className="comp-ctx-row"><span>最近一轮输出</span><b>{s.lastOutput != null ? `${s.lastOutput.toLocaleString()} tok` : "—"}</b></div>
              <div className="comp-ctx-row"><span>生成速度</span><b>{s.tokPerSec != null ? `${s.tokPerSec} tok/s` : "—"}</b></div>
              <div className="comp-ctx-row"><span>缓存命中率</span><b>{s.cacheHitRate != null ? `${Math.round(s.cacheHitRate * 100)}%` : "—"}</b></div>
              {s.cacheMissTotal != null && <div className="comp-ctx-row"><span>缓存未命中</span><b>{s.cacheMissTotal.toLocaleString()} tok</b></div>}
              {s.cacheBreaks != null && <div className="comp-ctx-row" title="压缩 / 备用模型 / 重启续跑 / 模式切换发生的轮次——这些轮前缀已知断裂"><span>断点轮</span><b>{s.cacheBreaks} 轮</b></div>}
              {s.compactions > 0 && <div className="comp-ctx-row"><span>已自动压缩</span><b>{s.compactions} 次</b></div>}
              {pct > 80 && (
                <div style={{ padding: "2px 9px 6px", fontSize: 11, color: "var(--c-amber)" }}>
                  已接近上限，建议 /compact 压缩历史
                </div>
              )}
            </>
          ) : (
            <div style={{ padding: "2px 9px 8px", fontSize: 11, color: "var(--c-text3)" }}>
              发送首条消息后开始统计
            </div>
          )}
        </CompPopover>
        </span>
      </span>
      )}
    </div>
  );
});



export const BUILTIN_COMPOSER_PROVIDERS: ComposerMentionProviderDef[] = [
  {
    prefix: "@",
    label: "文件",
    source: async (query: string) => {
      const files = await call<string[]>("repo.files", { query });
      return files.map((f) => ({ label: f, insert: f }));
    },
  },
];

