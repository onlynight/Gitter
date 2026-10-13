/**
 * 任务页时间线（v3）：块模型 / 事件 reducer（reduceBlocks）/ 日志与轮次分组 /
 * 全部时间线卡片（工具/思考/清单/授权/提问/计划/子代理/图片）与内置渲染器。
 * 由 TasksPage 消费：registerBuiltinAgentUI（页面侧）注册渲染器与 composer 提供者。
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { call } from "../bridge/client";
import type { AgentEventDTO, AgentTaskDTO, DiffDTO } from "../bridge/types";
import { DiffView, renderMarkdown } from "../kit";
import { TlIcon, toolIconName, type TlIconName } from "./taskIcons";
import type { TimelineCardCtx, TimelineRendererDef } from "../external/agentUIShim";
import { pageSdk } from "../pageSdk";

const { t } = pageSdk;

export const TOOL_LABELS: Record<string, string> = {
  web_search: "网络搜索", web_fetch: "读取网页",
  repo_status: "工作区状态", repo_diff: "读取 diff", repo_log: "提交历史",
  repo_read_file: "读文件", repo_list_files: "列文件", repo_glob: "找文件", repo_grep: "搜索内容",
  review_get_state: "验收反馈", file_write: "写文件", file_patch: "编辑文件",
  git_stage: "暂存", git_commit: "提交", git_push: "推送",
  terminal_run: "执行命令", terminal_poll: "后台命令",
  ask_user: "提问", todo_write: "任务清单", plan_submit: "提交计划", task: "子代理",
};


// ---- 时间线块模型（v3：⏺ 工具卡折叠 / ⎿ 结果缩进）----

export type Todo = { content: string; status: "pending" | "in_progress" | "completed" };

export type Block =
  | { kind: "human"; text: string }
  | { kind: "assistant"; text: string; merge: boolean }
  | { kind: "thinking"; text: string; merge: boolean; closed?: boolean }
  | { kind: "status"; text: string; phase?: string }
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

export function pushCap(arr: Block[], b: Block): Block[] {
  let next = [...arr, b];
  // 非思考块入场 = 思考已结束：把尾部思考块标记收起（用户之后仍可手动展开）
  if (b.kind !== "thinking") {
    for (let i = next.length - 2; i >= 0; i--) {
      const x = next[i];
      if (x.kind !== "thinking") break;
      if (!x.closed) {
        next = [...next];
        next[i] = { ...x, closed: true };
      }
    }
  }
  return next.length > MAX_BLOCKS ? next.slice(next.length - MAX_BLOCKS) : next;
}

/** 事件 → 块序列（纯归约；子代理事件按 subtaskId 归组嵌套）。 */
export function reduceBlocks(blocks: Block[], ev: AgentEventDTO): Block[] {
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
      // running-command 与同一 tool start 事件生成的 ToolCard 完全重复（还带 120 字符
      // 原始 JSON 倾泻），不进时间线；运行态由工具卡的琥珀脉冲承担
      if (ev.phase === "running-command") return blocks;
      return pushCap(blocks, { kind: "status", text: `${ev.phase ?? ""}${ev.summary ? ` — ${ev.summary}` : ""}`, phase: ev.phase });
    case "output":
      if (ev.stream === "thinking") {
        // 思考流：与正文同款合并策略（连续 thinking 增量并入最后一张思考卡）
        const last = blocks[blocks.length - 1];
        if (last && last.kind === "thinking" && last.merge && !last.closed) {
          const next = [...blocks];
          next[next.length - 1] = { ...last, text: last.text + (ev.text ?? "") };
          return next;
        }
        return pushCap(blocks, { kind: "thinking", text: ev.text ?? "", merge: true });
      }
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
      return pushCap(blocks.filter((b) => b.kind !== "todo"), { kind: "todo", todos: ev.todos ?? [] });
    case "checkpoint":
      return pushCap(blocks, { kind: "checkpoint", sha: ev.commitSha ?? "", summary: ev.summary ?? "" });
    case "file-change":
      return pushCap(blocks, { kind: "file", path: ev.path ?? "", changeKind: ev.kind ?? "modified", summary: ev.summary });
    case "subtask":
      return pushCap(blocks, { kind: "subtask", subtaskId: ev.subtaskId ?? "", name: ev.name ?? "", mode: ev.mode ?? "", state: ev.state ?? "running", final: ev.finalMessage, durationMs: ev.durationMs, children: [] });
    case "turn-completed":
      return pushCap(blocks, { kind: "turn", text: `turn #${blocks.filter((b) => b.kind === "turn").length + 1}`, usage: ev.usage });
    case "completed": {
      // 终态落时间线（失败/停止原因由此进入会话流）：outcome 翻译为中文标签；失败标红
      const outcomeLabel = ev.outcome === "failed" ? "失败"
        : ev.outcome === "stopped" ? "已停止"
        : ev.outcome === "interrupted" ? "已中断"
        : ev.outcome === "cancelled" ? "已中断"
        : (ev.outcome ?? "");
      return pushCap(blocks, { kind: "status", text: `${outcomeLabel}${ev.summary ? ` — ${ev.summary}` : ""}`, phase: ev.outcome === "failed" ? "failed" : undefined });
    }
    case "log":
      return pushCap(blocks, { kind: "log", level: ev.level ?? "info", text: ev.text ?? "" });
    default:
      return blocks;
  }
}

