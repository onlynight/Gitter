using Xunit;
using GitUI.Core.Models;
using GitUI.Diff.Render;

namespace GitUI.Render.Tests;

/// <summary>
/// 布局几何断言（design.md §8-S3「几何断言」）：
/// 行高 18 固定栅格、行号槽固定、列均分、水平滚动只移文本、overscan 包夹。
/// 默认度量：LineHeight=18, CharWidth=7.8, GutterPadding=8。
/// </summary>
public class LayoutGeometryTests
{
    private static readonly DiffMetrics M = DiffMetrics.Default;

    // hunk: @@ -1,3 +1,3 @@ [ctx a / -foo / +bar / ctx b] → rows: 0=header, 1=ctx, 2=pair, 3=ctx
    private static DiffRenderModel PairModel(bool sbs) => new(
        TestHunks.List(TestHunks.H(1, 3, 1, 3, " a", "-foo", "+bar", " b")), sideBySide: sbs);

    private static DiffViewport View(int firstRow = 0, double w = 800, double h = 200, double horiz = 0, DiffChangeBlock? block = null) =>
        new(w, h, firstRow, horiz, block);

    private const double Lh = 18, Cw = 7.8, Pad = 8;
    private const double LeftGutter = Cw + Pad * 2;          // 23.8（1 位行号）
    private const double MidX = LeftGutter + 376.2 + LeftGutter; // 两列均分 800-47.6
    private const double ColW = 376.2;

    [Fact]
    public void RowY_FixedGrid()
    {
        var frame = DiffLayoutEngine.Layout(PairModel(true), sideBySide: true, M, View());

        var row1Bg = FrameAssert.FindFill(frame, f => f.Y == Lh && f.X == 0)!;
        Assert.Equal(MidX, row1Bg.Width, 6);
        Assert.Equal(DiffColorKind.Background, row1Bg.Color);
        Assert.Equal(2 * Lh, FrameAssert.FindFill(frame, f => f.Y == 2 * Lh && f.X == 0)!.Y, 6);
    }

    [Fact]
    public void HeaderRow_FullWidthFill_TextAtPad()
    {
        var frame = DiffLayoutEngine.Layout(PairModel(true), sideBySide: true, M, View());

        var bg = FrameAssert.FindFill(frame, f => f.Color == DiffColorKind.HunkHeaderBackground)!;
        Assert.Equal(0, bg.X);
        Assert.Equal(0, bg.Y, 6);
        Assert.Equal(800, bg.Width, 6);
        Assert.Equal(Lh, bg.Height, 6);

        var text = FrameAssert.Texts(frame).First(t => t.Text.StartsWith("@@"));
        Assert.Equal(Pad, text.X, 6);
    }

    [Fact]
    public void GutterNumbers_RightAligned_Fixed()
    {
        var frame = DiffLayoutEngine.Layout(PairModel(true), sideBySide: true, M, View());

        var oldNo = FrameAssert.Texts(frame).First(t => t.Text == "1" && t.Y == Lh);
        Assert.Equal(LeftGutter - Pad - Cw, oldNo.X, 6); // 8.0
        var newNo = FrameAssert.Texts(frame).Where(t => t.Text == "1").OrderByDescending(t => t.X).First();
        Assert.Equal(MidX - Pad - Cw, newNo.X, 6);       // 408.0
    }

    [Fact]
    public void TextStartsAtGutterEdge_BothColumns()
    {
        var frame = DiffLayoutEngine.Layout(PairModel(true), sideBySide: true, M, View());

        var left = FrameAssert.Texts(frame).First(t => t.Text == "a" && t.Y == Lh && t.X < 100);
        Assert.Equal(LeftGutter, left.X, 6);
        var right = FrameAssert.Texts(frame).First(t => t.Text == "a" && t.Y == Lh && t.X > 100);
        Assert.Equal(MidX, right.X, 6);
    }

