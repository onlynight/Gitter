using System.Globalization;
using GitUI.Core.Ai;
using GitUI.Core.Models;
using GitUI.Core.Resources;
using GitUI.Core.Rules;
using GitUI.Core.Services;
using GitUI.Core.Settings;

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
    private readonly CommitSafetyOptions? _safetyOptions;
    private IAiGateway? _ai;

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

    /// <summary>最近一次安全网扫描发现（Off 模式为空）。UI 呈现用，提交后清空。</summary>
    private IReadOnlyList<RuleFinding> _lastFindings = Array.Empty<RuleFinding>();

    /// <summary>
    /// 当前提交信息是否由 AI 生成（<see cref="GenerateCommitMessageAsync"/> 成功置位）。
    /// CommitAsync 消费：按设置追加 Assisted-by trailer 后清除（ai-native-redesign.md §5.2）。
    /// </summary>
    private string? _pendingAiTrailer;

    /// <param name="safety">安全网扫描参数；null = 扫描（阈值默认）。Off/Warn/Block 档位由 <see cref="SafetyNetMode"/> 控制。</param>
    /// <param name="ai">AI 网关；null = AI 提交信息生成不可用（入口隐藏）。</param>
    public ChangesViewModel(
        IRepositoryService repo,
        CommitSafetyOptions? safety = null,
        IAiGateway? ai = null)
    {
        _repo = repo;
        _safetyOptions = safety;
        _ai = ai;
    }

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

    // ---- AI 与安全网（ai-native-redesign.md §四 / §八）----

    /// <summary>提交前安全网档位（设置页修改后由页面回写）。</summary>
    public CommitSafetyMode SafetyNetMode { get; set; } = CommitSafetyMode.Warn;

    /// <summary>AI 隐私档位（生成提交信息时决定是否随请求发送 diff 全文）。</summary>
    public AiPrivacyLevel AiPrivacy { get; set; } = AiPrivacyLevel.MetadataOnly;

    /// <summary>AI 提交信息生成是否可用（网关已配置且隐私档位非 Disabled）。</summary>
    public bool IsAiAvailable => _ai is { IsConfigured: true } && AiPrivacy != AiPrivacyLevel.Disabled;

    /// <summary>最近一次安全网扫描发现（提交动作之间保留，供 UI 呈现；Off 模式始终为空）。</summary>
    public IReadOnlyList<RuleFinding> LastFindings => _lastFindings;

    /// <summary>AI 生成的 trailer 溯源 id（Assisted-by 值，如 provider/model）；由页面在生成后设置。</summary>
    public string? AiTrailerId { get; set; }

    /// <summary>设置变更时由页面整体回写（网关可换、档位即时生效；线程模型：UI 线程调用）。</summary>
    public void UpdateAi(
        CommitSafetyMode safetyMode,
        AiPrivacyLevel privacy,
        string? trailerId,
        IAiGateway? gateway)
    {
        SafetyNetMode = safetyMode;
        AiPrivacy = privacy;
        AiTrailerId = trailerId;
        _ai = gateway;
        StructureChanged?.Invoke();
    }

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
        _error is not null ? string.Format(Strings.Common_ErrorPrefix, _error)
        : _isCommitting ? Strings.Changes_Committing
        : _isLoading ? Strings.Common_Loading
        : _workDir is null ? Strings.Common_NoRepoOpen
        : _transient is not null && CountSummary() == Strings.Changes_CleanTree ? _transient
        : _transient is not null ? $"{_transient} · {CountSummary()}"
        : CountSummary();

    private string CountSummary()
    {
        var parts = new List<string>();
        if (_changes.Count > 0) parts.Add(string.Format(Strings.Changes_CountChanges, _changes.Count));
        if (_staged.Count > 0) parts.Add(string.Format(Strings.Changes_CountStaged, _staged.Count));
        if (_unversioned.Count > 0) parts.Add(string.Format(Strings.Changes_CountUntracked, _unversioned.Count));
        if (_conflicts.Count > 0) parts.Add(string.Format(Strings.Changes_CountConflicts, _conflicts.Count));
        if (parts.Count == 0) return Strings.Changes_CleanTree;
        parts.Add(string.Format(Strings.Changes_CheckedCount, CheckedCount));
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

    /// <summary>
    /// 关闭仓库（项目页移除当前项目时调用）：清空全部状态回"未打开仓库"。
    /// 与在途加载并发的窗口极窄（均为 UI 线程触发），晚到结果会被下次操作校正。
    /// </summary>
    public void CloseRepository()
    {
        _workDir = null;
        _changes = new List<WorktreeFileStatus>();
        _staged = new List<WorktreeFileStatus>();
        _unversioned = new List<WorktreeFileStatus>();
        _conflicts = new List<WorktreeFileStatus>();
        _checkedOverrides.Clear();
        _partiallyStaged.Clear();
        _selected = null;
        _selectedDiff = null;
        _error = null;
        ErrorDetail = null;
        _transient = null;
        _lastOutcome = null;
        _lastPushedMessage = null;
        _lastFindings = Array.Empty<RuleFinding>();
        _pendingAiTrailer = null;
        _riskFindings = new Dictionary<string, List<RuleFinding>>(StringComparer.Ordinal);
        AgentFeedback = null;
        Explanation = null;
        IsExplaining = false;
        StructureChanged?.Invoke();
        SelectionChanged?.Invoke();
    }

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
            _error = Strings.Changes_EmptyMessage;
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
                _error = Strings.Changes_UnresolvedConflicts;
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

                    // 提交前安全网（ai-native-redesign.md §4.2）：staged 内容规则扫描，
                    // Block 模式命中阻止级即拒绝提交（index 保持已暂存状态，处理后再提交）。
                    var fullMessage = _pendingAiTrailer is not null && !message.Contains("Assisted-by:", StringComparison.Ordinal)
                        ? message.TrimEnd() + "\n\nAssisted-by: " + _pendingAiTrailer
                        : message;
                    var blocked = RunSafetyNet(workDir, CommittedPaths(toStage, toUnstage));
                    if (blocked is not null)
                    {
                        _lastFindings = blocked.Value.Findings;
                        throw new SafetyNetBlockedException(blocked.Value.Summary);
                    }

                    return _repo.Commit(workDir, fullMessage);
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
                _transient = string.Format(Strings.Changes_Committed, sha[..Math.Min(7, sha.Length)]);
                if (_lastFindings.Count > 0 && SafetyNetMode == CommitSafetyMode.Warn)
                    _transient += " · " + string.Format(Strings.Changes_SafetyWarnings, _lastFindings.Count);
                // 提交消费了 index 里的部分暂存状态；工作区剩余改动是全新的未暂存内容，
                // 标记必须清除，否则下次勾选整文件提交会被跳过（known-issues 1.1）
                _partiallyStaged.Clear();
                // Warn 模式的安全网发现保留展示（transient 已带计数）；下次提交时重新扫描
                _pendingAiTrailer = null;
            }
            catch (SafetyNetBlockedException ex)
            {
                _error = ex.Message;
                ErrorDetail = FormatFindings(_lastFindings);
                _transient = null;
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
                _transient = string.Format(Strings.Changes_Committed, _lastOutcome.Sha[..Math.Min(7, _lastOutcome.Sha.Length)]) + Strings.Changes_PushedSuffix;
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

    // ---- 提交前安全网（ai-native-redesign.md §4.2）----

    /// <summary>本次提交实际会进入 index 的文件路径（勾选 staged + 待暂存 + 部分暂存且勾选）。</summary>
    private List<string> CommittedPaths(List<string> toStage, List<string> toUnstage) =>
        toStage
            .Concat(FilesOf(StatusCategory.Staged).Where(IsChecked).Select(e => e.Path))
            .Concat(FilesOf(StatusCategory.Changes).Concat(FilesOf(StatusCategory.Unversioned))
                .Where(e => IsChecked(e) && _partiallyStaged.Contains(e.Path))
                .Select(e => e.Path))
            .Where(p => !toUnstage.Contains(p))
            .Distinct(StringComparer.Ordinal)
            .ToList();

    /// <summary>
    /// 扫描 staged 内容。返回非 null = Block 模式命中阻止级（值含全部发现与摘要）；
    /// 返回 null = 通过（Warn 模式的发现已记入 <see cref="LastFindings"/>，Off 模式直接跳过）。
    /// 必须在 Stage/Unstage 之后调用，index 才反映提交内容。
    /// </summary>
    private (IReadOnlyList<RuleFinding> Findings, string Summary)? RunSafetyNet(string workDir, IReadOnlyList<string> paths)
    {
        if (SafetyNetMode == CommitSafetyMode.Off)
        {
            _lastFindings = Array.Empty<RuleFinding>();
            return null;
        }

        var numstat = _repo.GetNumStat(workDir, staged: true);
        var inputs = new List<StagedFileInput>(paths.Count);
        foreach (var path in paths)
        {
            var patch = _repo.GetIndexPatch(workDir, path);
            if (patch is null) continue;
            DiffNumStat? stat = numstat.TryGetValue(path, out var n) ? n : null;
            var binary = stat is { AddedLines: null, DeletedLines: null }
                || patch.Contains("GIT binary patch", StringComparison.Ordinal)
                || patch.Contains("Binary files ", StringComparison.Ordinal);
            inputs.Add(new StagedFileInput(
                path, patch, binary,
                IsNew: patch.Contains("new file mode", StringComparison.Ordinal),
                stat?.AddedLines ?? 0,
                stat?.DeletedLines ?? 0));
        }

        var findings = CommitSafetyScanner.Scan(inputs, _safetyOptions ?? CommitSafetyOptions.Default);
        _lastFindings = findings;

        var blocking = CommitSafetySummarizer.Blocking(findings);
        return SafetyNetMode == CommitSafetyMode.Block && blocking.Count > 0
            ? (findings, string.Format(Strings.Changes_SafetyBlocked, blocking.Count))
            : null;
    }

    private static string FormatFindings(IReadOnlyList<RuleFinding> findings) =>
        string.Join(Environment.NewLine, findings.Select(f =>
            $"{f.FilePath}:{f.Line?.ToString(CultureInfo.InvariantCulture) ?? "-"} [{f.RuleId}] {f.Message}"));

    /// <summary>AI 生成提交信息草稿（ai-native-redesign.md §4.1）。失败写入 Error 并返回 null；成功置 trailer 待提交时追加。</summary>
    public async Task<string?> GenerateCommitMessageAsync(CancellationToken ct = default)
    {
        if (!IsAiAvailable || _ai is null)
        {
            _error = Strings.Changes_AiNotConfigured;
            ErrorDetail = null;
            StructureChanged?.Invoke();
            return null;
        }
        var workDir = _workDir;
        if (workDir is null) return null;

        await _gate.WaitAsync();
        try
        {
            try
            {
                var input = await Task.Run(() => BuildAiInput(workDir)).ConfigureAwait(false);

                // FullDiff 档发送前过 secrets 规则，命中即阻断（§8.2）
                if (AiPrivacy == AiPrivacyLevel.FullDiff)
                {
                    var findings = CommitSafetyScanner.Scan(input.ScanInputs);
                    if (CommitSafetySummarizer.Blocking(findings).Count > 0)
                    {
                        _lastFindings = findings;
                        _error = Strings.Changes_AiBlockedBySecrets;
                        ErrorDetail = FormatFindings(findings);
                        StructureChanged?.Invoke();
                        return null;
                    }
                }

                var recent = _repo.GetRecentCommitSubjects(workDir, 20);
                var prompt = CommitMessagePromptBuilder.Build(
                    new CommitMessageInput(recent, input.Files, input.DiffText), AiPrivacy);

                var draft = await _ai.CompleteAsync(prompt, ct).ConfigureAwait(false);
                var cleaned = CommitMessagePromptBuilder.CleanDraft(draft);
                if (cleaned.Length == 0)
                {
                    _error = Strings.Changes_AiEmptyDraft;
                    ErrorDetail = null;
                    StructureChanged?.Invoke();
                    return null;
                }
                // trailer 关闭（AiTrailerId = null）时不署名
                _pendingAiTrailer = AiTrailerId;
                _error = null; ErrorDetail = null;
                StructureChanged?.Invoke();
                return cleaned;
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                SetError(ex);
                StructureChanged?.Invoke();
                return null;
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    private (List<CommitMessageFile> Files, string? DiffText, List<StagedFileInput> ScanInputs) BuildAiInput(string workDir)
    {
        var stagedStats = _repo.GetNumStat(workDir, staged: true);
        var workStats = _repo.GetNumStat(workDir, staged: false);
        var paths = FilesOf(StatusCategory.Staged).Where(IsChecked).Select(e => e.Path)
            .Concat(FilesOf(StatusCategory.Changes).Where(IsChecked).Select(e => e.Path))
            .Concat(FilesOf(StatusCategory.Unversioned).Where(IsChecked).Select(e => e.Path))
            .Distinct(StringComparer.Ordinal)
            .ToList();

        var files = new List<CommitMessageFile>(paths.Count);
        var scanInputs = new List<StagedFileInput>(paths.Count);
        var diffs = new List<string>(paths.Count);
        foreach (var path in paths)
        {
            var isStaged = stagedStats.ContainsKey(path);
            DiffNumStat? stat = (isStaged ? stagedStats : workStats).TryGetValue(path, out var n) ? n : null;
            var added = stat?.AddedLines ?? 0;
            var deleted = stat?.DeletedLines ?? 0;
            files.Add(new CommitMessageFile(path, added, deleted));

            string? patch = null;
            try { patch = isStaged ? _repo.GetIndexPatch(workDir, path) : _repo.GetWorktreePatch(workDir, path); }
            catch { /* 单文件 patch 失败不阻塞生成（降级为元数据） */ }
            if (patch is not null)
            {
                scanInputs.Add(new StagedFileInput(path, patch,
                    IsBinary: stat is { AddedLines: null, DeletedLines: null }
                        || patch.Contains("GIT binary patch", StringComparison.Ordinal)
                        || patch.Contains("Binary files ", StringComparison.Ordinal),
                    IsNew: patch.Contains("new file mode", StringComparison.Ordinal),
                    added, deleted));
                diffs.Add(patch);
            }
        }

        var diffText = diffs.Count > 0 ? string.Join("\n", diffs) : null;
        return (files, diffText, scanInputs);
    }

    /// <summary>安全网阻止级异常：把发现摘要带到错误横幅（详情走 ErrorDetail 复制）。</summary>
    private sealed class SafetyNetBlockedException : Exception
    {
        public SafetyNetBlockedException(string summary) : base(summary) { }
    }

    // ---- 验收台 v1（ai-native-redesign.md §三）----

    /// <summary>风险扫描单次最多处理的文件数（超出部分不出徽标，防超大变更集拖垮 UI）。</summary>
    private const int MaxRiskScanFiles = 300;

    private Dictionary<string, List<RuleFinding>> _riskFindings = new(StringComparer.Ordinal);

    /// <summary>AI 解释进行中（页面据此禁用按钮、显示生成中）。</summary>
    public bool IsExplaining { get; private set; }

    /// <summary>最近一次 AI 解释/批注文本；null = 尚无。</summary>
    public string? Explanation { get; private set; }

    public ExplainScope Scope { get; set; } = ExplainScope.SelectedFile;

    public enum ExplainScope
    {
        SelectedFile = 0,
        CheckedFiles = 1,
    }

    /// <summary>清除 AI 批注（面板关闭按钮）。</summary>
    public void ClearExplanation()
    {
        if (Explanation is null) return;
        Explanation = null;
        StructureChanged?.Invoke();
    }

    /// <summary>
    /// 风险信号扫描（§3.3，纯规则零 AI）：对三层列表文件的 staged/worktree patch 跑安全网规则，
    /// 按路径归组。失败的单文件跳过；整体失败静默（保留上次结果）。
    /// </summary>
    public async Task ScanRisksAsync()
    {
        var workDir = _workDir;
        if (workDir is null) return;
        var snapshot = _changes.Concat(_staged).Concat(_unversioned).ToList();

        var map = await Task.Run(() =>
        {
            var result = new Dictionary<string, List<RuleFinding>>(StringComparer.Ordinal);
            IReadOnlyDictionary<string, DiffNumStat> stagedStats, workStats;
            try
            {
                stagedStats = _repo.GetNumStat(workDir, staged: true);
                workStats = _repo.GetNumStat(workDir, staged: false);
            }
            catch
            {
                return result;
            }

            foreach (var entry in snapshot.Take(MaxRiskScanFiles))
            {
                try
                {
                    var isStaged = entry.Category == StatusCategory.Staged;
                    var stats = isStaged ? stagedStats : workStats;
                    var patch = isStaged
                        ? _repo.GetIndexPatch(workDir, entry.Path)
                        : _repo.GetWorktreePatch(workDir, entry.Path);
                    if (patch is null) continue;

                    DiffNumStat? stat = stats.TryGetValue(entry.Path, out var n) ? n : null;
                    var input = new StagedFileInput(
                        entry.Path, patch,
                        IsBinary: stat is { AddedLines: null, DeletedLines: null }
                            || patch.Contains("GIT binary patch", StringComparison.Ordinal)
                            || patch.Contains("Binary files ", StringComparison.Ordinal),
                        IsNew: patch.Contains("new file mode", StringComparison.Ordinal),
                        stat?.AddedLines ?? 0,
                        stat?.DeletedLines ?? 0);
                    var findings = CommitSafetyScanner.Scan(new[] { input }, _safetyOptions ?? CommitSafetyOptions.Default);
                    if (findings.Count > 0) result[entry.Path] = findings.ToList();
                }
                catch
                {
                    // 单文件失败不影响整体扫描
                }
            }
            return result;
        });

        _riskFindings = map;
        // agent 反馈（review.submit_feedback 落盘，§7.2）：随扫描一并读出展示
        AgentFeedback = GitUI.Core.Mcp.AgentFeedbackStore.Read(workDir);
        StructureChanged?.Invoke();
    }

    /// <summary>agent 留下的人审反馈（无则 null）。人查看后可清除。</summary>
    public GitUI.Core.Mcp.AgentFeedbackStore.Feedback? AgentFeedback { get; private set; }

    /// <summary>清除 agent 反馈（人已处理）。</summary>
    public void ClearAgentFeedback()
    {
        var workDir = _workDir;
        if (workDir is null) return;
        GitUI.Core.Mcp.AgentFeedbackStore.Clear(workDir);
        AgentFeedback = null;
        StructureChanged?.Invoke();
    }

    /// <summary>文件的风险级别：null = 无发现。</summary>
    public SafetySeverity? RiskLevelFor(string path) =>
        _riskFindings.TryGetValue(path, out var findings)
            ? findings.Any(f => f.Severity == SafetySeverity.Blocked) ? SafetySeverity.Blocked : SafetySeverity.Warning
            : null;

    /// <summary>文件的风险发现明细（无发现返回空）。</summary>
    public IReadOnlyList<RuleFinding> FindingsFor(string path) =>
        _riskFindings.TryGetValue(path, out var findings) ? findings : Array.Empty<RuleFinding>();

    /// <summary>
    /// 拒绝选中 hunk（§3.4 审查三态之"拒绝"）：反向应用该块到工作区 = 丢弃工作区改动。
    /// 仅工作区视图（Staged 视图的对应动作是"撤销暂存"）。
    /// </summary>
    public async Task RejectHunksAsync(IReadOnlyList<int> hunkIndices)
    {
        ArgumentNullException.ThrowIfNull(hunkIndices);
        if (hunkIndices.Count == 0) return;
        var view = _selectedDiff;
        var workDir = _workDir;
        if (view is null || !view.CanStageHunks || workDir is null || view.IsStagedView) return;

        await _gate.WaitAsync();
        try
        {
            try
            {
                var patch = string.Concat(hunkIndices.Select(i => view.PatchChunks[i]));
                await Task.Run(() => _repo.ApplyWorktreePatch(workDir, patch, reverse: true));
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

    /// <summary>
    /// "退回重做"反馈 prompt（§3.4）：选中 hunk + 批注 → 结构化修改指令。
    /// v1 由页面复制到剪贴板；H2 起可经 harness 直投。当前无选中 diff 时返回 null。
    /// </summary>
    public string? BuildRetakeFeedback(IReadOnlyList<int> hunkIndices, string? note)
    {
        ArgumentNullException.ThrowIfNull(hunkIndices);
        var view = _selectedDiff;
        if (view is null || hunkIndices.Count == 0) return null;
        return ReviewFeedbackBuilder.Build(
            new[] { new ReviewFeedbackFile(view.Path, view.PatchChunks, hunkIndices) },
            note);
    }

    /// <summary>
    /// AI 解释/批注（§3.5）：非阻塞，结果进 <see cref="Explanation"/>。
    /// FullDiff 档发送前过 secrets 规则，命中即阻断（与生成同策略）。
    /// </summary>
    public async Task ExplainAsync(ExplainIntent intent, CancellationToken ct)
    {
        if (!IsAiAvailable || _ai is null)
        {
            _error = Strings.Changes_AiNotConfigured;
            ErrorDetail = null;
            StructureChanged?.Invoke();
            return;
        }
        var workDir = _workDir;
        if (workDir is null) return;

        IsExplaining = true;
        StructureChanged?.Invoke();
        try
        {
            var (files, diffText, scanInputs) = Scope == ExplainScope.CheckedFiles
                ? await Task.Run(() => BuildAiInput(workDir)).ConfigureAwait(false)
                : await Task.Run(() => BuildSelectedExplainInput(workDir)).ConfigureAwait(false);

            if (AiPrivacy == AiPrivacyLevel.FullDiff)
            {
                var findings = CommitSafetyScanner.Scan(scanInputs);
                if (CommitSafetySummarizer.Blocking(findings).Count > 0)
                {
                    _lastFindings = findings;
                    _error = Strings.Changes_AiBlockedBySecrets;
                    ErrorDetail = FormatFindings(findings);
                    return;
                }
            }

            var prompt = ExplainPromptBuilder.Build(new ExplainInput(files, diffText), AiPrivacy, intent);
            var text = await _ai.CompleteAsync(prompt, ct).ConfigureAwait(false);
            Explanation = text.Trim();
            _error = null; ErrorDetail = null;
        }
        catch (OperationCanceledException)
        {
            // 用户取消：保留旧解释
        }
        catch (Exception ex)
        {
            SetError(ex);
        }
        finally
        {
            IsExplaining = false;
            StructureChanged?.Invoke();
        }
    }

    private (List<CommitMessageFile> Files, string? DiffText, List<StagedFileInput> ScanInputs) BuildSelectedExplainInput(string workDir)
    {
        var entry = _selected;
        if (entry is null)
            return (new List<CommitMessageFile>(), null, new List<StagedFileInput>());

        var isStaged = entry.Category == StatusCategory.Staged;
        string? patch = null;
        try { patch = isStaged ? _repo.GetIndexPatch(workDir, entry.Path) : _repo.GetWorktreePatch(workDir, entry.Path); }
        catch { /* 降级为元数据 */ }

        var files = new List<CommitMessageFile> { new(entry.Path, entry.AddedLines ?? 0, entry.DeletedLines ?? 0) };
        var scanInputs = new List<StagedFileInput>();
        if (patch is not null)
        {
            scanInputs.Add(new StagedFileInput(entry.Path, patch,
                IsBinary: patch.Contains("GIT binary patch", StringComparison.Ordinal)
                    || patch.Contains("Binary files ", StringComparison.Ordinal),
                IsNew: patch.Contains("new file mode", StringComparison.Ordinal),
                entry.AddedLines ?? 0, entry.DeletedLines ?? 0));
        }
        return (files, patch, scanInputs);
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
        KickRiskScan();
    }

    private int _riskScanBusy;

    /// <summary>数据变化后自动重扫风险（去抖：扫描中则跳过本轮，下一轮数据变化再触发）。</summary>
    private void KickRiskScan()
    {
        if (_workDir is null) return;
        if (Interlocked.Exchange(ref _riskScanBusy, 1) != 0) return;
        _ = Task.Run(async () =>
        {
            try { await ScanRisksAsync(); }
            finally { Interlocked.Exchange(ref _riskScanBusy, 0); }
        });
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
