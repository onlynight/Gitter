# Codex Agent Harness 插件化接入设计

> 状态：设计提案 v1.0（2026-10-05），**仅设计方案，未动任何代码**
> 上位文档：docs/ai-native-redesign.md v1.1（本方案落实其 §十二，并给出首个 harness 包 `com.openai.codex` 的完整适配设计）
> 结论先行：§12.4 预留接口**骨架可用**（IAgentHarness / IAgentSession / 事件模型 / 四级传输方向正确），但要在 Gitter 现有代码上真正宿主 Codex，需 **7 处扩展**（§四）与 **5 项 .gpk 配套改造**（§九）；其中最关键的补强是：宿主侧托管 checkpoint（`HostCheckpoints`）、声明式事件映射（manifest 驱动，无脚本）、会话账本与 resume 键、以及 `AgentStartOptions` 等被引用但未定义的记录。

---

## 一、目标与范围

**做什么**：让 Gitter 以"宿主（harness 的本义）"身份接入 OpenAI Codex CLI——用户在 Gitter 里"新建任务 → 自动建 worktree → 派活给 Codex → 实时看事件流 → 验收会话 diff → 退回重做"，Codex 品牌只是任务卡上一个可插拔选项（.gpk `harness` kind 包），核心零绑定。

**明确对齐的三条上位原则**（ai-native-redesign §1.2，本方案全程遵守）：

1. 本地优先：Gitter 不托管 Codex 的 key/auth（Codex 用自己的 `~/.codex`），不内置 Codex 二进制，探测不到就置灰并提示安装方式；
2. 人保留 git 写路径最终决定权：默认配置下 **Codex 不打 git 提交**，checkpoint 由 Gitter 宿主代打（可关），合并/清理必经任务卡确认；
3. 降级为零依赖：Codex 不在场时任务卡照常工作（手动开终端派活），所有 AI 能力有非 AI 兜底形态。

**不做什么**（沿 §九边界）：不做 inline chat / 代码补全；不做 PR 协作；AI 生成的解释不写入仓库（trailer 署名除外）。

---

## 二、现状核对：预留接口 vs 代码现实

设计前先对齐代码事实（本轮勘察结论），避免方案悬空：

| 事项 | 文档假设 | 代码现实 | 对本方案的影响 |
|---|---|---|---|
| `GitUI.Core.Agents` 命名空间 | §12.4 预留了完整接口草案 | **零命中**，纯文档 | 接口按 §四 扩展后首次落地 |
| .gpk 支持的 kind | 已有框架，将加 `harness` kind | 仅 `theme`/`syntax`；`ThemeService.ImportGpk`（ThemeService.cs:196）**拒绝未知 kind** | §九 需放开白名单 + manifest 增 harness 段模型 |
| `PackageManifest` 模型 | manifest 已建模 | ThemeModels.cs:8，**只有 `theme` 段被建模**，其余字段靠 JsonDocument 即席读取 | harness 段需新增强类型 section（可选段，向前兼容） |
| `PackageRegistryState.DisabledKinds` | "包id:种类"天然兼容 | ✅ 属实（GitUI.Core/Extensions/PackageRegistryState.cs），SettingsPage 开关 UI 未知 kind 会显示但无加载方 | 复用；补 harness 标签与 rescan 钩子 |
| 终端会话层 | "ConPTY 既有能力" | ✅ `ITerminalSession`/`ConptySession`（GitUI.Shell）支持 **cwd + 环境变量注入**，`OutputReady` 可订阅，UI 无关 | `cli-pty` 形态与"终端逃生舱"直接可用；任务卡可独立实例化，不受 TerminalPage 单会话限制（TerminalPage.cs:32 仅持一个 `_session`） |
| git worktree 能力 | §6.1 已列为欠账 | `IRepositoryService` **无任何 worktree/fetch/stash/reset 方法**（仅 Unstage 内部用 `reset -q HEAD --`） | C0 必须先补 worktree 最小集（§4.5） |
| GitWorker | "代码已有未接线" | ✅ 属实（GitUI.Git/GitWorker.cs，串行队列，仅测试引用） | 托管 checkpoint / 账本刷新等后台 git 操作统一入队 |
| 进程spawn 范式 | — | `LibGit2RepositoryService.RunGit`（:630，同步、UTF-8、`-C workDir`）可作参数范式；agent 进程走 `ConptySession`（PTY）或专用管道进程（exec JSON） | §五 传输适配层的实现底座 |
| 命令面板 | "@ai 分类可扩展" | `CommandItem`/`CategoryOrder`/`BuildCommands` 全在 MainWindow.xaml.cs（:733/:751/:771），加分类零阻力 | §七 加"任务"分类 |
| 多窗口 | "机制现成" | `App.OpenNewWindow()`（App.xaml.cs:135）存在，但**无"打开指定 worktree"重载** | 小扩展：双击任务卡开对应 worktree 窗口 |
| UI 框架 | （文档未明说） | **WinUI 3**（Microsoft.UI.Xaml），非 WPF | 无实质影响，仅措辞 |

---

## 三、总体架构

