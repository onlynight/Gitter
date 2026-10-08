import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type {
  AgentSessionEvent,
  FileChangeKind,
  PermissionMode,
  PermissionPayload,
  TodoItem,
} from "./types";

/**
 * AgentToolRegistry——agent 工具面唯一事实源（agent-harness-v4.md §14.4）：
 * 内置工具经 registerAgentTool 自举注册（source="builtin"），与 MCP / 插件工具同一条入表路径；
 * buildToolset = 注册表视图（任务型白名单 ∩ 权限模式裁剪 ∩ 持久规则 ∩ 分级收紧），
 * 统一授权门/规则门在这里对全部来源工具生效——内置无特判。
 */

export type PermissionClass = "auto" | "session" | "each-time";
export type AgentToolSource = "builtin" | "mcp" | "plugin";

export const RANK: Record<PermissionClass, number> = { auto: 0, session: 1, "each-time": 2 };

/** 内置权限基线（v4 工具全集）。任务型策略只能沿 auto→session→each-time 收紧。 */
export const PERM: Record<string, PermissionClass> = {
  repo_status: "auto", repo_diff: "auto", repo_log: "auto",
  repo_read_file: "auto", repo_list_files: "auto",
  repo_glob: "auto", repo_grep: "auto",
  review_get_state: "auto",
  file_write: "auto", file_patch: "auto",
  git_stage: "session", git_commit: "session",
  terminal_run: "session", terminal_poll: "session",
  git_push: "each-time",
  ask_user: "auto", todo_write: "auto", plan_submit: "auto", task: "auto",
};

/** plan 模式保留集（F8.2：只读 ∩ 任务型 + 交互工具）。 */
const PLAN_ALWAYS = new Set(["todo_write", "plan_submit", "ask_user", "task"]);

/** 持久授权规则（F5.3，settings.agentRules）。pattern: null=全量；否则为签名前缀。 */
export interface AgentPermissionRule {
  id: string;
  tool: string;
  pattern: string | null;
  effect: "allow" | "deny";
  scope: "global" | "repo";
  repoPath?: string | null;
  createdAt: string;
}

export interface PermissionRequest {
  title: string;
  detail: string;
  command?: string | null;
  payload?: PermissionPayload;
  /** false = 卡上不给"记住本会话"（each-time） */
  rememberable?: boolean;
}

export interface ShellRecord {
  id: string;
  command: string;
  output: string;
  running: boolean;
  exitCode: number | null;
  startedAt: number;
}

/** 每会话工具环境：buildToolset 时注入，工具 execute 只经此触达宿主能力。 */
export interface ToolEnv {
  worktreePath: string;
  taskId: string;
  mode: PermissionMode;
  signal: AbortSignal;
  emit: (ev: AgentSessionEvent) => void;
  /** 统一授权门：false = 用户拒绝。payload 决定授权卡渲染形态。subtaskId = 子代理冒泡标。 */
  requestPermission: (toolName: string, req: PermissionRequest, subtaskId?: string) => Promise<boolean>;
  /** 读取登记（写前读校验数据源）+ 变更通知（ChangeSet/时间线） */
  readLog: Map<string, { mtimeMs: number; size: number }>;
  noteFileChange: (p: string, kind: FileChangeKind, summary?: string) => void;
  /** 交互工具宿主面（F5.4 / F8 / F9） */
  askUser: (question: string, options: string[], subtaskId?: string) => Promise<string>;
  submitPlan: (plan: string) => Promise<{ status: "approved" | "revised"; feedback?: string }>;
  setTodos: (todos: TodoItem[]) => void;
  spawnSubtask: (args: { name: string; prompt: string; mode: string }) => Promise<string>;
  subtaskPresets: () => string[];
  /** 后台 shell 注册表（terminal_run/terminal_poll） */
  shells: Map<string, ShellRecord>;
  /** 工具结果记账（F12.2 防死循环：连续失败 N 次返回提醒文本追加进结果；无提醒返回 null） */
  noteToolOutcome?: (toolName: string, args: Record<string, unknown>, isError: boolean) => string | null;
  /** 子代理嵌套标（事件归组） */
  subtaskId?: string;
}

