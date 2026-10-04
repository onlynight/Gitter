# assemble-theme.py - compose Themes/ThemeStyles.xaml (IDE v3) from extracted SDK templates
import io, re

D = "D:/Code/Gitter/design-mockups/templates"
OUT = "D:/Code/Gitter/src/GitUI.App/Themes/ThemeStyles.xaml"

def load(name, transforms=()):
    s = io.open(f"{D}/{name}", encoding="utf-8").read()
    idx = s.rfind("</Style>")
    s = s[:idx + len("</Style>")]  # drop trailing unrelated resources after the top-level style
    for pat, rep in transforms:
        s = re.sub(pat, rep, s)
    return s

button = load("button.xaml", [
    (r'<Style x:Key="DefaultButtonStyle" TargetType="Button">',
     '<Style TargetType="Button">\n        <Setter Property="MinHeight" Value="28" />\n        <Setter Property="FontSize" Value="12.5" />'),
])

textbox = load("textbox.xaml", [
    (r'<Style x:Key="DefaultTextBoxStyle" TargetType="TextBox">', '<Style TargetType="TextBox">'),
])

combobox = load("combobox.xaml", [
    (r'<Style x:Key="DefaultComboBoxStyle" TargetType="ComboBox">', '<Style TargetType="ComboBox">'),
])

comboitem = load("comboboxitem.xaml", [
    (r'<Style TargetType="ComboBoxItem" x:Key="DefaultComboBoxItemStyle">', '<Style TargetType="ComboBoxItem">'),
])

def dict_entries(pairs, indent="            "):
    return "\n".join(f"{indent}<{tag} x:Key=\"{k}\">{v}</{tag}>" for k, v, tag in pairs)

def brushes(pairs, indent="            "):
    return "\n".join(f'{indent}<SolidColorBrush x:Key="{k}" Color="{v}"/>' for k, v in pairs)

