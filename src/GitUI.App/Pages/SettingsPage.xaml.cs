using System;
using GitUI.Core.Settings;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.UI;

namespace GitUI.App.Pages;

public sealed partial class SettingsPage : UserControl
{
    private readonly ISettingsStore _settings;

    public SettingsPage(ISettingsStore settings)
    {
        InitializeComponent();
        _settings = settings;
        _settings.Changed += (_, _) => RefreshAppearance();

        RefreshAppearance();
    }

    private void Theme_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button btn) return;
        var theme = btn == ThemeSystemBtn ? ThemePreference.System
                  : btn == ThemeLightBtn ? ThemePreference.Light
                  : ThemePreference.Dark;
        _settings.Update(s => s.Theme = theme);
        _settings.Save();
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
    }
}
