using GitUI.Core.Models;
using GitUI.Diff.Highlighting;
using GitUI.Core.Services;

namespace GitUI.Diff.Render;

/// <summary>一段连续的变更行区间（行号含首尾）。</summary>
public sealed record DiffChangeBlock(int FirstRow, int LastRow);

/// <summary>
/// DiffCanvas 的行模型（S3）：把 <see cref="DiffHunk"/> 列表展开为可直接布局绘制的行序列。
///
/// 两种模式产出不同的行序列：
/// <list type="bullet">
///   <item>并排（side-by-side）：每行左右两格；纯增/删与段长不齐的余量一侧放 <see cref="DiffRowKind.Filler"/> 填充格。</item>
///   <item>内联（inline）：每行单格，删除行在前、新增行在后（unified 顺序），无填充行。</item>
/// </list>
///
/// 字级差异惰性计算：模型构建只做行配对（O(行数)），<see cref="EnsureWordDiff"/>
/// 只对可视区内的配对行调 <see cref="IDiffEngine.ComputeWordDiff"/> 并缓存，
/// 保证 10k 行 diff 的首帧不背全量字级差异的开销。
/// </summary>
public sealed class DiffRenderModel
{
    /// <summary>单对字级 diff 两侧的总字符数上限，超过则跳过行内高亮（防 O(n·m) 卡顿）。</summary>
    public const int WordDiffMaxChars = 4096;

    private readonly IDiffEngine _wordDiff;
    private readonly List<WordPair> _wordPairs = new();

    /// <param name="hunks">行级差异块（S2 引擎产出，git 块头语义）。</param>
    /// <param name="oldEndsWithNewline">旧内容末尾是否有换行符（TextDiffResult 携带，渲染 "\ No newline" 用）。</param>
    /// <param name="newEndsWithNewline">新内容末尾是否有换行符。</param>
    /// <param name="wordDiffEngine">字级差异引擎。默认 Myers。</param>
    public DiffRenderModel(
        IReadOnlyList<DiffHunk> hunks,
        bool oldEndsWithNewline = true,
        bool newEndsWithNewline = true,
        bool sideBySide = true,
        IDiffEngine? wordDiffEngine = null)
    {
        _wordDiff = wordDiffEngine ?? MyersDiffEngine.Instance;
        Hunks = hunks;
        SideBySide = sideBySide;
        Build(hunks, oldEndsWithNewline, newEndsWithNewline);
    }

    public IReadOnlyList<DiffHunk> Hunks { get; }

    /// <summary>构建时是否为并排模式。</summary>
    public bool SideBySide { get; }

    public IReadOnlyList<DiffRow> Rows { get; private set; } = Array.Empty<DiffRow>();

    /// <summary>所有内容行的最大列数（tab 已展开、按等宽字符格计），水平滚动范围用。</summary>
    public int MaxTextColumns { get; private set; }

    /// <summary>旧侧最大行号（行号槽宽度用）。</summary>
    public int MaxOldNumber { get; private set; }

    /// <summary>新侧最大行号（行号槽宽度用）。</summary>
    public int MaxNewNumber { get; private set; }

    /// <summary>
    /// 连续变更行区间列表（按出现顺序）。hunk 头/上下文/填充/标记行都会打断区间。
    /// 并排视图的一对变更行算同一区间（Alt+↑/↓ 的导航单元）。
    /// </summary>
    public IReadOnlyList<DiffChangeBlock> ChangeBlocks { get; private set; } = Array.Empty<DiffChangeBlock>();

    private Dictionary<int, DiffChangeBlock>? _hunkRowRanges;

    /// <summary>
    /// hunk 序号 → [首行, 末行]（含 hunk 头行），S5 选块高亮与点击定位用。
    /// 首次访问构建并缓存（O(行数) 一次）。
    /// </summary>
    public DiffChangeBlock? TryGetHunkRowRange(int hunkIndex)
    {
        if (hunkIndex < 0 || hunkIndex >= Hunks.Count) return null;
        _hunkRowRanges ??= BuildHunkRowRanges();
        return _hunkRowRanges.TryGetValue(hunkIndex, out var range) ? range : null;
    }

    /// <summary>行号 → 所属 hunk 序号；越界或不属于任何 hunk（EOF 标记行）返回 null。</summary>
    public int? TryGetHunkIndexAtRow(int row)
    {
        if (row < 0 || row >= Rows.Count) return null;
        var h = Rows[row].HunkIndex;
        return h >= 0 ? h : null;
    }

    private Dictionary<int, DiffChangeBlock> BuildHunkRowRanges()
    {
        var map = new Dictionary<int, DiffChangeBlock>();
        for (int r = 0; r < Rows.Count; r++)
        {
            var h = Rows[r].HunkIndex;
            if (h < 0) continue;
            if (map.TryGetValue(h, out var range))
                map[h] = new DiffChangeBlock(range.FirstRow, r);
            else
                map[h] = new DiffChangeBlock(r, r);
        }
        return map;
    }

