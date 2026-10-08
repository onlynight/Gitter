# Gitter 插件开发文档

> 面向插件作者。本文覆盖「是什么 / 目录结构 / manifest / 装载流程 / 打包发布 / 调试」；
> API 清单见 [plugin-api.md](./plugin-api.md)，可直接复制的完整包见 [`examples/`](../examples/)。

---

## 0. 一句话总结

一个 Gitter 插件 = **一个目录 + 一个 `manifest.json`**，目录名必须与 `manifest.id` 完全相同。
`manifest.json` 里声明 `contributes.*` 贡献点（纯数据）与可选的 `entry` 代码入口（CJS）。
插件不需要 `package.json`，不需要安装依赖，宿主直接 `require` 入口文件。

---

## 1. 三层信任模型（决定你能做什么）

| 层级 | 形态 | 门控 | 能做什么 |
|---|---|---|---|
| **L1 数据包** | 只有 `contributes.*`，无 `entry` | **无门控，始终可用** | 命令/配置/技能/主题/模型档案/任务型/提示词段/子代理预设/页面（页面仍受下面的页面门）等纯声明贡献 |
| **L2 代码插件** | `entry: "main.js"`，`entrySandbox` 缺省或 `host` | `settings.allowCodePlugins`（**默认 `false`**） | L2 `PluginCtx` 全量 API：门禁钩子、日志装饰器、Agent 工具、提示词槽位、压缩器等 |
| **L3 沙箱插件** | `entrySandbox: "utility"` + `permissions: [...]` | 同上 + 权限清单 | 隔离子进程运行；**API 面严格小于 L2**（只有 storage/notify/events/git.read/tools/statusbar/webview） |

**安全不变量（宿主强制，非约定）**：

- 插件**提议**（注册命令/工具/钩子），**执行权在宿主**；
- git 写操作仍走主进程人审门与安全网——插件绕不过去；
- 门禁钩子（`registerGate`）**只能否决、不能篡改**；
- 插件工具执行时拿到的上下文被刻意收窄为 `{ workDir, signal }`——拿不到权限请求、emit、askUser 等；
- 渲染层页面是 in-process 的：RPC 权限域校验是 **advisory**（诚实插件有效），恶意代码物理上可绕过；
  真正的防线是 `allowCodePlugins` 审核渠道门 + 主进程人审门。**不要把 L2 页面包当沙箱用。**

---

## 2. 目录结构

```
my-plugin/                     ← 目录名必须 === manifest.id
├── manifest.json              ← 唯一被读取的清单文件
├── main.js                    ← 可选，L2/L3 代码入口（CJS）
├── i18n/
│   ├── en.json                ← 仅识别 en / zh-Hans
│   └── zh-Hans.json
├── theme/dark.json            ← contributes.themes[].path 指向的文件
└── page.js                    ← contributes.pages[].entry 指向的渲染层脚本（经典 IIFE，非 module）
```

**装载根目录**（按优先级）：

1. `<userData>/packages/` — `.gpk` 导入的用户包
2. `<userData>/themes/` — v1 兼容主题目录
3. `<resources>/themes/` — v1 内置主题根（兼容）
4. `<resources>/packages/` — v2 内置包根

**同 id 时用户包遮蔽内置包**（按**目录名**判定，不是 manifest id）。用户包可卸载，内置包只能禁用。

> 开发期最快的放置方式：把目录直接拷进 `<userData>/packages/` 然后重启 Gitter。
> `userData` 在 Windows 上通常是 `%APPDATA%/gitter`（可用 `app.getPath("userData")` 确认）。

---

## 3. manifest.json 完整字段

### 3.1 顶层字段

