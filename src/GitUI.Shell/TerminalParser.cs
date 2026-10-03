using System.Runtime.CompilerServices;
using System.Text;

namespace GitUI.Shell;

/// <summary>
/// 终端输出字节流 → <see cref="TerminalBuffer"/> 的状态机解析器（S2b，design.md §4.7.3）。
/// 支持范围（v1，对齐 §4.7.7 全屏程序要求）：
/// <list type="bullet">
///   <item>控制字符：BS TAB LF VT FF CR BEL NUL（忽略）SO/SI（忽略，无字符集切换）</item>
///   <item>ESC：7 8 D E H M c = > 以及 CSI/OSC 引导</item>
///   <item>CSI：A B C D E F G H I J K L M P S T m n r s u @ d h l（含 ? 私有序列：
///         1 应用光标键 / 5 反显 / 7 自动换行 / 25 光标显隐 / 47 1047 1049 备屏 / 2004 括号粘贴）</item>
///   <item>SGR：0 1 2 3 4 7 22 23 24 27 30-37 38;2;r;g;b 38;5;n 39 40-47 48;… 49 90-97 100-107</item>
///   <item>OSC 0/2 标题</item>
///   <item>UTF-8 多字节（增量解码，跨 Feed 的截断序列缓存）、CJK 宽字符（占两格）、组合字符（忽略）</item>
///   <item>DSR/DA 应答（CSI 6n / CSI c → <see cref="ResponseReady"/>，由宿主写回 PTY）</item>
/// </list>
/// 线程安全：非线程安全，Feed 必须与渲染读串行（宿主负责）。
/// </summary>
public sealed class TerminalParser
{
    private enum State
    {
        Ground,
        Escape,
        CsiEntry,
        CsiIgnore,
        Osc,
    }

    private readonly TerminalBuffer _buffer;
    private readonly Decoder _decoder = Encoding.UTF8.GetDecoder();
    private readonly byte[] _pending = new byte[4];
    private int _pendingCount;

    private State _state = State.Ground;
    private int _paramCount;
    private int _p0, _p1, _p2, _p3, _p4;
    private int _csiCurrentParam = -1; // -1 = 还没开始 / 空 param
    private bool _csiPrivate;          // '?' 前缀
    private char _csiIntermediate;     // ' ' '!' 等（v1 只记不用于分发）
    private readonly StringBuilder _oscText = new();

    /// <summary>解析器需要写回 PTY 的应答（DSR 光标位置 / DA），宿主订阅并 Write。</summary>
    public event Action<string>? ResponseReady;

    public TerminalParser(TerminalBuffer buffer)
    {
        _buffer = buffer ?? throw new ArgumentNullException(nameof(buffer));
    }

    public TerminalBuffer Buffer => _buffer;

    /// <summary>喂入字节流。跨调用的 UTF-8 截断序列与转义序列状态均保留。</summary>
    public void Feed(ReadOnlySpan<byte> data)
    {
        var offset = 0;
        while (offset < data.Length)
        {
            // 字符集选择 / OSC ST 吞字节：优先于一切状态（可打印字节也要吞）
            if (_skipNext)
            {
                _skipNext = false;
                _state = State.Ground; // charset 描述符 / OSC ST 消费后恢复 Ground
                offset++;
                continue;
            }

            if (_state != State.Ground)
            {
                // 转义/CSI/OSC 状态只在 ASCII 域处理
                var b = data[offset++];
                FeedControlOrEscapeByte(b);
                continue;
            }

            // Ground：连续 ASCII 控制字节单独处理，其余批量 UTF-8 解码
            var start = offset;
            while (offset < data.Length && data[offset] >= 0x20 && data[offset] != 0x7f)
                offset++;

            if (offset > start)
            {
                DecodeAndEmit(data.Slice(start, offset - start));
            }

            if (offset < data.Length)
            {
                var b = data[offset++];
                if (b == 0x7f || b == 0x00)
                    continue; // DEL / NUL 忽略
                FeedControlOrEscapeByte(b);
            }
        }
    }

    // ---- UTF-8 增量解码 ----

