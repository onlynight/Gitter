using Microsoft.UI.Xaml.Media;
using Windows.UI;

namespace GitUI.Controls.Theme;

/// <summary>主题基座：语义令牌的两套内置配色族。</summary>
public enum ThemeBase
{
    Dark = 0,
    Light = 1,
}

/// <summary>语义令牌名（theme-framework.md §三）。只允许按流程新增，UI 一律引用令牌而非字面色。</summary>
public enum TokenKey
{
    Base,
    Panel,
    Hover,
    Selected,
    Border,
    BorderStrong,
    Accent,
    AccentHover,
    AccentPressed,
    AccentSoft,
    OnAccent,
    Text,
    Text2,
    Text3,
    Green,
    Red,
    Amber,
    ChipBlueBg,
    ChipBlueFg,
    ChipPurpleBg,
    ChipPurpleFg,
}

/// <summary>
/// 主题令牌运行时：语义令牌 → 颜色的单一事实来源（theme-framework.md §四.1）。
/// 主题应用 = 整表 Load + 广播；UiKit / 页面 / 画布均经由本类取色。
/// 必须在 UI 线程调用（SolidColorBrush 的创建绑定 UI 线程）。
/// </summary>
public static class TokenRuntime
{
    private static IReadOnlyDictionary<TokenKey, Color> _colors = BuiltinDefaults(ThemeBase.Dark);
    private static Dictionary<TokenKey, SolidColorBrush> _brushCache = new();

    /// <summary>当前活动基座（决定框架键推导的明暗族）。</summary>
    public static ThemeBase CurrentBase { get; private set; } = ThemeBase.Dark;

    /// <summary>令牌表整体更换后广播（同一基座换包不触发框架 ActualThemeChanged，消费方需自行订阅）。</summary>
    public static event Action? ThemeChanged;

    /// <summary>装载活动主题的完整令牌表（含继承合并后的最终值）。</summary>
    public static void Load(ThemeBase baseKind, IReadOnlyDictionary<TokenKey, Color> colors)
    {
        CurrentBase = baseKind;
        _colors = colors;

        // 就地变更已缓存画刷的颜色（而非替换实例）：
        // 页面构建时持有的画刷引用自动跟随新主题重绘，无需逐元素重建
        foreach (var (key, brush) in _brushCache)
        {
            if (_colors.TryGetValue(key, out var c))
            {
                brush.Color = c;
            }
        }

        ThemeChanged?.Invoke();
    }

    public static Color Get(TokenKey key) =>
        _colors.TryGetValue(key, out var c) ? c : Color.FromArgb(0, 0, 0, 0);

    public static SolidColorBrush Brush(TokenKey key)
    {
        if (_brushCache.TryGetValue(key, out var b))
        {
            return b;
        }

        b = new SolidColorBrush(Get(key));
        _brushCache[key] = b;
        return b;
    }

    /// <summary>内置基座缺省令牌（与 theme.json 内置包一致；仅作装载失败时的兜底）。</summary>
    public static IReadOnlyDictionary<TokenKey, Color> BuiltinDefaults(ThemeBase baseKind)
    {
        Dictionary<TokenKey, Color> d = new();
        void S(TokenKey k, uint dark, uint light) =>
            d[k] = baseKind == ThemeBase.Light
                ? Color.FromArgb((byte)(light >> 24), (byte)(light >> 16), (byte)(light >> 8), (byte)light)
                : Color.FromArgb((byte)(dark >> 24), (byte)(dark >> 16), (byte)(dark >> 8), (byte)dark);
        S(TokenKey.Base, 0xFF1E1F22, 0xFFFFFFFF);
        S(TokenKey.Panel, 0xFF2B2D30, 0xFFF7F8FA);
        S(TokenKey.Hover, 0xFF393B40, 0xFFEBECF0);
        S(TokenKey.Selected, 0xFF43454A, 0xFFE0E2E8);
        S(TokenKey.Border, 0xFF2E3033, 0xFFE6E7EA);
        S(TokenKey.BorderStrong, 0xFF43454A, 0xFFD5D7DB);
        S(TokenKey.Accent, 0xFF3574F0, 0xFF2B6BE4);
        S(TokenKey.AccentHover, 0xFF4682F2, 0xFF3D7AEA);
        S(TokenKey.AccentPressed, 0xFF2B62C9, 0xFF2359C7);
        S(TokenKey.AccentSoft, 0x333574F0, 0x1F2B6BE4);
        S(TokenKey.OnAccent, 0xFFFFFFFF, 0xFFFFFFFF);
        S(TokenKey.Text, 0xFFDFE1E5, 0xFF1F2328);
        S(TokenKey.Text2, 0xFF9DA0A8, 0xFF5C6167);
        S(TokenKey.Text3, 0xFF6F737A, 0xFF9DA0A8);
        S(TokenKey.Green, 0xFF6FBF73, 0xFF1A7F37);
        S(TokenKey.Red, 0xFFF75464, 0xFFCF222E);
        S(TokenKey.Amber, 0xFFC8A35F, 0xFF96671E);
        S(TokenKey.ChipBlueBg, 0x334C7DD4, 0x1A2B6BE4);
        S(TokenKey.ChipBlueFg, 0xFF8FB8E8, 0xFF1F5EDD);
        S(TokenKey.ChipPurpleBg, 0x36B080FF, 0x1A6B1EA0);
        S(TokenKey.ChipPurpleFg, 0xFFC9A2FF, 0xFF7A3FC9);
        return d;
    }
}