| 字段 | 类型 | 必填 | 规则与缺省 |
|---|---|---|---|
| `schemaVersion` | `2` | ✅ | 字面量 `2`。`1` 走兼容分支（只能表示主题包） |
| `id` | string | ✅ | 反向域名：`/^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/`，如 `com.example.deploy` |
| `name` | string | ✅ | 展示名，`min 1` |
| `version` | string | ✅ | `min 1` |
| `description` | string | ❌ | 缺省 `null` |
| `engines.gitter` | string | ❌ | semver 区间。非法 → 整包 error；不满足当前版本 → **disabled**（可恢复，不删除） |
| `entry` | string | ❌ | 相对包目录的 CJS 入口。缺省 = 纯 L1 数据包 |
| `entrySandbox` | `"host" \| "utility"` | ❌ | 缺省 `null` = `host`（L2）。`utility` = L3 隔离子进程 |
| `permissions` | string[] | ❌ | L3 能力清单：`storage` / `notify` / `events` / `git.read` / `tools` / `statusbar` / `webview` |
| `apiVersion` | number | ❌ | `> HOST_API_VERSION`（当前 **3**）→ disabled：`插件 API v<n> 超出宿主支持` |
| `contributes` | object | ❌ | 22 个贡献点，缺省全部 `[]` |

校验失败信息形如 `manifest 校验失败：<第一条 zod 消息>（<路径.join(".")>）`——**只报第一条**，整包拒载，
其它包不受影响。

### 3.2 贡献点一览

| `contributes.*` | 内容 | 关键约束 |
|---|---|---|
| `themes` | 主题文档 | `path` 必填；多主题包每项必须有唯一 `id` 且 `base` 一亮一暗 |
| `grammars` | TextMate 语法 | `extensions` 至少 1 项；`scopeName` 缺省时从语法文件解析 |
| `commands` | L1 命令 | `action` 必须在宿主白名单内；`when` 最长 200 字符 |
| `configuration` | 包配置项 | `type ∈ string/boolean/number` |
| `menus` | 右键菜单项 | `command` 指向本包命令 id；`location ∈ changesFile/branchRow/logRow`；`order` 缺省 100 |
| `keybindings` | 快捷键 | 只为命令补 `keyHint`，**不覆盖** manifest 显式声明的 `keyHint` |
| `terminalProfiles` | 终端档位 | 运行时 id = `ext.<pkg>.<id>` |
| `safetyRules` | 安全网规则 | `flags` 的 `g` 会被强制剥离（避免 lastIndex 状态泄漏）；**恒为 warning 档** |
| `skills` | Agent 技能（markdown 注入系统提示） | `instructions` 必填 |
| `mcpServers` | MCP 服务端 | `transport` 只能是字面量 `"stdio"` |
| `emptyHints` | 空态提示 | `slot ∈ changes.empty / log.empty / branches.empty` |
| `pages` | 渲染层页面 | 见 §5 |
| `harnesses` | CLI 传输适配器 | 重 schema，`emit.kind` 白名单 9 种 |
| `models` | 模型档案 | `kind ∈ openai-compatible / anthropic`；`temperature` 0..2 |
| `taskTypes` | 任务型 | `promptTemplate` **必须含 `{input}`**（zod `refine` 强制）；`maxSteps` 1..200 |
| `agentTools` | Agent 工具**声明** | ⚠️ **仅声明，不执行**——只为能力展示/校验。真正执行走 L2 `ctx.registerAgentTool` |
| `promptSections` | 系统提示词段 | `boundary` 槽位**仅内置包可用**，用户包同步时被拒 |
| `subagentPresets` | 子代理预设 | `timeoutMs` 30_000..1_800_000 |
| `contextFiles` | 固定文件上下文注入 | `capChars` 100..16_000，**运行时缺省 2000** |
| `commandRiskRules` | 命令风险规则 | `risk ∈ high/medium`，**只上调不下降**（max 语义合并） |
| `agentPermissionRules` | Agent 权限规则 | `effect` **只能是 `deny`**——包只能加严 |

### 3.3 运行时 id 命名空间（全部在装载时自动加前缀）

| 贡献 | 运行时 id |
|---|---|
| commands / menus / keybindings | `ext.<pkg>.<cmd>` |
| terminalProfiles / skills / agentTools | `ext.<pkg>.<id>` |
| pages | `ext.<pkg>.<pid>` |
| promptSections | `<pkg>.<id>` |
| subagentPresets | `<pkg>/<id>` |
| mcpServers | `mcp.<pkg>.<id>` |
| safetyRules | `pkg.<pkg>.<id>` |

