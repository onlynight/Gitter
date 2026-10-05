using GitUI.Shell;
using Xunit;

namespace GitUI.Shell.Tests;

/// <summary>
/// 键盘 → PTY 编码。EncodePrintable 依赖测试线程的活动键盘布局（中文系统基础布局为美式），
/// 布局不同的环境可能失败——本仓库冒烟/单测均在开发机（美式基础布局）上运行。
/// </summary>
public sealed class TerminalInputEncoderTests
{
    private static TerminalInputEncoder.Modifiers M(
        bool ctrl = false, bool shift = false, bool alt = false, bool caps = false, bool num = false)
        => new(ctrl, shift, alt, caps, num);

    // ---- 特殊键 ----

    [Theory]
    [InlineData(38, new byte[] { 0x1b, (byte)'[', (byte)'A' })]  // 上
    [InlineData(40, new byte[] { 0x1b, (byte)'[', (byte)'B' })]  // 下
    [InlineData(39, new byte[] { 0x1b, (byte)'[', (byte)'C' })]  // 右
    [InlineData(37, new byte[] { 0x1b, (byte)'[', (byte)'D' })]  // 左
    public void EncodeSpecial_Arrows_NormalMode(int key, byte[] expected)
    {
        Assert.Equal(expected, TerminalInputEncoder.EncodeSpecial(key, appCursorKeys: false, M()));
    }

    [Fact]
    public void EncodeSpecial_Arrows_ApplicationCursorKeys()
    {
        Assert.Equal(new byte[] { 0x1b, (byte)'O', (byte)'A' },
            TerminalInputEncoder.EncodeSpecial(38, appCursorKeys: true, M()));
    }

    [Theory]
    [InlineData(13, new byte[] { 0x0d })]   // Enter
    [InlineData(8, new byte[] { 0x7f })]    // Backspace
    [InlineData(9, new byte[] { 0x09 })]    // Tab
    [InlineData(27, new byte[] { 0x1b })]   // Esc
    public void EncodeSpecial_ControlKeys(int key, byte[] expected)
    {
        Assert.Equal(expected, TerminalInputEncoder.EncodeSpecial(key, appCursorKeys: false, M()));
    }

    [Theory]
    [InlineData(65, new byte[] { 0x01 })]   // Ctrl+A
    [InlineData(67, new byte[] { 0x03 })]   // Ctrl+C（中断）
    [InlineData(90, new byte[] { 0x1a })]   // Ctrl+Z
    public void EncodeSpecial_CtrlLetter_SendsControlChar(int key, byte[] expected)
    {
        Assert.Equal(expected, TerminalInputEncoder.EncodeSpecial(key, appCursorKeys: false, M(ctrl: true)));
    }

    [Fact]
    public void EncodeSpecial_UnknownPrintable_ReturnsNull()
    {
        Assert.Null(TerminalInputEncoder.EncodeSpecial(65, appCursorKeys: false, M())); // 无修饰的 A 走可打印路径
    }

    [Fact]
    public void EncodeSpecial_AltGrLetter_DoesNotSendControlChar()
    {
        // AltGr（Ctrl+Alt 同按）在欧语布局产出替代符号，不是 Ctrl 组合——
        // 此前误发 0x11 (DC1)
        Assert.Null(TerminalInputEncoder.EncodeSpecial(65, appCursorKeys: false, M(ctrl: true, alt: true)));
    }

    // ---- 可打印键范围 ----

    [Theory]
    [InlineData(0x20, true)]   // Space
    [InlineData(0x30, true)]   // 0
    [InlineData(0x41, true)]   // A
    [InlineData(0x5A, true)]   // Z
    [InlineData(0x6F, true)]   // 小键盘 Divide
    [InlineData(0xBA, true)]   // ; OEM_1（此前被范围判断漏掉）
    [InlineData(0xBD, true)]   // - OEM_MINUS（ls -al 的 -，此前无法输入）
    [InlineData(0xBE, true)]   // . OEM_PERIOD
    [InlineData(0xDC, true)]   // \ OEM_5
    [InlineData(0xE2, true)]   // OEM_102
    [InlineData(0x11, false)]  // Ctrl
    [InlineData(0x70, false)]  // F1
    [InlineData(0xE3, false)]  // 保留区
    public void IsPrintableKey_CoversOemBlock(int key, bool expected)
    {
        Assert.Equal(expected, TerminalInputEncoder.IsPrintableKey(key));
    }

    // ---- 可打印字符（ToUnicode，美式布局）----

    [Fact]
    public void EncodePrintable_Letter_LowercaseWithoutShift()
    {
        Assert.Equal("a", TerminalInputEncoder.EncodePrintable(65, 0x1E, M()));
    }

    [Fact]
    public void EncodePrintable_Letter_UppercaseWithShift()
    {
        Assert.Equal("A", TerminalInputEncoder.EncodePrintable(65, 0x1E, M(shift: true)));
    }

    [Fact]
    public void EncodePrintable_Letter_UppercaseWithCapsLock()
    {
        Assert.Equal("A", TerminalInputEncoder.EncodePrintable(65, 0x1E, M(caps: true)));
    }

    [Fact]
    public void EncodePrintable_Digit_WithShift_GivesSymbol()
    {
        Assert.Equal("!", TerminalInputEncoder.EncodePrintable(0x31, 0x02, M(shift: true)));
        Assert.Equal("1", TerminalInputEncoder.EncodePrintable(0x31, 0x02, M()));
    }

    [Fact]
    public void EncodePrintable_OemKeys_GiveLayoutSymbols_NotGarbage()
    {
        // 旧实现直接 (char)0xBA → 'º'；正确行为是按布局出 ';'
        Assert.Equal(";", TerminalInputEncoder.EncodePrintable(0xBA, 0x27, M()));
        // '\' VK_OEM_5 (0xDC)，旧实现输出 'Ü'
        Assert.Equal("\\", TerminalInputEncoder.EncodePrintable(0xDC, 0x2B, M()));
    }

    [Fact]
    public void EncodePrintable_Space()
    {
        Assert.Equal(" ", TerminalInputEncoder.EncodePrintable(0x20, 0x39, M()));
    }
}
