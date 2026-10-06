import { call } from "./bridge/client";
import type { MenuDTO } from "./bridge/types";
import { getState, navigate, routeCommand, setState, t, type PageKey } from "./state/store";

/**
 * 命令执行唯一入口（extension-system-v2.md §九：面板/右键菜单/快捷键共用）。
 * 内置命令执行体留在渲染层（routeCommand 语义），带宿主动作的命令走 commands.exec
 * （A 阶段：首跑确认 + ${...} 模板在主进程插值）。
 */

function builtinRunner(id: string, repoPath: string | null): (() => void) | null {
  // R0-8：内置命令的归属页面由执行体显式给出（routeCommand 的 page 参数），不再前缀启发式
  const route = (cmd: string, page: PageKey) => () => routeCommand(cmd, page);
  switch (id) {
    case "repo.refresh": return () => window.dispatchEvent(new CustomEvent("gitter:refresh"));
    case "repo.newWindow": return () => void call("app.newWindow", { path: repoPath });
    case "commit": return route("changes.commit", "changes");
    case "commit.push": return route("changes.commitPush", "changes");
    case "changes.stageAll": return route("changes.stageAll", "changes");
    case "changes.unstageAll": return route("changes.unstageAll", "changes");
    case "branches.create": return route("branches.create", "branches");
    case "branches.checkout": return route("branches.checkout", "branches");
    case "branches.pull": return route("branches.pull", "branches");
    case "branches.pullRebase": return route("branches.pullRebase", "branches");
    case "branches.push": return route("branches.push", "branches");
    case "view.diffSide": return () => void import("./state/store").then((m) => m.updateSettings({ diffMode: "sideBySide" }));
    case "view.diffInline": return () => void import("./state/store").then((m) => m.updateSettings({ diffMode: "inline" }));
    case "view.themeSystem": return () => void import("./state/store").then((m) => m.updateSettings({ theme: "system" }));
    case "view.themeLight": return () => void import("./state/store").then((m) => m.updateSettings({ theme: "light" }));
    case "view.themeDark": return () => void import("./state/store").then((m) => m.updateSettings({ theme: "dark" }));
    default: return null;
  }
}

export interface RunContext {
  /** ${file.path} 模板取值（文件右键菜单场景） */
  filePath?: string | null;
}

export interface RunnableCommand {
  id: string;
  titleKey?: string;
  title?: string;
  action?: string;
}

/** 命令不存在渲染层执行体时的兜底：交给宿主 commands.exec。 */
export async function runCommand(cmd: RunnableCommand, ctx?: RunContext): Promise<void> {
  const { id } = cmd;
  if (id.startsWith("goto.")) {
    navigate(id.slice(5) as PageKey);
    return;
  }
  const runner = builtinRunner(id, getState().repo?.workDir ?? null);
  if (runner) {
    runner();
    return;
  }
  if (!cmd.action) return; // 纯渲染层命令无执行体（不应发生）
  const r = await call<{ status: "ok" } | { status: "confirm-required"; id: string; title: string; titleKey?: string }>("commands.exec", {
    id,
    filePath: ctx?.filePath ?? null,
  });
  if (r.status === "confirm-required") {
    setState({
      commandConfirm: { id, title: r.titleKey ? t(r.titleKey) : r.title || id, filePath: ctx?.filePath ?? null },
    });
  }
}

/** menus.list 接缝 → 右键菜单项（页面把返回值追加进本地菜单数组）。 */
export async function seamMenuItems(location: MenuDTO["location"], filePath?: string | null): Promise<{ label: string; action: () => void }[]> {
  try {
    const items = await call<MenuDTO[]>("menus.list", { location, lang: getState().i18n?.lang ?? "en", fileSelected: !!filePath });
    return items.map((m) => ({ label: m.title, action: () => void runCommand({ id: m.command, title: m.title }, { filePath }) }));
  } catch {
    return []; // 桥不可用（纯浏览器调试）时无包菜单
  }
}
