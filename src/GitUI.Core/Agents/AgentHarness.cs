using System.Collections.Generic;

namespace GitUI.Core.Agents;

// ------------------------------------------------------------------------------------------------
// Agent Harness 契约（ai-native-redesign.md §十二，H0 接口冻结）。
// Gitter 核心只依赖本文件内的类型与事件；cli-json/acp/mcp 各传输的协议细节由 harness 包
// 或内置 transport 适配器消化。签名以实施为准，破坏性变更需经 H 系列 H0 评审。
// ------------------------------------------------------------------------------------------------

/// <summary>harness 能力位（UI 按位降级渲染）。</summary>
[System.Flags]
public enum HarnessCapability
{
    None = 0,
    /// <summary>结构化事件流（cli-json 及以上）。</summary>
    StructuredEvents = 1 << 0,
    /// <summary>agent 主动打 checkpoint 提交（事件反哺 §5 会话卡）。</summary>
    Checkpoints = 1 << 1,
    /// <summary>提供会话级变更摘要（§3.1 会话基线数据源之一）。</summary>
    SessionDiff = 1 << 2,
    /// <summary>可接收审查反馈（§3.4 退回重做直投）。</summary>
    FeedbackChannel = 1 << 3,
    /// <summary>权限请求回调（§12.6 权限卡）。</summary>
    PermissionPrompts = 1 << 4,
    /// <summary>支持会话恢复（Gitter 重启后 reattach）。</summary>
    Resume = 1 << 5,
    /// <summary>可向运行中会话追加指令。</summary>
    PromptSubmission = 1 << 6,
}

/// <summary>传输形态四级（§12.2）：上级形态包含下级能力。</summary>
public enum HarnessTransport
{
    /// <summary>agent CLI 跑在 Gitter 内嵌终端（零适配）。</summary>
    CliPty = 0,
    /// <summary>子进程管道驱动流式 JSON 输出。</summary>
    CliJson = 1,
    /// <summary>Agent Client Protocol（stdio JSON-RPC 全双工）。</summary>
    Acp = 2,
    /// <summary>MCP 工具接口互操作。</summary>
    Mcp = 3,
}

/// <summary>harness 的身份署名（对接 §5.2 会话规范：trailer 由 Gitter 代打或 harness 自打）。</summary>
public sealed record HarnessIdentity(string AssistedBy, string? SessionTrailer = "Gitter-Session");

/// <summary>一个 harness 类型的描述（一个扩展包注册一个）。</summary>
public sealed record HarnessDescriptor(
    string Id,
    string DisplayName,
    HarnessTransport Transport,
    IReadOnlySet<HarnessCapability> Capabilities,
    HarnessIdentity Identity);

/// <summary>探测结果：本机是否可用 + 版本（cli-pty 形态 version 可空）。</summary>
public sealed record HarnessInstall(string HarnessId, string? Version, bool Available);

/// <summary>启动会话参数（worktree 由任务卡注入）。</summary>
public sealed record AgentStartOptions(
    string WorktreePath,
    string Prompt,
    string? ResumeSessionId = null);

/// <summary>会话状态机（任务卡徽标按位呈现）。</summary>
public enum AgentSessionState
{
    Starting = 0,
    Working = 1,
    AwaitingPermission = 2,
    Idle = 3,
    Completed = 4,
    Failed = 5,
    Stopped = 6,
    Interrupted = 7,
}

/// <summary>事件流种类（终端回显来源标注）。</summary>
public enum AgentStreamKind
{
    Stdout = 0,
    Stderr = 1,
    System = 2,
}

/// <summary>agent 工作阶段（StatusEvent 携带，任务卡活动徽标）。</summary>
public enum AgentPhase
{
    Thinking = 0,
    Editing = 1,
    Running = 2,
    Waiting = 3,
    Done = 4,
}

/// <summary>停止结果（kill=false 优雅收尾时 agent 可能拒绝）。</summary>
public sealed record AgentStopResult(bool Stopped, string? Detail);

