/**
 * 命令面适配（ui-full-pluginization-plan.md R2b）：
 * 页面源码 import "../commands" → 页面构建期映射到本模块。
 * seamMenuItems 经 GITTER_UI（menus.list + runCommand——首跑确认/模板插值/命令路由
 * 全在宿主命令注册表语义内），页面产物不打包宿主命令模块。
 */
import type { MenuDTO } from "../bridge/types";

/** menus.list 接缝 → 右键菜单项（页面把返回值追加进本地菜单数组）。 */
export async function seamMenuItems(location: MenuDTO["location"], filePath?: string | null): Promise<{ label: string; action: () => void }[]> {
  try {
    const g = window.GITTER_UI;
    if (!g) return [];
    const items = await g.call<MenuDTO[]>("menus.list", { location, lang: g.getState().i18n?.lang ?? "en", fileSelected: !!filePath });
    return items.map((m) => ({ label: m.title, action: () => void g.runCommand({ id: m.command, title: m.title }, { filePath }) }));
  } catch {
    return []; // 桥不可用（纯浏览器调试）时无包菜单
  }
}
