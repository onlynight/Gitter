using System.Diagnostics;
using System.IO;
using GitUI.Git;
using Xunit;
using GitUI.Core.Resources;

namespace GitUI.ViewModels.Tests;

/// <summary>性能测试专用串行 collection：避免与单元测试并行争抢 CPU 导致基准抖动。</summary>
[CollectionDefinition("PerfSerial", DisableParallelization = true)]
public sealed class PerfSerialCollectionDefinition { }

/// <summary>
/// design.md §8-S4 性能基准：10 万提交仓库，首屏 50 条 &lt; 500ms，滚动加载下一页 &lt; 200ms。
/// 走完整 ViewModel 链路（GetLog + 过滤解析 + 分组 + 扁平行构建）。
/// 大仓 fixture 用 git fast-import 单进程灌入；数字写入临时日志供 verify-s4.ps1 汇总。
/// 无过滤查询走 S4 快路径（一次 git rev-list 同时供给 TotalCount 与分页窗口 + libgit2
/// Lookup 物化）。不走 libgit2 revwalk 的原因：实测其"每句柄首次迭代"固定开销 ~600ms
/// （10 万提交 packfile，commit-graph 也无法消除），取 50 条也会爆预算；见 §11.14。
/// </summary>
[Collection("PerfSerial")]
public sealed class LogPagePerformanceTests : IDisposable
{
    private static readonly string LogPath =
        Path.Combine(Path.GetTempPath(), "gitui-log-perf.log");

    private static void Log(string line)
    {
        try { File.AppendAllText(LogPath, line + Environment.NewLine); }
        catch { /* 日志不可用时忽略 */ }
    }

    private readonly GitFixtureBuilder _builder;
    private readonly LogViewModel _vm;

    public LogPagePerformanceTests()
    {
        var dir = Path.Combine(Path.GetTempPath(), "gitui-log-perf-" + Guid.NewGuid().ToString("N"));
        _builder = GitFixtureBuilder.Init(dir, "main");
        var sw = Stopwatch.StartNew();
        _builder.BulkCommits(100_000);
        sw.Stop();
        Log($"fast-import build 100k commits: {sw.ElapsedMilliseconds} ms");
        _vm = new LogViewModel(new LibGit2RepositoryService());
    }

    public void Dispose() => _builder.Dispose();

    [Fact]
    [Trait("Category", "Perf")]
    public async Task Open_First50_Under500Ms()
    {
        var sw = Stopwatch.StartNew();
        await _vm.OpenRepositoryAsync(_builder.WorkDir);
        sw.Stop();

        var loaded = _vm.Groups.SelectMany(g => g.Commits).Count();
        Assert.Equal(50, loaded);
        Assert.StartsWith(string.Format(Strings.Log_LoadedStatus, 50, 100000), _vm.StatusText);
        Log($"100k first screen (open, 50 items) = {sw.ElapsedMilliseconds} ms (budget 500)");
        Assert.True(sw.ElapsedMilliseconds < 500, $"首屏 {sw.ElapsedMilliseconds} ms 超过 500ms 预算");

        // 稳态复测：同参数重开（服务层无缓存，数字代表真实稳态）
        sw.Restart();
        await _vm.RefreshAsync();
        sw.Stop();
        Log($"100k first screen (refresh, 50 items) = {sw.ElapsedMilliseconds} ms (budget 500)");
        Assert.True(sw.ElapsedMilliseconds < 500, $"稳态首屏 {sw.ElapsedMilliseconds} ms 超过 500ms 预算");
    }

    [Fact]
    [Trait("Category", "Perf")]
    public async Task AuthorFilter_100k_Under2000Ms()
    {
        // known-issues 2.1：过滤查询经 rev-list 下推后的基准（无硬预算，宽断言防回归）
        var sw = Stopwatch.StartNew();
        await _vm.OpenRepositoryAsync(_builder.WorkDir);
        await _vm.SetQueryAsync("author:Fixture");
        sw.Stop();

        Assert.StartsWith(string.Format(Strings.Log_LoadedStatus, 50, 100000), _vm.StatusText);
        Log($"100k author-filtered first page = {sw.ElapsedMilliseconds} ms (budget 2000)");
        Assert.True(sw.ElapsedMilliseconds < 2000, $"过滤首屏 {sw.ElapsedMilliseconds} ms 超过 2000ms 宽预算");
    }

    [Fact]
    [Trait("Category", "Perf")]
    public async Task LoadNextPage_Under200Ms()
    {
        await _vm.OpenRepositoryAsync(_builder.WorkDir);

        var sw = Stopwatch.StartNew();
        await _vm.LoadNextPageAsync();
        sw.Stop();

        Assert.Equal(100, _vm.Groups.SelectMany(g => g.Commits).Count());
        Log($"100k next page = {sw.ElapsedMilliseconds} ms (budget 200)");
        Assert.True(sw.ElapsedMilliseconds < 200, $"下一页 {sw.ElapsedMilliseconds} ms 超过 200ms 预算");
    }
}
