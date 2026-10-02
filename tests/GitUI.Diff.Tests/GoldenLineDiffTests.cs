using GitUI.Core.Models;
using GitUI.Diff;
using Xunit;
using Engine = GitUI.Diff.MyersDiffEngine;

namespace GitUI.Diff.Tests;

/// <summary>
/// S2 黄金用例集（docs/design.md §8 S2）：行级 diff 的行为基线。
/// 每个用例同时断言：
///   1. hunk 结构（块数、块头、行内容前缀标记）；
///   2. 应用 hunk 到旧文本必须精确还原新文本（HunkAssert.AppliesCleanly）。
/// 行语义：DiffText（无幻影尾行、\r 属于行内容、EOF 换行差异单独携带）。
/// </summary>
public sealed class GoldenLineDiffTests
{
    private static Engine Create() => Engine.Instance;

    private static string J(params string[] lines) => string.Join("\n", lines) + "\n";

    // ---------- 纯新增 ----------

    [Fact]
    public void Golden01_PureAddition_AtEnd()
    {
        var hunks = Create().ComputeHunks(J("a", "b", "c"), J("a", "b", "c", "d", "e"));
        var h = Assert.Single(hunks);
        Assert.Equal((1, 3, 1, 5), (h.OldStart, h.OldCount, h.NewStart, h.NewCount));
        Assert.Equal(new[] { " a", " b", " c" }, h.OldLines);
        Assert.Equal(new[] { " a", " b", " c", "+d", "+e" }, h.NewLines);
        Assert.Equal(2, h.AddedCount);
        Assert.Equal(0, h.DeletedCount);
        HunkAssert.AppliesCleanly(J("a", "b", "c"), J("a", "b", "c", "d", "e"), hunks);
    }

    [Fact]
    public void Golden02_PureAddition_AtStart()
    {
        var hunks = Create().ComputeHunks(J("b", "c"), J("a", "b", "c"));
        var h = Assert.Single(hunks);
        Assert.Equal((1, 2, 1, 3), (h.OldStart, h.OldCount, h.NewStart, h.NewCount));
        Assert.Equal(new[] { " b", " c" }, h.OldLines);
        Assert.Equal(new[] { "+a", " b", " c" }, h.NewLines);
        HunkAssert.AppliesCleanly(J("b", "c"), J("a", "b", "c"), hunks);
    }

    [Fact]
    public void Golden03_PureAddition_InMiddle()
    {
        var old = J("a", "b", "c", "d", "e");
        var newT = J("a", "b", "X", "Y", "c", "d", "e");
        var hunks = Create().ComputeHunks(old, newT);
        var h = Assert.Single(hunks);
        Assert.Equal((1, 5, 1, 7), (h.OldStart, h.OldCount, h.NewStart, h.NewCount));
        Assert.Equal(2, h.AddedCount);
        Assert.Equal(0, h.DeletedCount);
        HunkAssert.AppliesCleanly(old, newT, hunks);
    }

    // ---------- 纯删除 ----------

    [Fact]
    public void Golden04_PureDeletion_AtEnd()
    {
        var old = J("a", "b", "c", "d", "e");
        var hunks = Create().ComputeHunks(old, J("a", "b", "c"));
        var h = Assert.Single(hunks);
        Assert.Equal((1, 5, 1, 3), (h.OldStart, h.OldCount, h.NewStart, h.NewCount));
        Assert.Equal(new[] { " a", " b", " c", "-d", "-e" }, h.OldLines);
        Assert.Equal(new[] { " a", " b", " c" }, h.NewLines);
        HunkAssert.AppliesCleanly(old, J("a", "b", "c"), hunks);
    }

    [Fact]
    public void Golden05_PureDeletion_AtStart()
    {
        var hunks = Create().ComputeHunks(J("a", "b", "c"), J("b", "c"));
        var h = Assert.Single(hunks);
        Assert.Equal((1, 3, 1, 2), (h.OldStart, h.OldCount, h.NewStart, h.NewCount));
        Assert.Equal(new[] { "-a", " b", " c" }, h.OldLines);
        Assert.Equal(new[] { " b", " c" }, h.NewLines);
        HunkAssert.AppliesCleanly(J("a", "b", "c"), J("b", "c"), hunks);
    }

