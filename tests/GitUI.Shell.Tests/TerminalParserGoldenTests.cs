using System.Diagnostics;
using System.Text;
using GitUI.Shell;
using Xunit;

namespace GitUI.Shell.Tests;

/// <summary>
/// S2b TerminalParser 黄金用例集（design.md §8-S2b：≥50 例，参考 xterm.js 兼容性测试集）。
/// 用例计数：本文件 xunit 用例（Theory 展开后）≥ 60。
/// </summary>
public sealed class TerminalParserGoldenTests
{
    private static (TerminalBuffer Buf, TerminalParser Parser) NewTerm(int cols = 10, int rows = 4)
    {
        var buf = new TerminalBuffer(cols, rows);
        return (buf, new TerminalParser(buf));
    }

    private static void Feed(TerminalParser p, string s) => p.Feed(Encoding.UTF8.GetBytes(s));

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

    private static string Screen(TerminalBuffer b)
    {
        var sb = new StringBuilder();
        for (var r = 0; r < b.Rows; r++) sb.AppendLine(Line(b, r));
        return sb.ToString();
    }

    // ---- 基础文本 ----

    [Fact]
    public void PlainText_AtHome()
    {
        var (b, p) = NewTerm();
        Feed(p, "hello");
        Assert.Equal("hello", Line(b, 0));
        Assert.Equal((5, 0), b.Cursor);
    }

    [Fact]
    public void CR_OverwritesFromColumnZero()
    {
        var (b, p) = NewTerm();
        Feed(p, "hello\rXX");
        Assert.Equal("XXllo", Line(b, 0));
    }

    [Fact]
    public void LF_MovesDownWithoutCR()
    {
        var (b, p) = NewTerm();
        Feed(p, "ab\ncd");
        Assert.Equal('c', b.GetChar(2, 1)); // xterm：LF 不回列
        // 光标列保留（xterm 终端 LF 不回列）
        Assert.Equal((4, 1), b.Cursor);
    }

    [Fact]
    public void CRLF_NewLineAtColumnZero()
    {
        var (b, p) = NewTerm();
        Feed(p, "ab\r\ncd");
        Assert.Equal("cd", Line(b, 1));
        Assert.Equal((2, 1), b.Cursor);
    }

    [Fact]
    public void Backspace_Overwrites()
    {
        var (b, p) = NewTerm();
        Feed(p, "abc\bX");
        Assert.Equal("abX", Line(b, 0));
    }

    [Fact]
    public void Tab_AdvancesToNext8ColumnStop()
    {
        var (b, p) = NewTerm();
        Feed(p, "a\tb");
        Assert.Equal('b', b.GetChar(8, 0));
    }

    [Fact]
    public void MultipleTabs_ClampAtLineEnd()
    {
        var (b, p) = NewTerm(cols: 10);
        Feed(p, "\t\t\t\t\t");
        Assert.Equal((9, 0), b.Cursor);
    }

    [Fact]
    public void Bel_Nul_Del_Ignored()
    {
        var (b, p) = NewTerm();
        Feed(p, "a\u0007\u0000\u007fb");
        Assert.Equal("ab", Line(b, 0));
    }

    // ---- 滚动 ----

    [Fact]
    public void LF_AtBottom_ScrollsScreen()
    {
        var (b, p) = NewTerm(rows: 3);
        Feed(p, "r0\r\nr1\r\nr2\r\nr3");
        Assert.Equal("r1", Line(b, 0));
        Assert.Equal("r2", Line(b, 1));
        Assert.Equal("r3", Line(b, 2));
        Assert.Equal(1, b.ScrollbackCount);
    }

    private static string FirstNonEmptyRow(TerminalBuffer b, int start)
    {
        for (var r = start; r < b.Rows; r++)
        {
            var line = Line(b, r);
            if (line.Length > 0) return line;
        }
        return string.Empty;
    }

