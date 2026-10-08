import { Fragment, forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { DiffView, Modal, renderMarkdown, Select } from "../kit";
import type {
  AgentCheckpointDTO, AgentContextStatsDTO, AgentEventDTO, AgentHarnessDTO, AgentTaskDTO,
  AgentTaskFileDTO, DiffDTO, ModelProfileDTO, TaskTypeDTO, WorktreeDTO,
} from "../bridge/types";
import { pageSdk, useAppState, useTaskFocus } from "../pageSdk";
import {
  registerAgentUI, resolveTimelineRenderer, composerProviders, useAgentUIVersion,
  type TimelineRendererDef, type ComposerMentionProviderDef, type TimelineCardCtx,
} from "../external/agentUIShim";
import { TlIcon, toolIconName, type TlIconName } from "./taskIcons";
// 任务页 v3（docs/task-page-v2-design.md）：Codex 信息架构（任务卡列表 + 对话/改动/检查点三独立页）
// × ZCode 交互（⏺ 工具卡折叠/⎿ 结果、编号授权选项、todo 清单、Esc/Esc×2、Shift+Tab 模式循环、
// 上下文条、发送/停止合一图标按钮）。页签为全局导航，改动/检查点为完全独立页（无对话元素）。
const { call, on: onEvent, t, openSettings } = pageSdk;

const LIVE_STATES = new Set(["starting", "working", "awaiting-input", "awaiting-permission"]);
const BUSY_STATES = new Set(["starting", "working", "awaiting-permission"]);
const MODE_ORDER: ("plan" | "default" | "yolo")[] = ["plan", "default", "yolo"];
const MODE_META: Record<string, { label: string; color: string }> = {
  plan: { label: "◇ 规划", color: "var(--c-chip-purple-fg, #b490ff)" },
  default: { label: "● 默认", color: "var(--c-text3)" },
  yolo: { label: "⚡ Yolo", color: "var(--c-red)" },
};
const THINKING_META: Record<"off" | "low" | "medium" | "high", { label: string; hint: string }> = {
  off: { label: "思考·关", hint: "跳过推理，响应最快" },
  low: { label: "思考·低", hint: "轻量推理，适合明确指令" },
  medium: { label: "思考·中", hint: "平衡推理与速度（默认）" },
  high: { label: "思考·高", hint: "深度推理，适合复杂设计" },
};

const TOOL_LABELS: Record<string, string> = {
  web_search: "网络搜索", web_fetch: "读取网页",
  repo_status: "工作区状态", repo_diff: "读取 diff", repo_log: "提交历史",
  repo_read_file: "读文件", repo_list_files: "列文件", repo_glob: "找文件", repo_grep: "搜索内容",
  review_get_state: "验收反馈", file_write: "写文件", file_patch: "编辑文件",
  git_stage: "暂存", git_commit: "提交", git_push: "推送",
  terminal_run: "执行命令", terminal_poll: "后台命令",
  ask_user: "提问", todo_write: "任务清单", plan_submit: "提交计划", task: "子代理",
};

/** 内置斜杠命令表（§20.3.8 数据化自举：补全列表与分发表同一数据源；包命令走 agent.command 贡献） */
const BUILTIN_SLASH: { name: string; arg?: string; hint: string; template?: string }[] = [
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
  { name: "export", hint: "导出会话为 Markdown 文件" },
  { name: "cp", hint: "立即创建检查点" },
  { name: "diff", hint: "查看当前改动" },
  { name: "attach", hint: "附加图片（随下条消息发送）" },
  // 模板命令（D3/D4）：与包命令同一分发语义（busy 排队 / idle 续跑，零新增 RPC）
  { name: "review", hint: "审查当前工作区改动（review 子代理）",
    template: "请用 task 工具（mode=review）审查当前工作区改动：先 repo_status / repo_diff 获取变更，逐文件审查正确性、边界条件与测试影响，产出问题清单（文件:行号 + 高/中/低 + 修复建议），最后给出可合并结论。${input}" },
  { name: "init", hint: "分析仓库并生成/更新 AGENTS.md",
    template: "请分析当前仓库（目录结构、构建/测试/lint 命令、代码约定、现有文档），在仓库根生成或更新 AGENTS.md：项目简介、常用命令、目录导览、代码约定与注意事项。已存在时合并改进而非覆盖。${input}" },
];

// ---- 时间线块模型（v3：⏺ 工具卡折叠 / ⎿ 结果缩进）----

type Todo = { content: string; status: "pending" | "in_progress" | "completed" };

type Block =
  | { kind: "human"; text: string }
  | { kind: "assistant"; text: string; merge: boolean }
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
      return pushCap(blocks, { kind: "status", text: `${ev.phase ?? ""}${ev.summary ? ` — ${ev.summary}` : ""}`, phase: ev.phase });
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

type PermOption = { label: string; reply: { ok: boolean; remember?: boolean; rulePrefix?: string | null; fullAccess?: boolean } };

/** 授权卡编号选项生成（§四 + Codex 式升级）：一次 / 本会话 / 总是允许前缀 / 完全访问（切 yolo）/ 否。
 * fullAccess = 批准当前请求并把任务切到 yolo 模式（后续免询问；推送/高危命令由安全内核恒拦，不可放宽）。 */
function permOptions(b: Extract<Block, { kind: "permission" }>, showFullAccess = false): PermOption[] {
  const sig = b.command ?? b.title;
  const prefix = sig ? sig.slice(0, 24) : null;
  const opts: PermOption[] = [{ label: "1. 是，执行一次", reply: { ok: true } }];
  if (b.rememberable !== false) opts.push({ label: "2. 是，本会话不再询问", reply: { ok: true, remember: true } });
  if (prefix) opts.push({ label: `3. 是，总是允许前缀 “${prefix}”`, reply: { ok: true, remember: true, rulePrefix: prefix } });
  if (showFullAccess) opts.push({ label: `${opts.length + 1}. 完全访问：批准并切换（后续免询问，推送/高危除外）`, reply: { ok: true, remember: true, fullAccess: true } });
  opts.push({ label: `${opts.length + 1}. 否，告诉 agent 改用其他方式`, reply: { ok: false } });
  return opts;
}

/** 错误浮层（对话页顶部状态条下方 / 新任务页顶部居中）：默认单行省略，超长时出现「展开」按钮查看全文；
 * go 可选——带「去设置」类跳转按钮（如视觉能力报错直达 模型档案 设置分区）。 */
function ErrorFloat(props: { text: string; maxWidth: number | string; go?: { label: string; section: string } | null; onGo?: (section: string) => void; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const textRef = useRef<HTMLSpanElement | null>(null);
  // 换新错误时回到折叠态，并按当前宽度重测是否被截断
  useEffect(() => {
    setOpen(false);
    const el = textRef.current;
    setTruncated(!!el && el.scrollWidth > el.clientWidth + 1);
  }, [props.text]);
  return (
    <div className="banner error" style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", zIndex: 30, margin: 0, maxWidth: props.maxWidth, boxShadow: "0 8px 20px color-mix(in srgb, #000 25%, transparent)" }}>
      <span ref={textRef} className="banner-text"
        style={open ? { whiteSpace: "normal", wordBreak: "break-word", maxHeight: "40vh", overflowY: "auto", userSelect: "text" } : undefined}>
        {props.text}
      </span>
      {(truncated || open) && (
        <button className="tool-btn" style={{ flex: "none" }} onClick={() => setOpen((v) => !v)}>{open ? "收起" : "展开"}</button>
      )}
      {props.go && props.onGo && (
        <button className="tool-btn" title={`打开设置 · ${props.go.section}`}
          style={{ flex: "none", color: "var(--c-link)", textDecoration: "underline", textUnderlineOffset: 2 }}
          onClick={() => props.onGo!(props.go!.section)}>{props.go.label}</button>
      )}
      <button className="tool-btn" style={{ flex: "none" }} onClick={props.onClose}>✕</button>
    </div>
  );
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
  selectedIndex: number;
  onSelect: (idx: number) => void;
}) {
  const { mention, items, onPick, onSelect } = props;
  if (!mention || items.length === 0) return null;
  const sel = Math.max(0, Math.min(props.selectedIndex, items.length - 1));
  return (
    <div className="mention-pop" style={{ position: "absolute", bottom: "100%", left: 0, right: 0, marginBottom: 10, maxHeight: 180, overflowY: "auto", border: "1px solid var(--c-border)", borderRadius: 8, zIndex: 20 }}>
      {items.map((it, i) => (
        <div key={it.label}
          ref={(el) => { if (el && i === sel) el.scrollIntoView({ block: "nearest" }); }}
          style={{
            padding: "4px 10px", fontSize: 12, cursor: "pointer", borderRadius: 6,
            background: i === sel ? "var(--c-selected)" : "transparent",
            color: i === sel ? "var(--c-text)" : "var(--c-text2)",
          }}
          onMouseEnter={() => onSelect(i)}
          onMouseDown={(e) => { e.preventDefault(); onPick(it.insert); }}>
          {it.label}
        </div>
      ))}
    </div>
  );
}

/** 斜杠命令弹出层（输入 / 后自动出现，过滤匹配的命令列表）。 */
function SlashPopover(props: {
  open: boolean;
  items: { name: string; hint: string; insert: string }[];
  onPick: (insert: string) => void;
  selectedIndex: number;
  onSelect: (idx: number) => void;
}) {
  if (!props.open || props.items.length === 0) return null;
  const sel = Math.max(0, Math.min(props.selectedIndex, props.items.length - 1));
  return (
    <div className="mention-pop" style={{ position: "absolute", bottom: "100%", left: 0, right: 0, marginBottom: 10, maxHeight: 240, overflowY: "auto", border: "1px solid var(--c-border)", borderRadius: 8, zIndex: 20 }}>
      {props.items.map((it, i) => (
        <div key={it.name}
          ref={(el) => { if (el && i === sel) el.scrollIntoView({ block: "nearest" }); }}
          style={{
            padding: "5px 10px", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, borderRadius: 6,
            background: i === sel ? "var(--c-selected)" : "transparent",
          }}
          onMouseEnter={() => props.onSelect(i)}
          onMouseDown={(e) => { e.preventDefault(); props.onPick(it.insert); }}>
          <span style={{ fontFamily: "var(--mono, monospace)", color: "var(--c-text)", fontWeight: 600, flex: "none" }}>{it.name}</span>
          <span style={{ color: "var(--c-text3)", fontSize: 11 }}>{it.hint}</span>
        </div>
      ))}
    </div>
  );
}

/** ⏺ 工具卡（ZCode 形态：默认折叠一行，⎿ 结果缩进一行；点击展开完整；terminal 运行中 tail 4 行）。
 * 行首图标按工具类别区分（taskIcons），颜色随状态：运行琥珀脉冲 / 成功绿 / 失败红。 */
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
        <TlIcon name={toolIconName(b.name)} color={glyphColor} className={b.state === "running" ? "tl-pulse" : undefined} />
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

/** 计划任务列表（ZCode TodoList 形态）：头部显示进度，点击整行折叠/展开。
 * 展开动画 = height: 0 ↔ 内容实测高度（px）。grid-template-rows 的 fr/max-content
 * 关键字不是长度，浏览器无法在两者间插值，视觉上是瞬切；height 的 px 一定能逐帧插值。
 * 过渡结束后把 height 归位到 auto，让后续条目增删、换行、字号变化都能自适应，不残留固定高度。
 * todo 事件每次都会替换掉历史条目（reducer 只留最新一份），
 * 所以状态推进时卡片原地刷新，不会在时间线里堆积重复清单。 */
function TodoList({ todos }: { todos: Todo[] }) {
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

/** 模型选择两级数据：一级 = 供应商（用户分组/包档案），二级 = 组内具体模型。 */
interface ModelGroupVM {
  id: string;
  name: string;
  hint?: string;
  members: { id: string; name: string; sub?: string }[];
}

/** composer 底部工具条弹出菜单（ZCode 形态）：向上展开，点击外部/Esc 收起。
 * open 为 null 表示关闭；动画由 .comp-pop.open 的 opacity+transform 过渡负责。 */
function CompPopover(props: {
  open: boolean;
  anchor: "left" | "right";
  /** 加宽变体（默认宽度的 2 倍）：内容多的面板用，如 + 附件/命令 */
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // 动态高度：向上展开的弹层按「视口顶 → 弹层底」的可用空间收顶（上限 320px），内容超高内部滚动
  const [maxH, setMaxH] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (!props.open) { setMaxH(undefined); return; }
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setMaxH(Math.max(160, Math.min(320, r.bottom - 12)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [props.open]);
  useEffect(() => {
    if (!props.open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) props.onClose();
    };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); props.onClose(); } };
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [props.open, props.onClose]);
  return (
    <div ref={ref} className={"comp-pop" + (props.open ? " open" : "") + (props.wide ? " wide" : "") + (props.anchor === "right" ? " right" : "")}
      style={{ maxHeight: maxH, overflowY: maxH !== undefined ? "auto" : undefined }} aria-hidden={!props.open}>
      {props.children}
    </div>
  );
}

/** 工具条单条菜单项：当前项打勾，其余行只给背景反馈 */
function CompOption(props: {
  icon?: TlIconName;
  color?: string;
  name: string;
  sub?: string;
  on: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  const { icon, color, name, sub, on, disabled, onSelect } = props;
  return (
    <div className={"comp-opt" + (on ? " on" : "") + (disabled ? "" : "")}
      style={disabled ? { opacity: 0.45, cursor: "default" } : undefined}
      onClick={() => { if (!disabled) onSelect(); }}>
      {icon ? <TlIcon name={icon} size={13} color={color} /> : <span style={{ width: 13, flex: "none" }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="comp-opt-name">{name}</div>
        {sub ? <div className="comp-opt-sub">{sub}</div> : null}
      </div>
      {on && <TlIcon name="check-circle" size={13} className="comp-check" color="var(--c-green)" />}
    </div>
  );
}

/** 任务页底部 composer（ZCode 中央输入框形态）——对话与新任务两处共用同一套工具条。
 * 工具条：+ 附件 / 访问控制（审批模式）/ 模型 / 思考深度 / 上下文用量 / 发送·停止。
 * 四个下拉均为真实功能入口（写回 agent.task.setMode / setModel / 续跑切换思考深度 / 上下文明细）。
 * forwardRef：React ≤18 不把 ref 作为 prop 传函数组件，自动增高与外部 focus 都依赖它。 */
type ComposerProps = {
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  minH?: number;
  maxH: number;
  autoFocus?: boolean;
  busy: boolean;
  sending: boolean;
  canSend: boolean;
  sendTitle: string;
  onStop: () => void;
  onSend: () => void;
  mode: "plan" | "default" | "yolo";
  onMode: (m: "plan" | "default" | "yolo") => void;
  modeDisabled?: boolean;
  modeLabel: string;
  /** 两级模型选择：一级供应商（用户分组/包档案），二级组内具体模型 */
  groups: ModelGroupVM[];
  model: string;
  onModel: (id: string) => void;
  modelDisabled?: boolean;
  thinking: "off" | "low" | "medium" | "high";
  onThinking: (v: "off" | "low" | "medium" | "high") => void;
  stats: AgentContextStatsDTO | null;
  attachments?: { name: string; dataUrl: string; onRemove: () => void }[];
  attachmentHint?: string;
  onAttachImage: () => void;
  slash?: { name: string; hint: string; insert: string }[];
  onPickSlash: (insert: string) => void;
  children?: ReactNode;
};

const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(function Composer(props, ref) {
  const { value, onChange, onKeyDown, placeholder, maxH } = props;
  const [open, setOpen] = useState<"" | "plus" | "mode" | "model" | "think" | "stats">("");
  const toggle = (k: typeof open) => setOpen((o) => (o === k ? "" : k));
  // 两级模型选择：modelNav = 当前二级面板的供应商分组 id（"" = 一级列表；面板收起即复位）
  const [modelNav, setModelNav] = useState("");
  useEffect(() => { if (open !== "model") setModelNav(""); }, [open]);
  // 自动增高：随内容长高，封顶后内部滚动；清空自动回落
  useEffect(() => {
    const el = typeof ref === "function" ? null : ref?.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, maxH) + "px";
  }, [value, maxH]);
  const pick = <T,>(v: T, set: (x: T) => void) => { set(v); setOpen(""); };

  // 当前选中项定位（跨分组找叶节点）：组名 · 模型名（单模型组只显示模型名）
  const curHit = (() => {
    for (const g of props.groups) {
      const mem = g.members.find((x) => x.id === props.model);
      if (mem) return { g, mem };
    }
    return null;
  })();

  const s = props.stats;
  const pct = s ? Math.round(s.ratio * 100) : 0;
  const pctColor = s ? (pct > 92 ? "var(--c-red)" : pct > 80 ? "var(--c-amber)" : "var(--c-text3)") : "var(--c-text3)";
  const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : `${n}`);

  return (
    <div className="composer-box" style={{ position: "relative" }}>
      {props.attachments && props.attachments.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
          {props.attachments.map((img, i) => (
            <div key={`${img.name}:${i}`} style={{ position: "relative" }}>
              <img src={img.dataUrl} alt={img.name} style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 8, border: "1px solid var(--c-border)" }} />
              <button className="tool-btn" title="移除" style={{ position: "absolute", top: -6, right: -6, padding: "0 5px", fontSize: 10 }} onClick={img.onRemove}>✕</button>
            </div>
          ))}
          {props.attachmentHint ? <span className="hint" style={{ alignSelf: "center" }}>{props.attachmentHint}</span> : null}
        </div>
      )}
      {props.children}
      <textarea
        ref={ref}
        className="composer-input"
        rows={1}
        autoFocus={props.autoFocus}
        style={{ minHeight: props.minH ?? 24 }}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => {
          const files = [...e.clipboardData.files];
          if (files.some((f) => f.type.startsWith("image/"))) { e.preventDefault(); props.onAttachImage(); }
        }}
        onDrop={(e) => {
          const files = [...e.dataTransfer.files];
          if (files.some((f) => f.type.startsWith("image/"))) { e.preventDefault(); props.onAttachImage(); }
        }}
        onKeyDown={onKeyDown}
      />
      <div className="comp-bar">
        {/* + 附件：图片选择器 + 内置斜杠命令快速注入 */}
        <span style={{ position: "relative", display: "inline-flex" }}>
          <button className="comp-item" title="附加附件 / 命令" aria-haspopup="menu" aria-expanded={open === "plus"}
            style={{ padding: "0 7px" }} onClick={() => toggle("plus")}>
            <TlIcon name="plus" size={14} />
          </button>
          <CompPopover open={open === "plus"} wide anchor="left" onClose={() => setOpen("")}>
            <div className="comp-pop-head">附件</div>
            <div className="comp-opt" onClick={() => { props.onAttachImage(); setOpen(""); }}>
              <TlIcon name="file" size={13} color="var(--c-text2)" />
              <span className="comp-opt-name">添加图片</span>
              <span className="comp-opt-sub">最多 4 张 · 4MB</span>
            </div>
            {props.slash && props.slash.length > 0 && (
              <>
                <div className="comp-pop-sep" />
                <div className="comp-pop-head">命令（插入输入框）</div>
                {props.slash.slice(0, 14).map((c) => (
                  <div key={c.name} className="comp-opt" onClick={() => { props.onPickSlash?.(c.insert); setOpen(""); }}>
                    <span style={{ fontFamily: "var(--mono, monospace)", color: "var(--c-text)", fontSize: 12 }}>{c.name}</span>
                    <span className="comp-opt-sub">{c.hint}</span>
                  </div>
                ))}
              </>
            )}
          </CompPopover>
        </span>

        {/* 访问控制：审批模式（规划 / 默认 / Yolo） */}
        <span style={{ position: "relative", display: "inline-flex" }}>
          <button className="comp-item" title="访问控制（Shift+Tab 循环）" aria-haspopup="menu" aria-expanded={open === "mode"}
            onClick={() => toggle("mode")} disabled={props.modeDisabled}>
            {props.mode === "yolo" ? <TlIcon name="bolt" size={13} color="var(--c-red)" />
              : props.mode === "plan" ? <TlIcon name="plan" size={13} color="var(--c-chip-purple-fg, #b490ff)" />
                : <TlIcon name="shield" size={13} color="var(--c-text2)" />}
            <span className="comp-label">{props.modeLabel}</span>
            <TlIcon name="chevron-down" size={10} className={"comp-chev" + (open === "mode" ? " open" : "")} />
          </button>
          <CompPopover open={open === "mode"} anchor="left" onClose={() => setOpen("")}>
            <div className="comp-pop-head">访问控制</div>
            {(MODE_ORDER as ("plan" | "default" | "yolo")[]).map((m) => (
              <CompOption key={m} on={props.mode === m} onSelect={() => pick(m, props.onMode)}
                icon={m === "yolo" ? "bolt" : m === "plan" ? "plan" : "shield"}
                color={MODE_META[m].color}
                name={MODE_META[m].label.replace(/^[●◆◇⚡]\s*/, "")}
                sub={m === "plan" ? "只读调研，出计划待批准" : m === "yolo" ? "全部放行，高危除外" : "写操作逐条授权"} />
            ))}
          </CompPopover>
        </span>

        {/* 模型 */}
        <span style={{ position: "relative", display: "inline-flex" }}>
          <button className="comp-item" title="模型档案" aria-haspopup="menu" aria-expanded={open === "model"}
            onClick={() => toggle("model")} disabled={props.modelDisabled}>
            <TlIcon name="bot" size={13} color="var(--c-text2)" />
            <span className="comp-label">{curHit
              ? (curHit.g.members.length > 1 ? `${curHit.g.name} · ${curHit.mem.name}` : curHit.mem.name)
              : (props.model || "默认模型")}</span>
            <TlIcon name="chevron-down" size={10} className={"comp-chev" + (open === "model" ? " open" : "")} />
          </button>
          <CompPopover open={open === "model"} anchor="left" onClose={() => setOpen("")}>
            {modelNav ? (() => {
              // 二级面板：具体模型列表（头部返回一级供应商列表）
              const g = props.groups.find((x) => x.id === modelNav);
              if (!g) return null;
              return (
                <>
                  <div className="comp-opt comp-group" role="button" tabIndex={0} aria-label={g.name}
                    onClick={() => setModelNav("")}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setModelNav(""); } }}>
                    <TlIcon name="chevron-right" size={11} style={{ transform: "rotate(180deg)" }} color="var(--c-text3)" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="comp-opt-name">{g.name}</div>
                      {g.hint ? <div className="comp-opt-sub">{g.hint}</div> : null}
                    </div>
                    <span className="comp-count">{g.members.length}</span>
                  </div>
                  {g.members.map((mem) => (
                    <CompOption key={mem.id} on={mem.id === props.model} onSelect={() => pick(mem.id, props.onModel)}
                      name={mem.name} sub={mem.sub} />
                  ))}
                </>
              );
            })() : (
              // 一级面板：供应商列表；单模型档案直接选中，多模型进入二级
              <>
                <div className="comp-pop-head">模型</div>
                {props.groups.map((g) => {
                  if (g.members.length > 1) {
                    return (
                      <div key={g.id} className="comp-opt comp-group" role="button" tabIndex={0}
                        aria-haspopup="menu" aria-label={g.name}
                        onClick={() => setModelNav(g.id)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setModelNav(g.id); } }}>
                        <TlIcon name="bot" size={13} color="var(--c-text2)" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="comp-opt-name">{g.name}</div>
                          {g.hint ? <div className="comp-opt-sub">{g.hint}</div> : null}
                        </div>
                        <span className="comp-count">{g.members.length}</span>
                        <TlIcon name="chevron-right" size={10} color="var(--c-text3)" />
                      </div>
                    );
                  }
                  const mem = g.members[0];
                  return (
                    <CompOption key={g.id} on={mem.id === props.model} onSelect={() => pick(mem.id, props.onModel)}
                      icon="bot" color="var(--c-text2)" name={g.name} sub={g.hint ?? mem.sub} />
                  );
                })}
              </>
            )}
          </CompPopover>
        </span>

        {/* 思考深度 */}
        <span style={{ position: "relative", display: "inline-flex" }}>
          <button className="comp-item" title="思考深度" aria-haspopup="menu" aria-expanded={open === "think"} onClick={() => toggle("think")}>
            <TlIcon name="gear" size={13} color="var(--c-text2)" />
            <span className="comp-label">{THINKING_META[props.thinking].label}</span>
            <TlIcon name="chevron-down" size={10} className={"comp-chev" + (open === "think" ? " open" : "")} />
          </button>
          <CompPopover open={open === "think"} anchor="left" onClose={() => setOpen("")}>
            <div className="comp-pop-head">思考深度</div>
            {(["off", "low", "medium", "high"] as const).map((v) => (
              <CompOption key={v} on={v === props.thinking} onSelect={() => pick(v, props.onThinking)}
                icon="sparkle" color={v === "off" ? "var(--c-text3)" : "var(--c-amber)"}
                name={THINKING_META[v].label} sub={THINKING_META[v].hint} />
            ))}
          </CompPopover>
        </span>

        <span style={{ flex: 1 }} />
        <button className="comp-send" title={props.sendTitle} disabled={!props.canSend && !props.busy} onClick={() => (props.busy ? props.onStop() : props.onSend())}>
          <TlIcon name={props.busy ? "stop" : "send"} size={13} />
        </button>
      </div>
      {/* 统计栏（DeepSeek 式）：上下文容量 / token 用量 / 速度 / 缓存命中率，点击展开明细。
          新任务页与空会话（无消息、无用量记录）不显示整栏——避免一排「—」和多余分割线。 */}
      {s && (s.estTokens > 0 || s.totalInput != null) && (
      <span style={{ position: "relative", display: "block" }}>
        <button type="button" className="comp-stats" title="用量明细" aria-haspopup="menu" aria-expanded={open === "stats"} onClick={() => toggle("stats")}>
          <span className="comp-stats-bar"><i style={{ width: `${Math.min(100, pct)}%`, background: pctColor }} /></span>
          <span className="comp-stats-item">上下文 <b>{s ? `${fmtK(s.estTokens)} / ${fmtK(s.contextWindow)}` : "—"}</b>{s ? ` · ${pct}%` : ""}</span>
          <span className="comp-stats-item">输入 <b>{s?.totalInput != null ? fmtK(s.totalInput) : "—"}</b></span>
          <span className="comp-stats-item">输出 <b>{s?.totalOutput != null ? fmtK(s.totalOutput) : "—"}</b></span>
          <span className="comp-stats-item"><b>{s?.tokPerSec != null ? `${s.tokPerSec} tok/s` : "—"}</b></span>
          <span className="comp-stats-item">缓存 <b>{s?.cacheHitRate != null ? `${Math.round(s.cacheHitRate * 100)}%` : "—"}</b></span>
          <TlIcon name="chevron-down" size={10} className={"comp-chev" + (open === "stats" ? " open" : "")} />
        </button>
        <CompPopover open={open === "stats"} anchor="right" onClose={() => setOpen("")}>
          <div className="comp-pop-head">用量明细</div>
          {s ? (
            <>
              <div className="comp-ctx-row"><span>上下文窗口</span><b>{fmtK(s.contextWindow)} · {pct}%</b></div>
              <div className="comp-ctx-row"><span>系统提示</span><b>{Math.round(s.breakdown.system)} tok</b></div>
              <div className="comp-ctx-row"><span>历史消息</span><b>{Math.round(s.breakdown.messages)} tok</b></div>
              <div className="comp-ctx-row"><span>预留输出</span><b>{Math.round(s.breakdown.reserved)} tok</b></div>
              <div className="comp-pop-sep" />
              <div className="comp-ctx-row"><span>剩余预算</span><b>{fmtK(s.budget)}</b></div>
              <div className="comp-ctx-row"><span>累计输入</span><b>{s.totalInput != null ? `${s.totalInput.toLocaleString()} tok` : "—"}</b></div>
              <div className="comp-ctx-row"><span>累计输出</span><b>{s.totalOutput != null ? `${s.totalOutput.toLocaleString()} tok` : "—"}</b></div>
              <div className="comp-ctx-row"><span>最近一轮输出</span><b>{s.lastOutput != null ? `${s.lastOutput.toLocaleString()} tok` : "—"}</b></div>
              <div className="comp-ctx-row"><span>生成速度</span><b>{s.tokPerSec != null ? `${s.tokPerSec} tok/s` : "—"}</b></div>
              <div className="comp-ctx-row"><span>缓存命中率</span><b>{s.cacheHitRate != null ? `${Math.round(s.cacheHitRate * 100)}%` : "—"}</b></div>
              {s.compactions > 0 && <div className="comp-ctx-row"><span>已自动压缩</span><b>{s.compactions} 次</b></div>}
              {pct > 80 && (
                <div style={{ padding: "2px 9px 6px", fontSize: 11, color: "var(--c-amber)" }}>
                  已接近上限，建议 /compact 压缩历史
                </div>
              )}
            </>
          ) : (
            <div style={{ padding: "2px 9px 8px", fontSize: 11, color: "var(--c-text3)" }}>
              发送首条消息后开始统计
            </div>
          )}
        </CompPopover>
      </span>
      )}
    </div>
  );
});


