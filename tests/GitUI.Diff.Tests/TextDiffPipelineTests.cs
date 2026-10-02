using System.Text;
using GitUI.Core.Services;
using GitUI.Diff;
using Xunit;

namespace GitUI.Diff.Tests;

/// <summary>
/// 字节级管线测试：二进制判定 → 大文件过滤 → 编码解码 → 行级引擎 的端到端行为。
/// </summary>
public sealed class TextDiffPipelineTests
{
    private static readonly TextDiffPipeline Pipeline = new();

    private static byte[] Utf8(string s) => Encoding.UTF8.GetBytes(s);

    private static string J(params string[] lines) => string.Join("\n", lines) + "\n";

    [Fact]
    public void TextChange_ProducesHunksAndStats()
    {
        var result = Pipeline.Diff(Utf8(J("a", "b", "c")), Utf8(J("a", "B", "c")));
        Assert.True(result.IsTextDiff);
        var h = Assert.Single(result.Hunks);
        Assert.Contains("-b", h.OldLines);
        Assert.Contains("+B", h.NewLines);
        Assert.Equal(1, result.AddedLines);
        Assert.Equal(1, result.DeletedLines);
    }

    [Fact]
    public void BinaryOldSide_IsBinary_NoHunks()
    {
        var oldBytes = new byte[] { 0x01, 0x00, 0x02 };
        var result = Pipeline.Diff(oldBytes, Utf8("text\n"));
        Assert.True(result.IsBinary);
        Assert.False(result.IsTextDiff);
        Assert.Empty(result.Hunks);
        Assert.Equal(0, result.AddedLines);
    }

    [Fact]
    public void BinaryNewSide_IsBinary()
    {
        var result = Pipeline.Diff(Utf8("text\n"), new byte[] { 0xFF, 0x00 });
        Assert.True(result.IsBinary);
        Assert.Empty(result.Hunks);
    }

    [Fact]
    public void OverBytesLimit_TooLarge_NoDecode()
    {
        var big = Encoding.ASCII.GetBytes(new string('a', 5 * 1024 * 1024 + 10) + "\n");
        var result = Pipeline.Diff(big, Utf8("small\n"));
        Assert.True(result.TooLarge);
        Assert.Empty(result.Hunks);
        Assert.False(result.IsBinary);
    }

    [Fact]
    public void OverLineLimit_TooLarge()
    {
        var big = string.Concat(Enumerable.Repeat("line\n", 20_001));
        var result = Pipeline.Diff(Utf8(big), Utf8(big + "extra\n"));
        Assert.True(result.TooLarge);
        Assert.Empty(result.Hunks);
    }

    [Fact]
    public void ExactlyAtLimits_StillDiffs()
    {
        var big = string.Concat(Enumerable.Repeat("line\n", 20_000));
        var changed = string.Concat(Enumerable.Repeat("line\n", 19_999)) + "CHANGED\n";
        var result = Pipeline.Diff(Utf8(big), Utf8(changed));
        Assert.False(result.TooLarge);
        Assert.NotEmpty(result.Hunks);
    }

    [Fact]
    public void GbkContent_DecodedAndDiffed()
    {
        var gbk = CreateGbk();
        var oldBytes = gbk.GetBytes(J("第一行", "第二行", "第三行"));
        var newBytes = gbk.GetBytes(J("第一行", "改的第二行", "第三行"));
        var result = Pipeline.Diff(oldBytes, newBytes);
        Assert.True(result.IsTextDiff);
        Assert.Equal(TextEncodingKind.Gbk, result.Encoding);
        var h = Assert.Single(result.Hunks);
        Assert.Contains("-第二行", h.OldLines);
        Assert.Contains("+改的第二行", h.NewLines);
    }

    [Fact]
    public void EncodingOverride_UsedOverDetection()
    {
        // 内容本身是 GBK，但用户手动指定 Latin1
        var gbk = CreateGbk();
        var bytes = gbk.GetBytes(J("中文行"));
        var result = Pipeline.Diff(bytes, bytes, new TextDiffOptions { EncodingOverride = TextEncodingKind.Latin1 });
        Assert.Equal(TextEncodingKind.Latin1, result.Encoding);
    }

    [Fact]
    public void NullOldSide_IsNewFile()
    {
        var result = Pipeline.Diff(null, Utf8(J("a", "b")));
        Assert.True(result.IsTextDiff);
        var h = Assert.Single(result.Hunks);
        Assert.Equal((0, 0, 1, 2), (h.OldStart, h.OldCount, h.NewStart, h.NewCount));
        Assert.Equal(2, result.AddedLines);
        Assert.Equal(0, result.DeletedLines);
    }

    [Fact]
    public void NullNewSide_IsDeletedFile()
    {
        var result = Pipeline.Diff(Utf8(J("a", "b")), null);
        var h = Assert.Single(result.Hunks);
        Assert.Equal((1, 2, 0, 0), (h.OldStart, h.OldCount, h.NewStart, h.NewCount));
        Assert.Equal(0, result.AddedLines);
        Assert.Equal(2, result.DeletedLines);
    }

    [Fact]
    public void BothNull_EmptyResult()
    {
        var result = Pipeline.Diff(null, null);
        Assert.True(result.IsTextDiff);
        Assert.Empty(result.Hunks);
    }

    [Fact]
    public void EofNewlineFlags_Carried()
    {
        var withEol = Pipeline.Diff(Utf8("a\nb\n"), Utf8("a\nb"));
        Assert.True(withEol.OldEndsWithNewline);
        Assert.False(withEol.NewEndsWithNewline);
        Assert.Empty(withEol.Hunks); // 行内容相同，hunk 层无差异

        var noEol = Pipeline.Diff(Utf8("a"), Utf8("a\n"));
        Assert.False(noEol.OldEndsWithNewline);
        Assert.True(noEol.NewEndsWithNewline);
    }

    [Fact]
    public void ContextLines_PassedThrough()
    {
        var old = Utf8(J("l1", "l2", "l3", "l4", "l5"));
        var newT = Utf8(J("l1", "l2", "L3", "l4", "l5"));
        var r0 = Pipeline.Diff(old, newT, new TextDiffOptions { ContextLines = 0 });
        var h0 = Assert.Single(r0.Hunks);
        Assert.DoesNotContain(h0.OldLines, l => l.StartsWith(' '));

        var r1 = Pipeline.Diff(old, newT, new TextDiffOptions { ContextLines = 1 });
        var h1 = Assert.Single(r1.Hunks);
        Assert.Equal(3, h1.OldLines.Count);
    }

    private static Encoding CreateGbk()
    {
        Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance);
        return Encoding.GetEncoding(936);
    }
}
