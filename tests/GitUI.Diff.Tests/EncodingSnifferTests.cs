using System.Text;
using GitUI.Diff;
using Xunit;

namespace GitUI.Diff.Tests;

public sealed class EncodingSnifferTests
{
    private static byte[] Gbk(params object[] parts)
    {
        var enc = CreateGbk();
        var bytes = new List<byte>();
        foreach (var p in parts)
            bytes.AddRange(p is string s ? enc.GetBytes(s) : new[] { (byte)p });
        return bytes.ToArray();
    }

    private static Encoding CreateGbk()
    {
        Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance);
        return Encoding.GetEncoding(936);
    }

    [Fact]
    public void EmptyBytes_IsUtf8()
        => Assert.Equal(TextEncodingKind.Utf8, EncodingSniffer.Detect(ReadOnlySpan<byte>.Empty));

    [Fact]
    public void AsciiOnly_IsUtf8()
        => Assert.Equal(TextEncodingKind.Utf8, EncodingSniffer.Detect("plain ascii text\n"u8.ToArray()));

    [Fact]
    public void Utf8Bom_Detected()
    {
        var bytes = new List<byte> { 0xEF, 0xBB, 0xBF };
        bytes.AddRange("中文 content\n"u8.ToArray());
        Assert.Equal(TextEncodingKind.Utf8Bom, EncodingSniffer.Detect(bytes.ToArray()));
    }

    [Fact]
    public void Utf8ChineseContent_IsUtf8()
        => Assert.Equal(TextEncodingKind.Utf8, EncodingSniffer.Detect("中文内容，混合 English\n"u8.ToArray()));

    [Fact]
    public void Utf16LeBom_Detected()
        => Assert.Equal(TextEncodingKind.Utf16Le, EncodingSniffer.Detect(new byte[] { 0xFF, 0xFE, 0x41, 0x00 }));

    [Fact]
    public void Utf16BeBom_Detected()
        => Assert.Equal(TextEncodingKind.Utf16Be, EncodingSniffer.Detect(new byte[] { 0xFE, 0xFF, 0x00, 0x41 }));

    [Fact]
    public void GbkChineseContent_Detected()
    {
        // GBK 双字节序列 ≥ 2 对（"中文内容" 4 对），且不是合法 UTF-8
        var bytes = Gbk("这是GBK编码的中文内容\n第二行\n");
        Assert.Equal(TextEncodingKind.Gbk, EncodingSniffer.Detect(bytes));
    }

    [Fact]
    public void Latin1AccentedText_NotGbk()
    {
        // 单个重音字符（1 对候选）→ 低于 GBK 阈值 → Latin1
        var bytes = new byte[] { (byte)'c', (byte)'a', (byte)'f', 0xE9, (byte)'\n' };
        Assert.Equal(TextEncodingKind.Latin1, EncodingSniffer.Detect(bytes));
    }

    [Fact]
    public void TruncatedUtf8Sequence_FallsBack()
    {
        // "中" = E4 B8 AD；截掉 AD → 非法 UTF-8；剩余单字节不成 GBK 对 → Latin1
        var bytes = new byte[] { (byte)'a', 0xE4, 0xB8, (byte)'\n' };
        Assert.Equal(TextEncodingKind.Latin1, EncodingSniffer.Detect(bytes));
    }

    [Fact]
    public void Decode_GbkRoundtrip()
    {
        var text = "中文内容第一行\nsecond line\n";
        var bytes = Gbk(text);
        Assert.Equal(text, EncodingSniffer.Decode(bytes));
        Assert.Equal(text, EncodingSniffer.Decode(bytes, TextEncodingKind.Gbk));
    }

    [Fact]
    public void Decode_Utf8Bom_StripsBom()
    {
        var bytes = new List<byte> { 0xEF, 0xBB, 0xBF };
        bytes.AddRange("hello\n"u8.ToArray());
        var text = EncodingSniffer.Decode(bytes.ToArray());
        Assert.Equal("hello\n", text);
        Assert.DoesNotContain('\uFEFF', text);
    }

    [Fact]
    public void Decode_Latin1_PreservesAccents()
    {
        var bytes = new byte[] { (byte)'c', (byte)'a', (byte)'f', 0xE9 };
        Assert.Equal("caf\u00E9", EncodingSniffer.Decode(bytes, TextEncodingKind.Latin1));
    }

    [Fact]
    public void Decode_Utf16Le_WithBom()
    {
        var text = "中文 utf16\n";
        var bytes = Encoding.Unicode.GetPreamble().Concat(Encoding.Unicode.GetBytes(text)).ToArray();
        Assert.Equal(text, EncodingSniffer.Decode(bytes));
    }
}

public sealed class BinaryDetectorTests
{
    [Fact]
    public void PlainText_NotBinary()
        => Assert.False(BinaryDetector.LooksBinary("hello world\nsecond line\n"u8.ToArray()));

    [Fact]
    public void NulByteInContent_IsBinary()
        => Assert.True(BinaryDetector.LooksBinary(new byte[] { 0x68, 0x65, 0x00, 0x6C, 0x6F }));

    [Fact]
    public void NulByteAfterScanWindow_NotBinary()
    {
        // NUL 出现在 8000 字节窗口之外（git 同语义不扫尾部）
        var bytes = new List<byte>();
        bytes.AddRange(new string('a', 9000).Select(c => (byte)c));
        bytes.Add(0);
        Assert.False(BinaryDetector.LooksBinary(bytes.ToArray()));
    }

    [Fact]
    public void NulByteInsideScanWindow_IsBinary()
    {
        var bytes = new List<byte>();
        bytes.AddRange(new string('a', 7999).Select(c => (byte)c));
        bytes.Add(0);
        Assert.True(BinaryDetector.LooksBinary(bytes.ToArray()));
    }

    [Fact]
    public void EmptyBytes_NotBinary()
        => Assert.False(BinaryDetector.LooksBinary(ReadOnlySpan<byte>.Empty));

    [Fact]
    public void Utf8TextWithChinese_NotBinary()
        => Assert.False(BinaryDetector.LooksBinary("中文内容不是二进制\n"u8.ToArray()));
}

public sealed class LargeFileFilterTests
{
    [Fact]
    public void Exactly5MB_NotTooLarge()
        => Assert.False(LargeFileFilter.IsTooLarge(5L * 1024 * 1024));

    [Fact]
    public void Over5MB_TooLarge()
        => Assert.True(LargeFileFilter.IsTooLarge(5L * 1024 * 1024 + 1));

    [Fact]
    public void Exactly20kLines_NotTooMany()
        => Assert.False(LargeFileFilter.IsTooManyLines(20_000));

    [Fact]
    public void Over20kLines_TooMany()
        => Assert.True(LargeFileFilter.IsTooManyLines(20_001));
}
