/**
 * 扩展名 → Monaco 语言 id（pages/filesMonaco 与 kit/DiffView 共用；原先在 filesMonaco，
 * DiffView 语法高亮迁移到渲染层 Monarch 分词后 kit 侧也需要该映射，pages 反向依赖
 * kit 不合适，故下沉到 libs。monaco 命名空间仍由 gitui.lib.monaco 提供，本模块零依赖）。
 *
 * ts/js/json/css/html 走语言服务（补全/校验），其余走 basic-languages 的 Monarch 语法。
 * 未命中回退 "plaintext"（无语法着色）。
 */
export const EXT_TO_LANG: Record<string, string> = {
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
  // AuraLang 生态（Monarch 定义在 web/src/libs/monarch/；Monarch 注册在 monacoLib.ts）
  ".aura": "aura", ".hat": "hat",
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
