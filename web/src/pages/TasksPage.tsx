import { useCallback, useEffect, useRef, useState } from "react";
import { call, onEvent } from "../bridge/client";
import { renderMarkdown } from "../lib/markdown";
import type { AgentEventDTO, AgentHarnessDTO, AgentTaskDTO, ModelProfileDTO, TaskTypeDTO, WorktreeDTO } from "../bridge/types";
import { refreshCurrent, setState, t, useApp, openSettings } from "../state/store";

/**
 * 任务页（agent-harness.md v3.0 §七，基准 = docs/gitter-fused-preview.html 设计稿）：
 * 两栏布局——左 400px 任务卡列（Agent 任务 + 手动 worktree），右侧选中任务详情
 * （标题行 / 三色时间线 / 内联授权卡 / 逃生舱 / 续跑-反馈输入区）。
 */

const LIVE_STATES = new Set(["starting", "working", "awaiting-input", "awaiting-permission"]);

const ACTOR_COLORS = {
  human: "var(--c-green)",
  agent: "var(--c-chip-purple-fg, #b490ff)",
  host: "var(--c-cyan, #4fc9d8)",
} as const;

type TimelineEntry = {
  /** agent 的 markdown 输出：按 md-body 渲染，且流式增量合并进上一条 */
  md?: boolean;
  merge?: boolean;
  actor: keyof typeof ACTOR_COLORS;
  glyph: string;
  text: string;
  color?: string;
  perm?: { requestId: string; command?: string | null; title?: string; question?: string };
};

function stateChip(s: AgentTaskDTO["state"]): { label: string; color: string } {
  switch (s) {
    case "starting": return { label: "Starting", color: "var(--c-text3)" };
    case "working": return { label: "● Working", color: "var(--c-green)" };
    case "awaiting-input": return { label: "Awaiting input", color: "var(--c-text)" };
    case "awaiting-permission": return { label: "● 待确认", color: "var(--c-amber)" };
    case "completed": return { label: "Completed", color: "var(--c-accent)" };
    case "failed": return { label: "Failed", color: "var(--c-red)" };
    case "interrupted": return { label: "Interrupted", color: "var(--c-amber)" };
    case "stopped": return { label: "Stopped", color: "var(--c-text3)" };
  }
}

function eventToEntry(ev: AgentEventDTO): TimelineEntry {
  switch (ev.type) {
    case "status": return { actor: "agent", glyph: "●", text: `${ev.phase}${ev.summary ? ` — ${ev.summary}` : ""}` };
    case "output":
      if (ev.stream === "assistant") return { actor: "agent", glyph: "", text: ev.text ?? "", md: true, merge: true };
      return { actor: "agent", glyph: "›", text: ev.text ?? "" };
    case "file-change": return { actor: "agent", glyph: ev.kind === "deleted" ? "−" : "+", text: `${ev.path}${ev.summary ? ` (${ev.summary})` : ""}`, color: ev.kind === "deleted" ? "var(--c-red)" : "var(--c-green)" };
    case "checkpoint": return { actor: "host", glyph: "✔", text: `宿主托管 checkpoint ${ev.commitSha?.slice(0, 8)} ${ev.summary ?? ""}` };
    case "turn-completed": return { actor: "agent", glyph: "↩", text: `turn.completed${ev.usage ? ` · ${ev.usage.input ?? "?"} in / ${ev.usage.output ?? "?"} out` : ""}` };
    case "completed": return { actor: "agent", glyph: "■", text: `${ev.outcome}${ev.summary ? ` — ${ev.summary}` : ""}`, color: ev.outcome === "failed" ? "var(--c-red)" : undefined };
    case "session-meta": return { actor: "agent", glyph: "⌁", text: `session ${ev.externalSessionId?.slice(0, 12)}` };
    case "permission": return { actor: "agent", glyph: "◈", text: `授权请求：${ev.command ?? ev.title ?? ""}`, perm: { requestId: ev.requestId!, command: ev.command, title: ev.title } };
    case "question": return { actor: "agent", glyph: "?", text: ev.question ?? "", perm: { requestId: ev.requestId!, title: ev.question } };
    case "log": return { actor: "host", glyph: "·", text: `${ev.level}: ${ev.text ?? ""}` };
  }
}

