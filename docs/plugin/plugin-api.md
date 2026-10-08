# Gitter 插件 API 参考

> 四套运行时 API，按「你在哪一层写代码」分。类型签名取自宿主源码，非猜测：
> `app/src/services/extensions/{host,schema,l3-child}.ts`、`web/src/{sdk,surface,agentUIRegistry}.ts`。

| 你在写 | 用哪套 API | 入口 |
|---|---|---|
| L2 主进程代码插件 | **`PluginCtx`** | `manifest.entry` → `module.exports = (ctx) => dispose?` |
| L3 沙箱子进程 | **`L3Ctx`** | `const { connectL3 } = require(<sdkDir>/services/extensions/l3-child)` |
| 渲染层页面 | **`window.GITTER_UI`** / `window.GITTER_KIT` | `manifest.contributes.pages[].entry`（经典 IIFE） |
| Agent 循环 / 工具 / 提示词 | `ctx.register*`（见 §2） | 同 L2 |

---

## 1. L2 `PluginCtx`

入口契约（`app/src/services/extensions/host.ts`）：

```js
module.exports = function activate(ctx) {
  // ...注册
  return () => { /* dispose：卸载/热重载/激活失败回滚时调用 */ };
};
// 也接受 module.exports = { activate(ctx) { ... } }
```

激活失败会**回滚该包已注册的全部面**，然后标记 `error`；宿主与其它包不受影响。

### 1.1 基础字段

```ts
ctx.packageId: string          // 本包 manifest.id
```

### 1.2 服务

```ts
ctx.storage: {
  get(key: string): unknown
  set(key: string, value: unknown): void
}
// 插件隔离 KV，落盘在 <userData>/plugin-data。同步 API。

ctx.notify(title: string, body?: string): void
// 渲染层 toast（经 ui.notify 事件扇出到所有窗口）

ctx.git: {
  status(): Promise<string>       // git status --porcelain
  log(limit?: number): Promise<string>   // git log --oneline -n <limit|10>
  branches(): Promise<string>     // git branch --list
}
// 只读。工作目录 = bridge 在 repo.open 时同步给宿主的当前仓库；无仓库时回退 "."
```

### 1.3 注册类 API

#### `ctx.registerCommand(def)`

```ts
def: { id: string; title: string; when?: string; action: string; args?: unknown }
```

自动加 `ext.<pkg>.` 前缀；运行时命令，随宿主启停回收。`action` 必须在宿主白名单内
（`terminal.run` / `shell.openPath` / `shell.reveal` / `repo.refresh` / `agent.task.create` / `agent.task.resume`）。

#### `ctx.registerTool(tool)`

```ts
tool: {
  name: string
  description: string
  permission: "read" | "write:gate"
  execute(args: Record<string, unknown>, ctx: { workDir: string; requestApproval: (d: string) => Promise<boolean> }): Promise<string>
}
```

进统一 `ToolRegistry`，`source = "plugin"`。`write:gate` 的写工具仍走人审门。

#### `ctx.on(event, handler)`

```ts
event: string                       // 必须 ∈ EVENT_NAMES（见 §1.5）
handler: (payload: Record<string, unknown>) => void | Promise<void>
```

单 handler 异常不上抛，其它订阅者继续执行。

#### `ctx.registerStatusItem(id, item)`

```ts
item: { text: string; tooltip?: string; command?: string }
```

状态栏条目，渲染层经 `ui.statusItems` RPC 拉取。

#### `ctx.registerPanel(id, panel)`

```ts
panel: { title: string; body: (ctx: { repo: string | null }) => Promise<string> | string }
```

侧栏面板（纯文本正文）。**单面板抛错不拖累其它面板**——错误会被渲染成 `（面板出错：<msg>）`。

#### `ctx.registerView(id, view)`

```ts
view: { title: string; html: string }
```

静态 HTML，渲染层放入**沙箱 iframe（无脚本权限）**。这是唯一有真实 HTML 沙箱的贡献。

#### `ctx.registerGate(point, fn)`

