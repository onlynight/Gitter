using GitUI.App.Pages;
using GitUI.Core.Services;
using GitUI.Core.Settings;
using GitUI.Git;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Controls.Primitives;
using Windows.System;
using Windows.UI;

namespace GitUI.App;

/// <summary>
/// 主窗口。Mica 背景 + 自定义标题栏 + 六页签导航（项目 / Log / 变更 / 分支 / Git Bash / 设置）。
/// 所有 UI 通过代码构建。参考 ECHWorkers.WinUI3/MainWindow。
/// Git Bash 自 2026-10-03 起承载为导航页签（design.md §4.7.2），不再是右侧停靠面板。
/// 项目页自 2026-10-04 起为仓库路径唯一入口（项目列表 + 目录选择对话框），替代手动填写。
/// </summary>
public sealed partial class MainWindow : Window
{
    private const int SidebarExpandedWidth = 176;
    private const int SidebarCollapsedWidth = 48;
    private const int TitleBarHeight = 36;

    private readonly ISettingsStore _settings;
    private readonly Button[] _navButtons;
    private readonly Grid _pageHost;
    private readonly Grid _sidebarHost;
    private readonly FontIcon _toggleIcon;
    private readonly Button _collapseBtn;
    private readonly Border _sidebarBorder;
    private readonly Border _titleBarStrip;
    private readonly Grid _rightHost;
    private readonly ColumnDefinition _sidebarColumn;
    private readonly Grid _rootGrid;
    private bool _collapsed;
    private int _sidebarWidth;

    // Git Bash 页签缓存：切换页签不丢输出；S0e 的终端会话将是 App 级单例（§5.1）
    private Pages.TerminalPage? _terminalPage;

    // 项目页签缓存：项目列表 + 目录选择对话框，仓库路径唯一入口（2026-10-04）
    private Pages.ProjectsPage? _projectsPage;

    // Log 页签缓存（S4）：切换页签不丢已加载的提交列表与选中状态
    private LogPage? _logPage;

    // S7：标题栏应用名（随当前仓库更新）、命令面板
    private readonly TextBlock _appTitle;
    private TextBlock? _statusRepo;
    private Popup? _commandPalette;
    private Border? _paletteBorder;
    private TextBox? _paletteInput;
    private ScrollViewer? _paletteScroll;
    private StackPanel? _palettePanel;
    private readonly List<FrameworkElement> _paletteRowButtons = new(); // 与 _paletteRows 平行
    private List<PaletteRow> _paletteRows = new();
    private int _paletteSelectedIndex = -1; // 当前选中命令行索引（组头不可选中）
    private Microsoft.UI.Dispatching.DispatcherQueueTimer? _filterDebounce;

    // 变更页签缓存（S5）：与 Log 页共享 RepositoryContext（当前仓库）
    private ChangesPage? _changesPage;

    // 分支页签缓存（S6）：与 Log 页共享 RepositoryContext（当前仓库）
    private BranchesPage? _branchesPage;

    private readonly RepositoryContext _repoContext = new();

    // App 级唯一服务实例（known-issues 2.3：此前三页各自 new，无共享）
    private readonly LibGit2RepositoryService _repoService = new();

    private string _currentKey = "log";

    private static SolidColorBrush SelectedBrush =>
        Application.Current?.RequestedTheme == ApplicationTheme.Light
            ? new SolidColorBrush(Color.FromArgb(0x33, 0x1C, 0x1B, 0x1F))
            : new SolidColorBrush(Color.FromArgb(0x33, 0xFF, 0xFF, 0xFF));

    private static SolidColorBrush HoverBrush =>
        Application.Current?.RequestedTheme == ApplicationTheme.Light
            ? new SolidColorBrush(Color.FromArgb(0x1A, 0x1C, 0x1B, 0x1F))
            : new SolidColorBrush(Color.FromArgb(0x1A, 0xFF, 0xFF, 0xFF));

    private static readonly SolidColorBrush ClearBrush = new(Color.FromArgb(0, 0, 0, 0));

    public MainWindow(ISettingsStore settings)
    {
        InitializeComponent();
        _settings = settings;

        // 启用 ExtendsContentIntoTitleBar：让 Mica 背景延伸到窗口顶部 48px
        // 覆盖整个标题栏区域。系统只在右上角绘制 min/max/close，其余区域
        // 我们自由布局（TitleBarStrip 拖拽热区 + hamburger + appTitle）。
        // 参考 ECHWorkers.WinUI3/MainWindow。
        _titleBarStrip = new Border
        {
            Height = TitleBarHeight,
            VerticalAlignment = VerticalAlignment.Top,
            Background = ClearBrush,
        };
        this.SetTitleBar(_titleBarStrip);
        this.ExtendsContentIntoTitleBar = true;

        var appWindow = this.AppWindow;
        if (appWindow?.TitleBar != null)
        {
            appWindow.TitleBar.ExtendsContentIntoTitleBar = true;
        }
        this.Title = "GitUI";

        try { this.SystemBackdrop = new MicaBackdrop(); }
        catch { }

        if (appWindow != null)
        {
            appWindow.Resize(new Windows.Graphics.SizeInt32(1120, 700));
            var workArea = Microsoft.UI.Windowing.DisplayArea.Primary.WorkArea;
            appWindow.Move(new Windows.Graphics.PointInt32(
                workArea.X + (workArea.Width - 1120) / 2,
                workArea.Y + (workArea.Height - 700) / 2));
        }

        // ---- 侧边栏（项目页为仓库路径唯一入口，置于首位）----
        var items = new (string Glyph, string Label, string Key)[]
        {
            ("\uE8B7", "项目", "projects"),
            ("\uE789", "Log", "log"),
            ("\uE7E8", "变更", "changes"),
            ("\uE713", "分支", "branches"),
            ("\uE756", "终端", "bash"),
            ("\uE713", "设置", "settings"),
        };

        var buttons = new List<Button>();
        var navStack = new StackPanel { Spacing = 1 };
        foreach (var (glyph, label, key) in items)
        {
            var btn = BuildNavItem(glyph, label, key);
            buttons.Add(btn);
            navStack.Children.Add(btn);
        }
        _navButtons = buttons.ToArray();

        _sidebarHost = new Grid();
        _sidebarHost.Children.Add(navStack);

        // sidebar 用固定 Width 的 Border 包裹，避免 Grid 列分配被 Button 内部
        // 布局干扰。折叠时只需改 Border.Width。
        _sidebarWidth = _settings.Current.SidebarCollapsed ? SidebarCollapsedWidth : SidebarExpandedWidth;
        _collapsed = _settings.Current.SidebarCollapsed;

        _sidebarBorder = new Border
        {
            Child = _sidebarHost,
            Width = _sidebarWidth,
            Background = Ui.Panel,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Stretch,
        };

        // ---- 主内容区 ----
        _pageHost = new Grid();

        _rightHost = new Grid();
        _rightHost.Children.Add(_pageHost);

        // ---- 标题栏：app 名 + 收起按钮 ----
        // 汉堡图标固定于左上角，不跟随 sidebar 折叠状态变化位置。
        _toggleIcon = new FontIcon
        {
            Glyph = "\uE700",
            FontSize = 13,
            Foreground = Ui.Text2,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        _collapseBtn = new Button
        {
            Content = _toggleIcon,
            Background = ClearBrush,
            BorderThickness = new Thickness(0),
            Padding = new Thickness(7),
            CornerRadius = new CornerRadius(Ui.CornerRadius),
            Width = 30,
            Height = 30,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(8, 0, 0, 0),
        };
        _collapseBtn.Click += CollapseToggle_Click;
        AutomationProperties.SetName(_collapseBtn, "切换侧边栏");

        _appTitle = new TextBlock
        {
            Text = "GitUI",
            FontSize = 12.5,
            FontWeight = new Windows.UI.Text.FontWeight(600),
            Foreground = Ui.Text,
            Margin = new Thickness(52, 0, 0, 0),
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Left,
        };

        // ---- 根布局：2 列 × 2 行 ----
        //   Row 0 = 标题栏 48px，跨 2 列
        //   Row 1 = 内容 *
        //   Col 0 = sidebar（Border.Width 控制实际宽度）
        //   Col 1 = 主内容 *（含 Git Bash 页签，design.md §4.7.2）
        // sidebar 只在 Row 1（从 y=48 起），不与标题栏重叠。
        // z-order（Row 0）：TitleBarStrip 底层 → appTitle → collapseBtn 顶层，
        // 保证汉堡按钮可点击、不被拖拽热区遮挡。
        _rootGrid = new Grid { Background = Ui.Base };
        _rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(TitleBarHeight) });
        _rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        _sidebarColumn = new ColumnDefinition { Width = new GridLength(_sidebarWidth) };
        _rootGrid.ColumnDefinitions.Add(_sidebarColumn);
        _rootGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        // TitleBarStrip：透明拖拽热区，铺满 Row 0（底层）
        _titleBarStrip.Margin = new Thickness(0);
        Grid.SetRow(_titleBarStrip, 0);
        Grid.SetColumn(_titleBarStrip, 0);
        Grid.SetColumnSpan(_titleBarStrip, 2);
        _rootGrid.Children.Add(_titleBarStrip);

