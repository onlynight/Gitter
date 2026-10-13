/**
 * 用量统计页（docs/usage-stats-design.md v1）：概览（KPI × 每日趋势 × 模型分布）/ 任务明细 / 空态。
 *
 * 数据源复用现有 RPC `agent.usage.report`（app/src/bridge.ts:713 → services/agents/usage.ts），
 * 零后端改动；时间范围 7/30/90/全部 纯前端切片 byDay，任务筛选与排序同样纯前端。
 *
 * 口径纪律（与 usage.ts 一致）：
 *  - cost === null（档案未配单价）显示「—」，绝不显示 0；
 *  - 成本 = 档案单价（$/Mtok）× token，缓存命中不计费。
 * 图表为手绘 SVG（echarts 仅存在于 iframe 预览运行时，页面侧零依赖）。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { pageSdk } from "../pageSdk";
import { NavIcon } from "../kit";
import type { UsageReport } from "../bridge/types";

const { call, t, navigate, repo, toast, focusTask } = pageSdk;

/**
 * 模型分色：色相差拉大（红→橙→绿→青→蓝→紫），相邻两条在深底上即可分辨。
 * 必须写字面色值——SVG 的 fill/stroke 属性里 var() 不解析，
 * 之前 var(--c-text2)/var(--c-text3) 回退成黑色，多条线撞成一色。
 */
const MODEL_COLORS = ["#F85149", "#E3B341", "#3FB950", "#2DD4BF", "#6BABF5", "#8250DF"];
const MODEL_DOT = (ref: string): string => {
  let h = 0;
  for (let i = 0; i < ref.length; i++) h = (h * 31 + ref.charCodeAt(i)) >>> 0;
  return MODEL_COLORS[h % MODEL_COLORS.length];
};

/** 线型：颜色之外再用虚实区分，同一模型在两图里保持同一线型 */
const MODEL_DASH = ["none", "none", "10 5", "7 4", "14 6", "4 4"];
const MODEL_DASH_OF = (ref: string): string => {
  let h = 0;
  for (let i = 0; i < ref.length; i++) h = (h * 31 + ref.charCodeAt(i)) >>> 0;
  return MODEL_DASH[h % MODEL_DASH.length];
};

/** 显示名：优先配置里的档案名，回退到剥标签后的裸 id */
const modelName = (names: UsageReport["modelNames"], ref: string): string => {
  if (ref === "(未记录)") return ref;
  const bare = ref.split("#")[0];
  return names[bare] ?? names[ref] ?? (bare !== ref ? `${bare} · ${ref.split("#")[1]}` : bare);
};

// ---- 数字格式（与设置页 UsageSection 同源口径：k/M/B 分级；null 成本 → —） ----

function fmtTok(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}

function fmtCost(n: number | null): string {
  return n === null ? "—" : "$" + n.toFixed(n < 10 ? 4 : 2);
}

/** 相对时间：今天→分钟前/小时前，昨天→「昨天 HH:mm」，更早→M-D。 */
function fmtAgo(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const now = new Date();
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) {
    const mins = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 60000));
    if (mins < 1) return t("Usage_JustNow");
    if (mins < 60) return t("Usage_MinAgo", mins);
    return t("Usage_HourAgo", Math.floor(mins / 60));
  }
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (sameDay(d, y)) return t("Usage_Yesterday", `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`);
  return `${d.getMonth() + 1}-${d.getDate()}`;
}

/** modelRef → 展示短名（取最后一段）。 */
/** 涨跌：prev 缺失（首次使用）→ null，调用方整行隐藏而非显示 ▲0%。 */
function trendOf(cur: number, prev: number): { dir: "up" | "down"; pct: number } | null {
  if (!prev) return null;
  const pct = Math.round((cur / prev - 1) * 100);
  return { dir: pct >= 0 ? "up" : "down", pct: Math.abs(pct) };
}

// ---- 窗口切片：KPI 与趋势随范围联动 ----

interface DayRow {
  day: string;
  label: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cost: number | null;
  cacheRate: number;
}

interface Sum { turns: number; input: number; output: number; cache: number; cost: number | null }

/** 窗口汇总；成本仅在窗口内有计费日时给出，否则保留 null（「未配价」语义）。 */
function sumWindow(rows: DayRow[]): Sum {
  const s: Sum = { turns: 0, input: 0, output: 0, cache: 0, cost: null };
  for (const r of rows) {
    s.turns += r.turns;
    s.input += r.inputTokens;
    s.output += r.outputTokens;
    s.cache += r.cacheReadTokens;
    if (r.cost !== null) s.cost = (s.cost ?? 0) + r.cost;
  }
  return s;
}

function windowOf(rep: UsageReport, days: number): { cur: DayRow[]; prev: DayRow[] } {
  const all: DayRow[] = rep.byDay.map((d) => ({
    day: d.day,
    label: d.day.slice(5).replace("-", "/"),
    turns: d.turns,
    inputTokens: d.inputTokens,
    outputTokens: d.outputTokens,
    cacheReadTokens: d.cacheReadTokens,
    cost: d.cost,
    cacheRate: d.inputTokens > 0 ? d.cacheReadTokens / d.inputTokens : 0,
  }));
  if (!days) return { cur: all, prev: [] };
  const cur = all.slice(-days);
  // 环比 = 紧邻的前一个等长区间
  return { cur, prev: all.slice(-days * 2, -days) };
}

// ---- 趋势图（SVG 手绘：柱组 输入/缓存/输出 + 费用折线右轴） ----