dark_tokens = [
    ("ControlCornerRadius", "4", "CornerRadius"),
    ("OverlayCornerRadius", "6", "CornerRadius"),
    ("ControlContentThemeFontSize", "13", "x:Double"),
]
dark_brushes = [
    # 分层底色
    ("ApplicationPageBackgroundThemeBrush", "#FF1E1F22"),
    ("CardBackgroundFillColorDefaultBrush", "#FF2B2D30"),
    ("CardBackgroundFillColorSecondaryBrush", "#FF313338"),
    # 强调色（固定 JetBrains 蓝，不跟随系统）
    ("SystemAccentColor", "#FF3574F0"),
    ("AccentFillColorDefaultBrush", "#FF3574F0"),
    ("AccentTextFillColorPrimaryBrush", "#FF6EA8FE"),
    ("TextControlSelectionHighlightColor", "#993574F0"),
    # Button
    ("ButtonBackground", "#FF2B2D30"),
    ("ButtonBackgroundPointerOver", "#FF393B40"),
    ("ButtonBackgroundPressed", "#FF43454A"),
    ("ButtonBackgroundDisabled", "#262B2D30"),
    ("ButtonBorderBrush", "#FF43454A"),
    ("ButtonBorderBrushPointerOver", "#FF5A5C61"),
    ("ButtonBorderBrushPressed", "#FF6A6C71"),
    ("ButtonBorderBrushDisabled", "#FF2E3033"),
    ("ButtonForeground", "#FFDFE1E5"),
    ("ButtonForegroundPointerOver", "#FFFFFFFF"),
    ("ButtonForegroundPressed", "#FFFFFFFF"),
    ("ButtonForegroundDisabled", "#FF6F737A"),
    # TextBox
    ("TextControlBackground", "#FF2B2D30"),
    ("TextControlBackgroundPointerOver", "#FF35373B"),
    ("TextControlBackgroundFocused", "#FF1E1F22"),
    ("TextControlBackgroundDisabled", "#262B2D30"),
    ("TextControlBorderBrush", "#FF43454A"),
    ("TextControlBorderBrushPointerOver", "#FF5A5C61"),
    ("TextControlBorderBrushFocused", "#FF3574F0"),
    ("TextControlBorderBrushDisabled", "#FF2E3033"),
    ("TextControlForeground", "#FFDFE1E5"),
    ("TextControlForegroundPointerOver", "#FFFFFFFF"),
    ("TextControlForegroundFocused", "#FFFFFFFF"),
    ("TextControlForegroundDisabled", "#FF6F737A"),
    ("TextControlPlaceholderForeground", "#FF6F737A"),
    ("TextControlPlaceholderForegroundPointerOver", "#FF6F737A"),
    ("TextControlPlaceholderForegroundFocused", "#FF7A7D83"),
    ("TextControlPlaceholderForegroundDisabled", "#FF5A5C61"),
    # ComboBox 收起态
    ("ComboBoxBackground", "#FF2B2D30"),
    ("ComboBoxBackgroundPointerOver", "#FF35373B"),
    ("ComboBoxBackgroundFocused", "#FF1E1F22"),
    ("ComboBoxBackgroundPressed", "#FF1E1F22"),
    ("ComboBoxBackgroundDisabled", "#262B2D30"),
    ("ComboBoxBorderBrush", "#FF43454A"),
    ("ComboBoxBorderBrushPointerOver", "#FF5A5C61"),
    ("ComboBoxBorderBrushFocused", "#FF3574F0"),
    ("ComboBoxBorderBrushPressed", "#FF3574F0"),
    ("ComboBoxBorderBrushDisabled", "#FF2E3033"),
    ("ComboBoxForeground", "#FFDFE1E5"),
    ("ComboBoxForegroundPointerOver", "#FFFFFFFF"),
    ("ComboBoxForegroundFocused", "#FFFFFFFF"),
    ("ComboBoxForegroundFocusedPressed", "#FFFFFFFF"),
    ("ComboBoxForegroundDisabled", "#FF6F737A"),
    ("ComboBoxPlaceHolderForeground", "#FF6F737A"),
    ("ComboBoxPlaceHolderForegroundPointerOver", "#FF6F737A"),
    ("ComboBoxPlaceHolderForegroundFocused", "#FF7A7D83"),
    ("ComboBoxPlaceHolderForegroundFocusedPressed", "#FF7A7D83"),
    ("ComboBoxPlaceHolderForegroundDisabled", "#FF5A5C61"),
    ("ComboBoxDropDownGlyphForeground", "#FF9DA0A8"),
    ("ComboBoxDropDownGlyphForegroundFocused", "#FFDFE1E5"),
    ("ComboBoxDropDownGlyphForegroundFocusedPressed", "#FFDFE1E5"),
    ("ComboBoxDropDownGlyphForegroundDisabled", "#FF5A5C61"),
    # ComboBox 弹层
    ("ComboBoxDropDownBackground", "#FF2B2D30"),
    ("ComboBoxDropDownBackgroundPointerOver", "#FF313338"),
    ("ComboBoxDropDownBackgroundPointerPressed", "#FF35373B"),
    ("ComboBoxFocusedDropDownBackgroundPointerPressed", "#FF1E1F22"),
    ("ComboBoxDropDownBorderBrush", "#FF43454A"),
    ("ComboBoxDropDownForeground", "#FFDFE1E5"),
    ("ComboBoxItemPillFillBrush", "#FF3574F0"),
    # ComboBoxItem
    ("ComboBoxItemBackground", "#002B2D30"),
    ("ComboBoxItemBackgroundPointerOver", "#FF393B40"),
    ("ComboBoxItemBackgroundPressed", "#FF3F4145"),
    ("ComboBoxItemBackgroundSelected", "#FF43454A"),
    ("ComboBoxItemBackgroundSelectedPointerOver", "#FF4A4C51"),
    ("ComboBoxItemBackgroundSelectedPressed", "#FF4E5055"),
    ("ComboBoxItemBackgroundSelectedUnfocused", "#FF43454A"),
    ("ComboBoxItemBackgroundDisabled", "#262B2D30"),
    ("ComboBoxItemForeground", "#FFDFE1E5"),
    ("ComboBoxItemForegroundPointerOver", "#FFFFFFFF"),
    ("ComboBoxItemForegroundPressed", "#FFFFFFFF"),
    ("ComboBoxItemForegroundSelected", "#FFFFFFFF"),
    ("ComboBoxItemForegroundSelectedPointerOver", "#FFFFFFFF"),
    ("ComboBoxItemForegroundSelectedPressed", "#FFFFFFFF"),
    ("ComboBoxItemForegroundSelectedUnfocused", "#FFDFE1E5"),
    ("ComboBoxItemForegroundDisabled", "#FF5A5C61"),
    # ListViewItem（文件列表 / 命令面板列表）
    ("ListViewItemBackgroundPointerOver", "#FF393B40"),
    ("ListViewItemBackgroundSelected", "#333574F0"),
    ("ListViewItemBackgroundSelectedPointerOver", "#4D3574F0"),
    ("ListViewItemForeground", "#FFDFE1E5"),
]
dark_doubles = [
    ("TextControlThemeMinHeight", "28"),
    ("ComboBoxMinHeight", "28"),
]
dark_thickness = [
    ("TextControlBorderThemeThickness", "1,1,1,1"),
    ("TextControlBorderThemeThicknessFocused", "1,1,1,1"),
    ("TextControlThemePadding", "9,3,9,4"),
    ("ComboBoxPadding", "9,3,9,4"),
    ("ComboBoxItemThemePadding", "10,4,10,4"),
    ("ButtonBorderThemeThickness", "1,1,1,1"),
]

