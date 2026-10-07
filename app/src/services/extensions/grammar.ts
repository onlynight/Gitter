import * as fs from "fs";
import * as path from "path";
import { Registry, parseRawGrammar, type IRawGrammar, type IRawTheme, type StateStack } from "vscode-textmate";
import { loadWASM, createOnigScanner, createOnigString } from "vscode-oniguruma";
import type { PackageStore } from "./store";
import type { TokenRun } from "../highlight";

/**
 * TextMate 语法高亮服务（extension-system-v2.md §七）：
 * vscode-textmate + vscode-oniguruma(WASM) 逐行分词（tokenizeLine2），
 * 颜色 = 二进制 metadata 的 foreground 索引 → registry.getColorMap()（monaco TokenMetadata 布局）。
 * 语法来源：内置 tm-grammars（node_modules 数据包，260 语言）+ 用户包 contributes.grammars。
 * 降级链（§七）：本服务返回 null（WASM 失败/无语法/异常）→ bridge 回退声明式引擎 → plain。
 */

// vscode-textmate 9.x EncodedTokenAttributes 布局（源码 getForeground = (0xFF0000 & m) >>> 15）
const FOREGROUND_OFFSET = 15;
const FOREGROUND_MASK = 0xff << FOREGROUND_OFFSET;

/** 文本量保险丝：超过则不走 TextMate（回退声明式），防止病态大输入。 */
const MAX_TEXT_CHARS = 2_000_000;

interface GrammarEntry {
  language: string;
  file: string;
}

/** 常用扩展名 → tm-grammars 语言名（该包元数据不带扩展名映射，按 diff 场景高频语言策划）。 */
const EXT_TO_GRAMMAR: Record<string, string> = {
  ".ts": "typescript", ".mts": "typescript", ".cts": "typescript", ".tsx": "tsx",
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".jsx": "jsx",
  ".py": "python", ".pyi": "python", ".rb": "ruby", ".go": "go", ".rs": "rust",
  ".java": "java", ".kt": "kotlin", ".kts": "kotlin", ".scala": "scala", ".swift": "swift",
  ".c": "c", ".h": "c", ".cpp": "cpp", ".cc": "cpp", ".cxx": "cpp", ".hpp": "cpp", ".hh": "cpp",
  ".cs": "csharp", ".php": "php", ".sh": "shellscript", ".bash": "shellscript", ".zsh": "shellscript",
  ".ps1": "powershell", ".psm1": "powershell", ".bat": "bat", ".cmd": "bat",
  ".yml": "yaml", ".yaml": "yaml", ".toml": "toml", ".json": "json", ".jsonc": "json",
  ".html": "html", ".htm": "html", ".css": "css", ".scss": "scss", ".less": "less",
  ".vue": "vue", ".svelte": "svelte", ".md": "markdown", ".markdown": "markdown",
  ".sql": "sql", ".lua": "lua", ".xml": "xml", ".xaml": "xml", ".csproj": "xml",
  ".props": "xml", ".targets": "xml", ".config": "xml", ".dart": "dart", ".pl": "perl",
  ".r": "r", ".m": "objective-c", ".groovy": "groovy", ".hs": "haskell",
  ".ex": "elixir", ".exs": "elixir", ".erl": "erlang", ".clj": "clojure", ".cljs": "clojure",
  ".ini": "ini", ".cfg": "ini", ".diff": "diff", ".patch": "diff", ".dockerfile": "dockerfile",
  "dockerfile": "dockerfile", "makefile": "makefile", ".graphql": "graphql", ".gql": "graphql",
  ".zig": "zig", ".nim": "nim", ".sol": "solidity", ".asm": "asm", ".f90": "fortran",
};

/** 主题 legacy syntax 语义键 → TextMate scope 选择器（extension-system-v2.md §七）。 */
const LEGACY_SCOPES: Record<string, string> = {
  keyword: "keyword",
  string: "string",
  comment: "comment",
  number: "constant.numeric",
  type: "entity.name.type",
  function: "entity.name.function",
  variable: "variable",
  operator: "keyword.operator",
  punctuation: "punctuation",
};

