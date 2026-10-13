import * as fs from "fs";
import { app, BrowserWindow, contentTracing, ipcMain, Menu, nativeTheme, safeStorage, screen } from "electron";
import * as os from "os";
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
import { OAuthManager } from "./services/oauth";
import { CockpitRegistry } from "./services/cockpit";
import { parseHeadlessArgs, runHeadless } from "./headless";
import { initUpdater } from "./services/updater";

const bridges = new Map<number, Bridge>();
let shared: SharedServices;

/** 窗口背景材质（Windows 11 22H2+ 的 Mica/Acrylic，Codex 式模糊窗口）：
 * backgroundMaterial 需要 backgroundColor 全透明才会透出材质；
 * 不支持的系统（Win10 / 非 Windows）一律回退 none + 不透明底色。 */
function windowMaterialSupported(): boolean {
  if (process.platform !== "win32") return false;
  const build = Number(os.release().split(".")[2] ?? 0);
  return build >= 22621;
}

function resolveWindowMaterial(material?: string | null): "none" | "mica" | "acrylic" {
  const requested = material === "mica" || material === "acrylic" ? material : "none";
  if (requested === "none" || !windowMaterialSupported()) return "none";
  return requested;
}

/** CSS 颜色 → 与 ground 合成的不透明 hex（材质关闭时窗口底色用：主题 Base 自带 alpha，
 * 直接透传会被 Electron 当黑底合成——按基座亮暗选 ground 压平）。 */
function flattenColorToOpaque(raw: string | undefined, ground: { r: number; g: number; b: number }): string | null {
  if (!raw) return null;
  const v = raw.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(v);
  let r: number, g: number, b: number, a = 1;
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length === 6) h += "ff";
    if (h.length !== 8) return null;
    const n = parseInt(h, 16);
    r = (n >>> 24) & 255; g = (n >>> 16) & 255; b = (n >>> 8) & 255; a = (n & 255) / 255;
  } else {
    const rgb = /^rgba?\(([^)]+)\)$/i.exec(v);
    if (!rgb) return null;
    const parts = rgb[1].split(",").map((s) => parseFloat(s.trim()));
    if (parts.length < 3 || parts.slice(0, 3).some((n) => Number.isNaN(n))) return null;
    r = parts[0]; g = parts[1]; b = parts[2];
    a = parts.length >= 4 && !Number.isNaN(parts[3]) ? Math.min(1, Math.max(0, parts[3])) : 1;
  }
  const ch = (c: number, gr: number) => Math.round(c * a + gr * (1 - a));
  return "#" + [ch(r, ground.r), ch(g, ground.g), ch(b, ground.b)].map((c) => c.toString(16).padStart(2, "0")).join("");
}

/** 材质关闭时的窗口不透明底色 = 当前主题 Base 压平（亮色基座合成白底、暗色合成黑底）。 */
function currentOpaqueBackground(): string {
  if (shared?.themes && shared?.settings) {
    try {
      const theme = shared.themes.resolve(shared.settings.current.themePackageId, "dark");
      const ground = theme.base === "light" ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
      return flattenColorToOpaque(theme.tokens.Base, ground) ?? "#1E1F22";
    } catch {
      // 主题服务未就绪：回退缺省底色
    }
  }
  return "#1E1F22";
}

/** 当前主题包声明的窗口材质（窗口效果唯一事实源 = 主题包；系统不支持时由 resolveWindowMaterial 回退 none）。 */
function activeThemeMaterial(): "none" | "mica" | "acrylic" {
  try {
    return shared?.themes?.resolve(shared?.settings?.current?.themePackageId ?? null, "dark")?.material ?? "none";
  } catch {
    return "none";
  }
}

/** 应用亮暗模式声明 → DWM 材质（Mica/Acrylic）与 Chromium（prefers-color-scheme、标题栏/菜单）
 * 跟随应用主题而非系统——暗色主题下系统材质底才会变暗，Base 无需高不透明度即可保住对比度。 */
function syncNativeTheme(): void {
  nativeTheme.themeSource = shared?.settings?.current?.theme ?? "system";
}

function applyWindowMaterialToAll(): void {
  syncNativeTheme();
  const resolved = resolveWindowMaterial(activeThemeMaterial());
  const opaqueBg = resolved === "none" ? currentOpaqueBackground() : "#00000000";
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      w.setBackgroundMaterial(resolved);
      w.setBackgroundColor(opaqueBg);
    } catch {
      // 旧 Electron/系统无此 API：静默保持不透明
    }
  }
}

