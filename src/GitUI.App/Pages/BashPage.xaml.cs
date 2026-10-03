using System.Text;
using GitUI.Controls;
using GitUI.Core.Settings;
using GitUI.Shell;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.System;

namespace GitUI.App.Pages;

/// <summary>
/// Git Bash 页签（S0e 接线，design.md §4.7.2 / §8-S0e）：
/// TerminalCanvas（S3b）+ TerminalParser（S2b）+ ConptySession（S0d）三方接通；
/// Lazy 会话（首次进入页签才启动进程）；跟随仓库（打开/切换仓库写入 cd）；
/// Bash 未安装空态（下载链接 + 手动指定路径）；状态条（会话状态 / PTY 尺寸 / 跟随仓库）。
/// 会话输出经 DispatcherQueue 回投 UI 线程（解析与绘制同线程串行）。
/// </summary>
public sealed class BashPage : UserControl
{
    private readonly ISettingsStore _settings;
    private readonly RepositoryContext _context;
    private readonly TerminalCanvas _canvas;
    private readonly TerminalParser _parser;
    private readonly TerminalBuffer _buffer;

    private ConptySession? _session;
    private bool _sessionRequested;
    private string? _bashPath;
    private int _cols = 80;
    private int _rows = 24;
    private string _sessionState = "未启动";

    private readonly UIElement _emptyState;
    private readonly TextBlock _statusLeft;
    private readonly ToggleMenuFlyoutItem _followRepoItem;
    private bool _shown;

