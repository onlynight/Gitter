import { BrowserWindow, dialog, Notification, shell, safeStorage } from "electron";
import * as fs from "fs";
import * as path from "path";
import { tryGit, looksLikeRepo, GitError } from "./services/gitexec";
import { commitFilesWithCounts, fileDiff, getCommit, listBranches, queryLog } from "./services/gitlog";
import * as status from "./services/gitstatus";
import * as branches from "./services/gitbranches";
import * as worktrees from "./services/worktrees";
import { SettingsStore } from "./services/settings";
import { I18nService, resolveLanguage } from "./services/i18n";
import { ThemeService } from "./services/themes";
import { TerminalManager } from "./services/terminal";
import { HighlightService } from "./services/highlight";
import { McpPipeHost, pendingApprovals, requestHumanApproval } from "./services/mcp";
import { runRegisteredLoop, registeredLoops } from "./services/extensions/agentLoop";
import { PackageStore, type PackageLedgerEntry } from "./services/extensions/store";
import { CommandRegistry } from "./services/extensions/commands";
import { importGpkFile, uninstallPackageDir } from "./services/extensions/gpk";
import { buildRawTheme } from "./services/extensions/grammar";
import { AgentSessionManager } from "./services/agents/session";
import { pickRepairTarget } from "./services/agents/session";
import { registerAgentTool, unregisterAgentToolsBySource } from "./services/agents/registry";
import { auditSeams } from "./services/agents/seams";
import { z } from "zod";
import { checkCallerAccess, type CallerIdentity } from "./services/extensions/rpcScopes";
import { HOST_API_VERSION } from "./services/extensions/store";
import { DATA_API_VERSION } from "./shared/apiVersion";
import { pickProfileRef, pickFastProfileRef, resolveProfileModel } from "./services/agents/provider";
import { compileTaskTypes, BUILTIN_FREE_ID } from "./services/agents/taskTypes";
import type { ModelProfileDTO, UserModelProfileDTO } from "./shared/types";
import * as gitconfig from "./services/gitconfig";
import * as preview from "./services/preview";
import * as aiSvc from "./services/ai";
import * as safety from "./services/safety";
import * as modelDiscovery from "./services/modelDiscovery";
import { groupSessions, squashMessage } from "./services/sessions";
import * as feedbackStore from "./services/feedback";
import type { SettingsDTO } from "./shared/types";

