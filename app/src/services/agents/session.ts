import { randomUUID } from "crypto";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import type { ModelMessage } from "ai";
import type { PackageStore } from "../extensions/store";
import type { SettingsStore } from "../settings";
import { tryGit } from "../gitexec";
import { parseUnifiedDiff } from "../gitlog";
import * as status from "../gitstatus";
import { createTaskWorktree, listWorktrees } from "../worktrees";
import { commitCheckpoint, headSha } from "./checkpoint";
import { resolveTaskType } from "./taskTypes";
import { buildToolset, type PermissionRequest, type ShellRecord, type ToolEnv } from "./registry";
import "./builtinTools"; // 内置工具自举注册（§14.4：与插件同接缝，import 副作用）
import "./builtinHooks"; // 内置 turn 钩子自举（§20.3.6：todo 防腐，与插件钩子同接缝）
import { runLoop } from "./loop";
import { collectRepoContext, composeSystemPrompt, wrapReminder, type RepoContext } from "./prompts";
import { budgetOf, compactNow, estimateMessagesTokens, validateMessageSequence } from "./compaction";
import { activeCompactor, getCompactorById, runContextCollectors, runTurnHooks } from "./seams";
import { runSubtask, subagentPresetIds, syncPackagePresets } from "./subagents";
import {
  appendJournalFile, deleteSessionFile, emptySessionFile, findTask, loadAgentTasks, loadJournalRange,
  loadSessionFile, markInterrupted, normalizeRecord, saveAgentTasks, saveSessionFile, upsertTask,
  type SessionFile, type SessionJournalEntry,
} from "./tasks";
import type {
  AgentContextStats, AgentHarnessDTO, AgentSessionEvent, AgentTaskRecord, FileChangeKind,
  PermissionMode, PlanHistoryEntry, ThinkingLevel, TodoItem,
} from "./types";

/**
 * AgentSessionManager（agent-harness-v4.md F1/F5/F6/F7/F8/F9/F10）：
 * 任务卡三元组 = worktree + Gitter agent 会话 + 会话基线（不变）。
 * v4 编排：消息完整回写持久化 / 权限模式与持久规则 / 排队投递 / 自动压缩与预算表 /
 * 计划批准流 / todo / 子代理（信号量限流）/ ChangeSet + checkpoint 索引 / journal 分段冲刷。
 * 安全边界不变：执行权不出宿主；checkpoint 唯一免卡写；push 恒 each-time。
 */

export interface AgentSessionDeps {
  repoOf: () => string | null;
  store: PackageStore;
  settings: SettingsStore;
  /** 模型档案链解析（bridge 组装；contextWindow 供预算表，缺省 128k） */
  resolveModel: (profileRef: string | null, thinking?: ThinkingLevel) =>
    { ok: true; model: import("ai").LanguageModel; profileRef: string; contextWindow: number } | { ok: false; error: string };
  /** 用量记账（按档案累计） */
  addUsage: (profileRef: string, usage: { input?: number; output?: number } | null) => void;
  /** 经 preload bridge 推渲染层（evt 通道） */
  send: (method: string, params: unknown) => void;
  /** 只读事件广播（§14.7：agent.turn.* / agent.tool.called / agent.permission.* → 插件 EventBus） */
  onBusEvent?: (name: string, payload: Record<string, unknown>) => void;
  /** U5 生命周期钩子 */
  onLifecycle?: (event: "created" | "resumed" | "stopped" | "removed", record: AgentTaskRecord) => void;
}

interface LiveSession {
  record: AgentTaskRecord;
  worktreePath: string;
  messages: ModelMessage[];
  taskType: import("./taskTypes").CompiledTaskType;
  abort: AbortController | null;
  /** 授权回执：requestId → resolve(ok, remember, answer) */
  perms: Map<string, (ok: boolean, remember: boolean, answer?: string) => void>;
  /** 提问回执（ask_user） */
  questions: Map<string, { options: string[]; resolve: (answer: string) => void }>;
  /** 计划回执（plan_submit） */
  plans: Map<string, (r: { ok: boolean; feedback?: string }) => void>;
  /** Session 级已记住的授权（工具名） */
  approved: Set<string>;
  /** journal 待冲刷 buffer（scheduleSave 时 appendJournalFile） */
  journal: SessionJournalEntry[];
  /** F2 读取登记（写前读校验） */
  readLog: Map<string, { mtimeMs: number; size: number }>;
  /** F6 ChangeSet 缓存 */
  changeSet: Map<string, { kind: FileChangeKind; added: number; deleted: number }>;
  shells: Map<string, ShellRecord>;
  todos: TodoItem[];
  queued: string[];
  /** turn 上下文（子代理复用） */
  turnCtx: RepoContext | null;
  systemEst: number;
  subtaskRunning: number;
  sessionFile: SessionFile;
  contextStats: AgentContextStats | null;
  /** 计划本轮获批 → turn 结束后自动注入计划开执行轮（工具面按新权限模式重建） */
  planApproved: string | null;
  /** F8.2 防呆：plan 模式未交计划连续提醒计数（2 次后放行结束） */
  planNudge: number;
  planSubmittedThisTurn: boolean;
  /** F8.1 todo 防腐：连续轮次 in_progress 未变计数 */
  todoStaleCount: number;
  lastInProgress: string | null;
  /** F12.2 防死循环：(tool:argsHash) → 连续失败次数 */
  toolFails: Map<string, number>;
  /** 本轮开始时刻（§20.3.6 turn.completed durationMs） */
  turnStartTs: number;
}

const BUILTIN_HARNESS_ID = "builtin/gitter-agent";
const NON_TERMINAL: AgentTaskRecord["state"][] = ["starting", "working", "awaiting-input", "awaiting-permission"];
const MAX_QUEUED_TURNS = 5;
const JOURNAL_BUFFER_CAP = 2000;

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