export type PermOption = { label: string; reply: { ok: boolean; remember?: boolean; rulePrefix?: string | null; fullAccess?: boolean } };

/** 授权卡编号选项生成（§四 + Codex 式升级）：一次 / 本会话 / 总是允许前缀 / 完全访问（切 yolo）/ 否。
 * fullAccess = 批准当前请求并把任务切到完全访问模式（后续免询问，仅不确定的选项仍会提问）。 */
export function permOptions(b: Extract<Block, { kind: "permission" }>, showFullAccess = false): PermOption[] {
  const sig = b.command ?? b.title;
  const prefix = sig ? sig.slice(0, 24) : null;
  const opts: PermOption[] = [{ label: "1. 是，执行一次", reply: { ok: true } }];
  if (b.rememberable !== false) opts.push({ label: "2. 是，本会话不再询问", reply: { ok: true, remember: true } });
  if (prefix) opts.push({ label: `3. 是，总是允许前缀 “${prefix}”`, reply: { ok: true, remember: true, rulePrefix: prefix } });
  if (showFullAccess) opts.push({ label: `${opts.length + 1}. 完全访问：批准并切换（后续不再询问，仅不确定时提问）`, reply: { ok: true, remember: true, fullAccess: true } });
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

/** v4.7 读出行构建：read 类=行号→内容；diff 类=彩色 +− 标记；其余=纯文本行。 */
type ReadoutLine =
  | { kind: "num"; no: string; tx: string }
  | { kind: "diff"; mk: "+" | "-" | " "; tone: "add" | "del" | "ctx"; tx: string }
  | { kind: "plain"; tx: string };

const READOUT_MAX = 400;

function buildReadout(tool: string, text: string): { lines: ReadoutLine[]; total: number } {
  const all = text.replace(/\u0000/g, "").split("\n");
  while (all.length > 0 && all[all.length - 1].trim() === "") all.pop();
  const total = all.length;
  const shown = all.slice(0, READOUT_MAX);
  if (tool === "repo_read_file") {
    return {
      lines: shown.map((tx, i) => ({ kind: "num" as const, no: String(i + 1), tx })),
      total,
    };
  }
  const diffish = shown.filter((l) => /^[+-]/.test(l)).length >= 2;
  if (diffish) {
    return {
      lines: shown.map((l) => {
        const mk = l[0] === "+" || l[0] === "-" ? l[0] : " ";
        const tone = mk === "+" ? "add" : mk === "-" ? "del" : "ctx";
        return { kind: "diff" as const, mk, tone, tx: l.slice(1) };
      }),
      total,
    };
  }
  return { lines: shown.map((tx) => ({ kind: "plain" as const, tx })), total };
}

/** 动作行（v4.7）：图标+命令一体（默认单行折叠），点击展开圆角读出框（340px 内滚动）。
 * 图标状态：运行=琥珀闪烁 / 失败=红；hover 圆角背景横跨左轨与文字。 */
function ToolCard({ b, ctx }: { b: Extract<Block, { kind: "tool" }>; ctx?: TimelineCardCtx }) {
  const [userOpen, setUserOpen] = useState(false);
  const open = !!ctx?.verbose || userOpen;
  const live = b.state === "running";
  const label = TOOL_LABELS[b.name] ?? b.name;
  const filePath = (() => {
    if (b.name !== "file_write" && b.name !== "file_patch") return null;
    try {
      const a = b.args as Record<string, unknown> | undefined;
      return typeof a?.path === "string" ? a.path : null;
    } catch { return null; }
  })();
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
  const readout = useMemo(
    () => buildReadout(b.name, live ? (b.tail ?? "") : (b.result ?? "")),
    [b.name, b.result, b.tail, live],
  );
  const hasBody = live ? !!b.tail : readout.lines.length > 0;
  if (b.name === "file_patch" || b.name === "file_write") {
    const paren = (b.result ?? "").match(/[（(]([^）)]+)[）)]/);
    const stats = paren ? ((paren[1] ?? "").split(/[;；]/).pop() ?? "").trim() : "";
    return (
      <div className="v47-al">
        <div className="v47-hd">
          <TlIcon name={toolIconName(b.name)} size={13}
            color={b.state === "error" ? "var(--c-red)" : live ? "var(--c-amber)" : undefined}
            className={live ? "v47-blink" : undefined} />
          <span className="v47-nm">{label}</span>
          <span className="v47-ar v47-fpath" title="打开右侧预览修改"
            onClick={(e) => { e.stopPropagation(); if (filePath) ctx?.previewFile?.(filePath); }}>{argSummary}</span>
          {stats ? <span className="v47-fsi">{stats}</span> : null}
          {ctx?.viewFile && filePath ? (
            <button className="tool-btn v47-preview" title="打开右侧差异面板"
              onClick={(e) => { e.stopPropagation(); ctx.viewFile?.(filePath); }}>差异</button>
          ) : null}
          {b.state === "error" ? <span className="v47-fail">失败</span> : null}
          {b.durationMs !== undefined ? <span className="v47-du">· {(b.durationMs / 1000).toFixed(1)}s</span> : null}
        </div>
      </div>
    );
  }
  return (
    <div className={"v47-al" + (open ? " open" : "") + (live ? " live" : "") + (b.state === "error" ? " err" : "")}>
      <div className="v47-hd" onClick={() => setUserOpen((v) => !v)} role="button" tabIndex={0} aria-expanded={open}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setUserOpen((v) => !v); } }}>
        <TlIcon name={toolIconName(b.name)} size={13}
          color={b.state === "error" ? "var(--c-red)" : live ? "var(--c-amber)" : undefined}
          className={"v47-hic" + (live ? " v47-blink" : undefined)} />
        <span className={"v47-nm" + (live ? " shimmer-text" : "")}>{label}</span>
            <span className={"v47-ar" + (live ? " shimmer-text" : "")}>{argSummary}</span>
            {filePath && ctx?.previewFile ? (
              <button className="tool-btn v47-preview" onClick={(e) => { e.stopPropagation(); ctx.previewFile?.(filePath); }}>预览</button>
            ) : null}
            {b.state === "error" ? <span className="v47-fail">失败</span> : null}
            {b.durationMs !== undefined ? <span className="v47-du">· {(b.durationMs / 1000).toFixed(1)}s</span> : null}
          </div>
          {hasBody ? (
            <div className="v47-res">
              {readout.lines.map((r, i) =>
                r.kind === "num" ? (
                  <div key={i} className="v47-rl"><span className="no">{r.no}</span><span className="ar">→</span><span className="tx">{r.tx}</span></div>
                ) : r.kind === "diff" ? (
                  <div key={i} className="v47-rl"><span className={"mk " + r.tone}>{r.mk}</span><span className={"tx " + r.tone}>{r.tx}</span></div>
                ) : (
                  <div key={i} className="v47-rl"><span className="tx">{r.tx || " "}</span></div>
                ),
              )}
              {readout.total > readout.lines.length ? (
                <div className="v47-rl"><span className="no">…</span><span className="ar">→</span><span className="tx" style={{ color: "var(--c-text3)" }}>共 {readout.total} 行</span></div>
              ) : null}
            </div>
          ) : null}
    </div>
  );
}