// ---- 窗口状态持久化：记录正常尺寸/位置与最大化态，重启恢复上次状态 ----
type SavedWindowBounds = Electron.Rectangle & { isMaximized?: boolean };

function windowBoundsFile(): string {
  return path.join(app.getPath("userData"), "window-bounds.json");
}

function loadWindowBounds(): SavedWindowBounds | null {
  try {
    const raw = JSON.parse(fs.readFileSync(windowBoundsFile(), "utf8")) as SavedWindowBounds;
    return raw && typeof raw.width === "number" && typeof raw.height === "number" ? raw : null;
  } catch {
    return null;
  }
}

/** 至少 1/3 宽高落在某台显示器工作区内才恢复，防止拔掉显示器后窗口跑丢。 */
function boundsVisibleOnSomeDisplay(b: { x: number; y: number; width: number; height: number }): boolean {
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    const ox = Math.max(0, Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x));
    const oy = Math.max(0, Math.min(b.y + b.height, a.y + a.height) - Math.max(b.y, a.y));
    return ox >= Math.min(160, b.width / 3) && oy >= Math.min(120, b.height / 3);
  });
}

/** 窗口创建（首窗 / 命令面板与项目·任务页"新窗口"/ second-instance）。 */
function createWindow(repoPath?: string): void {
  syncNativeTheme();
  const material = resolveWindowMaterial(activeThemeMaterial());
  const saved = loadWindowBounds();
  const restored = saved && boundsVisibleOnSomeDisplay(saved) ? saved : null;
  const win = new BrowserWindow({
    width: restored?.width ?? (Number(process.env.GITTER_WIN?.split("x")[0]) || 1120),
    height: restored?.height ?? (Number(process.env.GITTER_WIN?.split("x")[1]) || 700),
    x: restored?.x,
    y: restored?.y,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: material === "none" ? currentOpaqueBackground() : "#00000000",
    backgroundMaterial: material,
    // dev（app/dist）与打包（asar 内同级）下 resources/ 都在 __dirname 上一级
    icon: path.join(__dirname, "..", "resources", "icons", "gitter.png"),
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

  // 尺寸/位置变更防抖落盘；关闭时兜底保存一次（getNormalBounds 在最大化时也返回正常态边界）
  let boundsTimer: NodeJS.Timeout | null = null;
  const persistBounds = () => {
    try {
      const b: SavedWindowBounds = { ...win.getNormalBounds(), isMaximized: win.isMaximized() };
      fs.mkdirSync(path.dirname(windowBoundsFile()), { recursive: true });
      fs.writeFileSync(windowBoundsFile(), JSON.stringify(b));
    } catch {
      // 落盘失败静默忽略（只读目录等）
    }
  };
  const schedulePersistBounds = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(persistBounds, 500);
  };
  win.on("resize", schedulePersistBounds);
  win.on("move", schedulePersistBounds);
  win.on("close", persistBounds);
  if (restored?.isMaximized) win.maximize();

  win.on("maximize", () => win.webContents.send("evt", { method: "win.maximized", params: { value: true } }));
  win.on("unmaximize", () => win.webContents.send("evt", { method: "win.maximized", params: { value: false } }));

  if (repoPath) {
    // 按显式路径恢复仓库。必须在渲染层自报就绪（gitter:dom-ready）之后发送：
    // did-finish-load 早于 React 首次提交，此刻 App 的 app.openRepo 监听尚未注册，
    // 直接 send 事件被丢弃——新窗只落项目页、不打开选中项目。
    // 若主窗口在渲染层就绪前就 did-finish-load（竞态），回退定时器兜底补发。
    let sent = false;
    const openRequested = (): void => {
      if (sent) return;
      sent = true;
      win.webContents.send("evt", { method: "app.openRepo", params: { path: repoPath } });
    };
    win.webContents.on("dom-ready", openRequested);
    win.webContents.once("did-finish-load", () => {
      if (!sent) setTimeout(openRequested, 2500);
    });
  }

  // 产物经 vite 构建到仓库根 ../web/dist（开发态）；打包后由 extraResources 复制到 resources/web/dist
  const webIndex = app.isPackaged
    ? path.join(process.resourcesPath, "web", "dist", "index.html")
    : path.join(__dirname, "..", "..", "web", "dist", "index.html");
  win.loadFile(webIndex);
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

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null); // 自绘标题栏 + 渲染层快捷键接管

  // ---- M1.5 headless 运行模式（electron . run --repo <path> -p "..."）：不建窗口，跑完即退 ----
  const runIdx = process.argv.indexOf("run", 1);
  if (runIdx > 0) {
    const argv = process.argv.slice(runIdx + 1);
    const usageFail = (msg: string): never => {
      process.stderr.write(
        `[gitter] ${msg}\n用法：electron . run --repo <仓库路径> -p "<任务描述>" [--yolo|--mode plan|default|yolo] [--model <档案id>] [--thinking off|low|medium|high] [--task-type <fullId>] [--json] [--timeout-sec N]\n`);
      app.exit(3);
      throw new Error(msg);
    };
    let code = 3;
    try {
      const hArgs = parseHeadlessArgs(argv, usageFail);
      if (!hArgs.prompt.trim()) {
        // 无 -p：从 stdin 读（管道友好）
        hArgs.prompt = await new Promise<string>((resolve) => {
          let buf = "";
          process.stdin.setEncoding("utf8");
          process.stdin.on("data", (d) => (buf += String(d)));
          process.stdin.on("end", () => resolve(buf.trim()));
          setTimeout(() => resolve(buf.trim()), 3000);
        });
      }
      if (!hArgs.prompt.trim()) usageFail("缺少 -p <任务描述>（或经 stdin 管道提供）");
      code = await runHeadless(hArgs, app.getAppPath(), app.getPath("userData"));
    } catch (e) {
      process.stderr.write(`[gitter] headless 失败：${(e as Error).message}\n`);
      code = 1;
    }
    app.exit(code);
    return;
  }

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

  const oauth = new OAuthManager(userData, {
    encrypt: (plain) => (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(plain).toString("base64") : null),
    decrypt: (blob) => {
      try {
        return safeStorage.decryptString(Buffer.from(blob, "base64"));
      } catch {
        return null;
      }
    },
  });
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
    oauth,
    cockpit: new CockpitRegistry(),
    userPackagesRoot: path.join(userData, "packages"),
    userThemesRoot: path.join(userData, "themes"),
    createWindow: (repoPath?: string) => createWindow(repoPath),
    applyWindowMaterial: () => applyWindowMaterialToAll(),
  };

  // M3.1 自动更新（打包态启用 electron-updater 事件面；更新源取 settings.updateCheckUrl）
  initUpdater(
    (method, params) => {
      for (const b of bridges.values()) {
        if (!b.isWindowDestroyed()) b.sendEvt(method, params);
      }
    },
    () => settings.current.updateCheckUrl,
  );

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
          // files 槽探针（nav-item[6]，order 70 位于 bash 之后）：lsp/git.write 域放行 + 页面正常挂载。
          // 无仓库时 files 页显示空态——断言目标是无 permission denied + 空态文案，而非终端 shell 名。
          await win.webContents.executeJavaScript(
            "document.querySelectorAll('.nav-top .nav-item')[6].click()"); // files
          await new Promise((r) => setTimeout(r, 3000));
          const ftext = await win.webContents.executeJavaScript(
            "document.querySelector('.page')?.innerText?.slice(0, 2000) ?? ''");
          if (ftext.includes("permission denied")) {
            process.stdout.write("[e2e] FAIL: 文件页出现 permission denied — " + ftext.slice(0, 120).replace(/\n/g, " ") + "\n");
          } else {
            process.stdout.write("[e2e] PASS: 文件页正常挂载（无 permission denied）— " + ftext.slice(0, 60).replace(/\n/g, " ") + "\n");
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
          const wm = document.documentElement.dataset.windowMaterial ?? null;
          // 主题令牌已自带 alpha（#RRGGBBAA）时 body 可能原样透传——两种形态都算混合生效
          const cb = document.body.style.getPropertyValue("--c-base");
          const wmBlend = wm && wm !== "none" ? (cb.includes("rgba(") || cb.replace("#", "").length === 8) : true;
          return { navCount, rootRendered, gitterUi, kit, pageMounted, navLabels, wm, wmBlend };
        })()`);
        const slots = ["projects", "log", "changes", "branches", "tasks", "bash", "files", "office", "settings"];
        const resolved: Record<string, { source: string; isBuiltInPackage: boolean } | null> = {};
        for (const s of slots) {
          resolved[s] = await win.webContents.executeJavaScript(
            `window.__gitterDebugResolve ? window.__gitterDebugResolve(${JSON.stringify(s)}) : null`);
        }
        const slotsOk = slots.every((s) => resolved[s] && resolved[s]!.source === "package" && resolved[s]!.isBuiltInPackage);
        // 首个主导航 = projects（注册表 order 排序防回潮：包元数据继承内置身份 order）
        const firstNavOk = !!r.navLabels[0] && /projects|项目/i.test(r.navLabels[0]);
        // 窗口材质链路（竞态安全：渲染层主题路径未跑完时 dataset 为空则跳过）：
        // dataset 已标 → 必须与主进程 resolve 结果一致，且非 none 时 --c-base 已混成 rgba（body 内联）
        const expectedMaterial = resolveWindowMaterial(activeThemeMaterial());
        const wmOk = !r.wm ? true : r.wm === expectedMaterial && (r.wm === "none" || r.wmBlend === true);
        const ok = r.navCount >= 8 && r.rootRendered && r.gitterUi && r.kit && r.pageMounted && slotsOk && firstNavOk && wmOk;
        process.stdout.write("[boot] UI 断言: " + JSON.stringify({ ...r, slots: Object.fromEntries(slots.map((s) => [s, resolved[s]?.isBuiltInPackage === true ? "builtin-package" : resolved[s]?.source ?? null])) }) + "\n");
        try {
          // 语言切换探测（永久回归门）：触发 reapplyLanguage + reloadExternalPages →
          // 断言七槽位提供者仍全部在册（热重载差量同步的防回潮断言）
          await win.webContents.executeJavaScript(
            "window.__gitterDebugReload && void window.__gitterDebugReload('en')");
          await new Promise((r2) => setTimeout(r2, 2500));
          const after: Record<string, { source: string } | null> = {};
          for (const s2 of ["projects", "log", "changes", "branches", "tasks", "bash", "files", "office", "settings"]) {
            after[s2] = await win.webContents.executeJavaScript(
              `window.__gitterDebugResolve ? window.__gitterDebugResolve(${JSON.stringify(s2)}) : null`);
          }
          const langOk = Object.entries(after).every(([, v]) => v && v.source === "package");
          process.stdout.write("[boot] 语言切换后槽位: " + JSON.stringify(Object.fromEntries(Object.entries(after).map(([k, v]) => [k, v ? v.source : null]))) + (langOk ? " OK" : " BROKEN") + "\n");
        } catch (e2) {
          process.stdout.write("[boot] 语言探测异常 " + String(e2) + "\n");
        }
        app.exit(ok ? 0 : 3);
      } catch {
        app.exit(4);
      }
    }, bootExitMs);
  }

  const shotPath = process.env.GITTER_SHOT;
  const shotPage = process.env.GITTER_SHOT_PAGE;
  const shotRepo = process.env.GITTER_SHOT_REPO;

  // 视觉验收截图钩子（GITTER_SHOT=<png 路径>，需配合 GITTER_BOOT_EXIT_MS）：
  // boot 断言通过后 capturePage 落盘；GITTER_SHOT_VARS=JSON 可临时覆盖 --c-* token（浅色验收）。
  // GITTER_SHOT_REPO=<git 仓库>：did-finish-load 后延迟 5s 发 app.openRepo（走 App.tsx
  // 处理器，宿主侧 call 无 __caller 权限校验；处理器会把页面设为 log，15s 截图钩子内
  // 再按 shotPage 导航）。延迟是给渲染层启动恢复让路：App.tsx boot effect 会异步
  // repo.open(settings.currentProjectPath)——openRepo 必须晚于它，否则被覆盖；
  // 也必须远早于 15s 截图钩子，否则其完成回调（setState page:"log"）会落在
  // shotPage 导航之后，把页面从目标页扯回 log（两类竞态都实测过）。
  if (shotRepo && shotPath && bootExitMs > 0) {
    const win0 = BrowserWindow.getAllWindows()[0];
    win0.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        win0.webContents.send("evt", { method: "app.openRepo", params: { path: shotRepo } });
        process.stdout.write("[boot] shotRepo 已发 app.openRepo（did-finish-load+5s）\n");
      }, 5000);
    });
  }
  if (shotPath && bootExitMs > 0) {
    setTimeout(async () => {
      try {
        const win = BrowserWindow.getAllWindows()[0];
        const vars = process.env.GITTER_SHOT_VARS;
        if (vars) {
          await win.webContents.executeJavaScript(
            "(() => { const v = " + JSON.stringify(vars) + "; try { Object.entries(JSON.parse(v)).forEach(([k, val]) => document.documentElement.style.setProperty(k, String(val))); } catch {} })()");
          await new Promise((r) => setTimeout(r, 400));
        }
        if (shotPage) {
          // 先等仓库真正打开（openRepo 是异步 git 操作，其完成回调会把 page 设为 log——
          // 导航若发生在回调前会被扯回 log；慢机器上 repo.open 可能拖到十几秒）。
          // 轮询 GITTER_UI.getState().repo 与 shotRepo 一致，并要求 2 次读数稳定。
          const wantRepo = (shotRepo ?? "").replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
          if (wantRepo) {
            const readRepo = () => win.webContents.executeJavaScript(
              '(function(){ try { var r = window.GITTER_UI && window.GITTER_UI.getState && window.GITTER_UI.getState().repo; return r ? String(r.workDir).replaceAll("\\\\","/") : ""; } catch { return ""; } })()');
            const norm = (s: string) => s.replace(/\/+$/, "").toLowerCase();
            let prev = "";
            const deadline = Date.now() + 40000;
            for (;;) {
              const cur = norm(String(await readRepo().catch(() => "")));
              const ok = cur === wantRepo && prev === cur;
              if (ok) break;
              if (Date.now() > deadline) {
                process.stdout.write("[shot] 等仓库超时 repo=" + cur + "\n");
                break;
              }
              prev = cur;
              await new Promise((r) => setTimeout(r, 700));
            }
            await new Promise((r) => setTimeout(r, 1200)); // context.changed 广播余量
          }
          await win.webContents.executeJavaScript(
            "(document.querySelectorAll('.nav-top .nav-item')[7] || {}).click()");
          await new Promise((r) => setTimeout(r, 2500)); // 惰性装载 + 渲染稳定
        }
        // GITTER_SHOT_CLICK=<css 选择器>：截图前点击页面内元素（如 .office-row 打开文件验收编辑器），
        // 等待 GITTER_SHOT_CLICK_WAIT_MS（默认 4000）后探测渲染进程主线程活跃度——
        // 50ms 定时器的实际漂移即忙程度：漂移秒级 = 死循环/长任务（UI 冻结类 bug 的量化证据）。
        const shotClick = process.env.GITTER_SHOT_CLICK;
        if (shotClick) {
          // GITTER_TRACE_HANG=1：点击前启动 V8 栈采样 tracing——主线程忙死循环时
          // tracing 服务（独立进程）仍能采样 JS 栈，stopRecording 后聚合出热点函数。
          if (process.env.GITTER_TRACE_HANG === "1") {
            await contentTracing.startRecording({
              included_categories: ["disabled-by-default-cpu_profiler", "disabled-by-default-v8.cpu_profiler"],
            });
            process.stdout.write("[shot] tracing 已启动（cpu_profiler）\n");
          }
          // GITTER_SHOT_PREPARE_JS=<js>：点击前执行（此刻页面必然响应）——适合安装收集器
          const prepareJs = process.env.GITTER_SHOT_PREPARE_JS;
          if (prepareJs) {
            try {
              const out = await win.webContents.executeJavaScript(prepareJs);
              process.stdout.write("[prepare] " + JSON.stringify(out) + "\n");
            } catch (e) {
              process.stdout.write("[prepare] FAIL " + (e as Error).message + "\n");
            }
          }
          const hit = await win.webContents.executeJavaScript(
            "((sel) => { const el = document.querySelector(sel); if (!el) return 'NO_MATCH'; el.click(); return 'clicked:' + sel; })(" + JSON.stringify(shotClick) + ")");
          process.stdout.write("[shot] 点击 " + String(hit) + "\n");
          await new Promise((r) => setTimeout(r, Number(process.env.GITTER_SHOT_CLICK_WAIT_MS ?? 4000)));
          let hung = false;
          try {
            const lag = await Promise.race([
              win.webContents.executeJavaScript(
                "new Promise((r) => { const t0 = performance.now(); setTimeout(() => r(Math.round(performance.now() - t0)), 50); })"),
              new Promise((_, rej) => setTimeout(() => rej(new Error("探针 8s 无响应")), 8000)),
            ]);
            process.stdout.write("[shot] 主线程定时器漂移: " + String(lag) + "ms（≈50 为空闲）\n");
          } catch {
            hung = true;
            process.stdout.write("[shot] 主线程探针失败（疑似同步阻塞死循环）\n");
          }
          if (process.env.GITTER_TRACE_HANG === "1") {
            // 无论探针结果如何都停止采样并聚合热点——忙风暴与短暂空闲交替时，
            // 8s 等待窗口内的样本足以定位热点函数。tracing 服务独立于渲染主线程。
            try {
              const traceFile = await contentTracing.stopRecording();
              const keep = path.join(process.env.TEMP ?? ".", "gitter-trace.json");
              fs.copyFileSync(traceFile, keep);
              process.stdout.write("[shot] trace 已留存: " + keep + "\n");
              let raw = fs.readFileSync(traceFile, "utf8");
              // Chromium trace 文件可能是分块 JSON（多个 [...] 拼接）——拆成平衡的数组块分别 parse
              let events: Array<Record<string, any>> = [];
              try {
                const parsed = JSON.parse(raw);
                events = Array.isArray(parsed)
                  ? parsed
                  : (parsed?.traceEvents ?? Object.values(parsed).find(Array.isArray) ?? []);
              } catch {
                const chunks: string[] = [];
                let depth = 0, start = -1;
                for (let i = 0; i < raw.length; i++) {
                  const ch = raw[i];
                  if (ch === "[") { if (depth === 0) start = i; depth++; }
                  else if (ch === "]") { depth--; if (depth === 0 && start >= 0) { chunks.push(raw.slice(start, i + 1)); start = -1; } }
                }
                for (const c of chunks) {
                  try { const part = JSON.parse(c); if (Array.isArray(part)) events = events.concat(part); } catch {}
                }
              }
              const buckets = new Map<string, number>();
              // v8.cpu_profiler 事件：ProfileChunk 带帧表（frames/nodes）+ samples（帧 id 序列）
              const frameTable = new Map<number, string>();
              let profileChunks = 0, sampleTotal = 0;
              const addFrames = (arr: any[]) => {
                for (const f of arr) {
                  const cf = f?.callFrame ?? f;
                  const id = Number(f?.id ?? f?.nodeId ?? NaN);
                  const name = String(cf?.functionName ?? f?.name ?? "(anonymous)");
                  const url = String(cf?.url ?? cf?.scriptUrl ?? "").split("/").pop() ?? "";
                  const line = Number(cf?.lineNumber ?? cf?.line ?? -1);
                  frameTable.set(id, `${name} @ ${url}:${line}`);
                }
              };
              for (const ev of events) {
                const dd = ev?.args?.detailed_data ?? ev?.args;
                const cp = dd?.cpu_profiler ?? dd?.cpuProfile;
                if (!cp) continue;
                if (Array.isArray(cp.frames)) addFrames(cp.frames);
                if (Array.isArray(cp.nodes)) addFrames(cp.nodes);
                if (Array.isArray(cp.samples)) {
                  profileChunks++;
                  for (const sid of cp.samples) {
                    sampleTotal++;
                    const key = frameTable.get(Number(sid)) ?? `#${sid}`;
                    buckets.set(key, (buckets.get(key) ?? 0) + 1);
                  }
                }
              }
              process.stdout.write(`[shot] ProfileChunk ${profileChunks} 块，样本 ${sampleTotal} 条，帧表 ${frameTable.size} 帧\n`);
              const top = [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
              for (const [k, c] of top) process.stdout.write("[hot] x" + c + "  " + k + "\n");
              if (profileChunks === 0) {
                // 打印事件名直方图辅助定位实际产出的事件类别/名称
                const hist = new Map<string, number>();
                for (const ev of events) {
                  const key = `${String(ev?.cat ?? "?")} | ${String(ev?.name ?? "?")}`;
                  hist.set(key, (hist.get(key) ?? 0) + 1);
                }
                const htop = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
                for (const [k, c] of htop) process.stdout.write("[ev] x" + c + "  " + k + "\n");
              }
            } catch (e2) {
              process.stdout.write("[shot] 停止 tracing 失败: " + (e2 as Error).message + "\n");
            }
            // 渲染进程忙死时后续 executeJavaScript/capturePage 可能永久挂起——直接退出
            if (hung) {
              app.exit(5);
              return;
            }
          }
        }
        // GITTER_SHOT_PROBE_JS=<js 表达式>：截图前执行并打印结果（页面状态诊断用）。
        // 主线程忙风暴与短暂空闲交替——最多重试 8 次（每次超时 + 1.5s 间隔）直到拿到结果。
        // 超时可用 GITTER_SHOT_PROBE_TIMEOUT_MS 调（探针内含长等待序列时）。
        const probeJs = process.env.GITTER_SHOT_PROBE_JS;
        const probeTimeout = Number(process.env.GITTER_SHOT_PROBE_TIMEOUT_MS ?? 6000);
        if (probeJs) {
          for (let attempt = 1; attempt <= 20; attempt++) {
            try {
              const out = await Promise.race([
                win.webContents.executeJavaScript(probeJs),
                new Promise((_, rej) => setTimeout(() => rej(new Error("探针超时 " + probeTimeout + "ms")), probeTimeout)),
              ]);
              process.stdout.write("[probe] 尝试" + attempt + " " + JSON.stringify(out) + "\n");
              break;
            } catch (e) {
              process.stdout.write("[probe] 尝试" + attempt + " FAIL " + (e as Error).message + "\n");
              await new Promise((r) => setTimeout(r, 1500));
            }
          }
        }
        // GITTER_SHOT_INPUT=<json 数组>：注入真实输入事件（元素为 sendInputEvent 参数，
        // 间隔 400ms）——sandbox iframe 是 opaque origin，executeJavaScript 进不去，
        // 滚轮/键盘等须经真实输入管线才能触达（缩放后滚动可达性等验收用）。
        const shotInput = process.env.GITTER_SHOT_INPUT;
        if (shotInput) {
          try {
            const events = JSON.parse(shotInput) as Array<Record<string, unknown>>;
            for (const ev of events) {
              win.webContents.sendInputEvent(ev as never);
              await new Promise((r) => setTimeout(r, 400));
            }
            process.stdout.write("[shot] 注入输入事件 x" + events.length + "\n");
          } catch (e) {
            process.stdout.write("[shot] INPUT FAIL " + (e as Error).message + "\n");
          }
        }
        // 水平溢出探测：报告整页与各面板的超宽（定位"最小宽度过大"类问题）
        try {
          const fit = await Promise.race([win.webContents.executeJavaScript(`(() => {
            const pageOver = document.documentElement.scrollWidth - document.documentElement.clientWidth;
            const offenders = [...document.querySelectorAll('.page *')]
              .map((el) => ({ el, tag: el.tagName, cls: String(el.className).slice(0, 40),
                r: el.getBoundingClientRect(), sw: el.scrollWidth }))
              .filter((x) => x.r.right > window.innerWidth + 2 || x.sw - x.r.width > 4)
              .sort((a, b) => b.r.right - a.r.right).slice(0, 8)
              .map((x) => {
                const chain: string[] = [];
                let e: HTMLElement | null = x.el as HTMLElement;
                while (e && e !== document.body && chain.length < 6) {
                  chain.push(e.tagName + (e.id ? "#" + e.id : "") + (e.className ? "." + String(e.className).split(" ")[0] : ""));
                  e = e.parentElement;
                }
                return { chain: chain.join(" < "), right: Math.round(x.r.right), w: Math.round(x.r.width) };
              });
            return { pageOver, offenders };
          })()`), new Promise((_, rej) => setTimeout(() => rej(new Error("fit 6s 无响应")), 6000))]);
          if (fit.pageOver > 2 || fit.offenders.length > 0) {
            process.stdout.write("[fit] 页面水平溢出 " + fit.pageOver + "px; 元素: " + JSON.stringify(fit.offenders) + "\n");
          }
        } catch {}

        const img = await Promise.race([win.webContents.capturePage(), new Promise<Electron.NativeImage>((_, rej) => setTimeout(() => rej(new Error("capture 6s 无响应")), 6000))]);
        fs.writeFileSync(shotPath, img.toPNG());
        process.stdout.write("[shot] saved " + shotPath + "\n");
      } catch (e) {
        process.stdout.write("[shot] FAIL " + (e as Error).message + "\n");
      }
    }, 15000);
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
