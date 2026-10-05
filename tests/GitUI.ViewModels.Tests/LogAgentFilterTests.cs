using GitUI.Core.Models;
using GitUI.Git;
using Xunit;

namespace GitUI.ViewModels.Tests;

/// <summary>
/// P4 会话历史接线（ai-native-redesign.md §5.2）：is:ai / agent: 过滤语法解析 + session squash。
/// </summary>
public sealed class LogAgentFilterTests : IDisposable
{
    private readonly GitFixtureBuilder _builder;

    public LogAgentFilterTests()
    {
        var dir = Path.Combine(Path.GetTempPath(), "gitui-agent-filter-" + Guid.NewGuid().ToString("N"));
        _builder = GitFixtureBuilder.Init(dir, "main");
    }

    public void Dispose() => _builder.Dispose();

    // ---- 过滤语法 ----

    [Fact]
    public void Parse_IsAi_SetsAnyAgentFilter()
    {
        var f = LogFilterParser.Parse("is:ai");
        Assert.Equal("*", f.Agent);
    }

    [Fact]
    public void Parse_AgentPrefix_CarriesValue()
    {
        var f = LogFilterParser.Parse("agent:deepseek");
        Assert.Equal("deepseek", f.Agent);
    }

    [Fact]
    public void Parse_AgentMixedWithFreeWord_BothApplied()
    {
        var f = LogFilterParser.Parse("agent:codex login");
        Assert.Equal("codex", f.Agent);
        Assert.Contains("login", f.Topic);
    }

    // ---- 服务端过滤（集成）----

    [Fact]
    public void GetLog_AgentFilter_ReturnsOnlyAiCommits()
    {
        _builder.Commit("human work", ("f.txt", "1\n"));
        _builder.RunGitWithDate("2026-01-01 04:00:00Z", "commit", "-q", "--allow-empty", "-m", "checkpoint 2\n\nAssisted-by: deepseek\nGitter-Session: s1");
        _builder.RunGitWithDate("2026-01-01 03:00:00Z", "commit", "-q", "--allow-empty", "-m", "checkpoint 1\n\nAssisted-by: deepseek\nGitter-Session: s1");

        var repo = new LibGit2RepositoryService();
        var all = repo.GetLog(_builder.WorkDir, LogFilter.All);
        Assert.Equal(3, all.TotalCount);

        var ai = repo.GetLog(_builder.WorkDir, LogFilter.All with { Agent = "*" });
        Assert.Equal(2, ai.TotalCount);
        Assert.All(ai.Items, c => Assert.Contains("Assisted-by: deepseek", c.Message));

        var byAgent = repo.GetLog(_builder.WorkDir, LogFilter.All with { Agent = "deepseek" });
        Assert.Equal(2, byAgent.TotalCount);

        var none = repo.GetLog(_builder.WorkDir, LogFilter.All with { Agent = "codex" });
        Assert.Equal(0, none.TotalCount);
    }

    // ---- session squash（VM 集成）----

    /// <summary>搭两个带 trailer 的 checkpoint（物理序 = 日期序：cp1 先提交、cp2 在 HEAD）。</summary>
    private void BuildCheckpoints()
    {
        _builder.CommitOn("base", DateTimeOffset.Parse("2026-01-01T10:00:00"), ("f.txt", "1\n"));
        _builder.Write("g.txt", "v2\n");
        _builder.Stage("g.txt");
        _builder.RunGitWithDate("2026-01-01 03:00:00Z", "commit", "-q", "-m", "checkpoint 1\n\nAssisted-by: deepseek\nGitter-Session: s1");
        _builder.Write("g.txt", "v3\n");
        _builder.RunGitWithDate("2026-01-01 04:00:00Z", "commit", "-q", "-am", "checkpoint 2\n\nAssisted-by: deepseek\nGitter-Session: s1");
    }

    [Fact]
    public async Task SquashSession_MergesCheckpointsIntoOne()
    {
        BuildCheckpoints();

        var repo = new LibGit2RepositoryService();
        var vm = new LogViewModel(repo);
        await vm.OpenRepositoryAsync(_builder.WorkDir);

        var sessions = LogSessionGrouping.Group(repo.GetLog(_builder.WorkDir, LogFilter.All).Items);
        var session = Assert.Single(sessions);

        await vm.SquashSessionAsync(session);

        var after = repo.GetLog(_builder.WorkDir, LogFilter.All);
        Assert.True(after.TotalCount == 2, "vm.Error=" + (vm.Error ?? "none")); // base + 聚合提交
        var head = after.Items[0];
        Assert.StartsWith("checkpoint 2", head.Subject);
        Assert.Contains("2 checkpoint commits", head.Message);
        // soft reset 保留在 index 的内容随聚合提交一起进库
        Assert.Equal("v3", _builder.ShowFile("HEAD", "g.txt"));
        Assert.Null(vm.Error);
        Assert.Contains(_builder.Reflog(), entry => entry.Contains("reset")); // reflog 可回退
    }

    [Fact]
    public async Task SquashSession_NotAtHead_ReportsErrorWithoutMoving()
    {
        BuildCheckpoints();
        _builder.Commit("human tip", ("h.txt", "x\n")); // HEAD = 人写提交，会话 tip 不在顶端

        var repo = new LibGit2RepositoryService();
        var vm = new LogViewModel(repo);
        await vm.OpenRepositoryAsync(_builder.WorkDir);

        var sessions = LogSessionGrouping.Group(repo.GetLog(_builder.WorkDir, LogFilter.All).Items);
        var session = Assert.Single(sessions);
        await vm.SquashSessionAsync(session);

        Assert.NotNull(vm.Error); // 会话 tip ≠ HEAD → 拒绝
        // 历史未被动过：物理序 base←cp1←cp2←human-tip，HEAD~1 仍是 checkpoint 2
        Assert.Equal("checkpoint 2", _builder.RunGit("log", "-1", "--skip=1", "--format=%s"));
    }
}
