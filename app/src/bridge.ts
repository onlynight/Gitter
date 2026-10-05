import { BrowserWindow, dialog, shell } from "electron";
import * as fs from "fs";
import * as path from "path";
import { looksLikeRepo } from "./services/gitexec";
import { commitFilesWithCounts, fileDiff, getCommit, listBranches, queryLog } from "./services/gitlog";
import * as status from "./services/gitstatus";
import * as branches from "./services/gitbranches";
import * as worktrees from "./services/worktrees";
import { SettingsStore } from "./services/settings";
import { I18nService, resolveLanguage } from "./services/i18n";
import { ThemeService } from "./services/themes";
import { TerminalManager } from "./services/terminal";
import type { SettingsDTO } from "./shared/types";

export interface SharedServices {
  settings: SettingsStore;
  i18n: I18nService;
  themes: ThemeService;
  /** 新窗口创建（命令面板"新窗口"用；由 main 注入，避免循环 require）。 */
  createWindow: (repoPath?: string) => void;
}

type Handler = (args: any) => Promise<unknown> | unknown;

/** 统一错误封套：跨 IPC 不丢 detail。 */
export class BridgeError extends Error {
  constructor(message: string, public detail?: string) {
    super(message);
  }
}

/**
 * 每窗口一个桥实例（当前仓库 / 终端会话为窗口态）；
 * settings / i18n / themes 为应用级共享。
 */
export class Bridge {
  private handlers = new Map<string, Handler>();
  private terminals: TerminalManager;
  /** 当前仓库（渲染层 repo.open 驱动，对齐 RepositoryContext 单仓库语义）。 */
  repo: string | null = null;

  constructor(
    private readonly win: BrowserWindow,
    private readonly shared: SharedServices,
  ) {
    this.terminals = new TerminalManager({
      send: (channel: string, payload: unknown) => {
        if (!win.isDestroyed()) win.webContents.send(channel, payload);
      },
    });
    this.registerAll();
  }

  dispose() {
    this.terminals.disposeAll();
  }

  async handle(method: string, args: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: { message: string; detail?: string } }> {
    const handler = this.handlers.get(method);
    if (!handler) return { ok: false, error: { message: `未知桥方法: ${method}` } };
    try {
      const data = await handler(args);
      return { ok: true, data };
    } catch (e) {
      if (e instanceof BridgeError) return { ok: false, error: { message: e.message, detail: e.detail } };
      const err = e as Error;
      const detail = (err as { stderr?: string }).stderr ?? (err as { detail?: string }).detail;
      return { ok: false, error: { message: err.message, detail: typeof detail === "string" ? detail : undefined } };
    }
  }

  private needRepo(): string {
    if (!this.repo) throw new BridgeError("没有打开的仓库", "NO_REPO");
    return this.repo;
  }

  // -------------------------------------------------------------------------

