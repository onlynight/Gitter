/**
 * Monaco 页面装配（inline-editor-plan.md §2.3/§4.4；页面包拆分方案 S3 改造）：
 * monaco-editor 本体已拆为 gitui.lib.monaco 库包（window.GITTER_LIBS.monaco，
 * 由页装载器按 manifest dependencies 先于本页 entry 注入），本模块只做页面侧
 * 装配——TS 语言服务编译档、主题映射、扩展名→语言表、编辑器构造选项。
 * monaco 命名空间一律经 ../external/monacoLibAccess 访问面取用。
 *
 * Worker 装配（MonacoEnvironment + 五语言 worker）随 monaco 本体在库包内——
 * `?worker&inline` + Blob URL 的 file:// 约束由 gitui.lib.monaco/monaco.js 承接。
 *
 * 主题：defineTheme 把宿主主题包 syntax 表（9 键，与 DiffView 同源）映射为 Monaco
 * token 规则；亮暗随 pageSdk.theme().base 切换（FilesMonacoEditor 订阅 useAppState 重应用）。
 */
import * as monaco from "monaco-editor";
import { pageSdk } from "../pageSdk";

/** 宿主主题的页面侧结构投影（避免页面打包宿主 store 模块；字段语义同 ThemeStateDTO）。 */
interface EditorTheme {
  base?: string;
  /** 简化 token 名 → 颜色（app/src/services/themes.ts BUILTIN_SYNTAX 同源） */
  syntax?: Record<string, string>;
  /** 基础语义色（Text/Text2/Text3/Accent…） */
  tokens?: Record<string, string>;
}

// TS/JS 语言服务编译档：显式 bundler 解析（默认 classic 解不开 "./boot" 相对导入）+
// 宽松校验（编辑器不是 CI——类型噪音少些，补全照常）。model 挂真实 file URI 后
// 同仓库打开的文件互相可见，跨文件 import 由此解析。
const TS_COMPILER_OPTIONS: monaco.languages.typescript.CompilerOptions = {
  target: 99,          // Latest
  module: 99,          // ESNext
  // NodeJs 解析（追加 .ts 后缀找相对导入）；monaco 独立宿主下 Bundler 档无效
  moduleResolution: 2 as unknown as monaco.languages.typescript.ModuleResolutionKind,
  allowNonTsExtensions: true,
  allowJs: true,
  strict: false,
  noEmit: true,
  jsx: 1,              // Preserve
};
monaco.languages.typescript.typescriptDefaults.setCompilerOptions(TS_COMPILER_OPTIONS);
monaco.languages.typescript.javascriptDefaults.setCompilerOptions(TS_COMPILER_OPTIONS);
monaco.languages.typescript.typescriptDefaults.setEagerModelSync(true);
monaco.languages.typescript.javascriptDefaults.setEagerModelSync(true);
// 编辑器降噪：6133（声明未使用）不弹波浪线——编辑态不是 CI；跨文件相对导入的
// "Cannot find module"（2307）在 monaco 独立宿主下不可靠，工程级解析归 LSP（§4.5）
monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({ diagnosticCodesToIgnore: [6133] });
monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({ diagnosticCodesToIgnore: [6133] });

/** 编辑器视觉（inline-editor-plan.md §4.4 + P1 视觉基线：13px / 1.5 / 4 空格缩进；
 *  P4.2：多光标与平滑滚动手感显式固定，不随 Monaco 默认漂移）。 */
const EDITOR_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  fontSize: 13,
  lineHeight: 1.5 * 13,
  fontFamily: "'Cascadia Code', 'Fira Code', 'Cascadia Mono', Consolas, monospace",
  tabSize: 4,
  insertSpaces: true,
  minimap: { enabled: true },
  wordWrap: "off",
  scrollBeyondLastLine: false,
  automaticLayout: true,
  bracketPairColorization: { enabled: true },
  renderWhitespace: "selection",
  padding: { top: 8, bottom: 8 },
  // P4.2 多光标编辑体验：Alt+点击加光标 / Ctrl+Alt+↑↓ 加上下光标（Monaco 原生能力，
  // 这里只显式固定修饰键与动效——平滑光标/滚动、关闭无障碍层的高频 aria 重排）
  multiCursorModifier: "alt",
  cursorSmoothCaretAnimation: "on",
  smoothScrolling: true,
  accessibilitySupport: "off",
};

