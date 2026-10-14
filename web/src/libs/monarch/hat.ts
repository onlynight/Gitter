import type * as monaco from "monaco-editor";

/**
 * HAT 语言 Monarch 语法（HIR-Advanced Text，AuraLang SSA IR v3.0）。
 *
 * HAT 是 AuraLang 编译器后端使用的 SSA 中间表示文本格式。语法要点：
 *  - `@` 前缀所有关键字/指令/结构体类型/函数名（`@fn`、`@call`、`@Point`）
 *  - `%` 前缀 SSA 值（`%r = @add $i32(%a, %b)`）
 *  - `$` 前缀基本类型（`$i32`、`$f64`、`$void`）
 *  - `!` 前缀特殊类型（`!ptr`、`!list<T>`、`!fn`）
 *  - `;` 起注释（元信息也走注释通道：`; module foo target ...`、`; @fn name`、`; bb label`）
 *
 * Token 命名走 Monaco 语义（`keyword` / `string` / `type.identifier` / `entity.name.function`
 * / `variable.other` / `constant.numeric` 等），由 filesMonaco.ts buildTheme 统一映射到
 * 活动主题 syntax 表。参考：tools/ide-extension/hat-vscode-extension/syntaxes/hat.tmLanguage.json
 * （TextMate 版本，用于 Gitter diff 视图与 VS Code）。两者独立演进。
 */

export const hatConf: monaco.languages.LanguageConfiguration = {
  wordPattern: /[\w$%!@!?.,:;(){}[\]<>+=\/-]+/,
  comments: { lineComment: ";" },
  brackets: [["(", ")"], ["[", "]"], ["{", "}"]],
  autoClosingPairs: [
    { open: "(", close: ")" },
    { open: "[", close: "]" },
    { open: "{", close: "}" },
  ],
  surroundingPairs: [
    { open: "(", close: ")" },
    { open: "[", close: "]" },
    { open: "{", close: "}" },
  ],
  indentationRules: {
    increaseIndentPattern: /^(?!;\s*$)(?!bb\s)/,
    decreaseIndentPattern: /^(?:;\s*)?bb\s+/,
  },
  folding: {
    markers: {
      start: /^(?:;\s*)?@fn\b/,
      end: /^(?:;\s*)?@fn\b/,
    },
  },
};