    [Fact]
    public void Golden06_PureDeletion_InMiddle()
    {
        var old = J("a", "b", "c", "d", "e");
        var hunks = Create().ComputeHunks(old, J("a", "b", "d", "e"));
        var h = Assert.Single(hunks);
        Assert.Equal((1, 5, 1, 4), (h.OldStart, h.OldCount, h.NewStart, h.NewCount));
        Assert.Equal(new[] { " a", " b", "-c", " d", " e" }, h.OldLines);
        HunkAssert.AppliesCleanly(old, J("a", "b", "d", "e"), hunks);
    }

    // ---------- 修改与多块 ----------

    [Fact]
    public void Golden07_SingleLineModification_FullContextWhenShort()
    {
        var old = J("one", "two", "three", "four", "five");
        var newT = J("one", "TWO", "three", "four", "five");
        var hunks = Create().ComputeHunks(old, newT);
        var h = Assert.Single(hunks);
        // 5 行文件改中间一行，context=3 覆盖全文件
        Assert.Equal((1, 5, 1, 5), (h.OldStart, h.OldCount, h.NewStart, h.NewCount));
        Assert.Contains("-two", h.OldLines);
        Assert.Contains("+TWO", h.NewLines);
        HunkAssert.AppliesCleanly(old, newT, hunks);
    }

    [Fact]
    public void Golden08_TwoFarChanges_ProduceTwoHunks()
    {
        var lines = Enumerable.Range(1, 12).Select(i => $"l{i}").ToArray();
        var old = J(lines);
        var changed = (string[])lines.Clone();
        changed[0] = "L1";
        changed[11] = "L12";
        var newT = J(changed);

        var hunks = Create().ComputeHunks(old, newT);
        Assert.Equal(2, hunks.Count);

        var h1 = hunks[0];
        Assert.Equal((1, 4, 1, 4), (h1.OldStart, h1.OldCount, h1.NewStart, h1.NewCount));
        Assert.Equal(new[] { "-l1", " l2", " l3", " l4" }, h1.OldLines);

        var h2 = hunks[1];
        Assert.Equal((9, 4, 9, 4), (h2.OldStart, h2.OldCount, h2.NewStart, h2.NewCount));
        Assert.Equal(new[] { " l9", " l10", " l11", "-l12" }, h2.OldLines);
        HunkAssert.AppliesCleanly(old, newT, hunks);
    }

    [Fact]
    public void Golden09_GapSixChanges_MergeIntoOneHunk()
    {
        // 相距 6 行相同内容（≤ 2×context）→ 合并
        var lines = Enumerable.Range(0, 9).Select(i => $"l{i}").ToArray();
        var changed = (string[])lines.Clone();
        changed[0] = "L0";
        changed[7] = "L7";
        var hunks = Create().ComputeHunks(J(lines), J(changed));
        var h = Assert.Single(hunks);
        Assert.Equal((1, 9, 1, 9), (h.OldStart, h.OldCount, h.NewStart, h.NewCount));
        HunkAssert.AppliesCleanly(J(lines), J(changed), hunks);
    }

    [Fact]
    public void Golden10_GapSevenChanges_SplitIntoTwoHunks()
    {
        // 相距 7 行相同内容（> 2×context）→ 两个 hunk
        var lines = Enumerable.Range(0, 9).Select(i => $"l{i}").ToArray();
        var changed = (string[])lines.Clone();
        changed[0] = "L0";
        changed[8] = "L8";
        var hunks = Create().ComputeHunks(J(lines), J(changed));
        Assert.Equal(2, hunks.Count);
        Assert.Equal((1, 4, 1, 4), (hunks[0].OldStart, hunks[0].OldCount, hunks[0].NewStart, hunks[0].NewCount));
        Assert.Equal((6, 4, 6, 4), (hunks[1].OldStart, hunks[1].OldCount, hunks[1].NewStart, hunks[1].NewCount));
        HunkAssert.AppliesCleanly(J(lines), J(changed), hunks);
    }

