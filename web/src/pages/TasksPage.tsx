import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { DiffView, renderMarkdown } from "../kit";
import type {
  AgentCheckpointDTO, AgentContextStatsDTO, AgentEventDTO, AgentHarnessDTO, AgentTaskDTO,
  AgentTaskFileDTO, DiffDTO, ModelProfileDTO, TaskTypeDTO, WorktreeDTO,
} from "../bridge/types";
import { pageSdk, useAppState, useTaskFocus } from "../pageSdk";
import {
  registerAgentUI, resolveTimelineRenderer, composerProviders, useAgentUIVersion,
  type TimelineRendererDef, type ComposerMentionProviderDef, type TimelineCardCtx,
} from "../external/agentUIShim";
// 任务页 v3（docs/task-page-v2-design.md）：Codex 信息架构（任务卡列表 + 对话/改动/检查点三独立页）
// × ZCode 交互（⏺ 工具卡折叠/⎿ 结果、编号授权选项、todo 清单、Esc/Esc×2、Shift+Tab 模式循环、
// 上下文条、发送/停止合一图标按钮）。页签为全局导航，改动/检查点为完全独立页（无对话元素）。
const { call, on: onEvent, t, openSettings, openRepo } = pageSdk;

const LIVE_STATES = new Set(["starting", "working", "awaiting-input", "awaiting-permission"]);
const BUSY_STATES = new Set(["starting", "working", "awaiting-permission"]);
const MODE_ORDER: ("plan" | "default" | "yolo")[] = ["plan", "default", "yolo"];
const MODE_META: Record<string, { label: string; color: string }> = {
  plan: { label: "◇ 规划", color: "var(--c-chip-purple-fg, #b490ff)" },
  default: { label: "● 默认", color: "var(--c-text3)" },
  yolo: { label: "⚡ Yolo", color: "var(--c-red)" },
};

const TOOL_LABELS: Record<string, string> = {
  repo_status: "工作区状态", repo_diff: "读取 diff", repo_log: "提交历史",
  repo_read_file: "读文件", repo_list_files: "列文件", repo_glob: "找文件", repo_grep: "搜索内容",
  review_get_state: "验收反馈", file_write: "写文件", file_patch: "编辑文件",
  git_stage: "暂存", git_commit: "提交", git_push: "推送",
  terminal_run: "执行命令", terminal_poll: "后台命令",
  ask_user: "提问", todo_write: "任务清单", plan_submit: "提交计划", task: "子代理",
};

/** 内置斜杠命令表（§20.3.8 数据化自举：补全列表与分发表同一数据源；包命令走 agent.command 贡献） */
const BUILTIN_SLASH: { name: string; arg?: string; hint: string }[] = [
  { name: "compact", hint: "立即压缩上下文" },
  { name: "clear", hint: "重置会话（保留 worktree/checkpoint）" },
  { name: "plan", hint: "切规划模式" },
  { name: "default", hint: "切默认模式" },
  { name: "yolo", hint: "切 yolo 模式" },
  { name: "approvals", hint: "切换审批模式（同 Shift+Tab）" },
  { name: "stop", hint: "中断当前轮" },
  { name: "model", arg: "<id>", hint: "切换模型档案" },
  { name: "thinking", arg: "<level>", hint: "切换思考深度" },
  { name: "fork", hint: "分叉任务" },
  { name: "skill", arg: "<名称>", hint: "注入技能指引" },
];

// ---- 时间线块模型（v3：⏺ 工具卡折叠 / ⎿ 结果缩进）----

type Todo = { content: string; status: "pending" | "in_progress" | "completed" };

type Block =
  | { kind: "human"; text: string }
  | { kind: "assistant"; text: string; merge: boolean }
  | { kind: "status"; text: string }
  | { kind: "tool"; callId: string; name: string; args?: unknown; state: "running" | "ok" | "error"; result?: string; durationMs?: number; source?: string | null; tail?: string; startTs: number }
  | { kind: "permission"; requestId: string; toolName: string; title: string; command?: string | null; payload?: AgentEventDTO["payload"]; rememberable?: boolean }
  | { kind: "question"; requestId: string; question: string; options: string[] }
  | { kind: "plan"; requestId: string; plan: string }
  | { kind: "todo"; todos: Todo[] }
  | { kind: "checkpoint"; sha: string; summary: string }
  | { kind: "file"; path: string; changeKind: string; summary?: string }
  | { kind: "subtask"; subtaskId: string; name: string; mode: string; state: string; final?: string; durationMs?: number; children: Block[] }
  | { kind: "turn"; text: string; usage?: { input?: number; output?: number } }
  | { kind: "log"; level: string; text: string };

const MAX_BLOCKS = 400;

function pushCap(arr: Block[], b: Block): Block[] {
  const next = [...arr, b];
  return next.length > MAX_BLOCKS ? next.slice(next.length - MAX_BLOCKS) : next;
}

/** 事件 → 块序列（纯归约；子代理事件按 subtaskId 归组嵌套）。 */
function reduceBlocks(blocks: Block[], ev: AgentEventDTO): Block[] {
  if (ev.subtaskId) {
    if (ev.type === "subtask") {
      const idx = [...blocks].reverse().findIndex((b) => b.kind === "subtask" && b.subtaskId === ev.subtaskId);
      if (idx >= 0) {
        const at = blocks.length - 1 - idx;
        const next = [...blocks];
        const sub = next[at] as Extract<Block, { kind: "subtask" }>;
        next[at] = { ...sub, state: ev.state ?? sub.state, final: ev.finalMessage ?? sub.final, durationMs: ev.durationMs ?? sub.durationMs };
        return next;
      }
      return pushCap(blocks, { kind: "subtask", subtaskId: ev.subtaskId, name: ev.name ?? "", mode: ev.mode ?? "", state: ev.state ?? "running", final: ev.finalMessage, durationMs: ev.durationMs, children: [] });
    }
    const idx = [...blocks].reverse().findIndex((b) => b.kind === "subtask" && b.subtaskId === ev.subtaskId);
    if (idx >= 0) {
      const at = blocks.length - 1 - idx;
      const sub = blocks[at] as Extract<Block, { kind: "subtask" }>;
      const inner = reduceBlocks([], { ...ev, subtaskId: undefined });
      let children = sub.children;
      for (const c of inner) children = pushCap(children, c);
      const next = [...blocks];
      next[at] = { ...sub, children };
      return next;
    }
    return blocks;
  }

  switch (ev.type) {
    case "status":
      return pushCap(blocks, { kind: "status", text: `${ev.phase ?? ""}${ev.summary ? ` — ${ev.summary}` : ""}` });
    case "output":
      if (ev.stream === "assistant") {
        const last = blocks[blocks.length - 1];
        if (last && last.kind === "assistant" && last.merge) {
          const next = [...blocks];
          next[next.length - 1] = { ...last, text: last.text + (ev.text ?? "") };
          return next;
        }
        return pushCap(blocks, { kind: "assistant", text: ev.text ?? "", merge: true });
      }
      if (ev.stream === "tool") {
        for (let i = blocks.length - 1; i >= 0; i--) {
          const b = blocks[i];
          if (b.kind === "tool" && b.name === "terminal_run" && b.state === "running") {
            const next = [...blocks];
            next[i] = { ...b, tail: ((b.tail ?? "") + (ev.text ?? "")).slice(-2000) };
            return next;
          }
        }
      }
      return blocks;
    case "tool": {
      if (ev.phase === "start") {
        return pushCap(blocks, { kind: "tool", callId: ev.callId ?? "", name: ev.name ?? "", args: ev.args, state: "running", source: ev.source, startTs: Date.now() });
      }
      for (let i = blocks.length - 1; i >= 0; i--) {
        const b = blocks[i];
        if (b.kind === "tool" && b.callId === ev.callId) {
          const next = [...blocks];
          next[i] = { ...b, state: ev.isError ? "error" : "ok", result: ev.result, durationMs: ev.durationMs };
          return next;
        }
      }
      return blocks;
    }
    case "permission":
      return pushCap(blocks, { kind: "permission", requestId: ev.requestId ?? "", toolName: ev.toolName ?? ev.title ?? "", title: ev.title ?? "", command: ev.command, payload: ev.payload, rememberable: ev.rememberable });
    case "question":
      return pushCap(blocks, { kind: "question", requestId: ev.requestId ?? "", question: ev.question ?? "", options: ev.options ?? [] });
    case "plan":
      return pushCap(blocks, { kind: "plan", requestId: ev.requestId ?? "", plan: ev.plan ?? "" });
    case "todo":
      return [...blocks.filter((b) => b.kind !== "todo"), { kind: "todo", todos: ev.todos ?? [] }];
    case "checkpoint":
      return pushCap(blocks, { kind: "checkpoint", sha: ev.commitSha ?? "", summary: ev.summary ?? "" });
    case "file-change":
      return pushCap(blocks, { kind: "file", path: ev.path ?? "", changeKind: ev.kind ?? "modified", summary: ev.summary });
    case "subtask":
      return pushCap(blocks, { kind: "subtask", subtaskId: ev.subtaskId ?? "", name: ev.name ?? "", mode: ev.mode ?? "", state: ev.state ?? "running", final: ev.finalMessage, durationMs: ev.durationMs, children: [] });
    case "turn-completed":
      return pushCap(blocks, { kind: "turn", text: `turn #${blocks.filter((b) => b.kind === "turn").length + 1}`, usage: ev.usage });
    case "completed":
      return pushCap(blocks, { kind: "status", text: `${ev.outcome ?? ""}${ev.summary ? ` — ${ev.summary}` : ""}` });
    case "log":
      return pushCap(blocks, { kind: "log", level: ev.level ?? "info", text: ev.text ?? "" });
    default:
      return blocks;
  }
}

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