/** 总长趋势图放在 1.62fr 列（~1000px 宽），viewBox 取同宽避免横向拉伸 */
const TREND_W = 1000;
const TREND_H = 168;
const MT_W = 1400, MT_H = 156;
const PAD_L = 34, PAD_R = 38, PAD_T = 10, PAD_B = 20;
const MT_PAD_T = 10;

interface TrendTip { x: number; row: DayRow; models: UsageReport["byDayModel"] }

/** 取某日的模型明细（已按 inputTokens 降序）。 */
function modelsOfDay(rep: UsageReport["byDayModel"], day: string): UsageReport["byDayModel"] {
  return rep.filter((m) => m.day === day).sort((a, b) => b.inputTokens - a.inputTokens);
}

/** 提示框居中于触发列，左右各留 6px 安全边，避免贴边时溢出卡片被裁切。 */
function clampTip(x: number, boxRef: { current: HTMLDivElement | null }): string {
  const box = boxRef.current;
  if (!box) return `${x}px`;
  const half = 100;
  const lo = Math.max(6, -(half - box.offsetWidth));
  return `${Math.min(Math.max(x, lo), box.offsetWidth + half - 6)}px`;
}

/**
 * 平滑折线（Fritsch–Carlson 单调保形 → cubic Bezier）。
 * 朴素 Catmull-Rom 在两高值之间夹一个 0 时会把控制点拖到基线以下，
 * 曲线视觉上扎破 0 轴；先求单调切线斜率，再用标准 Hermite→Bezier 换算。
 * 两个图（总量趋势 / 按模型）共用，插值行为必须一致。
 */
