import * as fs from "fs";
import * as path from "path";
import type { CommandDTO, MenuDTO } from "../../shared/types";
import type { PackageStore } from "./store";

/**
 * 命令注册表（extension-system-v2.md §三/§九/§16.6 阶段 A）：
 * 命令面板/右键菜单/快捷键的唯一数据源。内置命令以元数据自举（执行体留在渲染层，
 * 带宿主动作的内置命令走 commands.exec）；扩展包命令经 L1 白名单在主进程执行。
 * A 阶段接缝：%key% i18n、when 表达式、${...} 参数模板、首跑确认、menus、keybindings。
 */

export type MenuLocation = "changesFile" | "branchRow" | "logRow";

export interface CommandDef {
  id: string;
  /** i18n 键（内置命令），与 title 二选一 */
  titleKey?: string;
  title?: string;
  categoryKey?: string;
  category?: string;
  keyHint?: string;
  /** when 表达式：空格分隔 AND，token ∈ {repoOpen, fileSelected, config:<key>}，"!" 前缀取反 */
  when?: string | null;
  /** L1 受限命令的宿主动作 */
  action?: string;
  args?: unknown;
  /** 首跑确认（缺省按动作决定：terminal.run = true） */
  confirm?: boolean;
  packageId?: string;
  /** L2 宿主运行时命令（host.ts 注册；manifest 重载不清除） */
  runtime?: boolean;
}

/** L1 命令允许引用的宿主动作白名单（§16.6 阶段 A：+shell.reveal/repo.refresh；
 * agent.task.* 由 AgentSessionManager 提供执行体，见 bridge.execHostAction）。 */
export const HOST_ACTIONS = new Set([
  "terminal.run", "shell.openPath", "shell.reveal", "repo.refresh",
  "agent.task.create", "agent.task.resume",
]);

/** 这些动作首跑必须确认（terminal.run 以用户权限执行任意 shell）。 */
const CONFIRM_DEFAULT_ACTIONS = new Set(["terminal.run"]);

const KNOWN_LANGS = new Set(["en", "zh-Hans"]);

/** 内置右键菜单项（自举：菜单走 menus 接缝引用内置命令，页面不再硬编码这两项）。 */
export const BUILTIN_MENUS: { location: MenuLocation; commandId: string; order: number }[] = [
  { location: "changesFile", commandId: "file.openInEditor", order: 100 },
  { location: "changesFile", commandId: "file.revealInExplorer", order: 101 },
];

