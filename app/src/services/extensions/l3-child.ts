/**
 * L3 子进程客户端（extension-system-v2.md §16.6 F 阶段）：
 * 隔离子进程内的插件经本模块与宿主通信（能力调用 RPC + 工具回调 + 事件下发）。
 * 双环境自适应：Node child_process.fork → process.send/on("message")；
 * Electron utilityProcess → process.parentPort.postMessage/on("message")。
 * 用法：const { connectL3 } = require(宿主 init 下发的 sdkDir + "/services/extensions/l3-child");
 *       connectL3().then((ctx) => { ... });
 * 未授权能力调用会被宿主拒绝（permission denied）——权限清单在 manifest.permissions。
 */

interface PortLike {
  post(msg: unknown): void;
}

function detectPort(): PortLike & { listen(cb: (msg: any) => void): void } {
  const pp = (process as unknown as { parentPort?: { postMessage(m: unknown): void; on(event: string, cb: (e: { data: unknown }) => void): void } }).parentPort;
  if (pp) {
    return {
      post: (m) => pp.postMessage(m),
      listen: (cb) => pp.on("message", (e) => cb((e as { data?: unknown }).data ?? e)),
    };
  }
  const p = process as unknown as { send?(m: unknown): void; on(event: string, cb: (m: unknown) => void): void };
  if (!p.send) throw new Error("L3 子进程未检测到 IPC 通道（需要 fork/utilityProcess 启动）");
  return {
    post: (m) => p.send!(m),
    listen: (cb) => p.on("message", (m) => cb(m)),
  };
}

export interface L3Ctx {
  packageId: string;
  permissions: string[];
  storage: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
  };
  notify(title: string, body?: string): Promise<void>;
  on(event: string, handler: (payload: Record<string, unknown>) => void): Promise<void>;
  /** 只读 git API（git.read 权限） */
  git: {
    status(): Promise<string>;
    log(limit?: number): Promise<string>;
    branches(): Promise<string>;
  };
  registerTool(def: {
    name: string;
    description: string;
    permission?: "read" | "write:gate";
    execute(args: Record<string, unknown>): Promise<string> | string;
  }): Promise<void>;
  registerStatusItem(id: string, item: { text: string; tooltip?: string; command?: string }): Promise<void>;
  /** webview 视图容器（webview 权限；静态 HTML，渲染层沙箱 iframe 无脚本） */
  registerView(id: string, view: { title: string; html: string }): Promise<void>;
}

export function connectL3(): Promise<L3Ctx> {
  const port = detectPort();
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const toolHandlers = new Map<string, (args: Record<string, unknown>) => Promise<string> | string>();
  const eventHandlers = new Map<string, (payload: Record<string, unknown>) => void>();

  const call = <T>(cap: string, method: string, args: Record<string, unknown> = {}): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`${cap}.${method} 超时`));
        }
      }, 20_000);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      port.post({ type: "cap", id, cap, method, args });
    });

  return new Promise<L3Ctx>((resolve) => {
    port.listen((raw) => {
      const msg = raw as {
        type: string;
        packageId?: string;
        permissions?: string[];
        id?: number;
        ok?: boolean;
        data?: unknown;
        error?: string;
        cap?: string;
        method?: string;
        name?: string;
        args?: Record<string, unknown>;
        event?: string;
        payload?: Record<string, unknown>;
      };
      if (msg.type === "init") {
        const packageId = msg.packageId ?? "?";
        const permissions = msg.permissions ?? [];
        const ctx: L3Ctx = {
          packageId,
          permissions,
          storage: {
            get: (key) => call("storage", "get", { key }),
            set: (key, value) => call("storage", "set", { key, value }).then(() => undefined),
          },
          notify: (title, body) => call("notify", "show", { title, body }).then(() => undefined),
          on: (event, handler) => {
            eventHandlers.set(event, handler);
            return call("events", "subscribe", { event }).then(() => undefined);
          },
          git: {
            status: () => call("git.read", "status", {}),
            log: (limit) => call("git.read", "log", { limit: limit ?? 5 }),
            branches: () => call("git.read", "branches", {}),
          },
          registerTool: (def) => {
            toolHandlers.set(def.name, def.execute);
            return call("tools", "register", { name: def.name, description: def.description, permission: def.permission ?? "read" }).then(() => undefined);
          },
          registerStatusItem: (id, item) => call("statusbar", "register", { id, ...item }).then(() => undefined),
          registerView: (id, view) => call("webview", "register", { id, ...view }).then(() => undefined),
        };
        port.post({ type: "ready" });
        resolve(ctx);
        return;
      }
      if (msg.type === "capResult" && msg.id !== undefined) {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.data);
        else p.reject(new Error(msg.error ?? "capability error"));
        return;
      }
      if (msg.type === "toolCall" && msg.id !== undefined) {
        const handler = toolHandlers.get(msg.name ?? "");
        Promise.resolve()
          .then(() => handler!(msg.args ?? {}))
          .then(
            (data) => port.post({ type: "toolResult", id: msg.id, ok: true, data }),
            (e) => port.post({ type: "toolResult", id: msg.id, ok: false, error: (e as Error).message }),
          );
        return;
      }
      if (msg.type === "event" && msg.event) {
        eventHandlers.get(msg.event)?.(msg.payload ?? {});
      }
    });
  });
}
