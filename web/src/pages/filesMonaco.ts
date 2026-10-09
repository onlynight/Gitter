/**
 * Monaco 页面私有装配（inline-editor-plan.md §2.2/§2.3/§6.2）：
 * monaco-editor 作为 gitui.page.files 的私有依赖整包打进 page.js——不走 window.GITTER_KIT
 * 共享、不 external（Monaco 自带 worker 体系与独立 CSS，单页自治，其他页面零负担）。
 *
 * 全量入口：editor.main（编辑器 contrib + basic-languages Monarch + json/css/html/typescript
 * 语言服务）——智能提示/补全/校验开箱即用（TS/JS/JSON/CSS/HTML），不依赖外部 LSP；
 * 其余语言（Python/Go…）的 LSP 通道是 P3+ 可选增强（§4.5）。
 *
 * Worker：file:// + webSecurity 下 `new Worker(相对 URL)` 被同源策略拦截；
 * `?worker&inline` + `worker: { format: "iife" }`（build-pages.mjs）把五个 worker 编译为
 * base64 内联、运行期经 Blob URL 构造，无跨源问题（§8.3 风险裁决）。
 * 必须用 &inline：普通 `?worker` 会附带产出 assets/*.worker-*.js（~16MB 死重）。
 *
 * 主题：defineTheme 把宿主主题包 syntax 表（9 键，与 DiffView 同源）映射为 Monaco
 * token 规则；亮暗随 pageSdk.theme().base 切换（FilesMonacoEditor 订阅 useAppState 重应用）。
 */
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker&inline";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker&inline";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker&inline";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker&inline";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker&inline";
import { pageSdk } from "../pageSdk";

/** 宿主主题的页面侧结构投影（避免页面打包宿主 store 模块；字段语义同 ThemeStateDTO）。 */
interface EditorTheme {
  base?: string;
  /** 简化 token 名 → 颜色（app/src/services/themes.ts BUILTIN_SYNTAX 同源） */
  syntax?: Record<string, string>;
  /** 基础语义色（Text/Text2/Text3/Accent…） */
  tokens?: Record<string, string>;
}

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    switch (label) {
      case "json": return new jsonWorker();
      case "css": return new cssWorker();
      case "html": return new htmlWorker();
      case "typescript":
      case "javascript": return new tsWorker();
      default: return new editorWorker();
    }
  },
};

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

/** 创建编辑器实例（构造选项统一走 EDITOR_OPTIONS）。 */
export function createEditor(host: HTMLElement): monaco.editor.IStandaloneCodeEditor {
  return monaco.editor.create(host, EDITOR_OPTIONS);
}

/** 销毁文本模型（幂等）。 */
export function disposeTextModel(model: unknown | null): void {
  (model as { dispose?: () => void } | null)?.dispose?.();
}

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