    /// <summary>
    /// 为 [firstRow, lastRowInclusive] 内的配对行计算字级差异（已缓存的跳过）。
    /// 只应在绘制前对可视区 + overscan 调用，避免全量开销。
    /// </summary>
    public void EnsureWordDiff(int firstRow, int lastRowInclusive)
    {
        foreach (var pair in _wordPairs)
        {
            if (pair.Owner.Index < firstRow || pair.Owner.Index > lastRowInclusive) continue;
            if (pair.OldCell.Words is not null) continue;
            if (pair.OldCell.Text.Length + pair.NewCell.Text.Length > WordDiffMaxChars) continue;

            var segments = _wordDiff.ComputeWordDiff(pair.OldCell.Text, pair.NewCell.Text);
            pair.OldCell.Words = segments;
            pair.NewCell.Words = segments;
        }
    }

    /// <summary>
    /// 为 [firstRow, lastRowInclusive] 内的内容格计算语法片段（code-highlight-framework.md §五）。
    /// 已解析的格跳过；无高亮器（null）时只标记已解析。只对可视区 + overscan 调用。
    /// </summary>
    public void EnsureSyntaxTokens(int firstRow, int lastRowInclusive, ISyntaxHighlighter? highlighter)
    {
        if (highlighter is null or NullHighlighter) return;

        if (highlighter.RequiresSequentialState)
        {
            // P4a：跨行块状态须按文件行序传递——左列（旧文件）与右列（新文件）各一遍全量顺序分词，
            // 结果缓存在格上，后续调用零开销
            var leftState = LineState.None;
            foreach (var row in Rows)
            {
                leftState = TokenizeInto(row.Left, highlighter, leftState);
            }

            var rightState = LineState.None;
            foreach (var row in Rows)
            {
                rightState = TokenizeInto(row.Right, highlighter, rightState);
            }

            return;
        }

        foreach (var row in Rows)
        {
            if (row.Index < firstRow || row.Index > lastRowInclusive) continue;
            TokenizeInto(row.Left, highlighter, LineState.None);
            TokenizeInto(row.Right, highlighter, LineState.None);
        }
    }

    private static LineState TokenizeInto(DiffCell? cell, ISyntaxHighlighter highlighter, LineState state)
    {
        if (cell is null || cell.SyntaxTokensResolved) return state;
        cell.SyntaxTokensResolved = true;
        if (cell.Kind is DiffRowKind.Filler or DiffRowKind.HunkHeader or DiffRowKind.NoNewlineMarker || cell.Text.Length == 0)
        {
            return state;
        }

        try
        {
            var r = highlighter.TokenizeLine(cell.Text, state);
            cell.SyntaxTokens = r.Spans;
            return r.NextState ?? state;
        }
        catch
        {
            cell.SyntaxTokens = Array.Empty<SyntaxSpan>(); // 高亮器故障 → 整行降级 plain
            return state;
        }
    }

    /// <summary>把 tab 展开到下一个 <paramref name="tabWidth"/> 列对齐（渲染层只画等宽网格，不处理 tab）。</summary>
    public static string ExpandTabs(string text, int tabWidth = 8)
    {
        if (!text.Contains('\t')) return text;

        var sb = new System.Text.StringBuilder(text.Length + 8);
        foreach (var c in text)
        {
            if (c == '\t')
            {
                var spaces = tabWidth - sb.Length % tabWidth;
                sb.Append(' ', spaces);
            }
            else
            {
                sb.Append(c);
            }
        }

        return sb.ToString();
    }

