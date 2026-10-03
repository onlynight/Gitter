using System.Text;
using GitUI.Shell;
using Xunit;

namespace GitUI.Shell.Tests;

public sealed class DumpDiag
{
    private static string Line(TerminalBuffer b, int row)
    {
        var sb = new StringBuilder();
        for (var c = 0; c < b.Columns; c++) sb.Append(b.GetChar(c, row));
        return sb.ToString().TrimEnd();
    }

    [Fact]
    public void DumpAll()
    {
        // CUU 场景
        var (b, p) = NewTerm();
        Feed(p, "\x1b[3;5HX\x1b[2A\x1b[1DX\x1b[4B\x1b[2CX");
        Console.WriteLine("== CUU 10x4 ==");
        for (var r = 0; r < 4; r++) Console.WriteLine($"  row{r}=[{Line(b, r)}]");
        Console.WriteLine($"  cursor={b.Cursor}");

        // RI 场景
        var (b2, p2) = NewTerm();
        Feed(p2, "r0\r\nr1\r\nr2\r\nr3\x1b[2;4r\x1b[2;1HX\x1bM Y");
        Console.WriteLine("== RI 10x4 ==");
        for (var r = 0; r < 4; r++) Console.WriteLine($"  row{r}=[{Line(b2, r)}]");

        Assert.True(true);
    }

    private static (TerminalBuffer, TerminalParser) NewTerm(int cols = 10, int rows = 4)
    {
        var buf = new TerminalBuffer(cols, rows);
        return (buf, new TerminalParser(buf));
    }

    private static void Feed(TerminalParser p, string s) => p.Feed(Encoding.UTF8.GetBytes(s));
}
