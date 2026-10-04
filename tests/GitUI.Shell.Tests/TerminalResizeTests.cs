using System.Text;
using GitUI.Shell;
using Xunit;

namespace GitUI.Shell.Tests;

/// <summary>
/// known-issues 修复回归：TerminalBuffer.Resize 缩小时的行淘汰与底部保留
/// （此前先换新网格再按旧行数索引 → IndexOutOfRangeException，crash.log 抓出）。
/// </summary>
public sealed class TerminalResizeTests
{
    private static string Line(TerminalBuffer b, int row)
    {
        var sb = new StringBuilder();
        for (var c = 0; c < b.Columns; c++)
        {
            var ch = b.GetChar(c, row);
            if (ch == TerminalCell.WideContinuation) continue;
            sb.Append(ch);
        }
        return sb.ToString().TrimEnd();
    }

    [Fact]
    public void Shrink_KeepsBottomRows_TopToScrollback()
    {
        var b = new TerminalBuffer(20, 5);
        var p = new TerminalParser(b);
        p.Feed(Encoding.UTF8.GetBytes("r0\r\nr1\r\nr2\r\nr3\r\nr4"));

        b.Resize(20, 3);

        Assert.Equal(2, b.ScrollbackCount);
        Assert.Equal("r2", Line(b, 0));
        Assert.Equal("r3", Line(b, 1));
        Assert.Equal("r4", Line(b, 2));
        var sb0 = b.GetScrollbackLine(0)!;
        var sb1 = b.GetScrollbackLine(1)!;
        Assert.Equal("r0", sb0[0].Char.ToString() + sb0[1].Char);
        Assert.Equal("r1", sb1[0].Char.ToString() + sb1[1].Char);
    }

    [Fact]
    public void Grow_KeepsTopRows_NewRowsBlank()
    {
        var b = new TerminalBuffer(20, 3);
        var p = new TerminalParser(b);
        p.Feed(Encoding.UTF8.GetBytes("r0\r\nr1\r\nr2"));

        b.Resize(20, 5);

        Assert.Equal("r0", Line(b, 0));
        Assert.Equal("r2", Line(b, 2));
        Assert.Equal("", Line(b, 4));
        Assert.Equal(0, b.ScrollbackCount);
    }

    [Fact]
    public void ShrinkThenGrow_RoundTrip()
    {
        var b = new TerminalBuffer(20, 5);
        var p = new TerminalParser(b);
        p.Feed(Encoding.UTF8.GetBytes("r0\r\nr1\r\nr2\r\nr3\r\nr4"));

        b.Resize(20, 2);
        Assert.Equal("r3", Line(b, 0));
        Assert.Equal("r4", Line(b, 1));

        b.Resize(20, 5);
        Assert.Equal("r3", Line(b, 0));
        Assert.Equal("r4", Line(b, 1));
        Assert.Equal("", Line(b, 4));
    }

    [Fact]
    public void Shrink_WidthTruncates()
    {
        var b = new TerminalBuffer(20, 4);
        var p = new TerminalParser(b);
        p.Feed(Encoding.UTF8.GetBytes("0123456789abcdefghij"));

        b.Resize(8, 4);

        Assert.Equal("01234567", Line(b, 0));
        Assert.Equal(8, b.Columns);
    }

    [Fact]
    public void Shrink_SkipsBlankLines_NoScrollbackPollution()
    {
        // 首帧 80×24 → 实际视口缩容：会话未启动 buffer 全空，被淘汰行全是空网格行，
        // 不得进 scrollback（此前空行入队 → 提示符被顶到视口中部、跟随逻辑不回底）
        var b = new TerminalBuffer(80, 24);
        b.Resize(60, 17);
        Assert.Equal(0, b.ScrollbackCount);
        Assert.Equal((0, 0), b.Cursor);

        // 内容在淘汰窗口之下：上方空行丢弃，内容原位保留，同样不进 scrollback
        var b2 = new TerminalBuffer(20, 6);
        var p2 = new TerminalParser(b2);
        p2.Feed(Encoding.UTF8.GetBytes("\r\n\r\n\r\nhello"));
        b2.Resize(20, 3);
        Assert.Equal(0, b2.ScrollbackCount);
        Assert.Equal("hello", Line(b2, 0));
    }

    [Fact]
    public void Shrink_KeepsContentRows_DropsBlankRows()
    {
        // 混合内容：非空行照常入 scrollback，夹在其中的空行丢弃
        var b = new TerminalBuffer(20, 6);
        var p = new TerminalParser(b);
        p.Feed(Encoding.UTF8.GetBytes("top\r\n\r\nmid\r\n\r\n\r\nbottom"));

        b.Resize(20, 3);

        // 淘汰窗口 = 顶部 3 行（top/空/mid）：top、mid 入 scrollback，空行丢弃
        Assert.Equal(2, b.ScrollbackCount);
        Assert.Equal("top", SbLine(b, 0));
        Assert.Equal("mid", SbLine(b, 1));
        // 屏幕保留底部 3 行（空/空/bottom）
        Assert.Equal("bottom", Line(b, 2));
    }

    private static string SbLine(TerminalBuffer b, int index)
    {
        var line = b.GetScrollbackLine(index)!;
        var sb = new StringBuilder();
        foreach (var cell in line)
        {
            if (cell.Char != TerminalCell.WideContinuation) sb.Append(cell.Char);
        }
        return sb.ToString().TrimEnd();
    }

    [Fact]
    public void Resize_DoesNotThrow_ForAnySize()
    {
        var b = new TerminalBuffer(80, 24);
        var p = new TerminalParser(b);
        p.Feed(Encoding.UTF8.GetBytes("hello\r\nworld"));

        // 任意尺寸组合都不应抛异常（此前缩小路径越界崩溃）
        foreach (var (c, r) in new[] { (2, 2), (500, 300), (3, 100), (80, 24), (120, 30), (4, 3) })
        {
            b.Resize(c, r);
        }
        Assert.True(b.Columns >= 2 && b.Rows >= 2);
    }
}