### 3.4 i18n

`i18n/<lang>.json`，**只识别 `en` 与 `zh-Hans`**（其它文件名静默忽略）。
`commands[].title` 与 `pages[].title` 支持 `%key%`，解析顺序 **lang → en → 原样返回**。

---

## 4. 装载流程与故障排查

### 4.1 时序

1. **扫描**（每次调用重扫，包量小所以目录 I/O 便宜）：用户根优先 → 内置根，按**目录名**去重。
2. **校验**：`JSON.parse` → `normalizeManifest` → semver → apiVersion → 账本 `enabled`。
3. **状态**：`active` / `disabled`（有 reason）/ `error`（manifest 坏，`reason` 写入错误账本）。
4. **激活**：`PluginHost.activateAll` —— **先全量 deactivate 再装载**；`allowCode === false` 时直接返回（L1 贡献仍全部生效，只是不跑代码）。
5. **回滚**：`activate` 抛错 → 该包已注册的所有可回收面全部执行，包标记 `error`，宿主与其它包不受影响。

### 4.2 常见故障与判定

| 现象 | 原因 |
|---|---|
| 设置页里根本看不到包 | 目录名 ≠ `manifest.id`；或不在任何装载根目录；或 `manifest.json` 不是合法 JSON |
| 包在列表里但显示 error | manifest 校验失败（id 不是反向域名最常见）；`engines.gitter` 非法 semver |
| 包显示 disabled 且有原因 | `engines.gitter` 不满足当前版本；`apiVersion > 3` |
| 页面没出现在侧栏 | `allowCodePlugins` 未开启（内置页面包免门，用户页面包需开） |
| 状态栏/面板/门禁等代码贡献全空 | 同上——这些依赖 L2 `entry` 装载 |
| 包命令执行报 `不允许的宿主动作` | `action` 不在白名单（见 §4.3） |

### 4.3 宿主动作白名单（L1 命令唯一能调的执行体）

```
terminal.run        在当前仓库终端执行命令（首跑确认默认开启）
shell.openPath      用外部编辑器/系统打开文件
shell.reveal        在资源管理器中显示
repo.refresh        全局刷新
agent.task.create   创建 Agent 任务
agent.task.resume   续跑最近 Agent 会话
```

超出白名单 → `Error("不允许的宿主动作：<action>")`，`detail: "ACTION_FORBIDDEN"`。

### 4.4 模板与 `when` 表达式

`args` 内的字符串支持 `${...}` 插值，可用变量：

| 变量 | 含义 |
|---|---|
| `${config.<key>}` | 本包配置当前值 |
| `${repo.path}` | 当前仓库路径 |
| `${repo.branch}` | 当前分支 |
| `${file.path}` | 右键菜单上下文中的选中文件 |

`when` 是空格分隔的 AND，支持 `!` 取反：

```
"repoOpen"                 仅仓库打开时可用
"fileSelected"             仅选中文件时可用
"config:enabled"           本包配置项为真值
"!fileSelected repoOpen"   仓库打开且未选中文件
```

未知 token **安全默认为 false**。

---

## 5. 页面插件（渲染层）——与 React 组件不是一回事

**页面不是 React 组件，而是一段经典 IIFE 脚本**，副作用是调用 `window.GITTER_UI.registerPage(def, mount)`。

```js
// page.js —— 经典 script（非 ES module，不能用 import/export）
(function (react) {
  function Page() {
    return react.createElement("div", null, "Hello from plugin");
  }
  window.GITTER_UI.registerPage({ id: "hello" }, (container) => {
    const root = window.GITTER_KIT.ReactDOMClient.createRoot(container);
    root.render(react.createElement(Page));
    return () => root.unmount();   // ← 清理函数，卸载时由宿主调用
  });
})(window.GITTER_KIT.ReactJSXRuntime && window.GITTER_KIT.React);
```

