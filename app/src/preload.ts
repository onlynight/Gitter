import { contextBridge, ipcRenderer } from "electron";

/**
 * 渲染层唯一入口（winui3-to-web-migration.md §3.3 安全模型）：
 * 只暴露 invoke(method, params) + 事件订阅，无 Node 能力泄漏。
 */
contextBridge.exposeInMainWorld("gitter", {
  invoke: (method: string, params?: unknown) => ipcRenderer.invoke("rpc", method, params),
  onEvent: (cb: (method: string, params: unknown) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, msg: { method: string; params: unknown }) => {
      try {
        cb(msg.method, msg.params);
      } catch {
        // 事件回调异常不上抛主进程
      }
    };
    ipcRenderer.on("evt", listener);
    return () => ipcRenderer.removeListener("evt", listener);
  },
  winAction: (action: "min" | "max" | "close") => ipcRenderer.send("win.action", action),
  isMaximized: () => ipcRenderer.invoke("win.isMaximized"),
});
