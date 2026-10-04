# 扩展包框架方案（GitUI Extension Package / .gpk）

> 状态：实施中 —— P1/P2 已完成（按 kind 启停、.gpk 导入、卸载、设置页卡片，2026-10-04）；P3 脚本宿主待实施
> 日期：2026-10-04
> 关联：`theme-framework.md`（主题框架，第一个消费者）、`code-highlight-framework.md`（代码高亮框架，第二个消费者）、`command-palette-v2.md`
> 设计约束：**主题与代码高亮可以打包成一个包，也可以分开打包**；框架本体用 C# 开发，插件允许用脚本语言开发。

---

## 一、背景与现状

当前 GitUI 没有任何扩展机制：主题是编译进程序的 `ThemeStyles.xaml` + `UiKit.cs` 静态令牌；代码着色只有 DiffCanvas 的行级增删背景。要支持"亮暗主题抽象、主题可单独打包、代码高亮插件化"，三件事共享同一套底层设施——**包的容器格式、发现/安装/启停生命周期、脚本宿主**。本文定义这套共享底座；主题与高亮各自的数据模型见对应文档。

**非目标（本期不做）**：在线市场/自动更新；C# 强类型插件的运行时热加载（仅预留接口）；跨进程沙箱。

## 二、总体架构

```
┌────────────────────────────────────────────────────┐
│ GitUI.App（宿主）                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ ThemeService  │  │ HighlightSvc │  │ 后续扩展…  │ │   ← 各扩展种类的消费服务
│  └──────┬───────┘  └──────┬───────┘  └───────────┘ │
│         │  注册/读取        │                        │
│  ┌──────┴──────────────────┴───────────────┐        │
│  │        ExtensionHost（包管理器）          │        │   ← 本文定义
│  │  PackageStore · Manifest · ScriptHost    │        │
│  └──────┬───────────────────────────────────┘        │
│         │ 扫描/装载                                    │
│  ┌──────┴────────────┐  ┌─────────────────────┐     │
│  │ 内置包（随应用发布） │  │ 用户包目录            │     │
│  │ GitUI.Core/Packages│  │ %APPDATA%\GitUI\pkgs │     │
│  └───────────────────┘  └─────────────────────┘     │
└────────────────────────────────────────────────────┘
```

三层职责：

1. **扩展种类（Kind）**：`theme` / `syntax`（后续 `command`、`exporter`…）。每种 Kind 由对应消费服务定义数据模型与注册接口。
2. **ExtensionHost（本文）**：与种类无关的包生命周期——发现、校验、排序、启停、脚本宿主、隔离与降级。
3. **脚本宿主（本文）**：脚本语言插件（第一期 JavaScript/Jint）的运行环境与受限 API。

## 三、包容器格式（.gpk）

### 3.1 物理形态（三选一，等价）

| 形态 | 用途 |
|---|---|
| `.gpk` 文件（zip 容器） | 分发/安装单位 |
| 解包目录（含 `manifest.json`） | 开发调试；用户包目录直接放目录即可生效 |
| 内嵌资源（`GitUI.Core/Packages/`） | **内置包也走同一格式**（自举，避免两套代码路径） |

### 3.2 目录布局

```
com.example.mytheme.gpk (zip)
├── manifest.json              # 必需，包描述
├── theme/
│   └── theme.json             # kind=theme 的内容（见 theme-framework.md §三）
├── syntax/
│   ├── highlighters.json      # kind=syntax：声明式高亮器（见 code-highlight-framework.md §四.2）
│   └── *.js                   # 脚本高亮器
└── preview.png                # 可选，设置页预览图
```

**"合包 / 分包"规则**：`manifest.kinds` 数组声明该包含有哪些种类，各种类内容放在以种类名命名的子目录。一个包含 `theme/` + `syntax/` 两目录 = 合包（一次安装同时获得主题与高亮，如"One Dark 完整包"）；只含其一 = 分包（如"主题 · 纸白"与"高亮 · One Dark"各自独立安装）。ExtensionHost 对 kinds 逐个独立注册——**装了合包等价于同时装了两个独立扩展，可分别启停**（启停粒度是"包内种类"，不是整包）。

### 3.3 manifest.json

```json
{
  "schemaVersion": 1,
  "id": "com.example.onedark",
  "name": "One Dark 完整包",
  "version": "1.2.0",
  "authors": ["someone"],
  "description": "One Dark 配色 + C#/JSON 高亮",
  "kinds": ["theme", "syntax"],
  "engines": { "gitui": ">=0.3.0", "script": "js-es2020" },
  "theme": { "base": "dark", "inherits": null },
  "syntax": { "languages": ["csharp", "json", "powershell"] },
  "entryPoints": {
    "script": "syntax/init.js"
  }
}
```

字段规则：

