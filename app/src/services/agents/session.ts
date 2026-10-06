import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { ModelMessage } from "ai";
import type { PackageStore } from "../extensions/store";
import type { SettingsStore } from "../settings";
import { createTaskWorktree, listWorktrees } from "../worktrees";
import { commitCheckpoint, headSha } from "./checkpoint";
import { buildToolset } from "./tools";
import { composeFeedbackPrompt, composeSystemPrompt, collectRepoContext } from "./prompts";
import type { AgentHarnessDTO, AgentSessionEvent, AgentTaskRecord, ThinkingLevel } from "./types";
import { runLoop } from "./loop";
import { resolveTaskType, type CompiledTaskType } from "./taskTypes";
import { deleteSessionFile, findTask, loadAgentTasks, loadSessionFile, saveAgentTasks, saveSessionFile, upsertTask, markInterrupted, type AgentTaskFile, type SessionJournalEntry, type SessionActor } from "./tasks";

/**
 * AgentSessionManager（agent-harness.md v3.0 + task-model-modules.md §三/§四）：
 * Gitter 自有 agent 运行时的会话编排。窗口域（与 TerminalManager 同模式）。
 * 任务卡三元组 = worktree + Gitter agent 会话 + 会话基线。
 * v3.1 增量（task-model-modules.md）：模型档案链（任务绑定 → 任务型缺省 → 全局，徽标切换下一轮生效）、
 * 任务型（工具裁剪 + 权限收紧 + promptTemplate/systemAddendum）、fork/归档/删除、用量记账。
 * 安全边界：git 写工具经授权卡（收紧后分级）/ commit 内置安全网 / 托管 checkpoint 唯一免卡写。
 */

export interface AgentSessionDeps {
  repoOf: () => string | null;
  store: PackageStore;
  settings: SettingsStore;
  /** 模型档案链解析（bridge 组装：档案 ref → 解密 → LanguageModel；null = 走全局缺省链） */
  resolveModel: (profileRef: string | null, thinking?: "off" | "low" | "medium" | "high") => { ok: true; model: import("ai").LanguageModel; profileRef: string } | { ok: false; error: string };
  /** 用量记账（按档案累计，task-model-modules.md §2.3） */
  addUsage: (profileRef: string, usage: { input?: number; output?: number } | null) => void;
  /** 经 preload bridge 推渲染层（evt 通道） */
  send: (method: string, params: unknown) => void;
}

interface LiveSession {
  record: AgentTaskRecord;
  worktreePath: string;
  messages: ModelMessage[];
  taskType: CompiledTaskType;
  abort: AbortController | null;
  /** 授权回执：requestId → resolve(ok, remember)。回调留宿主，渲染层只拿 requestId。 */
  perms: Map<string, (ok: boolean, remember: boolean) => void>;
  /** Session 级已记住的授权（工具名；仅对生效分级为 session 的工具有效） */
  approved: Set<string>;
  /** 事件日志（任务历史的时间线持久化源；上限 500 条） */
  journal: SessionJournalEntry[];
}

const BUILTIN_HARNESS_ID = "builtin/gitter-agent";
const NON_TERMINAL: AgentTaskRecord["state"][] = ["starting", "working", "awaiting-input", "awaiting-permission"];

/**
 * 任务名派生：ASCII 标题 → 连字符 slug（保留大小写，30 字符截断）；纯非 ASCII 回退 task-MMDD-HHMM。
 */
