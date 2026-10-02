using System.Collections.Immutable;
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
            var commitFilter = BuildCommitFilter(repo, f);

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
            return LineDiff.ComputeHunks(
                SplitLines(oldText ?? string.Empty),
                SplitLines(newText ?? string.Empty),
                contextLines: 3);
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
            return string.IsNullOrEmpty(text) ? 0 : SplitLines(text).Length;
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

        /// <summary>解析 unified diff 文本为 <see cref="CoreDiffHunk"/> 列表。</summary>
        internal static IReadOnlyList<CoreDiffHunk> ParseUnifiedDiff(string? patch)
        {
            if (string.IsNullOrEmpty(patch)) return Array.Empty<CoreDiffHunk>();
            var lines = patch.Split('\n');
            var hunks = new List<CoreDiffHunk>();
            int oldStart = 0, oldCount = 0, newStart = 0, newCount = 0;
            var oldLines = new List<string>();
            var newLines = new List<string>();
            bool inHunk = false;

            foreach (var raw in lines)
            {
                var line = raw.TrimEnd('\r');
                if (line.StartsWith("@@"))
                {
                    if (inHunk)
                        hunks.Add(new CoreDiffHunk(oldStart, oldCount, newStart, newCount, oldLines, newLines));
                    inHunk = true;
                    ParseHunkHeader(line, out oldStart, out oldCount, out newStart, out newCount);
                    oldLines.Clear();
                    newLines.Clear();
                }
                else if (inHunk)
                {
                    if (line.StartsWith(' ')) { oldLines.Add(line); newLines.Add(line); }
                    else if (line.StartsWith('-')) oldLines.Add(line);
                    else if (line.StartsWith('+')) newLines.Add(line);
                }
            }
            if (inHunk)
                hunks.Add(new CoreDiffHunk(oldStart, oldCount, newStart, newCount, oldLines, newLines));

            return hunks;
        }

        private static void ParseHunkHeader(
            string header, out int oldStart, out int oldCount, out int newStart, out int newCount)
        {
            oldStart = oldCount = newStart = newCount = 0;
            var idx = header.IndexOf('-', 2);
            if (idx < 0) return;
            ParseRange(header[idx..].Trim(), out oldStart, out oldCount);

            var plus = header.IndexOf('+', idx);
            if (plus < 0) return;
            ParseRange(header[plus..].Trim(), out newStart, out newCount);
        }

        private static void ParseRange(string s, out int start, out int count)
        {
            start = count = 0;
            var comma = s.IndexOf(',');
            var range = comma >= 0 ? s[..comma] : s;
            if (!int.TryParse(range, out start)) return;
            count = comma >= 0 && int.TryParse(s[(comma + 1)..], out var c) ? c : 1;
        }

        internal static string[] SplitLines(string text)
        {
            if (string.IsNullOrEmpty(text)) return Array.Empty<string>();
            var list = new List<string>();
            var current = new StringBuilder();
            foreach (var ch in text)
            {
                if (ch == '\n') { list.Add(current.ToString()); current.Clear(); }
                else if (ch != '\r') current.Append(ch);
            }
            list.Add(current.ToString());
            return list.ToArray();
        }
    }
}
