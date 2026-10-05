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

/** TextMate 主题贡献（VS Code 主题 JSON 的 tokenColors 形状，extension-system-v2.md §八）。 */
export interface TokenColorDTO {
  scope: string | string[];
  settings: { foreground?: string; fontStyle?: string };
}

export interface ThemeStateDTO {
  base: "dark" | "light";
  activeId: string | null;
  tokens: Record<string, string>; // 令牌名 → #RRGGBB(AA)
  diff: Record<string, string>;
  terminal: Record<string, string>;
  syntax: Record<string, string>; // 高亮 style → 颜色
  /** TextMate tokenColors（主题包提供；缺省 = 主进程由 syntax 语义键映射兜底） */
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
  /** 扩展包账本（extension-system-v2.md §五）：启停/按 kind 启停/包配置 */
  packages: Record<string, PackageLedgerDTO>;
}

/** settings.packages[id]：启停账本（缺省 = 全部启用）。 */
export interface PackageLedgerDTO {
  enabled?: boolean;
  kinds?: Record<string, boolean>;
  config?: Record<string, unknown>;
}

/** 扩展包列表项（extensions.list RPC）。 */
export interface ExtensionPackageDTO {
  id: string;
  name: string;
  version: string;
  description: string | null;
  isBuiltIn: boolean;
  /** 由 contributes 推导：theme / grammar / commands / configuration */
  kinds: string[];
  state: "active" | "disabled" | "error";
  /** error / engines 不满足的原因（设置页展示） */
  reason: string | null;
  kindStates: Record<string, boolean>;
  /** contributes.configuration 的 schema（设置页自动渲染，值存 packages[id].config） */
  configuration: { key: string; type: "string" | "boolean" | "number"; default: string | boolean | number; title: string | null }[];
}

/** 命令注册表条目（commands.list RPC）：内置命令带 *Key（i18n 键），包命令带 title/packageId。 */
export interface CommandDTO {
  id: string;
  titleKey?: string;
  title?: string;
  categoryKey?: string;
  category?: string;
  keyHint?: string;
  when?: "repoOpen";
  /** L1 受限命令的宿主动作（仅包命令有） */
  action?: string;
  args?: unknown;
  packageId?: string;
}

export interface I18nDTO {
  lang: "en" | "zh-Hans";
  strings: Record<string, string>;
}
