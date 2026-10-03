using System.Diagnostics;
using System.IO;
using GitUI.Core.Models;
using GitUI.Git;
using Xunit;

namespace GitUI.Git.Tests;

/// <summary>
/// 性能基准，分两档：
///   1. 小规模（10 提交）：单次 GetLog 基线（含预热对比）。
///   2. 大规模（10 000 提交）：docs/design.md §8 S1 要求 GetLog(skip=0, limit=50) < 500ms。
///
/// 大仓 fixture 用 git fast-import 单进程灌入，构造本身只要几秒。
/// [Trait("Category","Perf")] 用于 verify-s1.ps1 分组；数字同时写入临时日志文件。
/// </summary>
[Collection("PerfSerial")]
public sealed class PerformanceTests : IDisposable
{
    public void Dispose() { }

    private static readonly string _logPath =
        Path.Combine(Path.GetTempPath(), "gitui-perf.log");

    private static void Log(string line)
    {
        try { File.AppendAllText(_logPath, line + Environment.NewLine); }
        catch { /* 日志不可用时忽略 */ }
    }

    private static TestRepo BuildRepo(int commitCount)
    {
        var repo = new TestRepo();
        var sw = Stopwatch.StartNew();
        repo.Builder.BulkCommits(commitCount);
        sw.Stop();
        Log($"fast-import build {commitCount} commits: {sw.ElapsedMilliseconds} ms");
        return repo;
    }

    private static long TimeGetLog(TestRepo repo, int limit, int skip = 0)
    {
        var sw = Stopwatch.StartNew();
        var page = repo.Service.GetLog(repo.WorkDir, new LogFilter(Limit: limit, Skip: skip));
        sw.Stop();
        Assert.Equal(Math.Min(limit, page.TotalCount), page.Items.Count);
        return sw.ElapsedMilliseconds;
    }

    [Fact]
    [Trait("Category", "Perf")]
    public void GetLog_10Commits_FirstCallAndSteady()
    {
        using var repo = BuildRepo(10);
        var first = TimeGetLog(repo, 50);
        var steady = TimeGetLog(repo, 50);
        Log($"GetLog(10) first = {first} ms, steady = {steady} ms");
        Assert.True(steady < 50,
            $"GetLog(10) 稳态用了 {steady} ms，超过 50ms 阈值");
    }

    [Fact]
    [Trait("Category", "Perf")]
    public void GetLog_10kRepo_First50_Under500Ms()
    {
        using var repo = BuildRepo(10_000);
        var first = TimeGetLog(repo, 50);
        var steady = TimeGetLog(repo, 50);
        var page2 = repo.Service.GetLog(repo.WorkDir, new LogFilter(Limit: 50, Skip: 50));
        Log($"GetLog(10k, limit=50) first = {first} ms, steady = {steady} ms");

        Assert.Equal(10_000, repo.Service.GetLog(repo.WorkDir, new LogFilter(Limit: 1)).TotalCount);
        Assert.NotEmpty(page2.Items);
        Assert.Equal(page2.Items[0].Sha, steadyGet10k(repo, 50, 50));
        Assert.True(first < 500,
            $"GetLog(10k, limit=50) 首次用了 {first} ms，超过 500ms 阈值");
    }

    private static string steadyGet10k(TestRepo repo, int limit, int skip)
    {
        var page = repo.Service.GetLog(repo.WorkDir, new LogFilter(Limit: limit, Skip: skip));
        return page.Items[0].Sha;
    }

    [Fact]
    [Trait("Category", "Perf")]
    public void GetLog_10kRepo_SecondPage_NoOverlapWithFirst()
    {
        using var repo = BuildRepo(10_000);
        var p1 = repo.Service.GetLog(repo.WorkDir, new LogFilter(Limit: 50, Skip: 0));
        var p2 = repo.Service.GetLog(repo.WorkDir, new LogFilter(Limit: 50, Skip: 50));
        Assert.Equal(50, p1.Items.Count);
        Assert.Equal(50, p2.Items.Count);
        Assert.DoesNotContain(p2.Items[0].Sha, p1.Items.Select(c => c.Sha));
    }

    [Fact]
    [Trait("Category", "Perf")]
    public void GetBranches_10kRepo_Under500Ms()
    {
        using var repo = BuildRepo(10_000);
        var sw = Stopwatch.StartNew();
        var branches = repo.Service.GetBranches(repo.WorkDir);
        sw.Stop();
        Assert.Single(branches);
        Log($"GetBranches(10k) = {sw.ElapsedMilliseconds} ms");
        Assert.True(sw.ElapsedMilliseconds < 500,
            $"GetBranches(10k) 用了 {sw.ElapsedMilliseconds} ms");
    }

    [Fact]
    [Trait("Category", "Perf")]
    public void GetStatus_10kRepoClean_Under1000Ms()
    {
        using var repo = BuildRepo(10_000);
        var sw = Stopwatch.StartNew();
        var statuses = repo.Service.GetStatus(repo.WorkDir);
        sw.Stop();
        Assert.Empty(statuses);
        Log($"GetStatus(10k, clean) = {sw.ElapsedMilliseconds} ms");
        Assert.True(sw.ElapsedMilliseconds < 1_000,
            $"GetStatus(10k) 用了 {sw.ElapsedMilliseconds} ms");
    }
}