```ts
point: "commit" | "push"
fn: (info: Record<string, unknown>) => Promise<string | null> | string | null
// 返回非空字符串 = 否决（前端显示 "<pkg>: <reason>"）；null = 放行
```

**只能否决，不能篡改。** 钩子抛异常视为**放行**（`console.warn`，不阻塞主流程）。

#### `ctx.registerLogDecorator(fn)`

```ts
fn: (commit: { sha: string; subject: string; author: string; body: string }) =>
    { text: string; color?: string }[] | null
```

在 `log.query` 之后给提交追加 decorations。**只读，不能改 commit 本体**。单装饰器失败跳过。

#### `ctx.registerPreviewProvider(exts, fn)`

```ts
exts: string[]                                    // ["md","svg"]，前导点会被规范化为 ".md" 小写
fn: (filePath: string, maxBytes?: number) =>
    { kind: "text" | "html"; content: string } | null
```

按 `path.extname` 查找，**第一个匹配的提供者胜出**。

#### `ctx.registerScanner(fn)`

```ts
fn: (file: ScannableFile) => RuleFinding[] | null
```

L2 自定义扫描器，在数据包规则之后运行，**可返回 `blocked`**（`allowCodePlugins` 门 = 审核渠道信任）。

#### `ctx.registerCommitBlock(fn)`

```ts
fn: (info: { message: string; files: number }) => Promise<string> | string
```

提交对话框区块。**只能提示，不能阻断**——要阻断请用 `registerGate`。单块失败跳过。

#### `ctx.registerDiffNote(fn)`

```ts
fn: (filePath: string) => Promise<string | null> | string | null
```

diff 侧栏只读注记。单注记失败跳过。

### 1.4 Agent 相关（最有价值的一组）

#### `ctx.registerAgentTool(def)`

```ts
def: {
  id: string
  description: string
  parametersSchema?: unknown                 // 传 zod schema；非 zod 实例 → z.object({})
  permissionClass?: "auto" | "session" | "each-time"   // 缺省 "each-time"
  execute(args: Record<string, unknown>,
          ctx: { workDir: string; signal: AbortSignal }): Promise<string> | string
}
```

- 工具名 → `ext.<pkg>.<id>`，进 v4 `AgentToolRegistry`，**与内置工具同一条入表路径**
- ⚠️ 上下文刻意收窄：插件只拿到 `{ workDir, signal }`，**拿不到** `emit` / `requestPermission` /
  `askUser` / `submitPlan` / `setTodos` / `spawnSubtask` / `shells`
- 权限门在 `buildToolset` 包装层生效，插件无绕过路径
- `agentTaskType.tools` 白名单生效，`git_push` 恒 `each-time`

#### `ctx.registerLoop(id, impl)`

```ts
impl: (o: LoopOptions) => Promise<LoopResult>
// id → ext.<pkg>.<id>；bridge 按 provider 路由默认循环
```

#### `ctx.registerPromptSection(def)`

```ts
def: {
  id: string
  slot: "context" | "workflow" | "tools" | "skills" | "mode" | "task" | "free" | "output" | "compaction" | "subagent"
  order?: number                              // 缺省 100
  content?: string                            // 静态文本
  provide?: (ctx: { worktreePath: string; repoPath: string | null; mode: string }) =>
    Promise<string | null> | string | null    // 动态；null = 本轮省略
}
```

⚠️ **`identity` 与 `boundary` 槽位锁死，不对插件开放**。

#### `ctx.registerContextCollector(def)`

```ts
def: {
  id: string
  order?: number          // 缺省 100
  tokenBudget?: number    // 缺省 800，预算感知
  collect(ctx: { worktreePath: string; repoPath: string | null }):
    Promise<string | null> | string | null
}
```

软失败。

#### `ctx.registerSubagentPreset(def)`

```ts
def: {
  id: string; name: string; description?: string
  tools?: string[]      // ⊆ 当前工具注册表全集；未知名编译期剔除
  readonly?: boolean    // 为真时进一步过滤为只读工具
  addendum?: string
  timeoutMs?: number    // 夹在 30_000..600_000（注意：L2 运行时上限 600s，比 manifest 的 1_800_000 严）
}
```

