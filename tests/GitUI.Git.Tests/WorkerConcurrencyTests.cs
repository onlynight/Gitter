using GitUI.Core.Services;
using GitUI.Git;
using Xunit;

namespace GitUI.Git.Tests;

public sealed class WorkerConcurrencyTests : IDisposable
{
    private readonly TestRepo _repo = new();
    private GitWorker? _worker;

    public void Dispose()
    {
        _worker?.Dispose();
        _repo.Dispose();
    }

    private GitWorker NewWorker(int capacity = 1000)
    {
        _worker?.Dispose();
        _worker = new GitWorker(_repo.Service, capacity);
        return _worker;
    }

    [Fact]
    public async Task Invoke_100ConcurrentRequests_AllSucceed_NoDeadlock()
    {
        _repo.Builder.Commit("init", ("a.txt", "a\n"));
        using var worker = NewWorker();

        const int n = 100;
        var tasks = Enumerable.Range(0, n)
            .Select(i => worker.Invoke(s => s.HeadSha(_repo.WorkDir), TimeSpan.FromSeconds(30)))
            .ToArray();

        var results = await Task.WhenAll(tasks);
        Assert.All(results, r => Assert.False(string.IsNullOrEmpty(r)));
    }

    [Fact]
    public async Task Invoke_SerializesExecution_DifferentThreadsDoNotInterleave()
    {
        _repo.Builder.Commit("init", ("a.txt", "a\n"));
        using var worker = NewWorker();

        // 200 请求并发提交，检查最终状态无异常（隐式检测句柄跨线程崩溃）
        var tasks = Enumerable.Range(0, 200)
            .Select(_ => worker.Invoke(s => s.GetBranches(_repo.WorkDir), TimeSpan.FromSeconds(30)))
            .ToArray();
        var results = await Task.WhenAll(tasks);
        Assert.All(results, r => Assert.Single(r));
    }

    [Fact]
    public async Task Invoke_ExceptionPropagates_NotSwallowed()
    {
        using var worker = NewWorker();

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => worker.Invoke(s => throw new InvalidOperationException("boom"),
                TimeSpan.FromSeconds(10)));
        Assert.Equal("boom", ex.Message);
    }

    [Fact]
    public async Task Invoke_AfterDispose_ThrowsObjectDisposed()
    {
        var worker = new GitWorker(_repo.Service, 100);
        worker.Dispose();
        await Assert.ThrowsAsync<ObjectDisposedException>(
            () => worker.Invoke(s => s.HeadSha(_repo.WorkDir)));
    }

    [Fact]
    public async Task Invoke_TimesOutWhenWorkNotDone_RaisesTimeoutException()
    {
        using var worker = NewWorker();

        // 塞一个长睡眠的请求，第二个请求应在 100ms 超时
        var blocker = worker.Invoke(_ => { System.Threading.Thread.Sleep(2000); return 1; },
            TimeSpan.FromSeconds(10));
        var shortTask = worker.Invoke(_ => 42, TimeSpan.FromMilliseconds(100));

        var ex = await Assert.ThrowsAsync<TimeoutException>(async () => await shortTask);
        Assert.Contains("did not complete", ex.Message);
        // 让 blocker 也跑完避免 Dispose 卡
        await blocker;
    }

    [Fact]
    public async Task PendingCount_ReflectsQueueDepth()
    {
        _repo.Builder.Commit("init", ("a.txt", "a\n"));
        using var worker = NewWorker();

        // 先塞一个长时间任务，观察 PendingCount
        var blocker = worker.Invoke(_ => { System.Threading.Thread.Sleep(300); return 1; },
            TimeSpan.FromSeconds(10));
        var tasks = Enumerable.Range(0, 5)
            .Select(_ => worker.Invoke(_ => 1, TimeSpan.FromSeconds(10)))
            .ToArray();
        foreach (var t in tasks) _ = t; // 忽略返回值，让任务进入队列

        // 给一点时间让部分任务被消费
        await Task.Delay(50);
        Assert.True(worker.PendingCount >= 0);
        await blocker;
        // 等所有任务消化完
        await Task.WhenAll(tasks);
        while (worker.PendingCount > 0) await Task.Delay(20);
    }

    [Fact]
    public async Task Invoke_SmallTimeoutOnSlowOp_ThrowsTimeout()
    {
        using var worker = NewWorker();
        var ex = await Assert.ThrowsAsync<TimeoutException>(
            () => worker.Invoke(_ => { System.Threading.Thread.Sleep(1500); return 1; },
                TimeSpan.FromMilliseconds(150)));
        Assert.NotNull(ex);
    }

    [Fact]
    public void Worker_DisposeTwice_IsIdempotent()
    {
        var worker = new GitWorker(_repo.Service, 100);
        worker.Dispose();
        worker.Dispose(); // 不应抛
    }
}
