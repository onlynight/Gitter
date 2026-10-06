import * as path from "path";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const require_: NodeRequire = eval("require") as NodeRequire;
import { tryGit } from "../gitexec";
import { registerAgentLoop, unregisterAgentLoop } from "./agentLoop";
import { registerAiProvider, unregisterAiProvider } from "../ai";

/** L3 隔离子进程通道（extension-system-v2.md §16.6 F 阶段）。
 * 双适配器：Electron utilityProcess（main 注入）/ Node child_process.fork（无头冒烟）。 */
export interface L3Channel {
  send(msg: unknown): void;
  onMessage(cb: (msg: any) => void): void;
  onExit(cb: (code: number) => void): void;
  kill(): void;
}

export type UtilityTransport = (entryPath: string, serviceName: string, sdkDir: string) => L3Channel;
import type { PackageRecord, PackageStore } from "./store";
import type { CommandRegistry, CommandDef } from "./commands";
import type { ToolRegistry, ToolDef } from "./tools";
import type { EventBus } from "./events";
import type { PluginStorage } from "./storage";
import type { ScannableFile, RuleFinding } from "../safety";

/**
 * L2 插件宿主（extension-system-v2.md §16.6 C 阶段，host.ts activate/dispose 契约）：
 * 包 manifest 声明 `entry: "main.js"`（CJS，module.exports = (ctx) => dispose|void）。
 * 信任门：settings.allowCodePlugins（默认 false）——L2 只走审核渠道，任意来源默认仅 L1。
 * 安全不变量（§16.3）：插件"提议"（注册命令/工具/钩子），执行权在宿主；写操作仍走人审门；
 * 门禁钩子只能否决、不能篡改。
 */

export interface Decoration {
  text: string;
  color?: string;
}

export type LogDecorator = (commit: {
  sha: string;
  subject: string;
  author: string;
  body: string;
}) => Decoration[] | null;

export type GatePoint = "commit" | "push";
/** 返回否决原因字符串 = 拦截；null = 放行。 */
export type GateHook = (info: Record<string, unknown>) => Promise<string | null> | string | null;

export type PreviewResult = { kind: "text" | "html"; content: string } | null;
export type PreviewProvider = (filePath: string, maxBytes?: number) => Promise<PreviewResult> | PreviewResult;

export type PluginScanner = (file: ScannableFile) => RuleFinding[] | null;

export interface PluginCtx {
  packageId: string;
  /** 注册命令（自动加 ext.<pkg>. 前缀；运行时命令随宿主启停回收） */
  registerCommand(def: { id: string; title: string; when?: string; action: string; args?: unknown }): void;
  /** 注册工具进统一 ToolRegistry（source=plugin；写工具 permission="write:gate" 仍走人审） */
  registerTool(tool: ToolDef): void;
  /** 订阅宿主事件（事件名 = events.ts EVENT_NAMES 枚举） */
  on(event: string, handler: (payload: Record<string, unknown>) => void | Promise<void>): void;
  /** 插件隔离 KV */
  storage: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
  };
  /** 渲染层 toast（ui.notify 事件） */
  notify(title: string, body?: string): void;
  registerLogDecorator(fn: LogDecorator): void;
  registerPreviewProvider(exts: string[], fn: PreviewProvider): void;
  /** L2 自定义扫描器：可返回 blocked（allowCodePlugins 门 = 审核渠道信任） */
  registerScanner(fn: PluginScanner): void;
  /** 门禁钩子：只能否决不能篡改 */
  registerGate(point: GatePoint, fn: GateHook): void;
  /** 状态栏条目（E 阶段插槽：渲染层 ui.statusItems 拉取，command 为命令 id 可选） */
  registerStatusItem(id: string, item: { text: string; tooltip?: string; command?: string }): void;
  /** 侧栏面板（E 阶段插槽：L2 数据供给，渲染层 ui.panels 拉取正文文本） */
  registerPanel(id: string, panel: { title: string; body: (ctx: { repo: string | null }) => Promise<string> | string }): void;
  /** webview 视图容器（E 阶段收尾：静态 HTML，渲染层沙箱 iframe，无脚本权限） */
  registerView(id: string, view: { title: string; html: string }): void;
  /** 提交对话框区块（E 阶段收尾：提交前提示块，只能提示不能阻断——阻断走 registerGate） */
  registerCommitBlock(fn: (info: { message: string; files: number }) => Promise<string> | string): void;
  /** diff 侧栏注记（E 阶段收尾：按文件路径的只读注记） */
  registerDiffNote(fn: (filePath: string) => Promise<string | null> | string | null): void;
  /** 注册 Agent 循环（§15：id 自动加 ext.<pkg>. 前缀；bridge 按 provider 路由默认循环） */
  registerLoop(id: string, impl: (req: import("./agentLoop").AgentRunRequest, config: import("../ai").AiConfig) => Promise<import("./agentLoop").AgentRunResult>): void;
  /** 注册 AI provider（openai 兼容/anthropic 自定义传输；apiKey 永不下发插件） */
  registerAiProvider(name: string, impl: {
    isConfigured(c: import("../ai").AiConfig): boolean;
    complete(prompt: import("../ai").AiPrompt, c: import("../ai").AiConfig, timeoutMs: number): Promise<string>;
  }): void;
  /** 只读 git API（pluginization-plan.md PR-2 前置：L2 ctx.git） */
  git: {
    status(): Promise<string>;
    log(limit?: number): Promise<string>;
    branches(): Promise<string>;
  };
}

