using GitUI.Core.Services;

namespace GitUI.Git;

/// <summary>仓库变化类别（位标志，一次去抖窗口内可合并多种来源）。</summary>
[Flags]
public enum RepoChangeKind
{
    None = 0,
    /// <summary>工作区文件变化（agent 写文件 / 外部编辑器保存）。</summary>
    Worktree = 1,
    /// <summary>HEAD 变化（commit / checkout / agent checkpoint）。</summary>
    Head = 2,
    /// <summary>index 变化（stage / unstage）。</summary>
    Index = 4,
}

/// <summary>RepoMonitor 参数（测试可注入短间隔）。零值/ null = 用默认值。</summary>
public sealed record RepoMonitorOptions(
    bool WatchFiles = true,
    bool FocusPoll = true,
    bool AutoFetch = true,
    TimeSpan? Debounce = null,
    TimeSpan? PollInterval = null,
    TimeSpan? FetchInterval = null)
{
    public static RepoMonitorOptions Default { get; } = new();
}

/// <summary>
/// 实时基座（ai-native-redesign.md §7.1）：FileSystemWatcher（500ms 去抖）+ 30s 焦点轮询兜底 +
/// 后台定时 fetch。所有 git 调用经 <see cref="GitWorker"/> 单队列串行执行（known-issues 2.3 接线），
/// 与前台操作靠"每请求独立句柄"保证安全。
///
/// 事件在线程池线程触发，订阅方自行回投 UI 线程。后台任务永不抛出：任何失败静默降级
/// （fetch 失败 / 轮询异常不中断监视）。
/// </summary>
public sealed class RepoMonitor : IDisposable
{
    /// <summary>FSW 事件到去抖触发的合并窗口。</summary>
    private static readonly TimeSpan DefaultDebounce = TimeSpan.FromMilliseconds(500);
    private static readonly TimeSpan DefaultPoll = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan DefaultFetch = TimeSpan.FromMinutes(5);

    private readonly IRepositoryService _repo;
    private readonly GitWorker _worker;
    private readonly RepoMonitorOptions _options;
    private readonly TimeSpan _debounce;
    private readonly TimeSpan _pollInterval;
    private readonly TimeSpan _fetchInterval;

    private System.IO.FileSystemWatcher? _fsw;
    private readonly System.Threading.Timer _debounceTimer;
    private readonly System.Threading.Timer _pollTimer;
    private readonly System.Threading.Timer _fetchTimer;

    private string? _workDir;
    private int _pendingFlags;              // 去抖窗口内合并的变化类别（volatile 语义经 Interlocked）
    private (string? Head, long IndexMtime, long HeadMtime) _probe;
    private int _fetchBusy;
    private bool _disposed;

    /// <summary>仓库变化（去抖后）。非 UI 线程。</summary>
    public event Action<RepoChangeKind>? Changed;

    /// <summary>一次后台 fetch 成功完成（远程引用可能更新）。非 UI 线程。</summary>
    public event Action? FetchCompleted;

    public RepoMonitor(IRepositoryService repo, GitWorker worker, RepoMonitorOptions? options = null)
    {
        _repo = repo ?? throw new ArgumentNullException(nameof(repo));
        _worker = worker ?? throw new ArgumentNullException(nameof(worker));
        _options = options ?? RepoMonitorOptions.Default;
        _debounce = _options.Debounce ?? DefaultDebounce;
        _pollInterval = _options.PollInterval ?? DefaultPoll;
        _fetchInterval = _options.FetchInterval ?? DefaultFetch;

        // 定时器全程存活（Dispose 才停）；回调里看 _workDir 是否为空决定是否干活，
        // 避免 Start/Stop 频繁重建定时器。 dueTime = Interval 意味着启动后先等一个完整周期。
        _debounceTimer = new System.Threading.Timer(_ => FlushPending(), null, Timeout.Infinite, Timeout.Infinite);
        _pollTimer = new System.Threading.Timer(_ => _ = PollAsync(),
            null, _options.FocusPoll ? _pollInterval : Timeout.InfiniteTimeSpan, _options.FocusPoll ? _pollInterval : Timeout.InfiniteTimeSpan);
        _fetchTimer = new System.Threading.Timer(_ => _ = FetchAsync(),
            null, _options.AutoFetch ? _fetchInterval : Timeout.InfiniteTimeSpan, _options.AutoFetch ? _fetchInterval : Timeout.InfiniteTimeSpan);
    }

    public string? WorkDir => _workDir;
    public bool IsWatching => _workDir is not null;

    /// <summary>开始监视一个仓库（重复调用 = 切换目标）。关闭监视用 <see cref="Stop"/>。</summary>
    public void Start(string workDir)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        ArgumentException.ThrowIfNullOrWhiteSpace(workDir);
        if (_workDir == workDir) return;

        Stop();
        _workDir = workDir;
        _probe = default;
        _pendingFlags = 0;

