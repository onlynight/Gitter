import type { LanguageModel, ModelMessage } from "ai";
import type { CompactionRecord } from "./tasks";

/**
 * Agent 能力接缝注册表（agent-harness-v4.md §14.5"数据可插件，引擎不插件"）：
 * - promptSections：系统提示词槽位（context/skills/addendum/output 开放；identity/boundary 锁死）；
 * - contextCollectors：仓库上下文采集器（内置 gitStatus/agentsMd/topLevel 自举，tokenBudget 预算感知）；
 * - compactors：上下文压缩策略（单槽覆盖：活跃非内置压缩器优先，否则 builtin.summarizer）。
 * 内置能力经同一批 API 自举注册——无绕过注册表的内置特判（§14.10 无特判）。
 */

// ---- 提示词槽位（§20.3.1 v5.0：identity→boundary→context→workflow→tools→skills→mode→task→free→output + compaction/subagent 专用槽）----

export type PromptSlot =
  | "identity" | "boundary" | "context" | "workflow" | "tools" | "skills"
  | "mode" | "task" | "free" | "output" | "compaction" | "subagent";

/** 槽位组装顺序（boundary 物理第一由 assemble 保证，不在遍历序首防插件段插入其前） */
/** L1/L2 公开槽位白名单（identity/boundary/compaction/subagent 为内置/专用槽，不开放声明） */
export type PromptPublicSlot = Exclude<PromptSlot, "identity" | "boundary" | "compaction" | "subagent">;

export const PROMPT_SLOT_ORDER: PromptSlot[] = [
  "identity", "context", "workflow", "tools", "skills", "mode", "task", "free", "output",
];

export interface PromptRenderEnv {
  worktreePath: string;
  repoPath: string | null;
  branch: string | null;
  statusSummary: string | null;
  mode: string;
  taskTypeId: string | null;
  isSubtask?: boolean;
}

export interface PromptSectionDef {
  /** 全局唯一：<pkg>.<id> / builtin.<id> */
  id: string;
  slot: PromptSlot;
  /** 槽位内排序（小在前） */
  order: number;
  source: "builtin" | "package";
  packageId?: string;
  /** 静态段（L1 manifest 声明） */
  content?: string;
  /** 动态段（L2）：每轮组装时调用；null = 本轮省略。安全约束：只产出提示文本，不得触达执行器 */
  provide?: (env: PromptRenderEnv) => Promise<string | null> | string | null;
}

const PROMPT_SECTIONS = new Map<string, PromptSectionDef>();

export function registerPromptSection(def: PromptSectionDef): void {
  // §20.4 #9 boundary 槽锁死：仅内置可写（裁决面自我描述，插件不得改写）
  if (def.slot === "boundary" && def.source !== "builtin") {
    console.warn(`[promptSections] 拒绝非内置包声明 boundary 槽：${def.id}`);
    return;
  }
  PROMPT_SECTIONS.set(def.id, def);
}

export function unregisterPromptSectionsByPackage(packageId: string): void {
  for (const [id, s] of PROMPT_SECTIONS) {
    if (s.packageId === packageId) PROMPT_SECTIONS.delete(id);
  }
}

export function promptSections(slot: PromptSlot): PromptSectionDef[] {
  return [...PROMPT_SECTIONS.values()].filter((s) => s.slot === slot).sort((a, b) => a.order - b.order);
}

/** L1 静态段模板插值（§20.3.1：{{worktree.path}} {{branch}} {{status}} {{mode}}——消费机制在引擎侧）。 */
function interpolate(text: string, env: PromptRenderEnv): string {
  return text
    .replace(/\{\{worktree\.path\}\}/g, env.worktreePath)
    .replace(/\{\{branch\}\}/g, env.branch ?? "未知")
    .replace(/\{\{status\}\}/g, env.statusSummary ?? "未知")
    .replace(/\{\{mode\}\}/g, env.mode);
}

