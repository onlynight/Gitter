/**
 * Monaco 库访问面（页面包拆分方案 S3）：monaco-editor 不再打进 gitui.page.files/page.js，
 * 由 gitui.lib.monaco 库包提供（window.GITTER_LIBS.monaco，页装载器按 manifest
 * dependencies 先于页面 entry 注入）。页面构建经 build-pages.mjs 的 ^monaco-editor$
 * 精确 alias 指向本模块——页面源码保持 `import * as monaco from "monaco-editor"`
 * 零改动（tsc 仍对 node_modules 真实 monaco 类型做检查，本模块只在运行时被消费）。
 *
 * 本模块以命名导出铺开 monaco 的顶层命名空间投影：页面用到新的顶层成员时在此
 * 追加导出名——缺失成员会在下方断言处显式抛错（库版本变化/漏铺），不会静默 undefined。
 */
const lib = (window as unknown as { GITTER_LIBS?: Record<string, unknown> }).GITTER_LIBS?.monaco as
  | typeof import("monaco-editor")
  | undefined;
if (!lib) {
  throw new Error("GITTER_LIBS.monaco 未注册——gitui.lib.monaco 库未装载（loader 依赖序保证不应发生）");
}
const NAMESPACE_MEMBERS = [
  "editor", "languages", "Uri", "Position", "Range", "Selection", "Token",
  "KeyCode", "KeyMod", "MarkerSeverity", "MarkerTag",
] as const;
for (const k of NAMESPACE_MEMBERS) {
  if (!(k in lib)) throw new Error(`GITTER_LIBS.monaco 缺少顶层成员 ${k}——monacoLibAccess 导出面需跟进（库版本变化？）`);
}
export default lib;
export const editor = lib.editor;
export const languages = lib.languages;
export const Uri = lib.Uri;
export const Position = lib.Position;
export const Range = lib.Range;
export const Selection = lib.Selection;
export const Token = lib.Token;
export const KeyCode = lib.KeyCode;
export const KeyMod = lib.KeyMod;
export const MarkerSeverity = lib.MarkerSeverity;
export const MarkerTag = lib.MarkerTag;