    private void DecodeAndEmit(ReadOnlySpan<byte> bytes)
    {
        // 先消化上次残留的部分序列
        if (_pendingCount > 0)
        {
            var need = Math.Min(bytes.Length, _pending.Length - _pendingCount);
            bytes[..need].CopyTo(_pending.AsSpan(_pendingCount));
            _pendingCount += need;
            bytes = bytes[need..];

            if (!TryDecodePending(out var completed))
            {
                return; // 还不够
            }
            _pendingCount = 0;
            if (completed.Length > 0)
                DecodeAndEmitCore(completed.Span);

            if (bytes.IsEmpty) return;
        }

        // 从尾部找可能被截断的多字节序列前缀
        var complete = bytes.Length;
        for (var i = 1; i <= Math.Min(3, bytes.Length); i++)
        {
            var b = bytes[^i];
            if ((b & 0xC0) == 0x80) continue; // 续字节
            var lead = b;
            var expected = lead >= 0xF0 ? 4 : lead >= 0xE0 ? 3 : lead >= 0xC0 ? 2 : 1;
            if (expected > 1 && i < expected)
            {
                // 尾部 i 字节是一个被截断的序列
                var head = bytes[..^i];
                if (head.Length > 0) DecodeAndEmitCore(head);
                bytes[^i..].CopyTo(_pending);
                _pendingCount = i;
                return;
            }
            break;
        }

        DecodeAndEmitCore(bytes);
    }

    private bool TryDecodePending(out ReadOnlyMemory<byte> completed)
    {
        var chars = new char[4];
        _decoder.Convert(_pending.AsSpan(0, _pendingCount), chars, false, out var bytesUsed, out _, out var completed2);
        completed = completed2
            ? _pending.AsMemory(0, bytesUsed)
            : _pending.AsMemory(0, 0);
        return completed2;
    }

    private void DecodeAndEmitCore(ReadOnlySpan<byte> bytes)
    {
        // ASCII 快路径（shell 输出绝大多数字节 < 0x80）：跳过 Decoder 与组合/宽字符检查
        var allAscii = true;
        foreach (var b in bytes)
        {
            if (b >= 0x80) { allAscii = false; break; }
        }

        if (allAscii)
        {
            foreach (var b in bytes)
            {
                if (b >= 0x20 && b != 0x7f)
                {
                    _buffer.PutChar((char)b, wide: false);
                }
                else
                {
                    HandleControlChar((char)b);
                }
            }
            return;
        }

        var charCount = Encoding.UTF8.GetMaxCharCount(bytes.Length);
        var chars = charCount <= 256 ? stackalloc char[256] : new char[charCount];
        _decoder.Convert(bytes, chars, true, out var bytesUsed, out var charsUsed, out _);
        EmitDecoded(chars[..charsUsed]);
    }