export interface HostDeps {
  registry: CommandRegistry;
  tools: ToolRegistry;
  events: EventBus;
  storage: PluginStorage;
  notify: (title: string, body: string) => void;
  /** L3 隔离子进程通道工厂（缺省 = utility 沙箱不可用，entry 拒载并标注原因） */
  utilityTransport?: UtilityTransport;
  /** 编译产物目录（L3 子进程 require l3-child 用） */
  sdkDir?: string;
}

export interface ActivateOptions {
  allowCode: boolean;
  /** ctx.git 只读 API 的当前仓库（bridge repo.open 时同步） */
}

export interface PackageHostStatus {
  packageId: string;
  active: boolean;
  error: string | null;
}

export class PluginHost {
  private active = new Map<string, { error: string | null }>();
  private disposables = new Map<string, (() => void)[]>();
  private decorators: { owner: string; fn: LogDecorator }[] = [];
  private previewProviders: { owner: string; exts: Set<string>; fn: PreviewProvider }[] = [];
  private scanners: { owner: string; fn: PluginScanner }[] = [];
  private gates: { owner: string; point: GatePoint; fn: GateHook }[] = [];
  private statusItems = new Map<string, { owner: string; text: string; tooltip?: string; command?: string }>();
  private panels = new Map<string, { owner: string; title: string; body: (ctx: { repo: string | null }) => Promise<string> | string }>();
  private views = new Map<string, { owner: string; title: string; html: string }>();
  private commitBlocks: { owner: string; fn: (info: { message: string; files: number }) => Promise<string> | string }[] = [];
  private diffNotes: { owner: string; fn: (filePath: string) => Promise<string | null> | string | null }[] = [];
  private l3Channels = new Map<string, L3Channel>();
  private l3ToolPending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private l3ToolSeq = 1;
  private currentRepo: string | null = null;
  private lastActivateRecord: PackageRecord | null = null;

  constructor(private readonly deps: HostDeps) {}

  /** bridge repo.open/close 同步（ctx.git 只读 API 用）。 */
  setCurrentRepo(workDir: string | null): void {
    this.currentRepo = workDir;
  }

  get allowCodeActivated(): boolean {
    return this.active.size > 0;
  }

  /** 全量（重）激活：先卸载再按 allowCode 门装载 entry 包。 */
  async activateAll(store: PackageStore, opts: ActivateOptions): Promise<void> {
    this.deactivate();
    if (!opts.allowCode) return;
    for (const p of store.list()) {
      if (p.state !== "active") continue;
      const rec = store.find(p.id);
      if (!rec || !rec.manifest.contributes || !("entry" in (rec.manifest as unknown as Record<string, unknown>))) continue;
      const entry = (rec.manifest as unknown as { entry?: string }).entry;
      if (!entry) continue;
      await this.activateOne(p.id, path.join(rec.dir, entry), rec);
    }
  }