light_tokens = [
    ("ControlCornerRadius", "4", "CornerRadius"),
    ("OverlayCornerRadius", "6", "CornerRadius"),
    ("ControlContentThemeFontSize", "13", "x:Double"),
]
light_brushes = [
    ("ApplicationPageBackgroundThemeBrush", "#FFFAFAFB"),
    ("CardBackgroundFillColorDefaultBrush", "#FFF1F2F4"),
    ("CardBackgroundFillColorSecondaryBrush", "#FFEBECF0"),
    ("SystemAccentColor", "#FF2B6BE4"),
    ("AccentFillColorDefaultBrush", "#FF2B6BE4"),
    ("AccentTextFillColorPrimaryBrush", "#FF1F5EDD"),
    ("TextControlSelectionHighlightColor", "#992B6BE4"),
    ("ButtonBackground", "#FFF7F8FA"),
    ("ButtonBackgroundPointerOver", "#FFEBECF0"),
    ("ButtonBackgroundPressed", "#FFE0E2E8"),
    ("ButtonBackgroundDisabled", "#F0F7F8FA"),
    ("ButtonBorderBrush", "#FFD5D7DB"),
    ("ButtonBorderBrushPointerOver", "#FFC3C5CA"),
    ("ButtonBorderBrushPressed", "#FFB4B6BC"),
    ("ButtonBorderBrushDisabled", "#FFE4E5E8"),
    ("ButtonForeground", "#FF1F2328"),
    ("ButtonForegroundPointerOver", "#FF111318"),
    ("ButtonForegroundPressed", "#FF111318"),
    ("ButtonForegroundDisabled", "#FF9DA0A8"),
    ("TextControlBackground", "#FFFBFBFC"),
    ("TextControlBackgroundPointerOver", "#FFFFFFFF"),
    ("TextControlBackgroundFocused", "#FFFFFFFF"),
    ("TextControlBackgroundDisabled", "#F0FBFBFC"),
    ("TextControlBorderBrush", "#FFD5D7DB"),
    ("TextControlBorderBrushPointerOver", "#FFBFC1C6"),
    ("TextControlBorderBrushFocused", "#FF2B6BE4"),
    ("TextControlBorderBrushDisabled", "#FFE4E5E8"),
    ("TextControlForeground", "#FF1F2328"),
    ("TextControlForegroundPointerOver", "#FF111318"),
    ("TextControlForegroundFocused", "#FF111318"),
    ("TextControlForegroundDisabled", "#FF9DA0A8"),
    ("TextControlPlaceholderForeground", "#FF9DA0A8"),
    ("TextControlPlaceholderForegroundPointerOver", "#FF9DA0A8"),
    ("TextControlPlaceholderForegroundFocused", "#FF8A8E94"),
    ("TextControlPlaceholderForegroundDisabled", "#FFC3C5CA"),
    ("ComboBoxBackground", "#FFF7F8FA"),
    ("ComboBoxBackgroundPointerOver", "#FFEBECF0"),
    ("ComboBoxBackgroundFocused", "#FFFFFFFF"),
    ("ComboBoxBackgroundPressed", "#FFFFFFFF"),
    ("ComboBoxBackgroundDisabled", "#F0F7F8FA"),
    ("ComboBoxBorderBrush", "#FFD5D7DB"),
    ("ComboBoxBorderBrushPointerOver", "#FFBFC1C6"),
    ("ComboBoxBorderBrushFocused", "#FF2B6BE4"),
    ("ComboBoxBorderBrushPressed", "#FF2B6BE4"),
    ("ComboBoxBorderBrushDisabled", "#FFE4E5E8"),
    ("ComboBoxForeground", "#FF1F2328"),
    ("ComboBoxForegroundPointerOver", "#FF111318"),
    ("ComboBoxForegroundFocused", "#FF111318"),
    ("ComboBoxForegroundFocusedPressed", "#FF111318"),
    ("ComboBoxForegroundDisabled", "#FF9DA0A8"),
    ("ComboBoxPlaceHolderForeground", "#FF9DA0A8"),
    ("ComboBoxPlaceHolderForegroundPointerOver", "#FF9DA0A8"),
    ("ComboBoxPlaceHolderForegroundFocused", "#FF8A8E94"),
    ("ComboBoxPlaceHolderForegroundFocusedPressed", "#FF8A8E94"),
    ("ComboBoxPlaceHolderForegroundDisabled", "#FFC3C5CA"),
    ("ComboBoxDropDownGlyphForeground", "#FF5C6167"),
    ("ComboBoxDropDownGlyphForegroundFocused", "#FF1F2328"),
    ("ComboBoxDropDownGlyphForegroundFocusedPressed", "#FF1F2328"),
    ("ComboBoxDropDownGlyphForegroundDisabled", "#FFC3C5CA"),
    ("ComboBoxDropDownBackground", "#FFFFFFFF"),
    ("ComboBoxDropDownBackgroundPointerOver", "#FFF3F4F6"),
    ("ComboBoxDropDownBackgroundPointerPressed", "#FFEBECF0"),
    ("ComboBoxFocusedDropDownBackgroundPointerPressed", "#FFFFFFFF"),
    ("ComboBoxDropDownBorderBrush", "#FFD5D7DB"),
    ("ComboBoxDropDownForeground", "#FF1F2328"),
    ("ComboBoxItemPillFillBrush", "#FF2B6BE4"),
    ("ComboBoxItemBackgroundPointerOver", "#FFEBECF0"),
    ("ComboBoxItemBackgroundPressed", "#FFE4E5E8"),
    ("ComboBoxItemBackgroundSelected", "#FFE0E2E8"),
    ("ComboBoxItemBackgroundSelectedPointerOver", "#FFDADCE1"),
    ("ComboBoxItemBackgroundSelectedPressed", "#FFD5D7DB"),
    ("ComboBoxItemBackgroundSelectedUnfocused", "#FFE0E2E8"),
    ("ComboBoxItemForeground", "#FF1F2328"),
    ("ComboBoxItemForegroundPointerOver", "#FF111318"),
    ("ComboBoxItemForegroundPressed", "#FF111318"),
    ("ComboBoxItemForegroundSelected", "#FF111318"),
    ("ComboBoxItemForegroundSelectedPointerOver", "#FF111318"),
    ("ComboBoxItemForegroundSelectedPressed", "#FF111318"),
    ("ComboBoxItemForegroundSelectedUnfocused", "#FF1F2328"),
    ("ListViewItemBackgroundPointerOver", "#FFEBECF0"),
    ("ListViewItemBackgroundSelected", "#332B6BE4"),
    ("ListViewItemBackgroundSelectedPointerOver", "#4D2B6BE4"),
    ("ListViewItemForeground", "#FF1F2328"),
]
light_doubles = [("TextControlThemeMinHeight", "28"), ("ComboBoxMinHeight", "28")]
light_thickness = [
    ("TextControlBorderThemeThickness", "1,1,1,1"),
    ("TextControlBorderThemeThicknessFocused", "1,1,1,1"),
    ("TextControlThemePadding", "9,3,9,4"),
    ("ComboBoxPadding", "9,3,9,4"),
    ("ComboBoxItemThemePadding", "10,4,10,4"),
    ("ButtonBorderThemeThickness", "1,1,1,1"),
]

