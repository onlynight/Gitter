using System.Collections.Immutable;
using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;
using GitUI.Core.Services;
using LibGit2Sharp;
using CoreTreeEntry = GitUI.Core.Models.TreeEntry;
using CoreTreeEntryType = GitUI.Core.Models.TreeEntryType;
using CoreFileMode = GitUI.Core.Models.FileMode;
using CoreDiffResult = GitUI.Core.Models.DiffResult;
using CoreDiffHunk = GitUI.Core.Models.DiffHunk;
using CoreLogPage = GitUI.Core.Models.LogPage;
using CoreLogFilter = GitUI.Core.Models.LogFilter;
using CoreCommitNode = GitUI.Core.Models.CommitNode;
using CoreBranchRef = GitUI.Core.Models.BranchRef;
using CoreWorktreeFileStatus = GitUI.Core.Models.WorktreeFileStatus;
using CoreStatusCategory = GitUI.Core.Models.StatusCategory;
using CoreIRepositoryService = GitUI.Core.Services.IRepositoryService;
using CoreRepositoryNotFoundException = GitUI.Core.Services.RepositoryNotFoundException;
using CoreGitOperationException = GitUI.Core.Services.GitOperationException;
using CorePushFailureKind = GitUI.Core.Models.PushFailureKind;
using CorePushException = GitUI.Core.Services.PushException;
using CoreDiffNumStat = GitUI.Core.Models.DiffNumStat;

namespace GitUI.Git
{
    /// <summary>
    /// <see cref="CoreIRepositoryService"/> 的 libgit2sharp 实现。
    ///
    /// 每个方法都独立打开并释放 <see cref="Repository"/> 句柄。libgit2 的 Repository 句柄
    /// 不可跨线程共享（见 docs/design.md §3.2），因此本实现刻意不接受/不缓存句柄，
    /// 让 <see cref="GitWorker"/> 可以在单 worker 线程内安全地串行执行任意请求。
    ///
    /// libgit2sharp 0.3x API 注意（与设计文档不同，实测确认）：
    /// <list type="bullet">
    ///   <item><see cref="Repository.Init(string, bool)"/> 返回 git 目录路径字符串，不是 Repository 实例。</item>
    ///   <item>无 <c>Repository.WorkingDirectory</c>，改用 <see cref="RepositoryInformation.WorkingDirectory"/>。</item>
    ///   <item>无 <c>repo.Status()</c>，改用 <see cref="Repository.RetrieveStatus(StatusOptions)"/>；
    ///         全量条目通过 <see cref="RepositoryStatus.Item"/> 取。</item>
    ///   <item><see cref="Signature"/> 构造器强制要求 DateTimeOffset 第三参。</item>
    ///   <item><see cref="CommitFilter"/> 只有 SortBy / IncludeReachableFrom / ExcludeReachableFrom /
    ///         FirstParentOnly，没有时间窗口和作者过滤——这两项必须在查询后手工筛。</item>
    /// </list>
    /// </summary>
    public sealed class LibGit2RepositoryService : CoreIRepositoryService
    {
        private readonly GitUI.Core.Services.IDiffEngine _diffEngine;

        /// <param name="diffEngine">
        /// 纯文本 diff 引擎（S2）。默认 Myers（GitUI.Diff）；
        /// 测试可注入替身。libgit2 树对树的 diff 不走这里（见 GetFileDiff/GetCommitDiff）。
        /// </param>
        public LibGit2RepositoryService(GitUI.Core.Services.IDiffEngine? diffEngine = null)
        {
            _diffEngine = diffEngine ?? GitUI.Diff.MyersDiffEngine.Instance;
        }

        public string Open(string path)
        {
            ArgumentException.ThrowIfNullOrEmpty(path);
            var full = Path.GetFullPath(path);
            if (!Directory.Exists(full))
                throw new CoreRepositoryNotFoundException(full);

            try
            {
                using var repo = Discover(full);
                return TrimTrailingSep(repo.Info.WorkingDirectory, full);
            }
            catch (CoreRepositoryNotFoundException) { throw; }
            catch (Exception ex)
            {
                throw new CoreRepositoryNotFoundException(full, ex);
            }
        }

        public string? HeadSha(string workDir)
        {
            using var repo = OpenRepo(workDir);
            return repo.Info.IsHeadUnborn ? null : repo.Head?.Tip?.Sha;
        }

        public bool IsHeadUnborn(string workDir)
        {
            using var repo = OpenRepo(workDir);
            return repo.Info.IsHeadUnborn;
        }

