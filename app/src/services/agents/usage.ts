import * as fs from "fs";
import * as path from "path";
import { loadAgentTasks, loadSessionFile } from "./tasks";
import type { UserModelProfileDTO } from "../../shared/types";

/**
 * 用量聚合（M1.3 harness-mainline-roadmap.md）：扫描仓库账本 + 会话 usageHistory，
 * 聚合为 按天 / 按模型 / 按任务 三维报表；单价（档案 pricing，每百万 token）估算费用。
 * 纯读取，不写任何状态；单会话读取失败跳过（软失败）。
 */

export interface UsageTaskRow {
  taskId: string;
  title: string;
  state: string;
  modelRef: string | null;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cost: number | null;
  lastActiveAt: string | null;
}

export interface UsageModelRow {
  modelRef: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cost: number | null;
}

export interface UsageDayRow {
  day: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cost: number | null;
}

export interface UsageDayModelRow {
  day: string;
  modelRef: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cost: number | null;
}

export interface UsageReport {
  repoPaths: string[];
  totals: { turns: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cost: number | null };
  byDay: UsageDayRow[];
  byModel: UsageModelRow[];
  /** 配置的模型显示名映射（UserModelProfileDTO.name）——modelRef 可能是带 #tag 的内部 id */
  modelNames: Record<string, string>;
  /** 按「日 × 模型」聚合——趋势图节点提示框内展开当日各模型用量 */
  byDayModel: UsageDayModelRow[];
  byTask: UsageTaskRow[];
  /** 缓存断点轮数（usageHistory 带 note 注记：压缩/换模型/重启续跑/模式切换）——跨任务聚合，供命中率归因 */
  cacheBreaks: number;
  /** 未读到任何账本的仓库（供 UI 提示） */
  emptyRepos: string[];
}

interface PricingLookup {
  inputPerM: number | null;
  outputPerM: number | null;
}

function pricingOf(models: UserModelProfileDTO[], modelRef: string | null): PricingLookup {
  if (!modelRef) return { inputPerM: null, outputPerM: null };
  const gid = modelRef.split("#")[0];
  const p = models.find((m) => m.id === modelRef) ?? models.find((m) => m.id === gid) ?? models.find((m) => modelRef.startsWith(`${m.id}#`));
  if (!p?.pricing) return { inputPerM: null, outputPerM: null };
  return {
    inputPerM: typeof p.pricing.inputPerM === "number" ? p.pricing.inputPerM : null,
    outputPerM: typeof p.pricing.outputPerM === "number" ? p.pricing.outputPerM : null,
  };
}

function costOf(pr: PricingLookup, input: number, output: number): number | null {
  if (pr.inputPerM === null && pr.outputPerM === null) return null;
  return (input / 1_000_000) * (pr.inputPerM ?? 0) + (output / 1_000_000) * (pr.outputPerM ?? 0);
}

interface Acc {
  turns: number;
  input: number;
  output: number;
  cacheRead: number;
  cost: number | null;
  priced: boolean;
  /** 带 note 注记的轮数（压缩/换模型/重启续跑/模式切换）——缓存断点，命中率归因用 */
  breaks: number;
}

function newAcc(): Acc {
  return { turns: 0, input: 0, output: 0, cacheRead: 0, cost: null, priced: false, breaks: 0 };
}

function addEntry(acc: Acc, e: { input?: number; output?: number; cacheRead?: number; note?: string }, pr: PricingLookup): void {
  acc.turns++;
  acc.input += e.input ?? 0;
  acc.output += e.output ?? 0;
  acc.cacheRead += e.cacheRead ?? 0;
  if (e.note) acc.breaks++;
  const c = costOf(pr, e.input ?? 0, e.output ?? 0);
  if (c !== null) {
    acc.cost = (acc.cost ?? 0) + c;
    acc.priced = true;
  }
}

function sumAcc(list: Acc[]): { turns: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheBreaks: number; cost: number | null } {
  const t = { turns: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheBreaks: 0, cost: null as number | null };
  let priced = false;
  for (const a of list) {
    t.turns += a.turns;
    t.inputTokens += a.input;
    t.outputTokens += a.output;
    t.cacheReadTokens += a.cacheRead;
    t.cacheBreaks += a.breaks;
    if (a.cost !== null) {
      t.cost = (t.cost ?? 0) + a.cost;
      priced = true;
    }
  }
  if (!priced) t.cost = null;
  return t;
}

