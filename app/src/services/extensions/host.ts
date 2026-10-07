import * as path from "path";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const require_: NodeRequire = eval("require") as NodeRequire;
import { tryGit } from "../gitexec";
import { registerHarnessLoop, unregisterHarnessLoop } from "../agents/loop";
import { registerAiProvider, unregisterAiProvider } from "../ai";
import { agentToolCatalog, registerAgentTool, unregisterAgentToolsByPackage } from "../agents/registry";
import {
  registerPromptSection, unregisterPromptSectionsByPackage,
  registerContextCollector, unregisterContextCollectorsByPackage,
  registerCompactor, unregisterCompactorsByPackage,
  registerTurnHook, unregisterTurnHooksByPackage,
} from "../agents/seams";
import { registerSubagentPreset, unregisterSubagentPresetsByPackage } from "../agents/subagents";
import { z } from "zod";

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
  /** 注册 Agent 循环（§20.3.4 循环契约 v2：LoopOptions 统一契约 + services 只读代理面；<pkg>.<id> 命名空间） */
  registerLoop(id: string, impl: (o: import("../agents/loop").LoopOptions) => Promise<import("../agents/loop").LoopResult>): void;
  /** 注册 agent 工具（agent-harness-v4.md §14.4：与内置工具同一条入表路径；名称自动加 ext.<pkg>. 命名空间；权限缺省 each-time） */
  registerAgentTool(def: {
    id: string;
    description: string;
    parametersSchema?: unknown;
    permissionClass?: "auto" | "session" | "each-time";
    execute(args: Record<string, unknown>, ctx: { workDir: string; signal: AbortSignal }): Promise<string> | string;
  }): void;
  /** 注册系统提示词槽位贡献（§14.5：context/skills/addendum/output；identity/boundary 锁死不开放） */
  registerPromptSection(def: {
    id: string;
    slot: import("../agents/seams").PromptPublicSlot;
    order?: number;
    /** 静态文本或动态提供者（null = 本轮省略） */
    content?: string;
    provide?: (ctx: { worktreePath: string; repoPath: string | null; mode: string }) => Promise<string | null> | string | null;
  }): void;
  /** 注册仓库上下文采集器（§14.5：tokenBudget 预算感知；软失败） */
  registerContextCollector(def: {
    id: string;
    order?: number;
    tokenBudget?: number;
    collect(ctx: { worktreePath: string; repoPath: string | null }): Promise<string | null> | string | null;
  }): void;
  /** 注册子代理预设（§20.3.5：task 工具 mode 枚举扩展；tools ⊆ 注册表全集，编译期剔除） */
  registerSubagentPreset(def: {
    id: string;
    name: string;
    description?: string;
    tools?: string[];
    readonly?: boolean;
    addendum?: string;
    timeoutMs?: number;
  }): void;
  /** 注册 post-turn 钩子（§20.3.6：产物由宿主以 system-reminder 注入下一轮，cap 2000；pre-turn 不开放） */
  registerTurnHook(def: {
    id: string;
    order?: number;
    hook(info: { taskId: string; outcome: string; lastMessage: string | null; todoState: unknown[] | null }): Promise<string | null> | string | null;
  }): void;
  /** 注册压缩策略（§14.5：单槽覆盖——活跃非内置压缩器优先于 builtin.summarizer） */
  registerCompactor(def: {
    id: string;
    compact(input: {
      messages: unknown[]; contextWindow: number; systemEstTokens: number; model: unknown; signal?: AbortSignal;
    }): Promise<{ messages: unknown[]; record: { ts: string; removedCount: number; tokensBefore: number; tokensAfter: number; summary: string } } | null>;
  }): void;
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
        // §20.3.4 循环契约 v2：直注册统一注册表（LoopOptions 契约）；门/工具面由宿主 LoopOptions 注入
        const fullId = `ext.${packageId}.${loopId}`;
        registerHarnessLoop(fullId, impl as never);
        cleanup(() => unregisterHarnessLoop(fullId));
      },
      registerAgentTool: (def) => {
        const name = `ext.${packageId}.${def.id}`;
        const schema = def.parametersSchema instanceof z.ZodType ? def.parametersSchema : z.object({});
        registerAgentTool({
          name,
          description: def.description,
          parametersSchema: schema,
          permissionClass: def.permissionClass ?? "each-time",
          source: "plugin",
          execute: async (env, args) => {
            // 插件工具执行：workDir 锁 worktree；signal 透传；权限门已在 buildToolset 包装层生效
            return await def.execute(args, { workDir: env.worktreePath, signal: env.signal });
          },
        });
        cleanup(() => unregisterAgentToolsByPackage(`ext.${packageId}`));
      },
      registerPromptSection: (def) => {
        
        registerPromptSection({
          id: `ext.${packageId}.${def.id}`,
          slot: def.slot,
          order: def.order ?? 100,
          source: "package",
          packageId,
          content: def.content,
          provide: def.provide ? async (ctx) => await def.provide!(ctx) : undefined,
        });
        cleanup(() => unregisterPromptSectionsByPackage(packageId));
      },
      registerContextCollector: (def) => {
        
        registerContextCollector({
          id: `ext.${packageId}.${def.id}`,
          order: def.order ?? 100,
          tokenBudget: def.tokenBudget ?? 800,
          source: "package",
          packageId,
          collect: (ctx) => Promise.resolve(def.collect(ctx)),
        });
        cleanup(() => unregisterContextCollectorsByPackage(packageId));
      },
      registerSubagentPreset: (def) => {
        const known = new Set(agentToolCatalog().map((t) => t.name));
        const readonlyNames = new Set(agentToolCatalog().filter((t) => t.readonly).map((t) => t.name));
        const isReadonly = !!def.readonly;
        let tools = (def.tools ?? []).filter((t) => known.has(t));
        if (isReadonly) tools = tools.filter((t) => readonlyNames.has(t));
        registerSubagentPreset({
          id: `${packageId}/${def.id}`,
          name: def.name,
          description: def.description ?? "",
          tools: tools.length > 0 ? tools : null,
          readonly: isReadonly,
          addendum: def.addendum ?? "",
          timeoutMs: Math.min(Math.max(def.timeoutMs ?? 600_000, 30_000), 600_000),
        });
        cleanup(() => unregisterSubagentPresetsByPackage(packageId));
      },
      registerTurnHook: (def) => {
        registerTurnHook({
          id: `ext.${packageId}.${def.id}`,
          order: def.order ?? 100,
          source: "package",
          packageId,
          hook: (info) => Promise.resolve(def.hook(info)),
        });
        cleanup(() => unregisterTurnHooksByPackage(packageId));
      },
      registerCompactor: (def) => {
        
        registerCompactor({
          id: `ext.${packageId}.${def.id}`,
          source: "package",
          packageId,
          compact: def.compact as never,
        });
        cleanup(() => unregisterCompactorsByPackage(packageId));
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