React 通过宿主的全局 `window.GITTER_KIT` 共享**同一实例**（`React` / `ReactDOM` / `ReactDOMClient` /
`ReactJSXRuntime`），所以外部页不能自带 React——必须消费宿主那份，否则会双实例崩溃。

### 5.1 槽位与提供者竞争

```jsonc
"pages": [{
  "id": "dashboard",
  "slot": "dashboard",        // 缺省 = id → 新增独占槽位
  "title": "%Nav_Dashboard%",
  "entry": "page.js",
  "icon": "📊",               // Segoe Fluent 字形（单码点）
  "svg": "M2 3h12v1.5H2V3z", // 16×16 SVG path（侧栏图标第二形态）
  "permissions": ["git.read"],// 缺省 = ["open","git.read"]
  "styles": ["page.css"],     // 装载时注入，卸载时移除
  "lazy": false               // true = 首次导航才注入脚本
}]
```

同槽位三级解析：**用户包 > 内置包 > 宿主内置组件**。声明 `slot: "log"` 就等于**替换**内置 Log 页；
内置提供者**不可卸载，只可被替换**，且停用某包的唯一页面提供者会被宿主拒绝（防槽位塌陷）。

### 5.2 权限域（RPC scope）

页面调宿主 RPC 时按声明的 `permissions` 过滤。11 个域：

```
open              无敏感读（清单/状态/主题/技能列表）—— 恒放行
git.read          git 只读（log.query / changes.state / branches.state / agent.task.diff …）
git.write         git 写（stage/commit/branch/push/reset/squash）
settings.write    持久化写
agent.run         驱动任务（create/resume/stop/queue/setMode/compact）
agent.config      授权回执与导出
extensions.admin  扩展安装/卸载/启停/配置
terminal          pty 会话
ai.invoke         消耗 AI 额度
approval          人审回执（可替人类放行 MCP 写操作——高危）
window            窗口/壳层（repo.open/close、shell.*、dialog、commands.exec）
```

**未收录的 RPC 方法默认归入 `extensions.admin`**（默认拒绝）。缺省声明是 `["open","git.read"]`。
内置页面包**免 `allowCodePlugins` 门**；用户页面包需要它开启。

> ⚠️ 权限必须**在 `registerPage` 瞬间捕获**。宿主在注入完成后立刻重置装载窗口，
> 在 mount 时才读模块变量会永远回退到缺省权限（`terminal` / `extensions.admin` / `git.write` 全部被拒）。
> 页面 SDK 层已经处理好这一点——**用提供的 `pageSdk.call` 而不是裸 `window.GITTER_UI.call`**。

---

## 6. Agent 工具（L2，最有价值的一类）

L1 `contributes.agentTools` **只是声明**（用于能力展示）。真正让 Agent 能调用，要在 L2 entry 里注册：

```js
module.exports = function activate(ctx) {
  ctx.registerAgentTool({
    id: "deploy_preview",
    description: "生成部署预览链接（需要参数 stage：staging|prod）",
    parametersSchema: { /* zod schema */ },
    permissionClass: "each-time",
    execute: async (args, env) => {
      // env 只有 { workDir, signal } —— 拿不到权限请求、emit、askUser
      return `预览链接：https://deploy.example.com/${args.stage}`;
    },
  });
};
```

- 工具名自动加前缀 → `ext.<pkg>.deploy_preview`
- `permissionClass` 缺省 **`"each-time"`**（最严）；`auto` 免询问
- `parametersSchema` 不是 zod 实例时降级为 `z.object({})`
- 权限门由宿主的 `buildToolset` 统一生效，插件**没有绕过路径**
- 内置工具与插件工具**同一条入表路径**，无特权区分

完整可运行示例见 [`examples/agent-tool/`](../examples/agent-tool/)。

---

## 7. 打包与发布

`.gpk` 就是一个 zip（`manifest.json` 必须位于压缩包根），改后缀即可。

```bash
cd my-plugin
# zip 时必须保证 manifest.json 在根，而不是 my-plugin/manifest.json
zip -r ../my-plugin.gpk manifest.json main.js i18n -x "*.DS_Store"
```

导入方式（三选一）：

1. Gitter → 设置 → 扩展 → 导入扩展包（选 `.gpk`）
2. 目录拷进 `<userData>/packages/`
3. `extensions.installFromCatalog`（`http(s)://.../xxx.gpk`）