/** 由 ThemeStateDTO 构造 IRawTheme：优先 tokenColors，缺省用 syntax 语义键映射。 */
export function buildRawTheme(theme: {
  activeId: string | null;
  syntax: Record<string, string>;
  tokenColors?: { scope: string | string[]; settings: { foreground?: string; fontStyle?: string } }[] | null;
}): { theme: IRawTheme; signature: string } {
  const settings = theme.tokenColors?.length
    ? theme.tokenColors.map((tc) => ({ scope: tc.scope, settings: tc.settings }))
    : Object.entries(theme.syntax)
        .filter(([key, color]) => LEGACY_SCOPES[key] && typeof color === "string" && color.startsWith("#"))
        .map(([key, color]) => ({ scope: LEGACY_SCOPES[key], settings: { foreground: color } }));
  return {
    theme: { name: theme.activeId ?? "gitter-default", settings } as IRawTheme,
    signature: `${theme.activeId ?? "-"}:${settings.length}:${settings[0]?.settings.foreground ?? ""}`,
  };
}

export class GrammarService {
  /** WASM 每进程只装载一次；registry 可在包变更后重建 */
  private static onigReady: Promise<boolean> | null = null;

  private registry: Registry | null = null;
  private registryFailed = false;
  private themeSignature = "";
  private colorMap: string[] = [];
  private userGrammars = new Map<string, GrammarEntry>(); // 扩展名(带点小写) → 语法文件
  private scopeCache = new Map<string, string | null>(); // 语法文件 → scopeName
  private builtinScopeIndex: Map<string, string> | null = null; // scopeName → 文件（惰性全量索引，供嵌入式语法 include）

  constructor(
    private readonly store: PackageStore,
    private readonly builtinGrammarRoot: string, // tm-grammars/grammars 目录（require.resolve 探测，空串 = 无内置）
    private readonly onigWasmPath: string, // vscode-oniguruma/release/onig.wasm
  ) {}

  /** 包导入/卸载/启停后调用：清用户语法表 + 重建 registry（语法缓存随 registry 一并作废）。 */
  reset(): void {
    this.registerUserGrammars();
    this.registry = null;
    this.registryFailed = false;
    this.themeSignature = "";
  }

  private static async initOnig(wasmPath: string): Promise<boolean> {
    if (!GrammarService.onigReady) {
      GrammarService.onigReady = (async () => {
        try {
          const buf = fs.readFileSync(wasmPath);
          // Buffer 可能落在池上：复制出独立 ArrayBuffer
          const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
          await loadWASM(ab);
          return true;
        } catch {
          return false;
        }
      })();
    }
    return GrammarService.onigReady;
  }

  private async ensureRegistry(): Promise<Registry | null> {
    if (this.registry) return this.registry;
    if (this.registryFailed) return null;
    if (!(await GrammarService.initOnig(this.onigWasmPath))) {
      this.registryFailed = true;
      return null;
    }
    try {
      const self = this;
      this.registry = new Registry({
        onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
        loadGrammar: async (scopeName) => self.loadGrammarByScope(scopeName),
      });
      this.themeSignature = ""; // 新 registry 必须重设主题
      return this.registry;
    } catch {
      this.registryFailed = true;
      return null;
    }
  }

