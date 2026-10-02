using GitUI.Core.Models;

namespace GitUI.Core.Services;

/// <summary>
/// 仓库读取服务。所有方法接收工作目录路径字符串，内部独立打开/关闭底层仓库句柄。
///
/// 关键约束（见 docs/design.md §3.2）：libgit2 的 <c>Repository</c> 句柄不可跨线程。
/// 因此本接口不接受也不返回任何句柄对象，每次调用都是"打开 → 用 → 关闭"的短生命周期，
/// 以便 <see cref="GitWorker"/> 能安全地在单 worker 线程内串行执行任意请求。
/// </summary>
public interface IRepositoryService
{
    /// <summary>校验路径是否为有效仓库，返回规范化的工作目录绝对路径（无尾部分隔符）。</summary>
    /// <exception cref="RepositoryNotFoundException">路径不存在或非 git 仓库。</exception>
    string Open(string path);

    /// <summary>当前 HEAD 提交 SHA。unborn HEAD（空仓库）返回 null。</summary>
    string? HeadSha(string workDir);

    /// <summary>仓库是否处于 unborn HEAD 状态。</summary>
    bool IsHeadUnborn(string workDir);

    /// <summary>本地与远程分支列表。</summary>
    IReadOnlyList<BranchRef> GetBranches(string workDir);

    /// <summary>分页读取提交历史。</summary>
    LogPage GetLog(string workDir, LogFilter filter);

    /// <summary>按 SHA 读取单个提交。不存在时返回 null。</summary>
    CommitNode? GetCommit(string workDir, string sha);

    /// <summary>读取某树对象下的条目。<paramref name="treeish"/> 可为提交 SHA、分支名或 "HEAD"。</summary>
    IReadOnlyList<TreeEntry> GetTree(string workDir, string treeish);

    /// <summary>该提交相对于其父提交的 diff。根提交返回空列表。</summary>
    IReadOnlyList<DiffResult> GetCommitDiff(string workDir, string sha);

    /// <summary>两棵树之间指定文件的 diff。任一侧不存在视为新增/删除。</summary>
    DiffResult GetFileDiff(string workDir, string path, string aSha, string bSha);

    /// <summary>工作区三层状态分类。</summary>
    IReadOnlyList<WorktreeFileStatus> GetStatus(string workDir);

    /// <summary>
    /// 纯文本 diff 计算，不依赖 git。S2 起委托 <see cref="IDiffEngine"/>（Myers）。
    /// </summary>
    IReadOnlyList<DiffHunk> ComputeDiff(string oldText, string newText);
}

/// <summary>路径不存在或不是 git 仓库时抛出。</summary>
public sealed class RepositoryNotFoundException : Exception
{
    public RepositoryNotFoundException(string path) : base($"Not a git repository: {path}") { }
    public RepositoryNotFoundException(string path, Exception inner) : base($"Not a git repository: {path}", inner) { }
}