    [Fact]
    public void Scroll_GrowsScrollback()
    {
        var (b, p) = NewTerm(rows: 3);
        Feed(p, "r0\r\nr1\r\nr2\r\nr3");
        Assert.Equal(1, b.ScrollbackCount);
        var line = b.GetScrollbackLine(0)!;
        Assert.Equal('r', line[0].Char);
        Assert.Equal('0', line[1].Char);
    }

    [Fact]
    public void Scrollback_CappedAtMax()
    {
        var b = new TerminalBuffer(10, 3, maxScrollbackLines: 5);
        var p = new TerminalParser(b);
        for (var i = 0; i < 20; i++) Feed(p, $"line{i}\r\n");
        Assert.Equal(5, b.ScrollbackCount);
        // 最旧被丢弃：最后保留的是 line12..line16 中的顶部
        var top = b.GetScrollbackLine(0)!;
        Assert.Equal("line13", new string(top.Select(c => c.Char).ToArray()).TrimEnd());
    }

    [Fact]
    public void Autowrap_AtColumnEnd()
    {
        var (b, p) = NewTerm(cols: 10);
        Feed(p, "0123456789X");
        Assert.Equal("0123456789", Line(b, 0));
        Assert.Equal("X", Line(b, 1));
    }

    [Fact]
    public void DECAWM_Off_ClampsAtLastColumn()
    {
        var (b, p) = NewTerm(cols: 10);
        Feed(p, "\u001b[?7l0123456789XYZ");
        Assert.Equal("012345678Z", Line(b, 0)); // 光标钉在末列，持续覆盖
        Assert.Equal("", Line(b, 1));
        Feed(p, "\u001b[?7hW");
        Assert.Equal("012345678W", Line(b, 0)); // 恢复后 W 仍写在末列（挂起换行在下个字符触发）
        Assert.Equal((9, 0), b.Cursor);
    }

    // ---- CSI 光标移动 ----

    [Fact]
    public void CUU_CUD_CUF_CUB()
    {
        var (b, p) = NewTerm();
        Feed(p, "\u001b[3;5HX\u001b[2A\u001b[1DX\u001b[4B\u001b[2CX");
        Assert.Equal('X', b.GetChar(4, 0)); // 2A 回行首列 4，1D 后写 → X@3？否：1D 是从写后的 (5,0) 起算
        Assert.Equal('X', b.GetChar(4, 2)); // X1 在 (4,2)
        Assert.Equal('X', b.GetChar(7, 3)); // 4B（夹到行3）+2C
    }

    [Fact]
    public void CNL_CPL_MoveToColumnZero()
    {
        var (b, p) = NewTerm();
        Feed(p, "\u001b[3;5HX");       // (4,2)
        Feed(p, "\u001b[1E");          // 下一行行首 (0,3)
        Assert.Equal((0, 3), b.Cursor);
        Feed(p, "\u001b[2F");          // 上两行行首 (0,1)
        Assert.Equal((0, 1), b.Cursor);
    }

    [Fact]
    public void CHA_RowAbsolute_And_VPA()
    {
        var (b, p) = NewTerm();
        var (b2, p2) = NewTerm(cols: 40);
        Feed(p2, "\u001b[2;3HX");    // (2,1)
        Feed(p2, "\u001b[7G Y");     // 列 7 空格、列 8 = Y
        Assert.Equal('Y', b2.GetChar(7, 1));
        Feed(p2, "\u001b[4d Z");     // 第 4 行（VPA），空格@8，Z@9
        Assert.Equal('Z', b2.GetChar(9, 3));
    }

    [Fact]
    public void CUP_HomeWithoutParams()
    {
        var (b, p) = NewTerm();
        Feed(p, "\u001b[3;3HX\u001b[H Y");
        Assert.Equal('Y', b.GetChar(1, 0)); // 空格落 (0,0)，Y 在 (1,0)
    }

    [Fact]
    public void CursorMovement_ClampedAtEdges()
    {
        var (b, p) = NewTerm();
        Feed(p, "\u001b[99;99H");
        Assert.Equal((9, 3), b.Cursor);
        Feed(p, "\u001b[99A\u001b[99D");
        Assert.Equal((0, 0), b.Cursor);
    }