function smooth(pts: [number, number][]): string {
  const m = pts.length;
  if (m === 0) return "";
  if (m === 1) return `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  if (m === 2) return `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)} L${pts[1][0].toFixed(1)} ${pts[1][1].toFixed(1)}`;
  const dx: number[] = new Array(m).fill(0);
  const sl: number[] = new Array(m).fill(0);
  for (let i = 1; i < m; i++) dx[i - 1] = pts[i][0] - pts[i - 1][0];
  for (let i = 1; i < m - 1; i++) sl[i] = (pts[i + 1][1] - pts[i - 1][1]) / (dx[i] + dx[i - 1]);
  // 端点用单侧差分
  sl[0] = (pts[1][1] - pts[0][1]) / (dx[0] || 1);
  sl[m - 1] = (pts[m - 1][1] - pts[m - 2][1]) / (dx[m - 2] || 1);
  // 单调：某段零斜率则两端切线归零
  for (let i = 0; i < m - 1; i++) {
    if (pts[i][1] === pts[i + 1][1]) { sl[i] = 0; sl[i + 1] = 0; continue; }
    const a = sl[i] / sl[i + 1];
    if (a <= 0) { sl[i] = 0; sl[i + 1] = 0; continue; }
    const d = Math.hypot(a, 1);
    if (d > 3) { sl[i] = 3 * sl[i + 1] / a; sl[i + 1] = 3 * sl[i + 1] / a; }
  }
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < m - 1; i++) {
    const p1 = pts[i], p2 = pts[i + 1];
    const k = (dx[i] || 1) / 3;
    d += ` C${(p1[0] + k).toFixed(1)} ${(p1[1] + sl[i] * k).toFixed(1)} ${(p2[0] - k).toFixed(1)} ${(p2[1] - sl[i + 1] * k).toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

function TrendChart(props: { rows: DayRow[]; vis: Record<string, boolean>; models: UsageReport["byDayModel"]; onTip: (tip: TrendTip | null) => void }) {
  const { rows } = props;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // 实测容器宽当 viewBox 宽，1:1 对应 CSS 像素：窗口缩放只改变图占的宽度，
  // 描边/圆点/文字都不会变形。preserveAspectRatio="none" 是必需的——
  // viewBox 既然等于容器实际尺寸，就应当逐像素映射，不能被按像素比缩放。
  const [cw, setCw] = useState(TREND_W);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCw(Math.max(360, el.clientWidth)));
    ro.observe(el);
    setCw(Math.max(360, el.clientWidth));
    return () => ro.disconnect();
  }, []);
  const W = Math.round(cw);
  const iw = W - PAD_L - PAD_R;
  const ih = TREND_H - PAD_T - PAD_B;
  const n = Math.max(1, rows.length);
  const slot = iw / n;

  const maxTok = Math.max(1, ...rows.map((r) => Math.max(r.inputTokens, r.cacheReadTokens, r.outputTokens))) * 1.12;
  const maxCost = Math.max(1e-9, ...rows.map((r) => r.cost ?? 0)) * 1.25;
  const x = (i: number) => PAD_L + slot * i + slot / 2;
  const yT = (v: number) => PAD_T + ih - (v / maxTok) * ih;
  const yC = (v: number) => PAD_T + ih - (v / maxCost) * ih;

  const parts: string[] = [];
  // y 网格 + 左轴 token / 右轴费用
  for (let g = 0; g <= 3; g++) {
    const y = PAD_T + ih - (ih * g) / 3;
    parts.push(`<line class="gl" x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${W - PAD_R}" y2="${y.toFixed(1)}"/>`);
    parts.push(`<text class="ax ax-y" x="${PAD_L - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end">${fmtTok((maxTok * g) / 3)}</text>`);
    parts.push(`<text class="ax ax-yr" x="${W - PAD_R + 5}" y="${(y + 3).toFixed(1)}" text-anchor="start">$${((maxCost * g) / 3).toFixed(0)}</text>`);
  }
  parts.push(`<line class="baseline" x1="${PAD_L}" y1="${PAD_T + ih}" x2="${W - PAD_R}" y2="${PAD_T + ih}"/>`);

  // 关键节点：各序列的峰值日 + 首末日
  const isKey = (arr: number[]) => {
    const mx = Math.max(...arr);
    const key = new Set<number>();
    key.add(0);
    key.add(n - 1);
    arr.forEach((v, i) => { if (v === mx) key.add(i); });
    return key;
  };
  const keySet = new Set<number>();
  const series: Array<[string, number[], string]> = [
    ["input", rows.map((r) => r.inputTokens), "#9AA6B2"],
    ["cache", rows.map((r) => r.cacheReadTokens), "#4C5866"],
    ["output", rows.map((r) => r.outputTokens), "#6BABF5"],
  ];
  if (props.vis.cost) series.push(["cost", rows.map((r) => r.cost ?? 0), "#E3B341"]);
  for (const [name, vals] of series) {
    if (!props.vis[name]) continue;
    for (const i of isKey(vals)) keySet.add(i);
  }

  // x 轴刻度：≤7 全标，否则每 N 天一档 + 末日
  const step = n <= 7 ? 1 : Math.max(1, Math.round(n / 7));
  rows.forEach((r, i) => {
    if (i % step === 0 || i === n - 1)
      parts.push(`<text class="ax ax-x" x="${x(i).toFixed(1)}" y="${TREND_H - 5}" text-anchor="middle">${r.label}</text>`);
  });

  // 面积 + 曲线：填充最下一层（输入），曲线自上而下画
  if (props.vis.input) {
    const pts = rows.map((r, i) => [x(i), yT(r.inputTokens)] as [number, number]);
    const d = smooth(pts);
    parts.push(`<path class="ln-fill" d="${d} L${x(n - 1).toFixed(1)} ${PAD_T + ih} L${x(0).toFixed(1)} ${PAD_T + ih} Z"/>`);
    parts.push(`<path class="ln ln-in" d="${d}"/>`);
  }
  if (props.vis.cache) {
    parts.push(`<path class="ln ln-cache" d="${smooth(rows.map((r, i) => [x(i), yT(r.cacheReadTokens)] as [number, number]))}"/>`);
  }
  if (props.vis.output) {
    parts.push(`<path class="ln ln-out" d="${smooth(rows.map((r, i) => [x(i), yT(r.outputTokens)] as [number, number]))}"/>`);
  }
  if (props.vis.cost) {
    parts.push(`<path class="ln ln-cost" d="${smooth(rows.map((r, i) => [x(i), yC(r.cost ?? 0)] as [number, number]))}"/>`);
  }

  // 关键节点圆点（各序列按自身刻度）
  const dotOf = (name: string, vals: number[], color: string) => {
    for (const i of keySet) {
      if (!props.vis[name]) continue;
      const r = rows[i];
      if (!r) continue;
      const y = name === "cost" ? yC(vals[i]) : yT(vals[i]);
      parts.push(`<circle class="node" data-i="${i}" cx="${x(i).toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="${color}"/>`);
    }
  };
  dotOf("input", rows.map((r) => r.inputTokens), "#9AA6B2");
  dotOf("cache", rows.map((r) => r.cacheReadTokens), "#6E7C8C");
  dotOf("output", rows.map((r) => r.outputTokens), "#6BABF5");
  if (props.vis.cost) dotOf("cost", rows.map((r) => r.cost ?? 0), "#E3B341");

  // 命中区比精确悬停点更宽容；高度收到图内（PAD_T + ih），
  // 否则矩形会延伸进图例区的 DOM 空隙，鼠标经过图例时仍触发面板。
  rows.forEach((_, i) => {
    parts.push(`<rect class="hit" data-i="${i}" x="${(PAD_L + slot * i).toFixed(1)}" y="${PAD_T}" width="${slot.toFixed(1)}" height="${ih.toFixed(1)}"/>`);
  });

  const show = (e: React.MouseEvent<SVGElement>) => {
    const i = e.currentTarget.getAttribute("data-i");
    if (i == null) return;
    const row = rows[Number(i)];
    if (!row || !wrapRef.current) return;
    const wb = wrapRef.current.getBoundingClientRect();
    const cx = (e.currentTarget as SVGElement).getBoundingClientRect();
    props.onTip({ x: cx.left + cx.width / 2 - wb.left, row, models: modelsOfDay(props.models, row.day) });
  };

  return (
    <div className="trend-wrap" ref={wrapRef}>
      <svg className="trend" viewBox={`0 0 ${W} ${TREND_H}`} preserveAspectRatio="none"
        dangerouslySetInnerHTML={{ __html: parts.join("") }}
        onMouseOver={(e) => { console.debug("[usage-tip]", e.type, (e.target as Element).tagName); show(e); }}
        onMouseEnter={(e) => show(e)}
        onMouseOut={(e) => {
          // 只有离开整个图（移出 svg）才收起 tooltip，避免列间跳动
          if (!(e.relatedTarget instanceof Element && e.currentTarget.contains(e.relatedTarget))) props.onTip(null);
        }}
        onMouseLeave={() => props.onTip(null)} />
    </div>
  );
}

// ---- 按模型的每日用量（独立图，每条线 = 一个模型的每日输入 token）----