/**
 * 扩展名 → Monaco 语言 id。ts/js/json/css/html 走语言服务（补全/校验），
 * 其余走 basic-languages 的 Monarch 语法。未命中回退 "plaintext"（无语法着色）。
 */
const EXT_TO_LANG: Record<string, string> = {
  // JavaScript 生态（TS 语言服务：补全 + 诊断）
  ".ts": "typescript", ".tsx": "typescript",
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".jsx": "javascript",
  ".json": "json", ".jsonc": "json",
  // 样式与标记
  ".css": "css", ".scss": "css", ".less": "css",
  ".html": "html", ".htm": "html", ".vue": "html", ".svelte": "html",
  // C# 生态（app 侧 highlighters 覆盖面）
  ".cs": "csharp", ".csx": "csharp",
  ".xml": "xml", ".xaml": "xml", ".csproj": "xml", ".props": "xml", ".targets": "xml", ".config": "xml",
  // 脚本与系统
  ".ps1": "powershell", ".psm1": "powershell", ".psd1": "powershell",
  ".sh": "shell", ".bash": "shell", ".zsh": "shell",
  ".bat": "bat", ".cmd": "bat",
  ".py": "python",
  ".go": "go", ".rs": "rust", ".java": "java", ".kt": "kotlin",
  ".c": "c", ".h": "c", ".cpp": "cpp", ".hpp": "cpp", ".cc": "cpp",
  ".rb": "ruby", ".php": "php", ".swift": "swift", ".scala": "scala",
  // 标记与配置
  ".md": "markdown", ".markdown": "markdown",
  ".yml": "yaml", ".yaml": "yaml", ".toml": "ini", ".ini": "ini", ".cfg": "ini",
  ".properties": "ini", ".editorconfig": "ini",
  ".svg": "xml", ".sln": "ini",
  ".txt": "plaintext", ".log": "plaintext", ".gitignore": "plaintext",
};

/** 扩展名 → 语言 id（按最后一个点的后缀匹配；无后缀回退 plaintext）。 */
export function languageForPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "plaintext";
  const ext = base.slice(dot).toLowerCase();
  return EXT_TO_LANG[ext] ?? "plaintext";
}

const THEME_DARK = "gitter-dark";
const THEME_LIGHT = "gitter-light";

/** 由宿主主题构建 Monaco 主题（syntax 表 → token 规则；基础色随主题 token，files-editor-redesign-mockup.html §二）。 */
function buildTheme(theme: EditorTheme): monaco.editor.IStandaloneThemeData {
  const dark = theme.base !== "light";
  const rules: monaco.editor.IStandaloneThemeData["rules"] = [];
  const colors: Record<string, string> = {};

  // Monaco 0.5x 的 IStandaloneThemeData 只接受 ITokenThemeRule（token 字段）；
  // theme.syntax 已由主进程从 TextMate scope 聚合为 Monaco 同名简化 token（keyword/string/comment…）
  for (const [style, color] of Object.entries(theme.syntax ?? {})) {
    rules.push({ token: style, foreground: color });
  }

  // 底色/文字/行号/光标随宿主 token（原 #1e1e1e 硬编码会与主题 --c-base 脱节）；
  // 选区取 --c-link 叠 alpha（#RRGGBB → #RRGGBBAA），行高亮用中性叠加两主题通用
  colors["editor.background"] = theme.tokens?.Base ?? (dark ? "#0D0D0D" : "#FFFFFF");
  colors["editor.foreground"] = theme.tokens?.Text ?? (dark ? "#EAEAEA" : "#1B1B1B");
  colors["editor.lineHighlightBackground"] = dark ? "#ffffff0a" : "#0000000a";
  colors["editorLineNumber.foreground"] = theme.tokens?.Text3 ?? (dark ? "#6E6E6E" : "#8F8F8F");
  colors["editorLineNumber.activeForeground"] = theme.tokens?.Text2 ?? (dark ? "#A0A0A0" : "#5C5C5C");
  colors["editorCursor.foreground"] = theme.tokens?.Text ?? (dark ? "#EAEAEA" : "#1B1B1B");
  colors["editor.selectionBackground"] = theme.tokens?.Link
    ? theme.tokens.Link + "4D"
    : (dark ? "#264f7880" : "#cfe1f580");
  colors["editor.selectionHighlightBackground"] = theme.tokens?.Link
    ? theme.tokens.Link + "29"
    : (dark ? "#3a3f4b40" : "#cfe1f540");
  colors["editorWhitespace.foreground"] = dark ? "#6a6a6a40" : "#8f8f8f30";

  return { base: dark ? "vs-dark" : "vs", inherit: true, rules, colors };
}

