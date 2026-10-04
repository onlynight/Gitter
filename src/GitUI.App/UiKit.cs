using GitUI.Controls.Theme;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.UI;

namespace GitUI.App;

/// <summary>
/// "Gitter IDE" 主题外观（UiKit）：语义令牌的 C# 取色入口。
/// 颜色值不在本类维护——全部经 <see cref="TokenRuntime"/> 来自活动主题包
/// （内置深/浅包见 Packages/；值与 docs/theme-framework.md 令牌表一致）。
/// 控件工厂沿用：ToolButton（幽灵）/ PrimaryButton（强调色填充）/ IconButton / MonoText。
/// </summary>
public static class Ui
{
    // ---- 尺寸 ----
    public const double ControlHeight = 28;
    public const double NavRowHeight = 30;
    public const double StatusBarHeight = 26;
    public const double CornerRadius = 4;

    public static readonly FontFamily Mono = new("Cascadia Mono, Consolas");

    public static bool IsLight => TokenRuntime.CurrentBase == ThemeBase.Light;

    // ---- 分层 ----
    public static SolidColorBrush Base => TokenRuntime.Brush(TokenKey.Base);
    public static SolidColorBrush Panel => TokenRuntime.Brush(TokenKey.Panel);
    public static SolidColorBrush Hover => TokenRuntime.Brush(TokenKey.Hover);
    public static SolidColorBrush Selected => TokenRuntime.Brush(TokenKey.Selected);
    public static SolidColorBrush Border => TokenRuntime.Brush(TokenKey.Border);
    public static SolidColorBrush BorderStrong => TokenRuntime.Brush(TokenKey.BorderStrong);

    // ---- 强调色 ----
    public static SolidColorBrush Accent => TokenRuntime.Brush(TokenKey.Accent);
    public static SolidColorBrush AccentHover => TokenRuntime.Brush(TokenKey.AccentHover);
    public static SolidColorBrush AccentPressed => TokenRuntime.Brush(TokenKey.AccentPressed);
    public static SolidColorBrush AccentSoft => TokenRuntime.Brush(TokenKey.AccentSoft);

    // ---- 文字 ----
    public static SolidColorBrush Text => TokenRuntime.Brush(TokenKey.Text);
    public static SolidColorBrush Text2 => TokenRuntime.Brush(TokenKey.Text2);
    public static SolidColorBrush Text3 => TokenRuntime.Brush(TokenKey.Text3);

    // ---- 语义 ----
    public static SolidColorBrush Green => TokenRuntime.Brush(TokenKey.Green);
    public static SolidColorBrush Red => TokenRuntime.Brush(TokenKey.Red);
    public static SolidColorBrush Amber => TokenRuntime.Brush(TokenKey.Amber);

    // ---- 徽标/chip ----
    public static SolidColorBrush ChipBlueBg => TokenRuntime.Brush(TokenKey.ChipBlueBg);
    public static SolidColorBrush ChipBlueFg => TokenRuntime.Brush(TokenKey.ChipBlueFg);
    public static SolidColorBrush ChipPurpleBg => TokenRuntime.Brush(TokenKey.ChipPurpleBg);
    public static SolidColorBrush ChipPurpleFg => TokenRuntime.Brush(TokenKey.ChipPurpleFg);
    public static SolidColorBrush OnAccent => TokenRuntime.Brush(TokenKey.OnAccent);

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

    /// <summary>主按钮：全站唯一强调色填充（提交等主要动作）。悬停/离场换 AccentHover/Accent。</summary>
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
