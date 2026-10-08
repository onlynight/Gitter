import { execFile } from "child_process";
import * as fs from "fs/promises";
import { registerTurnHook } from "./seams";

/**
 * 前缀缓存卫兵（agent-harness-v4.md §二十二）：
 * DeepSeek 等提供方按请求前缀命中 KV cache——命中率由 harness 组装纪律决定。
 * 本模块承接"易变状态"的正确位置：每轮采样的 git 状态不进系统提示词（K1–K3），
 * 改由 post-turn 钩子在轮末（checkpoint 之后，天然稳定点）采样，经宿主
 * system-reminder 通道注入下一轮尾部；变更检测保证零变化零注入（前缀逐字节不动）。
 * 内置自举：经 registerTurnHook 公开接缝注册，与插件钩子同表并列、同审计、同总闸。
 */

interface WorkspaceSnapshot {
  branch: string;
  changed: number;
  topLevel: string;
}

const BASELINE_CAP = 500;
const TOP_CAP = 40;
const TOP_DELTA_CAP = 10;
const TOP_SEP = "  ";

const baselines = new Map<string, WorkspaceSnapshot>();

/** git -C 只读采样（1.5s 超时；失败返回 null 由钩子软跳过）。 */
function gitOut(cwd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", ["-C", cwd, ...args], { timeout: 1500, windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout) => {
      resolve(err ? null : String(stdout));
    });
  });
}

async function sampleWorkspace(worktreePath: string): Promise<WorkspaceSnapshot | null> {
  const [branchRaw, statusRaw, entries] = await Promise.all([
    gitOut(worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"]),
    gitOut(worktreePath, ["status", "--porcelain"]),
    fs.readdir(worktreePath, { withFileTypes: true }).catch(() => null),
  ]);
  if (branchRaw === null || entries === null) return null;
  const branch = branchRaw.trim() || "未知";
  const changed = statusRaw ? statusRaw.split("\n").filter((l) => l.trim()).length : 0;
  const topLevel = entries
    .map((d) => (d.isDirectory() ? d.name + "/" : d.name))
    .filter((n) => n !== ".git/")
    .sort()
    .slice(0, TOP_CAP)
    .join(TOP_SEP);
  return { branch, changed, topLevel };
}

function topLevelDelta(prev: string, cur: string): string | null {
  const parse = (s: string) => new Set(s ? s.split(TOP_SEP).filter(Boolean) : []);
  const a = parse(prev);
  const b = parse(cur);
  const added = [...b].filter((x) => !a.has(x));
  const removed = [...a].filter((x) => !b.has(x));
  const parts: string[] = [];
  if (added.length > 0) parts.push(`顶层新增：${added.slice(0, TOP_DELTA_CAP).join(" ")}${added.length > TOP_DELTA_CAP ? " 等" : ""}`);
  if (removed.length > 0) parts.push(`顶层移除：${removed.slice(0, TOP_DELTA_CAP).join(" ")}${removed.length > TOP_DELTA_CAP ? " 等" : ""}`);
  return parts.length > 0 ? parts.join("；") : null;
}

registerTurnHook({
  id: "builtin.hook.cache-guard",
  order: 10,
  source: "builtin",
  hook: async (info) => {
    if (!info.worktreePath) return null;
    const cur = await sampleWorkspace(info.worktreePath);
    if (!cur) return null;
    const prev = baselines.get(info.taskId) ?? null;
    baselines.delete(info.taskId);
    baselines.set(info.taskId, cur);
    if (baselines.size > BASELINE_CAP) {
      const oldest = baselines.keys().next().value;
      if (oldest !== undefined) baselines.delete(oldest);
    }
    if (!prev) {
      const top = cur.topLevel ? `；顶层条目：${cur.topLevel}` : "";
      return `仓库状态基线（轮末采样）：分支 ${cur.branch}；${cur.changed} 个文件有变更${top}。本提醒仅在状态变化时更新。`;
    }
    if (prev.branch === cur.branch && prev.changed === cur.changed && prev.topLevel === cur.topLevel) return null;
    const parts: string[] = [
      prev.branch === cur.branch ? `分支 ${cur.branch}` : `分支 ${prev.branch} → ${cur.branch}`,
      prev.changed === cur.changed ? `${cur.changed} 个文件有变更` : `${prev.changed} → ${cur.changed} 个文件有变更`,
    ];
    const delta = topLevelDelta(prev.topLevel, cur.topLevel);
    if (delta) parts.push(delta);
    return `仓库状态更新（轮末采样）：${parts.join("；")}。`;
  },
});

/** 测试辅助：清空基线状态（smoke 场景隔离用）。 */
export function cacheGuardReset(): void {
  baselines.clear();
}
