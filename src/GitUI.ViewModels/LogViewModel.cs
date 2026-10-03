using GitUI.Core.Models;
using GitUI.Core.Services;

namespace GitUI.ViewModels;

/// <summary>
/// Log 页状态机（design.md §8-S4）。无 UI 依赖：分页加载、搜索过滤、按天分组与折叠、
/// 选中提交与变更文件。重活在 <see cref="Task.Run"/> 内执行（IRepositoryService 为同步接口），
/// 状态更新完成后触发 <see cref="StructureChanged"/> / <see cref="SelectionChanged"/>
/// （在 worker 线程触发，UI 侧经 DispatcherQueue 回投）。
/// 所有可变状态经 <see cref="_gate"/> 串行化，公开 Task 方法 await 返回后状态即可见。
/// </summary>
public sealed class LogViewModel
{
    /// <summary>每页条数（design.md §4.2 性能目标：首屏 50 条）。</summary>
    public const int PageSize = 50;

    private readonly IRepositoryService _repo;
    private readonly SemaphoreSlim _gate = new(1, 1);

    private List<CommitNode> _items = new();
    private List<LogDayGroup> _groups = new();
    private IReadOnlyList<LogRow> _rows = Array.Empty<LogRow>();
    private readonly HashSet<DateTime> _collapsedDays = new();

    private int _totalCount;
    private bool _hasMore;
    private bool _isLoading;
    private string? _error;

    private CommitNode? _selected;
    private IReadOnlyList<DiffResult> _selectedFiles = Array.Empty<DiffResult>();
    private string? _selectedError;

    public LogViewModel(IRepositoryService repo) => _repo = repo;

    /// <summary>结构性变化（仓库打开/分页/过滤/折叠/加载状态/错误）。</summary>
    public event Action? StructureChanged;

    /// <summary>选中提交的变更文件列表变化（轻量，不重建行）。</summary>
    public event Action? SelectionChanged;

    // ---- 只读状态（await 完成后读取）----

    public string? WorkDir { get; private set; }

    /// <summary>当前分支名，null 表示从 HEAD 走。</summary>
    public string? Branch { get; private set; }

    public string Query { get; private set; } = string.Empty;

    public IReadOnlyList<LogRow> Rows => _rows;
    public IReadOnlyList<LogDayGroup> Groups => _groups;
    public IReadOnlyList<BranchRef> Branches { get; private set; } = Array.Empty<BranchRef>();
    public bool HasMore => _hasMore;
    public bool IsLoading => _isLoading;
    public string? Error => _error;
    public bool IsRepoOpen => WorkDir is not null;

    public CommitNode? Selected => _selected;
    public IReadOnlyList<DiffResult> SelectedFiles => _selectedFiles;
    public string? SelectedError => _selectedError;

    /// <summary>状态条文案。UIA 冒烟以 "已加载 N / 共 M" 模式断言条目数。</summary>
    public string StatusText =>
        _error is not null ? $"错误: {_error}"
        : _isLoading ? "加载中…"
        : WorkDir is null ? "未打开仓库"
        : $"已加载 {_items.Count} / 共 {_totalCount}"
          + (_hasMore ? " · 滚动加载更多" : "")
          + (_groups.Count > 0 ? $" · {_groups.Count} 个分组" : "");

    // ---- 命令 ----