def theme_dict(key, tokens, brush_list, doubles, thickness, indent="        "):
    parts = [f'{indent}<ResourceDictionary x:Key="{key}">']
    parts.append(dict_entries(tokens, indent + "    "))
    parts.append(dict_entries([(k, v, "x:Double") for k, v in doubles], indent + "    "))
    parts.append(dict_entries([(k, v, "Thickness") for k, v in thickness], indent + "    "))
    parts.append(brushes(brush_list, indent + "    "))
    parts.append(f"{indent}</ResourceDictionary>")
    return "\n".join(parts)

header = '''<ResourceDictionary
    xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
    xmlns:controls="using:Microsoft.UI.Xaml.Controls">

    <!--
      "Gitter IDE" 主题 v3（JetBrains New UI / VSCode 取向）

      组成：
        1. ThemeDictionaries 令牌覆盖（分层实色、28px 控件、4px 圆角、固定强调色 #3574F0）
        2. Button / TextBox / ComboBox / ComboBoxItem 隐式样式
           —— 模板取自本机 WindowsAppSDK WinUI 2.3.9 的 generic.xaml 原文，
           仅去掉 x:Key 使其成为隐式样式；颜色全部经由上面的主题资源键取值。

      深色令牌：base #1E1F22 · panel #2B2D30 · hover #393B40 · selected #43454A
                边框 #43454A · 文字 #DFE1E5/#9DA0A8/#6F737A
      浅色映射：base #FAFAFB · panel #F7F8FA · hover #EBECF0 · selected #E0E2E8
    -->

    <ResourceDictionary.ThemeDictionaries>

'''