  private async activateOne(packageId: string, entryPath: string, rec: PackageRecord): Promise<void> {
    this.lastActivateRecord = rec;
    const disposables: (() => void)[] = [];
    const cleanup = (fn: () => void) => {
      disposables.push(fn);
    };
    const ctx: PluginCtx = {
      packageId,
      registerCommand: (def) => {
        const fullId = `ext.${packageId}.${def.id}`;
        const cmdDef: CommandDef = {
          id: fullId,
          title: def.title,
          when: def.when ?? null,
          action: def.action,
          args: def.args,
          packageId,
          runtime: true,
        };
        this.deps.registry.registerRuntimeCommand(cmdDef);
        cleanup(() => this.deps.registry.unregisterCommand(fullId));
      },
      registerTool: (tool) => {
        this.deps.tools.register(tool, "plugin", packageId);
        cleanup(() => this.deps.tools.unregisterByPackage(packageId));
      },
      on: (event, handler) => {
        const off = this.deps.events.on(event, packageId, handler);
        cleanup(off);
      },
      storage: {
        get: (key) => this.deps.storage.getKey(packageId, key),
        set: (key, value) => this.deps.storage.set(packageId, key, value),
      },
      notify: (title, body) => this.deps.notify(title, body ?? ""),
      registerLogDecorator: (fn) => {
        this.decorators.push({ owner: packageId, fn });
        cleanup(() => {
          const i = this.decorators.findIndex((d) => d.owner === packageId && d.fn === fn);
          if (i >= 0) this.decorators.splice(i, 1);
        });
      },
      registerPreviewProvider: (exts, fn) => {
        const set = new Set(exts.map((e) => (e.startsWith(".") ? e.toLowerCase() : `.${e.toLowerCase()}`)));
        this.previewProviders.push({ owner: packageId, exts: set, fn });
        cleanup(() => {
          const i = this.previewProviders.findIndex((d) => d.owner === packageId && d.fn === fn);
          if (i >= 0) this.previewProviders.splice(i, 1);
        });
      },
      registerScanner: (fn) => {
        this.scanners.push({ owner: packageId, fn });
        cleanup(() => {
          const i = this.scanners.findIndex((d) => d.owner === packageId && d.fn === fn);
          if (i >= 0) this.scanners.splice(i, 1);
        });
      },
      registerGate: (point, fn) => {
        this.gates.push({ owner: packageId, point, fn });
        cleanup(() => {
          const i = this.gates.findIndex((d) => d.owner === packageId && d.point === point && d.fn === fn);
          if (i >= 0) this.gates.splice(i, 1);
        });
      },
      registerStatusItem: (itemId, item) => {
        const key = `${packageId}/${itemId}`;
        this.statusItems.set(key, { owner: packageId, text: item.text, tooltip: item.tooltip, command: item.command });
        cleanup(() => this.statusItems.delete(key));
      },
      registerPanel: (panelId, panel) => {
        const key = `${packageId}/${panelId}`;
        this.panels.set(key, { owner: packageId, title: panel.title, body: panel.body });
        cleanup(() => this.panels.delete(key));
      },
      registerView: (viewId, view) => {
        const key = `${packageId}/${viewId}`;
        this.views.set(key, { owner: packageId, title: view.title, html: view.html });
        cleanup(() => this.views.delete(key));
      },
      registerCommitBlock: (fn) => {
        this.commitBlocks.push({ owner: packageId, fn });
        cleanup(() => {
          const i = this.commitBlocks.findIndex((x) => x.owner === packageId && x.fn === fn);
          if (i >= 0) this.commitBlocks.splice(i, 1);
        });
      },
      registerDiffNote: (fn) => {
        this.diffNotes.push({ owner: packageId, fn });
        cleanup(() => {
          const i = this.diffNotes.findIndex((x) => x.owner === packageId && x.fn === fn);
          if (i >= 0) this.diffNotes.splice(i, 1);
        });
      },
      registerLoop: (loopId, impl) => {
        const fullId = `ext.${packageId}.${loopId}`;
        registerAgentLoop(fullId, impl);
        cleanup(() => unregisterAgentLoop(fullId));
      },
      registerAiProvider: (name, impl) => {
        const fullName = `ext.${packageId}.${name}`;
        registerAiProvider(fullName, impl);
        cleanup(() => unregisterAiProvider(fullName));
      },
      git: {
        status: async () => (await tryGit(this.currentRepo ?? ".", ["status", "--porcelain"])).stdout,
        log: async (limit) => (await tryGit(this.currentRepo ?? ".", ["log", "--oneline", "-n", String(limit ?? 10)])).stdout,
        branches: async () => (await tryGit(this.currentRepo ?? ".", ["branch", "--list"])).stdout,
      },
    };
    const recInfo = this.lastActivateRecord;
    if (recInfo?.manifest.entrySandbox === "utility") {
      this.activateUtility(packageId, entryPath, recInfo.manifest.permissions ?? [], ctx, disposables);
      this.disposables.set(packageId, disposables);
      return;
    }
    try {
      const mod = require_(path.resolve(entryPath));
      const activate = typeof mod === "function" ? mod : typeof mod?.activate === "function" ? mod.activate : null;
      if (!activate) throw new Error("entry 未导出 activate(ctx) 函数（module.exports = ctx => {...}）");
      const maybeDispose = await activate(ctx);
      if (typeof maybeDispose === "function") disposables.push(maybeDispose);
      this.disposables.set(packageId, disposables);
      this.active.set(packageId, { error: null });
    } catch (e) {
      // 装载失败：回滚本包已注册的面，宿主与其它包不受影响
      for (const d of disposables) {
        try {
          d();
        } catch { /* ignore */ }
      }
      this.active.set(packageId, { error: (e as Error).message });
    }
  }

