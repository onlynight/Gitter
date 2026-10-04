# patch-c1.py - theme package diff/terminal override sections
def patch(path, pairs):
    raw = open(path, "rb").read()
    bom = raw.startswith(b"\xef\xbb\xbf")
    s = raw.decode("utf-8-sig" if bom else "utf-8").replace("\r\n", "\n")
    for old, new in pairs:
        assert old in s, f"{path}: anchor missing: {old[:60]!r}"
        s = s.replace(old, new, 1)
    open(path, "wb").write((b"\xef\xbb\xbf" if bom else b"") + s.replace("\n", "\r\n").encode("utf-8"))
    print("patched", path)

# 1) DiffPalette：Clone + ApplyOverrides
patch("src/GitUI.Diff/Render/DiffPalette.cs", [
    ("""    public static DiffPalette Light { get; } = Build(""",
     """    /// <summary>复制一份（主题包覆盖前先克隆，避免污染 Light/Dark 静态单例）。</summary>
    public DiffPalette Clone() => new DiffPalette { _colors = (RgbaColor[])_colors.Clone() };

    /// <summary>主题包 diff 段覆盖：键 = DiffColorKind 名，值 = #RRGGBB/#AARRGGBB；无效键值忽略。</summary>
    public void ApplyOverrides(IReadOnlyDictionary<string, string>? overrides)
    {
        if (overrides is null) return;

        foreach (var (key, hex) in overrides)
        {
            if (!Enum.TryParse<DiffColorKind>(key, ignoreCase: true, out var kind)) continue;
            try { _colors[(int)kind] = RgbaColor.Parse(hex); } catch (FormatException) { }
        }
    }

    public static DiffPalette Light { get; } = Build("""),
])

# 2) ThemeDocument：diff / terminal 段
patch("src/GitUI.Controls/Theme/ThemeModels.cs", [
    ("""    /// <summary>框架键覆盖：键 = WinUI 主题资源名，值 = 颜色。缺省由 §四.3 推导。</summary>
    public Dictionary<string, string> Framework { get; set; } = new();""",
     """    /// <summary>框架键覆盖：键 = WinUI 主题资源名，值 = 颜色。缺省由 §四.3 推导。</summary>
    public Dictionary<string, string> Framework { get; set; } = new();

    /// <summary>diff 配色覆盖：键 = DiffColorKind 名（AddedBackground…），值 = 颜色。</summary>
    public Dictionary<string, string> Diff { get; set; } = new();

    /// <summary>终端配色覆盖：键 = background/foreground/cursor/selection/0..15，值 = 颜色。</summary>
    public Dictionary<string, string> Terminal { get; set; } = new();"""),
])

# 3) ThemeService：ActiveDiff / ActiveTerminal
patch("src/GitUI.Controls/Theme/ThemeService.cs", [
    ("""    /// <summary>活动主题的语法配色（styleKey → hex，含继承合并；代码高亮框架消费）。</summary>
    public static IReadOnlyDictionary<string, string> ActiveSyntax { get; private set; } =
        new Dictionary<string, string>();""",
     """    /// <summary>活动主题的语法配色（styleKey → hex，含继承合并；代码高亮框架消费）。</summary>
    public static IReadOnlyDictionary<string, string> ActiveSyntax { get; private set; } =
        new Dictionary<string, string>();

    /// <summary>活动主题的 diff 配色覆盖（DiffColorKind 名 → hex；DiffCanvas 消费）。</summary>
    public static IReadOnlyDictionary<string, string> ActiveDiff { get; private set; } =
        new Dictionary<string, string>();

    /// <summary>活动主题的终端配色覆盖（background/foreground/0..15 → hex；TerminalCanvas 消费）。</summary>
    public static IReadOnlyDictionary<string, string> ActiveTerminal { get; private set; } =
        new Dictionary<string, string>();"""),

    ("""            // 完全没有可用主题包：保留 TokenRuntime 兜底表
            ActiveSyntax = new Dictionary<string, string>();""",
     """            // 完全没有可用主题包：保留 TokenRuntime 兜底表
            ActiveSyntax = new Dictionary<string, string>();
            ActiveDiff = new Dictionary<string, string>();
            ActiveTerminal = new Dictionary<string, string>();"""),

    ("""        ActiveSyntax = ResolveSyntax(info);""",
     """        ActiveSyntax = ResolveSyntax(info);
        ActiveDiff = doc.Diff is null ? new Dictionary<string, string>() : new Dictionary<string, string>(doc.Diff);
        ActiveTerminal = doc.Terminal is null ? new Dictionary<string, string>() : new Dictionary<string, string>(doc.Terminal);"""),
])

