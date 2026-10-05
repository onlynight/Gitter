using System.Text;
using GitUI.Core.Ai;
using Xunit;

namespace GitUI.Core.Tests.Ai;

/// <summary>
/// 终端输出的 agent CLI 活动识别（ai-native-redesign.md §7.3）：VT 剥离、跨块 UTF-8、上升沿。
/// </summary>
public sealed class AgentActivityMatcherTests
{
    [Fact]
    public void Feed_PlainBanner_DetectsClaude()
    {
        var m = new AgentActivityMatcher();
        var hit = m.Feed("Welcome to Claude Code v1.0\r\n"u8.ToArray());
        Assert.NotNull(hit);
        Assert.Equal("claude-code", hit!.AgentId);
        Assert.NotNull(m.Current);
    }

    [Fact]
    public void Feed_VtSequences_AreStripped()
    {
        var m = new AgentActivityMatcher();
        // ESC[2J 清屏 + ESC[1;34m 颜色 + 签名文本
        var bytes = new byte[] { 0x1B, (byte)'[', (byte)'2', (byte)'J' }
            .Concat("codex cli ready"u8.ToArray())
            .Concat(new byte[] { 0x1B, (byte)'[', (byte)'0', (byte)'m' })
            .ToArray();
        Assert.NotNull(m.Feed(bytes));
        Assert.Equal("codex", m.Current!.AgentId);
    }

    [Fact]
    public void Feed_OscSequence_Stripped()
    {
        var m = new AgentActivityMatcher();
        var bytes = new byte[] { 0x1B, (byte)']' }
            .Concat("0;title with claude code inside"u8.ToArray())
            .Concat(new byte[] { 0x07 })
            .Concat("nothing here"u8.ToArray())
            .ToArray();
        // OSC 内容（窗口标题）不参与匹配
        Assert.Null(m.Feed(bytes));
    }

    [Fact]
    public void Feed_RisingEdge_OnlyOnce()
    {
        var m = new AgentActivityMatcher();
        Assert.NotNull(m.Feed("claude code"u8.ToArray()));
        Assert.Null(m.Feed("claude code again"u8.ToArray())); // 已识别，不重复报
    }

    [Fact]
    public void Feed_UnknownText_ReturnsNull()
    {
        var m = new AgentActivityMatcher();
        Assert.Null(m.Feed("just a regular shell prompt\r\n$ "u8.ToArray()));
        Assert.Null(m.Current);
    }

    [Fact]
    public void Feed_Utf8SplitAcrossFeeds_DoesNotThrow()
    {
        var m = new AgentActivityMatcher();
        var text = "普通输出 claude code ✻";
        var bytes = Encoding.UTF8.GetBytes(text);
        var cut = 7; // 落在多字节序列中间
        Assert.Null(m.Feed(bytes[..cut]));
        Assert.NotNull(m.Feed(bytes[cut..]));
    }

    [Fact]
    public void Reset_ClearsState()
    {
        var m = new AgentActivityMatcher();
        m.Feed("claude code"u8.ToArray());
        m.Reset();
        Assert.Null(m.Current);
    }

    [Fact]
    public void StripEscape_MixedContent_KeepsPlainText()
    {
        var bytes = "ab"u8.ToArray().Concat(new byte[] { 0x1B, (byte)'[', (byte)'K' }).Concat("cd"u8.ToArray()).ToArray();
        Assert.Equal("abcd", AgentActivityMatcher.StripEscape(bytes));
    }
}