```
┌────────────────────────── GitUI.App (WinUI 3) ──────────────────────────┐
│  TasksPage(新) + TasksViewModel        任务卡 / 会话时间线 / 内联授权卡    │
│  MainWindow: 导航"任务"项 · 命令面板"任务"分类 · 设置页 Agent 节         │
│  App.AgentHost：IAgentCatalog / IAgentSessionManager / IAgentTaskStore   │
└──────────┬──────────────────────────────┬──────────────────────────────┘
           │ 事件扇出(UI线程封送)           │ git 写（经 GitWorker 队列）
┌──────────▼──────────────┐   ┌────────────▼───────────────────────────┐
│ GitUI.Shell（纯 C#）     │   │ GitUI.Git                              │
│  传输适配器（内置四个）   │   │  IRepositoryService + worktree 最小集   │
│  CliPty → ConptySession  │   │  + IHostCheckpointService 实现          │
│  CliJson → 管道进程+解析 │   └────────────────────────────────────────┘
│  Acp/Mcp → H2/P5 预留    │
└──────────┬──────────────┘
           │ 编译自 manifest 的 HarnessLaunchSpec
┌──────────▼──────────────────────────────────────────────────────────────┐
│ GitUI.Core/Agents：§12.4 接口（扩展版）+ 声明式事件映射求值器（纯函数）   │
│ GitUI.Core/Extensions：.gpk harness 包扫描/启停（复用 PackageRegistryState）│
└─────────────────────────────────────────────────────────────────────────┘
           ▲
   %APPDATA%\GitUI\packages\com.openai.codex\manifest.json（.gpk harness 包）
   <App>\Packages\（内置目录，可随 Gitter 附带参考 harness 包，可选）
```

分层守卫（延续 DependencyCheckTests 风格）：Core.Agents 不依赖 UI 与 Shell；Shell 不依赖 App；事件模型是 Core 与 Shell 之间的唯一契约——传输细节（Codex JSONL、ACP JSON-RPC）被适配器消化，核心只见 `AgentSessionEvent`。

**一次任务的完整数据流**（Codex / cli-json 形态）：

新建任务 → catalog 列出探测到的 harness → `IRepositoryService.CreateWorktree` 拉出 `task/<slug>` → 记录 baselineSha → `IAgentHarness.StartSessionAsync` → CliJsonAdapter 拼装命令行（manifest `spawn` + `{worktree}`/`{sandbox}` 模板注入）→ 子进程 stdout JSONL 逐行 → **声明式事件映射**（manifest `events.rules`）→ `AgentSessionEvent` 流 → SessionManager 扇出：任务卡时间线 / 状态徽标 / §7.3 活动指示；`turn.completed` → **HostCheckpointService** 在任务 worktree 代打 WIP 提交（trailers 齐全）→ 会话时间线推进（§5.1 数据源）→ 结束事件 → 变更页横幅"agent 已完成，查看会话 diff"（§3.1 会话基线）→ 审查中 hunk 级"退回重做"→ `SubmitFeedbackAsync` → adapter 以 `exec resume {id}` 起下一轮。

---

## 四、预留接口的扩展设计（对 §12.4 的 7 处 delta）

§12.4 的 `IAgentHarness` / `IAgentSession` / `HarnessDescriptor` / 事件继承骨架 **保持不变**，以下为必要的扩展。逐条给出理由。

### 4.1 定义被引用但缺失的记录（delta ①）

`AgentStartOptions`、`PermissionRequest`、`PermissionDecision`、`AgentSessionEventArgs` 在 §12.4 被引用但未定义；`AgentPhase`、`AgentStreamKind`、`AgentOutcome` 同样悬空。补全如下（签名以实施为准）：

```csharp
namespace GitUI.Core.Agents;

public sealed record AgentStartOptions(
    string TaskId,                        // 关联任务卡与账本条目（§6.4）
    string WorktreePath,                  // 强制：spawn cwd（permissions.outsideWorktree=false 时校验）
    string? Prompt,                       // 首轮任务描述，经 stdin（避免命令行转义）
    string? ResumeSessionId,              // 非空 = 续跑外部会话（Codex thread id）
    string? Model,                        // harness 语义的模型/力度选择（如 "gpt-5-codex/high"）
    AgentSandboxPolicy Sandbox,           // 映射到 codex --sandbox（§6.3）
    IReadOnlyDictionary<string, string>? Environment,   // 附加 env（白名单过滤后）
    string? Preamble);                    // 宿主注入的任务约定前置（§6.5，Core 纯函数拼装）

public enum AgentSandboxPolicy { ReadOnly, WorkspaceWrite, FullAccess }

public sealed record PermissionRequest(
    PermissionKind Kind, string Title, string Detail,
    string? Command, IReadOnlyList<string> AffectedPaths,
    TaskCompletionSource<PermissionDecision> Reply);
public enum PermissionKind { Command, GitWrite, Network, OutsideWorktree, FileWrite }
public sealed record PermissionDecision(bool Allow, bool RememberForSession);

public sealed record AgentSessionEventArgs(string SessionId, AgentSessionEvent Event, DateTimeOffset Timestamp);

public enum AgentPhase { Starting, Thinking, Editing, RunningCommand, RunningTests, AwaitingInput, Idle, Finished }
public enum AgentStreamKind { Terminal, Assistant, Tool }
public enum AgentOutcome { Completed, Failed, Cancelled }
```

