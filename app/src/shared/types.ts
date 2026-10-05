// 桥 DTO（渲染层 ↔ 主进程）。与 web/src/bridge/types.ts 保持镜像（手工同步；
// 对等账本见 docs/winui3-to-web-migration.md §十三）。

export interface CommitDTO {
  sha: string;
  shortSha: string;
  subject: string;
  body: string;
  author: string;
  authorEmail: string;
  authorDate: number; // unix 秒
  committerDate: number;
  parents: string[];
  refs: RefDTO[]; // 分支/标签徽章（git log %D 解析）
  assistedBy: string[]; // Assisted-By trailer（会话分组/agent 过滤）
  sessionId: string | null; // Gitter-Session trailer（会话分组键）
}

export interface RefDTO {
  name: string;
  isTag: boolean;
}

export interface FileMetaDTO {
  path: string;
  oldPath?: string;
  statusCode: string; // M/A/D/R/U
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
  tokens: Record<string, string>; // 令牌名 → #RRGGBB(AA)
  diff: Record<string, string>;
  terminal: Record<string, string>;
  syntax: Record<string, string>; // 高亮 style → 颜色
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
  terminalShell: "powershell" | "cmd" | "bash";
  watchWorktree: boolean;
  autoFetch: boolean;
  autoFetchIntervalMinutes: number;
  recentCommands: string[];
  /** AI 网关（ai-native-redesign.md §8.1 的 TS 移植） */
  aiProvider: "off" | "openai" | "anthropic" | "cli";
  aiEndpoint: string | null;
  aiModel: string | null;
  aiCliCommand: string | null;
  aiPrivacy: "metadataOnly" | "fullDiff" | "disabled";
  aiAppendTrailer: boolean;
  aiApiKeyProtected: string | null; // safeStorage 密文 base64
  /** 提交安全网（规则引擎，纯规则零 AI 依赖） */
  safetyNet: "off" | "warn" | "block";
  /** MCP 管道宿主（随仓库启停） */
  mcpEnabled: boolean;
  /** 页面分割条位置（比例）持久化 */
  logSplitterFraction: number | null;
  changesSplitterFraction: number | null;
}

export interface I18nDTO {
  lang: "en" | "zh-Hans";
  strings: Record<string, string>;
}
