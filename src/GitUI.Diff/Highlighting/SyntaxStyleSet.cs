using GitUI.Diff.Render;

namespace GitUI.Diff.Highlighting;

/// <summary>
/// 语法样式键 → 颜色。内置深浅两套缺省值与内置主题包的 syntax 段一致
/// （深色 = VS 深色系，亮色 = VS 亮色系）；主题包经 ApplyOverrides 覆盖任意键，
/// 未覆盖/未知键由调用方回退 plain（不 emit 着色 run）。
/// </summary>
public sealed class SyntaxStyleSet
{
    private readonly Dictionary<string, RgbaColor> _colors = new(StringComparer.OrdinalIgnoreCase);

    /// <param name="isLight">基座：决定缺省语法配色族（深色系/亮色系）。</param>
    public SyntaxStyleSet(bool isLight)
    {
        var light = isLight;
        void S(string key, string dark, string lightHex) =>
            _colors[key] = RgbaColor.Parse(light ? lightHex : dark);

        S("keyword", "#569CD6", "#0000FF");
        S("string", "#6A9955", "#A31515");
        S("comment", "#6A9955", "#008000");
        S("number", "#B5CEA8", "#098658");
        S("type", "#4EC9B0", "#263F8C");
        S("function", "#DCDCAA", "#263F8C");
        S("variable", "#9CDCFE", "#001080");
        S("operator", "#D4D4D4", "#1F2328");
        S("punctuation", "#D4D4D4", "#1F2328");
    }

    /// <summary>样式键解析；未知键返回 false（调用方回退 plain）。</summary>
    public bool TryGetColor(string styleKey, out RgbaColor color) =>
        _colors.TryGetValue(styleKey, out color);

    /// <summary>主题包 syntax 段覆盖（hex = #RRGGBB / #AARRGGBB；无效值忽略）。</summary>
    public void ApplyOverrides(IReadOnlyDictionary<string, string>? syntax)
    {
        if (syntax is null)
        {
            return;
        }

        foreach (var (key, hex) in syntax)
        {
            if (string.IsNullOrWhiteSpace(hex))
            {
                continue;
            }

            try
            {
                _colors[key] = RgbaColor.Parse(hex);
            }
            catch (FormatException)
            {
                // 无效颜色值忽略，保留缺省
            }
        }
    }
}
