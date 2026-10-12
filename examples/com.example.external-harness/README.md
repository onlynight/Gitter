# com.example.external-harness（M3.3 外部任务类型示例）

Gitter 的"外部 harness"通道示例：任务创建时选择本包贡献的 `echo-agent`，
Gitter 会在任务 worktree 里以 cli-json 传输拉起 `spawn.command`，
stdout 逐行 JSONL 经 manifest 的 events 规则映射进任务时间线，
进程退出码合成终态（0 → completed / 非 0 → failed），隔离 worktree 下自动打托管 checkpoint。

## 接入真实外部 agent

1. 把 `echo-agent.js` 换成真实 CLI（或改 `spawn.command`/`args`）；
2. 按该 CLI 的输出协议改 `events.rules`（when 表达式 + emit 形状见 docs/agent-harness-v4.md §十五）；
3. `detect` 校验本机可用性（--version + versionPattern）；
4. 支持续跑的 CLI 填 `resume.args`（`{externalSessionId}` 占位符由 Gitter 回填）。

## 使用

设置 → 扩展 启用本包 → 任务页新建任务时选择 harness「Echo Agent」；
或 headless：`npm run cli -- run --repo <path> -p "..." `（内置循环）。