/** 语言 id → 状态栏显示名（未命中回退语言 id 本身）。 */
const LANG_LABEL: Record<string, string> = {
  typescript: "TypeScript", javascript: "JavaScript", json: "JSON", css: "CSS", html: "HTML",
  csharp: "C#", xml: "XML", powershell: "PowerShell", shell: "Shell", bat: "Batch",
  python: "Python", go: "Go", rust: "Rust", java: "Java", kotlin: "Kotlin",
  c: "C", cpp: "C++", ruby: "Ruby", php: "PHP", swift: "Swift", scala: "Scala",
  markdown: "Markdown", yaml: "YAML", ini: "INI", plaintext: "Plain Text",
};
export function languageLabel(lang: string): string {
  return LANG_LABEL[lang] ?? lang;
}

/** Monaco 诊断计数（页脚「问题」段；model 为 null 返回全零）。 */
export function markerCounts(model: unknown | null): { errors: number; warnings: number } {
  const m = model as monaco.editor.ITextModel | null;
  if (!m) return { errors: 0, warnings: 0 };
  const markers = monaco.editor.getModelMarkers({ resource: m.uri });
  let errors = 0;
  let warnings = 0;
  for (const mk of markers) {
    if (mk.severity === monaco.MarkerSeverity.Error) errors++;
    else if (mk.severity === monaco.MarkerSeverity.Warning) warnings++;
  }
  return { errors, warnings };
}

/**
 * 幂等应用主题（主题状态变化时重定义同名主题 + setTheme）。
 * 宿主未注入（纯浏览器直开调试）时 theme() 抛错——回退默认暗色。
 */
export function applyMonacoTheme(theme: EditorTheme | null | undefined): void {
  const t: EditorTheme = theme ?? { base: "dark" };
  const name = t.base === "light" ? THEME_LIGHT : THEME_DARK;
  monaco.editor.defineTheme(name, buildTheme(t));
  monaco.editor.setTheme(name);
}

/** 创建文本模型（语言按扩展名推断；挂真实 file URI——TS 语言服务靠它跨文件解析 import）。
 * 调用方持有并负责 dispose；同 URI 已存在时复用（keep-alive 二次打开）。 */
export function createTextModel(path: string, value: string): monaco.editor.ITextModel {
  const uri = monaco.Uri.file(path.replace(/\\/g, "/"));
  return monaco.editor.getModel(uri) ?? monaco.editor.createModel(value, languageForPath(path), uri);
}

// ---- 视图状态（滚动/光标/选区）按 model.id 存取 ----
// 模块级而非编辑器组件实例级：预览↔编辑切换（md/html 及后续一切预览类）会卸载编辑器
// 实例由查看器接管画布，实例内 Map 随之蒸发——切回编辑就丢位置回到首行。提升到模块级
// 随页面存活，反复切换持续可恢复；model 销毁（关标签/重载）时经 disposeTextModel 清理。
const viewStates = new Map<string, monaco.editor.ICodeEditorViewState>();

/** 保存视图状态（编辑器卸载/换 model 前调用；同 id 覆盖为最新位置） */
export function saveViewState(model: monaco.editor.ITextModel, vs: monaco.editor.ICodeEditorViewState): void {
  viewStates.set(model.id, vs);
}

/** 取视图状态（编辑器挂载/换 model 后恢复；不删除——反复切换要持续可恢复） */
export function viewStateOf(model: monaco.editor.ITextModel): monaco.editor.ICodeEditorViewState | undefined {
  return viewStates.get(model.id);
}

/** 创建编辑器实例（构造选项统一走 EDITOR_OPTIONS；overrides 供字号恢复等实例级覆盖）。 */
export function createEditor(
  host: HTMLElement,
  overrides?: monaco.editor.IStandaloneEditorConstructionOptions,
): monaco.editor.IStandaloneCodeEditor {
  return monaco.editor.create(host, { ...EDITOR_OPTIONS, ...overrides });
}