export interface SharedServices {
  settings: SettingsStore;
  i18n: I18nService;
  themes: ThemeService;
  highlight: HighlightService;
  /** 扩展宿主内核（extension-system-v2.md §六） */
  pkgStore: PackageStore;
  commands: CommandRegistry;
  /** TextMate 语法服务（降级链第一级；null 安全：WASM 缺失时自动回退声明式） */
  grammar: import("./services/extensions/grammar").GrammarService;
  /** 统一工具总线（B 阶段）：内置 git 工具 + MCP + L2 插件工具 */
  tools: import("./services/extensions/tools").ToolRegistry;
  /** 事件总线（C 阶段）：L2 插件钩子 */
  events: import("./services/extensions/events").EventBus;
  /** 包声明的外部 MCP server 连接器（D 阶段补 B 遗留） */
  mcpMgr: import("./services/extensions/mcpClient").McpClientManager;
  /** L2 插件宿主（C 阶段） */
  host: import("./services/extensions/host").PluginHost;
  /** 用户扩展包根（.gpk 导入目标 / 卸载边界校验），由 main 注入 */
  userPackagesRoot: string;
  userThemesRoot: string;
  /** 新窗口创建（命令面板"新窗口"用；由 main 注入，避免循环 require）。 */
  createWindow: (repoPath?: string) => void;
  /** 窗口材质重应用（主题/亮暗切换后从主题包重新解析材质与底色；由 main 注入）。 */
  applyWindowMaterial: () => void;
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
  /** Agent 宿主（窗口域，与终端同模式；事件经 evt 通道扇出渲染层） */
  private agents: AgentSessionManager;
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
    }, (kind) => {
      // terminalProfiles 接缝：ext.<pkg>.<id> → 包档位
      const p = this.shared.pkgStore.terminalProfiles().find((x) => x.id === kind);
      return p ? { command: p.command, args: p.args } : null;
    });
    this.agents = new AgentSessionManager({
      repoOf: () => this.repo,
      store: this.shared.pkgStore,
      settings: this.shared.settings,
      // 模型档案链（task-model-modules.md §2.2）：任务绑定 → defaultModelId → 首个可用；解密在此
      resolveModel: (profileRef: string | null, thinking?: "off" | "low" | "medium" | "high") => {
        const s = this.shared.settings.current;
        const p = pickProfileRef(s.models ?? [], profileRef);
        if (!p) {
          return { ok: false as const, error: "没有可用的模型档案：请在 设置 → 模型档案 新增并配置密钥" };
        }
        const key = this.decryptProfileKey(p.apiKeyProtected);
        // 思考深度：任务/输入台显式值 > 档案默认（添加模型时配置）> medium
        const r = resolveProfileModel({ kind: p.kind, baseURL: p.baseURL, modelId: p.modelId, apiKey: key, params: p.params, thinking: thinking ?? p.thinking ?? "medium" });
        return r.ok
          ? { ok: true as const, model: r.model, profileRef: p.id, contextWindow: p.capabilities?.contextTokens ?? 128_000 }
          : { ok: false as const, error: r.error };
      },
      // D8 降级链（§21.3.3）：备用模型 = default 优先、否则首个 ≠ 失败档案的可用档案
      alternateModel: (excludeRef: string, thinking?: "off" | "low" | "medium" | "high") => {
        const s = this.shared.settings.current;
        const exGid = excludeRef.split("#")[0];
        // 换分组而非换成员：同端点的其它模型视为同一份凭证，不算"备用"
        const pool = (s.models ?? []).filter((m) => {
          const gid = m.id.split("#")[0];
          return gid !== exGid && !gid.startsWith(`${exGid}#`);
        });
        const p = pickProfileRef(pool, s.defaultModelId);
        if (!p) return { ok: false as const, error: "没有备用模型档案" };
        const key = this.decryptProfileKey(p.apiKeyProtected);
        // 降级换模型不换思考深度：沿用当前任务档位（输入台显式值优先，其次档案默认）
        const eff = thinking ?? p.thinking ?? "medium";
        const r = resolveProfileModel({ kind: p.kind, baseURL: p.baseURL, modelId: p.modelId, apiKey: key, params: p.params, thinking: eff });
        return r.ok
          ? { ok: true as const, model: r.model, profileRef: p.id, contextWindow: p.capabilities?.contextTokens ?? 128_000 }
          : { ok: false as const, error: r.error };
      },
      // 用量记账（task-model-modules.md §2.3）
      // U5 生命周期钩子 → EventBus（L2 插件 ctx.on("agent.task.*") 订阅）
      onLifecycle: (event, record) => {
        void this.shared.events.emit(`agent.task.${event}`, {
          repo: this.repo,
          taskId: record.taskId,
          title: record.title,
          branch: record.branch,
          state: record.state,
        });
      },
      addUsage: (profileRef, usage) => {
        const cur = this.shared.settings.current.modelUsage ?? {};
        const prev = cur[profileRef] ?? { turns: 0, inputTokens: 0, outputTokens: 0 };
        this.shared.settings.update({
          modelUsage: {
            ...cur,
            [profileRef]: {
              turns: prev.turns + 1,
              inputTokens: prev.inputTokens + (usage?.input ?? 0),
              outputTokens: prev.outputTokens + (usage?.output ?? 0),
            },
          },
        });
      },
      send: (method: string, params: unknown) => {
        if (!win.isDestroyed()) win.webContents.send("evt", { method, params });
      },
      // D5 任务完成 OS 通知：completed/failed/interrupted 且窗口未聚焦时弹；点击聚焦窗口
      notifyTaskDone: (task) => {
        if (this.shared.settings.current.agentsNotify === false) return;
        const label = task.state === "awaiting-input" ? "已完成"
          : task.state === "failed" ? "失败"
          : task.state === "interrupted" ? "已中断" : "";
        if (!label || win.isDestroyed() || win.isFocused()) return;
        try {
          const n = new Notification({
            title: `Agent ${label}：${task.title}`,
            body: (task.summary ?? "").slice(0, 160),
            silent: false,
          });
          n.on("click", () => {
            if (win.isDestroyed()) return;
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
          });
          n.show();
        } catch {
          // 系统不支持通知：静默跳过
        }
      },
      // §14.7 只读事件广播 → 插件 EventBus（pre-tool 拦截不开放，引擎不插件）
      onBusEvent: (name, payload) => {
        void this.shared.events.emit(name, { repo: this.repo, ...payload });
      },
    });
    this.registerAll();
  }

  dispose() {
    this.terminals.disposeAll();
    this.mcpHost?.stop();
    this.agents.dispose();
  }

  /** main 的 host.notify 扇出用。 */
  isWindowDestroyed(): boolean {
    return this.win.isDestroyed();
  }

  sendNotify(title: string, body: string): void {
    if (!this.win.isDestroyed()) this.win.webContents.send("evt", { method: "ui.notify", params: { title, body } });
  }

  async handle(method: string, args: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: { message: string; detail?: string } }> {
    const handler = this.handlers.get(method);
    if (!handler) return { ok: false, error: { message: `未知桥方法: ${method}` } };

    // U2 权限令牌（advisory）：外部页 SDK 调用携带 __caller，bridge 按声明的权限域过滤；
    // 无 __caller（宿主自身页面）不受影响。剥离后转传，handler 参数不受污染。
    // R0/A1 闭环：permissions 由 loader 从 manifest 注入 __caller（页面脚本不可自报）。
    const caller = (args as { __caller?: CallerIdentity } | null)?.__caller;
    let handlerArgs = args;
    if (caller) {
      const access = checkCallerAccess(method, caller);
      if (!access.ok) {
        if (!this.win.isDestroyed()) {
          this.win.webContents.send("evt", { method: "audit.rpc.denied", params: { packageId: caller.packageId, method, scope: access.scope } });
        }
        process.stdout.write(`[audit.rpc.denied] ${caller.packageId} ${method} need=${access.scope}
`);
        return { ok: false, error: { message: `permission denied: ${access.scope}` } };
      }
      handlerArgs = { ...(args as Record<string, unknown>) };
      delete (handlerArgs as Record<string, unknown>).__caller;
    }

    try {
      const data = await handler(handlerArgs);
      return { ok: true, data };
    } catch (e) {
      if (e instanceof BridgeError) return { ok: false, error: { message: e.message, detail: e.detail } };
      const err = e as Error;
      const detail = (err as { detail?: string }).detail ?? (err as { stderr?: string }).stderr;
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
      this.shared.host.setCurrentRepo(full);
      this.ensureMcp();
      void this.shared.events.emit("repo.opened", { repo: full });
      return { workDir: full, name: path.basename(full) };
    });
    R("repo.close", () => {
      this.repo = null;
      this.shared.host.setCurrentRepo(null);
      this.mcpHost?.stop();
      this.mcpHost = null;
      void this.shared.events.emit("repo.closed", {});
      return {};
    });
    R("repo.state", () => ({ workDir: this.repo }));

    // ---- Log ----
    R("log.query", async (args: { branch?: string; query?: string; limit?: number; skip?: number }) => {
      const page = await queryLog(this.needRepo(), args ?? {});
      this.shared.host.applyDecorations(page.commits); // log.decorators 接缝（只读徽章）
      return page;
    });
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
        const pkgRules = this.shared.pkgStore.safetyRules();
        const blocked = [
          ...safety.scan(files),
          ...safety.scanPackageRules(files, pkgRules),
          ...this.shared.host.runScanners(files),
        ].filter((x) => x.severity === "blocked");
        if (blocked.length > 0) {
          throw new BridgeError(
            `安全网拦截：${blocked.length} 个阻塞级发现（${blocked[0].filePath}:${blocked[0].line ?? "?"} ${blocked[0].message}…）`,
            JSON.stringify(blocked),
          );
        }
      }
      const vetoes = await this.shared.host.runGates("commit", { message: args.message });
      if (vetoes.length > 0) throw new BridgeError(`插件门禁拦截提交：${vetoes.join("；")}`);
      const r = await status.commit(wd, args.message, !!args.push, this.syncProgress());
      void this.shared.events.emit("commit.created", { repo: wd, message: args.message, pushed: !!args.push });
      return r;
    });
    R("changes.push", async () => {
      const vetoes = await this.shared.host.runGates("push", {});
      if (vetoes.length > 0) throw new BridgeError(`插件门禁拦截推送：${vetoes.join("；")}`);
      const r = await status.retryPush(this.needRepo(), this.syncProgress());
      void this.shared.events.emit("sync.pushed", { repo: this.repo });
      return r;
    });
    // 拉取/抓取失败要抛：pullWithProgress/fetchAll 自身不抛（返回 GitResult），
    // 吞掉非零退出会让按钮报"已拉取"且无任何提示（脏工作区时 git 返回 128）。
    R("changes.pull", async (args: { rebase?: boolean }) => {
      const r = await status.pullWithProgress(this.needRepo(), !!args?.rebase, this.syncProgress());
      if (r.code !== 0) throw new GitError(["pull", "--progress"], r);
      void this.shared.events.emit("sync.pulled", { repo: this.repo });
      return {};
    });
    R("changes.fetch", async () => {
      const r = await status.fetchAll(this.needRepo(), this.syncProgress());
      if (r.code !== 0) throw new GitError(["fetch", "--all", "--progress"], r);
      return {};
    });

    // ---- 分支 ----
    R("branches.state", () => branches.getBranches(this.needRepo()));
    R("branches.checkout", async (args: { name: string }) => {
      const r = await branches.checkout(this.needRepo(), args.name);
      void this.shared.events.emit("branch.checkedOut", { repo: this.repo, branch: args.name });
      return r;
    });
    R("branches.checkoutRemote", async (args: { name: string }) => {
      const local = await branches.checkoutRemote(this.needRepo(), args.name);
      void this.shared.events.emit("branch.checkedOut", { repo: this.repo, branch: local });
      return local;
    });
    R("branches.create", (args: { name: string; fromSha?: string | null; checkout?: boolean }) =>
      branches.createBranch(this.needRepo(), args.name, args.fromSha ?? null, !!args.checkout));
    R("branches.rename", (args: { oldName: string; newName: string }) =>
      branches.renameBranch(this.needRepo(), args.oldName, args.newName));
    R("branches.deletePreview", (args: { name: string }) => branches.deletePreview(this.needRepo(), args.name));
    R("branches.delete", (args: { name: string; force?: boolean }) =>
      branches.deleteBranch(this.needRepo(), args.name, !!args.force));
    R("branches.merge", (args: { name: string; target?: string | null; noFf?: boolean; message?: string | null }) =>
      branches.mergeBranch(this.needRepo(), args.name, !!args.noFf, args.message ?? null, args.target ?? null));
    R("branches.rebase", (args: { name: string }) => branches.rebaseBranch(this.needRepo(), args.name));
    R("branches.ff", (args: { name: string }) => branches.fastForward(this.needRepo(), args.name));
    R("branches.deleteRemote", (args: { name: string }) => branches.deleteRemoteBranch(this.needRepo(), args.name));
    R("tags.list", () => branches.listTags(this.needRepo()));
    R("tags.delete", (args: { name: string }) => branches.deleteTag(this.needRepo(), args.name));
    R("tags.create", (args: { name: string; sha: string; message?: string | null }) =>
      branches.createTag(this.needRepo(), args.name, args.sha, args.message ?? null));
    R("reflog.list", (args: { ref: string; limit?: number }) =>
      branches.listReflog(this.needRepo(), args.ref, args.limit ?? 100));
    R("branches.pull", (args: { rebase?: boolean }) => branches.pull(this.needRepo(), !!args?.rebase, this.syncProgress()));
    R("branches.push", () => branches.push(this.needRepo(), this.syncProgress()));

    // ---- 任务（worktree）----
    R("tasks.list", () => worktrees.listWorktrees(this.needRepo()));
    R("tasks.create", (args: { name: string }) => worktrees.createTaskWorktree(this.needRepo(), args.name));
    R("tasks.remove", (args: { path: string }) => worktrees.removeTaskWorktree(this.needRepo(), args.path));
    // 仓库文件清单（TasksPage @ 提及补全数据源；子串过滤，cap 50）
    R("repo.files", async (args: { query?: string }) => {
      const r = await tryGit(this.needRepo(), ["ls-files", "-co", "--exclude-standard"]);
      let lines = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const q = (args?.query ?? "").trim().toLowerCase();
      if (q) {
        lines = lines
          .map((l) => {
            const low = l.toLowerCase();
            const idx = low.lastIndexOf(q);
            return { l, score: idx < 0 ? 1e9 : idx + low.length - q.length };
          })
          .filter((x) => x.score < 1e9)
          .sort((a, b) => a.score - b.score || a.l.length - b.l.length)
          .map((x) => x.l);
      }
      return lines.slice(0, 50);
    });

    // ---- Agent 宿主（agent-harness-codex.md v2.0 §三/§八 + v4.0 F1/F5/F6/F7/F10）----
    R("agents.list", () => this.agents.listHarnesses());
    R("agent.tasks", () => this.agents.listTasks());
    R("agent.task.create", (args: { name?: string; prompt: string; taskType?: string; model?: string; thinking?: string; mode?: string }) =>
      this.agents.createTask({ name: args?.name, prompt: args?.prompt ?? "", taskType: args?.taskType, model: args?.model, thinking: args?.thinking as never, mode: args?.mode as never }));
    R("agent.task.resume", (args: { taskId: string; prompt: string; thinking?: string; mode?: string }) =>
      this.agents.resumeTask({ ...args, thinking: args?.thinking as never, mode: args?.mode as never }));
    R("agent.task.queue", (args: { taskId: string; prompt: string }) => this.agents.queueTask(args) ?? {});
    R("agent.task.setMode", (args: { taskId: string; mode: string }) => this.agents.setMode({ ...args, mode: args.mode as never }) ?? {});
    R("agent.task.stop", (args: { taskId: string }) => this.agents.stopTask(args) ?? {});
    R("agent.task.feedback", (args: { taskId: string; feedback: string }) => this.agents.sendFeedback(args));
    // 任务历史读取（时间线回放 + journal 分页）：记录 + 事件日志 + 消息历史
    R("agent.task.history", (args: { taskId: string; before?: string; limit?: number }) => this.agents.taskHistory(args));
    R("agent.perm.reply", (args: { requestId: string; ok: boolean; remember?: boolean; answer?: string; optionIndex?: number }) =>
      this.agents.replyPermission(args));
    // 改动预览（F6）：文件列表 / diff（DiffDTO）/ diff 原文（复制）/ checkpoint 索引 / 恢复
    R("agent.task.files", (args: { taskId: string }) => this.agents.taskFiles(args));
    R("agent.task.diff", (args: { taskId: string; path?: string; since?: string }) => this.agents.taskDiff(args));
    R("agent.task.diffText", (args: { taskId: string; path?: string; since?: string }) => this.agents.taskDiffText(args));
    R("agent.task.checkpoints", (args: { taskId: string }) => this.agents.taskCheckpoints(args));
    R("agent.task.previewFile", (args: { taskId: string; path: string }) => this.agents.taskPreview(args));
    // D6 /export：markdown 生成后弹保存框落盘（主进程 dialog；渲染层零新增权限域）
    R("agent.task.export", async (args: { taskId: string }) => {
      const { markdown, title } = await this.agents.exportTaskMarkdown(args);
      const r = await dialog.showSaveDialog(this.win, {
        title: "导出会话为 Markdown",
        defaultPath: `${title.replace(/[\/:*?"<>|]/g, "_")}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (r.canceled || !r.filePath) return { canceled: true as const };
      await (await import("fs/promises")).writeFile(r.filePath, markdown, "utf8");
      return { canceled: false as const, path: r.filePath };
    });
    R("agent.task.restore", (args: { taskId: string; sha: string; path?: string }) => this.agents.restore(args));
    // 上下文与压缩（F7）
    R("agent.context.stats", (args: { taskId: string }) => this.agents.contextStats(args));
    R("agent.task.compact", (args: { taskId: string }) => this.agents.compactTask(args));
    R("agent.task.clear", (args: { taskId: string }) => this.agents.clearTask(args));
    R("agent.task.checkpoint", (args: { taskId: string; summary?: string }) => this.agents.createCheckpoint(args));
    // §20.6 审计视图（提示词段/采集器/钩子/压缩器/预设 逐包可见）
    R("agent.seams.audit", () => auditSeams());
    // 后台 shell 面板（F4 逃生舱联动）+ 图片预览（F2.1）
    R("agent.task.shells", (args: { taskId: string }) => this.agents.taskShells(args));
    R("agent.previewImage", (args: { taskId: string; path: string }) => this.agents.previewImage(args));
    R("agent.task.setModel", (args: { taskId: string; model: string }) => this.agents.setModel(args) ?? {});
    R("agent.task.fork", (args: { taskId: string; model?: string }) => this.agents.fork(args));
    R("agent.task.archive", (args: { taskId: string; archived: boolean }) => this.agents.archive(args) ?? {});
    R("agent.task.delete", (args: { taskId: string }) => this.agents.deleteTask(args));
    R("agent.taskTypes.list", () => {
      const { entries } = compileTaskTypes(this.shared.pkgStore);
      const free = {
        fullId: BUILTIN_FREE_ID, packageId: "builtin", id: "free",
        name: "自由任务", tools: [], defaultModelRef: null, error: null,
      };
      return [free, ...entries];
    });

    // ---- 模型档案（task-model-modules.md §二/§四）----
    R("models.list", () => {
      const s = this.shared.settings.current;
      const models = s.models ?? [];
      const out: ModelProfileDTO[] = [];
      const pkgIds = new Set<string>();
      for (const p of this.shared.pkgStore.list()) {
        if (p.state !== "active" || !p.kindStates.models) continue;
        const rec = this.shared.pkgStore.find(p.id);
        if (!rec) continue;
        for (const m of rec.manifest.contributes.models) {
          const fullId = `${p.id}/${m.id}`;
          pkgIds.add(fullId);
          const user = models.find((u) => u.id === fullId);
          out.push(this.toProfileDTO(
            fullId,
            user ?? {
              id: fullId, name: m.name, kind: m.kind, baseURL: m.baseURL, modelId: m.modelId,
              apiKeyProtected: null, params: { temperature: m.params?.temperature ?? undefined, maxOutputTokens: m.params?.maxOutputTokens ?? undefined },
              capabilities: { tools: m.capabilities.tools, streaming: m.capabilities.streaming, contextTokens: m.capabilities.contextTokens ?? undefined },
              tags: m.tags,
            },
            "package",
            m.keyHint,
            s,
          ));
        }
      }
      // 用户档案按分组折叠：同一 baseURL 的多个模型只显示一张卡片（主条目携带成员清单）
      const userGids = new Set<string>();
      for (const u of models) {
        if (pkgIds.has(u.id)) continue;
        const gid = u.id.split("#")[0];
        if (userGids.has(gid)) continue;
        userGids.add(gid);
        const primary = models.find((m) => m.id === gid) ?? u;
        out.push(this.toProfileDTO(primary.id, primary, "user", null, s, models));
      }
      return out;
    });
    R("models.save", (args: {
      profile: {
        id?: string;
        name: string;
        kind: "openai-compatible" | "anthropic";
        baseURL: string;
        /** 保留字段：分组模式下由 models 承载；单模型调用仍接受 */
        modelId?: string;
        /** 分组成员（一级分组下的多个模型）。给出即以它为准——新增合并、缺失移除。 */
        models?: { modelId: string; vision?: boolean; contextTokens?: number; thinking?: "off" | "low" | "medium" | "high" }[];
        tags?: string[];
        vision?: boolean;
        contextTokens?: number;
        thinking?: "off" | "low" | "medium" | "high";
      };
      /** 密钥仅对新建/未配密钥的分组写入（分组内已存密钥不动，避免每次保存都改写密文） */
      apiKey?: string;
    }) => {
      const p = args.profile;
      const rawModels = p.models ?? (p.modelId ? [{ modelId: p.modelId }] : []);
      const seen = new Set<string>();
      const models_ = rawModels
        .map((m) => ({ ...m, modelId: (m.modelId ?? "").trim() }))
        .filter((m) => {
          if (!m.modelId || seen.has(m.modelId)) return false;
          seen.add(m.modelId);
          return true;
        });
      if (!p.name.trim() || !p.baseURL.trim() || models_.length === 0) {
        throw new BridgeError("name/baseURL/models 均必填（至少 1 个模型）");
      }
      const s = this.shared.settings.current;
      const models = [...(s.models ?? [])];
      let id = p.id ?? "";
      if (!id || !models.some((m) => m.id === id)) {
        id = `user/${p.name.trim().toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "") || "profile"}-${Date.now().toString(36)}`;
      }
      // 分组成员按模型名定位旧条目（保住密钥与既有上下文/思考深度）
      const oldMembers = models.filter((m) => m.id === id || m.id.startsWith(`${id}#`));
      // 分组内已配好的密钥：新增成员直接继承（同一 baseURL 共用一个密钥）
      const groupKey = oldMembers.find((m) => m.apiKeyProtected)?.apiKeyProtected ?? null;
      const entries: UserModelProfileDTO[] = models_.map((m, i) => {
        const kept = oldMembers.find((x) => x.modelId === m.modelId);
        const thinking: "off" | "low" | "medium" | "high" = m.thinking ?? p.thinking ?? kept?.thinking ?? "medium";
        return {
          id: i === 0 ? id : `${id}#${m.modelId}`,
          name: p.name.trim(),
          kind: p.kind,
          baseURL: p.baseURL.trim(),
          modelId: m.modelId,
          apiKeyProtected: kept?.apiKeyProtected ?? groupKey,
          params: kept?.params,
          thinking,
          capabilities: {
            ...(kept?.capabilities ?? { tools: true, streaming: true }),
            vision: m.vision ?? kept?.capabilities?.vision ?? false,
            // 上下文窗口：仅存端点/用户显式提供的正整数（避免启发式猜测被当成事实落盘）
            contextTokens: Number.isFinite(m.contextTokens) && m.contextTokens! > 0
              ? Math.floor(m.contextTokens as number)
              : kept?.capabilities?.contextTokens,
          },
          tags: p.tags ?? kept?.tags ?? [],
        };
      });
      // 分组成员的档案 id：首个成员用分组 id，其余用 `<分组id>#<模型id>`。
      // 旧条目一律移除、以本次 entries 为准——分组 id 在首个成员上被复用，
      // 按 id 判存留会把被顶替的旧条目一并留下，产生 id 重复的脏数据。
      // （旧条目里被保留下来的密钥/上下文已由上面的 kept 合并进 entries。）
      const isGroupOlder = (m: UserModelProfileDTO) => m.id === id || m.id.startsWith(`${id}#`);
      const others = models.filter((m) => !isGroupOlder(m));
      // 浅拷贝 entries：update() 就地改写 settings.data，避免新旧条目共享同一对象引用
      this.shared.settings.update({ models: [...entries.map((e) => ({ ...e })), ...others] });
      // 密钥：分组尚未配置密钥时写入（safeStorage 加密，不出本机）
      const apiKey = args.apiKey;
      if (apiKey && apiKey.length >= 8) {
        const cipher = safeStorage.encryptString(apiKey).toString("base64");
        const patchModels = (this.shared.settings.current.models ?? []).map((e) =>
          !isGroupOlder(e) || e.apiKeyProtected ? e : { ...e, apiKeyProtected: cipher });
        this.shared.settings.update({ models: patchModels });
      }
      return { id, models: entries.map((e) => e.modelId) };
    });
    R("models.delete", (args: { id: string }) => {
      const s = this.shared.settings.current;
      // 删一个档案 = 删掉它所属的整个分组（同一 baseURL 的其余成员一并移除）
      const gid = args.id.split("#")[0];
      const group = (m: UserModelProfileDTO) => m.id === gid || m.id.startsWith(`${gid}#`);
      const models = (s.models ?? []).filter((m) => !group(m));
      const patch: Partial<SettingsDTO> = { models };
      const isGone = (ref: string | null | undefined) => !!ref && group({ id: ref } as UserModelProfileDTO);
      if (isGone(s.defaultModelId)) patch.defaultModelId = models[0]?.id ?? null;
      if (isGone(s.fastModelId)) patch.fastModelId = null;
      this.shared.settings.update(patch);
      return {};
    });
    R("models.setKey", (args: { id: string; key: string }) => {
      if (!safeStorage.isEncryptionAvailable()) throw new BridgeError("系统不支持密钥加密（safeStorage 不可用）");
      const s = this.shared.settings.current;
      const models = [...(s.models ?? [])];
      const gid = args.id.split("#")[0];
      // 分组语义：给组内所有档案都设同一密钥（同一 baseURL 共享凭证）
      const groupEntries = models.filter((m) => m.id === gid || m.id.startsWith(`${gid}#`));
      let target = groupEntries[0];
      if (!target) {
        // 包模板 → 实例化用户档案（同 fullId 遮蔽模板）
        for (const p of this.shared.pkgStore.list()) {
          if (p.state !== "active" || !p.kindStates.models) continue;
          const rec = this.shared.pkgStore.find(p.id);
          const m = rec?.manifest.contributes.models.find((x) => `${p.id}/${x.id}` === args.id);
          if (rec && m) {
            target = {
              id: args.id, name: m.name, kind: m.kind, baseURL: m.baseURL, modelId: m.modelId,
              apiKeyProtected: null, params: { temperature: m.params?.temperature ?? undefined, maxOutputTokens: m.params?.maxOutputTokens ?? undefined },
              capabilities: { tools: m.capabilities.tools, streaming: m.capabilities.streaming, contextTokens: m.capabilities.contextTokens ?? undefined },
              tags: m.tags,
            };
            models.unshift(target);
            break;
          }
        }
        if (!target) throw new BridgeError("模型档案不存在", args.id);
      }
      const cipher = safeStorage.encryptString(args.key).toString("base64");
      for (const m of groupEntries) m.apiKeyProtected = cipher;
      this.shared.settings.update({ models });
      return {};
    });
    R("models.setDefault", (args: { id: string | null }) => {
      this.shared.settings.update({ defaultModelId: args.id });
      return {};
    });
    R("models.setFast", (args: { id: string | null }) => {
      this.shared.settings.update({ fastModelId: args.id });
      return {};
    });
    // 测试连接：拉 /models 列表（DeepSeek-harness 式添加模型：验证 URL+密钥并可自动填充模型 ID）
    R("models.test", async (args: { kind: "openai-compatible" | "anthropic"; baseURL: string; apiKey?: string }) => {
      const base = args.baseURL.trim().replace(/\/+$/, "");
      if (!base) return { ok: false, error: "Base URL 不能为空" };
      const url = args.kind === "anthropic"
        ? `${base.endsWith("/v1") ? base : base + "/v1"}/models`
        : `${base}/models`;
      const headers: Record<string, string> = args.kind === "anthropic"
        ? { "x-api-key": args.apiKey ?? "", "anthropic-version": "2023-06-01" }
        : args.apiKey ? { authorization: `Bearer ${args.apiKey}` } : {};
      try {
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
        if (!res.ok) {
          const hint = res.status === 401 || res.status === 403 ? "（密钥无效或缺失）" : res.status === 404 ? "（端点不存在，检查 Base URL）" : "";
          return { ok: false, error: `HTTP ${res.status}${hint}` };
        }
        const j = (await res.json()) as { data?: { id?: string }[]; models?: { id?: string }[] };
        const ids = (j.data ?? j.models ?? []).map((x) => x.id).filter((x): x is string => !!x);
        return { ok: true, models: ids };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    });
    // 模型发现（添加模型弹窗）：列表 + 模型卡探测（上下文窗口 / 图片模态）
    R("models.discover", async (args: {
      kind: "openai-compatible" | "anthropic";
      baseURL: string;
      apiKey?: string;
      /** 编辑回填：apiKey 留空时用该分组已保存的密钥探测（解密不出本机） */
      profileId?: string;
    }) => {
      let apiKey = args.apiKey;
      if (!apiKey && args.profileId) {
        const gid = args.profileId.split("#")[0];
        const saved = (this.shared.settings.current.models ?? []).find(
          (m) => (m.id === gid || m.id.startsWith(`${gid}#`)) && !!m.apiKeyProtected,
        );
        apiKey = this.decryptProfileKey(saved?.apiKeyProtected) ?? undefined;
      }
      return modelDiscovery.discoverModels({ kind: args.kind, baseURL: args.baseURL, apiKey });
    });

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
    R("terminal.close", (args: { id: string }) => {
      this.terminals.close(args.id);
      return {};
    });

    // ---- 设置 / 主题 / 语言 ----
    R("settings.get", () => settings.current);
    R("api.info", () => ({
      dataApiVersion: DATA_API_VERSION,
      hostApiVersion: HOST_API_VERSION,
    }));
    R("settings.schema", () => ({
      apiVersion: 1,
      // 宿主设置 schema（ui-pluginization-plan.md U6/G9：替换 Settings 页的机器可读描述；
      // packages/confirmedCommands/aiApiKeyProtected 等宿主内部字段不发布）
      fields: [
        { key: "theme", type: "enum", values: ["system", "light", "dark"], default: "system", section: "appearance" },
        { key: "themePackageId", type: "string", default: null, section: "appearance" },
        { key: "language", type: "enum", values: ["system", "en", "zh-Hans"], default: "system", section: "appearance" },
        { key: "diffMode", type: "enum", values: ["sideBySide", "inline"], default: "sideBySide", section: "diff" },
        { key: "terminalShell", type: "string", default: "powershell", section: "terminal" },
        { key: "terminalFontFamily", type: "string", default: "Cascadia Mono", section: "terminal" },
        { key: "terminalFontSize", type: "number", default: 13, section: "terminal" },
        { key: "terminalFollowRepo", type: "boolean", default: true, section: "terminal" },
        { key: "bashPath", type: "string", default: null, section: "terminal" },
        { key: "autoFetch", type: "boolean", default: true, section: "monitor" },
        { key: "autoFetchIntervalMinutes", type: "number", default: 5, section: "monitor" },
        { key: "externalEditor", type: "string", default: null, section: "editor" },
        { key: "aiProvider", type: "string", default: "off", section: "ai" },
        { key: "aiEndpoint", type: "string", default: null, section: "ai" },
        { key: "aiModel", type: "string", default: null, section: "ai" },
        { key: "aiPrivacy", type: "enum", values: ["metadataOnly", "fullDiff", "disabled"], default: "metadataOnly", section: "ai" },
        { key: "safetyNet", type: "enum", values: ["off", "warn", "block"], default: "warn", section: "safety" },
        { key: "mcpEnabled", type: "boolean", default: true, section: "mcp" },
        { key: "allowCodePlugins", type: "boolean", default: false, section: "extensions" },
        { key: "externalMcpEnabled", type: "boolean", default: false, section: "extensions" },
      ],
    }));
    R("settings.set", (args: { patch: Partial<SettingsDTO> }) => {
      settings.update(args.patch ?? {});
      if (args.patch?.externalMcpEnabled !== undefined) void this.syncExternalMcp();
      if (args.patch?.allowCodePlugins !== undefined) this.refreshExtensions();
      // 主题/亮暗切换 → 从主题包重新解析窗口材质与底色（窗口效果唯一事实源 = 主题包）
      if (args.patch?.theme !== undefined || args.patch?.themePackageId !== undefined) {
        this.shared.applyWindowMaterial();
      }
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
    // markdown 链接（agent 输出）→ 系统浏览器；webview 内不跳转
    R("shell.openExternal", (args: { url: string }) => {
      const url = String(args?.url ?? "");
      if (!/^https?:\/\//i.test(url)) throw new BridgeError("仅允许 http/https 链接", url);
      void shell.openExternal(url);
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
      return {
        findings: [
          ...safety.scan(files),
          ...safety.scanPackageRules(files, this.shared.pkgStore.safetyRules()),
          ...this.shared.host.runScanners(files),
        ],
        mode: s.safetyNet,
      };
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

    // ---- 语法高亮（降级链：TextMate → 声明式 → plain，extension-system-v2.md §七）----
    R("highlight.file", async (args: { path: string; text: string }) => {
      const themeState = this.shared.themes.resolve(
        this.shared.settings.current.themePackageId,
        this.shared.settings.current.theme === "light" ? "light" : "dark",
      );
      const syntaxColors = themeState.syntax;
      // 第一级：TextMate（tokenizeLine2 → TokenRun.color 直接下发）
      const built = buildRawTheme(themeState);
      const tm = await this.shared.grammar.highlight(args.path, args.text, built);
      if (tm) return { language: tm.language, lines: tm.lines, syntaxColors };
      // 第二级：内置声明式引擎（highlighters.json）
      const h = this.shared.highlight.forFile(args.path);
      if (!h) return { language: null, lines: [], syntaxColors };
      const lines = args.text.split("\n");
      const { lines: runs } = this.shared.highlight.highlightLines(h, lines);
      return { language: h.language, lines: runs, syntaxColors };
    });

    // ---- 扩展包（extension-system-v2.md §五/§六）----
    R("extensions.list", () => this.shared.pkgStore.list());
    // 停用守卫（ui-full-pluginization-plan.md D4）：槽位恒有 ≥1 已启用提供者，
    // 停用将使某槽位失去唯一提供者时拒绝并把槽位列表作为原因返回。
    R("extensions.setEnabled", (args: { id: string; enabled: boolean }) => {
      if (args.enabled === false) {
        const sole = this.shared.pkgStore.soleProviderSlotsAfterDisable(args.id, "package");
        if (sole.length > 0) {
          throw new BridgeError(`无法停用：以下页面槽位将没有任何已启用的提供者——请先启用替换页面包：${sole.join("、")}`, sole.join(","));
        }
      }
      this.patchLedger(args.id, { enabled: !!args.enabled });
      this.refreshExtensions();
      return this.shared.pkgStore.list();
    });
    R("extensions.setKindEnabled", (args: { id: string; kind: string; enabled: boolean }) => {
      if (args.kind === "pages" && args.enabled === false) {
        const sole = this.shared.pkgStore.soleProviderSlotsAfterDisable(args.id, "pages");
        if (sole.length > 0) {
          throw new BridgeError(`无法停用页面能力：以下槽位将没有任何已启用的提供者——请先启用替换页面包：${sole.join("、")}`, sole.join(","));
        }
      }
      const cur = this.shared.settings.current.packages?.[args.id] ?? {};
      const kinds = { ...(cur.kinds ?? {}), [args.kind]: !!args.enabled };
      this.patchLedger(args.id, { kinds });
      this.refreshExtensions();
      return this.shared.pkgStore.list();
    });
    R("extensions.installFromCatalog", async (args: { url: string }) => {
      const url = String(args?.url ?? "").trim();
      if (!/^https?:\/\//.test(url)) throw new BridgeError("目录安装需要 http(s) 的 .gpk 地址", url);
      const res = await fetch(url);
      if (!res.ok) throw new BridgeError(`下载失败：HTTP ${res.status}`, url);
      const buf = Buffer.from(await res.arrayBuffer());
      const tmpGpk = path.join(this.shared.userPackagesRoot, `catalog-${Date.now()}.gpk`);
      fs.mkdirSync(this.shared.userPackagesRoot, { recursive: true });
      fs.writeFileSync(tmpGpk, buf);
      try {
        const result = importGpkFile(tmpGpk, this.shared.userPackagesRoot);
        this.refreshExtensions();
        return result;
      } finally {
        fs.rmSync(tmpGpk, { force: true });
      }
    });
    R("extensions.importGpk", async () => {
      const r = await dialog.showOpenDialog(this.win, {
        title: "导入扩展包",
        filters: [{ name: "Gitter 扩展包", extensions: ["gpk"] }],
        properties: ["openFile"],
      });
      if (r.canceled || !r.filePaths[0]) return null;
      const result = importGpkFile(r.filePaths[0], this.shared.userPackagesRoot);
      this.refreshExtensions();
      return result;
    });
    R("extensions.uninstall", (args: { id: string }) => {
      const rec = this.shared.pkgStore.find(args.id);
      const all = this.shared.pkgStore.scanAll().find((e) => e.manifest?.id === args.id);
      if (!rec || !all) throw new BridgeError("扩展包不存在", args.id);
      if (!fs.existsSync(all.dir)) throw new BridgeError("扩展包目录不可达", all.dir);
      const userRoots = [this.shared.userPackagesRoot, this.shared.userThemesRoot];
      if (!userRoots.some((root) => all.dir.startsWith(root))) {
        throw new BridgeError("内置包只能禁用，不能卸载", args.id);
      }
      // 停用守卫同款（D4）：卸载唯一页面提供者会让槽位塌陷，先拒
      const sole = this.shared.pkgStore.soleProviderSlotsAfterDisable(args.id, "package");
      if (sole.length > 0) {
        throw new BridgeError(`无法卸载：以下页面槽位将没有任何已启用的提供者——${sole.join("、")}`, sole.join(","));
      }
      uninstallPackageDir(all.dir);
      this.refreshExtensions();
      return this.shared.pkgStore.list();
    });
    R("extensions.setConfig", (args: { id: string; key: string; value: unknown }) => {
      const cur = this.shared.settings.current.packages?.[args.id] ?? {};
      this.patchLedger(args.id, { config: { ...(cur.config ?? {}), [args.key]: args.value } });
      return {};
    });

    // ---- 命令注册表（extension-system-v2.md §九）----
    R("commands.list", (args?: { lang?: "en" | "zh-Hans"; fileSelected?: boolean }) =>
      this.shared.commands.list({
        lang: args?.lang,
        repoOpen: !!this.repo,
        fileSelected: !!args?.fileSelected,
      }));
    R("commands.exec", async (args: { id: string; confirmed?: boolean; filePath?: string | null }) => {
      const vars = await this.templateVars(args.filePath ?? null);
      return this.shared.commands.execute(args.id, (action, execArgs) => this.execHostAction(action, execArgs), {
        confirmed: !!args.confirmed,
        isConfirmed: (id) => (this.shared.settings.current.confirmedCommands ?? []).includes(id),
        markConfirmed: (id) => {
          const cur = this.shared.settings.current.confirmedCommands ?? [];
          this.shared.settings.update({ confirmedCommands: [...cur.filter((c) => c !== id), id].slice(-200) });
        },
        vars,
      });
    });
    R("menus.list", (args?: { location: "changesFile" | "branchRow" | "logRow"; lang?: "en" | "zh-Hans"; fileSelected?: boolean }) =>
      this.shared.commands.menusList(args?.location ?? "changesFile", {
        lang: args?.lang,
        repoOpen: !!this.repo,
        fileSelected: !!args?.fileSelected,
      }));
    R("tools.list", () => this.shared.tools.list());
    R("skills.list", () => this.shared.pkgStore.skillsOf());
    R("ui.statusItems", () => this.shared.host.listStatusItems());
    R("ui.panels", () => this.shared.host.resolvePanels(this.repo));
    R("ui.views", () => this.shared.host.listViews());
    // 内置页面包恒返回（信任随应用分发，R0/A3 门分离）；用户页面包受 allowCodePlugins 门控
    R("extensions.pages", (args?: { lang?: string }) => {
      const all = this.shared.pkgStore.pagesOf();
      const gate = this.shared.settings.current.allowCodePlugins;
      const lang = args?.lang ?? "en";
      return (gate ? all : all.filter((p) => p.isBuiltIn)).map((p) => ({
        ...p,
        title: this.shared.commands.resolvePageTitle(p.packageId, p.title, lang),
      }));
    });
    R("ui.emptyHints", (args?: { slot?: "changes.empty" | "log.empty" | "branches.empty" }) =>
      this.shared.pkgStore.emptyHintsOf(args?.slot ?? "changes.empty"));
    R("ui.commitBlocks", (args?: { message?: string; fileCount?: number }) =>
      this.shared.host.resolveCommitBlocks({ message: args?.message ?? "", files: args?.fileCount ?? 0 }));
    R("diff.notes", (args: { path: string }) => this.shared.host.resolveDiffNotes(args.path));
    R("review.repair", () => {
      // A4 验收台闭环：rejected 反馈 → 直投最近可接任务的修复轮
      const wd = this.needRepo();
      const fb = feedbackStore.readFeedback(wd);
      if (!fb) throw new BridgeError("没有待处理的验收反馈");
      const target = pickRepairTarget(this.agents.listTasks());
      if (!target) throw new BridgeError("没有可直投的任务——请先在任务页创建", "NO_TASK");
      const feedback = fb.path ? `${fb.note}
（涉及文件：${fb.path}）` : fb.note;
      const task = this.agents.sendFeedback({ taskId: target.taskId, feedback });
      feedbackStore.clearFeedback(wd);
      return { task, note: fb.note };
    });
    R("agent.loop.run", async (args: { input: string; loopId?: string; maxSteps?: number }) => {
      const wd = this.needRepo();
      const sink = {
        send: (channel: string, payload: unknown) => {
          if (!this.win.isDestroyed()) this.win.webContents.send(channel, payload);
        },
      };
      const provider = this.aiConfig().provider;
      return runRegisteredLoop(args.loopId ?? (provider === "anthropic" ? "builtin.tools.anthropic" : "builtin.tools"), {
        workDir: wd,
        system: "You are a git assistant inside the Gitter client. Use tools when helpful, then answer concisely.",
        user: String(args.input ?? ""),
        skills: this.shared.pkgStore.skillsOf().map((k) => ({ name: k.name, instructions: k.instructions })),
        maxSteps: args.maxSteps,
        requestApproval: (d) => requestHumanApproval(sink, path.basename(wd), d),
        onDelta: (delta) => {
          if (!this.win.isDestroyed()) this.win.webContents.send("evt", { method: "agent.stream", params: { delta } });
        },
      }, this.aiConfig());
    });
    R("agent.loops", () => registeredLoops());
    R("host.status", () => this.shared.host.status());
    R("terminal.profiles", () => [
      { id: "powershell", name: "PowerShell", source: "builtin" },
      { id: "cmd", name: "CMD", source: "builtin" },
      { id: "bash", name: "Git Bash", source: "builtin" },
      ...this.shared.pkgStore.terminalProfiles().map((p) => ({ id: p.id, name: p.name, source: "package" as const })),
    ]);

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

    R("log.reset", async (args: { sha: string; mode: "soft" | "mixed" | "hard"; branch?: string | null }) => {
      const wd = this.needRepo();
      // 指定 branch 且非当前检出分支：只移动该分支指针（git branch -f），不动工作区——
      // 修复"日志页切换查看分支后重置仍作用于当前分支"的错位（dev 被误重置）
      if (args.branch) {
        const cur = (await tryGit(wd, ["branch", "--show-current"])).stdout.trim();
        if (cur !== args.branch) return branches.moveBranch(wd, args.branch, args.sha);
      }
      return status.resetTo(wd, args.sha, args.mode ?? "mixed");
    });

    // ---- 非代码文件预览（图片等二进制直接出内容，不走 diff）----
    R("file.preview", async (args: { path: string; staged?: boolean; maxBytes?: number }) => {
      // previewProviders 接缝：包提供者优先，缺省走内置预览
      const provider = this.shared.host.findPreviewProvider(args.path);
      if (provider) {
        const r = await provider(args.path, args.maxBytes);
        if (r) return r;
      }
      return preview.readPreview(this.needRepo(), args.path, !!args.staged, args.maxBytes);
    });

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

  /** 组装 AI 配置：模型档案 fast 链优先（task-model-modules.md §2.4）；无档案回落 legacy（cli 桥一次性补全）。 */
  private aiConfig(): aiSvc.AiConfig {
    const s = this.shared.settings.current;
    const p = pickFastProfileRef(s.models ?? [], s.fastModelId, s.defaultModelId);
    if (p) {
      const key = this.decryptProfileKey(p.apiKeyProtected);
      return {
        provider: p.kind === "anthropic" ? "anthropic" : "openai",
        endpoint: p.baseURL,
        model: p.modelId,
        cliCommand: s.aiCliCommand,
        apiKey: key,
      };
    }
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

  /** 档案密钥解密（safeStorage；只在内存，不回传渲染层明文）。 */
  private decryptProfileKey(protectedKey: string | null | undefined): string | null {
    if (!protectedKey || !safeStorage.isEncryptionAvailable()) return null;
    try {
      return safeStorage.decryptString(Buffer.from(protectedKey, "base64"));
    } catch {
      return null;
    }
  }

  private toProfileDTO(
    id: string,
    u: UserModelProfileDTO,
    source: "user" | "package",
    keyHint: string | null,
    s: SettingsDTO,
    peers?: UserModelProfileDTO[],
  ): ModelProfileDTO {
    // 分组档案（同一 baseURL 的多个模型）：用量按组内成员汇总，密钥状态取组内并集
    const gid = id.split("#")[0];
    const group = (peers && peers.length > 0 ? peers : [u]).filter(
      (m) => m.id === gid || m.id.startsWith(`${gid}#`),
    );
    const usage = group.reduce(
      (acc, m) => {
        const u = s.modelUsage?.[m.id] ?? { turns: 0, inputTokens: 0, outputTokens: 0 };
        return { turns: acc.turns + u.turns, inputTokens: acc.inputTokens + u.inputTokens, outputTokens: acc.outputTokens + u.outputTokens };
      },
      { turns: 0, inputTokens: 0, outputTokens: 0 },
    );
    const hasKey = group.some((m) => !!m.apiKeyProtected);
    return {
      id,
      name: u.name,
      kind: u.kind,
      baseURL: u.baseURL,
      modelId: u.modelId,
      source,
      configured: source === "user" || hasKey,
      enabled: true,
      hasKey,
      keyHint,
      thinking: u.thinking ?? "medium",
      capabilities: {
        tools: u.capabilities?.tools ?? true,
        streaming: u.capabilities?.streaming ?? true,
        contextTokens: u.capabilities?.contextTokens,
        vision: u.capabilities?.vision ?? false,
      },
      tags: u.tags ?? [],
      // 分组级判定：默认/轻量指向组内任一成员时，整组卡片都视为默认/轻量
      isDefault: (s.defaultModelId?.split("#")[0] ?? null) === gid,
      isFast: (s.fastModelId?.split("#")[0] ?? null) === gid,
      usage,
      groupId: gid,
      // 仅分组主条目（档案 id 即分组 id）携带成员明细；成员条目本身不进列表
      groupModels: id === gid
        ? group.map((m) => ({
            modelId: m.modelId,
            vision: m.capabilities?.vision ?? false,
            contextTokens: m.capabilities?.contextTokens,
            thinking: m.thinking ?? "medium",
          }))
        : undefined,
    };
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
    }, { allowWrites: false, tools: this.shared.tools });
    this.mcpHost.start();
  }

  /** 扩展启停账本补丁（settings.packages[id]），白名单式合并。 */
  private patchLedger(id: string, patch: Partial<PackageLedgerEntry>): void {
    const cur = { ...(this.shared.settings.current.packages ?? {}) };
    cur[id] = { ...(cur[id] ?? {}), ...patch };
    this.shared.settings.update({ packages: cur });
  }

  /** 包集合变化后重建派生注册表（包命令 / 用户语法 / L2 宿主 / 工具表 / 外部 MCP），
   * 并通知渲染层热刷新外部页面（R0/D6 生命周期：卸载注销/重装载）。 */
  private refreshExtensions(): void {
    this.shared.commands.registerPackageCommands(this.shared.pkgStore);
    this.shared.grammar.reset();
    void this.shared.host.activateAll(this.shared.pkgStore, {
      allowCode: this.shared.settings.current.allowCodePlugins,
    });
    void this.syncExternalMcp();
    this.syncPackageAgentRules();
    this.emit("extensions.changed", { allowCodePlugins: this.shared.settings.current.allowCodePlugins });
  }

  /** 渲染层事件推送（evt 通道，onEvent 消费）。 */
  private emit(method: string, params: unknown): void {
    if (!this.win.isDestroyed()) this.win.webContents.send("evt", { method, params });
  }

  /** §20.3.9 规则数据化：包 commandRiskRules → safety（只上调 max 语义）；agentPermissionRules(deny) 由 session 直读 store。 */
  private syncPackageAgentRules(): void {
    try {
      const rules = this.shared.pkgStore.commandRiskRulesOf().map((r) => ({
        packageId: r.packageId,
        pattern: new RegExp(r.pattern),
        risk: r.risk,
      }));
      safety.setPackageRiskRules(rules);
    } catch (e) {
      console.warn("[commandRiskRules] 注册失败:", (e as Error).message);
    }
  }

  /** mcpServers 接缝：包声明的外部 server 全量重连（信任门 settings.externalMcpEnabled）。
   *  F12.4：agentsExternalMcpTools 开启时，MCP 工具同步注册进 agent 注册表（mcp. 命名空间，恒 each-time）。 */
  private async syncExternalMcp(): Promise<void> {
    const mgr = this.shared.mcpMgr;
    mgr.disconnectAll();
    unregisterAgentToolsBySource("mcp");
    if (!this.shared.settings.current.externalMcpEnabled) return;
    const intoAgent = this.shared.settings.current.agentsExternalMcpTools === true;
    for (const cfg of this.shared.pkgStore.mcpServersOf()) {
      const r = await mgr.connect(cfg, this.shared.tools);
      if (r.error) {
        console.warn(`[mcpServers] ${cfg.id} 连接失败:`, r.error);
        continue;
      }
      if (!intoAgent) continue;
      for (const info of this.shared.tools.list().filter((t) => t.source === "mcp" && t.name.startsWith(`${cfg.id}.`))) {
        registerAgentTool({
          name: `mcp.${info.name}`,
          description: `[MCP] ${info.description}`,
          parametersSchema: z.record(z.string(), z.unknown()),
          permissionClass: "each-time",
          source: "mcp",
          execute: async (env, args) => {
            // agent 侧授权门（each-time）已在 buildToolset 生效，此处放行 extensions 门
            const out = await this.shared.tools.call(info.name, args, {
              workDir: env.worktreePath,
              requestApproval: async () => true,
            });
            return out ?? "（空结果）";
          },
        });
      }
    }
  }

  /** 命令模板变量（${repo.path}/${repo.branch}/${file.path}；config.* 在 registry.execute 内按包合并）。 */
  private async templateVars(filePath: string | null): Promise<Record<string, string>> {
    const vars: Record<string, string> = { "repo.path": this.repo ?? "", "repo.branch": "", "file.path": filePath ?? "" };
    if (this.repo) {
      try {
        const r = await tryGit(this.repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
        vars["repo.branch"] = r.stdout.trim();
      } catch {
        // 游离 HEAD 等场景取不到分支名 → 空串
      }
    }
    return vars;
  }

  /** L1 受限命令的宿主动作执行体（白名单见 commands.ts HOST_ACTIONS）。 */
  private async execHostAction(action: string, rawArgs: unknown): Promise<void> {
    const a = (rawArgs ?? {}) as Record<string, unknown>;
    if (action === "terminal.run") {
      if (typeof a.command !== "string" || !a.command.trim()) {
        throw new BridgeError("terminal.run 需要 command 参数");
      }
      const session = this.terminals.ensure({
        cols: 120,
        rows: 30,
        cwd: this.repo,
        shellKind: this.shared.settings.current.terminalShell,
      });
      this.terminals.write(session.id, Buffer.from(a.command + "\r", "utf8").toString("base64"));
      return;
    }
    if (action === "shell.openPath") {
      if (typeof a.path !== "string" || !a.path.trim()) {
        throw new BridgeError("shell.openPath 需要 path 参数");
      }
      if (a.editor === true && this.shared.settings.current.externalEditor) {
        await new Promise<void>((resolve, reject) => {
          import("child_process").then((cp) => {
            const child = cp.spawn(this.shared.settings.current.externalEditor!, [a.path as string], { shell: true, windowsHide: true });
            child.on("close", (code) => (code === 0 ? resolve() : reject(new BridgeError("外部编辑器启动失败", `exit ${code}`))));
            child.on("error", (e) => reject(new BridgeError("外部编辑器启动失败", String(e))));
          });
        });
        return;
      }
      await shell.openPath(a.path);
      return;
    }
    if (action === "shell.reveal") {
      if (typeof a.path !== "string" || !a.path.trim()) {
        throw new BridgeError("shell.reveal 需要 path 参数");
      }
      shell.showItemInFolder(a.path);
      return;
    }
    if (action === "repo.refresh") {
      if (!this.win.isDestroyed()) this.win.webContents.send("evt", { method: "repo.refresh", params: {} });
      return;
    }
    // Agent 宿主动作（agent-harness.md v3.0：包命令的执行体；任务派生已收敛为内置 agent）
    if (action === "agent.task.create") {
      const name = typeof a.name === "string" && a.name.trim() ? a.name : "";
      const prompt = typeof a.prompt === "string" ? a.prompt : "";
      this.needRepo();
      await this.agents.createTask({ name, prompt });
      return;
    }
    if (action === "agent.task.resume") {
      const prompt = typeof a.prompt === "string" ? a.prompt : "";
      this.needRepo();
      await this.agents.resumeLast(prompt);
      return;
    }
    throw new BridgeError(`不允许的宿主动作：${action}`);
  }
}
