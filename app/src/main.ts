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
import { ToolRegistry, builtinGitTools } from "./services/extensions/tools";
import { EventBus } from "./services/extensions/events";
import { PluginStorage } from "./services/extensions/storage";
import { PluginHost } from "./services/extensions/host";
import { McpClientManager } from "./services/extensions/mcpClient";
import { bindToolRegistry } from "./services/extensions/agentLoop";

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
  const tools = new ToolRegistry(builtinGitTools());
  const events = new EventBus();
  bindToolRegistry(tools);
  const mcpMgr = new McpClientManager();
  const host = new PluginHost({
    registry: commands,
    tools,
    events,
    storage: new PluginStorage(path.join(userData, "plugin-data")),
    notify: (title, body) => {
      for (const b of bridges.values()) {
        if (!b.isWindowDestroyed()) b.sendNotify(title, body);
      }
    },
    // L3 隔离子进程（Electron utilityProcess 适配器；无头冒烟走 Node fork 适配器）
    utilityTransport: (entryPath, serviceName, sdkDir) => {
      const { utilityProcess } = require("electron") as typeof import("electron");
      const up = utilityProcess.fork(entryPath, [sdkDir], { serviceName });
      return {
        send: (m) => up.postMessage(m),
        onMessage: (cb) => up.on("message", (m) => cb((m as { data?: unknown }).data ?? m)),
        onExit: (cb) => up.on("exit", (code) => cb(code ?? 0)),
        kill: () => up.kill(),
      };
    },
    sdkDir: __dirname,
  });
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
    tools,
    events,
    host,
    mcpMgr,
    userPackagesRoot: path.join(userData, "packages"),
    userThemesRoot: path.join(userData, "themes"),
    createWindow: (repoPath?: string) => createWindow(repoPath),
  };

  registerIpc();
  const repoArg = process.argv.slice(1).find((a) => looksLikeRepoArg(a));
  createWindow(repoArg);

  // 启动级验证钩子（scripts/boot-check.mjs）：定时退出前对渲染层做 UI 断言——
  // 侧边栏导航项 ≥ 7 + root 已渲染 + 槽位运行时（GITTER_UI/GITTER_KIT 已装，
  // 七个槽位全部解析到内置页面包提供者 gitui.page.*——R9 后宿主 bundle 零页面代码）；失败退出码 3/4。
  const bootExitMs = Number(process.env.GITTER_BOOT_EXIT_MS ?? 0);
  if (bootExitMs > 0) {
    // E2E 权限探针（scripts/e2e-pages-check.mjs 驱动，GITTER_E2E=1 门控）：
    // 真点击终端页（terminal.ensure 需 terminal 域）→ 断言页面无 "permission denied"——
    // __caller permissions 闭包捕获的端到端验证（无头冒烟只能静态断言）。
    if (process.env.GITTER_E2E === "1") {
      setTimeout(async () => {
        try {
          const win = BrowserWindow.getAllWindows()[0];
          await win.webContents.executeJavaScript(
            "document.querySelectorAll('.nav-top .nav-item')[5].click()"); // bash（注册表序 projects..bash）
          await new Promise((r) => setTimeout(r, 3000));
          const text = await win.webContents.executeJavaScript(
            "document.querySelector('.page')?.innerText?.slice(0, 2000) ?? ''");
          if (text.includes("permission denied")) {
            process.stdout.write("[e2e] FAIL: 终端页出现 permission denied — " + text.slice(0, 120).replace(/\n/g, " ") + "\n");
          } else if (/PowerShell|bash|cmd|·/.test(text)) {
            process.stdout.write("[e2e] PASS: 终端页正常挂载（terminal 域放行）\n");
          } else {
            process.stdout.write("[e2e] WARN: 终端页内容不可识别 — " + text.slice(0, 120).replace(/\n/g, " ") + "\n");
          }
        } catch (e) {
          process.stdout.write("[e2e] FAIL: 探针异常 " + (e as Error).message + "\n");
        }
      }, Math.max(bootExitMs - 9000, 3000));
    }
    setTimeout(async () => {
      try {
        const win = BrowserWindow.getAllWindows()[0];
        const r = await win.webContents.executeJavaScript(`(() => {
          const navCount = document.querySelectorAll('.nav-item').length;
          const rootRendered = !!document.getElementById('root') && document.getElementById('root').children.length > 0;
          const gitterUi = !!window.GITTER_UI && typeof window.GITTER_UI.registerPage === "function";
          const kit = !!window.GITTER_KIT && !!window.GITTER_KIT.React && !!window.GITTER_KIT.DiffView;
          const pageMounted = !!document.querySelector('.page .toolbar') || !!document.querySelector('.page .settings-page') || !!document.querySelector('.page .empty-state');
          const navLabels = [...document.querySelectorAll('.nav-top .nav-item .nav-label')].map((e) => e.textContent ?? "");
          return { navCount, rootRendered, gitterUi, kit, pageMounted, navLabels };
        })()`);
        const slots = ["projects", "log", "changes", "branches", "tasks", "bash", "settings"];
        const resolved: Record<string, { source: string; isBuiltInPackage: boolean } | null> = {};
        for (const s of slots) {
          resolved[s] = await win.webContents.executeJavaScript(
            `window.__gitterDebugResolve ? window.__gitterDebugResolve(${JSON.stringify(s)}) : null`);
        }
        const slotsOk = slots.every((s) => resolved[s] && resolved[s]!.source === "package" && resolved[s]!.isBuiltInPackage);
        // 首个主导航 = projects（注册表 order 排序防回潮：包元数据继承内置身份 order）
        const firstNavOk = !!r.navLabels[0] && /projects|项目/i.test(r.navLabels[0]);
        const ok = r.navCount >= 7 && r.rootRendered && r.gitterUi && r.kit && r.pageMounted && slotsOk && firstNavOk;
        process.stdout.write("[boot] UI 断言: " + JSON.stringify({ ...r, slots: Object.fromEntries(slots.map((s) => [s, resolved[s]?.isBuiltInPackage === true ? "builtin-package" : resolved[s]?.source ?? null])) }) + "\n");
        app.exit(ok ? 0 : 3);
      } catch {
        app.exit(4);
      }
    }, bootExitMs);
  }

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
