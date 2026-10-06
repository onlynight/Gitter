import { z } from "zod";

/**
 * 扩展包 manifest 校验（extension-system-v2.md §五）：
 * schemaVersion 2 = contributes 贡献点；schemaVersion 1（v1 .gpk/目录，extension-package-framework.md §3.3）
 * 走兼容分支——kinds/theme 映射为 contributes.themes，syntax kind 随声明式引擎降级一并忽略。
 * 校验失败 = 拒载 + 错误账本，其余包不受影响。
 */

const ID_RE = /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/; // 反向域名

export interface ThemeContribution {
  path: string;
  base: "dark" | "light" | null;
}

export interface GrammarContribution {
  language: string;
  extensions: string[];
  path: string;
  /** 缺省时从语法文件解析 */
  scopeName: string | null;
}

export interface CommandContribution {
  id: string;
  title: string;
  category: string | null;
  keyHint: string | null;
  /** when 条件 token（空格分隔 AND，"!" 前缀取反）：repoOpen / fileSelected / config:<key> */
  when: string | null;
  /** L1 受限命令引用的宿主动作（白名单见 commands.ts HOST_ACTIONS） */
  action: string;
  args: unknown;
  /** 首跑确认（缺省：terminal.run 动作 = true） */
  confirm: boolean | null;
}

export interface MenuContribution {
  /** 本包内命令 id（装载时加 ext.<pkg>. 前缀） */
  command: string;
  location: "changesFile" | "branchRow" | "logRow";
  order: number;
}

export interface KeybindingContribution {
  command: string;
  key: string;
}

export interface TerminalProfileContribution {
  id: string;
  name: string;
  command: string;
  args: string[];
}

export interface SkillContribution {
  id: string;
  name: string;
  description: string;
  /** markdown 正文，AgentLoop 注入系统提示（L1 纯数据，安全） */
  instructions: string;
  /** 建议工具白名单（提示层引用，非强制） */
  tools: string[];
}

export type RpcScopeName =
  | "open" | "git.read" | "git.write" | "settings.write"
  | "agent.run" | "agent.config" | "extensions.admin"
  | "terminal" | "ai.invoke" | "approval" | "window";

export interface PageContribution {
  id: string;
  title: string;
  /** 渲染层入口（经典 script，相对包目录；经 window.GITTER_UI 注册） */
  entry: string;
  icon: string | null;
  /** 桥权限域声明（缺省 = open + git.read；bridge 入口按此过滤外部页调用） */
  permissions: RpcScopeName[];
}

export interface EmptyHintContribution {
  /** 插槽：changes.empty / log.empty / branches.empty */
  slot: "changes.empty" | "log.empty" | "branches.empty";
  text: string;
}

export interface McpServerContribution {
  id: string;
  name: string;
  transport: "stdio";
  command: string;
  args: string[];
  description: string | null;
}

export interface SafetyRuleContribution {
  id: string;
  pattern: string;
  flags: string;
  message: string;
  /** 缺省 = 全部文本文件 */
  fileExts: string[];
}

export interface ConfigItem {
  key: string;
  type: "string" | "boolean" | "number";
  default: string | boolean | number;
  title: string | null;
}

// ---- harness 贡献（agent-harness-codex.md v2.0 §二：L1 纯声明，宿主内置传输适配器代为执行）----

export type HarnessTransport = "cli-pty" | "cli-json" | "acp" | "mcp";

export interface HarnessDetect {
  command: string;
  args: string[];
  versionPattern: string | null;
}

export interface HarnessSpawnTemplate {
  command: string;
  args: string[];
  promptStdin: boolean;
  env: Record<string, string>;
}

export interface HarnessResumeTemplate {
  args: string[];
  promptStdin: boolean;
}

export interface HarnessEventMap {
  lineFormat: "jsonl";
  externalId: string | null;
  rules: { when: string; emit: Record<string, unknown> }[];
  unmatched: "log" | "ignore";
}

