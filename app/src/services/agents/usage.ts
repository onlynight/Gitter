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

export interface UsageReport {
  repoPaths: string[];
  totals: { turns: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cost: number | null };
  byDay: UsageDayRow[];
  byModel: UsageModelRow[];
  byTask: UsageTaskRow[];
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
}

function newAcc(): Acc {
  return { turns: 0, input: 0, output: 0, cacheRead: 0, cost: null, priced: false };
}

function addEntry(acc: Acc, e: { input?: number; output?: number; cacheRead?: number }, pr: PricingLookup): void {
  acc.turns++;
  acc.input += e.input ?? 0;
  acc.output += e.output ?? 0;
  acc.cacheRead += e.cacheRead ?? 0;
  const c = costOf(pr, e.input ?? 0, e.output ?? 0);
  if (c !== null) {
    acc.cost = (acc.cost ?? 0) + c;
    acc.priced = true;
  }
}

function sumAcc(list: Acc[]): { turns: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cost: number | null } {
  const t = { turns: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cost: null as number | null };
  let priced = false;
  for (const a of list) {
    t.turns += a.turns;
    t.inputTokens += a.input;
    t.outputTokens += a.output;
    t.cacheReadTokens += a.cacheRead;
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
      for (const e of entries) {
        addEntry(acc, e, pr);
        const day = (e.ts || "").slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(day)) addEntry(byDay.get(day) ?? byDay.set(day, newAcc()).get(day)!, e, pr);
        const mr = t.modelRef ?? "(未记录)";
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
  return {
    repoPaths,
    totals: sumAcc(taskAccs),
    byDay: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, a]) => ({ day, ...sumAcc([a]), cost: a.priced ? round(a.cost) : null })),
    byModel: [...byModel.entries()].sort((a, b) => b[1].input - a[1].input).map(([modelRef, a]) => ({ modelRef, ...sumAcc([a]), cost: a.priced ? round(a.cost) : null })),
    byTask: byTask.map((t) => ({ ...t })),
    emptyRepos,
  };
}

function round(n: number | null): number | null {
  return n === null ? null : Math.round(n * 1e4) / 1e4;
}
