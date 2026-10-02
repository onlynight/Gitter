using System.Collections.Concurrent;
using GitUI.Core.Services;

namespace GitUI.Git
{
    /// <summary>
    /// Git 操作串行队列。UI 线程提交请求，单一 worker 线程消费。
    ///
    /// 这是 docs/design.md §3.2 的落地：libgit2 的 <see cref="LibGit2Sharp.Repository"/> 句柄
    /// 不可跨线程，因此请求被表示为纯数据（<see cref="GitRequest{T}"/> 里装一个
    /// <see cref="Func{IRepositoryService,T}"/> 指令），worker 在自有线程内执行后把结果
    /// 通过 <see cref="TaskCompletionSource{TResult}"/> 回投。队列有界，避免内存爆。
    /// </summary>
    public sealed class GitWorker : IDisposable
    {
        private readonly IRepositoryService _service;
        private readonly BlockingCollection<GitRequestBase> _queue;
        private readonly CancellationTokenSource _cts;
        private readonly Thread _worker;
        private volatile bool _disposed;

        /// <param name="capacity">队列最大长度。超出时 <see cref="Invoke{T}"/> 阻塞。</param>
        public GitWorker(IRepositoryService service, int capacity = 1000)
        {
            _service = service ?? throw new ArgumentNullException(nameof(service));
            _queue = new BlockingCollection<GitRequestBase>(new ConcurrentQueue<GitRequestBase>(), capacity);
            _cts = new CancellationTokenSource();
            _worker = new Thread(WorkerLoop) { IsBackground = true, Name = "GitWorker" };
            _worker.Start();
        }

        /// <summary>提交一个请求并等待结果。异常原样抛出。</summary>
        public Task<T> Invoke<T>(Func<IRepositoryService, T> action, TimeSpan? timeout = null)
        {
            if (_disposed) throw new ObjectDisposedException(nameof(GitWorker));
            if (action is null) throw new ArgumentNullException(nameof(action));

            var request = new GitRequest<T>(action);
            _queue.Add(request, _cts.Token);
            return request.Task.TimeoutAfter(timeout ?? TimeSpan.FromMinutes(5));
        }

        /// <summary>提交一个无返回值请求。</summary>
        public Task Invoke(Action<IRepositoryService> action, TimeSpan? timeout = null)
        {
            if (_disposed) throw new ObjectDisposedException(nameof(GitWorker));
            if (action is null) throw new ArgumentNullException(nameof(action));
            return Invoke(s => { action(s); return true; }, timeout);
        }

        /// <summary>请求队列中尚未消费的条目数（用于监控/测试）。</summary>
        public int PendingCount => _queue.Count;

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            _cts.Cancel();
            _queue.CompleteAdding();
            _worker.Join(TimeSpan.FromSeconds(5));
            _queue.Dispose();
            _cts.Dispose();
        }

        private void WorkerLoop()
        {
            try
            {
                foreach (var request in _queue.GetConsumingEnumerable())
                {
                    request.Execute(_service);
                }
            }
            catch (OperationCanceledException) { /* 正常收尾 */ }
            catch (Exception ex)
            {
                // 队列整体出错时，把所有待处理请求标记为失败，避免调用方永久挂起
                foreach (var request in _queue.GetConsumingEnumerable())
                {
                    request.Fail(ex);
                }
            }
        }

        /// <summary>一个入队请求的抽象基类。</summary>
        private abstract class GitRequestBase
        {
            public abstract void Execute(IRepositoryService service);
            public abstract void Fail(Exception ex);
        }

        /// <summary>
        /// 不可变指令 + <see cref="TaskCompletionSource{TResult}"/> 回投通道。
        /// </summary>
        private sealed class GitRequest<T> : GitRequestBase
        {
            private readonly Func<IRepositoryService, T> _action;
            private readonly TaskCompletionSource<T> _tcs =
                new(TaskCreationOptions.RunContinuationsAsynchronously);

            public GitRequest(Func<IRepositoryService, T> action)
            {
                _action = action ?? throw new ArgumentNullException(nameof(action));
            }

            public Task<T> Task => _tcs.Task;

            public override void Execute(IRepositoryService service)
            {
                try { _tcs.SetResult(_action(service)); }
                catch (Exception ex) { _tcs.SetException(ex); }
            }

            public override void Fail(Exception ex) => _tcs.TrySetException(ex);
        }
    }

    internal static class TaskTimeoutExtensions
    {
        /// <summary>给 Task 加超时保护，避免 worker 挂起时调用方永久阻塞。</summary>
        public static async Task<T> TimeoutAfter<T>(this Task<T> task, TimeSpan timeout)
        {
            var delay = Task.Delay(timeout);
            var finished = await Task.WhenAny(task, delay).ConfigureAwait(false);
            if (finished != task)
                throw new TimeoutException($"Git operation did not complete within {timeout}.");
            return await task.ConfigureAwait(false);
        }
    }
}
