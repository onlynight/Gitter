// 桥 DTO 镜像（与 app/src/shared/types.ts 同步）。空文件占位防误 import——实际类型从 main 转抄。
export interface CommitDTO {
  sha: string;
  shortSha: string;
  subject: string;
  body: string;
  author: string;
  authorEmail: string;
  authorDate: number;
  committerDate: number;
  parents: string[];
  refs: { name: string; isTag: boolean }[];
  assistedBy: string[];
  sessionId: string | null;
  decorations?: { text: string; color?: string }[];
}

export interface FileMetaDTO {
  path: string;
  oldPath?: string;
  statusCode: string;
  added: number | null;
  deleted: number | null;
  isBinary?: boolean;
}

export interface CommitDetailDTO {
  commit: CommitDTO;
  files: FileMetaDTO[];
  error?: string;
}

export interface HunkDTO {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  oldLines: string[];
  newLines: string[];
}

export interface DiffDTO {
  path: string;
  oldPath: string;
  isBinary: boolean;
  isNew: boolean;
  isDeleted: boolean;
  isRenamed: boolean;
  hunks: HunkDTO[];
  addedLines: number;
  deletedLines: number;
  oldEndsWithNewline: boolean;
  newEndsWithNewline: boolean;
}

export interface FileStatusDTO {
  path: string;
  category: "changes" | "staged" | "unversioned" | "conflicts";
  isConflict: boolean;
  added: number | null;
  deleted: number | null;
}

export interface ChangesStateDTO {
  workDir: string | null;
  changes: FileStatusDTO[];
  staged: FileStatusDTO[];
  unversioned: FileStatusDTO[];
  conflicts: FileStatusDTO[];
}

export interface BranchItemDTO {
  name: string;
  shortSha: string;
  subject: string;
  isHead: boolean;
  isRemote: boolean;
}

export interface BranchesStateDTO {
  workDir: string | null;
  current: string | null;
  local: BranchItemDTO[];
  remote: BranchItemDTO[];
}

export interface DeletePreviewDTO {
  forceRequired: boolean;
  lostCount: number;
  lostSamples: { shortSha: string; subject: string }[];
}

export interface ProjectDTO {
  name: string;
  path: string;
}

export interface ProjectsStateDTO {
  projects: ProjectDTO[];
  recent: ProjectDTO[];
  currentPath: string | null;
}

export interface WorktreeDTO {
  path: string;
  head: string;
  branch: string;
  isMain: boolean;
  isCurrent: boolean;
  prunable: boolean;
}

export interface TerminalSessionDTO {
  id: string;
  backend: string;
  shellKind: string;
  cwd: string | null;
  running: boolean;
  exitCode: number | null;
}

export interface ThemePackageDTO {
  id: string;
  name: string;
  base: "dark" | "light";
  isBuiltIn: boolean;
}

export interface ThemeStateDTO {
  base: "dark" | "light";
  activeId: string | null;
  tokens: Record<string, string>;
  diff: Record<string, string>;
  terminal: Record<string, string>;
  syntax: Record<string, string>;
  tokenColors?: TokenColorDTO[];
}

export interface SettingsDTO {
  theme: "system" | "light" | "dark";
  themePackageId: string | null;
  language: "system" | "en" | "zh-Hans";
  projects: ProjectDTO[];
  currentProjectPath: string | null;
  externalEditor: string | null;
  diffMode: "sideBySide" | "inline";
  sidebarCollapsed: boolean;
  bashPath: string | null;
  terminalFontFamily: string;
  terminalFontSize: number;
  terminalFollowRepo: boolean;
  terminalShell: string; // 内置 powershell|cmd|bash 或包档位 ext.<pkg>.<id>（terminalProfiles 接缝）
  watchWorktree: boolean;
  autoFetch: boolean;
  autoFetchIntervalMinutes: number;
  recentCommands: string[];
  aiProvider: "off" | "openai" | "anthropic" | "cli";
  aiEndpoint: string | null;
  aiModel: string | null;
  aiCliCommand: string | null;
  aiPrivacy: "metadataOnly" | "fullDiff" | "disabled";
  aiAppendTrailer: boolean;
  aiApiKeyProtected: string | null;
  safetyNet: "off" | "warn" | "block";
  mcpEnabled: boolean;
  logSplitterFraction: number | null;
  changesSplitterFraction: number | null;
  packages: Record<string, PackageLedgerDTO>;
  confirmedCommands: string[];
  allowCodePlugins: boolean;
  externalMcpEnabled: boolean;
  /** Agent 宿主（agent-harness.md v3.0 §六）：托管 checkpoint 与退出策略 */
  agentsCheckpoint: boolean;
  agentsOnExit: "terminate" | "keep";
  /** 模型档案（task-model-modules.md §二） */
  models: UserModelProfileDTO[];
  defaultModelId: string | null;
  fastModelId: string | null;
  modelUsage: Record<string, { turns: number; inputTokens: number; outputTokens: number }>;
}

