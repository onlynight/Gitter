# commit-gate

L2 受信代码插件：**门禁钩子 + 状态栏 + 面板 + 提交区块 + diff 注记 + 事件订阅
+ 运行时命令 + 工具 + 生命周期**——把 L2 `PluginCtx` 的 UI 类 API 一次演示完。

> ⚠️ 需要 `settings.allowCodePlugins` 开启（设置 → 扩展 → 允许代码插件，默认 `false`）。

## 演示要点

| API | 说明 |
|---|---|
| `registerGate("commit" \| "push")` | **只能否决，不能篡改**；返回非空字符串 = 拦截，`null` = 放行；**钩子抛异常视为放行** |
| `registerCommitBlock` | 提交对话框区块；**只能提示，不能阻断**（阻断用 gate）；单块失败跳过 |
| `registerDiffNote` | diff 侧栏只读注记；单注记失败跳过 |
| `registerStatusItem` | 状态栏条目 |
| `registerPanel` | 侧栏面板；单面板抛错不拖累其它，渲染为 `（面板出错：<msg>）` |
| `registerView` | 静态 HTML → **沙箱 iframe，无脚本权限** |
| `registerCommand` | 运行时命令，自动加 `ext.commit-gate.` 前缀 |
| `registerTool` | legacy `ToolRegistry`；`write:gate` 仍走人审门 |
| `on(event)` | 事件订阅；事件名是宿主枚举，**插件不能自定义事件源** |
| `ctx.git` / `ctx.storage` / `ctx.notify` | 只读 git API / 插件隔离 KV / 渲染层 toast |
| `return dispose()` | 卸载 / 热重载 / 激活失败回滚时调用 |

## 安全不变量

- **插件提议，执行权在宿主**：命令仍走宿主白名单，工具写操作仍走人审门
- **门禁只能否决**：无法改提交消息、无法改文件集
- **面板/区块/注记单点失败不扩散**：宿主 `try/catch` 吞掉，保证 UI 存活
- **门禁异常 = 放行**：`console.warn` 记录，不阻塞主流程

## 注意：L2 代码读不到 `contributes.configuration`

`contributes.configuration` 的运行值由宿主 `store.configOf` 提供给
**命令模板插值**（`${config.<key>}`）。L2 代码面目前没有读配置值的通道，
所以本示例用 `ctx.storage` 存运行期状态，配置项用来演示 manifest 形态。

要读配置值，用 L1 命令 + 模板插值：

```jsonc
{ "id": "show", "action": "terminal.run",
  "args": { "command": "echo threshold=${config.warnBodyLines}" } }
```