### 4.2 事件模型扩展（delta ②）

§12.4 的 6 个事件覆盖了状态/输出/checkpoint/权限/问答/完成，但驱动"任务卡时间线 + 托管 checkpoint + 会话账本"还缺五类。**新增**：

```csharp
// 外部会话号到达（Codex thread.started）——resume 的键，落账本
public record AgentSessionMetaEvent(string ExternalSessionId) : AgentSessionEvent;

// 文件级变更（Codex file_change item）——任务卡"改动中 N 文件"实时计数 + 时间线
public record AgentFileChangeEvent(string Path, FileChangeKind Kind, string? Summary) : AgentSessionEvent;
public enum FileChangeKind { Added, Modified, Deleted, Renamed }

// 轮次边界——HostCheckpoints 的触发点；携带用量与末条 agent 消息（卡面摘要）
public record AgentTurnCompletedEvent(TurnUsage? Usage, string? LastMessage) : AgentSessionEvent;
public sealed record TurnUsage(int? InputTokens, int? OutputTokens, int? CachedTokens);

// 兜底日志：未匹配的协议帧、探测/启动诊断——前向兼容的落点
public record AgentLogEvent(AgentLogLevel Level, string Text) : AgentSessionEvent;
public enum AgentLogLevel { Debug, Info, Warn, Error }
```

设计动机：Codex **默认不打 git 提交**（见 §6.2），§12.4 的 `AgentCheckpointEvent` 对它恒不触发——若不补 `AgentTurnCompletedEvent` 与宿主侧 checkpoint，§五"会话感知历史"对 Codex 完全断链。`AgentLogEvent` 则是声明式映射"未知帧不丢弃"的降级出口，直接决定协议漂移时的健壮性。

### 4.3 能力与传输枚举扩展（delta ③）

```csharp
[Flags]
public enum HarnessCapability
{
    // …§12.4 原 7 位不变…
    FileWatch = 1 << 7,   // 事件流含文件级变更（file-change 类）
}

public enum HarnessTransport { CliPty, CliJson, Acp, Mcp }   // 不变

// 新增：指令追加的语义分级（原 PromptSubmission 注释"向运行中会话追加指令"过粗）
public enum HarnessSubmissionMode
{
    None,        // 一次性运行，不可追加
    NextTurn,    // 轮次间追加：以 resume 新起一轮（Codex exec 形态）——FeedbackChannel 的实现载体
    Streaming,   // 运行中即时注入（ACP 全双工，H2）
}
```

`HarnessDescriptor` 相应扩展（新增三成员，其余不变）：

```csharp
public sealed record HarnessDescriptor(
    string Id, string DisplayName,
    HarnessTransport Transport,
    HarnessTransport? FallbackTransport,          // 新增：降级形态（cli-json 失败 → cli-pty）
    IReadOnlySet<HarnessCapability> Capabilities,
    HarnessIdentity Identity,
    HarnessSubmissionMode SubmissionMode,         // 新增
    string? VersionPattern);                      // 新增：detect 探测到的版本需匹配，防止协议漂移误配
```

关键推论：`FeedbackChannel` 在 `NextTurn` 语义下 **cli-json 形态即可为真**（`codex exec resume <id>` 投递反馈 prompt）——§3.4"退回重做 v2 直投"不必等 H2 的 ACP，C1 即可对 Codex 落地。

### 4.4 新增宿主侧服务接口（delta ④）

§12.4 只定义了"包侧"契约，宿主侧（谁枚举包、谁管会话、谁记账）无接口。新增于 GitUI.Core/Agents（实现放 App 层）：

```csharp
// 枚举 .gpk harness 包 → 编译 LaunchSpec → 探测缓存（安装向导数据源）
public interface IAgentCatalog
{
    Task<IReadOnlyList<HarnessDescriptor>> ListAsync(CancellationToken ct);   // 已启用的 harness 包
    Task<HarnessProbeResult> ProbeAsync(string harnessId, CancellationToken ct); // detect 命令探测+版本匹配
}

// 会话生命周期：启动/续跑/停止、事件扇出（UI 线程封送）、崩溃标记
public interface IAgentSessionManager
{
    Task<IAgentSession> StartAsync(string harnessId, AgentStartOptions options, CancellationToken ct);
    IReadOnlyList<AgentTaskRecord> ActiveSessions { get; }
    event EventHandler<AgentSessionEventArgs> SessionEvent;     // TasksPage/状态栏/活动指示统一订阅点
    Task StopAllAsync(bool kill, CancellationToken ct);         // Gitter 退出时按设置终止或保留
}

// 任务↔会话账本：持久化于 .git/gitter/agent-tasks.json（仓库本地、不入版本控制）
public interface IAgentTaskStore
{
    Task<IReadOnlyList<AgentTaskRecord>> LoadAsync(string repoWorkDir, CancellationToken ct);
    Task SaveAsync(string repoWorkDir, AgentTaskRecord record, CancellationToken ct);
}

public sealed record AgentTaskRecord(
    string TaskId, string Title, string HarnessId,
    string WorktreePath, string Branch,
    string? ExternalSessionId,            // resume 键（来自 AgentSessionMetaEvent）
    string? BaselineSha,                  // 会话基线（§3.1 squash 视角的 diff 起点）
    AgentTaskState State, DateTimeOffset CreatedAt, DateTimeOffset? LastActiveAt,
    string? LastMessage);
public enum AgentTaskState { Starting, Working, AwaitingInput, AwaitingPermission, Completed, Failed, Interrupted, Stopped }
```