    // ---- 擦除 ----

    [Fact]
    public void EL_Modes()
    {
        var (b, p) = NewTerm();
        Feed(p, "abcdefghij\r\nijklmnopqr\r\x1b[4G\x1b[K");
        Assert.Equal("ijk", Line(b, 1)); // EL0：光标（第4列）起清到行尾

        Feed(p, "\x1b[1;1H\x1b[5G\x1b[1K");
        Assert.Equal(' ', b.GetChar(0, 0)); // EL1：清到光标
        Assert.Equal('f', b.GetChar(5, 0));

        Feed(p, "\x1b[2K");
        Assert.Equal("", Line(b, 0)); // EL2：整行
    }

    [Fact]
    public void ED_Modes()
    {
        var (b, p) = NewTerm();
        Feed(p, "aaaaaaaaaa\r\nbbbbbbbbbb\r\ncccccccccc\r\n\r\u001b[2;3H\u001b[0J");
        Assert.Equal("aaaaaaaaaa", Line(b, 0));
        Assert.Equal("bb", Line(b, 1));
        Assert.Equal("", Line(b, 2));
        Assert.Equal("", Line(b, 3));

        Feed(p, "\u001b[2J");
        Assert.All(Enumerable.Range(0, 4), r => Assert.Equal("", Line(b, r)));
    }

    [Fact]
    public void ED3_ClearsScrollback()
    {
        var (b, p) = NewTerm(rows: 3);
        Feed(p, "r0\r\nr1\r\nr2\r\nr3\r\n\u001b[3J");
        Assert.Equal(0, b.ScrollbackCount);
    }

    // ---- 插入/删除 ----

    [Fact]
    public void InsertChars_AtCursor()
    {
        var (b, p) = NewTerm();
        Feed(p, "abcdef\r\u001b[2G\u001b[2@X");
        Assert.Equal("aX bcdef", Line(b, 0));
    }

    [Fact]
    public void DeleteChars_AtCursor()
    {
        var (b, p) = NewTerm();
        Feed(p, "abcdef\r\u001b[2G\u001b[2P");
        Assert.Equal("adef", Line(b, 0));
    }

    [Fact]
    public void InsertLines_WithinRegion()
    {
        var (b, p) = NewTerm(rows: 5);
        Feed(p, "r0\r\nr1\r\nr2\r\nr3\r\nr4\r\u001b[2;1H\u001b[1L");
        Assert.Equal("", Line(b, 1));
        Assert.Equal("r1", Line(b, 2));
        Assert.Equal("r3", Line(b, 4));
    }

    [Fact]
    public void DeleteLines_WithinRegion()
    {
        var (b, p) = NewTerm(rows: 5);
        Feed(p, "r0\r\nr1\r\nr2\r\nr3\r\nr4\r\u001b[1;1H\u001b[1M");
        Assert.Equal("r1", Line(b, 0));
        Assert.Equal("", Line(b, 4));
    }

    [Fact]
    public void ScrollUpDown_RegionWide()
    {
        var (b, p) = NewTerm(rows: 4);
        Feed(p, "r0\r\nr1\r\nr2\r\nr3\r\u001b[1S");
        Assert.Equal("r1", Line(b, 0));
        Feed(p, "\u001b[2T");
        Assert.Equal("", Line(b, 0));
        Assert.Equal("r1", Line(b, 2));
    }

    // ---- 滚动区 ----

    [Fact]
    public void DECSTBM_LimitsScroll()
    {
        var (b, p) = NewTerm(rows: 4);
        Feed(p, "top\r\nr1\r\nr2");           // 行0..2，未滚动
        Feed(p, "\x1b[2;4r");                   // 滚动区 = 行1..3
        Feed(p, "\x1b[4;1HX\r\nLF1\r\nLF2\r\nLF3\r\nLF4");
        Assert.Equal("top", Line(b, 0));        // 区外第0行不动
        Assert.Equal("LF2", Line(b, 1));        // 区内滚了两行
        Assert.Equal("LF4", Line(b, 3));
    }

