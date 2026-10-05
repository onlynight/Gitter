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
}

export interface I18nDTO {
  lang: "en" | "zh-Hans";
  strings: Record<string, string>;
}