/** 扫描多个仓库聚合用量（models 用于把 modelRef 映射到单价）。 */
export function aggregateUsage(repoPaths: string[], models: UserModelProfileDTO[]): UsageReport {
  const byDay = new Map<string, Acc>();
  const byModel = new Map<string, Acc>();
  const byDayModel = new Map<string, Acc>();
  const byTask: UsageTaskRow[] = [];
  const emptyRepos: string[] = [];
  const taskAccs: Acc[] = [];

  for (const repo of repoPaths) {
    let ledger;
    try {
      ledger = loadAgentTasks(repo);
    } catch {
      ledger = { version: 1 as const, tasks: [] };
    }
    if (!fs.existsSync(path.join(repo, ".git", "gitter", "agent-tasks.json"))) {
      emptyRepos.push(repo);
      continue;
    }
    for (const t of ledger.tasks) {
      let sf;
      try {
        sf = loadSessionFile(repo, t.taskId);
      } catch {
        sf = null;
      }
      const entries = sf?.usageHistory ?? [];
      const acc = newAcc();
      const pr = pricingOf(models, t.modelRef);
      const mr = t.modelRef ?? "(未记录)";
      for (const e of entries) {
        addEntry(acc, e, pr);
        const day = (e.ts || "").slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
          addEntry(byDay.get(day) ?? byDay.set(day, newAcc()).get(day)!, e, pr);
          const dm = day + "\0" + mr;
          addEntry(byDayModel.get(dm) ?? byDayModel.set(dm, newAcc()).get(dm)!, e, pr);
        }
        addEntry(byModel.get(mr) ?? byModel.set(mr, newAcc()).get(mr)!, e, pr);
      }
      taskAccs.push(acc);
      byTask.push({
        taskId: t.taskId,
        title: t.title,
        state: t.state,
        modelRef: t.modelRef,
        turns: acc.turns,
        inputTokens: acc.input,
        outputTokens: acc.output,
        cacheReadTokens: acc.cacheRead,
        cost: acc.priced ? round(acc.cost) : null,
        lastActiveAt: t.lastActiveAt,
      });
    }
  }

  byTask.sort((a, b) => (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? ""));
  // modelRef 可能是「档案 id#任务内标签」形式的内部引用，先剥标签再查配置名
  const modelNames: Record<string, string> = {};
  for (const m of models) modelNames[m.id] = m.name;

  const displayName = (ref: string): string => {
    const bare = ref.split("#")[0];
    return modelNames[bare] ?? modelNames[ref] ?? (ref === "(未记录)" ? ref : bare);
  };

  return {
    repoPaths,
    totals: sumAcc(taskAccs),
    modelNames,
    byDay: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, a]) => ({ day, turns: a.turns, inputTokens: a.input, outputTokens: a.output, cacheReadTokens: a.cacheRead, cost: a.priced ? round(a.cost) : null })),
    byModel: [...byModel.entries()].sort((a, b) => b[1].input - a[1].input).map(([modelRef, a]) => ({ modelRef, turns: a.turns, inputTokens: a.input, outputTokens: a.output, cacheReadTokens: a.cacheRead, cost: a.priced ? round(a.cost) : null })),
    byDayModel: [...byDayModel.entries()].sort((a, b) => a[0].localeCompare(b[0]) || b[1].input - a[1].input).map(([k, a]) => {
      const s = k.indexOf("\0");
      return { day: k.slice(0, s), modelRef: k.slice(s + 1), turns: a.turns, inputTokens: a.input, outputTokens: a.output, cacheReadTokens: a.cacheRead, cost: a.priced ? round(a.cost) : null };
    }),
    byTask: byTask.map((t) => ({ ...t })),
    cacheBreaks: taskAccs.reduce((n, a) => n + a.breaks, 0),
    emptyRepos,
  };
}

function round(n: number | null): number | null {
  return n === null ? null : Math.round(n * 1e4) / 1e4;
}
