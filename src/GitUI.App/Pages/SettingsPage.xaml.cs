using System;
using GitUI.Controls.Theme;
using GitUI.Core.Settings;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
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
            var row = new Button
            {
                Content = $"{pkg.Name}（{(pkg.BaseKind == ThemeBase.Light ? "亮色" : "深色")} · {origin}）",
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
