using GitUI.Core.Models;
using GitUI.Core.Services;

namespace GitUI.ViewModels;

/// <summary>分支树扁平行。组头或分支。</summary>
public abstract record BranchRow;

/// <summary>组头（本地分支 / 远程分支）。</summary>
public sealed record BranchGroupRow(string Title, int Count, bool IsRemote) : BranchRow;

/// <summary>
/// 分支行。Meta = "短SHA · tip 主题"（远程分支可能无 tip 信息）。
/// ImpactCount = 删除后不可达的提交数（仅本地分支且已计算时有值）。
/// </summary>
public sealed record BranchItemRow(
    string Name,
    string? Sha,
    bool IsHead,
    bool IsRemote,
    string Meta,
    int? ImpactCount) : BranchRow;

/// <summary>删除分支前的确认数据（design.md §8-S6"将丢弃 N 个提交"）。</summary>
public sealed record BranchDeletePreview(string BranchName, bool ForceRequired, IReadOnlyList<CommitNode> LostCommits)
{
    /// <summary>确认对话框主文案。N 值与实际影响必须一致（S6 通过标准）。</summary>
    public string ConfirmationText => LostCommits.Count == 0
        ? $"分支 {BranchName} 的全部提交在其他分支上仍然可达，删除分支不会丢弃任何提交。"
        : $"将丢弃 {LostCommits.Count} 个提交：{string.Join("、", LostCommits.Take(3).Select(c => c.ShortSha))}" +
          (LostCommits.Count > 3 ? $" 等（共 {LostCommits.Count} 个）" : "");
}

/// <summary>
/// 分支页状态机（S6，design.md §4.5 / §8-S6）：
/// Local / Remote 树、Create / Rename / Delete / Checkout / Merge / Rebase、
/// Pull / Pull Rebase / Push 顶部按钮、删除前影响计算（<see cref="RequestDeletePreview"/>）。
/// 写操作全部经 <see cref="_gate"/> 串行；远程操作为网络路径，超时放宽。
/// </summary>
public sealed class BranchesViewModel
{
    private readonly IRepositoryService _repo;
    private readonly SemaphoreSlim _gate = new(1, 1);

    private string? _workDir;
    private List<BranchRow> _rows = new();
    private BranchItemRow? _selected;

    private bool _isLoading;
    private bool _isBusy;
    private string? _error;
    private string? _transient;

    public BranchesViewModel(IRepositoryService repo) => _repo = repo;

    /// <summary>树 / 状态条 / 错误变化。</summary>
    public event Action? StructureChanged;

    /// <summary>分支引用集合变化（创建/重命名/删除成功后触发），供跨页联动。</summary>
    public event Action? BranchListChanged;

    /// <summary>清掉一次性成功消息（页面 5s 定时器调用，known-issues 1.8）。</summary>
    public void ClearTransient()
    {
        if (_transient is null) return;
        _transient = null;
        StructureChanged?.Invoke();
    }

    /// <summary>一次性成功消息（已检出/已创建…），页面定时器据此自动消退。</summary>
    public string? TransientMessage => _transient;

    public string? WorkDir => _workDir;
    public bool IsRepoOpen => _workDir is not null;
    public bool IsLoading => _isLoading;
    public bool IsBusy => _isBusy;
    public string? Error => _error;

    /// <summary>错误完整详情（GitOperationException 的完整 stderr / 其他异常的 ToString），
    /// 供"复制错误详情"（known-issues 1.7）。</summary>
    public string? ErrorDetail { get; private set; }
    public IReadOnlyList<BranchRow> Rows => _rows;
    public BranchItemRow? Selected => _selected;

    /// <summary>状态条文案。"已创建/已检出/已删除/已合并/已变基/已推送/已拉取"前缀是各操作的 UIA 断言锚点。</summary>
    public string StatusText =>
        _error is not null ? $"错误: {_error}"
        : _isBusy ? "执行中…"
        : _isLoading ? "加载中…"
        : _workDir is null ? "未打开仓库"
        : _transient is not null ? _transient
        : $"共 {_rows.OfType<BranchItemRow>().Count()} 个分支";