    [Fact]
    public void Golden11_CrossBlockMove_DeletedAndInserted()
    {
        // 块整体移动：一个 hunk 内同内容先删后加
        var old = J("a", "b", "c", "d", "e", "f", "g");
        var newT = J("c", "d", "e", "a", "b", "f", "g");
        var hunks = Create().ComputeHunks(old, newT);
        var h = Assert.Single(hunks);
        Assert.Equal(3, h.DeletedCount);
        Assert.Equal(3, h.AddedCount);
        HunkAssert.AppliesCleanly(old, newT, hunks);
    }

    [Fact]
    public void Golden12_WholeFileReplace_OneHunk()
    {
        var old = J("x1", "x2", "x3", "x4", "x5");
        var newT = J("y1", "y2", "y3", "y4", "y5");
        var hunks = Create().ComputeHunks(old, newT);
        var h = Assert.Single(hunks);
        Assert.Equal(5, h.DeletedCount);
        Assert.Equal(5, h.AddedCount);
        Assert.All(h.OldLines, l => Assert.StartsWith("-", l));
        Assert.All(h.NewLines, l => Assert.StartsWith("+", l));
        HunkAssert.AppliesCleanly(old, newT, hunks);
    }

    // ---------- 空与相等 ----------

    [Fact]
    public void Golden13_EmptyToEmpty_NoHunks()
        => Assert.Empty(Create().ComputeHunks(string.Empty, string.Empty));

    [Fact]
    public void Golden14_EmptyToText_PureAdditionWithZeroOldRange()
    {
        var hunks = Create().ComputeHunks(string.Empty, J("a", "b"));
        var h = Assert.Single(hunks);
        // git 语义：全文件新增 → -0,0
        Assert.Equal((0, 0, 1, 2), (h.OldStart, h.OldCount, h.NewStart, h.NewCount));
        Assert.Empty(h.OldLines);
        Assert.Equal(new[] { "+a", "+b" }, h.NewLines);
        HunkAssert.AppliesCleanly(string.Empty, J("a", "b"), hunks);
    }

    [Fact]
    public void Golden15_TextToEmpty_PureDeletionWithZeroNewRange()
    {
        var hunks = Create().ComputeHunks(J("a", "b"), string.Empty);
        var h = Assert.Single(hunks);
        Assert.Equal((1, 2, 0, 0), (h.OldStart, h.OldCount, h.NewStart, h.NewCount));
        Assert.Equal(new[] { "-a", "-b" }, h.OldLines);
        Assert.Empty(h.NewLines);
        HunkAssert.AppliesCleanly(J("a", "b"), string.Empty, hunks);
    }

    [Fact]
    public void Golden16_IdenticalTexts_NoHunks()
        => Assert.Empty(Create().ComputeHunks(J("same", "same"), J("same", "same")));

    // ---------- 行尾与空白语义 ----------

    [Fact]
    public void Golden17_CrlfToLf_IsRealContentDifference()
    {
        // \r 属于行内容（git 同语义）：CRLF → LF 是每一行的差异
        var hunks = Create().ComputeHunks("a\r\nb\r\n", "a\nb\n");
        var h = Assert.Single(hunks);
        Assert.Equal(2, h.DeletedCount);
        Assert.Equal(2, h.AddedCount);
        Assert.Equal("-a\r", h.OldLines[0]);
        Assert.Equal("+a", h.NewLines[0]);
        HunkAssert.AppliesCleanly("a\r\nb\r\n", "a\nb\n", hunks);
    }

