using Xunit;
using GitUI.Core.Models;
using GitUI.Diff.Render;

namespace GitUI.Render.Tests;

/// <summary>测试用 hunk 构造：行内容带 unified 前缀，自动分到两侧。</summary>
internal static class TestHunks
{
    public static DiffHunk H(int oldStart, int oldCount, int newStart, int newCount, params string[] lines)
    {
        var oldLines = lines.Where(l => l.StartsWith(' ') || l.StartsWith('-')).ToList();
        var newLines = lines.Where(l => l.StartsWith(' ') || l.StartsWith('+')).ToList();
        return new DiffHunk(oldStart, oldCount, newStart, newCount, oldLines, newLines);
    }

    public static IReadOnlyList<DiffHunk> List(params DiffHunk[] hunks) => hunks;
}

public class ModelSideBySideTests
{
    private const bool Sbs = true;

    [Fact]
    public void ContextOnly_PairedRows_WithNumbers()
    {
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 2, 1, 2, " alpha", " beta")), sideBySide: Sbs);

        Assert.Equal(3, model.Rows.Count); // header + 2 context
        var row1 = model.Rows[1];
        Assert.Equal(DiffRowKind.Context, row1.Left!.Kind);
        Assert.Equal(DiffRowKind.Context, row1.Right!.Kind);
        Assert.Equal("alpha", row1.Left.Text);
        Assert.Equal("alpha", row1.Right.Text);
        Assert.Equal(1, row1.Left.OldNumber);
        Assert.Equal(1, row1.Right.NewNumber);
        Assert.Equal(2, model.Rows[2].Left!.OldNumber);
        Assert.Equal(2, model.Rows[2].Right!.NewNumber);
    }

    [Fact]
    public void PureAdd_LeftSideIsFiller()
    {
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(0, 0, 1, 2, "+first", "+second")), sideBySide: Sbs);

        var row1 = model.Rows[1];
        Assert.Equal(DiffRowKind.Filler, row1.Left!.Kind);
        Assert.Equal(string.Empty, row1.Left.Text);
        Assert.Equal(DiffRowKind.Added, row1.Right!.Kind);
        Assert.Equal("first", row1.Right.Text);
        Assert.Equal(1, row1.Right.NewNumber);
        Assert.Equal(0, row1.Right.OldNumber);
    }

    [Fact]
    public void PureDelete_RightSideIsFiller()
    {
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 2, 0, 0, "-gone1", "-gone2")), sideBySide: Sbs);

        var row1 = model.Rows[1];
        Assert.Equal(DiffRowKind.Deleted, row1.Left!.Kind);
        Assert.Equal("gone1", row1.Left.Text);
        Assert.Equal(1, row1.Left.OldNumber);
        Assert.Equal(DiffRowKind.Filler, row1.Right!.Kind);
    }

    [Fact]
    public void ModifiedPair_OneRow_SharedWordPair()
    {
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 3, 1, 3, " a", "-foo", "+bar", " b")), sideBySide: Sbs);

        Assert.Equal(4, model.Rows.Count); // header + ctx + pair + ctx
        var pairRow = model.Rows[2];
        Assert.Equal(DiffRowKind.Deleted, pairRow.Left!.Kind);
        Assert.Equal(DiffRowKind.Added, pairRow.Right!.Kind);
        Assert.Equal("foo", pairRow.Left.Text);
        Assert.Equal("bar", pairRow.Right.Text);
        Assert.Equal(2, pairRow.Left.OldNumber);
        Assert.Equal(2, pairRow.Right.NewNumber);

        model.EnsureWordDiff(0, model.Rows.Count - 1);
        Assert.NotNull(pairRow.Left.Words);
        Assert.NotNull(pairRow.Right.Words);
    }

    [Fact]
    public void UnequalRuns_PairOneToOne_LeftoverFiller()
    {
        // 3 删对 1 增：首行配对，其余删除行右侧补 filler
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 4, 1, 2, "-a1", "-a2", "-a3", "+b1", " ctx")), sideBySide: Sbs);

        Assert.Equal(5, model.Rows.Count); // header + pair + 2 leftover + ctx
        var pair = model.Rows[1];
        Assert.Equal("a1", pair.Left!.Text);
        Assert.Equal("b1", pair.Right!.Text);
        Assert.Equal(DiffRowKind.Deleted, model.Rows[2].Left!.Kind);
        Assert.Equal(DiffRowKind.Filler, model.Rows[2].Right!.Kind);
        Assert.Equal(DiffRowKind.Deleted, model.Rows[3].Left!.Kind);
        Assert.Equal(DiffRowKind.Filler, model.Rows[3].Right!.Kind);
        Assert.Equal(3, model.Rows[3].Left!.OldNumber); // a2、a3 行号连续
        // 左余量行不参与字级配对
        model.EnsureWordDiff(0, model.Rows.Count - 1);
        Assert.Null(model.Rows[2].Left!.Words);

        // 反向：1 删对 3 增
        var reverse = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 2, 1, 4, "-a1", "+b1", "+b2", "+b3", " ctx")), sideBySide: Sbs);
        Assert.Equal(DiffRowKind.Filler, reverse.Rows[2].Left!.Kind);
        Assert.Equal("b2", reverse.Rows[2].Right!.Text);
        Assert.Equal(2, reverse.Rows[2].Right!.NewNumber);
        Assert.Equal("b3", reverse.Rows[3].Right!.Text);
        Assert.Equal(3, reverse.Rows[3].Right!.NewNumber);
    }

    [Fact]
    public void HunkHeaders_EmittedPerHunk_WithGitHeader()
    {
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 3, 1, 3, " a", "-foo", "+bar", " b"),
            TestHunks.H(10, 1, 10, 2, " m", "+n")), sideBySide: Sbs);

        Assert.Equal("@@ -1,3 +1,3 @@", model.Rows[0].Left!.Text);
        Assert.True(model.Rows[0].IsHunkHeader);
        Assert.Equal("@@ -10,1 +10,2 @@", model.Rows[4].Left!.Text);
        Assert.Equal("n", model.Rows[6].Right!.Text);
    }

    [Fact]
    public void LineNumbers_JumpAcrossHunks()
    {
        // 两个 hunk 之间省略 6 行相同上下文
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 3, 1, 3, " l1", "-l2", "+l2x", " l3"),
            TestHunks.H(10, 2, 10, 2, " m1", " m2")), sideBySide: Sbs);

        Assert.Equal(1, model.Rows[1].Left!.OldNumber);
        Assert.Equal(3, model.Rows[3].Left!.OldNumber);
        Assert.Equal(10, model.Rows[5].Left!.OldNumber);
        Assert.Equal(11, model.Rows[6].Left!.OldNumber);
        Assert.Equal(10, model.Rows[5].Right!.NewNumber);
        Assert.Equal(11, model.Rows[6].Right!.NewNumber);
        Assert.Equal(11, model.MaxOldNumber);
        Assert.Equal(11, model.MaxNewNumber);
    }

    [Fact]
    public void NoNewlineMarker_OldSide()
    {
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 2, 1, 2, "-old", "+new", " c")),
            oldEndsWithNewline: false, newEndsWithNewline: true, sideBySide: Sbs);

        var marker = model.Rows[^1];
        Assert.Equal(DiffRowKind.NoNewlineMarker, marker.Left!.Kind);
        Assert.Equal("\\ No newline at end of file", marker.Left.Text);
        Assert.Equal(DiffRowKind.Filler, marker.Right!.Kind);
    }

    [Fact]
    public void NoNewlineMarker_BothSides_TwoRows()
    {
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 2, 1, 2, "-old", "+new")),
            oldEndsWithNewline: false, newEndsWithNewline: false, sideBySide: Sbs);

        Assert.Equal(DiffRowKind.NoNewlineMarker, model.Rows[^2].Left!.Kind);
        Assert.Equal(DiffRowKind.NoNewlineMarker, model.Rows[^1].Right!.Kind);
        Assert.Equal(DiffRowKind.Filler, model.Rows[^1].Left!.Kind);
    }

    [Fact]
    public void EofNewline_NoMarker()
    {
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 2, 1, 2, "-old", "+new")),
            oldEndsWithNewline: true, newEndsWithNewline: true, sideBySide: Sbs);

        Assert.All(model.Rows, r =>
        {
            Assert.NotEqual(DiffRowKind.NoNewlineMarker, r.Left?.Kind);
            Assert.NotEqual(DiffRowKind.NoNewlineMarker, r.Right?.Kind);
        });
    }

    [Fact]
    public void EmptyInput_ZeroRows_NoMarkerEvenIfEofFalse()
    {
        var model = new DiffRenderModel(Array.Empty<DiffHunk>(),
            oldEndsWithNewline: false, newEndsWithNewline: false, sideBySide: Sbs);

        Assert.Empty(model.Rows);
        Assert.Empty(model.ChangeBlocks);
        Assert.Equal(0, model.MaxTextColumns);
    }

    [Fact]
    public void TabExpansion_ToNextEightColumnStop()
    {
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 1, 1, 1, "-\tabc", "+\t\tabc")), sideBySide: Sbs);

        Assert.Equal(new string(' ', 8) + "abc", model.Rows[1].Left!.Text);
        Assert.Equal(new string(' ', 16) + "abc", model.Rows[1].Right!.Text);
        Assert.Equal(19, model.MaxTextColumns);
    }

    [Fact]
    public void MaxTextColumns_TracksLongestContent()
    {
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 3, 1, 3, " short", "-longer line here", "+bar", " x")), sideBySide: Sbs);

        Assert.Equal("longer line here".Length, model.MaxTextColumns);
    }

    [Fact]
    public void ChangeBlocks_PairAndLeftover_AreOneBlock()
    {
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 5, 1, 2, "-a1", "-a2", "-a3", "+b1", " ctx")), sideBySide: Sbs);

        var blocks = model.ChangeBlocks;
        Assert.Single(blocks);
        Assert.Equal(1, blocks[0].FirstRow);
        Assert.Equal(3, blocks[0].LastRow); // pair 行 + 2 余量行
    }

    [Fact]
    public void ChangeBlocks_SeparatedByContext()
    {
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 6, 1, 6, "-d1", "+a1", " c", " c", "-d2", "+a2", " c")), sideBySide: Sbs);

        Assert.Equal(2, model.ChangeBlocks.Count);
        Assert.Equal((1, 1), (model.ChangeBlocks[0].FirstRow, model.ChangeBlocks[0].LastRow));
        Assert.Equal((4, 4), (model.ChangeBlocks[1].FirstRow, model.ChangeBlocks[1].LastRow));
    }

    [Fact]
    public void ChangeBlocks_None_WhenContextOnly()
    {
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 2, 1, 2, " a", " b")), sideBySide: Sbs);

        Assert.Empty(model.ChangeBlocks);
    }
}

