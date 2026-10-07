import type { PackageStore } from "../extensions/store";
import type { PermissionClass } from "./registry";
import { PERM, RANK, agentToolNames } from "./registry";

/**
 * 任务型编译（task-model-modules.md §3.1/§3.2）：
 * 从 PackageStore 的 taskTypes kind 收集预设，编译期校验——
 * tools ⊆ 全集；permissionPolicy 只能沿 auto→session→each-time 收紧；git_push 恒 each-time。
 * 违规进 DTO.error（不拖累其它预设）。内置 free 恒可用（free 预设被禁/缺失时的兜底）。
 */

export const BUILTIN_FREE_ID = "builtin/free";

export interface CompiledTaskType {
  fullId: string;
  packageId: string;
  id: string;
  name: string;
  promptTemplate: string;
  systemAddendum: string | null;
  tools: string[] | null; // null = 全集
  policy: Record<string, PermissionClass>;
  defaultModelRef: string | null;
  /** 循环实现 id（G7：taskType→loop 绑定；缺省 builtin.default） */
  defaultLoop: string | null;
  /** 单任务步数上限（F12.2：缺省 50，上限 200） */
  maxSteps: number | null;
  /** 压缩器选择（§20.3.3：taskType.compactor → settings → builtin） */
  compactor: string | null;
}

export interface TaskTypeEntry {
  fullId: string;
  packageId: string;
  id: string;
  name: string;
  tools: string[];
  defaultModelRef: string | null;
  defaultLoop: string | null;
  error: string | null;
}

const TOOL_SET = new Set<string>([...Object.keys(PERM), ...agentToolNames()]);

/** 内置 free：全工具 + 基线策略 + 原样输入（恒可用，不进 PackageStore）。 */
export const FREE_TASK_TYPE: CompiledTaskType = {
  fullId: BUILTIN_FREE_ID,
  packageId: "builtin",
  id: "free",
  name: "自由任务",
  promptTemplate: "{input}",
  systemAddendum: null,
  tools: null,
  policy: {},
  defaultModelRef: null,
  defaultLoop: null,
  maxSteps: null,
  compactor: null,
};

function compileOne(packageId: string, t: {
  id: string; name: string; promptTemplate: string; systemAddendum: string | null;
  tools: string[]; permissionPolicy: Record<string, PermissionClass>; defaultModelRef: string | null;
  defaultLoop: string | null; maxSteps: number | null; compactor: string | null;
}): { spec: CompiledTaskType | null; error: string | null } {
  const unknownTools = t.tools.filter((x) => !TOOL_SET.has(x));
  if (unknownTools.length > 0) {
    return { spec: null, error: `tools 含未知工具：${unknownTools.join(", ")}` };
  }
  const unknownPolicy = Object.keys(t.permissionPolicy).filter((x) => !TOOL_SET.has(x));
  if (unknownPolicy.length > 0) {
    return { spec: null, error: `permissionPolicy 含未知工具：${unknownPolicy.join(", ")}` };
  }
  for (const [k, v] of Object.entries(t.permissionPolicy)) {
    if (k === "git_push" && v !== "each-time") {
      return { spec: null, error: "git_push 固定 each-time，不允许覆盖" };
    }
    if (RANK[v] < RANK[PERM[k] ?? "each-time"]) {
      return { spec: null, error: `permissionPolicy.${k}=${v} 比内置基线（${PERM[k]}）更宽——任务型只能收紧` };
    }
  }
  return {
    spec: {
      fullId: `${packageId}/${t.id}`,
      packageId,
      id: t.id,
      name: t.name,
      promptTemplate: t.promptTemplate,
      systemAddendum: t.systemAddendum,
      tools: t.tools.length > 0 ? [...t.tools] : null,
      policy: { ...t.permissionPolicy },
      defaultModelRef: t.defaultModelRef,
      defaultLoop: t.defaultLoop ?? null,
      maxSteps: t.maxSteps ?? null,
      compactor: t.compactor ?? null,
    },
    error: null,
  };
}

export function compileTaskTypes(store: PackageStore): { entries: TaskTypeEntry[]; specs: Map<string, CompiledTaskType> } {
  const entries: TaskTypeEntry[] = [];
  const specs = new Map<string, CompiledTaskType>();
  for (const p of store.list()) {
    if (p.state !== "active" || !p.kindStates.taskTypes) continue;
    const rec = store.find(p.id);
    if (!rec) continue;
    for (const t of rec.manifest.contributes.taskTypes) {
      const fullId = `${p.id}/${t.id}`;
      const { spec, error } = compileOne(p.id, t);
      if (spec) specs.set(fullId, spec);
      entries.push({
        fullId,
        packageId: p.id,
        id: t.id,
        name: t.name,
        tools: [...t.tools],
        defaultModelRef: t.defaultModelRef,
        defaultLoop: t.defaultLoop ?? null,
        error,
      });
    }
  }
  return { entries, specs };
}

/** 解析任务型：指定 id 优先（含错误时抛出），否则内置 free。 */
export function resolveTaskType(
  store: PackageStore,
  ref: string | null | undefined,
): { spec: CompiledTaskType; error?: string } {
  if (!ref || ref === BUILTIN_FREE_ID) return { spec: FREE_TASK_TYPE };
  const { specs, entries } = compileTaskTypes(store);
  const err = entries.find((e) => e.fullId === ref)?.error;
  const spec = specs.get(ref);
  if (!spec) {
    if (err) throw new Error(`任务型 ${ref} 不可用：${err}`);
    throw new Error(`任务型不存在：${ref}`);
  }
  return { spec };
}