    /// <summary>已解码字符批：可见字符直接落格，控制字符单独处理。</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private void EmitDecoded(ReadOnlySpan<char> chars)
    {
        foreach (var ch in chars)
        {
            if (ch >= ' ')
            {
                // 组合字符（v1 策略：忽略，避免破坏网格对齐）
                if (IsCombining(ch)) continue;
                _buffer.PutChar(ch, IsWide(ch));
                continue;
            }

            HandleControlChar(ch);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static bool IsWide(char ch) =>
        ch >= 0x1100 && (
            (ch <= 0x115F) ||                                   // Hangul Jamo
            (ch >= 0x2E80 && ch <= 0xA4CF && ch != 0x303F) ||   // CJK 部首～Yi
            (ch >= 0xAC00 && ch <= 0xD7A3) ||                   // Hangul 音节
            (ch >= 0xF900 && ch <= 0xFAFF) ||                   // CJK 兼容表意
            (ch >= 0xFE30 && ch <= 0xFE4F) ||                   // CJK 兼容形式
            (ch >= 0xFF00 && ch <= 0xFF60) ||                   // 全角形式
            (ch >= 0xFFE0 && ch <= 0xFFE6));                    // 全角符号

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static bool IsCombining(char ch) =>
        (ch >= 0x0300 && ch <= 0x036F) ||                       // 组合附加符号
        (ch >= 0x200B && ch <= 0x200F);                         // 零宽字符/方向标记

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private void HandleControlChar(char ch)
    {
        switch (ch)
        {
            case '\r':
                _buffer.CarriageReturn();
                break;
            case '\n':
            case '\v':
            case '\f':
                _buffer.LineFeed();
                break;
            case '\b':
                _buffer.Backspace();
                break;
            case '\t':
                _buffer.Tab();
                break;
            case '\a':
                break; // BEL：v1 不响铃
            case (char)0x0e:
            case (char)0x0f:
                break; // SO/SI：字符集切换，v1 忽略
            case (char)0x1b:
                _state = State.Escape;
                break;
        }
    }

    // ---- 转义/CSI/OSC 状态机 ----

    private void FeedControlOrEscapeByte(byte b)
    {
        if (_skipNext)
        {
            // 字符集选择 ESC ( X / OSC 以 ESC 终止后吞掉一个字节（通常是 '\'）
            _skipNext = false;
            if (_state != State.Ground) _state = State.Ground;
            return;
        }

        // 非引导状态下内嵌控制字符：CSI/OSC 内的 CR/LF 等按 xterm 行为在 OSC 中终止/忽略
        switch (_state)
        {
            case State.Ground:
                HandleControlChar((char)b);
                return;
            case State.Escape:
                HandleEscapeByte(b);
                return;
            case State.CsiEntry:
            case State.CsiIgnore:
                HandleCsiByte(b);
                return;
            case State.Osc:
                HandleOscByte(b);
                return;
        }
    }

    private void HandleEscapeByte(byte b)
    {
        switch (b)
        {
            case (byte)'[':
                _state = State.CsiEntry;
                _paramCount = 0;
                _p0 = _p1 = _p2 = _p3 = _p4 = -1;
                _csiCurrentParam = -1;
                _csiPrivate = false;
                _csiIntermediate = default;
                return;
            case (byte)']':
                _state = State.Osc;
                _oscText.Clear();
                return;
            case (byte)'7': // DECSC 保存光标
                _buffer.SaveCursor();
                _state = State.Ground;
                return;
            case (byte)'8': // DECRC 恢复光标
                _buffer.RestoreCursor();
                _state = State.Ground;
                return;
            case (byte)'D': // IND 下移
                _buffer.LineFeed();
                _state = State.Ground;
                return;
            case (byte)'M': // RI 上移
                _buffer.ReverseIndex();
                _state = State.Ground;
                return;
            case (byte)'E': // NEL
                _buffer.CarriageReturn();
                _buffer.LineFeed();
                _state = State.Ground;
                return;
            case (byte)'c': // RIS 全量重置
                _buffer.Reset();
                _state = State.Ground;
                return;
            case (byte)'=': // 应用小键盘
            case (byte)'>': // 数字小键盘
                _state = State.Ground;
                return;
            case (byte)'(' or (byte)')': // 字符集选择：吞掉下一个描述符字节，v1 无字符集切换
                _skipNext = true;
                return;
            default:
                _state = State.Ground;
                return;
        }
    }

    private bool _skipNext;

    private void HandleCsiByte(byte b)
    {
        if (_skipNext)
        {
            _skipNext = false;
            _state = State.Ground;
            return;
        }

        if (b is >= (byte)'0' and <= (byte)'9')
        {
            if (_csiCurrentParam < 0) _csiCurrentParam = 0;
            _csiCurrentParam = _csiCurrentParam * 10 + (b - (byte)'0');
            return;
        }
        if (b == (byte)';')
        {
            CommitParam();
            _csiCurrentParam = -1;
            return;
        }
        if (b == (byte)'?' || b == (byte)'>' || b == (byte)'<' || b == (byte)'=')
        {
            _csiPrivate = true;
            return;
        }
        if (b is >= 0x20 and <= 0x2F)
        {
            _csiIntermediate = (char)b; // 中间字节（v1 记录，SP q 等）
            return;
        }
        if (b >= 0x40 && b <= 0x7E)
        {
            // 终结字节：分发
            if (_csiCurrentParam >= 0)
                CommitParam();
            _csiCurrentParam = -1;
            if (_state == State.CsiIgnore)
            {
                _state = State.Ground;
                return;
            }
            DispatchCsi((char)b);
            _state = State.Ground;
            return;
        }

        // 非法字节（含内嵌 CR/LF 等控制）→ 丢弃整个序列
        _state = State.CsiIgnore;
        if (b is 0x18 or 0x1A)
            _state = State.Ground;
        else if (b == 0x1B)
            _state = State.Escape;
    }

    private void CommitParam()
    {
        var v = Math.Max(0, _csiCurrentParam);
        switch (_paramCount)
        {
            case 0: _p0 = v; break;
            case 1: _p1 = v; break;
            case 2: _p2 = v; break;
            case 3: _p3 = v; break;
            case 4: _p4 = v; break;
            default: _p4 = v; break; // 超出槽位的参数罕见，覆盖最后一个
        }
        _paramCount++;
        _csiCurrentParam = -1;
    }

    /// <summary>已提交参数的枚举（零分配；最多 8 个槽位）。</summary>
    private IEnumerable<int> ParamSpan()
    {
        for (var i = 0; i < _paramCount; i++) yield return ParamAt(i);
    }

    private int ParamAt(int i) => i switch
    {
        0 => _p0,
        1 => _p1,
        2 => _p2,
        3 => _p3,
        _ => _p4,
    };

    private int ParamOrZero() => _paramCount > 0 ? ParamAt(0) : 0;

    private int Param(int index, int fallback)
    {
        var v = index switch
        {
            0 => _p0,
            1 => _p1,
            2 => _p2,
            3 => _p3,
            _ => _p4,
        };
        return v <= 0 ? fallback : v;
    }

    private void DispatchCsi(char final)
    {
        // 私有序列 ?…
        if (_csiPrivate)
        {
            var enable = final == 'h';
            var disable = final == 'l';
            if (enable || disable)
            {
                foreach (var p in ParamSpan())
                {
                    switch (p)
                    {
                        case 1: _buffer.ApplicationCursorKeys = enable; break;
                        case 5: _buffer.ReverseVideo = enable; break;
                        case 6: _originMode = enable; break;
                        case 7: _buffer.AutoWrap = enable; break;
                        case 25: _buffer.CursorVisible = enable; break;
                        case 47: _buffer.SetAlternateScreen(enable, saveCursor: false); break;
                        case 1047: _buffer.SetAlternateScreen(enable, saveCursor: false); break;
                        case 1049: _buffer.SetAlternateScreen(enable, saveCursor: true); break;
                        case 2004: _buffer.BracketedPaste = enable; break;
                    }
                }
            }
            return;
        }

        switch (final)
        {
            case 'A': MoveCursor(0, -Param(0, 1)); break;
            case 'B': MoveCursor(0, Param(0, 1)); break;
            case 'C': MoveCursor(Param(0, 1), 0); break;
            case 'D': MoveCursor(-Param(0, 1), 0); break;
            case 'E': MoveTo(0, CursorRow() + Param(0, 1)); break;
            case 'F': MoveTo(0, CursorRow() - Param(0, 1)); break;
            case 'G': MoveTo(Param(0, 1) - 1, CursorRow()); break;
            case '`': MoveTo(Param(0, 1) - 1, CursorRow()); break;
            case 'd': MoveTo(CursorCol(), Param(0, 1) - 1); break;
            case 'H':
            case 'f': MoveTo(Param(1, 1) - 1, Param(0, 1) - 1); break;

            case 'J': _buffer.EraseDisplay(ParamOrZero()); break;
            case 'K': _buffer.EraseLine(ParamOrZero()); break;

            case 'L': _buffer.InsertLines(Param(0, 1)); break;
            case 'M': _buffer.DeleteLines(Param(0, 1)); break;
            case '@': _buffer.InsertChars(Param(0, 1)); break;
            case 'P': _buffer.DeleteChars(Param(0, 1)); break;

            case 'S': _buffer.ScrollUp(Param(0, 1)); break;   // 滚动区上滚（与光标无关）
            case 'T': _buffer.ScrollDown(Param(0, 1)); break; // 滚动区下滚

            case 'r': // DECSTBM 滚动区
                _buffer.SetScrollRegion(Param(0, 1) - 1, Param(1, _buffer.Rows) - 1);
                MoveTo(0, 0);
                break;

            case 's': _buffer.SaveCursor(); break;
            case 'u': _buffer.RestoreCursor(); break;

            case 'm': DispatchSgr(); break;

            case 'n': // DSR
                if (ParamOrZero() == 6)
                    ResponseReady?.Invoke($"\x1b[{CursorRow() + 1};{CursorCol() + 1}R");
                else if (ParamOrZero() == 5)
                    ResponseReady?.Invoke("\x1b[0n");
                break;

            case 'c': // DA 主设备属性
                var first = ParamOrZero();
                if (first == 0)
                    ResponseReady?.Invoke("\x1b[?1;2c");
                break;

            case 'I': // 前向制表
                for (var i = 0; i < Param(0, 1); i++) _buffer.Tab();
                break;

            case 'Z': // 反向制表
                for (var i = 0; i < Param(0, 1); i++)
                {
                    var (col, row) = _buffer.Cursor;
                    MoveTo(Math.Max(0, ((col / 8) - 1) * 8), row);
                }
                break;
        }
    }

    private int CursorCol() => _buffer.Cursor.Col;
    private int CursorRow() => _buffer.Cursor.Row;

    private void MoveCursor(int dc, int dr)
    {
        var (col, row) = _buffer.Cursor;
        MoveTo(col + dc, row + dr);
    }

    private void MoveTo(int col, int row)
    {
        col = Math.Clamp(col, 0, _buffer.Columns - 1);
        // origin mode（DECOM）：行参数相对滚动区顶
        if (_originMode)
            row = _buffer.ScrollRegionTop + row;
        row = Math.Clamp(row, 0, _buffer.Rows - 1);
        _buffer.SetCursor(col, row);
    }

    private bool _originMode;

    // SGR 序列 memo：参数向量 → 属性索引（shell 输出反复使用少数几种属性，
    // 命中后零分配；record 分配 + 字典驻留曾占 10MB 解析 ~300ms）
    private readonly Dictionary<(int, int, int, int, int, int), int> _sgrCache = new();

    private (int, int, int, int, int, int) SgrKey()
    {
        return (Pad(0), Pad(1), Pad(2), Pad(3), Pad(4), _paramCount);

        int Pad(int i) => ParamAt(i);
    }

    private void DispatchSgr()
    {
        var key = SgrKey();
        if (_sgrCache.TryGetValue(key, out var cachedIdx))
        {
            _buffer.CurrentAttrIndex = cachedIdx;
            return;
        }

        if (_paramCount == 0)
        {
            var normalIdx = _buffer.InternAttr(SgrAttribute.Normal);
            _sgrCache[key] = normalIdx;
            _buffer.CurrentAttrIndex = normalIdx;
            return;
        }

        var attr = _buffer.AttrByIndex(_buffer.CurrentAttrIndex);
        for (var i = 0; i < _paramCount; i++)
        {
            var p = ParamAt(i);
            switch (p)
            {
                case 0:
                    attr = SgrAttribute.Normal;
                    break;
                case 1: attr = attr with { Bold = true }; break;
                case 2: attr = attr with { Dim = true }; break;
                case 3: attr = attr with { Italic = true }; break;
                case 4: attr = attr with { Underline = true }; break;
                case 7: attr = attr with { Reverse = true }; break;
                case 22: attr = attr with { Bold = false, Dim = false }; break;
                case 23: attr = attr with { Italic = false }; break;
                case 24: attr = attr with { Underline = false }; break;
                case 27: attr = attr with { Reverse = false }; break;

                case 39: attr = attr with { Foreground = TerminalColor.Default }; break;
                case 49: attr = attr with { Background = TerminalColor.Default }; break;

                case >= 30 and <= 37: attr = attr with { Foreground = TerminalColor.FromIndexed(p - 30) }; break;
                case >= 90 and <= 97: attr = attr with { Foreground = TerminalColor.FromIndexed(p - 90 + 8) }; break;
                case >= 40 and <= 47: attr = attr with { Background = TerminalColor.FromIndexed(p - 40) }; break;
                case >= 100 and <= 107: attr = attr with { Background = TerminalColor.FromIndexed(p - 100 + 8) }; break;

                case 38:
                case 48:
                {
                    var isFg = p == 38;
                    var color = ParseExtendedColor(_paramCount, ParamAt, ref i);
                    if (color is not null)
                        attr = isFg ? attr with { Foreground = color.Value } : attr with { Background = color.Value };
                    break;
                }
            }
        }
        var idx = _buffer.InternAttr(attr);
        _sgrCache[key] = idx;
        _buffer.CurrentAttrIndex = idx;
    }

    private static TerminalColor? ParseExtendedColor(int count, Func<int, int> at, ref int i)
    {
        if (i + 1 >= count) return null;
        switch (at(i + 1))
        {
            case 5: // 256 色
                if (i + 2 >= count) return null;
                var idx = at(i + 2);
                i += 2;
                return TerminalColor.FromIndexed(idx);
            case 2: // RGB
                if (i + 4 >= count) return null;
                var color = TerminalColor.FromRgb(
                    (byte)Math.Clamp(at(i + 2), 0, 255),
                    (byte)Math.Clamp(at(i + 3), 0, 255),
                    (byte)Math.Clamp(at(i + 4), 0, 255));
                i += 4;
                return color;
            default:
                return null;
        }
    }

    private void HandleOscByte(byte b)
    {
        if (b == 0x07) // BEL 终止
        {
            FinishOsc();
            return;
        }
        if (b == 0x1B) // ESC 终止（ESC \）：吞掉后续的 '\'；裸 ESC 亦吞掉一字节（容错）
        {
            _skipNext = true;
            FinishOsc();
            return;
        }
        if (b is >= 0x20) _oscText.Append((char)b);
    }

    private void FinishOsc()
    {
        _state = State.Ground;
        var text = _oscText.ToString();
        if (text.StartsWith("0;", StringComparison.Ordinal) || text.StartsWith("2;", StringComparison.Ordinal))
        {
            _buffer.Title = text[2..];
        }
        _oscText.Clear();
    }
}
