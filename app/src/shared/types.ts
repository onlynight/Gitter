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
  /** log.decorators 接缝（C 阶段）：插件贡献的只读徽章 */
  decorations?: { text: string; color?: string }[];
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

export interface TagItemDTO {
  name: string;
  shortSha: string;
  subject: string;
}

export interface BranchesStateDTO {
  workDir: string | null;
  current: string | null;
  local: BranchItemDTO[];
  remote: BranchItemDTO[];
  tags: TagItemDTO[];
}

export interface DeletePreviewDTO {
  forceRequired: boolean;
  lostCount: number;
  lostSamples: { shortSha: string; subject: string }[];
}

export interface ReflogEntryDTO {
  sha: string;
  shortSha: string;
  /** reflog 选择子（如 dev@{0}，0 = 最新） */
  selector: string;
  /** reflog 描述（commit: xxx / reset: moving to xxx 等） */
  subject: string;
  /** unix 秒 */
  timestamp: number;
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
  /** 包覆盖的亮暗档（多主题包 = ["dark","light"]；第三方单文档 = 单元素） */
  bases: ("dark" | "light")[];
  /** 窗口背景材质（窗口效果唯一事实源） */
  material: "none" | "mica" | "acrylic";
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
  /** 窗口背景材质（来自主题包声明；none = 不透明） */
  material: "none" | "mica" | "acrylic";
  /** 包内命中的主题文档 id（多主题包 = "dark"/"light"） */
  themeId: string | null;
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
  terminalShell: string; // 内置 powershell|cmd|bash 或包档位 ext.<pkg>.<id>（terminalProfiles 接缝）
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
  /** 终端页 Git 文档面板分栏比例（design/terminal-git-docs-mockup.html） */
  terminalDocFraction: number | null;
  /** 扩展包账本（extension-system-v2.md §五）：启停/按 kind 启停/包配置 */
  packages: Record<string, PackageLedgerDTO>;
  /** L1 命令首跑确认账本（已确认的命令 id，terminal.run 类） */
  confirmedCommands: string[];
  /** L2 代码插件装载门（extension-system-v2.md §16.3：只走审核渠道，默认关） */
  allowCodePlugins: boolean;
  /** 包声明的外部 MCP server 连接门（mcpServers 接缝，默认关） */
  externalMcpEnabled: boolean;
  /** Agent 宿主（agent-harness-codex.md v2.0 §六）：托管 checkpoint 与退出策略 */
  agentsCheckpoint: boolean;
  agentsOnExit: "terminate" | "keep";
  /** Agent 权限规则（agent-harness-v4.md F5.3：deny > allow > 分级基线） */
  agentRules: AgentPermissionRuleDTO[];
  /** 上下文压缩策略（F7：auto=80% 阈值自动 / manual=仅 /compact / off） */
  agentsCompaction: "auto" | "manual" | "off";
  /** 压缩数据面调参（§20.3.3：threshold ∈ [0.5,0.95]，keepLast ∈ [4,32]） */
  agentsCompactionPolicy: { threshold?: number; keepLast?: number };
  /** post-turn 钩子总开关（§20.3.6，默认开） */
  agentsPostTurnHooks: boolean;
  /** D5 任务完成 OS 通知 */
  agentsNotify: boolean;
  /** 子代理并发上限（F9） */
  agentsMaxSubagents: number;
  /** MCP 工具入 agent 循环（F12.4：信任门，默认关；server 级随 externalMcpEnabled） */
  agentsExternalMcpTools: boolean;
  /** 模型档案（task-model-modules.md §二）：用户档案 + 缺省链 + 用量累计 */
  models: UserModelProfileDTO[];
  defaultModelId: string | null;
  fastModelId: string | null;
  modelUsage: Record<string, { turns: number; inputTokens: number; outputTokens: number }>;
}

/** 持久授权规则（settings.agentRules；pattern null=工具全量，否则签名前缀）。 */
export interface AgentPermissionRuleDTO {
  id: string;
  tool: string;
  pattern: string | null;
  effect: "allow" | "deny";
  scope: "global" | "repo";
  repoPath?: string | null;
  createdAt: string;
}

/** 思考深度档位（任务级可覆盖档案默认值）。 */
export type ThinkingLevel = "off" | "low" | "medium" | "high";