/** 组装槽位文本（动态段逐个求值，软失败跳过；单段 cap 8000 字符）。 */
export async function renderPromptSlot(slot: PromptSlot, env: PromptRenderEnv, tokenBudget = 2000): Promise<string> {
  const parts: string[] = [];
  const budgetChars = tokenBudget * 2.5;
  let used = 0;
  for (const s of promptSections(slot)) {
    let text: string | null = s.content ?? null;
    if (s.provide) {
      try {
        text = await s.provide(env);
      } catch {
        text = null; // 软失败：异常段跳过
      }
    }
    if (!text?.trim()) continue;
    const filled = interpolate(text, env);
    const clipped = filled.length > 8000 ? filled.slice(0, 8000) + "\n…（本段超 8000 字符截断）" : filled;
    if (used + clipped.length > budgetChars * 4) break;
    parts.push(clipped);
    used += clipped.length;
  }
  return parts.join("\n\n");
}

// ---- 上下文采集器 ----

export interface ContextCollectorDef {
  id: string;
  order: number;
  /** token 预算（该段上限；超限截断并标注） */
  tokenBudget: number;
  source: "builtin" | "package";
  packageId?: string;
  collect(ctx: { worktreePath: string; repoPath: string | null }): Promise<string | null>;
}

const COLLECTORS = new Map<string, ContextCollectorDef>();

export function registerContextCollector(def: ContextCollectorDef): void {
  COLLECTORS.set(def.id, def);
}

export function unregisterContextCollectorsByPackage(packageId: string): void {
  for (const [id, c] of COLLECTORS) {
    if (c.packageId === packageId) COLLECTORS.delete(id);
  }
}

export function contextCollectors(): ContextCollectorDef[] {
  return [...COLLECTORS.values()].sort((a, b) => a.order - b.order);
}

/** 运行全部采集器（F7：每段 token 预算，超限截断标注）。 */
export async function runContextCollectors(ctx: {
  worktreePath: string;
  repoPath: string | null;
}): Promise<string[]> {
  const out: string[] = [];
  for (const c of contextCollectors()) {
    try {
      const text = await Promise.race([
        Promise.resolve(c.collect(ctx)),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
      ]);
      if (!text?.trim()) continue;
      const cap = c.tokenBudget * 2.5;
      out.push(text.length > cap ? text.slice(0, cap) + "\n…（本段超预算截断）" : text);
    } catch {
      /* 单个采集器失败不阻塞（软失败原则） */
    }
  }
  return out;
}

// ---- 压缩策略 ----

export interface CompactionInput {
  messages: ModelMessage[];
  contextWindow: number;
  systemEstTokens: number;
  model: LanguageModel;
  signal?: AbortSignal;
  threshold?: number;
  keepLast?: number;
}

export interface CompactionOutput {
  messages: ModelMessage[];
  record: CompactionRecord;
}

export interface CompactorDef {
  id: string;
  source: "builtin" | "package";
  packageId?: string;
  compact(input: CompactionInput): Promise<CompactionOutput | null>;
}

const COMPACTORS = new Map<string, CompactorDef>();

export function registerCompactor(def: CompactorDef): void {
  COMPACTORS.set(def.id, def);
}

export function unregisterCompactorsByPackage(packageId: string): void {
  for (const [id, c] of COMPACTORS) {
    if (c.packageId === packageId) COMPACTORS.delete(id);
  }
}

/** 单槽选择：活跃非内置压缩器优先（用户覆盖内置），否则 builtin。 */
export function activeCompactor(): CompactorDef {
  for (const c of COMPACTORS.values()) {
    if (c.source !== "builtin") return c;
  }
  return COMPACTORS.get("builtin.summarizer")!;
}

// ---- 包贡献同步（§14.2 #3：promptSections L1 静态段 → 槽位注册表，幂等全量重建）----

import type { PackageStore } from "../extensions/store";

export function syncPackagePromptSections(store: PackageStore): void {
  const seen = new Set<string>();
  for (const s of store.promptSectionsOf()) {
    seen.add(s.id);
    // §20.4 #9 信任穿透：随应用分发的内置包视为 builtin（boundary 槽仅内置可写）；
    // 用户包声明 boundary → 跳过并警示（registerPromptSection 的锁是第二道防线）
    if (s.slot === "boundary" && !s.isBuiltIn) {
      console.warn(`[promptSections] 用户包 ${s.packageId} 声明 boundary 槽被拒（仅内置包可写）`);
      continue;
    }
    registerPromptSection({
      id: s.id,
      slot: s.slot as PromptSlot,
      order: s.order,
      source: s.isBuiltIn ? "builtin" : "package",
      packageId: s.packageId,
      content: s.content,
    });
  }
  for (const [id, sec] of PROMPT_SECTIONS) {
    if (sec.source === "package" && !seen.has(id)) PROMPT_SECTIONS.delete(id);
  }
}


