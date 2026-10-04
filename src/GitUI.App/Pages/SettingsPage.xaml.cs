using System;
using GitUI.Controls.Theme;
using GitUI.Core.Extensions;
using GitUI.Core.Settings;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.UI;

namespace GitUI.App.Pages;

public sealed partial class SettingsPage : UserControl
{
    private readonly ISettingsStore _settings;
    private readonly Func<Task>? _exportSettings;
    private readonly Func<Task>? _importSettings;

    /// <summary>导入 .gpk 主题包由宿主窗口实现（文件选择器需要窗口句柄）；返回状态文案（null = 用户取消）。</summary>
    private readonly Func<Task<string?>>? _importThemePackage;

    /// <summary>宿主窗口的设置页构造（S7：导出/导入/主题包导入均走窗口句柄）。</summary>
    public SettingsPage(
        ISettingsStore settings,
        Func<Task>? exportSettings = null,
        Func<Task>? importSettings = null,
        Func<Task<string?>>? importThemePackage = null)
    {
        InitializeComponent();
        _settings = settings;
        _exportSettings = exportSettings;
        _importSettings = importSettings;
        _importThemePackage = importThemePackage;
        _settings.Changed += (_, _) => RefreshAppearance();

        RefreshAppearance();
    }

    private void Export_Click(object sender, RoutedEventArgs e) => _ = (_exportSettings?.Invoke() ?? Task.CompletedTask);

    private void Import_Click(object sender, RoutedEventArgs e) => _ = (_importSettings?.Invoke() ?? Task.CompletedTask);