export const BUILTIN_COMMANDS: CommandDef[] = [
  { id: "goto.projects", titleKey: "Cmd_GotoProjects", categoryKey: "Cat_Nav", keyHint: "Ctrl+1" },
  { id: "goto.log", titleKey: "Cmd_GotoLog", categoryKey: "Cat_Nav", keyHint: "Ctrl+2" },
  { id: "goto.changes", titleKey: "Cmd_GotoChanges", categoryKey: "Cat_Nav", keyHint: "Ctrl+3" },
  { id: "goto.branches", titleKey: "Cmd_GotoBranches", categoryKey: "Cat_Nav", keyHint: "Ctrl+4" },
  { id: "goto.tasks", titleKey: "Cmd_GotoTasks", categoryKey: "Cat_Nav", keyHint: "Ctrl+5" },
  { id: "goto.bash", titleKey: "Cmd_GotoTerminal", categoryKey: "Cat_Nav", keyHint: "Ctrl+6" },
  { id: "goto.settings", titleKey: "Cmd_GotoSettings", categoryKey: "Cat_Nav", keyHint: "Ctrl+7" },
  { id: "repo.refresh", titleKey: "Cmd_RefreshPage", categoryKey: "Cat_Repo", keyHint: "F5" },
  { id: "repo.newWindow", titleKey: "Cmd_NewWindow", categoryKey: "Cat_Repo" },
  { id: "commit", titleKey: "Cmd_Commit", categoryKey: "Cat_Commit", keyHint: "Ctrl+Enter", when: "repoOpen" },
  { id: "commit.push", titleKey: "Cmd_CommitPush", categoryKey: "Cat_Commit", when: "repoOpen" },
  { id: "changes.stageAll", titleKey: "Cmd_StageAll", categoryKey: "Cat_Commit", when: "repoOpen" },
  { id: "changes.unstageAll", titleKey: "Cmd_UnstageAll", categoryKey: "Cat_Commit", when: "repoOpen" },
  { id: "branches.create", titleKey: "Cmd_CreateBranch", categoryKey: "Cat_Branch", keyHint: "Ctrl+Shift+N", when: "repoOpen" },
  { id: "branches.checkout", titleKey: "Cmd_CheckoutBranch", categoryKey: "Cat_Branch", when: "repoOpen" },
  { id: "branches.pull", titleKey: "Cmd_Pull", categoryKey: "Cat_Sync", when: "repoOpen" },
  { id: "branches.pullRebase", titleKey: "Cmd_PullRebase", categoryKey: "Cat_Sync", when: "repoOpen" },
  { id: "branches.push", titleKey: "Cmd_Push", categoryKey: "Cat_Sync", when: "repoOpen" },
  { id: "view.diffSide", titleKey: "Cmd_DiffSideBySide", categoryKey: "Cat_View" },
  { id: "view.diffInline", titleKey: "Cmd_DiffInline", categoryKey: "Cat_View" },
  { id: "view.themeSystem", titleKey: "Cmd_ThemeSystem", categoryKey: "Cat_View" },
  { id: "view.themeLight", titleKey: "Cmd_ThemeLight", categoryKey: "Cat_View" },
  { id: "view.themeDark", titleKey: "Cmd_ThemeDark", categoryKey: "Cat_View" },
  // 带宿主动作的内置命令（${file.path} 由 commands.exec 执行期插值；右键菜单项经 menus 接缝暴露）
  { id: "file.openInEditor", titleKey: "Changes_OpenInEditor", categoryKey: "Cat_File", when: "fileSelected", action: "shell.openPath", args: { path: "${file.path}", editor: true } },
  { id: "file.revealInExplorer", titleKey: "Changes_RevealInExplorer", categoryKey: "Cat_File", when: "fileSelected", action: "shell.reveal", args: { path: "${file.path}" } },
];

// ---- when 表达式（A 阶段子集）----

export interface WhenContext {
  repoOpen: boolean;
  fileSelected: boolean;
  /** config:<key> 求值用的包配置（调用方注入，通常 = store.configOf） */
  configOf?: (packageId: string) => Record<string, unknown>;
}

/** when 表达式求值：未知 token 安全默认 false。 */
export function evaluateWhen(when: string | null | undefined, ctx: WhenContext, packageId?: string): boolean {
  if (!when || !when.trim()) return true;
  for (const raw of when.trim().split(/\s+/)) {
    const neg = raw.startsWith("!");
    const token = neg ? raw.slice(1) : raw;
    let val: boolean;
    if (token === "repoOpen") val = ctx.repoOpen;
    else if (token === "fileSelected") val = ctx.fileSelected;
    else if (token.startsWith("config:")) {
      const cfg = packageId ? ctx.configOf?.(packageId) : undefined;
      const v = cfg?.[token.slice("config:".length)];
      val = v === true || (typeof v === "string" && v.length > 0) || (typeof v === "number" && v !== 0);
    } else {
      val = false;
    }
    if (neg ? val : !val) return false;
  }
  return true;
}

// ---- ${...} 参数模板（A 阶段：config.<key> / repo.path / repo.branch / file.path）----

export function interpolateString(s: string, vars: Record<string, string>): string {
  return s.replace(/\$\{([^}]+)\}/g, (_, k) => vars[k.trim()] ?? "");
}

export function interpolateDeep<T>(value: T, vars: Record<string, string>): T {
  if (typeof value === "string") return interpolateString(value, vars) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => interpolateDeep(v, vars)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = interpolateDeep(v, vars);
    return out as unknown as T;
  }
  return value;
}