  private registerAll() {
    const { settings, i18n, themes, createWindow } = this.shared;
    const R = (method: string, handler: Handler) => this.handlers.set(method, handler);

    // ---- 仓库 ----
    R("repo.open", (args: { path: string }) => {
      const full = path.resolve(String(args?.path ?? "").trim());
      if (!fs.existsSync(full) || !looksLikeRepo(full)) {
        throw new BridgeError("不是有效的 git 仓库", full);
      }
      this.repo = full;
      return { workDir: full, name: path.basename(full) };
    });
    R("repo.close", () => {
      this.repo = null;
      return {};
    });
    R("repo.state", () => ({ workDir: this.repo }));

    // ---- Log ----
    R("log.query", (args: { branch?: string; query?: string; limit?: number; skip?: number }) =>
      queryLog(this.needRepo(), args ?? {}));
    R("log.branches", () => listBranches(this.needRepo()));
    R("log.detail", async (args: { sha: string; baseSha?: string | null }) => {
      const wd = this.needRepo();
      const commit = await getCommit(wd, args.sha);
      if (!commit) throw new BridgeError("提交不存在", args.sha);
      const files = await commitFilesWithCounts(wd, args.sha, args.baseSha ?? null);
      return { commit, files };
    });
    R("log.fileDiff", (args: { sha: string; baseSha?: string | null; path: string }) =>
      fileDiff(this.needRepo(), args.sha, args.path, args.baseSha ?? null));

    // ---- 变更 ----
    R("changes.state", () => status.getStatus(this.needRepo()));
    R("changes.stage", (args: { paths: string[] }) => status.stageFiles(this.needRepo(), args.paths));
    R("changes.unstage", (args: { paths: string[] }) => status.unstageFiles(this.needRepo(), args.paths));
    R("changes.diffFile", (args: { path: string; staged: boolean; isNewFile?: boolean }) =>
      status.worktreeFileDiff(this.needRepo(), args.path, !!args.staged, !!args.isNewFile));
    R("changes.stageHunks", (args: { path: string; indices: number[] }) =>
      status.stageHunks(this.needRepo(), args.path, args.indices));
    R("changes.unstageHunks", (args: { path: string; indices: number[] }) =>
      status.unstageHunks(this.needRepo(), args.path, args.indices));
    R("changes.commit", async (args: { message: string; push?: boolean; toStage?: string[]; toUnstage?: string[] }) => {
      const wd = this.needRepo();
      if (args.toStage?.length) await status.stageFiles(wd, args.toStage);
      if (args.toUnstage?.length) await status.unstageFiles(wd, args.toUnstage);
      return status.commit(wd, args.message, !!args.push);
    });
    R("changes.push", () => status.retryPush(this.needRepo()));
    R("changes.pull", (args: { rebase?: boolean }) => status.pull(this.needRepo(), !!args?.rebase));
    R("changes.fetch", () => status.fetchAll(this.needRepo()));

    // ---- 分支 ----
    R("branches.state", () => branches.getBranches(this.needRepo()));
    R("branches.checkout", (args: { name: string }) => branches.checkout(this.needRepo(), args.name));
    R("branches.create", (args: { name: string; fromSha?: string | null }) =>
      branches.createBranch(this.needRepo(), args.name, args.fromSha ?? null));
    R("branches.rename", (args: { oldName: string; newName: string }) =>
      branches.renameBranch(this.needRepo(), args.oldName, args.newName));
    R("branches.deletePreview", (args: { name: string }) => branches.deletePreview(this.needRepo(), args.name));
    R("branches.delete", (args: { name: string; force?: boolean }) =>
      branches.deleteBranch(this.needRepo(), args.name, !!args.force));
    R("branches.merge", (args: { name: string; noFf?: boolean; message?: string | null }) =>
      branches.mergeBranch(this.needRepo(), args.name, !!args.noFf, args.message ?? null));
    R("branches.rebase", (args: { name: string }) => branches.rebaseBranch(this.needRepo(), args.name));
    R("branches.ff", (args: { name: string }) => branches.fastForward(this.needRepo(), args.name));
    R("branches.pull", (args: { rebase?: boolean }) => branches.pull(this.needRepo(), !!args?.rebase));
    R("branches.push", () => branches.push(this.needRepo()));

    // ---- 任务（worktree）----
    R("tasks.list", () => worktrees.listWorktrees(this.needRepo()));
    R("tasks.create", (args: { name: string }) => worktrees.createTaskWorktree(this.needRepo(), args.name));
    R("tasks.remove", (args: { path: string }) => worktrees.removeTaskWorktree(this.needRepo(), args.path));

    // ---- 项目 ----
    R("projects.list", () => {
      const s = settings.current;
      return { projects: s.projects, recent: s.projects.slice(0, 5), currentPath: this.repo };
    });
    R("projects.pickFolder", async (args: { title?: string }) => {
      const r = await dialog.showOpenDialog(this.win, {
        title: args?.title ?? "选择仓库文件夹",
        properties: ["openDirectory"],
        defaultPath: this.repo ?? undefined,
      });
      return r.canceled ? null : r.filePaths[0];
    });
    R("projects.add", async () => {
      const r = await dialog.showOpenDialog(this.win, {
        title: "添加项目",
        properties: ["openDirectory"],
      });
      if (r.canceled || !r.filePaths[0]) return null;
      const full = path.resolve(r.filePaths[0]);
      if (!looksLikeRepo(full)) throw new BridgeError("所选文件夹不是 git 仓库", full);
      const p = { name: path.basename(full), path: full };
      settings.setCurrentProject(p);
      this.repo = full;
      return p;
    });
    R("projects.remove", (args: { path: string }) => {
      settings.removeProject(args.path);
      return {};
    });
    R("projects.open", (args: { path: string }) => {
      const full = path.resolve(args.path);
      if (!looksLikeRepo(full)) throw new BridgeError("不是有效的 git 仓库", full);
      settings.setCurrentProject({ name: path.basename(full), path: full });
      this.repo = full;
      return { workDir: full, name: path.basename(full) };
    });

    // ---- 终端 ----
    R("terminal.ensure", (args: { cols: number; rows: number; cwd?: string | null; shellKind?: string }) =>
      this.terminals.ensure(args ?? { cols: 120, rows: 30 }));
    R("terminal.write", (args: { id: string; dataB64: string }) => {
      this.terminals.write(args.id, args.dataB64);
      return {};
    });
    R("terminal.resize", (args: { id: string; cols: number; rows: number }) => {
      this.terminals.resize(args.id, args.cols, args.rows);
      return {};
    });
    R("terminal.list", () => this.terminals.list());

    // ---- 设置 / 主题 / 语言 ----
    R("settings.get", () => settings.current);
    R("settings.set", (args: { patch: Partial<SettingsDTO> }) => {
      settings.update(args.patch ?? {});
      return settings.current;
    });
    R("settings.rememberCommand", (args: { id: string }) => {
      settings.rememberCommand(args.id);
      return {};
    });
    R("themes.list", () => themes.list());
    R("themes.state", (args: { systemBase?: "dark" | "light" }) =>
      themes.resolve(
        settings.current.themePackageId,
        settings.current.theme === "light" ? "light" : settings.current.theme === "dark" ? "dark" : (args?.systemBase ?? "dark"),
      ));
    R("i18n.strings", (args: { preference: "system" | "en" | "zh-Hans"; navigatorLanguage?: string }) => {
      const lang = resolveLanguage(args?.preference ?? "system", args?.navigatorLanguage ?? "en-US");
      return i18n.get(lang);
    });

    // ---- 平台 ----
    R("dialog.pickFile", async (args: { title?: string; filters?: { name: string; ext: string[] }[]; save?: boolean }) => {
      const filters = args?.filters?.map((f) => ({ name: f.name, extensions: f.ext }));
      if (args?.save) {
        const r = await dialog.showSaveDialog(this.win, { title: args.title, filters });
        return r.canceled ? null : r.filePath;
      }
      const r = await dialog.showOpenDialog(this.win, { title: args?.title, filters, properties: ["openFile"] });
      return r.canceled ? null : r.filePaths[0];
    });
    R("shell.openPath", async (args: { path: string; editor?: boolean }) => {
      if (args.editor && settings.current.externalEditor) {
        const cp = await import("child_process");
        const r = await new Promise<{ code: number; stderr: string }>((resolve) => {
          const child = cp.spawn(settings.current.externalEditor!, [args.path], { shell: true, windowsHide: true });
          let err = "";
          child.stderr.on("data", (d) => (err += d));
          child.on("close", (code) => resolve({ code: code ?? -1, stderr: err }));
          child.on("error", (e) => resolve({ code: -1, stderr: String(e) }));
        });
        if (r.code !== 0) throw new BridgeError("外部编辑器启动失败", r.stderr);
        return {};
      }
      await shell.openPath(args.path);
      return {};
    });
    R("shell.reveal", (args: { path: string }) => {
      shell.showItemInFolder(args.path);
      return {};
    });
    R("app.newWindow", (args: { path?: string }) => {
      createWindow(args?.path);
      return {};
    });
    R("app.gitVersion", async () => {
      const { tryGit } = await import("./services/gitexec");
      const r = await tryGit(process.env.USERPROFILE ?? ".", ["--version"]);
      return r.stdout.trim() || null;
    });
  }
}