        if (_options.WatchFiles)
        {
            try
            {
                var fsw = new System.IO.FileSystemWatcher(workDir)
                {
                    IncludeSubdirectories = true,
                    NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite,
                    InternalBufferSize = 64 * 1024,
                };
                fsw.Created += (_, e) => OnFsEvent(e.FullPath ?? string.Empty);
                fsw.Changed += (_, e) => OnFsEvent(e.FullPath ?? string.Empty);
                fsw.Deleted += (_, e) => OnFsEvent(e.FullPath ?? string.Empty);
                fsw.Renamed += (_, e) => { OnFsEvent(e.OldFullPath ?? string.Empty); OnFsEvent(e.FullPath ?? string.Empty); };
                fsw.Error += (_, _) => { /* 缓冲溢出：轮询兜底 */ };
                fsw.EnableRaisingEvents = true;
                _fsw = fsw;
            }
            catch
            {
                // 网络盘/权限问题起不了 FSW：轮询兜底，不中断
                _fsw = null;
            }
        }
    }

    /// <summary>停止监视并释放 FSW（定时器保留，回调因 _workDir 为空而空转）。</summary>
    public void Stop()
    {
        var fsw = Interlocked.Exchange(ref _fsw, null);
        if (fsw is not null)
        {
            fsw.EnableRaisingEvents = false;
            fsw.Dispose();
        }
        _workDir = null;
        Interlocked.Exchange(ref _pendingFlags, 0);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        Stop();
        _debounceTimer.Dispose();
        _pollTimer.Dispose();
        _fetchTimer.Dispose();
    }

    // ---- FileSystemWatcher 路径 ----

    private void OnFsEvent(string fullPath)
    {
        if (_workDir is null || _disposed) return;

        var kind = Classify(fullPath, _workDir);
        if (kind == RepoChangeKind.None) return;

        Interlocked.Or(ref _pendingFlags, (int)kind);
        // 固定 due time：首个事件后 500ms 触发；持续写入只 OR 标志不重置，避免饿死
        _debounceTimer.Change(_debounce, Timeout.InfiniteTimeSpan);
    }

    /// <summary>.git 下的事件归 Head/Index（commit、checkout、stage 都会动 .git），其余归工作区。</summary>
    internal static RepoChangeKind Classify(string fullPath, string workDir)
    {
        if (string.IsNullOrEmpty(fullPath)) return RepoChangeKind.None;

        string? rel = null;
        var root = workDir.EndsWith(Path.DirectorySeparatorChar) || workDir.EndsWith(Path.AltDirectorySeparatorChar)
            ? workDir
            : workDir + Path.DirectorySeparatorChar;
        if (fullPath.StartsWith(root, StringComparison.OrdinalIgnoreCase))
            rel = fullPath[root.Length..];
        else if (fullPath.Equals(workDir, StringComparison.OrdinalIgnoreCase))
            return RepoChangeKind.Worktree;

        if (rel is null) return RepoChangeKind.Worktree;

        var seg = rel.Split('/', '\\');
        if (seg.Length == 0 || seg[0] != ".git") return RepoChangeKind.Worktree;

        return seg.Any(s => s.Equals("index", StringComparison.OrdinalIgnoreCase) || s.Equals("index.lock", StringComparison.OrdinalIgnoreCase))
            ? RepoChangeKind.Index
            : RepoChangeKind.Head;
    }

    private void FlushPending()
    {
        if (_disposed) return;
        var flags = Interlocked.Exchange(ref _pendingFlags, 0);
        if (flags != 0) Changed?.Invoke((RepoChangeKind)flags);
    }

    // ---- 焦点轮询兜底 ----

    /// <summary>
    /// 30s 探测（FSW 失效 / 网络盘兜底）：HEAD SHA + .git/index 与 .git/HEAD 的 mtime，
    /// 与上次快照比对，有差异即发事件。经 GitWorker 串行，异常吞掉。
    /// </summary>
    internal async Task PollAsync()
    {
        var workDir = _workDir;
        if (workDir is null || _disposed) return;

        try
        {
            var head = await _worker.Invoke(s => s.HeadSha(workDir)).ConfigureAwait(false);
            var (indexMtime, headMtime) = ProbeMtimes(workDir);
            var last = _probe;
            _probe = (head, indexMtime, headMtime);

            var kind = RepoChangeKind.None;
            if (last.Head != head && head is not null) kind |= RepoChangeKind.Head;
            if (last.IndexMtime != indexMtime && last != default) kind |= RepoChangeKind.Index;
            if (last.HeadMtime != headMtime && last != default) kind |= RepoChangeKind.Head;

            if (kind != RepoChangeKind.None) Changed?.Invoke(kind);
        }
        catch
        {
            // 仓库临时不可用（rebase 中间态等）：下个周期再试
        }
    }

    private static (long Index, long Head) ProbeMtimes(string workDir)
    {
        try
        {
            var gitDir = Path.Combine(workDir, ".git");
            var index = Ftime(Path.Combine(gitDir, "index"));
            var head = Ftime(Path.Combine(gitDir, "HEAD"));
            // worktree（git file 指向真实 gitdir）场景下读不到，返回 0 兜底
            return (index, head);
        }
        catch
        {
            return (0, 0);
        }
    }

    private static long Ftime(string path)
    {
        try
        {
            return File.GetLastWriteTimeUtc(path).Ticks;
        }
        catch
        {
            return 0;
        }
    }

    // ---- 后台 fetch ----

    private async Task FetchAsync()
    {
        var workDir = _workDir;
        if (workDir is null || _disposed) return;
        if (Interlocked.Exchange(ref _fetchBusy, 1) != 0) return;

        try
        {
            await _worker.Invoke(s => s.Fetch(workDir, null), TimeSpan.FromMinutes(3)).ConfigureAwait(false);
            FetchCompleted?.Invoke();
            // fetch 更新了远程引用，顺带探测一次 HEAD（本分支被快进等场景）
            await PollAsync().ConfigureAwait(false);
        }
        catch
        {
            // 认证失败 / 离线 / 无远程：静默，下个周期再试
        }
        finally
        {
            Interlocked.Exchange(ref _fetchBusy, 0);
        }
    }
}
