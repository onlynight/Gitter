using System.Text;
using GitUI.Controls;
using GitUI.Core.Resources;
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
/// 终端页（S0e + P1/P2/P4 + P3-D4 多终端 tab，design.md §4.7 / ai-native-redesign.md §6.3）：
/// TerminalCanvas（S3b）+ TerminalParser（S2b）+ 多后端会话（ConPTY / winpty，P2/P3）。
/// shell 可选 PowerShell / CMD / Git Bash；ConPTY 不可用（RDP 0xC0000142）自动降级 winpty；
/// 跟随仓库；Lazy 会话；状态条；agent 活动感知（§7.3）+ 反馈直投（§3.4）。
/// D4：tab 条——每个 tab 一套独立的 buffer/parser/canvas/session，任务 worktree 可开
/// 固定 cwd 的专用终端（OpenWorktreeSession，不跟随仓库切换）。
/// </summary>
public sealed class TerminalPage : UserControl
{
    private readonly ISettingsStore _settings;
    private readonly IRepositoryService _repoService;
    private readonly RepositoryContext _context;
    private readonly Action? _closeCommandPalette;

    private readonly List<TerminalTab> _tabs = new();
    private TerminalTab _current = null!;
    private readonly StackPanel _tabStrip;
    private readonly Grid _termHost;
    private readonly UIElement _emptyState;

    private string? _bashPath;

    /// <summary>会话状态种类（语言中立；UpdateStatus 时按当前语言转译，支持热切换）。</summary>
    private enum TermState
    {
        NotStarted, BashNotFound, Probing, Starting, Running, StartFailed, StartFailedWinpty, Exited,
    }

    /// <summary>空态失败种类（重转译用）。</summary>
    private enum EmptyFailKind { None, BashMissing, Conpty, Winpty }

    /// <summary>
    /// 一个终端 tab：独立的 buffer/parser/canvas/session 与全部会话状态。
    /// PinnedCwd 非空 = 任务专用终端（cwd 固定，不跟随仓库切换）。
    /// </summary>
    private sealed class TerminalTab
    {
        public required string Title;
        public required TerminalBuffer Buffer = null!;
        public required TerminalParser Parser = null!;
        public required TerminalCanvas Canvas = null!;
        public ITerminalSession? Session;
        public bool SessionRequested;
        public int RestartGeneration;
        public TermState State = TermState.NotStarted;
        public string Backend = "";
        public int? ExitCode;
        public EmptyFailKind EmptyFailKind = EmptyFailKind.None;
        public string EmptyFailDetail = string.Empty;
        public GitUI.Shell.BashLocateError? BashFailure;
        public int Cols = 80;
        public int Rows = 24;
        public readonly GitUI.Core.Ai.AgentActivityMatcher AgentActivity = new();
        public string? AgentHint;
        public readonly Queue<byte[]> PendingInput = new();
        public string? PinnedCwd;

        public bool IsRunning => State == TermState.Running && Session is not null;
    }

