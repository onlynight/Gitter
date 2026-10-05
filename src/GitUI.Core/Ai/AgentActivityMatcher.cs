using System.Text;

namespace GitUI.Core.Ai;

/// <summary>识别到的终端内 agent 活动。</summary>
public sealed record AgentActivity(string AgentId);

/// <summary>
/// 终端输出的 agent CLI 活动识别（ai-native-redesign.md §7.3，纯函数状态机）：
/// 对原始 PTY 字节流做最小 VT 剥离（丢弃 ESC 起始的控制序列），UTF-8 解码后滚动匹配
/// 已知 agent CLI 签名。命中上升沿时产出 <see cref="AgentActivity"/>；无超时语义——
/// 停止判定由调用方（终端页）配合会话存活状态处理。
/// </summary>
public sealed class AgentActivityMatcher
{
    /// <summary>签名表（小写比较）。可扩展为 .gpk policy 包的一部分。</summary>
    private static readonly (string AgentId, string[] Signatures)[] Known =
    {
        ("claude-code", new[] { "claude code", "claude-code", "✻ welcome to claude" }),
        ("codex", new[] { "codex cli", "openai codex", "codex --" }),
        ("deepseek", new[] { "deepseek agent", "deepseek-cli" }),
        ("gemini-cli", new[] { "gemini cli" }),
    };

    private const int TailCapacity = 4096;
    private readonly StringBuilder _tail = new();
    private string? _current;
    private byte[] _pending = Array.Empty<byte>();

    /// <summary>当前识别到的 agent；null = 无。</summary>
    public AgentActivity? Current => _current is null ? null : new AgentActivity(_current);

    /// <summary>喂入原始 PTY 输出；返回本次新识别到的活动（上升沿），否则 null。</summary>
    public AgentActivity? Feed(ReadOnlySpan<byte> data)
    {
        // 处理跨 Feed 的 UTF-8 截断：残尾字节留存
        var bytes = new byte[_pending.Length + data.Length];
        _pending.CopyTo(bytes, 0);
        data.CopyTo(bytes.AsSpan(_pending.Length));

        var complete = DecodeCompleteLength(bytes, out var usable);
        _pending = complete < bytes.Length ? bytes[complete..].ToArray() : Array.Empty<byte>();
        if (usable > 0) AppendText(StripEscape(bytes.AsSpan(0, usable)));

        var match = Match(_tail.ToString());
        if (match is not null && match != _current)
        {
            _current = match;
            return new AgentActivity(match);
        }
        return null;
    }

    /// <summary>清空状态（会话重启）。</summary>
    public void Reset()
    {
        _tail.Clear();
        _pending = Array.Empty<byte>();
        _current = null;
    }

    /// <summary>丢弃 ESC 控制序列（CSI/OSC 粗剥离：ESC 到首个终止字节之间不输出）。</summary>
    internal static string StripEscape(ReadOnlySpan<byte> data)
    {
        var sb = new StringBuilder(data.Length);
        var i = 0;
        while (i < data.Length)
        {
            var b = data[i];
            if (b == 0x1B) // ESC
            {
                i++;
                if (i < data.Length && data[i] == '[')
                {
                    i++; // CSI：直到 0x40..0x7E 终止字节
                    while (i < data.Length && (data[i] < 0x40 || data[i] > 0x7E)) i++;
                    i++;
                }
                else if (i < data.Length && data[i] == ']')
                {
                    i++; // OSC：直到 BEL 或 ST
                    while (i < data.Length && data[i] != 0x07)
                    {
                        if (data[i] == 0x1B && i + 1 < data.Length && data[i + 1] == '\\') { i += 2; break; }
                        i++;
                    }
                    if (i < data.Length && data[i] == 0x07) i++;
                }
                else
                {
                    i++; // 双字节转义（ESC 7 / ESC ( B 等）
                }
                continue;
            }
            if (b == 0x07 || b == 0x08 || b == 0x0D) { i++; continue; } // BEL/BS/CR 不参与匹配
            sb.Append((char)b); // 单字节 Latin-1 透传：ASCII 签名足够
            i++;
        }
        return sb.ToString();
    }

    private static int DecodeCompleteLength(byte[] bytes, out int usableBytes)
    {
        // 末尾不足的 UTF-8 序列不投喂（保留下轮）
        usableBytes = bytes.Length;
        var i = bytes.Length - 1;
        var continuation = 0;
        while (i >= 0 && continuation < 4)
        {
            var b = bytes[i];
            if ((b & 0xC0) == 0x80) { continuation++; i--; continue; }
            if ((b & 0x80) != 0)
            {
                var need = b >= 0xF0 ? 4 : b >= 0xE0 ? 3 : b >= 0xC0 ? 2 : 0;
                if (need > 0 && bytes.Length - i < need) usableBytes = i;
            }
            break;
        }
        return usableBytes;
    }

    private void AppendText(string text)
    {
        _tail.Append(text);
        if (_tail.Length > TailCapacity)
            _tail.Remove(0, _tail.Length - TailCapacity);
    }

    private static string? Match(string text)
    {
        if (text.Length == 0) return null;
        var lower = text.ToLowerInvariant();
        foreach (var (agentId, signatures) in Known)
            foreach (var sig in signatures)
                if (lower.Contains(sig, StringComparison.Ordinal))
                    return agentId;
        return null;
    }
}
