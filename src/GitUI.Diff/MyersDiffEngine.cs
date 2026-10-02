using GitUI.Core.Models;
using GitUI.Core.Services;
using CoreDiffHunk = GitUI.Core.Models.DiffHunk;

namespace GitUI.Diff;

/// <summary>
/// <see cref="IDiffEngine"/> 的 Myers 实现（S2，docs/design.md §8）。
///
/// 三层策略，全部产出仍然正确的编辑脚本：
/// 1. 唯一行锚点预分割——两侧各只出现一次且值相同的行作为分割锚点，
///    把大文件切成小窗口（git histogram/xdl 的同源思路，应对分散修改）；
/// 2. 窗口内走 Myers 线性空间分治（middle snake），带确定性步数预算；
/// 3. 预算耗尽（如两侧完全不同的超大窗口）退化为整段"删除 + 插入"。
///
/// 块划分可能与 GNU diff 不同（设计允许"内容等价"），但应用结果恒等于新文本。
/// </summary>
public sealed class MyersDiffEngine : IDiffEngine
{
    public static readonly MyersDiffEngine Instance = new();

    private const int DefaultContextLines = 3;

    private MyersDiffEngine() { }

    public IReadOnlyList<DiffHunk> ComputeHunks(string oldText, string newText, DiffOptions? options = null)
    {
        var opt = (options ?? DiffOptions.Default).Normalized();
        var oldLines = DiffText.SplitLines(oldText ?? string.Empty);
        var newLines = DiffText.SplitLines(newText ?? string.Empty);

        var ops = ComputeEditOps(oldLines, newLines);
        if (ops.Count == 0) return Array.Empty<DiffHunk>();

        return AssembleHunks(ops, oldLines, newLines, opt.ContextLines);
    }

    public IReadOnlyList<WordSegment> ComputeWordDiff(string oldLine, string newLine)
    {
        if (string.IsNullOrEmpty(oldLine) && string.IsNullOrEmpty(newLine)) return Array.Empty<WordSegment>();
        if (string.Equals(oldLine, newLine, StringComparison.Ordinal))
            return string.IsNullOrEmpty(oldLine)
                ? Array.Empty<WordSegment>()
                : new[] { new WordSegment(WordSegmentKind.Equal, oldLine) };

        var oldTokens = WordTokenizer.Tokenize(oldLine ?? string.Empty);
        var newTokens = WordTokenizer.Tokenize(newLine ?? string.Empty);

        // 单行 token 数量级很小，直接 Myers，不需要锚点；预算给足避免退化。
        var (a, b) = Intern(oldTokens, newTokens);
        var ops = new List<DiffOp>();
        MyersDiffAlgorithm.Compute(a, b, ops, stepBudget: 1 << 22);

        var segments = new List<WordSegment>();
        foreach (var op in ops)
        {
            var kind = op.Kind switch
            {
                DiffOpKind.Equal => WordSegmentKind.Equal,
                DiffOpKind.Delete => WordSegmentKind.Deleted,
                _ => WordSegmentKind.Inserted,
            };
            var text = kind switch
            {
                WordSegmentKind.Equal => oldTokens[op.OldIdx],
                WordSegmentKind.Deleted => oldTokens[op.OldIdx],
                _ => newTokens[op.NewIdx],
            };
            if (segments.Count > 0 && segments[^1].Kind == kind)
                segments[^1] = segments[^1] with { Text = segments[^1].Text + text };
            else
                segments.Add(new WordSegment(kind, text));
        }

        return segments;
    }

    // ---------- 编辑脚本 ----------

    /// <summary>行内容 → 整型 id，再经锚点分割 + Myers 生成编辑脚本。无差异时返回空表。</summary>
    private static List<DiffOp> ComputeEditOps(string[] oldLines, string[] newLines)
    {
        var ops = new List<DiffOp>();
        if (oldLines.Length == 0 && newLines.Length == 0) return ops;

        var (a, b) = Intern(oldLines, newLines);

        // 快路径：完全一致
        if (a.AsSpan().SequenceEqual(b)) return ops;

        if (a.Length == 0)
        {
            for (int j = 0; j < b.Length; j++) ops.Add(new DiffOp(DiffOpKind.Insert, 0, j));
            return ops;
        }
        if (b.Length == 0)
        {
            for (int i = 0; i < a.Length; i++) ops.Add(new DiffOp(DiffOpKind.Delete, i, 0));
            return ops;
        }

        var anchors = FindAnchors(a, b);
        ProcessWindow(a, b, 0, a.Length, 0, b.Length, anchors, ops);
        return ops;
    }