/** 思考行（v4.7）：✻ 入左轨与其他指令对齐；默认折叠一行（思考文本单行尾随，
 * 内容从末端持续追加、左缘渐隐）；点击展开 = 圆角框全文竖向滚动（200px 上限）。
 * 全程正常灰（无琥珀、无斜体），进行中 ✻ 灰色闪烁。 */
function ThinkingCard({ b, ctx }: { b: Extract<Block, { kind: "thinking" }>; ctx?: TimelineCardCtx }) {
  const [userOpen, setUserOpen] = useState(false);
  const open = !!ctx?.verbose || userOpen;
  const streaming = !b.closed;
  const text = b.text.trim() || "…";
  return (
    <div className={"v47-think" + (open ? " open" : "") + (streaming ? " live" : "")}
      onClick={() => setUserOpen((v) => !v)} role="button" tabIndex={0} aria-expanded={open}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setUserOpen((v) => !v); } }}>
      <div className="v47-th">
        <span className="v47-spk">✻</span>
        <span className="v47-tlabel">{streaming ? "思考中…" : "思考过程"}</span>
        <span className="v47-mq"><span>{text}</span></span>
      </div>
      <div className="v47-tbody">{text}</div>
    </div>
  );
}

/** 计划任务列表（ZCode TodoList 形态）：头部显示进度，点击整行折叠/展开。
 * 展开动画 = height: 0 ↔ 内容实测高度（px）。grid-template-rows 的 fr/max-content
 * 关键字不是长度，浏览器无法在两者间插值，视觉上是瞬切；height 的 px 一定能逐帧插值。
 * 过渡结束后把 height 归位到 auto，让后续条目增删、换行、字号变化都能自适应，不残留固定高度。
 * todo 事件每次都会替换掉历史条目（reducer 只留最新一份），
 * 所以状态推进时卡片原地刷新，不会在时间线里堆积重复清单。 */
