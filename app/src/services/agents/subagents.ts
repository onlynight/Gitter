import { randomUUID } from "crypto";
import type { LanguageModel } from "ai";
import { agentToolCatalog, agentToolNames, buildToolset, type AgentPermissionRule, type PermissionClass, type ToolEnv } from "./registry";
import { runLoop } from "./loop";
import { composeSubagentPrompt, type RepoContext } from "./prompts";
import { READONLY_TOOL_NAMES } from "./builtinTools";
import type { AgentSessionEvent, PermissionMode, PermissionPayload, SubtaskState } from "./types";

/**
 * 子代理运行时（agent-harness-v4.md F9）：
 * ChildLiveSession——不建 worktree、不进任务列表、不入账本；独立上下文，结果以 final message 回父；
 * 同步阻塞 + 信号量限流（信号量在 SessionManager）；深度 1（工具面剔除 task）。
 * 预设注册表：内置 explore/act 自举，插件经 registerSubagentPreset 同一接缝扩展。
 */

export interface SubagentPreset {
  id: string;
  name: string;
  description: string;
  /** 工具白名单；null = 全集（仍剔除 task） */
  tools: readonly string[] | null;
  readonly: boolean;
  addendum: string;
  timeoutMs: number;
}

const PRESETS = new Map<string, SubagentPreset>();

export function registerSubagentPreset(p: SubagentPreset): void {
  PRESETS.set(p.id, p);
}

/** 按包清理（§20.3.5 L2 ctx.registerSubagentPreset 的卸载路径；包 id 形如 `<pkg>/`）。 */
export function unregisterSubagentPresetsByPackage(packageId: string): void {
  for (const id of [...PRESETS.keys()]) {
    if (id.startsWith(`${packageId}/`)) PRESETS.delete(id);
  }
}

export function subagentPresets(): SubagentPreset[] {
  return [...PRESETS.values()];
}

export function subagentPresetIds(): string[] {
  return [...PRESETS.keys()];
}

export function getPreset(id: string): SubagentPreset | null {
  return PRESETS.get(id) ?? null;
}

// 内置 explore/act 预设已数据化迁入内置包 agent.builtin.presets（§20.3.5 实际插件化）；
// 本模块只保留预设注册表与包贡献同步（syncPackagePresets）。包缺失时 task 工具无预设可用（空载语义）。

export interface SubtaskRequest {
  name: string;
  prompt: string;
  mode: string;
  /** 父会话能力面 */
  worktreePath: string;
  taskId: string;
  mode_: PermissionMode;
  signal: AbortSignal;
  model: LanguageModel;
  thinking: "off" | "low" | "medium" | "high" | undefined;
  context: RepoContext;
  readLog: Map<string, { mtimeMs: number; size: number }>;
  shells: Map<string, { id: string; command: string; output: string; running: boolean; exitCode: number | null; startedAt: number }>;
  requestPermission: (toolName: string, req: { title: string; detail: string; command?: string | null; payload?: PermissionPayload; rememberable?: boolean }, subtaskId?: string) => Promise<boolean>;
  /** 提问透传父会话（问题卡带 subtask 标，答案回子代理） */
  askUser: (question: string, options: string[], subtaskId: string) => Promise<string>;
  emit: (ev: AgentSessionEvent) => void;
  /** 父任务型约束（act 预设工具面 ⊆ 父工具面） */
  parentAllowedTools?: readonly string[] | null;
  parentPolicy?: Record<string, PermissionClass>;
  rules?: AgentPermissionRule[];
  repoPath?: string | null;
  maxSteps?: number;
}

export interface SubtaskResult {
  subtaskId: string;
  state: SubtaskState;
  text: string;
  durationMs: number;
  /** 子 transcript（宿主持久化 subtasks/<id>.json 用） */
  messages: import("ai").ModelMessage[];
  usage: { input?: number; output?: number } | null;
}

