namespace GitUI.Diff.Render;

/// <summary>不透明的 RGBA 颜色（渲染管线与 Headless 测试共用，不依赖 Windows.UI）。</summary>
public readonly record struct RgbaColor(byte A, byte R, byte G, byte B)
{
    public static RgbaColor FromArgb(byte a, byte r, byte g, byte b) => new(a, r, g, b);

    /// <summary>"#RRGGBB" 或 "#AARRGGBB"（不透明缺省）。</summary>
    public static RgbaColor Parse(string hex)
    {
        var s = hex.StartsWith('#') ? hex[1..] : hex;
        byte a = 0xFF, r, g, b;
        if (s.Length == 8)
        {
            a = Convert.ToByte(s[..2], 16);
            s = s[2..];
        }

        r = Convert.ToByte(s[..2], 16);
        g = Convert.ToByte(s[2..4], 16);
        b = Convert.ToByte(s[4..6], 16);
        return new RgbaColor(a, r, g, b);
    }
}

/// <summary>绘制命令携带的语义色种别（主题映射见 <see cref="DiffPalette"/>）。</summary>
public enum DiffColorKind
{
    Background,
    Foreground,
    LineNumberForeground,
    MutedForeground,
    AddedBackground,
    AddedWordBackground,
    AddedForeground,
    DeletedBackground,
    DeletedWordBackground,
    DeletedForeground,
    FillerBackground,
    HunkHeaderBackground,
    CurrentChangeBar,
}

/// <summary>
/// Diff 视图调色板：主题（浅色/深色）→ 语义色。取值参照 GitHub Diff / VSCode 的成熟配色。
/// 管线与测试只见语义种别，实际颜色集中在此处调。
/// </summary>
public sealed class DiffPalette
{
    private readonly RgbaColor[] _colors = new RgbaColor[Enum.GetValues<DiffColorKind>().Length];

    public static DiffPalette Light { get; } = Build(
        Background: "#FFFFFF",
        Foreground: "#1F2328",
        LineNumberForeground: "#6E7781",
        MutedForeground: "#59636E",
        AddedBackground: "#E6FFEC",
        AddedWordBackground: "#ABF2BC",
        AddedForeground: "#1A7F37",
        DeletedBackground: "#FFEBE9",
        DeletedWordBackground: "#FFB1A9",
        DeletedForeground: "#CF222E",
        FillerBackground: "#F6F8FA",
        HunkHeaderBackground: "#F6F8FA",
        CurrentChangeBar: "#0969DA");

    public static DiffPalette Dark { get; } = Build(
        Background: "#1E1E1E",
        Foreground: "#CCCCCC",
        LineNumberForeground: "#8B949E",
        MutedForeground: "#8B949E",
        AddedBackground: "#263D2C",
        AddedWordBackground: "#37563B",
        AddedForeground: "#3FB950",
        DeletedBackground: "#472B29",
        DeletedWordBackground: "#6D3331",
        DeletedForeground: "#F85149",
        FillerBackground: "#171717",
        HunkHeaderBackground: "#181818",
        CurrentChangeBar: "#4493F8");

    public RgbaColor this[DiffColorKind kind] => _colors[(int)kind];

    private static DiffPalette Build(
        string Background, string Foreground,
        string LineNumberForeground, string MutedForeground,
        string AddedBackground, string AddedWordBackground, string AddedForeground,
        string DeletedBackground, string DeletedWordBackground, string DeletedForeground,
        string FillerBackground, string HunkHeaderBackground, string CurrentChangeBar)
    {
        var p = new DiffPalette();
        p._colors[(int)DiffColorKind.Background] = RgbaColor.Parse(Background);
        p._colors[(int)DiffColorKind.Foreground] = RgbaColor.Parse(Foreground);
        p._colors[(int)DiffColorKind.LineNumberForeground] = RgbaColor.Parse(LineNumberForeground);
        p._colors[(int)DiffColorKind.MutedForeground] = RgbaColor.Parse(MutedForeground);
        p._colors[(int)DiffColorKind.AddedBackground] = RgbaColor.Parse(AddedBackground);
        p._colors[(int)DiffColorKind.AddedWordBackground] = RgbaColor.Parse(AddedWordBackground);
        p._colors[(int)DiffColorKind.AddedForeground] = RgbaColor.Parse(AddedForeground);
        p._colors[(int)DiffColorKind.DeletedBackground] = RgbaColor.Parse(DeletedBackground);
        p._colors[(int)DiffColorKind.DeletedWordBackground] = RgbaColor.Parse(DeletedWordBackground);
        p._colors[(int)DiffColorKind.DeletedForeground] = RgbaColor.Parse(DeletedForeground);
        p._colors[(int)DiffColorKind.FillerBackground] = RgbaColor.Parse(FillerBackground);
        p._colors[(int)DiffColorKind.HunkHeaderBackground] = RgbaColor.Parse(HunkHeaderBackground);
        p._colors[(int)DiffColorKind.CurrentChangeBar] = RgbaColor.Parse(CurrentChangeBar);
        return p;
    }
}
