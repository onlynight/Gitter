using GitUI.Core.Models;
using GitUI.Core.Services;

namespace GitUI.ViewModels;

/// <summary>右侧 diff 面板的一个文件视图：hunks 供渲染，chunks 供 hunk 级暂存（一一对应）。</summary>
public sealed record FileDiffView(
    string Path,
    StatusCategory Category,
    bool IsStagedView,
    IReadOnlyList<DiffHunk> Hunks,
    IReadOnlyList<string> PatchChunks,
    bool CanStageHunks,
    bool OldEndsWithNewline = true,
    bool NewEndsWithNewline = true);

/// <summary>一次提交的结果。PushFailure 非 null 表示提交成功但推送失败（分类见 design.md §5.3）。</summary>
public sealed record CommitOutcome(string Sha, PushFailure? PushFailure);

/// <summary>推送失败摘要（分类 + 建议，供 InfoBar 呈现与重试决策）。</summary>
public sealed record PushFailure(PushFailureKind Kind, string Message, string Hint);

/// <summary>
/// Changes 页状态机（S5，design.md §4.3 / §8-S5）：
/// 三层列表（Changes / Staged / Unversioned，冲突文件独立成组展示）、
/// 勾选（IDEA 语义：勾选 = 纳入本次提交，Changes/Unversioned 勾选即暂存、
/// Staged 取消勾选即撤销暂存）、hunk 级暂存（git apply --cached 分块）、
/// 提交（幂等守卫）与推送（失败分类 + 重试）。
/// 线程模型同 LogViewModel：Task.Run + SemaphoreSlim 串行 + 双事件回投。
/// </summary>
public sealed class ChangesViewModel
{
    private readonly IRepositoryService _repo;
    private readonly SemaphoreSlim _gate = new(1, 1);

    private string? _workDir;
    private List<WorktreeFileStatus> _changes = new();
    private List<WorktreeFileStatus> _staged = new();
    private List<WorktreeFileStatus> _unversioned = new();
    private List<WorktreeFileStatus> _conflicts = new();
    private readonly Dictionary<string, bool> _checkedOverrides = new();

    /// <summary>
    /// 用户做过 hunk 级部分暂存的文件路径。提交时对这些文件不再整文件 add
    /// （整文件 add 会覆盖 index 的部分暂存结果）；显式 StageFileAsync 清除标记。
    /// </summary>
    private readonly HashSet<string> _partiallyStaged = new(StringComparer.Ordinal);

    private WorktreeFileStatus? _selected;
    private FileDiffView? _selectedDiff;

    private bool _isLoading;
    private string? _error;
    private string? _transient;
    private CommitOutcome? _lastOutcome;
    private string? _lastPushedMessage;
    private bool _isCommitting;

    public ChangesViewModel(IRepositoryService repo) => _repo = repo;

    /// <summary>列表 / 勾选 / 状态条 / 错误变化（含加载开始与结束）。</summary>
    public event Action? StructureChanged;

    /// <summary>选中文件与其 diff 变化。</summary>
    public event Action? SelectionChanged;

    public string? WorkDir => _workDir;
    public bool IsRepoOpen => _workDir is not null;
    public bool IsLoading => _isLoading;
    public string? Error => _error;

    /// <summary>错误完整详情（GitOperationException 的完整 stderr / 其他异常的 ToString），
    /// 供"复制错误详情"。无错误时为 null。</summary>
    public string? ErrorDetail { get; private set; }
    public string? TransientMessage => _transient;
    public CommitOutcome? LastOutcome => _lastOutcome;

    /// <summary>清掉一次性成功消息（页面 5s 定时器调用）。</summary>
    public void ClearTransient()
    {
        if (_transient is null) return;
        _transient = null;
        StructureChanged?.Invoke();
    }
    public bool IsCommitting => _isCommitting;

    public WorktreeFileStatus? Selected => _selected;
    public FileDiffView? SelectedDiff => _selectedDiff;

    public IReadOnlyList<WorktreeFileStatus> Changes => _changes;
    public IReadOnlyList<WorktreeFileStatus> Staged => _staged;
    public IReadOnlyList<WorktreeFileStatus> Unversioned => _unversioned;
    public IReadOnlyList<WorktreeFileStatus> Conflicts => _conflicts;

    public int CheckedCount =>
        _changes.Count(IsChecked) + _staged.Count(IsChecked)
        + _unversioned.Count(IsChecked) + _conflicts.Count(IsChecked);