    public BashPage(ISettingsStore settings, RepositoryContext context)
    {
        _settings = settings;
        _context = context;

        var host = new Grid();
        host.RowDefinitions.Add(new RowDefinition { Height = new GridLength(32) });      // 工具条
        host.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) }); // 终端
        host.RowDefinitions.Add(new RowDefinition { Height = new GridLength(20) });      // 状态条

        // —— 工具条（32px）——
        var titleIcon = new FontIcon { Glyph = "\uE756", FontSize = 13, VerticalAlignment = VerticalAlignment.Center };
        var title = new TextBlock
        {
            Text = "Git Bash",
            FontSize = 12,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(6, 0, 0, 0),
        };
        var titleHost = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(12, 0, 0, 0),
        };
        titleHost.Children.Add(titleIcon);
        titleHost.Children.Add(title);

        var clearBtn = BuildToolbarButton("\uE74D", "清屏");

        var (menu, followItem) = BuildConsoleMenu();
        _followRepoItem = followItem;
        var moreBtn = BuildToolbarButton("\uE712", "更多");
        moreBtn.Flyout = menu;

        var toolsHost = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
            Spacing = 2,
            Margin = new Thickness(0, 0, 6, 0),
        };
        toolsHost.Children.Add(clearBtn);
        toolsHost.Children.Add(moreBtn);

        var toolbar = new Grid();
        toolbar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        toolbar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(titleHost, 0);
        toolbar.Children.Add(titleHost);
        Grid.SetColumn(toolsHost, 1);
        toolbar.Children.Add(toolsHost);

        // —— 终端 / 空态（同一格二选一显示）——
        _buffer = new TerminalBuffer(80, 24);
        _parser = new TerminalParser(_buffer);
        _parser.ResponseReady += response => WriteRaw(Encoding.UTF8.GetBytes(response));

        _canvas = new TerminalCanvas { Buffer = _buffer };
        _canvas.KeyPressed += bytes => WriteRaw(bytes);
        _canvas.ViewportSizeChanged += (cols, rows) => ResizeTo(cols, rows);
        AutomationProperties.SetName(_canvas, "终端输出区");
        Grid.SetRow(_canvas, 1);
        host.Children.Add(_canvas);

        // 清屏按钮的字段捕获晚于赋值（可空流分析要求注册点在赋值后）
        clearBtn.Click += (_, _) =>
        {
            _buffer.EraseDisplayAll();
            _canvas.NotifyOutput();
        };

        _emptyState = BuildEmptyState(host);

        // —— 状态条（20px）——
        _statusLeft = new TextBlock
        {
            FontSize = 11,
            Opacity = 0.72,
            Margin = new Thickness(12, 0, 0, 0),
            VerticalAlignment = VerticalAlignment.Center,
        };
        // 不设显式 Name 的动态文本约定之外：此处 Name 供无障碍定位，内容经 ToScreenText 摘要在画布侧
        var statusRow = new Grid { Height = 20 };
        statusRow.Children.Add(_statusLeft);

        Grid.SetRow(toolbar, 0);
        host.Children.Add(toolbar);
        Grid.SetRow(statusRow, 2);
        host.Children.Add(statusRow);

        Content = host;

        _context.Changed += () => DispatcherQueue.TryEnqueue(FollowRepoIfNeeded);
        _settings.Changed += (_, _) => DispatcherQueue.TryEnqueue(() =>
        {
            _followRepoItem.IsChecked = _settings.Current.TerminalFollowRepo;
            UpdateStatus();
        });

        UpdateStatus();
    }

    /// <summary>页签宿主在首次显示时调用（Lazy 会话启动；重复调用无害）。</summary>
    public void OnShown()
    {
        if (_shown) return;
        _shown = true;
        EnsureSessionStarted();
        FollowRepoIfNeeded();
        _canvas.Focus(FocusState.Programmatic);
    }

    // ---- 会话生命周期 ----

    private void EnsureSessionStarted()
    {
        if (_sessionRequested) return;
        _sessionRequested = true;

        if (!BashLocator.TryLocate(_settings.Current.BashPath, out var bashPath, out var error))
        {
            _sessionState = "未找到 bash";
            ShowEmptyState(error);
            UpdateStatus();
            return;
        }

        _bashPath = bashPath;
        HideEmptyState();
        StartSession();
    }

    private void StartSession()
    {
        try
        {
            var session = new ConptySession(
                commandLine: $"\"{_bashPath}\" -i -l",
                workingDirectory: ResolveWorkDir(),
                initialColumns: _cols,
                initialRows: _rows);
            session.OutputReady += bytes => DispatcherQueue.TryEnqueue(() =>
            {
                _parser.Feed(bytes.Span);
                _canvas.NotifyOutput();
            });
            session.Exited += code => DispatcherQueue.TryEnqueue(() =>
            {
                _sessionState = $"已退出 (code {code})";
                UpdateStatus();
            });
            session.Start();
            _session = session;
            _sessionState = "运行中";
        }
        catch (Exception ex)
        {
            _sessionState = "启动失败";
            ShowEmptyState(ex.Message);
        }
        UpdateStatus();
    }

    /// <summary>重启 shell（⋯ 菜单 / 空态"使用此路径"后）。</summary>
    private void RestartSession()
    {
        _session?.Dispose();
        _session = null;
        _sessionRequested = false;
        _buffer.HardReset();
        _canvas.NotifyOutput();
        EnsureSessionStarted();
    }

    private string ResolveWorkDir()
        => _settings.Current.TerminalFollowRepo && _context.WorkDir is not null
            ? _context.WorkDir
            : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

    // ---- 跟随仓库 ----

    private void FollowRepoIfNeeded()
    {
        if (!_settings.Current.TerminalFollowRepo) return;
        var workDir = _context.WorkDir;
        if (workDir is null || _session is null) return;
        var payload = $"cd \"{workDir.Replace('\\', '/')}\"\n";
        WriteRaw(Encoding.UTF8.GetBytes(payload));
    }

    private void WriteRaw(ReadOnlyMemory<byte> bytes)
    {
        try
        {
            _session?.Write(bytes.Span);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine("pty write: " + ex);
        }
    }

    private void ResizeTo(int cols, int rows)
    {
        _cols = Math.Clamp(cols, 2, 500);
        _rows = Math.Clamp(rows, 2, 300);
        try { _session?.Resize(_cols, _rows); } catch { /* 会话未启动/已退出 */ }
        _buffer.Resize(_cols, _rows);
        UpdateStatus();
    }

    // ---- 空态（bash 未安装 / 启动失败）----

    private UIElement BuildEmptyState(Grid host)
    {
        var card = new StackPanel
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Spacing = 10,
            Visibility = Visibility.Collapsed,
        };
        AutomationProperties.SetName(card, "Git Bash 未安装提示");

        var msg = new TextBlock { FontSize = 15, HorizontalAlignment = HorizontalAlignment.Center, Text = "未检测到 Git Bash" };
        var download = new Button { Content = "打开下载页（git-scm.com）", HorizontalAlignment = HorizontalAlignment.Center };
        AutomationProperties.SetName(download, "打开 Git 下载页");
        download.Click += (_, _) => _ = Launcher.LaunchUriAsync(new Uri("https://git-scm.com/download/win"));

        var manualRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, HorizontalAlignment = HorizontalAlignment.Center };
        var pathBox = new TextBox { MinWidth = 320, PlaceholderText = @"C:\Program Files\Git\bin\bash.exe" };
        AutomationProperties.SetName(pathBox, "手动指定 bash 路径");
        var useBtn = new Button { Content = "使用此路径" };
        AutomationProperties.SetName(useBtn, "使用此路径");
        useBtn.Click += (_, _) =>
        {
            var path = pathBox.Text.Trim();
            if (path.Length == 0) return;
            _settings.Update(s => s.BashPath = path);
            _settings.Save();
            RestartSession();
        };
        manualRow.Children.Add(pathBox);
        manualRow.Children.Add(useBtn);

        card.Children.Add(msg);
        card.Children.Add(download);
        card.Children.Add(manualRow);

        Grid.SetRow(card, 1);
        host.Children.Add(card);
        return card;
    }

    private void ShowEmptyState(string? error)
    {
        _emptyState.Visibility = Visibility.Visible;
        _canvas.Visibility = Visibility.Collapsed;
        if (error is not null) _statusLeft.Text = "错误: " + error;
    }

    private void HideEmptyState()
    {
        _emptyState.Visibility = Visibility.Collapsed;
        _canvas.Visibility = Visibility.Visible;
    }

    // ---- 菜单 ----

    private (MenuFlyout Menu, ToggleMenuFlyoutItem FollowItem) BuildConsoleMenu()
    {
        var menu = new MenuFlyout();

        var restart = new MenuFlyoutItem { Text = "重开 shell" };
        AutomationProperties.SetName(restart, "重开 shell");
        restart.Click += (_, _) => RestartSession();
        menu.Items.Add(restart);

        var copy = new MenuFlyoutItem { Text = "复制屏幕输出" };
        AutomationProperties.SetName(copy, "复制屏幕输出");
        copy.Click += (_, _) =>
        {
            var text = _canvas.SelectedText();
            if (text.Length == 0) text = _buffer.ToScreenText();
            var dp = new Windows.ApplicationModel.DataTransfer.DataPackage();
            dp.SetText(text);
            Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(dp);
        };
        menu.Items.Add(copy);

        var bashrc = new MenuFlyoutItem { Text = "用默认编辑器打开 .bashrc" };
        AutomationProperties.SetName(bashrc, "打开 .bashrc");
        bashrc.Click += (_, _) =>
        {
            var profile = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".bashrc");
            if (!File.Exists(profile)) return;
            var file = Windows.Storage.StorageFile.GetFileFromPathAsync(profile).GetAwaiter().GetResult();
            _ = Launcher.LaunchFileAsync(file);
        };
        menu.Items.Add(bashrc);

        var follow = new ToggleMenuFlyoutItem
        {
            Text = "跟随仓库工作目录",
            IsChecked = _settings.Current.TerminalFollowRepo,
        };
        AutomationProperties.SetName(follow, "跟随仓库工作目录");
        follow.Click += (_, _) =>
        {
            _settings.Update(s => s.TerminalFollowRepo = follow.IsChecked);
            _settings.Save();
            if (follow.IsChecked) FollowRepoIfNeeded();
            UpdateStatus();
        };
        menu.Items.Add(follow);

        return (menu, follow);
    }

    // ---- 状态条 ----

    private void UpdateStatus()
    {
        var follow = _settings.Current.TerminalFollowRepo ? "开" : "关";
        _statusLeft.Text = $"{_sessionState} · {_cols}×{_rows} · 跟随仓库: {follow}"
            + (_bashPath is null ? "" : $" · {Path.GetFileName(_bashPath)}");
    }

    private static Button BuildToolbarButton(string glyph, string automationName)
    {
        var btn = new Button
        {
            Content = new FontIcon { Glyph = glyph, FontSize = 13 },
            Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent),
            BorderThickness = new Thickness(0),
            Padding = new Thickness(6, 4, 6, 4),
            CornerRadius = new CornerRadius(6),
        };
        AutomationProperties.SetName(btn, automationName);
        return btn;
    }
}
