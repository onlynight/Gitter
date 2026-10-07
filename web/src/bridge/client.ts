// 桥客户端：渲染层唯一宿主入口（preload 暴露 window.gitter）。
// 呼应 app/src/preload.ts；错误封套在主进程 bridge.handle 展开。

type EventListener = (method: string, params: unknown) => void;

interface GitterApi {
  invoke(method: string, params?: unknown): Promise<
    { ok: true; data: unknown } | { ok: false; error: { message: string; detail?: string } }
  >;
  onEvent(cb: EventListener): () => void;
  winAction(action: "min" | "max" | "close"): void;
  isMaximized(): Promise<boolean>;
}

declare global {
  interface Window {
    gitter?: GitterApi;
  }
}

function api(): GitterApi {
  if (!window.gitter) {
    // 浏览器直接打开（vite dev 调试）时的桩：桥调用全部失败但不崩
    return {
      invoke: async () => ({ ok: false, error: { message: "不在 Electron 宿主内（桥不可用）" } }),
      onEvent: () => () => {},
      winAction: () => {},
      isMaximized: async () => false,
    };
  }
  return window.gitter;
}

export class BridgeCallError extends Error {
  constructor(message: string, public detail?: string) {
    super(message);
  }
}

export async function call<T>(method: string, params?: unknown): Promise<T> {
  const res = await api().invoke(method, params);
  if (!res.ok) throw new BridgeCallError(res.error.message, res.error.detail);
  return res.data as T;
}

// ---- 事件总线（terminal.data / terminal.exit / win.maximized / app.openRepo）----

const listeners = new Set<EventListener>();
let subscribed = false;

function ensureSubscribe() {
  if (subscribed) return;
  subscribed = true;
  api().onEvent((method, params) => {
    for (const fn of listeners) {
      try {
        fn(method, params);
      } catch {
        // 单个订阅者异常不影响其他
      }
    }
  });
}

export function onEvent(method: string, cb: (params: never) => void): () => void {
  ensureSubscribe();
  const fn: EventListener = (m, p) => {
    if (m === method) cb(p as never);
  };
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const winAction = (action: "min" | "max" | "close") => api().winAction(action);
export const isMaximized = () => api().isMaximized();