账本落在 `.git/` 下而非 `%APPDATA%`：跟随克隆走、天然按仓库隔离、不污染工作区。Gitter 重启后运行中任务标记为 `Interrupted`，任务卡提供"续跑（resume）"/"放弃"两键。

### 4.5 IRepositoryService worktree 最小集（delta ⑤）

§6.1 列的欠账全量较大；harness 依赖的**最小集**先行（全部 git CLI 实现，`RunGit` 范式）：

```csharp
// IRepositoryService 追加：
IReadOnlyList<WorktreeInfo> GetWorktrees(string workDir);                 // list --porcelain
string CreateWorktree(string workDir, string worktreePath, string branch, string? startPoint);  // add -b
void RemoveWorktree(string workDir, string worktreePath, bool force);
void PruneWorktrees(string workDir);
public sealed record WorktreeInfo(string Path, string? Branch, string HeadSha, bool IsBare, bool IsLocked, bool IsMain);
```

### 4.6 宿主托管 checkpoint 服务（delta ⑥，本方案最重要的补强）

**问题**：§12.3 `identity` 假设"agent 打的 checkpoint 提交自带 trailer"，但 Codex 的执行模型是"直接改文件 + 自主决定是否 git 操作"，默认**不提交**。若宿主不介入，Codex 任务在 Gitter 里没有会话时间线、没有会话基线的推进锚点、§4.3 会话整理无从谈起。

**方案**：新增宿主能力（非 agent 能力，故不进 `HarnessCapability`，由 manifest 声明请求 + 任务卡开关）：

```csharp
public interface IHostCheckpointService
{
    // 触发点：AgentTurnCompletedEvent（+ FileSystemWatcher 500ms 静默确认，P0 基座）
    // 动作：在【任务 worktree】内 git add -A && git commit
    //   message: "checkpoint: {LastMessage 首行截断}"
    //   trailers: Assisted-by: {identity.assistedBy} \n Gitter-Session: {TaskId}
    // 约束：仅在任务 worktree 生效；主 worktree 永不自动提交；经 GitWorker 入队
    Task<string?> CommitCheckpointAsync(AgentTaskRecord task, string summary, CancellationToken ct);
}
```

- 打出的 checkpoint 提交天然携带 `Assisted-by:` + `Gitter-Session:` trailer——§5.2 会话识别获得**最可信来源**，且不依赖 agent 自觉遵守约定；
- 验收流闭环：会话 diff（vs BaselineSha）→ 人审 → 任务卡"整理为一次提交"（§4.3 squash）或合并回默认分支（`BranchDeleteImpact` 影响面确认）；
- agent 若被用户显式允许自行提交（`permissions.gitWrite` 非空），HostCheckpoints 自动让位（检测到工作区干净即跳过），避免双重 checkpoint。

### 4.7 传输适配器契约（delta ⑦）

§12.4 说"协议细节在各 harness 包或内置 transport 适配器内消化"，但未给适配器形状。**声明式 manifest + 内置适配器**是既定路线（harness 包是纯 JSON，没有 DLL 入口——现有 .gpk 仅 syntax kind 有 DLL 通道），故适配器必须由 Gitter 内置、manifest 驱动：

```csharp
// GitUI.Shell（纯 C#，无 UI 依赖）
public interface IHarnessTransportAdapter
{
    HarnessTransport Transport { get; }
    bool CanLaunch(HarnessLaunchSpec spec);
    Task<IAgentSession> LaunchAsync(HarnessLaunchSpec spec, AgentStartOptions options,
        CancellationToken ct);
}

// HarnessLaunchSpec = manifest harness 段的编译产物（Catalog 在扫描时编译并校验模板占位符）
public sealed record HarnessLaunchSpec(
    string Command, IReadOnlyList<string> ArgTemplates, bool PromptStdin,
    IReadOnlyDictionary<string, string> Env,
    SpawnTemplate? Resume, StopPolicy Stop, HarnessEventMap Events);
public enum StopPolicy { Kill, GracefulSignal }
```

内置四个适配器：`CliPtyAdapter`（包装 `ConptySession`，VT 解析后按 §7.3 模式表推断状态——退化事件源）、`CliJsonAdapter`（管道子进程 + 逐行 JSON → §五 映射器）、`AcpAdapter`（H2）、`McpAdapter`（随 P5）。选择规则：descriptor.Transport 对应适配器可用即用；启动失败且存在 `FallbackTransport` 则降级（UI 提示降级原因）。

