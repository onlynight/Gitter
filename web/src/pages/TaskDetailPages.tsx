/**
 * 任务页独立子页：改动（Codex Diff Review × Gitter 语义）+ 检查点（ZCode rewind）。
 * 由 TasksPage 消费（tab 切换挂载）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { call } from "../bridge/client";
import type { AgentCheckpointDTO, AgentTaskFileDTO, DiffDTO } from "../bridge/types";
import { DiffView } from "../kit";
import { pageSdk } from "../pageSdk";

const { notifyRepoChanged } = pageSdk;

type SettingsRulesLite = { id: string; tool: string; pattern: string | null; effect: "allow" | "deny"; scope: "global" | "repo"; createdAt: string };

// ---- 改动页（独立页 · Codex Diff Review × Gitter 语义）----

export function ChangesTab(props: {
  taskId: string;
  worktreePath: string;
  baselineSha: string;
  initialFile?: string | null;
  branch: string;
  tick: number;
  onReloadAgents: () => Promise<void>;
  setError: (e: string) => void;
  onCount: (n: number) => void;
  /** 本页发起的变更（还原文件）完成后通知父级 bump tick：文件列表与顶部徽标同步刷新 */
  onMutate?: () => void;
}) {
  const { taskId, worktreePath, baselineSha, initialFile, tick } = props;
  const [files, setFiles] = useState<AgentTaskFileDTO[]>([]);
  const [sel, setSel] = useState<string | null>(initialFile ?? null);
  const [diffs, setDiffs] = useState<DiffDTO[]>([]);
  const diffTextRef = useRef("");
  const [since, setSince] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    void call<AgentTaskFileDTO[]>("agent.task.files", { taskId })
      .then(async (fs) => {
        if (cancelled) return;
        setFiles(fs);
        props.onCount(fs.length);
        const target = sel && fs.some((f) => f.path === sel) ? sel : fs[0]?.path ?? null;
        setSel(target);
        if (target) {
          const [d, txt] = await Promise.all([
            call<DiffDTO[]>("agent.task.diff", { taskId, path: target, since }),
            call<string>("agent.task.diffText", { taskId, path: target, since }),
          ]);
          if (!cancelled) { setDiffs(d); diffTextRef.current = txt; }
        } else { setDiffs([]); diffTextRef.current = ""; }
      })
      .catch((e) => props.setError((e as Error).message))
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, tick, sel, since]);

  const pick = (x: string | null) => { setSel(x); setDiffs([]); };

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 14px", borderBottom: "1px solid var(--c-border)", flexWrap: "wrap" }}>
        <b style={{ fontSize: 12.5 }}>改动</b>
        <span style={{ color: "var(--c-text3)", fontSize: 11.5, fontFamily: "var(--mono, monospace)" }}>{props.branch}</span>
        <span style={{ color: "var(--c-text3)", fontSize: 11 }}>{files.length} 个文件 · 基于 {baselineSha.slice(0, 8)}^</span>
        {since ? <span style={{ color: "var(--c-amber)", fontSize: 11 }}>· 查看 {since}</span> : null}
        <span style={{ flex: 1 }} />
        <button className="tool-btn" onClick={() => void call("app.newWindow", { path: worktreePath })}>在 Changes 中打开</button>
        <button className="tool-btn" onClick={() => void navigator.clipboard?.writeText(diffTextRef.current)}>复制 diff</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "250px 1fr", overflow: "hidden" }}>
        <div style={{ borderRight: "1px solid var(--c-border)", overflowY: "auto", padding: 8 }}>
          {files.length === 0 && <div style={{ color: "var(--c-text3)", fontSize: 11.5, padding: 6 }}>{busy ? "加载中…" : "暂无改动"}</div>}
          {files.map((f) => {
            const letter = f.kind === "deleted" ? "D" : f.kind === "added" ? "A" : "M";
            const color = f.kind === "deleted" ? "var(--c-red)" : f.kind === "added" ? "var(--c-green)" : "var(--c-amber)";
            return (
              <div key={f.path} onClick={() => pick(f.path)}
                style={{ padding: "6px 9px", borderRadius: 8, cursor: "pointer", display: "flex", gap: 6, background: sel === f.path ? "var(--c-panel)" : "transparent", border: `1px solid ${sel === f.path ? "var(--c-text)" : "transparent"}` }}>
                <span style={{ fontFamily: "var(--mono, monospace)", fontWeight: 700, color }}>{letter}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--mono, monospace)", fontSize: 11.5 }}>{f.path}</span>
                <span style={{ color: "var(--c-text3)", fontFamily: "var(--mono, monospace)", fontSize: 10.5 }}>+{f.added ?? 0} −{f.deleted ?? 0}</span>
              </div>
            );
          })}
        </div>
        <div className="tl-scroll" style={{ overflowY: "auto", padding: "12px 16px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{ fontFamily: "var(--mono, monospace)", fontSize: 12.5, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sel ?? "（选择文件）"}</span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <button className="tool-btn" disabled={!sel} onClick={async () => {
                if (!sel || !window.confirm(`还原 ${sel} 到会话基线（${baselineSha.slice(0, 8)}）？该文件在本会话的改动将被丢弃。`)) return;
                try { await call("agent.task.restore", { taskId, sha: baselineSha, path: sel }); await props.onReloadAgents(); notifyRepoChanged(); props.onMutate?.(); } catch (e) { props.setError((e as Error).message); }
              }}>还原此文件</button>
              <button className="tool-btn">复制</button>
            </div>
          </div>
          {diffs.length === 0 ? (
            <div style={{ color: "var(--c-text3)", fontSize: 11.5 }}>{busy ? "加载中…" : "（无差异）"}</div>
          ) : diffs.map((d) => (
            <div key={d.path} style={{ marginBottom: 8 }}>
              <div style={{ color: "var(--c-text3)", fontSize: 11, padding: "2px 0" }}>{d.path} +{d.addedLines} −{d.deletedLines}</div>
              <DiffView diff={d} />
            </div>
          ))}
          <div style={{ color: "var(--c-text3)", fontSize: 11, marginTop: 8 }}>并排 / 内联 切换沿用现有 DiffView</div>
        </div>
      </div>
    </div>
  );
}

