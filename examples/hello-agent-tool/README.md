# hello-agent-tool —— 最小 agent 扩展示例

对应 `docs/agent-harness-v4.md` §14.10 的示例包验收件，演示四个贡献接缝：

| 接缝 | 声明位置 | 生效方式 |
|---|---|---|
| `agentTools`（工具） | manifest `contributes.agentTools` 声明 + L2 `ctx.registerAgentTool` 注册 | agent 循环工具面（命名空间 `ext.com.example.hello-agent.*`，恒授权卡） |
| `promptSections`（提示词槽位） | manifest `contributes.promptSections` 静态段 | 系统提示词 output 槽位（L1 纯数据）；entry 另演示 L2 动态段（context 槽位） |
| `subagentPresets`（子代理预设） | manifest `contributes.subagentPresets` | `task` 工具 mode 枚举出现 `com.example.hello-agent/scout` |
| `registerContextCollector`（采集器） | entry 演示（本例用 promptSection 代替） | 每轮上下文组装时求值 |

## 验证

1. Gitter 设置 → 扩展：导入本目录打包的 .gpk（或开发模式指向本目录）；
2. 新建 agent 任务 → 提问"调用 hello-ping"→ 授权卡出现 `[插件]` 徽标 → 批准 → 返回 `pong @ <时间>`；
3. 任务结束时输出带「Hello from hello-agent-tool 🎉」尾注（promptSection 生效）；
4. 对话输入 `/skill` 无参 → 不列出（技能另属 skills 接缝）；对话派子代理 `task(mode="com.example.hello-agent/scout")` 可用；
5. 停用包 → 工具/提示词/预设全部消失（拔除测试）。