export async function runSubtask(req: SubtaskRequest): Promise<SubtaskResult> {
  const preset = getPreset(req.mode);
  if (!preset) return { subtaskId: "unknown", state: "failed", text: `未知子代理预设：${req.mode}`, durationMs: 0, messages: [], usage: null };
  const subtaskId = randomUUID().slice(0, 8);
  const started = Date.now();
  req.emit({
    type: "subtask", subtaskId, name: req.name, mode: req.mode, state: "running",
  });

  const childAbort = new AbortController();
  const onParentAbort = () => childAbort.abort();
  req.signal.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(() => childAbort.abort(), preset.timeoutMs);

  const emit = (ev: AgentSessionEvent) => {
    req.emit({ ...ev, subtaskId: (ev as { subtaskId?: string }).subtaskId ?? subtaskId } as AgentSessionEvent);
  };

  try {
    const childEnv: ToolEnv = {
      worktreePath: req.worktreePath,
      taskId: req.taskId,
      mode: preset.readonly ? "plan" : req.mode_,
      signal: childAbort.signal,
      emit,
      requestPermission: (toolName, r) => req.requestPermission(toolName, r, subtaskId),
      readLog: req.readLog,
      noteFileChange: (p, kind, summary) =>
        emit({ type: "file-change", path: p, kind, summary }),
      askUser: async (question, options) => req.askUser(question, options, subtaskId),
      submitPlan: async () => ({ status: "revised" as const, feedback: "子代理不能提交计划（plan_submit 仅主会话可用）" }),
      setTodos: () => {
        emit({ type: "log", level: "info", text: "子代理的 todo 不入主清单" });
      },
      spawnSubtask: async () => "错误：子代理不能再派生子代理（深度 1）",
      subtaskPresets: () => subagentPresetIds(),
      shells: req.shells,
      subtaskId,
    };

    const tools = buildToolset(childEnv, {
      allowedTools: preset.tools ?? (req.parentAllowedTools ?? undefined),
      policy: req.parentPolicy,
      rules: req.rules,
      mode: childEnv.mode,
      repoPath: req.repoPath,
      noSubtaskSpawn: true,
    });

    const messages: import("ai").ModelMessage[] = [{ role: "user", content: req.prompt }];
    const system = await composeSubagentPrompt(
      {
        worktreePath: req.worktreePath, repoPath: req.repoPath ?? null, branch: req.context.branch,
        statusSummary: req.context.statusSummary, mode: req.mode_, taskTypeId: null, isSubtask: true,
      },
      preset.addendum,
      req.thinking,
    );
    const result = await runLoop({
      model: req.model,
      thinking: req.thinking,
      system,
      messages,
      tools,
      signal: childAbort.signal,
      maxSteps: req.maxSteps ?? 50,
      worktreePath: req.worktreePath,
      onEvent: emit,
    });

    clearTimeout(timer);
    const durationMs = Date.now() - started;
    let state: SubtaskState;
    if (result.outcome === "completed") state = "completed";
    else if (result.outcome === "cancelled") state = childAbort.signal.aborted && req.signal.aborted ? "cancelled" : "timeout";
    else state = "failed";
    const text = result.outcome === "completed"
      ? result.lastMessage ?? "（子代理未产出文本）"
      : `（子代理${state === "timeout" ? "超时" : state === "cancelled" ? "被取消" : "失败"}：${result.error ?? "未知原因"}${result.lastMessage ? `\n已完成部分：${result.lastMessage.slice(0, 2000)}` : ""}）`;
    req.emit({ type: "subtask", subtaskId, name: req.name, mode: req.mode, state, finalMessage: text, durationMs });
    return { subtaskId, state, text, durationMs, messages, usage: result.usage };
  } catch (e) {
    clearTimeout(timer);
    const durationMs = Date.now() - started;
    const text = `（子代理异常：${(e as Error).message}）`;
    req.emit({ type: "subtask", subtaskId, name: req.name, mode: req.mode, state: "failed", finalMessage: text, durationMs });
    return { subtaskId, state: "failed", text, durationMs, messages: [], usage: null };
  } finally {
    req.signal.removeEventListener("abort", onParentAbort);
  }
}

// ---- 包贡献同步（§14.2 #6：subagentPresets L1 声明 → 预设注册表）----

import type { PackageStore } from "../extensions/store";

/** 已同步的包 preset 全名（重复同步幂等；包禁用/卸载后由全量重建清理）。 */
export function syncPackagePresets(store: PackageStore): void {
  const seen = new Set<string>();
  for (const p of store.list()) {
    if (p.state !== "active" || !p.kindStates.subagentPresets) continue;
    const rec = store.find(p.id);
    if (!rec) continue;
    for (const sp of rec.manifest.contributes.subagentPresets) {
      const fullId = `${p.id}/${sp.id}`;
      seen.add(fullId);
      // 工具白名单校验 ⊆ 当前注册表全集（编译期收紧方向，未知工具剔除）
      // §20.3.5 编译期校验：未知工具剔除；readonly ⇒ 工具面全部只读；timeout ≤ 600s
      const known = new Set(agentToolNames());
      const readonlyNames = new Set(agentToolCatalog().filter((t) => t.readonly).map((t) => t.name));
      const isReadonly = !!sp.readonly;
      let tools = (sp.tools ?? []).filter((t) => known.has(t));
      if (isReadonly) tools = tools.filter((t) => readonlyNames.has(t));
      registerSubagentPreset({
        id: fullId,
        name: sp.name,
        description: sp.description ?? "",
        tools: tools.length > 0 ? tools : null,
        readonly: isReadonly,
        addendum: sp.addendum ?? "",
        timeoutMs: Math.min(Math.max(sp.timeoutMs ?? 600_000, 30_000), 600_000),
      });
    }
  }
  // 清掉已消失/停用的包预设
  for (const id of subagentPresetIds()) {
    if (id.includes("/") && !seen.has(id)) {
      PRESETS.delete(id);
    }
  }
}