/** 悬停行：日期 + 当日各模型（只列有量的，避免面板被 0 值刷屏）。 */
interface ModelTip { x: number; day: string; rows: { modelRef: string; name: string; dash: string; input: number; output: number }[]; total: number }

const MAX_MODELS = 6;

function ModelTrendChart(props: {
  rows: DayRow[];
  byDayModel: UsageReport["byDayModel"];
  /** 按窗口输入量降序截断的模型列表（最多 MAX_MODELS） */
  models: UsageReport["byModel"];
  onTip: (tip: ModelTip | null) => void;
  modelNames: UsageReport["modelNames"];
}) {
  const { rows } = props;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [cw, setCw] = useState(MT_W);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCw(Math.max(360, el.clientWidth)));
    ro.observe(el);
    setCw(Math.max(360, el.clientWidth));
    return () => ro.disconnect();
  }, []);
  const W = Math.round(cw);
  const iw = W - PAD_L - PAD_R;
  const ih = MT_H - MT_PAD_T - PAD_B;
  const n = Math.max(1, rows.length);
  const slot = iw / n;

  // 每个模型的逐日输入（缺失日补 0），供画线与取悬浮值
  const series = props.models.slice(0, MAX_MODELS).map((m) => {
    const map = new Map(props.byDayModel.filter((d) => d.modelRef === m.modelRef).map((d) => [d.day, d]));
    return {
      modelRef: m.modelRef,
      name: modelName(props.modelNames, m.modelRef),
      color: MODEL_DOT(m.modelRef),
      dash: MODEL_DASH_OF(m.modelRef),
      vals: rows.map((r) => (map.get(r.day)?.inputTokens ?? 0)),
      out: rows.map((r) => (map.get(r.day)?.outputTokens ?? 0)),
    };
  });

  const maxTok = Math.max(1, ...series.flatMap((s) => s.vals)) * 1.12;
  const x = (i: number) => PAD_L + slot * i + slot / 2;
  const yT = (v: number) => MT_PAD_T + ih - (v / maxTok) * ih;

  const parts: string[] = [];
  for (let g = 0; g <= 3; g++) {
    const y = MT_PAD_T + ih - (ih * g) / 3;
    parts.push(`<line class="gl" x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${W - PAD_R}" y2="${y.toFixed(1)}"/>`);
    parts.push(`<text class="ax ax-y" x="${PAD_L - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end">${fmtTok((maxTok * g) / 3)}</text>`);
  }
  parts.push(`<line class="baseline" x1="${PAD_L}" y1="${MT_PAD_T + ih}" x2="${W - PAD_R}" y2="${MT_PAD_T + ih}"/>`);

  const step = n <= 7 ? 1 : Math.max(1, Math.round(n / 7));
  rows.forEach((r, i) => {
    if (i % step === 0 || i === n - 1)
      parts.push(`<text class="ax ax-x" x="${x(i).toFixed(1)}" y="${MT_H - 5}" text-anchor="middle">${r.label}</text>`);
  });

  // 每条模型线全刻度独立归零，不共用总量基准；关键点 = 峰值日 + 首末
  series.forEach((s) => {
    const d = smooth(rows.map((_, i) => [x(i), yT(s.vals[i])] as [number, number]));
    parts.push(`<path class="ln ln-m" style="stroke:${s.color};stroke-dasharray:${s.dash}" d="${d}"/>`);
    const mx = Math.max(...s.vals);
    const key = new Set<number>([0, n - 1]);
    s.vals.forEach((v, i) => { if (v === mx && v > 0) key.add(i); });
    key.forEach((i) => {
      if (s.vals[i] === 0) return;
      parts.push(`<circle class="node" data-i="${i}" cx="${x(i).toFixed(1)}" cy="${yT(s.vals[i]).toFixed(1)}" r="3.2" fill="${s.color}"/>`);
    });
  });

  rows.forEach((_, i) => {
    parts.push(`<rect class="hit" data-i="${i}" x="${(PAD_L + slot * i).toFixed(1)}" y="${MT_PAD_T}" width="${slot.toFixed(1)}" height="${ih.toFixed(1)}"/>`);
  });

  const show = (e: React.MouseEvent<SVGElement>) => {
    const i = e.currentTarget.getAttribute("data-i");
    if (i == null) return;
    const row = rows[Number(i)];
    if (!row || !wrapRef.current) return;
    const wb = wrapRef.current.getBoundingClientRect();
    const cx = (e.currentTarget as SVGElement).getBoundingClientRect();
    const list = series
      .map((s) => ({ modelRef: s.modelRef, name: s.name, dash: s.dash, input: s.vals[Number(i)] ?? 0, output: s.out[Number(i)] ?? 0 }))
      .filter((r) => r.input > 0 || r.output > 0)
      .sort((a, b) => b.input - a.input);
    props.onTip({ x: cx.left + cx.width / 2 - wb.left, day: row.day, rows: list, total: row.inputTokens });
  };

  return (
    <div className="trend-wrap" ref={wrapRef}>
      <svg className="trend mt" viewBox={`0 0 ${W} ${MT_H}`} preserveAspectRatio="none"
        dangerouslySetInnerHTML={{ __html: parts.join("") }}
        onMouseOver={(e) => { console.debug("[usage-tip:mt]", e.type, (e.target as Element).tagName); show(e); }}
        onMouseEnter={show}
        onMouseOut={(e) => {
          if (!(e.relatedTarget instanceof Element && e.currentTarget.contains(e.relatedTarget))) props.onTip(null);
        }}
        onMouseLeave={() => props.onTip(null)} />
    </div>
  );
}

