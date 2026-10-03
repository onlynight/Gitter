using Xunit;
using GitUI.Core.Models;
using GitUI.Diff.Render;

namespace GitUI.Render.Tests;

/// <summary>
/// 像素级断言（design.md §8-S3「截图对比」）：把 FillRectCommand 光栅化到像素缓冲，
/// 对"第 N 行是什么颜色块"逐像素验证。不依赖图形栈，结果完全确定。
/// </summary>
public class PixelRenderTests
{
    private static readonly DiffPalette P = DiffPalette.Dark;
    private static readonly DiffMetrics M = DiffMetrics.Default;

    private static PixelBuffer Render(DiffRenderModel model, bool sbs = true, int w = 800, int h = 100, DiffViewport? viewport = null)
    {
        var vp = viewport ?? new DiffViewport(w, h, 0);
        var frame = DiffLayoutEngine.Layout(model, sbs, M, vp);
        return PixelBuffer.Render(frame.Commands, w, h, P);
    }

    private static DiffRenderModel AddModel() => new(
        TestHunks.List(TestHunks.H(0, 0, 1, 1, "+added")), sideBySide: true);

    private static DiffRenderModel DeleteModel() => new(
        TestHunks.List(TestHunks.H(1, 1, 0, 0, "-removed")), sideBySide: true);

    private static DiffRenderModel ContextModel() => new(
        TestHunks.List(TestHunks.H(1, 1, 1, 1, " same")), sideBySide: true);

    [Fact]
    public void AddedRow_RightColumnGreen_LeftColumnFiller()
    {
        var buf = Render(AddModel());

        FrameAssert.PixelIs(buf, 10, 25, P, DiffColorKind.FillerBackground);     // 行 1 左侧
        FrameAssert.PixelIs(buf, 700, 25, P, DiffColorKind.AddedBackground);     // 行 1 右侧
        FrameAssert.PixelIs(buf, 700, 5, P, DiffColorKind.HunkHeaderBackground); // 行 0 头
        Assert.Equal(default(RgbaColor), buf.Pixel(10, 45));                     // 行 1 以下无内容
    }

    [Fact]
    public void DeletedRow_LeftColumnRed_RightColumnFiller()
    {
        var buf = Render(DeleteModel());

        FrameAssert.PixelIs(buf, 10, 25, P, DiffColorKind.DeletedBackground);
        FrameAssert.PixelIs(buf, 700, 25, P, DiffColorKind.FillerBackground);
    }

    [Fact]
    public void ContextRow_BothColumnsBackground()
    {
        var buf = Render(ContextModel());

        FrameAssert.PixelIs(buf, 10, 25, P, DiffColorKind.Background);
        FrameAssert.PixelIs(buf, 700, 25, P, DiffColorKind.Background);
    }

    [Fact]
    public void WordHighlightRect_DistinguishableFromRowBackground()
    {
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 2, 1, 2, "-foo", "+bar")), sideBySide: true);
        model.EnsureWordDiff(0, model.Rows.Count - 1);
        var buf = Render(model, viewport: new DiffViewport(800, 100, 1));

        double leftGutter = Cw0() + 2 * M.GutterPadding;
        FrameAssert.PixelIs(buf, (int)leftGutter + 5, 9, P, DiffColorKind.DeletedWordBackground); // 段内（行 1 的 y=0..18）
        FrameAssert.PixelIs(buf, (int)leftGutter + 200, 9, P, DiffColorKind.DeletedBackground);   // 段外仍为行背景
    }

    [Fact]
    public void CurrentChangeBar_PaintedAtLeftEdge()
    {
        var pairModel = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 2, 1, 2, "-foo", "+bar")), sideBySide: true);
        var buf = Render(pairModel, viewport: new DiffViewport(800, 100, 0, 0, new DiffChangeBlock(1, 1)));

        FrameAssert.PixelIs(buf, 1, 23, P, DiffColorKind.CurrentChangeBar);
        FrameAssert.PixelIs(buf, 5, 23, P, DiffColorKind.DeletedBackground); // 条外是行背景
    }

    [Fact]
    public void OverscanRow_PaintedAboveViewport_ClippedAtZero()
    {
        var buf = Render(AddModel(), viewport: new DiffViewport(800, 40, FirstRow: 1));
        // 行 0（hunk 头）y=-18，只在 y=0 以上……实际被完全裁掉；行 1 从 y=0 开始
        FrameAssert.PixelIs(buf, 10, 5, P, DiffColorKind.FillerBackground);
        FrameAssert.PixelIs(buf, 10, 3, P, DiffColorKind.FillerBackground);
    }

    [Fact]
    public void RectsClippedToBuffer()
    {
        // 填充裁剪到缓冲边界：探最后一行/列不越界（PixelBuffer.Fill 内部 clamp）
        var buf = Render(AddModel(), w: 800, h: 40);
        Assert.Equal(800 * 40, buf.Pixels.Length);
        _ = buf.Pixel(799, 39);
        _ = buf.Pixel(0, 0);
    }

    [Fact]
    public void InlineMode_FullWidthBackground()
    {
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 2, 1, 2, "-old", "+new")), sideBySide: false);
        var buf = Render(model, sbs: false);

        FrameAssert.PixelIs(buf, 10, 23, P, DiffColorKind.DeletedBackground);  // 行 1 删除
        FrameAssert.PixelIs(buf, 790, 23, P, DiffColorKind.DeletedBackground); // 整行同色
        FrameAssert.PixelIs(buf, 10, 41, P, DiffColorKind.AddedBackground);    // 行 2 新增
    }

    private static double Cw0() => M.CharWidth * 1 + 2 * M.GutterPadding; // 1 位行号槽宽

    private static double ColW(double width) => (width - 2 * Cw0()) / 2;
}
