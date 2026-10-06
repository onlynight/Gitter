// 自动生成：scripts/gen-ui-sdk.mjs —— 不要手改（再生成：node scripts/gen-ui-sdk.mjs）
// 数据 API 版本：v3
// 契约冻结政策：修改 web/src/bridge/types.ts 对外类型 → 递增 DATA_API_VERSION → 重新生成
// 兼容查询：宿主桥 RPC "api.info" 返回 { dataApiVersion, hostApiVersion }

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

// ---- GITTER_UI 全局 API（宿主注入；外部页脚本直接使用，无需 import） ----

/** 宿主注入的 UI SDK（内置页面包恒可用；用户页面包受 allowCodePlugins 门控）。
 * 除 registerPage/getState/subscribeState 外与内置 pageSdk 同实现（web/src/surface.ts 单一源）。 */
declare var GITTER_UI: GITTER_UI_API;

interface GITTER_UI_API {
  /** 注册外部页面：id 自动加 ext.<包id>. 前缀；身份（标题/图标/权限/顺序）来自 manifest 元数据，def 只需 id */
  registerPage(
    def: { id: string; title?: string; icon?: string; order?: number },
    mount: (container: HTMLElement, ctx: ExternalPageContext) => void | (() => void),
  ): void;
  /** 宿主桥调用（按 manifest permissions 声明过滤，advisory） */
  call<T = unknown>(method: string, params?: unknown): Promise<T>;
  /** 订阅宿主事件（ui.notify / sync.progress / repo.opened / agent.stream / context.changed / extensions.changed 等） */
  on(method: string, cb: (params: never) => void): () => void;
  /** i18n（宿主当前语言字典） */
  t(key: string, ...args: (string | number)[]): string;
  /** 导航到页面槽位 */
  navigate(page: string): void;
  /** 打开设置页并定位区块 */
  openSettings(section?: string): void;
  /** 通知 toast */
  toast(title: string, body?: string): void;
  /** 触发全局刷新（F5 语义） */
  refresh(): void;
  /** 当前仓库 */
  repo(): { workDir: string; name: string } | null;
  /** 当前设置快照 */
  settings(): SettingsDTO | null;
  /** 当前主题状态 */
  theme(): ThemeStateDTO | null;
  /** 打开仓库（projects.open + 导航到 log；Projects/替换页用） */
  openRepo(path: string): Promise<void>;
  /** 关闭当前仓库 */
  closeRepo(): void;
  /** 命令执行唯一入口（首跑确认/模板插值/路由在宿主） */
  runCommand(cmd: { id: string; title?: string; titleKey?: string }, ctx?: { filePath?: string | null }): Promise<void>;
  /** 共享上下文（repo + selectedFile/selectedCommitSha 镜像） */
  context(): {
    repo: { workDir: string; name: string } | null;
    selectedFile: { path: string; staged: boolean; isNew: boolean; isConflict: boolean } | null;
    selectedCommitSha: string | null;
  };
  /** 共享上下文写 */
  setContext(patch: { selectedFile?: { path: string; staged: boolean; isNew: boolean; isConflict: boolean } | null; selectedCommitSha?: string | null }): void;
  /** 设置更新（持久化 + 回写 + 主题/语言/差异模式按需重应用） */
  updateSettings(patch: Partial<SettingsDTO>): Promise<SettingsDTO>;
  /** 回写设置快照（专用 RPC 返回新快照后） */
  applySettings(s: SettingsDTO): void;
  /** 重取主题并落到 DOM */
  reloadTheme(): Promise<void>;
  /** 清空设置页定位信号 */
  clearSettingsFocus(): void;
  /** 任务聚焦信号（Log 会话卡 → TasksPage） */
  focusTask(taskId: string): void;
  clearTaskFocus(): void;
  /** 宿主活状态快照（配合 subscribeState 组装 useSyncExternalStore） */
  getState(): AppStateSnapshot;
  /** 订阅宿主状态变化（setState 即触发；返回退订函数） */
  subscribeState(cb: () => void): () => void;
  /** 装载期窗口内可取：当前注入包的 caller 身份（适配层在入口脚本 eval 期捕获） */
  getActiveCaller(): { packageId: string; permissions?: string[] } | null;
  /** 以显式 caller 调桥（页面挂载后的全部调用走这里） */
  callWith<T = unknown>(caller: { packageId: string; permissions?: string[] } | null, method: string, params?: unknown): Promise<T>;
}

/** 宿主状态快照（渲染层 AppState 的只读镜像；字段见 web/src/state/store.ts） */
interface AppStateSnapshot {
  booted: boolean;
  page: string;
  repo: { workDir: string; name: string } | null;
  settings: SettingsDTO | null;
  theme: ThemeStateDTO | null;
  i18n: { lang: string; strings: Record<string, string> } | null;
  refreshTick: number;
  context: {
    selectedFile: { path: string; staged: boolean; isNew: boolean; isConflict: boolean } | null;
    selectedCommitSha: string | null;
  };
  [key: string]: unknown;
}

/** mount 收到的宿主上下文（packageId = 本包反向域名；其余与 GITTER_UI 同面） */
interface ExternalPageContext extends Omit<GITTER_UI_API, "registerPage" | "getState" | "subscribeState"> {
  packageId: string;
}

/** window.GITTER_KIT：宿主启动时组装的 React 单实例 + 内核组件库（web/src/kitGlobal.ts）。
 * 页面构建把 react/jsx-runtime/react-dom(+/client) 声明为 GITTER_KIT.* globals external。 */
declare var GITTER_KIT: {
  React: unknown;
  ReactDOM: unknown;
  ReactDOMClient: { createRoot(container: Element): { render(node: unknown): void; unmount(): void } };
  ReactJSXRuntime: unknown;
  DiffView: unknown;
  SplitPane: unknown;
  Banner: unknown;
  Modal: unknown;
  SyncBar: unknown;
  PageErrorBoundary: unknown;
  NavIcon: unknown;
  useContextMenu: () => unknown;
  renderMarkdown: (text: string) => string;
  registerMarkdownPlugin: (plugin: unknown) => void;
  [key: string]: unknown;
};

/** 权限域（contributes.pages[].permissions；缺省 = ["open", "git.read"]） */
type UiPermission =
  | "open" | "git.read" | "git.write" | "settings.write"
  | "agent.run" | "agent.config" | "extensions.admin"
  | "terminal" | "ai.invoke" | "approval" | "window" | "webview";