// ---- 任务明细表 ----

type TaskSortKey = "title" | "turns" | "inputTokens" | "outputTokens" | "cost" | "lastActiveAt";
type TaskFilter = "all" | "priced" | "failed";

function stateBadge(state: string): "run" | "err" | "done" | "" {
  const s = state.toLowerCase();
  if (/fail|error|abort|cancel/.test(s)) return "err";
  if (/run|pend|queu|work/.test(s)) return "run";
  if (/comp|done|finish|success/.test(s)) return "done";
  return "";
}

const TASK_LIMIT = 100;

function UsageTable(props: { rows: UsageReport["byTask"]; names: UsageReport["modelNames"]; onOpen: (taskId: string) => void }) {
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [sortKey, setSortKey] = useState<TaskSortKey>("lastActiveAt");
  const [desc, setDesc] = useState(true);

  const shown = useMemo(() => {
    let rows = props.rows;
    if (filter === "priced") rows = rows.filter((r) => r.cost !== null);
    else if (filter === "failed") rows = rows.filter((r) => stateBadge(r.state) === "err");
    const mul = desc ? -1 : 1;
    return [...rows].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (sortKey === "title") return String(av).localeCompare(String(bv)) * mul;
      if (sortKey === "lastActiveAt") return String(av ?? "").localeCompare(String(bv ?? "")) * mul;
      return (Number(av ?? 0) - Number(bv ?? 0)) * mul;
    }).slice(0, TASK_LIMIT);
  }, [props.rows, filter, sortKey, desc]);

  const stats = useMemo(() => {
    let cost: number | null = null, turns = 0, failCost: number | null = null, failed = 0, maxCost: number | null = null;
    for (const r of props.rows) {
      turns += r.turns;
      if (r.cost !== null) {
        cost = (cost ?? 0) + r.cost;
        maxCost = maxCost === null ? r.cost : Math.max(maxCost, r.cost);
        if (stateBadge(r.state) === "err") { failCost = (failCost ?? 0) + r.cost; failed++; }
      }
    }
    return { cost, turns, failCost, failed, maxCost };
  }, [props.rows]);

  const th = (key: TaskSortKey, label: string, right?: boolean) => (
    <th className={right ? "r" : ""} onClick={() => {
      if (sortKey === key) setDesc(!desc);
      else { setSortKey(key); setDesc(true); }
    }}>
      {label}{sortKey === key && <span className="srt">{desc ? "▼" : "▲"}</span>}
    </th>
  );

  return (
    <div className="usage-card">
      <div className="sumrow">
        <span className="kv">{t("Usage_TaskCount", props.rows.length)}</span>
        <span className="sep" />
        <span className="kv">{t("Usage_TotalCost", fmtCost(stats.cost))}</span>
        <span className="sep" />
        <span className="kv">{t("Usage_MostExpensive", fmtCost(stats.maxCost))}</span>
        <span className="sep" />
        <span className="kv">{t("Usage_AvgTurns", props.rows.length ? Math.round(stats.turns / props.rows.length) : 0)}</span>
        <span className="grow" />
        {stats.failed > 0 && stats.failCost !== null && (
          <span className="kv warn">{t("Usage_FailedCost", stats.failed, fmtCost(stats.failCost))}</span>
        )}
      </div>

      <div className="usage-filters">
        {(["all", "priced", "failed"] as TaskFilter[]).map((f) => (
          <span key={f} className={"seg-sg" + (filter === f ? " on" : "")} onClick={() => setFilter(f)}>
            {t(f === "all" ? "Usage_Filter_All" : f === "priced" ? "Usage_Filter_Priced" : "Usage_Filter_Failed")}
          </span>
        ))}
      </div>

      <table className="usage-tbl">
        <thead>
          <tr>
            {th("title", t("Usage-Col_Task"), false)}
            <th>{t("Usage-Col_Model")}</th>
            <th className="st">{t("Usage-Col_State")}</th>
            {th("turns", t("Usage-Col_Turns"), true)}
            {th("inputTokens", t("Usage-Col_Input"), true)}
            {th("outputTokens", t("Usage-Col_Output"), true)}
            <th className="r">{t("Usage-Col_Cache")}</th>
            {th("cost", t("Usage-Col_Cost"), true)}
            {th("lastActiveAt", t("Usage-Col_When"), true)}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const st = stateBadge(r.state);
            return (
              <tr key={r.taskId} title={r.title} onClick={() => props.onOpen(r.taskId)}>
                <td className="ti">{r.title}</td>
                <td className="sp" title={r.modelRef ?? ""}>
                  <span className="mdot" style={{ background: MODEL_DOT(r.modelRef ?? "") }} />{r.modelRef ? modelName(props.names, r.modelRef) : "—"}
                </td>
                <td className="st"><span className={"badge" + (st ? " " + st : "")}><i className="d" />{r.state}</span></td>
                <td className="num">{r.turns}</td>
                <td className="num">{fmtTok(r.inputTokens)}</td>
                <td className="num">{fmtTok(r.outputTokens)}</td>
                <td className={"num" + (r.cacheReadTokens === 0 ? " na" : "")}>{fmtTok(r.cacheReadTokens)}</td>
                <td className={"num" + (r.cost === null ? " na" : "")}>{fmtCost(r.cost)}</td>
                <td className="num dim">{fmtAgo(r.lastActiveAt)}</td>
              </tr>
            );
          })}
          {shown.length === 0 && (
            <tr><td colSpan={9} className="empty-cell">{t("Usage_NoTaskRows")}</td></tr>
          )}
        </tbody>
      </table>

      {props.rows.length > TASK_LIMIT && (
        <div className="usage-more">{t("Usage_MoreCollapsed", props.rows.length - TASK_LIMIT)}</div>
      )}

      <div className="usage-note">{t("Usage_Foot_Task")}</div>
    </div>
  );
}