middle = '''
    </ResourceDictionary.ThemeDictionaries>

    <!-- 侧边导航项：静态圆角，选中/悬停由 MainWindow.xaml.cs 代码后置着色 -->
    <Style x:Key="SidebarItemButton" TargetType="controls:Button">
        <Setter Property="Background" Value="Transparent"/>
        <Setter Property="Foreground" Value="{ThemeResource TextFillColorPrimaryBrush}"/>
        <Setter Property="BorderThickness" Value="0"/>
        <Setter Property="Padding" Value="12"/>
        <Setter Property="Margin" Value="8,2,8,2"/>
        <Setter Property="CornerRadius" Value="4"/>
        <Setter Property="HorizontalAlignment" Value="Stretch"/>
        <Setter Property="HorizontalContentAlignment" Value="Stretch"/>
        <Setter Property="VerticalContentAlignment" Value="Center"/>
        <Setter Property="FontSize" Value="12.5"/>
        <Setter Property="Height" Value="30"/>
    </Style>

    <!-- 主区域占位大标题 -->
    <Style x:Key="PagePlaceholderTitle" TargetType="TextBlock">
        <Setter Property="FontSize" Value="22"/>
        <Setter Property="FontWeight" Value="SemiBold"/>
        <Setter Property="Foreground" Value="{ThemeResource TextFillColorPrimaryBrush}"/>
        <Setter Property="HorizontalAlignment" Value="Center"/>
    </Style>

    <Style x:Key="PagePlaceholderSubtitle" TargetType="TextBlock">
        <Setter Property="FontSize" Value="12"/>
        <Setter Property="Foreground" Value="{ThemeResource TextFillColorSecondaryBrush}"/>
        <Setter Property="HorizontalAlignment" Value="Center"/>
    </Style>

    <!-- ==================== 隐式控件样式（模板来自 SDK generic.xaml） ==================== -->

    <!-- Button -->
'''

tail = f'''

    <!-- TextBox -->
{textbox}

    <!-- ComboBox -->
{combobox}

    <!-- ComboBoxItem -->
{comboitem}

</ResourceDictionary>
'''

content = (
    header
    + theme_dict("Light", light_tokens, light_brushes, light_doubles, light_thickness)
    + "\n\n"
    + theme_dict("Default", dark_tokens, dark_brushes, dark_doubles, dark_thickness)
    + middle
    + button
    + tail
)

io.open(OUT, "w", encoding="utf-8", newline="\n").write(content)
print("written", len(content.splitlines()), "lines")
