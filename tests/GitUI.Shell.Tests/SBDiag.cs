using System.Text;
using GitUI.Shell;
using GitUI.Shell.Render;
using Xunit;

namespace GitUI.Shell.Tests;

public sealed class SBDiag
{
    private static string Line(TerminalCell[] line)
    {
        var sb = new StringBuilder();
        foreach (var c in line) { if (c.Char != TerminalCell.WideContinuation) sb.Append(c.Char); }
        return sb.ToString().TrimEnd();
    }

    [Fact]
    public void Dump()
    {
        var b = new TerminalBuffer(20, 5);
        var p = new TerminalParser(b);
        p.Feed(Encoding.UTF8.GetBytes("r0\r\nr1\r\nr2\r\nr3"));
        Console.WriteLine($"after1: sbCount={b.ScrollbackCount}");
        p.Feed(Encoding.UTF8.GetBytes("\r\nr4\r\nr5\r\nr6"));
        Console.WriteLine($"after2: sbCount={b.ScrollbackCount}");
        for (var i = 0; i < b.ScrollbackCount; i++)
            Console.WriteLine($"  sb[{i}]=[{Line(b.GetScrollbackLine(i)!)}]");
        for (var r = 0; r < b.Rows; r++)
            Console.WriteLine($"  screen[{r}]=[{Line(b.GetScreenRowInternal(r)!)}]");
        var (rects, runs) = TerminalRenderModel.Layout(b, TerminalPalette.Dark, 0, 5, 20);
        foreach (var run in runs) Console.WriteLine($"  run row{run.Row} col{run.Col}=[{run.Text.TrimEnd()}]");
        Assert.True(true);
    }
}