    [Fact]
    public void Golden18_EofNewlineOnlyDifference_IsInvisibleToHunks()
    {
        // "a\nb" 与 "a\nb\n" 行内容相同 → 无 hunk；
        // EOF 换行差异由 TextDiffPipeline 的 *EndsWithNewline 标志携带（S3 渲染标记用）
        Assert.Empty(Create().ComputeHunks("a\nb", "a\nb\n"));
        Assert.Empty(Create().ComputeHunks("a\nb\n", "a\nb"));
    }

    [Fact]
    public void Golden19_TrailingEmptyLine_Deletion()
    {
        var hunks = Create().ComputeHunks("a\n\n", "a\n");
        var h = Assert.Single(hunks);
        Assert.Equal(new[] { " a", "-" }, h.OldLines);  // "-" 即被删除的空行
        Assert.Equal(new[] { " a" }, h.NewLines);
        HunkAssert.AppliesCleanly("a\n\n", "a\n", hunks);
    }

    // ---------- 上下文选项 ----------

    [Fact]
    public void Golden20_ContextZero_GitU0HeaderConvention()
    {
        var hunks = Create().ComputeHunks(J("a", "b"), J("a", "X", "b"), new DiffOptions { ContextLines = 0 });
        var h = Assert.Single(hunks);
        // git -U0：第 1 行后插入 → -1,0 +2,1
        Assert.Equal((1, 0, 2, 1), (h.OldStart, h.OldCount, h.NewStart, h.NewCount));
        Assert.Empty(h.OldLines);
        Assert.Equal(new[] { "+X" }, h.NewLines);
        HunkAssert.AppliesCleanly(J("a", "b"), J("a", "X", "b"), hunks);
    }

    [Fact]
    public void Golden21_ContextOne_ShrinkedWindow()
    {
        var lines = new[] { "l1", "l2", "l3", "l4", "l5" };
        var changed = new[] { "l1", "l2", "L3", "l4", "l5" };
        var hunks = Create().ComputeHunks(J(lines), J(changed), new DiffOptions { ContextLines = 1 });
        var h = Assert.Single(hunks);
        Assert.Equal((2, 3, 2, 3), (h.OldStart, h.OldCount, h.NewStart, h.NewCount));
        Assert.Equal(new[] { " l2", "-l3", " l4" }, h.OldLines);
        Assert.Equal(new[] { " l2", "+L3", " l4" }, h.NewLines);
        HunkAssert.AppliesCleanly(J(lines), J(changed), hunks);
    }

    [Fact]
    public void Golden22_ContextLargerThanFile_ClampedToWholeFile()
    {
        var old = J("a", "b", "c");
        var newT = J("a", "B", "c");
        var hunks = Create().ComputeHunks(old, newT, new DiffOptions { ContextLines = 100 });
        var h = Assert.Single(hunks);
        Assert.Equal((1, 3, 1, 3), (h.OldStart, h.OldCount, h.NewStart, h.NewCount));
        HunkAssert.AppliesCleanly(old, newT, hunks);
    }

    [Fact]
    public void Golden23_ContextLinesClampedTo64()
    {
        var normalized = new DiffOptions { ContextLines = 500 }.Normalized();
        Assert.Equal(64, normalized.ContextLines);
        var normalizedLow = new DiffOptions { ContextLines = -3 }.Normalized();
        Assert.Equal(0, normalizedLow.ContextLines);
    }

    // ---------- 规模与重复行 ----------

    [Fact]
    public void Golden24_ManyChanges_EveryTenthLine_TenHunks()
    {
        var lines = Enumerable.Range(0, 100).Select(i => $"line {i}").ToArray();
        var changed = (string[])lines.Clone();
        for (int i = 0; i < 100; i += 10) changed[i] = $"CHANGED {i}";
        var hunks = Create().ComputeHunks(J(lines), J(changed));
        Assert.Equal(10, hunks.Count);
        HunkAssert.AppliesCleanly(J(lines), J(changed), hunks);
    }