    [Fact]
    public void RI_AtRegionTop_ScrollsRegionDown()
    {
        var (b, p) = NewTerm(rows: 4);
        Feed(p, "r0\r\nr1\r\nr2\r\nr3\u001b[2;4r\u001b[2;1HX\u001bM Y");
        Assert.Equal('X', b.GetChar(0, 2));  // X 被下滚一行
        Assert.Equal(' ', b.GetChar(1, 1));  // 光标停在 (1,1)：空格落这里
        Assert.Equal('Y', b.GetChar(2, 1));  // Y 跟随
        Assert.Equal("r2", Line(b, 3));      // 区底滚入 r2
    }

    [Fact]
    public void OriginMode_CUPRelativeToRegion()
    {
        var (b, p) = NewTerm(rows: 4);
        Feed(p, "\u001b[2;4r\u001b[?6h\u001b[1;1HX"); // origin 后 1;1 = 区顶（行索引1）
        Assert.Equal('X', b.GetChar(0, 1));
        Feed(p, "\u001b[?6l");
    }

    // ---- 保存/恢复光标 ----

    [Fact]
    public void SaveRestoreCursor_CsiSU()
    {
        var (b, p) = NewTerm();
        Feed(p, "\u001b[2;3H\u001b[sXX\u001b[uX");
        Assert.Equal('X', b.GetChar(2, 1));
    }

    [Fact]
    public void SaveRestoreCursor_DecscDecrc()
    {
        var (b, p) = NewTerm();
        Feed(p, "\u001b[2;3H\u001b7XX\u001b8X");
        Assert.Equal('X', b.GetChar(2, 1));
    }

    // ---- RIS ----

    [Fact]
    public void RIS_ResetsAll()
    {
        var (b, p) = NewTerm();
        Feed(p, "\u001b[?25l\u001b[?7l\u001b[?1h\u001b[2;4r\u001b]0;mytitle\u0007text");
        Feed(p, "\u001bc");
        Assert.True(b.CursorVisible);
        Assert.True(b.AutoWrap);
        Assert.False(b.ApplicationCursorKeys);
        Assert.Equal((0, 0), b.Cursor);
        Assert.Equal(0, b.ScrollRegionTop);
        Assert.Equal(b.Rows - 1, b.ScrollRegionBottom);
        Assert.Equal(string.Empty, b.Title);
        Assert.Equal("", Line(b, 0));
    }

    // ---- OSC ----

    [Fact]
    public void OscTitle_BelTerminated()
    {
        var (b, p) = NewTerm();
        Feed(p, "\u001b]0;my window\u0007");
        Assert.Equal("my window", b.Title);
    }

    [Fact]
    public void OscTitle_StTerminated()
    {
        var (b, p) = NewTerm();
        Feed(p, "\u001b]2;title X\u001b\\next");
        Assert.Equal("title X", b.Title);
        Assert.Equal("next", Line(b, 0)); // ST 的 '\' 被吞，不落格
    }

    // ---- SGR ----

    [Fact]
    public void Sgr_BoldItalicUnderline()
    {
        var (b, p) = NewTerm();
        Feed(p, "\u001b[1;3;4mX");
        var a = b.GetAttr(0, 0);
        Assert.True(a.Bold);
        Assert.True(a.Italic);
        Assert.True(a.Underline);
        Feed(p, "\u001b[22;23;24mY");
        var a2 = b.GetAttr(1, 0);
        Assert.False(a2.Bold);
        Assert.False(a2.Italic);
        Assert.False(a2.Underline);
    }