/** 授权卡（ZCode 编号选项：❯ 当前项，↑↓+Enter+数字直选） */
function PermissionCard(props: {
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
    <div style={{ border: `1px solid ${decided ? "var(--c-border)" : "var(--c-amber)"}`, borderRadius: 12, padding: "10px 14px", maxWidth: 700, opacity: decided ? 0.65 : 1 }}>
      <div style={{ color: decided ? "var(--c-text3)" : "var(--c-amber)", fontWeight: 700, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
        <TlIcon name="shield" size={13} />
        <span>授权请求 · {kindLabel[kind] ?? kind}</span>
        {b.payload?.source ? <span style={{ fontSize: 10, border: "1px solid var(--c-border)", borderRadius: 4, padding: "0 4px" }}>{b.payload.source}</span> : null}
        {b.payload?.risk && <span style={{ color: b.payload.risk === "high" ? "var(--c-red)" : "var(--c-amber)", marginLeft: "auto", fontWeight: 700 }}>■ {b.payload.risk === "high" ? "高危" : "注意"}</span>}
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
                  if (o.reply.fullAccess) props.onFullAccess(b.requestId);
                  else if (o.reply.rulePrefix !== undefined && o.reply.rulePrefix !== null && o.reply.ok) props.onReply(b.requestId, true, true, o.reply.rulePrefix);
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
function PlanCard(props: {
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

function SubtaskBlock({ b, ctx }: { b: Extract<Block, { kind: "subtask" }>; ctx?: TimelineCardCtx }) {
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
      // 对话形式：用户消息靠右圆角气泡（ZCode 形态），上下留宽间距
      return (
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "12px 0 4px" }}>
          <div style={{ maxWidth: "78%", background: "var(--c-panel2, var(--c-panel))", border: "1px solid var(--c-border)", borderRadius: 14, padding: "10px 14px", whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 13, lineHeight: 1.65 }}>
            {b.text}
          </div>
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
    render: ({ block }) => <ToolCard b={block as Extract<Block, { kind: "tool" }>} />,
  },
  {
    blockKind: "checkpoint",
    render: ({ block }) => {
      const b = block as Extract<Block, { kind: "checkpoint" }>;
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", color: "var(--c-text3)", fontSize: 12, fontFamily: "var(--mono, monospace)" }}>
          <TlIcon name="check-circle" size={13} color="var(--c-text)" /><span>cp {b.sha.slice(0, 8)}</span>
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
          {ctx?.previewFile && b.changeKind !== "deleted" && (
            <button className="tool-btn" style={{ fontSize: 10.5, marginLeft: 4, padding: "0 6px" }} onClick={() => ctx.previewFile?.(b.path)}>预览</button>
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
        <div style={{ color: "var(--c-text3)", fontSize: 11, fontFamily: "var(--mono, monospace)", display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <TlIcon name="usage" size={12} />{b.text}
          </span>
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
        <div style={{ fontSize: 11, color: b.level === "error" ? "var(--c-red)" : b.level === "warn" ? "var(--c-amber)" : "var(--c-text3)", overflowWrap: "anywhere", display: "flex", alignItems: "center", gap: 6 }}>
          <TlIcon name="dot" size={8} />{b.text}
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
  // 切回对话页：恢复离开时的滚动位置（面板保持挂载，无需重新加载历史）
  useEffect(() => {
    if (tab !== "chat") return;
    requestAnimationFrame(() => {
      const el = timelineRef.current;
      if (!el) return;
      const saved = lastChatScrollRef.current;
      if (saved != null) { el.scrollTop = saved; lastChatScrollRef.current = null; }
      else scrollTimelineToBottom(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  const [evMap, setEvMap] = useState<Record<string, Block[]>>({});
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [focusTaskId, consumeTaskFocus] = useTaskFocus();
  useEffect(() => {
    if (!focusTaskId) return;
    setSelectedTask(focusTaskId);
    consumeTaskFocus();
  }, [focusTaskId]);
  const [error, setError] = useState<string | null>(null);
  // 「去设置」跳转：仅与 setConfigError 设置的那条错误配对（普通 setError 不带跳转）
  const [errorGo, setErrorGo] = useState<{ label: string; section: string } | null>(null);
  const errorGoFor = useRef<string | null>(null);
  const setConfigError = (text: string, label: string, section: string) => {
    errorGoFor.current = text;
    setErrorGo({ label, section });
    setError(text);
  };
  useEffect(() => {
    if (error !== errorGoFor.current) setErrorGo(null);
  }, [error]);
  const [inputText, setInputText] = useState("");
  const [composeText, setComposeText] = useState("");
  // 思考深度：跟随所选模型的档案默认值（添加模型时配置；分组按实际成员取），任务打开时用其持久值
  const defaultProfile = modelProfiles.find((m) => m.isDefault) ?? modelProfiles[0];
  /** 模型引用 → 分组主条目（成员引用 `分组id#模型id` 归到所属分组卡片）。 */
  const resolveRefProfile = (ref: string | null | undefined): ModelProfileDTO | undefined => {
    if (!ref) return undefined;
    const gid = ref.split("#")[0];
    return modelProfiles.find((m) => m.id === ref) ?? modelProfiles.find((m) => m.id === gid);
  };
  /** 模型引用 → 该成员的视觉能力（成员可与首成员不同，D1 门控按实际选中成员判定）。 */
  const resolveRefVision = (ref: string | null | undefined): boolean => {
    const profile = resolveRefProfile(ref);
    if (!profile) return false;
    const gid = profile.groupId;
    if (ref && ref.startsWith(`${gid}#`) && profile.groupModels) {
      const mem = profile.groupModels.find((g) => g.modelId === ref.slice(gid.length + 1));
      if (mem) return mem.vision;
    }
    return profile.capabilities.vision ?? false;
  };
  /** 模型引用 → 该成员的默认思考深度（选择/切换模型时带入）。 */
  const resolveRefThinking = (ref: string | null | undefined): "off" | "low" | "medium" | "high" => {
    const profile = resolveRefProfile(ref);
    if (!profile) return "medium";
    const gid = profile.groupId;
    if (ref && ref.startsWith(`${gid}#`) && profile.groupModels) {
      const mem = profile.groupModels.find((g) => g.modelId === ref.slice(gid.length + 1));
      if (mem) return mem.thinking;
    }
    return profile.thinking ?? "medium";
  };
  const [thinking, setThinking] = useState<"off" | "low" | "medium" | "high">(defaultProfile?.thinking ?? "medium");
  // 新建任务：模型未显式指定时跟随设置里的默认模型（含具体成员），切换选择即带入其思考深度
  useEffect(() => {
    if (!selectedTask) setThinking(resolveRefThinking(modelId || app.settings?.defaultModelId || defaultProfile?.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, modelProfiles]);
  const [sending, setSending] = useState(false);
  const [decided, setDecided] = useState<Record<string, string>>({});
  const [stats, setStats] = useState<AgentContextStatsDTO | null>(null);
  const [changesTick, setChangesTick] = useState(0);
  const [mention, setMention] = useState<{ start: number; prefix: string; query: string } | null>(null);
  const [mentionItems, setMentionItems] = useState<{ label: string; insert: string }[]>([]);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [slashSel, setSlashSel] = useState(0);
  const [mentionSel, setMentionSel] = useState(0);
  const [pkgCommands, setPkgCommands] = useState<{ name: string; template: string; packageId: string }[]>([]);
  const [permSel, setPermSel] = useState<Record<string, number>>({});
  const [maxSubagents, setMaxSubagents] = useState(3);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [pendingFile, setPendingFile] = useState<string | null>(null);
  // D1 图片输入（§21.2.1）：粘贴/拖拽附件（继续对话与新任务 composer 共用，互斥显示）
  const [pendingImages, setPendingImages] = useState<{ name: string; dataUrl: string }[]>([]);
  const addImages = useCallback((files: { name: string; dataUrl: string }[]) => {
    setPendingImages((cur) => {
      const next = [...cur, ...files].slice(0, 4);
      return next;
    });
  }, []);
  const filesToImages = useCallback((files: File[]) => {
    const imgs = files.filter((f) => /^image\//.test(f.type)).slice(0, 4);
    for (const f of imgs) {
      if (f.size > 4 * 1024 * 1024) { setError(`图片超过 4MB 上限：${f.name}`); continue; }
      const reader = new FileReader();
      reader.onload = () => addImages([{ name: f.name || "image.png", dataUrl: String(reader.result) }]);
      reader.readAsDataURL(f);
    }
  }, [addImages]);
  // D9 只读预览（§21.3.4）
  const [preview, setPreview] = useState<{ path: string; content: string; truncated: boolean; binary: boolean; size: number } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewFile = useCallback((path: string) => {
    if (!selectedTask) return;
    setPreviewLoading(true);
    setPreview({ path, content: "", truncated: false, binary: false, size: 0 });
    void call<{ content: string; truncated: boolean; binary: boolean; size: number }>("agent.task.previewFile", { taskId: selectedTask, path })
      .then((r) => setPreview({ path, ...r }))
      .catch((e) => setPreview({ path, content: `（读取失败：${(e as Error).message}）`, truncated: false, binary: false, size: 0 }))
      .finally(() => setPreviewLoading(false));
  }, [selectedTask]);
  const [cpCount, setCpCount] = useState(0);
  const [diffCount, setDiffCount] = useState(0);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  // 最近一次时间线滚动位置：切改动/检查点后切回对话时恢复，避免回顶
  const lastChatScrollRef = useRef<number | null>(null);
  // 稳定引用：onScroll 回调通过 ref 调用 loadOlder，避免闭包依赖
  const loadOlderRef = useRef<(() => void) | null>(null);
  // 距底超过 80px 才显示「返回底部」浮钮：滚轮微动不闪烁，接近底部即隐藏
  const onTimelineScroll = useCallback(() => {
    const el = timelineRef.current;
    if (!el) return;
    const away = el.scrollHeight - el.scrollTop - el.clientHeight > 80;
    setAwayFromBottom((v) => (v === away ? v : away));
    // 持续记录滚动位置：切改动/检查点再切回时恢复（面板保持挂载，不重载）
    lastChatScrollRef.current = el.scrollTop;
    // 距顶 < 160px 触发加载更早；由 loadOlder 内部的 guard 去重
    if (el.scrollTop < 160) void loadOlderRef.current?.();
  }, []);
  const replied = useRef(new Set<string>());
  const inputHistory = useRef<string[]>([]);
  const historyIdx = useRef(-1);
  const escTs = useRef(0);
  const oldestTs = useRef<string | null>(null);
  const composeRef = useRef<HTMLTextAreaElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  // composer 自动增高由 Composer 组件内部按 minH/maxH props 处理（此处旧的重复 effect 会覆盖组件内高度）
  const [, forceTick] = useState(0);
  // agent UI 注册表版本订阅：包热插拔（用户包注册/卸载渲染器、provider）时时间线重渲染
  useAgentUIVersion();
  // 模块级自举错过注入窗口时（宿主内置组件语境）由组件体补注册（幂等）
  registerBuiltinAgentUI();

  const scrollTimelineToBottom = useCallback((smooth?: boolean) => {
    const doScroll = () => {
      const el = timelineRef.current;
      if (!el) return;
      if (smooth) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      else el.scrollTop = el.scrollHeight;
      // 程序化设置 scrollTop 不一定触发 scroll 事件（尤其 IAB/Playwright），
      // 显式同步浮钮状态，避免「已到底部但按钮仍在」
      setAwayFromBottom(false);
    };
    // 立即滚一次（覆盖点击当时的状态），再在下一帧滚一次吸收新增 DOM 布局
    doScroll();
    requestAnimationFrame(doScroll);
  }, []);

  // 新任务（按钮 / Ctrl+N）：回到新任务 composer 并聚焦输入框。
  // 快捷键在 window 上监听、随本页卸载清理——仅任务页挂载期间生效，其他页面不受影响。
  const startNewTask = useCallback(() => {
    setSelectedTask(null);
    setTab("chat");
    requestAnimationFrame(() => requestAnimationFrame(() => composeRef.current?.focus()));
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        startNewTask();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [startNewTask]);

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
  const runningCount = (agentTasks ?? []).filter((x) => LIVE_STATES.has(x.state)).length;

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

  // 切任务即复位：避免上一个任务的用量残留到新任务（轮询数据到达前短暂空窗，正确优于误导）
  useEffect(() => { setStats(null); }, [selectedTask]);
  useEffect(() => {
    if (!selectedTask) return;
    let cancelled = false;
    const pull = () => {
      void call<AgentContextStatsDTO | null>("agent.context.stats", { taskId: selectedTask })
        .then((s) => { if (!cancelled) setStats(s); })
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
      "agent.task.history", { taskId: selectedTask, limit: 100 },
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
    const el = timelineRef.current;
    setLoadingOlder(true);
    // 记录加载前的位置，加载完成后按新增高度补偿 scrollTop，视角停在原来那条消息上
    const prevScrollHeight = el?.scrollHeight ?? 0;
    const prevScrollTop = el?.scrollTop ?? 0;
    try {
      const h = await call<{ events: { ts: string; actor: "human" | "agent" | "host"; kind: "text" | "event"; text?: string; event?: AgentEventDTO }[]; hasMore?: boolean }>(
        "agent.task.history", { taskId: selectedTask, before: oldestTs.current, limit: 100 },
      );
      const older = eventsToBlocks(h.events);
      if (h.events[0]?.ts) oldestTs.current = h.events[0].ts;
      setHasMoreHistory(!!h.hasMore);
      if (older.length > 0) {
        // 预置抑制位：evMap 变更后触发的自动滚底 effect 会跳过一次
        skippingAutoScroll.current = true;
        setEvMap((m) => ({ ...m, [selectedTask]: [...older, ...(m[selectedTask] ?? [])] }));
        // 下一帧 DOM 提交后补偿滚动位置
        requestAnimationFrame(() => {
          const e2 = timelineRef.current;
          if (!e2) return;
          const delta = e2.scrollHeight - prevScrollHeight;
          if (delta > 0) e2.scrollTop = prevScrollTop + delta;
        });
      }
    } catch (e) { setError((e as Error).message); } finally { setLoadingOlder(false); }
  };
  // 稳定引用：onScroll 回调通过 ref 调用 loadOlder，避免闭包依赖
  loadOlderRef.current = loadOlder;
  // 上滚加载更早时置位，抑制「回填后自动滚底」副作用（loadOlder 内已按新增高度补偿 scrollTop）
  const skippingAutoScroll = useRef(false);

  useEffect(() => {
    if (skippingAutoScroll.current) { skippingAutoScroll.current = false; return; }
    scrollTimelineToBottom();
  }, [evMap, selectedTask, scrollTimelineToBottom]);

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

  // Codex 式升级：批准当前请求并把任务切到完全访问（yolo）——安全内核（推送/高危恒拦）不受影响
  const replyFullAccess = useCallback(async (requestId: string) => {
    if (!selected) return;
    setDecided((d) => ({ ...d, [requestId]: "ok" }));
    try {
      await call("agent.perm.reply", { requestId, ok: true, remember: true });
      await call("agent.task.setMode", { taskId: selected.taskId, mode: "yolo" });
      setMode("yolo");
      await reloadAgents();
    } catch (e) { setError((e as Error).message); }
  }, [selected, reloadAgents]);

  // 授权卡键盘：↑↓/Enter/数字直选（焦点不在输入框时）
  const showFullAccess = (selected?.permissionMode ?? "default") !== "yolo";
  useEffect(() => {
    if (!pendingPerm || !selectedTask) return;
    const requestId = pendingPerm.requestId;
    const opts = permOptions(pendingPerm, showFullAccess);
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      const cur = permSel[requestId] ?? 0;
      const apply = (idx: number) => {
        const o = opts[Math.min(idx, opts.length - 1)];
        if (o.reply.fullAccess) void replyFullAccess(requestId);
        else if (o.reply.rulePrefix !== undefined && o.reply.rulePrefix !== null && o.reply.ok) replyPerm(requestId, true, true, o.reply.rulePrefix);
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
  }, [pendingPerm, selectedTask, permSel, replyPerm, replyFullAccess, showFullAccess]);

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

  if (!repo) {
    return <div className="empty-state"><div className="big">🗂</div>{t("Common_NoProjectSelected")}</div>;
  }

  const timeline = selectedTask ? evMap[selectedTask] ?? [] : [];
  const modelInfo = harnesses?.[0]?.detect;

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
          if (name === "export") {
            // D6 会话导出：主进程生成 markdown 并弹保存框
            try {
              await call<{ canceled: boolean; path?: string }>("agent.task.export", { taskId: selected.taskId });
            } catch (err) { setError((err as Error).message); }
            setInputText("");
            return;
          }
          if (builtin.template) {
            // 模板命令（review/init）：展开后走 resume/queue（同包命令语义）
            const expanded = builtin.template.replace(/\$\{input\}/g, arg);
            if (BUSY_STATES.has(selected.state)) await call("agent.task.queue", { taskId: selected.taskId, prompt: expanded });
            else await call("agent.task.resume", { taskId: selected.taskId, prompt: expanded, thinking, mode });
            setInputText("");
            return;
          }
          if (name === "compact") await call("agent.task.compact", { taskId: selected.taskId });
          else if (name === "clear") await call("agent.task.clear", { taskId: selected.taskId });
          else if (name === "cp") await call("agent.task.checkpoint", { taskId: selected.taskId, summary: arg || "手动检查点（/cp）" });
          else if (name === "diff") { setTab("diff"); setInputText(""); return; }
          else if (name === "attach") { imageInputRef.current?.click(); setInputText(""); return; }
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
              // 仅记录本地配置，不打断/唤醒 agent；下次发送消息时随 resume 生效
              setThinking(v);
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

    if (pendingImages.length > 0 && !visionOk) {
      setConfigError("当前模型档案未声明视觉（vision）能力，无法发送图片——请在 设置 → 模型档案 勾选「视觉」", "去设置", "models");
      return;
    }
    inputHistory.current = [text, ...inputHistory.current.filter((x) => x !== text)].slice(0, 20);
    historyIdx.current = -1;
    setEvMap((m) => ({ ...m, [selected.taskId]: pushCap(m[selected.taskId] ?? [], { kind: "human", text }) }));
    setInputText("");
    setSending(true);
    const attachments = attachmentsPayload;
    setPendingImages([]);
    const busy = BUSY_STATES.has(selected.state);
    try {
      if (busy) {
        // 排队轮不支持多模态注入：busy 时图片随文本提示走下轮（主进程忽略排队附件）
        if (attachments.length > 0) setError("任务运行中：图片将不随排队消息注入，请等本轮结束再发送");
        await call("agent.task.queue", { taskId: selected.taskId, prompt: text });
      } else {
        await call("agent.task.resume", { taskId: selected.taskId, prompt: text, thinking, mode, ...(attachments.length > 0 ? { attachments } : {}) });
      }
      await reloadAgents();
    } catch (e) { setError((e as Error).message); } finally { setSending(false); }
  };

  const createFromCompose = async () => {
    if (!composeText.trim() || sending) return;
    // 新任务页的斜杠命令：/attach 是纯 UI 动作可直接执行；其余命令需要具体任务上下文
    if (composeText.trim().startsWith("/")) {
      const cmd = composeText.trim().split(/\s+/)[0].slice(1);
      if (cmd === "attach") { imageInputRef.current?.click(); setComposeText(""); return; }
      setError(`命令 /${cmd} 需在具体任务的对话中使用（新任务页仅支持 /attach）`);
      return;
    }
    setSending(true);
    try {
      if (pendingImages.length > 0) {
        const chosenRef = modelId || modelProfiles.find((m) => m.isDefault)?.id;
        if (!resolveRefVision(chosenRef)) {
          setConfigError("所选模型档案未声明视觉（vision）能力，无法带图创建任务——请在 设置 → 模型档案 勾选「视觉」", "去设置", "models");
          return;
        }
      }
      const record = await call<AgentTaskDTO>("agent.task.create", {
        prompt: composeText.trim(), taskType: taskTypeId || undefined, model: modelId || undefined,
        thinking, mode,
        ...(pendingImages.length > 0 ? { attachments: attachmentsPayload } : {}),
      });
      setComposeText("");
      setPendingImages([]);
      setSelectedTask(record.taskId);
      setEvMap((m) => ({ ...m, [record.taskId]: [{ kind: "human", text: composeText.trim() }] }));
      await reloadAgents();
    } catch (e) { setError((e as Error).message); } finally { setSending(false); }
  };

  const stopTask = async (taskId: string) => {
    try { await call("agent.task.stop", { taskId }); await reloadAgents(); } catch (e) { setError((e as Error).message); }
  };

  // 任务卡右侧操作（列表极简化后仅存的两个动作）：分叉 = 复制历史到新 worktree；归档 = 从列表隐藏
  const forkTask = async (taskId: string) => {
    try {
      const forked = await call<AgentTaskDTO>("agent.task.fork", { taskId });
      await reloadAgents();
      setSelectedTask(forked.taskId);
      setTab("chat");
    } catch (e) { setError((e as Error).message); }
  };
  const archiveTask = async (taskId: string) => {
    try {
      await call("agent.task.archive", { taskId, archived: true });
      if (selectedTask === taskId) setSelectedTask(null);
      await reloadAgents();
    } catch (e) { setError((e as Error).message); }
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
    // 斜杠命令：检测 / 前缀，过滤匹配的命令
    const slashM = /(^|\s)\/([\w-]*)$/.exec(before);
    if (slashM) {
      setSlashQuery(slashM[2]);
      setSlashSel(0);
      setMention(null);
      return;
    }
    setSlashQuery(null);
    // 长前缀优先匹配（@ 与 @issue 并存时 @issue 先试）
    const providers = [...composerProviders()].sort((a, b) => b.prefix.length - a.prefix.length);
    if (providers.length === 0) { setMention(null); return; }
    const esc = providers.map((x) => x.prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const m = new RegExp(`(^|\\s)(${esc})([\\w./\\-]*)$`).exec(before);
    if (!m) { setMention(null); return; }
    const prefix = m[2];
    const query = m[3];
    setMention({ start: caret - query.length, prefix, query });
    setMentionSel(0);
    const provider = providers.find((x) => x.prefix === prefix);
    if (!provider) { setMentionItems([]); return; }
    void Promise.resolve(provider.source(query).catch(() => []))
      .then((items) => {
        // D7 @任务：本仓库其他任务混入补全（insert 短 id，宿主 resume/queue 解析展开）
        if (prefix !== "@") { setMentionItems(items.slice(0, 50)); return; }
        const q = query.toLowerCase();
        const taskItems = (agentTasks ?? [])
          .filter((t) => t.taskId !== selected?.taskId)
          .filter((t) => !q || t.title.toLowerCase().includes(q) || t.taskId.startsWith(query))
          .slice(0, 6)
          .map((t) => ({ label: `任务：${t.title}`, insert: t.taskId.slice(0, 8) }));
        setMentionItems([...taskItems, ...items].slice(0, 50));
      });
  };
  const insertMention = (insert: string, setter: (v: string) => void, current: string) => {
    if (!mention) return;
    const next = current.slice(0, mention.start) + insert + " " + current.slice(mention.start + mention.query.length);
    setter(next);
    setMention(null);
  };

  // 斜杠命令插入：替换光标前的 /query 片段并收起弹出层
  const pickSlash = (insert: string, setText: (v: string) => void, current: string) => {
    const el = document.activeElement as HTMLTextAreaElement | null;
    const caret = el?.selectionStart ?? current.length;
    const before = current.slice(0, caret);
    const m = /(^|\s)\/[\w-]*$/.exec(before);
    setText(m ? current.slice(0, caret - m[0].length + m[1].length) + (insert || "") + " " : current);
    setSlashQuery(null);
  };
  // 弹出层（斜杠命令 / @提及）打开时接管方向键与 Enter：上下选择、Enter 确认、Esc 关闭，不移动输入框光标
  const navKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, text: string, setText: (v: string) => void): boolean => {
    const matches = slashQuery !== null
      ? slashItems.filter((s) => s.name.toLowerCase().includes(slashQuery.toLowerCase())).slice(0, 8)
      : [];
    if (matches.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSlashSel((s) => (s + 1) % matches.length); return true; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSlashSel((s) => (s - 1 + matches.length) % matches.length); return true; }
      if (e.key === "Enter") { e.preventDefault(); pickSlash(matches[Math.min(slashSel, matches.length - 1)].insert, setText, text); return true; }
      if (e.key === "Escape") { e.stopPropagation(); setSlashQuery(null); return true; }
    } else if (mention && mentionItems.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionSel((s) => (s + 1) % mentionItems.length); return true; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMentionSel((s) => (s - 1 + mentionItems.length) % mentionItems.length); return true; }
      if (e.key === "Enter") { e.preventDefault(); insertMention(mentionItems[Math.min(mentionSel, mentionItems.length - 1)].insert, setText, text); return true; }
      if (e.key === "Escape") { e.stopPropagation(); setMention(null); return true; }
    }
    return false;
  };

  // 聊天/新任务 composer 共用键盘处理：Enter 发送，Shift+Enter 换行，Shift+Tab 切模式
  const chatKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (navKeyDown(e, inputText, setInputText)) return;
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendInput(); return; }
    if (e.key === "Tab" && e.shiftKey) { e.preventDefault(); setMode((m) => MODE_ORDER[(MODE_ORDER.indexOf(m) + 1) % MODE_ORDER.length]); return; }
  };
  const composeKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (navKeyDown(e, composeText, setComposeText)) return;
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void createFromCompose(); return; }
    if (e.key === "Tab" && e.shiftKey) { e.preventDefault(); setMode((m) => MODE_ORDER[(MODE_ORDER.indexOf(m) + 1) % MODE_ORDER.length]); return; }
  };

  // 可选模型两级化：一级供应商（用户分组/包档案），二级组内具体模型（与设置页 models.list 同源）
  const fmtCtx = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
  const modelGroups: ModelGroupVM[] = (modelProfiles ?? []).filter((m) => m.configured).map((m) => ({
    id: m.id,
    name: m.name,
    hint: m.isDefault ? "默认" : m.source === "package" ? "包" : undefined,
    members: (m.groupModels && m.groupModels.length > 1)
      ? m.groupModels.map((g, i) => ({
          // 首成员复用分组 id（与后端约定一致），其余 `<分组id>#<模型id>`
          id: i === 0 ? m.id : `${m.groupId}#${g.modelId}`,
          name: g.modelId,
          sub: [g.vision ? "视觉" : null, g.contextTokens ? `${fmtCtx(g.contextTokens)} ctx` : null].filter(Boolean).join(" · ") || undefined,
        }))
      : [{ id: m.id, name: m.modelId }],
  }));

  // 斜杠命令：内置 / 唤起 + 已安装包注册的命令
  // 补全列表与分发表同一数据源（§20.3.8）：BUILTIN_SLASH + 包命令，避免两表漂移
  const slashItems = (() => {
    const list: { name: string; hint: string; insert: string }[] = BUILTIN_SLASH.map((c) => ({ name: `/${c.name}`, hint: c.hint, insert: `/${c.name}` }));
    for (const c of pkgCommands) list.push({ name: `/${c.name}`, hint: c.packageId, insert: `/${c.name}` });
    return list;
  })();

  // 时间线块渲染（§20.3.7）：裁决面交互卡（授权/提问/计划）硬接线不开放替换；
  // 其余展示块经 agentUIRegistry 解析——用户包 > 内置包 > 宿主缺省，工具精确 > 前缀 > blockKind。
  const renderBlock = (b: Block, key: string | number): ReactNode => {
    switch (b.kind) {
      case "permission":
        return <PermissionCard key={key} b={b} decided={decided[b.requestId]} sel={permSel[b.requestId] ?? 0} showFullAccess={showFullAccess} onSel={(id, i) => setPermSel((m) => ({ ...m, [id]: i }))} onReply={replyPerm} onFullAccess={(id) => void replyFullAccess(id)} />;
      case "question":
        return <QuestionCard key={key} b={b} decided={decided[b.requestId]} onAnswer={replyAnswer} />;
      case "plan":
        return <PlanCard key={key} b={b} decided={decided[b.requestId]} onPlan={replyPlan} />;
      case "todo":
        // todo 清单以右上角悬浮态展示，不占用时间线版面
        return null;
      default:
        break;
    }
    const renderer = resolveTimelineRenderer(b.kind === "tool" ? b.name : undefined, b.kind);
    if (!renderer) return null;
    const ctx: TimelineCardCtx = {
      taskId: selectedTask ?? "",
      viewFile: (path) => { setPendingFile(path); setTab("diff"); },
      previewFile,
      contextPct: stats ? `${Math.round(stats.ratio * 100)}%` : undefined,
      renderChildren: (children) => <Fragment>{(children as Block[]).map((c, i) => renderBlock(c, `${key}-${i}`))}</Fragment>,
    };
    return <Fragment key={key}>{renderer.render({ block: b, taskId: ctx.taskId ?? "", ctx })}</Fragment>;
  };

  // 任务列表极简卡：状态点 + 标题一行；操作收敛为右侧 分叉/归档 图标按钮（运行中禁用）
  const agentCard = (task: AgentTaskDTO) => {
    const live = LIVE_STATES.has(task.state);
    const selectedNow = selectedTask === task.taskId;
    const dotColor = task.state === "failed" ? "var(--c-red)" : task.state === "completed" || task.state === "stopped" ? "var(--c-text3)" : task.permissionMode === "plan" ? "var(--c-chip-purple-fg, #b490ff)" : "var(--c-green)";
    const working = task.state === "working" || task.state === "starting";
    return (
      <div key={task.taskId} onClick={() => { setSelectedTask(selectedNow ? null : task.taskId); setTab("chat"); setThinking(task.thinking ?? "medium"); setMode(task.permissionMode ?? "default"); }}
        title={`${task.title}\n${stateChip(task.state).label} · ${task.branch}`}
        style={{ border: `1px solid ${selectedNow ? "var(--c-text)" : "var(--c-border)"}`, borderRadius: 10, padding: "6px 6px 6px 11px", cursor: "pointer", background: "var(--c-panel)", display: "flex", alignItems: "center", gap: 8, minHeight: 34 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, flex: "none", opacity: working ? 1 : 0.85 }} />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, fontWeight: 600 }}>{task.title}</span>
        <button className="icon-btn" title={live ? "运行中不可分叉，请先停止" : "分叉任务（复制对话历史到新分支）"} disabled={live}
          onClick={(e) => { e.stopPropagation(); void forkTask(task.taskId); }}>
          <TlIcon name="fork" size={14} />
        </button>
        <button className="icon-btn" title={live ? "运行中不可归档，请先停止" : "归档任务（从列表隐藏，可恢复）"} disabled={live}
          onClick={(e) => { e.stopPropagation(); void archiveTask(task.taskId); }}>
          <TlIcon name="archive" size={14} />
        </button>
      </div>
    );
  };

  const busy = selected ? BUSY_STATES.has(selected.state) : false;
  // D1 vision 门控：当前生效档案（任务绑定 → 默认★）按实际选中成员判定
  const activeProfile = resolveRefProfile(selected?.modelRef) ?? modelProfiles.find((m) => m.isDefault) ?? modelProfiles[0];
  const visionOk = resolveRefVision(selected?.modelRef ?? activeProfile?.id);
  const attachmentsPayload = pendingImages.map((img) => ({ name: img.name, dataBase64: img.dataUrl }));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px minmax(0, 1fr)", flex: 1, minHeight: 0, height: "100%" }}>
      {/* 图片附加：粘贴/拖拽之外提供点击入口（视觉能力门控在选择时校验） */}
      <input ref={imageInputRef} type="file" accept="image/*" multiple style={{ display: "none" }}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length === 0) return;
          if (!visionOk) { setConfigError("当前模型档案未声明视觉（vision）能力，无法附加图片——请在 设置 → 模型档案 勾选「视觉」", "去设置", "models"); return; }
          filesToImages(files);
        }}
      />
      {preview && (
        <Modal title={`预览：${preview.path}`} confirmText="关闭" onConfirm={() => setPreview(null)} onClose={() => setPreview(null)}>
          <div style={{ fontSize: 11, color: "var(--c-text3)", marginBottom: 6 }}>
            {previewLoading ? "加载中…" : `${preview.binary ? "二进制文件" : `${(preview.size / 1024).toFixed(1)} KB`}${preview.truncated ? " · 已截断（前 64KB）" : ""}`}
          </div>
          <pre style={{ maxHeight: 420, overflow: "auto", background: "var(--c-panel2)", border: "1px solid var(--c-border)", borderRadius: 8, padding: "8px 10px", fontSize: 11.5, fontFamily: "var(--mono, monospace)", whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>{preview.content}</pre>
        </Modal>
      )}
      {/* 错误提示以浮层显示在对话页顶部状态条下方（见时间线容器内）：
          grid 根元素的直接子元素会抢占 300px 侧栏列把排版挤乱，侧栏内联则常驻占一行 */}

      {/* ═══ 左：会话列表（任务卡）═══ */}
      <div style={{ borderRight: "1px solid var(--c-border)", display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 }}>
        <button className="new-task-btn" style={{ margin: "10px 10px 6px", width: "calc(100% - 20px)" }} onClick={startNewTask}>
          ＋ 新任务（描述目标，Ctrl+N）
        </button>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 10px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
          {(agentTasks?.length ?? 0) === 0 && (
            <div style={{ fontSize: 12, color: "var(--c-text3)", padding: "4px 2px" }}>{t("Agents_EmptyHint")}</div>
          )}
          {agentTasks?.map(agentCard)}
        </div>
      </div>

      {/* ═══ 右：详情（页签 = 全局导航；三页互斥独立）═══ */}
      {/* minWidth: 0 = grid item 自动最小尺寸回收：对话内容的 min-content 宽度不再把 1fr 轨道撑破窗口 */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 2, padding: "6px 14px 0", borderBottom: "1px solid var(--c-border)" }}>
          {([["chat", "对话"], ["diff", `改动${diffCount ? ` ${diffCount}` : ""}`], ["cp", `检查点${cpCount ? ` ${cpCount}` : ""}`]] as const).map(([id, label]) => (
            <div key={id} onClick={() => setTab(id)}
              style={{ padding: "5px 14px", fontSize: 12.5, color: tab === id ? "var(--c-text)" : "var(--c-text3)", cursor: "pointer", border: `1px solid ${tab === id ? "var(--c-border)" : "transparent"}`, borderBottom: "none", borderRadius: "8px 8px 0 0" }}>
              {label}
            </div>
          ))}
        </div>

        {/* ═══ 对话页（保持挂载：切改动/检查点不重新加载历史、不丢滚动位置） ═══ */}
        {selected && (
          <div style={{ flex: 1, minHeight: 0, display: tab === "chat" ? "flex" : "none", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 14px", borderBottom: "1px solid var(--c-border)", flexWrap: "wrap", color: "var(--c-text3)", fontSize: 11, fontFamily: "var(--mono, monospace)" }}>
              <span style={{ fontSize: 11.5, padding: "1px 10px", borderRadius: 999, border: `1px solid ${stateChip(selected.state).color}`, color: stateChip(selected.state).color }}>
                {stateChip(selected.state).label}{busy && selected.lastActiveAt ? " · " + Math.max(0, Math.round((Date.now() - new Date(selected.lastActiveAt).getTime()) / 1000)) + "s" : ""}
              </span>
              <span style={{ fontSize: 11.5 }}>{selected.branch}</span>
              {runningTool ? (
                <span style={{ color: "var(--c-amber)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <TlIcon name={toolIconName(runningTool.name)} size={11} className="tl-pulse" />
                  {(TOOL_LABELS[runningTool.name] ?? runningTool.name)} {((Date.now() - runningTool.startTs) / 1000).toFixed(1)}s
                </span>
              ) : null}
              {(selected.queued?.length ?? 0) > 0 ? <span style={{ color: "var(--c-amber)", display: "inline-flex", alignItems: "center", gap: 5 }}><TlIcon name="clock" size={11} />排队 {selected.queued!.length}</span> : null}
              <span>子代理 {runningSubs}/{maxSubagents}</span>
              <span style={{ flex: 1 }} />
              <span>Esc 中断 · Esc×2 回滚 · Shift+Tab 模式 · ↑↓ 历史</span>
              <button className="tool-btn icon" data-tip="在新窗口打开 worktree" onClick={() => void call("app.newWindow", { path: selected.worktreePath })}>
                <TlIcon name="external" size={14} />
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0, minWidth: 0, position: "relative" }}>
              {/* 错误浮层：悬于时间线之上、顶部状态条正下方；不打断版面流 */}
              {error && <ErrorFloat text={error} maxWidth="calc(100% - 292px)" go={errorGo} onGo={(s) => { openSettings(s); setError(null); }} onClose={() => setError(null)} />}
              <div ref={timelineRef} style={{ height: "100%", overflowY: "auto", overflowX: "hidden" }}
                onScroll={onTimelineScroll}
                onDoubleClick={(e) => {
                  const pre = (e.target as HTMLElement).closest("pre");
                  if (pre) void navigator.clipboard?.writeText(pre.textContent ?? "");
                }}>
              <div style={{ maxWidth: 880, margin: "0 auto", padding: "18px 20px 26px", display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
                {loadingOlder && (
                  <div style={{ textAlign: "center", color: "var(--c-text3)", fontSize: 11 }}>
                    <span className="tl-pulse">加载中…</span>
                  </div>
                )}
                {hasMoreHistory && !loadingOlder && (
                  <div style={{ textAlign: "center", color: "var(--c-text3)", fontSize: 11, opacity: .6 }}>↑ 上滚加载更早</div>
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
              {/* 悬浮任务清单：从时间线提取最新 todo 块，固定右上，实时刷新状态 */}
              {(() => {
                const todoBlock = [...timeline].reverse().find((b) => b.kind === "todo");
                if (!todoBlock) return null;
                return (
                  <div
                    style={{
                      position: "absolute", top: 8, right: 8, width: 260, maxWidth: "calc(100% - 16px)",
                      background: "var(--c-panel2)", border: "1px solid var(--c-border-strong)",
                      borderRadius: 10, boxShadow: "0 2px 8px rgba(0,0,0,.22)", zIndex: 10,
                      overflow: "hidden",
                    }}
                  >
                    <TodoList todos={(todoBlock as Extract<Block, { kind: "todo" }>).todos} />
                  </div>
                );
              })()}
              {awayFromBottom && (
                <button
                  className="tool-btn icon"
                  data-tip="返回底部"
                  aria-label="返回底部"
                  style={{
                    position: "absolute", left: "50%", bottom: 10, transform: "translateX(-50%)",
                    width: 28, height: 28, padding: 0, borderRadius: 999,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "var(--c-panel2)", border: "1px solid var(--c-border-strong)",
                    color: "var(--c-text2)", boxShadow: "0 2px 8px rgba(0,0,0,.22)",
                  }}
                  onClick={() => scrollTimelineToBottom(false)}
                >
                  <TlIcon name="chevron-down" size={14} />
                </button>
              )}
            </div>
            <div style={{ borderTop: "1px solid var(--c-border)", padding: "8px 20px 8px" }}>
              <div style={{ maxWidth: 880, margin: "0 auto", position: "relative" }}>
                {pendingPerm && (
                  <div style={{ marginBottom: 8, fontSize: 11.5, color: "var(--c-amber)", display: "flex", alignItems: "center", gap: 6 }}>
                    <TlIcon name="shield" size={12} className="tl-pulse" />
                    <span>等待授权（↑↓+Enter 或数字直选上方卡片选项）</span>
                  </div>
                )}
                {pendingImages.length > 0 && (
                  <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                    {pendingImages.map((img, i) => (
                      <div key={`${img.name}:${i}`} style={{ position: "relative" }}>
                        <img src={img.dataUrl} alt={img.name} style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, border: "1px solid var(--c-border)" }} />
                        <button className="tool-btn" title="移除" style={{ position: "absolute", top: -6, right: -6, padding: "0 5px", fontSize: 10 }}
                          onClick={() => setPendingImages((cur) => cur.filter((_, j) => j !== i))}>✕</button>
                      </div>
                    ))}
                    <span className="hint" style={{ alignSelf: "center" }}>图片 {pendingImages.length}/4{!visionOk ? " · ⚠ 当前模型未声明视觉能力" : ""}</span>
                  </div>
                )}
                <Composer
                  ref={inputRef}
                  value={inputText}
                  onChange={(v) => onComposeChange(v, setInputText)}
                  maxH={240}
                  placeholder={busy
                    ? "agent 正在工作——输入将排队，本轮结束后自动注入（Esc 中断 / Esc×2 回滚）"
                    : "继续对话…输入 / 唤起命令、@ 唤起文件、Shift+Tab 切模式"}
                  busy={busy}
                  sending={sending}
                  canSend={!!inputText.trim()}
                  sendTitle={busy ? "停止（Esc 同效）" : "发送（Enter）"}
                  onStop={() => void stopTask(selected.taskId)}
                  onSend={() => void sendInput()}
                  mode={selected.permissionMode ?? "default"}
                  modeLabel={MODE_META[selected.permissionMode ?? "default"].label.replace(/^[●◆◇⚡]\s*/, "")}
                  onMode={(m) => void setTaskMode(selected.taskId, m).then(() => setMode(m))}
                  groups={modelGroups}
                  model={selected.modelRef ?? ""}
                  modelDisabled={busy && selected.state !== "awaiting-input"}
                  onModel={(id) => void (async () => {
                    try {
                      await call("agent.task.setModel", { taskId: selected.taskId, model: id });
                      await reloadAgents();
                      // 切换模型带入新模型的默认思考深度（后续消息生效）
                      setThinking(resolveRefThinking(id));
                    } catch (err) { setError((err as Error).message); }
                  })()}
                  thinking={thinking}
                  onThinking={(v) => { setThinking(v); }}
                  stats={stats}
                  attachments={pendingImages.map((img, i) => ({ name: img.name, dataUrl: img.dataUrl, onRemove: () => setPendingImages((cur) => cur.filter((_, j) => j !== i)) }))}
                  attachmentHint={`图片 ${pendingImages.length}/4${!visionOk ? " · ⚠ 当前模型未声明视觉能力" : ""}`}
                  onAttachImage={() => imageInputRef.current?.click()}
                  slash={slashItems}
                  onPickSlash={(insert) => { setInputText((cur) => (cur ? `${cur} ${insert}` : insert)); setTimeout(() => inputRef.current?.focus(), 0); }}
                  onKeyDown={chatKeyDown}
                  children={<>
                    {mention ? <MentionPopover mention={mention} items={mentionItems} selectedIndex={mentionSel} onSelect={setMentionSel} onPick={(x) => insertMention(x, setInputText, inputText)} /> : null}
                    {slashQuery !== null && <SlashPopover open items={slashItems.filter((s) => s.name.toLowerCase().includes(slashQuery.toLowerCase())).slice(0, 8)} selectedIndex={slashSel} onSelect={setSlashSel} onPick={(insert) => pickSlash(insert, setInputText, inputText)} />}
                  </>}
                />
              </div>
            </div>
          </div>
        )}

        {/* ═══ 对话页：未选中任务 = 新任务 composer ═══ */}
        {tab === "chat" && !selected && (
          <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", position: "relative" }}>
            {error && <ErrorFloat text={error} maxWidth="min(680px, 92%)" go={errorGo} onGo={(s) => { openSettings(s); setError(null); }} onClose={() => setError(null)} />}
            <div style={{ width: 680, maxWidth: "90%" }}>
              {modelInfo && !modelInfo.available ? (
                <button className="tool-btn" style={{ color: "var(--c-amber)", borderColor: "var(--c-amber)", marginBottom: 10 }} onClick={() => openSettings("models")}>
                  ● {t("Agents_ModelMissing")} → {t("Agents_OpenSettings")}
                </button>
              ) : null}
              <Composer
                ref={composeRef}
                value={composeText}
                onChange={(v) => onComposeChange(v, setComposeText)}
                maxH={208}
                minH={42}
                autoFocus
                placeholder={`${t("Agents_ComposePlaceholder")}\n支持 @文件 提及；规划类任务先切「◇ 规划」模式（Shift+Tab）`}
                busy={false}
                sending={sending}
                canSend={!!composeText.trim()}
                sendTitle="创建任务（Enter）"
                onStop={() => {}}
                onSend={() => void createFromCompose()}
                mode={mode}
                modeLabel={MODE_META[mode].label.replace(/^[●◆◇⚡]\s*/, "")}
                onMode={setMode}
                groups={modelGroups}
                model={modelId || (modelProfiles.find((m) => m.isDefault)?.id ?? "")}
                onModel={setModelId}
                thinking={thinking}
                onThinking={setThinking}
                stats={null}
                attachments={pendingImages.map((img, i) => ({ name: img.name, dataUrl: img.dataUrl, onRemove: () => setPendingImages((cur) => cur.filter((_, j) => j !== i)) }))}
                attachmentHint={`图片 ${pendingImages.length}/4（随首条消息发送）`}
                onAttachImage={() => imageInputRef.current?.click()}
                slash={slashItems}
                onPickSlash={(insert) => { setComposeText((cur) => (cur ? `${cur} ${insert}` : insert)); setTimeout(() => composeRef.current?.focus(), 0); }}
                onKeyDown={composeKeyDown}
                children={<>
                  {mention ? <MentionPopover mention={mention} items={mentionItems} selectedIndex={mentionSel} onSelect={setMentionSel} onPick={(x) => insertMention(x, setComposeText, composeText)} /> : null}
                  {slashQuery !== null && <SlashPopover open items={slashItems.filter((s) => s.name.toLowerCase().includes(slashQuery.toLowerCase())).slice(0, 8)} selectedIndex={slashSel} onSelect={setSlashSel} onPick={(insert) => pickSlash(insert, setComposeText, composeText)} />}
                </>}
              />
              <div style={{ color: "var(--c-text3)", fontSize: 11, marginTop: 6 }}>
                Enter 发送 · Shift+Enter 换行 · {t("Agents_TargetHint")} · 规划模式：先调研出计划，批准后自动执行
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