// ---- 模型分布 ----

function ModelList(props: { rep: UsageReport }) {
  const rows = props.rep.byModel;
  const totIn = Math.max(1, rows.reduce((a, m) => a + m.inputTokens, 0));
  if (rows.length === 0) return <div className="empty-cell">{t("Usage_NoModelRows")}</div>;
  return (
    <div>
      {rows.map((m, i) => {
        const pct = (m.inputTokens / totIn) * 100;
        const fill = m.inputTokens > 0 ? (m.cacheReadTokens / m.inputTokens) * 100 : 0;
        return (
          <div key={m.modelRef} className="usage-mrow" title={m.modelRef}>
            <span className="rk">{i + 1}</span>
            <span className="body">
              <span className="nm">
                <span className="mdot" style={{ background: MODEL_DOT(m.modelRef) }} />
                <span className="mn">{modelName(props.rep.modelNames, m.modelRef)}</span>
                <span className="full">{m.modelRef}</span>
              </span>
              <span className="mbar">
                <i style={{ width: `${pct.toFixed(1)}%` }} />
                {fill > 0 && <i className="on" style={{ width: `${fill.toFixed(1)}%` }} />}
              </span>
            </span>
            <span className="mnum">
              <span className="v">{fmtTok(m.inputTokens)}</span>
              <span className="p">{pct.toFixed(1)}% · {m.cost === null ? t("Usage_NoCost") : fmtCost(m.cost)}</span>
            </span>
          </div>
        );
      })}
      <div className="usage-note">{t("Usage_Foot_Model")}</div>
    </div>
  );
}

// ---- 主页面 ----

const RANGES = [
  { d: 7, key: "Usage_Range_7" },
  { d: 30, key: "Usage_Range_30" },
  { d: 90, key: "Usage_Range_90" },
  { d: 0, key: "Usage_Range_All" },
] as const;

const ICON_USAGE = "M2 13.25h12v1.25H2v-1.25ZM3.25 8.5H5v3.25H3.25V8.5Zm4-4H9v7.25H7.25V4.5Zm4 2H13v5.25h-1.75V6.5Z";

