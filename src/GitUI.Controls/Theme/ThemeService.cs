using System.IO.Compression;
using GitUI.Core.Extensions;
using GitUI.Diff.Highlighting;
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

    /// <summary>用户主题包根目录（导入的 .gpk 解包到这里）。</summary>
    public static string UserPackagesRoot => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GitUI", UserRelativeDir);

    /// <summary>已扫描的主题包（内置 + 用户，含被禁用的）。</summary>
    public static IReadOnlyList<ThemePackageInfo> Packages => _packages.Values.ToList().AsReadOnly();

    /// <summary>当前活动主题包。</summary>
    public static ThemePackageInfo? Active { get; private set; }

    /// <summary>活动主题的语法配色（styleKey → hex，含继承合并；代码高亮框架消费）。</summary>
    public static IReadOnlyDictionary<string, string> ActiveSyntax { get; private set; } =
        new Dictionary<string, string>();

    /// <summary>活动主题的 diff 配色覆盖（DiffColorKind 名 → hex；DiffCanvas 消费）。</summary>
    public static IReadOnlyDictionary<string, string> ActiveDiff { get; private set; } =
        new Dictionary<string, string>();

    /// <summary>活动主题的终端配色覆盖（background/foreground/0..15 → hex；TerminalCanvas 消费）。</summary>
    public static IReadOnlyDictionary<string, string> ActiveTerminal { get; private set; } =
        new Dictionary<string, string>();

    /// <summary>每次应用完成后广播（宿主：RootGrid.RequestedTheme / 标题栏 / 页面 Rebind）。</summary>
    public static event Action<ThemePackageInfo>? Applied;

    /// <summary>扫描内置与用户包目录。重复 id：用户包覆盖内置包。</summary>
    public static void Scan()
    {
        _packages.Clear();

        var builtinRoot = Path.Combine(AppContext.BaseDirectory, BuiltinRelativeDir);
        ScanDirectory(builtinRoot, isBuiltin: true);

        ScanDirectory(UserPackagesRoot, isBuiltin: false);
    }

    /// <summary>解析并应用主题包；找不到时回退到指定基座的内置主题。返回是否应用成功。</summary>
    public static bool Apply(string? packageId, ThemeBase fallbackBase)
    {
        if (_packages.Count == 0)
        {
            Scan();
        }

        ThemePackageInfo? info = null;
        if (packageId is not null && _packages.TryGetValue(packageId, out var p)
            && PackageRegistryState.IsEnabled(packageId, "theme"))
        {
            info = p; // 包存在且未被禁用
        }
        info ??= _packages.TryGetValue(DefaultPackageId(fallbackBase), out var builtin) ? builtin : null;
        info ??= _packages.Values.FirstOrDefault(x => x.BaseKind == fallbackBase);
        if (info?.ThemeDoc is null)
        {
            // 完全没有可用主题包：保留 TokenRuntime 兜底表
            ActiveSyntax = new Dictionary<string, string>();
            ActiveDiff = new Dictionary<string, string>();
            ActiveTerminal = new Dictionary<string, string>();
            TokenRuntime.Load(fallbackBase, TokenRuntime.BuiltinDefaults(fallbackBase));
            Applied?.Invoke(info ?? new ThemePackageInfo(fallbackBase == ThemeBase.Light ? LightPackageId : DarkPackageId,
                fallbackBase == ThemeBase.Light ? "亮色" : "深色", fallbackBase, true, "", new PackageManifest(), new ThemeDocument()));
            return false;
        }

        Active = info;
        var tokens = ResolveTokens(info);
        TokenRuntime.Load(info.BaseKind, tokens);
        ActiveSyntax = ResolveSyntax(info);
        ActiveDiff = info.ThemeDoc!.Diff is null
            ? new Dictionary<string, string>()
            : new Dictionary<string, string>(info.ThemeDoc.Diff);
        ActiveTerminal = info.ThemeDoc.Terminal is null
            ? new Dictionary<string, string>()
            : new Dictionary<string, string>(info.ThemeDoc.Terminal);
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

    /// <summary>
    /// 卸载用户主题包：删除用户目录下的包目录并重扫描。
    /// 内置包不可卸载（返回 false）；若卸载的是活动包，调用方负责重新 Apply（会自动回退内置）。
    /// </summary>
    public static bool UninstallPackage(string packageId)
    {
        if (!_packages.TryGetValue(packageId, out var pkg) || pkg.IsBuiltin)
        {
            return false;
        }

        try
        {
            if (Directory.Exists(pkg.RootPath))
            {
                Directory.Delete(pkg.RootPath, recursive: true);
            }
        }
        catch
        {
            return false;
        }

        _packages.Remove(packageId);
        if (Active?.Id == packageId)
        {
            Active = null;
        }

        Scan();
        return true;
    }

    /// <summary>
    /// 导入 .gpk 扩展包：按 kinds 分流——含 theme → 校验 theme/theme.json，安装后返回包 id
    /// （调用方设为活动主题）；含 syntax → 校验 syntax/highlighters.json，安装后重扫描高亮器。
    /// 返回 (是否成功, 状态文案, 主题包 id 或 null)；成功后调用方设置 ThemePackageId 并保存。
    /// </summary>
    public static (bool Ok, string Status, string? ThemePackageId) ImportGpk(string gpkPath)
    {
        string? temp = null;
        try
        {
            if (!File.Exists(gpkPath))
            {
                return (false, "文件不存在：" + gpkPath, null);
            }

            temp = Path.Combine(Path.GetTempPath(), "gitui-pkg-" + Guid.NewGuid().ToString("N"));
            ZipFile.ExtractToDirectory(gpkPath, temp, overwriteFiles: true);

            var manifestPath = Path.Combine(temp, "manifest.json");
            if (!File.Exists(manifestPath))
            {
                CleanupTemp(temp);
                return (false, "包内缺少 manifest.json", null);
            }

            var manifest = ThemePackageJson.ParseManifest(File.ReadAllText(manifestPath));
            if (manifest is null || string.IsNullOrWhiteSpace(manifest.Id))
            {
                CleanupTemp(temp);
                return (false, "manifest 无效（缺少 id）", null);
            }

            var hasTheme = manifest.Kinds.Contains("theme", StringComparer.OrdinalIgnoreCase);
            var hasSyntax = manifest.Kinds.Contains("syntax", StringComparer.OrdinalIgnoreCase);
            if (!hasTheme && !hasSyntax)
            {
                CleanupTemp(temp);
                return (false, "该包未声明受支持的种类（kinds 需含 theme 或 syntax）", null);
            }

            if (hasTheme && !File.Exists(Path.Combine(temp, "theme", "theme.json")))
            {
                CleanupTemp(temp);
                return (false, "包内缺少 theme/theme.json", null);
            }

            if (hasSyntax && !File.Exists(Path.Combine(temp, "syntax", "highlighters.json")))
            {
                CleanupTemp(temp);
                return (false, "包内缺少 syntax/highlighters.json", null);
            }

            Directory.CreateDirectory(UserPackagesRoot);
            var dest = Path.Combine(UserPackagesRoot, manifest.Id);
            if (Directory.Exists(dest))
            {
                Directory.Delete(dest, recursive: true); // 同 id 覆盖安装（升级）
            }

            Directory.Move(temp, dest);
            temp = null;
            Scan();
            if (hasSyntax)
            {
                HighlighterRegistry.Rescan();
            }

            string? themeId = hasTheme ? manifest.Id : null;
            var status = hasTheme
                ? "已导入并应用主题包：" + manifest.Id
                : "已导入语法高亮包：" + manifest.Id;
            return (true, status, themeId);
        }
        catch (Exception ex)
        {
            if (temp is not null)
            {
                CleanupTemp(temp);
            }

            return (false, "导入失败：" + ex.Message, null);
        }
    }

    private static void CleanupTemp(string dir)
    {
        try
        {
            Directory.Delete(dir, recursive: true);
        }
        catch
        {
            // 临时目录清理失败可忽略（系统临时目录会回收）
        }
    }

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
                if (manifest is null || string.IsNullOrWhiteSpace(manifest.Id)
                    || !manifest.Kinds.Contains("theme", StringComparer.OrdinalIgnoreCase)
                    || !PackageRegistryState.IsEnabled(manifest.Id, "theme"))
                {
                    continue; // 非主题种类包 / 已被用户禁用
                }

                var themeDoc = File.Exists(themePath)
                    ? ThemePackageJson.ParseTheme(File.ReadAllText(themePath))
                    : null;
                if (themeDoc is null)
                {
                    continue; // kinds 声明了 theme 但缺少 theme.json → 视为损坏，不注册
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

    /// <summary>语法配色继承合并：inherits 主题 syntax → 自身 syntax。</summary>
    private static IReadOnlyDictionary<string, string> ResolveSyntax(ThemePackageInfo info)
    {
        var doc = info.ThemeDoc!;
        var syntax = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        if (doc.Inherits is not null && _packages.TryGetValue(doc.Inherits, out var baseTheme)
            && baseTheme.ThemeDoc is not null)
        {
            foreach (var (key, hex) in baseTheme.ThemeDoc.Syntax)
            {
                syntax[key] = hex;
            }
        }

        foreach (var (key, hex) in doc.Syntax)
        {
            syntax[key] = hex;
        }

        return syntax;
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