  /** 从活跃扩展包收集用户语法（扩展名可能覆盖内置映射）。 */
  registerUserGrammars(): void {
    this.userGrammars.clear();
    for (const p of this.store.list()) {
      if (p.state !== "active" || !p.kindStates.grammar) continue;
      const rec = this.store.find(p.id);
      if (!rec) continue;
      for (const g of rec.manifest.contributes.grammars) {
        const file = path.join(rec.dir, g.path);
        if (!fs.existsSync(file)) continue;
        for (const ext of g.extensions) {
          this.userGrammars.set(ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`, {
            language: g.language,
            file,
          });
        }
      }
    }
  }

  private entryFor(filePath: string): GrammarEntry | null {
    const ext = path.extname(filePath).toLowerCase();
    const base = path.basename(filePath).toLowerCase();
    const user = this.userGrammars.get(ext) ?? this.userGrammars.get(base);
    if (user) return user;
    const name = EXT_TO_GRAMMAR[ext] ?? EXT_TO_GRAMMAR[base];
    if (!name || !this.builtinGrammarRoot) return null;
    const file = path.join(this.builtinGrammarRoot, `${name}.json`);
    return fs.existsSync(file) ? { language: name, file } : null;
  }

  private scopeOf(entry: GrammarEntry): string | null {
    if (this.scopeCache.has(entry.file)) return this.scopeCache.get(entry.file)!;
    let scope: string | null = null;
    try {
      const parsed = parseRawGrammar(fs.readFileSync(entry.file, "utf8"), entry.file);
      scope = parsed.scopeName ?? null;
    } catch {
      scope = null;
    }
    this.scopeCache.set(entry.file, scope);
    return scope;
  }

  /** 嵌入式语法（如 html include source.js）按 scopeName 找文件：用户包 → 内置惰性全量索引。 */
  private loadGrammarByScope(scopeName: string): Promise<IRawGrammar | null> {
    const find = (): string | null => {
      for (const [, entry] of this.userGrammars) {
        if (this.scopeOf(entry) === scopeName) return entry.file;
      }
      if (!this.builtinScopeIndex) {
        this.builtinScopeIndex = new Map();
        if (this.builtinGrammarRoot) {
          try {
            for (const f of fs.readdirSync(this.builtinGrammarRoot)) {
              if (!f.endsWith(".json")) continue;
              try {
                const g = JSON.parse(fs.readFileSync(path.join(this.builtinGrammarRoot, f), "utf8"));
                if (typeof g.scopeName === "string") this.builtinScopeIndex.set(g.scopeName, path.join(this.builtinGrammarRoot, f));
              } catch { /* 单文件损坏跳过 */ }
            }
          } catch { /* 目录不可读 */ }
        }
      }
      return this.builtinScopeIndex.get(scopeName) ?? null;
    };
    const file = find();
    if (!file) return Promise.resolve(null);
    try {
      return Promise.resolve(parseRawGrammar(fs.readFileSync(file, "utf8"), file));
    } catch {
      return Promise.resolve(null);
    }
  }

  /**
   * TextMate 高亮入口。返回 null = 本服务不处理（无语法/WASM 不可用/异常），
   * 调用方沿降级链回退。theme 每次调用随 ThemeState 下发，主题切换即时生效。
   */
  async highlight(
    filePath: string,
    text: string,
    theme: { theme: IRawTheme; signature: string },
  ): Promise<{ language: string; lines: TokenRun[][] } | null> {
    const entry = this.entryFor(filePath);
    if (!entry || text.length > MAX_TEXT_CHARS) return null;
    const registry = await this.ensureRegistry();
    if (!registry) return null;
    try {
      const scope = this.scopeOf(entry);
      if (!scope) return null;
      if (theme.signature !== this.themeSignature) {
        registry.setTheme(theme.theme);
        this.colorMap = registry.getColorMap();
        this.themeSignature = theme.signature;
      }
      const grammar = await registry.loadGrammar(scope);
      if (!grammar) return null;

      const out: TokenRun[][] = [];
      let stack: StateStack | null = null;
      for (const line of text.split("\n")) {
        const r = grammar.tokenizeLine2(line, stack);
        stack = r.ruleStack;
        const runs: TokenRun[] = [];
        const count = r.tokens.length >> 1;
        for (let i = 0; i < count; i++) {
          const start = r.tokens[2 * i];
          const end = i + 1 < count ? r.tokens[2 * (i + 1)] : line.length;
          if (end <= start) continue;
          // index 0 为主题保留位（无规则命中），视为无色
          const fg = (r.tokens[2 * i + 1] & FOREGROUND_MASK) >>> FOREGROUND_OFFSET;
          const color = fg > 0 ? this.colorMap[fg] : undefined;
          const last = runs[runs.length - 1];
          if (last && last.color === color && last.end === start) {
            last.end = end; // 相邻同色合并，减少 run 数
          } else {
            runs.push({ start, end, style: color ? "tm" : "plain", color });
          }
        }
        out.push(runs);
      }
      return { language: entry.language, lines: out };
    } catch {
      return null; // 降级链：任何异常 → 声明式回退
    }
  }
}
