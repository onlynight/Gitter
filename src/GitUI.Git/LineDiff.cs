using GitUI.Core.Models;
using CoreDiffHunk = GitUI.Core.Models.DiffHunk;

namespace GitUI.Git
{
    /// <summary>
    /// 行级 LCS diff。这是 S1 阶段的临时实现，仅用于让 <c>GetFileDiff</c> 在纯文本输入时
    /// 能返回结构正确的 <see cref="CoreDiffHunk"/>，以及为
    /// <c>IRepositoryService.ComputeDiff</c> 提供不依赖 libgit2 的路径。
    ///
    /// S2 阶段会用 DiffPkg 的 Myers 算法替换本类并加字级差异。届时
    /// <c>IRepositoryService.ComputeDiff</c> 的签名保持不变，调用方无感切换。
    /// </summary>
    internal static class LineDiff
    {
        private readonly struct Edit
        {
            public Edit(int oldIdx, int newIdx, bool isDeletion)
            {
                OldIdx = oldIdx;
                NewIdx = newIdx;
                IsDeletion = isDeletion;
            }

            public int OldIdx { get; }
            public int NewIdx { get; }
            public bool IsDeletion { get; }
        }

        /// <summary>计算两组行之间的差异，返回带上下文的 <see cref="CoreDiffHunk"/> 列表。</summary>
        public static IReadOnlyList<CoreDiffHunk> ComputeHunks(
            string[] oldLines, string[] newLines, int contextLines = 3)
        {
            var edits = ComputeEditScript(oldLines, newLines);
            return edits.Count == 0 ? Array.Empty<CoreDiffHunk>() : GroupIntoHunks(edits, oldLines, newLines, contextLines);
        }

        /// <summary>编辑脚本：一个元素表示一次插入或删除的位置。</summary>
        private static List<Edit> ComputeEditScript(string[] oldLines, string[] newLines)
        {
            int n = oldLines.Length, m = newLines.Length;
            var dp = new int[n + 1, m + 1];
            for (int i = n - 1; i >= 0; i--)
            {
                for (int j = m - 1; j >= 0; j--)
                {
                    dp[i, j] = oldLines[i] == newLines[j]
                        ? dp[i + 1, j + 1] + 1
                        : Math.Max(dp[i + 1, j], dp[i, j + 1]);
                }
            }

            var edits = new List<Edit>();
            int oi = 0, ni = 0;
            while (oi < n && ni < m)
            {
                if (oldLines[oi] == newLines[ni]) { oi++; ni++; continue; }
                if (dp[oi + 1, ni] >= dp[oi, ni + 1]) { edits.Add(new Edit(oi, ni, isDeletion: true)); oi++; }
                else { edits.Add(new Edit(oi, ni, isDeletion: false)); ni++; }
            }
            while (oi < n) { edits.Add(new Edit(oi, ni, isDeletion: true)); oi++; }
            while (ni < m) { edits.Add(new Edit(oi, ni, isDeletion: false)); ni++; }
            return edits;
        }

        private static IReadOnlyList<CoreDiffHunk> GroupIntoHunks(
            List<Edit> edits, string[] oldLines, string[] newLines, int contextLines)
        {
            var groups = new List<List<Edit>>();
            foreach (var cur in edits)
            {
                if (groups.Count > 0)
                {
                    var last = groups[^1][^1];
                    if (last.OldIdx + 1 == cur.OldIdx || last.NewIdx + 1 == cur.NewIdx)
                    {
                        groups[^1].Add(cur);
                        continue;
                    }
                }
                groups.Add(new List<Edit> { cur });
            }

            var hunks = new List<CoreDiffHunk>();
            foreach (var group in groups)
            {
                var firstOld = group[0].OldIdx; var lastOld = group[^1].OldIdx;
                var firstNew = group[0].NewIdx; var lastNew = group[^1].NewIdx;

                var oldStart = Math.Max(0, firstOld - contextLines);
                var newStart = Math.Max(0, firstNew - contextLines);
                var oldEnd = Math.Min(oldLines.Length, lastOld + 1 + contextLines);
                var newEnd = Math.Min(newLines.Length, lastNew + 1 + contextLines);

                var deletions = new HashSet<int>(group.Where(g => g.IsDeletion).Select(g => g.OldIdx));
                var insertions = new HashSet<int>(group.Where(g => !g.IsDeletion).Select(g => g.NewIdx));

                var oldList = new List<string>();
                var newList = new List<string>();
                int di = oldStart, ii = newStart;
                while (di < oldEnd || ii < newEnd)
                {
                    if (deletions.Contains(di))
                    {
                        oldList.Add("-" + oldLines[di]);
                        di++;
                    }
                    else if (insertions.Contains(ii))
                    {
                        newList.Add("+" + newLines[ii]);
                        ii++;
                    }
                    else
                    {
                        if (di >= oldEnd && ii >= newEnd) break;
                        var text = di < oldEnd ? oldLines[di] : newLines[ii];
                        oldList.Add(" " + text);
                        newList.Add(" " + text);
                        di++;
                        ii++;
                    }
                }

                hunks.Add(new CoreDiffHunk(
                    OldStart: oldStart + 1,
                    OldCount: oldEnd - oldStart,
                    NewStart: newStart + 1,
                    NewCount: newEnd - newStart,
                    OldLines: oldList,
                    NewLines: newList));
            }
            return hunks;
        }
    }
}
