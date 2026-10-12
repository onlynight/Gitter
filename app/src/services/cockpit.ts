import type { AgentTaskRecord } from "./agents/types";

/**
 * 跨窗口任务驾驶舱（M3.4 harness-mainline-roadmap.md）：
 * 主进程级注册表——每个 Bridge 把自己的 AgentSessionManager 按 repoPath 登记，
 * app.allTasks RPC 聚合全部存活会话的任务摘要（项目页"进行中任务"区块数据源）。
 * 单进程内存态，不落盘；Bridge dispose 注销。
 */

export interface CockpitTaskRow {
  repoPath: string;
  repoName: string;
  taskId: string;
  title: string;
  state: string;
  branch: string;
  modelRef: string | null;
  lastMessage: string | null;
  lastActiveAt: string | null;
  review: { status: string; comment: string | null; at: string } | null;
}

interface Registration {
  /** null = 窗口未开仓库（摘要里跳过该会话） */
  repoPath: string | null;
  listTasks: () => AgentTaskRecord[];
}

export class CockpitRegistry {
  private readonly sessions = new Map<string, Registration>();

  register(key: string, reg: Registration): void {
    this.sessions.set(key, reg);
  }

  unregister(key: string): void {
    this.sessions.delete(key);
  }

  /** 聚合全部注册会话的任务（单会话失败跳过；软失败原则）。 */
  allTasks(): CockpitTaskRow[] {
    const out: CockpitTaskRow[] = [];
    for (const reg of this.sessions.values()) {
      if (!reg.repoPath) continue;
      try {
        for (const t of reg.listTasks()) {
          if (t.archived) continue;
          out.push({
            repoPath: reg.repoPath,
            repoName: reg.repoPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? reg.repoPath,
            taskId: t.taskId,
            title: t.title,
            state: t.state,
            branch: t.branch,
            modelRef: t.modelRef,
            lastMessage: t.lastMessage,
            lastActiveAt: t.lastActiveAt,
            review: t.review ? { status: t.review.status, comment: t.review.comment, at: t.review.at } : null,
          });
        }
      } catch {
        /* 单会话失败不拖累聚合 */
      }
    }
    const rank: Record<string, number> = {
      "awaiting-permission": 0, "awaiting-input": 1, working: 2, starting: 3,
      interrupted: 4, failed: 5, stopped: 6, completed: 7,
    };
    return out.sort((a, b) =>
      (rank[a.state] ?? 9) - (rank[b.state] ?? 9) ||
      (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? ""));
  }
}