        // appTitle 在 Row 0，Col 0-1 全宽，Margin.Left 定位在 hamburger 右侧
        _appTitle.HorizontalAlignment = HorizontalAlignment.Left;
        _appTitle.Margin = new Thickness(52, 0, 0, 0); // 8(hamburger margin) + 36(按钮) + 8
        Grid.SetRow(_appTitle, 0);
        Grid.SetColumn(_appTitle, 0);
        Grid.SetColumnSpan(_appTitle, 2);
        _rootGrid.Children.Add(_appTitle);

        // collapseBtn 在最上层，固定左上角
        _collapseBtn.HorizontalAlignment = HorizontalAlignment.Left;
        _collapseBtn.Margin = new Thickness(8, 0, 0, 0);
        Grid.SetRow(_collapseBtn, 0);
        Grid.SetColumn(_collapseBtn, 0);
        Grid.SetColumnSpan(_collapseBtn, 2);
        _rootGrid.Children.Add(_collapseBtn);

        // S7 命令面板入口（标题栏右侧，系统按钮左侧）：文字 chip + 快捷键提示
        var paletteBtn = new Button
        {
            Background = ClearBrush,
            BorderThickness = new Thickness(0),
            CornerRadius = new CornerRadius(Ui.CornerRadius),
            MinHeight = 26,
            Padding = new Thickness(9, 3, 9, 4),
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 0, 160, 0),
        };
        var paletteBtnLabel = new TextBlock { Text = "命令面板", FontSize = 11.5, Foreground = Ui.Text2 };
        var paletteKbd = new Border
        {
            Background = Ui.Base,
            BorderBrush = Ui.BorderStrong,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(3),
            Padding = new Thickness(4, 0, 4, 1),
            Child = new TextBlock { Text = "Ctrl+Shift+P", FontFamily = Ui.Mono, FontSize = 9.5, Foreground = Ui.Text3 },
        };
        var paletteBtnHost = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 7 };
        paletteBtnHost.Children.Add(paletteBtnLabel);
        paletteBtnHost.Children.Add(paletteKbd);
        paletteBtn.Content = paletteBtnHost;
        paletteBtn.PointerEntered += (_, _) => { paletteBtn.Background = Ui.Hover; paletteBtnLabel.Foreground = Ui.Text; };
        paletteBtn.PointerExited += (_, _) => { paletteBtn.Background = ClearBrush; paletteBtnLabel.Foreground = Ui.Text2; };
        paletteBtn.Click += (_, _) => OpenCommandPalette();
        AutomationProperties.SetName(paletteBtn, "命令面板");
        Grid.SetRow(paletteBtn, 0);
        Grid.SetColumn(paletteBtn, 0);
        Grid.SetColumnSpan(paletteBtn, 2);
        _rootGrid.Children.Add(paletteBtn);

        // sidebar 在 Col 0, Row 1
        Grid.SetColumn(_sidebarBorder, 0);
        Grid.SetRow(_sidebarBorder, 1);
        _rootGrid.Children.Add(_sidebarBorder);

        // 主内容 host：Col 1, Row 1
        _rightHost.Margin = new Thickness(0);
        Grid.SetColumn(_rightHost, 1);
        Grid.SetRow(_rightHost, 1);
        _rootGrid.Children.Add(_rightHost);

        // ---- 状态栏（Row 2，跨两列，VSCode 式信息条）----
        _rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(Ui.StatusBarHeight) });
        // 不设 AutomationProperties.Name（显式 Name 覆盖动态文本，UIA 冒烟依赖 Name=内容；
        // known-issues 2.4：屏幕阅读器也会读不到真实项目路径）
        _statusRepo = new TextBlock
        {
            FontFamily = Ui.Mono,
            FontSize = 10.5,
            Foreground = Ui.Text2,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(10, 0, 0, 0),
            TextTrimming = TextTrimming.CharacterEllipsis,
            Text = "未选择项目",
        };
        var statusHint = new TextBlock
        {
            Text = "Ctrl+1..6 切换页签 · F5 刷新",
            FontSize = 10.5,
            Foreground = Ui.Text3,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 0, 10, 0),
        };
        var statusBar = new Grid { Background = Ui.Panel };
        statusBar.Children.Add(_statusRepo);
        Grid.SetRow(_statusRepo, 0);
        var statusHintHost = new Grid();
        statusHintHost.Children.Add(statusHint);
        statusHint.HorizontalAlignment = HorizontalAlignment.Right;
        statusBar.Children.Add(statusHintHost);
        Grid.SetRow(statusBar, 2);
        Grid.SetColumn(statusBar, 0);
        Grid.SetColumnSpan(statusBar, 2);
        _rootGrid.Children.Add(statusBar);

        // 快捷键：Ctrl+J 切换 Git Bash 页签（VSCode Ctrl+J 语义的页签化）、
        // Ctrl+Shift+J 切换跟随仓库（全局，BashPage 监听 Changed 刷新 UI）
        var toggleConsoleAccel = new KeyboardAccelerator { Modifiers = VirtualKeyModifiers.Control, Key = VirtualKey.J };
        toggleConsoleAccel.Invoked += (_, args) =>
        {
            ShowPage(_currentKey == "bash" ? "log" : "bash");
            args.Handled = true;
        };
        _rootGrid.KeyboardAccelerators.Add(toggleConsoleAccel);

        var toggleFollowAccel = new KeyboardAccelerator { Modifiers = VirtualKeyModifiers.Control | VirtualKeyModifiers.Shift, Key = VirtualKey.J };
        toggleFollowAccel.Invoked += (_, args) =>
        {
            _settings.Update(s => s.TerminalFollowRepo = !s.TerminalFollowRepo);
            _settings.Save();
            args.Handled = true;
        };
        _rootGrid.KeyboardAccelerators.Add(toggleFollowAccel);

        // ---- S7 全局快捷键（design.md §6.2 / docs/command-palette-v2.md）----
        // Ctrl+Shift+P 命令面板（不预填）；Ctrl+P 同面板，预填 ">" 进入命令模式（万能入口）
        var paletteAccel = new KeyboardAccelerator { Modifiers = VirtualKeyModifiers.Control | VirtualKeyModifiers.Shift, Key = VirtualKey.P };
        paletteAccel.Invoked += (_, args) => { OpenCommandPalette(); args.Handled = true; };
        _rootGrid.KeyboardAccelerators.Add(paletteAccel);

        var paletteQuickAccel = new KeyboardAccelerator { Modifiers = VirtualKeyModifiers.Control, Key = VirtualKey.P };
        paletteQuickAccel.Invoked += (_, args) => { OpenCommandPalette(">"); args.Handled = true; };
        _rootGrid.KeyboardAccelerators.Add(paletteQuickAccel);

        // Ctrl+Shift+N 创建分支（v2 把"创建分支…"提为全局命令后的主快捷键）
        var createBranchAccel = new KeyboardAccelerator { Modifiers = VirtualKeyModifiers.Control | VirtualKeyModifiers.Shift, Key = VirtualKey.N };
        createBranchAccel.Invoked += (_, args) =>
        {
            var cmd = BuildCommands().FirstOrDefault(c => c.Title == "创建分支…");
            if (cmd is { Enabled: true }) ExecuteCommand(cmd);
            args.Handled = true;
        };
        _rootGrid.KeyboardAccelerators.Add(createBranchAccel);

        // Ctrl+1..6 直达页签（sidebar 顺序：项目 / Log / 变更 / 分支 / Git Bash / 设置）
        var pageKeys = new[] { ("projects", VirtualKey.Number1), ("log", VirtualKey.Number2), ("changes", VirtualKey.Number3), ("branches", VirtualKey.Number4), ("bash", VirtualKey.Number5), ("settings", VirtualKey.Number6) };
        foreach (var (key, vk) in pageKeys)
        {
            var accel = new KeyboardAccelerator { Modifiers = VirtualKeyModifiers.Control, Key = vk };
            var pageKey = key;
            accel.Invoked += (_, args) => { ShowPage(pageKey); args.Handled = true; };
            _rootGrid.KeyboardAccelerators.Add(accel);
        }

        // Ctrl+Tab 循环切换页签
        var cycleAccel = new KeyboardAccelerator { Modifiers = VirtualKeyModifiers.Control, Key = VirtualKey.Tab };
        cycleAccel.Invoked += (_, args) => { CyclePage(+1); args.Handled = true; };
        _rootGrid.KeyboardAccelerators.Add(cycleAccel);

        // F5 刷新当前页
        var refreshAccel = new KeyboardAccelerator { Key = VirtualKey.F5 };
        refreshAccel.Invoked += (_, args) => { RefreshCurrentPage(); args.Handled = true; };
        _rootGrid.KeyboardAccelerators.Add(refreshAccel);

        RootGrid.Children.Clear();
        RootGrid.Children.Add(_rootGrid);

        // 主题
        ApplyTheme(_settings.Current.Theme);
        _settings.Changed += (_, _) => ApplyTheme(_settings.Current.Theme);

        // S7：窗口标题随当前仓库更新（多窗口时任务栏可区分，design.md §6.7）
        _repoContext.Changed += () => DispatcherQueue.TryEnqueue(UpdateWindowTitle);

        RefreshNavVisuals();

        // 启动恢复上次项目（settings.json currentProjectPath；目录已消失则忽略）。
        // 在 ShowPage 之前 Set：先创建的页面靠 P5 的"构造时追上已有上下文"逻辑加载数据。
        var lastProject = _settings.Current.CurrentProjectPath;
        if (!string.IsNullOrEmpty(lastProject) && System.IO.Directory.Exists(lastProject))
        {
            _repoContext.Set(System.IO.Path.GetFullPath(lastProject));
        }

        ShowPage("log");
    }

    private void UpdateWindowTitle()
    {
        var workDir = _repoContext.WorkDir;
        var name = workDir is null ? "GitUI" : System.IO.Path.GetFileName(workDir.TrimEnd('/', '\\')) + " - GitUI";
        Title = name;
        _appTitle.Text = name;
        if (_statusRepo is not null)
        {
            _statusRepo.Text = workDir is null
                ? "未选择项目"
                : $"{System.IO.Path.GetFileName(workDir.TrimEnd('/', '\\'))} · {workDir}";
        }
    }

    /// <summary>Ctrl+Tab：按 sidebar 顺序循环切换页签。</summary>
    private void CyclePage(int direction)
    {
        var order = new[] { "projects", "log", "changes", "branches", "bash", "settings" };
        var idx = Array.IndexOf(order, _currentKey);
        if (idx < 0) idx = 0;
        ShowPage(order[(idx + direction + order.Length) % order.Length]);
    }

    /// <summary>F5：刷新当前页（无刷新语义的页为空操作）。</summary>
    private void RefreshCurrentPage()
    {
        switch (_currentKey)
        {
            case "log": _ = (_logPage is null ? Task.CompletedTask : _logPage.RefreshAsync()); break;
            case "changes": _ = (_changesPage is null ? Task.CompletedTask : _changesPage.RefreshAsync()); break;
            case "branches": _ = (_branchesPage is null ? Task.CompletedTask : _branchesPage.RefreshAsync()); break;
        }
    }

    /// <summary>标题栏折叠/展开按钮点击处理。</summary>
    private void CollapseToggle_Click(object sender, RoutedEventArgs e)
    {
        _collapsed = !_collapsed;
        _sidebarWidth = _collapsed ? SidebarCollapsedWidth : SidebarExpandedWidth;
        // 更新 sidebar 宽度（Border.Width + ColumnDefinition）
        _sidebarBorder.Width = _sidebarWidth;
        _sidebarColumn.Width = new GridLength(_sidebarWidth);
        // 汉堡按钮位置固定在左上角，不随折叠状态变化
        _toggleIcon.Glyph = _collapsed ? "\uE712" : "\uE700";
        _settings.Update(s => s.SidebarCollapsed = _collapsed);
        _settings.Save();
        RefreshNavVisuals();
    }

    /// <summary>按 ThemePreference 应用主题并同步标题栏配色。</summary>
    public void ApplyTheme(ThemePreference preference)
    {
        var theme = preference switch
        {
            ThemePreference.Light => ApplicationTheme.Light,
            ThemePreference.Dark => ApplicationTheme.Dark,
            _ => Application.Current?.RequestedTheme ?? ApplicationTheme.Light,
        };

        try
        {
            if (Application.Current is null) return;
            Application.Current.RequestedTheme = theme;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine("theme: " + ex);
        }

        var titleBar = this.AppWindow?.TitleBar;
        if (titleBar == null) return;

        var isLight = Application.Current?.RequestedTheme == ApplicationTheme.Light;
        var text = isLight ? Color.FromArgb(0xF2, 0x1C, 0x1B, 0x1F) : Color.FromArgb(0xFF, 0xFA, 0xFA, 0xFB);
        var hover = isLight ? Color.FromArgb(0x14, 0, 0, 0) : Color.FromArgb(0x20, 0xFF, 0xFF, 0xFF);
        var pressed = isLight ? Color.FromArgb(0x24, 0, 0, 0) : Color.FromArgb(0x40, 0xFF, 0xFF, 0xFF);
        var clear = Color.FromArgb(0, 0, 0, 0);

        titleBar.BackgroundColor = clear;
        titleBar.ForegroundColor = text;
        titleBar.InactiveBackgroundColor = clear;
        titleBar.InactiveForegroundColor = text;
        titleBar.ButtonBackgroundColor = clear;
        titleBar.ButtonForegroundColor = text;
        titleBar.ButtonInactiveBackgroundColor = clear;
        titleBar.ButtonInactiveForegroundColor = text;
        titleBar.ButtonHoverBackgroundColor = hover;
        titleBar.ButtonHoverForegroundColor = text;
        titleBar.ButtonPressedBackgroundColor = pressed;
        titleBar.ButtonPressedForegroundColor = text;

        RefreshNavVisuals();
    }

    private Button BuildNavItem(string glyph, string label, string key)
    {
        // row = Grid，2 列：Col 0 (icon, Width=20), Col 1 (label, Auto)。
        // 最左是 2px 选中指示条（RefreshOne 按选中态切换可见性）。
        var row = new Grid
        {
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(20) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var indicator = new Border
        {
            Width = 2,
            Background = Ui.Accent,
            CornerRadius = new CornerRadius(1),
            Margin = new Thickness(-10, 5, 0, 5),
            VerticalAlignment = VerticalAlignment.Stretch,
            Visibility = Visibility.Collapsed,
            Tag = "indicator",
        };
        row.Children.Add(indicator);

        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = 14,
            Width = 20,
            Height = 20,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0),
            Tag = "icon",
        };
        Grid.SetColumn(icon, 0);
        row.Children.Add(icon);

        var text = new TextBlock
        {
            Text = label,
            FontSize = 12.5,
            Margin = new Thickness(10, 0, 0, 0),
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Left,
            Tag = "label",
        };
        Grid.SetColumn(text, 1);
        row.Children.Add(text);

        var btn = new Button
        {
            Content = row,
            Background = ClearBrush,
            BorderThickness = new Thickness(0),
            Padding = new Thickness(10, 5, 10, 5),
            CornerRadius = new CornerRadius(Ui.CornerRadius),
            Height = Ui.NavRowHeight,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Left,
            VerticalContentAlignment = VerticalAlignment.Center,
            Tag = key,
            Margin = new Thickness(8, 1, 8, 1),
        };

        btn.Click += NavItem_Click;
        btn.PointerEntered += NavItem_PointerEntered;
        btn.PointerExited += NavItem_PointerExited;
        AutomationProperties.SetName(btn, label);

        return btn;
    }

    private void NavItem_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button button && button.Tag is string key)
        {
            ShowPage(key);
        }
    }

    private void NavItem_PointerEntered(object sender, PointerRoutedEventArgs e)
    {
        if (sender is Button button) RefreshOne(button);
    }

    private void NavItem_PointerExited(object sender, PointerRoutedEventArgs e)
    {
        if (sender is Button button) RefreshOne(button);
    }

    private void ShowPage(string key)
    {
        _currentKey = key;
        // S0e：Bash 页签首次显示时启动 ConPTY 会话（Lazy）
        if (key == "bash") _terminalPage?.OnShown();

        _terminalPage ??= new TerminalPage(_settings, _repoService, _repoContext);
        UIElement page = key switch
        {
            "projects" => _projectsPage ??= new Pages.ProjectsPage(_settings, _repoService, _repoContext, ShowPage, () => Hwnd),
            "changes" => _changesPage ??= new ChangesPage(_settings, _repoService, _repoContext, ShowPage),
            "branches" => _branchesPage ??= new BranchesPage(_repoService, _repoContext, ShowPage),
            "bash" => _terminalPage,
            "settings" => new SettingsPage(_settings, ExportSettingsAsync, ImportSettingsAsync),
            _ => _logPage ??= new LogPage(_settings, _repoService, _repoContext, ShowPage),
        };

        _pageHost.Children.Clear();
        _pageHost.Children.Add(page);

        RefreshNavVisuals();
    }

    private void RefreshNavVisuals()
    {
        foreach (var button in _navButtons) RefreshOne(button);
    }

    // ===================== S7：命令面板 v2（docs/command-palette-v2.md） =====================

    /// <summary>命令面板条目：分类 + 标题 + 快捷键提示 + 动作。Enabled=false 显示置灰、不可执行（Action 在 UI 线程执行）。</summary>
    public sealed record CommandItem(string Category, string Title, string KeyHint, Action Action, bool Enabled = true);

    /// <summary>
    /// 面板行：组头占位（Command=null）或命令项。组头不可选中、↑↓ 自动跳过。
    /// UIA Name 格式：组头 = "分类 X"，命令项 = 命令标题（冒烟依赖，勿改）。
    /// </summary>
    private sealed record PaletteRow(string? HeaderText, string CountText, CommandItem? Command)
    {
        public bool IsHeader => Command is null;

        public static PaletteRow Header(string name, string count) => new(name, count, null);
        public static PaletteRow For(CommandItem cmd) => new(null, string.Empty, cmd);
        public static PaletteRow Empty() => new("没有匹配的命令（Esc 关闭）", string.Empty, null);
    }

    private List<CommandItem> _commands = new();

    /// <summary>分类固定顺序：空查询按此排列组（最近使用组置顶）。</summary>
    private static readonly string[] CategoryOrder = { "导航", "仓库", "提交", "分支", "同步", "视图", "设置" };

    private static string CategoryGlyph(string category) => category switch
    {
        "最近使用" => "\uE823",
        "导航" => "\uE700",
        "仓库" => "\uE8B7",
        "提交" => "\uE73E",
        "分支" => "\uE713",
        "同步" => "\uE895",
        "视图" => "\uE790",
        "设置" => "\uE713",
        _ => "\uE7C3",
    };

    /// <summary>
    /// 构建命令注册表（6 类 30 条，docs/command-palette-v2.md §三）。
    /// 页面动作经缓存页对象调用；可用性在面板打开时求值：未开仓库置灰提交/同步类，
    /// 分支页未打开或无选中置灰分支操作类。
    /// </summary>
    private List<CommandItem> BuildCommands()
    {
        bool repoOpen = _repoContext.WorkDir is not null;
        bool branchesOpen = _branchesPage is { } b && b.IsRepoOpen;
        bool branchSelected = _branchesPage is { } b2 && b2.HasSelectedLocalBranch;

        return new List<CommandItem>
        {
            // ---- 导航 ----
            new("导航", "转到项目", "Ctrl+1", () => ShowPage("projects")),
            new("导航", "转到 Log", "Ctrl+2", () => ShowPage("log")),
            new("导航", "转到变更", "Ctrl+3", () => ShowPage("changes")),
            new("导航", "转到分支", "Ctrl+4", () => ShowPage("branches")),
            new("导航", "转到终端", "Ctrl+5", () => ShowPage("bash")),
            new("导航", "转到设置", "Ctrl+6", () => ShowPage("settings")),
            // ---- 仓库 ----
            new("仓库", "刷新当前页", "F5", RefreshCurrentPage),
            new("仓库", "新建窗口", string.Empty, OpenNewWindow),
            new("仓库", "切换项目", string.Empty, () => ShowPage("projects")),
            // ---- 提交（未开仓库置灰）----
            new("提交", "提交", "Ctrl+Enter", () => { ShowPage("changes"); _changesPage?.CommitFromPalette(push: false); }, repoOpen),
            new("提交", "提交并推送", string.Empty, () => { ShowPage("changes"); _changesPage?.CommitFromPalette(push: true); }, repoOpen),
            new("提交", "全部暂存", string.Empty, () => _changesPage?.StageAllFromPalette(), repoOpen),
            new("提交", "全部撤销暂存", string.Empty, () => _changesPage?.UnstageAllFromPalette(), repoOpen),
            // ---- 分支（分支页未打开或无选中置灰）----
            new("分支", "检出选中分支", string.Empty, () => { ShowPage("branches"); _branchesPage?.CheckoutSelectedFromPalette(); }, branchSelected),
            new("分支", "创建分支…", "Ctrl+Shift+N", () => { ShowPage("branches"); _ = _branchesPage?.CreateBranchFromPaletteAsync(); }, branchesOpen),
            new("分支", "重命名分支", string.Empty, () => { ShowPage("branches"); _ = _branchesPage?.RenameBranchFromPaletteAsync(); }, branchSelected),
            new("分支", "删除分支", string.Empty, () => { ShowPage("branches"); _ = _branchesPage?.DeleteBranchFromPaletteAsync(); }, branchSelected),
            new("分支", "合并到当前分支", string.Empty, () => { ShowPage("branches"); _branchesPage?.MergeSelectedFromPalette(); }, branchSelected),
            new("分支", "变基到该分支", string.Empty, () => { ShowPage("branches"); _branchesPage?.RebaseSelectedFromPalette(); }, branchSelected),
            new("分支", "快进", string.Empty, () => { ShowPage("branches"); _branchesPage?.FastForwardSelectedFromPalette(); }, branchSelected),
            // ---- 同步（未开仓库置灰；动作先跳分支页复用其按钮逻辑）----
            new("同步", "Pull", string.Empty, () => { ShowPage("branches"); _branchesPage?.PullFromPalette(rebase: false); }, repoOpen),
            new("同步", "Pull Rebase", string.Empty, () => { ShowPage("branches"); _branchesPage?.PullFromPalette(rebase: true); }, repoOpen),
            new("同步", "Push", string.Empty, () => { ShowPage("branches"); _branchesPage?.PushFromPalette(); }, repoOpen),
            // ---- 视图 ----
            new("视图", "Diff 模式：并排", string.Empty, () => ApplyDiffModeSetting(DiffViewMode.SideBySide)),
            new("视图", "Diff 模式：内联", string.Empty, () => ApplyDiffModeSetting(DiffViewMode.Inline)),
            new("视图", "主题：跟随系统", string.Empty, () => ApplyThemeSetting(ThemePreference.System)),
            new("视图", "主题：浅色", string.Empty, () => ApplyThemeSetting(ThemePreference.Light)),
            new("视图", "主题：深色", string.Empty, () => ApplyThemeSetting(ThemePreference.Dark)),
            // ---- 设置 ----
            new("设置", "导出设置", string.Empty, () => _ = ExportSettingsAsync()),
            new("设置", "导入设置", string.Empty, () => _ = ImportSettingsAsync()),
        };
    }

    private void ApplyThemeSetting(ThemePreference theme)
    {
        _settings.Update(s2 => s2.Theme = theme);
        _settings.Save();
    }

    private void ApplyDiffModeSetting(DiffViewMode mode)
    {
        _settings.Update(s2 => s2.DiffMode = mode);
        _settings.Save();
    }

    /// <summary>打开命令面板（Ctrl+P / Ctrl+Shift+P / 标题栏 chip）。<paramref name="prefill"/> 非空时预填输入框（">" = 命令模式标记）。</summary>
    private void OpenCommandPalette(string prefill = "")
    {
        _commands = BuildCommands();

        if (_commandPalette is null)
        {
            BuildPaletteUi();
        }

        _paletteInput!.Text = prefill;
        FilterPalette(prefill);
        // 每次打开时刷新面板配色（跟随主题切换）；行内画刷在 FilterPalette 重建时取当前主题
        _paletteBorder!.Background = Ui.Panel;
        _paletteBorder.BorderBrush = Ui.BorderStrong;

        // 顶部居中（VSCode 式）
        if (Content.XamlRoot is { } root)
        {
            _commandPalette!.HorizontalOffset = Math.Max(0, (root.Size.Width - 460) / 2);
            _commandPalette.VerticalOffset = 56;
        }
        _commandPalette!.IsOpen = true;
        _paletteInput.Focus(FocusState.Keyboard);
        _paletteInput.SelectionStart = _paletteInput.Text.Length;
    }

    /// <summary>构建面板 UI：输入行（> 标记 + 输入框 + Ctrl+P kbd）→ 命令列表 → 底栏键位提示。只建一次。</summary>
    private void BuildPaletteUi()
    {
        _paletteInput = new TextBox
        {
            PlaceholderText = "输入命令…",
            FontSize = 12.5,
            MinHeight = 30,
            BorderThickness = new Thickness(0),
            Background = ClearBrush,
            VerticalAlignment = VerticalAlignment.Center,
        };
        // 显式 Name：占位符在部分 UIA 客户端不稳，冒烟依赖 Name="输入命令…"
        AutomationProperties.SetName(_paletteInput, "输入命令…");

        var prompt = new TextBlock
        {
            Text = ">",
            FontFamily = Ui.Mono,
            FontSize = 13,
            Foreground = Ui.Accent,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(4, 0, 8, 0),
        };

        var inputKbd = new Border
        {
            Background = Ui.Base,
            BorderBrush = Ui.BorderStrong,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(3),
            Padding = new Thickness(4, 0, 4, 1),
            VerticalAlignment = VerticalAlignment.Center,
            Child = new TextBlock { Text = "Ctrl+P", FontFamily = Ui.Mono, FontSize = 9.5, Foreground = Ui.Text3 },
        };

        var inputRow = new Grid { Height = 34 };
        inputRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        inputRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        inputRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(prompt, 0);
        inputRow.Children.Add(prompt);
        Grid.SetColumn(_paletteInput, 1);
        inputRow.Children.Add(_paletteInput);
        Grid.SetColumn(inputKbd, 2);
        inputRow.Children.Add(inputKbd);

        // 行容器：ScrollViewer + StackPanel。不用 ListView——ItemClick 在 Single 模式下不保证
        // 触发（冒烟实测），且 ListViewItem 不支持 UIA InvokePattern；行直接用 Button 承载
        // （仓库惯例：ChangesPage/ProjectsPage 的行同款，InvokePattern 可驱动冒烟）。
        _palettePanel = new StackPanel();
        _paletteScroll = new ScrollViewer
        {
            Content = _palettePanel,
            MaxHeight = 320,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };

        var footerLeft = new TextBlock
        {
            Text = "↑↓ 选择 · ↵ 执行 · Esc 关闭",
            FontSize = 10.5,
            Foreground = Ui.Text3,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(2, 0, 0, 0),
        };
        var footerRight = new TextBlock
        {
            Text = "@分类名 直接索引",
            FontSize = 10.5,
            Foreground = Ui.Text3,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
            Margin = new Thickness(0, 0, 2, 0),
        };
        var footer = new Border
        {
            BorderThickness = new Thickness(0, 1, 0, 0),
            BorderBrush = Ui.Border,
            Padding = new Thickness(4, 0, 4, 0),
            Child = new Grid { MinHeight = 26, Children = { footerLeft, footerRight } },
        };

        var host = new StackPanel { Spacing = 4, Padding = new Thickness(6) };
        host.Children.Add(inputRow);
        host.Children.Add(_paletteScroll);
        host.Children.Add(footer);

        _paletteBorder = new Border
        {
            Width = 460,
            Child = host,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(6),
            Background = Ui.Panel,
        };
        _commandPalette = new Popup
        {
            Child = _paletteBorder,
            IsLightDismissEnabled = true,
        };
        _commandPalette.XamlRoot = Content.XamlRoot;

        // 输入即过滤，防抖 120ms（§四）
        _filterDebounce = DispatcherQueue.CreateTimer();
        _filterDebounce.Interval = TimeSpan.FromMilliseconds(120);
        _filterDebounce.Tick += (_, _) => { _filterDebounce.Stop(); FilterPalette(_paletteInput!.Text); };
        _paletteInput.TextChanged += (_, _) => { _filterDebounce.Stop(); _filterDebounce.Start(); };

        _paletteInput.KeyDown += PaletteInput_KeyDown;
    }

    private void PaletteInput_KeyDown(object sender, KeyRoutedEventArgs e)
    {
        switch (e.Key)
        {
            case VirtualKey.Down:
                MovePaletteSelection(+1);
                e.Handled = true;
                break;
            case VirtualKey.Up:
                MovePaletteSelection(-1);
                e.Handled = true;
                break;
            case VirtualKey.Home:
                SelectEdge(+1);
                e.Handled = true;
                break;
            case VirtualKey.End:
                SelectEdge(-1);
                e.Handled = true;
                break;
            case VirtualKey.Enter:
                ExecuteSelectedCommand();
                e.Handled = true;
                break;
            case VirtualKey.Escape:
                if (_commandPalette is not null) _commandPalette.IsOpen = false;
                e.Handled = true;
                break;
        }
    }

    // ---- 过滤与行构建 ----

    private void FilterPalette(string rawQuery)
    {
        if (_palettePanel is null) return;
        _paletteRows = BuildPaletteRows(rawQuery);
        var highlight = ExtractHighlightWord(rawQuery);

        _palettePanel.Children.Clear();
        _paletteRowButtons.Clear();
        for (int i = 0; i < _paletteRows.Count; i++)
        {
            var row = _paletteRows[i];
            FrameworkElement el = row.IsHeader
                ? BuildHeaderItem(row)
                : row.Command is not null
                    ? BuildCommandItem(row, highlight, i)
                    : BuildEmptyStateItem(row);
            _paletteRowButtons.Add(el);
            _palettePanel.Children.Add(el);
        }

        // 选择默认：过滤后选中首个命中（无命令行则不选中）
        _paletteSelectedIndex = FirstSelectableIndex();
        SyncSelection();
    }

    /// <summary>解析查询语法：前缀 "&gt;" 兼容保留（等价空）；"@" 前缀仅按分类过滤；普通文本标题+分类双字段模糊匹配。</summary>
    private List<PaletteRow> BuildPaletteRows(string rawQuery)
    {
        var rows = new List<PaletteRow>();
        var q = rawQuery.TrimStart();
        if (q.StartsWith(">")) q = q[1..].TrimStart();

        if (q.StartsWith("@"))
        {
            var body = q[1..];
            string catQuery = body, wordQuery = string.Empty;
            var sp = body.IndexOf(' ');
            if (sp >= 0)
            {
                catQuery = body[..sp];
                wordQuery = body[(sp + 1)..].Trim();
            }

            foreach (var cat in CategoryOrder)
            {
                if (FuzzyMatcher.Score(cat, catQuery) is null) continue;
                var items = _commands
                    .Where(c => c.Category == cat)
                    .Where(c => wordQuery.Length == 0 || FuzzyMatcher.Score(c.Title, wordQuery) is not null)
                    .ToList();
                if (items.Count == 0) continue;
                AddGroup(rows, cat, items, filtered: true);
            }
            if (rows.Count == 0) rows.Add(PaletteRow.Empty());
            return rows;
        }

        if (q.Length == 0)
        {
            // 空查询：最近使用（≤8，置顶）→ 分类顺序全量
            var recents = new List<CommandItem>();
            foreach (var title in _settings.Current.RecentCommands)
            {
                if (_commands.FirstOrDefault(c => c.Title == title) is not { } cmd) continue;
                recents.Add(cmd);
                if (recents.Count >= 8) break;
            }
            if (recents.Count > 0)
            {
                rows.Add(PaletteRow.Header("最近使用", recents.Count.ToString()));
                foreach (var c in recents) rows.Add(PaletteRow.For(c));
            }
            foreach (var cat in CategoryOrder)
            {
                AddGroup(rows, cat, _commands.Where(c => c.Category == cat).ToList(), filtered: false);
            }
            if (rows.Count == 0) rows.Add(PaletteRow.Empty());
            return rows;
        }

        // 文本查询：标题命中排前（Title null → -1），同类内分类命中次之，最后按注册顺序
        foreach (var cat in CategoryOrder)
        {
            var items = _commands
                .Select((c, i) => (Cmd: c, Order: i, Title: FuzzyMatcher.Score(c.Title, q), Cat: FuzzyMatcher.Score(cat, q)))
                .Where(x => x.Title is not null || x.Cat is not null)
                .OrderByDescending(x => x.Title ?? -1)
                .ThenByDescending(x => x.Cat ?? 0)
                .ThenBy(x => x.Order)
                .Select(x => x.Cmd)
                .ToList();
            AddGroup(rows, cat, items, filtered: true);
        }
        if (rows.Count == 0) rows.Add(PaletteRow.Empty());
        return rows;
    }

    private void AddGroup(List<PaletteRow> rows, string category, List<CommandItem> items, bool filtered)
    {
        if (items.Count == 0) return;
        rows.Add(PaletteRow.Header(category, filtered ? $"命中 {items.Count}" : items.Count.ToString()));
        foreach (var c in items) rows.Add(PaletteRow.For(c));
    }

    /// <summary>行内高亮词：普通查询取全文；@分类 词 模式取空格后的标题词；均无则不高亮。</summary>
    private static string? ExtractHighlightWord(string rawQuery)
    {
        var q = rawQuery.TrimStart();
        if (q.StartsWith(">")) q = q[1..].TrimStart();
        if (q.StartsWith("@"))
        {
            var body = q[1..];
            var sp = body.IndexOf(' ');
            if (sp < 0) return null;
            var word = body[(sp + 1)..].Trim();
            return word.Length == 0 ? null : word;
        }
        q = q.TrimEnd();
        return q.Length == 0 ? null : q;
    }

    /// <summary>分类组头：base 底、11px 半粗 Text3、右侧 mono 计数，24px。点击 = 组名填入输入框（等价 @组名）。</summary>
    private Button BuildHeaderItem(PaletteRow row)
    {
        var name = new TextBlock
        {
            Text = row.HeaderText,
            FontSize = 11,
            FontWeight = new Windows.UI.Text.FontWeight(600),
            Foreground = Ui.Text3,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var count = new TextBlock
        {
            Text = row.CountText,
            FontFamily = Ui.Mono,
            FontSize = 10.5,
            Foreground = Ui.Text3,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        var grid = new Grid { MinHeight = 24 };
        grid.Children.Add(name);
        grid.Children.Add(count);

        var btn = new Button
        {
            Content = new Border
            {
                Background = Ui.Base,
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(8, 0, 8, 0),
                Child = grid,
            },
            Background = ClearBrush,
            BorderThickness = new Thickness(0),
            Padding = new Thickness(0),
            Margin = new Thickness(0, 2, 0, 1),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            IsTabStop = false,
        };
        AutomationProperties.SetName(btn, $"分类 {row.HeaderText}");
        btn.Click += (_, _) => ActivatePaletteRow(row);
        return btn;
    }

    /// <summary>空态：不可交互的一行提示。</summary>
    private FrameworkElement BuildEmptyStateItem(PaletteRow row)
    {
        var host = new Border
        {
            Padding = new Thickness(8, 6, 8, 6),
            Child = new TextBlock
            {
                Text = row.HeaderText,
                FontSize = 12,
                Foreground = Ui.Text3,
                HorizontalAlignment = HorizontalAlignment.Center,
            },
        };
        AutomationProperties.SetName(host, row.HeaderText ?? string.Empty);
        return host;
    }

    /// <summary>命令行：[2px accent 条][图标][标题（命中词高亮）][kbd]，28px。置灰项 IsEnabled=false。</summary>
    private Button BuildCommandItem(PaletteRow row, string? highlight, int index)
    {
        var cmd = row.Command!;
        var bar = new Border
        {
            Width = 2,
            Background = Ui.Accent,
            CornerRadius = new CornerRadius(1),
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Stretch,
            Margin = new Thickness(2, 4, 0, 4),
            Visibility = Visibility.Collapsed,
            Tag = "bar",
        };
        var icon = new FontIcon
        {
            Glyph = CategoryGlyph(cmd.Category),
            FontSize = 12,
            Foreground = Ui.Text2,
            Width = 16,
            Height = 16,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var grid = new Grid { Height = 28 };
        var title = BuildTitle(cmd.Title, highlight);
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(16) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(bar, 0);
        grid.Children.Add(bar);
        Grid.SetColumn(icon, 1);
        grid.Children.Add(icon);
        Grid.SetColumn(title, 2);
        grid.Children.Add(title);
        if (cmd.KeyHint.Length > 0)
        {
            var kbd = new Border
            {
                Background = Ui.Base,
                BorderBrush = Ui.BorderStrong,
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(4, 0, 4, 1),
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(8, 0, 2, 0),
                Child = new TextBlock { Text = cmd.KeyHint, FontFamily = Ui.Mono, FontSize = 9.5, Foreground = Ui.Text3 },
            };
            Grid.SetColumn(kbd, 3);
            grid.Children.Add(kbd);
        }

        var btn = new Button
        {
            Content = grid,
            Background = ClearBrush,
            BorderThickness = new Thickness(0),
            Padding = new Thickness(0),
            MinHeight = 28,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            IsTabStop = false,
        };
        btn.IsEnabled = cmd.Enabled;
        if (!cmd.Enabled) btn.Opacity = 0.45;
        AutomationProperties.SetName(btn, cmd.Title);
        btn.Click += (_, _) => ActivatePaletteRow(row);
        // 悬停高亮（按钮模板无 hover 底，手工画；选中行的底色归 UpdateSelectionVisuals 管）
        btn.PointerEntered += (_, _) => { if (index != _paletteSelectedIndex) btn.Background = Ui.Hover; };
        btn.PointerExited += (_, _) => { if (index != _paletteSelectedIndex) btn.Background = ClearBrush; };
        return btn;
    }

    /// <summary>
    /// 标题文本：命中词以 accent 20% 底色高亮（连续子串命中时）。
    /// WinUI 的 Run 无 Background，用 前缀 + Border 包裹命中词 + 后缀 三段拼装；后缀承担省略号裁剪。
    /// </summary>
    private static FrameworkElement BuildTitle(string title, string? highlight)
    {
        var idx = string.IsNullOrEmpty(highlight) ? -1 : title.IndexOf(highlight, StringComparison.OrdinalIgnoreCase);
        if (idx < 0)
        {
            return new TextBlock
            {
                Text = title,
                FontSize = 12.5,
                VerticalAlignment = VerticalAlignment.Center,
                TextTrimming = TextTrimming.CharacterEllipsis,
            };
        }

        var row = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(new TextBlock { Text = title[..idx], FontSize = 12.5, VerticalAlignment = VerticalAlignment.Center });
        row.Children.Add(new Border
        {
            Background = Ui.AccentSoft,
            CornerRadius = new CornerRadius(2),
            Child = new TextBlock { Text = title.Substring(idx, highlight!.Length), FontSize = 12.5 },
        });
        row.Children.Add(new TextBlock
        {
            Text = title[(idx + highlight!.Length)..],
            FontSize = 12.5,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        return row;
    }

    // ---- 选择与执行 ----

    private int FirstSelectableIndex()
    {
        for (int i = 0; i < _paletteRows.Count; i++)
        {
            if (!_paletteRows[i].IsHeader) return i;
        }
        return -1;
    }

    /// <summary>↑↓/Home/End 移动选择，自动跳过组头。</summary>
    private void MovePaletteSelection(int delta)
    {
        int i = _paletteSelectedIndex;
        while (true)
        {
            i += delta;
            if (i < 0 || i >= _paletteRows.Count) return;
            if (!_paletteRows[i].IsHeader) break;
        }
        _paletteSelectedIndex = i;
        SyncSelection();
    }

    private void SelectEdge(int direction)
    {
        int i = direction > 0 ? 0 : _paletteRows.Count - 1;
        while (i >= 0 && i < _paletteRows.Count && _paletteRows[i].IsHeader) i += direction;
        if (i < 0 || i >= _paletteRows.Count) return;
        _paletteSelectedIndex = i;
        SyncSelection();
    }

    private void SyncSelection()
    {
        UpdateSelectionVisuals();
        // 滚动到选中行（WinAppSDK 2.3 无 StartBringIntoView，手动算偏移）
        if (_paletteSelectedIndex >= 0 && _paletteSelectedIndex < _paletteRowButtons.Count
            && _paletteRowButtons[_paletteSelectedIndex] is FrameworkElement el
            && _paletteScroll is not null
            && _paletteScroll.ViewportHeight > 0)
        {
            var top = el.TransformToVisual(_paletteScroll).TransformPoint(new Windows.Foundation.Point(0, 0)).Y;
            var bottom = top + el.ActualHeight;
            var viewTop = _paletteScroll.VerticalOffset;
            var viewBottom = viewTop + _paletteScroll.ViewportHeight;
            double? newY = top < viewTop ? top : bottom > viewBottom ? bottom - _paletteScroll.ViewportHeight : null;
            if (newY is not null) _paletteScroll.ChangeView(null, newY, null, disableAnimation: true);
        }
    }

    /// <summary>选中行：selected 底 + 左侧 2px accent 条；其余行回透明底。</summary>
    private void UpdateSelectionVisuals()
    {
        for (int i = 0; i < _paletteRowButtons.Count; i++)
        {
            var selected = i == _paletteSelectedIndex;
            if (_paletteRowButtons[i] is not Button { Content: Grid grid } btn) continue;
            foreach (var child in grid.Children)
            {
                if (child is Border b && Equals(b.Tag, "bar"))
                    b.Visibility = selected ? Visibility.Visible : Visibility.Collapsed;
            }
            btn.Background = selected ? Ui.Selected : ClearBrush;
        }
    }

    /// <summary>
    /// 行激活：单击即执行（VSCode 式，替换 v1 DoubleTapped 的"双击无响应"缺陷）。
    /// 行是 Button——鼠标 Click 与 UIA InvokePattern 同一路径（本会话物理输入不可靠，冒烟走 Invoke）。
    /// 组头 = 组名填入输入框（等价 @组名）；空态/最近使用组头不响应。
    /// </summary>
    private void ActivatePaletteRow(PaletteRow row)
    {
        if (row.IsHeader)
        {
            if (row.HeaderText is string h && CategoryOrder.Contains(h) && _paletteInput is not null)
            {
                _paletteInput.Text = "@" + h;
                _paletteInput.Focus(FocusState.Keyboard);
                _paletteInput.SelectionStart = _paletteInput.Text.Length;
            }
            return;
        }

        if (row.Command is { } cmd) ExecuteCommand(cmd);
    }

    private void ExecuteSelectedCommand()
    {
        if (_paletteSelectedIndex < 0 || _paletteSelectedIndex >= _paletteRows.Count) return;
        if (_paletteRows[_paletteSelectedIndex].Command is { } cmd) ExecuteCommand(cmd);
    }

    /// <summary>执行：关面板 → 记最近使用（去重置顶，超 8 删尾，立即持久化）→ 跑动作。</summary>
    private void ExecuteCommand(CommandItem cmd)
    {
        if (!cmd.Enabled) return;
        if (_commandPalette is not null) _commandPalette.IsOpen = false;
        RecordRecentCommand(cmd.Title);
        cmd.Action();
    }

    private void RecordRecentCommand(string title)
    {
        _settings.Update(s =>
        {
            var list = new List<string>(8) { title };
            foreach (var t in s.RecentCommands)
            {
                if (list.Count >= 8) break;
                if (!string.Equals(t, title, StringComparison.Ordinal)) list.Add(t);
            }
            s.RecentCommands = list;
        });
        _settings.Save();
    }

    // ===================== S7：多窗口（design.md §6.7） =====================

    /// <summary>打开一个新主窗口（每仓库一窗口；窗口自带独立的页签缓存与仓库上下文）。</summary>
    private void OpenNewWindow()
    {
        App.OpenNewWindow();
    }

    // ===================== S7：设置导入导出 =====================

    private IntPtr Hwnd => WinRT.Interop.WindowNative.GetWindowHandle(this);

    /// <summary>导出当前设置为 JSON 文件（FileSavePicker）。</summary>
    private async System.Threading.Tasks.Task ExportSettingsAsync()
    {
        try
        {
            var picker = new Windows.Storage.Pickers.FileSavePicker
            {
                SuggestedStartLocation = Windows.Storage.Pickers.PickerLocationId.DocumentsLibrary,
                SuggestedFileName = "gitui-settings",
            };
            picker.FileTypeChoices.Add("JSON", new List<string> { ".json" });
            WinRT.Interop.InitializeWithWindow.Initialize(picker, Hwnd);

            var file = await picker.PickSaveFileAsync();
            if (file is null) return;
            await Windows.Storage.FileIO.WriteTextAsync(file, JsonSettingsStore.ToJson(_settings.Current));
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine("export settings: " + ex);
        }
    }

    /// <summary>从 JSON 文件导入设置（损坏文件保持现状，不崩）。</summary>
    private async System.Threading.Tasks.Task ImportSettingsAsync()
    {
        try
        {
            var picker = new Windows.Storage.Pickers.FileOpenPicker
            {
                SuggestedStartLocation = Windows.Storage.Pickers.PickerLocationId.DocumentsLibrary,
            };
            picker.FileTypeFilter.Add(".json");
            WinRT.Interop.InitializeWithWindow.Initialize(picker, Hwnd);

            var file = await picker.PickSingleFileAsync();
            if (file is null) return;
            var text = await Windows.Storage.FileIO.ReadTextAsync(file);
            _settings.Replace(JsonSettingsStore.FromJson(text));
            _settings.Save();
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine("import settings: " + ex);
        }
    }

    private void RefreshOne(Button button)
    {
        var isSelected = button.Tag as string == _currentKey;
        var isActive = isSelected || button.IsPointerOver;

        button.Background = isSelected ? Ui.Selected : isActive ? Ui.Hover : ClearBrush;
        button.Opacity = 1.0;

        // 选中指示条（BuildNavItem 里 Tag="indicator" 的 2px 强调色竖条）
        if (button.Content is Grid row)
        {
            foreach (var child in row.Children)
            {
                if (child is Border b && b.Tag as string == "indicator")
                    b.Visibility = isSelected ? Visibility.Visible : Visibility.Collapsed;
            }
        }

        // 折叠/展开：只切换 label 可见性，row 与 icon 位置固定不变，
        // icon 始终位于按钮左侧（button.Margin.Left + button.Padding.Left = 20）。
        if (button.Content is Grid row2 && row2.Children.Count >= 3
            && row2.Children[2] is TextBlock label)
        {
            label.Visibility = _collapsed ? Visibility.Collapsed : Visibility.Visible;
        }
    }
}