---

## 五、声明式事件映射（manifest 驱动，无脚本）

harness 包没有代码入口，协议 → 事件的翻译必须完全声明式。manifest 新增 `events` 段：

```jsonc
"events": {
  "lineFormat": "jsonl",
  "externalId": "$.thread_id",                    // → AgentSessionMetaEvent
  "rules": [
    { "when": "$.type == 'turn.started'",
      "emit": { "kind": "status", "phase": "Thinking" } },
    { "when": "$.type == 'item.started' && $.item.item_type == 'command_execution'",
      "emit": { "kind": "status", "phase": "RunningCommand", "summary": "$.item.command" } },
    { "when": "$.type == 'item.completed' && $.item.item_type == 'agent_message'",
      "emit": { "kind": "output", "stream": "assistant", "text": "$.item.text", "capture": "lastMessage" } },
    { "when": "$.type == 'item.completed' && $.item.item_type == 'file_change'",
      "emit": { "kind": "fileChange", "from": "$.item.changes[*]" } },
    { "when": "$.type == 'turn.completed'",
      "emit": { "kind": "turnCompleted", "usage": "$.usage" } },
    { "when": "$.type == 'turn.failed' || $.item.item_type == 'error'",
      "emit": { "kind": "failed", "summary": "$.message" } },
    { "when": "$.type == 'thread.completed'",
      "emit": { "kind": "completed" } }
  ],
  "unmatched": "log"                              // 未匹配帧 → AgentLogEvent(Info)，永不丢弃
}
```

- `when` 是**极小子集**求值器：属性路径 + `==` + `&&` + 字符串字面量，纯函数实现进 Core，黄金用例测试（延续仓库规则引擎风格）。**刻意不用 Jint**：规则是数据不是脚本，可审计、可快照测试，且 Core 不引入脚本宿主依赖（Jint 宿主现居 GitUI.Diff，仅服务 syntax kind）；
- `from: "$.item.changes[*]"` 支持数组展开（一帧多事件）；`capture: "lastMessage"` 写入会话上下文供 `AgentTurnCompletedEvent.LastMessage` 与账本 `LastMessage` 使用；
- **协议漂移的吸收方式**：Codex 演进导致字段改名时，由 harness 包更新映射表（包升级即可，不动 Gitter 代码）；`detect.versionPattern` 门控 + `unmatched: log` 兜底保证旧包遇到新协议只降级不崩溃；
- 未知 `kind` 值在 Catalog 编译期即拒绝（manifest 校验），运行期错误一律落 `AgentLogEvent(Error)`。

---

## 六、Codex harness 包设计（`com.openai.codex`）

### 6.1 manifest 全文（含 §四 全部扩展点）

```jsonc
{
  "schemaVersion": 1,
  "id": "com.openai.codex",
  "name": "OpenAI Codex CLI",
  "version": "0.1.0",
  "kinds": ["harness"],
  "engines": { "gitui": ">=1.0" },
  "harness": {
    "transport": "cli-json",
    "fallback": "cli-pty",
    "detect": {
      "command": "codex", "args": ["--version"],
      "versionPattern": "codex-cli\\s+0\\.\\d+"        // 锁定 exec --json 行为已知的一版段
    },
    "spawn": {
      "command": "codex",
      "args": ["exec", "--json", "--skip-git-repo-check",
               "--cd", "{worktree}", "--sandbox", "{sandbox}", "-"],
      "promptStdin": true,
      "env": { "GITUI_HARNESS": "com.openai.codex", "GITUI_TASK": "{taskId}" }
    },
    "resume": {
      "args": ["exec", "resume", "{externalSessionId}", "--json",
               "--cd", "{worktree}", "--sandbox", "{sandbox}", "-"],
      "promptStdin": true
    },
    "stop": { "mode": "kill" },                        // exec 无优雅停机信号，仅 kill
    "capabilities": ["structured-events", "session-diff", "file-watch",
                     "feedback-channel", "resume", "prompt-submission"],
    "submissionMode": "next-turn",
    "hostServices": ["host-checkpoints"],
    "identity": { "assistedBy": "codex" },
    "permissions": { "gitWrite": [], "outsideWorktree": false, "network": "model-endpoint" },
    "promptTemplates": {
      "preamble": "你在 Gitter 管理的隔离任务 worktree（{worktree}）中工作：\n只在该目录内改动文件；不要执行 push、分支删除、历史改写等破坏性 git 操作；默认不要自行提交（宿主负责 checkpoint）；完成后输出一段总结。",
      "feedback": "以下是人工审查者对上一轮改动的反馈，请只处理这些条目，不要扩大改动范围：\n{feedback}"
    },
    "events": { "……见 §五……" }
  }
}
```

具体参数说明与版本口径：

