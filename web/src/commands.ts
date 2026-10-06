import { call } from "./bridge/client";
import type { MenuDTO } from "./bridge/types";
import { getState, navigate, routeCommand, setState, t, type PageKey } from "./state/store";

/**
 * 命令执行唯一入口（extension-system-v2.md §九：面板/右键菜单/快捷键共用）。
 * 内置命令执行体留在渲染层（routeCommand 语义），带宿主动作的命令走 commands.exec
 * （A 阶段：首跑确认 + ${...} 模板在主进程插值）。
 */

function builtinRunner(id: string, repoPath: string | null): (() => void) | null {
  const route = (cmd: string) => () => routeCommand(cmd);
  switch (id) {
    case "repo.refresh": return () => window.dispatchEvent(new CustomEvent("gitter:refresh"));
    case "repo.newWindow": return () => void call("app.newWindow", { path: repoPath });
    case "commit": return route("changes.commit");
    case "commit.push": return route("changes.commitPush");
    case "changes.stageAll": return route("changes.stageAll");
    case "changes.unstageAll": return route("changes.unstageAll");
    case "branches.create": return route("branches.create");
    case "branches.checkout": return route("branches.checkout");
    case "branches.pull": return route("branches.pull");
    case "branches.pullRebase": return route("branches.pullRebase");
    case "branches.push": return route("branches.push");
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