# 4) DiffCanvas：ResolvePalette 应用覆盖
patch("src/GitUI.Controls/DiffCanvas.cs", [
    ("""    private DiffPalette ResolvePalette() =>
        ActualTheme == ElementTheme.Light ? DiffPalette.Light : DiffPalette.Dark;""",
     """    private DiffPalette ResolvePalette()
    {
        // 主题包 diff 段覆盖：克隆内置深/浅色板后应用（不污染静态单例）
        var palette = (ActualTheme == ElementTheme.Light ? DiffPalette.Light : DiffPalette.Dark).Clone();
        palette.ApplyOverrides(ThemeService.ActiveDiff);
        return palette;
    }"""),
])

# 5) TerminalPalette：WithOverrides（GitUI.Shell，自解析 hex，不引 Diff）
patch("src/GitUI.Shell/Render/TerminalRenderModel.cs", [
    ("""    private static uint Rgba(byte r, byte g, byte b, byte a = 255)
        => ((uint)a << 24) | ((uint)r << 16) | ((uint)g << 8) | b;""",
     """    private static uint Rgba(byte r, byte g, byte b, byte a = 255)
        => ((uint)a << 24) | ((uint)r << 16) | ((uint)g << 8) | b;

    /// <summary>
    /// 主题包 terminal 段覆盖（theme-framework.md §三）：键 = background/foreground/cursor/
    /// selection 或 "0".."15"，值 = #RRGGBB/#AARRGGBB。返回应用覆盖后的副本（不改静态单例）。
    /// </summary>
    public TerminalPalette WithOverrides(IReadOnlyDictionary<string, string>? overrides)
    {
        if (overrides is null || overrides.Count == 0) return this;

        var result = new TerminalPalette
        {
            BackgroundRgba = BackgroundRgba,
            ForegroundRgba = ForegroundRgba,
            CursorRgba = CursorRgba,
            SelectionRgba = SelectionRgba,
            Indexed = (uint[])Indexed.Clone(),
        };

        foreach (var (key, hex) in overrides)
        {
            uint rgba;
            try
            {
                var s = hex.StartsWith('#') ? hex[1..] : hex;
                if (s.Length == 8) s = s[2..]; // 丢弃 alpha
                var v = Convert.ToUInt32(s, 16);
                rgba = 0xFF000000 | (v & 0xFFFFFF);
            }
            catch
            {
                continue; // 无效颜色忽略
            }

            switch (key.ToLowerInvariant())
            {
                case "background": result = result with { BackgroundRgba = rgba }; break;
                case "foreground": result = result with { ForegroundRgba = rgba }; break;
                case "cursor": result = result with { CursorRgba = rgba }; break;
                case "selection": result = result with { SelectionRgba = rgba }; break;
                default:
                    if (int.TryParse(key, out var idx) && idx >= 0 && idx < 16)
                    {
                        result.Indexed[idx] = rgba;
                    }
                    break;
            }
        }

        return result;
    }"""),
])

# 6) TerminalCanvas：ResolvePalette 应用覆盖 + 主题包切换跟随
patch("src/GitUI.Controls/TerminalCanvas.cs", [
    ("""    private TerminalPalette ResolvePalette() =>
        ActualTheme == ElementTheme.Light ? TerminalPalette.Light : TerminalPalette.Dark;""",
     """    private TerminalPalette ResolvePalette()
    {
        // 主题包 terminal 段覆盖：克隆内置深/浅色板后应用（不污染静态单例）
        return (ActualTheme == ElementTheme.Light
            ? TerminalPalette.Light
            : TerminalPalette.Dark).WithOverrides(ThemeService.ActiveTerminal);
    }"""),
])
print("C1 all patched")