预设 id → `<pkg>/<id>`。

#### `ctx.registerTurnHook(def)`

```ts
def: {
  id: string
  order?: number   // 缺省 100
  hook(info: { taskId: string; outcome: string;
                lastMessage: string | null; todoState: unknown[] | null }):
    Promise<string | null> | string | null
}
```

**只有 post-turn**：产物由宿主以 `system-reminder` 注入下一轮，cap 2000 字符。
pre-turn 拦截**不开放**（引擎不插件化）。

#### `ctx.registerCompactor(def)`

```ts
def: {
  id: string
  compact(input: {
    messages: unknown[]; contextWindow: number; systemEstTokens: number
    model: unknown; signal?: AbortSignal
  }): Promise<{
    messages: unknown[]
    record: { ts: string; removedCount: number
              tokensBefore: number; tokensAfter: number; summary: string }
  } | null>
}
```

**单槽覆盖**：活跃的非内置压缩器优先于 `builtin.summarizer`。

#### `ctx.registerAiProvider(name, impl)`

```ts
impl: {
  isConfigured(c: AiConfig): boolean
  complete(prompt: AiPrompt, c: AiConfig, timeoutMs: number): Promise<string>
}
```

⚠️ **`apiKey` 永远不会下发给插件**——由宿主在请求侧注入。

---

### 1.5 事件枚举（`ctx.on` 可订阅的全部事件）

```
repo.opened           { repo }
repo.closed           {}
changes.updated       { repo, ... }
commit.created        { repo, message, pushed }
branch.checkedOut     { repo, branch }
sync.pushed           { repo }
sync.pulled           { repo }

agent.task.created / resumed / stopped / removed
                      { repo, taskId, title, branch, state }

agent.turn.started / agent.turn.completed
agent.tool.called
agent.permission.raised / agent.permission.decided
```

**事件名是宿主枚举——插件不能自定义事件源**（架构边界）。全部为只读广播，无 pre-tool 拦截。

---

## 2. L3 `L3Ctx`（隔离子进程）

`manifest.json`：

```jsonc
{
  "entry": "main.js",
  "entrySandbox": "utility",
  "permissions": ["git.read", "tools", "statusbar", "storage", "notify", "events", "webview"]
}
```

入口写法（`app/src/services/extensions/l3-child.ts`）：

```js
const sdkDir = process.argv[2];
const { connectL3 } = require(sdkDir + "/services/extensions/l3-child");
connectL3().then((ctx) => {
  // ...
});
```

### 2.1 API（**严格小于 L2**）

```ts
ctx.packageId: string
ctx.permissions: string[]

ctx.storage: {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
}
ctx.notify(title: string, body?: string): Promise<void>
ctx.on(event: string, handler: (payload: Record<string, unknown>) => void): Promise<void>

ctx.git: {
  status(): Promise<string>
  log(limit?: number): Promise<string>     // 缺省 limit 5
  branches(): Promise<string>
}

ctx.registerTool(def: {
  name: string
  description: string
  permission?: "read" | "write:gate"       // 缺省 "read"
  execute(args: Record<string, unknown>): Promise<string> | string
}): Promise<void>

ctx.registerStatusItem(id: string, item: { text: string; tooltip?: string; command?: string }): Promise<void>
ctx.registerView(id: string, view: { title: string; html: string }): Promise<void>
```

### 2.2 与 L2 的差异

| | L2 | L3 |
|---|---|---|
| 进程 | 进程内 `require` | utilityProcess / child_process.fork |
| 超时 | 无 | 每次能力调用 **20s**；工具回调 **30s** |
| Agent 工具 | ✅（v4 注册表，权限门生效） | ❌（进 legacy `ToolRegistry`） |
| gate / decorator / loop / promptSection / compactor / aiProvider | ✅ | ❌ |
| 崩溃影响 | 包被回滚标记 error | 同，且进程退出码非 0 时标 `L3 进程异常退出（码 <n>）` |

### 2.3 能力与权限

