# agent-skill

L1 技能包：`contributes.skills[].instructions` 是 markdown 正文，由 Agent 循环注入系统提示。
**纯数据，安全，不需要 `allowCodePlugins`。**

## 演示要点

- 两个技能共存（一个详尽、一个精简）
- `tools` 是**提示层引用，非强制**——真正的工具白名单请用
  [`../com.example.agent-task-type`](../com.example.agent-task-type/) 的 `taskTypes[].tools`

## 技能 id

```
ext.agent-skill.review-checklist
ext.agent-skill.concise-reply
```

宿主通过 `skills.list` RPC 暴露给渲染层，由 AgentLoop 在组装系统提示时注入。

## 与 L2 提示词槽位的区别

| | `skills`（本示例） | `promptSections`（[`../com.example.agent-prompts`](../com.example.agent-prompts/)） |
|---|---|---|
| 层级 | L1 纯数据 | L1 声明 或 L2 动态 |
| 注入位置 | 技能区（可被 Agent 选择性使用） | 系统提示的固定槽位 |
| 动态内容 | ❌ 静态 markdown | ✅ `provide(ctx)` 可按仓库/模式生成 |