// ---- ZCode 式交互组件 ----

type PermOption = { label: string; reply: { ok: boolean; remember?: boolean; rulePrefix?: string | null } };

/** 授权卡编号选项生成（§四：一次 / 本会话 / 总是允许前缀 / 否）。 */
function permOptions(b: Extract<Block, { kind: "permission" }>): PermOption[] {
  const sig = b.command ?? b.title;
  const prefix = sig ? sig.slice(0, 24) : null;
  const opts: PermOption[] = [{ label: "1. 是，执行一次", reply: { ok: true } }];
  if (b.rememberable !== false) opts.push({ label: "2. 是，本会话不再询问", reply: { ok: true, remember: true } });
  if (prefix) opts.push({ label: `3. 是，总是允许前缀 “${prefix}”`, reply: { ok: true, remember: true, rulePrefix: prefix } });
  opts.push({ label: `${opts.length + 1}. 否，告诉 agent 改用其他方式`, reply: { ok: false } });
  return opts;
}

function AgentImage(props: { taskId: string; path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void call<{ dataUrl?: string; error?: string }>("agent.previewImage", { taskId: props.taskId, path: props.path })
      .then((r) => {
        if (cancelled) return;
        if (r.dataUrl) setSrc(r.dataUrl);
        else setErr(r.error ?? "加载失败");
      })
      .catch((e) => setErr((e as Error).message));
    return () => { cancelled = true; };
  }, [props.taskId, props.path]);
  if (err) return <div style={{ color: "var(--c-text3)", fontSize: 11.5 }}>🖼 {props.path}（{err}）</div>;
  if (!src) return <div style={{ color: "var(--c-text3)", fontSize: 11.5 }}>🖼 {props.path}（加载中…）</div>;
  return <img src={src} alt={props.path} style={{ maxWidth: 320, maxHeight: 220, borderRadius: 6, border: "1px solid var(--c-border)" }} />;
}

function MentionPopover(props: {
  mention: { start: number; prefix: string; query: string } | null;
  items: { label: string; insert: string }[];
  onPick: (insert: string) => void;
}) {
  const { mention, items, onPick } = props;
  if (!mention || items.length === 0) return null;
  return (
    <div style={{ position: "absolute", bottom: "100%", left: 0, right: 0, marginBottom: 4, maxHeight: 180, overflowY: "auto", background: "var(--c-panel)", border: "1px solid var(--c-border)", borderRadius: 8, zIndex: 20 }}>
      {items.map((it) => (
        <div key={it.label} style={{ padding: "4px 10px", fontSize: 12, cursor: "pointer" }} onMouseDown={(e) => { e.preventDefault(); onPick(it.insert); }}>
          {it.label}
        </div>
      ))}
    </div>
  );
}

/** ⏺ 工具卡（ZCode 形态：默认折叠一行，⎿ 结果缩进一行；点击展开完整；terminal 运行中 tail 4 行） */
function ToolCard({ b }: { b: Extract<Block, { kind: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const label = TOOL_LABELS[b.name] ?? b.name;
  const argSummary = (() => {
    try {
      const a = b.args as Record<string, unknown> | undefined;
      if (!a) return "";
      if (typeof a.command === "string") return a.command.slice(0, 110);
      if (typeof a.path === "string") return a.path;
      if (typeof a.pattern === "string") return JSON.stringify(a).slice(0, 110);
      if (Array.isArray(a.paths)) return (a.paths as string[]).slice(0, 3).join(", ");
      if (typeof a.question === "string") return a.question.slice(0, 80);
      return JSON.stringify(a).slice(0, 110);
    } catch { return ""; }
  })();
  const glyphColor = b.state === "running" ? "var(--c-amber)" : b.state === "error" ? "var(--c-red)" : "var(--c-green)";
  const firstLine = (b.result ?? "").split("\n")[0] ?? "";
  return (
    <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 12.5 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "2px 4px", borderRadius: 6 }} onClick={() => setOpen(!open)}>
        <span style={{ color: glyphColor }}>⏺</span>
        <span style={{ fontWeight: 700 }}>{label}</span>
        <span style={{ color: "var(--c-text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{argSummary}</span>
        {b.source ? <span style={{ fontSize: 9.5, border: "1px solid var(--c-border)", borderRadius: 4, padding: "0 4px", color: "var(--c-text3)" }}>{b.source}</span> : null}
        {b.durationMs !== undefined ? <span style={{ color: "var(--c-text3)", fontSize: 11 }}>{(b.durationMs / 1000).toFixed(1)}s</span> : null}
      </div>
      <div style={{ margin: "1px 0 0 18px", borderLeft: "1px solid var(--c-border)", paddingLeft: 10, color: "var(--c-text3)", fontSize: 12 }}>
        {b.state === "running" && b.tail ? (
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0, fontFamily: "inherit", color: "var(--c-text)" }}>{b.tail.split("\n").slice(-4).join("\n")}</pre>
        ) : b.result ? (
          <>
            <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: open ? 420 : 22, overflow: "hidden", cursor: "pointer" }} onClick={() => setOpen(!open)}>
              {open ? b.result.slice(0, 16_000) : firstLine.slice(0, 200) || "（无输出）"}
            </div>
            {open && (
              <button className="tool-btn" style={{ fontSize: 10.5, margin: "4px 0" }} onClick={() => void navigator.clipboard?.writeText(b.result ?? "")}>复制结果</button>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

function TodoList({ todos }: { todos: Todo[] }) {
  const done = todos.filter((x) => x.status === "completed").length;
  return (
    <div style={{ border: "1px solid var(--c-border)", borderRadius: 10, padding: "8px 12px", maxWidth: 620 }}>
      <div style={{ color: "var(--c-text3)", fontSize: 11, marginBottom: 4 }}>任务清单 · {done}/{todos.length}</div>
      {todos.map((td, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12.5, color: td.status === "completed" ? "var(--c-text3)" : td.status === "in_progress" ? "var(--c-text)" : "var(--c-text3)" }}>
          <span className="mono">{td.status === "completed" ? "☑" : td.status === "in_progress" ? "◉" : "☐"}</span>
          <span style={{ textDecoration: td.status === "completed" ? "line-through" : undefined, fontWeight: td.status === "in_progress" ? 600 : 400 }}>{td.content}</span>
        </div>
      ))}
    </div>
  );
}

/** 授权卡（ZCode 编号选项：❯ 当前项，↑↓+Enter+数字直选） */
function PermissionCard(props: {
  b: Extract<Block, { kind: "permission" }>;
  decided: string | undefined;
  sel: number;
  onSel: (requestId: string, i: number) => void;
  onReply: (requestId: string, ok: boolean, remember?: boolean, rulePrefix?: string | null) => void;
}) {
  const { b, decided, sel } = props;
  const kindLabel: Record<string, string> = {
    command: "命令", "git-stage": "暂存", "git-commit": "提交", "git-push": "推送",
    mcp: "MCP", plugin: "插件", restore: "恢复",
  };
  const kind = b.payload?.kind ?? "command";
  const options = permOptions(b);
  return (
    <div style={{ border: `1px solid ${decided ? "var(--c-border)" : "var(--c-amber)"}`, borderRadius: 12, padding: "10px 14px", maxWidth: 700, opacity: decided ? 0.65 : 1 }}>
      <div style={{ color: decided ? "var(--c-text3)" : "var(--c-amber)", fontWeight: 700, marginBottom: 4 }}>
        ◈ 授权请求 · {kindLabel[kind] ?? kind}
        {b.payload?.source ? <span style={{ fontSize: 10, border: "1px solid var(--c-border)", borderRadius: 4, padding: "0 4px", marginLeft: 8 }}>{b.payload.source}</span> : null}
        {b.payload?.risk && <span style={{ color: b.payload.risk === "high" ? "var(--c-red)" : "var(--c-amber)", float: "right", fontWeight: 700 }}>■ {b.payload.risk === "high" ? "高危" : "注意"}</span>}
      </div>
      {b.command && <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 12, background: "var(--c-panel)", border: "1px solid var(--c-border)", borderRadius: 8, padding: "6px 10px", margin: "4px 0", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{b.command}</div>}
      {b.payload?.paths && b.payload.paths.length > 0 && (
        <div style={{ fontSize: 11.5, color: "var(--c-text3)", margin: "4px 0", maxHeight: 64, overflowY: "auto" }}>
          {b.payload.paths.slice(0, 20).map((p) => <div key={p}>{p}</div>)}
          {b.payload.paths.length > 20 ? <div>…共 {b.payload.paths.length} 个文件</div> : null}
        </div>
      )}
      {decided ? (
        <div style={{ fontSize: 11.5, color: "var(--c-text3)" }}>{decided === "ok" ? "✓ 已批准" : decided === "rule" ? "✓ 已批准并记住前缀" : "✕ 已拒绝"}</div>
      ) : (
        <>
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 2 }}>
            {options.map((o, i) => (
              <div key={o.label}
                onClick={() => {
                  props.onSel(b.requestId, i);
                  if (o.reply.rulePrefix !== undefined && o.reply.rulePrefix !== null && o.reply.ok) props.onReply(b.requestId, true, true, o.reply.rulePrefix);
                  else props.onReply(b.requestId, o.reply.ok, o.reply.remember);
                }}
                style={{ display: "flex", gap: 8, padding: "4px 10px", borderRadius: 8, cursor: "pointer", border: `1px solid ${sel === i ? "var(--c-border)" : "transparent"}`, background: sel === i ? "var(--c-panel)" : "transparent" }}>
                <span style={{ color: sel === i ? "var(--c-text)" : "transparent", width: 12 }}>{sel === i ? "❯" : ""}</span>
                <span>{o.label}</span>
              </div>
            ))}
          </div>
          <div style={{ color: "var(--c-text3)", fontSize: 10.5, marginTop: 6 }}>↑↓ 选择 · Enter 确认 · 数字直选 · 选择结果会回给 agent 继续工作</div>
        </>
      )}
    </div>
  );
}