        public IReadOnlyList<CoreBranchRef> GetBranches(string workDir)
        {
            using var repo = OpenRepo(workDir);
            var headSha = repo.Info.IsHeadUnborn ? null : repo.Head?.Tip?.Sha;
            var result = new List<CoreBranchRef>();
            foreach (var branch in repo.Branches)
            {
                var isLocal = branch is LibGit2Sharp.Branch;
                // HEAD 指向的分支名才是"当前分支"。其他分支即便 tip 与 HEAD 同 SHA
                // （刚创建还没切），也不应标 IsHead。
                var headFriendly = repo.Head is LibGit2Sharp.Branch hb ? hb.FriendlyName : null;
                var isHead = headFriendly is not null
                             && string.Equals(branch.FriendlyName, headFriendly, StringComparison.Ordinal);
                result.Add(new CoreBranchRef(
                    Name: branch.FriendlyName,
                    Sha: branch.Tip?.Sha,
                    IsLocal: isLocal,
                    IsRemote: branch.IsRemote,
                    IsHead: isHead));
            }
            return result
                .OrderByDescending(b => b.IsHead)
                .ThenBy(b => b.IsRemote)
                .ThenBy(b => b.Name, StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        public CoreLogPage GetLog(string workDir, CoreLogFilter filter)
        {
            using var repo = OpenRepo(workDir);
            if (repo.Info.IsHeadUnborn)
                return new CoreLogPage(Array.Empty<CoreCommitNode>(), 0, filter.Skip, filter.Limit);

            var f = filter.Normalize();

            // 预计算 branch/tag → SHA 映射。ToCommitNode 若每个提交都全量扫
            // repo.Branches / repo.Tags，复杂度是 O(提交数 × 分支数)，万级仓库下不可接受。
            var branchTips = new Dictionary<string, List<string>>(StringComparer.Ordinal);
            foreach (var b in repo.Branches)
            {
                if (b.Tip is null) continue;
                if (!branchTips.TryGetValue(b.Tip.Sha, out var names))
                    branchTips[b.Tip.Sha] = names = new List<string>();
                names.Add(b.FriendlyName);
            }

            var tagTargets = new Dictionary<string, List<string>>(StringComparer.Ordinal);
            foreach (var t in repo.Tags)
            {
                string? sha = t.PeeledTarget is Commit pc ? pc.Sha
                            : t.Annotation is { Target: Commit ac } ? ac.Sha
                            : null;
                if (sha is null) continue;
                if (!tagTargets.TryGetValue(sha, out var names))
                    tagTargets[sha] = names = new List<string>();
                names.Add(t.FriendlyName);
            }

            // S4 快路径（design.md §8-S4：10 万提交首屏 50 条 < 500ms、下一页 < 200ms）：
            // 无 author/topic/时间过滤时，两次 `git rev-list`（--count + --skip/--max-count 窗口）
            // 分别供给精确 TotalCount 与分页窗口，再用 libgit2 Lookup 物化窗口内的提交。
            // 不走 libgit2 revwalk 的原因：实测其"每句柄首次迭代"固定开销 ~600ms（10 万提交
            // 的 packfile，commit-graph 也无法消除），单是取 50 条就会爆掉预算；
            // git CLI（现代 Git 自动维护 commit-graph）冷读同仓库每次只要 ~70ms。
            // CLI 兜底在 §3.1 授权范围内；CLI 不可用时回退 libgit2 全量遍历路径。
            // 仅大仓库启用：CLI 进程启动 ~25ms，小仓库（S1 稳态 ~5ms）纯 libgit2 更快。
            if (f.Author is null && f.Topic is null && f.After is null && f.Before is null
                && f.Limit > 0 && HasLargePack(workDir))
            {
                var refName = f.Branch ?? "HEAD";
                var window = TryRevListWindow(workDir, refName, f.Skip, f.Limit);
                if (window is not null && TryRevListCount(workDir, refName) is { } revTotal)
                {
                    var fastPage = new List<CoreCommitNode>(window.Count);
                    foreach (var sha in window)
                    {
                        var c = repo.Lookup<Commit>(sha);
                        if (c is not null)
                            fastPage.Add(ToCommitNode(c, branchTips, tagTargets));
                    }
                    return new CoreLogPage(fastPage, revTotal, f.Skip, f.Limit);
                }
            }

            var commitFilter = BuildCommitFilter(repo, f);

            // 轻量收集：只存排序键和 Commit 引用，不物化 CommitNode。
            // 万级仓库下 TotalCount 需要完整走一遍，但只携带 SHA，成本很低。
            var buffer = new List<(DateTimeOffset cd, DateTimeOffset ad, string sha, Commit c)>();
            foreach (var c in repo.Commits.QueryBy(commitFilter))
            {
                if (!MatchesTime(c, f)) continue;
                if (!MatchesAuthor(c, f.Author)) continue;
                if (!MatchesTopic(c, f.Topic)) continue;
                buffer.Add((c.Committer.When, c.Author.When, c.Sha, c));
            }

            // 保证按提交时间倒序（libgit2 的 Time 排序对同秒提交不保证稳定）
            buffer.Sort(static (x, y) =>
            {
                int r = y.cd.CompareTo(x.cd);
                if (r != 0) return r;
                r = y.ad.CompareTo(x.ad);
                return r != 0 ? r : string.CompareOrdinal(y.sha, x.sha);
            });

            var total = buffer.Count;
            var start = Math.Min(f.Skip, total);
            var end = f.Limit > 0 ? Math.Min(f.Skip + f.Limit, total) : total;
            var page = new List<CoreCommitNode>(Math.Max(0, end - start));
            for (int i = start; i < end; i++)
                page.Add(ToCommitNode(buffer[i].c, branchTips, tagTargets));

            return new CoreLogPage(page, total, f.Skip, f.Limit);
        }

        public CoreCommitNode? GetCommit(string workDir, string sha)
        {
            ArgumentException.ThrowIfNullOrEmpty(sha);
            using var repo = OpenRepo(workDir);
            Commit? commit;
            try { commit = repo.Lookup<Commit>(sha); }
            catch (NotFoundException) { return null; }
            catch (LibGit2SharpException) { return null; }
            return commit is null ? null : ToCommitNode(repo, commit);
        }

        public IReadOnlyList<CoreTreeEntry> GetTree(string workDir, string treeish)
        {
            using var repo = OpenRepo(workDir);
            var tree = ResolveTree(repo, treeish);
            var result = new List<CoreTreeEntry>();
            WalkTree(tree, string.Empty, result);
            return result;
        }

        public IReadOnlyList<CoreDiffResult> GetCommitDiff(string workDir, string sha)
        {
            using var repo = OpenRepo(workDir);
            var commit = repo.Lookup<Commit>(sha);
            var parents = commit.Parents.ToList();
            if (parents.Count == 0) return Array.Empty<CoreDiffResult>();

            var patch = repo.Diff.Compare<Patch>(parents[0].Tree, commit.Tree);
            return patch.Select(ToDiffResult).ToList();
        }

        public CoreDiffResult GetFileDiff(string workDir, string path, string? aSha, string? bSha)
        {
            ArgumentException.ThrowIfNullOrEmpty(path);
            using var repo = OpenRepo(workDir);

            var oldTree = aSha is null ? null : ResolveTree(repo, aSha);
            var newTree = bSha is null ? null : ResolveTree(repo, bSha);

            var oldBlob = LookupBlob(oldTree, path);
            var newBlob = LookupBlob(newTree, path);

            var isBinary = (oldBlob?.IsBinary ?? false) || (newBlob?.IsBinary ?? false);
            var isNew = oldBlob is null && newBlob is not null;
            var isDeleted = oldBlob is not null && newBlob is null;

            IReadOnlyList<CoreDiffHunk> hunks = Array.Empty<CoreDiffHunk>();
            int added = 0, deleted = 0;

            if (!isBinary && oldBlob is not null && newBlob is not null)
            {
                var changes = repo.Diff.Compare(oldBlob, newBlob);
                added = changes.LinesAdded;
                deleted = changes.LinesDeleted;
                hunks = ParseUnifiedDiff(changes.Patch);
            }
            else if (newBlob is not null)
            {
                added = CountLines(newBlob);
                hunks = new[] { BuildInsertionHunk(newBlob) };
            }
            else if (oldBlob is not null)
            {
                deleted = CountLines(oldBlob);
                hunks = new[] { BuildDeletionHunk(oldBlob) };
            }

            return new CoreDiffResult(
                Path: path, OldPath: path, IsBinary: isBinary,
                IsNew: isNew, IsDeleted: isDeleted, IsRenamed: false,
                Hunks: hunks, AddedLines: added, DeletedLines: deleted);
        }

        public IReadOnlyList<CoreWorktreeFileStatus> GetStatus(string workDir)
        {
            using var repo = OpenRepo(workDir);
            var status = repo.RetrieveStatus(new StatusOptions
            {
                Show = StatusShowOption.IndexAndWorkDir,
                IncludeUntracked = true,
                IncludeIgnored = false,
                RecurseUntrackedDirs = true,
            });

            var result = new List<CoreWorktreeFileStatus>();
            foreach (var entry in status)
            {
                foreach (var category in ClassifyAll(entry))
                {
                    result.Add(new CoreWorktreeFileStatus(
                        Path: entry.FilePath,
                        Category: category,
                        IsConflict: entry.State == FileStatus.Conflicted,
                        IsExecutable: false,
                        AddedLines: null,
                        DeletedLines: null));
                }
            }
            return result
                .OrderBy(s => s.Category)
                .ThenBy(s => s.Path, StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        public IReadOnlyList<CoreDiffHunk> ComputeDiff(string oldText, string newText)
        {
            return _diffEngine.ComputeHunks(oldText ?? string.Empty, newText ?? string.Empty);
        }

        // ---------- S5：Changes 页与提交流 ----------

        public void Stage(string workDir, IReadOnlyList<string> paths)
        {
            ValidatePaths(paths);
            var r = RunGit(workDir, new[] { "add", "-A", "--" }.Concat(paths).ToArray());
            if (r.ExitCode != 0)
                throw new CoreGitOperationException("暂存", r.StdError, r.ExitCode);
        }

        public void Unstage(string workDir, IReadOnlyList<string> paths)
        {
            ValidatePaths(paths);
            var r = RunGit(workDir, new[] { "reset", "-q", "HEAD", "--" }.Concat(paths).ToArray());
            if (r.ExitCode != 0)
            {
                // unborn HEAD（还没有任何提交）时 reset HEAD 不可用，退化为从 index 移除
                var rm = RunGit(workDir, new[] { "rm", "--cached", "-q", "--" }.Concat(paths).ToArray());
                if (rm.ExitCode != 0)
                    throw new CoreGitOperationException("撤销暂存", r.StdError, r.ExitCode);
            }
        }

        public string Commit(string workDir, string message)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(message);
            using var repo = OpenRepo(workDir);

            // 无已暂存变更时拒绝提交（幂等性保护的第一道：按钮侧还有 in-flight 守卫）
            if (repo.Info.IsHeadUnborn)
            {
                if (!repo.Index.Any())
                    throw new InvalidOperationException("没有已暂存的变更，无法提交");
            }
            else
            {
                var changes = repo.Diff.Compare<TreeChanges>(repo.Head.Tip!.Tree, DiffTargets.Index);
                if (!changes.Any())
                    throw new InvalidOperationException("没有已暂存的变更，无法提交");
            }

            try
            {
                var signature = repo.Config.BuildSignature(DateTimeOffset.Now);
                var commit = repo.Commit(message.Trim(), signature, signature);
                return commit.Sha;
            }
            catch (LibGit2SharpException ex)
            {
                throw new CoreGitOperationException("commit", ex.Message, 1);
            }
        }

        public string? GetWorktreePatch(string workDir, string path)
            => TryDiffPatch(workDir, new[] { "diff", "--", path });

        public string? GetIndexPatch(string workDir, string path)
            => TryDiffPatch(workDir, new[] { "diff", "--cached", "--", path });

        public void ApplyIndexPatch(string workDir, string patch, bool reverse)
        {
            var args = new List<string> { "apply", "--cached", "--whitespace=nowarn" };
            if (reverse) args.Add("--reverse");
            args.Add("-");
            var r = RunGit(workDir, args, stdin: patch);
            if (r.ExitCode != 0)
                throw new CoreGitOperationException(reverse ? "撤销暂存块" : "暂存块", r.StdError, r.ExitCode);
        }

        public void Push(string workDir, string? remote, string? branch)
        {
            var args = new List<string> { "push" };
            if (remote is not null) args.Add(remote);
            if (branch is not null) args.Add(branch);
            // push 涉及网络，放宽超时；credential helper 可能弹窗（默认行为），v1 不接管凭据
            var r = RunGit(workDir, args, timeoutMs: 120_000);
            if (r.ExitCode != 0)
                throw new CorePushException(r.StdError, r.ExitCode, GitUI.Core.Services.PushErrorClassifier.Classify(r.StdError));
        }

        public IReadOnlyDictionary<string, CoreDiffNumStat> GetNumStat(string workDir, bool staged)
        {
            var args = staged
                ? new[] { "diff", "--cached", "--numstat" }
                : new[] { "diff", "--numstat" };
            var r = RunGit(workDir, args);
            var result = new Dictionary<string, CoreDiffNumStat>(StringComparer.Ordinal);
            foreach (var raw in r.StdOut.Split('\n', StringSplitOptions.RemoveEmptyEntries))
            {
                var line = raw.TrimEnd('\r');
                var parts = line.Split('\t');
                if (parts.Length < 3) continue;
                int? added = int.TryParse(parts[0], out var a) ? a : null;
                int? deleted = int.TryParse(parts[1], out var d) ? d : null;
                result[parts[^1]] = new CoreDiffNumStat(added, deleted);
            }
            return result;
        }

        public IReadOnlyList<string> GetRecentCommitSubjects(string workDir, int count)
        {
            if (count <= 0) return Array.Empty<string>();
            return GetLog(workDir, new CoreLogFilter(Limit: count))
                .Items.Select(c => c.Subject).ToList();
        }

        // ---------- S6：Branches 页与分支操作 ----------

        public void CreateBranch(string workDir, string name, string? fromSha)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(name);
            using var repo = OpenRepo(workDir);
            try
            {
                var tip = fromSha is null ? repo.Head.Tip : repo.Lookup<Commit>(fromSha);
                if (tip is null)
                    throw new CoreGitOperationException("创建分支", $"找不到起点提交 {fromSha}", 1);
                repo.Branches.Add(name, tip);
            }
            catch (LibGit2SharpException ex)
            {
                throw new CoreGitOperationException("创建分支", ex.Message, 1);
            }
        }

        public void RenameBranch(string workDir, string oldName, string newName)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(oldName);
            ArgumentException.ThrowIfNullOrWhiteSpace(newName);
            using var repo = OpenRepo(workDir);
            var branch = repo.Branches[oldName]
                ?? throw new CoreGitOperationException("重命名分支", $"分支 {oldName} 不存在", 1);
            try
            {
                repo.Branches.Rename(branch, newName);
            }
            catch (LibGit2SharpException ex)
            {
                throw new CoreGitOperationException("重命名分支", ex.Message, 1);
            }
        }

        public void DeleteBranch(string workDir, string name, bool force)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(name);
            // libgit2sharp 0.32 的 Branches.Remove(string, bool) 静默无效（ref 仍在，
            // S6 实测抓出），直接走 CLI（§3.1 兜底授权）：-d 未合并拒绝 / -D 强制
            var r = RunGit(workDir, new[] { "branch", force ? "-D" : "-d", name });
            if (r.ExitCode != 0)
                throw new CoreGitOperationException("删除分支", r.StdError, r.ExitCode);
        }