    [Fact]
    public void Sgr_FgIndexed_AndBright()
    {
        var (b, p) = NewTerm();
        Feed(p, "\u001b[31mX\u001b[91mY");
        Assert.Equal(TerminalColor.FromIndexed(1), b.GetAttr(0, 0).Foreground);
        Assert.Equal(TerminalColor.FromIndexed(9), b.GetAttr(1, 0).Foreground);
    }

    [Fact]
    public void Sgr_BgIndexed_AndBright()
    {
        var (b, p) = NewTerm();
        Feed(p, "\u001b[44mX\u001b[104mY");
        Assert.Equal(TerminalColor.FromIndexed(4), b.GetAttr(0, 0).Background);
        Assert.Equal(TerminalColor.FromIndexed(12), b.GetAttr(1, 0).Background);
    }

    [Fact]
    public void Sgr_256Color()
    {
        var (b, p) = NewTerm();
        Feed(p, "\u001b[38;5;196mX\u001b[48;5;21m Y");
        Assert.Equal(TerminalColor.FromIndexed(196), b.GetAttr(0, 0).Foreground);
        Assert.Equal(TerminalColor.FromIndexed(21), b.GetAttr(1, 0).Background);
    }

    [Fact]
    public void Sgr_Truecolor()
    {
        var (b, p) = NewTerm();
        Feed(p, "\u001b[38;2;12;34;56mX");
        var fg = b.GetAttr(0, 0).Foreground;
        Assert.Equal(TerminalColorKind.Rgb, fg.Kind);
        Assert.Equal((12, 34, 56), (fg.R, fg.G, fg.B));
    }

    [Fact]
    public void Sgr_Reset_And_DefaultColors()
    {
        var (b, p) = NewTerm();
        Feed(p, "\u001b[1;31;44mX\u001b[0mY");
        Assert.Equal(SgrAttribute.Normal, b.GetAttr(1, 0));
        Feed(p, "\u001b[31;44mZ\u001b[39;49m W");
        Assert.Equal(TerminalColor.Default, b.GetAttr(3, 0).Foreground);
        Assert.Equal(TerminalColor.Default, b.GetAttr(3, 0).Foreground);
    }

    [Fact]
    public void Sgr_ReverseFlag()
    {
        var (b, p) = NewTerm();
        Feed(p, "\u001b[7mX\u001b[27mY");
        Assert.True(b.GetAttr(0, 0).Reverse);
        Assert.False(b.GetAttr(1, 0).Reverse);
    }

    [Fact]
    public void Sgr_EmptyIsReset()
    {
        var (b, p) = NewTerm();
        Feed(p, "\u001b[1mX\u001b[mY");
        Assert.True(b.GetAttr(0, 0).Bold);
        Assert.False(b.GetAttr(1, 0).Bold);
    }

    // ---- 模式开关 ----

    [Fact]
    public void CursorHideShow()
    {
        var (b, p) = NewTerm();
        Feed(p, "\u001b[?25l");
        Assert.False(b.CursorVisible);
        Feed(p, "\u001b[?25h");
        Assert.True(b.CursorVisible);
    }

    [Fact]
    public void AppCursorKeys_Flag()
    {
        var (b, p) = NewTerm();
        Feed(p, "\u001b[?1h");
        Assert.True(b.ApplicationCursorKeys);
        Feed(p, "\u001b[?1l");
        Assert.False(b.ApplicationCursorKeys);
    }

    [Fact]
    public void BracketedPaste_Flag()
    {
        var (b, p) = NewTerm();
        Feed(p, "\u001b[?2004h");
        Assert.True(b.BracketedPaste);
        Feed(p, "\u001b[?2004l");
        Assert.False(b.BracketedPaste);
    }

    // ---- 备屏 ----

    [Fact]
    public void AltScreen_1049_SwitchAndRestore()
    {
        var (b, p) = NewTerm();
        Feed(p, "primary");
        Feed(p, "\u001b[?1049h");
        Assert.True(b.IsAlternateScreen);
        Assert.Equal("", Line(b, 0)); // 备屏清空
        Feed(p, "alt-text");
        Assert.Equal('a', b.GetChar(7, 0)); // 备屏光标保持原位（1049 只存不回位）
        Feed(p, "\u001b[?1049l");
        Assert.False(b.IsAlternateScreen);
        Assert.Equal("primary", Line(b, 0)); // 主屏内容保留
    }

