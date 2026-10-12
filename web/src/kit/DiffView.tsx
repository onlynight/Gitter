import { memo, useEffect, useMemo, useRef, useState } from "react";
import { call } from "../bridge/client";
import type { DiffDTO, HunkDTO } from "../bridge/types";
import { t, useApp } from "../state/store";
import { renderSegments, wordDiff } from "./wordDiff";

// 并排行对：上下文 1:1 配对，删除/新增块按索引配对、短侧补空。
interface SideRow {
  kind: "ctx" | "add" | "del";
  left?: { num: number; text: string };
  right?: { num: number; text: string };
}

function buildSideRows(h: HunkDTO): SideRow[] {
  const rows: SideRow[] = [];
  const oldLines = h.oldLines.filter((l) => l.startsWith(" ") || l.startsWith("-"));
  const newLines = h.newLines.filter((l) => l.startsWith(" ") || l.startsWith("+"));
  let oldNum = h.oldCount > 0 ? h.oldStart : h.oldStart + 1;
  let newNum = h.newCount > 0 ? h.newStart : h.newStart + 1;
  let oi = 0;
  let ni = 0;
  while (oi < oldLines.length || ni < newLines.length) {
    const o = oldLines[oi];
    const n = newLines[ni];
    if (o?.startsWith(" ") && n?.startsWith(" ")) {
      rows.push({ kind: "ctx", left: { num: oldNum++, text: o.slice(1) }, right: { num: newNum++, text: n.slice(1) } });
      oi++; ni++;
    } else if (o && !n) {
      rows.push({ kind: "del", left: { num: oldNum++, text: o.slice(1) } });
      oi++;
    } else if (!o && n) {
      rows.push({ kind: "add", right: { num: newNum++, text: n.slice(1) } });
      ni++;
    } else {
      const oIsDel = o!.startsWith("-");
      const nIsAdd = n!.startsWith("+");
      if (oIsDel && nIsAdd) {
        rows.push({ kind: "del", left: { num: oldNum++, text: o!.slice(1) }, right: { num: newNum++, text: n!.slice(1) } });
        oi++; ni++;
      } else if (oIsDel) {
        rows.push({ kind: "del", left: { num: oldNum++, text: o!.slice(1) } });
        oi++;
      } else {
        rows.push({ kind: "add", right: { num: newNum++, text: n!.slice(1) } });
        ni++;
      }
    }
  }
  return rows;
}

/** 语法 run：TextMate 路径带解析后的 color；声明式路径缺省按 style 查主题 syntax 表。 */
type SyntaxRun = { start: number; end: number; style: string; color?: string };

// 高亮输入防线：超大文本（压缩产物单行可达数百 KB）逐行分词代价高，主进程声明式
// 回退更是 O(行长²)——超限的 diff 直接纯文本，不发桥调用
const MAX_HL_CHARS = 100_000;
const MAX_HL_LINE = 20_000;

// 虚拟化：扁平 item 数超过阈值才启用窗口化；小 diff 走同一渲染路径的全量分支
const VIRT_THRESHOLD = 600;
const OVERSCAN = 60;

// 行高运行时实测前的估值（mount 后按 .diff-cell/.hunk-header 实测校正）
const ROW_H_ESTIMATE = 18;
const HDR_H_ESTIMATE = 23;

const NO_COLORS: Record<string, string> = {};

// ---------- 扁平布局模型（并排/内联共用；虚拟化的单一数据源） ----------

interface RowItem {
  kind: "row";
  key: string;
  cells: 1 | 2;
  focusLn?: number;
  // 内联单列
  cls?: string;
  num?: number;
  text?: string;
  runIdx?: number;
  runSide?: "left" | "right";
  // 并排双列
  leftCls?: string;
  rightCls?: string;
  leftNum?: number;
  rightNum?: number;
  leftText?: string;
  rightText?: string;
  leftRunIdx?: number;
  rightRunIdx?: number;
}

interface HdrItem {
  kind: "hdr";
  key: string;
  hunk: number;
}

interface EofItem {
  kind: "eof";
  key: string;
  oldMissing: boolean;
  newMissing: boolean;
}

