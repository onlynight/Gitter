# sandboxed-plugin

L3 隔离子进程示例：`entrySandbox: "utility"` + 权限清单 + `connectL3`。

> ⚠️ 需要 `settings.allowCodePlugins` 开启。
> ⚠️ L3 依赖宿主提供 `utilityProcess` 通道；无头冒烟环境走 `child_process.fork`。

## 与 L2 的差异

| | L2（`entrySandbox: "host"`） | L3（`entrySandbox: "utility"`） |
|---|---|---|
| 运行位置 | 主进程内 `require` | utilityProcess / fork 子进程 |
| 超时 | 无 | 能力调用 **20s**；工具回调 **30s** |
| Agent 工具（v4 注册表） | ✅ | ❌（L3 工具进 legacy `ToolRegistry`） |
| gate / decorator / loop / promptSection / compactor / aiProvider / turnHook / subagentPreset / contextCollector | ✅ | ❌ |
| 崩溃影响 | 包回滚标记 error | 同；进程退出码非 0 时标 `L3 进程异常退出（码 <n>）` |
| 权限 | `allowCodePlugins` 门 | 门 + `manifest.permissions` 逐项强制 |

## L3 API 面（`L3Ctx`）

```ts
ctx.packageId: string
ctx.permissions: string[]

ctx.storage: { get(key): Promise<unknown>; set(key, value): Promise<void> }
ctx.notify(title, body?): Promise<void>
ctx.on(event, handler): Promise<void>

ctx.git: {
  status(): Promise<string>
  log(limit?: number): Promise<string>   // 缺省 5
  branches(): Promise<string>
}

ctx.registerTool({ name, description, permission?: "read"|"write:gate", execute }): Promise<void>
ctx.registerStatusItem(id, { text, tooltip?, command? }): Promise<void>
ctx.registerView(id, { title, html }): Promise<void>
```

## 权限清单

`manifest.permissions` 里**未列出**的能力调用 → 返回 `{ok:false, error:"permission denied: <cap>"}`；
未知能力抛 `未知能力 <cap>`。

| 能力 | 方法 |
|---|---|
| `storage` | `get` / `set` |
| `notify` | `show` |
| `events` | `subscribe` |
| `git.read` | `status` / `log` / `branches` |
| `tools` | `register`（`write:gate` 在宿主侧套人审门） |
| `webview` | `register` |
| `statusbar` | `register` |

## 入口写法

```js
const sdkDir = process.argv[2];                       // 宿主下发的 sdkDir
const { connectL3 } = require(sdkDir + "/services/extensions/l3-child");

connectL3().then((ctx) => {
  ctx.storage.set("k", "v");
  ctx.registerTool({ name: "hello", description: "hi", execute: () => "hello" });
});
```

`sdkDir` 是编译产物目录（`app/dist`），其中包含 `services/extensions/l3-child.js`。

## 崩溃隔离

子进程异常退出 → 宿主回收该包**全部注册面**，标记 `active.error = "L3 进程异常退出（码 <n>）"`。
其它包与宿主不受影响。

## 何时用 L3 而不是 L2

- 需要**真正的进程隔离**（插件崩溃不影响宿主）
- 只需要少量能力（工具 + 状态栏 + 视图 + 只读 git + 事件）
- 想给插件装 `entrySandbox: "utility"` 作为**审核渠道的信任标记**

反过来，如果你的插件需要 Agent 工具（v4 注册表）、提示词槽位、压缩器、门禁钩子等——
L3 面**没有**，必须用 L2。
