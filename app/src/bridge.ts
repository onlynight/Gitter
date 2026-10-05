import { BrowserWindow, dialog, shell, safeStorage } from "electron";
import * as fs from "fs";
import * as path from "path";
import { tryGit, looksLikeRepo } from "./services/gitexec";
import { commitFilesWithCounts, fileDiff, getCommit, listBranches, queryLog } from "./services/gitlog";
import * as status from "./services/gitstatus";
import * as branches from "./services/gitbranches";
import * as worktrees from "./services/worktrees";
import { SettingsStore } from "./services/settings";
import { I18nService, resolveLanguage } from "./services/i18n";
import { ThemeService } from "./services/themes";
import { TerminalManager } from "./services/terminal";
import { HighlightService } from "./services/highlight";
import { McpPipeHost, pendingApprovals } from "./services/mcp";
import * as gitconfig from "./services/gitconfig";
import * as preview from "./services/preview";
import * as aiSvc from "./services/ai";
import * as safety from "./services/safety";
import { groupSessions, squashMessage } from "./services/sessions";
import * as feedbackStore from "./services/feedback";
import type { SettingsDTO } from "./shared/types";

export interface SharedServices {
  settings: SettingsStore;
  i18n: I18nService;
  themes: ThemeService;
  highlight: HighlightService;
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
  private mcpHost: McpPipeHost | null = null;
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
    this.mcpHost?.stop();
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
      this.ensureMcp();
      return { workDir: full, name: path.basename(full) };
    });
    R("repo.close", () => {
      this.repo = null;
      this.mcpHost?.stop();
      this.mcpHost = null;
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
      const s = this.shared.settings.current;
      if (args.toStage?.length) await status.stageFiles(wd, args.toStage);
      if (args.toUnstage?.length) await status.unstageFiles(wd, args.toUnstage);
      // 安全网 block 模式：有 Blocked 级发现即拦截（先扫描后落盘，ai-native-redesign.md §4.2）
      if (s.safetyNet === "block") {
        const st = await status.getStatus(wd);
        const files: safety.ScannableFile[] = [];
        for (const f of st.staged) {
          const patch = (await tryGit(wd, ["diff", "--cached", "--no-color", "--", f.path])).stdout;
          files.push({
            path: f.path, patch: patch || null,
            isBinary: patch.includes("GIT binary patch") || patch.includes("Binary files"),
            isNew: patch.includes("new file mode"),
            addedLines: f.added ?? 0, deletedLines: f.deleted ?? 0,
          });
        }
        const blocked = safety.scan(files).filter((x) => x.severity === "blocked");
        if (blocked.length > 0) {
          throw new BridgeError(
            `安全网拦截：${blocked.length} 个阻塞级发现（${blocked[0].filePath}:${blocked[0].line ?? "?"} ${blocked[0].message}…）`,
            JSON.stringify(blocked),
          );
        }
      }
      return status.commit(wd, args.message, !!args.push, this.syncProgress());
    });
    R("changes.push", () => status.retryPush(this.needRepo(), this.syncProgress()));
    R("changes.pull", (args: { rebase?: boolean }) => status.pullWithProgress(this.needRepo(), !!args?.rebase, this.syncProgress()).then(() => ({})));
    R("changes.fetch", () => status.fetchAll(this.needRepo(), this.syncProgress()).then(() => ({})));

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
    R("branches.pull", (args: { rebase?: boolean }) => branches.pull(this.needRepo(), !!args?.rebase, this.syncProgress()));
    R("branches.push", () => branches.push(this.needRepo(), this.syncProgress()));

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

    // ---- AI 网关（ai-native-redesign.md §8.1 移植）----
    R("ai.state", () => {
      const s = settings.current;
      const config = this.aiConfig();
      return {
        provider: s.aiProvider,
        privacy: s.aiPrivacy,
        appendTrailer: s.aiAppendTrailer,
        hasKey: !!s.aiApiKeyProtected,
        configured: aiSvc.isConfigured(config),
      };
    });
    R("settings.setAiKey", (args: { key: string }) => {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new BridgeError("系统不支持密钥加密（safeStorage 不可用）");
      }
      const encrypted = safeStorage.encryptString(args.key);
      settings.update({ aiApiKeyProtected: encrypted.toString("base64") });
      return {};
    });
    R("ai.generateCommitMessage", async () => {
      const wd = this.needRepo();
      const s = settings.current;
      if (s.aiPrivacy === "disabled") throw new BridgeError("AI 隐私档位为 Disabled，已禁用 AI 功能");
      const config = this.aiConfig();
      const st = await status.getStatus(wd);
      const stagedFiles = st.staged;
      if (stagedFiles.length === 0) throw new BridgeError("没有已暂存的变更");
      const recent = await queryLog(wd, { limit: 20 });
      const diffText = s.aiPrivacy === "fullDiff"
        ? (await tryGit(wd, ["diff", "--cached", "--no-color"])).stdout
        : null;
      const prompt = aiSvc.buildCommitMessagePrompt(
        { recentSubjects: recent.commits.map((c) => c.subject), files: aiSvc.filesOf(stagedFiles), diffText },
        s.aiPrivacy,
      );
      const raw = await aiSvc.complete(prompt, config);
      let draft = aiSvc.cleanDraft(raw);
      if (!draft) throw new BridgeError("AI 返回了空草稿");
      if (s.aiAppendTrailer) {
        draft += /\n/.test(draft) ? "\n\nAssisted-by: Gitter" : "\n\nAssisted-by: Gitter";
      }
      return { message: draft };
    });
    R("ai.explain", async (args: { intent: "explain" | "review"; path?: string | null }) => {
      const wd = this.needRepo();
      const s = settings.current;
      if (s.aiPrivacy === "disabled") throw new BridgeError("AI 隐私档位为 Disabled，已禁用 AI 功能");
      const st = await status.getStatus(wd);
      const target = args.path
        ? st.staged.filter((f) => f.path === args.path)
        : st.staged;
      if (target.length === 0) throw new BridgeError("没有可解释的已暂存变更");
      const diffText = s.aiPrivacy === "fullDiff"
        ? (await tryGit(wd, ["diff", "--cached", "--no-color", ...(args.path ? ["--", args.path] : [])])).stdout
        : null;
      const prompt = aiSvc.buildExplainPrompt(aiSvc.filesOf(target), diffText, s.aiPrivacy, args.intent);
      const raw = await aiSvc.complete(prompt, this.aiConfig());
      return { text: raw.trim() };
    });

    // ---- 安全网（规则引擎）----
    R("changes.safetyScan", async () => {
      const wd = this.needRepo();
      const s = settings.current;
      if (s.safetyNet === "off") return { findings: [], mode: s.safetyNet };
      const st = await status.getStatus(wd);
      const files: safety.ScannableFile[] = [];
      for (const f of st.staged) {
        const patch = (await tryGit(wd, ["diff", "--cached", "--no-color", "--", f.path])).stdout;
        files.push({
          path: f.path,
          patch: patch || null,
          isBinary: patch.includes("GIT binary patch") || patch.includes("Binary files"),
          isNew: patch.includes("new file mode"),
          addedLines: f.added ?? 0,
          deletedLines: f.deleted ?? 0,
        });
      }
      return { findings: safety.scan(files), mode: s.safetyNet };
    });

    // ---- agent 反馈（review.submit_feedback 的消费侧）----
    R("changes.feedback", (_args) => feedbackStore.readFeedback(this.needRepo()));
    R("changes.clearFeedback", () => {
      feedbackStore.clearFeedback(this.needRepo());
      return {};
    });

    // ---- Log 会话（squash + 聚合预览）----
    R("log.squash", (args: { topSha: string; bottomParentSha: string; message: string }) => {
      const wd = this.needRepo();
      return this.squashSession(wd, args.topSha, args.bottomParentSha, args.message);
    });

    // ---- 语法高亮 ----
    R("highlight.file", (args: { path: string; text: string }) => {
      const h = this.shared.highlight.forFile(args.path);
      const theme = this.shared.themes.resolve(
        this.shared.settings.current.themePackageId,
        this.shared.settings.current.theme === "light" ? "light" : "dark",
      );
      if (!h) return { language: null, lines: [], syntaxColors: theme.syntax };
      const lines = args.text.split("\n");
      const { lines: runs } = this.shared.highlight.highlightLines(h, lines);
      return { language: h.language, lines: runs, syntaxColors: theme.syntax };
    });

    // ---- MCP 宿主 ----
    R("mcp.state", () => ({
      enabled: settings.current.mcpEnabled,
      running: !!this.mcpHost?.running,
      pipeName: this.mcpHost?.name ?? null,
      repo: this.repo,
    }));
    R("mcp.approve", (args: { id: string; ok: boolean }) => {
      const p = pendingApprovals.get(args.id);
      if (p) {
        pendingApprovals.delete(args.id);
        p.resolve(!!args.ok);
      }
      return {};
    });
    R("mcp.setPipeName", () => ({ pipeName: this.mcpHost?.name ?? null }));

    // ---- Git 配置（设置页"Git 配置"区）----
    // 全局层级不依赖已打开仓库（cwd 用用户主目录）；仓库层级必须先开仓库
    const configWorkDir = (scope: gitconfig.ConfigScope) =>
      this.repo ?? (scope === "global" ? process.env.USERPROFILE ?? "." : this.needRepo());
    R("gitconfig.list", (args: { scope: gitconfig.ConfigScope }) => gitconfig.listConfig(configWorkDir(args.scope ?? "repo"), args.scope ?? "repo"));
    R("gitconfig.set", (args: { key: string; value: string | null; scope: gitconfig.ConfigScope }) => {
      if (!/^[a-z0-9.-]+$/i.test(args.key)) throw new BridgeError("非法配置键", args.key);
      gitconfig.setConfig(configWorkDir(args.scope ?? "repo"), args.key.toLowerCase(), args.value, args.scope ?? "repo");
      return {};
    });
    R("remote.list", () => gitconfig.listRemotes(this.needRepo()));
    R("remote.add", (args: { name: string; url: string }) => {
      if (!args.name.trim() || !args.url.trim()) throw new BridgeError("名称与 URL 均必填");
      gitconfig.addRemote(this.needRepo(), args.name.trim(), args.url.trim());
      return {};
    });
    R("remote.remove", (args: { name: string }) => {
      gitconfig.removeRemote(this.needRepo(), args.name);
      return {};
    });

    // ---- 非代码文件预览（图片等二进制直接出内容，不走 diff）----
    R("file.preview", (args: { path: string; staged?: boolean; maxBytes?: number }) =>
      preview.readPreview(this.needRepo(), args.path, !!args.staged, args.maxBytes));

    // ---- 推送自助修复（noUpstream 错误的动作）----
    R("changes.pushSetUpstream", async () => {
      try {
        return await gitconfig.pushSetUpstream(this.needRepo());
      } catch (e) {
        const err = e as { message?: string; result?: { stderr?: string } };
        const hint = err.result?.stderr ?? err.message ?? "";
        if (hint.includes("NO_REMOTE")) {
          throw new BridgeError("没有配置远程仓库——请在 设置 → Git 配置 中添加", "NO_REMOTE");
        }
        if (hint.includes("NO_BRANCH")) {
          throw new BridgeError("当前处于游离 HEAD，没有可推送的分支", "NO_BRANCH");
        }
        throw e;
      }
    });
  }

  /** 组装 AI 配置（密钥 safeStorage 解密，只在内存，不回传渲染层明文）。 */
  private aiConfig(): aiSvc.AiConfig {
    const s = this.shared.settings.current;
    let apiKey: string | null = null;
    if (s.aiApiKeyProtected && safeStorage.isEncryptionAvailable()) {
      try {
        apiKey = safeStorage.decryptString(Buffer.from(s.aiApiKeyProtected, "base64"));
      } catch {
        apiKey = null;
      }
    }
    return {
      provider: s.aiProvider,
      endpoint: s.aiEndpoint,
      model: s.aiModel,
      cliCommand: s.aiCliCommand,
      apiKey,
    };
  }

  /** 会话 squash（C# SquashSessionAsync 语义）：HEAD 必须 == top；reset --soft 到 bottom 父提交后重提交。 */
  private async squashSession(wd: string, topSha: string, bottomParentSha: string, message: string) {
    const head = (await tryGit(wd, ["rev-parse", "HEAD"])).stdout.trim();
    if (head !== topSha) {
      throw new BridgeError("会话顶端不是 HEAD，无法 squash", "NOT_HEAD");
    }
    const parentOfBottom = (await tryGit(wd, ["rev-parse", bottomParentSha + "^"])).stdout.trim();
    if (!parentOfBottom) throw new BridgeError("会话底端为根提交，无法 squash", "ROOT_COMMIT");
    const r1 = await tryGit(wd, ["reset", "--soft", parentOfBottom]);
    if (r1.code !== 0) throw new BridgeError("reset 失败", r1.stderr);
    const r2 = await tryGit(wd, ["commit", "-m", message]);
    if (r2.code !== 0) throw new BridgeError("squash 提交失败", r2.stderr);
    return { sha: (await tryGit(wd, ["rev-parse", "HEAD"])).stdout.trim() };
  }

  /** 主题 syntax 配色（高亮 style → 颜色）。 */
  private activeSyntaxColors(): Record<string, string> {
    return this.shared.themes.resolve(
      this.shared.settings.current.themePackageId,
      this.shared.settings.current.theme === "light" ? "light" : "dark",
    ).syntax;
  }

  /** 同步进度事件（push/pull/fetch 的 --progress 行），100ms 节流防 IPC 风暴。 */
  private syncProgress(): status.SyncProgress {
    let last = 0;
    return (text, percent) => {
      const now = Date.now();
      if (percent !== null && percent < 100 && now - last < 100) return;
      last = now;
      if (!this.win.isDestroyed()) {
        this.win.webContents.send("evt", { method: "sync.progress", params: { text, percent } });
      }
    };
  }

  /** MCP 管道宿主随仓库启停（settings.mcpEnabled 门控）。 */
  private ensureMcp() {
    if (!this.shared.settings.current.mcpEnabled || !this.repo) {
      this.mcpHost?.stop();
      this.mcpHost = null;
      return;
    }
    if (this.mcpHost?.running && this.mcpHost.currentDir === this.repo) return;
    this.mcpHost?.stop();
    this.mcpHost = new McpPipeHost(this.repo, {
      send: (channel: string, payload: unknown) => {
        if (!this.win.isDestroyed()) this.win.webContents.send(channel, payload);
      },
    });
    this.mcpHost.start();
  }
}
