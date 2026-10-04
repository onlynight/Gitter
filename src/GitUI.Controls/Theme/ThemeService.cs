using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using Windows.UI;

namespace GitUI.Controls.Theme;

/// <summary>
/// 主题服务：扫描主题包（内置 + 用户）、解析继承、应用令牌与框架键覆盖（theme-framework.md §四）。
///
/// 应用链路（每次 Apply 全部执行）：
///   1. TokenRuntime.Load(语义令牌表)        → UiKit / 页面 / 画布取色跟随
///   2. doc.Framework 非空时构建框架键覆盖字典并注入 Application.Resources.MergedDictionaries
///      （追加在 ThemeStyles 之后，查表顺序后者优先）；
///      内置主题 Framework 为空 → 依赖 ThemeStyles.xaml 既有覆盖，视觉与现状零差异
///   3. 广播 Applied（宿主据此设置 RootGrid.RequestedTheme / 标题栏配色）
/// </summary>
public static class ThemeService
{
    private const string BuiltinRelativeDir = "Packages";
    private const string UserRelativeDir = "packages";
    private const string DarkPackageId = "gitui.theme.dark";
    private const string LightPackageId = "gitui.theme.light";

    private static readonly Dictionary<string, ThemePackageInfo> _packages = new(StringComparer.OrdinalIgnoreCase);
    private static ResourceDictionary? _injectedFramework;

    /// <summary>已扫描的主题包（内置 + 用户，含被禁用的）。</summary>
    public static IReadOnlyList<ThemePackageInfo> Packages => _packages.Values.ToList().AsReadOnly();

    /// <summary>当前活动主题包。</summary>
    public static ThemePackageInfo? Active { get; private set; }

    /// <summary>每次应用完成后广播（宿主：RootGrid.RequestedTheme / 标题栏 / 页面 Rebind）。</summary>
    public static event Action<ThemePackageInfo>? Applied;

    /// <summary>扫描内置与用户包目录。重复 id：用户包覆盖内置包。</summary>
    public static void Scan()
    {
        _packages.Clear();

        var builtinRoot = Path.Combine(AppContext.BaseDirectory, BuiltinRelativeDir);
        ScanDirectory(builtinRoot, isBuiltin: true);

        var userRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GitUI", UserRelativeDir);
        ScanDirectory(userRoot, isBuiltin: false);
    }

    /// <summary>解析并应用主题包；找不到时回退到指定基座的内置主题。返回是否应用成功。</summary>
    public static bool Apply(string? packageId, ThemeBase fallbackBase)
    {
        if (_packages.Count == 0)
        {
            Scan();
        }

        var info = packageId is not null && _packages.TryGetValue(packageId, out var p) ? p : null;
        info ??= _packages.TryGetValue(DefaultPackageId(fallbackBase), out var builtin) ? builtin : null;
        info ??= _packages.Values.FirstOrDefault(x => x.BaseKind == fallbackBase);
        if (info?.ThemeDoc is null)
        {
            // 完全没有可用主题包：保留 TokenRuntime 兜底表
            TokenRuntime.Load(fallbackBase, TokenRuntime.BuiltinDefaults(fallbackBase));
            return false;
        }

        Active = info;
        var tokens = ResolveTokens(info);
        TokenRuntime.Load(info.BaseKind, tokens);
        InjectFramework(info.ThemeDoc);
        Applied?.Invoke(info);
        return true;
    }

    /// <summary>按偏好取回退基座：Dark/Light 直接映射；System 由应用默认主题推导（WinUI 默认跟随系统）。</summary>
    public static ThemeBase FallbackBase(bool preferLight, bool preferDark)
    {
        if (preferLight)
        {
            return ThemeBase.Light;
        }

        if (preferDark)
        {
            return ThemeBase.Dark;
        }

        var appTheme = Application.Current?.RequestedTheme;
        return appTheme == ApplicationTheme.Light ? ThemeBase.Light : ThemeBase.Dark;
    }

    public static string DefaultPackageId(ThemeBase baseKind) =>
        baseKind == ThemeBase.Light ? LightPackageId : DarkPackageId;

    // ---- 内部 ----

    private static void ScanDirectory(string root, bool isBuiltin)
    {
        if (!Directory.Exists(root))
        {
            return;
        }

        foreach (var dir in Directory.EnumerateDirectories(root))
        {
            try
            {
                var manifestPath = Path.Combine(dir, "manifest.json");
                var themePath = Path.Combine(dir, "theme", "theme.json");
                if (!File.Exists(manifestPath) || !File.Exists(themePath))
                {
                    continue;
                }

                var manifest = ThemePackageJson.ParseManifest(File.ReadAllText(manifestPath));
                var themeDoc = ThemePackageJson.ParseTheme(File.ReadAllText(themePath));
                if (manifest is null || themeDoc is null
                    || !manifest.Kinds.Contains("theme", StringComparer.OrdinalIgnoreCase))
                {
                    continue;
                }

                var baseKind = manifest.Theme?.Base == "light" || themeDoc.Base == "light"
                    ? ThemeBase.Light : ThemeBase.Dark;
                _packages[manifest.Id] = new ThemePackageInfo(
                    manifest.Id, manifest.Name, baseKind, isBuiltin, dir, manifest, themeDoc);
            }
            catch
            {
                // 单个包损坏不阻断扫描（extension-package-framework.md §四 故障隔离）
            }
        }
    }