    private void Build(IReadOnlyList<DiffHunk> hunks, bool oldEof, bool newEof)
    {
        var rows = new List<DiffRow>();
        int index = 0;
        int maxCols = 0, maxOld = 0, maxNew = 0;
        bool hasOldSide = false, hasNewSide = false;

        DiffCell Cell(DiffRowKind kind, string text, int oldNo = 0, int newNo = 0)
        {
            // 列宽只统计内容行——hunk 头/标记不参与水平滚动，不计入
            if (kind is DiffRowKind.Context or DiffRowKind.Added or DiffRowKind.Deleted && text.Length > maxCols)
                maxCols = text.Length;
            if (oldNo > maxOld) maxOld = oldNo;
            if (newNo > maxNew) maxNew = newNo;
            return new DiffCell(kind, text, oldNo, newNo);
        }

        int hunkIdx = -1;

        void AddRow(DiffCell? left, DiffCell? right)
        {
            rows.Add(new DiffRow(left, right, index++, hunkIdx));
        }

        for (int h = 0; h < hunks.Count; h++)
        {
            hunkIdx = h;
            var hunk = hunks[h];
            AddRow(Cell(DiffRowKind.HunkHeader,
                $"@@ -{hunk.OldStart},{hunk.OldCount} +{hunk.NewStart},{hunk.NewCount} @@"), null);

            int i = 0, j = 0;
            int oldNo = hunk.OldStart, newNo = hunk.NewStart;

            while (i < hunk.OldLines.Count || j < hunk.NewLines.Count)
            {
                var o = i < hunk.OldLines.Count ? hunk.OldLines[i] : null;
                var n = j < hunk.NewLines.Count ? hunk.NewLines[j] : null;
                var oCtx = o is not null && o.StartsWith(' ');
                var nCtx = n is not null && n.StartsWith(' ');

                if (oCtx && nCtx)
                {
                    var text = ExpandTabs(o![1..]);
                    hasOldSide = true;
                    hasNewSide = true;
                    if (SideBySide)
                        AddRow(Cell(DiffRowKind.Context, text, oldNo), Cell(DiffRowKind.Context, text, 0, newNo));
                    else
                        AddRow(Cell(DiffRowKind.Context, text, oldNo, newNo), null);
                    oldNo++;
                    newNo++;
                    i++;
                    j++;
                    continue;
                }

                // 收集连续的 - 段与 + 段（unified 顺序下两段总是相邻）
                int dStart = i;
                while (i < hunk.OldLines.Count && hunk.OldLines[i].StartsWith('-')) i++;
                int aStart = j;
                while (j < hunk.NewLines.Count && hunk.NewLines[j].StartsWith('+')) j++;
                int delCount = i - dStart, addCount = j - aStart;

                if (delCount == 0 && addCount == 0)
                {
                    // 防御：既非上下文也非 +/- 的畸形行。消费一行保证不死循环。
                    if (o is not null) i++;
                    if (n is not null) j++;
                    continue;
                }

                hasOldSide |= delCount > 0;
                hasNewSide |= addCount > 0;

                // 1:1 配对（VSCode 同款）：段长不齐时余量行退化为纯增/删（无行内高亮）
                int pairCount = Math.Min(delCount, addCount);
                for (int k = 0; k < pairCount; k++)
                {
                    var oldText = ExpandTabs(hunk.OldLines[dStart + k][1..]);
                    var newText = ExpandTabs(hunk.NewLines[aStart + k][1..]);
                    var left = Cell(DiffRowKind.Deleted, oldText, oldNo + k);
                    var right = Cell(DiffRowKind.Added, newText, 0, newNo + k);

                    if (SideBySide)
                    {
                        AddRow(left, right);
                        _wordPairs.Add(new WordPair(rows[^1], left, right));
                    }
                    else
                    {
                        AddRow(left, null);
                        AddRow(right, null);
                        _wordPairs.Add(new WordPair(rows[^2], left, right));
                    }
                }

                for (int k = pairCount; k < delCount; k++)
                {
                    var text = ExpandTabs(hunk.OldLines[dStart + k][1..]);
                    AddRow(
                        Cell(DiffRowKind.Deleted, text, oldNo + k),
                        SideBySide ? Cell(DiffRowKind.Filler, string.Empty) : null);
                }

                for (int k = pairCount; k < addCount; k++)
                {
                    var text = ExpandTabs(hunk.NewLines[aStart + k][1..]);
                    AddRow(
                        SideBySide ? Cell(DiffRowKind.Filler, string.Empty) : Cell(DiffRowKind.Added, text, 0, newNo + k),
                        SideBySide ? Cell(DiffRowKind.Added, text, 0, newNo + k) : null);
                }

                oldNo += delCount;
                newNo += addCount;
            }
        }

        if (hunks.Count > 0)
        {
            const string marker = "\\ No newline at end of file";
            if (!oldEof && hasOldSide)
                AddRow(Cell(DiffRowKind.NoNewlineMarker, marker), SideBySide ? Cell(DiffRowKind.Filler, string.Empty) : null);
            if (!newEof && hasNewSide)
                AddRow(SideBySide ? Cell(DiffRowKind.Filler, string.Empty) : Cell(DiffRowKind.NoNewlineMarker, marker),
                    SideBySide ? Cell(DiffRowKind.NoNewlineMarker, marker) : null);
        }

        Rows = rows;
        MaxTextColumns = maxCols;
        MaxOldNumber = maxOld;
        MaxNewNumber = maxNew;
        BuildChangeBlocks(rows);
    }

    private void BuildChangeBlocks(List<DiffRow> rows)
    {
        var blocks = new List<DiffChangeBlock>();
        int start = -1;

        for (int r = 0; r < rows.Count; r++)
        {
            var change = rows[r].Left?.IsChange == true || rows[r].Right?.IsChange == true;
            if (change && start < 0)
            {
                start = r;
            }
            else if (!change && start >= 0)
            {
                blocks.Add(new DiffChangeBlock(start, r - 1));
                start = -1;
            }
        }

        if (start >= 0)
            blocks.Add(new DiffChangeBlock(start, rows.Count - 1));

        ChangeBlocks = blocks;
    }

    private sealed record WordPair(DiffRow Owner, DiffCell OldCell, DiffCell NewCell);
}