/** 销毁文本模型（幂等）；视图状态随 model 一并清理（重开文件回首行是预期）。 */
export function disposeTextModel(model: unknown | null): void {
  const m = model as monaco.editor.ITextModel | null;
  if (m && typeof m.id === "string") viewStates.delete(m.id);
  (model as { dispose?: () => void } | null)?.dispose?.();
}

/** 任意 model 的 marker 变化（问题面板聚合刷新；不区分 resource）。 */
export function onAnyMarkers(cb: () => void): { dispose: () => void } {
  return monaco.editor.onDidChangeMarkers(() => cb());
}

/** 单 model 的 marker 列表（问题面板渲染用）。 */
export function markersOf(model: unknown): monaco.editor.IMarker[] {
  const m = model as monaco.editor.ITextModel | null;
  if (!m || m.isDisposed()) return [];
  return monaco.editor.getModelMarkers({ resource: m.uri });
}

/** model URI → 仓库相对路径（blame 悬停/问题面板定位用；createTextModel 挂的 file URI）。 */
export function pathOfModel(model: unknown): string | null {
  const m = model as monaco.editor.ITextModel | null;
  if (!m || m.isDisposed()) return null;
  try {
    return m.uri.path.replace(/^\/+/, "");
  } catch {
    return null;
  }
}

/**
 * 缩进探测（打开文件时按内容猜，页脚可再改）：扫前 200 行行首空白——
 * tab 占多 → Tab 缩进；否则 2/4 空格按多数决。
 */
export function detectIndent(text: string): { insertSpaces: boolean; tabSize: number } {
  let tabs = 0;
  let s2 = 0;
  let s4 = 0;
  for (const line of text.split("\n").slice(0, 200)) {
    if (/^\t+/.test(line)) tabs++;
    else if (/^ {2}/.test(line)) {
      if (/^ {4}/.test(line)) s4++;
      else s2++;
    }
  }
  if (tabs > s2 + s4) return { insertSpaces: false, tabSize: 4 };
  return { insertSpaces: true, tabSize: s4 >= s2 ? 4 : 2 };
}

// ---- blame 悬停（git 深度集成）：全语言 hover provider，git.blame 按文件缓存（30s TTL）----

interface BlameEntry {
  line: number;
  sha: string;
  author: string;
  time: number;
  summary: string;
}

const blameCache = new Map<string, { at: number; lines: BlameEntry[] }>();
const BLAME_TTL = 30_000;

function blameOfPath(path: string): BlameEntry[] {
  const hit = blameCache.get(path);
  if (hit && Date.now() - hit.at < BLAME_TTL) return hit.lines;
  void pageSdk.call<BlameLineDTO[]>("git.blame", { path })
    .then((lines) => {
      if (Array.isArray(lines)) blameCache.set(path, { at: Date.now(), lines });
    })
    .catch(() => { /* blame 不可用（空仓库/越界）：悬停静默无归属 */ });
  return hit?.lines ?? [];
}

/** git.blame 行 DTO（与 treex.BlameLine 同形，页面不 import 主进程类型） */
interface BlameLineDTO {
  line: number;
  sha: string;
  author: string;
  time: number;
  summary: string;
}

// 首次 hover 触发拉取，命中缓存后立即渲染；未提交行（全零 sha）不显示
monaco.languages.registerHoverProvider("*", {
  provideHover: (model, position) => {
    const path = pathOfModel(model);
    if (!path) return null;
    const lines = blameOfPath(path);
    if (lines.length === 0) return null;
    const info = lines[position.lineNumber - 1];
    if (!info || /^0+$/.test(info.sha)) return null;
    const when = info.time ? new Date(info.time * 1000).toLocaleDateString() : "";
    return {
      contents: [
        { value: `**${info.author || "?"}** · ${when} · \`${info.sha.slice(0, 7)}\`` },
        ...(info.summary ? [{ value: info.summary.replace(/[\n\r]/g, " ") }] : []),
      ],
    };
  },
});

// 初始主题：模块装载即应用（page.js 经典脚本 eval 时 GITTER_UI 已注入）
try {
  applyMonacoTheme(pageSdk.theme());
} catch {
  applyMonacoTheme(null);
}

// 调试/自动化接缝：e2e 与 harness 用它读 markers（诊断/波浪线断言），不进任何 UI 面
(window as unknown as { __gitterMonacoEditor: typeof monaco.editor }).__gitterMonacoEditor = monaco.editor;

export { EDITOR_OPTIONS };
export type { EditorTheme };