- **探测**：`codex --version` 输出形如 `codex-cli x.y.z`；`versionPattern` 锁主版本段，Catalog 探测失败/不匹配 → 任务卡选项置灰 + 安装指引（npm 安装命令由 manifest `detect.installHint` 可选提供）；
- **`-`（stdin 读 prompt）**：任务描述与反馈 prompt 全走 stdin，规避命令行长度与转义；`--skip-git-repo-check` 因任务 worktree 的属主检测可能误报（以实测为准，必要时去除）；
- **末条消息**：优先从 `agent_message` 事件 `capture`；若版本支持 `--output-last-message-file {capturePath}` 可选启用，作为 `AgentCompletedEvent.Summary` 的高保真来源；
- 字段名（`item_type`/`changes` 等）**以实测版本的 JSONL schema 为准**——这正是把映射放进 manifest 的原因：发现偏差时改包即可。

### 6.2 执行模型与 Gitter 的分工（为什么 checkpoint 归宿主）

| 事项 | 归属 | 理由 |
|---|---|---|
| 改文件、跑命令、出总结 | Codex（sandbox 限定在 worktree） | agent 本职 |
| checkpoint 提交 | **Gitter 宿主**（HostCheckpoints，可关） | Codex 默认不提交；宿主代打保证 trailer/归组/时机可控（§4.6） |
| 会话基线与会话 diff | Gitter（BaselineSha + `git diff`） | Gitter 已有完整 diff 资产，`session-diff` 能力仅用于时间线摘要增强 |
| 语义提交（squash） | Gitter（§4.3，人确认） | 人保留最终决定权 |
| 反馈下一轮 | Codex（`exec resume <id>`） | `NextTurn` 语义，§3.4 v2 载体 |
| 自主 git 提交 | 默认**禁止**（`gitWrite: []` + preamble 约束） | 需要时用户在任务卡显式放开，放开后宿主 checkpoint 自动让位 |

### 6.3 沙箱与审批策略映射

Codex 的审批是**运行前声明**而非运行中回调（exec 非交互形态无权限弹窗），映射为启动选项：

| AgentSandboxPolicy（Gitter） | codex 参数（示意，以 `codex exec --help` 为准） | 任务卡默认 |
|---|---|---|
| `ReadOnly` | `--sandbox read-only` | 问答/解释类任务 |
| `WorkspaceWrite` | `--sandbox workspace-write` | ✅ 默认（写限 worktree） |
| `FullAccess` | `--sandbox danger-full-access` | 显式警示色 + 二次确认 |

审批策略（`--ask-for-approval on-failure` 等）由 Gitter 按沙箱档位推导：`WorkspaceWrite` ⇒ `on-failure`（命令失败时退回询问，落入终端逃生舱处理）。`PermissionPrompts` 能力对 cli-json 形态为 **false**——Gitter 不伪装能力，运行中权限请求 UI（内联授权卡）属 ACP 形态（H2）；v1 的权限控制 = 启动前策略 + 任务卡实时显示 Codex 执行的命令流（`command_execution` 事件）。

### 6.4 会话账本与 resume

- 启动后首个 `AgentSessionMetaEvent`（thread id）写入 `.git/gitter/agent-tasks.json`（§4.4）；此后任务卡"续跑"按钮 = `resume.args` 模板 + 账本中的 externalSessionId；
- Gitter 重启：活跃任务标 `Interrupted`（Codex 侧会话文件在 `~/.codex/sessions` 仍存续），续跑无损；
- **不依赖** Codex 自身的会话枚举 CLI（各版本能力不一），账本是 Gitter 侧唯一事实源；Codex 会话目录仅作未来"导入历史会话"的可选增强。

### 6.5 Preamble 约定注入（软约束层）

manifest `promptTemplates.preamble` 由 Core 纯函数拼装（`{worktree}`/`{taskId}` 注入）后经 stdin 与任务描述合并投递。它承担：工作目录边界、禁破坏性 git、"默认别自己提交"（与 `gitWrite: []` 双保险）、输出总结要求。**定位是软约束**：真正硬边界是 Codex 自身 sandbox（worktree 写限）+ Gitter 侧路径校验；preamble 失效不破坏安全模型，只影响整洁度。

### 6.6 MCP 互操作（C2，依赖 P5 MCP server）

Gitter MCP server 就绪后，设置页/任务卡提供一键"把 Gitter git 工具接入 Codex"：向 `~/.codex/config.toml` 合并 `[mcp_servers.gitter]` 表（command = Gitter 的 `mcp serve` 子命令；合并前备份，只动 `gitter` 键）。此后 Codex 可直接调 `repo.status/repo.diff/review.submit_feedback` 等（§7.2），agent 经 Gitter 执行的 git 写自带确认通道与溯源——与 harness 通道互补：**harness 管"Gitter 宿主 agent"，MCP 管"agent 用 Gitter"**。

---

## 七、UI 编排：任务卡三元组（任务卡 = worktree + harness 会话 + 会话基线）

### 7.1 导航与页面

