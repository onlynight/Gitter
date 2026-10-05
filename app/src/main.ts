import { app, BrowserWindow, ipcMain, Menu } from "electron";
import * as path from "path";
import { Bridge, SharedServices } from "./bridge";
import { SettingsStore } from "./services/settings";
import { I18nService, resourcePaths } from "./services/i18n";
import { ThemeService } from "./services/themes";
import { HighlightService } from "./services/highlight";
import { PackageStore } from "./services/extensions/store";
import { CommandRegistry, BUILTIN_COMMANDS } from "./services/extensions/commands";
import { GrammarService } from "./services/extensions/grammar";

const bridges = new Map<number, Bridge>();
let shared: SharedServices;

/** 窗口创建（首窗 / 命令面板与项目·任务页"新窗口"/ second-instance）。 */
function createWindow(repoPath?: string): void {
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

  win.on("maximize", () => win.webContents.send("evt", { method: "win.maximized", params: { value: true } }));
  win.on("unmaximize", () => win.webContents.send("evt", { method: "win.maximized", params: { value: false } }));

  if (repoPath) {
    // 渲染层加载后按显式路径恢复仓库
    win.webContents.once("did-finish-load", () => {
      win.webContents.send("evt", { method: "app.openRepo", params: { path: repoPath } });
    });
  }

  // 产物经 vite 构建到 ../web/dist
  win.loadFile(path.join(__dirname, "..", "..", "web", "dist", "index.html"));
}

/** 全局 IPC：只在启动时注册一次。窗口级 handle 重复注册会抛异常，
 * 曾导致"新窗口"按钮（第二窗创建）静默失败。 */
function registerIpc() {
  ipcMain.handle("rpc", async (e, method: string, args: unknown) => {
    const bridge = bridges.get(BrowserWindow.fromWebContents(e.sender)?.id ?? -1);
    if (!bridge) return { ok: false, error: { message: "窗口未初始化" } };
    return bridge.handle(method, args);
  });

  // 自定义标题栏窗口控制（渲染层拖拽区 + 三键）
  ipcMain.on("win.action", (e, action: string) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) return;
    if (action === "min") w.minimize();
    else if (action === "max") w.isMaximized() ? w.unmaximize() : w.maximize();
    else if (action === "close") w.close();
  });
  ipcMain.handle("win.isMaximized", (e) => BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false);
}

function looksLikeRepoArg(p: string): boolean {
  try {
    const { looksLikeRepo } = require("./services/gitexec") as { looksLikeRepo: (d: string) => boolean };
    const fs = require("fs") as typeof import("fs");
    return fs.existsSync(p) && looksLikeRepo(p);
  } catch {
    return false;
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // 自绘标题栏 + 渲染层快捷键接管

  const userData = app.getPath("userData");
  // resourcePaths(root) 内部自拼 resources/ 子目录——root 必须是 app 根目录，
  // 不能传 resources 本身（双拼导致 i18n/主题/高亮数据全部 404，曾致词条全显 key）
  const res = resourcePaths(process.env.GITTER_RESOURCES ?? app.getAppPath());
  const settings = new SettingsStore(userData);
  const i18n = new I18nService(res.stringsTsv);
  // 扩展宿主内核（extension-system-v2.md §六）：用户根优先遮蔽内置根；
  // 内置根含 v1 主题包目录（resources/themes，兼容装载）与 v2 包根（resources/packages）
  const pkgStore = new PackageStore(
    [res.themesRoot, res.packagesRoot],
    [path.join(userData, "packages"), path.join(userData, "themes")],
    app.getVersion(),
    () => settings.current.packages ?? {},
  );
  const themes = new ThemeService(pkgStore);
  const highlightSvc = new HighlightService(res.syntaxRulesPath);
  const commands = new CommandRegistry(BUILTIN_COMMANDS);
  commands.registerPackageCommands(pkgStore);
  const grammarSvc = new GrammarService(pkgStore, grammarDataRoot(), onigWasmPath());
  grammarSvc.registerUserGrammars();
  if (Object.keys(i18n.get("en").strings).length === 0) {
    console.warn("[gitter] i18n 字典为空，检查资源路径:", res.stringsTsv);
  }

  shared = {
    settings,
    i18n,
    themes,
    highlight: highlightSvc,
    pkgStore,
    commands,
    grammar: grammarSvc,
    userPackagesRoot: path.join(userData, "packages"),
    userThemesRoot: path.join(userData, "themes"),
    createWindow: (repoPath?: string) => createWindow(repoPath),
  };

  registerIpc();
  const repoArg = process.argv.slice(1).find((a) => looksLikeRepoArg(a));
  createWindow(repoArg);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});

/** tm-grammars 数据根（内置 260 语言语法；npm 数据包缺失时 TextMate 路径自动关闭，回退声明式）。 */
function grammarDataRoot(): string {
  try {
    return path.dirname(require.resolve("tm-grammars/grammars/typescript.json"));
  } catch {
    return "";
  }
}

function onigWasmPath(): string {
  try {
    return require.resolve("vscode-oniguruma/release/onig.wasm");
  } catch {
    return "";
  }
}

// 单实例：再次启动 → 聚焦已有窗口（带仓库路径则开新窗，对齐 WinUI 行为）
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
