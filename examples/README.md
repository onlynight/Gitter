# Gitter 插件示例

每个子目录都是一个可直接安装的插件包（目录名 === `manifest.id`，反向域名）。
文档见 [`../docs/plugin-development.md`](../docs/plugin-development.md) 与
[`../docs/plugin-api.md`](../docs/plugin-api.md)。

| 示例 | 层级 | 演示什么 |
|---|---|---|
| [`com.example.hello-command`](./com.example.hello-command/) | L1 | 最小组：命令 + 配置 + i18n + 模板插值 + when 表达式 |
| [`com.example.agent-skill`](./com.example.agent-skill/) | L1 | 技能（markdown 注入 Agent 系统提示） |
| [`com.example.agent-task-type`](./com.example.agent-task-type/) | L1 | 任务型（promptTemplate / 工具白名单 / 权限收紧） |
| [`com.example.safety-rules`](./com.example.safety-rules/) | L1 | 安全网规则 + 命令风险规则 + Agent 权限规则 |
| [`com.example.theme-pack`](./com.example.theme-pack/) | L1 | 主题包（亮/暗双档 + 材质） |
| [`com.example.model-profile`](./com.example.model-profile/) | L1 | 模型档案 |
| [`com.example.mcp-bridge`](./com.example.mcp-bridge/) | L1 | MCP 服务端声明 |
| [`com.example.git-dashboard-page`](./com.example.git-dashboard-page/) | L1+页面 | 渲染层页面：槽位、权限域、GITTER_UI、GITTER_KIT |
| [`com.example.commit-gate`](./com.example.commit-gate/) | L2 | 门禁钩子 + 状态栏 + 面板 + 提交区块 + diff 注记 + 事件订阅 |
| [`com.example.agent-tool`](./com.example.agent-tool/) | L2 | `ctx.registerAgentTool`（zod 参数、权限档、workDir 收窄） |
| [`com.example.agent-prompts`](./com.example.agent-prompts/) | L2 | 提示词槽位 + 上下文采集器 + 子代理预设 + 压缩器 |
| [`com.example.log-decorator`](./com.example.log-decorator/) | L2 | 日志装饰器 + 预览提供者 + 扫描器 + git 只读 API |
| [`com.example.sandboxed-plugin`](./com.example.sandboxed-plugin/) | L3 | utility 沙箱 + 权限清单 + connectL3 |

## 安装

把目录整体拷到 `<userData>/packages/` 下即可（Windows 通常是 `%APPDATA%/gitter/packages/`），
重启 Gitter。

```bash
cp -r examples/com.example.hello-command %APPDATA%/gitter/packages/
```

或打包成 `.gpk`（zip，`manifest.json` 必须在压缩包根）：

```bash
cd examples/com.example.hello-command
zip -r ../hello-command.gpk manifest.json
```

Gitter → 设置 → 扩展 → 导入扩展包。

> ⚠️ **L2 / L3 代码插件需要 `allowCodePlugins` 开启**（设置 → 扩展 → 允许代码插件）。
> 默认 `false`。L1 数据包与内置页面包不受此门影响。

## 校验

所有示例的 manifest 都通过了宿主 zod 校验器（`app/src/services/extensions/schema.ts`）：

```bash
cd app && npm run build && cd ..
node scripts/check-examples.mjs
```

校验脚本走真实的 `normalizeManifest`，不是另写一份规则；同时检查目录名 === `manifest.id`、
i18n 语言识别、`%key%` 引用完整性、L2/L3 entry 导出形态与权限清单。

## 包 id 约定

校验器强制反向域名（`/^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/`），所以示例统一用
`com.example.*` 前缀。自己的插件请用真实组织域名，例如 `com.acme.deploy`。

## 用脚手架生成

```bash
node scripts/gen-plugin-scaffold.mjs out/com.example.myplugin com.example.myplugin
```
