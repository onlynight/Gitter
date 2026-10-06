# Codex Agent Harness 插件化接入设计 v2（对齐插件系统 v2）

> ⛔ **本方案已废止（2026-10-05，v2.0 当日）**：方向性误读——把"做成 agent harness"错解为"适配外部 codex CLI"。正确方向见 **docs/agent-harness.md v3.0（Gitter 自身即 agent 运行时，ZCode/DeepSeek Harness 同构）**。本文件的"外部 CLI 桥"机制（catalog/manifest/事件映射/cli-json 传输）降级为未来可选扩展点封存；事件模型、任务账本、托管 checkpoint、安全模型由 v3.0 继承。已按本文件实现的代码处置清单见 v3.0 §八。
> **实施进度（2026-10-05）：P1 全部 + C1 主进程侧已落地**——`app/src/services/agents/`（types/events/catalog/tasks/checkpoint/prompts/transports/clijson/session）+ PackageStore `contributes.harnesses` 段 + 内置 `com.openai.codex` 包 + 任务页 Agent 卡（渲染层）+ 六个 `agent.*` RPC + `agent.task.*` 宿主动作；无头验收 `npm run build && node dist/smoke-agents.js`（39 项含 cli-json 端到端）。未含：cli-pty/acp/mcp 传输、review.state 拉通道、内置循环包装。
> 变更：v1.x 基于 C#/WinUI3 栈与 .gpk v1；本版随 **WinUI3→Web 迁移**与**插件系统 v2**（docs/extension-system-v2.md）整体重排。上位文档换为 extension-system-v2.md；ai-native-redesign.md §十二降为"概念与接口形状来源"（形状仍有效，落点重排）。**本文自 v2.0 起为 agent 宿主设计的权威版本。**
> 结论先行：**设计骨架零弃用**——四级传输、事件模型、宿主托管 checkpoint、声明式事件映射、会话账本、Codex 包全部具体适配均保留；变化的是形态与落点：harness 从"自定义 kind"变为 **schema v2 的 `contributes.harnesses` 段（L1 纯声明）**；接口从 C# 变为 **TS（zod）**；确认队列并入 **safety.ts 人审门**；MCP 双向统一走 **@modelcontextprotocol/sdk**；并补上与 §十五 agentLoop 的关系界定（Gitter 自有循环 vs 外部 agent 宿主）。

---

## 一、与插件系统 v2 的对位：改动为什么很小

v2 的信任分级表（extension-system-v2 §二）恰好给 harness 留好了位置——**harness 包在 v2 里是 L1 数据包，不是代码插件**：

| v2 信任级 | harness 的用法 |
|---|---|
| L1 声明式贡献 | `com.openai.codex` 包 = 纯 manifest：`contributes.harnesses` 段（transport/detect/spawn/events…）+ 顺带贡献 commands/configuration。**无代码**，宿主内置传输适配器代为执行——正是 v2"数据包先行"的主形态 |
| L2 受信代码 | **宿主自己的**传输适配器（cli-pty/cli-json/acp/mcp）与会话管理/托管 checkpoint——内置自举，不是插件，不占插件信任面 |
| L3 隔离代码 | 仅当第三方 harness 需要声明式映射覆盖不了的自定义协议解析时启用：解析逻辑跑 utilityProcess，经 comlink 只回传**结构化事件**——"解析可下放，执行不下放"，与 §15 agentLoop 的安全不变量同构 |
| 外部进程 | codex exec 本身：同 mcp-server 层级，manifest 是"配置引用"，Gitter 不装载 agent 的代码 |

对位一句话：**harness 包之于传输适配器，恰如 grammar 包之于 GrammarSvc**——宿主持有引擎，包只给数据。

由此，v1 §九"HarnessCatalog 自扫目录"**取消**：统一走 PackageStore，catalog 退化为"消费 PackageStore 注册的 kind 消费者"，与 ThemeSvc/GrammarSvc/CommandReg 并排（v2 §三架构图各就各位）。

**v1.2 → v2.0 变更对照**：