/** 用户模型档案（settings.models[]；包模板实例化后也落在这里，同 fullId 遮蔽模板）。 */
export interface UserModelProfileDTO {
  id: string; // 全限定：user/<slug> 或 <包id>/<模型id>（遮蔽模板）
  name: string;
  kind: "openai-compatible" | "anthropic";
  baseURL: string;
  modelId: string;
  /** safeStorage 密文 base64（keyRef 即档案 id） */
  apiKeyProtected: string | null;
  params?: { temperature?: number; maxOutputTokens?: number };
  /** 默认思考深度（添加模型时配置，默认 medium；任务输入台可逐次覆盖） */
  thinking?: ThinkingLevel;
  capabilities: { tools: boolean; streaming: boolean; contextTokens?: number; /** D1 多模态：可接收图片输入 */ vision?: boolean };
  tags: string[];
}

/** models.discover 条目：/models 列表项原始形状（OpenAI 兼容 / Anthropic 均归一到此）。 */
export interface ModelDiscoveryEntryDTO {
  id: string;
  name: string;
  /** OpenAI v1/v2 原生模型卡的上下文窗口；null = 端点未提供 */
  contextTokens: number | null;
  /** 原生模型卡 image 类输入模态（v3 模型卡）；null = 端点未提供 */
  image: boolean | null;
  /** 命名启发式的视觉判定（无原生声明时供 UI 置灰/勾选参考） */
  imageGuess: boolean;
  /** 命名启发式的上下文提示（无原生声明时供 UI 回填参考） */
  contextHint: number | null;
}

/** models.list RPC 条目：用户档案与包模板的合并视图。 */
export interface ModelProfileDTO {
  id: string;
  name: string;
  kind: "openai-compatible" | "anthropic";
  baseURL: string;
  modelId: string;
  source: "user" | "package";
  /** 包模板尚未实例化（未填密钥）→ 不可选 */
  configured: boolean;
  enabled: boolean;
  hasKey: boolean;
  keyHint: string | null;
  /** 档案默认思考深度（未配置视为 medium） */
  thinking?: ThinkingLevel;
  capabilities: { tools: boolean; streaming: boolean; contextTokens?: number; vision?: boolean };
  tags: string[];
  isDefault: boolean;
  isFast: boolean;
  usage: { turns: number; inputTokens: number; outputTokens: number };
  /** 分组 id（档案 id 去掉 `#成员` 后缀）。同一分组的多个模型共享名称/API URL/密钥。 */
  groupId: string;
  /** 分组成员明细（仅分组主条目携带，供设置页分组卡片与编辑回填）。 */
  groupModels?: { modelId: string; vision: boolean; contextTokens?: number; thinking: ThinkingLevel }[];
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
  /** L3 权限清单（entrySandbox=utility；设置页安装明示） */
  permissions: string[];
  /** contributes.configuration 的 schema（设置页自动渲染，值存 packages[id].config） */
  configuration: { key: string; type: "string" | "boolean" | "number"; default: string | boolean | number; title: string | null }[];
}

/** 命令注册表条目（commands.list RPC）：内置命令带 *Key（i18n 键），包命令带 title/packageId。
 * A 阶段：when 表达式宿主求值（enabled），%key% 标题按 lang 解析，confirm = 首跑确认。 */
export interface CommandDTO {
  id: string;
  titleKey?: string;
  title?: string;
  categoryKey?: string;
  category?: string;
  keyHint?: string;
  when?: string | null;
  /** L1 受限命令的宿主动作（包命令；带动作的内置命令也有） */
  action?: string;
  args?: unknown;
  packageId?: string;
  /** 首跑确认要求（terminal.run 类缺省 true） */
  confirm?: boolean;
  /** when 求值结果（宿主按调用上下文算好） */
  enabled?: boolean;
}

/** 右键菜单项（menus.list RPC，extension-system-v2.md §16.5 menus 接缝）。 */
export interface MenuDTO {
  id: string;
  location: "changesFile" | "branchRow" | "logRow";
  title: string;
  command: string;
  order: number;
  packageId?: string;
}

/** 终端档位（terminal.profiles RPC：内置 3 档 + terminalProfiles 包）。 */
export interface TerminalProfileDTO {
  id: string;
  name: string;
  source: "builtin" | "package";
}

export interface I18nDTO {
  lang: "en" | "zh-Hans";
  strings: Record<string, string>;
}
