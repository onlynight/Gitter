import { registerBuiltinPages } from "./uiRegistry";

/**
 * 内置页面元数据自举（ui-pluginization-plan.md U1a）：
 * 图标（SVG/glyph）从 Shell.tsx NAV 表迁入——页面身份归属注册表，
 * Shell/App/快捷键只是注册表的消费者。settings 固定在侧栏底部（order 700）。
 */
registerBuiltinPages([
  { id: "projects", titleKey: "Nav_Projects", glyph: "\uE8B7", order: 10 },
  { id: "log", titleKey: "Nav_Log", svg: "M2 3h12v1.5H2V3zm0 4.25h8.5v1.5H2v-1.5zM2 11.5h12V13H2v-1.5z", order: 20 },
  { id: "changes", titleKey: "Nav_Changes", svg: "M2 4.25 5 8l-3 3.75V4.25zM6 3h1.5v10H6V3zm3 0h5a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9v-1.5h4.5v-7H9V3z", order: 30 },
  { id: "branches", titleKey: "Nav_Branches", svg: "M13.1 3.9a2.3 2.3 0 0 0-3.25 3.25l-.1.1a2.3 2.3 0 0 1-3.25 0L5.4 6.2a2.3 2.3 0 1 0-1.06 1.06l1.1 1.05a3.8 3.8 0 0 0 2.31 1.09v1.2a2.3 2.3 0 1 0 1.5 0V9.4a3.8 3.8 0 0 0 2.31-1.09l.1-.1a2.3 2.3 0 1 0 1.44-4.31z", order: 40 },
  { id: "tasks", titleKey: "Nav_Tasks", glyph: "\uE7C1", order: 50 },
  { id: "bash", titleKey: "Nav_Terminal", glyph: "\uE756", order: 60 },
  { id: "files", titleKey: "Nav_Files", glyph: "\uE8A5", order: 70 },
  // Office：表格网格（电子表格隐喻）——原先 E7C3 Page 与 files 的 E8A5 Document 轮廓几乎
  // 相同，侧栏里分不清哪个是 office；E786 同样不可用（图标字体缺字），故走 SVG。
  { id: "office", titleKey: "Nav_Office", svg: "M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9zm1.5 0v9h9v-9h-9zM7.25 3.5h1.5v9h-1.5zM3.5 7.25h9v1.5h-9z", order: 71 },
  // 用量：柱状图（token/turn 统计隐喻）——与任务页 E7C1、终端 E756 等字形项区分，故走 SVG。
  { id: "usage", titleKey: "Nav_Usage", svg: "M2 13.25h12v1.25H2v-1.25ZM3.25 8.5H5v3.25H3.25V8.5Zm4-4H9v7.25H7.25V4.5Zm4 2H13v5.25h-1.75V6.5Z", order: 72 },
  { id: "settings", titleKey: "Nav_Settings", glyph: "\uE713", order: 700 },
]);