| v1.x（C# 栈） | v2.0（本版） |
|---|---|
| .gpk v1 自定义 `harness` kind + ImportGpk 白名单 | schema v2 `contributes.harnesses`（kinds 由 contributes 推导；`packages[id].kinds` 账本启停） |
| GitUI.Core/Agents（C# record / Flags 枚举） | app/src/services/agents（TS 判别联合 + zod schema 同源） |
| HarnessCatalog 自扫双根目录 | PackageStore 统一扫描注册，catalog 仅消费 |
| 自建"统一确认队列" | 并入 **safety.ts 人审门**（操作目录确认策略为其策略输入） |
| MCP：`gitter mcp serve` 自述 | server 仍 mcp.ts 管道宿主（后续迁 SDK server）；client 侧统一 P4 的 SDK |
| agent-host 独立子进程（H3） | **取消**——Electron 主进程 + Job Object 即崩溃隔离与孤儿回收边界 |
| C 系列独立路线 | 并入 v2 P1/P3/P4/P4.5/P5 阶段（§十） |
| （无） | 与 §15 agentLoop 的关系界定 + "内置循环包装为 harness"决策门（§五） |

---

## 二、包格式：contributes.harnesses（schemaVersion 2）

```jsonc
{
  "schemaVersion": 2,
  "id": "com.openai.codex",
  "name": "OpenAI Codex CLI",
  "version": "0.2.0",
  "engines": { "gitter": ">=0.6.0" },
  "contributes": {
    "harnesses": [{
      "id": "codex",                              // 包内 id，全限定 com.openai.codex/codex
      "transport": "cli-json",
      "fallback": "cli-pty",
      "detect": { "command": "codex", "args": ["--version"], "versionPattern": "codex-cli\\s+0\\.\\d+" },
      "spawn": {
        "command": "codex",
        "args": ["exec", "--json", "--skip-git-repo-check", "--cd", "{worktree}", "--sandbox", "{sandbox}", "-"],
        "promptStdin": true,
        "env": { "GITUI_HARNESS": "com.openai.codex", "GITUI_TASK": "{taskId}" }
      },
      "resume": {
        "args": ["exec", "resume", "{externalSessionId}", "--json", "--cd", "{worktree}", "--sandbox", "{sandbox}", "-"],
        "promptStdin": true
      },
      "stop": { "mode": "kill" },
      "capabilities": ["structured-events", "session-diff", "file-watch", "feedback-channel", "resume", "prompt-submission"],
      "submissionMode": "next-turn",
      "hostServices": ["host-checkpoints"],
      "identity": { "assistedBy": "codex" },
      "permissions": { "gitWrite": ["repo.stage", "repo.commit"], "outsideWorktree": false, "network": "model-endpoint" },
      "promptTemplates": { "preamble": "…", "feedback": "…" },
      "events": { "lineFormat": "jsonl", "externalId": "$.thread_id", "rules": [ "…同 v1.2 §五…" ], "unmatched": "log" }
    }],
    "commands": [
      { "id": "codex.newTask", "title": "新建 Codex 任务", "when": "repoOpen", "action": "agent.task.create", "args": { "harness": "codex" } },
      { "id": "codex.resumeLast", "title": "续跑上次 Codex 会话", "when": "repoOpen", "action": "agent.task.resume" }
    ],
    "configuration": [
      { "key": "agents.codex.model", "type": "string", "default": "" },
      { "key": "agents.codex.sandbox", "type": "string", "enum": ["read-only", "workspace-write", "danger-full-access"], "default": "workspace-write" }
    ]
  }
}
```