export function UsagePage() {
  const [rep, setRep] = useState<UsageReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [allProjects, setAllProjects] = useState(false);
  const [range, setRange] = useState<number>(30);
  const [view, setView] = useState<"overview" | "tasks">("overview");
  const [vis, setVis] = useState<Record<string, boolean>>({ input: true, cache: true, output: true, cost: true });
  const [tip, setTip] = useState<TrendTip | null>(null);
  const [mTip, setMTip] = useState<ModelTip | null>(null);
  const [spinning, setSpinning] = useState(false);
  const tipBoxRef = useRef<HTMLDivElement | null>(null);
  const mtBoxRef = useRef<HTMLDivElement | null>(null);
  const info = repo();

  const reload = useCallback((all: boolean) => {
    setSpinning(true);
    void call<UsageReport>("agent.usage.report", { allProjects: all })
      .then((r) => { setRep(r); setErr(null); })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setSpinning(false));
  }, []);

  useEffect(() => reload(allProjects), [reload, allProjects]);

  const w = useMemo(() => (rep ? windowOf(rep, range) : null), [rep, range]);
  const cur = w ? sumWindow(w.cur) : null;
  const prev = w && w.prev.length ? sumWindow(w.prev) : null;
  // 缓存命中率 = ΣcacheRead / Σinput（与平台口径一致）
  const hitRate = cur && cur.input > 0 ? cur.cache / cur.input : 0;

  if (err) {
    return (
      <div className="page usage-page">
        <div className="usage-scroll">
          <div className="usage-card"><div className="empty-cell err">{err}</div></div>
        </div>
      </div>
    );
  }

  const onOpenTask = (taskId: string) => {
    try {
      focusTask(taskId);
      navigate("tasks");
    } catch { /* 任务页未装载时忽略 */ }
  };

  // 空态：窗口内无任何用量记录
  const isEmpty = cur !== null && cur.turns === 0;

  return (
    <div className="page usage-page">
      <div className="usage-head">
        <div className="ti">
          <NavIcon svg={ICON_USAGE} />
          <h1>{t("Usage_Title")}</h1>
          <span className="rpc">agent.usage.report</span>
        </div>
        <span className="grow" />
        <span className="seg">
          <span className={"seg-sg" + (view === "overview" ? " on" : "")} onClick={() => setView("overview")}>{t("Usage_View_Overview")}</span>
          <span className={"seg-sg" + (view === "tasks" ? " on" : "")} onClick={() => setView("tasks")}>{t("Usage_View_Tasks")}</span>
        </span>
        <span className="scope" onClick={() => setAllProjects(!allProjects)} title={t("Usage_Scope_Hint")}>
          <span className="nm">{info ? info.name : "—"}</span>
          <span className="all">{t(allProjects ? "Usage_Scope_All" : "Usage_Scope_Current")}</span>
        </span>
        <span className="seg">
          {RANGES.map((r) => (
            <span key={r.d} className={"seg-sg" + (range === r.d ? " on" : "")} onClick={() => setRange(r.d)}>{t(r.key)}</span>
          ))}
        </span>
        <button className={"tool-btn" + (spinning ? " spin" : "")} onClick={() => reload(allProjects)}>{t("Usage_Refresh")}</button>
      </div>

      <div className="usage-scroll">
        {!rep ? (
          <div className="usage-card"><div className="empty-cell">{t("Usage_Loading")}</div></div>
        ) : isEmpty ? (
          <>
            <div className="usage-card">
              <div className="empty-box">
                <div className="ic">{t("Usage_Empty_Ic")}</div>
                <div className="ttl">{t("Usage_Empty_Title")}</div>
                <div className="sub">{t("Usage_Empty_Sub")}</div>
                <div className="acts">
                  <button className="tool-btn solid" onClick={() => navigate("tasks")}>{t("Usage_Empty_Cta")}</button>
                  {!allProjects && <button className="tool-btn" onClick={() => setAllProjects(true)}>{t("Usage_Empty_All")}</button>}
                </div>
              </div>
            </div>
            {rep.repoPaths.length > 0 && (
              <div className="usage-card" style={{ marginTop: 12 }}>
                <div className="card-hd">
                  <h3>{t("Usage_Scan_Title")}</h3>
                  <span className="note">{t("Usage_Scan_Note")}</span>
                </div>
                <table className="usage-tbl">
                  <thead><tr><th>{t("Usage_Scan_Repo")}</th><th className="st">{t("Usage_Scan_Status")}</th></tr></thead>
                  <tbody>
                    {rep.repoPaths.map((p) => {
                      const empty = rep.emptyRepos.includes(p);
                      return (
                        <tr key={p}>
                          <td className="sp" title={p}>{p}</td>
                          <td className="st">
                            <span className={"badge" + (empty ? " warn" : " done")}><i className="d" />
                              {empty ? t("Usage_Empty_Ledger") : t("Usage_Has_Ledger")}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : view === "tasks" ? (
          <UsageTable rows={rep.byTask} names={rep.modelNames} onOpen={onOpenTask} />
        ) : (
          <>
            <div className="kpi-row">
              <div className="kpi">
                <div className="lbl">{t("Usage_Kpi_Cost")}</div>
                <div className={"val" + (cur!.cost === null ? " na" : "")}>{cur!.cost === null ? "—" : fmtCost(cur!.cost)}</div>
                {prev && prev.cost !== null && cur!.cost !== null
                  ? (trendOf(cur!.cost, prev.cost) && (() => {
                      const tr = trendOf(cur!.cost!, prev.cost!)!;
                      return <div className="meta"><span className={tr.dir === "up" ? "up" : "dn"}>{tr.dir === "up" ? "▲" : "▼"} {tr.pct}%</span><span>{t("Usage_Meta_Prev", fmtCost(prev.cost))}</span></div>;
                    })())
                  : <div className="meta">{t("Usage_NoPrice")}</div>}
              </div>

              <div className="kpi">
                <div className="lbl">{t("Usage_Kpi_Input")}</div>
                <div className="val">{fmtTok(cur!.input)}</div>
                <div className="meta">
                  <b>{cur!.turns.toLocaleString()}</b><span className="u-lbl">{t("Usage_Kpi_Turns")}</span>
                  {prev && prev.input > 0 && (() => {
                    const tr = trendOf(cur!.input, prev.input);
                    return tr ? <span className={tr.dir === "up" ? "up" : "dn"}>{tr.dir === "up" ? "▲" : "▼"} {tr.pct}%</span> : null;
                  })()}
                </div>
              </div>

              <div className="kpi">
                <div className="lbl">{t("Usage_Kpi_Output")}</div>
                <div className="val">{fmtTok(cur!.output)}</div>
                <div className="meta">
                  <b>{cur!.turns > 0 ? fmtTok(Math.round(cur!.output / cur!.turns)) : "—"}</b>
                  <span className="u-lbl">{t("Usage_Kpi_PerTurn")}</span>
                  {prev && prev.output > 0 && cur!.turns > 0 && (() => {
                    const pt = prev.turns > 0 ? prev.output / prev.turns : 0;
                    const tr = trendOf(cur!.output / cur!.turns, pt);
                    return tr ? <span className={tr.dir === "up" ? "up" : "dn"}>{tr.dir === "up" ? "▲" : "▼"} {tr.pct}%</span> : null;
                  })()}
                </div>
              </div>

              <div className="kpi">
                <div className="lbl">{t("Usage_Kpi_Cache")}</div>
                <div className="val">{fmtTok(cur!.cache)}</div>
                <div className="meta">
                  <b>{Math.round(hitRate * 100)}%</b><span className="u-lbl">{t("Usage_Kpi_HitRate")}</span>
                  {rep.cacheBreaks > 0 && <span className="warn">{t("Usage_Kpi_Breaks", rep.cacheBreaks)}</span>}
                </div>
              </div>

              <div className="kpi">
                <div className="lbl">{t("Usage_Kpi_Scale")}</div>
                <div className="val">{rep.byTask.length}<span className="u">/ {rep.byModel.length}</span></div>
                <div className="meta">
                  <span>{t("Usage_Kpi_Repos", rep.repoPaths.length)}</span>
                  <span className="sep2" />
                  <span>{rep.emptyRepos.length ? t("Usage_Kpi_Empty", rep.emptyRepos.length) : t("Usage_Kpi_NoEmpty")}</span>
                </div>
              </div>
            </div>

            <div className="grid-2a">
              <div className="usage-card">
                <div className="card-hd">
                  <h3>{t("Usage_Trend_Title")}</h3>
                  <span className="note">{t("Usage_Trend_Note")}</span>
                  <span className="grow" />
                  <span className="note">{t("Usage_Trend_Total", w!.cur.length, cur!.cost === null ? "—" : fmtCost(cur!.cost))}</span>
                </div>
                {w!.cur.length ? (
                  <>
                    <div className="trend-box" ref={tipBoxRef}>
                      <TrendChart rows={w!.cur} vis={vis} models={rep.byDayModel} onTip={setTip} />
                      {tip && (
                        <div className="usage-tip" style={{ left: clampTip(tip.x, tipBoxRef) }}>
                          <div className="tp-h">{tip.row.day}</div>
                          <div className="tp-r"><span>{t("Usage_Tip_Turns")}</span><b>{tip.row.turns.toLocaleString()}</b></div>
                          <div className="tp-r"><span>{t("Usage_Tip_Input")}</span><b>{fmtTok(tip.row.inputTokens)}</b></div>
                          <div className="tp-r"><span>{t("Usage_Tip_Output")}</span><b>{fmtTok(tip.row.outputTokens)}</b></div>
                          <div className="tp-r"><span>{t("Usage_Tip_Cache")}</span><b>{fmtTok(tip.row.cacheReadTokens)} · {Math.round(tip.row.cacheRate * 100)}%</b></div>
                          <div className="tp-r tp-cost"><span>{t("Usage_Tip_Cost")}</span><b>{fmtCost(tip.row.cost)}</b></div>
                          {tip.models.length > 0 && (
                            <div className="tp-models">
                              <div className="tp-m-h">{t("Usage_Tip_Model_Title")}</div>
                              {tip.models.map((m) => (
                                <div key={m.modelRef} className="tp-m-r">
                                  <span className="tp-m-nm" style={{"--md": MODEL_DOT(m.modelRef)} as React.CSSProperties}>{modelName(rep.modelNames, m.modelRef)}</span>
                                  <b>{fmtTok(m.inputTokens)}<span className="u">· {fmtTok(m.outputTokens)}</span></b>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="trend-metric">
                      {([["input", "Usage_M_Input"], ["cache", "Usage_M_Cache"], ["output", "Usage_M_Output"]] as const).map(([k, labelKey]) => (
                        <span key={k} className={"m" + (vis[k] ? " on" : " off")} onClick={() => setVis({ ...vis, [k]: !vis[k] })}>
                          <span className={"sw " + k} />{t(labelKey)}
                        </span>
                      ))}
                      <span className="sep" />
                      <span className={"m" + (vis.cost ? " on" : " off")} onClick={() => setVis({ ...vis, cost: !vis.cost })}>
                        <span className="sw cost" />{t("Usage_M_Cost")}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="empty-cell">{t("Usage_NoDayRows")}</div>
                )}
              </div>

              <div className="usage-card">
                <div className="card-hd">
                  <h3>{t("Usage_Model_Title")}</h3>
                  <span className="grow" />
                  <span className="note">{t("Usage_Model_Scope")}</span>
                </div>
                <ModelList rep={rep} />
              </div>
            </div>

            {/* 按模型的每日输入：独立图，每条线 = 一个模型的逐日 token */}
            <div className="usage-card">
              <div className="card-hd">
                <h3>{t("Usage_Trend_Model_Title")}</h3>
                <span className="note">{t("Usage_Trend_Model_Note")}</span>
                <span className="grow" />
                <span className="note">{t("Usage_Trend_Model_Limit", MAX_MODELS)}</span>
              </div>
              {w!.cur.length && rep.byModel.length ? (
                <>
                  <div className="trend-box" ref={mtBoxRef}>
                    <ModelTrendChart rows={w!.cur} byDayModel={rep.byDayModel} models={rep.byModel} modelNames={rep.modelNames} onTip={setMTip} />
                    {mTip && (
                      <div className="usage-tip" style={{ left: clampTip(mTip.x, mtBoxRef) }}>
                        <div className="tp-h">{mTip.day}</div>
                        {mTip.rows.length ? mTip.rows.map((r) => (
                          <div key={r.modelRef} className="tp-m-r">
                            <span className="tp-m-nm" style={{"--md": MODEL_DOT(r.modelRef)} as React.CSSProperties}>{r.name}</span>
                            <b>{fmtTok(r.input)}<span className="u">· {fmtTok(r.output)}</span></b>
                          </div>
                        )) : <div className="tp-empty">{t("Usage_Tip_NoUsage")}</div>}
                      </div>
                    )}
                  </div>
                  <div className="trend-model">
                    {rep.byModel.map((m, mi) => {
                      const on = mi < MAX_MODELS;
                      return (
                        <span key={m.modelRef} className={"m" + (on ? " on" : " off")}
                          title={`${m.modelRef}\n${t("Usage_Trend_ByModelHint", fmtTok(m.inputTokens))}`}>
                          <span className="sw" style={{ background: MODEL_DOT(m.modelRef), "--mdash": MODEL_DASH_OF(m.modelRef) } as React.CSSProperties} />
                          <span className="nm">{modelName(rep.modelNames, m.modelRef)}</span>
                          <span className="v">{fmtTok(m.inputTokens)}</span>
                        </span>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="empty-cell">{t("Usage_NoDayRows")}</div>
              )}
            </div>

            <div className="usage-note">{t("Usage_Foot_Cost")}</div>
          </>
        )}
      </div>
    </div>
  );
}
