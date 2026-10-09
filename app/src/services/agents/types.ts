import type { HarnessContribution, HarnessTransport } from "../extensions/schema";

/**
 * Agent 宿主接口与事件模型（agent-harness.md v3.0 §四 + v4.0 F1/F5/F8/F9）。
 * v4 增量：权限模式（plan/default/yolo）、结构化授权卡 payload、tool/todo/plan/subtask 事件族、
 * 任务记录扩展（permissionMode/todoState/planHistory/queued）。
 * C# 冻结版的同构 TS 平移：授权回执走 requestId + invoke，回调留在宿主。
 */

export type { HarnessTransport };
export type HarnessCapability =
  | "structured-events"
  | "checkpoints"
  | "session-diff"
  | "feedback-channel"
  | "permission-prompts"
  | "resume"
  | "prompt-submission"
  | "file-watch";

export type SubmissionMode = "none" | "next-turn" | "streaming";

export interface HarnessDescriptor {
  fullId: string;
  packageId: string;
  harnessId: string;
  displayName: string;
  transport: HarnessTransport;
  fallback: HarnessTransport | null;
  capabilities: string[];
  submissionMode: SubmissionMode;
  identity: { assistedBy: string };
  versionPattern: string | null;
}

export type AgentPhase =
  | "starting"
  | "thinking"
  | "editing"
  | "running-command"
  | "running-tests"
  | "awaiting-input"
  | "idle"
  | "finished";

export type AgentOutcome = "completed" | "failed" | "cancelled";

export type FileChangeKind = "added" | "modified" | "deleted" | "renamed" | "read-image";

/** 权限模式（三档）：plan 只读出计划 / default 自动执行（高危命令逐次确认）/ yolo 完全访问免确认。 */
export type PermissionMode = "plan" | "default" | "yolo";

export type TodoStatus = "pending" | "in_progress" | "completed";
export interface TodoItem {
  content: string;
  status: TodoStatus;
}

/** 计划历史（F8：planHistory，重启回放）。 */
export interface PlanHistoryEntry {
  ts: string;
  plan: string;
  decision: "approved" | "revised";
  feedback?: string;
}

/** 结构化授权卡 payload（F5.2）：渲染层按 kind 分型渲染。 */
export type PermissionPayloadKind =
  | "command" | "git-stage" | "git-commit" | "git-push" | "mcp" | "plugin" | "restore" | "fs-outside";

export interface PermissionPayload {
  kind: PermissionPayloadKind;
  paths?: string[];
  diffStat?: string;
  risk?: "high" | "medium" | null;
  source?: string | null;
}

/** 子代理状态（F9：事件与回放）。 */
export type SubtaskState = "running" | "completed" | "failed" | "timeout" | "cancelled";

/** 判别联合：结构化克隆安全，可跨 preload bridge。 */
export type AgentSessionEvent =
  | { type: "status"; phase: AgentPhase; summary?: string }
  | { type: "output"; text: string; stream: "terminal" | "assistant" | "tool" | "thinking"; subtaskId?: string }
  | { type: "checkpoint"; commitSha: string; summary: string }
  | {
      type: "permission";
      title: string;
      detail: string;
      command: string | null;
      requestId: string;
      /** 触发工具名（"总是允许前缀"写持久规则用） */
      toolName?: string;
      payload?: PermissionPayload;
      rememberable?: boolean;
      subtaskId?: string;
    }
  | { type: "question"; question: string; options: string[]; requestId: string; subtaskId?: string }
  | { type: "plan"; plan: string; requestId: string }
  | { type: "completed"; outcome: AgentOutcome; summary?: string; exitCode?: number | null }
  | { type: "session-meta"; externalSessionId: string }
  | { type: "file-change"; path: string; kind: FileChangeKind; summary?: string; subtaskId?: string }
  | { type: "turn-completed"; usage?: { input?: number; output?: number }; lastMessage?: string }
  | {
      type: "tool";
      phase: "start" | "end";
      callId: string;
      name: string;
      args?: unknown;
      result?: string;
      durationMs?: number;
      isError?: boolean;
      source?: string | null;
      subtaskId?: string;
    }
  | { type: "todo"; todos: TodoItem[] }
  | {
      type: "subtask";
      subtaskId: string;
      name: string;
      mode: string;
      state: SubtaskState;
      finalMessage?: string;
      durationMs?: number;
    }
  | { type: "log"; level: "debug" | "info" | "warn" | "error"; text: string };