    // ---- 打开 / 刷新 ----

    public async Task OpenRepositoryAsync(string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        await _gate.WaitAsync();
        try
        {
            SetFlag(true, ref _isLoading);
            string? workDir = null;
            string? error = null;
            try { workDir = await Task.Run(() => _repo.Open(path)); }
            catch (Exception ex) { error = ex.Message; }

            _error = error;
            if (workDir is not null)
            {
                _workDir = workDir;
                _selected = null;
                await LoadCoreAsync();
            }
            SetFlag(false, ref _isLoading);
        }
        finally
        {
            _gate.Release();
        }
    }

    public Task RefreshAsync() => WorkDir is null ? Task.CompletedTask : RunExclusive(LoadCoreAsync);

    /// <summary>选中分支（供操作按钮定位）。远程分支只读。</summary>
    public void Select(BranchItemRow row)
    {
        _selected = row;
        StructureChanged?.Invoke();
    }

    // ---- 危险操作确认（design.md §6.4：弹确认框且显示具体影响范围）----

    /// <summary>
    /// 计算删除 <paramref name="branchName"/> 的影响（不执行删除）。
    /// 影响提交数 &gt; 0 时 UI 必须弹确认框展示 <see cref="BranchDeletePreview.ConfirmationText"/>。
    /// </summary>
    public async Task<BranchDeletePreview> RequestDeletePreview(string branchName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(branchName);
        var workDir = _workDir!;
        var lost = await Task.Run(() => _repo.BranchDeleteImpact(workDir, branchName));
        var branches = await Task.Run(() => _repo.GetBranches(workDir));
        // 目标分支 tip 与任何其他分支 tip 相同 → 删除后提交仍可达（非 force 即可删）
        var forceRequired = lost.Count > 0;
        return new BranchDeletePreview(branchName, forceRequired, lost);
    }

    // ---- 分支操作 ----

    public Task CheckoutAsync(string branch) => RunWrite($"已检出 {branch}", () => _repo.Checkout(_workDir!, branch));

    public Task CreateAsync(string name, string? fromSha) =>
        RunWrite($"已创建 {name}", () => _repo.CreateBranch(_workDir!, name, fromSha),
            affectsBranchList: true);

    public Task RenameAsync(string oldName, string newName) =>
        RunWrite($"已重命名 {oldName} → {newName}", () => _repo.RenameBranch(_workDir!, oldName, newName),
            affectsBranchList: true);

    /// <summary>删除分支。UI 必须先 <see cref="RequestDeletePreview"/> 并在影响 &gt; 0 时取得用户确认。</summary>
    public Task DeleteAsync(string branch, bool force) =>
        RunWrite($"已删除 {branch}", () => _repo.DeleteBranch(_workDir!, branch, force),
            affectsBranchList: true);

    /// <summary>合并到当前分支（noFastForward = 强制产生合并提交）。</summary>
    public Task MergeAsync(string branch, bool noFastForward, string? message) =>
        RunWrite($"已合并 {branch}", () => _repo.MergeBranch(_workDir!, branch, noFastForward, message));

    /// <summary>把当前分支变基到 <paramref name="upstream"/> 之上。</summary>
    public Task RebaseAsync(string upstream) =>
        RunWrite($"已变基到 {upstream}", () => _repo.Rebase(_workDir!, upstream));

    /// <summary>快进当前分支到 <paramref name="branch"/>（merge --ff-only，分叉即失败）。</summary>
    public Task FastForwardAsync(string branch) =>
        RunWrite($"已快进到 {branch}",
            () => _repo.FastForward(_workDir!, branch),
            validateFastForward: true, fastForwardTarget: branch);

    public Task PullAsync(bool rebase) =>
        RunWrite(rebase ? "已拉取（rebase）" : "已拉取", () => _repo.Pull(_workDir!, rebase));

    public Task PushAsync() => RunWrite("已推送", () => _repo.Push(_workDir!, null, null));

    // ---- 内部 ----

