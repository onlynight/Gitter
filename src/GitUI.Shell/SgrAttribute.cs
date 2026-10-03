namespace GitUI.Shell;

/// <summary>终端颜色：默认 / 16 色索引（0-15）/ RGB 直色（SGR 38/48;2 与 5）。</summary>
public readonly record struct TerminalColor(TerminalColorKind Kind, int Indexed, byte R, byte G, byte B)
{
    public static TerminalColor Default { get; } = new(TerminalColorKind.Default, 0, 0, 0, 0);

    public static TerminalColor FromIndexed(int index) =>
        new(TerminalColorKind.Indexed, index, 0, 0, 0);

    public static TerminalColor FromRgb(byte r, byte g, byte b) =>
        new(TerminalColorKind.Rgb, 0, r, g, b);
}

/// <summary>终端颜色类别。</summary>
public enum TerminalColorKind
{
    /// <summary>未设置（渲染时用调色板前景/背景）。</summary>
    Default = 0,

    /// <summary>16/256 色索引。</summary>
    Indexed = 1,

    /// <summary>RGB 直色。</summary>
    Rgb = 2,
}

/// <summary>
/// 单个字符格的 SGR 属性（SGR 序列作用结果）。
/// 引用类型（record 提供值相等）：同一属性运行内的字符共享同一实例，
/// 使 <see cref="TerminalCell"/> 保持 16 字节、全屏滚动的整块搬移成本可控。
/// Reverse 在渲染时交换前景/背景；Bold 渲染时加粗并提亮 0-7 前景。
/// </summary>
public sealed record SgrAttribute(
    bool Bold,
    bool Dim,
    bool Italic,
    bool Underline,
    bool Reverse,
    TerminalColor Foreground,
    TerminalColor Background)
{
    /// <summary>默认属性（无修饰、默认色）。</summary>
    public static SgrAttribute Normal { get; } =
        new(false, false, false, false, false, TerminalColor.Default, TerminalColor.Default);
}
