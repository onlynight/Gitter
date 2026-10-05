using GitUI.Core.Services;
using Xunit;

namespace GitUI.Git.Tests;

/// <summary>
/// 实时基座（ai-native-redesign.md §7.1）：FSW 去抖合并、轮询探测 HEAD、后台 fetch 事件。
/// 全部使用短间隔 + 宽松等待超时（5s），避免 CI/慢盘抖动。
/// </summary>
[Collection("RepoMonitorSerial")]
public sealed class RepoMonitorTests : IDisposable
{
    private static readonly TimeSpan WaitBudget = TimeSpan.FromSeconds(10);

    private readonly GitFixtureBuilder _builder;
    private readonly LibGit2RepositoryService _repo = new();
    private readonly GitWorker _worker;

    public RepoMonitorTests()
    {
        var dir = Path.Combine(Path.GetTempPath(), "gitui-monitor-test-" + Guid.NewGuid().ToString("N"));
        _builder = GitFixtureBuilder.Init(dir, "main");
        _worker = new GitWorker(_repo);
    }

    public void Dispose()
    {
        _worker.Dispose();
        _builder.Dispose();
    }

    private static async Task<T> WaitAsync<T>(TaskCompletionSource<T> tcs, string what)
    {
        var done = await Task.WhenAny(tcs.Task, Task.Delay(WaitBudget)).ConfigureAwait(false);
        Assert.True(done == tcs.Task, $"Timed out waiting for {what}");
        return await tcs.Task.ConfigureAwait(false);
    }

    [Fact]
    public async Task WorktreeFileChange_RaisesWorktreeEvent()
    {
        var tcs = new TaskCompletionSource<RepoChangeKind>(TaskCreationOptions.RunContinuationsAsynchronously);
        using var monitor = new RepoMonitor(_repo, _worker, new RepoMonitorOptions
        {
            Debounce = TimeSpan.FromMilliseconds(100),
            FocusPoll = false,
            AutoFetch = false,
        });
        monitor.Changed += kind => tcs.TrySetResult(kind);
        monitor.Start(_builder.WorkDir);

        _builder.Write("watched.txt", "hello\n");

        var kind = await WaitAsync(tcs, "worktree change");
        Assert.True(kind.HasFlag(RepoChangeKind.Worktree));
    }

    [Fact]
    public async Task Commit_RaisesHeadEvent()
    {
        _builder.Commit("base", ("f.txt", "1\n"));

        var tcs = new TaskCompletionSource<RepoChangeKind>(TaskCreationOptions.RunContinuationsAsynchronously);
        using var monitor = new RepoMonitor(_repo, _worker, new RepoMonitorOptions
        {
            Debounce = TimeSpan.FromMilliseconds(100),
            FocusPoll = false,
            AutoFetch = false,
        });
        monitor.Changed += kind => { if (kind.HasFlag(RepoChangeKind.Head)) tcs.TrySetResult(kind); };
        monitor.Start(_builder.WorkDir);

        _builder.Write("f.txt", "2\n");
        _builder.Commit("second", ("f.txt", "2\n"));

        await WaitAsync(tcs, "head change");
    }

    [Fact]
    public async Task FocusPoll_DetectsHeadChange_WithoutWatcher()
    {
        _builder.Commit("base", ("f.txt", "1\n"));

        var tcs = new TaskCompletionSource<RepoChangeKind>(TaskCreationOptions.RunContinuationsAsynchronously);
        using var monitor = new RepoMonitor(_repo, _worker, new RepoMonitorOptions
        {
            WatchFiles = false,                 // FSW 关闭：纯轮询兜底路径
            FocusPoll = true,
            PollInterval = TimeSpan.FromMilliseconds(200),
            AutoFetch = false,
        });
        monitor.Changed += kind => { if (kind.HasFlag(RepoChangeKind.Head)) tcs.TrySetResult(kind); };
        monitor.Start(_builder.WorkDir);

        // 等首个探测建立基线，再提交（首个探测不产生事件）
        await Task.Delay(700);
        _builder.Commit("second", ("f.txt", "2\n"));

        await WaitAsync(tcs, "polled head change");
    }