export function deriveSlug(title: string, date: Date = new Date()): string {
  const ascii = title.replace(/\.[a-z0-9]+$/i, "").replace(/[^A-Za-z0-9]+/g, " ").trim();
  let slug = ascii ? ascii.split(/\s+/).join("-") : "";
  if (slug.length > 30) slug = slug.slice(0, 30);
  if (!slug) {
    const pad = (n: number) => String(n).padStart(2, "0");
    slug = `task-${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  }
  return slug;
}

/** 分支去重：task/<slug> 已存在 → 追加 -2/-3…（对齐 TasksPage 既有 task/ 前缀约定）。 */
export function dedupeSlug(slug: string, existingBranches: ReadonlySet<string>): string {
  if (!existingBranches.has(`task/${slug}`)) return slug;
  let n = 2;
  while (existingBranches.has(`task/${slug}-${n}`)) n++;
  return `${slug}-${n}`;
}

/**
 * A4 验收台直投：挑选修复轮目标任务。
 * 忙态（starting/working/awaiting-permission）与归档任务不参与；
 * 优先级 awaiting-input > interrupted > stopped > completed > failed，同级取最近活跃。
 */
export function pickRepairTarget(tasks: AgentTaskRecord[]): AgentTaskRecord | null {
  const priority: Partial<Record<AgentTaskRecord["state"], number>> = {
    "awaiting-input": 0, interrupted: 1, stopped: 2, completed: 3, failed: 4,
  };
  return (
    tasks
      .filter((t) => !t.archived && priority[t.state] !== undefined)
      .sort(
        (a, b) =>
          priority[a.state]! - priority[b.state]! ||
          (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? ""),
      )[0] ?? null
  );
}

export class AgentSessionManager {
  private live = new Map<string, LiveSession>();
  private manualStop = new Set<string>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: AgentSessionDeps) {}

  dispose(): void {
    // 先冲刷历史（消息 + 事件日志）再终止——重启后时间线可完整回放
    const repo = this.repoOrNull();
    if (repo) {
      for (const s of this.live.values()) {
        try {
          saveSessionFile(repo, { version: 1, taskId: s.record.taskId, messages: s.messages, events: s.journal });
        } catch {
          /* 冲刷失败不阻断退出 */
        }
      }
    }
    if (this.deps.settings.current.agentsOnExit !== "keep") {
      for (const s of this.live.values()) s.abort?.abort();
    }
  }

  // ---- 查询 ----

  async listHarnesses(): Promise<AgentHarnessDTO[]> {
    const det = this.modelAvailability(null);
    return [
      {
        fullId: BUILTIN_HARNESS_ID,
        packageId: "builtin",
        packageName: "Gitter",
        harnessId: "gitter-agent",
        displayName: "Gitter Agent（内置）",
        transport: "internal",
        fallback: null,
        capabilities: ["structured-events", "checkpoints", "feedback-channel", "resume", "prompt-submission", "file-watch"],
        submissionMode: "streaming",
        identity: { assistedBy: "gitter-agent" },
        detect: det,
        error: null,
      },
    ];
  }

  listTasks(args?: { includeArchived?: boolean }): AgentTaskRecord[] {
    const repo = this.repoOrNull();
    if (!repo) return [];
    const file = loadAgentTasks(repo);
    const liveIds = new Set([...this.live.values()].filter((l) => l.abort).map((l) => l.record.taskId));
    if (markInterrupted(file, liveIds) > 0) saveAgentTasks(repo, file);
    return file.tasks
      .filter((t) => args?.includeArchived || !t.archived)
      .map((t) => {
        const l = this.live.get(t.taskId);
        return l ? { ...t, state: l.record.state, lastMessage: l.record.lastMessage, lastActiveAt: l.record.lastActiveAt } : t;
      });
  }

  replyPermission(args: { requestId: string; ok: boolean; remember?: boolean }): { ok: boolean } {
    for (const s of this.live.values()) {
      const resolve = s.perms.get(args.requestId);
      if (resolve) {
        s.perms.delete(args.requestId);
        resolve(!!args.ok, !!args.remember);
        if (s.record.state === "awaiting-permission") s.record.state = "working";
        this.scheduleSave();
        return { ok: true };
      }
    }
    return { ok: false };
  }

  // ---- 任务生命周期 ----

  async createTask(args: { harness?: string; name?: string; prompt: string; taskType?: string; model?: string; thinking?: ThinkingLevel }): Promise<AgentTaskRecord> {
    const repo = this.needRepo();
    if (args.harness && args.harness !== BUILTIN_HARNESS_ID) {
      throw new Error(`未知 agent：${args.harness}（当前版本仅内置 Gitter Agent）`);
    }
    const tt = resolveTaskType(this.deps.store, args.taskType);
    if (tt.error) throw new Error(tt.error);
    if (!args.prompt.trim()) throw new Error("任务描述不能为空");
    const name = args.name?.trim() || args.prompt.trim().split(/\r?\n/)[0]?.slice(0, 40) || "task";

    // 模型链先于 worktree 创建校验（task-model-modules.md §2.2：任务绑定 → 任务型缺省 → 全局）
    const preferred = args.model ?? tt.spec.defaultModelRef ?? null;
    const rr = this.deps.resolveModel(preferred, args.thinking);
    if (!rr.ok) throw new Error(rr.error);

    const title = args.prompt.trim().split(/\r?\n/)[0]?.slice(0, 60) || name;
    let slug = args.name?.trim() || deriveSlug(title);
    const existing = new Set((await listWorktrees(repo)).map((w) => w.branch));
    slug = dedupeSlug(slug, existing);

    const wt = await createTaskWorktree(repo, slug);
    const baseline = (await headSha(wt.path)) ?? "";
    const record: AgentTaskRecord = {
      taskId: randomUUID(),
      title: args.prompt.trim().split(/\r?\n/)[0]?.slice(0, 60) || name,
      harnessFullId: BUILTIN_HARNESS_ID,
      worktreePath: wt.path,
      branch: wt.branch,
      externalSessionId: null,
      baselineSha: baseline,
      state: "starting",
      exitCode: null,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      lastMessage: null,
      modelRef: rr.profileRef,
      taskType: tt.spec.fullId,
      thinking: args.thinking ?? "medium",
      archived: false,
    };
    this.putRecord(record);
    const input = tt.spec.promptTemplate.replace("{input}", args.prompt.trim());
    const messages: ModelMessage[] = [{ role: "user", content: input }];
    this.persistMessages(record.taskId, messages);
    void this.startTurn(record, wt.path, messages, tt.spec, `任务下发：${title}`);
    return record;
  }

  /** 续跑：历史重放 + 追加输入。modelRef 已在记录上（徽标切换下一轮生效）。 */
  async resumeTask(args: { taskId: string; prompt: string; thinking?: ThinkingLevel }): Promise<AgentTaskRecord> {
    const repo = this.needRepo();
    if (!args.prompt.trim()) throw new Error("输入不能为空");
    if (this.isRunning(args.taskId)) throw new Error("会话仍在运行，请等待当前轮次结束");
    const file = loadAgentTasks(repo);
    const record = findTask(file, args.taskId);
    if (!record) throw new Error("任务不存在");
    const tt = resolveTaskType(this.deps.store, record.taskType);
    const messages = this.loadMessages(repo, record.taskId);
    messages.push({ role: "user", content: args.prompt.trim() });
    this.persistMessages(record.taskId, messages);
    record.state = "starting";
    record.archived = false;
    record.lastActiveAt = new Date().toISOString();
    if (args.thinking) record.thinking = args.thinking;
    this.putRecord(record);
    const humanNote = `追加输入：${args.prompt.trim().split(/\r?\n/)[0]?.slice(0, 60)}`;
    void this.startTurn(record, record.worktreePath, messages, tt.spec, humanNote);
    return record;
  }

  async resumeLast(prompt: string): Promise<AgentTaskRecord> {
    const repo = this.needRepo();
    const file = loadAgentTasks(repo);
    const candidate = file.tasks
      .filter((t) => !NON_TERMINAL.includes(t.state) && !t.archived)
      .sort((a, b) => (b.lastActiveAt ?? b.createdAt).localeCompare(a.lastActiveAt ?? a.createdAt))[0];
    if (!candidate) throw new Error("没有可续跑的任务");
    return this.resumeTask({ taskId: candidate.taskId, prompt });
  }

  /** 退回重做直投（验收台 rejected + 反馈 → 注入同会话）。 */
  async sendFeedback(args: { taskId: string; feedback: string }): Promise<AgentTaskRecord> {
    return this.resumeTask({
      taskId: args.taskId,
      prompt: [
        "人工审查者对上一轮改动的反馈如下，请只处理这些条目，不要扩大改动范围：",
        args.feedback.trim(),
      ].join("\n"),
    });
  }

  stopTask(args: { taskId: string }): AgentTaskRecord | null {
    const live = this.live.get(args.taskId);
    if (!live?.abort) return null;
    this.manualStop.add(args.taskId);
    this.journalHuman(live.record, "停止请求");
    live.abort.abort();
    return live.record;
  }

  /** 模型徽标切换（下一轮生效；task-model-modules.md §2.2）。 */
  setModel(args: { taskId: string; model: string }): AgentTaskRecord | null {
    const rr = this.deps.resolveModel(args.model);
    if (!rr.ok || rr.profileRef !== args.model) {
      throw new Error(`模型档案不可用：${args.model}${rr.ok ? "" : `（${rr.error}）`}`);
    }
    const repo = this.repoOrNull();
    if (!repo) throw new Error("没有打开的仓库");
    const live = this.live.get(args.taskId);
    const file = loadAgentTasks(repo);
    const record = live?.record ?? findTask(file, args.taskId);
    if (!record) throw new Error("任务不存在");
    record.modelRef = args.model;
    upsertTask(file, record);
    saveAgentTasks(repo, file);
    this.scheduleSave();
    return record;
  }

  /** fork：复制消息历史派生新任务（可换模型），原任务不动；新任务处于待输入态。 */
  fork(args: { taskId: string; model?: string }): AgentTaskRecord {
    const repo = this.needRepo();
    if (this.isRunning(args.taskId)) throw new Error("源任务正在运行，请先停止再分叉");
    const file = loadAgentTasks(repo);
    const source = findTask(file, args.taskId);
    if (!source) throw new Error("任务不存在");
    const modelRef = args.model ?? source.modelRef;
    if (modelRef) {
      const rr = this.deps.resolveModel(modelRef, source.thinking);
      if (!rr.ok) throw new Error(rr.error);
    }
    const messages = this.loadMessages(repo, source.taskId);
    const record: AgentTaskRecord = {
      ...source,
      taskId: randomUUID(),
      title: `fork: ${source.title}`.slice(0, 80),
      externalSessionId: null,
      state: "awaiting-input",
      exitCode: null,
      createdAt: new Date().toISOString(),
      lastActiveAt: null,
      modelRef: modelRef ?? null,
      archived: false,
    };
    upsertTask(file, record);
    saveAgentTasks(repo, file);
    this.persistMessages(record.taskId, messages);
    this.deps.send("agent.tasks.changed", {});
    return record;
  }

  archive(args: { taskId: string; archived: boolean }): AgentTaskRecord | null {
    const repo = this.needRepo();
    if (this.isRunning(args.taskId)) throw new Error("任务正在运行，无法归档");
    const file = loadAgentTasks(repo);
    const record = findTask(file, args.taskId);
    if (!record) return null;
    record.archived = !!args.archived;
    upsertTask(file, record);
    saveAgentTasks(repo, file);
    this.deps.send("agent.tasks.changed", {});
    return record;
  }

  /** 删除：账本条目 + 会话历史（worktree 不动，独立清理）。运行中不可删。 */
  deleteTask(args: { taskId: string }): { ok: boolean } {
    const repo = this.needRepo();
    if (this.isRunning(args.taskId)) throw new Error("任务正在运行，无法删除");
    const file = loadAgentTasks(repo);
    const record = findTask(file, args.taskId);
    if (!record) return { ok: false };
    file.tasks = file.tasks.filter((t) => t.taskId !== args.taskId);
    saveAgentTasks(repo, file);
    try {
      deleteSessionFile(repo, args.taskId);
    } catch {
      /* 会话文件缺失不阻塞 */
    }
    this.deps.send("agent.tasks.changed", {});
    return { ok: true };
  }

  // ---- 内部：一轮对话 ----

  private isRunning(taskId: string): boolean {
    const a = this.live.get(taskId)?.abort;
    return a !== null && a !== undefined;
  }

  private async startTurn(record: AgentTaskRecord, worktreePath: string, messages: ModelMessage[], tt: CompiledTaskType, humanNote?: string): Promise<void> {
    let live = this.live.get(record.taskId);
    if (!live) {
      live = { record, worktreePath, messages, taskType: tt, abort: null, perms: new Map(), approved: new Set(), journal: [] };
      this.live.set(record.taskId, live);
    }
    live.messages = messages;
    live.worktreePath = worktreePath;
    live.taskType = tt;
    live.journal.push({ ts: new Date().toISOString(), actor: "human", kind: "text", text: humanNote ?? "任务下发" });
    live.abort = new AbortController();
    record.state = "starting";
    record.lastActiveAt = new Date().toISOString();
    this.emit(record, { type: "status", phase: "thinking", summary: "组装上下文…" });
    this.scheduleSave();

    const rr = this.deps.resolveModel(record.modelRef, record.thinking);
    if (!rr.ok) {
      record.state = "failed";
      record.lastMessage = rr.error;
      this.emit(record, { type: "completed", outcome: "failed", summary: rr.error });
      this.scheduleSave();
      this.deps.send("agent.tasks.changed", {});
      return;
    }

    const ctx = await collectRepoContext(worktreePath);
    this.emit(record, { type: "status", phase: "editing", summary: `分支 ${ctx.branch ?? "?"} · ${ctx.statusSummary}` });

    const result = await runLoop({
      model: rr.model,
      thinking: record.thinking,
      system: composeSystemPrompt(ctx, worktreePath) + (tt.systemAddendum ? `\n\n${tt.systemAddendum}` : ""),
      messages,
      tools: buildToolset(
        {
          worktreePath,
          taskId: record.taskId,
          requestPermission: (toolName, req) => this.requestPermission(record, live!, toolName, req),
          onFileChange: (p, kind) => this.emit(record, { type: "file-change", path: p, kind }),
        },
        { allowedTools: tt.tools ?? undefined, policy: tt.policy },
      ),
      signal: live.abort.signal,
      onEvent: (ev) => this.handleLoopEvent(record, ev),
    });

    if (result.outcome === "cancelled") {
      record.state = this.manualStop.has(record.taskId) ? "stopped" : "interrupted";
      this.manualStop.delete(record.taskId);
    } else if (result.outcome === "completed") {
      record.state = "awaiting-input";
      if (result.lastMessage) record.lastMessage = result.lastMessage;
      this.deps.addUsage(rr.profileRef, result.usage);
      if (this.deps.settings.current.agentsCheckpoint !== false) {
        try {
          const cp = await commitCheckpoint(worktreePath, {
            summary: result.lastMessage ?? "轮次结束",
            assistedBy: "gitter-agent",
            sessionId: record.taskId,
          });
          if (cp.sha) {
            this.emit(record, { type: "checkpoint", commitSha: cp.sha, summary: result.lastMessage ?? "" });
          }
        } catch (e) {
          this.emit(record, { type: "log", level: "warn", text: `checkpoint 失败：${(e as Error).message}` });
        }
      }
    } else {
      record.state = "failed";
      record.lastMessage = result.error ?? result.lastMessage ?? "循环失败";
    }
    record.exitCode = null;
    record.lastActiveAt = new Date().toISOString();
    live.abort = null;
    this.scheduleSave();
    this.deps.send("agent.tasks.changed", {});
  }

  private handleLoopEvent(record: AgentTaskRecord, ev: AgentSessionEvent): void {
    if (ev.type === "output" && ev.text.trim()) record.lastMessage = ev.text;
    if (ev.type === "turn-completed" && ev.lastMessage) record.lastMessage = ev.lastMessage;
    if (record.state === "starting") record.state = "working";
    this.emit(record, ev);
  }

  private requestPermission(
    record: AgentTaskRecord,
    live: LiveSession,
    toolName: string,
    req: { title: string; detail: string; command?: string | null; permissionClass: "auto" | "session" | "each-time" },
  ): Promise<boolean> {
    if (req.permissionClass === "session" && live.approved.has(toolName)) return Promise.resolve(true);
    const requestId = randomUUID();
    record.state = "awaiting-permission";
    this.emit(record, {
      type: "permission",
      title: req.title,
      detail: req.detail,
      command: req.command ?? null,
      requestId,
    });
    this.scheduleSave();
    return new Promise<boolean>((resolve) => {
      live.perms.set(requestId, (ok, remember) => {
        if (ok && remember && req.permissionClass === "session") live.approved.add(toolName);
        record.state = "working";
        resolve(ok);
      });
    });
  }

  // ---- 持久化 ----

  private sessionsDir(repo: string): string {
    return path.join(repo, ".git", "gitter", "agent-sessions");
  }

  private loadMessages(repo: string, taskId: string): ModelMessage[] {
    return loadSessionFile(repo, taskId).messages;
  }

  private persistMessages(taskId: string, messages: ModelMessage[]): void {
    const repo = this.repoOrNull();
    if (!repo) return;
    saveSessionFile(repo, { version: 1, taskId, messages, events: this.live.get(taskId)?.journal ?? [] });
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const repo = this.repoOrNull();
      if (!repo) return;
      const file: AgentTaskFile = loadAgentTasks(repo);
      for (const s of this.live.values()) {
        upsertTask(file, s.record);
        saveSessionFile(repo, { version: 1, taskId: s.record.taskId, messages: s.messages, events: s.journal });
      }
      saveAgentTasks(repo, file);
      this.deps.send("agent.tasks.changed", {});
    }, 250);
  }

  // ---- 杂项 ----

  private emit(record: AgentTaskRecord, ev: AgentSessionEvent): void {
    this.journalEvent(record, ev);
    this.deps.send("agent.event", { taskId: record.taskId, event: ev });
  }

  private journalActor(ev: AgentSessionEvent): SessionActor {
    return ev.type === "checkpoint" || ev.type === "log" ? "host" : "agent";
  }

  private journalEvent(record: AgentTaskRecord, ev: AgentSessionEvent): void {
    const live = this.live.get(record.taskId);
    if (!live) return;
    live.journal.push({ ts: new Date().toISOString(), actor: this.journalActor(ev), kind: "event", event: ev });
    if (live.journal.length > 500) live.journal.splice(0, live.journal.length - 500);
  }

  private journalHuman(record: AgentTaskRecord, text: string): void {
    const live = this.live.get(record.taskId);
    const entry: SessionJournalEntry = { ts: new Date().toISOString(), actor: "human", kind: "text", text };
    if (live) {
      live.journal.push(entry);
      if (live.journal.length > 500) live.journal.splice(0, live.journal.length - 500);
    }
    this.scheduleSave();
  }

  /** 任务历史读取（agent-harness.md v3.0 历史面：UI 回填 + 插件读取口）。 */
  taskHistory(args: { taskId: string }): {
    record: AgentTaskRecord | null;
    events: SessionJournalEntry[];
    messages: import("ai").ModelMessage[];
  } {
    const repo = this.needRepo();
    const file = loadAgentTasks(repo);
    const record = findTask(file, args.taskId) ?? null;
    const sf = loadSessionFile(repo, args.taskId);
    const live = this.live.get(args.taskId);
    return { record, events: live?.journal ?? sf.events, messages: sf.messages };
  }

  private putRecord(record: AgentTaskRecord): void {
    const repo = this.needRepo();
    const file = loadAgentTasks(repo);
    upsertTask(file, record);
    saveAgentTasks(repo, file);
  }

  private modelAvailability(preferred: string | null): { available: boolean; version: string | null; reason: string | null } {
    if (this.deps.settings.current.aiPrivacy === "disabled") {
      return { available: false, version: null, reason: "AI 隐私档位为 Disabled（设置 → AI 网关）" };
    }
    const rr = this.deps.resolveModel(preferred);
    return rr.ok
      ? { available: true, version: this.deps.settings.current.aiModel, reason: null }
      : { available: false, version: null, reason: rr.error };
  }

  private repoOrNull(): string | null {
    return this.deps.repoOf();
  }

  private needRepo(): string {
    const repo = this.repoOrNull();
    if (!repo) throw new Error("没有打开的仓库");
    return repo;
  }
}
