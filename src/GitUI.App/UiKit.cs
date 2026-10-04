using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.UI;

namespace GitUI.App;

/// <summary>
/// "Gitter IDE" 主题共享令牌与控件工厂（v3，与 Themes/ThemeStyles.xaml 令牌一致）。
/// 分层实色：base（内容底）→ panel（侧边栏/工具条/状态栏）→ hover/selected；
/// 深色为第一主题，浅色按同结构映射。控件默认样式由 ThemeStyles.xaml 的隐式样式提供。
/// </summary>
public static class Ui
{
    // ---- 尺寸 ----
    public const double ControlHeight = 28;
    public const double NavRowHeight = 30;
    public const double StatusBarHeight = 26;
    public const double CornerRadius = 4;

    public static readonly FontFamily Mono = new("Cascadia Mono, Consolas");

    public static bool IsLight => Application.Current?.RequestedTheme != ApplicationTheme.Dark;

    // ---- 分层 ----
    public static SolidColorBrush Base => C(IsLight ? 0xFFFAFAFB : 0xFF1E1F22);
    public static SolidColorBrush Panel => C(IsLight ? 0xFFF7F8FA : 0xFF2B2D30);
    public static SolidColorBrush Hover => C(IsLight ? 0xFFEBECF0 : 0xFF393B40);
    public static SolidColorBrush Selected => C(IsLight ? 0xFFE0E2E8 : 0xFF43454A);
    public static SolidColorBrush Border => C(IsLight ? 0xFFE4E5E8 : 0xFF2E3033);
    public static SolidColorBrush BorderStrong => C(IsLight ? 0xFFD5D7DB : 0xFF43454A);

    // ---- 强调色 ----
    public static SolidColorBrush Accent => C(IsLight ? 0xFF2B6BE4 : 0xFF3574F0);
    public static SolidColorBrush AccentHover => C(IsLight ? 0xFF3D7AEA : 0xFF4682F2);
    public static SolidColorBrush AccentPressed => C(IsLight ? 0xFF2359C7 : 0xFF2B62C9);
    public static SolidColorBrush AccentSoft => C(IsLight ? 0x1F2B6BE4 : 0x333574F0);

    // ---- 文字 ----
    public static SolidColorBrush Text => C(IsLight ? 0xFF1F2328 : 0xFFDFE1E5);
    public static SolidColorBrush Text2 => C(IsLight ? 0xFF5C6167 : 0xFF9DA0A8);
    public static SolidColorBrush Text3 => C(IsLight ? 0xFF9DA0A8 : 0xFF6F737A);

    // ---- 语义 ----
    public static SolidColorBrush Green => C(IsLight ? 0xFF1A7F37 : 0xFF6FBF73);
    public static SolidColorBrush Red => C(IsLight ? 0xFFCF222E : 0xFFF75464);
    public static SolidColorBrush Amber => C(IsLight ? 0xFF96671E : 0xFFC8A35F);

    // ---- 徽标/chip ----
    public static SolidColorBrush ChipBlueBg => C(IsLight ? 0x1A2B6BE4 : 0x334C7DD4);
    public static SolidColorBrush ChipBlueFg => C(IsLight ? 0xFF1F5EDD : 0xFF8FB8E8);
    public static SolidColorBrush ChipPurpleBg => C(IsLight ? 0x1A6B1EA0 : 0x36B080FF);
    public static SolidColorBrush ChipPurpleFg => C(IsLight ? 0xFF7A3FC9 : 0xFFC9A2FF);
    public static SolidColorBrush OnAccent => C(0xFFFFFFFF);

    public static SolidColorBrush C(long argb) => new(Color.FromArgb(
        (byte)(argb >> 24), (byte)(argb >> 16), (byte)(argb >> 8), (byte)argb));

    // ---- 控件工厂 ----

    /// <summary>工具栏幽灵按钮：透明底、悬停由按钮模板 PointerOver 提亮，28px 高。</summary>
    public static Button ToolButton(string text, string? automationName = null)
    {
        var btn = new Button
        {
            Content = text,
            Background = C(0x00000000),
            BorderThickness = new Thickness(0),
            MinHeight = ControlHeight,
            Padding = new Thickness(10, 3, 10, 4),
            CornerRadius = new CornerRadius(CornerRadius),
            FontSize = 12.5,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(btn, automationName ?? text);
        return btn;
    }

    /// <summary>主按钮：全站唯一强调色填充（提交等主要动作）。</summary>
    public static Button PrimaryButton(string text, string? automationName = null)
    {
        var btn = ToolButton(text, automationName);
        btn.Background = Accent;
        btn.Foreground = OnAccent;
        btn.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold;
        btn.Padding = new Thickness(14, 3, 14, 4);
        btn.PointerEntered += (_, _) => { if (btn.IsEnabled) btn.Background = AccentHover; };
        btn.PointerExited += (_, _) => btn.Background = Accent;
        btn.IsEnabledChanged += (_, _) => btn.Background = Accent;
        return btn;
    }

    /// <summary>图标按钮（Segoe Fluent Icons 字形）。</summary>
    public static Button IconButton(string glyph, string automationName)
    {
        var btn = ToolButton(glyph, automationName);
        btn.FontFamily = new FontFamily("Segoe Fluent Icons, Segoe MDL2 Assets");
        btn.FontSize = 13;
        btn.Padding = new Thickness(7, 3, 7, 5);
        return btn;
    }

    /// <summary>提交行 SHA / 时间等展示型等宽 TextBlock。</summary>
    public static TextBlock MonoText(string text, double size, SolidColorBrush brush)
        => new() { Text = text, FontFamily = Mono, FontSize = size, Foreground = brush };
}

public static class UiExtensions
{
    /// <summary>给文本块加省略号裁剪（工具栏布局常用组合）。</summary>
    public static Microsoft.UI.Xaml.Controls.TextBlock Trim(this Microsoft.UI.Xaml.Controls.TextBlock tb)
    {
        tb.TextTrimming = Microsoft.UI.Xaml.TextTrimming.CharacterEllipsis;
        return tb;
    }
}
