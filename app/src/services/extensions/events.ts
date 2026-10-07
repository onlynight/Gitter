/**
 * 事件总线（extension-system-v2.md §16.5 C 阶段接缝）：
 * 宿主在操作成功后发射；L2 插件经 ctx.on 订阅（L3 走 RPC 存根，F 阶段）。
 * 事件名是宿主枚举——插件不能自定义事件源（架构边界，非缺陷）。
 */

export const EVENT_NAMES = [
  "repo.opened",
  "repo.closed",
  "changes.updated",
  "commit.created",
  "branch.checkedOut",
  "sync.pushed",
  "sync.pulled",
  "agent.task.created",
  "agent.task.resumed",
  "agent.task.stopped",
  "agent.task.removed",
  // §20.3.6 事件面细化（全部只读广播；pre-tool 拦截不开放）
  "agent.turn.started",
  "agent.turn.completed",
  "agent.tool.called",
  "agent.permission.raised",
  "agent.permission.decided",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];
export type EventHandler = (payload: Record<string, unknown>) => void | Promise<void>;

interface Subscription {
  owner: string;
  fn: EventHandler;
}

export class EventBus {
  private handlers = new Map<string, Set<Subscription>>();

  on(event: EventName | string, owner: string, fn: EventHandler): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    const sub: Subscription = { owner, fn };
    set.add(sub);
    return () => set!.delete(sub);
  }

  off(event: string, owner: string): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const sub of [...set]) {
      if (sub.owner === owner) set.delete(sub);
    }
  }

  clearOwner(owner: string): void {
    for (const set of this.handlers.values()) {
      for (const sub of [...set]) {
        if (sub.owner === owner) set.delete(sub);
      }
    }
  }

  /** 发射：单 handler 异常不上抛（隔离），其余继续；宿主调用点 await 以保顺序。 */
  async emit(event: EventName | string, payload: Record<string, unknown> = {}): Promise<void> {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) return;
    for (const sub of [...set]) {
      try {
        await sub.fn({ ...payload });
      } catch (e) {
        console.warn(`[events] handler ${sub.owner}@${event} 失败:`, (e as Error).message);
      }
    }
  }

  handlerCount(event?: string): number {
    if (event) return this.handlers.get(event)?.size ?? 0;
    let n = 0;
    for (const set of this.handlers.values()) n += set.size;
    return n;
  }
}