- **kinds 由 contributes 推导**（v2 §五）：本包即 harness + commands + configuration 三个 kind，账本 `packages["com.openai.codex"].kinds` 按 kind 分别启停——停用 harness kind 即从任务卡移除，停用 commands kind 即命令面板消失。contributes 段清单在 v2 §五（theme/grammar/commands/configuration/aiProvider）基础上**新增 `harnesses`**，属 schema 的加段演进，内核 zod schema 加一个可选段即可；
- **v2 贡献点红利**（v1 没有）：装包即得"新建 Codex 任务"命令（L1 受限命令，`action` 只能引用宿主动作 `agent.task.*`——由本方案在 CommandReg 注册）+ 设置页按 configuration schema 自动渲染模型/沙箱选择。Codex 包自身**零代码**；
- `permissions.gitWrite` 直接引用 **tool-agent-fusion.md 的操作目录 id**（v1.2 既定的收敛在此完成），manifest 校验对目录做合法性检查；
- `events` 段与 v1.2 §五完全一致（JSONPath 子集声明式映射、`unmatched: log` 兜底、versionPattern 门控），求值器是宿主纯函数——仍属 L1 数据，不是脚本；
- 旧 v1 harness 包（若有）随 C# 栈废弃，不设迁移分支（v1 从未实施，无存量）。

---

## 三、模块落点（Electron 主进程）

```
app/src/services/agents/
├── types.ts        # 接口与事件模型（§四）；zod schema 与 TS 类型同源
├── catalog.ts      # PackageStore 的 harness kind 消费者：harnesses 段 zod 校验、
│                   #   detect 探测缓存 + versionPattern 门、LaunchSpec 编译（占位符校验）
├── session.ts      # SessionManager：生命周期、事件扇出（经 preload bridge 到渲染层）、崩溃标记
├── tasks.ts        # AgentTaskStore：.git/gitter/agent-tasks.json（账本沿用 v1.2 §四）
├── checkpoint.ts   # HostCheckpointService：turn-completed + 文件监视静默 → git 服务层 add -A && commit（trailer 代打）
├── events.ts       # HarnessEventMap 求值器：JSONPath 子集，纯函数（黄金用例测试）
└── transports/
    ├── pty.ts      # cli-pty：node-pty（迁移后终端基座，以 winui3-to-web-migration.md 为准）
    ├── json.ts     # cli-json：child_process 管道 + 逐行 JSONL
    ├── acp.ts      # H2 预留（适配器成熟度门）
    └── mcp.ts      # 复用 P4 的 @modelcontextprotocol/sdk client
```

- **PackageStore 内核零改动**：store.ts 的 manifest zod schema 增加可选 `harnesses` 段 + 注册通知——性质与 grammars/commands 段相同，是数据不是宿主逻辑，"每一层用现成的成熟开源件，Gitter 只写领域胶水"不被破坏；
- **进程治理**：主进程 spawn + Windows Job Object（KILL_ON_JOB_CLOSE）/tree-kill 承担崩溃隔离与孤儿回收——Electron 主进程本身已是独立进程，v1 设想的"agent-host 子进程化"（H3）**取消**；"Gitter 退出时终止/保留会话"为 settings 项（`agents.onExit`）；
- GitWorker 的对应物是迁移后 git 服务层的串行任务队列；托管 checkpoint 与账本刷新统一入队，不与前台操作争抢；
- 文件监视（改动中计数 / checkpoint 静默确认 500ms）用迁移后 watcher 服务（chokidar 类，以迁移文档为准）。

---

## 四、接口（TS 形状，zod 为准）

C# §12.4 v1.2 的形状一一对应平移。映射约定：**record → interface、Flags 枚举 → 字符串字面量联合（与 manifest 直接互转）、TaskCompletionSource → 宿主侧 deferred Promise、C# event → EventEmitter**：