- MainWindow 侧边栏/`ShowPage`（MainWindow.xaml.cs:692）新增键 `"tasks"`（标签"任务"，置于"分支"与"终端"之间）；`TasksPage` + `TasksViewModel` 按既有模式自建并共享 `RepositoryContext`；
- 任务卡内容：标题（任务描述首行）、harness 徽标 + 状态徽标（`AgentTaskState`，主题令牌见 §7.4）、分支名、ahead/behind（P3 后）、改动中 N 文件（`AgentFileChangeEvent` 聚合 + FileSystemWatcher 校准）、最近活动时间、本次会话净变更量（vs BaselineSha）；
- 快速动作：新建任务（选 harness → worktree 模板 `task/<slug>` → 派活）、续跑/停止、打开终端（逃生舱）、在编辑器打开、查看会话 diff（跳变更页并切"自会话起点"基线，§3.1）、退回重做入口、整理为一次提交 / 合并回默认分支（危险操作确认，复用 `BranchDeleteImpact` 交互范式）、清理任务（删 worktree + 影响面确认）。

### 7.2 会话状态机（卡面驱动）

```
Starting → Working ⇄ (Thinking/Editing/RunningCommand 由 AgentStatusEvent 细分显示)
    → AwaitingPermission(仅 ACP 形态) / AwaitingInput
    → Completed(AgentCompletedEvent) → 审查提示横幅 → 验收流
    → Failed(非零退出/turn.failed) → 卡面显示 LastMessage + [续跑][放弃]
    → Stopped(人为 kill) / Interrupted(Gitter 重启) → [续跑][清理]
```

cli-pty 退化形态：状态由 §7.3 终端模式表推断（徽标加"~"后缀表示推断值），时间线退化为输出摘要行；**终端永远是本体**——卡面"打开终端"在 cli-pty 形态下即任务本体视图。

### 7.3 终端编排（现有多会话约束的绕行）

`TerminalPage` 目前单会话（TerminalPage.cs:32），P3 多 tab 改造前，C 系列采用**多窗口即多终端**：任务卡双击 → `App.OpenNewWindow(worktreePath)`（需补该重载，§二已列）→ 新窗口终端页经 `ResolveWorkDir()` 天然落位该 worktree（跟随机制现成）。cli-json 形态不需要终端容器（事件流即 UI）；cli-pty 形态若不想开新窗，任务卡内直接嵌 `TerminalCanvas + ConptySession + TerminalParser`（三层均 UI 无关，可独立实例化，不影响 TerminalPage 单例）。

### 7.4 设置、命令面板、主题、扩展页

- **设置**：`AppSettings` 增 `Agents` 节——`DefaultHarnessPerProject`（repoPath→harnessId）、`DefaultSandbox`（WorkspaceWrite）、`CheckpointMode`（托管/关）、`OnExit`（终止/保留 agent 会话）、`EnvDenylist`；SettingsPage 新增"Agent"节 + 扩展卡片 kind 标签表增"Agent 运行时"；`PackageKindToggle_Changed` 对 `kind==harness` 触发 Catalog 重扫，停用包时运行中会话提示收尾（§12.6）；
- **命令面板**：`CategoryOrder`（MainWindow.xaml.cs:751）增"任务"分类 + 条目（新建任务/续跑上次会话/查看会话 diff/接入 Codex MCP/打开 Agent 设置）；
- **主题**：v1 复用现有令牌（Amber=AwaitingPermission、Green=Working、Red=Failed、Chip 系列作 harness 徽标），新增语义令牌"活动色/风险色"沿 §十一旁路字典形态（`ActiveAgent`）短期过渡；
- **首次启用确认**：harness 包首次勾选启用时展示 manifest `permissions` 声明卡（gitWrite 白名单 / outsideWorktree / network=model-endpoint 与厂商名），确认后才进任务卡选项——延续危险操作确认交互范式。

---

## 八、安全与生命周期

| 层 | 机制（对 §12.6 的落地与补强） |
|---|---|
| 进程边界 | C 系列内嵌于 Gitter 进程 + **Windows Job Object（KILL_ON_JOB_CLOSE）**收编 agent 进程树：Gitter 崩溃/退出不遗孤儿；`OnExit=保留` 时改挂独立 job 并提示"会话仍在运行"。agent-host 独立子进程按 H3 推进 |
| 环境变量 | spawn env = 父进程 env − `EnvDenylist`（默认剔除 `GH_TOKEN`/`OPENAI_API_KEY` 等凭据类）+ manifest `env` 注入（`GITUI_*` 标记便于溯源）；Codex 认证走其自有 `~/.codex`，Gitter 不经手 |
| worktree 隔离 | `--cd {worktree}` 由模板强制注入；`outsideWorktree:false` 时 LaunchAsync 校验 cwd 归属；Gitter 侧 git 写全部经 GitWorker 且 `-C` 锁定 worktree |
| git 写 | **两层防线**：①对"经 Gitter 通道"的写（未来 MCP/反馈回流）按 `permissions.gitWrite` 白名单 + 确认；②对 agent 直接跑 git（Gitter 管不到的进程内行为），默认靠 Codex sandbox + preamble 禁止提交，显式放开时接受"agent 可在 worktree 内自行提交"并在验收台以 trailer/时间窗弱标注兜底——诚实边界，不伪装强隔离 |
| 隐私明示 | 任务描述与反馈 prompt 将进入所选 agent 的模型端点（Codex ⇒ OpenAI 云端）：首次启用确认卡 + 任务卡 harness 徽标悬停明示；§8.2 隐私三档仅约束 IAiGateway，不适用于本地 harness 进程，但 UI 文案不得混淆二者 |
| 启停粒度 | 复用 `DisabledKinds`（"包id:harness"）；停用 → 选项移除 + 运行中会话收尾提示 |