    private async Task LoadCoreAsync()
    {
        var workDir = _workDir!;
        try
        {
            var (branches, head) = await Task.Run(() =>
            {
                var b = _repo.GetBranches(workDir);
                var h = _repo.HeadSha(workDir);
                return (b, h);
            });

            var rows = new List<BranchRow>();
            var locals = branches.Where(b => b.IsLocal).ToList();
            var remotes = branches.Where(b => b.IsRemote).ToList();

            rows.Add(new BranchGroupRow($"本地分支 ({locals.Count})", locals.Count, IsRemote: false));
            foreach (var b in locals)
                rows.Add(await ToItemRow(workDir, b));

            if (remotes.Count > 0)
            {
                rows.Add(new BranchGroupRow($"远程分支 ({remotes.Count})", remotes.Count, IsRemote: true));
                foreach (var b in remotes)
                    rows.Add(await ToItemRow(workDir, b));
            }

            _rows = rows;
            // 注意：不清 _error——LoadCoreAsync 在写操作之后执行（RunWrite），
            // 写操作失败设置的 _error 必须保留到 UI（快进失败/合并冲突可见性，S6 测试抓出）
        }
        catch (Exception ex)
        {
            SetError(ex);
        }
        StructureChanged?.Invoke();
    }

    /// <summary>分支 → 行。取 tip 提交主题（单次 GetCommit；远程跟踪分支失败不致命）。</summary>
    private async Task<BranchItemRow> ToItemRow(string workDir, BranchRef b)
    {
        string meta = b.Sha is null ? "（空分支）" : b.Sha[..Math.Min(7, b.Sha.Length)];
        if (b.Sha is not null)
        {
            try
            {
                var tip = await Task.Run(() => _repo.GetCommit(workDir, b.Sha));
                if (tip is not null) meta += $" · {tip.Subject}";
            }
            catch { /* tip 主题拿不到就只显示 SHA */ }
        }
        return new BranchItemRow(b.Name, b.Sha, b.IsHead, b.IsRemote, meta, ImpactCount: null);
    }

    private async Task RunWrite(
        string successMessage, Action action, bool validateFastForward = false,
        string? fastForwardTarget = null, bool affectsBranchList = false)
    {
        if (_workDir is null) return;
        await _gate.WaitAsync();
        try
        {
            if (_isBusy) return;
            SetFlag(true, ref _isBusy);
            try
            {
                await Task.Run(action);
                if (validateFastForward && fastForwardTarget is not null)
                    await ValidateFastForwardAsync(fastForwardTarget);
                _error = null;
                ErrorDetail = null;
                _transient = successMessage;
                if (affectsBranchList) BranchListChanged?.Invoke();
            }
            catch (Exception ex)
            {
                SetError(ex);
            }
            await LoadCoreAsync();
            SetFlag(false, ref _isBusy);
        }
        finally
        {
            _isBusy = false;
            _gate.Release();
        }
    }

    /// <summary>统一错误写入：保留完整详情供复制（known-issues 1.7）。</summary>
    private void SetError(Exception ex)
    {
        _error = ex.Message;
        ErrorDetail = ex is GitOperationException g ? g.StdError : ex.ToString();
    }

    /// <summary>快进校验：当前 HEAD 必须已移动到目标分支 tip，否则视为失败（含"无法快进"）。</summary>
    private async Task ValidateFastForwardAsync(string target)
    {
        var workDir = _workDir!;
        var head = await Task.Run(() => _repo.HeadSha(workDir));
        var branches = await Task.Run(() => _repo.GetBranches(workDir));
        var tip = branches.FirstOrDefault(b => b.Name == target)?.Sha;
        if (head != tip)
            throw new GitOperationException("fast-forward", $"当前分支无法快进到 {target}（存在分叉或目标无效）", 1);
    }

    private async Task RunExclusive(Func<Task> action)
    {
        await _gate.WaitAsync();
        try
        {
            SetFlag(true, ref _isLoading);
            await action();
            SetFlag(false, ref _isLoading);
        }
        finally
        {
            _gate.Release();
        }
    }

    private void SetFlag(bool value, ref bool field)
    {
        field = value;
        StructureChanged?.Invoke();
    }
}
