import type * as monaco from "monaco-editor";

/**
 * Aura 语言 Monarch 语法（AuraLang VS Code 扩展的 Monarch 对位）。
 *
 * 背景：Aura 与 Kotlin 风格同源（结构体、协程、actor、空安全 `?.`/`?:`、标签循环、
 * 字符串插值、三引号原始字符串），因此 Monarch 定义以 Monaco 内置 Kotlin Monarch 为骨架，
 * 补入 Aura 专有关键字（extern/actor/object/companion/typealias/suspend/comptime/inline/
 * reified 等）与字面量（二进制 `0b`、字符字面量）。
 *
 * Token 命名遵循 Monaco 惯例（`keyword` / `string` / `comment` / `number` /
 * `type.identifier` / `annotation` / `delimiter`）；主题 tokenColors 由 filesMonaco.ts
 * buildTheme 统一映射（见 filesMonaco.ts EditorTheme.syntax）。
 *
 * 关键约束：**不设置 tokenPostfix**。Monarch 默认会把每个 token 追加 tokenPostfix，
 * 若设成 ".aura" 则规则里写的 `keyword` 会变成实际 token `keyword.aura`；而 buildTheme
 * 由 theme.syntax 产出的 IStandaloneThemeData rules 里只写了 `keyword` 等单名——
 * Monarch token 匹配是**精确字符串**（不认前缀），带 postfix 会让所有 token 都命中不到
 * 任何 rule，编辑器里一片默认色。语言区分靠 monaco.languages.register({id:"aura"})，
 * token 名不需要重复加后缀。参考：Monaco basic-languages 的 python/csharp 等定义也不设。
 *
 * 参考：tools/ide-extension/aura-vscode-extension/syntaxes/aura.tmLanguage.json
 * （TextMate 版本，供 Gitter diff 视图与 VS Code 使用；本文件是编辑器 Monarch 版本）。
 * 两者独立演进——上游 TextMate 新增关键字时需人工同步本文件。
 */

export const auraConf: monaco.languages.LanguageConfiguration = {
  wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
  comments: { lineComment: "//", blockComment: ["/*", "*/"] },
  brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
    { open: "`", close: "`" },
    { open: "/*", close: " */", notIn: ["string"] },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
    { open: "`", close: "`" },
    { open: "<", close: ">" },
  ],
  indentationRules: {
    increaseIndentPattern: /^.*( \{| \( | \bdo\b|\belse\b|\bwhen\b|\bfor\b|\bif\b|\bwhile\b|\btry\b|\bcatch\b|\bfinally\b|\bextern\b|\basync\b)/,
    decreaseIndentPattern: /^.*( \}| \))/,
  },
  folding: {
    markers: {
      start: /^\s*\/\/\s*(@region|BEGIN)\b/,
      end: /^\s*\/\/\s*(@endregion|END)\b/,
    },
  },
  onEnterRules: [
    {
      beforeText: /^\s*\/\/\s*[^*/].*$/,
      // monaco.languages.IndentAction.Indent = 1（此处避开 `import type` 不能当值用的限制）
      action: { indentAction: 1 as unknown as monaco.languages.IndentAction },
    },
  ],
};