    [Fact]
    public void AltScreen_NoScrollback()
    {
        var (b, p) = NewTerm(rows: 3);
        Feed(p, "\u001b[?1049h");
        for (var i = 0; i < 10; i++) Feed(p, $"x{i}\r\n");
        Assert.Equal(0, b.ScrollbackCount);
        Feed(p, "\u001b[?1049l");
    }

    // ---- UTF-8 / 宽字符 / 组合字符 ----

    [Fact]
    public void Utf8_Cjk3Byte_Decoded()
    {
        var (b, p) = NewTerm();
        Feed(p, "你好");
        Assert.Equal('你', b.GetChar(0, 0));
        Assert.Equal('好', b.GetChar(2, 0));
    }

    [Fact]
    public void Utf8_Emoji4Byte_Placed()
    {
        var (b, p) = NewTerm();
        Feed(p, "\U0001F600"); // 😀 是星面（代理对）——v1 存首代字符
        Assert.NotEqual(' ', b.GetChar(0, 0));
    }

    [Fact]
    public void CjkWide_OccupiesTwoCells()
    {
        var (b, p) = NewTerm();
        Feed(p, "你A");
        Assert.Equal('你', b.GetChar(0, 0));
        Assert.Equal(TerminalCell.WideContinuation, b.GetChar(1, 0));
        Assert.Equal('A', b.GetChar(2, 0));
        Assert.Equal((3, 0), b.Cursor);
    }

    [Fact]
    public void CjkWide_AtLastColumn_FillsBlankAndWraps()
    {
        var (b, p) = NewTerm(cols: 5);
        Feed(p, "abcd你");
        Assert.Equal(' ', b.GetChar(4, 0)); // 行尾放不下：末格补空白
        Assert.Equal('你', b.GetChar(0, 1));
        Assert.Equal(TerminalCell.WideContinuation, b.GetChar(1, 1));
    }

    [Fact]
    public void Utf8_SplitAcrossFeeds()
    {
        var (b, p) = NewTerm();
        var bytes = Encoding.UTF8.GetBytes("你");
        p.Feed(bytes[..1]);
        p.Feed(bytes[1..]); // 序列跨两次 Feed
        Assert.Equal('你', b.GetChar(0, 0));
    }

    [Fact]
    public void Utf8_InvalidSequence_ReplacedWithoutDesync()
    {
        var (b, p) = NewTerm();
        p.Feed(new byte[] { 0xE4, 0xBD }); // 截断的"你"
        p.Feed(new byte[] { 0xA0, (byte)'X' }); // 续上后 + ASCII
        Assert.Equal('你', b.GetChar(0, 0));
        Assert.Equal('X', b.GetChar(2, 0));
    }

    [Fact]
    public void CombiningChar_Ignored()
    {
        var (b, p) = NewTerm();
        Feed(p, "e\u0301X"); // é = e + U+0301 组合符
        Assert.Equal('e', b.GetChar(0, 0));
        Assert.Equal('X', b.GetChar(1, 0)); // 组合符不占格
    }

    // ---- 字符集选择 ----

    [Fact]
    public void CharsetSelection_BytesSwallowed()
    {
        var (b, p) = NewTerm();
        Feed(p, "\u001b(0ab"); // ESC ( 0 = DEC 特殊图形声明，0 应被吞
        Assert.Equal("ab", Line(b, 0));
        Assert.Equal('a', b.GetChar(0, 0));
    }

    // ---- DSR / DA 应答 ----

    [Fact]
    public void Dsr_CursorPosition_Response()
    {
        var (b, p) = NewTerm();
        string? response = null;
        p.ResponseReady += r => response = r;
        Feed(p, "\u001b[3;5H\u001b[6n");
        Assert.NotNull(response);
        Assert.Equal("\u001b[3;5R", response);
    }