export interface HarnessContribution {
  id: string;
  transport: HarnessTransport;
  fallback: HarnessTransport | null;
  detect: HarnessDetect;
  spawn: HarnessSpawnTemplate;
  resume: HarnessResumeTemplate | null;
  stop: { mode: "kill" | "graceful-signal" };
  capabilities: string[];
  submissionMode: "none" | "next-turn" | "streaming";
  hostServices: string[];
  identity: { assistedBy: string };
  permissions: { gitWrite: string[]; outsideWorktree: boolean; network: string };
  promptTemplates: { preamble: string | null; feedback: string | null };
  events: HarnessEventMap | null;
}

// ---- models / taskTypes 贡献（task-model-modules.md §2.1/§3.1，L1 声明式）----

export interface ModelContribution {
  id: string;
  name: string;
  kind: "openai-compatible" | "anthropic";
  baseURL: string;
  modelId: string;
  keyHint: string | null;
  params: { temperature: number | null; maxOutputTokens: number | null };
  capabilities: { tools: boolean; streaming: boolean; contextTokens: number | null };
  tags: string[];
}

export interface TaskTypeContribution {
  id: string;
  name: string;
  /** 必须含 {input} 占位（用户输入落点） */
  promptTemplate: string;
  systemAddendum: string | null;
  /** 工具白名单（全集子集，全集 = agents/tools.ts PERM 键，编译期校验） */
  tools: string[];
  /** 权限覆盖：只能沿 auto→session→each-time 收紧（编译期校验）；git_push 恒 each-time */
  permissionPolicy: Record<string, "auto" | "session" | "each-time">;
  defaultModelRef: string | null;
  /** 循环实现 id（G7：taskType→loop 绑定；缺省 builtin.default） */
  defaultLoop: string | null;
}

export interface Manifest {
  schemaVersion: 1 | 2;
  id: string;
  name: string;
  version: string;
  description: string | null;
  engines: { gitter?: string } | null;
  /** L2 代码插件入口（CJS，module.exports = (ctx) => dispose|void）；缺省 = 纯数据包。装载受 settings.allowCodePlugins 门控。 */
  entry: string | null;
  /** entry 运行沙箱：host = 进程内受信（L2）；utility = 隔离子进程（L3，F 阶段，权限清单强制） */
  entrySandbox: "host" | "utility" | null;
  /** L3 权限清单（entrySandbox=utility 时宿主代理强制）：storage/notify/events/git.read/tools/statusbar */
  permissions: string[];
  /** 插件 API 版本；超过宿主支持版本 → 拒载（G 阶段 apiVersion 冻结策略） */
  apiVersion: number | null;
  contributes: {
    themes: ThemeContribution[];
    grammars: GrammarContribution[];
    commands: CommandContribution[];
    configuration: ConfigItem[];
    menus: MenuContribution[];
    keybindings: KeybindingContribution[];
    terminalProfiles: TerminalProfileContribution[];
    safetyRules: SafetyRuleContribution[];
    skills: SkillContribution[];
    mcpServers: McpServerContribution[];
    emptyHints: EmptyHintContribution[];
    pages: PageContribution[];
    harnesses: HarnessContribution[];
    models: ModelContribution[];
    taskTypes: TaskTypeContribution[];
  };
}

export type ManifestResult = { ok: true; manifest: Manifest } | { ok: false; reason: string };