/// <summary>权限请求载荷（PermissionEvent → 任务卡内联授权卡）。</summary>
public sealed record PermissionRequest(string Kind, string Description, string? WorktreePath);

/// <summary>权限决定。</summary>
public sealed record PermissionDecision(bool Allowed, bool RememberForSession = false);

/// <summary>会话收束结果。</summary>
public enum AgentOutcome
{
    Success = 0,
    Failed = 1,
    Cancelled = 2,
}

/// <summary>会话事件的基类型（§12.4：cli-pty 形态退化为输出推断事件，cli-json/acp 为真实事件）。</summary>
public abstract record AgentSessionEvent;

public sealed record AgentStatusEvent(AgentPhase Phase, string? Summary) : AgentSessionEvent;

public sealed record AgentOutputEvent(string Text, AgentStreamKind Kind) : AgentSessionEvent;

/// <summary>agent 打了 checkpoint 提交 → §5 会话时间线 / §5.2 trailer 归组。</summary>
public sealed record AgentCheckpointEvent(string CommitSha, string Summary) : AgentSessionEvent;

/// <summary>权限请求 → 任务卡内联授权卡（不抢焦点弹窗）。</summary>
public sealed record AgentPermissionEvent(PermissionRequest Request, TaskCompletionSource<PermissionDecision> Reply) : AgentSessionEvent;

/// <summary>agent 选择题（如多方案取舍）。</summary>
public sealed record AgentQuestionEvent(string Question, IReadOnlyList<string> Options, TaskCompletionSource<int> Reply) : AgentSessionEvent;

/// <summary>会话完成 → §7.3 "agent 已完成，查看会话 diff" 审查提示。</summary>
public sealed record AgentCompletedEvent(AgentOutcome Outcome, string? Summary) : AgentSessionEvent;

/// <summary>会话事件聚合参数。</summary>
public sealed record AgentSessionEventArgs(AgentSessionEvent Event);

/// <summary>
/// 审查反馈载荷（§3.4 退回重做的直投载体）：hunk 定位 + 问题 + 约束。
/// 核心只定义格式；投递由 harness 的 FeedbackChannel 能力实现。
/// </summary>
public sealed record ReviewFeedback(
    string FilePath,
    int? OldStart,
    int? NewStart,
    string Issue,
    string Constraint);

/// <summary>一个 harness 类型（扩展包注册；无状态）。</summary>
public interface IAgentHarness
{
    HarnessDescriptor Descriptor { get; }

    /// <summary>探测本机 CLI/协议可用性（未探测到 → 任务卡选项置灰并提示安装方式）。</summary>
    System.Collections.Generic.IAsyncEnumerable<HarnessInstall> DetectAsync(System.Threading.CancellationToken ct);

    Task<IAgentSession> StartSessionAsync(AgentStartOptions options, System.Threading.CancellationToken ct);
}

/// <summary>一次运行的会话实例（绑定 worktree，有状态；一个任务卡 = worktree + 会话 + 会话基线）。</summary>
public interface IAgentSession : System.IAsyncDisposable
{
    string SessionId { get; }

    HarnessDescriptor Harness { get; }

    string WorktreePath { get; }

    AgentSessionState State { get; }

    /// <summary>事件流（worker 线程触发，UI 自行回投）。</summary>
    event System.EventHandler<AgentSessionEventArgs>? Event;

    /// <summary>派任务 / 追加指令（PromptSubmission 能力）。</summary>
    Task SubmitPromptAsync(string prompt, System.Threading.CancellationToken ct);

    /// <summary>审查反馈直投（FeedbackChannel 能力，§3.4）。</summary>
    Task SubmitFeedbackAsync(System.Collections.Generic.IReadOnlyList<ReviewFeedback> feedback, System.Threading.CancellationToken ct);

    /// <summary>停止会话（kill=false 请求优雅收尾，agent 可拒绝）。</summary>
    Task<AgentStopResult> StopAsync(bool kill, System.Threading.CancellationToken ct);
}