    /// <summary>状态条文案。"已提交"前缀是提交成功的 UIA 断言锚点。</summary>
    public string StatusText =>
        _error is not null ? $"错误: {_error}"
        : _isCommitting ? "正在提交…"
        : _isLoading ? "加载中…"
        : _workDir is null ? "未打开仓库"
        : _transient is not null && CountSummary() == "工作区干净" ? _transient
        : _transient is not null ? $"{_transient} · {CountSummary()}"
        : CountSummary();

    private string CountSummary()
    {
        var parts = new List<string>();
        if (_changes.Count > 0) parts.Add($"{_changes.Count} 项变更");
        if (_staged.Count > 0) parts.Add($"{_staged.Count} 项已暂存");
        if (_unversioned.Count > 0) parts.Add($"{_unversioned.Count} 项未跟踪");
        if (_conflicts.Count > 0) parts.Add($"{_conflicts.Count} 项冲突");
        if (parts.Count == 0) return "工作区干净";
        parts.Add($"已勾选 {CheckedCount} 项");
        return string.Join(" · ", parts);
    }

    // ---- 勾选（IDEA 语义）----

    private static string Key(WorktreeFileStatus e) => $"{e.Category}|{e.Path}";

    public bool IsChecked(WorktreeFileStatus e)
    {
        if (_checkedOverrides.TryGetValue(Key(e), out var v)) return v;
        return e.Category is StatusCategory.Changes or StatusCategory.Staged;
    }

    public void SetChecked(WorktreeFileStatus e, bool value)
    {
        _checkedOverrides[Key(e)] = value;
        StructureChanged?.Invoke();
    }

    /// <summary>把某层全部文件设为同一勾选状态（组头"全部暂存/全部撤销"的勾选面）。</summary>
    public void SetAllChecked(StatusCategory category, bool value)
    {
        foreach (var e in FilesOf(category)) _checkedOverrides[Key(e)] = value;
        StructureChanged?.Invoke();
    }

    private List<WorktreeFileStatus> FilesOf(StatusCategory category) => category switch
    {
        StatusCategory.Changes => _changes,
        StatusCategory.Staged => _staged,
        StatusCategory.Unversioned => _unversioned,
        _ => _conflicts,
    };

    // ---- 打开 / 刷新 ----