const manifestV2 = z.object({
  schemaVersion: z.literal(2),
  id: z.string().regex(ID_RE, "id 必须是反向域名（如 com.example.mypack）"),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  engines: z.object({ gitter: z.string().min(1).optional() }).optional(),
  entry: z.string().min(1).nullish(),
  entrySandbox: z.enum(["host", "utility"]).nullish(),
  permissions: z.array(z.enum(["storage", "notify", "events", "git.read", "tools", "statusbar", "webview"])).nullish(),
  apiVersion: z.number().int().positive().nullish(),
  contributes: z
    .object({
      themes: z
        .array(
          z.object({
            path: z.string().min(1),
            base: z.enum(["dark", "light"]).nullish(),
          }),
        )
        .optional(),
      grammars: z
        .array(
          z.object({
            language: z.string().min(1),
            extensions: z.array(z.string().min(1)).min(1),
            path: z.string().min(1),
            scopeName: z.string().min(1).nullish(),
          }),
        )
        .optional(),
      commands: z
        .array(
          z.object({
            id: z.string().min(1),
            title: z.string().min(1), // 支持 %key% 引用包 i18n/<lang>.json
            category: z.string().nullish(),
            keyHint: z.string().nullish(),
            when: z.string().max(200).nullish(), // when 表达式 token 串（evaluateWhen 校验语义）
            action: z.string().min(1),
            args: z.unknown().optional(),
            confirm: z.boolean().nullish(),
          }),
        )
        .optional(),
      menus: z
        .array(
          z.object({
            command: z.string().min(1),
            location: z.enum(["changesFile", "branchRow", "logRow"]),
            order: z.number().int().nullish(),
          }),
        )
        .optional(),
      keybindings: z
        .array(z.object({ command: z.string().min(1), key: z.string().min(1) }))
        .optional(),
      terminalProfiles: z
        .array(
          z.object({
            id: z.string().min(1),
            name: z.string().min(1),
            command: z.string().min(1),
            args: z.array(z.string()).nullish(),
          }),
        )
        .optional(),
      safetyRules: z
        .array(
          z.object({
            id: z.string().min(1),
            pattern: z.string().min(1),
            flags: z.string().nullish(),
            message: z.string().min(1),
            fileExts: z.array(z.string()).nullish(),
          }),
        )
        .optional(),
      pages: z
        .array(
          z.object({
            id: z.string().min(1),
            title: z.string().min(1),
            entry: z.string().min(1),
            icon: z.string().nullish(),
            permissions: z.array(z.enum([
              "open", "git.read", "git.write", "settings.write",
              "agent.run", "agent.config", "extensions.admin",
              "terminal", "ai.invoke", "approval", "window",
            ])).nullish(),
          }),
        )
        .optional(),
      emptyHints: z
        .array(
          z.object({
            slot: z.enum(["changes.empty", "log.empty", "branches.empty"]),
            text: z.string().min(1),
          }),
        )
        .optional(),
      skills: z
        .array(
          z.object({
            id: z.string().min(1),
            name: z.string().min(1),
            description: z.string().min(1),
            instructions: z.string().min(1),
            tools: z.array(z.string()).nullish(),
          }),
        )
        .optional(),
      mcpServers: z
        .array(
          z.object({
            id: z.string().min(1),
            name: z.string().min(1),
            transport: z.literal("stdio"),
            command: z.string().min(1),
            args: z.array(z.string()).nullish(),
            description: z.string().nullish(),
          }),
        )
        .optional(),
      configuration: z
        .array(
          z.object({
            key: z.string().min(1),
            type: z.enum(["string", "boolean", "number"]),
            default: z.union([z.string(), z.boolean(), z.number()]),
            title: z.string().nullish(),
          }),
        )
        .optional(),
      // harness 段（agent-harness-codex.md v2.0 §二）：emit.kind 白名单在 zod 层把关，
      // when 表达式合法性由 catalog 编译期校验（发现即错误账本，不拖累其它包）。
      harnesses: z
        .array(
          z.object({
            id: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/i, "harness id 只允许字母数字与 .-"),
            transport: z.enum(["cli-pty", "cli-json", "acp", "mcp"]),
            fallback: z.enum(["cli-pty", "cli-json", "acp", "mcp"]).nullish(),
            detect: z.object({
              command: z.string().min(1),
              args: z.array(z.string()).default([]),
              versionPattern: z.string().min(1).nullish(),
            }),
            spawn: z.object({
              command: z.string().min(1),
              args: z.array(z.string()).default([]),
              promptStdin: z.boolean().default(false),
              env: z.record(z.string(), z.string()).default({}),
            }),
            resume: z
              .object({
                args: z.array(z.string()).min(1),
                promptStdin: z.boolean().default(false),
              })
              .nullish(),
            stop: z
              .object({ mode: z.enum(["kill", "graceful-signal"]).default("kill") })
              .default({ mode: "kill" }),
            capabilities: z
              .array(
                z.enum([
                  "structured-events", "checkpoints", "session-diff", "feedback-channel",
                  "permission-prompts", "resume", "prompt-submission", "file-watch",
                ]),
              )
              .default([]),
            submissionMode: z.enum(["none", "next-turn", "streaming"]).default("none"),
            hostServices: z.array(z.string()).default([]),
            identity: z
              .object({ assistedBy: z.string().min(1) })
              .default({ assistedBy: "unknown" }),
            permissions: z
              .object({
                gitWrite: z.array(z.string()).default([]),
                outsideWorktree: z.boolean().default(false),
                network: z.string().default("model-endpoint"),
              })
              .default({ gitWrite: [], outsideWorktree: false, network: "model-endpoint" }),
            promptTemplates: z
              .object({
                preamble: z.string().nullish(),
                feedback: z.string().nullish(),
              })
              .default({}),
            events: z
              .object({
                lineFormat: z.literal("jsonl"),
                externalId: z.string().min(1).nullish(),
                rules: z
                  .array(
                    z.object({
                      when: z.string().min(1),
                      emit: z
                        .object({
                          kind: z.enum([
                            "status", "output", "checkpoint", "session-meta", "file-change",
                            "turn-completed", "completed", "failed", "log",
                          ]),
                          phase: z.string().optional(),
                          summary: z.string().optional(),
                          text: z.string().optional(),
                          stream: z.string().optional(),
                          commitSha: z.string().optional(),
                          externalId: z.string().optional(),
                          path: z.string().optional(),
                          changeKind: z.string().optional(),
                          from: z.string().optional(),
                          usageIn: z.string().optional(),
                          usageOut: z.string().optional(),
                          level: z.string().optional(),
                          capture: z.enum(["lastMessage"]).optional(),
                        }),
                    }),
                  )
                  .min(1),
                unmatched: z.enum(["log", "ignore"]).default("log"),
              })
              .nullish(),
          }),
        )
        .optional(),
      models: z
        .array(
          z.object({
            id: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/i, "model id 只允许字母数字与 .-"),
            name: z.string().min(1),
            kind: z.enum(["openai-compatible", "anthropic"]),
            baseURL: z.string().min(1),
            modelId: z.string().min(1),
            keyHint: z.string().nullish(),
            params: z
              .object({
                temperature: z.number().min(0).max(2).nullish(),
                maxOutputTokens: z.number().int().positive().nullish(),
              })
              .default({}),
            capabilities: z
              .object({
                tools: z.boolean().default(true),
                streaming: z.boolean().default(true),
                contextTokens: z.number().int().positive().nullish(),
              })
              .default({ tools: true, streaming: true }),
            tags: z.array(z.string()).default([]),
          }),
        )
        .optional(),
      taskTypes: z
        .array(
          z.object({
            id: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/i, "taskType id 只允许字母数字与 .-"),
            name: z.string().min(1),
            promptTemplate: z
              .string()
              .min(1)
              .refine((v) => v.includes("{input}"), "promptTemplate 必须包含 {input} 占位符"),
            systemAddendum: z.string().nullish(),
            tools: z.array(z.string().min(1)).default([]),
            permissionPolicy: z
              .record(z.string(), z.enum(["auto", "session", "each-time"]))
              .default({}),
            defaultModelRef: z.string().nullish(),
            defaultLoop: z.string().nullish(),
          }),
        )
        .optional(),
    })
    .optional(),
});