type FlatItem = RowItem | HdrItem | EofItem;

interface DiffLayout {
  items: FlatItem[];
  /** 前缀高度和（items.length + 1）：prefix[i] = 第 i 个 item 顶部相对 grid 的偏移 */
  prefix: Float64Array;
  totalHeight: number;
}

function renderCode(text: string, runs: SyntaxRun[] | undefined, colors: Record<string, string>, emph?: { text: string; emph: boolean }[]) {
  // 语法 runs 优先；无 runs 时用字级强调；都没有 = 纯文本
  if (runs && runs.length > 0) {
    const styled = runs.some((r) => r.style !== "plain" || r.color);
    if (styled) {
      return runs.map((r, i) => {
        const color = r.color ?? colors[r.style];
        return color ? (
          <span key={i} style={{ color }}>{text.slice(r.start, r.end)}</span>
        ) : (
          <span key={i}>{text.slice(r.start, r.end)}</span>
        );
      });
    }
  }
  if (emph) {
    return renderSegments(text, emph.filter((s) => s.emph).map((s) => {
      let start = 0;
      for (const seg of emph) {
        if (seg === s) break;
        start += seg.text.length;
      }
      return { start, end: start + s.text.length };
    })).map((seg, i) =>
      seg.emph ? <span key={i} className="wd-emph">{seg.text}</span> : <span key={i}>{seg.text}</span>,
    );
  }
  return text;
}

function Cell(props: { num?: number; content: React.ReactNode; cls: string; newLn?: number }) {
  return (
    <div className={"diff-cell " + props.cls} data-new-ln={props.newLn}>
      <span className="ln">{props.num ?? ""}</span>
      <span className="code">{props.content}</span>
    </div>
  );
}

/** 并排行：wordDiff 按行 memo（虚拟化下只对可视行计算），props 全为值/稳定引用。 */
const SideRowView = memo(function SideRowView(props: {
  row: RowItem;
  runsL?: SyntaxRun[];
  runsR?: SyntaxRun[];
  colors: Record<string, string>;
  rich: boolean;
}) {
  const { row } = props;
  const paired = row.leftText !== undefined && row.rightText !== undefined && (row.leftCls === "d-del" || row.rightCls === "d-add");
  const emph = useMemo(() => {
    if (!props.rich || !paired) return null;
    const wd = wordDiff(row.leftText!, row.rightText!);
    return { l: renderSegments(row.leftText!, wd.oldSpans), r: renderSegments(row.rightText!, wd.newSpans) };
  }, [props.rich, paired, row.leftText, row.rightText]);
  const leftContent = row.leftText !== undefined
    ? renderCode(row.leftText, props.runsL, props.colors, emph?.l)
    : "";
  const rightContent = row.rightText !== undefined
    ? renderCode(row.rightText, props.runsR, props.colors, emph?.r)
    : "";
  return (
    <div className="diff-row">
      <Cell num={row.leftNum} content={leftContent} cls={row.leftCls ?? "d-pad"} />
      <Cell num={row.rightNum} content={rightContent} cls={row.rightCls ?? "d-pad"} newLn={row.focusLn} />
    </div>
  );
});

const InlineRowView = memo(function InlineRowView(props: {
  row: RowItem;
  runs?: SyntaxRun[];
  colors: Record<string, string>;
}) {
  return (
    <div className="diff-row">
      <Cell num={props.row.num} newLn={props.row.focusLn} content={renderCode(props.row.text ?? "", props.runs, props.colors)} cls={props.row.cls ?? "d-ctx"} />
    </div>
  );
});

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let p = el?.parentElement ?? null;
  while (p) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === "auto" || oy === "scroll") return p;
    p = p.parentElement;
  }
  return null;
}