    public async Task OpenRepositoryAsync(string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        await _gate.WaitAsync();
        try
        {
            SetLoading(true);
            string? workDir = null;
            string? error = null;
            try
            {
                workDir = await Task.Run(() => _repo.Open(path));
            }
            catch (Exception ex)
            {
                error = ex.Message;
            }

            _error = error;
            if (workDir is not null)
            {
                _workDir = workDir;
                _checkedOverrides.Clear();
                _partiallyStaged.Clear();
                _selected = null;
                _selectedDiff = null;
                _transient = null;
                await LoadCoreAsync();
                SelectionChanged?.Invoke();
            }
            SetLoading(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>刷新三层状态。外部工具改文件 / 提交后调用；勾选偏好按 (分类, 路径) 保留。</summary>
    public Task RefreshAsync() => WorkDir is null ? Task.CompletedTask : RunExclusive(LoadAsyncCore);

    // ---- 选择与 diff ----

    /// <summary>选中文件并加载其 diff（Staged 视图 = index vs HEAD；其余 = 工作区 vs index）。</summary>
    public async Task SelectAsync(WorktreeFileStatus entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        await _gate.WaitAsync();
        try
        {
            _selected = entry;
            _selectedDiff = null;
            SelectionChanged?.Invoke();

            var workDir = _workDir;
            if (workDir is null) return;
            try
            {
                var view = await Task.Run(() => LoadDiffCore(workDir, entry));
                _selectedDiff = view;
                _error = null; ErrorDetail = null;
            }
            catch (Exception ex)
            {
                SetError(ex);
            }
            SelectionChanged?.Invoke();
        }
        finally
        {
            _gate.Release();
        }
    }

    private FileDiffView? LoadDiffCore(string workDir, WorktreeFileStatus entry)
    {
        var stagedView = entry.Category == StatusCategory.Staged;
        var patch = stagedView
            ? _repo.GetIndexPatch(workDir, entry.Path)
            : _repo.GetWorktreePatch(workDir, entry.Path);
        if (patch is null) return null;

        var hunks = UnifiedPatch.ParseHunks(patch);
        var chunks = UnifiedPatch.SplitHunks(patch);
        // 渲染 hunk 与 apply 分块必须一一对应（同为 "@@" 边界）；不齐（mode change 等）禁用块级操作
        var canStage = hunks.Count > 0 && hunks.Count == chunks.Count;
        var (oldEof, newEof) = UnifiedPatch.DetectEndOfNewline(patch);
        return new FileDiffView(entry.Path, entry.Category, stagedView, hunks, chunks, canStage, oldEof, newEof);
    }

    /// <summary>
    /// hunk 级暂存（design.md §4.3"选中行暂存"）。
    /// <paramref name="hunkIndices"/> 为当前 <see cref="SelectedDiff"/> 的 hunk 序号；
    /// Staged 视图执行反向应用（撤销暂存该块），其余正向应用（暂存该块）。
    /// 成功后自动刷新并重新加载该文件的 diff。
    /// </summary>
    public async Task StageHunksAsync(IReadOnlyList<int> hunkIndices)
    {
        ArgumentNullException.ThrowIfNull(hunkIndices);
        if (hunkIndices.Count == 0) return;
        var view = _selectedDiff;
        var workDir = _workDir;
        var entry = _selected;
        if (view is null || !view.CanStageHunks || workDir is null || entry is null) return;

        await _gate.WaitAsync();
        try
        {
            try
            {
                var patch = string.Concat(hunkIndices.Select(i => view.PatchChunks[i]));
                await Task.Run(() => _repo.ApplyIndexPatch(workDir, patch, reverse: view.IsStagedView));
                if (!view.IsStagedView) _partiallyStaged.Add(view.Path);
                _error = null; ErrorDetail = null;
            }
            catch (Exception ex)
            {
                SetError(ex);
            }
            await LoadCoreAsync();
            ReloadSelectedDiff(workDir);
            SelectionChanged?.Invoke();
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>按路径在新层里重新定位选中文件并重载其 diff（hunk 暂存后该文件的 diff 面已变化）。</summary>
    private void ReloadSelectedDiff(string workDir)
    {
        if (_selected is null) return;
        var path = _selected.Path;
        var fresh = _changes.FirstOrDefault(e => e.Path == path)
                    ?? _staged.FirstOrDefault(e => e.Path == path)
                    ?? _unversioned.FirstOrDefault(e => e.Path == path);
        if (fresh is null)
        {
            _selected = null;
            _selectedDiff = null;
            return;
        }
        _selected = fresh;
        try
        {
            _selectedDiff = LoadDiffCore(workDir, fresh);
        }
        catch (Exception ex)
        {
            _selectedDiff = null;
            _error = ex.Message;
        }
    }

    /// <summary>整文件暂存（Changes/Unversioned）或撤销暂存（Staged）。成功后刷新。</summary>
    public Task StageFileAsync(WorktreeFileStatus entry) => StageFilesAsync(new[] { entry });

    public async Task StageFilesAsync(IReadOnlyList<WorktreeFileStatus> entries)
    {
        ArgumentNullException.ThrowIfNull(entries);
        if (entries.Count == 0) return;
        await _gate.WaitAsync();
        try
        {
            var workDir = _workDir;
            if (workDir is null) return;
            try
            {
                var staged = entries.Where(e => e.Category == StatusCategory.Staged).ToList();
                var rest = entries.Where(e => e.Category != StatusCategory.Staged).ToList();
                if (rest.Count > 0)
                {
                    var paths = rest.Select(e => e.Path).ToList();
                    await Task.Run(() => _repo.Stage(workDir, paths));
                    foreach (var p in paths) _partiallyStaged.Remove(p);
                }
                if (staged.Count > 0)
                    await Task.Run(() => _repo.Unstage(workDir, staged.Select(e => e.Path).ToList()));
                _error = null; ErrorDetail = null;
                _transient = null;
            }
            catch (Exception ex)
            {
                SetError(ex);
            }
            await LoadCoreAsync();
            SelectionChanged?.Invoke();
        }
        finally
        {
            _gate.Release();
        }
    }

    // ---- 提交与推送 ----

    /// <summary>
    /// 按勾选提交（勾选的 Changes/Unversioned 先暂存、取消勾选的 Staged 先撤销暂存），
    /// <paramref name="push"/> = 提交后推送。推送失败时提交仍然生效，
    /// 失败分类在 <see cref="CommitOutcome.PushFailure"/>，可 <see cref="RetryPushAsync"/>。
    /// in-flight 时再次调用直接返回 null（幂等守卫，重复点击不产生第二个提交）。
    /// </summary>
    public async Task<CommitOutcome?> CommitAsync(string message, bool push)
    {
        if (string.IsNullOrWhiteSpace(message))
        {
            _error = "提交消息不能为空";
            ErrorDetail = null;
            StructureChanged?.Invoke();
            return null;
        }
        if (_isCommitting || _workDir is null) return null;

        await _gate.WaitAsync();
        try
        {
            if (_isCommitting) return null;
            _isCommitting = true;
            _error = null; ErrorDetail = null;
            _transient = null;
            StructureChanged?.Invoke();

            var workDir = _workDir;
            var toStage = FilesOf(StatusCategory.Changes).Concat(FilesOf(StatusCategory.Unversioned))
                .Concat(FilesOf(StatusCategory.Conflict))
                .Where(IsChecked)
                .Select(e => e.Path)
                .Where(p => !_partiallyStaged.Contains(p)) // 部分暂存过的文件保留 index 现状，避免整文件 add 覆盖
                .ToList();
            var toUnstage = FilesOf(StatusCategory.Staged)
                .Where(e => !IsChecked(e))
                .Select(e => e.Path)
                .ToList();

            if (FilesOf(StatusCategory.Conflict).Any(IsChecked))
            {
                _isCommitting = false;
                _error = "存在未解决的冲突文件，请先解决冲突再提交";
                ErrorDetail = null;
                StructureChanged?.Invoke();
                return null;
            }

            CommitOutcome? outcome = null;
            try
            {
                var sha = await Task.Run(() =>
                {
                    if (toStage.Count > 0) _repo.Stage(workDir, toStage);
                    if (toUnstage.Count > 0) _repo.Unstage(workDir, toUnstage);
                    return _repo.Commit(workDir, message);
                });

                PushFailure? failure = null;
                if (push)
                {
                    _lastPushedMessage = message;
                    try
                    {
                        await Task.Run(() => _repo.Push(workDir, null, null));
                    }
                    catch (PushException pex)
                    {
                        failure = new PushFailure(pex.Kind, pex.Message, pex.Hint);
                    }
                }

                outcome = new CommitOutcome(sha, failure);
                _lastOutcome = outcome;
                _transient = $"已提交 {sha[..Math.Min(7, sha.Length)]}";
                // 提交消费了 index 里的部分暂存状态；工作区剩余改动是全新的未暂存内容，
                // 标记必须清除，否则下次勾选整文件提交会被跳过（known-issues 1.1）
                _partiallyStaged.Clear();
            }
            catch (InvalidOperationException ex)
            {
                SetError(ex);
            }
            catch (Exception ex)
            {
                SetError(ex);
            }

            _isCommitting = false;
            _checkedOverrides.Clear();
            await LoadCoreAsync();
            SelectionChanged?.Invoke();
            StructureChanged?.Invoke();
            return outcome;
        }
        finally
        {
            _isCommitting = false;
            _gate.Release();
        }
    }

    /// <summary>重试上次失败的推送（design.md §8-S5"可重试"）。无失败记录时返回 null。</summary>
    public async Task<PushFailure?> RetryPushAsync()
    {
        var workDir = _workDir;
        if (workDir is null || _lastOutcome?.PushFailure is null) return null;

        await _gate.WaitAsync();
        try
        {
            PushFailure? failure = null;
            try
            {
                await Task.Run(() => _repo.Push(workDir, null, null));
                _lastOutcome = _lastOutcome with { PushFailure = null };
                _transient = $"已提交 {_lastOutcome.Sha[..Math.Min(7, _lastOutcome.Sha.Length)]} · 推送成功";
            }
            catch (PushException pex)
            {
                failure = new PushFailure(pex.Kind, pex.Message, pex.Hint);
                _lastOutcome = _lastOutcome with { PushFailure = failure };
            }
            StructureChanged?.Invoke();
            return failure;
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>提交消息的 conventional 前缀建议（design.md §6.5）。</summary>
    public IReadOnlyList<string> PrefixSuggestions()
    {
        var paths = FilesOf(StatusCategory.Changes).Concat(FilesOf(StatusCategory.Unversioned))
            .Concat(FilesOf(StatusCategory.Staged))
            .Where(IsChecked)
            .Select(e => e.Path)
            .ToList();
        return CommitPrefixSuggester.Suggestions(paths);
    }

    /// <summary>最近提交消息（模板建议）。</summary>
    public IReadOnlyList<string> RecentMessages(int count = 20)
    {
        var workDir = _workDir;
        if (workDir is null) return Array.Empty<string>();
        try { return _repo.GetRecentCommitSubjects(workDir, count); }
        catch { return Array.Empty<string>(); }
    }

    // ---- 内部 ----

    private async Task LoadAsyncCore()
    {
        var workDir = _workDir!;
        try
        {
            var (status, unstagedStats, stagedStats) = await Task.Run(() =>
            {
                var s = _repo.GetStatus(workDir);
                var u = _repo.GetNumStat(workDir, staged: false);
                var st = _repo.GetNumStat(workDir, staged: true);
                return (s, u, st);
            });
            ApplyLayers(status, unstagedStats, stagedStats);
            _error = null; ErrorDetail = null;
            _transient = null;
        }
        catch (Exception ex)
        {
            _error = ex.Message;
        }
    }

    private void ApplyLayers(
        IReadOnlyList<WorktreeFileStatus> status,
        IReadOnlyDictionary<string, DiffNumStat> unstagedStats,
        IReadOnlyDictionary<string, DiffNumStat> stagedStats)
    {
        _changes = status.Where(s => s.Category == StatusCategory.Changes)
            .Select(s => WithStats(s, unstagedStats)).ToList();
        _staged = status.Where(s => s.Category == StatusCategory.Staged)
            .Select(s => WithStats(s, stagedStats)).ToList();
        _unversioned = status.Where(s => s.Category == StatusCategory.Unversioned).ToList();
        _conflicts = status.Where(s => s.Category == StatusCategory.Conflict).ToList();
    }

    private static WorktreeFileStatus WithStats(WorktreeFileStatus s, IReadOnlyDictionary<string, DiffNumStat> stats)
        => stats.TryGetValue(s.Path, out var st)
            ? s with { AddedLines = st.AddedLines, DeletedLines = st.DeletedLines }
            : s;

    private async Task RunExclusive(Func<Task> action)
    {
        await _gate.WaitAsync();
        try
        {
            SetLoading(true);
            await action();
            SetLoading(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task LoadCoreAsync()
    {
        // 已持有 _gate 时调用（Open/Commit/StageHunks/StageFiles 内部刷新）。
        // 层分布变化后必须触发 StructureChanged——S5 冒烟抓出：StageFiles 只发
        // SelectionChanged，三层列表与状态条永远不刷新，表现为"暂存了但 UI 没动"。
        var workDir = _workDir;
        if (workDir is null) return;
        try
        {
            var (status, unstagedStats, stagedStats) = await Task.Run(() =>
            {
                var s = _repo.GetStatus(workDir);
                var u = _repo.GetNumStat(workDir, staged: false);
                var st = _repo.GetNumStat(workDir, staged: true);
                return (s, u, st);
            });
            ApplyLayers(status, unstagedStats, stagedStats);
            StructureChanged?.Invoke();
        }
        catch (Exception ex)
        {
            _error = ex.Message;
            StructureChanged?.Invoke();
        }
    }

    /// <summary>统一错误写入：保留完整详情供复制（known-issues 1.7）。</summary>
    private void SetError(Exception ex)
    {
        _error = ex.Message;
        ErrorDetail = ex is GitOperationException g ? g.StdError : ex.ToString();
    }

    private void SetLoading(bool loading)
    {
        _isLoading = loading;
        StructureChanged?.Invoke();
    }
}

/// <summary>conventional commit 前缀建议（纯函数）。</summary>
public static class CommitPrefixSuggester
{
    public const string Feat = "feat:";
    public const string Fix = "fix:";
    public const string Docs = "docs:";
    public const string Test = "test:";
    public const string Build = "build:";
    public const string Chore = "chore:";

    /// <summary>按勾选文件路径给出全部可用前缀，首项为建议项（design.md §6.5）。</summary>
    public static IReadOnlyList<string> Suggestions(IReadOnlyList<string> paths)
    {
        var all = new[] { Feat, Fix, Docs, Test, Build, Chore };
        if (paths.Count == 0) return all;

        string suggested;
        if (paths.All(p => p.EndsWith(".md", StringComparison.OrdinalIgnoreCase)
                           || p.StartsWith("docs/", StringComparison.OrdinalIgnoreCase)))
            suggested = Docs;
        else if (paths.All(p =>
                    p.Contains("test", StringComparison.OrdinalIgnoreCase)
                    || p.StartsWith("tests/", StringComparison.OrdinalIgnoreCase)))
            suggested = Test;
        else if (paths.All(p =>
                    p.EndsWith(".csproj", StringComparison.OrdinalIgnoreCase)
                    || p.EndsWith(".sln", StringComparison.OrdinalIgnoreCase)
                    || p.EndsWith(".props", StringComparison.OrdinalIgnoreCase)
                    || p.EndsWith(".yml", StringComparison.OrdinalIgnoreCase)
                    || p.EndsWith(".yaml", StringComparison.OrdinalIgnoreCase)
                    || p.Contains("build", StringComparison.OrdinalIgnoreCase)))
            suggested = Build;
        else
            suggested = Feat;

        return new[] { suggested }.Concat(all.Where(p => p != suggested)).ToList();
    }
}