    private void Theme_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button btn) return;
        var theme = btn == ThemeSystemBtn ? ThemePreference.System
                  : btn == ThemeLightBtn ? ThemePreference.Light
                  : ThemePreference.Dark;

        var targetBase = theme switch
        {
            ThemePreference.Light => ThemeBase.Light,
            ThemePreference.Dark => ThemeBase.Dark,
            _ => Application.Current?.RequestedTheme == ApplicationTheme.Light ? ThemeBase.Light : ThemeBase.Dark,
        };

        _settings.Update(s =>
        {
            s.Theme = theme;
            // 基座按钮 = 回到"内置跟随基座"心智：当前主题包基座与新基座不符时清空包选择
            if (ThemeService.Active is { } active && active.BaseKind != targetBase)
            {
                s.ThemePackageId = null;
            }
        });
        _settings.Save();
    }

    /// <summary>主题包行点击：选定包（显式选择优先于基座偏好），settings.Changed → 宿主应用。</summary>
    private void ThemePackage_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button btn || btn.Tag is not string id) return;
        _settings.Update(s => s.ThemePackageId = id);
        _settings.Save();
    }

    /// <summary>"跟随基座（内置）"：清空包选择，回到按基座取内置主题。</summary>
    private void ThemeFollowBase_Click(object sender, RoutedEventArgs e)
    {
        _settings.Update(s => s.ThemePackageId = null);
        _settings.Save();
    }

    private void ImportTheme_Click(object sender, RoutedEventArgs e)
    {
        if (_importThemePackage is null)
        {
            ShowThemeStatus("当前窗口不支持导入（缺少宿主句柄）");
            return;
        }

        _ = RunImportAsync();

        async Task<string?> RunImportAsync()
        {
            var message = await _importThemePackage();
            if (message is not null)
            {
                ShowThemeStatus(message);
            }

            return message;
        }
    }

    private void DiffMode_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button btn) return;
        var mode = btn == DiffSideBySideBtn ? DiffViewMode.SideBySide : DiffViewMode.Inline;
        _settings.Update(s => s.DiffMode = mode);
        _settings.Save();
    }

    /// <summary>打开 S3 Diff 渲染预览窗口（手动验证工具，非正式页签）。</summary>
    private void DiffPreview_Click(object sender, RoutedEventArgs e)
    {
        new DiffPreviewWindow(_settings).Activate();
    }

    private void RefreshAppearance()
    {
        if (ThemeSystemBtn == null) return;

        var s = _settings.Current;
        var selected = new Windows.UI.Text.FontWeight(600);
        var normal = new Windows.UI.Text.FontWeight(400);

        ThemeSystemBtn.FontWeight = s.Theme == ThemePreference.System ? selected : normal;
        ThemeLightBtn.FontWeight = s.Theme == ThemePreference.Light ? selected : normal;
        ThemeDarkBtn.FontWeight = s.Theme == ThemePreference.Dark ? selected : normal;

        DiffSideBySideBtn.FontWeight = s.DiffMode == DiffViewMode.SideBySide ? selected : normal;
        DiffInlineBtn.FontWeight = s.DiffMode == DiffViewMode.Inline ? selected : normal;

        // ---- 主题包列表（theme-framework.md P3）----
        ThemePackageList.Children.Clear();
        foreach (var pkg in ThemeService.Packages)
        {
            var isSelected = pkg.Id == s.ThemePackageId;
            var origin = pkg.IsBuiltin ? "内置" : "自定义";
            var rowContent = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            if (pkg.PreviewPath is not null)
            {
                rowContent.Children.Add(new Image
                {
                    Source = new BitmapImage(new Uri(pkg.PreviewPath)),
                    Width = 56,
                    Height = 30,
                    Stretch = Stretch.UniformToFill,
                });
            }

            rowContent.Children.Add(new TextBlock
            {
                Text = $"{pkg.Name}（{(pkg.BaseKind == ThemeBase.Light ? "亮色" : "深色")} · {origin}）",
                VerticalAlignment = VerticalAlignment.Center,
            });

            var row = new Button
            {
                Content = rowContent,
                Padding = new Thickness(10, 5, 10, 6),
                CornerRadius = new CornerRadius(4),
                HorizontalAlignment = HorizontalAlignment.Stretch,
                HorizontalContentAlignment = HorizontalAlignment.Left,
                FontSize = 12,
                Tag = pkg.Id,
            };
            row.Background = isSelected ? ThemeServiceActiveBrush() : null;
            AutomationProperties.SetName(row, $"主题包 {pkg.Name}");
            row.Click += ThemePackage_Click;
            ThemePackageList.Children.Add(row);
        }

        var followSelected = string.IsNullOrWhiteSpace(s.ThemePackageId);
        ThemeFollowBaseBtn.FontWeight = followSelected ? selected : normal;

        PopulateExtensions();
    }

    // ---- 扩展卡片（extension-package-framework.md P1/P2：列表 / 按 kind 启停 / 卸载）----

    private void PopulateExtensions()
    {
        if (ExtensionPackageList == null) return;

        // 勾选事件内同步重建可视树有重入挂死风险：延迟到下一个调度周期
        DispatcherQueue.TryEnqueue(() =>
        {
            if (ExtensionPackageList == null) return;
            PopulateExtensionsCore();
        });
    }

    private void PopulateExtensionsCore()
    {
        ExtensionPackageList.Children.Clear();
        var s = _settings.Current;

        foreach (var pkg in ThemeService.Packages.OrderBy(p => p.IsBuiltin ? 0 : 1).ThenBy(p => p.Name, StringComparer.OrdinalIgnoreCase))
        {
            var row = new Grid { ColumnSpacing = 8 };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var origin = pkg.IsBuiltin ? "内置" : "自定义";
            var kindsText = string.Join("/", pkg.Manifest.Kinds.Select(k => k == "theme" ? "主题" : k == "syntax" ? "语法" : k));
            var name = new TextBlock
            {
                Text = $"{pkg.Name} · {origin} · v{pkg.Manifest.Version} · {kindsText}",
                FontSize = 12,
                VerticalAlignment = VerticalAlignment.Center,
                TextTrimming = TextTrimming.CharacterEllipsis,
            };
            Grid.SetColumn(name, 0);
            row.Children.Add(name);

            var kindsHost = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
            foreach (var kind in pkg.Manifest.Kinds)
            {
                var kindCn = kind == "theme" ? "主题" : kind == "syntax" ? "语法" : kind;
                var enabled = GitUI.Core.Extensions.PackageRegistryState.IsEnabled(pkg.Id, kind);
                var cb = new CheckBox
                {
                    Content = kindCn,
                    IsChecked = enabled,
                    MinWidth = 0,
                    Padding = new Thickness(0),
                    FontSize = 11,
                    Tag = pkg.Id + ":" + kind,
                };
                AutomationProperties.SetName(cb, $"启用 {pkg.Name} {kindCn}");
                cb.Checked += PackageKindToggle_Changed;
                cb.Unchecked += PackageKindToggle_Changed;
                kindsHost.Children.Add(cb);
            }

            Grid.SetColumn(kindsHost, 1);
            row.Children.Add(kindsHost);

            if (!pkg.IsBuiltin)
            {
                var uninstallBtn = new Button
                {
                    Content = "卸载",
                    FontSize = 11,
                    Padding = new Thickness(8, 2, 8, 3),
                    CornerRadius = new CornerRadius(4),
                    Tag = pkg.Id,
                };
                AutomationProperties.SetName(uninstallBtn, $"卸载 {pkg.Name}");
                uninstallBtn.Click += UninstallPackage_Click;
                Grid.SetColumn(uninstallBtn, 2);
                row.Children.Add(uninstallBtn);
            }

            ExtensionPackageList.Children.Add(row);
        }
    }

    /// <summary>kind 启停：更新共享注册状态 + 持久化；主题即时经 settings.Changed 重载，语法即时重扫描。</summary>
    private void PackageKindToggle_Changed(object sender, RoutedEventArgs e)
    {
        if (sender is not CheckBox cb || cb.Tag is not string entry) return;

        GitUI.Core.Extensions.PackageRegistryState.SetEnabled(
            entry[..entry.LastIndexOf(':')], entry[(entry.LastIndexOf(':') + 1)..], cb.IsChecked == true);

        _settings.Update(s => s.DisabledPackageKinds =
            GitUI.Core.Extensions.PackageRegistryState.DisabledKinds.ToList());
        _settings.Save();

        if (entry.EndsWith(":syntax", StringComparison.OrdinalIgnoreCase))
        {
            GitUI.Diff.Highlighting.HighlighterRegistry.Rescan();
        }

        ShowExtensionStatus($"已{(cb.IsChecked == true ? "启用" : "禁用")}：{entry.Replace(':', '·')}");
    }

    /// <summary>卸载用户扩展包（含其全部种类）：主题立即回退内置，语法回退 plain。</summary>
    private void UninstallPackage_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button btn || btn.Tag is not string id) return;

        var wasActiveTheme = _settings.Current.ThemePackageId == id;
        var ok = ThemeService.UninstallPackage(id);
        if (!ok)
        {
            ShowExtensionStatus("卸载失败（内置包或目录不可删）");
            return;
        }

        GitUI.Diff.Highlighting.HighlighterRegistry.Rescan();

        _settings.Update(s =>
        {
            s.DisabledPackageKinds = GitUI.Core.Extensions.PackageRegistryState.DisabledKinds
                .Where(entry => !entry.StartsWith(id + ":", StringComparison.OrdinalIgnoreCase)).ToList();
            if (wasActiveTheme)
            {
                s.ThemePackageId = null; // 活动主题被卸载 → 回退内置跟随基座
            }
        });
        _settings.Save();
        ShowExtensionStatus($"已卸载：{id}");
    }

    private void ShowExtensionStatus(string message)
    {
        ExtensionStatusText.Text = message;
        ExtensionStatusText.Visibility = string.IsNullOrEmpty(message) ? Visibility.Collapsed : Visibility.Visible;
    }

    /// <summary>选中主题包的高亮底色（跟随令牌，暗亮自适配）。</summary>
    private static Brush ThemeServiceActiveBrush() => GitUI.Controls.Theme.TokenRuntime.Brush(
        GitUI.Controls.Theme.TokenKey.AccentSoft);

    /// <summary>显示主题导入/切换的状态文案（3 秒后自动消退由调用方控制；此处常驻到下次刷新）。</summary>
    private void ShowThemeStatus(string message)
    {
        ThemeStatusText.Text = message;
        ThemeStatusText.Visibility = string.IsNullOrEmpty(message) ? Visibility.Collapsed : Visibility.Visible;
    }
}