export interface AgentToolDef {
  name: string;
  description: string;
  parametersSchema: z.ZodType;
  permissionClass: PermissionClass;
  source: AgentToolSource;
  /** 只读工具（plan 模式可用、explore 子代理可用） */
  readonly?: boolean;
  /** plan 模式恒可用（交互/规划工具） */
  planAlways?: boolean;
  /** 动态风险：terminal 命令分级——yolo 下 high 仍 each-time */
  dynamicRisk?: (args: Record<string, unknown>) => "high" | "medium" | null;
  /** 授权卡定制文案（缺省由 buildPayload 生成） */
  permissionRequest?: (args: Record<string, unknown>) => PermissionRequest;
  /** 子代理不可用（默认 task 工具防递归用） */
  noSubtask?: boolean;
  execute(env: ToolEnv, args: Record<string, unknown>): Promise<string>;
}

// ---- 注册表 ----

const AGENT_TOOLS = new Map<string, AgentToolDef>();

/** 注册（同 id 覆盖 = 内置自举与插件同一接缝；插件须带命名空间 <pkg>.<id>）。 */
export function registerAgentTool(def: AgentToolDef): void {
  AGENT_TOOLS.set(def.name, def);
}

export function unregisterAgentToolsByPackage(packageId: string): void {
  for (const [name, t] of AGENT_TOOLS) {
    if (t.source !== "builtin" && name.startsWith(`${packageId}.`)) AGENT_TOOLS.delete(name);
  }
}

/** 按来源清注册（MCP 断连时清全部 mcp 工具）。 */
export function unregisterAgentToolsBySource(source: AgentToolSource): void {
  for (const [name, t] of AGENT_TOOLS) {
    if (t.source === source) AGENT_TOOLS.delete(name);
  }
}

export function agentToolCatalog(): AgentToolDef[] {
  return [...AGENT_TOOLS.values()];
}

export function agentToolNames(): string[] {
  return [...AGENT_TOOLS.keys()];
}

/** 生效分级 = 基线 ⊕ 任务型收紧（git_push 恒 each-time）。 */
export function effectivePermissionClass(toolName: string, policy?: Record<string, PermissionClass>): PermissionClass {
  const base = AGENT_TOOLS.get(toolName)?.permissionClass ?? PERM[toolName] ?? "each-time";
  if (toolName === "git_push") return "each-time";
  const over = policy?.[toolName];
  if (!over) return base;
  return RANK[over] >= RANK[base] ? over : base;
}

/** 规则签名：command 工具用命令串，其余用参数 JSON（稳定键序）。 */
function signatureOf(toolName: string, args: Record<string, unknown>): string {
  if (toolName === "terminal_run" || toolName === "terminal_poll") {
    return String(args?.command ?? args?.shellId ?? "");
  }
  try {
    return JSON.stringify(args, Object.keys(args).sort());
  } catch {
    return "";
  }
}

/** 规则评估：deny 优先于 allow；pattern null = 全量，否则前缀匹配。 */
export function evaluateRules(
  rules: AgentPermissionRule[] | undefined,
  toolName: string,
  args: Record<string, unknown>,
  repoPath?: string | null,
): "allow" | "deny" | null {
  if (!rules || rules.length === 0) return null;
  const sig = signatureOf(toolName, args);
  let verdict: "allow" | "deny" | null = null;
  for (const r of rules) {
    if (r.tool !== toolName) continue;
    if (r.scope === "repo" && r.repoPath && repoPath && r.repoPath !== repoPath) continue;
    const hit = r.pattern === null || r.pattern === "" || sig.startsWith(r.pattern);
    if (!hit) continue;
    if (r.effect === "deny") return "deny";
    verdict = "allow";
  }
  return verdict;
}

