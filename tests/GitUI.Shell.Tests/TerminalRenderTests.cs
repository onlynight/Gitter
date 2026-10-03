using System.Diagnostics;
using System.Text;
using GitUI.Shell;
using GitUI.Shell.Render;
using Xunit;

namespace GitUI.Shell.Tests;

/// <summary>
/// S3b TerminalRenderModel headless 渲染测试（design.md §8-S3b：
/// "喂入 S2b 的 parser 输出，断言第 N 行第 M 列是什么字符、什么颜色" + 几何 + 性能）。
/// </summary>
public sealed class TerminalRenderTests : IDisposable
{
    private readonly TerminalBuffer _buffer = new(20, 5);
    private readonly TerminalParser _parser;
    private readonly TerminalPalette _palette = TerminalPalette.Dark;

    public TerminalRenderTests() => _parser = new TerminalParser(_buffer);

    public void Dispose() { }

    private void Feed(string s) => _parser.Feed(Encoding.UTF8.GetBytes(s));

    private (IReadOnlyList<TermFillRect> Rects, IReadOnlyList<TermTextRun> Runs) Layout(
        int firstRow = 0, int rows = 5, int cols = 20, int cursorRow = -1,
        (int Col, int Row, int Cols, int Rows)? selection = null)
        => TerminalRenderModel.Layout(_buffer, _palette, firstRow, rows, cols, cursorRow, selection);

    private static string RunTextAt(IReadOnlyList<TermTextRun> runs, int row, int col)
    {
        foreach (var run in runs)
        {
            if (run.Row != row) continue;
            if (col >= run.Col && col < run.Col + run.Text.Length)
                return run.Text.Substring(col - run.Col).TrimEnd();
        }
        return string.Empty;
    }

    private static TermRunStyle? StyleAt(IReadOnlyList<TermTextRun> runs, int row, int col)
    {
        foreach (var run in runs)
        {
            if (run.Row != row) continue;
            if (col >= run.Col && col < run.Col + run.Text.Length)
                return run.Style;
        }
        return null;
    }

    // ---- 字符与颜色（§8-S3b 核心断言）----

    [Fact]
    public void ScreenRow0_TextInRuns()
    {
        Feed("hello world");
        var (_, runs) = Layout();
        Assert.Equal("hello world", RunTextAt(runs, 0, 0));
    }

    [Fact]
    public void CharAt_RowCol_ViaRuns()
    {
        Feed("\x1b[3;5HX"); // (4,2)
        var (_, runs) = Layout();
        Assert.Equal("X", RunTextAt(runs, 2, 4));
    }

    [Fact]
    public void FgColor_Red30_ResolvesFromPalette()
    {
        Feed("\x1b[31mX");
        var (_, runs) = Layout();
        var style = StyleAt(runs, 0, 0)!;
        Assert.Equal(TerminalPalette.Dark.Indexed[1], style.FgRgba);
    }

    [Fact]
    public void BgColor_Red44_ProducesFillRect()
    {
        Feed("\x1b[44mX");
        var (rects, _) = Layout();
        Assert.Contains(rects, r => r.Col == 0 && r.Row == 0 && r.Cols == 1
            && r.Rgba == TerminalPalette.Dark.Indexed[4]);
    }

    [Fact]
    public void Truecolor_Fg_PassedThrough()
    {
        Feed("\x1b[38;2;10;20;30mX");
        var (_, runs) = Layout();
        var style = StyleAt(runs, 0, 0)!;
        Assert.Equal(TerminalRenderModel.Rgba(10, 20, 30), style.FgRgba);
    }

    [Fact]
    public void Bold_IndexedFg0_7_Brightens()
    {
        Feed("\x1b[1;30mX"); // 黑 + bold → 亮黑（索引 8）
        var (_, runs) = Layout();
        var style = StyleAt(runs, 0, 0)!;
        Assert.True(style.Bold);
        Assert.Equal(TerminalPalette.Dark.Indexed[8], style.FgRgba);
    }

    [Fact]
    public void Reverse_SwapsFgBg()
    {
        Feed("\x1b[31;44;7mX"); // fg 红 bg 蓝 + 反显 → fg 蓝 bg 红
        var (_, runs) = Layout();
        var style = StyleAt(runs, 0, 0)!;
        Assert.Equal(TerminalPalette.Dark.Indexed[4], style.FgRgba); // 蓝
        Assert.Equal(TerminalPalette.Dark.Indexed[1], style.BgRgba); // 红
    }