    /// <summary>继承合并：基座缺省表 → inherits 主题覆盖 → 自身覆盖。</summary>
    private static IReadOnlyDictionary<TokenKey, Color> ResolveTokens(ThemePackageInfo info)
    {
        var doc = info.ThemeDoc!;
        var resolved = new Dictionary<TokenKey, Color>(TokenRuntime.BuiltinDefaults(info.BaseKind));

        if (doc.Inherits is not null && _packages.TryGetValue(doc.Inherits, out var baseTheme)
            && baseTheme.ThemeDoc is not null)
        {
            ApplyTokens(resolved, baseTheme.ThemeDoc.Tokens);
        }

        ApplyTokens(resolved, doc.Tokens);
        return resolved;
    }

    private static void ApplyTokens(Dictionary<TokenKey, Color> target, Dictionary<string, string> overrides)
    {
        foreach (var (name, hex) in overrides)
        {
            if (Enum.TryParse<TokenKey>(name, ignoreCase: true, out var key)
                && ThemePackageJson.TryParseColor(hex, out var color))
            {
                target[key] = color;
            }
        }
    }

    /// <summary>
    /// 框架键覆盖字典：doc.Framework 的显式覆盖 + 常用键的令牌推导（第三方包只需给令牌即可改控件内里）。
    /// 内置主题 Framework 为空，不注入——完全依赖 ThemeStyles.xaml（视觉零风险）。
    /// </summary>
    private static void InjectFramework(ThemeDocument doc)
    {
        var app = Application.Current;
        if (app is null)
        {
            return;
        }

        if (_injectedFramework is not null)
        {
            app.Resources.MergedDictionaries.Remove(_injectedFramework);
            _injectedFramework = null;
        }

        if (doc.Framework.Count == 0)
        {
            return;
        }

        var dict = new ResourceDictionary();
        foreach (var (key, hex) in doc.Framework)
        {
            if (ThemePackageJson.TryParseColor(hex, out var color))
            {
                dict[key] = new SolidColorBrush(color);
            }
        }

        // 常用键推导：未显式给出的键由令牌映射（主题改 Accent/Panel 即可影响控件内里）
        void Derive(string key, TokenKey token, byte alpha = 0xFF)
        {
            if (dict.ContainsKey(key))
            {
                return;
            }

            var c = TokenRuntime.Get(token);
            dict[key] = new SolidColorBrush(Color.FromArgb(alpha, c.R, c.G, c.B));
        }

        Derive("ApplicationPageBackgroundThemeBrush", TokenKey.Base);
        Derive("CardBackgroundFillColorDefaultBrush", TokenKey.Panel);
        Derive("ButtonBackground", TokenKey.Panel);
        Derive("ButtonBackgroundPointerOver", TokenKey.Hover);
        Derive("ButtonBackgroundPressed", TokenKey.Selected);
        Derive("ButtonBorderBrush", TokenKey.BorderStrong);
        Derive("ButtonForeground", TokenKey.Text);
        Derive("ButtonForegroundPointerOver", TokenKey.Text);
        Derive("TextControlBackground", TokenKey.Panel);
        Derive("TextControlBackgroundPointerOver", TokenKey.Hover);
        Derive("TextControlBackgroundFocused", TokenKey.Base);
        Derive("TextControlBorderBrush", TokenKey.BorderStrong);
        Derive("TextControlBorderBrushPointerOver", TokenKey.BorderStrong);
        Derive("TextControlBorderBrushFocused", TokenKey.Accent);
        Derive("TextControlForeground", TokenKey.Text);
        Derive("TextControlPlaceholderForeground", TokenKey.Text3);
        Derive("TextControlPlaceholderForegroundFocused", TokenKey.Text3);
        Derive("TextControlSelectionHighlightColor", TokenKey.Accent, 0x99);
        Derive("ComboBoxBackground", TokenKey.Panel);
        Derive("ComboBoxBackgroundPointerOver", TokenKey.Hover);
        Derive("ComboBoxBackgroundFocused", TokenKey.Base);
        Derive("ComboBoxBorderBrush", TokenKey.BorderStrong);
        Derive("ComboBoxBorderBrushFocused", TokenKey.Accent);
        Derive("ComboBoxForeground", TokenKey.Text);
        Derive("ComboBoxPlaceHolderForeground", TokenKey.Text3);
        Derive("ComboBoxDropDownBackground", TokenKey.Panel);
        Derive("ComboBoxDropDownBorderBrush", TokenKey.BorderStrong);
        Derive("ComboBoxDropDownForeground", TokenKey.Text);
        Derive("ComboBoxItemBackgroundPointerOver", TokenKey.Hover);
        Derive("ComboBoxItemBackgroundSelected", TokenKey.Selected);
        Derive("ComboBoxItemForeground", TokenKey.Text);
        Derive("ComboBoxItemPillFillBrush", TokenKey.Accent);
        Derive("ListViewItemBackgroundPointerOver", TokenKey.Hover);
        Derive("ListViewItemBackgroundSelected", TokenKey.AccentSoft);
        Derive("ListViewItemForeground", TokenKey.Text);
        Derive("AccentFillColorDefaultBrush", TokenKey.Accent);

        _injectedFramework = dict;
        app.Resources.MergedDictionaries.Add(dict);
    }
}