    /// <summary>打开仓库。重置分支与搜索；失败时置 <see cref="Error"/> 且不改变已打开状态。</summary>
    public async Task OpenRepositoryAsync(string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        await _gate.WaitAsync();
        try
        {
            SetLoading(true);

            string? workDir = null;
            IReadOnlyList<BranchRef> branches = Array.Empty<BranchRef>();
            LogPage page;
            try
            {
                (workDir, branches, page) = await Task.Run(() =>
                {
                    var wd = _repo.Open(path);
                    var br = _repo.GetBranches(wd);
                    var pg = _repo.GetLog(wd, new LogFilter(Limit: PageSize, Skip: 0));
                    return (wd, br, pg);
                });
            }
            catch (Exception ex)
            {
                page = new LogPage(Array.Empty<CommitNode>(), 0, 0, PageSize);
                _error = ex.Message;
            }

            if (workDir is not null)
            {
                WorkDir = workDir;
                Branches = branches;
                Branch = null;
                Query = string.Empty;
                _selected = null;
                _selectedFiles = Array.Empty<DiffResult>();
                _selectedError = null;
                _collapsedDays.Clear();
                ApplyPage(page, reset: true);
                SelectionChanged?.Invoke();
            }
            SetLoading(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>切换分支（null = HEAD）。未打开仓库时忽略。</summary>
    public Task SetBranchAsync(string? branch)
    {
        if (WorkDir is null) return Task.CompletedTask;
        Branch = branch;
        _collapsedDays.Clear();
        return LoadAsync(reset: true);
    }

    /// <summary>应用搜索文本（design.md §8-S4"搜索过滤"）。未打开仓库时忽略。</summary>
    public Task SetQueryAsync(string query)
    {
        if (WorkDir is null) return Task.CompletedTask;
        Query = query ?? string.Empty;
        _collapsedDays.Clear();
        return LoadAsync(reset: true);
    }

    /// <summary>刷新（同参数重载第一页）。</summary>
    public Task RefreshAsync() => WorkDir is null ? Task.CompletedTask : LoadAsync(reset: true);

    /// <summary>滚动加载下一页（design.md §8-S4"分页加载数量"）。无更多或加载中时为空操作。</summary>
    public async Task LoadNextPageAsync()
    {
        if (!_hasMore || _isLoading || WorkDir is null) return;
        await _gate.WaitAsync();
        try
        {
            if (!_hasMore) return;
            SetLoading(true);
            var workDir = WorkDir;
            var branch = Branch;
            var query = Query;
            var skip = _items.Count;
            LogPage page;
            try
            {
                page = await Task.Run(() => _repo.GetLog(
                    workDir, BuildFilter(query, branch, skip)));
                _error = null;
            }
            catch (Exception ex)
            {
                _error = ex.Message;
                page = new LogPage(Array.Empty<CommitNode>(), _totalCount, skip, PageSize);
            }
            ApplyPage(page, reset: false);
            SetLoading(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>展开/折叠某天的分组。折叠状态跨分页保留。</summary>
    public void ToggleCollapse(DateTime day)
    {
        if (!_collapsedDays.Remove(day)) _collapsedDays.Add(day);
        RebuildRows();
        StructureChanged?.Invoke();
    }

    /// <summary>选中提交并加载其变更文件（design.md §8-S4"点击提交 → 右侧文件列表"）。</summary>
    public async Task SelectAsync(CommitNode commit)
    {
        ArgumentNullException.ThrowIfNull(commit);
        await _gate.WaitAsync();
        try
        {
            _selected = commit;
            _selectedError = null;
            // 先给出选择反馈（文件加载前的空列表），再异步取文件
            _selectedFiles = Array.Empty<DiffResult>();
            SelectionChanged?.Invoke();

            var workDir = WorkDir;
            if (workDir is null) return;
            IReadOnlyList<DiffResult> files;
            try
            {
                files = await Task.Run(() => _repo.GetCommitDiff(workDir, commit.Sha));
                _selectedError = null;
            }
            catch (Exception ex)
            {
                files = Array.Empty<DiffResult>();
                _selectedError = ex.Message;
            }
            _selectedFiles = files;
            SelectionChanged?.Invoke();
        }
        finally
        {
            _gate.Release();
        }
    }

    // ---- 内部 ----

    private async Task LoadAsync(bool reset)
    {
        await _gate.WaitAsync();
        try
        {
            SetLoading(true);
            var workDir = WorkDir!;
            var branch = Branch;
            var query = Query;
            LogPage page;
            try
            {
                page = await Task.Run(() => _repo.GetLog(
                    workDir, BuildFilter(query, branch, skip: 0)));
                _error = null;
            }
            catch (Exception ex)
            {
                _error = ex.Message;
                page = new LogPage(Array.Empty<CommitNode>(), 0, 0, PageSize);
            }
            if (reset && _selected is not null)
            {
                _selected = null;
                _selectedFiles = Array.Empty<DiffResult>();
                SelectionChanged?.Invoke();
            }
            ApplyPage(page, reset);
            SetLoading(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    private static LogFilter BuildFilter(string query, string? branch, int skip)
    {
        var parsed = LogFilterParser.Parse(query, PageSize, skip);
        // 搜索文本未写 branch: 时，UI 分支选择生效
        return parsed.Branch is null && branch is not null ? parsed with { Branch = branch } : parsed;
    }

    /// <summary>应用一页结果并重建分组与扁平行。</summary>
    private void ApplyPage(LogPage page, bool reset)
    {
        if (reset)
        {
            _items = page.Items.ToList();
        }
        else
        {
            var known = new HashSet<string>(_items.Select(c => c.Sha), StringComparer.Ordinal);
            _items.AddRange(page.Items.Where(c => known.Add(c.Sha)));
        }

        _totalCount = page.TotalCount;
        _hasMore = page.TotalCount > 0 && _items.Count < page.TotalCount;
        RebuildRows();
        StructureChanged?.Invoke();
    }

    private void RebuildRows()
    {
        _groups = LogDayGrouping.Group(_items);
        var rows = new List<LogRow>(_items.Count + _groups.Count);
        foreach (var g in _groups)
        {
            var collapsed = _collapsedDays.Contains(g.Day);
            rows.Add(new LogGroupHeaderRow(g.Day, g.Title, g.Commits.Count, collapsed));
            if (collapsed) continue;
            foreach (var c in g.Commits)
            {
                var badges = c.BranchNames.Select(n => new LogBadge(n, IsTag: false))
                    .Concat(c.TagNames.Select(n => new LogBadge(n, IsTag: true)))
                    .ToList();
                rows.Add(new LogCommitRow(
                    c,
                    IsSelected: c == _selected,
                    MetaText: $"{c.Author} · {LogFormatting.Relative(c.CommitterDate, DateTimeOffset.Now)}",
                    Badges: badges));
            }
        }
        _rows = rows;
    }

    private void SetLoading(bool loading)
    {
        _isLoading = loading;
        StructureChanged?.Invoke();
    }
}