// ---- 检查点页（独立页 · ZCode rewind）----

export function CheckpointsTab(props: {
  taskId: string;
  branch: string;
  tick: number;
  setError: (e: string) => void;
  onCount: (n: number) => void;
  onViewDiff: () => void;
  /** 回滚完成后通知父级 bump tick：改动页文件列表与顶部徽标同步刷新 */
  onMutate?: () => void;
}) {
  const { taskId, tick } = props;
  const [cps, setCps] = useState<AgentCheckpointDTO[]>([]);
  const [viewSha, setViewSha] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<DiffDTO[]>([]);

  useEffect(() => {
    let cancelled = false;
    void call<AgentCheckpointDTO[]>("agent.task.checkpoints", { taskId })
      .then((x) => {
        if (cancelled) return;
        const r = x.reverse();
        setCps(r);
        props.onCount(r.length);
      })
      .catch((e) => props.setError((e as Error).message));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, tick]);

  useEffect(() => {
    if (!viewSha) { setDiffs([]); return; }
    let cancelled = false;
    void call<DiffDTO[]>("agent.task.diff", { taskId, since: `checkpoint:${viewSha}` })
      .then((d) => { if (!cancelled) setDiffs(d); })
      .catch((e) => props.setError((e as Error).message));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewSha]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "7px 14px", borderBottom: "1px solid var(--c-border)" }}>
        <b style={{ fontSize: 12.5 }}>检查点</b>
        <span style={{ color: "var(--c-text3)", fontSize: 11.5, fontFamily: "var(--mono, monospace)" }}>{props.branch}</span>
        <span style={{ color: "var(--c-text3)", fontSize: 11 }}>{cps.length} 个托管提交 · Esc×2 快捷回此页</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 16px", maxWidth: 880 }}>
        <div style={{ color: "var(--c-text3)", fontSize: 12, marginBottom: 10 }}>
          每轮结束自动托管 checkpoint。回滚 = ZCode rewind：恢复 worktree 到该轮之前（消息历史保留，可重新续跑）。
        </div>
        {cps.map((cp) => (
          <div key={cp.sha} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", border: "1px solid var(--c-border)", borderRadius: 10, padding: "8px 12px", marginBottom: 8, fontFamily: "var(--mono, monospace)", fontSize: 12 }}>
            <span style={{ color: "var(--c-text3)" }}>cp {cp.sha.slice(0, 8)}</span>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "inherit" }}>{cp.summary.replace(/^checkpoint:\s*/, "")}</span>
            <span style={{ color: "var(--c-text3)", fontSize: 11 }}>{cp.date.slice(5, 16).replace("T", " ")}</span>
            <button className="tool-btn" onClick={() => setViewSha(viewSha === cp.sha ? null : cp.sha)}>{viewSha === cp.sha ? "收起该轮 diff" : "查看该轮 diff"}</button>
            <button className="tool-btn" onClick={async () => {
              if (!window.confirm(`回滚 worktree 到 ${cp.sha.slice(0, 8)}？该 checkpoint 之后的所有改动将被丢弃（reset --hard）。`)) return;
              try { await call("agent.task.restore", { taskId, sha: cp.sha }); props.onViewDiff(); notifyRepoChanged(); props.onMutate?.(); } catch (e) { props.setError((e as Error).message); }
            }}>回滚到此处</button>
          </div>
        ))}
        {cps.length === 0 && <div style={{ color: "var(--c-text3)", fontSize: 11.5 }}>暂无 checkpoint</div>}
        {viewSha && (
          <div style={{ marginTop: 8, maxHeight: 320, overflowY: "auto", border: "1px solid var(--c-border)", borderRadius: 10, padding: 8 }}>
            {diffs.length === 0 ? <div style={{ color: "var(--c-text3)", fontSize: 11.5 }}>（该轮无改动）</div> : diffs.map((d) => (
              <div key={d.path}>
                <div style={{ color: "var(--c-text3)", fontSize: 11, padding: "2px 0" }}>{d.path} +{d.addedLines} −{d.deletedLines}</div>
                <DiffView diff={d} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