export const auraLanguage: monaco.languages.IMonarchLanguage = {
  defaultToken: "",
  // 不设 tokenPostfix——见文件头注释。
  keywords: [
    "as", "as?", "is", "!is", "in", "!in", "to", "it",
    "break", "continue", "return", "throw", "when", "if", "else", "do", "while", "for",
    "try", "catch", "finally", "suspend", "async", "await",
    "true", "false", "null",
    "import", "package", "export", "public", "private", "internal", "protected",
    "val", "var", "const", "lazy", "mutable",
    "class", "interface", "enum", "object", "struct", "data", "sealed", "typealias",
    "fun", "operator", "infix", "inline", "noinline", "reified", "tailrec", "override",
    "abstract", "open", "final", "companion", "inner", "lateinit",
    "constructor", "property", "delegate", "receiver", "init",
    "get", "set", "by", "field", "param", "where", "out",
    "super", "this", "file", "type",
    // Aura 特有
    "actor", "comptime", "extern", "external", "defer", "select",
    "native", "box", "weak", "malloc", "free", "retain", "release",
    "value", "expect", "actual",
  ],
  builtinTypes: [
    "Any", "Nothing", "Unit",
    "Int", "Long", "Short", "Byte", "Char", "Float", "Double", "Boolean",
    "String", "CharSequence", "StringBuilder",
    "List", "MutableList", "Set", "MutableSet", "Map", "MutableMap",
    "IntArray", "LongArray", "DoubleArray", "FloatArray", "ByteArray", "CharArray",
    "Comparable", "Iterable", "Sequence", "Pair", "Triple", "Range", "Lazy",
    "Throwable", "Exception", "Error",
    "Actor", "Job",
  ],
  operators: [
    "+", "-", "*", "/", "%", "=", "==", "===", "!", "!=", "!==", "++", "--",
    "&&", "||", "->", "..", "as", "as?", "!!", "?.", "?:", "::",
    "@", ":", ";", ".", "(", ")", "{", "}", "[", "]", "<", ">", "|", "&", "^", "~",
    "<<", ">>", "<<=", ">>=", "+=", "-=", "*=", "/=", "%=",
  ],
  symbols: /[=><!~?:&|+\-*\/\^%]+/,
  escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
  digits: /\d+(_+\d+)*/,
  octalDigits: /[0-7]+(_+[0-7]+)*/,
  binaryDigits: /[0-1]+(_+[0-1]+)*/,
  hexDigits: /[0-9a-fA-F]+(_+[0-9a-fA-F]+)*/,
  tokenizer: {
    root: [
      // 大写开头的标识符视作类型（Kotlin Monarch 同款启发式）
      [/[A-Z][\w$]*/, "type.identifier"],
      // 标识符 / 关键字分派
      [
        /[a-zA-Z_$][\w$]*/,
        {
          cases: {
            "@keywords": "keyword",
            "@builtinTypes": "type.builtin",
            "@default": "identifier",
          },
        },
      ],
      { include: "@whitespace" },
      // 括号与尖括号（类型参数）
      [/[{}()\[\]]/, "@brackets"],
      [/<(?![>=])/, "@brackets"],
      // 运算符/分隔符
      [
        /@symbols/,
        {
          cases: {
            "@operators": "delimiter",
            "@default": "",
          },
        },
      ],
      // 注解（@Annotate 或 @Annotate(args)）
      [/@\s*[a-zA-Z_$][\w$]*(?=\s*\()/, "annotation", "@annotationArgs"],
      [/@\s*[a-zA-Z_$][\w$]*/, "annotation"],
      // 标签循环 outer@
      [/\w@/, "label"],
      // 数字字面量
      [/0x[0-9a-fA-F]+[Ll]?/, "number.hex"],
      [/0b[01]+[Ll]?/, "number.binary"],
      [/0o[0-7]+[Ll]?/, "number.octal"],
      [/(@digits)\.(@digits)([eE][\-+]?(@digits))?[fFdD]?/, "number.float"],
      [/(@digits)([eE][\-+]?(@digits))?[fFdD]?/, "number.float"],
      [/(@digits)[Ll]?/, "number"],
      [/[;,.]/, "delimiter"],
      // 字符串：三引号多行原始字符串（无插值）
      [/"""/, "string", "@rawString"],
      // 字符串：双引号（支持 ${expr} 与 $name 插值）
      [/"/, "string", "@string"],
      // 反引号字符串（Kotlin 转义标识符；Aura 兼容）
      [/`[^`\\]*(?:\\.[^`\\]*)*`/, "string.escape"],
      // 字符字面量
      [/'[^\\']'/, "string.char"],
      [/(')(@escapes)(')/, ["string.char", "string.escape", "string.char"]],
      [/'/, "string.invalid"],
    ],
    whitespace: [
      [/[ \t\r\n]+/, ""],
      [/\/\*\*(?!\/)/, "comment.doc", "@javadoc"],
      [/\/\*/, "comment", "@comment"],
      [/\/\/.*$/, "comment"],
    ],
    comment: [
      [/[^\/*]+/, "comment"],
      [/\/\*/, "comment", "@comment"],
      [/\*\/\s*$/, ""],
      [/\*\/\s*([^\s*]+[^\s]*)/, ""],
      [/\*\/\s*/, "comment", "@pop"],
      [/\*/, "comment"],
      [/[\s\S]/, "comment"],
    ],
    javadoc: [
      [/[^\/*]+/, "comment.doc"],
      [/\/\*/, "comment.doc", "@push"],
      [/\/\*/, "comment.doc.invalid"],
      [/\*\/\s*$/, ""],
      [/\*\/\s*([^\s*]+[^\s]*)/, ""],
      [/\*\/\s*/, "comment.doc", "@pop"],
      [/\*/, "comment.doc"],
      [/[\s\S]/, "comment.doc"],
      // KDoc 标签
      [/@\w+/, "annotation"],
    ],
    string: [
      // 字符串插值 ${expr}
      [/\$\{[^}]+\}/, { cases: { "@default": "string.interp" } }],
      // 单变量插值 $name
      [/\$[A-Za-z_][\w]*/, "string.interp"],
      [/[^\\$"]+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/"/, "string", "@pop"],
    ],
    rawString: [
      // 原始字符串无插值，三引号结束
      [/"""/, "string", "@pop"],
      [/[^"]+/, "string"],
      [/./, "string"],
    ],
    annotationArgs: [
      [/\(/, "delimiter", "@push"],
      [/\)/, "delimiter", "@pop"],
      [/@escapes/, "string.escape"],
      { include: "@root" },
    ],
  },
};
