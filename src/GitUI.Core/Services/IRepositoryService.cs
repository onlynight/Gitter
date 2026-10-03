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

    /// <summary>
    /// 任意两个提交之间的树 diff（design.md §4.2 P1"任意两点比较"，S7 通用 git diff）。
    /// 与 GetCommitDiff 不同，不要求父子关系。
    /// </summary>
    IReadOnlyList<DiffResult> GetTreeDiff(string workDir, string aSha, string bSha);

    /// <summary>两棵树之间指定文件的 diff。任一侧不存在视为新增/删除。</summary>
    DiffResult GetFileDiff(string workDir, string path, string aSha, string bSha);

    /// <summary>工作区三层状态分类。</summary>
    IReadOnlyList<WorktreeFileStatus> GetStatus(string workDir);

    /// <summary>
    /// 纯文本 diff 计算，不依赖 git。S2 起委托 <see cref="IDiffEngine"/>（Myers）。
    /// </summary>
    IReadOnlyList<DiffHunk> ComputeDiff(string oldText, string newText);

    // ---- S5：Changes 页与提交流 ----

    /// <summary>把工作区文件（含删除）加入 index。等价 <c>git add -A --</c>。</summary>
    void Stage(string workDir, IReadOnlyList<string> paths);

    /// <summary>把 index 中的文件退回工作区。等价 <c>git reset -q HEAD --</c>。</summary>
    void Unstage(string workDir, IReadOnlyList<string> paths);

    /// <summary>提交 index 内容，返回新提交 SHA。无已暂存变更时抛 <see cref="InvalidOperationException"/>。</summary>
    string Commit(string workDir, string message);

    /// <summary>工作区相对 index 的 diff patch 文本（hunk 级暂存用）。无差异返回 null。</summary>
    string? GetWorktreePatch(string workDir, string path);

    /// <summary>index 相对 HEAD 的 diff patch 文本（hunk 级撤销暂存用）。无差异返回 null。</summary>
    string? GetIndexPatch(string workDir, string path);

    /// <summary>把 patch 应用到 index（<c>git apply --cached</c>，reverse = 反向应用）。失败抛 <see cref="GitOperationException"/>。</summary>
    void ApplyIndexPatch(string workDir, string patch, bool reverse);

    /// <summary>推送到远程。失败抛 <see cref="PushException"/>（含分类）。</summary>
    void Push(string workDir, string? remote, string? branch);

    /// <summary>各文件的 +N −M 行数统计（二进制为 null）。staged = index vs HEAD，否则 index vs 工作区。</summary>
    IReadOnlyDictionary<string, DiffNumStat> GetNumStat(string workDir, bool staged);

    /// <summary>最近 N 条提交主题（提交消息建议用）。</summary>
    IReadOnlyList<string> GetRecentCommitSubjects(string workDir, int count);

    /// <summary>全部分支 tip 的提交主题（SHA → 主题），一次调用取回，供分支树展示。</summary>
    IReadOnlyDictionary<string, string> GetBranchTipSubjects(string workDir);

    // ---- S6：Branches 页与分支操作 ----

    /// <summary>创建分支（不切换）。fromSha 为 null 时从 HEAD 创建。</summary>
    void CreateBranch(string workDir, string name, string? fromSha);

    /// <summary>重命名分支。</summary>
    void RenameBranch(string workDir, string oldName, string newName);

    /// <summary>删除分支。force = false 时未合并的分支删除失败抛 <see cref="GitOperationException"/>。</summary>
    void DeleteBranch(string workDir, string name, bool force);

    /// <summary>切换 HEAD 到指定分支。</summary>
    void Checkout(string workDir, string name);

    /// <summary>合并分支到当前分支（CLI 兜底）。冲突/失败抛 <see cref="GitOperationException"/>。</summary>
    void MergeBranch(string workDir, string branch, bool noFastForward, string? message);

    /// <summary>把当前分支变基到 <paramref name="upstream"/>（CLI 兜底）。冲突/失败抛异常。</summary>
    void Rebase(string workDir, string upstream);

    /// <summary>快进当前分支到 <paramref name="branch"/>（git merge --ff-only，分叉时失败）。</summary>
    void FastForward(string workDir, string branch);

    /// <summary>拉取并整合（rebase = git pull --rebase）。失败抛异常。</summary>
    void Pull(string workDir, bool rebase);

    /// <summary>两个提交的最近公共祖先。不存在（无关历史）返回 null。</summary>
    string? MergeBase(string workDir, string aSha, string bSha);

    /// <summary>
    /// 从 <paramref name="tipSha"/> 可达但 <paramref name="baseSha"/> 不可达的提交
    /// （按时间倒序）。危险操作确认的"将丢弃 N 个提交"数据源（design.md §8-S6）。
    /// </summary>
    IReadOnlyList<CommitNode> UniqueCommits(string workDir, string tipSha, string? baseSha);

    /// <summary>
    /// 删除分支的影响范围：从该分支可达、但其余全部本地分支与远程跟踪分支不可达的提交
    /// （按时间倒序）——即删除后真正不可达的提交，"将丢弃 N 个提交"的精确数据源。
    /// </summary>
    IReadOnlyList<CommitNode> BranchDeleteImpact(string workDir, string branchName);
}

/// <summary>路径不存在或不是 git 仓库时抛出。</summary>
public sealed class RepositoryNotFoundException : Exception
{
    public RepositoryNotFoundException(string path) : base($"Not a git repository: {path}") { }
    public RepositoryNotFoundException(string path, Exception inner) : base($"Not a git repository: {path}", inner) { }
}