    [Fact]
    public void Golden25_RepeatedLines_Append()
    {
        // 全文件同一行内容重复：无唯一锚点，走纯 Myers
        var old = string.Concat(Enumerable.Repeat("x\n", 5));
        var newT = string.Concat(Enumerable.Repeat("x\n", 8));
        var hunks = Create().ComputeHunks(old, newT);
        var h = Assert.Single(hunks);
        Assert.Equal(0, h.DeletedCount);
        Assert.Equal(3, h.AddedCount);
        HunkAssert.AppliesCleanly(old, newT, hunks);
    }

    [Fact]
    public void Golden26_RepeatedLines_Rearranged_AppliesCleanly()
    {
        var old = J("p", "q", "p", "q", "p");
        var newT = J("q", "p", "q", "p", "q");
        var hunks = Create().ComputeHunks(old, newT);
        Assert.NotEmpty(hunks);
        Assert.Equal(0, HunkAssert.SumAdded(hunks) - HunkAssert.SumDeleted(hunks)); // 行数不变
        HunkAssert.AppliesCleanly(old, newT, hunks);
    }

    [Fact]
    public void Golden27_InvalidOperation_ContextDoesNotBreakApply_OnBoundaries()
    {
        // 首尾同时修改（上下文截断的两个边界情况）
        var old = J("a", "b", "c", "d", "e");
        var newT = J("A", "b", "c", "d", "E");
        var hunks = Create().ComputeHunks(old, newT);
        // 两处相距 3 行相同内容（≤ 6）→ 合并
        Assert.Single(hunks);
        HunkAssert.AppliesCleanly(old, newT, hunks);
    }

    // ---------- 内容类别 ----------

    [Fact]
    public void Golden28_UnicodeChineseContent()
    {
        var old = J("第一行", "第二行", "第三行");
        var newT = J("第一行", "改过的第二行", "第三行");
        var hunks = Create().ComputeHunks(old, newT);
        var h = Assert.Single(hunks);
        Assert.Contains("-第二行", h.OldLines);
        Assert.Contains("+改过的第二行", h.NewLines);
        HunkAssert.AppliesCleanly(old, newT, hunks);
    }

    [Fact]
    public void Golden29_EmptyLinesAsContent()
    {
        var old = J("a", "", "b");
        var newT = J("a", "", "", "b");
        var hunks = Create().ComputeHunks(old, newT);
        Assert.Equal(1, HunkAssert.SumAdded(hunks));
        Assert.Equal(0, HunkAssert.SumDeleted(hunks));
        HunkAssert.AppliesCleanly(old, newT, hunks);
    }

    [Fact]
    public void Golden30_LongSingleLine_Changed()
    {
        var big = new string('x', 100_000);
        var old = J("head", big, "tail");
        var newT = J("head", big + "!", "tail");
        var hunks = Create().ComputeHunks(old, newT);
        var h = Assert.Single(hunks);
        Assert.Equal(1, h.AddedCount);
        Assert.Equal(1, h.DeletedCount);
        HunkAssert.AppliesCleanly(old, newT, hunks);
    }

    [Fact]
    public void Golden31_NoTrailingNewline_OnBothSides()
    {
        var hunks = Create().ComputeHunks("a\nb\nc", "a\nb\nc\nd");
        var h = Assert.Single(hunks);
        Assert.Equal(1, h.AddedCount);
        Assert.Equal(0, h.DeletedCount);
        HunkAssert.AppliesCleanly("a\nb\nc", "a\nb\nc\nd", hunks);
    }

    [Fact]
    public void Golden32_TabAndSpaceOnlyChanges()
    {
        var old = J("foo()", "    return 1;", "}");
        var newT = J("foo()", "\treturn 1;", "}");
        var hunks = Create().ComputeHunks(old, newT);
        var h = Assert.Single(hunks);
        Assert.Equal("-    return 1;", h.OldLines[1]);
        Assert.Equal("+\treturn 1;", h.NewLines[1]);
        HunkAssert.AppliesCleanly(old, newT, hunks);
    }
}
