import { useMemo, useState } from "react";
import type { DiffDTO, HunkDTO } from "../bridge/types";
import { t } from "../state/store";

// 并排行对：上下文 1:1 配对，删除/新增块按索引配对、短侧补空。
interface SideRow {
  kind: "ctx" | "add" | "del" | "pad";
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
      // 两侧都有：- 块对 + 块，按序配对到短侧耗尽
      const oIsDel = o!.startsWith("-");
      const nIsAdd = n!.startsWith("+");
      if (oIsDel && nIsAdd) {
        rows.push({ kind: "del", left: { num: oldNum++, text: o!.slice(1) }, right: { num: newNum++, text: n!.slice(1) }, } as SideRow);
        oi++; ni++;
      } else if (oIsDel) {
        rows.push({ kind: "del", left: { num: oldNum++, text: o!.slice(1) } });
        oi++;
      } else if (nIsAdd) {
        rows.push({ kind: "add", right: { num: newNum++, text: n!.slice(1) } });
        ni++;
      } else {
        // 双上下文但走到这里 = 计数错位，防死循环
        rows.push({ kind: "ctx", left: { num: oldNum++, text: o!.slice(1) }, right: { num: newNum++, text: n!.slice(1) } });
        oi++; ni++;
      }
    }
  }
  return rows;
}

function Cell(props: { num?: number; text: string; cls: string }) {
  return (
    <div className={"diff-cell " + props.cls}>
      <span className="ln">{props.num ?? ""}</span>
      <span className="code">{props.text}</span>
    </div>
  );
}

export function DiffView(props: {
  diff: DiffDTO;
  inline?: boolean;
  /** hunk 多选（变更页 hunk 级暂存用）；不传 = 只读 */
  selectedHunks?: Set<number>;
  onToggleHunk?: (index: number) => void;
  hunkActionLabel?: (index: number) => string;
  onHunkAction?: (index: number) => void;
}) {
  const { diff } = props;
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

  const body = diff.hunks.map((h, hi) => {
    const sideRows = props.inline ? null : buildSideRows(h);
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
            <span className="grow" style={{ flex: 1 }} />
            {props.onHunkAction && (
              <button className="tool-btn" style={{ height: 20, fontSize: 11 }} onClick={(e) => { e.stopPropagation(); props.onHunkAction!(hi); }}>
                {props.hunkActionLabel?.(hi) ?? t("Changes_StageHunk")}
              </button>
            )}
          </div>
        ) : null}
        {props.inline ? <InlineHunkBody hunk={h} /> : <SideHunkBody rows={sideRows!} />}
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
    <div className="diff">
      {header}
      <div className={"diff-grid" + (props.inline ? " inline" : "")}>{body}</div>
    </div>
  );
}

function SideHunkBody({ rows }: { rows: SideRow[] }) {
  return (
    <>
      {rows.map((r, i) => {
        const leftCls = r.kind === "del" ? "d-del" : r.left ? "d-ctx" : "d-pad";
        const rightCls = r.kind === "add" ? "d-add" : r.right ? "d-ctx" : "d-pad";
        return (
          <div className="diff-row" key={i}>
            <Cell num={r.left?.num} text={r.left?.text ?? ""} cls={leftCls} />
            <Cell num={r.right?.num} text={r.right?.text ?? ""} cls={rightCls} />
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
    const emit = (lines: string[]) => {
      for (const l of lines) {
        if (l.startsWith("+")) out.push({ cls: "d-add", num: newNum++, text: l.slice(1) });
        else if (l.startsWith("-")) out.push({ cls: "d-del", num: oldNum++, text: l.slice(1) });
        else { out.push({ cls: "d-ctx", num: newNum, text: l.slice(1) }); oldNum++; newNum++; }
      }
    };
    emit(hunk.oldLines);
    emit(hunk.newLines);
    return out;
  }, [hunk]);
  return (
    <>
      {rows.map((r, i) => (
        <div className="diff-row" key={i}>
          <Cell num={r.num} text={r.text} cls={r.cls} />
        </div>
      ))}
    </>
  );
}

export function diffStatusLetter(d: DiffDTO): string {
  return d.isNew ? "A" : d.isDeleted ? "D" : d.isRenamed ? "R" : "M";
}
