using System.Diagnostics;
using System.Text;
using GitUI.Shell;
using Xunit;

namespace GitUI.Shell.Tests;

public sealed class PerfDiag2
{
    private const int N = 10_000_000;

    [Fact]
    public void Segments2()
    {
        var buf = new TerminalBuffer(120, 30);
        var sw = Stopwatch.StartNew();
        for (var i = 0; i < N; i++) buf.PutChar('a', wide: false);
        sw.Stop();
        Console.WriteLine($"D putchar-loop: {sw.ElapsedMilliseconds} ms");
        Assert.True(true);
    }

    [Fact]
    public void Segments3()
    {
        var buf = new TerminalBuffer(120, 30);
        var p = new TerminalParser(buf);
        var bytes = new byte[N];
        Array.Fill(bytes, (byte)'a');
        var sw = Stopwatch.StartNew();
        p.Feed(bytes);
        sw.Stop();
        Console.WriteLine($"E feed-ascii-run: {sw.ElapsedMilliseconds} ms");
        Assert.True(true);
    }

    [Fact]
    public void Segments4()
    {
        // 每 60 字节一个 \r\n（滚动压力）
        var buf = new TerminalBuffer(120, 30);
        var p = new TerminalParser(buf);
        var bytes = new byte[N];
        for (var i = 0; i < N; i++) bytes[i] = (byte)((i % 61 == 59) ? '\n' : (i % 61 == 58) ? '\r' : 'a');
        var sw = Stopwatch.StartNew();
        p.Feed(bytes);
        sw.Stop();
        Console.WriteLine($"F feed-ascii-lf: {sw.ElapsedMilliseconds} ms");
        Assert.True(true);
    }
}
