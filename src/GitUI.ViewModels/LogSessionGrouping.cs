using GitUI.Core.Models;

namespace GitUI.ViewModels;

/// <summary>
/// 一个 agent 会话（ai-native-redesign.md §5.1）：连续的同署名 checkpoint 提交聚合。
/// 提交顺序与其在 Log 中的顺序一致（新→旧）。
/// </summary>
public sealed record AgentSession(
    string SessionId,
    string AgentId,
    DateTimeOffset Start,
    DateTimeOffset End,
    IReadOnlyList<CommitNode> Commits)
{
    /// <summary>聚合提交信息（session squash 用）：tip 主题 + 规则模板 body。</summary>
    public string SquashMessage()
    {
        var tip = Commits[0];
        return $"{tip.Subject}\n\nSquashed {Commits.Count} checkpoint commits from {AgentId}"
             + $" ({Commits[^1].ShortSha}..{tip.ShortSha}).";
    }
}

/// <summary>
/// 会话聚合（纯函数，ai-native-redesign.md §5.1）：识别连续的 AI checkpoint 提交——
/// 优先按 <c>Gitter-Session</c> trailer 归组；无 session trailer 时按"同 Assisted-by + 时间窗
/// 邻近（≤30 分钟）"聚合。人写提交永不聚合。孤立的 AI 提交不成组（由行模型打 AI 徽标）。
/// </summary>
public static class LogSessionGrouping
{
    /// <summary>无 session trailer 时的归组时间窗。</summary>
    public static readonly TimeSpan GapWindow = TimeSpan.FromMinutes(30);

    /// <param name="itemsDesc">按时间倒序（新→旧）的提交列表，即 Log 页顺序。</param>
    public static IReadOnlyList<AgentSession> Group(IEnumerable<CommitNode> itemsDesc)
    {
        var sessions = new List<AgentSession>();
        List<CommitNode>? current = null;
        string? currentAgent = null, currentSessionId = null;

        void Flush()
        {
            if (current is { Count: >= 2 })
            {
                sessions.Add(new AgentSession(
                    currentSessionId ?? $"{currentAgent}|{current[^1].Sha}",
                    currentAgent ?? "ai",
                    current[^1].CommitterDate,
                    current[0].CommitterDate,
                    current.ToArray()));
            }
            current = null;
        }

        foreach (var c in itemsDesc)
        {
            var meta = CommitTrailers.Read(c.Message);
            if (!meta.IsAi)
            {
                Flush();
                continue;
            }

            var sameGroup = current is not null
                && meta.AssistedBy == currentAgent
                && (meta.SessionId is not null
                    ? meta.SessionId == currentSessionId && currentSessionId is not null
                    : currentSessionId is null && current[0].CommitterDate - c.CommitterDate <= GapWindow);

            if (!sameGroup) Flush();

            current ??= new List<CommitNode>();
            currentAgent = meta.AssistedBy;
            currentSessionId = meta.SessionId;
            current.Add(c);
        }
        Flush();

        return sessions;
    }

    /// <summary>提交所属会话（不存在返回 null）——行装配用。</summary>
    public static AgentSession? SessionOf(IReadOnlyList<AgentSession> sessions, CommitNode commit) =>
        sessions.FirstOrDefault(s => s.Commits.Any(c => c.Sha == commit.Sha));
}