    [Fact]
    public void HorizontalOffset_MovesTextOnly()
    {
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 2, 1, 2, " hello")), sideBySide: true);
        var frame = DiffLayoutEngine.Layout(model, sideBySide: true, M, View(horiz: 15));

        // 'h'、'e' 已滚出列首（列边界在字符格中间时按整格裁剪），可见部分从第 3 个字符起
        var text = FrameAssert.Texts(frame).First(t => t.Text == "llo" && t.Y == Lh);
        Assert.Equal(LeftGutter + 2 * Cw - 15, text.X, 6);
        var number = FrameAssert.Texts(frame).First(t => t.Text == "1" && t.Y == Lh);
        Assert.Equal(LeftGutter - Pad - Cw, number.X, 6); // 行号不随滚动
    }

    [Fact]
    public void WordSpans_MappedToColumnX()
    {
        var model = PairModel(true);
        model.EnsureWordDiff(0, model.Rows.Count - 1);
        var frame = DiffLayoutEngine.Layout(model, sideBySide: true, M, View(firstRow: 2));

        // "foo" vs "bar" 无公共词元 → 删除段从列首开始
        var delWord = FrameAssert.FindFill(frame, f => f.Color == DiffColorKind.DeletedWordBackground)!;
        Assert.Equal(LeftGutter, delWord.X, 6);
        Assert.Equal(3 * Cw, delWord.Width, 6);          // 23.4
        Assert.Equal(0, delWord.Y, 6);                   // row 2 - firstRow 2 = 0
        var addWord = FrameAssert.FindFill(frame, f => f.Color == DiffColorKind.AddedWordBackground)!;
        Assert.Equal(MidX, addWord.X, 6);
    }

    [Fact]
    public void WordSpans_XAccountsForPrecedingEqualSegments()
    {
        // "int x = 1;" vs "int x = 2;"：前面有 Equal 段占列
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 2, 1, 2, "-int x = 1;", "+int x = 2;")), sideBySide: true);
        model.EnsureWordDiff(0, model.Rows.Count - 1);

        var frame = DiffLayoutEngine.Layout(model, sideBySide: true, M, View(firstRow: 1));
        var delWord = FrameAssert.FindFill(frame, f => f.Color == DiffColorKind.DeletedWordBackground)!;

        var words = model.Rows[1].Left!.Words!;
        int col = 0;
        foreach (var s in words)
        {
            if (s.Kind == WordSegmentKind.Deleted) break;
            if (s.Kind != WordSegmentKind.Inserted) col += s.Text.Length;
        }

        Assert.Equal(LeftGutter + col * Cw, delWord.X, 6);
        Assert.Single(words, s => s.Kind == WordSegmentKind.Deleted);
    }

    [Fact]
    public void TextClippedAtColumnEdge_LongLine()
    {
        var longText = new string('x', 100);
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 2, 1, 2, " " + longText)), sideBySide: true);
        var frame = DiffLayoutEngine.Layout(model, sideBySide: true, M, View(firstRow: 1));

        var cmd = FrameAssert.Texts(frame).First(t => t.Text.Contains('x') && t.Y == 0);
        // 376.2 / 7.8 = 48.23 → 48 个整字符
        Assert.Equal(48, cmd.Text.Length);
        Assert.Equal(LeftGutter, cmd.X, 6);
    }

    [Fact]
    public void TextClippedAtColumnEdge_WithHorizontalOffset()
    {
        var longText = new string('x', 100);
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 2, 1, 2, " " + longText)), sideBySide: true);
        var frame = DiffLayoutEngine.Layout(model, sideBySide: true, M, View(firstRow: 1, horiz: 40));

        var cmd = FrameAssert.Texts(frame).First(t => t.Text.Contains('x') && t.Y == 0);
        // 首字符 ceil(40/7.8)=6；末字符 floor((376.2+40)/7.8)=53 → 47 字符，起点 colX + (6×7.8-40)
        Assert.Equal(47, cmd.Text.Length);
        Assert.Equal(LeftGutter + 6 * Cw - 40, cmd.X, 6);
    }

    [Fact]
    public void Overscan_IncludesRowsAboveViewport_AtNegativeY()
    {
        var (first, from, last) = DiffLayoutEngine.VisibleRange(4, M, View(firstRow: 2));
        Assert.Equal((2, 0, 3), (first, from, last));

        var frame = DiffLayoutEngine.Layout(PairModel(true), sideBySide: true, M, View(firstRow: 2));
        Assert.Equal(0, frame.FirstRow);
        Assert.Equal(3, frame.LastRow);
        // 上方 overscan 行以负 y 绘制
        var header = FrameAssert.FindFill(frame, f => f.Color == DiffColorKind.HunkHeaderBackground)!;
        Assert.Equal(-2 * Lh, header.Y, 6);
    }

    [Fact]
    public void FirstRow_ClampedBeyondEnds()
    {
        var frame = DiffLayoutEngine.Layout(PairModel(true), sideBySide: true, M, View(firstRow: 999));

        // 帧覆盖范围 = 含 overscan 的实际绘制区间；越界 FirstRow 被夹紧到最后一行贴底
        Assert.Equal(0, frame.FirstRow);
        Assert.Equal(3, frame.LastRow);
        var ctx = FrameAssert.FindFill(frame, f => f.Y == 0 && f.X == 0)!; // 行 3 的 y = 0
        Assert.Equal(DiffColorKind.Background, ctx.Color);
    }

    [Fact]
    public void CurrentBlock_BarPaintedOnBlockRows()
    {
        var frame = DiffLayoutEngine.Layout(PairModel(true), sideBySide: true, M, View(firstRow: 0, block: new DiffChangeBlock(2, 2)));

        var bar = FrameAssert.FindFill(frame, f => f.Color == DiffColorKind.CurrentChangeBar)!;
        Assert.Equal(0, bar.X, 6);
        Assert.Equal(2 * Lh, bar.Y, 6);
        Assert.Equal(3, bar.Width, 6);
        Assert.Equal(Lh, bar.Height, 6);
    }

    [Fact]
    public void Inline_MarkerAndTextOffset()
    {
        var frame = DiffLayoutEngine.Layout(PairModel(false), sideBySide: false, M, View());

        double textX = LeftGutter * 2; // 旧号槽 + 新号槽
        var minus = FrameAssert.Texts(frame).First(t => t.Text == "-");
        Assert.Equal(textX, minus.X, 6);
        Assert.Equal(DiffColorKind.DeletedForeground, minus.Color);
        var foo = FrameAssert.Texts(frame).First(t => t.Text == "foo");
        Assert.Equal(textX + Cw, foo.X, 6);              // 标记列占 1 格
        var plus = FrameAssert.Texts(frame).First(t => t.Text == "+");
        Assert.Equal(DiffColorKind.AddedForeground, plus.Color);
        // 上下文行没有标记列，文本直接从 textX 起
        var ctx = FrameAssert.Texts(frame).First(t => t.Text == "a");
        Assert.Equal(textX, ctx.X, 6);
    }

    [Fact]
    public void Inline_LineNumbers_TwoSlots()
    {
        var frame = DiffLayoutEngine.Layout(PairModel(false), sideBySide: false, M, View());

        var oldNo = FrameAssert.Texts(frame).First(t => t.Text == "3"); // 行 4 的旧号
        Assert.Equal(LeftGutter - Pad - Cw, oldNo.X, 6);
        var newNo = FrameAssert.Texts(frame).Where(t => t.Text == "2").OrderByDescending(t => t.X).First();
        Assert.Equal(2 * LeftGutter - Pad - Cw, newNo.X, 6);
    }

    [Fact]
    public void EmptyModel_EmptyFrame()
    {
        var model = new DiffRenderModel(Array.Empty<DiffHunk>(), sideBySide: true);
        var frame = DiffLayoutEngine.Layout(model, sideBySide: true, M, View());

        Assert.Empty(frame.Commands);
        Assert.Equal(-1, frame.LastRow);
    }
}
