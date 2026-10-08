# model-profile

L1 模型档案：安装后在 设置 → 模型档案 里出现，填 key（本地端点可留空）即可用。

## 演示要点

| 字段 | 说明 |
|---|---|
| `kind` | `"openai-compatible"` 或 `"anthropic"` |
| `baseURL` | 端点地址 |
| `modelId` | 传给 API 的模型标识 |
| `keyHint` | 设置页提示用户填什么；`null` = 无需密钥 |
| `params.temperature` | 0..2 |
| `capabilities.tools` | 缺省 `true` |
| `capabilities.streaming` | 缺省 `true` |
| `capabilities.contextTokens` | 上下文窗口（驱动压缩策略） |
| `tags` | 展示用标签 |

模型 id 只允许 `/^[a-z0-9][a-z0-9.-]*$/i`。

## 与内置的关系

内置包提供 `gitui.models.deepseek`（deepseek-chat / deepseek-reasoner）与
`gitui.models.ollama`（ollama-local）。本包与它们并列。

> `apiKey` **永远不会下发给插件**——`ctx.registerAiProvider` 的 `AiConfig`
> 里也没有它，宿主在请求侧注入。