    [Fact]
    public async Task AutoFetch_LocalRemote_RaisesFetchCompleted()
    {
        var bare = Path.Combine(Path.GetTempPath(), "gitui-monitor-bare-" + Guid.NewGuid().ToString("N") + ".git");
        try
        {
            GitFixtureBuilder.InitBare(bare);
            _builder.AddRemote("origin", bare);
            _builder.Commit("base", ("f.txt", "1\n"));
            _builder.RunGit("push", "-q", "origin", "main");

            var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            using var monitor = new RepoMonitor(_repo, _worker, new RepoMonitorOptions
            {
                WatchFiles = false,
                FocusPoll = false,
                AutoFetch = true,
                FetchInterval = TimeSpan.FromMilliseconds(400),
            });
            monitor.FetchCompleted += () => tcs.TrySetResult(true);
            monitor.Start(_builder.WorkDir);

            await WaitAsync(tcs, "fetch completed");
        }
        finally
        {
            GitFixtureBuilder.DeleteDirectory(bare);
        }
    }

    [Fact]
    public void Classify_SplitsWorktreeFromGitInternals()
    {
        var root = Path.Combine("D:", "repo");
        Assert.Equal(RepoChangeKind.Worktree, RepoMonitor.Classify(Path.Combine(root, "src", "a.cs"), root));
        Assert.Equal(RepoChangeKind.Worktree, RepoMonitor.Classify(root, root));
        Assert.Equal(RepoChangeKind.Index, RepoMonitor.Classify(Path.Combine(root, ".git", "index"), root));
        Assert.Equal(RepoChangeKind.Index, RepoMonitor.Classify(Path.Combine(root, ".git", "index.lock"), root));
        Assert.Equal(RepoChangeKind.Head, RepoMonitor.Classify(Path.Combine(root, ".git", "HEAD"), root));
        Assert.Equal(RepoChangeKind.Head, RepoMonitor.Classify(Path.Combine(root, ".git", "refs", "heads", "main"), root));
        Assert.Equal(RepoChangeKind.None, RepoMonitor.Classify(string.Empty, root));
    }

    [Fact]
    public void Stop_DisablesEvents()
    {
        var fired = false;
        using var monitor = new RepoMonitor(_repo, _worker, new RepoMonitorOptions
        {
            Debounce = TimeSpan.FromMilliseconds(50),
            FocusPoll = false,
            AutoFetch = false,
        });
        monitor.Changed += _ => fired = true;
        monitor.Start(_builder.WorkDir);
        monitor.Stop();

        _builder.Write("after-stop.txt", "x\n");
        Thread.Sleep(300); // 若事件仍会触发，这里足够可见

        Assert.False(fired);
        Assert.False(monitor.IsWatching);
    }

    [Fact]
    public async Task Start_Twice_SwitchesTarget()
    {
        var dir2 = Path.Combine(Path.GetTempPath(), "gitui-monitor-test2-" + Guid.NewGuid().ToString("N"));
        using var builder2 = GitFixtureBuilder.Init(dir2, "main");

        var tcs = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        using var monitor = new RepoMonitor(_repo, _worker, new RepoMonitorOptions
        {
            Debounce = TimeSpan.FromMilliseconds(100),
            FocusPoll = false,
            AutoFetch = false,
        });
        monitor.Start(_builder.WorkDir);
        monitor.Start(builder2.WorkDir);

        builder2.Write("in-second.txt", "x\n");
        // 第一次仓库的变更不应再触发（已切走）——只等第二个仓库的事件
        monitor.Changed += _ => tcs.TrySetResult(monitor.WorkDir!);

        _builder.Write("in-first.txt", "x\n"); // 旧目标：不应到达（重复 Start 已换目录）

        var workDir = await WaitAsync(tcs, "switched target event");
        Assert.Equal(builder2.WorkDir, workDir);
    }
}
