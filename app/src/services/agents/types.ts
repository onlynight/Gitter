import type { HarnessContribution, HarnessTransport } from "../extensions/schema";

/**
 * Agent 宿主接口与事件模型（agent-harness-codex.md v2.0 §四）。
 * C# 冻结版（src/GitUI.Core/Agents/AgentHarness.cs）的同构 TS 平移：
 * Flags 枚举 → 字符串字面量联合（与 manifest 直转）；授权回执走 requestId + invoke，回调留在宿主。
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

export type FileChangeKind = "added" | "modified" | "deleted" | "renamed";

/** 判别联合：结构化克隆安全，可跨 preload bridge。 */
export type AgentSessionEvent =
  | { type: "status"; phase: AgentPhase; summary?: string }
  | { type: "output"; text: string; stream: "terminal" | "assistant" | "tool" }
  | { type: "checkpoint"; commitSha: string; summary: string }
  | { type: "permission"; title: string; detail: string; command: string | null; requestId: string }
  | { type: "question"; question: string; options: string[]; requestId: string }
  | { type: "completed"; outcome: AgentOutcome; summary?: string; exitCode?: number | null }
  | { type: "session-meta"; externalSessionId: string }
  | { type: "file-change"; path: string; kind: FileChangeKind; summary?: string }
  | { type: "turn-completed"; usage?: { input?: number; output?: number }; lastMessage?: string }
  | { type: "log"; level: "debug" | "info" | "warn" | "error"; text: string };

/** 任务↔会话账本条目（.git/gitter/agent-tasks.json，agent-harness-codex.md v2.0 §三）。 */
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
  /** 模型档案全限定 id（task-model-modules.md §2.2，下一轮生效的徽标切换目标） */
  modelRef: string | null;
  /** 任务型全限定 id（builtin/free = 自由任务） */
  taskType: string | null;
  /** 循环实现 id（G7：taskType→loop 绑定或 createTask 显式指定；缺省 builtin.default） */
  loopId: string | null;
  /** 思考深度（ZCode reasoning-effort 语义：循环侧 providerOptions + 系统提示词双通道） */
  thinking: ThinkingLevel;
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
