using System;
using GitUI.App.Platform;
using GitUI.Controls.Theme;
using GitUI.Core.Extensions;
using GitUI.Core.Resources;
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

    /// <summary>语言切换（docs/i18n.md §四）：热切换，立即生效。</summary>
    private void Language_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button btn) return;
        var language = btn == LangSystemBtn ? LanguagePreference.System
                     : btn == LangEnglishBtn ? LanguagePreference.English
                     : LanguagePreference.SimplifiedChinese;
        // 顺序关键：先 Apply 切资源文化并广播各窗口重绘，再 Update 触发
        // settings.Changed → RefreshAppearance——反了会让设置页自身在旧文化下渲染
        //（表现为"切走再切回页面才变成新语言"）。
        LanguageService.Apply(language);
        _settings.Update(s => s.Language = language);
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
            ShowThemeStatus(Strings.Settings_ImportUnavailable);
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

    // ---- 实时监视与后台 fetch（ai-native-redesign.md §7.1）----

    private bool _suppressSettingEvents; // RefreshAppearance 回填控件时抑制写回

    private void WatchWorktree_Changed(object sender, RoutedEventArgs e)
    {
        if (_suppressSettingEvents || WatchWorktreeCheck is null) return;
        _settings.Update(s => s.WatchWorktree = WatchWorktreeCheck.IsChecked == true);
        _settings.Save();
    }

    private void AutoFetch_Changed(object sender, RoutedEventArgs e)
    {
        if (_suppressSettingEvents || AutoFetchCheck is null) return;
        _settings.Update(s => s.AutoFetch = AutoFetchCheck.IsChecked == true);
        _settings.Save();
    }

    private void McpPipe_Changed(object sender, RoutedEventArgs e)
    {
        if (_suppressSettingEvents || McpPipeCheck is null) return;
        _settings.Update(s => s.McpPipeEnabled = McpPipeCheck.IsChecked == true);
        _settings.Save();
    }

    private void FetchInterval_ValueChanged(NumberBox sender, NumberBoxValueChangedEventArgs args)
    {
        if (_suppressSettingEvents) return;
        var v = (int)Math.Clamp(Math.Round(sender.Value), 1, 120);
        _settings.Update(s => s.AutoFetchIntervalMinutes = v);
        _settings.Save();
    }

    // ---- AI 助手（ai-native-redesign.md §八；provider 与档位热生效）----

    private static readonly string[] AiProviderKinds =
    {
        AiProviderKind.Off, "ollama", AiProviderKind.OpenAi, AiProviderKind.Anthropic, AiProviderKind.Cli,
    };

    private void AiProvider_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressSettingEvents || AiProviderBox is null) return;
        var idx = Math.Max(0, AiProviderBox.SelectedIndex);
        _settings.Update(s =>
        {
            s.Ai.ProviderKind = AiProviderKinds[idx];
            if (idx == 1 && string.IsNullOrWhiteSpace(s.Ai.Endpoint))
                s.Ai.Endpoint = "http://127.0.0.1:11434/v1"; // Ollama 预设
        });
        _settings.Save();
        RefreshAppearance();
    }

    private void AiEndpoint_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressSettingEvents || AiEndpointBox is null) return;
        _settings.Update(s => s.Ai.Endpoint = BlankToNull(AiEndpointBox.Text));
        _settings.Save();
    }

    private void AiModel_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressSettingEvents || AiModelBox is null) return;
        _settings.Update(s => s.Ai.Model = BlankToNull(AiModelBox.Text));
        _settings.Save();
    }

    private void AiApiKey_PasswordChanged(object sender, RoutedEventArgs e)
    {
        if (_suppressSettingEvents || AiApiKeyBox is null) return;
        var plain = AiApiKeyBox.Password;
        _settings.Update(s => s.Ai.ApiKeyProtected = string.IsNullOrEmpty(plain) ? null : SecretProtector.Protect(plain));
        _settings.Save();
    }

    private void AiCli_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressSettingEvents || AiCliBox is null) return;
        _settings.Update(s => s.Ai.CliCommand = BlankToNull(AiCliBox.Text));
        _settings.Save();
    }

    private void AiPrivacy_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressSettingEvents || AiPrivacyBox is null) return;
        _settings.Update(s => s.Ai.Privacy = (AiPrivacyLevel)Math.Max(0, AiPrivacyBox.SelectedIndex));
        _settings.Save();
    }

    private void AiTrailer_Changed(object sender, RoutedEventArgs e)
    {
        if (_suppressSettingEvents || AiTrailerCheck is null) return;
        _settings.Update(s => s.Ai.AppendTrailer = AiTrailerCheck.IsChecked == true);
        _settings.Save();
    }

    private void SafetyNet_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressSettingEvents || SafetyNetBox is null) return;
        _settings.Update(s => s.SafetyNetMode = (CommitSafetyMode)Math.Max(0, SafetyNetBox.SelectedIndex));
        _settings.Save();
    }

    private static string? BlankToNull(string text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim();

    private void RefreshAppearance()
    {
        if (ThemeSystemBtn == null) return;

        var s = _settings.Current;
        var selected = new Windows.UI.Text.FontWeight(600);
        var normal = new Windows.UI.Text.FontWeight(400);

        // ---- 静态文案（语言重启生效，此处取当前文化的资源值）----
        SettingsTitle.Text = Strings.Settings_Title;
        ThemeCardTitle.Text = Strings.Settings_Theme;
        BaseLabel.Text = Strings.Settings_Base;
        ThemeSystemBtn.Content = Strings.Common_FollowSystem;
        ThemeLightBtn.Content = Strings.Common_Light;
        ThemeDarkBtn.Content = Strings.Common_Dark;
        ThemePackageLabel.Text = Strings.Settings_ThemePackages;
        ThemeFollowBaseBtn.Content = Strings.Settings_FollowBaseBuiltin;
        ImportThemeBtn.Content = Strings.Settings_ImportThemePackage;
        LanguageTitle.Text = Strings.Settings_Language;
        LanguageHint.Text = Strings.Settings_LanguageHint;
        // 语言名按惯例以自身语言显示，不随当前 UI 文化翻译
        LangSystemBtn.Content = Strings.Common_FollowSystem;
        LangEnglishBtn.Content = "English";
        LangChineseBtn.Content = "简体中文";
        ExtensionsTitle.Text = Strings.Settings_Extensions;
        ExtensionsHint.Text = Strings.Settings_ExtensionsHint;
        DiffModeTitle.Text = Strings.Settings_DiffMode;
        DiffSideBySideBtn.Content = Strings.Common_SideBySide;
        DiffInlineBtn.Content = Strings.Common_Inline;
        DevToolsTitle.Text = Strings.Settings_DevTools;
        DiffPreviewBtn.Content = Strings.Settings_OpenDiffPreview;
        SettingsFileTitle.Text = Strings.Settings_SettingsFile;
        ExportBtn.Content = Strings.Settings_Export;
        ImportBtn.Content = Strings.Settings_Import;

        // ---- 实时监视与后台 fetch（ai-native-redesign.md §7.1）----
        MonitorTitle.Text = Strings.Settings_MonitorSection;
        WatchWorktreeCheck.Content = Strings.Settings_WatchWorktree;
        McpPipeCheck.Content = Strings.Settings_McpPipe;
        AutoFetchCheck.Content = Strings.Settings_AutoFetch;
        FetchIntervalLabel.Text = Strings.Settings_FetchIntervalMinutes;

        // ---- AI 助手（ai-native-redesign.md §八）----
        AiTitle.Text = Strings.Settings_AiSection;
        AiHint.Text = Strings.Settings_AiHint;
        AiProviderLabel.Text = Strings.Settings_AiProvider;
        AiEndpointLabel.Text = Strings.Settings_AiEndpoint;
        AiModelLabel.Text = Strings.Settings_AiModel;
        AiApiKeyLabel.Text = Strings.Settings_AiApiKey;
        AiCliLabel.Text = Strings.Settings_AiCliCommand;
        AiPrivacyLabel.Text = Strings.Settings_AiPrivacy;
        AiTrailerCheck.Content = Strings.Settings_AiAppendTrailer;
        SafetyNetLabel.Text = Strings.Settings_SafetyNetMode;

        // 回填控件值：抑制事件写回（Text/Selection/IsChecked 赋值会触发对应 handler）
        _suppressSettingEvents = true;
        try
        {
            var providerTexts = new[]
            {
                Strings.Settings_AiProviderOff, Strings.Settings_AiProviderOllama, Strings.Settings_AiProviderOpenAi,
                Strings.Settings_AiProviderAnthropic, Strings.Settings_AiProviderCli,
            };
            AiProviderBox.ItemsSource = providerTexts;
            var kindIndex = Array.IndexOf(AiProviderKinds, AiSettings.NormalizeProvider(s.Ai.ProviderKind));
            AiProviderBox.SelectedIndex = kindIndex < 0 ? 0 : kindIndex;
            AiEndpointBox.Text = s.Ai.Endpoint ?? string.Empty;
            AiModelBox.Text = s.Ai.Model ?? string.Empty;
            AiCliBox.Text = s.Ai.CliCommand ?? string.Empty;
            AiPrivacyBox.ItemsSource = new[]
            {
                Strings.Settings_PrivacyDisabled, Strings.Settings_PrivacyMetadata, Strings.Settings_PrivacyFullDiff,
            };
            AiPrivacyBox.SelectedIndex = (int)s.Ai.Privacy;
            SafetyNetBox.ItemsSource = new[]
            {
                Strings.Settings_SafetyOff, Strings.Settings_SafetyWarn, Strings.Settings_SafetyBlock,
            };
            SafetyNetBox.SelectedIndex = (int)s.SafetyNetMode;
            AiTrailerCheck.IsChecked = s.Ai.AppendTrailer;
            WatchWorktreeCheck.IsChecked = s.WatchWorktree;
            McpPipeCheck.IsChecked = s.McpPipeEnabled;
            AutoFetchCheck.IsChecked = s.AutoFetch;
            FetchIntervalBox.Value = s.AutoFetchIntervalMinutes;
            // 密码框不随刷新覆盖用户输入；仅在为空且有存量密文时回填
            if (AiApiKeyBox.Password.Length == 0 && s.Ai.ApiKeyProtected is not null)
                AiApiKeyBox.Password = SecretProtector.Unprotect(s.Ai.ApiKeyProtected) ?? string.Empty;
        }
        finally
        {
            _suppressSettingEvents = false;
        }

        ThemeSystemBtn.FontWeight = s.Theme == ThemePreference.System ? selected : normal;
        ThemeLightBtn.FontWeight = s.Theme == ThemePreference.Light ? selected : normal;
        ThemeDarkBtn.FontWeight = s.Theme == ThemePreference.Dark ? selected : normal;

        var lang = LanguageService.Normalize(s.Language);
        LangSystemBtn.FontWeight = lang == LanguagePreference.System ? selected : normal;
        LangEnglishBtn.FontWeight = lang == LanguagePreference.English ? selected : normal;
        LangChineseBtn.FontWeight = lang == LanguagePreference.SimplifiedChinese ? selected : normal;

        DiffSideBySideBtn.FontWeight = s.DiffMode == DiffViewMode.SideBySide ? selected : normal;
        DiffInlineBtn.FontWeight = s.DiffMode == DiffViewMode.Inline ? selected : normal;

        // ---- 主题包列表（theme-framework.md P3）----
        ThemePackageList.Children.Clear();
        foreach (var pkg in ThemeService.Packages)
        {
            var isSelected = pkg.Id == s.ThemePackageId;
            var origin = pkg.IsBuiltin ? Strings.Common_Builtin : Strings.Common_Custom;
            var baseKind = pkg.BaseKind == ThemeBase.Light ? Strings.ThemePkg_Light : Strings.ThemePkg_Dark;
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
                Text = string.Format(Strings.Settings_ThemePackageRowFormat, pkg.Name, baseKind, origin),
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
            AutomationProperties.SetName(row, string.Format(Strings.Settings_ThemePackageAutomation, pkg.Name));
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

            var origin = pkg.IsBuiltin ? Strings.Common_Builtin : Strings.Common_Custom;
            var kindsText = string.Join("/", pkg.Manifest.Kinds.Select(KindDisplayName));
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
                var kindLabel = KindDisplayName(kind);
                var enabled = GitUI.Core.Extensions.PackageRegistryState.IsEnabled(pkg.Id, kind);
                var cb = new CheckBox
                {
                    Content = kindLabel,
                    IsChecked = enabled,
                    MinWidth = 0,
                    Padding = new Thickness(0),
                    FontSize = 11,
                    Tag = pkg.Id + ":" + kind,
                };
                AutomationProperties.SetName(cb, string.Format(Strings.Settings_EnableKindAutomation, pkg.Name, kindLabel));
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
                    Content = Strings.Settings_Uninstall,
                    FontSize = 11,
                    Padding = new Thickness(8, 2, 8, 3),
                    CornerRadius = new CornerRadius(4),
                    Tag = pkg.Id,
                };
                AutomationProperties.SetName(uninstallBtn, string.Format(Strings.Settings_UninstallAutomation, pkg.Name));
                uninstallBtn.Click += UninstallPackage_Click;
                Grid.SetColumn(uninstallBtn, 2);
                row.Children.Add(uninstallBtn);
            }

            ExtensionPackageList.Children.Add(row);
        }
    }

    /// <summary>扩展包种类显示名（未知种类原样展示）。</summary>
    private static string KindDisplayName(string kind) => kind switch
    {
        "theme" => Strings.Kind_Theme,
        "syntax" => Strings.Kind_Syntax,
        _ => kind,
    };

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

        ShowExtensionStatus(string.Format(
            cb.IsChecked == true ? Strings.Settings_EnabledStatus : Strings.Settings_DisabledStatus,
            entry.Replace(':', '·')));
    }

    /// <summary>卸载用户扩展包（含其全部种类）：主题立即回退内置，语法回退 plain。</summary>
    private void UninstallPackage_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button btn || btn.Tag is not string id) return;

        var wasActiveTheme = _settings.Current.ThemePackageId == id;
        var ok = ThemeService.UninstallPackage(id);
        if (!ok)
        {
            ShowExtensionStatus(Strings.Settings_UninstallFailed);
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
        ShowExtensionStatus(string.Format(Strings.Settings_Uninstalled, id));
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
