namespace GitUI.App;

/// <summary>
/// App 级当前仓库（design.md §5.1 RepoSession 的最小雏形）：
/// 任一页签打开仓库后其余页签（变更 / 分支 / 后续 Bash 跟随仓库）自动感知。
/// 单线程访问（全部经 UI 线程 DispatcherQueue 回投）。
/// </summary>
public sealed class RepositoryContext
{
    public string? WorkDir { get; private set; }

    /// <summary>当前仓库变化（含置空）。</summary>
    public event Action? Changed;

    /// <summary>当前仓库的分支引用集合变化（创建/重命名/删除后），供其他页刷新分支列表。</summary>
    public event Action? BranchesChanged;

    public void Set(string? workDir)
    {
        if (WorkDir == workDir) return;
        WorkDir = workDir;
        Changed?.Invoke();
    }

    /// <summary>分支页操作成功后调用，通知其他页刷新分支列表（known-issues 1.2）。</summary>
    public void NotifyBranchesChanged() => BranchesChanged?.Invoke();
}
