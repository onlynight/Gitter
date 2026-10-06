import { useEffect, useMemo, useRef, useState } from "react";
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

interface CodeContent {
  text: string;
  /** 字级强调段（并排配对行） */
  emph?: { text: string; emph: boolean }[];
}

/** 语法 run：TextMate 路径带解析后的 color；声明式路径缺省按 style 查主题 syntax 表。 */
type SyntaxRun = { start: number; end: number; style: string; color?: string };

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

export function DiffView(props: {
  diff: DiffDTO;
  inline?: boolean;
  selectedHunks?: Set<number>;
  onToggleHunk?: (index: number) => void;
  hunkActionLabel?: (index: number) => string;
  onHunkAction?: (index: number) => void;
  /** 语法高亮 + 字级 diff 开关（详情页只读视图开，普通渲染默认开） */
  rich?: boolean;
  /** 定位到新增行号（安全网发现跳转）：滚动到该行并短暂高亮；ts 变化即重复触发 */
  focusLine?: { line: number; ts: number } | null;
}) {
  const { diff } = props;
  const app = useApp();
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const line = props.focusLine?.line;
    if (!line) return;
    const el = rootRef.current?.querySelector(`[data-new-ln="${line}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.classList.add("ln-focus");
    const timer = setTimeout(() => el.classList.remove("ln-focus"), 1800);
    return () => {
      clearTimeout(timer);
      el.classList.remove("ln-focus");
    };
  }, [props.focusLine, diff]);
  const syntaxColors = app.theme?.syntax ?? {};
  const [syntaxLines, setSyntaxLines] = useState<{ left?: SyntaxRun[][]; right?: SyntaxRun[][] }>({});

  // 并排模式收集左/右行文本 → 两次桥调用取语法 runs（inline 模式行序不同构，v1 纯文本）
  const assembled = useMemo(() => {
    const left: string[] = [];
    const right: string[] = [];
    const rowsPerHunk: SideRow[][] = [];
    for (const h of diff.hunks) {
      const rows = buildSideRows(h);
      rowsPerHunk.push(rows);
      for (const r of rows) {
        left.push(r.left?.text ?? "");
        right.push(r.right?.text ?? "");
      }
    }
    return { left, right, rowsPerHunk };
  }, [diff]);

  useEffect(() => {
    if (!props.rich || props.inline) return;
    let cancelled = false;
    (async () => {
      try {
        const [r, r2] = await Promise.all([
          call<{ lines: SyntaxRun[][] }>("highlight.file", {
            path: diff.path,
            text: assembled.left.join("\n"),
          }),
          call<{ lines: SyntaxRun[][] }>("highlight.file", {
            path: diff.path,
            text: assembled.right.join("\n"),
          }),
        ]);
        if (!cancelled) setSyntaxLines({ left: r.lines, right: r2.lines });
      } catch {
        // 高亮失败静默降级为纯文本
      }
    })();
    return () => {
      cancelled = true;
    };
    // app.theme 进依赖：TextMate 颜色在主进程按活动主题解析，切主题需重拉
  }, [assembled, props.inline, props.rich, diff.path, app.theme]);

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

  if (diff.isBinary) {
    return (
      <div className="diff">
        <div className="diff-file-header">
          <span className="path">{diff.path}</span>
          <span className="diff-stats-del">{t("Diff_BinaryFile")}</span>
        </div>
      </div>
    );
  }

  const noteStrip = notes.length > 0 ? (
    <div className="hint" style={{ padding: "2px 10px", borderBottom: "1px solid var(--c-border)" }}>
      {notes.map((n, i) => <span key={i} style={{ marginRight: 12 }}>▸ {n.text}<span className="hint">（{n.packageId}）</span></span>)}
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
      <div className="diff">
        {header}
      {noteStrip}
      <div className="empty-state">{t("Diff_NoContentChange")}</div>
      </div>
    );
  }

  let rowOffset = 0;
  const body = diff.hunks.map((h, hi) => {
    const rows = assembled.rowsPerHunk[hi];
    const slice = (arr?: { start: number; end: number; style: string }[][]) =>
      arr ? arr.slice(rowOffset, rowOffset + rows.length) : undefined;
    const leftSyntax = slice(syntaxLines.left);
    const rightSyntax = slice(syntaxLines.right);
    rowOffset += rows.length;
    const checked = props.selectedHunks?.has(hi);
    return (
      <div key={hi}>
        {props.onToggleHunk ? (
          <div
            className={"hunk-header" + (checked ? " checked" : "")}
            title={t("Changes_ToggleHunkHint")}
            onClick={() => props.onToggleHunk!(hi)}
          >
            <input type="checkbox" readOnly checked={!!checked} style={{ pointerEvents: "none" }} />
            <span className="hunk-range">{`@@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@`}</span>
            <span style={{ flex: 1 }} />
            {props.onHunkAction && (
              <button className="tool-btn" style={{ height: 20, fontSize: 11 }} onClick={(e) => { e.stopPropagation(); props.onHunkAction!(hi); }}>
                {props.hunkActionLabel?.(hi) ?? t("Changes_StageHunk")}
              </button>
            )}
          </div>
        ) : null}
        {props.inline ? (
          <InlineHunkBody hunk={h} />
        ) : (
          <SideHunkBody rows={rows} leftSyntax={leftSyntax} rightSyntax={rightSyntax} colors={syntaxColors} rich={props.rich} />
        )}
        {!diff.newEndsWithNewline || !diff.oldEndsWithNewline ? (
          <div style={{ gridColumn: "1 / -1" }}>
            {!diff.oldEndsWithNewline && <div className="diff-cell d-del eof-note">\ {t("Diff_NoNewlineAtEof")}</div>}
            {!diff.newEndsWithNewline && <div className="diff-cell d-add eof-note">\ {t("Diff_NoNewlineAtEof")}</div>}
          </div>
        ) : null}
      </div>
    );
  });

  return (
    <div className="diff" ref={rootRef}>
      {header}
      {noteStrip}
      <div className={"diff-grid" + (props.inline ? " inline" : "")}>{body}</div>
    </div>
  );
}

function SideHunkBody(props: {
  rows: SideRow[];
  leftSyntax?: { start: number; end: number; style: string }[][] | undefined;
  rightSyntax?: { start: number; end: number; style: string }[][] | undefined;
  colors: Record<string, string>;
  rich?: boolean;
}) {
  const { rows, colors, rich } = props;
  const li = 0;
  void li;
  return (
    <>
      {rows.map((r, i) => {
        const leftCls = r.kind === "del" ? "d-del" : r.left ? "d-ctx" : "d-pad";
        const rightCls = r.kind === "add" ? "d-add" : r.right ? "d-ctx" : "d-pad";
        // 字级强调：del+add 配对行
        let leftEmph: { text: string; emph: boolean }[] | undefined;
        let rightEmph: { text: string; emph: boolean }[] | undefined;
        if (rich && r.left && r.right && (r.kind === "del" || r.kind === "add")) {
          const wd = wordDiff(r.left.text, r.right.text);
          leftEmph = renderSegments(r.left.text, wd.oldSpans);
          rightEmph = renderSegments(r.right.text, wd.newSpans);
        }
        const leftContent = r.left ? renderCode(r.left.text, props.leftSyntax?.[i], colors, leftEmph) : "";
        const rightContent = r.right ? renderCode(r.right.text, props.rightSyntax?.[i], colors, rightEmph) : "";
        return (
          <div className="diff-row" key={i}>
            <Cell num={r.left?.num} content={leftContent} cls={leftCls} />
            <Cell num={r.right?.num} newLn={r.right?.num} content={rightContent} cls={rightCls} />
          </div>
        );
      })}
    </>
  );
}

function InlineHunkBody({ hunk }: { hunk: HunkDTO }) {
  const rows = useMemo(() => {
    const out: { cls: string; num: number; text: string }[] = [];
    let oldNum = hunk.oldCount > 0 ? hunk.oldStart : hunk.oldStart + 1;
    let newNum = hunk.newCount > 0 ? hunk.newStart : hunk.newStart + 1;
    for (const l of hunk.oldLines) {
      if (l.startsWith("+")) out.push({ cls: "d-add", num: newNum++, text: l.slice(1) });
      else if (l.startsWith("-")) out.push({ cls: "d-del", num: oldNum++, text: l.slice(1) });
      else { out.push({ cls: "d-ctx", num: newNum, text: l.slice(1) }); oldNum++; newNum++; }
    }
    for (const l of hunk.newLines) {
      if (l.startsWith("+")) out.push({ cls: "d-add", num: newNum++, text: l.slice(1) });
      else if (l.startsWith("-")) out.push({ cls: "d-del", num: oldNum++, text: l.slice(1) });
      else { out.push({ cls: "d-ctx", num: newNum, text: l.slice(1) }); oldNum++; newNum++; }
    }
    return out;
  }, [hunk]);
  return (
    <>
      {rows.map((r, i) => (
        <div className="diff-row" key={i}>
          <Cell num={r.num} newLn={r.cls !== "d-del" ? r.num : undefined} content={r.text} cls={r.cls} />
        </div>
      ))}
    </>
  );
}

export function diffStatusLetter(d: DiffDTO): string {
  return d.isNew ? "A" : d.isDeleted ? "D" : d.isRenamed ? "R" : "M";
}