    private readonly TextBlock _statusLeft;
    private readonly ToggleMenuFlyoutItem _followRepoItem;
    private readonly TextBlock _titleText;
    private readonly Button _clearBtn;
    private readonly Button _moreBtn;
    // 在 BuildEmptyState/BuildConsoleMenu（ctor 调用的方法）中赋值：非 readonly + null!
    private TextBlock _emptyMsg = null!;
    private TextBlock _emptyHint = null!;
    private Button _emptyDownload = null!;
    private MenuFlyoutItem _restartItem = null!;
    private MenuFlyoutItem _copyItem = null!;
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
        host.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });         // tab 条
        host.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) }); // 终端
        host.RowDefinitions.Add(new RowDefinition { Height = new GridLength(20) });      // 状态条

        // —— 工具条（32px）——
        var titleIcon = new FontIcon { Glyph = "\uE756", FontSize = 13, VerticalAlignment = VerticalAlignment.Center };
        var title = _titleText = new TextBlock
        {
            Text = Strings.Nav_Terminal,
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

        var clearBtn = _clearBtn = BuildToolbarButton("\uE74D", Strings.Terminal_Clear);

        var (menu, followItem) = BuildConsoleMenu();
        _followRepoItem = followItem;
        var moreBtn = _moreBtn = BuildToolbarButton("\uE712", Strings.Terminal_More);
        moreBtn.Flyout = menu;

        var shellLabel = new TextBlock { Text = "Shell:", FontSize = 11.5, VerticalAlignment = VerticalAlignment.Center, Opacity = 0.8 };
        var shellBox = new ComboBox { MinWidth = 110, FontSize = 11.5 };
        AutomationProperties.SetName(shellBox, Strings.Terminal_ShellPickerAutomation);
        foreach (var s in new[] { "PowerShell", "CMD", "Git Bash" }) shellBox.Items.Add(s);
        shellBox.SelectedIndex = CurrentShellKind() switch
        {
            TerminalShellKind.Cmd => 1,
            TerminalShellKind.Bash => 2,
            _ => 0,
        };
        var _shellBox = shellBox;

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

        // —— tab 条（26px；Auto：仅一个 tab 时也显示，作为"新建终端"入口）——
        _tabStrip = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 2,
            Margin = new Thickness(8, 1, 8, 1),
        };
        var addTabBtn = BuildToolbarButton("\uE710", Strings.Terminal_NewTab);
        addTabBtn.Padding = new Thickness(4, 2, 4, 2);
        addTabBtn.Click += (_, _) => ActivateTab(CreateTab());
        _tabStrip.Children.Add(addTabBtn);

        // —— 终端 / 空态（同一格二选一显示；canvas 按 tab 切换）——
        _termHost = new Grid();
        _emptyState = BuildEmptyState(_termHost);

        // 清屏按钮：作用于当前 tab
        clearBtn.Click += (_, _) =>
        {
            _current.Buffer.EraseDisplayAll();
            _current.Canvas.NotifyOutput();
        };

        // Shell 切换：重启当前 tab 的会话（全局设置照旧）
        shellBox.SelectionChanged += (_, _) =>
        {
            if (shellBox.SelectedIndex < 0) return;
            var kind = shellBox.SelectedIndex switch
            {
                1 => TerminalShellKind.Cmd,
                2 => TerminalShellKind.Bash,
                _ => TerminalShellKind.PowerShell,
            };
            _settings.Update(s => s.TerminalShell = kind);
            _settings.Save();
            RestartSession(_current);
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
        Grid.SetRow(_tabStrip, 1);
        host.Children.Add(_tabStrip);
        Grid.SetRow(_termHost, 2);
        host.Children.Add(_termHost);
        Grid.SetRow(statusRow, 3);
        host.Children.Add(statusRow);

        Content = host;

        // 初始 tab（保持既有"单会话"默认体验：首个 tab 不关闭重建）
        ActivateTab(CreateTab());

        _context.Changed += () => DispatcherQueue.TryEnqueue(FollowRepoIfNeeded);
        _settings.Changed += (_, _) => DispatcherQueue.TryEnqueue(() =>
        {
            _followRepoItem.IsChecked = _settings.Current.TerminalFollowRepo;
            UpdateStatus();
        });

        UpdateStatus();
    }

    // ---- tab 管理 ----

    private TerminalTab CreateTab(string title = "", string? pinnedCwd = null)
    {
        var tab = new TerminalTab
        {
            Title = title.Length > 0 ? title : Strings.Terminal_TabDefault,
            Buffer = new TerminalBuffer(80, 24),
            Parser = null!,
            Canvas = null!,
            PinnedCwd = pinnedCwd,
        };
        tab.Parser = new TerminalParser(tab.Buffer);
        tab.Parser.ResponseReady += response => WriteRaw(tab, Encoding.UTF8.GetBytes(response));
        tab.Canvas = new TerminalCanvas { Buffer = tab.Buffer };
        tab.Canvas.KeyPressed += bytes => WriteRaw(tab, bytes);
        tab.Canvas.ViewportSizeChanged += (cols, rows) => ResizeTo(tab, cols, rows);
        AutomationProperties.SetName(tab.Canvas, "终端输出区");
        _tabs.Add(tab);
        RebuildTabStrip();
        return tab;
    }

    private void ActivateTab(TerminalTab tab)
    {
        _current = tab;
        // 只换 canvas；空态卡常驻宿主树
        for (var i = _termHost.Children.Count - 1; i >= 0; i--)
            if (_termHost.Children[i] is TerminalCanvas) _termHost.Children.RemoveAt(i);
        _termHost.Children.Add(tab.Canvas);
        if (!_termHost.Children.Contains(_emptyState)) _termHost.Children.Add(_emptyState);

        var failed = tab.State is TermState.BashNotFound or TermState.StartFailed or TermState.StartFailedWinpty;
        if (failed) ShowEmptyState(tab, ComposeEmptyFailText(tab));
        else HideEmptyState(tab);
        RebuildTabStrip();
        UpdateStatus();
        if (_shown) tab.Canvas.Focus(FocusState.Programmatic);
    }

    private void CloseTab(TerminalTab tab)
    {
        var index = _tabs.IndexOf(tab);
        if (index < 0) return;
        _tabs.Remove(tab);
        DisposeSession(tab);

        if (_tabs.Count == 0)
        {
            ActivateTab(CreateTab());
            return;
        }
        if (_current == tab)
            ActivateTab(_tabs[Math.Clamp(index, 0, _tabs.Count - 1)]);
        else
            RebuildTabStrip();
    }

    private void RebuildTabStrip()
    {
        // 保留首位的"+"按钮，其后每个 tab 一个按钮
        var addBtn = _tabStrip.Children.Count > 0 ? _tabStrip.Children[0] : null;
        _tabStrip.Children.Clear();
        if (addBtn is not null) _tabStrip.Children.Add(addBtn);

        foreach (var tab in _tabs)
        {
            var isCurrent = ReferenceEquals(tab, _current);
            var caption = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
            caption.Children.Add(new TextBlock
            {
                Text = tab.Title,
                FontSize = 11,
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = isCurrent ? Ui.Text : Ui.Text2,
            });
            var close = new TextBlock
            {
                Text = "\uE711",
                FontSize = 9,
                VerticalAlignment = VerticalAlignment.Center,
                Opacity = 0.6,
            };
            caption.Children.Add(close);

            var btn = new Button
            {
                Content = caption,
                FontSize = 11,
                Padding = new Thickness(8, 2, 6, 3),
                CornerRadius = new CornerRadius(5),
                Background = isCurrent ? Ui.AccentSoft : new SolidColorBrush(Microsoft.UI.Colors.Transparent),
                BorderThickness = new Thickness(0),
            };
            AutomationProperties.SetName(btn, string.Format(Strings.Terminal_TabAutomation, tab.Title));
            btn.Click += (_, _) => ActivateTab(tab);
            btn.RightTapped += (_, _) => CloseTab(tab);
            caption.Children[1].Tapped += (_, _) => CloseTab(tab); // ✕ 关闭
            _tabStrip.Children.Add(btn);
        }
    }

    /// <summary>
    /// 任务 worktree 专用终端（ai-native-redesign.md §6.3）：cwd 固定到该 worktree
    /// （不跟随仓库切换）；同 worktree 复用已有 tab。
    /// </summary>
    internal void OpenWorktreeSession(string title, string cwd)
    {
        var existing = _tabs.FirstOrDefault(t => t.PinnedCwd == cwd);
        var tab = existing ?? CreateTab(title, cwd);
        ActivateTab(tab);
        EnsureSessionStarted(tab);
        if (_shown) tab.Canvas.Focus(FocusState.Programmatic);
    }

    /// <summary>页签宿主在首次显示时调用（Lazy 会话启动；重复调用无害）。</summary>
    public void OnShown()
    {
        if (_shown) return;
        _shown = true;
        _closeCommandPalette?.Invoke(); // 终端页独占键盘：命令面板残留会截获全部键入
        EnsureSessionStarted(_current);
        _current.Canvas.Focus(FocusState.Programmatic);

        // 诊断钩子（diag-term-typing.ps1）：GITTER_TERM_AUTOTYPE=文本 时经 WriteRaw
        // 进暂存队列、会话启动后回放——SendKeys 被环境策略拒绝时的键入链路复现路径；
        // GITTER_TERM_SNAPSHOT=路径 时 15s 后用 RenderTargetBitmap 进程内截取画布 PNG
        var autoType = Environment.GetEnvironmentVariable("GITTER_TERM_AUTOTYPE");
        if (!string.IsNullOrEmpty(autoType)) WriteRaw(_current, Encoding.UTF8.GetBytes(autoType));
        var snapshot = Environment.GetEnvironmentVariable("GITTER_TERM_SNAPSHOT");
        if (!string.IsNullOrEmpty(snapshot)) _ = SnapshotCanvasAsync(snapshot, _current);
    }

    private async Task SnapshotCanvasAsync(string path, TerminalTab tab)
    {
        try
        {
            await Task.Delay(15000); // 等会话启动 + 回显渲染（ConPTY 探测可达 ~7s）
            var rtb = new Microsoft.UI.Xaml.Media.Imaging.RenderTargetBitmap();
            await rtb.RenderAsync(tab.Canvas);
            var pixels = await rtb.GetPixelsAsync();
            var stream = new Windows.Storage.Streams.InMemoryRandomAccessStream();
            var encoder = await Windows.Graphics.Imaging.BitmapEncoder.CreateAsync(
                Windows.Graphics.Imaging.BitmapEncoder.PngEncoderId, stream);
            encoder.SetPixelData(
                Windows.Graphics.Imaging.BitmapPixelFormat.Bgra8,
                Windows.Graphics.Imaging.BitmapAlphaMode.Ignore,
                (uint)rtb.PixelWidth, (uint)rtb.PixelHeight, 96, 96,
                System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions.ToArray(pixels));
            await encoder.FlushAsync();
            using var fs = File.Create(path);
            await stream.AsStreamForRead().CopyToAsync(fs);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine("term snapshot: " + ex.Message);
        }
    }

    // ---- 会话生命周期（分层后端：ConPTY → winpty；全部作用于指定 tab）----

    private void EnsureSessionStarted(TerminalTab tab)
    {
        if (tab.SessionRequested) return;
        tab.SessionRequested = true;
        var generation = ++tab.RestartGeneration;
        _ = EnsureSessionStartedAsync(tab, generation);
    }

    private async Task EnsureSessionStartedAsync(TerminalTab tab, int generation)
    {
        // 代际不符 = 已被更新的重启流程取代（RestartSession 会复位 SessionRequested）
        if (generation != tab.RestartGeneration) return;

        // 0. shell 解析（P1：PowerShell/CMD 系统内置零依赖，bash 可选）
        var shellKind = CurrentShellKind();
        string commandLine;
        string? cwd = ResolveWorkDir(tab);
        if (shellKind == TerminalShellKind.Bash)
        {
            if (!BashLocator.TryLocate(_settings.Current.BashPath, out var bashPath, out var bashError))
            {
                tab.State = TermState.BashNotFound;
                tab.EmptyFailKind = EmptyFailKind.BashMissing;
                tab.BashFailure = bashError;
                if (ReferenceEquals(tab, _current)) { ShowEmptyState(tab, ComposeEmptyFailText(tab)); UpdateStatus(); }
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
        tab.State = TermState.Probing;
        if (ReferenceEquals(tab, _current)) UpdateStatus();
        var backend = "";
        var healthy = await Task.Run(() =>
        {
            var conpty = ConptyProbe.IsHealthy();
            backend = conpty ? "ConPTY" : "winpty";
            return conpty;
        });

        // 探测期间用户又切了 shell → 本轮启动作废（新重启流程已接管）
        if (generation != tab.RestartGeneration)
        {
            return;
        }

        tab.Backend = backend;

        // 2/3. ConPTY 后端 / winpty 后端（P2）
        tab.State = TermState.Starting;
        if (ReferenceEquals(tab, _current)) UpdateStatus();
        try
        {
            ITerminalSession session = healthy
                ? new ConptySession(commandLine: commandLine, workingDirectory: cwd, initialColumns: tab.Cols, initialRows: tab.Rows)
                : new WinPtySession(commandLine, cwd, tab.Cols, tab.Rows);
            if (!healthy) HideEmptyState(tab);
            WireSession(tab, session);
            session.Start();
            if (generation != tab.RestartGeneration)
            {
                session.Dispose(); // 启动期间用户又切了 shell → 本次产物作废
                return;
            }

            tab.Session = session;
            tab.State = TermState.Running;
            FlushPendingInput(tab);
        }
        catch (Exception ex)
        {
            tab.State = healthy ? TermState.StartFailed : TermState.StartFailedWinpty;
            tab.EmptyFailKind = healthy ? EmptyFailKind.Conpty : EmptyFailKind.Winpty;
            tab.EmptyFailDetail = ex.Message;
            if (ReferenceEquals(tab, _current)) ShowEmptyState(tab, ComposeEmptyFailText(tab));
        }
        if (ReferenceEquals(tab, _current)) UpdateStatus();
    }

    private void WireSession(TerminalTab tab, ITerminalSession session)
    {
        session.OutputReady += bytes => DispatcherQueue.TryEnqueue(() =>
        {
            if (!ReferenceEquals(tab.Session, session)) return; // 旧会话尾部输出不进当前解析器

            tab.Parser.Feed(bytes.Span);
            tab.Canvas.NotifyOutput();
            if (tab.AgentActivity.Feed(bytes.Span) is { } activity)
            {
                tab.AgentHint = activity.AgentId;
                if (ReferenceEquals(tab, _current)) UpdateStatus();
            }
        });
        session.Exited += code => DispatcherQueue.TryEnqueue(() =>
        {
            if (!ReferenceEquals(tab.Session, session)) return;
            tab.State = TermState.Exited;
            tab.ExitCode = code;
            if (ReferenceEquals(tab, _current)) UpdateStatus();
        });
    }

    /// <summary>重启 shell（shell 切换 / ⋯ 菜单 / 会话退出后）。仅作用于当前 tab。</summary>
    private void RestartSession(TerminalTab tab)
    {
        var old = tab.Session;
        tab.Session = null;
        tab.SessionRequested = false;
        tab.RestartGeneration++; // 使在途的异步启动流程失效
        tab.Buffer.HardReset();
        tab.Canvas.NotifyOutput();

        if (old is not null)
        {
            // 会话销毁包含最长 10s 的线程 Join（ConPTY 关闭后 shell 退出慢），
            // 移出 UI 线程执行——避免切 shell 时界面冻结
            _ = Task.Run(() =>
            {
                try { old.Dispose(); }
                catch (Exception ex) { System.Diagnostics.Debug.WriteLine("pty dispose: " + ex); }
            });
        }

        EnsureSessionStarted(tab);
    }

    private void DisposeSession(TerminalTab tab)
    {
        var old = tab.Session;
        tab.Session = null;
        if (old is null) return;
        _ = Task.Run(() =>
        {
            try { old.Dispose(); }
            catch (Exception ex) { System.Diagnostics.Debug.WriteLine("pty dispose: " + ex); }
        });
    }

    private string ResolveWorkDir(TerminalTab tab)
        => tab.PinnedCwd
           ?? (_settings.Current.TerminalFollowRepo && _context.WorkDir is not null
                ? _context.WorkDir
                : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile));

    // ---- 跟随仓库 ----

    private void FollowRepoIfNeeded()
    {
        if (!_settings.Current.TerminalFollowRepo) return;
        var workDir = _context.WorkDir;
        if (workDir is null) return;
        var payload = $"cd \"{workDir.Replace('\\', '/')}\"\n";
        foreach (var tab in _tabs)
        {
            if (tab.PinnedCwd is null && tab.IsRunning)
                WriteRaw(tab, Encoding.UTF8.GetBytes(payload)); // 任务专用终端不跟随
        }
    }

    /// <summary>
    /// 反馈直投（ai-native-redesign.md §3.4/§12.7 cli-pty 形态）：把审查反馈 prompt
    /// 写入当前 tab 的 PTY（末尾回车提交）。仅在会话存活且识别到 agent CLI 时由页面启用。
    /// </summary>
    internal bool CanReceiveFeedback => _current.IsRunning && _current.AgentHint is not null;

    internal string? DetectedAgent => _current.AgentHint;

    internal void SendText(string text)
    {
        if (!CanReceiveFeedback) return;
        WriteRaw(_current, Encoding.UTF8.GetBytes(text + "\r"));
    }

    private void WriteRaw(TerminalTab tab, ReadOnlyMemory<byte> bytes)
    {
        var session = tab.Session;
        if (session is null)
        {
            // 会话未就绪（ConPTY 环境探测可达数秒）：暂存键入，会话启动后按序回放。
            // 此前直接静默丢弃 —— 页签打开后立刻键入的字符全部丢失（键入不回显的根因）。
            lock (tab.PendingInput)
            {
                if (tab.PendingInput.Count < 128) tab.PendingInput.Enqueue(bytes.ToArray());
            }
            return;
        }
        try
        {
            session.Write(bytes.Span);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine("pty write: " + ex);
        }
    }

    /// <summary>会话就绪后回放启动期间暂存的键入（保持顺序；上限 128 块防积压）。</summary>
    private void FlushPendingInput(TerminalTab tab)
    {
        lock (tab.PendingInput)
        {
            while (tab.PendingInput.Count > 0 && tab.Session is not null)
            {
                try { tab.Session.Write(tab.PendingInput.Dequeue()); }
                catch (Exception ex) { System.Diagnostics.Debug.WriteLine("pty replay: " + ex); break; }
            }
        }
    }

    private void ResizeTo(TerminalTab tab, int cols, int rows)
    {
        tab.Cols = Math.Clamp(cols, 2, 500);
        tab.Rows = Math.Clamp(rows, 2, 300);
        try { tab.Session?.Resize(tab.Cols, tab.Rows); } catch { /* 会话未启动/已退出 */ }
        tab.Buffer.Resize(tab.Cols, tab.Rows);
        if (ReferenceEquals(tab, _current)) UpdateStatus();
    }

    /// <summary>把 BashLocator 的结构化失败转用户文案（Shell 层语言中立）。</summary>
    private static string? DescribeBashError(GitUI.Shell.BashLocateError? error) => error?.Kind switch
    {
        GitUI.Shell.BashLocateFailureKind.CustomPathMissing => string.Format(Strings.Bash_CustomPathMissing, error.Detail ?? string.Empty),
        GitUI.Shell.BashLocateFailureKind.NotFound => Strings.Bash_LocateFailed,
        _ => null,
    };

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

    // ---- 空态（环境不支持 / bash 未安装 / 启动失败；消息随 current tab）----

    private UIElement BuildEmptyState(Grid host)
    {
        var card = new StackPanel
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Spacing = 10,
            Visibility = Visibility.Collapsed,
        };
        AutomationProperties.SetName(card, Strings.Terminal_EnvironmentAutomation);

        var msg = _emptyMsg = new TextBlock
        {
            FontSize = 14,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
            Text = Strings.Terminal_Unavailable,
        };
        var hint = _emptyHint = new TextBlock
        {
            FontSize = 11.5,
            Opacity = 0.7,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
            Text = Strings.Terminal_UnavailableHint,
        };

        var download = _emptyDownload = new Button { Content = Strings.Terminal_OpenDownload, HorizontalAlignment = HorizontalAlignment.Center };
        AutomationProperties.SetName(download, Strings.Terminal_OpenDownloadAutomation);
        download.Click += (_, _) => _ = Launcher.LaunchUriAsync(new Uri("https://git-scm.com/download/win"));

        card.Children.Add(msg);
        card.Children.Add(hint);
        card.Children.Add(download);

        host.Children.Add(card);
        return card;
    }

    private void ShowEmptyState(TerminalTab tab, string? message)
    {
        _emptyState.Visibility = Visibility.Visible;
        tab.Canvas.Visibility = Visibility.Collapsed;
        if (_emptyState is Panel panel
            && panel.Children.Count > 0
            && panel.Children[0] is TextBlock msg
            && message is not null)
        {
            msg.Text = message;
        }
    }

    private void HideEmptyState(TerminalTab tab)
    {
        _emptyState.Visibility = Visibility.Collapsed;
        tab.Canvas.Visibility = Visibility.Visible;
    }

    // ---- 菜单 ----

    private (MenuFlyout Menu, ToggleMenuFlyoutItem FollowItem) BuildConsoleMenu()
    {
        var menu = new MenuFlyout();

        var restart = _restartItem = new MenuFlyoutItem { Text = Strings.Terminal_RestartShell };
        AutomationProperties.SetName(restart, Strings.Terminal_RestartShell);
        restart.Click += (_, _) => RestartSession(_current);
        menu.Items.Add(restart);

        var copy = _copyItem = new MenuFlyoutItem { Text = Strings.Terminal_CopyScreen };
        AutomationProperties.SetName(copy, Strings.Terminal_CopyScreen);
        copy.Click += (_, _) =>
        {
            var text = _current.Canvas.SelectedText();
            if (text.Length == 0) text = _current.Buffer.ToScreenText();
            var dp = new Windows.ApplicationModel.DataTransfer.DataPackage();
            dp.SetText(text);
            Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(dp);
        };
        menu.Items.Add(copy);

        var follow = new ToggleMenuFlyoutItem
        {
            Text = Strings.Terminal_FollowRepo,
            IsChecked = _settings.Current.TerminalFollowRepo,
        };
        AutomationProperties.SetName(follow, Strings.Terminal_FollowRepo);
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

    /// <summary>语言热切换：静态文案重取值 + 状态/空态重译（docs/i18n.md §四）。</summary>
    internal void OnLanguageChanged()
    {
        _titleText.Text = Strings.Nav_Terminal;
        AutomationProperties.SetName(_clearBtn, Strings.Terminal_Clear);
        AutomationProperties.SetName(_moreBtn, Strings.Terminal_More);
        _restartItem.Text = Strings.Terminal_RestartShell;
        AutomationProperties.SetName(_restartItem, Strings.Terminal_RestartShell);
        _copyItem.Text = Strings.Terminal_CopyScreen;
        AutomationProperties.SetName(_copyItem, Strings.Terminal_CopyScreen);
        _followRepoItem.Text = Strings.Terminal_FollowRepo;
        AutomationProperties.SetName(_followRepoItem, Strings.Terminal_FollowRepo);

        _emptyHint.Text = Strings.Terminal_UnavailableHint;
        _emptyDownload.Content = Strings.Terminal_OpenDownload;
        AutomationProperties.SetName(_emptyDownload, Strings.Terminal_OpenDownloadAutomation);
        _emptyMsg.Text = _current.EmptyFailKind == EmptyFailKind.None ? Strings.Terminal_Unavailable : ComposeEmptyFailText(_current);
        AutomationProperties.SetName(_emptyState, Strings.Terminal_EnvironmentAutomation);

        RebuildTabStrip();
        UpdateStatus();
    }

    private void UpdateStatus()
    {
        var follow = _settings.Current.TerminalFollowRepo ? Strings.Common_On : Strings.Common_Off;
        var backend = string.IsNullOrEmpty(_current.Backend) ? "" : $" · {_current.Backend}";
        var agent = _current.AgentHint is null ? "" : " · " + string.Format(Strings.Terminal_AgentRunning, _current.AgentHint);
        _statusLeft.Text = string.Format(Strings.Terminal_StatusFormat, StateText(_current), backend, _current.Cols, _current.Rows, follow) + agent;
    }

    /// <summary>会话状态文案（按状态种类转译，语言热切换后随 UpdateStatus 重译）。</summary>
    private string StateText(TerminalTab tab) => tab.State switch
    {
        TermState.NotStarted => Strings.Terminal_NotStarted,
        TermState.BashNotFound => Strings.Terminal_BashNotFound,
        TermState.Probing => Strings.Terminal_Probing,
        TermState.Starting => Strings.Terminal_Starting,
        TermState.Running => Strings.Terminal_Running,
        TermState.StartFailed => Strings.Terminal_StartFailed,
        TermState.StartFailedWinpty => Strings.Terminal_StartFailedWinpty,
        TermState.Exited => string.Format(Strings.Terminal_Exited, tab.ExitCode ?? 0),
        _ => string.Empty,
    };

    /// <summary>按失败种类合成空态错误文案（语言热切换后可重译）。</summary>
    private string ComposeEmptyFailText(TerminalTab tab) => tab.EmptyFailKind switch
    {
        EmptyFailKind.BashMissing => string.Format(Strings.Terminal_BashMissing, DescribeBashError(tab.BashFailure) ?? Strings.Terminal_BashMissingFallback),
        EmptyFailKind.Conpty => string.Format(Strings.Terminal_ConptyFailed, tab.EmptyFailDetail),
        EmptyFailKind.Winpty => string.Format(Strings.Terminal_WinptyFailed, tab.EmptyFailDetail),
        _ => Strings.Terminal_Unavailable,
    };

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