```ts
// app/src/services/agents/types.ts（节选；完整字段清单 = ai-native-redesign.md §12.4 v1.2）
export type HarnessTransport = 'cli-pty' | 'cli-json' | 'acp' | 'mcp';
export type HarnessCapability =
  | 'structured-events' | 'checkpoints' | 'session-diff' | 'feedback-channel'
  | 'permission-prompts' | 'resume' | 'prompt-submission' | 'file-watch';
export type SubmissionMode = 'none' | 'next-turn' | 'streaming';

export interface HarnessDescriptor {
  id: string;                 // 全限定 com.openai.codex/codex
  packageId: string;
  displayName: string;
  transport: HarnessTransport;
  fallback?: HarnessTransport;
  capabilities: HarnessCapability[];
  submissionMode: SubmissionMode;
  identity: { assistedBy: string };
  versionPattern?: string;
}

export type AgentSessionEvent =
  | { type: 'status'; phase: AgentPhase; summary?: string }
  | { type: 'output'; text: string; stream: 'terminal' | 'assistant' | 'tool' }
  | { type: 'checkpoint'; commitSha: string; summary: string }
  | { type: 'permission'; request: PermissionRequest; requestId: string }
  | { type: 'question'; question: string; options: string[]; requestId: string }
  | { type: 'completed'; outcome: 'completed' | 'failed' | 'cancelled'; summary?: string }
  | { type: 'session-meta'; externalSessionId: string }
  | { type: 'file-change'; path: string; kind: 'added' | 'modified' | 'deleted' | 'renamed'; summary?: string }
  | { type: 'turn-completed'; usage?: TurnUsage; lastMessage?: string }
  | { type: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; text: string };
```

- 事件跨 preload bridge 送达渲染层（React 任务页）：判别联合结构化克隆安全；**`permission/question` 的 `reply` 回调留在宿主**——渲染层只拿 `requestId`，经 invoke 回传决定，授权逻辑不过桥；
- 其余记录（AgentStartOptions / AgentTaskRecord / PermissionRequest / PermissionDecision / ReviewFeedback / TurnUsage / AgentTaskState…）字段与 v1.2 完全一致，同构平移不重复罗列；`IHostCheckpointService` → `checkpoint.ts`，宿主侧服务（catalog/session/tasks/checkpoint）仍为"Core 契约 + App 实现"模式的 TS 版（契约即 types.ts，实现即 services/agents）。
- **与 C# 冻结实现的衔接**：`src/GitUI.Core/Agents/AgentHarness.cs`（H 系列，已冻结）是同形状的在途 C# 实现——枚举/接口与本节一一对应；Web 栈落地按本节映射平移即可，C# 版随栈处置（归迁移文档裁决），不构成第二权威。

---

## 五、与 §十五 agentLoop 的关系（本版最重要的概念对齐）

v2 已给出 Gitter **自有 agent 主循环**的设计（P4.5，Vercel AI SDK）；harness 是**外部 agent 宿主**。两者是不同物种，共用一个框架与一个安全不变量：

| | agentLoop（v2 §15） | harness（本方案） |
|---|---|---|
| 循环跑在哪 | Gitter 主进程（Vercel AI SDK 多步工具循环） | 外部进程（codex exec 自带循环） |
| Gitter 的角色 | 自己开循环干 git 任务（提交消息/审查/冲突助手） | 监督者 + 验收台 |
| 决策/执行分离 | 决策在循环（可下放 L3），执行（工具调用/模型代理/人审门）永在宿主 | 决策在 codex（本就 Gitter 之外）；经 Gitter 通道的写受人审门，直跑 git 由其 sandbox + 验收台弱标注兜底 |
| 贡献形态 | `ctx.registerAgentLoop`（L2，host.ts 第三注册动词） | `contributes.harnesses`（L1 数据包） |
| 第三方自定义 | 循环本体替换仅 L3（utilityProcess） | 声明式映射为主；自定义协议解析 L3 |
| 验收出口 | 同一验收台 / review.state / 会话卡 | 同左 |

- **安全不变量统一表述**："**决策/解析可下放，执行不下放**"——§15 用在循环上，本方案用在解析器上，同一把尺子；L3 插件（无论循环还是解析器）拿到的只有数据（工具结果/协议帧），碰不到执行器（git 写/模型代理/进程治理）；
- **汇合点（独立决策门，暂不实施）**：内置 agentLoop 可包装为一个**内置 harness**（transport 增 `'loop'`，L2 自举注册）接入同一任务卡——"新建任务 → 选一个 agent"列表里，内置循环与 Codex 并排，任务卡不区分内外部 agent。这让 §15 的循环立刻获得 worktree 隔离、会话基线与验收流，是两个设计的自然汇合；因 transport 模型要扩一位，留作 P4.5 落地后的独立评估，不在本期承诺。