未授权的能力调用返回 `{ok:false, error:"permission denied: <cap>"}`；未知能力抛 `未知能力 <cap>`。

| 能力 | 对应方法 |
|---|---|
| `storage` | `get` / `set` |
| `notify` | `show` |
| `events` | `subscribe` |
| `git.read` | `status` / `log` / `branches` |
| `tools` | `register`（`write:gate` 工具在宿主侧套人审门） |
| `webview` | `register` |
| `statusbar` | `register` |

---

## 3. 渲染层页面 API

### 3.1 `window.GITTER_UI`

```ts
window.GITTER_UI = PageSurface & {
  registerPage(def: { id: string; title?: string; icon?: string; order?: number },
               mount: (container: HTMLElement, ctx: ExternalPageContext) => void | (() => void)): void
  registerAgentUI(reg: {
    timelineRenderers?: TimelineRendererDef[]
    composerProviders?: ComposerMentionProviderDef[]
  }): void
  resolveTimelineRenderer(toolName: string | undefined, blockKind: string): TimelineRendererDef | null
  composerProviders(): ComposerMentionProviderDef[]
  onAgentUIChanged(cb: () => void): () => void
  agentUIVersion(): number
  context(): PageContextSnapshot
  getState(): AppState
  subscribeState(cb: () => void): () => void
  getActiveCaller(): { packageId: string; permissions?: string[] } | null
  callWith<T>(caller: CallerIdentityView | null, method: string, params?: unknown): Promise<T>
}
```

注册时 `id` 会被宿主展开成 `ext.<pkg>.<id>`；`slot` / `permissions` / `svg` 等来自 manifest 元数据。
`mount` 返回的清理函数在**页面卸载时真正被调用**。

### 3.2 `PageSurface`（`pageSdk.call` 提供的完整数据/控制面）

```ts
call<T>(method: string, params?: unknown): Promise<T>     // RPC，权限域按 manifest 过滤
on(method: string, cb: (params: never) => void): () => void
t(key: string, ...args: (string | number)[]): string      // i18n
navigate(page: PageKey): void
openSettings(section?: string): void
toast(title: string, body?: string): void
refresh(): void                                           // F5 语义

repo(): { workDir: string; name: string } | null
settings(): SettingsDTO | null
theme(): ThemeStateDTO | null
openRepo(path: string): Promise<void>                     // projects.open + 跳 log + 刷新
closeRepo(): void
updateSettings(patch: Partial<SettingsDTO>): Promise<SettingsDTO>
applySettings(s: SettingsDTO): void
reloadTheme(): Promise<void>
clearSettingsFocus(): void

context(): {
  selectedFile: { path: string; staged: boolean; isNew: boolean; isConflict: boolean } | null
  selectedCommitSha: string | null
}
setContext: typeof setSharedContext

focusTask(taskId: string): void
clearTaskFocus(): void

runCommand(cmd: { id: string; title?: string; titleKey?: string }, ctx?: RunContext): Promise<void>
extTree(): ExtTreeSnapshot
```

### 3.3 `window.GITTER_KIT`（UI kit + React 单实例）

```ts
React, ReactDOM, ReactDOMClient, ReactJSXRuntime
DiffView, diffStatusLetter, renderSegments, wordDiff
SplitPane
Banner, Modal, useContextMenu
SyncBar, useSyncProgress
renderMarkdown, registerMarkdownPlugin
PageErrorBoundary
NavIcon
Select
ScrollArea
```

⚠️ KIT 是**可复用组件不是可替换引擎**——DiffView / 虚拟滚动的实现不开放替换。

### 3.4 Agent UI 贡献

```ts
interface TimelineRendererDef {
  tool?: string      // 精确工具名（"mydeploy.release"）或包前缀（"mydeploy."）；
                     // undefined = 按 blockKind 通配
  blockKind?: string
  rank?: number      // 同特异性同 tier 内大者胜；同分先注册胜
  render: (props: TimelineCardProps) => ReactNode
}

interface TimelineCardProps {
  block: unknown; taskId: string; expandable?: boolean
  ctx?: {
    taskId?: string
    viewFile?: (path: string) => void
    previewFile?: (path: string) => void
    contextPct?: string
    renderChildren?: (children: unknown[]) => ReactNode
  }
}

interface ComposerMentionProviderDef {
  prefix: string     // "@" 为内置；插件可加 "#"、"!" 等；同 prefix 用户包覆盖内置
  label: string
  source: (query: string) => Promise<{ label: string; insert: string }[]>
}
```