        public void Checkout(string workDir, string name)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(name);
            using var repo = OpenRepo(workDir);
            var branch = repo.Branches[name]
                ?? throw new CoreGitOperationException("检出", $"分支 {name} 不存在", 1);
            try
            {
                LibGit2Sharp.Commands.Checkout(repo, branch);
            }
            catch (LibGit2SharpException ex)
            {
                throw new CoreGitOperationException("检出", ex.Message, 1);
            }
        }

        public void MergeBranch(string workDir, string branch, bool noFastForward, string? message)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(branch);
            var args = new List<string> { "merge" };
            if (noFastForward) args.Add("--no-ff");
            if (message is not null) { args.Add("-m"); args.Add(message); }
            args.Add(branch);
            var r = RunGit(workDir, args);
            if (r.ExitCode != 0)
                throw new CoreGitOperationException("merge", r.StdError, r.ExitCode);
        }

        public void FastForward(string workDir, string branch)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(branch);
            // --ff-only：分叉时 git 自身拒绝（退出码非 0），不会像普通 merge 那样
            // 创建合并提交污染 HEAD（S6 测试抓出）
            var r = RunGit(workDir, new[] { "merge", "--ff-only", branch });
            if (r.ExitCode != 0)
                throw new CoreGitOperationException("fast-forward", r.StdError, r.ExitCode);
        }

        public void Rebase(string workDir, string upstream)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(upstream);
            var r = RunGit(workDir, new[] { "rebase", upstream });
            if (r.ExitCode != 0)
                throw new CoreGitOperationException("rebase", r.StdError, r.ExitCode);
        }

        public void Pull(string workDir, bool rebase)
        {
            var args = rebase ? new[] { "pull", "--rebase" } : new[] { "pull" };
            var r = RunGit(workDir, args, timeoutMs: 120_000);
            if (r.ExitCode != 0)
                throw new CoreGitOperationException(rebase ? "pull --rebase" : "pull", r.StdError, r.ExitCode);
        }

        public string? MergeBase(string workDir, string aSha, string bSha)
        {
            using var repo = OpenRepo(workDir);
            var a = repo.Lookup<Commit>(aSha);
            var b = repo.Lookup<Commit>(bSha);
            if (a is null || b is null) return null;
            return repo.ObjectDatabase.FindMergeBase(a, b)?.Sha;
        }

        public IReadOnlyList<CoreCommitNode> UniqueCommits(string workDir, string tipSha, string? baseSha)
        {
            using var repo = OpenRepo(workDir);
            var tip = repo.Lookup<Commit>(tipSha);
            if (tip is null) return Array.Empty<CoreCommitNode>();

            var filter = new CommitFilter { SortBy = CommitSortStrategies.Time, IncludeReachableFrom = tip };
            var baseCommit = baseSha is null ? null : repo.Lookup<Commit>(baseSha);
            if (baseCommit is not null) filter.ExcludeReachableFrom = baseCommit;

            return repo.Commits.QueryBy(filter)
                .Select(c => ToCommitNode(repo, c))
                .ToList();
        }

        public IReadOnlyList<CoreCommitNode> BranchDeleteImpact(string workDir, string branchName)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(branchName);
            using var repo = OpenRepo(workDir);
            var target = repo.Branches[branchName];
            if (target?.Tip is null) return Array.Empty<CoreCommitNode>();

            // 其余全部引用（本地分支 + 远程跟踪）仍可达的提交不算丢弃
            var others = repo.Branches
                .Where(b => b.FriendlyName != branchName && b.Tip is not null)
                .Select(b => b.Tip!)
                .ToList();

            var filter = new CommitFilter { SortBy = CommitSortStrategies.Time, IncludeReachableFrom = target.Tip };
            if (others.Count > 0) filter.ExcludeReachableFrom = others;

            return repo.Commits.QueryBy(filter)
                .Select(c => ToCommitNode(repo, c))
                .ToList();
        }

        // ---------- S5/S6 CLI 辅助 ----------

        private static void ValidatePaths(IReadOnlyList<string> paths)
        {
            if (paths is null || paths.Count == 0)
                throw new ArgumentException("paths must not be empty", nameof(paths));
            foreach (var p in paths)
                ArgumentException.ThrowIfNullOrWhiteSpace(p);
        }

        private static (int ExitCode, string StdOut, string StdError) RunGit(
            string workDir, IReadOnlyList<string> args, string? stdin = null, int timeoutMs = 60_000)
        {
            var psi = new ProcessStartInfo("git")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                RedirectStandardInput = stdin is not null,
                UseShellExecute = false,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            psi.ArgumentList.Add("-C");
            psi.ArgumentList.Add(workDir);
            foreach (var a in args) psi.ArgumentList.Add(a);

            using var process = Process.Start(psi)
                ?? throw new InvalidOperationException("Failed to start git.");
            if (stdin is not null)
            {
                process.StandardInput.Write(stdin);
                process.StandardInput.Close();
            }

            var stdout = process.StandardOutput.ReadToEnd();
            var stderr = process.StandardError.ReadToEnd();
            if (!process.WaitForExit(timeoutMs))
            {
                try { process.Kill(); } catch { /* 已退出则忽略 */ }
                throw new CoreGitOperationException(args.FirstOrDefault("git"), "执行超时", -1);
            }
            return (process.ExitCode, stdout, stderr);
        }

        private string? TryDiffPatch(string workDir, IReadOnlyList<string> args)
        {
            var r = RunGit(workDir, args);
            if (r.ExitCode != 0)
                throw new CoreGitOperationException("diff", r.StdError, r.ExitCode);
            var text = r.StdOut;
            return string.IsNullOrWhiteSpace(text) ? null : text;
        }

        // ---------- 私有辅助 ----------

        private static Repository Discover(string workDir)
        {
            if (!Directory.Exists(workDir))
                throw new CoreRepositoryNotFoundException(workDir);

            var gitDir = Path.Combine(workDir, ".git");
            if (Directory.Exists(gitDir) && Directory.Exists(Path.Combine(gitDir, "objects")))
            {
                if (Repository.IsValid(workDir) || Repository.IsValid(gitDir))
                    return new Repository(gitDir);
            }

            try
            {
                var discovered = Repository.Discover(workDir);
                return new Repository(discovered);
            }
            catch (Exception ex) when (ex is not CoreRepositoryNotFoundException)
            {
                throw new CoreRepositoryNotFoundException(workDir, ex);
            }
        }

        private static Repository OpenRepo(string workDir)
        {
            ArgumentException.ThrowIfNullOrEmpty(workDir);
            return Discover(workDir);
        }

        private static string TrimTrailingSep(string fromLibgit2, string fallback)
        {
            var p = (fromLibgit2 ?? string.Empty).TrimEnd('/', '\\');
            return string.IsNullOrEmpty(p) ? fallback : p;
        }

        private static CommitFilter BuildCommitFilter(Repository repo, CoreLogFilter f)
        {
            var filter = new CommitFilter { SortBy = CommitSortStrategies.Time };
            if (f.Branch is not null && repo.Branches[f.Branch] is { Tip: not null } branch)
                filter.IncludeReachableFrom = branch.Tip;
            return filter;
        }

        /// <summary>
        /// pack idx ≥ 128KB（约 5k 对象 ≈ 2k 提交）视为大仓库，启用 rev-list 快路径。
        /// 只看 packfile（大仓库必然 gc 过）；loose-only 或 worktree（.git 为文件）按小仓库
        /// 处理，正确性不变、仅走较慢的全量遍历。
        /// </summary>
        private static bool HasLargePack(string workDir)
        {
            try
            {
                var packDir = Path.Combine(workDir, ".git", "objects", "pack");
                if (!Directory.Exists(packDir)) return false;
                foreach (var idx in Directory.EnumerateFiles(packDir, "*.idx"))
                {
                    if (new FileInfo(idx).Length >= 128 * 1024) return true;
                }
            }
            catch
            {
                // 枚举失败按小仓库处理
            }
            return false;
        }

        /// <summary>
        /// <c>git rev-list --count &lt;ref&gt;</c> 取可达提交总数。
        /// git CLI 不可用 / 超时 / ref 不存在时返回 null，调用方回退 libgit2 全量遍历路径。
        /// </summary>
        private static int? TryRevListCount(string workDir, string refName)
        {
            try
            {
                var psi = CreateRevList(workDir, refName);
                psi.ArgumentList.Add("--count");

                using var process = Process.Start(psi);
                if (process is null) return null;

                var stdout = process.StandardOutput.ReadToEnd();
                if (!WaitForExitOrKill(process, 10_000)) return null;
                if (process.ExitCode != 0) return null;

                return int.Parse(stdout.Trim(), System.Globalization.CultureInfo.InvariantCulture);
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// <c>git rev-list --skip N --max-count L &lt;ref&gt;</c> 取分页窗口的 SHA。
        /// 失败时返回 null（调用方回退），窗口不足 L 条即到达历史尽头。
        /// </summary>
        private static List<string>? TryRevListWindow(string workDir, string refName, int skip, int limit)
        {
            try
            {
                var psi = CreateRevList(workDir, refName);
                psi.ArgumentList.Add("--skip");
                psi.ArgumentList.Add(skip.ToString(System.Globalization.CultureInfo.InvariantCulture));
                psi.ArgumentList.Add("--max-count");
                psi.ArgumentList.Add(limit.ToString(System.Globalization.CultureInfo.InvariantCulture));

                using var process = Process.Start(psi);
                if (process is null) return null;

                var window = new List<string>(Math.Min(limit, 1024));
                string? line;
                while ((line = process.StandardOutput.ReadLine()) is not null)
                {
                    if (line.Length > 0) window.Add(line);
                }

                if (!WaitForExitOrKill(process, 10_000)) return null;
                if (process.ExitCode != 0) return null;

                return window;
            }
            catch
            {
                return null;
            }
        }

        private static ProcessStartInfo CreateRevList(string workDir, string refName)
        {
            var psi = new ProcessStartInfo("git")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add("-C");
            psi.ArgumentList.Add(workDir);
            psi.ArgumentList.Add("rev-list");
            psi.ArgumentList.Add(refName);
            return psi;
        }

        /// <summary>限时等待退出；超时杀进程并返回 false。</summary>
        private static bool WaitForExitOrKill(Process process, int timeoutMs)
        {
            if (process.WaitForExit(timeoutMs)) return true;
            try { process.Kill(); } catch { /* 已退出则忽略 */ }
            return false;
        }

        private static bool MatchesTime(Commit c, CoreLogFilter f)
        {
            if (f.After is { } after && c.Author.When < after) return false;
            if (f.Before is { } before && c.Author.When > before) return false;
            return true;
        }

        private static bool MatchesAuthor(Commit c, string? author)
        {
            if (string.IsNullOrEmpty(author)) return true;
            return c.Author.Name.Contains(author, StringComparison.OrdinalIgnoreCase)
                || c.Author.Email.Contains(author, StringComparison.OrdinalIgnoreCase);
        }

        private static bool MatchesTopic(Commit c, string? topic)
        {
            if (string.IsNullOrEmpty(topic)) return true;
            try { return Regex.IsMatch(c.Message, topic, RegexOptions.Singleline | RegexOptions.CultureInvariant); }
            catch (ArgumentException) { return c.Message.Contains(topic, StringComparison.OrdinalIgnoreCase); }
        }

        private static CoreCommitNode ToCommitNode(Repository repo, Commit commit)
        {
            if (commit is null) throw new ArgumentNullException(nameof(commit));
            var branchTips = new Dictionary<string, List<string>>(StringComparer.Ordinal);
            foreach (var b in repo.Branches)
            {
                if (b.Tip is null) continue;
                if (!branchTips.TryGetValue(b.Tip.Sha, out var names))
                    branchTips[b.Tip.Sha] = names = new List<string>();
                names.Add(b.FriendlyName);
            }

            var tagTargets = new Dictionary<string, List<string>>(StringComparer.Ordinal);
            foreach (var t in repo.Tags)
            {
                string? sha = t.PeeledTarget is Commit pc ? pc.Sha
                            : t.Annotation is { Target: Commit ac } ? ac.Sha
                            : null;
                if (sha is null) continue;
                if (!tagTargets.TryGetValue(sha, out var names))
                    tagTargets[sha] = names = new List<string>();
                names.Add(t.FriendlyName);
            }

            return ToCommitNode(commit, branchTips, tagTargets);
        }

        /// <summary>用预计算好的 branch/tag 映射物化节点（GetLog 批量路径）。</summary>
        private static CoreCommitNode ToCommitNode(
            Commit commit,
            Dictionary<string, List<string>> branchTips,
            Dictionary<string, List<string>> tagTargets)
        {
            branchTips.TryGetValue(commit.Sha, out var branches);
            tagTargets.TryGetValue(commit.Sha, out var tags);

            return new CoreCommitNode(
                commit.Sha,
                commit.Sha.Substring(0, Math.Min(7, commit.Sha.Length)),
                commit.Message,
                commit.MessageShort,
                commit.Author.Name,
                commit.Author.Email,
                commit.Author.When,
                commit.Committer.Name,
                commit.Committer.When,
                commit.Parents.Select(p => p.Sha).ToImmutableArray(),
                commit.Tree.Sha,
                (branches ?? new List<string>()).ToImmutableArray(),
                (tags ?? new List<string>()).ToImmutableArray());
        }

        /// <summary>
        /// 在树对象中按完整相对路径查找 blob。libgit2sharp 的 <see cref="Tree"/> 索引器
        /// 仅接受相对路径且不支持子目录，故需逐级下降。
        /// </summary>
        private static Blob? LookupBlob(Tree? tree, string path)
        {
            if (tree is null || string.IsNullOrEmpty(path)) return null;
            var current = tree;
            var parts = path.Split('/');
            foreach (var part in parts)
            {
                var entry = current[part];
                if (entry is null) return null;
                if (part == parts[^1]) return entry.Target as Blob;
                var next = entry.Target as Tree;
                if (next is null) return null;
                current = next;
            }
            return null;
        }

        private static Tree ResolveTree(Repository repo, string treeish)
        {
            ArgumentException.ThrowIfNullOrEmpty(treeish);
            var obj = repo.Lookup(treeish);
            return obj switch
            {
                Tree t => t,
                Commit c => c.Tree,
                TagAnnotation tag when tag.Target is Commit tc => tc.Tree,
                TagAnnotation tag when tag.Target is Tree tt => tt,
                _ => throw new InvalidOperationException($"Cannot resolve tree from '{treeish}'."),
            };
        }

        private static void WalkTree(Tree tree, string prefix, List<CoreTreeEntry> result)
        {
            foreach (var entry in tree)
            {
                var path = string.IsNullOrEmpty(prefix) ? entry.Path : prefix + "/" + entry.Name;
                var type = entry.TargetType switch
                {
                    LibGit2Sharp.TreeEntryTargetType.Tree => CoreTreeEntryType.Tree,
                    LibGit2Sharp.TreeEntryTargetType.GitLink => CoreTreeEntryType.GitLink,
                    _ => CoreTreeEntryType.Blob,
                };
                var mode = entry.Mode switch
                {
                    Mode.ExecutableFile => CoreFileMode.Executable,
                    Mode.NonExecutableFile => CoreFileMode.NonExecutable,
                    Mode.Directory => CoreFileMode.Tree,
                    Mode.SymbolicLink => CoreFileMode.Symlink,
                    Mode.GitLink => CoreFileMode.GitLink,
                    _ => CoreFileMode.NonExecutable,
                };
                result.Add(new CoreTreeEntry(Path: path, Name: entry.Name, Sha: entry.Target.Sha, Mode: mode, EntryType: type));
                if (type == CoreTreeEntryType.Tree && entry.Target is Tree subtree)
                    WalkTree(subtree, path, result);
            }
        }

        private static CoreDiffResult ToDiffResult(PatchEntryChanges entry)
        {
            var path = entry.Path.TrimStart('/');
            var oldPath = (entry.OldPath ?? entry.Path).TrimStart('/');
            var isNew = entry.Status == ChangeKind.Added;
            var isDeleted = entry.Status == ChangeKind.Deleted;
            var isRenamed = entry.Status is ChangeKind.Renamed or ChangeKind.Copied;

            IReadOnlyList<CoreDiffHunk> hunks =
                entry.IsBinaryComparison ? Array.Empty<CoreDiffHunk>() : ParseUnifiedDiff(entry.Patch);

            return new CoreDiffResult(
                Path: path,
                OldPath: isRenamed ? oldPath : path,
                IsBinary: entry.IsBinaryComparison,
                IsNew: isNew,
                IsDeleted: isDeleted,
                IsRenamed: isRenamed,
                Hunks: hunks,
                AddedLines: entry.LinesAdded,
                DeletedLines: entry.LinesDeleted);
        }

        /// <summary>
        /// 把一个 <see cref="StatusEntry"/> 拆成可能同时出现的多个分类。
        /// 同一个文件既可能进 index（Staged）又可能有工作区改动（Changes），
        /// 此时返回两个分类，让 Changes 页的两层列表都能显示它。
        /// </summary>
        private static IReadOnlyList<CoreStatusCategory> ClassifyAll(StatusEntry entry)
        {
            var s = entry.State;
            if (s == FileStatus.Conflicted)
                return new[] { CoreStatusCategory.Conflict };

            // libgit2sharp 把 index 侧与 workdir 侧的多个状态 OR 到同一个 State 字段里，
            // 所以必须按位检查，不能靠相等比较。
            bool inIndex = (s & FileStatus.NewInIndex) != 0
                       || (s & FileStatus.ModifiedInIndex) != 0
                       || (s & FileStatus.DeletedFromIndex) != 0
                       || (s & FileStatus.RenamedInIndex) != 0
                       || (s & FileStatus.TypeChangeInIndex) != 0;
            bool inWorkdir = (s & FileStatus.NewInWorkdir) != 0
                         || (s & FileStatus.ModifiedInWorkdir) != 0
                         || (s & FileStatus.DeletedFromWorkdir) != 0
                         || (s & FileStatus.RenamedInWorkdir) != 0
                         || (s & FileStatus.TypeChangeInWorkdir) != 0;

            var result = new List<CoreStatusCategory>();
            // IDEA 三层模型：进 index 即 Staged；纯新增归 Unversioned；其余工作区改动归 Changes。
            // 未跟踪文件只进 Unversioned 一层，不再额外塞一条 Changes（避免 IDEA 里同文件在两栏重复出现）。
            if (inIndex) result.Add(CoreStatusCategory.Staged);
            if (s == FileStatus.NewInWorkdir && !inIndex) result.Add(CoreStatusCategory.Unversioned);
            if (inWorkdir && !s.Equals(FileStatus.NewInWorkdir)) result.Add(CoreStatusCategory.Changes);
            if (result.Count == 0) result.Add(CoreStatusCategory.Changes);
            return result;
        }

        private static int CountLines(Blob blob)
        {
            var text = blob.GetContentText();
            return DiffText.CountLines(text);
        }

        private static CoreDiffHunk BuildInsertionHunk(Blob blob)
        {
            var lines = SplitLines(blob.GetContentText());
            return new CoreDiffHunk(
                0, 0, 1, lines.Length,
                Array.Empty<string>(),
                lines.Select(l => "+" + l).ToList());
        }

        private static CoreDiffHunk BuildDeletionHunk(Blob blob)
        {
            var lines = SplitLines(blob.GetContentText());
            return new CoreDiffHunk(
                1, lines.Length, 0, 0,
                lines.Select(l => "-" + l).ToList(),
                Array.Empty<string>());
        }

        /// <summary>解析 unified diff 文本为 hunk 列表（S5 起委托 Core 的 UnifiedPatch.ParseHunks，语义不变）。</summary>
        internal static IReadOnlyList<CoreDiffHunk> ParseUnifiedDiff(string? patch)
            => GitUI.Core.Services.UnifiedPatch.ParseHunks(patch);


        /// <summary>行切分统一走 <see cref="DiffText"/>（S2 起：无幻影尾行、\r 视为行内容）。</summary>
        internal static string[] SplitLines(string text) => DiffText.SplitLines(text);
    }
}