function zodReason(e: z.ZodError): string {
  const first = e.issues[0];
  const at = first?.path?.length ? `（${first.path.join(".")}）` : "";
  return `manifest 校验失败：${first?.message ?? "未知错误"}${at}`;
}

/** 统一入口：v2 严格校验；v1（kinds/theme 形状）兼容映射；都不像 → 拒载。 */
export function normalizeManifest(raw: unknown): ManifestResult {
  if (typeof raw !== "object" || raw === null) return { ok: false, reason: "manifest 不是 JSON 对象" };
  const doc = raw as Record<string, unknown>;

  if (doc.schemaVersion === 2) {
    const r = manifestV2.safeParse(raw);
    if (!r.success) return { ok: false, reason: zodReason(r.error) };
    const c = r.data.contributes ?? {};
    return {
      ok: true,
      manifest: {
        schemaVersion: 2,
        id: r.data.id,
        name: r.data.name,
        version: r.data.version,
        description: r.data.description ?? null,
        engines: r.data.engines ?? null,
        entry: r.data.entry ?? null,
        entrySandbox: r.data.entrySandbox ?? null,
        permissions: [...(r.data.permissions ?? [])],
        apiVersion: r.data.apiVersion ?? null,
        contributes: {
          themes: (c.themes ?? []).map((t) => ({ path: t.path, base: t.base ?? null })),
          grammars: (c.grammars ?? []).map((g) => ({
            language: g.language,
            extensions: g.extensions.map(normExt),
            path: g.path,
            scopeName: g.scopeName ?? null,
          })),
          commands: (c.commands ?? []).map((cmd) => ({
            id: cmd.id,
            title: cmd.title,
            category: cmd.category ?? null,
            keyHint: cmd.keyHint ?? null,
            when: cmd.when ?? null,
            action: cmd.action,
            args: cmd.args,
            confirm: cmd.confirm ?? null,
          })),
          menus: (c.menus ?? []).map((m) => ({
            command: m.command,
            location: m.location,
            order: m.order ?? 100,
          })),
          keybindings: (c.keybindings ?? []).map((k) => ({ command: k.command, key: k.key })),
          terminalProfiles: (c.terminalProfiles ?? []).map((p) => ({
            id: p.id,
            name: p.name,
            command: p.command,
            args: [...(p.args ?? [])],
          })),
          emptyHints: (c.emptyHints ?? []).map((h) => ({ slot: h.slot, text: h.text })),
          pages: (c.pages ?? []).map((pg) => ({
            id: pg.id, title: pg.title, entry: pg.entry, icon: pg.icon ?? null,
            permissions: [...(pg.permissions ?? [])],
          })),
          skills: (c.skills ?? []).map((k) => ({
            id: k.id, name: k.name, description: k.description, instructions: k.instructions, tools: [...(k.tools ?? [])],
          })),
          mcpServers: (c.mcpServers ?? []).map((m) => ({
            id: m.id, name: m.name, transport: m.transport, command: m.command, args: [...(m.args ?? [])], description: m.description ?? null,
          })),
          safetyRules: (c.safetyRules ?? []).map((r) => ({
            id: r.id,
            pattern: r.pattern,
            flags: r.flags ?? "",
            message: r.message,
            fileExts: [...(r.fileExts ?? [])],
          })),
          configuration: (c.configuration ?? []).map((cfg) => ({
            key: cfg.key,
            type: cfg.type,
            default: cfg.default,
            title: cfg.title ?? null,
          })),
          harnesses: (c.harnesses ?? []).map((h) => ({
            id: h.id,
            transport: h.transport,
            fallback: h.fallback ?? null,
            detect: { command: h.detect.command, args: h.detect.args, versionPattern: h.detect.versionPattern ?? null },
            spawn: {
              command: h.spawn.command,
              args: h.spawn.args,
              promptStdin: h.spawn.promptStdin,
              env: h.spawn.env,
            },
            resume: h.resume ? { args: h.resume.args, promptStdin: h.resume.promptStdin } : null,
            stop: { mode: h.stop.mode },
            capabilities: [...h.capabilities],
            submissionMode: h.submissionMode,
            hostServices: [...h.hostServices],
            identity: { assistedBy: h.identity.assistedBy },
            permissions: {
              gitWrite: [...h.permissions.gitWrite],
              outsideWorktree: h.permissions.outsideWorktree,
              network: h.permissions.network,
            },
            promptTemplates: {
              preamble: h.promptTemplates?.preamble ?? null,
              feedback: h.promptTemplates?.feedback ?? null,
            },
            events: h.events
              ? {
                  lineFormat: h.events.lineFormat,
                  externalId: h.events.externalId ?? null,
                  rules: h.events.rules.map((r) => ({ when: r.when, emit: r.emit })),
                  unmatched: h.events.unmatched,
                }
              : null,
          })),
          models: (c.models ?? []).map((m) => ({
            id: m.id,
            name: m.name,
            kind: m.kind,
            baseURL: m.baseURL,
            modelId: m.modelId,
            keyHint: m.keyHint ?? null,
            params: {
              temperature: m.params?.temperature ?? null,
              maxOutputTokens: m.params?.maxOutputTokens ?? null,
            },
            capabilities: {
              tools: m.capabilities.tools,
              streaming: m.capabilities.streaming,
              contextTokens: m.capabilities.contextTokens ?? null,
            },
            tags: [...m.tags],
          })),
          taskTypes: (c.taskTypes ?? []).map((t) => ({
            id: t.id,
            name: t.name,
            promptTemplate: t.promptTemplate,
            systemAddendum: t.systemAddendum ?? null,
            tools: [...t.tools],
            permissionPolicy: { ...t.permissionPolicy },
            defaultModelRef: t.defaultModelRef ?? null,
            defaultLoop: t.defaultLoop ?? null,
          })),
        },
      },
    };
  }

  // v1 兼容（extension-package-framework.md §3.3）：kinds 数组 + theme.base
  const id = typeof doc.id === "string" ? doc.id : "";
  const name = typeof doc.name === "string" ? doc.name : "";
  if (!id || !name) return { ok: false, reason: "manifest 缺少 id/name" };
  if (!ID_RE.test(id)) return { ok: false, reason: `id 不是反向域名：${id}` };
  const kinds = Array.isArray(doc.kinds) ? doc.kinds.filter((k): k is string => typeof k === "string") : [];
  const themeBase = (doc.theme as { base?: unknown } | undefined)?.base;
  return {
    ok: true,
    manifest: {
      schemaVersion: 1,
      id,
      name,
      version: typeof doc.version === "string" ? doc.version : "0.0.0",
      description: typeof doc.description === "string" ? doc.description : null,
      engines: null,
      entry: null,
      entrySandbox: null,
      permissions: [],
      apiVersion: null,
      contributes: {
        // v1 主题包固定为 theme/theme.json（与现栈 ThemeService 读取路径一致）
        themes: kinds.includes("theme")
          ? [{ path: "theme/theme.json", base: themeBase === "light" ? "light" : themeBase === "dark" ? "dark" : null }]
          : [],
        // v1 syntax kind 随声明式引擎降级为回退层，不再作为扩展点装载
        grammars: [],
        commands: [],
        configuration: [],
        menus: [],
        keybindings: [],
        terminalProfiles: [],
        safetyRules: [],
        skills: [],
        mcpServers: [],
        emptyHints: [],
        pages: [],
        harnesses: [],
        models: [],
        taskTypes: [],
      },
    },
  };
}

function normExt(e: string): string {
  return (e.startsWith(".") ? e : `.${e}`).toLowerCase();
}