export function TasksPage() {
  const app = useApp();
  const repo = app.repo;
  const [worktrees, setWorktrees] = useState<WorktreeDTO[] | null>(null);
  const [harnesses, setHarnesses] = useState<AgentHarnessDTO[] | null>(null);
  const [agentTasks, setAgentTasks] = useState<AgentTaskDTO[] | null>(null);
  const [taskTypes, setTaskTypes] = useState<TaskTypeDTO[]>([]);
  const [modelProfiles, setModelProfiles] = useState<ModelProfileDTO[]>([]);
  const [taskTypeId, setTaskTypeId] = useState<string>("");
  const [modelId, setModelId] = useState<string>("");
  /** taskId → 事件（易失，账本只保 lastMessage / checkpoint 提交等持久事实） */
  const [evMap, setEvMap] = useState<Record<string, TimelineEntry[]>>({});
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const focusTaskId = useApp().focusTaskId;
  useEffect(() => {
    if (!focusTaskId) return;
    setSelectedTask(focusTaskId);
    setState({ focusTaskId: null });
  }, [focusTaskId]);
  const [error, setError] = useState<string | null>(null);
  const [transient, setTransient] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [composeText, setComposeText] = useState("");
  const [thinking, setThinking] = useState<"off" | "low" | "medium" | "high">("medium");
  const [sending, setSending] = useState(false);
  const replied = useRef(new Set<string>());
  const timelineRef = useRef<HTMLDivElement | null>(null);
  /** 时间线滚到底（双 rAF：等 markdown innerHTML 提交并完成布局后再定位） */
  const scrollTimelineToBottom = useCallback(() => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = timelineRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      }),
    );
  }, []);

  const reloadWorktrees = useCallback(async () => {
    if (!repo) return;
    try {
      setWorktrees(await call<WorktreeDTO[]>("tasks.list"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [repo]);

  const reloadAgents = useCallback(async () => {
    if (!repo) return;
    try {
      setHarnesses(await call<AgentHarnessDTO[]>("agents.list"));
      setAgentTasks(await call<AgentTaskDTO[]>("agent.tasks"));
      setTaskTypes(await call<TaskTypeDTO[]>("agent.taskTypes.list"));
      setModelProfiles(await call<ModelProfileDTO[]>("models.list"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [repo]);

  useEffect(() => {
    void reloadWorktrees();
    void reloadAgents();
  }, [repo, app.refreshTick, reloadWorktrees, reloadAgents]);

  useEffect(
    () =>
      onEvent("agent.event", (p) => {
        const { taskId, event } = p as { taskId: string; event: AgentEventDTO };
        setEvMap((m) => {
          const arr = [...(m[taskId] ?? [])];
          const e = eventToEntry(event);
          const last = arr[arr.length - 1];
          if (e.merge && last && last.merge) {
            // 流式增量合并：assistant markdown 渲染为一块，不逐 delta 断行
            arr[arr.length - 1] = { ...last, text: (last.text ?? "") + (e.text ?? "") };
          } else {
            arr.push(e);
          }
          return { ...m, [taskId]: arr.slice(-120) };
        });
        if (event.type === "completed" || event.type === "turn-completed") void reloadAgents();
      }),
    [reloadAgents],
  );
  useEffect(
    () =>
      onEvent("agent.tasks.changed", () => {
        void reloadAgents();
      }),
    [reloadAgents],
  );

  // 历史回填：选中任务且无实时事件时，从盘上日志恢复时间线（重启后可完整回放）
  useEffect(() => {
    if (!selectedTask) return;
    if ((evMap[selectedTask] ?? []).length > 0) return;
    let cancelled = false;
    void call<{ events: { ts: string; actor: "human" | "agent" | "host"; kind: "text" | "event"; text?: string; event?: AgentEventDTO }[] }>(
      "agent.task.history",
      { taskId: selectedTask },
    )
      .then((h) => {
        if (cancelled) return;
        const entries: TimelineEntry[] = h.events.map((je) => {
          if (je.kind === "text") return { actor: je.actor, glyph: "▶", text: je.text ?? "" } as TimelineEntry;
          return eventToEntry(je.event as AgentEventDTO);
        });
        setEvMap((m) => (m[selectedTask]?.length ? m : { ...m, [selectedTask]: entries }));
        scrollTimelineToBottom();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedTask, evMap]);

  // 时间线自动滚到底（流式增量跟随）
  useEffect(() => {
    scrollTimelineToBottom();
  }, [evMap, selectedTask, scrollTimelineToBottom]);

  const open = (w: WorktreeDTO) => {
    setState({ repo: { workDir: w.path, name: w.path.split(/[\\/]/).pop() ?? w.path }, page: "log" });
    refreshCurrent();
  };

  if (!repo) {
    return <div className="empty-state"><div className="big">🗂</div>{t("Common_NoProjectSelected")}</div>;
  }

  const selected = agentTasks?.find((x) => x.taskId === selectedTask) ?? null;
  const timeline = selectedTask ? evMap[selectedTask] ?? [] : [];
  const pendingPerm = [...timeline].reverse().find((e) => e.perm && !replied.current.has(e.perm.requestId));
  const modelInfo = harnesses?.[0]?.detect;

  const sendInput = async () => {
    if (!selected || !inputText.trim() || sending) return;
    const text = inputText.trim();
    setEvMap((m) => ({ ...m, [selected.taskId]: [...(m[selected.taskId] ?? []), { actor: "human", glyph: "▶", text }] }));
    setInputText("");
    setSending(true);
    try {
      await call("agent.task.resume", { taskId: selected.taskId, prompt: text, thinking });
      await reloadAgents();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  /** 对话式派活：右栏输入即建任务（标题/slug/基线全部自动派生；任务型/模型可选）。 */
  const createFromCompose = async () => {
    if (!composeText.trim() || sending) return;
    setSending(true);
    try {
      const record = await call<AgentTaskDTO>("agent.task.create", {
        prompt: composeText.trim(),
        taskType: taskTypeId || undefined,
        model: modelId || undefined,
        thinking,
      });
      setComposeText("");
      setSelectedTask(record.taskId);
      setEvMap((m) => ({ ...m, [record.taskId]: [{ actor: "human", glyph: "▶", text: t("Agents_Dispatched", record.title) }] }));
      await reloadAgents();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const agentCard = (task: AgentTaskDTO) => {
    const chip = stateChip(task.state);
    const live = LIVE_STATES.has(task.state);
    const selectedNow = selectedTask === task.taskId;
    return (
      <div
        key={task.taskId}
        className="card"
        style={{
          cursor: "pointer",
          borderColor: selectedNow ? "var(--c-accent)" : "var(--c-border)",
          background: selectedNow ? "var(--c-hover)" : undefined,
        }}
        onClick={() => { setSelectedTask(selectedNow ? null : task.taskId); setThinking(task.thinking ?? "medium"); }}
      >
        <div className="card-title">
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{task.title}</span>
          <span className="chip" style={{ color: chip.color, background: "transparent", border: `1px solid ${chip.color}` }}>{chip.label}</span>
        </div>
        <div className="card-path">
          <span style={{ color: "var(--c-chip-purple-fg)" }}>⚡ Gitter Agent</span>
          {" · "}{task.branch}
        </div>
        <div className="card-path">{task.worktreePath}</div>
        {task.lastMessage && (
          <div style={{ fontSize: 11, color: "var(--c-text)", marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {task.lastMessage}
          </div>
        )}
        <div className="card-actions" onClick={(e) => e.stopPropagation()}>
          {live && (
            <button className="tool-btn" onClick={async () => {
              try {
                await call("agent.task.stop", { taskId: task.taskId });
                setTransient(t("Agents_Stopped"));
                await reloadAgents();
              } catch (e) { setError((e as Error).message); }
            }}>{t("Agents_Stop")}</button>
          )}
          {!live && (
            <button className="tool-btn" onClick={() => { setSelectedTask(task.taskId); setInputText(""); }}>
              {t("Agents_Resume")}
            </button>
          )}
          {!live && (
            <button className="tool-btn" onClick={async () => {
              try {
                await call("agent.task.archive", { taskId: task.taskId, archived: true });
                if (selectedTask === task.taskId) setSelectedTask(null);
                await reloadAgents();
              } catch (e) { setError((e as Error).message); }
            }}>{t("Agents_Archive")}</button>
          )}
          <button className="tool-btn" onClick={() => void call("app.newWindow", { path: task.worktreePath })}>{t("Projects_NewWindow")}</button>
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "400px 1fr", gap: 14, flex: 1, minHeight: 0, alignItems: "stretch" }}>
      {/* ════ 左栏：任务卡列表 ════ */}
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, gap: 10 }}>
        {transient && <div className="toolbar" style={{ padding: 0 }}><span style={{ fontSize: 11, color: "var(--c-green)" }}>{transient}</span></div>}
        {error && <div className="banner error"><span className="banner-text">{error}</span><button className="tool-btn" onClick={() => setError(null)}>✕</button></div>}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
          {(agentTasks?.length ?? 0) === 0 && (
            <div className="card" style={{ fontSize: 12, color: "var(--c-text3)" }}>
              {t("Agents_EmptyHint")}
            </div>
          )}
          {agentTasks?.map(agentCard)}

          <div style={{ fontSize: 11, color: "var(--c-text3)", letterSpacing: 1, marginTop: 6 }}>{t("Tasks_WorktreeSection")}</div>
          {(worktrees ?? []).filter((w) => !w.isMain).map((w) => (
            <div key={w.path} className="card" style={{ padding: "8px 12px", cursor: "pointer" }} onClick={() => open(w)}>
              <div className="card-title" style={{ fontSize: 12 }}>🗂 {w.branch}</div>
              <div className="card-path">{w.path}</div>
              <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                <button className="tool-btn" onClick={() => open(w)}>{t("Tasks_Open")}</button>
                <button className="tool-btn" onClick={() => void call("app.newWindow", { path: w.path })}>{t("Projects_NewWindow")}</button>
                <button
                  className="tool-btn"
                  onClick={async () => {
                    try {
                      await call("tasks.remove", { path: w.path });
                      await reloadWorktrees();
                    } catch (e) { setError((e as Error).message); }
                  }}
                >
                  {t("Tasks_Remove")}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ════ 右栏：新任务（对话式派活） / 选中任务详情 ════ */}
      <div className="card" style={{ minHeight: 0, display: "flex", flexDirection: "column", padding: "14px 16px" }}>
        {!selected && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <b style={{ fontSize: 14 }}>⚡ Gitter Agent</b>
              {modelInfo?.available ? (
                <span className="chip" style={{ color: "var(--c-green)", background: "transparent", border: "1px solid var(--c-green)" }}>
                  ● {t("Agents_ModelReady")}{modelInfo.version ? ` · ${modelInfo.version}` : ""}
                </span>
              ) : (
                <button
                  className="tool-btn"
                  style={{ color: "var(--c-amber)", borderColor: "var(--c-amber)" }}
                  onClick={() => openSettings("models")}
                >
                  ● {t("Agents_ModelMissing")} → {t("Agents_OpenSettings")}
                </button>
              )}
              <span className="grow" />
              <span className="card-path">{t("Agents_ComposeHint")}</span>
            </div>
            {/* 输入台（ZCode 式）：描述在上，任务型/模型/思考深度 + 发送在台底 */}
            <div
              className="card"
              style={{
                flex: 1, minHeight: 200, display: "flex", flexDirection: "column", padding: "12px 14px",
                background: "var(--c-panel)", borderColor: composeText.trim() ? "var(--c-accent)" : "var(--c-border)",
              }}
              onClick={(e) => {
                const el = e.currentTarget.querySelector("textarea");
                if (el && e.target === el) return;
                (el as HTMLTextAreaElement | null)?.focus();
              }}
            >
              <textarea
                autoFocus
                className="input"
                style={{ flex: 1, minHeight: 150, resize: "none", fontSize: 13.5, background: "transparent", border: "none", outline: "none", color: "var(--c-text)", padding: 0 }}
                placeholder={t("Agents_ComposePlaceholder")}
                value={composeText}
                onChange={(e) => setComposeText(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void createFromCompose();
                }}
              />
              <div style={{ borderTop: "1px solid var(--c-border)", marginTop: 10, paddingTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <select className="input" style={{ width: 140 }} title={t("Agents_TaskType")} value={taskTypeId} onChange={(e) => setTaskTypeId(e.target.value)}>
                  <option value="">{t("Agents_TaskTypeFree")}</option>
                  {taskTypes.filter((tt) => !tt.error).map((tt) => (
                    <option key={tt.fullId} value={tt.fullId}>{tt.name}</option>
                  ))}
                </select>
                <select className="input" style={{ width: 170 }} title={t("Agents_Model")} value={modelId} onChange={(e) => setModelId(e.target.value)}>
                  <option value="">{t("Agents_ModelDefault")}</option>
                  {modelProfiles.filter((m) => m.configured).map((m) => (
                    <option key={m.id} value={m.id}>{m.name}{m.isDefault ? " ★" : ""}</option>
                  ))}
                </select>
                <select className="input" style={{ width: 120 }} title={t("Agents_Thinking")} value={thinking} onChange={(e) => setThinking(e.target.value as "off" | "low" | "medium" | "high")}>
                  <option value="high">{t("Agents_ThinkingHigh")}</option>
                  <option value="medium">{t("Agents_ThinkingMedium")}</option>
                  <option value="low">{t("Agents_ThinkingLow")}</option>
                  <option value="off">{t("Agents_ThinkingOff")}</option>
                </select>
                <span className="grow" />
                <button className="tool-btn primary" disabled={sending || !composeText.trim()} onClick={() => void createFromCompose()}>
                  {sending ? "…" : `${t("Agents_Send")} ▶`}
                </button>
              </div>
            </div>
            <div className="card-path">Ctrl+Enter · {t("Agents_TargetHint")}</div>
          </>
        )}
        {selected && (
          <>
            {/* 标题行 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <b style={{ fontSize: 14 }}>{selected.title}</b>
              <span className="chip" style={{ color: stateChip(selected.state).color, background: "transparent", border: `1px solid ${stateChip(selected.state).color}` }}>
                {stateChip(selected.state).label}
              </span>
              <span className="card-path">session {selected.taskId.slice(0, 8)} · ⚡ {selected.harnessFullId.split("/")[0]}</span>
              <select
                className="input"
                style={{ width: 160, fontSize: 11 }}
                value={selected.modelRef ?? ""}
                disabled={LIVE_STATES.has(selected.state) && selected.state !== "awaiting-input"}
                title={t("Agents_ModelBadgeTitle")}
                onChange={async (e) => {
                  try {
                    await call("agent.task.setModel", { taskId: selected.taskId, model: e.target.value });
                    await reloadAgents();
                  } catch (err) { setError((err as Error).message); }
                }}
              >
                {(modelProfiles ?? []).filter((m) => m.configured).map((m) => (
                  <option key={m.id} value={m.id}>{m.name}{m.isDefault ? " ★" : ""}</option>
                ))}
                {selected.modelRef && !(modelProfiles ?? []).some((m) => m.id === selected.modelRef) && (
                  <option value={selected.modelRef}>{selected.modelRef}</option>
                )}
              </select>
              <span className="grow" />
              <button className="tool-btn" onClick={() => void call("app.newWindow", { path: selected.worktreePath })}>{t("Projects_NewWindow")}</button>
            </div>
            <div className="card-path" style={{ marginTop: 2 }}>
              {selected.worktreePath} · 基线 {selected.baselineSha.slice(0, 8) || "—"}
              {selected.externalSessionId ? ` · session ${selected.externalSessionId.slice(0, 12)}` : ""}
            </div>

            {/* 时间线（三色：人=绿 / agent=紫 / 宿主=青） */}
            <div
              ref={timelineRef}
              style={{
                flex: 1, minHeight: 0, overflowY: "auto", marginTop: 12,
                borderLeft: "2px solid var(--c-border)", padding: "4px 0 4px 14px",
                display: "flex", flexDirection: "column", gap: 6,
              }}
              onClick={(e) => {
                // markdown 链接：webview 不跳转，交系统浏览器
                const a = (e.target as HTMLElement).closest("a");
                if (a) {
                  e.preventDefault();
                  const href = a.getAttribute("href") ?? "";
                  if (/^https?:\/\//i.test(href)) void call("shell.openExternal", { url: href });
                }
              }}
            >
              {timeline.length === 0 && <div className="card-path">{t("Agents_TimelineEmpty")}</div>}
              {timeline.map((e, i) => (
                e.md ? (
                  <div
                    key={i}
                    className="md-body"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(e.text ?? "") }}
                  />
                ) : (
                <div key={i} style={{ fontSize: 12.5, color: e.color ?? ACTOR_COLORS[e.actor], lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  <span className="mono" style={{ marginRight: 6 }}>{e.glyph}</span>
                  {e.text}
                  {e.perm && e.perm.requestId && !replied.current.has(e.perm.requestId) && (
                    <div style={{ marginTop: 6, border: "1px dashed var(--c-amber)", borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ color: "var(--c-amber)", fontWeight: 600, marginBottom: 4 }}>
                        ◈ {t("Agents_PermTitle")}
                        {e.perm.command ? <span className="card-path" style={{ marginLeft: 8 }}>{e.perm.command}</span> : null}
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <button className="tool-btn" onClick={async () => {
                          replied.current.add(e.perm!.requestId);
                          await call("agent.perm.reply", { requestId: e.perm!.requestId, ok: true, remember: true });
                        }}>{t("Agents_PermApprove")}</button>
                        <button className="tool-btn" onClick={async () => {
                          replied.current.add(e.perm!.requestId);
                          await call("agent.perm.reply", { requestId: e.perm!.requestId, ok: false, remember: false });
                        }}>{t("Agents_PermDeny")}</button>
                        <span style={{ fontSize: 10.5, color: "var(--c-text3)", marginLeft: "auto" }}>{t("Agents_PermNote")}</span>
                      </div>
                    </div>
                  )}
                </div>
                )
              ))}
            </div>

            {/* 输入区（续跑 / 反馈共用；可调思考深度，下一轮生效） */}
            <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "flex-end" }}>
              <select
                className="input"
                style={{ width: 120 }}
                title={t("Agents_Thinking")}
                value={thinking}
                onChange={(e) => setThinking(e.target.value as "off" | "low" | "medium" | "high")}
              >
                <option value="high">{t("Agents_ThinkingHigh")}</option>
                <option value="medium">{t("Agents_ThinkingMedium")}</option>
                <option value="low">{t("Agents_ThinkingLow")}</option>
                <option value="off">{t("Agents_ThinkingOff")}</option>
              </select>
              <textarea
                className="input"
                style={{ flex: 1, minHeight: 44, maxHeight: 120, resize: "vertical" }}
                placeholder={LIVE_STATES.has(selected.state) ? t("Agents_InputRunning") : t("Agents_InputPlaceholder")}
                disabled={LIVE_STATES.has(selected.state) && selected.state !== "awaiting-input"}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void sendInput();
                }}
              />
              <button className="tool-btn primary" style={{ alignSelf: "flex-end" }} disabled={sending || !inputText.trim()} onClick={() => void sendInput()}>
                {t("Agents_Send")}
              </button>
            </div>
          </>
        )}
      </div>

    </div>
  );
}