export function dedupeSlug(slug: string, existingBranches: ReadonlySet<string>): string {
  if (!existingBranches.has(`task/${slug}`)) return slug;
  let n = 2;
  while (existingBranches.has(`task/${slug}-${n}`)) n++;
  return `${slug}-${n}`;
}

/** A4 验收台直投：挑选修复轮目标任务。 */
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
    const repo = this.repoOrNull();
    if (repo) {
      for (const s of this.live.values()) {
        try {
          this.flushJournal(s);
          saveSessionFile(repo, s.sessionFile);
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
        capabilities: ["structured-events", "checkpoints", "feedback-channel", "resume", "prompt-submission", "file-watch", "subagents", "plan-mode", "compaction"],
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
        return l ? normalizeRecord({ ...l.record, state: l.record.state, lastMessage: l.record.lastMessage, lastActiveAt: l.record.lastActiveAt }) : normalizeRecord(t);
      });
  }

  replyPermission(args: { requestId: string; ok: boolean; remember?: boolean; answer?: string; optionIndex?: number }): { ok: boolean } {
    for (const s of this.live.values()) {
      const resolve = s.perms.get(args.requestId);
      if (resolve) {
        s.perms.delete(args.requestId);
        resolve(!!args.ok, !!args.remember);
        if (s.record.state === "awaiting-permission") s.record.state = "working";
        this.scheduleSave();
        return { ok: true };
      }
      const q = s.questions.get(args.requestId);
      if (q) {
        s.questions.delete(args.requestId);
        const answer = args.answer ?? (args.optionIndex !== undefined ? q.options[args.optionIndex] : undefined) ?? "";
        if (s.record.state === "awaiting-input") s.record.state = "working";
        q.resolve(answer);
        this.scheduleSave();
        return { ok: true };
      }
      const plan = s.plans.get(args.requestId);
      if (plan) {
        s.plans.delete(args.requestId);
        if (s.record.state === "awaiting-input") s.record.state = "working";
        plan({ ok: !!args.ok, feedback: args.answer });
        this.scheduleSave();
        return { ok: true };
      }
    }
    return { ok: false };
  }

  // ---- 任务生命周期 ----

  async createTask(args: {
    harness?: string; name?: string; prompt: string; taskType?: string; model?: string;
    thinking?: ThinkingLevel; loopId?: string; mode?: PermissionMode;
  }): Promise<AgentTaskRecord> {
    const repo = this.needRepo();
    if (args.harness && args.harness !== BUILTIN_HARNESS_ID) {
      throw new Error(`未知 agent：${args.harness}（当前版本仅内置 Gitter Agent）`);
    }
    const tt = resolveTaskType(this.deps.store, args.taskType);
    if (tt.error) throw new Error(tt.error);
    if (!args.prompt.trim()) throw new Error("任务描述不能为空");
    const name = args.name?.trim() || args.prompt.trim().split(/\r?\n/)[0]?.slice(0, 40) || "task";

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
      title,
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
      loopId: args.loopId ?? tt.spec.defaultLoop ?? null,
      thinking: args.thinking ?? "medium",
      permissionMode: args.mode ?? "default",
      todoState: null,
      planHistory: [],
      queued: [],
      archived: false,
    };
    this.putRecord(record);
    this.deps.onLifecycle?.("created", record);
    const input = tt.spec.promptTemplate.replace("{input}", args.prompt.trim());
    this.ensureLive(record, tt.spec, wt.path, [{ role: "user", content: input }]);
    void this.startTurn(record, `任务下发：${title}`);
    return record;
  }

  /** 续跑：历史重放 + 追加输入。 */
  async resumeTask(args: { taskId: string; prompt: string; thinking?: ThinkingLevel; mode?: PermissionMode }): Promise<AgentTaskRecord> {
    const repo = this.needRepo();
    if (!args.prompt.trim()) throw new Error("输入不能为空");
    if (this.isRunning(args.taskId)) throw new Error("会话仍在运行，请用排队投递（agent.task.queue）");
    const file = loadAgentTasks(repo);
    const record = findTask(file, args.taskId);
    if (!record) throw new Error("任务不存在");
    const tt = resolveTaskType(this.deps.store, record.taskType);
    const sf = loadSessionFile(repo, args.taskId);
    const live = this.ensureLive(record, tt.spec, record.worktreePath, sf.messages, sf);
    live.messages.push({ role: "user", content: args.prompt.trim() });
    record.state = "starting";
    record.archived = false;
    record.lastActiveAt = new Date().toISOString();
    if (args.thinking) record.thinking = args.thinking;
    if (args.mode) record.permissionMode = args.mode;
    this.putRecord(record);
    this.deps.onLifecycle?.("resumed", record);
    void this.startTurn(record, `追加输入：${args.prompt.trim().split(/\r?\n/)[0]?.slice(0, 60)}`);
    return record;
  }

  /** 排队投递（F10.4）：working/awaiting-permission 中补充输入，turn 边界自动注入。 */
  queueTask(args: { taskId: string; prompt: string }): AgentTaskRecord | null {
    const repo = this.needRepo();
    if (!args.prompt.trim()) throw new Error("输入不能为空");
    const live = this.live.get(args.taskId);
    const file = loadAgentTasks(repo);
    const record = live?.record ?? findTask(file, args.taskId);
    if (!record) throw new Error("任务不存在");
    record.queued.push(args.prompt.trim());
    this.journalHuman(record, live, `排队：${args.prompt.trim().slice(0, 60)}`);
    this.putRecord(record);
    this.deps.send("agent.tasks.changed", {});
    return record;
  }

  /** 手动压缩（/compact）。 */
  async compactTask(args: { taskId: string }): Promise<{ ok: boolean; summary?: string }> {
    const live = this.live.get(args.taskId);
    if (!live) throw new Error("任务未在运行（重启后暂不支持手动压缩）");
    if (this.isRunning(args.taskId)) throw new Error("会话运行中，请在轮次结束后压缩");
    const rr = this.deps.resolveModel(live.record.modelRef, live.record.thinking);
    if (!rr.ok) throw new Error(rr.error);
    const result = await compactNow({
      messages: live.messages,
      contextWindow: 1_000_000, // 手动模式不限预算
      systemEstTokens: live.systemEst,
      model: rr.model,
    });
    if (!result) return { ok: false };
    live.messages.length = 0;
    live.messages.push(...result.messages);
    live.sessionFile.compactions.push(result.record);
    this.emit(live.record, { type: "log", level: "info", text: `上下文已手动压缩（${result.record.removedCount} 条消息 → 摘要）` });
    this.scheduleSave();
    return { ok: true, summary: result.record.summary };
  }

  /** /clear：清空消息历史（保留 worktree / checkpoint / 账本）。 */
  clearTask(args: { taskId: string }): { ok: boolean } {
    const repo = this.needRepo();
    if (this.isRunning(args.taskId)) throw new Error("会话运行中，先停止再清空");
    const live = this.live.get(args.taskId);
    if (live) {
      live.messages.length = 0;
      live.sessionFile.compactions = [];
      this.emit(live.record, { type: "log", level: "info", text: "会话已重置（/clear）" });
      saveSessionFile(repo, live.sessionFile);
    } else {
      const sf = emptySessionFile(args.taskId);
      saveSessionFile(repo, sf);
    }
    this.deps.send("agent.tasks.changed", {});
    return { ok: true };
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

  /** A4 修复轮注入：反馈包装成受限提示走 resume。 */
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
    // 挂起的授权/提问/计划全部按拒绝结算（F10.5：中断不悬挂）
    for (const [id, resolve] of [...live.perms]) {
      live.perms.delete(id);
      resolve(false, false);
    }
    for (const [id, q] of [...live.questions]) {
      live.questions.delete(id);
      q.resolve("（会话中断）");
    }
    for (const [id, p] of [...live.plans]) {
      live.plans.delete(id);
      p({ ok: false, feedback: "（会话中断）" });
    }
    this.journalHuman(live.record, live, "停止请求");
    live.abort.abort();
    return live.record;
  }

  /** 权限模式切换（F5.1：下一轮生效）。 */
  setMode(args: { taskId: string; mode: PermissionMode }): AgentTaskRecord | null {
    const repo = this.repoOrNull();
    if (!repo) throw new Error("没有打开的仓库");
    const live = this.live.get(args.taskId);
    const file = loadAgentTasks(repo);
    const record = live?.record ?? findTask(file, args.taskId);
    if (!record) throw new Error("任务不存在");
    record.permissionMode = args.mode;
    upsertTask(file, record);
    saveAgentTasks(repo, file);
    if (live) this.emit(record, { type: "log", level: "info", text: `权限模式 → ${args.mode}` });
    this.scheduleSave();
    this.deps.send("agent.tasks.changed", {});
    return record;
  }

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

  /** fork（F1.4 修复）：必建新 worktree，复制消息历史，原任务不动。 */
  async fork(args: { taskId: string; model?: string }): Promise<AgentTaskRecord> {
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
    const slug = source.branch.replace(/^task\//, "");
    const existing = new Set((await listWorktrees(repo)).map((w) => w.branch));
    const forkSlug = dedupeSlug(`${slug}-fork`, existing);
    const wt = await createTaskWorktree(repo, forkSlug);
    const baseline = (await headSha(wt.path)) ?? "";
    const messages = loadSessionFile(repo, args.taskId).messages;
    const record: AgentTaskRecord = {
      ...normalizeRecord(source),
      taskId: randomUUID(),
      title: `fork: ${source.title}`.slice(0, 80),
      worktreePath: wt.path,
      branch: wt.branch,
      baselineSha: baseline,
      externalSessionId: null,
      state: "awaiting-input",
      exitCode: null,
      createdAt: new Date().toISOString(),
      lastActiveAt: null,
      modelRef: modelRef ?? null,
      queued: [],
      archived: false,
    };
    upsertTask(file, record);
    saveAgentTasks(repo, file);
    const sf = emptySessionFile(record.taskId);
    sf.messages = messages;
    saveSessionFile(repo, sf);
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
    this.deps.onLifecycle?.("removed", record);
    return { ok: true };
  }

  // ---- 改动预览（F6） ----

  async taskFiles(args: { taskId: string }): Promise<{ path: string; kind: FileChangeKind; added: number | null; deleted: number | null }[]> {
    const record = this.recordOf(args.taskId);
    // numstat（基线 → 工作区，含已提交）+ 未跟踪
    const r = await tryGit(record.worktreePath, ["diff", "--numstat", record.baselineSha].filter(Boolean) as string[]);
    const out: { path: string; kind: FileChangeKind; added: number | null; deleted: number | null }[] = [];
    const seen = new Set<string>();
    for (const line of r.stdout.split(/\r?\n/)) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line.trim());
      if (!m) continue;
      const p = m[3].replace(/^"|"$/g, "");
      seen.add(p);
      out.push({
        path: p,
        kind: m[1] === "0" && m[2] !== "0" ? "deleted" : "modified",
        added: m[1] === "-" ? null : parseInt(m[1], 10),
        deleted: m[2] === "-" ? null : parseInt(m[2], 10),
      });
    }
    const st = await status.getStatus(record.worktreePath);
    for (const u of st.unversioned) {
      if (!seen.has(u.path)) out.push({ path: u.path, kind: "added", added: u.added, deleted: u.deleted });
    }
    return out;
  }

  async taskDiff(args: { taskId: string; path?: string; since?: string }): Promise<import("../../shared/types").DiffDTO[]> {
    const text = await this.taskDiffText(args);
    return parseUnifiedDiff(text);
  }

  /** 原始 unified diff 文本（复制/导出用）。 */
  async taskDiffText(args: { taskId: string; path?: string; since?: string }): Promise<string> {
    const record = this.recordOf(args.taskId);
    const gitArgs = ["diff", "--no-color"];
    if (args.since && args.since.startsWith("checkpoint:")) {
      const sha = args.since.slice("checkpoint:".length);
      gitArgs.push(`${sha}^`, sha);
    } else if (record.baselineSha) {
      gitArgs.push(record.baselineSha);
    }
    if (args.path) gitArgs.push("--", args.path);
    const r = await tryGit(record.worktreePath, gitArgs);
    const out = r.stdout;
    return out.length > 256_000 ? out.slice(0, 256_000) + "\n…（diff 已截断）" : out;
  }

  async taskCheckpoints(args: { taskId: string }): Promise<{ sha: string; summary: string; date: string }[]> {
    const record = this.recordOf(args.taskId);
    const r = await tryGit(record.worktreePath, [
      "log", "--grep", `Gitter-Session: ${args.taskId}`, "--format=%H%x09%s%x09%cI",
    ]);
    return r.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
      const [sha, summary, date] = line.split("\t");
      return { sha, summary, date: date ?? "" };
    });
  }

  /** 恢复（整点 reset --hard / 逐文件 checkout；UI 侧确认后调用）。 */
  async restore(args: { taskId: string; sha: string; path?: string }): Promise<{ ok: boolean }> {
    const record = this.recordOf(args.taskId);
    if (args.path) {
      const r = await tryGit(record.worktreePath, ["checkout", args.sha, "--", args.path]);
      if (r.code !== 0) throw new Error(r.stderr.trim() || "checkout 失败");
    } else {
      const r = await tryGit(record.worktreePath, ["reset", "--hard", args.sha]);
      if (r.code !== 0) throw new Error(r.stderr.trim() || "reset 失败");
    }
    const live = this.live.get(args.taskId);
    if (live) this.journalHuman(record, live, `恢复到 ${args.sha.slice(0, 8)}${args.path ? `（仅 ${args.path}）` : ""}`);
    this.deps.send("agent.tasks.changed", {});
    return { ok: true };
  }

  /** 上下文用量（F7.6）。 */
  contextStats(args: { taskId: string }): AgentContextStats | null {
    const live = this.live.get(args.taskId);
    if (!live) return null;
    const window = live.contextStats?.contextWindow ?? 128_000;
    return this.computeStats(live, window);
  }

  /** 后台 shell 状态（F4 逃生舱联动：任务卡面板数据源）。 */
  taskShells(args: { taskId: string }): { id: string; command: string; running: boolean; exitCode: number | null; tail: string }[] {
    const live = this.live.get(args.taskId);
    if (!live) return [];
    return [...live.shells.values()].map((s) => ({
      id: s.id, command: s.command.slice(0, 200), running: s.running, exitCode: s.exitCode,
      tail: s.output.slice(-2000),
    }));
  }

  /** 图片预览（F2.1：read-image 附件数据源；base64 data URL，cap 2MB）。 */
  async previewImage(args: { taskId: string; path: string }): Promise<{ dataUrl: string } | { error: string }> {
    const record = this.recordOf(args.taskId);
    const { resolveSafe } = await import("./fsx");
    const abs = await resolveSafe(record.worktreePath, args.path);
    const st = await fsp.stat(abs).catch(() => null);
    if (!st || !st.isFile()) return { error: "文件不存在" };
    if (st.size > 2 * 1024 * 1024) return { error: "超过 2MB 预览上限" };
    const ext = path.extname(abs).toLowerCase().replace(".", "") || "png";
    const mime = ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext) ? (ext === "jpg" ? "jpeg" : ext) : "png";
    const buf = await fsp.readFile(abs);
    return { dataUrl: `data:image/${mime};base64,${buf.toString("base64")}` };
  }

  /** 任务历史读取（journal 分页：before/limit）。 */
  taskHistory(args: { taskId: string; before?: string; limit?: number }): {
    record: AgentTaskRecord | null;
    events: SessionJournalEntry[];
    hasMore: boolean;
    messages: ModelMessage[];
  } {
    const repo = this.needRepo();
    const file = loadAgentTasks(repo);
    const record = findTask(file, args.taskId) ?? null;
    const live = this.live.get(args.taskId);
    if (live) {
      const merged = [...live.journal];
      if (args.before || args.limit) {
        const disk = loadJournalRange(repo, args.taskId, { before: args.before, limit: args.limit ?? 200 });
        return {
          record: record ? normalizeRecord(record) : null,
          events: disk.entries,
          hasMore: disk.hasMore,
          messages: live.messages,
        };
      }
      const disk = loadJournalRange(repo, args.taskId, {});
      return {
        record: record ? normalizeRecord(record) : null,
        events: [...disk.entries, ...merged],
        hasMore: false,
        messages: live.messages,
      };
    }
    const disk = loadJournalRange(repo, args.taskId, { before: args.before, limit: args.limit ?? 200 });
    return {
      record: record ? normalizeRecord(record) : null,
      events: disk.entries,
      hasMore: disk.hasMore,
      messages: loadSessionFile(repo, args.taskId).messages,
    };
  }

  // ---- 内部：一轮对话（含排队续轮） ----

  private isRunning(taskId: string): boolean {
    const a = this.live.get(taskId)?.abort;
    return a !== null && a !== undefined;
  }

  private ensureLive(
    record: AgentTaskRecord,
    tt: import("./taskTypes").CompiledTaskType,
    worktreePath: string,
    messages: ModelMessage[],
    sf?: SessionFile,
  ): LiveSession {
    let live = this.live.get(record.taskId);
    if (!live) {
      live = {
        record, worktreePath, messages, taskType: tt, abort: null,
        perms: new Map(), questions: new Map(), plans: new Map(), approved: new Set(),
        journal: [], readLog: new Map(), changeSet: new Map(), shells: new Map(),
        todos: record.todoState ?? [], queued: record.queued ?? [], turnCtx: null,
        systemEst: 0, subtaskRunning: 0,
        sessionFile: sf ?? emptySessionFile(record.taskId),
        contextStats: null,
        planApproved: null,
        planNudge: 0,
        planSubmittedThisTurn: false,
        todoStaleCount: 0,
        lastInProgress: null,
        toolFails: new Map(),
        turnStartTs: Date.now(),
      };
      this.live.set(record.taskId, live);
    }
    live.record = record;
    live.worktreePath = worktreePath;
    live.messages = messages;
    live.taskType = tt;
    live.queued = record.queued ?? [];
    return live;
  }

  private async startTurn(record: AgentTaskRecord, humanNote?: string): Promise<void> {
    const live = this.live.get(record.taskId);
    if (!live) return;
    let autoTurns = 0;
    for (;;) {
      syncPackagePresets(this.deps.store); // §14.2 #6：包声明预设 → 预设注册表（幂等）
      live.planSubmittedThisTurn = false;
      live.journal.push({ ts: new Date().toISOString(), actor: "human", kind: "text", text: humanNote ?? "任务下发" });
      live.abort = new AbortController();
      live.turnStartTs = Date.now();
      record.state = "starting";
      record.lastActiveAt = new Date().toISOString();
      this.emit(record, { type: "status", phase: "thinking", summary: "组装上下文…" });
      this.deps.onBusEvent?.("agent.turn.started", { taskId: record.taskId, mode: record.permissionMode ?? "default" });
      this.scheduleSave();

      const rr = this.deps.resolveModel(record.modelRef, record.thinking);
      if (!rr.ok) {
        record.state = "failed";
        record.lastMessage = rr.error;
        this.emit(record, { type: "completed", outcome: "failed", summary: rr.error });
        break;
      }

      const ctx = await collectRepoContext(record.worktreePath);
      live.turnCtx = ctx;
      this.emit(record, { type: "status", phase: "editing", summary: `分支 ${ctx.branch ?? "?"} · ${ctx.statusSummary}` });

      const mode: PermissionMode = record.permissionMode ?? "default";
      const slotCtx = { worktreePath: record.worktreePath, repoPath: this.repoOrNull(), branch: ctx.branch, statusSummary: ctx.statusSummary, mode, taskTypeId: live.taskType.fullId, isSubtask: false };
      // §14.5/§20.3.2 接缝：内置三采集器 + 插件采集器；技能清单（F7.5，数据来自 PackageStore）
      const contextSections = await runContextCollectors(slotCtx);
      const contextText = [`- 分支：${ctx.branch ?? "未知"}；工作区：${ctx.statusSummary}`, ...contextSections].join("\n");
      const skills = this.deps.store.skillsOf().map((s) => ({ name: s.name, description: s.description }));
      const skillsText = skills.length > 0
        ? ["可用技能（人类 /skill 或任务模板引用时展开）：", ...skills.map((s) => `- ${s.name}：${s.description}`)].join("\n")
        : undefined;
      const system = await composeSystemPrompt({
        env: slotCtx,
        slots: {
          context: contextText,
          skills: skillsText,
          task: live.taskType.systemAddendum ?? undefined,
        },
        thinking: record.thinking,
      });
      live.systemEst = estimateMessagesTokens([{ role: "user", content: system }]);

      // 自动压缩（F7.2；§20.3.3 选择链 taskType.compactor → builtin；数据面调参 threshold/keepLast）
      const compactionMode = this.deps.settings.current.agentsCompaction ?? "auto";
      if (compactionMode === "auto") {
        const compactor = (live.taskType.compactor && getCompactorById(live.taskType.compactor)) || activeCompactor();
        const policy = this.deps.settings.current.agentsCompactionPolicy ?? {};
        const compacted = await compactor.compact({
          messages: live.messages,
          contextWindow: rr.contextWindow || 128_000,
          systemEstTokens: live.systemEst,
          model: rr.model,
          signal: live.abort.signal,
          threshold: policy.threshold,
          keepLast: policy.keepLast,
        });
        if (compacted) {
          live.messages.length = 0;
          live.messages.push(...compacted.messages);
          live.sessionFile.compactions.push(compacted.record);
          this.emit(record, {
            type: "log", level: "info",
            text: `上下文已压缩：${compacted.record.removedCount} 条消息 → 摘要（${compacted.record.tokensBefore} → ${compacted.record.tokensAfter} tokens）`,
          });
        }
      }
      live.contextStats = this.computeStats(live, rr.contextWindow || 128_000);

      const tt = live.taskType;
      const env: ToolEnv = {
        worktreePath: record.worktreePath,
        taskId: record.taskId,
        mode,
        signal: live.abort.signal,
        emit: (ev) => this.emit(record, ev),
        requestPermission: (toolName, req, subtaskId) => this.requestPermission(record, live, toolName, req, subtaskId),
        readLog: live.readLog,
        noteFileChange: (p, kind, summary) => {
          this.updateChangeSet(live, p, kind, summary);
          this.emit(record, { type: "file-change", path: p, kind, summary });
        },
        askUser: (question, options, subtaskId) => this.askUser(record, live, question, options, subtaskId),
        submitPlan: (plan) => this.submitPlan(record, live, plan),
        setTodos: (todos) => {
          live.todos = todos;
          record.todoState = todos;
          this.emit(record, { type: "todo", todos });
          this.scheduleSave();
        },
        spawnSubtask: (targs) => this.spawnSubtask(record, live, targs),
        subtaskPresets: () => subagentPresetIds(),
        shells: live.shells,
        noteToolOutcome: (toolName, args, isError) => {
          // F12.2 防死循环：同一 (tool, args) 连续失败 ≥3 次 → 提醒追加进结果
          const key = `${toolName}:${JSON.stringify(args).slice(0, 200)}`;
          if (!isError) {
            live.toolFails.delete(key);
            return null;
          }
          const n = (live.toolFails.get(key) ?? 0) + 1;
          live.toolFails.set(key, n);
          return n >= 3 ? wrapReminder(`该操作（${toolName}）已连续失败 ${n} 次，请更换方法或向用户说明。`) : null;
        },
      };

      const result = await runLoop({
        loopId: record.loopId ?? undefined,
        model: rr.model,
        thinking: record.thinking,
        system,
        messages: live.messages,
        tools: buildToolset(env, {
          allowedTools: tt.tools ?? undefined,
          policy: tt.policy,
          // §20.3.9：用户持久规则 + 包 deny 规则（deny-only，加严方向）合并
          rules: [
            ...((this.deps.settings.current.agentRules ?? []) as never[]),
            ...this.deps.store.agentPermissionRulesOf().map((r) => ({
              id: `pkg:${r.packageId}:${r.tool}:${r.pattern ?? "*"}`,
              tool: r.tool, pattern: r.pattern, effect: "deny" as const, scope: "global" as const, createdAt: "",
            })),
          ] as never,
          mode,
          repoPath: this.repoOrNull(),
        }),
        signal: live.abort.signal,
        worktreePath: record.worktreePath,
        maxSteps: Math.min(live.taskType.maxSteps ?? 50, 200),
        // §20.3.4 循环契约 v2：只读服务代理（门在宿主）
        services: {
          requestPermission: (toolName, req) => this.requestPermission(record, live, toolName, req),
          askUser: (question, options) => this.askUser(record, live, question, options),
          submitPlan: (plan) => this.submitPlan(record, live, plan),
          setTodos: (todos) => {
            live.todos = todos;
            record.todoState = todos;
            this.emit(record, { type: "todo", todos });
            this.scheduleSave();
          },
          spawnSubtask: (targs) => this.spawnSubtask(record, live, targs),
        },
        onEvent: (ev) => this.handleLoopEvent(record, ev),
      });

      // §20.4 #8 压缩/循环产物完整性：turn 收尾宿主校验消息序列（tool 配对），非法自愈（中断补记）
      const seq = validateMessageSequence(live.messages);
      if (!seq.ok) {
        const cut = seq.cutIndex;
        const healed = live.messages.slice(0, cut);
        live.messages.length = 0;
        live.messages.push(...healed);
        live.messages.push({
          role: "user",
          content: wrapReminder("上一轮产物存在不完整的工具调用序列，已被宿主截断。请从中断处继续。"),
        });
        this.emit(record, { type: "log", level: "error", text: `消息序列校验失败（索引 ${seq.badIndex}），已自愈截断至 ${cut}` });
      }

      if (result.outcome === "cancelled") {
        record.state = this.manualStop.has(record.taskId) ? "stopped" : "interrupted";
        this.manualStop.delete(record.taskId);
      } else if (result.outcome === "completed") {
        record.state = "awaiting-input";
        if (result.lastMessage) record.lastMessage = result.lastMessage;
        this.deps.addUsage(rr.profileRef, result.usage);
        live.sessionFile.usageHistory.push({ ts: new Date().toISOString(), input: result.usage?.input, output: result.usage?.output });
        if (this.deps.settings.current.agentsCheckpoint !== false) {
          try {
            const cp = await commitCheckpoint(record.worktreePath, {
              summary: result.lastMessage ?? "轮次结束",
              assistedBy: "gitter-agent",
              sessionId: record.taskId,
            });
            if (cp.sha) this.emit(record, { type: "checkpoint", commitSha: cp.sha, summary: result.lastMessage ?? "" });
          } catch (e) {
            this.emit(record, { type: "log", level: "warn", text: `checkpoint 失败：${(e as Error).message}` });
          }
        }
      } else {
        record.state = "failed";
        record.lastMessage = result.error ?? result.lastMessage ?? "循环失败";
      }

      // §20.3.6 post-turn 钩子（编排面唯一钩子相）：产物以 system-reminder 注入下一轮（排队注入之前）
      if (this.deps.settings.current.agentsPostTurnHooks !== false) {
        const hookTexts = await runTurnHooks({
          taskId: record.taskId,
          outcome: result.outcome,
          lastMessage: result.lastMessage,
          todoState: record.todoState ?? null,
        });
        if (hookTexts.length > 0) {
          live.messages.push({
            role: "user",
            content: wrapReminder(`turn 钩子产出（下一轮处理）：\n${hookTexts.map((t) => `- ${t}`).join("\n")}`),
          });
          this.scheduleSave();
        }
      }
      record.exitCode = null;
      record.lastActiveAt = new Date().toISOString();
      live.abort = null;
      this.scheduleSave();
      this.deps.send("agent.tasks.changed", {});
      this.deps.onBusEvent?.("agent.turn.completed", {
        taskId: record.taskId,
        outcome: record.state,
        usage: result.usage ?? null,
        durationMs: Date.now() - live.turnStartTs,
      });

      // 计划获批 → 注入计划文本自动开执行轮（F8.2：新轮按 default 工具面重建）
      if (result.outcome === "completed" && live.planApproved && autoTurns < MAX_QUEUED_TURNS) {
        const plan = live.planApproved;
        live.planApproved = null;
        live.messages.push({
          role: "user",
          content: wrapReminder(`计划已获人类批准，请立即开始执行。先用 todo_write 把步骤落成清单，然后逐步执行并更新状态。\n\n${plan}`),
        });
        humanNote = "计划批准 → 执行轮";
        autoTurns++;
        continue;
      }

      // F8.2 防呆：plan 模式本轮未提交计划 → 提醒注入并续轮（连续 2 次后放行结束）
      if (
        result.outcome === "completed" &&
        (record.permissionMode ?? "default") === "plan" &&
        !live.planApproved &&
        !live.planSubmittedThisTurn &&
        autoTurns < MAX_QUEUED_TURNS
      ) {
        live.planNudge++;
        if (live.planNudge <= 2) {
          live.messages.push({
            role: "user",
            content: wrapReminder("你处于规划模式，本轮尚未调用 plan_submit 提交计划。请继续调研并在本轮内提交计划。"),
          });
          humanNote = "规划模式：未交计划提醒";
          autoTurns++;
          continue;
        }
      }
      if ((record.permissionMode ?? "default") !== "plan") live.planNudge = 0;

      // 排队投递注入（F10.4）：正常完成的轮次若有人类排队消息 → 自动续轮
      if (result.outcome === "completed" && record.queued.length > 0 && autoTurns < MAX_QUEUED_TURNS) {
        const drained = record.queued.splice(0, record.queued.length);
        live.messages.push({
          role: "user",
          content: wrapReminder(`用户在工作期间补充了以下输入，请结合处理：\n${drained.map((q) => `- ${q}`).join("\n")}`),
        });
        humanNote = `排队输入注入：${drained.length} 条`;
        autoTurns++;
        continue;
      }
      break;
    }
  }

  private handleLoopEvent(record: AgentTaskRecord, ev: AgentSessionEvent): void {
    if (ev.type === "output" && ev.text.trim() && ev.stream === "assistant") record.lastMessage = ev.text;
    if (ev.type === "turn-completed" && ev.lastMessage) record.lastMessage = ev.lastMessage;
    if (record.state === "starting") record.state = "working";
    if (ev.type === "tool" && ev.phase === "end") {
      // §14.7 只读广播：post 工具调用事件（pre-tool 拦截不开放）
      this.deps.onBusEvent?.("agent.tool.called", {
        taskId: record.taskId,
        subtaskId: ev.subtaskId ?? null,
        toolName: ev.name,
        source: ev.source ?? null,
        durationMs: ev.durationMs ?? null,
        isError: !!ev.isError,
      });
    }
    this.emit(record, ev);
  }

  private computeStats(live: LiveSession, contextWindow: number): AgentContextStats {
    const estTokens = estimateMessagesTokens(live.messages) + live.systemEst;
    const budget = budgetOf(contextWindow);
    return {
      estTokens,
      contextWindow,
      budget,
      ratio: contextWindow > 0 ? Math.min(1, estTokens / budget) : 0,
      breakdown: { system: live.systemEst, messages: estTokens - live.systemEst, reserved: contextWindow - budget },
      compactions: live.sessionFile.compactions.length,
    };
  }

  // ---- 权限引擎（F5） ----

  private async requestPermission(
    record: AgentTaskRecord,
    live: LiveSession,
    toolName: string,
    req: PermissionRequest,
    subtaskId?: string,
  ): Promise<boolean> {
    if (req.rememberable !== false && live.approved.has(toolName)) return true;
    // 持久规则 allow（deny 已在 toolset 门拦截；此处兜底）
    const rules = (this.deps.settings.current.agentRules ?? []) as import("../../shared/types").AgentPermissionRuleDTO[];
    const sig = req.command ?? req.detail;
    for (const r of rules) {
      if (r.tool !== toolName || r.effect !== "allow") continue;
      if (r.scope === "repo" && r.repoPath && this.repoOrNull() && r.repoPath !== this.repoOrNull()) continue;
      if (r.pattern === null || r.pattern === "" || (sig && sig.startsWith(r.pattern))) return true;
    }
    const requestId = randomUUID();
    record.state = "awaiting-permission";
    this.deps.onBusEvent?.("agent.permission.raised", { taskId: record.taskId, subtaskId: subtaskId ?? null, toolName, requestId, payload: req.payload ?? null });
    this.emit(record, {
      type: "permission",
      title: req.title,
      detail: req.detail,
      command: req.command ?? null,
      requestId,
      toolName,
      payload: req.payload,
      rememberable: req.rememberable !== false,
      subtaskId,
    });
    this.scheduleSave();
    return new Promise<boolean>((resolve) => {
      live.perms.set(requestId, (ok, remember) => {
        if (ok && remember && req.rememberable !== false) live.approved.add(toolName);
        record.state = "working";
        this.deps.onBusEvent?.("agent.permission.decided", { taskId: record.taskId, toolName, requestId, approved: ok, remembered: !!remember });
        resolve(ok);
      });
    });
  }

  private async askUser(
    record: AgentTaskRecord,
    live: LiveSession,
    question: string,
    options: string[],
    subtaskId?: string,
  ): Promise<string> {
    const requestId = randomUUID();
    record.state = "awaiting-input";
    this.emit(record, { type: "question", question, options, requestId, subtaskId });
    this.scheduleSave();
    return new Promise<string>((resolve) => {
      live.questions.set(requestId, { options, resolve });
    });
  }

  private async submitPlan(
    record: AgentTaskRecord,
    live: LiveSession,
    plan: string,
  ): Promise<{ status: "approved" | "revised"; feedback?: string }> {
    live.planSubmittedThisTurn = true;
    const requestId = randomUUID();
    record.state = "awaiting-input";
    this.emit(record, { type: "plan", plan, requestId });
    this.scheduleSave();
    const decision = await new Promise<{ ok: boolean; feedback?: string }>((resolve) => {
      live.plans.set(requestId, resolve);
    });
    const entry: PlanHistoryEntry = { ts: new Date().toISOString(), plan, decision: decision.ok ? "approved" : "revised", feedback: decision.feedback };
    record.planHistory = [...(record.planHistory ?? []), entry];
    if (decision.ok) {
      record.permissionMode = "default";
      live.planApproved = plan;
      this.emit(record, { type: "log", level: "info", text: "计划已批准 → 本轮结束后自动开始执行" });
    }
    this.putRecord(record);
    return { status: decision.ok ? "approved" : "revised", feedback: decision.feedback };
  }

  // ---- 子代理（F9） ----

  private async spawnSubtask(
    record: AgentTaskRecord,
    live: LiveSession,
    targs: { name: string; prompt: string; mode: string },
  ): Promise<string> {
    const max = Math.max(1, this.deps.settings.current.agentsMaxSubagents ?? 3);
    while (live.subtaskRunning >= max) {
      if (live.abort?.signal.aborted) return "（会话中断，子代理未启动）";
      await new Promise((r) => setTimeout(r, 300));
    }
    live.subtaskRunning++;
    try {
      const rr = this.deps.resolveModel(record.modelRef, record.thinking);
      if (!rr.ok) return `子代理模型不可用：${rr.error}`;
      const ctx = live.turnCtx ?? (await collectRepoContext(record.worktreePath));
      const result = await runSubtask({
        name: targs.name,
        prompt: targs.prompt,
        mode: targs.mode,
        worktreePath: record.worktreePath,
        taskId: record.taskId,
        mode_: record.permissionMode ?? "default",
        signal: live.abort?.signal ?? new AbortController().signal,
        model: rr.model,
        thinking: record.thinking,
        context: ctx,
        readLog: live.readLog,
        shells: live.shells,
        requestPermission: (toolName, req, subtaskId) => this.requestPermission(record, live, toolName, req, subtaskId),
        askUser: (question, options, subtaskId) => this.askUser(record, live, question, options, subtaskId),
        emit: (ev) => this.emit(record, ev),
        parentAllowedTools: live.taskType.tools ?? null,
        parentPolicy: live.taskType.policy,
        rules: (this.deps.settings.current.agentRules ?? []) as never,
        repoPath: this.repoOrNull(),
      });
      // F9.3：子 transcript 持久化（cap 20 份，逐出最旧）+ usage 挂父档案
      try {
        const dir = path.join(this.needRepo(), ".git", "gitter", "agent-sessions", record.taskId, "subtasks");
        await fsp.mkdir(dir, { recursive: true });
        const file = path.join(dir, `${result.subtaskId}.json`);
        await fsp.writeFile(file, JSON.stringify({
          version: 1, subtaskId: result.subtaskId, name: targs.name, mode: targs.mode,
          prompt: targs.prompt, state: result.state, finalMessage: result.text,
          durationMs: result.durationMs, ts: new Date().toISOString(), messages: result.messages,
        }, null, 2), "utf8");
        const files = (await fsp.readdir(dir)).filter((f) => f.endsWith(".json"));
        if (files.length > 20) {
          const stats = await Promise.all(files.map(async (f) => ({ f, m: (await fsp.stat(path.join(dir, f))).mtimeMs })));
          for (const { f } of stats.sort((a, b) => a.m - b.m).slice(0, files.length - 20)) {
            await fsp.rm(path.join(dir, f), { force: true });
          }
        }
      } catch {
        /* transcript 落盘失败不阻塞 */
      }
      if (result.usage) this.deps.addUsage(rr.profileRef, result.usage);
      return result.text;
    } finally {
      live.subtaskRunning--;
    }
  }

  // ---- 持久化 ----

  private updateChangeSet(live: LiveSession, p: string, kind: FileChangeKind, summary?: string): void {
    const m = /\+(\d+)\s*−\s*(\d+)/.exec(summary ?? "") ?? /\+(\d+)\s*-\s*(\d+)/.exec(summary ?? "");
    live.changeSet.set(p, {
      kind,
      added: m ? parseInt(m[1], 10) : 0,
      deleted: m ? parseInt(m[2], 10) : 0,
    });
  }

  private flushJournal(live: LiveSession): void {
    const repo = this.repoOrNull();
    if (!repo || live.journal.length === 0) return;
    try {
      appendJournalFile(repo, live.record.taskId, live.journal);
      live.journal = [];
    } catch {
      /* 冲刷失败不阻断 */
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const repo = this.repoOrNull();
      if (!repo) return;
      const file = loadAgentTasks(repo);
      for (const s of this.live.values()) {
        upsertTask(file, s.record);
        this.flushJournal(s);
        saveSessionFile(repo, s.sessionFile);
      }
      saveAgentTasks(repo, file);
      this.deps.send("agent.tasks.changed", {});
    }, 250);
  }

  private emit(record: AgentTaskRecord, ev: AgentSessionEvent): void {
    const live = this.live.get(record.taskId);
    if (live) {
      live.journal.push({ ts: new Date().toISOString(), actor: ev.type === "checkpoint" || ev.type === "log" ? "host" : "agent", kind: "event", event: ev });
      if (live.journal.length > JOURNAL_BUFFER_CAP) live.journal.splice(0, live.journal.length - JOURNAL_BUFFER_CAP);
    }
    this.deps.send("agent.event", { taskId: record.taskId, event: ev });
  }

  private journalHuman(record: AgentTaskRecord, live: LiveSession | null | undefined, text: string): void {
    const entry: SessionJournalEntry = { ts: new Date().toISOString(), actor: "human", kind: "text", text };
    if (live) {
      live.journal.push(entry);
      if (live.journal.length > JOURNAL_BUFFER_CAP) live.journal.splice(0, live.journal.length - JOURNAL_BUFFER_CAP);
    }
    this.scheduleSave();
  }

  private putRecord(record: AgentTaskRecord): void {
    const repo = this.needRepo();
    const file = loadAgentTasks(repo);
    upsertTask(file, record);
    saveAgentTasks(repo, file);
  }

  private recordOf(taskId: string): AgentTaskRecord {
    const repo = this.needRepo();
    const live = this.live.get(taskId);
    if (live) return live.record;
    const record = findTask(loadAgentTasks(repo), taskId);
    if (!record) throw new Error("任务不存在");
    return normalizeRecord(record);
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