export interface BuildToolsetOptions {
  /** 任务型白名单（缺省 = 全集） */
  allowedTools?: readonly string[];
  /** 任务型权限收紧 */
  policy?: Record<string, PermissionClass>;
  /** 持久规则（settings.agentRules，scope=repo 按 worktree 归属过滤） */
  rules?: AgentPermissionRule[];
  mode: PermissionMode;
  repoPath?: string | null;
  /** 子代理环境：隐藏 task 工具（深度 1） */
  noSubtaskSpawn?: boolean;
}

/** 注册表视图 → AI SDK ToolSet。统一门序：规则 deny → 模式/分级授权 → 执行。 */
export function buildToolset(env: ToolEnv, opts: BuildToolsetOptions): ToolSet {
  const out: ToolSet = {};
  // §22.4 E4：名字序确定性迭代——Map 插入序随包启停/重启漂移，会打散工具定义段前缀
  const defs = [...AGENT_TOOLS.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const def of defs) {
    if (opts.noSubtaskSpawn && def.noSubtask) continue;
    if (opts.mode === "plan" && !(def.readonly || def.planAlways)) continue;
    if (opts.allowedTools && !opts.allowedTools.includes(def.name)) continue;
    // 全量 deny 规则 → 工具整体剔除（前缀 deny 在执行门拦截）
    const fullDeny = opts.rules?.some((r) => r.tool === def.name && r.effect === "deny" && (r.pattern === null || r.pattern === "")) ?? false;
    if (fullDeny) continue;

    const wrapped = tool({
      description: def.description,
      // biome-ignore lint: 注册表 schema 为宽型 ZodType，AI SDK 泛型按 any 消费
      inputSchema: def.parametersSchema as never,
      execute: async (rawArgs: Record<string, unknown>) => {
        const args = (rawArgs ?? {}) as Record<string, unknown>;
        // 1) 前缀 deny 规则
        if (evaluateRules(opts.rules, def.name, args, opts.repoPath) === "deny") {
          return `错误：该操作被权限规则拒绝（${def.name}）。请调整方案，不要原样重试。`;
        }
        // 2) 分级（含 yolo/动态风险）
        let cls = effectivePermissionClass(def.name, opts.policy);
        const risk = def.dynamicRisk?.(args) ?? null;
        if (env.mode === "yolo" && risk !== "high") cls = "auto";
        if (risk === "high") cls = "each-time";
        if (cls !== "auto") {
          const allow = await env.requestPermission(def.name, def.permissionRequest?.(args) ?? {
            title: def.name,
            detail: JSON.stringify(args).slice(0, 200),
            command: typeof args.command === "string" ? args.command : null,
            payload: buildPayload(def, args, risk),
            rememberable: cls === "session",
          });
          if (!allow) return `用户拒绝了该操作（${def.name}）。请调整方案，不要原样重试。`;
        }
        // 3) 执行 + 防死循环记账（F12.2：同一 (tool, args) 连续失败追加提醒）
        let out: string;
        try {
          out = await def.execute(env, args);
        } catch (e) {
          out = `错误：${(e as Error).message}`;
        }
        const note = env.noteToolOutcome?.(def.name, args, out.startsWith("错误："));
        return note ? `${out}\n${note}` : out;
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    out[def.name] = wrapped as any;
  }
  return out;
}

function buildPayload(def: AgentToolDef, args: Record<string, unknown>, risk: "high" | "medium" | null): PermissionPayload {
  const base: PermissionPayload = {
    kind: def.source === "builtin" ? "command" : def.source === "mcp" ? "mcp" : "plugin",
    risk,
    source: def.source === "builtin" ? null : def.source,
  };
  if (def.name === "git_stage") {
    base.kind = "git-stage";
    base.paths = Array.isArray(args.paths) ? (args.paths as string[]) : undefined;
  } else if (def.name === "git_commit") {
    base.kind = "git-commit";
  } else if (def.name === "git_push") {
    base.kind = "git-push";
  }
  return base;
}

/** plan 模式工具集断言（验收用）。 */
export function isPlanAllowed(def: AgentToolDef): boolean {
  return !!(def.readonly || def.planAlways);
}

export const PLAN_ALWAYS_TOOLS = PLAN_ALWAYS;
