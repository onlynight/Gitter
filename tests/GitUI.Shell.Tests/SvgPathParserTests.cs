using GitUI.Shell;
using Xunit;

namespace GitUI.Shell.Tests;

/// <summary>
/// SVG path 解析（设计稿侧边图标用，design-mockups 内联 SVG 的 16×16 路径）。
/// 测试数据即三条真实设计路径，钉住子路径/段数/关键坐标/闭合与黏连数字切分。
/// </summary>
public sealed class SvgPathParserTests
{
    private const string LogPath = "M2 3h12v1.5H2V3zm0 4.25h8.5v1.5H2v-1.5zM2 11.5h12V13H2v-1.5z";
    private const string ChangesPath = "M2 4.25 5 8l-3 3.75V4.25zM6 3h1.5v10H6V3zm3 0h5a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9v-1.5h4.5v-7H9V3z";
    private const string BranchPath = "M13.1 3.9a2.3 2.3 0 0 0-3.25 3.25l-.1.1a2.3 2.3 0 0 1-3.25 0L5.4 6.2a2.3 2.3 0 1 0-1.06 1.06l1.1 1.05a3.8 3.8 0 0 0 2.31 1.09v1.2a2.3 2.3 0 1 0 1.5 0V9.4a3.8 3.8 0 0 0 2.31-1.09l.1-.1a2.3 2.3 0 1 0 1.44-4.31z";

    [Fact]
    public void Log_ThreeBars_SixClosedSubPaths()
    {
        var d = SvgPathParser.Parse(LogPath);

        Assert.Equal(3, d.SubPaths.Count);
        Assert.All(d.SubPaths, sp => Assert.True(sp.IsClosed));
        // 第一条：M2 3 h12 v1.5 H2 V3 → 4 段
        var bar0 = d.SubPaths[0];
        Assert.Equal(4, bar0.Segments.Count);
        Assert.Equal((2, 3), (bar0.StartX, bar0.StartY));
        Assert.Equal((14, 4.5), (bar0.Segments[1].EndX, bar0.Segments[1].EndY));
        Assert.All(bar0.Segments, s => Assert.False(s.IsArc));
    }

    [Fact]
    public void Changes_ImplicitLineAfterMove_ArcsInDocument()
    {
        var d = SvgPathParser.Parse(ChangesPath);

        Assert.Equal(3, d.SubPaths.Count);
        // M2 4.25 5 8（M 后隐式 L）l-3 3.75 V4.25 z → 三角形 3 段
        var tri = d.SubPaths[0];
        Assert.Equal(3, tri.Segments.Count);
        Assert.Equal((5, 8), (tri.Segments[0].EndX, tri.Segments[0].EndY));
        Assert.Equal((2, 4.25), (tri.Segments[2].EndX, tri.Segments[2].EndY));
        // 文档子路径含 2 个弧
        var doc = d.SubPaths[2];
        Assert.Equal(2, doc.Segments.Count(s => s.IsArc));
        // 弧参数：a1 1 0 0 1 1 1 → rx=ry=1, rot=0, large=0, sweep=1
        var arc = doc.Segments.First(s => s.IsArc);
        Assert.Equal(1, arc.RadiusX);
        Assert.Equal(0, arc.Rotation);
        Assert.False(arc.LargeArc);
        Assert.True(arc.Sweep);
    }

    [Fact]
    public void Branch_SingleSubPath_AllArcsRelative()
    {
        var d = SvgPathParser.Parse(BranchPath);

        var sp = Assert.Single(d.SubPaths);
        Assert.True(sp.IsClosed);
        Assert.Equal((13.1, 3.9), (sp.StartX, sp.StartY));
        // 起点 + a2.3 2.3 0 0 0-3.25 3.25（黏连切分：sweep=0，终点相对 (-3.25, 3.25)）
        var first = sp.Segments[0];
        Assert.True(first.IsArc);
        Assert.Equal(2.3, first.RadiusX);
        Assert.False(first.LargeArc);
        Assert.False(first.Sweep);
        Assert.Equal(13.1 - 3.25, first.EndX, 6);
        Assert.Equal(3.9 + 3.25, first.EndY, 6);
        // l-.1.1 → 黏连小数：(-0.1, 0.1)
        var line = sp.Segments[1];
        Assert.False(line.IsArc);
        Assert.Equal(13.1 - 3.25 - 0.1, line.EndX, 6);
        Assert.Equal(3.9 + 3.25 + 0.1, line.EndY, 6);
        // 全部段终点均在 0..16 视图内
        Assert.All(sp.Segments, s => Assert.InRange(s.EndX, -0.01, 16.01));
        Assert.All(sp.Segments, s => Assert.InRange(s.EndY, -0.01, 16.01));
    }

    [Fact]
    public void Z_ResetsCurrentPointToSubPathStart()
    {
        var d = SvgPathParser.Parse("M2 3h4v2zM8 8h2z");
        Assert.Equal(2, d.SubPaths.Count);
        Assert.Equal((8, 8), (d.SubPaths[1].StartX, d.SubPaths[1].StartY));
        // z 后 H 相对子路径起点（当前点复位）
        Assert.Equal(10, d.SubPaths[1].Segments[0].EndX);
    }

    [Fact]
    public void CurveCommand_Throws()
    {
        Assert.Throws<FormatException>(() => SvgPathParser.Parse("M2 3C4 5 6 7 8 9"));
        Assert.Throws<FormatException>(() => SvgPathParser.Parse("M2 3Q4 5 8 9"));
    }

    [Fact]
    public void EmptyPath_NoSubPaths()
    {
        Assert.Empty(SvgPathParser.Parse("").SubPaths);
    }
}