export class CommandRegistry {
  private cmds = new Map<string, CommandDef>();
  /** packageId → lang → key → text（包 i18n/<lang>.json） */
  private i18n = new Map<string, Record<string, Record<string, string>>>();
  private menus = new Map<string, { location: MenuLocation; commandId: string; order: number; packageId: string | null }>();
  private store: PackageStore | null = null;

  constructor(builtins: CommandDef[]) {
    for (const c of builtins) this.cmds.set(c.id, { ...c });
    for (const m of BUILTIN_MENUS) {
      this.menus.set(`builtin/${m.commandId}/${m.location}`, { location: m.location, commandId: m.commandId, order: m.order, packageId: null });
    }
  }

  /** 从活跃扩展包装载命令 + menus + keybindings + 包 i18n。启停/导入/卸载后重跑。 */
  registerPackageCommands(store: PackageStore): void {
    this.store = store;
    for (const [id, c] of this.cmds) {
      if (c.packageId && !c.runtime) this.cmds.delete(id);
    }
    for (const [key, m] of this.menus) {
      if (m.packageId) this.menus.delete(key);
    }
    this.i18n.clear();
    for (const p of store.list()) {
      if (p.state !== "active") continue;
      const rec = store.find(p.id);
      if (!rec) continue;
      const manifest = rec.manifest;
      // 包 i18n 目录（i18n/<lang>.json，仅识别 en / zh-Hans）
      const dicts: Record<string, Record<string, string>> = {};
      try {
        const i18nDir = path.join(rec.dir, "i18n");
        for (const f of fs.readdirSync(i18nDir)) {
          const lang = f.replace(/\.json$/i, "");
          if (!KNOWN_LANGS.has(lang) || !f.endsWith(".json")) continue;
          dicts[lang] = JSON.parse(fs.readFileSync(path.join(i18nDir, f), "utf8"));
        }
      } catch { /* 无 i18n 目录 */ }
      if (Object.keys(dicts).length > 0) this.i18n.set(manifest.id, dicts);

      if (!p.kindStates.commands) continue;
      for (const c of manifest.contributes.commands) {
        this.cmds.set(`ext.${manifest.id}.${c.id}`, {
          id: `ext.${manifest.id}.${c.id}`,
          title: c.title,
          category: manifest.name,
          keyHint: c.keyHint ?? undefined,
          when: c.when ?? undefined,
          action: c.action,
          args: c.args,
          confirm: c.confirm ?? undefined,
          packageId: manifest.id,
        });
      }
      // menus：引用本包命令（装载期校验命令存在）
      for (const m of manifest.contributes.menus) {
        const commandId = `ext.${manifest.id}.${m.command}`;
        if (!this.cmds.has(commandId)) continue;
        this.menus.set(`${manifest.id}/${m.command}/${m.location}`, {
          location: m.location, commandId, order: m.order, packageId: manifest.id,
        });
      }
      // keybindings：为包命令补 keyHint（不覆盖 manifest 显式 keyHint）
      for (const kb of manifest.contributes.keybindings) {
        const cmd = this.cmds.get(`ext.${manifest.id}.${kb.command}`);
        if (cmd && !cmd.keyHint) cmd.keyHint = kb.key;
      }
    }
  }

  /** %key% → 包 i18n 解析（lang → en → 原样）。 */
  private resolveTitle(c: CommandDef, lang: string): string {
    if (c.titleKey) return c.titleKey; // 内置 i18n 键由渲染层 t() 解析
    const t = c.title ?? c.id;
    const m = /^%(.+)%$/.exec(t);
    if (!m || !c.packageId) return t;
    const dicts = this.i18n.get(c.packageId);
    return dicts?.[lang]?.[m[1]] ?? dicts?.["en"]?.[m[1]] ?? t;
  }

  private whenCtx(opts?: { repoOpen?: boolean; fileSelected?: boolean }): WhenContext {
    return {
      repoOpen: opts?.repoOpen ?? false,
      fileSelected: opts?.fileSelected ?? false,
      configOf: (pid) => (this.store ? this.store.configOf(pid) : {}),
    };
  }

