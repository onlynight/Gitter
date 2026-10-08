# agent-prompts

L2 Agent 提示词与上下文示例：把 Agent 的「脑子里在想什么」拆成可插拔的部件。

> ⚠️ 需要 `settings.allowCodePlugins` 开启。

## 演示要点

| API | 演示 |
|---|---|
| `registerPromptSection` + `content` | 静态提示词段 |
| `registerPromptSection` + `provide` | 动态生成（可 `null` 省略本轮） |
| `registerContextCollector` | 预算感知的上下文注入（README 摘要） |
| `registerSubagentPreset` | 只读子代理预设 |
| `registerTurnHook` | post-turn 审计（todo 未清空提醒） |
| `registerCompactor` | 尾部保留式压缩（覆盖内置） |
| `registerAiProvider` | 自定义 provider 形态 |
| L1 `contributes.promptSections` | 静态段与动态段的对比 |
| L1 `contributes.subagentPresets` | 静态预设与动态预设的对比 |

## 槽位清单（L2 可写）

```
context  workflow  tools  skills  mode  task
free     output   compaction  subagent
```

⚠️ **`identity` 与 `boundary` 锁死，不对插件开放**。用户包贡献 `boundary`
会在同步时被拒（按 `isBuiltIn` 裁决）。

## 关键约束

| 项 | 约束 |
|---|---|
| `contextCollector.tokenBudget` | 缺省 800，预算感知；软失败（抛错返回 `null`） |
| `subagentPreset.tools` | ⊆ 当前工具注册表全集；未知名编译期剔除 |
| `subagentPreset.readonly` | 为真时进一步过滤为只读工具 |
| `subagentPreset.timeoutMs` | L2 运行时夹到 **30_000..600_000**（manifest 层是 30_000..1_800_000，运行时更严） |
| `turnHook` | **只有 post-turn**；产物以 `system-reminder` 注入下一轮，**cap 2000 字符** |
| `compactor` | **单槽覆盖**——活跃的非内置压缩器优先于 `builtin.summarizer` |
| `aiProvider` | **`apiKey` 永远不会下发给插件** |

## 静态段 vs 动态段

```jsonc
// manifest.contributes.promptSections —— 纯文本，L1 即可
{ "id": "tone", "slot": "mode", "order": 40, "content": "回复风格：先结论后依据" }
```

```js
// ctx.registerPromptSection —— 可按仓库/模式动态生成
ctx.registerPromptSection({
  id: "branch_context", slot: "context", order: 20,
  provide: async (env) => {
    const status = await ctx.git.status();
    return `- 工作区改动文件：${status.split("\n").filter(Boolean).length}`;
  },
});
```

L1 段 id → `<pkg>.<id>`；L2 段 id → `ext.<pkg>.<id>`（不同命名空间，不冲突）。

## 生命周期

停用/热重载 → 宿主自动
`unregisterPromptSectionsByPackage` / `unregisterContextCollectorsByPackage` /
`unregisterSubagentPresetsByPackage` / `unregisterTurnHooksByPackage` /
`unregisterCompactorsByPackage` / `unregisterAiProvider`。