宿主导入时会**重新校验 manifest**，并拒绝 `contributes` 为空的包（`包不含任何可安装内容`）。
解包有 zip-slip 防护（剥离前导分隔符、拒绝 `..`/绝对路径、二次 `startsWith(target + sep)` 校验）。

卸载 = 直接删目录，**仅用户包**（内置包目录不在用户根下，会被拒：`内置包只能禁用，不能卸载`）。

---

## 8. 开发调试

### 8.1 生成骨架

```bash
node scripts/gen-plugin-scaffold.mjs out/com.example.myplugin com.example.myplugin
```

产出 `manifest.json`（命令 + 配置 + 技能 + i18n）、`main.js`（L2 entry）、`i18n/{zh-Hans,en}.json`、`README.md`。
会校验反向域名 id。

### 8.2 热同步

包集合变化（导入/卸载/启停）触发 `extensions.changed` 事件，渲染层做**差量同步**：
新页幂等 upsert；被移除的包注销页面/样式/agent UI；`entry` 未变的包**不重挂**（零闪烁、无卸载窗口）。

### 8.3 无头冒烟

`app/src/smoke-*.ts` 直接构造 `PackageStore` 扫真实 `resources/packages` 或临时目录，覆盖：
manifest 校验、`.gpk` 导入、停用守卫、权限域分级、agent e2e。改插件系统时先跑这些。

### 8.4 页面视觉验收

`web/harness/` 是开发用视觉 harness（不随应用分发）：stub 了 `window.GITTER_UI` / `window.GITTER_KIT`
同构接口 + mock RPC 数据，直接装载 `app/resources/packages/gitui.page.tasks/page.js`，
亮/暗两档截图验证。自定义页面的验收可以用同一套 stub 思路。

### 8.5 内置页面构建（了解即可，外部作者用不到）

`web/scripts/build-pages.mjs` 把 `web/src/pages/entries/<slot>.ts` 打成 IIFE →
`app/resources/packages/gitui.page.<slot>/page.js`，把 `react*` external 到 `window.GITTER_KIT.*`，
`emptyOutDir: false`（`manifest.json`/`i18n/` 是入库静态资源）、`minify: false`（产物保持可读多行）。

---

## 9. 与宿主相关的现有文档

| 文档 | 内容 |
|---|---|
| [extension-system-v2.md](./extension-system-v2.md) | 扩展系统 v2 总体设计（本文的上游） |
| [extension-package-framework.md](./extension-package-framework.md) | v1 包框架（兼容分支来源） |
| [pluginization-plan.md](./pluginization-plan.md) | 插件化路线图 |
| [ui-pluginization-plan.md](./ui-pluginization-plan.md) | UI 插件化 |
| [ui-full-pluginization-plan.md](./ui-full-pluginization-plan.md) | UI 全插件化（槽位/提供者模型） |
| [agent-harness-v4.md](./agent-harness-v4.md) | Agent 工具契约 v4 |
| [task-model-modules.md](./task-model-modules.md) | 任务型 / 模型档案 |
| [agent-harness-codex.md](./agent-harness-codex.md) | CLI harness 贡献格式 |
| [theme-framework.md](./theme-framework.md) | 主题文档格式 |
| [code-highlight-framework.md](./code-highlight-framework.md) | TextMate 语法接入 |
| [i18n.md](./i18n.md) | 国际化工具链 |

---

## 10. 下一步

1. 读 [plugin-api.md](./plugin-api.md) 查具体方法签名
2. 从 [`examples/`](../examples/) 挑一个最接近你需求的骨架改
3. 拷进 `<userData>/packages/`，重启 Gitter，看设置 → 扩展
