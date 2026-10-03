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

    public void Set(string? workDir)
    {
        if (WorkDir == workDir) return;
        WorkDir = workDir;
        Changed?.Invoke();
    }
}