---

## 六、安全与确认：safety.ts 为唯一写门

v1.2 的"统一确认队列"不再自建——**并入 safety.ts 人审门**（v2 §十一既定："写操作一律复用 safety.ts"）：

- 工具面操作目录（tool-agent-fusion.md §三）的确认策略（Auto / Session / EachTime）成为 safety.ts 的**策略输入**：agent 经 Gitter 通道的写（MCP 工具调用、`agent.task` 类宿主动作、反馈投递）一律过门；Session 记忆范围 = agent 身份 × 操作 × 任务卡；EachTime 永不记忆；
- 呈现层在渲染层：任务卡内联授权卡 / 变更页横幅；本方案只定义事件与 requestId 协议（§四），不复刻 UI 状态机；
- mcp.ts 既有的人审门保持——MCP server（拉通道）与 harness（推通道）两条路同门，"人保留 git 写路径最终决定权"在架构上单点成立；
- 其余沿用 v1.2 §八：env denylist（剔除 GH_TOKEN 等凭据类 + 注入 GITUI_* 标记）、spawn cwd 锁任务 worktree、诚实边界（codex 直跑 git 管不住，靠 sandbox 默认 workspace-write + preamble 软约束 + 验收台 trailer/时间窗弱标注兜底）、隐私明示（任务内容将进入所选 agent 的模型端点，首次启用确认卡）。

---

## 七、MCP 与 AI provider 对位

- **mcp 传输**：复用 P4 的 `@modelcontextprotocol/sdk` client（对接暴露工具接口的 agent）；Gitter 对外的 server 仍是 mcp.ts 管道宿主（含人审门），后续按 v2 §十迁 SDK server 形态。双向同 SDK 后，"agent 用 Gitter"（拉通道）与"harness 宿主 agent"（推通道）共享一条管道层——v1.2 §7.2 的互补论断不变；
- **IAiGateway 的归宿**：ai-native-redesign §8.1 的四类 provider 由 v2 P4 的 `ctx.registerAiProvider` 注册表承接（内置 openai/anthropic/cli 自举，CliBridge 语义保留）。harness **不走** provider——外部 agent 自带模型与 auth（~/.codex）；provider 接缝服务的是反馈措辞生成、AI 批注等一次性补全。两个接缝各司其职，不得混用。

---

## 八、任务卡 UI 与账本（渲染层）

- 任务页为渲染层 React 页面（与 SettingsPage 扩展卡片同栈），经 bridge 消费会话事件流；三态任务卡 / 会话时间线 / 内联授权卡 / 变更页 review.state 条的交互以 **docs/gitter-fused-preview.html**（可点击原型）为 UI 事实规格；
- 账本 `.git/gitter/agent-tasks.json` 沿用 v1.2 §四：ExternalSessionId 为 resume 键、BaselineSha 为会话基线、Gitter 重启标 `Interrupted` 提供续跑/放弃；
- 命令面板数据源 = CommandReg（P3）：codex 包的 `commands` 贡献自动出现，无需手写面板项；`agent.task.create / agent.task.resume` 等宿主动作由本方案注册进 CommandReg（内置命令同一 manifest 形态，自举）；
- 设置页：全局 Agent 节（默认 harness per project、默认沙箱、托管 checkpoint 开关、onExit、env denylist）走 settings；包启停走 `packages[id].kinds` 账本——harness kind 停用 → SessionManager 提示运行中会话收尾（v2 §五启停语义）。

---

## 九、Codex 适配细则（自 v1.2 §六原样沿用，索引）

以下内容与栈无关，v1.2 文字继续有效，不重抄：