/** 任务↔会话账本条目（.git/gitter/agent-tasks.json）。 */
export interface AgentTaskRecord {
  taskId: string;
  title: string;
  /** 全限定 harness id（内置 = builtin/gitter-agent） */
  harnessFullId: string;
  worktreePath: string;
  branch: string;
  /** 外部会话号——v3.0 自有循环下作废，保留字段兼容旧账本 */
  externalSessionId: string | null;
  /** 会话基线（squash 视角 diff 起点，spawn 时 worktree HEAD） */
  baselineSha: string;
  state:
    | "starting"
    | "working"
    | "awaiting-input"
    | "awaiting-permission"
    | "completed"
    | "failed"
    | "interrupted"
    | "stopped";
  exitCode: number | null;
  createdAt: string;
  lastActiveAt: string | null;
  lastMessage: string | null;
  /** 模型档案全限定 id（下一轮生效的徽标切换目标） */
  modelRef: string | null;
  /** 任务型全限定 id（builtin/free = 自由任务） */
  taskType: string | null;
  /** 循环实现 id（缺省 builtin.default） */
  loopId: string | null;
  /** 思考深度 */
  thinking: ThinkingLevel;
  /** 权限模式（plan/default/yolo：计划/默认/完全访问；持久，resume 保持） */
  permissionMode: PermissionMode;
  /** todo 清单最新状态（F8：重启回放） */
  todoState: TodoItem[] | null;
  /** 计划历史（F8：批准/修订链） */
  planHistory: PlanHistoryEntry[];
  /** 排队投递（F10.4：working 中用户补充，turn 边界注入） */
  queued: string[];
  /** 归档（列表默认过滤，可恢复） */
  archived: boolean;
}

export type ThinkingLevel = "off" | "low" | "medium" | "high";

/** agents.list RPC 条目：descriptor + 探测结果 + 编译错误。 */
export interface AgentHarnessDTO {
  fullId: string;
  packageId: string;
  packageName: string;
  harnessId: string;
  displayName: string;
  /** "internal" = 内置 Gitter Agent 循环（进程内）；其余为外部桥形态（封存扩展点） */
  transport: HarnessTransport | "internal";
  fallback: HarnessTransport | null;
  capabilities: string[];
  submissionMode: SubmissionMode;
  identity: { assistedBy: string };
  /** 探测结果（安装时置灰 + 提示安装方式的依据） */
  detect: { available: boolean; version: string | null; reason: string | null };
  /** manifest/编译错误（不可用原因，区别于未安装） */
  error: string | null;
}

/** LaunchSpec = manifest harness 段的编译产物（catalog 编译并校验模板占位符）。 */
export interface HarnessLaunchSpec {
  fullId: string;
  packageId: string;
  harnessId: string;
  displayName: string;
  descriptor: HarnessDescriptor;
  spawn: HarnessContribution["spawn"];
  resume: HarnessContribution["resume"];
  stopMode: "kill" | "graceful-signal";
  hostServices: string[];
  permissions: HarnessContribution["permissions"];
  promptTemplates: HarnessContribution["promptTemplates"];
  /** 事件映射编译产物（null = 声明式映射缺失，仅 cli-pty 退化形态） */
  eventMap: import("./events").CompiledEventMap | null;
}

/** 上下文用量（F7：contextStats RPC 返回）。 */
export interface AgentContextStats {
  estTokens: number;
  contextWindow: number;
  budget: number;
  ratio: number;
  breakdown: { system: number; messages: number; reserved: number };
  compactions: number;
  /** 会话累计输入/输出 token（usageHistory 汇总；无记录时缺省） */
  totalInput?: number;
  totalOutput?: number;
  /** 最近一轮输出 token 与生成速度（tok/s） */
  lastOutput?: number;
  tokPerSec?: number;
  /** 最近一轮缓存命中率（cacheRead / input，0~1） */
  cacheHitRate?: number;
}