export function TodoList({ todos }: { todos: Todo[] }) {
  const done = todos.filter((x) => x.status === "completed").length;
  const running = todos.some((x) => x.status === "in_progress");
  const allDone = todos.length > 0 && done === todos.length;
  const [open, setOpen] = useState(() => !allDone);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  // 状态变化驱动默认展开态：全部完成收起（不占屏），有进行中项自动展开
  useEffect(() => {
    if (allDone) setOpen(false);
    else if (running) setOpen(true);
  }, [allDone, running]);
  // 展开/收起动画：实测 inner 内容高度 → 写入 body.style.height（CSS 负责过渡曲线）
  // 条目数量或文案变化时（如 todo_write 更新）重算一次，避免固定高度卡住新内容
  useEffect(() => {
    const body = bodyRef.current;
    const inner = innerRef.current;
    if (!body || !inner) return;
    if (!openRef.current) { body.style.height = "0px"; return; }
    body.style.height = `${inner.scrollHeight}px`;
    const settle = () => {
      if (openRef.current) body.style.height = "auto";
      body.removeEventListener("transitionend", settle);
    };
    body.addEventListener("transitionend", settle);
  }, [open, todos]);
  const pct = todos.length > 0 ? Math.round((done / todos.length) * 100) : 0;
  const title = allDone ? "全部完成" : running ? "进行中" : "等待中";
  return (
    <div className="todo-card">
      <div className="todo-head" onClick={() => setOpen((o) => !o)} role="button" tabIndex={0} aria-expanded={open}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => !o); } }}>
        <TlIcon name="chevron-right" size={11} className={"todo-chev" + (open ? " open" : "")} />
        <TlIcon name="plan" size={12} color={allDone ? "var(--c-green)" : running ? "var(--c-amber)" : "var(--c-text3)"} />
        <span style={{ fontWeight: 700 }}>{title}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span className="todo-progress"><i style={{ width: `${pct}%` }} /></span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{done}/{todos.length}</span>
        </span>
        {running && <span className="tl-pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--c-amber)", marginLeft: "auto" }} />}
      </div>
      <div ref={bodyRef} className="todo-body">
        <div ref={innerRef} className="todo-inner">
          {todos.map((td, i) => (
            <div key={i} className={"todo-item" + (td.status === "completed" ? " done" : td.status === "in_progress" ? " cur" : "")}>
              <TlIcon name={td.status === "completed" ? "check-circle" : td.status === "in_progress" ? "circle-dot" : "circle"}
                color={td.status === "completed" ? "var(--c-green)" : td.status === "in_progress" ? "var(--c-amber)" : "var(--c-text3)"}
                className={td.status === "in_progress" ? "tl-pulse" : undefined} />
              <span style={{ flex: 1, minWidth: 0, fontWeight: td.status === "in_progress" ? 600 : 400 }}>{td.content}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


export function PermissionCard(props: {
  b: Extract<Block, { kind: "permission" }>;
  decided: string | undefined;
  sel: number;
  showFullAccess: boolean;
  onSel: (requestId: string, i: number) => void;
  onReply: (requestId: string, ok: boolean, remember?: boolean, rulePrefix?: string | null) => void;
  onFullAccess: (requestId: string) => void;
}) {
  const { b, decided, sel } = props;
  const kindLabel: Record<string, string> = {
    command: "命令", "git-stage": "暂存", "git-commit": "提交", "git-push": "推送",
    mcp: "MCP", plugin: "插件", restore: "恢复",
  };
  const kind = b.payload?.kind ?? "command";
  const options = permOptions(b, props.showFullAccess);
  return (
    <div style={{ minWidth: 0, opacity: decided ? 0.65 : 1 }}>
      <div style={{ fontWeight: 650, marginBottom: 2, display: "flex", alignItems: "center", gap: 6 }}>
        <TlIcon name="shield" size={13} />
        <span>授权请求 · {kindLabel[kind] ?? kind}</span>
        {b.payload?.source ? <span style={{ fontSize: 10, border: "1px solid var(--c-border)", borderRadius: 4, padding: "0 4px", color: "var(--c-text3)" }}>{b.payload.source}</span> : null}
        {b.payload?.risk && <span style={{ color: b.payload.risk === "high" ? "var(--c-red)" : "var(--c-text3)", marginLeft: "auto", fontWeight: 650 }}>{b.payload.risk === "high" ? "高危" : "注意"}</span>}
      </div>
      {b.command && <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 12, color: "var(--c-text2)", margin: "4px 0 8px", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{b.command}</div>}
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
                  if (o.reply.fullAccess) props.onFullAccess(b.requestId);
                  else if (o.reply.rulePrefix !== undefined && o.reply.rulePrefix !== null && o.reply.ok) props.onReply(b.requestId, true, true, o.reply.rulePrefix);
                  else props.onReply(b.requestId, o.reply.ok, o.reply.remember);
                }}
                style={{ display: "flex", gap: 8, padding: "3px 8px", borderRadius: 6, cursor: "pointer", color: sel === i ? "var(--c-text)" : "var(--c-text2)", background: sel === i ? "var(--c-panel)" : "transparent" }}>
                <span style={{ color: sel === i ? "var(--c-text)" : "transparent", width: 12, flex: "none" }}>{sel === i ? "❯" : ""}</span>
                <span>{o.label}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function QuestionCard(props: {
  b: Extract<Block, { kind: "question" }>;
  decided: string | undefined;
  onAnswer: (requestId: string, answer?: string, optionIndex?: number) => void;
}) {
  const { b, decided, onAnswer } = props;
  const [text, setText] = useState("");
  return (
    <div style={{ border: `2px dashed ${decided ? "var(--c-border)" : "var(--c-accent)"}`, borderRadius: 12, padding: "10px 14px", maxWidth: 700, opacity: decided ? 0.65 : 1 }}>
      <div style={{ fontWeight: 600, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
        <TlIcon name="chat" size={13} color="var(--c-accent)" />
        <span>{b.question}</span>
      </div>
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
export function PlanCard(props: {
  b: Extract<Block, { kind: "plan" }>;
  decided: string | undefined;
  onPlan: (requestId: string, ok: boolean, feedback?: string) => void;
}) {
  const { b, decided, onPlan } = props;
  const [text, setText] = useState("");
  return (
    <div style={{ border: `1px solid ${decided ? "var(--c-border)" : "var(--c-chip-purple-fg, #b490ff)"}`, borderRadius: 12, padding: "10px 14px", maxWidth: 720, opacity: decided ? 0.75 : 1 }}>
      <div style={{ color: "var(--c-chip-purple-fg, #b490ff)", fontWeight: 700, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
        <TlIcon name="plan" size={13} />
        <span>执行计划{decided ? (decided === "ok" ? " · 已批准" : " · 需修订") : ""}</span>
      </div>
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

export function SubtaskBlock({ b, ctx }: { b: Extract<Block, { kind: "subtask" }>; ctx?: TimelineCardCtx }) {
  const [open, setOpen] = useState(b.state === "running");
  const stateColor = b.state === "running" ? "var(--c-amber)" : b.state === "completed" ? "var(--c-green)" : "var(--c-red)";
  return (
    <div style={{ border: "1px solid var(--c-border)", borderRadius: 10, padding: "6px 10px", minWidth: 0 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer", flexWrap: "wrap" }} onClick={() => setOpen(!open)}>
        <TlIcon name="bot" size={14} color={stateColor} className={b.state === "running" ? "tl-pulse" : undefined} />
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


type LogBlock = Extract<Block, { kind: "log" }>;
export function groupLogs(blocks: Block[]): ({ kind: "block"; block: Block } | { kind: "logs"; items: LogBlock[] })[] {
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

// ---- 轮次分组（ZCode 式折叠）----
// 以 turn（轮完成）标记切组：一组 = 一条用户消息（或有/无）之后到下一个 turn 之间的全部过程块。
// 已结束的组把最后一段正文（其后无工具/子代理）抽为 conclusion 常驻可见，process 默认折叠；
// 最后一组若还没有 turn 标记 = 进行中，保持实时展开不折叠。

export interface TurnGroup {
  /** 折叠状态记忆锚（human / turn / 首个过程块的稳定引用） */
  anchor: unknown;
  human: Block | null;
  process: Block[];
  conclusion: Block | null;
  /** 过程尾部的中断/失败/停止状态（独立结果行，不入折叠层，v4.7） */
  outcome: Block[];
  turn: Block | null;
  /** true = 最后一组且尚未收到 turn 标记（本轮仍在流式） */
  active: boolean;
}

export function groupTurns(blocks: Block[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  let cur: TurnGroup | null = null;
  const newGroup = (human: Block | null): TurnGroup =>
    ({ anchor: null, human, process: [], conclusion: null, outcome: [], turn: null, active: false });
  const flush = () => { if (cur) groups.push(cur); cur = null; };
  for (const b of blocks) {
    if (b.kind === "human") { flush(); cur = newGroup(b); continue; }
    if (!cur) cur = newGroup(null);
    if (b.kind === "turn") { cur.turn = b; flush(); continue; }
    cur.process.push(b);
  }
  flush();
  for (const g of groups) {
    g.anchor = g.human ?? g.turn ?? g.process[0] ?? {};
    if (!g.turn) { g.active = true; continue; }
    // 结论抽取：从组尾向前找最后一段正文；中途遇工具/子代理 = 轮以动作收尾（max-steps 等），不抽取
    for (let j = g.process.length - 1; j >= 0; j--) {
      const b = g.process[j];
      if (b.kind === "tool" || b.kind === "subtask") break;
      if (b.kind === "assistant") { g.conclusion = b; g.process.splice(j, 1); break; }
    }
    // 中断/结果状态抽取：过程尾部的连续 status 块独立成行（不入折叠层，v4.7）
    while (g.process.length > 0) {
      const last = g.process[g.process.length - 1];
      if (last.kind !== "status") break;
      g.outcome.unshift(last);
      g.process.pop();
    }
  }
  return groups;
}

function CopyMessageButton({ text, align }: { text: string; align: "left" | "right" }) {
  const [done, setDone] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  return (
    <div style={{ display: "flex", justifyContent: align === "right" ? "flex-end" : "flex-start", marginTop: 4 }}>
      <button type="button" className="icon-btn msg-copy" title={done ? "已复制" : "复制"} aria-label={done ? "已复制" : "复制"}
        onClick={(e) => {
          e.stopPropagation();
          void navigator.clipboard?.writeText(text);
          setDone(true);
          if (timer.current !== null) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setDone(false), 1400);
        }}>
        <TlIcon name={done ? "check" : "copy"} size={13} color={done ? "var(--c-green)" : undefined} />
      </button>
    </div>
  );
}

/** 文件变更组（v4.7）：回合内连续 file 块合并为一组（≥2 时由 TasksPage 调用），行点击跳改动页。 */
export function FileGroup({ items, ctx }: { items: Extract<Block, { kind: "file" }>[]; ctx?: TimelineCardCtx }) {
  return (
    <div className="v47-ln">
      <div className="v47-g"><TlIcon name="diff" size={13} color="var(--c-text2)" /></div>
      <div className="v47-c">
        <div className="v47-fgrp">
          <div className="v47-fh"><span className="fn">本轮变更</span><span className="fc">{items.length} 个文件</span></div>
          {items.map((b, i) => (
            <div key={i} className="v47-frow" title="打开右侧预览修改" onClick={() => ctx?.previewFile?.(b.path)}>
              <span className="st">{b.changeKind === "deleted" ? "D" : b.changeKind === "added" ? "A" : "M"}</span>
              <span className="p">{b.path}</span>
              {b.summary ? <span className="stats">{b.summary}</span> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export const BUILTIN_TIMELINE_RENDERERS: TimelineRendererDef[] = [
  {
    blockKind: "human",
    render: ({ block }) => {
      const b = block as Extract<Block, { kind: "human" }>;
      // 对话形式：用户消息靠右圆角气泡（ZCode 形态），上下留宽间距（文本可选中，无复制钮）
      return (
        <div className="msg-row" style={{ display: "flex", justifyContent: "flex-end", padding: "12px 0 4px" }}>
          <div style={{ maxWidth: "78%", background: "var(--c-panel2, var(--c-panel))", border: "1px solid var(--c-border)", borderRadius: 14, padding: "10px 14px", whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 15, lineHeight: 1.65 }}>
            {b.text}
          </div>
        </div>
      );
    },
  },
  {
    blockKind: "assistant",
    render: ({ block, ctx }) => {
      const b = block as Extract<Block, { kind: "assistant" }>;
      // 空文本块不渲染（流式分片产生的空 assistant 块会在指令组之间留幽灵空行）
      if (!b.text.trim()) return null;
      // 复制钮只挂本轮结论（ctx.showCopy 由 renderBlock 前向扫描判定）
      return (
        <div className="msg-row" style={{ padding: "2px 0" }}>
          <div className="md-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(b.text) }} />
          {ctx?.showCopy ? <CopyMessageButton text={b.text} align="left" /> : null}
        </div>
      );
    },
  },
  {
    blockKind: "thinking",
    render: ({ block, ctx }) => <ThinkingCard b={block as Extract<Block, { kind: "thinking" }>} ctx={ctx} />,
  },
  {
    blockKind: "status",
    render: ({ block }) => {
      const b = block as Extract<Block, { kind: "status" }>;
      const isOutcome = !b.phase || b.phase === "failed"; // completed 落地的中断/结果行（独立类型）
      if (isOutcome) {
        const failed = b.phase === "failed";
        return (
          <div className="v47-outcome">
            <TlIcon name={failed ? "dot" : "check-circle"} size={14} color={failed ? "var(--c-red)" : "var(--c-green)"} style={{ flex: "none", marginTop: 3 }} />
            <span className="tx">{b.text || (failed ? "任务失败" : "本轮已完成")}</span>
          </div>
        );
      }
      const icon = b.phase === "thinking" ? "sparkle" : b.phase === "editing" ? "pencil" : "dot";
      return (
        <div style={{ fontSize: 11.5, color: "var(--c-text3)", display: "flex", alignItems: "center", gap: 6 }}>
          <TlIcon name={icon} size={12} className={b.phase === "thinking" ? "tl-pulse" : undefined} />{b.text}
        </div>
      );
    },
  },
  {
    blockKind: "tool",
    render: ({ block, ctx }) => <ToolCard b={block as Extract<Block, { kind: "tool" }>} ctx={ctx} />,
  },
  {
    blockKind: "checkpoint",
    render: ({ block }) => {
      const b = block as Extract<Block, { kind: "checkpoint" }>;
      return (
        <div className="v47-meta">
          <span>· 检查点 {b.sha.slice(0, 8)}</span>
          <span style={{ color: "var(--c-text2)", overflowWrap: "anywhere" }}>{b.summary}</span>
          <span style={{ opacity: .8 }}>Esc×2 可回滚</span>
        </div>
      );
    },
  },
  {
    blockKind: "file",
    render: ({ block, ctx }) => {
      const b = block as Extract<Block, { kind: "file" }>;
      if (b.changeKind === "read-image") return <div><AgentImage taskId={ctx?.taskId ?? ""} path={b.path} /></div>;
      const letter = b.changeKind === "deleted" ? "D" : b.changeKind === "added" ? "A" : "M";
      return (
        <div className="v47-frow" title="打开右侧预览修改" onClick={() => ctx?.previewFile?.(b.path)}>
          <span className="st">{letter}</span>
          <span className="p">{b.path}</span>
          {b.summary ? <span className="stats">{b.summary}</span> : null}
          {ctx?.viewFile ? <button className="tool-btn v47-preview" onClick={(e) => { e.stopPropagation(); ctx.viewFile?.(b.path); }}>查看</button> : null}
          {ctx?.previewFile && b.changeKind !== "deleted" ? <button className="tool-btn v47-preview" onClick={(e) => { e.stopPropagation(); ctx.previewFile?.(b.path); }}>预览</button> : null}
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
      const total = ((b.usage?.input ?? 0) + (b.usage?.output ?? 0)) / 1000;
      return (
        <div className="v47-usage">
          · {b.usage ? `${total.toFixed(1)}k tokens（${b.usage.input ?? "?"} in / ${b.usage.output ?? "?"} out）` : b.text}
          {ctx?.contextPct ? ` · context ${ctx.contextPct}` : ""}
        </div>
      );
    },
  },
  {
    blockKind: "log",
    render: ({ block }) => {
      const b = block as Extract<Block, { kind: "log" }>;
      return (
        <div style={{ fontSize: 11, color: b.level === "error" ? "var(--c-red)" : b.level === "warn" ? "var(--c-amber)" : "var(--c-text3)", overflowWrap: "anywhere", display: "flex", alignItems: "center", gap: 6 }}>
          <TlIcon name="dot" size={8} />{b.text}
        </div>
      );
    },
  },
];