**解析特异性**：工具精确名 = 3 > 工具前缀 = 2 > blockKind 通配 = 1。
**tier**：`user` (3) > `builtin` (2) > `host` (1)。

---

## 4. RPC 权限域速查

页面声明 `permissions` 后，`call(method)` 会校验该方法所属域。未收录方法**默认 `extensions.admin`**。

| 域 | 代表方法 |
|---|---|
| `open` | `extensions.list`、`commands.list`、`menus.list`、`skills.list`、`models.list`、`themes.list`、`settings.get`、`ui.*`、`agent.taskTypes.list`、`api.info` |
| `git.read` | `log.query`、`changes.state`、`changes.diffFile`、`branches.state`、`file.preview`、`highlight.file`、`repo.files`、`agent.task.diff`、`agent.task.checkpoints` |
| `git.write` | `changes.stage/unstage/commit/push/pull/fetch`、`branches.*`、`log.reset/squash`、`tasks.create/remove`、`gitconfig.set`、`agent.task.restore` |
| `settings.write` | `settings.set`、`settings.setAiKey`、`settings.rememberCommand` |
| `agent.run` | `agent.task.create/resume/stop/feedback/setModel/fork/archive/delete/queue/setMode/compact/clear`、`agent.loop.run`、`review.repair` |
| `agent.config` | `agent.perm.reply`、`agent.task.export` |
| `extensions.admin` | `extensions.importGpk/installFromCatalog/setEnabled/setKindEnabled/setConfig/uninstall` |
| `terminal` | `terminal.ensure/write/resize` |
| `ai.invoke` | `ai.generateCommitMessage`、`ai.explain`、`models.test/save/delete/setDefault/setFast/setKey` |
| `approval` | `mcp.approve`（高危：可替人类放行 MCP 写操作） |
| `window` | `shell.openPath/reveal/openExternal`、`dialog.pickFile`、`projects.*`、`repo.open/close`、`commands.exec`、`app.newWindow` |

`open` 恒放行。`scopeGranted` 判定只看声明是否包含所需域。

---

## 5. 数据契约速查

```ts
const HOST_API_VERSION = 3;          // apiVersion > 3 → disabled
const DATA_API_VERSION = "v3";       // api.info RPC 可运行时查询
DEFAULT_PAGE_SCOPES = ["open", "git.read"];

// taskTypes.permissionPolicy 只能沿 auto → session → each-time 收紧；git_push 恒 each-time
// subagentPresets.timeoutMs：manifest 层 30_000..1_800_000；L2 运行时夹到 30_000..600_000
// contextFiles.capChars：100..16_000，运行时缺省 2000
// menu order / promptSection order / keybinding：缺省 100
// agentTools.permission：缺省 "each-time"
```

---

## 6. 不要做的事

- ❌ 在页面里自带 React（必须用 `window.GITTER_KIT.React`，双实例会崩）
- ❌ 在 mount 里调 `window.GITTER_UI.call` 而不用 `pageSdk.call`（权限会永远回退缺省）
- ❌ 用 `registerGate` 篡改提交内容（只能否决）
- ❌ 假设拿得到完整 `ToolEnv`（Agent 工具只给 `{workDir, signal}`）
- ❌ 贡献 `promptSections` 到 `identity` / `boundary` 槽位（用户包会被拒）
- ❌ 贡献 `agentPermissionRules.effect: "allow"`（只能是 `deny`）
- ❌ 指望 L1 `contributes.agentTools` 让工具可执行（那是纯声明）
- ❌ 把渲染层页面包当沙箱（in-process，权限校验是 advisory）
- ❌ 依赖目录名与 `manifest.id` 不同（扫描按目录名去重）