    [Fact]
    public void AdjacentSameAttr_MergesIntoOneRun()
    {
        Feed("hello"); // 同属性 → 一个 run
        var (_, runs) = Layout();
        var rowRuns = runs.Where(r => r.Row == 0).ToList();
        Assert.Single(rowRuns);
        Assert.Equal(5, rowRuns[0].Text.TrimEnd().Length);
    }

    [Fact]
    public void AttrChange_SplitsRuns()
    {
        Feed("\x1b[31mred\x1b[32mgreen");
        var (_, runs) = Layout();
        var rowRuns = runs.Where(r => r.Row == 0 && r.Text.TrimEnd().Length > 0)
            .OrderBy(r => r.Col).ToList();
        Assert.Equal(2, rowRuns.Count);
        Assert.Equal("red", rowRuns[0].Text.TrimEnd());
        Assert.Equal("green", rowRuns[1].Text.TrimEnd());
    }

    [Fact]
    public void ScrollbackRows_LaidOutByAbsoluteRow()
    {
        Feed("r0\r\nr1\r\nr2\r\nr3"); // 4 行屏（5 行高，无滚动）
        var (_, runs) = Layout(firstRow: 0, rows: 5);
        Assert.Equal("r0", RunTextAt(runs, 0, 0));
        Assert.Equal("r3", RunTextAt(runs, 3, 0));

        // 制造滚动：r0、r1 进 scrollback，屏幕变为 r2..r6
        Feed("\r\nr4\r\nr5\r\nr6");
        var (rects2, runs2) = Layout(firstRow: 0, rows: 5);
        Assert.Equal("r0", RunTextAt(runs2, 0, 0)); // 绝对行 0 = scrollback 最旧
        Assert.Equal("r3", RunTextAt(runs2, 3, 0)); // abs3 = 屏幕行 0（sbCount=2）

        // 视窗下移一行：可视首行 = r1
        var (_, runs3) = Layout(firstRow: 1, rows: 5);
        Assert.Equal("r1", RunTextAt(runs3, 0, 0));
    }

    // ---- 光标与选区 ----

    [Fact]
    public void CursorBlock_FillRectAtCursorCell()
    {
        Feed("hello");
        var (rects, _) = Layout(cursorRow: _buffer.ScrollbackCount + _buffer.Cursor.Row);
        Assert.Contains(rects, r => r.Col == 5 && r.Row == 0);
    }

    [Fact]
    public void Selection_FillRect()
    {
        var (rects, _) = Layout(selection: (2, 1, 5, 1));
        Assert.Contains(rects, r => r.Col == 2 && r.Row == 1 && r.Cols == 5);
    }

    // ---- 几何 ----

    [Fact]
    public void Layout_RespectsViewportCols()
    {
        Feed("0123456789ABCDEFGHIJ");
        var (_, runs) = Layout(cols: 10);
        Assert.All(runs.Where(r => r.Row == 0), r => Assert.True(r.Col + r.Text.Length <= 10));
    }

    [Fact]
    public void Layout_VisibleRowsOnly()
    {
        Feed("l0\r\nl1\r\nl2\r\nl3\r\nl4");
        var (_, runs) = Layout(firstRow: 0, rows: 2);
        Assert.All(runs, r => Assert.True(r.Row < 2));
    }

    // ---- 性能（§8-S3b：10k scrollback 布局流畅）----

    [Fact]
    public void Perf_10kScrollback_VisibleLayout_Under16Ms()
    {
        var b = new TerminalBuffer(120, 30, maxScrollbackLines: 10_000);
        var p = new TerminalParser(b);
        var sb = new StringBuilder();
        for (var i = 0; i < 10_000; i++)
            sb.Append("\x1b[1;32mline\x1b[0m ").Append(i).Append(" —— 中文宽字符\n");
        p.Feed(Encoding.UTF8.GetBytes(sb.ToString()));

        var firstRow = b.ScrollbackCount - 10; // 滚到接近底部
        // 预热
        _ = TerminalRenderModel.Layout(b, TerminalPalette.Dark, firstRow, 30, 120);

        var sw = Stopwatch.StartNew();
        for (var i = 0; i < 100; i++)
        {
            _ = TerminalRenderModel.Layout(b, TerminalPalette.Dark, firstRow - i, 30, 120);
        }
        sw.Stop();
        // 单帧预算 16ms（60fps），100 帧 = 1600ms
        Assert.True(sw.ElapsedMilliseconds < 1600,
            $"100 帧可视布局耗时 {sw.ElapsedMilliseconds} ms（预算 1600ms）");
    }
}
