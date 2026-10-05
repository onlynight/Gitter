using GitUI.Core.Models;
using GitUI.Core.Resources;
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
    private readonly HashSet<string> _collapsedSessions = new(StringComparer.Ordinal);

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
        _error is not null ? string.Format(Strings.Common_ErrorPrefix, _error)
        : _isLoading ? Strings.Common_Loading
        : WorkDir is null ? Strings.Common_NoRepoOpen
        : string.Format(Strings.Log_LoadedStatus, _items.Count, _totalCount)
          + (_hasMore ? Strings.Log_ScrollMore : "")
          + (_groups.Count > 0 ? string.Format(Strings.Log_GroupsSuffix, _groups.Count) : "");

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
                _compareBase = null;
                _selectedFiles = Array.Empty<DiffResult>();
                _selectedError = null;
                _collapsedDays.Clear();
                _collapsedSessions.Clear();
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

    /// <summary>
    /// 关闭仓库（项目页移除当前项目时调用）：清空全部状态回"未打开仓库"。
    /// 与 <see cref="OpenRepositoryAsync"/> 并发的窗口极窄（均为 UI 线程触发），
    /// 即使一次在途加载晚到重开，下次任意操作也会被最新 WorkDir 校正。
    /// </summary>
    public void CloseRepository()
    {
        WorkDir = null;
        Branch = null;
        Query = string.Empty;
        Branches = Array.Empty<BranchRef>();
        _items = new List<CommitNode>();
        _totalCount = 0;
        _hasMore = false;
        _error = null;
        _compareBase = null;
        _selected = null;
        _selectedFiles = Array.Empty<DiffResult>();
        _selectedError = null;
        _collapsedDays.Clear();
        _collapsedSessions.Clear();
        RebuildRows();
        SelectionChanged?.Invoke();
        StructureChanged?.Invoke();
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

    /// <summary>
    /// 只刷新分支列表（known-issues 1.2：分支页增删分支后 Log 页下拉联动），
    /// 不动已加载的提交与选中状态。
    /// </summary>
    public async Task RefreshBranchesAsync()
    {
        var workDir = WorkDir;
        if (workDir is null) return;
        await _gate.WaitAsync();
        try
        {
            Branches = await Task.Run(() => _repo.GetBranches(workDir));
            StructureChanged?.Invoke();
        }
        finally
        {
            _gate.Release();
        }
    }

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

    /// <summary>展开/折叠一个 agent 会话卡（ai-native-redesign.md §5.1）。跨分页保留。</summary>
    public void ToggleSession(string sessionId)
    {
        if (!_collapsedSessions.Remove(sessionId)) _collapsedSessions.Add(sessionId);
        RebuildRows();
        StructureChanged?.Invoke();
    }

    /// <summary>
    /// 会话整理（session squash，ai-native-redesign.md §4.3）：soft reset 到会话最老提交的父，
    /// 以聚合 message 重新提交。仅当会话 tip 是当前 HEAD（避免移动别的分支）。
    /// 失败写 Error；成功后刷新（原提交链在 reflog 可回退）。
    /// </summary>
    public async Task SquashSessionAsync(AgentSession session)
    {
        var workDir = WorkDir;
        if (workDir is null || session.Commits.Count == 0) return;

        await _gate.WaitAsync();
        try
        {
            SetLoading(true);
            try
            {
                var (newSha, error) = await Task.Run(() =>
                {
                    try
                    {
                        var head = _repo.HeadSha(workDir);
                        var tip = session.Commits[0];
                        if (head is null || head != tip.Sha)
                            return ((string?)null, (string?)Strings.Log_SquashNotHead);
                        var oldest = session.Commits[^1];
                        if (oldest.ParentShas.Length == 0)
                            return ((string?)null, (string?)Strings.Log_SquashRootCommit);
                        _repo.ResetTo(workDir, oldest.ParentShas[0], ResetMode.Soft);
                        var sha = _repo.Commit(workDir, session.SquashMessage());
                        return ((string?)sha, (string?)null);
                    }
                    catch (Exception ex)
                    {
                        return ((string?)null, (string?)ex.Message);
                    }
                });
                if (error is not null)
                {
                    _error = error;
                }
                else
                {
                    _error = null;
                    _selected = null;
                    _selectedFiles = Array.Empty<DiffResult>();
                    SelectionChanged?.Invoke();
                    await ReloadCoreAsync();
                }
            }
            finally
            {
                SetLoading(false);
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>同参数重载当前页（squash 后调用；持有 _gate）。</summary>
    private async Task ReloadCoreAsync()
    {
        var workDir = WorkDir;
        if (workDir is null) return;
        try
        {
            var page = await Task.Run(() => _repo.GetLog(workDir, BuildFilter(Query, Branch, skip: 0)));
            _error = null;
            _totalCount = page.TotalCount;
            _items = page.Items.ToList();
            _hasMore = page.TotalCount > 0 && _items.Count < page.TotalCount;
        }
        catch (Exception ex)
        {
            _error = ex.Message;
        }
        RebuildRows();
        StructureChanged?.Invoke();
    }

    /// <summary>
    /// 以当前语言/文化重建行与分组标题（语言热切换用，docs/i18n.md §四）。
    /// 不触发事件——调用方（页面）随后自行 Rebind，避免重入。
    /// </summary>
    public void RefreshRows() => RebuildRows();

    /// <summary>选中提交并加载其变更文件（design.md §8-S4"点击提交 → 右侧文件列表"）。
    /// 设置了比较基准时（S7 通用 git diff），加载的是所选提交对基准提交的树 diff。</summary>
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
            var baseCommit = _compareBase;
            IReadOnlyList<DiffResult> files;
            try
            {
                files = await Task.Run(() =>
                    baseCommit is not null && baseCommit.Sha != commit.Sha
                        ? _repo.GetTreeDiff(workDir, baseCommit.Sha, commit.Sha)
                        : _repo.GetCommitDiff(workDir, commit.Sha));
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

    // ---- S7 通用 git diff：比较基准（任意两点比较，design.md §4.2 P1）----

    private CommitNode? _compareBase;

    /// <summary>
    /// 比较基准提交。非空且不等于所选提交时，右侧文件列表显示
    /// "所选提交 对 基准提交" 的树 diff；null 恢复默认"对父提交"。
    /// </summary>
    public CommitNode? CompareBase => _compareBase;

    public void SetCompareBase(CommitNode? baseCommit)
    {
        _compareBase = baseCommit;
        StructureChanged?.Invoke();
        // 重新加载当前选中的差异面
        if (_selected is not null) _ = SelectAsync(_selected);
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
        var sessions = LogSessionGrouping.Group(_items);

        var rows = new List<LogRow>(_items.Count + _groups.Count + sessions.Count);
        var sessionBySha = new Dictionary<string, AgentSession>(StringComparer.Ordinal);
        foreach (var sess in sessions)
            foreach (var c in sess.Commits)
                sessionBySha[c.Sha] = sess;
        var emittedSessions = new HashSet<string>(StringComparer.Ordinal);

        foreach (var g in _groups)
        {
            var collapsed = _collapsedDays.Contains(g.Day);
            rows.Add(new LogGroupHeaderRow(g.Day, g.Title, g.Commits.Count, collapsed));
            if (collapsed) continue;
            foreach (var c in g.Commits)
            {
                // 会话卡（§5.1）：成员提交首次出现时先发卡片行；折叠则吞掉整个会话
                // （跨天会话的后段天里不再重复发卡、也不再发成员行）
                if (sessionBySha.TryGetValue(c.Sha, out var session))
                {
                    var isCollapsedSession = _collapsedSessions.Contains(session.SessionId);
                    if (emittedSessions.Add(session.SessionId))
                    {
                        rows.Add(new LogSessionRow(
                            session,
                            isCollapsedSession,
                            string.Format(Strings.Log_SessionTitle, session.AgentId, session.Commits.Count),
                            $"{LogFormatting.Relative(session.Start, DateTimeOffset.Now)}"));
                        if (isCollapsedSession) continue;
                    }
                    else if (isCollapsedSession)
                    {
                        continue;
                    }
                }

                var meta = CommitTrailers.Read(c.Message);
                var badges = c.BranchNames.Select(n => new LogBadge(n, IsTag: false))
                    .Concat(c.TagNames.Select(n => new LogBadge(n, IsTag: true)))
                    .ToList();
                if (meta.IsAi && !sessionBySha.ContainsKey(c.Sha))
                    badges.Add(new LogBadge(Strings.Log_AiBadge, IsTag: true)); // 孤立 AI 提交打徽标
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
