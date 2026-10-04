# 代码高亮框架方案（分词 · 主题集成 · 插件与脚本）

> 状态：设计稿（未实施）
> 日期：2026-10-04
> 关联：`extension-package-framework.md`（.gpk 包容器 / Jint 脚本宿主）、`theme-framework.md`（Syntax.* 语法令牌）
> 设计目标：Diff 视图从"行级增删背景"升级到 **IDE 式 token 级代码着色**；高亮器是**插件**（内置 + .gpk 分发）；支持声明式规则与脚本语言开发；框架本体 C#，为后续 C# 强类型插件预留同一契约。

---

## 一、现状与差距

`DiffCanvas`（GitUI.Controls）按 hunk 画行：等宽字体 + 增删行背景 + 前缀符号，**文本单色**。TerminalParser 侧已有逐字符状态机经验可借鉴。差距：

1. 无分词层（token）；2. 颜色与语义脱钩（没有 keyword/string 等概念）；3. 无按语言扩展的入口；4. 大 diff 性能约束未规划着色开销。

## 二、总体架构

```
DiffCanvas / 未来代码视图
   │  行文本（+语言探测结果）
   ▼
HighlightPipeline（每行）
   ① HighlighterRegistry.Resolve(path/language)   ← 按扩展名选高亮器
   ② IHighlighter.TokenizeLine(line, state)       ← 内置声明式 / 脚本 / （预留）C# 插件
   ③ SyntaxStyleMap.Resolve(styleKey)             ← 语义样式键 → 颜色（活动主题提供）
   ④ 行内绘制：Canvas 逐 run 画前景色（背景色仍由增删语义负责）
```

**核心解耦**：高亮器只产出**语义样式键**（`keyword`/`string`/`comment`/`number`/`type`/`function`/`variable`/`operator`/`punctuation`），**不产生颜色**；颜色由活动主题的 `syntax` 段提供（theme-framework.md §四 theme.json）。因此：

- 换主题 = 换语法配色，高亮器零改动
- 新增高亮器 = 新增语言支持，主题零改动
- 深浅主题各有一套语法配色（深色 One Dark 系 / 亮色 VS Light 系为内置默认）

## 三、样式键与主题集成

样式键集合（首批 9 个，冻结后走 theme-framework.md 的令牌新增流程）：

```
Syntax.keyword  Syntax.string   Syntax.comment  Syntax.number
Syntax.type     Syntax.function Syntax.variable Syntax.operator
Syntax.punctuation      （+ Syntax.plain = 正文色，不单独配色）
```

- 内置深色基座默认值：keyword `#569CD6`、string/comment `#6A9955`、number `#B5CEA8`、type `#4EC9B0`、function `#DCDCAA`（VS 深色系）
- 内置亮色基座默认值：keyword `#0000FF`、string `#A31515`、comment `#008000`、number `#098658`、type/function `#263F8C`（VS 亮色系）
- 主题包可在 `syntax` 段覆盖任意键（如 One Dark 主题包给出自家配色）
- 未定义键 → 回退 `Text`；未知高亮器输出 → 整行 plain

## 四、高亮器插件模型

### 4.1 统一契约（C# 接口 = 脚本契约 = 未来强类型契约）

```csharp
public interface ISyntaxHighlighter {
    string Id { get; }                       // "builtin.csharp"
    string Language { get; }                 // "csharp"
    IReadOnlyList<string> Extensions { get; }// [".cs", ".csx"]
    HighlightResult TokenizeLine(string line, LineState? state);
}
public record HighlightResult(IReadOnlyList<SyntaxToken> Tokens, LineState? NextState);
public record SyntaxToken(int Start, int Length, string StyleKey);
```

- `state` 支持跨行结构（块注释、逐字字符串、heredoc）：行序处理时传递；diff 场景按文件缓存"每行起始 state"
- 契约**先冻结**：脚本（Phase 2）与未来 C# ALC 插件（Phase 3）实现同一形状

### 4.2 三类高亮器

| 类型 | 形态 | 覆盖 | 分发 |
|---|---|---|---|
| **内置声明式** | `highlighters.json`：规则 = 关键字表 + 正则顺序表（注释→字符串→数字→关键字→类型→标点） | C# / JSON / PowerShell / Markdown / XML（首批 5 种，够本仓库自举） | 内置包 |
| **脚本高亮器** | JS（Jint，`gitui.syntax.register`）+ 预留 Lua | 小众语言、实验语法 | .gpk（syntax kind） |
| **C# 强类型插件** | `AssemblyLoadContext`（可收集），实现 `ISyntaxHighlighter` | 复杂语言（真正 IDE 级） | .gpk（Phase 3） |