public class ModelInlineTests
{
    private const bool Inline = false;

    [Fact]
    public void Order_ContextDeleteAddContext()
    {
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 4, 1, 4, " a", "-foo", "+bar", " b")), sideBySide: Inline);

        Assert.Equal(5, model.Rows.Count);
        Assert.All(model.Rows, r => Assert.Null(r.Right));
        Assert.Equal(DiffRowKind.Context, model.Rows[1].Left!.Kind);
        Assert.Equal(DiffRowKind.Deleted, model.Rows[2].Left!.Kind);
        Assert.Equal(DiffRowKind.Added, model.Rows[3].Left!.Kind);
        Assert.Equal(DiffRowKind.Context, model.Rows[4].Left!.Kind);
    }

    [Fact]
    public void LineNumbers_OldAndNewColumns()
    {
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(3, 4, 2, 4, " a", "-foo", "+bar", " b")), sideBySide: Inline);

        Assert.Equal((3, 2), (model.Rows[1].Left!.OldNumber, model.Rows[1].Left!.NewNumber));
        Assert.Equal((4, 0), (model.Rows[2].Left!.OldNumber, model.Rows[2].Left!.NewNumber));
        Assert.Equal((0, 3), (model.Rows[3].Left!.OldNumber, model.Rows[3].Left!.NewNumber));
    }

    [Fact]
    public void PureAdd_NoFillerRows()
    {
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(0, 0, 1, 2, "+x", "+y")), sideBySide: Inline);

        Assert.Equal(3, model.Rows.Count);
        Assert.Equal(DiffRowKind.Added, model.Rows[1].Left!.Kind);
        Assert.Equal("x", model.Rows[1].Left!.Text);
    }

    [Fact]
    public void WordPair_OwnerIsDeletedRow()
    {
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 3, 1, 3, " a", "-foo", "+bar", " b")), sideBySide: Inline);

        model.EnsureWordDiff(0, model.Rows.Count - 1);
        Assert.NotNull(model.Rows[2].Left!.Words);
        Assert.NotNull(model.Rows[3].Left!.Words);
        Assert.Same(model.Rows[2].Left!.Words, model.Rows[3].Left!.Words);
    }

    [Fact]
    public void NoNewlineMarker_Inline_SingleSideRows()
    {
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 2, 1, 2, "-old", "+new")),
            oldEndsWithNewline: false, newEndsWithNewline: false, sideBySide: Inline);

        Assert.Equal(DiffRowKind.NoNewlineMarker, model.Rows[^2].Left!.Kind);
        Assert.Equal(DiffRowKind.NoNewlineMarker, model.Rows[^1].Left!.Kind);
        Assert.All(model.Rows, r => Assert.Null(r.Right));
    }

    [Fact]
    public void CJKContent_PreservedAsText()
    {
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 2, 1, 2, "-你好", "+你号，世界")), sideBySide: Inline);

        Assert.Equal("你好", model.Rows[1].Left!.Text);
        Assert.Equal("你号，世界", model.Rows[2].Left!.Text);
        Assert.Equal(5, model.MaxTextColumns); // 等宽网格按字符数计（CJK 宽度由字体兜住）
    }
}
