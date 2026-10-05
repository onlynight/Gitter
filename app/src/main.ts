import { app, BrowserWindow, ipcMain, Menu } from "electron";
import * as path from "path";
import { Bridge, SharedServices } from "./bridge";
import { SettingsStore } from "./services/settings";
import { I18nService, resourcePaths } from "./services/i18n";
import { ThemeService } from "./services/themes";
import { HighlightService } from "./services/highlight";

// 无头烟雾模式：node dist/smoke.js 由 smoke.ts 单独入口承担（本文件不参与）。
// 判定：electron 主入口被直接要求运行 smoke 时跳过窗口创建。
const argv = process.argv.slice(1);
if (argv.some((a) => a === "--smoke")) {
  // 由 smoke.ts 作为独立 node 入口运行；electron 入口下不执行（防呆）
}

const bridges = new Map<number, Bridge>();
let shared: SharedServices;

export function createWindow(repoPath?: string): void {
  const win = new BrowserWindow({
    width: 1120,
    height: 700,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: "#1E1F22",
    titleBarStyle: "hidden",
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const bridge = new Bridge(win, shared);
  bridges.set(win.id, bridge);
  win.once("closed", () => {
    bridge.dispose();
    bridges.delete(win.id);
  });
  win.once("ready-to-show", () => win.show());

  // 自定义标题栏窗口控制（渲染层拖拽区 + 三键）
  ipcMain.on("win.action", (e, action: string) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) return;
    if (action === "min") w.minimize();
    else if (action === "max") w.isMaximized() ? w.unmaximize() : w.maximize();
    else if (action === "close") w.close();
  });
  ipcMain.handle("win.isMaximized", (e) => BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false);

  win.on("maximize", () => win.webContents.send("evt", { method: "win.maximized", params: { value: true } }));
  win.on("unmaximize", () => win.webContents.send("evt", { method: "win.maximized", params: { value: false } }));

  if (repoPath) {
    // 渲染层加载后按 settings.currentProjectPath / 显式路径恢复仓库
    win.webContents.once("did-finish-load", () => {
      if (repoPath) win.webContents.send("evt", { method: "app.openRepo", params: { path: repoPath } });
    });
  }

  // 产物经 vite 构建到 ../web/dist（csproj 拷贝链已废，改为 npm build 链）
  win.loadFile(path.join(__dirname, "..", "..", "web", "dist", "index.html"));
}

function registerRpc() {
  ipcMain.handle("rpc", async (e, method: string, args: unknown) => {
    const bridge = bridges.get(BrowserWindow.fromWebContents(e.sender)?.id ?? -1);
    if (!bridge) return { ok: false, error: { message: "窗口未初始化" } };
    return bridge.handle(method, args);
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // 自绘标题栏 + 渲染层快捷键接管

  const userData = app.getPath("userData");
  const res = resourcePaths(process.env.GITTER_RESOURCES ?? app.getAppPath() + "/resources");
  const settings = new SettingsStore(userData);
  const i18n = new I18nService(res.stringsTsv);
  const themes = new ThemeService(res.themesRoot, path.join(userData, "themes"));
  const highlightSvc = new HighlightService(res.syntaxRulesPath);

  shared = {
    settings,
    i18n,
    themes,
    highlight: highlightSvc,
    createWindow: (repoPath?: string) => createWindow(repoPath),
  };

  registerRpc();
  createWindow(process.argv[process.argv.length - 1] && looksLikeRepoArg(process.argv[process.argv.length - 1]) ? process.argv[process.argv.length - 1] : undefined);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function looksLikeRepoArg(p: string): boolean {
  try {
    const { looksLikeRepo } = require("./services/gitexec") as { looksLikeRepo: (d: string) => boolean };
    const fs = require("fs") as typeof import("fs");
    return fs.existsSync(p) && looksLikeRepo(p);
  } catch {
    return false;
  }
}

app.on("window-all-closed", () => {
  app.quit();
});

// 单实例：再次启动 → 聚焦已有窗口（可选带仓库路径则开新窗，对齐 WinUI 行为）
if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on("second-instance", (_e, argv2) => {
  const repoArg = argv2.find((a) => !a.startsWith("-") && looksLikeRepoArg(a));
  if (repoArg) createWindow(repoArg);
  else {
    const [w] = BrowserWindow.getAllWindows();
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  }
});
