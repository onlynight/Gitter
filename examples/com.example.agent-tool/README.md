# agent-tool

L2 Agent 工具示例：让 Agent 能调用你写的自定义工具。

> ⚠️ 需要 `settings.allowCodePlugins` 开启。

## 关键：L1 声明 ≠ 可执行

`contributes.agentTools` **只是声明**（用于能力展示/校验），不会让工具可执行。
真正注册执行体必须在 L2 entry 里：

```js
ctx.registerAgentTool({ id, description, parametersSchema, permissionClass, execute });
```

manifest 里的声明与本文件注册的工具**同名并列**，声明负责展示，`registerAgentTool`
负责执行。

## 工具名与权限档

```
ext.agent-tool.word-count        auto        纯计算，免询问
ext.agent-tool.recent-commits    auto        只读 git，免询问
ext.agent-tool.open-link         each-time   有副作用，每次询问
ext.agent-tool.slow-probe        auto        演示 AbortSignal
```

权限档 `auto | session | each-time`，**缺省 `each-time`**（最严）。

## ⚠️ 上下文刻意收窄

`execute(args, env)` 的 `env` **只有两个字段**：

```ts
env.workDir: string     // 当前 worktree
env.signal: AbortSignal
```

拿不到：

- `emit` / `requestPermission` —— 无法主动弹授权卡
- `askUser` / `submitPlan` / `setTodos`
- `spawnSubtask` / `shells` / `readLog`
- 主代理的上下文与历史

**原因**：Agent 工具可能被模型自由组合调用，给全量 `ToolEnv` 等于把整个会话
引擎交给插件。宿主刻意只给最小组合。

**要弹授权卡怎么办？** 用 L1 命令 + `terminal.run`（宿主自带首跑确认），
或用页面 + `pageSdk.call("mcp.approve")` 走 `approval` 域。

## 参数 schema

```js
const { z } = require("zod");
parametersSchema: z.object({
  limit: z.number().int().min(1).max(50).default(10).describe("提交条数"),
})
```

非 zod 实例 → 降级为 `z.object({})`（无参数）。
`describe()` 会进入模型的 function calling schema。

## 中止传播

长任务应尊重 `env.signal`：

```js
for (let waited = 0; waited < ms; waited += 250) {
  if (env.signal.aborted) return `（已取消，已等待 ${waited}ms）`;
  await sleep(250);
}
```

## 与内置工具的关系

插件工具与内置工具**同一条入表路径**（v4 `AgentToolRegistry`），无特权区分。
`buildToolset` 统一执行：规则 deny → 模式/权限档授权 → execute。

> `git_push` 恒为 `each-time`，无法放宽。
> `taskTypes[].tools` 白名单生效——白名单外的工具 Agent 看不到。

## 生命周期

激活失败 → 宿主回滚本文件已注册的全部面，标记 `error`，其它包不受影响。
停用/热重载 → `unregisterAgentToolsByPackage("ext.agent-tool")` 自动清理。