    [Fact]
    public void Dsr_Status_Response()
    {
        var (b, p) = NewTerm();
        string? response = null;
        p.ResponseReady += r => response = r;
        Feed(p, "\u001b[5n");
        Assert.Equal("\u001b[0n", response);
    }

    [Fact]
    public void Da_Response()
    {
        var (b, p) = NewTerm();
        string? response = null;
        p.ResponseReady += r => response = r;
        Feed(p, "\u001b[c");
        Assert.Equal("\u001b[?1;2c", response);
    }

    // ---- 鲁棒性 ----

    [Fact]
    public void LongLine_ClampedWithoutWrapDisabled()
    {
        var (b, p) = NewTerm(cols: 10);
        Feed(p, "\u001b[?7l");
        Feed(p, new string('X', 100));
        Assert.Equal((9, 0), b.Cursor);
        Assert.Equal('X', b.GetChar(9, 0));
    }

    [Fact]
    public void IllegalCsiBytes_Dropped()
    {
        var (b, p) = NewTerm();
        Feed(p, "\u001b[3\x07;5H\u001b[2;3HX"); // BEL 非法字节使序列被丢，后续正常
        Assert.Equal('X', b.GetChar(2, 1));
    }

    [Fact]
    public void TabForwardBackward_CsiI_Z()
    {
        var (b, p) = NewTerm();
        var (b3, p3) = NewTerm(cols: 40);
        Feed(p3, "\u001b[2I"); // 前进 2 个制表位 → 第 16 列
        Assert.Equal((16, 0), b3.Cursor);
        Feed(p3, "X");
        Assert.Equal('X', b3.GetChar(16, 0));
        Feed(p3, "\u001b[2Z"); // 后退 2 个制表位 → 第 0 列
        Assert.Equal((0, 0), b3.Cursor);
        Feed(p3, "Y");
        Assert.Equal('Y', b3.GetChar(0, 0));
    }

    [Fact]
    public void Resize_PreservesTopLeftContent()
    {
        var (b, p) = NewTerm(cols: 10, rows: 4);
        Feed(p, "hello");
        b.Resize(20, 6);
        Assert.Equal("hello", Line(b, 0));
        Assert.Equal((5, 0), b.Cursor);
    }

    // ---- 性能基准（§8-S2b：10MB < 500ms）----

    [Fact]
    public void Perf_10MB_Under500Ms()
    {
        var (b, p) = NewTerm(cols: 120, rows: 30);
        // 构造 10MB 混合内容：彩色文本行 + 光标定位 + 偶发宽字符
        var chunk = new StringBuilder();
        while (chunk.Length < 64 * 1024)
        {
            chunk.Append("\u001b[1;32m[info]\u001b[0m 处理完成 step=").Append(chunk.Length % 1000)
                 .Append(" \u001b[38;5;208m⚠\u001b[0m done\r\n");
        }
        var chunkBytes = Encoding.UTF8.GetBytes(chunk.ToString());
        var total = 10L * 1024 * 1024;
        var sw = Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < 60_000)
        {
            var n = Math.Min(chunkBytes.Length, (int)Math.Min(int.MaxValue, total));
            p.Feed(chunkBytes.AsSpan(0, n));
            total -= n;
            if (total <= 0) break;
        }
        sw.Stop();
        Assert.True(total <= 0, "未能喂满 10MB");
#if DEBUG
        // Debug JIT 无内联，固有 ~1.4× 开销；预算以 Release 为准（verify 脚本用 Release 跑）
        Assert.True(sw.ElapsedMilliseconds < 1200, $"10MB 解析耗时 {sw.ElapsedMilliseconds} ms（Debug，Release 预算 500ms）");
#else
        Assert.True(sw.ElapsedMilliseconds < 500, $"10MB 解析耗时 {sw.ElapsedMilliseconds} ms，超过 500ms 预算");
#endif
    }
}