  deactivate(): void {
    for (const list of this.disposables.values()) {
      for (const d of list) {
        try {
          d();
        } catch { /* ignore */ }
      }
    }
    this.disposables.clear();
    this.active.clear();
    this.decorators = [];
    this.previewProviders = [];
    this.scanners = [];
    this.gates = [];
    this.statusItems.clear();
    this.panels.clear();
    this.views.clear();
    this.commitBlocks = [];
    this.diffNotes = [];
    for (const ch of this.l3Channels.values()) {
      try {
        ch.kill();
      } catch {
        /* ignore */
      }
    }
    this.l3Channels.clear();
    this.l3ToolPending.clear();
  }

  /** L3 隔离装载：spawn utility 通道 → init（权限清单）→ 能力代理（权限强制）。 */
  private activateUtility(
    packageId: string,
    entryPath: string,
    permissions: string[],
    _ctx: PluginCtx,
    disposables: (() => void)[],
  ): void {
    const transport = this.deps.utilityTransport;
    if (!transport) {
      this.active.set(packageId, { error: "utilityProcess 通道不可用（宿主未提供 L3 传输）" });
      return;
    }
    const perms = new Set(permissions);
    let channel: L3Channel;
    try {
      channel = transport(entryPath, packageId, this.deps.sdkDir ?? "");
    } catch (e) {
      this.active.set(packageId, { error: `L3 启动失败：${(e as Error).message}` });
      return;
    }
    this.l3Channels.set(packageId, channel);
    disposables.push(() => {
      channel.kill();
      this.l3Channels.delete(packageId);
    });

    const reply = (m: unknown) => channel.send(m);
    const callTool = (name: string, args: Record<string, unknown>): Promise<unknown> =>
      new Promise((resolve, reject) => {
        const id = `t${this.l3ToolSeq++}`;
        const timer = setTimeout(() => {
          if (this.l3ToolPending.has(id)) {
            this.l3ToolPending.delete(id);
            reject(new Error("L3 工具执行超时"));
          }
        }, 30000);
        this.l3ToolPending.set(id, {
          resolve: (v) => {
            clearTimeout(timer);
            resolve(v);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });
        reply({ type: "toolCall", id, name, args });
      });

    channel.onMessage((raw) => {
      const msg = raw as { type: string; id?: number | string; ok?: boolean; data?: unknown; error?: string; cap?: string; method?: string; args?: Record<string, unknown> };
      if (msg.type === "ready") {
        this.active.set(packageId, { error: null });
        return;
      }
      if (msg.type === "toolResult" && msg.id !== undefined) {
        const p = this.l3ToolPending.get(String(msg.id));
        if (!p) return;
        this.l3ToolPending.delete(String(msg.id));
        if (msg.ok) p.resolve(String(msg.data ?? ""));
        else p.reject(new Error(msg.error ?? "L3 工具错误"));
        return;
      }
      if (msg.type === "cap" && msg.cap) {
        void (async () => {
          if (!perms.has(msg.cap!)) {
            reply({ type: "capResult", id: msg.id, ok: false, error: `permission denied: ${msg.cap}` });
            return;
          }
          try {
            const data = await this.dispatchCapability(packageId, msg.cap!, msg.method ?? "", msg.args ?? {}, channel, disposables);
            reply({ type: "capResult", id: msg.id, ok: true, data });
          } catch (e) {
            reply({ type: "capResult", id: msg.id, ok: false, error: (e as Error).message });
          }
        })();
      }
    });

    channel.onExit((code) => {
      // 崩溃隔离：子进程退出 → 该包注册面全部回收
      for (const d of this.disposables.get(packageId) ?? []) {
        try {
          d();
        } catch {
          /* ignore */
        }
      }
      this.disposables.delete(packageId);
      this.active.set(packageId, { error: code !== 0 ? `L3 进程异常退出（码 ${code}）` : null });
    });

    reply({
      type: "init",
      packageId,
      permissions,
      workDir: this.currentRepo ?? "",
      sdkDir: this.deps.sdkDir ?? "",
    });
  }

  private async dispatchCapability(
    packageId: string,
    cap: string,
    method: string,
    args: Record<string, unknown>,
    channel: L3Channel,
    disposables: (() => void)[],
  ): Promise<unknown> {
    switch (cap) {
      case "storage":
        if (method === "get") return this.deps.storage.getKey(packageId, String(args.key ?? ""));
        if (method === "set") {
          this.deps.storage.set(packageId, String(args.key ?? ""), args.value);
          return null;
        }
        throw new Error(`未知 storage 方法 ${method}`);
      case "notify":
        this.deps.notify(String(args.title ?? ""), String(args.body ?? ""));
        return null;
      case "events": {
        if (method !== "subscribe") throw new Error(`未知 events 方法 ${method}`);
        const event = String(args.event ?? "");
        const off = this.deps.events.on(event, packageId, (payload) => channel.send({ type: "event", event, payload }));
        disposables.push(off);
        return null;
      }
      case "git.read": {
        const wd = this.currentRepo ?? process.env.USERPROFILE ?? ".";
        if (method === "status") return (await tryGit(wd, ["status", "--porcelain"])).stdout;
        if (method === "log") return (await tryGit(wd, ["log", "--oneline", "-n", String(Number(args.limit) || 5)])).stdout;
        if (method === "branches") return (await tryGit(wd, ["branch", "--list"])).stdout;
        throw new Error(`未知 git.read 方法 ${method}`);
      }
      case "tools": {
        if (method !== "register") throw new Error(`未知 tools 方法 ${method}`);
        const plain = String(args.name ?? "");
        const fullName = `ext.${packageId}.${plain}`;
        const permission = args.permission === "write:gate" ? "write:gate" : "read";
        this.deps.tools.register(
          {
            name: fullName,
            description: String(args.description ?? ""),
            permission,
            execute: async (toolArgs, toolCtx) => {
              if (permission === "write:gate" && !(await toolCtx.requestApproval(`插件工具 ${fullName}`))) {
                return "denied by human gate";
              }
              const r = await new Promise<unknown>((resolve, reject) => {
                const id = `t${this.l3ToolSeq++}`;
                const timer = setTimeout(() => {
                  if (this.l3ToolPending.has(id)) {
                    this.l3ToolPending.delete(id);
                    reject(new Error("L3 工具执行超时"));
                  }
                }, 30000);
                this.l3ToolPending.set(id, {
                  resolve: (v) => {
                    clearTimeout(timer);
                    resolve(v);
                  },
                  reject: (e) => {
                    clearTimeout(timer);
                    reject(e);
                  },
                });
                channel.send({ type: "toolCall", id, name: plain, args: toolArgs });
              });
              return String(r);
            },
          },
          "plugin",
          packageId,
        );
        disposables.push(() => this.deps.tools.unregisterByPackage(packageId));
        return null;
      }
      case "webview": {
        if (method !== "register") throw new Error(`未知 webview 方法 ${method}`);
        const key = `${packageId}/${String(args.id ?? "view")}`;
        this.views.set(key, { owner: packageId, title: String(args.title ?? "view"), html: String(args.html ?? "") });
        disposables.push(() => this.views.delete(key));
        return null;
      }
      case "statusbar": {
        if (method !== "register") throw new Error(`未知 statusbar 方法 ${method}`);
        const key = `${packageId}/${String(args.id ?? "item")}`;
        this.statusItems.set(key, {
          owner: packageId,
          text: String(args.text ?? ""),
          tooltip: typeof args.tooltip === "string" ? args.tooltip : undefined,
          command: typeof args.command === "string" ? args.command : undefined,
        });
        disposables.push(() => this.statusItems.delete(key));
        return null;
      }
      default:
        throw new Error(`未知能力 ${cap}`);
    }
  }

  /** 提交对话框区块（ui.commitBlocks RPC：单块失败跳过）。 */
  async resolveCommitBlocks(info: { message: string; files: number }): Promise<{ packageId: string; text: string }[]> {
    const out: { packageId: string; text: string }[] = [];
    for (const b of this.commitBlocks) {
      try {
        const r = await b.fn({ ...info });
        if (typeof r === "string" && r.trim()) out.push({ packageId: b.owner, text: r });
      } catch { /* 单块失败跳过 */ }
    }
    return out;
  }

  /** diff 侧栏注记（diff.notes RPC：单注记失败跳过）。 */
  async resolveDiffNotes(filePath: string): Promise<{ packageId: string; text: string }[]> {
    const out: { packageId: string; text: string }[] = [];
    for (const n of this.diffNotes) {
      try {
        const r = await n.fn(filePath);
        if (typeof r === "string" && r.trim()) out.push({ packageId: n.owner, text: r });
      } catch { /* 单注记失败跳过 */ }
    }
    return out;
  }

  /** webview 视图产物（ui.views RPC：静态 HTML，渲染层 sandbox iframe 无脚本）。 */
  listViews(): { id: string; title: string; html: string; packageId: string }[] {
    return [...this.views.entries()].map(([id, v]) => ({ id, title: v.title, html: v.html, packageId: v.owner }));
  }

  /** 面板插槽产物（ui.panels RPC：解析正文，单面板失败不拖累其它）。 */
  async resolvePanels(repo: string | null): Promise<{ id: string; title: string; body: string }[]> {
    const out: { id: string; title: string; body: string }[] = [];
    for (const [id, p] of this.panels) {
      try {
        out.push({ id, title: p.title, body: await p.body({ repo }) });
      } catch (e) {
        out.push({ id, title: p.title, body: `（面板出错：${(e as Error).message}）` });
      }
    }
    return out;
  }

  /** 状态栏插槽产物（ui.statusItems RPC）。 */
  listStatusItems(): { id: string; text: string; tooltip?: string; command?: string; packageId: string }[] {
    return [...this.statusItems.entries()].map(([key, v]) => ({
      id: key, text: v.text, tooltip: v.tooltip, command: v.command, packageId: v.owner,
    }));
  }

  status(): PackageHostStatus[] {
    return [...this.active.entries()].map(([packageId, s]) => ({ packageId, active: !s.error, error: s.error }));
  }

  /** log.query 后处理：装饰器追加 decorations（只读，不能改 commit 本体）。 */
  applyDecorations<T extends { sha: string; subject: string; author: string; body: string; decorations?: Decoration[] }>(commits: T[]): void {
    if (this.decorators.length === 0) return;
    for (const c of commits) {
      const out: Decoration[] = [...(c.decorations ?? [])];
      for (const d of this.decorators) {
        try {
          const r = d.fn(c);
          if (r) out.push(...r);
        } catch { /* 单装饰器失败跳过 */ }
      }
      if (out.length > 0) c.decorations = out;
    }
  }

  findPreviewProvider(filePath: string): PreviewProvider | null {
    const ext = path.extname(filePath).toLowerCase();
    for (const p of this.previewProviders) {
      if (p.exts.has(ext)) return p.fn;
    }
    return null;
  }

  /** L2 扫描器合并（在数据包规则之后调用；L2 可返回 blocked——allowCode 门即审核渠道信任）。 */
  runScanners(files: ScannableFile[]): RuleFinding[] {
    if (this.scanners.length === 0) return [];
    const out: RuleFinding[] = [];
    for (const f of files) {
      for (const s of this.scanners) {
        try {
          const r = s.fn(f);
          if (r) out.push(...r);
        } catch { /* 单扫描器失败跳过 */ }
      }
    }
    return out;
  }

  /** 门禁咨询：返回否决原因列表（空 = 放行）。单钩子异常视为放行（不阻塞主流程）。 */
  async runGates(point: GatePoint, info: Record<string, unknown>): Promise<string[]> {
    const vetoes: string[] = [];
    for (const g of this.gates.filter((x) => x.point === point)) {
      try {
        const verdict = await g.fn({ ...info, repo: this.currentRepo });
        if (typeof verdict === "string" && verdict.trim()) vetoes.push(`${g.owner}: ${verdict.trim()}`);
      } catch (e) {
        console.warn(`[host] gate ${g.owner}@${point} 异常（放行）:`, (e as Error).message);
      }
    }
    return vetoes;
  }
}