/** 前缀和上界：返回最后一个 prefix[i] <= y 的 i（y ≤ 0 → 0）。 */
function indexAt(prefix: Float64Array, y: number): number {
  let lo = 0;
  let hi = prefix.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (prefix[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const DiffViewImpl = function DiffView(props: {
  diff: DiffDTO;
  inline?: boolean;
  selectedHunks?: Set<number>;
  onToggleHunk?: (index: number) => void;
  hunkActionLabel?: (index: number) => string;
  onHunkAction?: (index: number) => void;
  /** 语法高亮 + 字级 diff 开关（缺省开；显式传 false 关闭） */
  rich?: boolean;
  /** 定位到新增行号（安全网发现跳转）：滚动到该行并短暂高亮；ts 变化即重复触发 */
  focusLine?: { line: number; ts: number } | null;
  /** 隐藏内置文件头（宿主已有自己的文件头时避免双头，如变更页右侧 chg-filehead） */
  hideHeader?: boolean;
}) {
  const { diff } = props;
  const rich = props.rich ?? true;
  const app = useApp();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const syntaxColors = app.theme?.syntax ?? NO_COLORS;
  const [syntaxLines, setSyntaxLines] = useState<{ left?: SyntaxRun[][]; right?: SyntaxRun[][] }>({});

  // ---------- 扁平布局：items（行/hunk 头/EOF 注记）为唯一行数据源 ----------
  const showHunkHeaders = !!props.onToggleHunk;

  const items = useMemo(() => {
    const out: FlatItem[] = [];
    if (props.inline) {
      diff.hunks.forEach((h, hi) => {
        if (showHunkHeaders) out.push({ kind: "hdr", key: `h${hi}`, hunk: hi });
        let oldNum = h.oldCount > 0 ? h.oldStart : h.oldStart + 1;
        let newNum = h.newCount > 0 ? h.newStart : h.newStart + 1;
        let oi = 0;
        for (const l of h.oldLines) {
          const c = l[0];
          const cls = c === "+" ? "d-add" : c === "-" ? "d-del" : "d-ctx";
          let num: number;
          if (c === "+") num = newNum++;
          else if (c === "-") num = oldNum++;
          else { num = newNum; oldNum++; newNum++; }
          out.push({
            kind: "row", key: `h${hi}o${oi}`, cells: 1, cls, num, text: l.slice(1),
            runIdx: oi, runSide: "left", focusLn: cls !== "d-del" ? num : undefined,
          });
          oi++;
        }
        let ni = 0;
        for (const l of h.newLines) {
          const c = l[0];
          const cls = c === "+" ? "d-add" : c === "-" ? "d-del" : "d-ctx";
          let num: number;
          if (c === "+") num = newNum++;
          else if (c === "-") num = oldNum++;
          else { num = newNum; oldNum++; newNum++; }
          out.push({
            kind: "row", key: `h${hi}n${ni}`, cells: 1, cls, num, text: l.slice(1),
            runIdx: ni, runSide: "right", focusLn: cls !== "d-del" ? num : undefined,
          });
          ni++;
        }
        if (!diff.oldEndsWithNewline || !diff.newEndsWithNewline) {
          out.push({ kind: "eof", key: `h${hi}eof`, oldMissing: !diff.oldEndsWithNewline, newMissing: !diff.newEndsWithNewline });
        }
      });
      return out;
    }
    let rowOffset = 0;
    diff.hunks.forEach((h, hi) => {
      const rows = buildSideRows(h);
      if (showHunkHeaders) out.push({ kind: "hdr", key: `h${hi}`, hunk: hi });
      rows.forEach((r, ri) => {
        out.push({
          kind: "row",
          key: `h${hi}r${ri}`,
          cells: 2,
          leftCls: r.kind === "del" ? "d-del" : r.left ? "d-ctx" : "d-pad",
          rightCls: r.kind === "add" ? "d-add" : r.right ? "d-ctx" : "d-pad",
          leftNum: r.left?.num,
          rightNum: r.right?.num,
          leftText: r.left?.text,
          rightText: r.right?.text,
          leftRunIdx: rowOffset + ri,
          rightRunIdx: rowOffset + ri,
          focusLn: r.right?.num,
        });
      });
      rowOffset += rows.length;
      if (!diff.oldEndsWithNewline || !diff.newEndsWithNewline) {
        out.push({ kind: "eof", key: `h${hi}eof`, oldMissing: !diff.oldEndsWithNewline, newMissing: !diff.newEndsWithNewline });
      }
    });
    return out;
  }, [diff, props.inline, showHunkHeaders]);

  // 高亮输入文本：直接从 items 聚合（并排行左右对齐；内联按 old/new 侧分列）
  const hlTexts = useMemo(() => {
    const left: string[] = [];
    const right: string[] = [];
    for (const it of items) {
      if (it.kind === "row" && it.cells === 2) {
        left.push(it.leftText ?? "");
        right.push(it.rightText ?? "");
      }
    }
    return { left, right };
  }, [items]);

  const hlTextsInline = useMemo(() => {
    if (!props.inline) return null;
    const oldLines: string[] = [];
    const newLines: string[] = [];
    for (const it of items) {
      if (it.kind === "row" && it.cells === 1) (it.runSide === "left" ? oldLines : newLines).push(it.text ?? "");
    }
    return { oldLines, newLines };
  }, [items, props.inline]);

  const [measured, setMeasured] = useState<{ rowH: number; hdrH: number }>({ rowH: ROW_H_ESTIMATE, hdrH: HDR_H_ESTIMATE });

  const layout: DiffLayout = useMemo(() => {
    const prefix = new Float64Array(items.length + 1);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      prefix[i + 1] = prefix[i] + (it.kind === "hdr"
        ? measured.hdrH
        : it.kind === "eof"
          ? ((it.oldMissing ? 1 : 0) + (it.newMissing ? 1 : 0)) * measured.rowH
          : measured.rowH);
    }
    return { items, prefix, totalHeight: prefix[items.length] };
  }, [items, measured]);

  const virtualize = items.length > VIRT_THRESHOLD;
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const activeRange = virtualize
    ? range ?? { start: 0, end: Math.min(items.length, 160) }
    : { start: 0, end: items.length };

  // 行高实测：窗口内首批元素挂载后校正估值（仅在实际变化时 setState，避免循环）
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const cell = grid.querySelector(".diff-cell") as HTMLElement | null;
    const hdr = grid.querySelector(".hunk-header") as HTMLElement | null;
    const rowH = cell ? cell.offsetHeight : ROW_H_ESTIMATE;
    const hdrH = hdr ? hdr.offsetHeight : HDR_H_ESTIMATE;
    if (rowH > 0 && hdrH > 0 && (rowH !== measured.rowH || hdrH !== measured.hdrH)) {
      setMeasured({ rowH, hdrH });
    }
  });

  // 滚动监听：最近可滚动祖先（无则退化为文档滚动），rAF 节流重算窗口
  useEffect(() => {
    if (!virtualize) return;
    const root = rootRef.current;
    if (!root) return;
    const sc = findScrollParent(root) ?? document.scrollingElement;
    const isDoc = sc === document.scrollingElement;
    let raf = 0;
    const recompute = () => {
      raf = 0;
      const grid = gridRef.current;
      if (!grid) return;
      const scrollTop = isDoc ? window.scrollY : (sc as HTMLElement).scrollTop;
      const viewH = isDoc ? window.innerHeight : (sc as HTMLElement).clientHeight;
      const scRect = isDoc ? { top: 0 } : (sc as HTMLElement).getBoundingClientRect();
      const gridTopContent = grid.getBoundingClientRect().top - scRect.top + scrollTop;
      const rel = scrollTop - gridTopContent;
      const visStart = indexAt(layout.prefix, rel);
      const visEnd = indexAt(layout.prefix, rel + viewH);
      const s = Math.max(0, visStart - OVERSCAN);
      const e = Math.min(layout.items.length, visEnd + OVERSCAN);
      setRange((prev) => (prev && Math.abs(prev.start - s) < 20 && Math.abs(prev.end - e) < 20 ? prev : { start: s, end: e }));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(recompute);
    };
    const target: HTMLElement | Window = isDoc ? window : (sc as HTMLElement);
    target.addEventListener("scroll", schedule, { passive: true });
    let ro: ResizeObserver | null = null;
    if (!isDoc) {
      ro = new ResizeObserver(schedule);
      ro.observe(sc as HTMLElement);
    }
    recompute();
    return () => {
      target.removeEventListener("scroll", schedule);
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [virtualize, layout]);

  useEffect(() => {
    if (!rich || diff.hunks.length === 0) return;
    const oldText = props.inline ? (hlTextsInline?.oldLines.join("\n") ?? "") : hlTexts.left.join("\n");
    const newText = props.inline ? (hlTextsInline?.newLines.join("\n") ?? "") : hlTexts.right.join("\n");
    if (
      Math.max(oldText.length, newText.length) > MAX_HL_CHARS ||
      oldText.split("\n").some((l) => l.length > MAX_HL_LINE) ||
      newText.split("\n").some((l) => l.length > MAX_HL_LINE)
    ) {
      setSyntaxLines({ left: [], right: [] });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [r, r2] = await Promise.all([
          call<{ lines: SyntaxRun[][] }>("highlight.file", {
            path: diff.path,
            text: oldText,
          }),
          call<{ lines: SyntaxRun[][] }>("highlight.file", {
            path: diff.path,
            text: newText,
          }),
        ]);
        if (cancelled) return;
        // 空响应不覆盖已有配色：主进程降级链瞬态失败（如 registry 重建窗口）时保持上次着色
        const hasRuns = (s?: SyntaxRun[][]) => !!s && s.some((l) => l.length > 0);
        setSyntaxLines((prev) =>
          hasRuns(r.lines) || hasRuns(r2.lines) || (!hasRuns(prev.left) && !hasRuns(prev.right))
            ? { left: r.lines, right: r2.lines }
            : prev,
        );
      } catch {
        // 高亮失败静默降级为纯文本
      }
    })();
    return () => {
      cancelled = true;
    };
    // app.theme 进依赖：TextMate 颜色在主进程按活动主题解析，切主题需重拉
  }, [rich, hlTexts, hlTextsInline, props.inline, diff.path, app.theme]);

  // diff 侧栏注记接缝（E 阶段收尾：L2 按路径只读注记）
  const [notes, setNotes] = useState<{ packageId: string; text: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    void call<{ packageId: string; text: string }[]>("diff.notes", { path: diff.path }).then((r) => {
      if (!cancelled) setNotes(r);
    });
    return () => {
      cancelled = true;
    };
  }, [diff.path]);

  // 定位到新增行号：虚拟化下目标行可能未渲染，先推窗口再滚动 + 短暂高亮
  useEffect(() => {
    const line = props.focusLine?.line;
    if (!line) return;
    let cancelled = false;
    let timer: number | undefined;
    const attempt = (tries: number) => {
      if (cancelled) return;
      const el = rootRef.current?.querySelector(`[data-new-ln="${line}"]`);
      if (el) {
        el.scrollIntoView({ block: "center" });
        el.classList.add("ln-focus");
        timer = window.setTimeout(() => el.classList.remove("ln-focus"), 1800);
        return;
      }
      if (tries <= 0) return;
      const idx = items.findIndex((it) => it.kind === "row" && it.focusLn === line);
      if (idx >= 0) setRange({ start: Math.max(0, idx - 40), end: Math.min(items.length, idx + 40) });
      requestAnimationFrame(() => window.setTimeout(() => attempt(tries - 1), 40));
    };
    attempt(virtualize ? 8 : 1);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [props.focusLine, diff, items, virtualize]);

  if (diff.isBinary) {
    return (
      <div className="diff" ref={rootRef}>
        {!props.hideHeader && (
          <div className="diff-file-header">
            <span className="path">{diff.path}</span>
            <span className="diff-stats-del">{t("Diff_BinaryFile")}</span>
          </div>
        )}
      </div>
    );
  }

  const noteStrip = notes.length > 0 ? (
    <div className="hint" style={{ padding: "2px 10px", borderBottom: "1px solid var(--c-border)" }}>
      {notes.map((n, i) => <span key={i} style={{ marginRight: 12 }}>▸ {n.text}<span className="hint">（{n.packageId}）</span></span>)}
    </div>
  ) : null;

  const truncatedStrip = diff.truncated ? (
    <div className="hint" style={{ padding: "2px 10px", borderBottom: "1px solid var(--c-border)" }}>
      ⚠ {t("Diff_Truncated")}
    </div>
  ) : null;

  const header = (
    <div className="diff-file-header">
      <span className={"status-letter " + (diff.isNew ? "st-A" : diff.isDeleted ? "st-D" : diff.isRenamed ? "st-R" : "st-M")}>
        {diff.isNew ? "A" : diff.isDeleted ? "D" : diff.isRenamed ? "R" : "M"}
      </span>
      <span className="path">{diff.isRenamed ? `${diff.oldPath} → ${diff.path}` : diff.path}</span>
      <span className="diff-stats-add">+{diff.addedLines}</span>
      <span className="diff-stats-del">−{diff.deletedLines}</span>
    </div>
  );

  // 无内容差异：纯重命名 / 属性（mode）变更等，头部之外没有可渲染的行
  if (diff.hunks.length === 0 && !diff.isBinary) {
    return (
      <div className="diff" ref={rootRef}>
        {!props.hideHeader && header}
        {noteStrip}
        <div className="empty-state">{t("Diff_NoContentChange")}</div>
      </div>
    );
  }

  const visible = items.slice(activeRange.start, activeRange.end);
  const topH = layout.prefix[activeRange.start];
  const bottomH = layout.totalHeight - layout.prefix[activeRange.end];

  const body = visible.map((it) => {
    if (it.kind === "hdr") {
      const hi = it.hunk;
      const checked = props.selectedHunks?.has(hi);
      return (
        <div
          key={it.key}
          className={"hunk-header" + (checked ? " checked" : "")}
          title={t("Changes_ToggleHunkHint")}
          onClick={() => props.onToggleHunk!(hi)}
        >
          <input type="checkbox" readOnly checked={!!checked} style={{ pointerEvents: "none" }} />
          <span className="hunk-range">{`@@ -${diff.hunks[hi].oldStart},${diff.hunks[hi].oldCount} +${diff.hunks[hi].newStart},${diff.hunks[hi].newCount} @@`}</span>
          <span style={{ flex: 1 }} />
          {props.onHunkAction && (
            <button className="tool-btn" style={{ height: 20, fontSize: 11 }} onClick={(e) => { e.stopPropagation(); props.onHunkAction!(hi); }}>
              {props.hunkActionLabel?.(hi) ?? t("Changes_StageHunk")}
            </button>
          )}
        </div>
      );
    }
    if (it.kind === "eof") {
      return (
        <div key={it.key} style={{ gridColumn: "1 / -1" }}>
          {it.oldMissing && <div className="diff-cell d-del eof-note">\ {t("Diff_NoNewlineAtEof")}</div>}
          {it.newMissing && <div className="diff-cell d-add eof-note">\ {t("Diff_NoNewlineAtEof")}</div>}
        </div>
      );
    }
    if (it.cells === 2) {
      return (
        <SideRowView
          key={it.key}
          row={it}
          runsL={syntaxLines.left?.[it.leftRunIdx ?? -1]}
          runsR={syntaxLines.right?.[it.rightRunIdx ?? -1]}
          colors={syntaxColors}
          rich={rich}
        />
      );
    }
    return (
      <InlineRowView
        key={it.key}
        row={it}
        runs={(it.runSide === "left" ? syntaxLines.left : syntaxLines.right)?.[it.runIdx ?? -1]}
        colors={syntaxColors}
      />
    );
  });

  return (
    <div className={"diff" + (props.hideHeader ? " hide-header" : "")} ref={rootRef}>
      {!props.hideHeader && header}
      {noteStrip}
      {truncatedStrip}
      <div className={"diff-grid" + (props.inline ? " inline" : "")} ref={gridRef}>
        {virtualize && topH > 0 && <div style={{ gridColumn: "1 / -1", height: topH }} />}
        {body}
        {virtualize && bottomH > 0 && <div style={{ gridColumn: "1 / -1", height: bottomH }} />}
      </div>
    </div>
  );
};

/** memo 化导出：props 浅比较（diff/selectedHunks 引用稳定 + 消费方回调需 useCallback），切掉 tick 驱动的全量重渲染。 */
export const DiffView = memo(DiffViewImpl);

export function diffStatusLetter(d: DiffDTO): string {
  return d.isNew ? "A" : d.isDeleted ? "D" : d.isRenamed ? "R" : "M";
}
