using System.Text;
using GitUI.Controls;
using GitUI.Core.Services;
using GitUI.Core.Settings;
using GitUI.Shell;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.System;

namespace GitUI.App.Pages;

/// <summary>
/// 终端页（S0e + P1/P2/P4，design.md §4.7）：
/// TerminalCanvas（S3b）+ TerminalParser（S2b）+ 多后端会话（ConPTY / winpty，P2/P3）。
/// shell 可选 PowerShell / CMD / Git Bash（P1：默认 PowerShell 系统内置零外部依赖）；
/// ConPTY 不可用（RDP 0xC0000142，§11.10.5）自动降级 winpty 后端（P2）；
/// ConPTY 预检门控 + SEM_FAILCRITICALERRORS 弹窗抑制；
/// 跟随仓库；Lazy 会话；状态条（后端档位 / PTY 尺寸 / 跟随仓库）。
/// </summary>
public sealed class TerminalPage : UserControl
{
    private readonly ISettingsStore _settings;
    private readonly IRepositoryService _repoService;
    private readonly RepositoryContext _context;
    private readonly Action? _closeCommandPalette;
    private readonly TerminalCanvas _canvas;
    private readonly TerminalParser _parser;
    private readonly TerminalBuffer _buffer;

    private ITerminalSession? _session;
    private bool _sessionRequested;

    /// <summary>会话重启代际：每次重启自增，使在途的异步启动流程失效（P0 修复：双会话竞争崩溃）。</summary>
    private int _restartGeneration;
    private string? _bashPath;
    private int _cols = 80;
    private int _rows = 24;
    private string _sessionState = "未启动";
    private string _backend = "";

    private readonly UIElement _emptyState;
    private readonly TextBlock _statusLeft;
    private readonly ToggleMenuFlyoutItem _followRepoItem;
    private bool _shown;