    /// <summary>
    /// 锚点分割窗口：窗口内取中位锚点二分递归；无锚点的窗口交给 Myers。
    /// 用中位锚点保证递归深度是 O(log 锚点数)。
    /// </summary>
    private static void ProcessWindow(
        int[] a, int[] b, int a0, int a1, int b0, int b1,
        IReadOnlyList<(int I, int J)> anchors, List<DiffOp> ops)
    {
        if (a0 == a1 && b0 == b1) return;

        if (a0 == a1)
        {
            for (int j = b0; j < b1; j++) ops.Add(new DiffOp(DiffOpKind.Insert, a0, j));
            return;
        }
        if (b0 == b1)
        {
            for (int i = a0; i < a1; i++) ops.Add(new DiffOp(DiffOpKind.Delete, i, b0));
            return;
        }

        // 二分找 i ∈ [a0, a1) 的锚点区间
        int lo = LowerBound(anchors, a0);
        int hi = lo;
        while (hi < anchors.Count && anchors[hi].I < a1) hi++;

        if (lo >= hi)
        {
            // 无锚点窗口：Myers 分治 + 预算兜底。
            long budget = Math.Max(65_536, (long)(a1 - a0 + b1 - b0) * 1024);
            MyersDiffAlgorithm.ComputeRange(a, a0, a1, b, b0, b1, ops, new StepBudget(budget), 0);
            return;
        }

        var (midI, midJ) = anchors[lo + (hi - lo - 1) / 2];
        ProcessWindow(a, b, a0, midI, b0, midJ, anchors, ops);
        ops.Add(new DiffOp(DiffOpKind.Equal, midI, midJ));
        ProcessWindow(a, b, midI + 1, a1, midJ + 1, b1, anchors, ops);
    }

