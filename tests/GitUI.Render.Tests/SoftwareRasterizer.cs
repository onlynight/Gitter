using GitUI.Diff.Render;

namespace GitUI.Render.Tests;

/// <summary>
/// 软件光栅化（Headless 测试专用）：把布局产出的 FillRectCommand 填充到像素缓冲。
/// 每像素断言 = design.md §8-S3「截图对比 + 几何断言」中的像素层验证——
/// 不依赖任何图形栈、字体与 GPU，颜色块断言完全确定。
/// TextCommand 不参与光栅化（字形依赖字体；文本几何由 LayoutGeometryTests 按命令断言）。
/// </summary>
public sealed class PixelBuffer
{
    public PixelBuffer(int width, int height)
    {
        Width = width;
        Height = height;
        Pixels = new RgbaColor[width * height];
    }

    public int Width { get; }
    public int Height { get; }
    public RgbaColor[] Pixels { get; }

    /// <summary>把 FillRectCommand 光栅化到缓冲（矩形裁剪到缓冲边界；后画的覆盖先画的）。</summary>
    public static PixelBuffer Render(IEnumerable<DiffDrawCommand> commands, int width, int height, DiffPalette palette)
    {
        var buf = new PixelBuffer(width, height);
        foreach (var cmd in commands)
        {
            if (cmd is not FillRectCommand f) continue;
            buf.Fill(f.X, f.Y, f.Width, f.Height, palette[f.Color]);
        }

        return buf;
    }

    public void Fill(double x, double y, double w, double h, RgbaColor color)
    {
        int x0 = Math.Max(0, (int)Math.Ceiling(x));
        int y0 = Math.Max(0, (int)Math.Ceiling(y));
        int x1 = Math.Min(Width, (int)Math.Floor(x + w));
        int y1 = Math.Min(Height, (int)Math.Floor(y + h));
        for (int py = y0; py < y1; py++)
        {
            for (int px = x0; px < x1; px++)
            {
                Pixels[py * Width + px] = color;
            }
        }
    }

    public RgbaColor Pixel(int x, int y) => Pixels[y * Width + x];
}

/// <summary>帧级断言辅助。</summary>
public static class FrameAssert
{
    /// <summary>行顶部 y 坐标（相对视口）。</summary>
    public static double RowY(int row, int firstRow, double lineHeight) => (row - firstRow) * lineHeight;

    public static FillRectCommand? FindFill(DiffFrame frame, Func<FillRectCommand, bool> match) =>
        frame.Commands.OfType<FillRectCommand>().FirstOrDefault(match);

    public static IReadOnlyList<FillRectCommand> FindFills(DiffFrame frame, Func<FillRectCommand, bool> match) =>
        frame.Commands.OfType<FillRectCommand>().Where(match).ToList();

    public static IReadOnlyList<TextCommand> Texts(DiffFrame frame) =>
        frame.Commands.OfType<TextCommand>().ToList();

    /// <summary>在 (x, y) 处断言像素为 palette 的某语义色。</summary>
    public static void PixelIs(PixelBuffer buf, int x, int y, DiffPalette palette, DiffColorKind kind)
    {
        var expected = palette[kind];
        var actual = buf.Pixel(x, y);
        if (actual != expected)
            throw new Xunit.Sdk.XunitException(
                $"Pixel({x},{y}) expected {kind} #{expected.R:X2}{expected.G:X2}{expected.B:X2}, got #{actual.R:X2}{actual.G:X2}{actual.B:X2}");
    }
}
