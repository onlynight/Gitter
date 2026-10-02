using GitUI.Core.Settings;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Windows.ApplicationModel.DataTransfer;
using Windows.System;
using Windows.UI;

namespace GitUI.App.Pages;

/// <summary>
/// Git Bash 页签（S0b 外壳，2026-10-03 起承载于左侧导航的主内容区，
/// 不再是右侧停靠面板——design.md §4.7.2 已更新）。
/// 工具条 + 输出区 + 输入行 + 状态条；ConPTY 在 S0e 接线，
/// 当前为占位 stub，支持 echo / clear / exit。
/// 代码构建（§11.2：Button.Padding 不能进 XAML 属性）。
/// </summary>
public sealed class BashPage : UserControl
{
    private readonly ISettingsStore _settings;
    private readonly TextBox _output;
    private readonly TextBox _input;
    private readonly TextBlock _statusLeft;
    private readonly ToggleMenuFlyoutItem _followRepoItem;

    public BashPage(ISettingsStore settings)
    {
        _settings = settings;

        var host = new Grid();
        host.RowDefinitions.Add(new RowDefinition { Height = new GridLength(32) });      // 工具条
        host.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) }); // 输出
        host.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });         // 输入行
        host.RowDefinitions.Add(new RowDefinition { Height = new GridLength(20) });      // 状态条

        // —— 工具条（32px）：▣ Git Bash …… [清屏] [⋯] ——
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
        clearBtn.Click += (_, _) => ClearConsole();

        var moreBtn = BuildToolbarButton("\uE712", "更多");
        var (consoleMenu, followItem) = BuildConsoleMenu();
        moreBtn.Flyout = consoleMenu;
        _followRepoItem = followItem;

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
        Grid.SetRow(toolbar, 0);
        host.Children.Add(toolbar);

        // —— 输出区（S0b stub：只读 TextBox 模拟终端输出）——
        _output = new TextBox
        {
            AcceptsReturn = true,
            IsReadOnly = true,
            TextWrapping = TextWrapping.NoWrap,
            FontFamily = new FontFamily($"{_settings.Current.TerminalFontFamily}, Consolas"),
            FontSize = _settings.Current.TerminalFontSize,
            Margin = new Thickness(8, 4, 8, 4),
            BorderThickness = new Thickness(0),
            Background = ClearBrush,
        };
        ScrollViewer.SetVerticalScrollBarVisibility(_output, ScrollBarVisibility.Auto);
        ScrollViewer.SetHorizontalScrollBarVisibility(_output, ScrollBarVisibility.Auto);
        Grid.SetRow(_output, 1);
        host.Children.Add(_output);

        // —— 输入行：❯ [command] ——
        var prompt = new TextBlock
        {
            Text = "\u276F",
            FontFamily = new FontFamily($"{_settings.Current.TerminalFontFamily}, Consolas"),
            FontSize = _settings.Current.TerminalFontSize,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(12, 0, 6, 4),
        };
        _input = new TextBox
        {
            PlaceholderText = "输入命令（stub 支持 echo / clear / exit）",
            FontFamily = new FontFamily($"{_settings.Current.TerminalFontFamily}, Consolas"),
            FontSize = _settings.Current.TerminalFontSize,
            Margin = new Thickness(0, 0, 12, 4),
        };
        _input.KeyDown += Input_KeyDown;

        var inputHost = new Grid();
        inputHost.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        inputHost.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(prompt, 0);
        inputHost.Children.Add(prompt);
        Grid.SetColumn(_input, 1);
        inputHost.Children.Add(_input);
        Grid.SetRow(inputHost, 2);
        host.Children.Add(inputHost);

        // —— 状态条（20px）——
        _statusLeft = new TextBlock
        {
            FontSize = 11,
            Opacity = 0.65,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(12, 0, 0, 0),
        };
        var statusRight = new TextBlock
        {
            Text = "\u25CF Stub（ConPTY 于 S0e 接入）",
            FontSize = 11,
            Opacity = 0.65,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
            Margin = new Thickness(0, 0, 12, 0),
        };
        var statusHost = new Grid();
        statusHost.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        statusHost.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_statusLeft, 0);
        statusHost.Children.Add(_statusLeft);
        Grid.SetColumn(statusRight, 1);
        statusHost.Children.Add(statusRight);
        Grid.SetRow(statusHost, 3);
        host.Children.Add(statusHost);

        Content = host;

        AppendConsoleLine("Git Bash 面板（S0b 外壳）");
        AppendConsoleLine("ConPTY 将在 S0e 阶段接入；当前为占位 stub，支持 echo / clear / exit。");
        UpdateConsoleStatus();

        // 跟随仓库开关可能被 Ctrl+Shift+J（MainWindow）或设置页改变，这里同步 UI
        _settings.Changed += (_, _) => OnSettingsChanged();
    }

    private static readonly SolidColorBrush ClearBrush = new(Color.FromArgb(0, 0, 0, 0));

    private void OnSettingsChanged()
    {
        _followRepoItem.IsChecked = _settings.Current.TerminalFollowRepo;
        UpdateConsoleStatus();
    }

    private (MenuFlyout Menu, ToggleMenuFlyoutItem FollowRepoItem) BuildConsoleMenu()
    {
        var menu = new MenuFlyout();

        var reopen = new MenuFlyoutItem { Text = "重开 shell" };
        reopen.Click += (_, _) =>
        {
            ClearConsole();
            AppendConsoleLine("stub: 会话已重开（真实 shell 将在 S0e 接入）");
        };
        menu.Items.Add(reopen);

        var bashrc = new MenuFlyoutItem { Text = "用默认编辑器打开 .bashrc" };
        bashrc.Click += (_, _) => OpenBashrc();
        menu.Items.Add(bashrc);

        var followItem = new ToggleMenuFlyoutItem
        {
            Text = "跟随仓库目录（Ctrl+Shift+J）",
            IsChecked = _settings.Current.TerminalFollowRepo,
        };
        followItem.Click += (_, _) =>
        {
            _settings.Update(s => s.TerminalFollowRepo = followItem.IsChecked);
            _settings.Save();
            // 状态条由 Changed 事件回调刷新
        };
        menu.Items.Add(followItem);

        var copy = new MenuFlyoutItem { Text = "复制输出" };
        copy.Click += (_, _) => CopyConsoleOutput();
        menu.Items.Add(copy);

        return (menu, followItem);
    }

    private static Button BuildToolbarButton(string glyph, string name)
    {
        var btn = new Button
        {
            Content = new FontIcon { Glyph = glyph, FontSize = 14 },
            Background = ClearBrush,
            BorderThickness = new Thickness(0),
            Padding = new Thickness(5),
            CornerRadius = new CornerRadius(6),
            Width = 28,
            Height = 28,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(btn, name);
        return btn;
    }

    private void Input_KeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key != VirtualKey.Enter)
        {
            return;
        }

        e.Handled = true;
        SubmitStubCommand();
    }

    private void SubmitStubCommand()
    {
        var command = _input.Text.Trim();
        _input.Text = string.Empty;
        if (command.Length == 0)
        {
            return;
        }

        AppendConsoleLine("\u276F " + command);
        switch (command)
        {
            case "clear" or "cls":
                ClearConsole();
                break;
            case "exit":
                AppendConsoleLine("会话已结束 · 工具条 ⋯ → 重开 shell");
                break;
            default:
                if (command.StartsWith("echo ", StringComparison.Ordinal))
                {
                    AppendConsoleLine(command[5..]);
                }
                else
                {
                    AppendConsoleLine($"stub: '{command}' 未执行 —— ConPTY 将在 S0e 阶段接入");
                }

                break;
        }
    }

    private void AppendConsoleLine(string line) => _output.Text += line + Environment.NewLine;

    private void ClearConsole() => _output.Text = string.Empty;

    private void UpdateConsoleStatus()
    {
        var follow = _settings.Current.TerminalFollowRepo ? "开" : "关";
        _statusLeft.Text = $"stub · 80×24 · 跟随仓库: {follow}";
    }

    private void OpenBashrc()
    {
        var bashrc = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".bashrc");
        if (!File.Exists(bashrc))
        {
            AppendConsoleLine($"未找到 {bashrc}");
            return;
        }

        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = "explorer.exe",
                ArgumentList = { bashrc },
                UseShellExecute = true,
            });
        }
        catch (Exception ex)
        {
            AppendConsoleLine("打开 .bashrc 失败: " + ex.Message);
        }
    }

    private void CopyConsoleOutput()
    {
        try
        {
            var package = new DataPackage { RequestedOperation = DataPackageOperation.Copy };
            package.SetText(_output.Text);
            Clipboard.SetContent(package);
        }
        catch (Exception ex)
        {
            AppendConsoleLine("复制失败: " + ex.Message);
        }
    }
}