// ---- turn 钩子（§20.3.6：post-turn addendum，唯一开放钩子相；产物由宿主以 system-reminder 注入下一轮）----

export interface TurnHookInfo {
  taskId: string;
  outcome: string;
  lastMessage: string | null;
  todoState: { content: string; status: "pending" | "in_progress" | "completed" }[] | null;
}

export interface TurnHookDef {
  id: string;
  order: number;
  source: "builtin" | "package";
  packageId?: string;
  hook(info: TurnHookInfo): Promise<string | null> | string | null;
}

const TURN_HOOKS = new Map<string, TurnHookDef>();

export function registerTurnHook(def: TurnHookDef): void {
  TURN_HOOKS.set(def.id, def);
}

export function unregisterTurnHooksByPackage(packageId: string): void {
  for (const [id, h] of TURN_HOOKS) {
    if (h.packageId === packageId) TURN_HOOKS.delete(id);
  }
}

/** 运行全部 post-turn 钩子（order 排序；单钩子 2s 超时/异常跳过；产物各自 cap 2000）。 */
export async function runTurnHooks(info: TurnHookInfo): Promise<string[]> {
  const out: string[] = [];
  const hooks = [...TURN_HOOKS.values()].sort((a, b) => a.order - b.order);
  for (const h of hooks) {
    try {
      const text = await Promise.race([
        Promise.resolve(h.hook(info)),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
      ]);
      if (text?.trim()) out.push(text.trim().slice(0, 2000));
    } catch {
      /* 单钩子异常跳过 */
    }
  }
  return out;
}

/** 压缩器按 id 查找（§20.3.3 选择链第一级 taskType.compactor）。 */
export function getCompactorById(id: string): CompactorDef | null {
  return COMPACTORS.get(id) ?? null;
}

// ---- §20.6 审计视图数据源（提示词段/采集器/钩子/压缩器 逐包可见、可停用）----

export interface SeamsAudit {
  sections: { id: string; slot: PromptSlot; order: number; source: string; packageId: string | null; chars: number }[];
  collectors: { id: string; order: number; tokenBudget: number; source: string; packageId: string | null }[];
  hooks: { id: string; order: number; source: string; packageId: string | null }[];
  compactors: { id: string; source: string; packageId: string | null }[];
  presets: { id: string; name: string; readonly: boolean; tools: string[] | null }[];
  subagentPresetIds: string[];
  toolNames: string[];
}

export function auditSeams(): SeamsAudit {
  // 延迟 require 避免 seams↔registry/subagents 启动环
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const reg = require("./registry") as typeof import("./registry");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sub = require("./subagents") as typeof import("./subagents");
  return {
    sections: [...PROMPT_SECTIONS.values()].map((s) => ({
      id: s.id, slot: s.slot, order: s.order, source: s.source, packageId: s.packageId ?? null,
      chars: (s.content ?? "").length,
    })),
    collectors: contextCollectors().map((c) => ({
      id: c.id, order: c.order, tokenBudget: c.tokenBudget, source: c.source, packageId: c.packageId ?? null,
    })),
    hooks: [...TURN_HOOKS.values()].map((h) => ({
      id: h.id, order: h.order, source: h.source, packageId: h.packageId ?? null,
    })),
    compactors: [...COMPACTORS.values()].map((c) => ({ id: c.id, source: c.source, packageId: c.packageId ?? null })),
    presets: sub.subagentPresets().map((p) => ({ id: p.id, name: p.name, readonly: p.readonly, tools: p.tools ? [...p.tools] : null })),
    subagentPresetIds: sub.subagentPresetIds(),
    toolNames: reg.agentToolNames(),
  };
}