声明式规则示例（`syntax/highlighters.json`）：

```json
{
  "id": "builtin.powershell", "language": "powershell", "extensions": [".ps1", ".psm1"],
  "rules": [
    { "style": "comment",  "pattern": "#.*$" },
    { "style": "string",   "pattern": "\"(?:[^\"]|\"\")*\"|'(?:[^']|'')*'" },
    { "style": "number",   "pattern": "\\b0x[0-9A-Fa-f]+\\b|\\b\\d+(?:\\.\\d+)?\\b" },
    { "style": "type",     "pattern": "\\[[A-Z][A-Za-z0-9.]*\\]" },
    { "style": "keyword",  "keywords": ["function","if","elseif","else","foreach","in","return","try","catch","param","begin","process","end"] }
  ]
}
```

执行语义：规则**按声明顺序**从左到右扫描，命中即消费并继续；`keywords` 编译为 Trie。该模型每语言约 10~20 行 JSON，是第三方包最常用的形态。

### 4.3 注册与解析

- ExtensionHost 装载 syntax kind → `HighlighterRegistry`（扩展名→高亮器，**用户包覆盖内置**，同扩展名后者优先）
- 语言探测：优先文件扩展名；diff 内旧/新路径分别探测（重命名文件两侧可不同语言）
- 无匹配 → `NullHighlighter`（纯 plain，零开销）

## 五、渲染集成（DiffCanvas）

1. **着色为增量增强**：先按现状画行（背景/前缀/单色文本），高亮结果就绪后重画该行文本 run——**首帧不等待分词**
2. **缓存**：`(行文本哈希, 高亮器Id, 主题Id) → tokens` 的 LRU（默认 2000 行）；同一文件重渲染零成本
3. **异步**：`Channel` 化的行队列 + 单一后台分词任务（分词纯 CPU、无 UI 访问），结果回 UI 线程重绘；超长文件（>2000 行 diff）仅高亮可视区附近（滚动驱动）
4. **性能预算**：每行分词 ≤ 0.2ms（内置规则实测量级）；脚本高亮器超时由脚本宿主统一裁剪（extension-package-framework.md §5.2）
5. hunk 级暂存选择、增删背景、行号等**现有能力不变**——着色只替换"文本 run 的画刷序列"

## 六、分阶段计划

| 阶段 | 内容 | 验收 |
|---|---|---|
| P1 | 契约 + 内置声明式引擎 + 5 语言规则 + DiffCanvas run 绘制 + 缓存/异步 | 打开 .cs/.ps1 提交的 diff：关键字/字符串/注释着色正确；增删背景不冲突；diff 冒烟全绿 |
| P2 | 主题 syntax 段接入（深浅两套语法配色随主题切换） | 切换亮暗主题语法配色跟随；第三方主题包覆盖 syntax 生效 |
| P3 | Jint 脚本高亮器（.gpk syntax kind）+ 设置页管理 | 安装一个 JS 高亮器包，小众语言 diff 着色 |
| P4（预留） | C# ALC 强类型插件契约启用；跨行 state 全量（块注释跨 diff 行）；正则升级为 TextMate 兼容子集 | — |

## 七、验收标准

1. 本仓库自举：打开 `LogPage.cs` 或 `DiffCanvas.cs` 的提交 diff，关键字/类型/字符串/注释按主题着色，增删行背景与行号保持现状
2. 深浅主题切换，语法配色跟随（两套内置语法配色）
3. 禁用某高亮器 → 该语言回退纯文本，应用不闪退
4. 1000 行 diff 首帧 < 现状 +10%（着色异步补齐），滚动无明显卡顿
5. 脚本高亮器死循环/抛错 → 该行降级 plain + 包标记错误，宿主存活

## 八、风险

| 风险 | 对策 |
|---|---|
| Canvas 逐 run 绘制的性能回归 | 增量重绘 + 缓存 + 可视区优先；P1 就建性能基线对比 |
| 正则声明式的表达力上限（嵌套结构差） | 明确定位"diff 着色够用"；复杂语言走脚本/C# 插件路线；接口已统一 |
| 脚本插件质量参差 | 脚本宿主超时/沙箱 + 行级降级 plain |
| 与 TerminalCanvas ANSI 着色的概念混淆 | ANSI 着色是**终端语义**（转义序列驱动），本框架是**语言语义**（语法驱动），两套并存不合并 |