---

## 九、.gpk 框架配套扩展（实现前置清单，均为小改动）

| # | 改动 | 位置 | 说明 |
|---|---|---|---|
| 1 | `PackageManifest` 增 `Harness` 可选段（强类型 `HarnessManifestSection`） | ThemeModels.cs（或迁至独立 manifest 模型） | schemaVersion 保持 1，新段可选即向前兼容 |
| 2 | `ImportGpk` kinds 白名单 `{theme,syntax}` → 增 `harness` | ThemeService.cs:196 | 按"是否存在已注册消费者"判定而非硬编码列表（顺手还掉技术债） |
| 3 | 新增 `AgentCatalog` 扫描器（双根：内置 `<App>\Packages` + `%APPDATA%\GitUI\packages`，用户同 id 覆盖） | GitUI.App 或 GitUI.Core | 沿用 ThemeService/HighlighterRegistry 的既有扫描范式；不强推统一 PackageStore 重构（known-issues 既定后续项），但接口按未来收敛设计 |
| 4 | SettingsPage kind 标签表 + harness rescan/收尾钩子 | SettingsPage.xaml.cs:222 | 现有 UI 会显示未知 kind，仅缺标签与钩子 |
| 5 | `App.OpenNewWindow(worktreePath)` 重载 + 导航"任务"键 | App.xaml.cs:135 / MainWindow.xaml.cs:142 | 多窗口即多终端的载体 |

---

## 十、落地路线（C 系列，与 §十 P/H 系列对齐）

| 阶段 | 交付 | 对应 P/H | 依赖 |
|---|---|---|---|
| **C0 接口与宿主骨架** | §12.4 接口（含 §四 delta）落地 `GitUI.Core/Agents`；IAgentCatalog/SessionManager/TaskStore；worktree 最小集；TasksPage 任务卡 v1（手动模式：建 worktree + cli-pty 开跑任意 CLI，状态靠 §7.3 推断）；.gpk 配套 1–5 | H0 的具体化 + P3 的 worktree 切片 + P0 watcher | P0（FileSystemWatcher/GitWorker 接线） |
| **C1 Codex cli-json** | CliJsonAdapter + 声明式映射器 + `com.openai.codex` 包；HostCheckpoints；账本/resume/续跑；**退回重做直投**（NextTurn：exec resume 投反馈）——§3.4 v2 对 Codex 提前落地 | H1 的 Codex 实例化 | C0；Codex exec --json 实测采样固件 |
| **C2 权限与互操作** | AcpAdapter（若 codex-acp/`codex acp` 成熟）：内联授权卡 + Streaming 追加；Gitter MCP server 一键注册进 `~/.codex/config.toml` | H2 + P5 衔接 | C1 + P5 |
| **C3 生态** | .gpk 分发/检测向导、per-project 默认 harness、agent-host 子进程化（Job Object 迁移）、多 harness 并存管理面板 | H3 | C2 |

**测试策略**（延续仓库守卫风格）：映射求值器与模板拼装纯函数黄金用例进 Core 测试；事件映射用**真实 codex exec --json 采样 JSONL** 作固件做快照测试；CliJsonAdapter 用脚本化 stdout 注入（FakeTerminalSession 范式）；worktree 服务对临时仓库参数化拓扑（GitFixtureBuilder 风格）；任务卡状态机表驱动测试；TasksPage 走既有 headless 软件光栅化渲染测试。

**风险与对策**

| 风险 | 对策 |
|---|---|
| codex exec JSONL schema 随版本漂移 | versionPattern 门控 + 映射表在包内声明（升级包即修复）+ `unmatched: log` 永不崩溃 |
| exec 形态无运行中审批 | 沙箱策略前置 + 命令流透明展示 + 终端逃生舱；真权限卡留给 ACP（H2） |
| 一次性会话的中断恢复 | ExternalSessionId 账本 + `exec resume`；Gitter 重启标 Interrupted 不丢会话 |
| agent 绕过宿主自行 git 提交 | sandbox 默认 workspace-write + preamble 软约束 + 验收台弱标注兜底；文档明示边界（§八） |
| ConPTY/winpty 双后端差异 | CliPtyAdapter 统一走 ITerminalSession 抽象；cli-json 主形态不走 PTY，不受影响 |

---

## 十一、明确不做

- 不内置、不分发 Codex 二进制，不代理其登录与 key（探测不到即置灰）；
- 不做 inline chat / 代码补全（§九边界不变）；任务卡的对话感止步于"派活 + 反馈轮次"；
- 不承诺 harness 会话跨平台（当前 ConPTY/winpty 为 Windows 路线）；
- 不在 v1 伪装权限弹窗能力（`PermissionPrompts` 按 transport 诚实声明，UI 按位降级）；
- AI 解释/批注不写入仓库（沿 §九）；HostCheckpoints 的 checkpoint 提交属 git 数据但语义为 WIP，最终历史以人确认的 squash 为准。