export const hatLanguage: monaco.languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".hat",
  // 声明关键字（`@fn` / `@extern` / `@struct` / `@enum`）
  declKeywords: ["fn", "extern", "struct", "enum"],
  // 终止指令
  terminators: ["br", "br_if", "ret", "return", "unreachable", "select"],
  // 调用/phi 指令
  callInstrs: ["call", "phi", "invoke"],
  // 常量指令
  constInstrs: [
    "i32_const", "i64_const", "f64_const", "f32_const",
    "const_str", "bool_const", "null", "true", "false",
  ],
  // 算术/位运算/比较
  arithInstrs: ["add", "sub", "mul", "div", "rem", "neg"],
  bitwiseInstrs: ["and", "or", "xor", "shl", "shr", "not"],
  cmpInstrs: ["icmp", "fcmp", "cmp", "eq", "ne", "lt", "le", "gt", "ge"],
  // 转换/内存/集合
  convInstrs: [
    "sext", "zext", "trunc", "fptosi", "sitofp", "uitofp",
    "fptrunc", "fpext", "bitcast", "ptrtoint", "inttoptr", "freeze",
  ],
  memInstrs: ["load", "store", "alloc", "alloca", "free", "getelementptr", "gep"],
  collInstrs: ["list", "cons", "head", "tail", "concat", "append", "slice", "len", "getfield", "setfield"],
  // 基本/用户类型（`@` 前缀分派时用）
  basicTypes: ["Int", "Float", "Bool", "Unit", "String", "Any", "Char", "Void"],
  tokenizer: {
    root: [
      // 空白
      [/[ \t]+/, ""],
      // 注释/元信息 —— 分派到专门状态处理结构；否则当普通注释。
      // 正则里的字面 `@` 必须写成 `[@]`：Monarch 编译期会把 `@词` 当属性引用替换，
      // 撞上未定义属性会在 setMonarchTokensProvider 时直接抛错，整库装载失败。
      [/;[ \t]*module\b/, "keyword.meta", "@moduleHeader"],
      [/;[ \t]*[@]fn\b/, "keyword.declaration", "@declLine"],
      [/;[ \t]*[@]extern\b/, "keyword.declaration", "@declLine"],
      [/;[ \t]*[@]struct\b/, "keyword.declaration", "@declLine"],
      [/;[ \t]*[@]enum\b/, "keyword.declaration", "@declLine"],
      [/;[ \t]*bb\b/, "keyword.declaration.bb"],
      [/;.*$/, "comment"],
      // 模块头（无 `;` 前缀形式：`module foo target x86_64-...`）
      [/module\s+[A-Za-z_][\w.]*/, "keyword.meta", "@moduleHeader"],
      // 类型定义（`@Point` 后跟括号内字段）
      [/@[A-Z][A-Za-z0-9_]*/, "storage.type.user", "@userType"],
      // 类型引用（在指令行内）
      [/\$[A-Za-z_][\w]*/, "type.builtin"],
      // 特殊类型（`!ptr` / `!list` / `!fn`）
      [/!list\b/, "type.special"],
      [/!map\b/, "type.special"],
      [/!ptr\b/, "type.special"],
      [/!fn\b/, "type.special"],
      [/!stackslot\b/, "type.special"],
      // 字符串
      [/"[^"\\]*(?:\\.[^"\\]*)*"/, "string.quoted.double"],
      // 数字
      [/0x[0-9a-fA-F]+/, "constant.numeric.hex"],
      [/0o[0-7]+/, "constant.numeric.octal"],
      [/0b[01]+/, "constant.numeric.binary"],
      [/-?\d+\.\d+(?:[eE][+-]?\d+)?/, "constant.numeric.float"],
      [/-?\d+/, "constant.numeric.integer"],
      // 布尔/字面
      [/true\b/, "constant.language"],
      [/false\b/, "constant.language"],
      [/null\b/, "constant.language"],
      // 值定义 `%r = ...`
      [/%[A-Za-z_][\w.]*/, "variable.other.def"],
      // `@` 前缀的关键字/指令/结构体（分派到各自 token）
      [
        /@[A-Za-z_][\w.]*/,
        {
          cases: {
            "@declKeywords": "keyword.declaration",
            "@terminators": "keyword.instruction.terminator",
            "@callInstrs": "keyword.instruction.call",
            "@constInstrs": "keyword.instruction.constant",
            "@arithInstrs": "keyword.instruction.arith",
            "@bitwiseInstrs": "keyword.instruction.bitwise",
            "@cmpInstrs": "keyword.instruction.cmp",
            "@convInstrs": "keyword.instruction.conv",
            "@memInstrs": "keyword.instruction.mem",
            "@collInstrs": "keyword.instruction.coll",
            // 大写开头：用户类型（属性名是 basicTypes，勿写成 builtin——cases 引用
            // 同样走 Monarch 属性解析，引用不存在会编译失败）
            "@basicTypes": "storage.type.user",
            // 其它 `@` 标识符：参数 / 字段 / 标签
            "@default": "variable.other.at",
          },
        },
      ],
      // 基本类型引用（`Int` / `Float` / ...）
      [/\b(Int|Float|Bool|Unit|String|Any|Char|Void)\b/, "type.builtin"],
      // 用户类型引用（`Point` / `Color`）
      [/[A-Z][A-Za-z0-9_]*/, "type.identifier"],
      // 分隔符
      [/[{}()\[\]]/, "@brackets"],
      [/->/, "keyword.other.arrow"],
      [/[=,;:.|&!+*/%<>^\\-]+/, "delimiter"],
    ],
    moduleHeader: [
      // `module foo target x86_64-linux-gnu`
      [/[A-Za-z_][\w.]*/, { cases: { "@default": "entity.name.type.module" } }],
      [/target\b/, "keyword.other.target"],
      [/[\w.-]+/, "string.unquoted"],
      [/;.*$/, "", "@pop"],
      [/.*$/, "", "@pop"],
    ],
    declLine: [
      // 声明行（`@fn name(args) -> ret` 或 `@struct @Point { ... }` 等）
      // 函数名（`@fn foo(` 或 `@extern bar(`）
      [/@?[A-Za-z_][\w.]*(?=\s*\()/, "entity.name.function"],
      // 参数（`@name: Type`）
      [/@[\w]+(?=\s*:)/, "variable.parameter"],
      // 箭头
      [/->/, "keyword.other.arrow"],
      // 类型
      [/\$[A-Za-z_][\w]*/, "type.builtin"],
      [/!list\b|!map\b|!ptr\b|!fn\b|!stackslot\b/, "type.special"],
      [/@[A-Z][A-Za-z0-9_]*/, "storage.type.user"],
      [/\b(Int|Float|Bool|Unit|String|Any|Char|Void)\b/, "type.builtin"],
      // 枚举成员（`@enum @Color { RED, GREEN, ... }`）
      [/[A-Z][A-Z0-9_]*/, "variable.other.enummember"],
      // 其它标识符
      [/\w+/, "identifier"],
      // 分隔符
      [/[{}()\[\]:,;=<>|&\-]+/, "delimiter"],
      // 空白
      [/[ \t]+/, ""],
      // 到行尾退出
      [/.*$/, "", "@pop"],
    ],
    userType: [
      // 类型体（字段/成员/方法列表），遇 `}` 退出
      [/\}/, "delimiter", "@pop"],
      [/[{}()\[\]:,;=<>|&\-]+/, "delimiter"],
      [/\$[A-Za-z_][\w]*/, "type.builtin"],
      [/!list\b|!map\b|!ptr\b|!fn\b|!stackslot\b/, "type.special"],
      [/@[A-Z][A-Za-z0-9_]*/, "storage.type.user"],
      [/@[a-z][\w]*/, "variable.other.field"],
      [/%[A-Za-z_][\w.]*/, "variable.other"],
      [/\w+/, "identifier"],
      [/[ \t]+/, ""],
    ],
  },
};
