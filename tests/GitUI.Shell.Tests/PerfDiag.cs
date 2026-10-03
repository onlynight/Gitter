using System.Diagnostics;
using System.Text;
using GitUI.Shell;
using Xunit;

namespace GitUI.Shell.Tests;

public sealed class PerfDiag
{
    [Fact]
    public void Segments()
    {
        var chunk = new StringBuilder();
        while (chunk.Length < 64 * 1024)
            chunk.Append("\x1b[1;32m[info]\x1b[0m step=").Append(chunk.Length % 1000).Append(" done\r\n");
        var bytes = Encoding.UTF8.GetBytes(chunk.ToString());

        // A: 纯解码
        var dec = Encoding.UTF8.GetDecoder();
        var chars = new char[Encoding.UTF8.GetMaxCharCount(bytes.Length)];
        var sw = Stopwatch.StartNew();
        for (var i = 0; i < 160; i++)
            dec.Convert(bytes, chars, true, out _, out var charsUsed, out _);
        sw.Stop();
        Console.WriteLine($"A decode-only: {sw.ElapsedMilliseconds} ms");

        // B: 解码 + 逐 char 扫描（不落格）
        sw.Restart();
        for (var i = 0; i < 160; i++)
        {
            dec.Convert(bytes, chars, true, out _, out var charsUsed, out _);
            foreach (var ch in chars.AsSpan(0, charsUsed))
            {
                if (ch < ' ') continue;
                _ = ch >= 0x1100 && (ch <= 0x115F || (ch >= 0x2E80 && ch <= 0xA4CF && ch != 0x303F) || (ch >= 0xAC00 && ch <= 0xD7A3) || (ch >= 0xF900 && ch <= 0xFAFF) || (ch >= 0xFE30 && ch <= 0xFE4F) || (ch >= 0xFF00 && ch <= 0xFF60) || (ch >= 0xFFE0 && ch <= 0xFFE6));
            }
        }
        sw.Stop();
        Console.WriteLine($"B decode+scan: {sw.ElapsedMilliseconds} ms");

        // C: 完整 Feed
        var buf = new TerminalBuffer(120, 30);
        var p = new TerminalParser(buf);
        sw.Restart();
        for (var i = 0; i < 160; i++) p.Feed(bytes);
        sw.Stop();
        Console.WriteLine($"C full feed: {sw.ElapsedMilliseconds} ms");

        Assert.True(true);
    }
}