- `id`：反向域名，全局唯一，包目录/启停记录以其为键
- `schemaVersion`：容器格式版本；不匹配则拒载并提示升级宿主
- `engines.gitui`：semver 区间，宿主版本不满足则禁用（不删除）
- `kinds`：非空子集 ⊆ `{theme, syntax}`；宿主只认识其中一部分时**部分装载**（认识的注册、不认识的忽略并记录日志）

## 四、生命周期

```
扫描 → 解析 manifest → 校验 → (排序) → 注册各 Kind → 就绪
                        ↘ 失败：标记 disabled + 原因，宿主继续跑
```

- **扫描顺序**：用户包目录优先于内置包（同 id 时用户版覆盖内置版）；包间排序按"被依赖的令牌/语法缺失时回退内置"兜底，不做显式依赖图（本期）
- **启停**：settings.json 记录 `{ "packages": { "<id>": { "enabled": true, "kinds": {...} } } }`；禁用 = 从注册表摘除并触发对应服务重建（主题禁用→回退内置深色，高亮禁用→该语言回退纯文本）
- **安装/卸载**：设置页"扩展"卡片，导入 `.gpk`（FileOpenPicker）→ 校验 → 解压到用户目录 → 启用；卸载仅限用户包，内置包只能禁用
- **故障隔离**：任何包内异常（manifest 损坏、脚本抛错）→ 该包标记 `error` 并在设置页显示原因，**宿主与其它包不受影响**（沿用 crash.log 的"可诊断不闪退"原则）

## 五、脚本宿主（第一期 JavaScript）

### 5.1 引擎选型

| 候选 | 结论 |
|---|---|
| **Jint（JS，纯 .NET）** | ✅ 选定：无原生依赖（WindowsAppSDKSelfContained 发布友好）、.NET 8 兼容、维护活跃；ES2020 覆盖脚本插件需求 |
| MoonSharp（Lua） | 备选，接口留作 `engines.script: "lua-5.4"` 第二后端 |
| Roslyn C# 脚本 | 放弃：与宿主同进程强耦合、无沙箱边界、发布体积大 |
| ClearScript（V8） | 放弃：原生依赖，自包含发布复杂 |

### 5.2 受限 API（版本化，`gitui.apiVersion`）

脚本可见的对象只有宿主显式注入的 `gitui`：

```js
// syntax/init.js —— 注册一个脚本高亮器
gitui.syntax.register({
  id: "mylang",
  extensions: [".myl"],
  tokenizeLine(line, state) {          // 见 code-highlight-framework.md §四
    return { tokens: [...], state };
  }
});
```

**沙箱规则**：不注入 IO/Process/网络/反射；脚本执行超时（默认 200ms/调用，可配）即中断并禁用该包；内存上限由 Jint constraints 控制。脚本**只读**宿主状态（如 `gitui.theme.getTokenColor("keyword")`），修改一律走注册接口。

### 5.3 C# 强类型插件（Phase 3 预留）

`ISyntaxHighlighter` 等接口（见高亮文档）同期就是 C# 插件契约：Phase 3 用可收集 `AssemblyLoadContext` 装载第三方 dll，manifest 加 `"entryPoints": {"dotnet": "My.dll"}` 与权限声明。接口先冻结、宿主后实现，保证脚本插件可平滑迁移为 C# 插件。

## 六、设置页集成

设置页新增"扩展"卡片：已装包列表（名称/版本/种类徽标/启用开关/卸载按钮/错误原因）、"导入 .gpk…"按钮、内置包标记"内置"。启用/禁用即时生效（主题回退默认、高亮回退纯文本），不需要重启。

## 七、分阶段计划

| 阶段 | 内容 | 验收 | 状态 |
|---|---|---|---|
| P1 | manifest schema + 扫描/校验/按 kind 启停 + 设置页卡片 | 设置页可见包并可禁用（禁用即时回退） | ✅ 2026-10-04（扫描分散在 ThemeService/HighlighterRegistry，统一 PackageStore 为后续重构项） |
| P2 | .gpk zip 容器 + 导入/卸载 + 内置包自举 | 内置包以同一格式随构建分发；.gpk 可导入可卸载 | ✅ 2026-10-04（导入按 kinds 分流：theme/syntax 均可导入） |
| P3 | Jint 脚本宿主 + `gitui.syntax.register` + 超时/沙箱 | 一个 JS 高亮器包从安装到生效全流程 | ⬜ 待实施 |

## 八、风险

| 风险 | 对策 |
|---|---|
| 脚本死循环/慢 | Jint 执行超时 + 内存约束 + 禁用降级 |
| manifest 生态混乱 | schemaVersion + 严格校验 + 部分装载 |
| 内置包迁移回归 | P2 用"内置=同一格式"自举，冒烟（三页 + 命令面板）全绿为准 |
| 主题包注入 XAML 失败（0xC000027B 前科） | 主题应用只操作**已知键集合**的 ResourceDictionary（见 theme-framework.md §五），不触碰控件模板结构 |
