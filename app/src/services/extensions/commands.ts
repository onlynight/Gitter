import type { CommandDTO } from "../../shared/types";
import type { PackageStore } from "./store";

/**
 * 命令注册表（extension-system-v2.md §三 CommandReg / §九）：
 * 命令面板/右键菜单/快捷键的唯一数据源。内置命令以元数据自举（执行体留在渲染层，
 * 与现有 routeCommand 语义一致）；扩展包命令带宿主动作，经 L1 白名单在主进程执行。
 */

export interface CommandDef {
  id: string;
  /** i18n 键（内置命令），与 title 二选一 */
  titleKey?: string;
  title?: string;
  categoryKey?: string;
  category?: string;
  keyHint?: string;
  when?: "repoOpen";
  /** L1 受限命令的宿主动作 */
  action?: string;
  args?: unknown;
  packageId?: string;
}

/** L1 命令允许引用的宿主动作白名单（extension-system-v2.md §九：无代码覆盖 80% 场景）。 */
export const HOST_ACTIONS = new Set(["terminal.run", "shell.openPath"]);

/** 内置命令元数据——镜像 web/src/components/CommandPalette.tsx 的既有列表（执行体仍在渲染层）。 */
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
];

export class CommandRegistry {
  private cmds = new Map<string, CommandDef>();

  constructor(builtins: CommandDef[]) {
    for (const c of builtins) this.cmds.set(c.id, { ...c });
  }

  /** 从活跃扩展包装载 contributes.commands（id 加包前缀防冲突）。启停/导入/卸载后重跑。 */
  registerPackageCommands(store: PackageStore): void {
    for (const [id, c] of this.cmds) {
      if (c.packageId) this.cmds.delete(id);
    }
    for (const p of store.list()) {
      if (p.state !== "active" || !p.kindStates.commands) continue;
      const rec = store.find(p.id);
      if (!rec) continue;
      for (const c of rec.manifest.contributes.commands) {
        this.cmds.set(`ext.${rec.manifest.id}.${c.id}`, {
          id: `ext.${rec.manifest.id}.${c.id}`,
          title: c.title,
          category: rec.manifest.name,
          keyHint: c.keyHint ?? undefined,
          when: c.when ?? undefined,
          action: c.action,
          args: c.args,
          packageId: rec.manifest.id,
        });
      }
    }
  }

  list(): CommandDTO[] {
    return [...this.cmds.values()].map((c) => ({
      id: c.id,
      titleKey: c.titleKey,
      title: c.title,
      categoryKey: c.categoryKey,
      category: c.category,
      keyHint: c.keyHint,
      when: c.when,
      action: c.action,
      args: c.args,
      packageId: c.packageId,
    }));
  }

  /** L1 受限命令执行：白名单动作 + 由调用方注入的执行器（bridge execHostAction）。 */
  async execute(id: string, exec: (action: string, args: unknown) => Promise<void>): Promise<void> {
    const c = this.cmds.get(id);
    if (!c || !c.packageId || !c.action) {
      throw Object.assign(new Error(`命令不存在或不可由宿主执行：${id}`), { detail: "NOT_EXECUTABLE" });
    }
    if (!HOST_ACTIONS.has(c.action)) {
      throw Object.assign(new Error(`不允许的宿主动作：${c.action}`), { detail: "ACTION_FORBIDDEN" });
    }
    await exec(c.action, c.args);
  }
}