    /// <summary>窗口内第一个 >= a0 的锚点下标。</summary>
    private static int LowerBound(IReadOnlyList<(int I, int J)> anchors, int a0)
    {
        int lo = 0, hi = anchors.Count;
        while (lo < hi)
        {
            int mid = lo + (hi - lo) / 2;
            if (anchors[mid].I < a0) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }

    /// <summary>
    /// 找"两侧都唯一且值相同"的行作为锚点：i 递增扫描，贪心保留 j 严格递增的配对。
    /// 贪心丢弃部分锚点不影响正确性（任何公共子序列都是合法的 Equal），
    /// 只影响窗口切分粒度。
    /// </summary>
    private static List<(int I, int J)> FindAnchors(int[] a, int[] b)
    {
        // 两侧出现次数必须分别统计：合成差值无法区分"两侧各一次"与"两侧各两次"。
        var countA = new Dictionary<int, int>(a.Length);
        foreach (var id in a) countA[id] = countA.TryGetValue(id, out var c) ? c + 1 : 1;
        var countB = new Dictionary<int, int>(b.Length);
        var posInB = new Dictionary<int, int>(b.Length);
        for (int j = 0; j < b.Length; j++)
        {
            var id = b[j];
            countB[id] = countB.TryGetValue(id, out var c) ? c + 1 : 1;
            if (!posInB.ContainsKey(id)) posInB[id] = j;
        }

        var anchors = new List<(int I, int J)>();
        int lastJ = -1;
        for (int i = 0; i < a.Length; i++)
        {
            var id = a[i];
            if (countA[id] != 1 || countB.GetValueOrDefault(id) != 1) continue;
            int j = posInB[id];
            if (j <= lastJ) continue;                    // 破坏 i/j 同序，丢弃
            anchors.Add((i, j));
            lastJ = j;
        }
        return anchors;
    }

    private static (int[] A, int[] B) Intern(IReadOnlyList<string> oldItems, IReadOnlyList<string> newItems)
    {
        var map = new Dictionary<string, int>(oldItems.Count + newItems.Count);
        var a = new int[oldItems.Count];
        for (int i = 0; i < oldItems.Count; i++)
        {
            if (!map.TryGetValue(oldItems[i], out var id))
            {
                id = map.Count;
                map[oldItems[i]] = id;
            }
            a[i] = id;
        }

        var b = new int[newItems.Count];
        for (int j = 0; j < newItems.Count; j++)
        {
            if (!map.TryGetValue(newItems[j], out var id))
            {
                id = map.Count;
                map[newItems[j]] = id;
            }
            b[j] = id;
        }
        return (a, b);
    }

    // ---------- hunk 组装 ----------

    /// <summary>
    /// 把编辑脚本组装成带上下文的 unified hunk。
    /// 相距 ≤ 2×context 行相同内容的两个编辑块合并为一个 hunk（git/GNU diff 同语义，
    /// 因此相邻 hunk 的上下文区间天然不重叠）。
    /// 上下文直接取编辑块前后的 Equal 操作——两侧行号天然对齐，
    /// 避免对纯插入/纯删除组（一侧区间为空）做错误的独立区间扩展。
    /// 块头遵循 git 语义：0 计数一侧的起始行是插入/删除点前一行行号（文件最前为 0）。
    /// </summary>
    private static List<CoreDiffHunk> AssembleHunks(
        List<DiffOp> ops, string[] oldLines, string[] newLines, int context)
    {
        int splitGap = 2 * context;
        // 组 = ops 里一段连续的编辑区（编辑 op 下标区间 [start, end)）
        var starts = new List<int>();
        var ends = new List<int>();
        int runGap = int.MaxValue / 2;
        for (int k = 0; k < ops.Count; k++)
        {
            if (ops[k].Kind == DiffOpKind.Equal)
            {
                if (starts.Count > 0) runGap++;
                continue;
            }
            if (starts.Count == 0 || runGap > splitGap)
            {
                starts.Add(k);
                ends.Add(k + 1); // 排他区间：单编辑块也成立
            }
            else
            {
                ends[^1] = k + 1;
            }
            runGap = 0;
        }

        var hunks = new List<CoreDiffHunk>(starts.Count);
        for (int g = 0; g < starts.Count; g++)
            hunks.Add(BuildHunk(ops, starts[g], ends[g], oldLines, newLines, context));
        return hunks;
    }

    private static CoreDiffHunk BuildHunk(
        List<DiffOp> ops, int start, int end, string[] oldLines, string[] newLines, int context)
    {
        // 前后各取 ≤ context 个相邻 Equal 作为上下文（文件边界处自然截断）
        int back = 0;
        while (back < context && start - back - 1 >= 0 && ops[start - back - 1].Kind == DiffOpKind.Equal) back++;
        int fwd = 0;
        while (fwd < context && end + fwd < ops.Count && ops[end + fwd].Kind == DiffOpKind.Equal) fwd++;

        var first = ops[start];
        var last = ops[end - 1];

        int oldStart = back > 0 ? ops[start - back].OldIdx : first.OldIdx;
        int newStart = back > 0 ? ops[start - back].NewIdx : first.NewIdx;
        int oldEnd = fwd > 0 ? ops[end + fwd - 1].OldIdx + 1
                   : last.Kind == DiffOpKind.Delete ? last.OldIdx + 1 : last.OldIdx;
        int newEnd = fwd > 0 ? ops[end + fwd - 1].NewIdx + 1
                   : last.Kind == DiffOpKind.Insert ? last.NewIdx + 1 : last.NewIdx;

        var oldBody = new List<string>(oldEnd - oldStart);
        var newBody = new List<string>(newEnd - newStart);

        for (int k = start - back; k < start; k++)
        {
            oldBody.Add(" " + oldLines[ops[k].OldIdx]);
            newBody.Add(" " + newLines[ops[k].NewIdx]);
        }
        for (int k = start; k < end; k++)
        {
            var op = ops[k];
            if (op.Kind == DiffOpKind.Equal)
            {
                // 组内被合并块隔开的相同行是上下文（merged edits 之间的 gap）
                oldBody.Add(" " + oldLines[op.OldIdx]);
                newBody.Add(" " + newLines[op.NewIdx]);
            }
            else if (op.Kind == DiffOpKind.Delete)
            {
                oldBody.Add("-" + oldLines[op.OldIdx]);
            }
            else
            {
                newBody.Add("+" + newLines[op.NewIdx]);
            }
        }
        for (int k = end; k < end + fwd; k++)
        {
            oldBody.Add(" " + oldLines[ops[k].OldIdx]);
            newBody.Add(" " + newLines[ops[k].NewIdx]);
        }

        int oldCount = oldEnd - oldStart, newCount = newEnd - newStart;
        return new CoreDiffHunk(
            OldStart: oldCount > 0 ? oldStart + 1 : oldStart,
            OldCount: oldCount,
            NewStart: newCount > 0 ? newStart + 1 : newStart,
            NewCount: newCount,
            OldLines: oldBody,
            NewLines: newBody);
    }
}
