# mcp-bridge

L1 MCP 服务端声明：宿主以 **stdio** 协议拉起外部 MCP server 并接入工具总线。

## 演示要点

- `transport` **只能是字面量 `"stdio"`**（zod `z.literal`，其它值直接拒载）
- `args` 支持 `npx -y <pkg>` 形式的自拉取
- 工具 id 运行时形式：`mcp.mcp-bridge.playwright`

## 安全相关

MCP server 暴露的工具会进入 Agent 工具总线。写类操作走 `approval` 权限域
（`mcp.approve`）——这是全部 RPC 里**最危险的域**：可替人类放行 MCP 写操作。

> 本示例的两个 server 都需要本机有 `npx`。GitHub 那个需要 `GITHUB_TOKEN`
> 环境变量在 Gitter 进程环境里可见。
