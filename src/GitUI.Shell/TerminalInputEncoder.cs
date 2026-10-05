using System.Runtime.InteropServices;

namespace GitUI.Shell;

/// <summary>
/// 键盘事件 → PTY 字节流编码（纯逻辑，headless 可测）。
/// 可打印字符经 ToUnicode 按"当前键盘状态 + 布局"解码——不能用 VirtualKey 枚举值直接转
/// char：字母区枚举值就是大写 ASCII（导致输入恒为大写），OEM 区（;:=,\ 等）枚举值对应
/// 的 Unicode 码位与实际字符无关（0xBA → 'º'）。
/// </summary>
public static class TerminalInputEncoder
{
    public const int VkShift = 0x10;
    public const int VkControl = 0x11;
    public const int VkMenu = 0x12;
    public const int VkCapital = 0x14;
    public const int VkNumLock = 0x90;

    // Windows.System.VirtualKey 的数值（GitUI.Shell 为纯 net8.0，不引用 WinRT 枚举）
    private const int VkUp = 38;
    private const int VkDown = 40;
    private const int VkRight = 39;
    private const int VkLeft = 37;
    private const int VkHome = 36;
    private const int VkEnd = 35;
    private const int VkEnter = 13;
    private const int VkBack = 8;
    private const int VkTab = 9;
    private const int VkEscape = 27;
    private const int VkA = 65;
    private const int VkZ = 90;

    /// <summary>修饰键状态（调用方从 InputKeyboardSource.Get*ForCurrentThread 采集）。</summary>
    public readonly record struct Modifiers(bool Ctrl, bool Shift, bool Alt, bool CapsLock, bool NumLock);

    /// <summary>
    /// 特殊键编码：方向键（应用光标键模式用 SS3）、回车/退格/Tab/Esc、Ctrl+字母 → 控制字符。
    /// 非特殊键返回 null（交由 <see cref="EncodePrintable"/>）。
    /// AltGr（Ctrl+Alt 同按，欧语布局产出替代符号）不算 Ctrl：否则 AltGr+Q 会错发 DC1。
    /// </summary>
    public static byte[]? EncodeSpecial(int key, bool appCursorKeys, in Modifiers mods)
    {
        byte[]? seq = key switch
        {
            VkUp => appCursorKeys ? [0x1b, (byte)'O', (byte)'A'] : [0x1b, (byte)'[', (byte)'A'],
            VkDown => appCursorKeys ? [0x1b, (byte)'O', (byte)'B'] : [0x1b, (byte)'[', (byte)'B'],
            VkRight => appCursorKeys ? [0x1b, (byte)'O', (byte)'C'] : [0x1b, (byte)'[', (byte)'C'],
            VkLeft => appCursorKeys ? [0x1b, (byte)'O', (byte)'D'] : [0x1b, (byte)'[', (byte)'D'],
            VkHome => appCursorKeys ? [0x1b, (byte)'O', (byte)'H'] : [0x1b, (byte)'[', (byte)'H'],
            VkEnd => appCursorKeys ? [0x1b, (byte)'O', (byte)'F'] : [0x1b, (byte)'[', (byte)'F'],
            VkEnter => [0x0d],
            VkBack => [0x7f],
            VkTab => [0x09],
            VkEscape => [0x1b],
            _ => null,
        };

        if (seq is null && mods.Ctrl && !mods.Alt && key is >= VkA and <= VkZ)
        {
            seq = [(byte)(key - VkA + 1)];
        }

        return seq;
    }

    /// <summary>
    /// 可打印键范围（画布按键分发用；最终字符由 <see cref="EncodePrintable"/> 的 ToUnicode
    /// 按布局决定，此处只做粗筛）：
    /// 0x20..0x6F = Space、数字、字母、小键盘区；
    /// 0xBA..0xE2 = OEM 标点区（; = , - . / ` [ \ ] ' 等）——
    /// 此前漏掉整个 OEM 区，- ; . / 等符号全部无法输入（VirtualKey.Divide=0x6F 是小键盘除号，
    /// 不是 OEM 上界）。
    /// </summary>
    public static bool IsPrintableKey(int key)
        => key is >= 0x20 and <= 0x6F or >= 0xBA and <= 0xE2;

    /// <summary>
    /// 可打印键 → 实际字符（ToUnicode 解码，遵循 Shift/CapsLock/NumLock/键盘布局）。
    /// 死键或无映射返回 null（v1 不上屏）。
    /// </summary>
    public static string? EncodePrintable(int key, uint scanCode, in Modifiers mods)
    {
        var state = new byte[256];
        if (mods.Shift) state[VkShift] = 0x80;
        if (mods.Ctrl) state[VkControl] = 0x80;
        if (mods.Alt) state[VkMenu] = 0x80;
        if (mods.CapsLock) state[VkCapital] = 0x01; // toggle 位
        if (mods.NumLock) state[VkNumLock] = 0x01;

        var chars = new char[8];
        var n = ToUnicode((uint)key, scanCode, state, chars, chars.Length, 0);
        if (n <= 0) return null;
        return new string(chars, 0, n);
    }

    [DllImport("user32.dll")]
    private static extern int ToUnicode(
        uint wVirtKey, uint wScanCode, byte[] lpKeyState, [Out] char[] pwszBuff, int cchBuff, uint wFlags);
}
