using GitUI.Core.Models;
using GitUI.ViewModels;
using Xunit;

namespace GitUI.ViewModels.Tests;

/// <summary>
/// 会话聚合（ai-native-redesign.md §5.1）：trailer 优先归组、时间窗邻近、人写提交永不聚合。
/// </summary>
public sealed class LogSessionGroupingTests
{
    private static CommitNode Ai(string sha, string subject, string agent, string? session, int minutesAgo, string[]? parents = null) =>
        new(sha, sha[..7],
            subject + "\n\nAssisted-by: " + agent + (session is null ? "" : "\nGitter-Session: " + session) + "\n",
            subject, "agent", "agent@x", DateTimeOffset.Now.AddMinutes(-minutesAgo),
            "agent", DateTimeOffset.Now.AddMinutes(-minutesAgo),
            System.Collections.Immutable.ImmutableArray.Create(parents ?? Array.Empty<string>()),
            "tree", System.Collections.Immutable.ImmutableArray.Create<string>(),
            System.Collections.Immutable.ImmutableArray.Create<string>());

    private static CommitNode Human(string sha, string subject, int minutesAgo) =>
        new(sha, sha[..7], subject, subject, "human", "h@x", DateTimeOffset.Now.AddMinutes(-minutesAgo),
            "human", DateTimeOffset.Now.AddMinutes(-minutesAgo),
            System.Collections.Immutable.ImmutableArray.Create<string>(),
            "tree", System.Collections.Immutable.ImmutableArray.Create<string>(),
            System.Collections.Immutable.ImmutableArray.Create<string>());

    [Fact]
    public void Group_HumanCommitBreaksContinuity()
    {
        // Log 顺序（新→旧）：人写提交打断连续性，同 session 的更早提交不成组（规则：连续）
        var items = new[]
        {
            Ai("ccccccc1", "checkpoint 3", "deepseek", "s1", 30),
            Ai("ccccccc2", "checkpoint 2", "deepseek", "s1", 40),
            Human("bbbbbbb1", "human work", 45),
            Ai("ccccccc3", "checkpoint 1", "deepseek", "s1", 50),
        };

        var sessions = LogSessionGrouping.Group(items);

        var single = Assert.Single(sessions);
        Assert.Equal(2, single.Commits.Count);
        Assert.Equal("deepseek", single.AgentId);
        Assert.Equal("s1", single.SessionId);
        Assert.Equal("ccccccc1", single.Commits[0].Sha); // 新→旧
    }

    [Fact]
    public void Group_SameAgent_NoSession_WithinGapWindow_Groups()
    {
        var items = new[]
        {
            Ai("aaaaaaa1", "c2", "codex", null, 10),
            Ai("aaaaaaa2", "c1", "codex", null, 20),
        };

        var one = Assert.Single(LogSessionGrouping.Group(items));
        Assert.Equal(2, one.Commits.Count);
    }

    [Fact]
    public void Group_SameAgent_NoSession_BeyondGap_Separate()
    {
        var items = new[]
        {
            Ai("aaaaaaa1", "c2", "codex", null, 10),
            Ai("aaaaaaa2", "c1", "codex", null, 120),
        };

        Assert.Empty(LogSessionGrouping.Group(items));
    }

    [Fact]
    public void Group_DifferentAgents_NeverMerged()
    {
        var items = new[]
        {
            Ai("aaaaaaa1", "c2", "codex", null, 10),
            Ai("aaaaaaa2", "c1", "deepseek", null, 15),
        };

        Assert.Empty(LogSessionGrouping.Group(items));
    }

    [Fact]
    public void Group_SingleAiCommit_NotGrouped()
    {
        var items = new[] { Ai("aaaaaaa1", "solo", "codex", null, 10) };
        Assert.Empty(LogSessionGrouping.Group(items));
    }

    [Fact]
    public void Group_HumanOnly_Empty()
    {
        var items = new[] { Human("aaaaaaa1", "a", 1), Human("aaaaaaa2", "b", 2) };
        Assert.Empty(LogSessionGrouping.Group(items));
    }

    [Fact]
    public void SquashMessage_HasTipSubjectAndCount()
    {
        var items = new[]
        {
            Ai("aaaaaaa1", "checkpoint 2", "codex", "s9", 10),
            Ai("aaaaaaa2", "checkpoint 1", "codex", "s9", 20),
        };
        var session = Assert.Single(LogSessionGrouping.Group(items));

        var message = session.SquashMessage();
        Assert.StartsWith("checkpoint 2", message);
        Assert.Contains("2 checkpoint commits", message);
        Assert.Contains("codex", message);
    }

    [Fact]
    public void SessionOf_FindsBySha()
    {
        var items = new[]
        {
            Ai("aaaaaaa1", "c2", "codex", "s1", 10),
            Ai("aaaaaaa2", "c1", "codex", "s1", 20),
        };
        var sessions = LogSessionGrouping.Group(items);

        Assert.NotNull(LogSessionGrouping.SessionOf(sessions, items[0]));
        Assert.Null(LogSessionGrouping.SessionOf(sessions, Human("bbbbbbb1", "x", 30)));
    }
}