function QuestionCard(props: {
  b: Extract<Block, { kind: "question" }>;
  decided: string | undefined;
  onAnswer: (requestId: string, answer?: string, optionIndex?: number) => void;
}) {
  const { b, decided, onAnswer } = props;
  const [text, setText] = useState("");
  return (
    <div style={{ border: `2px dashed ${decided ? "var(--c-border)" : "var(--c-accent)"}`, borderRadius: 12, padding: "10px 14px", maxWidth: 700, opacity: decided ? 0.65 : 1 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>? {b.question}</div>
      {decided ? (
        <div style={{ fontSize: 11.5, color: "var(--c-text3)" }}>已回答：{decided}</div>
      ) : (
        <>
          {b.options.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
              {b.options.map((o, i) => (
                <button key={o} className="tool-btn" onClick={() => onAnswer(b.requestId, undefined, i)}>{o}</button>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            <input className="input" style={{ flex: 1 }} placeholder="自由回答…（Enter 发送）" value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) onAnswer(b.requestId, text.trim()); }} />
            <button className="tool-btn" disabled={!text.trim()} onClick={() => onAnswer(b.requestId, text.trim())}>回答</button>
          </div>
        </>
      )}
    </div>
  );
}

/** 计划卡（ZCode ExitPlanMode：批准选项） */
function PlanCard(props: {
  b: Extract<Block, { kind: "plan" }>;
  decided: string | undefined;
  onPlan: (requestId: string, ok: boolean, feedback?: string) => void;
}) {
  const { b, decided, onPlan } = props;
  const [text, setText] = useState("");
  return (
    <div style={{ border: `1px solid ${decided ? "var(--c-border)" : "var(--c-chip-purple-fg, #b490ff)"}`, borderRadius: 12, padding: "10px 14px", maxWidth: 720, opacity: decided ? 0.75 : 1 }}>
      <div style={{ color: "var(--c-chip-purple-fg, #b490ff)", fontWeight: 700, marginBottom: 6 }}>◇ 执行计划{decided ? (decided === "ok" ? " · 已批准" : " · 需修订") : ""}</div>
      <div className="md-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(b.plan) }} />
      {decided ? null : (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 2 }}>
          {[
            { label: "1. 批准并开始执行", act: () => onPlan(b.requestId, true) },
            { label: "2. 批准，执行时逐项确认", act: () => onPlan(b.requestId, true) },
          ].map((o) => (
            <div key={o.label} onClick={o.act} style={{ display: "flex", gap: 8, padding: "4px 10px", borderRadius: 8, cursor: "pointer", background: "var(--c-panel)" }}>
              <span>{o.label}</span>
            </div>
          ))}
          <div style={{ display: "flex", gap: 6, padding: "4px 10px" }}>
            <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="修改意见（可选）…" value={text} onChange={(e) => setText(e.target.value)} />
            <button className="tool-btn" onClick={() => onPlan(b.requestId, false, text.trim() || undefined)}>继续规划</button>
          </div>
        </div>
      )}
    </div>
  );
}

function SubtaskBlock({ b, ctx }: { b: Extract<Block, { kind: "subtask" }>; ctx?: TimelineCardCtx }) {
  const [open, setOpen] = useState(b.state === "running");
  const stateColor = b.state === "running" ? "var(--c-amber)" : b.state === "completed" ? "var(--c-green)" : "var(--c-red)";
  return (
    <div style={{ border: "1px solid var(--c-border)", borderRadius: 10, padding: "6px 10px", minWidth: 0 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer", flexWrap: "wrap" }} onClick={() => setOpen(!open)}>
        <span style={{ color: stateColor }}>{b.state === "running" ? "◐" : "▣"}</span>
        <b style={{ fontSize: 12.5 }}>{b.name || "子代理"}</b>
        <span style={{ fontSize: 10.5, color: stateColor, border: `1px solid ${stateColor}`, borderRadius: 4, padding: "0 4px" }}>{b.mode} · {b.state}</span>
        {b.durationMs !== undefined ? <span style={{ color: "var(--c-text3)", fontSize: 11 }}>{Math.round(b.durationMs / 100) / 10}s</span> : null}
        <span style={{ color: "var(--c-text3)", fontSize: 10.5, marginLeft: "auto" }}>{open ? "收起" : "展开"}</span>
      </div>
      {open && (
        <div style={{ marginTop: 6, borderLeft: "1px solid var(--c-border)", paddingLeft: 10, display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          {ctx?.renderChildren ? ctx.renderChildren(b.children) : null}
          {b.final && <div className="md-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(b.final) }} />}
        </div>
      )}
    </div>
  );
}

/** 连续 ≥3 条 log 折叠为一组（渲染分组，不改块序列）。 */
type LogBlock = Extract<Block, { kind: "log" }>;
function groupLogs(blocks: Block[]): ({ kind: "block"; block: Block } | { kind: "logs"; items: LogBlock[] })[] {
  const out: ({ kind: "block"; block: Block } | { kind: "logs"; items: LogBlock[] })[] = [];
  let run: LogBlock[] = [];
  const flush = () => {
    if (run.length === 0) return;
    if (run.length >= 3) out.push({ kind: "logs", items: run });
    else for (const b of run) out.push({ kind: "block", block: b });
    run = [];
  };
  for (const b of blocks) {
    if (b.kind === "log") run.push(b);
    else { flush(); out.push({ kind: "block", block: b }); }
  }
  flush();
  return out;
}

// ---- 内置时间线渲染器自举（agent-harness-v4.md §20.3.7 第 2 期迁移）----
// 十类展示块经 registerAgentUI 与插件包同接缝竞争（层级 builtin：用户包可替换，宿主缺省兜底）；
// 交互卡（授权/提问/计划）是裁决面 UI，不开放替换（§20.9），仍硬接线在 renderBlock。
// @文件 mention 同批迁移为内置 composer provider（插件可加新前缀，同 prefix 用户包覆盖）。

const BUILTIN_TIMELINE_RENDERERS: TimelineRendererDef[] = [
  {
    blockKind: "human",
    render: ({ block }) => {
      const b = block as Extract<Block, { kind: "human" }>;
      return (
        <div style={{ borderLeft: "1px solid var(--c-green)", padding: "5px 12px", background: "rgba(126,231,135,.05)", borderRadius: "0 8px 8px 0", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          <div style={{ color: "var(--c-green)", fontSize: 11, marginBottom: 2 }}>▸ 你</div>
          {b.text}
        </div>
      );
    },
  },
  {
    blockKind: "assistant",
    render: ({ block }) => {
      const b = block as Extract<Block, { kind: "assistant" }>;
      return <div className="md-body" style={{ padding: "0 4px" }} dangerouslySetInnerHTML={{ __html: renderMarkdown(b.text) }} />;
    },
  },
  {
    blockKind: "status",
    render: ({ block }) => {
      const b = block as Extract<Block, { kind: "status" }>;
      return (
        <div style={{ fontSize: 11.5, color: "var(--c-text3)" }}>
          <span className="mono" style={{ marginRight: 6 }}>●</span>{b.text}
        </div>
      );
    },
  },
  {
    blockKind: "tool",
    render: ({ block }) => <ToolCard b={block as Extract<Block, { kind: "tool" }>} />,
  },
  {
    blockKind: "checkpoint",
    render: ({ block }) => {
      const b = block as Extract<Block, { kind: "checkpoint" }>;
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", color: "var(--c-text3)", fontSize: 12, fontFamily: "var(--mono, monospace)" }}>
          <span style={{ color: "var(--c-text)" }}>✔</span><span>cp {b.sha.slice(0, 8)}</span>
          <span style={{ color: "var(--c-text)", fontFamily: "inherit", overflowWrap: "anywhere" }}>{b.summary}</span>
          <span style={{ fontSize: 10.5 }}>· Esc×2 可回滚</span>
        </div>
      );
    },
  },
  {
    blockKind: "file",
    render: ({ block, ctx }) => {
      const b = block as Extract<Block, { kind: "file" }>;
      if (b.changeKind === "read-image") return <div><AgentImage taskId={ctx?.taskId ?? ""} path={b.path} /></div>;
      const color = b.changeKind === "deleted" ? "var(--c-red)" : b.changeKind === "added" ? "var(--c-green)" : "var(--c-amber)";
      return (
        <div style={{ fontSize: 12, color, overflowWrap: "anywhere" }}>
          <span className="mono" style={{ marginRight: 6 }}>{b.changeKind === "deleted" ? "−" : "+"}</span>
          {b.path}{b.summary ? ` (${b.summary})` : ""}
          {ctx?.viewFile && (
            <button className="tool-btn" style={{ fontSize: 10.5, marginLeft: 8, padding: "0 6px" }} onClick={() => ctx.viewFile?.(b.path)}>查看</button>
          )}
        </div>
      );
    },
  },
  {
    blockKind: "todo",
    render: ({ block }) => <TodoList todos={(block as Extract<Block, { kind: "todo" }>).todos} />,
  },
  {
    blockKind: "subtask",
    render: ({ block, ctx }) => <SubtaskBlock b={block as Extract<Block, { kind: "subtask" }>} ctx={ctx} />,
  },
  {
    blockKind: "turn",
    render: ({ block, ctx }) => {
      const b = block as Extract<Block, { kind: "turn" }>;
      return (
        <div style={{ color: "var(--c-text3)", fontSize: 11, fontFamily: "var(--mono, monospace)", display: "flex", gap: 14, flexWrap: "wrap" }}>
          <span>⎡ {b.text}</span>
          {b.usage ? <span>{(((b.usage.input ?? 0) + (b.usage.output ?? 0)) / 1000).toFixed(1)}k tokens（{b.usage.input ?? "?"} in / {b.usage.output ?? "?"} out）</span> : null}
          {ctx?.contextPct ? <span>context {ctx.contextPct}</span> : null}
        </div>
      );
    },
  },
  {
    blockKind: "log",
    render: ({ block }) => {
      const b = block as Extract<Block, { kind: "log" }>;
      return (
        <div style={{ fontSize: 11, color: b.level === "error" ? "var(--c-red)" : b.level === "warn" ? "var(--c-amber)" : "var(--c-text3)", overflowWrap: "anywhere" }}>
          <span className="mono" style={{ marginRight: 6 }}>·</span>{b.text}
        </div>
      );
    },
  },
];

const BUILTIN_COMPOSER_PROVIDERS: ComposerMentionProviderDef[] = [
  {
    prefix: "@",
    label: "文件",
    source: async (query: string) => {
      const files = await call<string[]>("repo.files", { query });
      return files.map((f) => ({ label: f, insert: f }));
    },
  },
];

let builtinAgentUIDone = false;
/** 自举注册：模块求值时（loader 注入窗口内）包身份生效 → 层级 builtin；
 * 错过窗口（如未来主 bundle 内置组件语境）由组件体补注册 → 层级 host 兜底。 */
function registerBuiltinAgentUI(): void {
  if (builtinAgentUIDone || typeof window === "undefined" || !window.GITTER_UI) return;
  builtinAgentUIDone = true;
  registerAgentUI({ timelineRenderers: BUILTIN_TIMELINE_RENDERERS, composerProviders: BUILTIN_COMPOSER_PROVIDERS });
}
registerBuiltinAgentUI();

// ---- 页面 ----

export function TasksPage() {
  const app = useAppState();
  const repo = app.repo;
  const [worktrees, setWorktrees] = useState<WorktreeDTO[] | null>(null);
  const [harnesses, setHarnesses] = useState<AgentHarnessDTO[] | null>(null);
  const [agentTasks, setAgentTasks] = useState<AgentTaskDTO[] | null>(null);
  const [taskTypes, setTaskTypes] = useState<TaskTypeDTO[]>([]);
  const [modelProfiles, setModelProfiles] = useState<ModelProfileDTO[]>([]);
  const [taskTypeId, setTaskTypeId] = useState("");
  const [modelId, setModelId] = useState("");
  const [mode, setMode] = useState<"plan" | "default" | "yolo">("default");
  const [tab, setTab] = useState<"chat" | "diff" | "cp">("chat");
  const [evMap, setEvMap] = useState<Record<string, Block[]>>({});
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [focusTaskId, consumeTaskFocus] = useTaskFocus();
  useEffect(() => {
    if (!focusTaskId) return;
    setSelectedTask(focusTaskId);
    consumeTaskFocus();
  }, [focusTaskId]);
  const [error, setError] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [composeText, setComposeText] = useState("");
  const [thinking, setThinking] = useState<"off" | "low" | "medium" | "high">("medium");
  const [sending, setSending] = useState(false);
  const [decided, setDecided] = useState<Record<string, string>>({});
  const [stats, setStats] = useState<AgentContextStatsDTO | null>(null);
  const [changesTick, setChangesTick] = useState(0);
  const [mention, setMention] = useState<{ start: number; prefix: string; query: string } | null>(null);
  const [mentionItems, setMentionItems] = useState<{ label: string; insert: string }[]>([]);
  const [pkgCommands, setPkgCommands] = useState<{ name: string; template: string; packageId: string }[]>([]);
  const [permSel, setPermSel] = useState<Record<string, number>>({});
  const [maxSubagents, setMaxSubagents] = useState(3);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [pendingFile, setPendingFile] = useState<string | null>(null);
  const [cpCount, setCpCount] = useState(0);
  const [diffCount, setDiffCount] = useState(0);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const replied = useRef(new Set<string>());
  const inputHistory = useRef<string[]>([]);
  const historyIdx = useRef(-1);
  const escTs = useRef(0);
  const oldestTs = useRef<string | null>(null);
  const [, forceTick] = useState(0);
  // agent UI 注册表版本订阅：包热插拔（用户包注册/卸载渲染器、provider）时时间线重渲染
  useAgentUIVersion();
  // 模块级自举错过注入窗口时（宿主内置组件语境）由组件体补注册（幂等）
  registerBuiltinAgentUI();

  const scrollTimelineToBottom = useCallback(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = timelineRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }));
  }, []);

  const reloadWorktrees = useCallback(async () => {
    if (!repo) return;
    try { setWorktrees(await call<WorktreeDTO[]>("tasks.list")); } catch (e) { setError((e as Error).message); }
  }, [repo]);

  const reloadAgents = useCallback(async () => {
    if (!repo) return;
    try {
      setHarnesses(await call<AgentHarnessDTO[]>("agents.list"));
      setAgentTasks(await call<AgentTaskDTO[]>("agent.tasks"));
      setTaskTypes(await call<TaskTypeDTO[]>("agent.taskTypes.list"));
      setModelProfiles(await call<ModelProfileDTO[]>("models.list"));
      const cmds = await call<{ id: string; action?: string; packageId?: string; args?: unknown }[]>("commands.list");
      setPkgCommands(
        cmds
          .filter((c) => c.action === "agent.command")
          .map((c) => {
            const a = (c.args ?? {}) as { slash?: string; template?: string };
            const short = c.packageId?.split(".").pop() ?? "pkg";
            return { name: `${short}:${a.slash ?? c.id}`, template: a.template ?? "${input}", packageId: c.packageId ?? "" };
          }),
      );
    } catch (e) { setError((e as Error).message); }
  }, [repo]);

  useEffect(() => {
    void reloadWorktrees();
    void reloadAgents();
  }, [repo, app.refreshTick, reloadWorktrees, reloadAgents]);

  useEffect(() => {
    void call<{ agentsMaxSubagents?: number }>("settings.get").then((s) => {
      if (s?.agentsMaxSubagents) setMaxSubagents(s.agentsMaxSubagents);
    }).catch(() => {});
  }, []);

  // 事件摄入 → 时间线块
  useEffect(
    () =>
      onEvent("agent.event", (p) => {
        const { taskId, event } = p as { taskId: string; event: AgentEventDTO };
        setEvMap((m) => ({ ...m, [taskId]: reduceBlocks(m[taskId] ?? [], event) }));
        if (event.type === "turn-completed" || event.type === "completed") {
          void reloadAgents();
          setChangesTick((n) => n + 1);
        }
        if (event.type === "file-change") setChangesTick((n) => n + 1);
      }),
    [reloadAgents],
  );
  useEffect(
    () => onEvent("agent.tasks.changed", () => void reloadAgents()),
    [reloadAgents],
  );

  const selected = agentTasks?.find((x) => x.taskId === selectedTask) ?? null;

  // 运行中工具 + 子代理计数 + 上下文用量
  const runningTool = (() => {
    if (!selectedTask) return null;
    const blocks = evMap[selectedTask] ?? [];
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      if (b.kind === "tool" && b.state === "running") return b;
    }
    return null;
  })();
  const runningSubs = selectedTask ? (evMap[selectedTask] ?? []).filter((b) => b.kind === "subtask" && b.state === "running").length : 0;

  useEffect(() => {
    if (!selectedTask) return;
    let cancelled = false;
    const pull = () => {
      void call<AgentContextStatsDTO | null>("agent.context.stats", { taskId: selectedTask })
        .then((s) => { if (!cancelled && s) setStats(s); })
        .catch(() => {});
    };
    pull();
    const iv = setInterval(pull, 5000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [selectedTask, changesTick]);

  useEffect(() => {
    if (!runningTool) return;
    const iv = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [runningTool]);

  const eventsToBlocks = (events: { ts: string; actor: "human" | "agent" | "host"; kind: "text" | "event"; text?: string; event?: AgentEventDTO }[]): Block[] => {
    let blocks: Block[] = [];
    for (const je of events) {
      if (je.kind === "text") blocks = pushCap(blocks, { kind: "human", text: je.text ?? "" });
      else blocks = reduceBlocks(blocks, je.event as AgentEventDTO);
    }
    return blocks;
  };

  // 历史回填（分页 + 加载更早）
  useEffect(() => {
    if (!selectedTask) return;
    if ((evMap[selectedTask] ?? []).length > 0) return;
    let cancelled = false;
    void call<{ events: { ts: string; actor: "human" | "agent" | "host"; kind: "text" | "event"; text?: string; event?: AgentEventDTO }[]; hasMore?: boolean }>(
      "agent.task.history", { taskId: selectedTask, limit: 300 },
    )
      .then((h) => {
        if (cancelled) return;
        const blocks = eventsToBlocks(h.events);
        oldestTs.current = h.events[0]?.ts ?? null;
        setEvMap((m) => (m[selectedTask]?.length ? m : { ...m, [selectedTask]: blocks }));
        setHasMoreHistory(!!h.hasMore);
        scrollTimelineToBottom();
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedTask, evMap, scrollTimelineToBottom]);

  const loadOlder = async () => {
    if (!selectedTask || loadingOlder || !oldestTs.current) return;
    setLoadingOlder(true);
    try {
      const h = await call<{ events: { ts: string; actor: "human" | "agent" | "host"; kind: "text" | "event"; text?: string; event?: AgentEventDTO }[]; hasMore?: boolean }>(
        "agent.task.history", { taskId: selectedTask, before: oldestTs.current, limit: 200 },
      );
      const older = eventsToBlocks(h.events);
      if (h.events[0]?.ts) oldestTs.current = h.events[0].ts;
      setHasMoreHistory(!!h.hasMore);
      if (older.length > 0) setEvMap((m) => ({ ...m, [selectedTask]: [...older, ...(m[selectedTask] ?? [])] }));
    } catch (e) { setError((e as Error).message); } finally { setLoadingOlder(false); }
  };

  useEffect(() => { scrollTimelineToBottom(); }, [evMap, selectedTask, scrollTimelineToBottom]);

  // Esc：一次=中断；500ms 内两次=打开检查点页（ZCode rewind）
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !selectedTask) return;
      const now = Date.now();
      if (now - escTs.current < 500) {
        setTab("cp");
        escTs.current = 0;
      } else {
        escTs.current = now;
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [selectedTask]);

  const pendingPerm = (() => {
    if (!selectedTask) return null;
    const blocks = evMap[selectedTask] ?? [];
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      if (b.kind === "permission" && !decided[b.requestId]) return b;
    }
    return null;
  })();
  const permOptionCount = pendingPerm ? permOptions(pendingPerm).length : 0;

  const replyPerm = useCallback(async (requestId: string, ok: boolean, remember?: boolean, rulePrefix?: string | null) => {
    setDecided((d) => ({ ...d, [requestId]: ok ? (rulePrefix ? "rule" : "ok") : "deny" }));
    try {
      if (rulePrefix) {
        // 总是允许前缀 → 写持久规则（settings.agentRules，deny>allow>基线）
        const tool = (evMap[selectedTask ?? ""] ?? []).find((b) => b.kind === "permission" && b.requestId === requestId);
        const ruleTool = tool && tool.kind === "permission" ? tool.toolName : "";
        const s = await call<{ agentRules?: { id: string; tool: string; pattern: string | null; effect: "allow" | "deny"; scope: "global" | "repo"; createdAt: string }[] }>("settings.get");
        const rules = [
          ...(s.agentRules ?? []),
          { id: `rule-${Date.now().toString(36)}`, tool: ruleTool, pattern: rulePrefix, effect: "allow" as const, scope: "global" as const, createdAt: new Date().toISOString() },
        ];
        await call("settings.set", { agentRules: rules });
        await call("agent.perm.reply", { requestId, ok: true, remember: true });
      } else {
        await call("agent.perm.reply", { requestId, ok, remember });
      }
    } catch (e) { setError((e as Error).message); }
  }, [selectedTask, evMap]);

  // 授权卡键盘：↑↓/Enter/数字直选（焦点不在输入框时）
  useEffect(() => {
    if (!pendingPerm || !selectedTask) return;
    const requestId = pendingPerm.requestId;
    const opts = permOptions(pendingPerm);
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      const cur = permSel[requestId] ?? 0;
      const apply = (idx: number) => {
        const o = opts[Math.min(idx, opts.length - 1)];
        if (o.reply.rulePrefix !== undefined && o.reply.rulePrefix !== null && o.reply.ok) replyPerm(requestId, true, true, o.reply.rulePrefix);
        else replyPerm(requestId, o.reply.ok, o.reply.remember);
      };
      if (e.key === "ArrowDown") { e.preventDefault(); setPermSel((m) => ({ ...m, [requestId]: Math.min(cur + 1, opts.length - 1) })); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setPermSel((m) => ({ ...m, [requestId]: Math.max(cur - 1, 0) })); }
      else if (e.key === "Enter") { e.preventDefault(); apply(cur); }
      else if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        if (idx < opts.length) { e.preventDefault(); apply(idx); }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [pendingPerm, selectedTask, permSel, replyPerm]);

  // Shift+Tab 权限模式循环
  const cycleMode = useCallback(() => {
    if (!selected) return;
    const cur = selected.permissionMode ?? "default";
    const next = MODE_ORDER[(MODE_ORDER.indexOf(cur) + 1) % MODE_ORDER.length];
    void call("agent.task.setMode", { taskId: selected.taskId, mode: next }).then(reloadAgents).catch((e) => setError((e as Error).message));
  }, [selected, reloadAgents]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Tab" && e.shiftKey) { e.preventDefault(); cycleMode(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [cycleMode]);

  const open = (w: WorktreeDTO) => void openRepo(w.path);

  if (!repo) {
    return <div className="empty-state"><div className="big">🗂</div>{t("Common_NoProjectSelected")}</div>;
  }

  const timeline = selectedTask ? evMap[selectedTask] ?? [] : [];
  const modelInfo = harnesses?.[0]?.detect;
  const todoProgress = (tk: AgentTaskDTO) => {
    const todos = tk.todoState ?? [];
    if (todos.length === 0) return null;
    return `☑${todos.filter((x) => x.status === "completed").length}/${todos.length}`;
  };

  const replyAnswer = async (requestId: string, answer?: string, optionIndex?: number) => {
    setDecided((d) => ({ ...d, [requestId]: answer ?? `#${(optionIndex ?? 0) + 1}` }));
    try { await call("agent.perm.reply", { requestId, ok: true, answer, optionIndex }); } catch (e) { setError((e as Error).message); }
  };
  const replyPlan = async (requestId: string, ok: boolean, feedback?: string) => {
    setDecided((d) => ({ ...d, [requestId]: ok ? "ok" : "revised" }));
    try { await call("agent.perm.reply", { requestId, ok, answer: feedback }); } catch (e) { setError((e as Error).message); }
  };

  const sendInput = async () => {
    if (!selected || !inputText.trim() || sending) return;
    const text = inputText.trim();

    if (text.startsWith("/")) {
      const [cmdRaw, ...rest] = text.split(/\s+/);
      const cmd = cmdRaw;
      const arg = rest.join(" ").trim();
      const builtin = BUILTIN_SLASH.find((c) => c.name === cmd.slice(1));
      try {
        if (builtin) {
          const name = builtin.name;
          if (name === "compact") await call("agent.task.compact", { taskId: selected.taskId });
          else if (name === "clear") await call("agent.task.clear", { taskId: selected.taskId });
          else if (name === "plan" || name === "default" || name === "yolo" || name === "approvals") {
            const m = name === "approvals" ? MODE_ORDER[(MODE_ORDER.indexOf(selected.permissionMode ?? "default") + 1) % MODE_ORDER.length] : name;
            await call("agent.task.setMode", { taskId: selected.taskId, mode: m });
            setMode(m as "plan" | "default" | "yolo");
          } else if (name === "stop") await call("agent.task.stop", { taskId: selected.taskId });
          else if (name === "model") {
            const id = arg || (selected.modelRef ?? "");
            await call("agent.task.setModel", { taskId: selected.taskId, model: id });
          } else if (name === "thinking") {
            const v = arg as "off" | "low" | "medium" | "high";
            if (["off", "low", "medium", "high"].includes(v)) {
              setThinking(v);
              if (!BUSY_STATES.has(selected.state)) await call("agent.task.resume", { taskId: selected.taskId, prompt: `（思考深度切换为 ${v}，继续当前任务）`, thinking: v, mode });
            } else setError("/thinking 用法：/thinking off|low|medium|high");
          } else if (name === "fork") {
            const forked = await call<AgentTaskDTO>("agent.task.fork", { taskId: selected.taskId, model: arg || undefined });
            setSelectedTask(forked.taskId);
            await reloadAgents();
          } else if (name === "skill") {
            const skills = await call<{ id: string; name: string; description: string; instructions: string }[]>("skills.list");
            const target = arg ? skills.find((s) => s.id.endsWith(`.${arg}`) || s.name === arg || s.id === arg) : undefined;
            if (!arg) setError(`可用技能：${skills.map((s) => s.name).join("、") || "（无）"}——用法 /skill <名称>`);
            else if (!target) setError(`未找到技能 ${arg}`);
            else if (BUSY_STATES.has(selected.state)) setError("agent 运行中，请在轮次结束后注入技能");
            else await call("agent.task.resume", { taskId: selected.taskId, prompt: `<system-reminder>\n请应用以下技能指引继续工作：\n\n${target.instructions}\n</system-reminder>`, thinking, mode });
          }
        } else {
          const pc = pkgCommands.find((c) => c.name === cmd.slice(1));
          if (pc) {
            const expanded = pc.template.replace(/\$\{input\}/g, arg);
            if (BUSY_STATES.has(selected.state)) await call("agent.task.queue", { taskId: selected.taskId, prompt: expanded });
            else await call("agent.task.resume", { taskId: selected.taskId, prompt: expanded, thinking, mode });
          } else {
            const pkgHint = pkgCommands.length > 0 ? `；包命令：${pkgCommands.map((c) => "/" + c.name).join(" ")}` : "";
            setError(`未知命令 ${cmd}（内置：${BUILTIN_SLASH.map((c) => "/" + c.name).join(" ")}${pkgHint}）`);
          }
        }
      } catch (e) { setError((e as Error).message); }
      setInputText("");
      return;
    }

    inputHistory.current = [text, ...inputHistory.current.filter((x) => x !== text)].slice(0, 20);
    historyIdx.current = -1;
    setEvMap((m) => ({ ...m, [selected.taskId]: pushCap(m[selected.taskId] ?? [], { kind: "human", text }) }));
    setInputText("");
    setSending(true);
    const busy = BUSY_STATES.has(selected.state);
    try {
      if (busy) await call("agent.task.queue", { taskId: selected.taskId, prompt: text });
      else await call("agent.task.resume", { taskId: selected.taskId, prompt: text, thinking, mode });
      await reloadAgents();
    } catch (e) { setError((e as Error).message); } finally { setSending(false); }
  };

  const createFromCompose = async () => {
    if (!composeText.trim() || sending) return;
    setSending(true);
    try {
      const record = await call<AgentTaskDTO>("agent.task.create", {
        prompt: composeText.trim(), taskType: taskTypeId || undefined, model: modelId || undefined,
        thinking, mode,
      });
      setComposeText("");
      setSelectedTask(record.taskId);
      setEvMap((m) => ({ ...m, [record.taskId]: [{ kind: "human", text: composeText.trim() }] }));
      await reloadAgents();
    } catch (e) { setError((e as Error).message); } finally { setSending(false); }
  };

  const stopTask = async (taskId: string) => {
    try { await call("agent.task.stop", { taskId }); await reloadAgents(); } catch (e) { setError((e as Error).message); }
  };

  const setTaskMode = async (taskId: string, m: string) => {
    try { await call("agent.task.setMode", { taskId, mode: m }); await reloadAgents(); } catch (e) { setError((e as Error).message); }
  };

  // @ / 插件前缀提及（§20.3.7 composerProviders：前缀不竞争并存；内置 @文件 为 builtin 层自举）
  const onComposeChange = (value: string, setter: (v: string) => void) => {
    setter(value);
    const el = document.activeElement as HTMLTextAreaElement | null;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    // 长前缀优先匹配（@ 与 @issue 并存时 @issue 先试）
    const providers = [...composerProviders()].sort((a, b) => b.prefix.length - a.prefix.length);
    if (providers.length === 0) { setMention(null); return; }
    const esc = providers.map((x) => x.prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const m = new RegExp(`(^|\\s)(${esc})([\\w./\\-]*)$`).exec(before);
    if (!m) { setMention(null); return; }
    const prefix = m[2];
    const query = m[3];
    setMention({ start: caret - query.length, prefix, query });
    const provider = providers.find((x) => x.prefix === prefix);
    if (!provider) { setMentionItems([]); return; }
    void Promise.resolve(provider.source(query).catch(() => []))
      .then((items) => setMentionItems(items.slice(0, 50)));
  };
  const insertMention = (insert: string, setter: (v: string) => void, current: string) => {
    if (!mention) return;
    const next = current.slice(0, mention.start) + insert + " " + current.slice(mention.start + mention.query.length);
    setter(next);
    setMention(null);
  };

  // 时间线块渲染（§20.3.7）：裁决面交互卡（授权/提问/计划）硬接线不开放替换；
  // 其余展示块经 agentUIRegistry 解析——用户包 > 内置包 > 宿主缺省，工具精确 > 前缀 > blockKind。
  const renderBlock = (b: Block, key: string | number): ReactNode => {
    switch (b.kind) {
      case "permission":
        return <PermissionCard key={key} b={b} decided={decided[b.requestId]} sel={permSel[b.requestId] ?? 0} onSel={(id, i) => setPermSel((m) => ({ ...m, [id]: i }))} onReply={replyPerm} />;
      case "question":
        return <QuestionCard key={key} b={b} decided={decided[b.requestId]} onAnswer={replyAnswer} />;
      case "plan":
        return <PlanCard key={key} b={b} decided={decided[b.requestId]} onPlan={replyPlan} />;
      default:
        break;
    }
    const renderer = resolveTimelineRenderer(b.kind === "tool" ? b.name : undefined, b.kind);
    if (!renderer) return null;
    const ctx: TimelineCardCtx = {
      taskId: selectedTask ?? "",
      viewFile: (path) => { setPendingFile(path); setTab("diff"); },
      contextPct: stats ? `${Math.round(stats.ratio * 100)}%` : undefined,
      renderChildren: (children) => <Fragment>{(children as Block[]).map((c, i) => renderBlock(c, `${key}-${i}`))}</Fragment>,
    };
    return <Fragment key={key}>{renderer.render({ block: b, taskId: ctx.taskId ?? "", ctx })}</Fragment>;
  };

  const agentCard = (task: AgentTaskDTO) => {
    const live = LIVE_STATES.has(task.state);
    const selectedNow = selectedTask === task.taskId;
    const dotColor = task.state === "failed" ? "var(--c-red)" : task.state === "completed" || task.state === "stopped" ? "var(--c-text3)" : task.permissionMode === "plan" ? "var(--c-chip-purple-fg, #b490ff)" : "var(--c-green)";
    const working = task.state === "working" || task.state === "starting";
    return (
      <div key={task.taskId} onClick={() => { setSelectedTask(selectedNow ? null : task.taskId); setTab("chat"); setThinking(task.thinking ?? "medium"); setMode(task.permissionMode ?? "default"); }}
        style={{ border: `1px solid ${selectedNow ? "var(--c-text)" : "var(--c-border)"}`, borderRadius: 10, padding: "8px 11px", cursor: "pointer", background: "var(--c-panel)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, opacity: working ? 1 : 0.85 }} />
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, fontWeight: 600 }}>{task.title}</span>
        </div>
        <div style={{ color: "var(--c-text3)", fontSize: 11, marginTop: 3, display: "flex", gap: 8 }}>
          <span className="mono">{task.branch}</span>
          <span>· {new Date(task.lastActiveAt ?? task.createdAt).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
          {(task.queued?.length ?? 0) > 0 ? <span style={{ color: "var(--c-amber)" }}>· ⏳排队 {task.queued!.length}</span> : null}
          {task.permissionMode && task.permissionMode !== "default" ? <span style={{ color: MODE_META[task.permissionMode].color }}>· {MODE_META[task.permissionMode].label}</span> : null}
        </div>
        <div style={{ color: "var(--c-text3)", fontSize: 11, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {stateChip(task.state).label.replace("● ", "")} · {task.lastMessage ?? task.worktreePath}{todoProgress(task) ? ` · ${todoProgress(task)}` : ""}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
          {live && <button className="tool-btn" onClick={() => void stopTask(task.taskId)}>停止</button>}
          {!live && <button className="tool-btn" onClick={() => { setSelectedTask(task.taskId); setTab("chat"); setInputText(""); }}>续跑</button>}
          <button className="tool-btn" onClick={() => void call("app.newWindow", { path: task.worktreePath })}>新窗口</button>
        </div>
      </div>
    );
  };

  const busy = selected ? BUSY_STATES.has(selected.state) : false;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px minmax(0, 1fr)", flex: 1, minHeight: 0, height: "100%" }}>
      {/* ═══ 左：任务列表（Codex 任务卡）═══ */}
      <div style={{ borderRight: "1px solid var(--c-border)", display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0, background: "var(--c-panel)" }}>
        {error && <div className="banner error"><span className="banner-text">{error}</span><button className="tool-btn" onClick={() => setError(null)}>✕</button></div>}
        <div onClick={() => { setSelectedTask(null); setTab("chat"); }} style={{ margin: "10px 10px 6px", padding: "9px 12px", border: "2px dashed var(--c-border)", borderRadius: 8, color: "var(--c-text3)", textAlign: "center", cursor: "pointer", fontSize: 12.5 }}>
          ＋ 新任务（描述目标，Ctrl+N）
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 10px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
          {(agentTasks?.length ?? 0) === 0 && (
            <div style={{ fontSize: 12, color: "var(--c-text3)", padding: "4px 2px" }}>{t("Agents_EmptyHint")}</div>
          )}
          {agentTasks?.map(agentCard)}
        </div>
      </div>

      {/* ═══ 右：详情（页签 = 全局导航；三页互斥独立）═══ */}
      {/* minWidth: 0 = grid item 自动最小尺寸回收：对话内容的 min-content 宽度不再把 1fr 轨道撑破窗口 */}
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 2, padding: "6px 14px 0", borderBottom: "1px solid var(--c-border)", background: "var(--c-panel)" }}>
          {([["chat", "对话"], ["diff", `改动${diffCount ? ` ${diffCount}` : ""}`], ["cp", `检查点${cpCount ? ` ${cpCount}` : ""}`]] as const).map(([id, label]) => (
            <div key={id} onClick={() => setTab(id)}
              style={{ padding: "5px 14px", fontSize: 12.5, color: tab === id ? "var(--c-text)" : "var(--c-text3)", cursor: "pointer", border: `1px solid ${tab === id ? "var(--c-border)" : "transparent"}`, borderBottom: "none", borderRadius: "8px 8px 0 0" }}>
              {label}
            </div>
          ))}
        </div>

        {/* ═══ 对话页 ═══ */}
        {tab === "chat" && selected && (
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 14px", borderBottom: "1px solid var(--c-border)", background: "var(--c-panel)", flexWrap: "wrap" }}>
              <span style={{ fontSize: 11.5, padding: "1px 10px", borderRadius: 999, border: `1px solid ${stateChip(selected.state).color}`, color: stateChip(selected.state).color }}>
                {stateChip(selected.state).label}{busy && selected.lastActiveAt ? " · " + Math.max(0, Math.round((Date.now() - new Date(selected.lastActiveAt).getTime()) / 1000)) + "s" : ""}
              </span>
              <span style={{ color: "var(--c-text3)", fontSize: 11.5, fontFamily: "var(--mono, monospace)" }}>{selected.branch}</span>
              <span style={{ flex: 1 }} />
              <button className="tool-btn" onClick={() => void call("app.newWindow", { path: selected.worktreePath })}>送验收</button>
              <button className="tool-btn" onClick={() => void call("app.newWindow", { path: selected.worktreePath })}>新窗口</button>
            </div>
            <div ref={timelineRef} style={{ flex: 1, minHeight: 0, minWidth: 0, overflowY: "auto", overflowX: "hidden" }}
              onDoubleClick={(e) => {
                const pre = (e.target as HTMLElement).closest("pre");
                if (pre) void navigator.clipboard?.writeText(pre.textContent ?? "");
              }}>
              <div style={{ maxWidth: 880, margin: "0 auto", padding: "18px 20px 26px", display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
                {hasMoreHistory && (
                  <button className="tool-btn" style={{ alignSelf: "center", fontSize: 11 }} disabled={loadingOlder} onClick={() => void loadOlder()}>
                    {loadingOlder ? "加载中…" : "加载更早"}
                  </button>
                )}
                {timeline.length === 0 && <div style={{ color: "var(--c-text3)", fontSize: 12 }}>{t("Agents_TimelineEmpty")}</div>}
                {groupLogs(timeline).map((g, i) =>
                  g.kind === "logs" ? (
                    <details key={i} style={{ fontSize: 11 }}>
                      <summary style={{ cursor: "pointer", color: "var(--c-text3)" }}>▸ 显示 {g.items.length} 条日志</summary>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                        {g.items.map((b, j) => renderBlock(b, `${i}-${j}`))}
                      </div>
                    </details>
                  ) : (
                    renderBlock(g.block, i)
                  ),
                )}
              </div>
            </div>
            <div style={{ borderTop: "1px solid var(--c-border)", background: "var(--c-panel)", padding: "4px 20px 2px" }}>
              <div style={{ maxWidth: 880, margin: "0 auto", display: "flex", gap: 16, rowGap: 2, flexWrap: "wrap", color: "var(--c-text3)", fontSize: 11, fontFamily: "var(--mono, monospace)" }}>
                {runningTool ? (
                  <span style={{ color: "var(--c-amber)" }}>● {(TOOL_LABELS[runningTool.name] ?? runningTool.name)} 运行中 {((Date.now() - runningTool.startTs) / 1000).toFixed(1)}s</span>
                ) : <span>○ 空闲</span>}
                {(selected.queued?.length ?? 0) > 0 ? <span style={{ color: "var(--c-amber)" }}>⏳ 排队 {selected.queued!.length}</span> : null}
                <span>子代理 {runningSubs}/{maxSubagents}</span>
                <span style={{ marginLeft: "auto" }}>Esc 中断 · Esc×2 回滚 · Shift+Tab 模式 · ↑↓ 历史</span>
              </div>
            </div>
            <div style={{ borderTop: "1px solid var(--c-border)", background: "var(--c-panel)", padding: "8px 20px 8px" }}>
              <div style={{ maxWidth: 880, margin: "0 auto", position: "relative" }}>
                {pendingPerm && (
                  <div style={{ marginBottom: 8, fontSize: 11.5, color: "var(--c-amber)" }}>◈ 等待授权（↑↓+Enter 或数字直选上方卡片选项）</div>
                )}
                {mention && (
                  <MentionPopover mention={mention} items={mentionItems} onPick={(x) => insertMention(x, setInputText, inputText)} />
                )}
                <div style={{ border: `1px solid ${inputText.trim() ? "var(--c-text)" : "var(--c-border)"}`, borderRadius: 12, padding: "8px 12px 6px" }}>
                  <textarea
                    style={{ width: "100%", background: "transparent", border: "none", outline: "none", resize: "none", color: "var(--c-text)", font: "13px/1.55 inherit", minHeight: 44, maxHeight: 140 }}
                    placeholder={busy
                      ? "agent 正在工作——输入将排队，本轮结束后自动注入（Esc 中断 / Esc×2 回滚）"
                      : "继续对话…输入 / 唤起命令、@ 唤起文件、Shift+Tab 切模式"}
                    value={inputText}
                    onChange={(e) => onComposeChange(e.target.value, setInputText)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") { void stopTask(selected.taskId); return; }
                      if (e.key === "Tab" && e.shiftKey) { e.preventDefault(); cycleMode(); return; }
                      if (e.key === "ArrowUp" && !inputText.includes("\n") && inputHistory.current.length > 0) {
                        historyIdx.current = Math.min(historyIdx.current + 1, inputHistory.current.length - 1);
                        setInputText(inputHistory.current[historyIdx.current] ?? "");
                        e.preventDefault();
                        return;
                      }
                      if (e.key === "ArrowDown" && historyIdx.current >= 0) {
                        historyIdx.current = Math.max(historyIdx.current - 1, -1);
                        setInputText(historyIdx.current === -1 ? "" : inputHistory.current[historyIdx.current] ?? "");
                        e.preventDefault();
                        return;
                      }
                      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void sendInput();
                    }}
                  />
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap", rowGap: 6 }}>
                    <span className="chip" onClick={cycleMode} title="Shift+Tab 循环">{MODE_META[selected.permissionMode ?? "default"].label}</span>
                    <select className="input" style={{ width: 130, fontSize: 11.5, padding: "1px 6px", border: "1px solid var(--c-border)", borderRadius: 999, background: "transparent", color: "var(--c-text3)" }}
                      value={selected.modelRef ?? ""} disabled={busy && selected.state !== "awaiting-input"}
                      onChange={async (e) => {
                        try { await call("agent.task.setModel", { taskId: selected.taskId, model: e.target.value }); await reloadAgents(); } catch (err) { setError((err as Error).message); }
                      }}>
                      {(modelProfiles ?? []).filter((m) => m.configured).map((m) => (<option key={m.id} value={m.id}>{m.name}{m.isDefault ? " ★" : ""}</option>))}
                      {selected.modelRef && !(modelProfiles ?? []).some((m) => m.id === selected.modelRef) ? (<option value={selected.modelRef}>{selected.modelRef}</option>) : null}
                    </select>
                    <span className="chip" title="@ 文件 / @任务 提及">@</span>
                    <span className="chip" title="粘贴图片附加" onClick={() => setError("当前模型档案未声明多模态能力，图片输入暂不可用")}>🖼</span>
                    <span style={{ flex: 1 }} />
                    {stats && (
                      <div title={`系统 ${Math.round(stats.breakdown.system)} · 历史 ${Math.round(stats.breakdown.messages)} · 预留 ${Math.round(stats.breakdown.reserved)}${stats.compactions ? ` · 已压缩 ${stats.compactions} 次` : ""}`}
                        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: stats.ratio > 0.92 ? "var(--c-red)" : stats.ratio > 0.8 ? "var(--c-amber)" : "var(--c-text3)" }}>
                        <div style={{ width: 80, height: 4, borderRadius: 2, background: "var(--c-border)", overflow: "hidden" }}>
                          <div style={{ width: `${Math.min(100, stats.ratio * 100)}%`, height: "100%", background: stats.ratio > 0.92 ? "var(--c-red)" : stats.ratio > 0.8 ? "var(--c-amber)" : "var(--c-text3)" }} />
                        </div>
                        <span>context {Math.round(stats.ratio * 100)}% · {(stats.estTokens / 1000).toFixed(1)}k</span>
                        {stats.ratio > 0.8 && <span style={{ color: "var(--c-amber)" }}>· /compact</span>}
                      </div>
                    )}
                    <button
                      title={busy ? "⏹ 停止（Esc 同效）" : "➤ 发送（Ctrl+Enter 同效）"}
                      onClick={() => { if (busy) void stopTask(selected.taskId); else void sendInput(); }}
                      style={{ border: "none", background: "var(--c-text)", color: "var(--c-panel)", borderRadius: 8, width: 30, height: 30, fontSize: 14, cursor: "pointer", flex: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {busy ? "⏹" : "➤"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ 对话页：未选中任务 = 新任务 composer ═══ */}
        {tab === "chat" && !selected && (
          <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            <div style={{ width: 680, maxWidth: "90%" }}>
              {modelInfo && !modelInfo.available ? (
                <button className="tool-btn" style={{ color: "var(--c-amber)", borderColor: "var(--c-amber)", marginBottom: 10 }} onClick={() => openSettings("models")}>
                  ● {t("Agents_ModelMissing")} → {t("Agents_OpenSettings")}
                </button>
              ) : null}
              <div style={{ border: `1px solid ${composeText.trim() ? "var(--c-text)" : "var(--c-border)"}`, borderRadius: 12, padding: "10px 12px 6px", position: "relative" }}>
                {mention && <MentionPopover mention={mention} items={mentionItems} onPick={(x) => insertMention(x, setComposeText, composeText)} />}
                <textarea
                  autoFocus
                  style={{ width: "100%", background: "transparent", border: "none", outline: "none", resize: "none", color: "var(--c-text)", font: "13.5px/1.55 inherit", minHeight: 120 }}
                  placeholder={`${t("Agents_ComposePlaceholder")}\n支持 @文件 提及；规划类任务先切「◇ 规划」模式（Shift+Tab）`}
                  value={composeText}
                  onChange={(e) => onComposeChange(e.target.value, setComposeText)}
                  onKeyDown={(e) => {
                    if (e.key === "Tab" && e.shiftKey) { e.preventDefault(); setMode(MODE_ORDER[(MODE_ORDER.indexOf(mode) + 1) % MODE_ORDER.length]); return; }
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void createFromCompose();
                  }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap", rowGap: 6 }}>
                  <span className="chip" onClick={() => setMode(MODE_ORDER[(MODE_ORDER.indexOf(mode) + 1) % MODE_ORDER.length])} title="Shift+Tab 循环">{MODE_META[mode].label}</span>
                  <select className="input" style={{ width: 140, fontSize: 11.5, padding: "1px 6px", border: "1px solid var(--c-border)", borderRadius: 999, background: "transparent", color: "var(--c-text3)" }}
                    value={taskTypeId} onChange={(e) => setTaskTypeId(e.target.value)} title={t("Agents_TaskType")}>
                    <option value="">{t("Agents_TaskTypeFree")}</option>
                    {taskTypes.filter((tt) => !tt.error).map((tt) => (<option key={tt.fullId} value={tt.fullId}>{tt.name}</option>))}
                  </select>
                  <select className="input" style={{ width: 150, fontSize: 11.5, padding: "1px 6px", border: "1px solid var(--c-border)", borderRadius: 999, background: "transparent", color: "var(--c-text3)" }}
                    value={modelId} onChange={(e) => setModelId(e.target.value)} title={t("Agents_Model")}>
                    <option value="">{t("Agents_ModelDefault")}</option>
                    {modelProfiles.filter((m) => m.configured).map((m) => (<option key={m.id} value={m.id}>{m.name}{m.isDefault ? " ★" : ""}</option>))}
                  </select>
                  <select className="input" style={{ width: 100, fontSize: 11.5, padding: "1px 6px", border: "1px solid var(--c-border)", borderRadius: 999, background: "transparent", color: "var(--c-text3)" }}
                    value={thinking} onChange={(e) => setThinking(e.target.value as "off" | "low" | "medium" | "high")} title={t("Agents_Thinking")}>
                    <option value="high">{t("Agents_ThinkingHigh")}</option>
                    <option value="medium">{t("Agents_ThinkingMedium")}</option>
                    <option value="low">{t("Agents_ThinkingLow")}</option>
                    <option value="off">{t("Agents_ThinkingOff")}</option>
                  </select>
                  <span style={{ flex: 1 }} />
                  <button onClick={() => void createFromCompose()} disabled={sending || !composeText.trim()}
                    style={{ border: "none", background: "var(--c-text)", color: "var(--c-panel)", borderRadius: 8, width: 30, height: 30, fontSize: 14, cursor: "pointer", opacity: sending || !composeText.trim() ? 0.4 : 1 }}>➤</button>
                </div>
              </div>
              <div style={{ color: "var(--c-text3)", fontSize: 11, marginTop: 6 }}>
                Ctrl+Enter 发送 · {t("Agents_TargetHint")} · 规划模式：先调研出计划，批准后自动执行
              </div>
            </div>
          </div>
        )}

        {/* ═══ 改动页（完全独立页 · Codex Diff Review）═══ */}
        {tab === "diff" && selected && (
          <ChangesTab taskId={selected.taskId} worktreePath={selected.worktreePath} baselineSha={selected.baselineSha} initialFile={pendingFile} branch={selected.branch}
            onCount={setDiffCount} tick={changesTick} onReloadAgents={reloadAgents} setError={setError} />
        )}

        {/* ═══ 检查点页（完全独立页 · ZCode rewind）═══ */}
        {tab === "cp" && selected && (
          <CheckpointsTab taskId={selected.taskId} branch={selected.branch} tick={changesTick} setError={setError} onCount={setCpCount} onViewDiff={() => setTab("diff")} />
        )}
      </div>
    </div>
  );
}

type SettingsRulesLite = { id: string; tool: string; pattern: string | null; effect: "allow" | "deny"; scope: "global" | "repo"; createdAt: string };

// ---- 改动页（独立页 · Codex Diff Review × Gitter 语义）----

function ChangesTab(props: {
  taskId: string;
  worktreePath: string;
  baselineSha: string;
  initialFile?: string | null;
  branch: string;
  tick: number;
  onReloadAgents: () => Promise<void>;
  setError: (e: string) => void;
  onCount: (n: number) => void;
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
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 14px", borderBottom: "1px solid var(--c-border)", background: "var(--c-panel)", flexWrap: "wrap" }}>
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
        <div style={{ overflowY: "auto", padding: "12px 16px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{ fontFamily: "var(--mono, monospace)", fontSize: 12.5, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sel ?? "（选择文件）"}</span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <button className="tool-btn" disabled={!sel} onClick={async () => {
                if (!sel || !window.confirm(`还原 ${sel} 到会话基线（${baselineSha.slice(0, 8)}）？该文件在本会话的改动将被丢弃。`)) return;
                try { await call("agent.task.restore", { taskId, sha: baselineSha, path: sel }); await props.onReloadAgents(); } catch (e) { props.setError((e as Error).message); }
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

function CheckpointsTab(props: {
  taskId: string;
  branch: string;
  tick: number;
  setError: (e: string) => void;
  onCount: (n: number) => void;
  onViewDiff: () => void;
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
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "7px 14px", borderBottom: "1px solid var(--c-border)", background: "var(--c-panel)" }}>
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
              try { await call("agent.task.restore", { taskId, sha: cp.sha }); props.onViewDiff(); } catch (e) { props.setError((e as Error).message); }
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