- **执行模型分工**：codex 改文件/跑命令/出总结；checkpoint 归宿主代打（`host-checkpoints`，任务卡开关；用户显式放行 agent 自行提交时自动让位）；语义提交（squash）归人；
- **exec JSONL → 事件映射表**：`thread.started`→session-meta、`item(command_execution)`→status、`file_change`→file-change、`turn.completed`→turn-completed（checkpoint 触发点）、`turn.failed`→failed、`thread.completed`→completed；字段名以实测版本为准，映射在包内声明，协议漂移由包升级吸收、`unmatched: log` 永不崩溃；
- **沙箱三档映射**：ReadOnly→`--sandbox read-only`；WorkspaceWrite→`workspace-write`（默认）；FullAccess→`danger-full-access`（警示色 + 二次确认）；审批 on-failure 退回终端逃生舱；exec 形态无运行中审批，`permission-prompts` 恒 false，不伪装；
- **resume/账本**：thread id 落账本，续跑 = `exec resume {id}`；反馈直投 = resume 起修复轮（NextTurn，§3.4 v2 提前落地）；
- **preamble 软约束**：worktree 边界 / 禁破坏性 git / 默认不自行提交（与 `gitWrite` 白名单双保险）；真正的硬边界是 codex 自身 sandbox + Gitter 路径校验；
- **MCP 互操作**：一键向 `~/.codex/config.toml` 合并 `[mcp_servers.gitter]`（备份、只动 gitter 键；依赖 mcp.ts server，随 P4 对齐）。

---

## 十、路线（并入 v2 阶段，替代 v1 C 系列）

| v2 阶段 | harness 相关交付 | 原 v1 对应 |
|---|---|---|
| **P1**（PackageStore） | `contributes.harnesses` zod 段 + catalog/detect/versionPattern 门 + 设置页按 kind 启停；任务卡只读骨架（账本驱动） | C0 接口与目录部分 |
| **P1 后可随时** | cli-pty/cli-json 适配器 + Codex 实测 JSONL 采样固件 + 事件映射快照 + HostCheckpoints + 反馈直投（NextTurn） | C1 |
| **P3**（CommandReg） | `agent.task.*` 宿主动作注册；codex 包 L1 命令自动入面板 | C0 UI 部分 |
| **P4**（MCP + provider） | mcp 传输 + config.toml 一键接入 + review.state 拉通道 | C2 前半 |
| **P4.5** | agentLoop 内置循环；"内置循环包装为 harness（transport `'loop'`）"决策门（§五） | 新增 |
| **P5**（PackageHost） | L3 第三方协议解析通道（utilityProcess + comlink，解析/执行分离） | C3（agent-host 子进程化取消） |

H 系列编号并入此表后废止；H2 ACP 维持"适配器成熟度门"（`codex acp` / codex-acp 可用时启用 permission-prompts 与 Streaming 注入）。

---

## 十一、测试与风险

- 测试（栈以迁移后为准）：events 求值器黄金用例；真实 `codex exec --json` 采样 JSONL 固件快照；manifest zod 负样本（拒载 + 错误账本可见，坏包不拖累他包——v2 PackageStore 语义免费获得）；safety 门策略表驱动；账本序列化往返；降级守卫（禁用全部 harness + 关 MCP，全功能回归）；
- 风险沿用 v1.2 §十全表（JSONL schema 漂移 / exec 无运行中审批 / 中断恢复 / agent 绕过宿主自行 git / PTY 后端差异），新增一条：

| 风险 | 对策 |
|---|---|
| node-pty 终端基座与迁移进度耦合 | cli-json 主形态不走 PTY；cli-pty 仅降级形态，以迁移后终端服务就绪为准 |

---

## 十二、明确不做（继承 + 增补）

继承 v1.2 §十一全部：不内置/不分发 Codex 二进制、不代理其登录与 key；不做 inline chat / 代码补全；不伪装权限弹窗能力；AI 输出零 git 污染（trailer 白名单之外）。增补：

- harness 包**不引入 L2/L3 代码形态**——声明式覆盖不了的协议走 L3 解析通道（回传事件），不开放"插件自己写传输适配器"；
- 内置循环与 harness **不做运行时互换**——仅任务卡层面统一呈现（§五决策门）；
- Cordis 不引入（v2 §四结论延续：三触发信号未命中）；LangGraph 不引入（git 任务型 agent 时程短，§15 结论延续）。
