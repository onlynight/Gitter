/**
 * 任务页独立子页：改动（Codex Diff Review × Gitter 语义）+ 检查点（ZCode rewind）+ 后台 shell（v3.3）。
 * 由 TasksPage 消费（tab 切换挂载）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { call, onEvent } from "../bridge/client";
import type { AgentCheckpointDTO, AgentShellDTO, AgentSubtaskDTO, AgentSubtaskListDTO, AgentSubtaskTranscriptDTO, AgentTaskFileDTO, AgentEventDTO, DiffDTO } from "../bridge/types";
import { DiffView, renderMarkdown } from "../kit";
import { pageSdk } from "../pageSdk";
import { TlIcon } from "./taskIcons";
import {
  reduceBlocks, groupTurns, BUILTIN_TIMELINE_RENDERERS,
  type Block,
} from "./TaskTimeline";

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
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 16px" }}>
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

// ---- 后台 shell 页（v3.3 工作流 C · design v2 §5：命令列表 + 内嵌详情两级）----

type ShellFocus = { shellId: string; ts: number } | null;

export function ShellsTab(props: {
  taskId: string;
  live: boolean;
  tick: number;
  setError: (e: string) => void;
  /** 上报运行中 shell 数（页签徽标） */
  onCount: (n: number) => void;
  /** 卡片跳转锚：切到 shells 页后按此 shellId 自动展开详情（design v2 §5） */
  focus?: ShellFocus;
  /** 详情页已打开后清除跳转锚，避免后续重进反复跳 */
  onFocused?: () => void;
}) {
  const { taskId, live, tick } = props;
  const [shells, setShells] = useState<AgentShellDTO[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 详情页输出（agent.shell.output 拉底 + shell-output 事件追增量）
  const [detail, setDetail] = useState<{ output: string; running: boolean; exitCode: number | null } | null>(null);
  const [truncated, setTruncated] = useState(false);
  // 订阅时锚定的 shellId（切换时重拉）
  const detailShellRef = useRef<string | null>(null);
  const detailEndRef = useRef<HTMLDivElement | null>(null);

  const reload = useCallback(() => {
    void call<AgentShellDTO[]>("agent.task.shells", { taskId })
      .then((x) => { setShells(x); props.onCount(x.filter((s) => s.running).length); })
      .catch(() => { setShells([]); props.onCount(0); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  useEffect(() => { reload(); }, [reload, tick]);
  // 页签打开时 2s 轮询刷新（列表状态；详情页输出走事件通道 + 底部滚动追平）
  useEffect(() => {
    const iv = setInterval(reload, 2000);
    return () => clearInterval(iv);
  }, [reload]);

  // 跳转锚：切到 shells 页后自动选中并展开对应 shellId 详情
  useEffect(() => {
    if (!props.focus) return;
    setSelectedId(props.focus.shellId);
    props.onFocused?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focus?.ts]);

  // 详情页数据：切换 selectedId 时先拉底，再订阅 shell-output 追增量
  useEffect(() => {
    if (!selectedId) { setDetail(null); setTruncated(false); detailShellRef.current = null; return; }
    detailShellRef.current = selectedId;
    let cancelled = false;
    void call<{ output?: string; running?: boolean; exitCode?: number | null; truncated?: boolean } | null>(
      "agent.shell.output", { taskId, shellId: selectedId },
    ).then((r) => {
      if (cancelled) return;
      if (!r) {
        setDetail(null);
        setTruncated(false);
        return;
      }
      setDetail({ output: r.output ?? "", running: r.running ?? false, exitCode: r.exitCode ?? null });
      setTruncated(!!r.truncated);
      // 底部锚点
      requestAnimationFrame(() => detailEndRef.current?.scrollIntoView({ block: "end" }));
    }).catch(() => { if (!cancelled) setDetail(null); });
    return () => { cancelled = true; detailShellRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, taskId]);

  // shell-output 事件通道：只追当前详情页的 shellId；EOF 时刷新列表状态
  useEffect(() => {
    return onEvent("agent.event", (p) => {
      const { taskId: tid, event } = p as { taskId: string; event: AgentEventDTO };
      if (tid !== taskId || event.type !== "shell-output") return;
      if (!selectedId || event.shellId !== selectedId) return;
      const chunk = event.chunk ?? "";
      if (chunk) {
        setDetail((d) => d ? { ...d, output: d.output + chunk } : { output: chunk, running: true, exitCode: null });
      }
      if (event.eof) {
        // EOF：刷新列表（终止按钮消失、状态色归位），并追一次底部
        reload();
      }
      requestAnimationFrame(() => detailEndRef.current?.scrollIntoView({ block: "end" }));
    });
  }, [taskId, selectedId, reload]);

  const kill = async (shellId: string) => {
    setBusyId(shellId);
    try { await call("agent.task.shellKill", { taskId, shellId }); reload(); }
    catch (e) { props.setError((e as Error).message); }
    finally { setBusyId(null); }
  };

  const fmtDur = (s: AgentShellDTO) => {
    if (!s.running) return `exit ${s.exitCode ?? "-"}`;
    return "运行中";
  };

  const sel = selectedId ? shells.find((s) => s.shellId === selectedId) ?? null : null;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "7px 14px", borderBottom: "1px solid var(--c-border)" }}>
        <b style={{ fontSize: 12.5 }}>后台</b>
        <span style={{ color: "var(--c-text3)", fontSize: 11 }}>
          agent 命令执行记录（terminal_run 前/后台）· 仅 live 会话有数据
        </span>
        <span style={{ flex: 1 }} />
        <button className="tool-btn" onClick={reload}>刷新</button>
      </div>
      {sel ? (
        // ═══ 详情页：命令 + 完整输出 + 元信息 ═══
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderBottom: "1px solid var(--c-border)", flexWrap: "wrap" }}>
            <button className="tool-btn" onClick={() => setSelectedId(null)}>← 列表</button>
            <span className="tk-dot" style={{ color: sel.running ? "var(--c-amber)" : (sel.exitCode ?? 0) === 0 ? "var(--c-green)" : "var(--c-red)", animation: sel.running ? "tk-pulse 1.2s infinite" : undefined }} />
            <span className="tk-shell-cmd" title={sel.command}>{sel.command}</span>
            <span className="tk-shell-tm">{fmtDur(sel)}</span>
            {sel.running && (
              <button className="tool-btn" style={{ color: "var(--c-red)", borderColor: "color-mix(in srgb, var(--c-red) 38%, transparent)", flex: "none" }}
                disabled={busyId === sel.id} onClick={() => void kill(sel.id)}>终止</button>
            )}
          </div>
          <div className="tl-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "10px 14px" }}>
            {detail === null ? (
              <div style={{ color: "var(--c-text3)", fontSize: 12 }}>加载中…</div>
            ) : (
              <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 11.5, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-all", color: "var(--c-text)" }}>
                {detail.output || <span style={{ color: "var(--c-text3)" }}>（无输出）</span>}
                <div ref={detailEndRef} />
              </div>
            )}
            {truncated && (
              <div style={{ color: "var(--c-amber)", fontSize: 11, marginTop: 6 }}>
                ⚠ 输出超过 128KB 上限，仅显示尾部
              </div>
            )}
          </div>
        </div>
      ) : (
        // ═══ 列表页：全部 shell 条目 ═══
        <div className="tl-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 16px", width: "100%" }}>
          {!live && shells.length === 0 && (
            <div style={{ color: "var(--c-text3)", fontSize: 12, marginTop: 20, textAlign: "center" }}>
              重启后后台 shell 不保留（仅 live 会话内存）——时间线里 terminal_poll 的输出仍可回看
            </div>
          )}
          {live && shells.length === 0 && (
            <div style={{ color: "var(--c-text3)", fontSize: 12, marginTop: 20, textAlign: "center" }}>暂无命令执行记录</div>
          )}
          {shells.map((s) => (
            <div key={s.id} className="tk-shell" style={{ cursor: "pointer" }} onClick={() => setSelectedId(s.shellId)}>
              <div className="tk-shell-h">
                <span className="tk-dot" style={{ color: s.running ? "var(--c-amber)" : (s.exitCode ?? 0) === 0 ? "var(--c-green)" : "var(--c-red)", animation: s.running ? "tk-pulse 1.2s infinite" : undefined }} />
                <span className="tk-shell-cmd" title={s.command}>{s.command}</span>
                {s.foreground ? <span style={{ fontSize: 10, color: "var(--c-text3)", border: "1px solid var(--c-border)", borderRadius: 4, padding: "0 4px", flex: "none" }}>前台</span> : null}
                <span className="tk-shell-tm">{fmtDur(s)}</span>
                {s.running && (
                  <button className="tool-btn" style={{ color: "var(--c-red)", borderColor: "color-mix(in srgb, var(--c-red) 38%, transparent)", flex: "none" }}
                    disabled={busyId === s.id}
                    onClick={(e) => { e.stopPropagation(); void kill(s.id); }}>终止</button>
                )}
                <span style={{ marginLeft: "auto", color: "var(--c-text3)", fontSize: 11, flex: "none" }}>详情 ›</span>
              </div>
              {s.tail && <div className="tk-shell-tail" style={{ opacity: 0.75 }}>{s.tail}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ---- 子代理页（v4.9 设计稿 §5）：列表 + 详情 ----
// 列表：所有子代理按状态排序（running → failed/timeout → cancelled → completed），每条两行文本。
// 详情：对话样式与会话页完全一致（复用 reduceBlocks + groupTurns + renderBlock 管线）。
// 授权浮层：不在详情页承接——若子代理冒泡授权，详情页只显示普通动作行 + 「在主会话页回答 →」跳转徽章。

type SubagentFocus = { subtaskId: string; ts: number } | null;

const SUB_STATE_RANK = (s: string): number => s === "running" ? 0 : s === "failed" || s === "timeout" ? 1 : s === "cancelled" ? 2 : 3;
const SUB_READONLY_MODES = new Set(["review", "explore"]);

export function SubagentsTab(props: {
  taskId: string;
  live: boolean;
  tick: number;
  setError: (e: string) => void;
  /** 上报运行中子代理数（页签徽标） */
  onCount: (n: number) => void;
  /** 跳转锚：从会话内单行化子代理卡「← 查看详情」跳过来时按此 subtaskId 自动打开详情 */
  focus?: SubagentFocus;
  /** 详情页已打开后清除跳转锚，避免后续重进反复跳 */
  onFocused?: () => void;
  /** 授权浮层不在此承接——点「在主会话页回答 →」跳回会话页 */
  onJumpToChat?: () => void;
}) {
  const { taskId, live, tick } = props;
  const [subs, setSubs] = useState<AgentSubtaskDTO[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailBlocks, setDetailBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(() => {
    void call<AgentSubtaskListDTO>("agent.subtask.list", { taskId })
      .then((x) => {
        setSubs(x.subtasks);
        props.onCount(x.running);
      })
      .catch((e) => { props.setError(`子代理列表加载失败：${String(e)}`); setSubs([]); props.onCount(0); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  useEffect(() => { reload(); }, [reload, tick]);
  useEffect(() => {
    const iv = setInterval(reload, 2000);
    return () => clearInterval(iv);
  }, [reload]);

  // 跳转锚：切到子代理页后自动打开对应 subtaskId 详情
  useEffect(() => {
    if (!props.focus) return;
    setSelectedId(props.focus.subtaskId);
    props.onFocused?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focus?.ts]);

  // 详情拉底（幂等）：把当前 selectedId 的完整事件流归约为 blocks，仅在归约结果非空时 setDetailBlocks。
  // 用 setDetailBlocks(prev) 判断，避免 stale closure 覆盖实时增量订阅写入的更新。
  // 关键：stripSubtaskId——reduceBlocks 遇到带 subtaskId 的事件会去找匹配的 subtask block 挂到 children，
  // 但详情页是"扁平"渲染（该 subtask 自己就是被展开的内容），没有 subtask block 可挂，事件会被静默丢弃。
  // 所以前端必须剥掉 subtaskId，让 reduceBlocks 走普通 output/tool 分支。
  const stripSubtaskId = (ev: AgentEventDTO): AgentEventDTO => {
    if (!ev.subtaskId) return ev;
    const { subtaskId: _drop, ...rest } = ev;
    return rest;
  };

  const pullTranscript = useCallback(() => {
    if (!selectedId) return;
    setLoading(true);
    void call<AgentSubtaskTranscriptDTO>("agent.subtask.transcript", { taskId, subtaskId: selectedId })
      .then((r) => {
        let blocks: Block[] = [];
        for (const e of r.events) {
          if (e.kind === "event" && e.event) blocks = reduceBlocks(blocks, stripSubtaskId(e.event));
        }
        // 仅在归约出内容时写入；空结果不动当前 state（实时增量可能已经填充过）
        if (blocks.length > 0) setDetailBlocks((cur) => cur.length ? cur : blocks);
      })
      .catch((e) => { props.setError(`子代理详情加载失败：${String(e)}`); })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, taskId]);

  // 切换 selectedId：清空 → 拉底
  useEffect(() => {
    if (!selectedId) { setDetailBlocks([]); return; }
    setDetailBlocks([]);
    pullTranscript();
  }, [selectedId, taskId, pullTranscript]);

  // 实时增量：只追当前详情页的 subtaskId；其它子代理状态更新只刷列表
  useEffect(() => {
    if (!selectedId) return;
    return onEvent("agent.event", (p) => {
      const { taskId: tid, event } = p as { taskId: string; event: AgentEventDTO };
      if (tid !== taskId) return;
      if (event.subtaskId === selectedId) {
        // 剥掉 subtaskId 再喂给 reduceBlocks（同 pullTranscript 注释）
        setDetailBlocks((bs) => reduceBlocks(bs, stripSubtaskId(event)));
      } else if (event.type === "subtask") {
        // 其他子代理的状态更新（不影响当前详情，但触发列表刷新）
        reload();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, taskId]);

  // 兜底轮询：拉底命中为空但子代理仍在跑时，定期重拉；避免「初拉空 + 首条 agent.event 之间」的空白期。
  // 停止条件：detailBlocks 非空 或 selectedId 变更 或 组件卸载。
  const detailEmpty = detailBlocks.length === 0;
  useEffect(() => {
    if (!selectedId || !detailEmpty) return;
    const iv = setInterval(() => { pullTranscript(); }, 1500);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, detailEmpty, pullTranscript]);

  const sel = subs.find((x) => x.subtaskId === selectedId) ?? null;
  const sorted = [...subs].sort((a, b) => SUB_STATE_RANK(a.state) - SUB_STATE_RANK(b.state) || (a.startedAt > b.startedAt ? 1 : -1));
  const runningCount = subs.filter((x) => x.state === "running").length;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {selectedId === null || !sel ? (
        /* ═══ 列表视图 ═══ */
        <>
          <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--c-border)", display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: "var(--c-text3)" }}>
            <span style={{ color: "var(--c-text)" }}>子代理</span>
            <span>· {subs.length} 个</span>
            <span style={{ flex: 1 }} />
            <span>{runningCount} 运行中</span>
          </div>
          <div className="tk-sub-list" style={{ flex: 1, overflowY: "auto", padding: "8px 14px" }}>
            {subs.length === 0 && (
              <div className="empty">· 尚无子代理 · 主代理发起 task 工具调用即自动创建</div>
            )}
            {sorted.map((s) => (
              <div key={s.subtaskId} className={"tk-sub-item " + (s.state === "running" ? "running" : s.state === "failed" || s.state === "timeout" ? "fail" : "done")}
                onClick={() => setSelectedId(s.subtaskId)} role="button" tabIndex={0}>
                <span className="rail"><span className="dot">{s.state === "running" ? "◐" : "·"}</span></span>
                <span className="body">
                  <span className="title">{s.name || "子代理"}</span>
                  <span className="meta">
                    <span className="mode">{s.mode}</span>
                    <span>{s.toolCount} 个工具</span>
                    {s.fileCount > 0 && <span>{s.fileCount} 个文件</span>}
                    {s.permissionBubbles > 0 && <span>冒泡 {s.permissionBubbles} 次授权</span>}
                    {s.failureReason && <span className="fail">失败：{s.failureReason}</span>}
                  </span>
                </span>
                <span className="du">{s.durationMs != null ? (Math.round(s.durationMs / 100) / 10) + "s" : ""}</span>
                <span className="state-badge">{s.state}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        /* ═══ 详情视图 ═══ */
        <>
          <div className="tk-sub-detail-head" style={{ padding: "6px 14px", borderBottom: "1px solid var(--c-border)", display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--c-text3)" }}>
            <span className="back" onClick={() => setSelectedId(null)} role="button" tabIndex={0}>← 返回列表</span>
            <span style={{ fontSize: 16, color: sel.state === "running" ? "var(--c-amber)" : "var(--c-text3)", animation: sel.state === "running" ? "v47-blink 1s ease-in-out infinite" : undefined }}>◐</span>
            <span style={{ color: "var(--c-text)", fontWeight: 600, fontSize: 14 }}>{sel.name || "子代理"}</span>
            <span style={{ flex: 1 }} />
            <span className="meta">{sel.durationMs != null ? (Math.round(sel.durationMs / 100) / 10) + "s" : ""} · {sel.state}</span>
          </div>
          <div className="tl-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 20px 26px" }}>
            {loading && <div style={{ color: "var(--c-text3)", fontSize: 11, textAlign: "center" }}><span className="tl-pulse">加载中…</span></div>}
            {!loading && detailBlocks.length === 0 && (
              <div className="empty">· 子代理对话为空</div>
            )}
            {!loading && detailBlocks.length > 0 && (() => {
              const groups = groupTurns(detailBlocks);
              return groups.map((g, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {g.human && (
                    <div className="msg-row human" style={{ display: "flex", justifyContent: "flex-end", padding: "8px 0" }}>
                      <div className="bubble" style={{ maxWidth: "78%", background: "var(--c-panel2)", border: "1px solid var(--c-border)", borderRadius: "14px 14px 4px 14px", padding: "10px 14px", fontSize: 14.5, lineHeight: 1.65, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {(g.human as Extract<Block, { kind: "human" }>).text}
                      </div>
                    </div>
                  )}
                  {g.process.map((b, j) => renderSubDetailBlock(b, j, { onJumpToChat: () => props.onJumpToChat?.() }))}
                  {g.conclusion && (
                    <div className="assistant" style={{ fontSize: 14.5, lineHeight: 1.7, color: "var(--c-text)" }}
                      dangerouslySetInnerHTML={{ __html: renderMarkdown((g.conclusion as Extract<Block, { kind: "assistant" }>).text) }} />
                  )}
                </div>
              ));
            })()}
          </div>
          <div className="sub-detail-footer" style={{ padding: "8px 14px", fontSize: 11.5, color: "var(--c-text3)", borderTop: "1px solid var(--c-border)", display: "flex", justifyContent: "center", gap: 14, fontFamily: "var(--c-mono)" }}>
            <span>{sel.toolCount} 个工具</span>
            <span>·</span>
            <span>{detailBlocks.filter((b) => b.kind === "thinking").length} 个思考回合</span>
            <span>·</span>
            <span>{SUB_READONLY_MODES.has(sel.mode) ? "只读" : "可写"}工具面</span>
            <span>·</span>
            <span>冒泡 {sel.permissionBubbles} 次授权</span>
          </div>
        </>
      )}
    </div>
  );
}

// 详情对话块渲染（复用 BUILTIN_TIMELINE_RENDERERS；子代理块不递归展开——depth 已固定为 1）
function renderSubDetailBlock(b: Block, key: number, ctx: { onJumpToChat?: () => void }) {
  // 子代理详情页：不再显示嵌套的 subtask 块（子代理的 child 不再 spawnSubtask）
  if (b.kind === "subtask") return null;
  // 授权/问题块：显示为普通动作行 + 「在主会话页回答 →」跳转徽章
  if (b.kind === "permission" || b.kind === "question") {
    return (
      <div key={key} className="sub-row" style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 10, border: "1px solid color-mix(in srgb, var(--c-amber) 32%, transparent)", background: "color-mix(in srgb, var(--c-amber) 9%, transparent)" }}>
        <span style={{ color: "var(--c-amber)" }}>⚡</span>
        <span style={{ color: "var(--c-text)", fontWeight: 600 }}>授权</span>
        <span style={{ color: "var(--c-text2)", fontSize: 12.5 }}>· {b.kind === "permission" ? b.toolName : b.question.slice(0, 60)}</span>
        <span style={{ flex: 1 }} />
        <span onClick={ctx.onJumpToChat} role="button" tabIndex={0} style={{ cursor: "pointer", color: "var(--c-amber)", fontSize: 11.5 }}>
          在主会话页回答 →
        </span>
      </div>
    );
  }
  const def = BUILTIN_TIMELINE_RENDERERS.find((r) => r.blockKind === b.kind);
  if (!def) return null;
  return def.render({ block: b, taskId: "", ctx: { renderChildren: () => null } });
}