/** 用户模型档案（settings.models[]；包模板实例化后同 fullId 遮蔽）。 */
export interface UserModelProfileDTO {
  id: string;
  name: string;
  kind: "openai-compatible" | "anthropic";
  baseURL: string;
  modelId: string;
  apiKeyProtected: string | null;
  params?: { temperature?: number; maxOutputTokens?: number };
  capabilities: { tools: boolean; streaming: boolean; contextTokens?: number };
  tags: string[];
}

/** models.list RPC 条目：用户档案与包模板的合并视图。 */
export interface ModelProfileDTO {
  id: string;
  name: string;
  kind: "openai-compatible" | "anthropic";
  baseURL: string;
  modelId: string;
  source: "user" | "package";
  configured: boolean;
  enabled: boolean;
  hasKey: boolean;
  keyHint: string | null;
  capabilities: { tools: boolean; streaming: boolean; contextTokens?: number };
  tags: string[];
  isDefault: boolean;
  isFast: boolean;
  usage: { turns: number; inputTokens: number; outputTokens: number };
}

/** agent.taskTypes.list RPC 条目。 */
export interface TaskTypeDTO {
  fullId: string;
  packageId: string;
  id: string;
  name: string;
  tools: string[];
  defaultModelRef: string | null;
  error: string | null;
}

export interface PackageLedgerDTO {
  enabled?: boolean;
  kinds?: Record<string, boolean>;
  config?: Record<string, unknown>;
}

export interface ExtensionPackageDTO {
  id: string;
  name: string;
  version: string;
  description: string | null;
  isBuiltIn: boolean;
  kinds: string[];
  state: "active" | "disabled" | "error";
  reason: string | null;
  kindStates: Record<string, boolean>;
  permissions: string[];
  configuration: { key: string; type: "string" | "boolean" | "number"; default: string | boolean | number; title: string | null }[];
}

export interface CommandDTO {
  id: string;
  titleKey?: string;
  title?: string;
  categoryKey?: string;
  category?: string;
  keyHint?: string;
  when?: string | null;
  action?: string;
  args?: unknown;
  packageId?: string;
  confirm?: boolean;
  enabled?: boolean;
}

export interface MenuDTO {
  id: string;
  location: "changesFile" | "branchRow" | "logRow";
  title: string;
  command: string;
  order: number;
  packageId?: string;
}

export interface StatusItemDTO {
  id: string;
  text: string;
  tooltip?: string;
  command?: string;
  packageId: string;
}

export interface TerminalProfileDTO {
  id: string;
  name: string;
  source: "builtin" | "package";
}

export interface TokenColorDTO {
  scope: string | string[];
  settings: { foreground?: string; fontStyle?: string };
}

export interface I18nDTO {
  lang: "en" | "zh-Hans";
  strings: Record<string, string>;
}

// ---- Agent 宿主（agent-harness-codex.md v2.0；与 app/src/services/agents/types.ts 手工同步）----

export type AgentHarnessDTO = {
  fullId: string;
  packageId: string;
  packageName: string;
  harnessId: string;
  displayName: string;
  transport: "cli-pty" | "cli-json" | "acp" | "mcp" | "internal";
  fallback: "cli-pty" | "cli-json" | "acp" | "mcp" | null;
  capabilities: string[];
  submissionMode: "none" | "next-turn" | "streaming";
  identity: { assistedBy: string };
  detect: { available: boolean; version: string | null; reason: string | null };
  error: string | null;
};

export type AgentTaskDTO = {
  taskId: string;
  title: string;
  harnessFullId: string;
  worktreePath: string;
  branch: string;
  externalSessionId: string | null;
  baselineSha: string;
  state: "starting" | "working" | "awaiting-input" | "awaiting-permission" | "completed" | "failed" | "interrupted" | "stopped";
  exitCode: number | null;
  createdAt: string;
  lastActiveAt: string | null;
  lastMessage: string | null;
  modelRef: string | null;
  taskType: string | null;
  thinking?: "off" | "low" | "medium" | "high";
  archived: boolean;
};

export type AgentEventDTO = {
  type: "status" | "output" | "checkpoint" | "permission" | "question" | "completed" | "session-meta" | "file-change" | "turn-completed" | "log";
  phase?: string;
  summary?: string;
  text?: string;
  stream?: "terminal" | "assistant" | "tool";
  commitSha?: string;
  title?: string;
  detail?: string;
  command?: string | null;
  requestId?: string;
  question?: string;
  options?: string[];
  outcome?: "completed" | "failed" | "cancelled";
  exitCode?: number | null;
  externalSessionId?: string;
  path?: string;
  kind?: string;
  usage?: { input?: number; output?: number };
  lastMessage?: string;
  level?: "debug" | "info" | "warn" | "error";
};