    public TerminalPage(ISettingsStore settings, IRepositoryService repoService, RepositoryContext context,
        Action? closeCommandPalette = null)
    {
        _closeCommandPalette = closeCommandPalette;
        _settings = settings;
        _repoService = repoService;
        _context = context;

        var host = new Grid();
        host.RowDefinitions.Add(new RowDefinition { Height = new GridLength(32) });      // 工具条
        host.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) }); // 终端
        host.RowDefinitions.Add(new RowDefinition { Height = new GridLength(20) });      // 状态条

        // —— 工具条（32px）——
        var titleIcon = new FontIcon { Glyph = "\uE756", FontSize = 13, VerticalAlignment = VerticalAlignment.Center };
        var title = new TextBlock
        {
            Text = "终端",
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

        var shellLabel = new TextBlock { Text = "Shell:", FontSize = 11.5, VerticalAlignment = VerticalAlignment.Center, Opacity = 0.8 };
        var shellBox = new ComboBox { MinWidth = 110, FontSize = 11.5 };
        AutomationProperties.SetName(shellBox, "终端 Shell 选择");
        foreach (var s in new[] { "PowerShell", "CMD", "Git Bash" }) shellBox.Items.Add(s);
        shellBox.SelectedIndex = CurrentShellKind() switch
        {
            TerminalShellKind.Cmd => 1,
            TerminalShellKind.Bash => 2,
            _ => 0,
        };
        _shellBox = shellBox;

        var toolsHost = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
            Spacing = 4,
            Margin = new Thickness(0, 0, 6, 0),
        };
        toolsHost.Children.Add(shellLabel);
        toolsHost.Children.Add(shellBox);
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

        _emptyState = BuildEmptyState(host);

        // 清屏按钮：字段捕获晚于赋值（可空流分析），注册移到这里
        clearBtn.Click += (_, _) =>
        {
            _buffer.EraseDisplayAll();
            _canvas.NotifyOutput();
        };

        // Shell 切换：重启会话（字段捕获同上，注册移到 _buffer/_canvas 赋值后）
        _shellBox.SelectionChanged += (_, _) =>
        {
            if (_shellBox.SelectedIndex < 0) return;
            var kind = _shellBox.SelectedIndex switch
            {
                1 => TerminalShellKind.Cmd,
                2 => TerminalShellKind.Bash,
                _ => TerminalShellKind.PowerShell,
            };
            _settings.Update(s => s.TerminalShell = kind);
            _settings.Save();
            RestartSession();
        };

        // —— 状态条（20px）——
        _statusLeft = new TextBlock
        {
            FontSize = 11,
            Opacity = 0.72,
            Margin = new Thickness(12, 0, 0, 0),
            VerticalAlignment = VerticalAlignment.Center,
        };
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

    private readonly ComboBox _shellBox;

    /// <summary>页签宿主在首次显示时调用（Lazy 会话启动；重复调用无害）。</summary>
    public void OnShown()
    {
        if (_shown) return;
        _shown = true;
        _closeCommandPalette?.Invoke(); // 终端页独占键盘：命令面板残留会截获全部键入
        EnsureSessionStarted();
        _canvas.Focus(FocusState.Programmatic);
    }


    // ---- 会话生命周期（分层后端：ConPTY → winpty）----

    private void EnsureSessionStarted()
    {
        if (_sessionRequested) return;
        _sessionRequested = true;
        var generation = ++_restartGeneration;
        _ = EnsureSessionStartedAsync(generation);
    }

    private async Task EnsureSessionStartedAsync(int generation)
    {
        // 代际不符 = 已被更新的重启流程取代（RestartSession 会复位 _sessionRequested）
        if (generation != _restartGeneration) return;

        // 0. shell 解析（P1：PowerShell/CMD 系统内置零依赖，bash 可选）
        var shellKind = CurrentShellKind();
        string commandLine;
        string? cwd = ResolveWorkDir();
        if (shellKind == TerminalShellKind.Bash)
        {
            if (!BashLocator.TryLocate(_settings.Current.BashPath, out var bashPath, out var bashError))
            {
                _sessionState = "未找到 bash";
                ShowEmptyState("未检测到 Git Bash（已选 Git Bash shell）：" + (bashError ?? "请安装 Git for Windows 或改用 PowerShell/CMD。"));
                UpdateStatus();
                return;
            }
            _bashPath = bashPath;
            commandLine = $"\"{bashPath}\" -i -l";
        }
        else if (shellKind == TerminalShellKind.Cmd)
        {
            commandLine = "cmd.exe";
        }
        else
        {
            commandLine = "powershell.exe -NoLogo";
        }

        // 1. ConPTY 环境预检：RDP/非交互会话下伪控制台子进程 DLL 初始化整体失败
        //    （bash/cmd 0xC0000142，§11.10.5）——先探测，选择健康后端
        _sessionState = "正在检测终端环境…";
        UpdateStatus();
        var backend = "";
        var healthy = await Task.Run(() =>
        {
            var conpty = ConptyProbe.IsHealthy();
            backend = conpty ? "ConPTY" : "winpty";
            return conpty;
        });

        // 探测期间用户又切了 shell → 本轮启动作废（新重启流程已接管）
        if (generation != _restartGeneration)
        {
            return;
        }

        _backend = backend;

        if (healthy)
        {
            // 2. ConPTY 后端
            _sessionState = "启动中";
            UpdateStatus();
            StartConptySession(commandLine, cwd, generation);
        }
        else
        {
            // 3. winpty 后端（P2）：ConPTY 不可用时仍提供完整终端
            _sessionState = "启动中";
            UpdateStatus();
            StartWinPtySession(commandLine, cwd, generation);
        }
    }

    private void StartConptySession(string commandLine, string? cwd, int generation)
    {
        try
        {
            var session = new ConptySession(
                commandLine: commandLine,
                workingDirectory: cwd,
                initialColumns: _cols,
                initialRows: _rows);
            WireSession(session);
            session.Start();
            if (generation != _restartGeneration)
            {
                session.Dispose(); // 启动期间用户又切了 shell → 本次产物作废
                return;
            }

            _session = session;
            _sessionState = "运行中";
        }
        catch (Exception ex)
        {
            _sessionState = "启动失败";
            ShowEmptyState("ConPTY 会话启动失败：" + ex.Message);
        }
        UpdateStatus();
    }

    private void StartWinPtySession(string commandLine, string? cwd, int generation)
    {
        try
        {
            HideEmptyState();
            var session = new WinPtySession(commandLine, cwd, _cols, _rows);
            WireSession(session);
            session.Start();
            if (generation != _restartGeneration)
            {
                session.Dispose(); // 启动期间用户又切了 shell → 本次产物作废
                return;
            }

            _session = session;
            _sessionState = "运行中";
        }
        catch (Exception ex)
        {
            _sessionState = "winpty 启动失败";
            ShowEmptyState("winpty 会话启动失败：" + ex.Message);
        }
        UpdateStatus();
    }

    private void WireSession(ITerminalSession session)
    {
        session.OutputReady += bytes => DispatcherQueue.TryEnqueue(() =>
        {
            if (!ReferenceEquals(_session, session)) return; // 旧会话尾部输出不进当前解析器
            _parser.Feed(bytes.Span);
            _canvas.NotifyOutput();
        });
        session.Exited += code => DispatcherQueue.TryEnqueue(() =>
        {
            if (!ReferenceEquals(_session, session)) return;
            _sessionState = $"已退出 (code {code})";
            UpdateStatus();
        });
    }

    /// <summary>重启 shell（shell 切换 / ⋯ 菜单 / 会话退出后）。</summary>
    private void RestartSession()
    {
        var old = _session;
        _session = null;
        _sessionRequested = false;
        _restartGeneration++; // 使在途的异步启动流程失效
        _buffer.HardReset();
        _canvas.NotifyOutput();

        if (old is not null)
        {
            // 会话销毁包含最长 10s 的线程 Join（ConPTY 关闭后 shell 退出慢），
            // 移出 UI 线程执行——避免切 shell 时界面冻结
            var oldSession = old;
            _ = Task.Run(() =>
            {
                try { oldSession.Dispose(); }
                catch (Exception ex) { System.Diagnostics.Debug.WriteLine("pty dispose: " + ex); }
            });
        }

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

    private string CurrentShellKind()
    {
        var v = (_settings.Current.TerminalShell ?? string.Empty).Trim().ToLowerInvariant();
        return v switch
        {
            TerminalShellKind.Cmd => TerminalShellKind.Cmd,
            TerminalShellKind.Bash => TerminalShellKind.Bash,
            _ => TerminalShellKind.PowerShell,
        };
    }

    // ---- 空态（环境不支持 / bash 未安装 / 启动失败）----

    private UIElement BuildEmptyState(Grid host)
    {
        var card = new StackPanel
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Spacing = 10,
            Visibility = Visibility.Collapsed,
        };
        AutomationProperties.SetName(card, "终端环境提示");

        var msg = new TextBlock
        {
            FontSize = 14,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
            Text = "终端不可用",
        };
        var hint = new TextBlock
        {
            FontSize = 11.5,
            Opacity = 0.7,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
            Text = "可改用其他 Shell（工具条下拉）或打开下载页安装 Git Bash。",
        };

        var download = new Button { Content = "打开下载页（git-scm.com）", HorizontalAlignment = HorizontalAlignment.Center };
        AutomationProperties.SetName(download, "打开 Git 下载页");
        download.Click += (_, _) => _ = Launcher.LaunchUriAsync(new Uri("https://git-scm.com/download/win"));

        card.Children.Add(msg);
        card.Children.Add(hint);
        card.Children.Add(download);

        Grid.SetRow(card, 1);
        host.Children.Add(card);
        return card;
    }

    private void ShowEmptyState(string? message)
    {
        _emptyState.Visibility = Visibility.Visible;
        _canvas.Visibility = Visibility.Collapsed;
        if (_emptyState is Panel panel
            && panel.Children.Count > 0
            && panel.Children[0] is TextBlock msg
            && message is not null)
        {
            msg.Text = message;
        }
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
        var backend = string.IsNullOrEmpty(_backend) ? "" : $" · {_backend}";
        _statusLeft.Text = $"{_sessionState}{backend} · {_cols}×{_rows} · 跟随仓库: {follow}";
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
