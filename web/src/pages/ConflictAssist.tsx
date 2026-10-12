/**
 * 冲突闭环助手（M1.4 harness-mainline-roadmap.md）：
 * - 进行中状态横幅（merge/rebase/cherry-pick/revert）→ 继续 / 中止；
 * - 逐块冲突解决器：解析 <<<<<<< / ======= / >>>>>>> 标记，逐 hunk 三态决策
 *   （采用当前=ours / 采用传入=theirs / 两侧保留），全部决策后写回 + 暂存。
 * 纯前端解析 + 既有 RPC（git.ops.state / git.*Abort / git.*Continue / file.content / file.write / changes.stage）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { call } from "../bridge/client";
import type { GitOperationState } from "../bridge/types";

interface ConflictHunk {
  start: number; // 起始行（含 <<<<<<< 行）
  end: number; // 结束行（含 >>>>>>> 行）
  ours: string[]; // HEAD 侧（不含标记行）
  theirs: string[]; // 传入侧
  theirsLabel: string;
}

type Choice = "ours" | "theirs" | "both";

export function parseConflictHunks(content: string): { hunks: ConflictHunk[]; eol: "\n" | "\r\n" } {
  const eol: "\n" | "\r\n" = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const hunks: ConflictHunk[] = [];
  let i = 0;
  while (i < lines.length) {
    if (/^<{7} /.test(lines[i]) || lines[i] === "<<<<<<<") {
      const start = i;
      const ours: string[] = [];
      i++;
      while (i < lines.length && lines[i] !== "=======") { ours.push(lines[i]); i++; }
      if (i >= lines.length) break; // 未闭合：交给 git
      i++; // 跳过 =======
      const theirs: string[] = [];
      let theirsLabel = "";
      while (i < lines.length && !/^>{7} /.test(lines[i])) { theirs.push(lines[i]); i++; }
      if (i >= lines.length) break;
      theirsLabel = lines[i].replace(/^>{7} /, "");
      hunks.push({ start, end: i, ours, theirs, theirsLabel });
      i++;
    } else {
      i++;
    }
  }
  return { hunks, eol };
}

function applyChoices(lines: string[], hunks: ConflictHunk[], choices: Map<number, Choice>, eol: "\n" | "\r\n"): string {
  const out: string[] = [];
  let idx = 0;
  const byStart = new Map(hunks.map((h) => [h.start, h]));
  while (idx < lines.length) {
    const h = byStart.get(idx);
    if (!h) { out.push(lines[idx]); idx++; continue; }
    const c = choices.get(h.start) ?? "ours";
    if (c === "ours" || c === "both") out.push(...h.ours);
    if (c === "theirs" || c === "both") out.push(...h.theirs);
    idx = h.end + 1;
  }
  return out.join(eol);
}

export function ConflictAssist(props: { repo: string | null; conflictPath: string | null; onChanged: () => void }) {
  const [ops, setOps] = useState<GitOperationState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState<{ path: string; content: string; hunks: ConflictHunk[]; eol: "\n" | "\r\n" } | null>(null);
  const [choices, setChoices] = useState<Map<number, Choice>>(new Map());
  const timer = useRef<number | null>(null);

  const refreshOps = useCallback(async () => {
    if (!props.repo) { setOps(null); return; }
    try {
      setOps(await call<GitOperationState>("git.ops.state", {}));
    } catch {
      setOps(null);
    }
  }, [props.repo]);

  useEffect(() => {
    void refreshOps();
    timer.current = window.setInterval(() => void refreshOps(), 3000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [refreshOps]);

  const opAction = async (kind: "continue" | "abort") => {
    if (!ops?.kind) return;
    setBusy(true);
    setErr(null);
    try {
      // 四种进行中操作都接续行/中止 RPC（此前 cherry-pick/revert 只显示横幅不产生调用——死按钮）
      const base = ops.kind === "rebase" ? "git.rebase"
        : ops.kind === "merge" ? "git.merge"
        : ops.kind === "cherry-pick" ? "git.cherryPick"
        : "git.revert";
      await call(kind === "continue" ? `${base}Continue` : `${base}Abort`, {});
      props.onChanged();
      await refreshOps();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openResolver = async () => {
    if (!props.conflictPath) return;
    setErr(null);
    try {
      const r = await call<{ content: string } | null>("file.content", { path: props.conflictPath, revision: "worktree" });
      if (!r?.content) { setErr("读取冲突文件失败"); return; }
      const { hunks, eol } = parseConflictHunks(r.content);
      if (hunks.length === 0) { setErr("未解析到冲突标记（可能已解决，直接暂存即可）"); return; }
      setChoices(new Map());
      setModal({ path: props.conflictPath, content: r.content, hunks, eol });
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const saveResolved = async () => {
    if (!modal) return;
    setBusy(true);
    setErr(null);
    try {
      const lines = modal.content.split(/\r?\n/);
      const resolved = applyChoices(lines, modal.hunks, choices, modal.eol);
      await call("file.write", { path: modal.path, content: resolved });
      await call("changes.stage", { paths: [modal.path] });
      setModal(null);
      props.onChanged();
      await refreshOps();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const opName = ops?.kind === "merge" ? "合并" : ops?.kind === "rebase" ? `变基${ops.detail ? `（${ops.detail}）` : ""}`
    : ops?.kind === "cherry-pick" ? "拣选" : ops?.kind === "revert" ? "回退" : null;

  return (
    <>
      {props.repo && opName ? (
        <div className="chg-ops-banner">
          <span>⚠ 检测到进行中的{opName}操作——解决冲突后可继续，或中止恢复原状。</span>
          <span style={{ flex: 1 }} />
          <button className="tool-btn" disabled={busy} onClick={() => void opAction("abort")}>中止（--abort）</button>
          <button className="tool-btn primary" disabled={busy} onClick={() => void opAction("continue")}>继续（--continue）</button>
        </div>
      ) : null}
      {props.repo && props.conflictPath ? (
        <button className="tool-btn chg-conflict-btn" onClick={() => void openResolver()}>逐块解决冲突…</button>
      ) : null}
      {err && <div className="chg-ops-err">{err}</div>}
      {modal ? (
        <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) setModal(null); }}>
          <div className="modal chg-conflict-modal">
            <div className="modal-title">解决冲突：{modal.path}</div>
            <div className="chg-conflict-body">
              {modal.hunks.map((h) => {
                const c = choices.get(h.start);
                return (
                  <div key={h.start} className="chg-conflict-hunk">
                    <div className="chg-conflict-head">
                      <span>第 {h.start + 1} 行起 · 传入侧：{h.theirsLabel || "(unknown)"}</span>
                      <span className="chg-conflict-choice" style={{ color: c ? "var(--c-green)" : "var(--c-amber)" }}>
                        {c === "ours" ? "已选：当前" : c === "theirs" ? "已选：传入" : c === "both" ? "已选：两侧" : "未决策"}
                      </span>
                    </div>
                    <div className="chg-conflict-cols">
                      <pre className="chg-conflict-side ours">{h.ours.join("\n") || "（空）"}</pre>
                      <pre className="chg-conflict-side theirs">{h.theirs.join("\n") || "（空）"}</pre>
                    </div>
                    <div className="chg-conflict-actions">
                      <button className={"tool-btn" + (c === "ours" ? " on" : "")} onClick={() => setChoices((m) => new Map(m).set(h.start, "ours"))}>采用当前（HEAD）</button>
                      <button className={"tool-btn" + (c === "theirs" ? " on" : "")} onClick={() => setChoices((m) => new Map(m).set(h.start, "theirs"))}>采用传入（{h.theirsLabel.slice(0, 24) || "incoming"}）</button>
                      <button className={"tool-btn" + (c === "both" ? " on" : "")} onClick={() => setChoices((m) => new Map(m).set(h.start, "both"))}>两侧保留</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="modal-actions">
              <span className="chg-conflict-count">
                {choices.size}/{modal.hunks.length} 块已决策
              </span>
              <span style={{ flex: 1 }} />
              <button className="tool-btn" onClick={() => setModal(null)}>取消</button>
              <button className="tool-btn primary" disabled={busy || choices.size < modal.hunks.length} onClick={() => void saveResolved()}>
                写回并暂存
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