  /** 命令清单（i18n 解析 + when 求值；enabled 由宿主算好，渲染层不再自行判断）。 */
  list(opts?: { lang?: string; repoOpen?: boolean; fileSelected?: boolean }): CommandDTO[] {
    const lang = opts?.lang ?? "en";
    const ctx = this.whenCtx(opts);
    return [...this.cmds.values()].map((c) => ({
      id: c.id,
      titleKey: c.titleKey,
      title: c.titleKey ? undefined : this.resolveTitle(c, lang),
      categoryKey: c.categoryKey,
      category: c.category,
      keyHint: c.keyHint,
      when: c.when ?? null,
      action: c.action,
      args: c.args,
      packageId: c.packageId,
      confirm: c.confirm ?? (c.action ? CONFIRM_DEFAULT_ACTIONS.has(c.action) : false),
      enabled: evaluateWhen(c.when, ctx, c.packageId),
    }));
  }

  /** L2 宿主运行时命令（host.ts ctx.registerCommand）。 */
  registerRuntimeCommand(def: CommandDef): void {
    this.cmds.set(def.id, { ...def });
  }

  unregisterCommand(id: string): void {
    this.cmds.delete(id);
  }

  /** 指定位置的菜单项（when 已求值，按 order 排序）。 */
  menusList(location: MenuLocation, opts?: { lang?: string; repoOpen?: boolean; fileSelected?: boolean }): MenuDTO[] {
    const lang = opts?.lang ?? "en";
    const ctx = this.whenCtx(opts);
    return [...this.menus.values()]
      .filter((m) => m.location === location)
      .map((m) => ({ m, cmd: this.cmds.get(m.commandId) }))
      .filter((x): x is { m: { location: MenuLocation; commandId: string; order: number; packageId: string | null }; cmd: CommandDef } =>
        !!x.cmd && evaluateWhen(x.cmd.when, ctx, x.cmd.packageId ?? undefined))
      .map(({ m, cmd }) => ({
        id: m.commandId,
        location,
        title: this.resolveTitle(cmd, lang),
        command: m.commandId,
        order: m.order,
        packageId: m.packageId ?? undefined,
      }))
      .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  }

  /** L1 受限命令执行：白名单动作 + 首跑确认 + ${...} 模板插值（vars 由调用方按执行上下文组装）。 */
  async execute(
    id: string,
    exec: (action: string, args: unknown) => Promise<void>,
    opts?: {
      confirmed?: boolean;
      isConfirmed?: (id: string) => boolean;
      markConfirmed?: (id: string) => void;
      vars?: Record<string, string>;
    },
  ): Promise<{ status: "ok" } | { status: "confirm-required"; id: string; title: string; titleKey?: string }> {
    const c = this.cmds.get(id);
    if (!c || !c.action) {
      throw Object.assign(new Error(`命令不存在或不可由宿主执行：${id}`), { detail: "NOT_EXECUTABLE" });
    }
    if (!HOST_ACTIONS.has(c.action)) {
      throw Object.assign(new Error(`不允许的宿主动作：${c.action}`), { detail: "ACTION_FORBIDDEN" });
    }
    const needConfirm = c.confirm ?? CONFIRM_DEFAULT_ACTIONS.has(c.action);
    if (needConfirm && !opts?.confirmed && !(opts?.isConfirmed?.(id) ?? false)) {
      return { status: "confirm-required", id, title: this.resolveTitle(c, "en"), titleKey: c.titleKey };
    }
    opts?.markConfirmed?.(id);
    const vars: Record<string, string> = { ...(opts?.vars ?? {}) };
    if (c.packageId && this.store) {
      for (const [k, v] of Object.entries(this.store.configOf(c.packageId))) {
        vars[`config.${k}`] = String(v);
      }
    }
    await exec(c.action, interpolateDeep(c.args ?? {}, vars));
    return { status: "ok" };
  }
}
