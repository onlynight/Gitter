using GitUI.App.Pages;
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
/// 主窗口。Mica 背景 + 自定义标题栏 + 五页签导航（Log / 变更 / 分支 / Git Bash / 设置）。
/// 所有 UI 通过代码构建。参考 ECHWorkers.WinUI3/MainWindow。
/// Git Bash 自 2026-10-03 起承载为导航页签（design.md §4.7.2），不再是右侧停靠面板。
/// </summary>
public sealed partial class MainWindow : Window
{
    private const int SidebarExpandedWidth = 200;
    private const int SidebarCollapsedWidth = 72;
    private const int TitleBarHeight = 48;

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
    private BashPage? _bashPage;

    // Log 页签缓存（S4）：切换页签不丢已加载的提交列表与选中状态
    private LogPage? _logPage;

    // S7：标题栏应用名（随当前仓库更新）、命令面板
    private readonly TextBlock _appTitle;
    private Popup? _commandPalette;
    private TextBox? _paletteInput;
    private ListView? _paletteList;
    private List<CommandItem> _paletteResults = new();

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

        // ---- 侧边栏（Git Bash 与其他页签同级，design.md §4.7.2）----
        var items = new (string Glyph, string Label, string Key)[]
        {
            ("\uE789", "Log", "log"),
            ("\uE7E8", "变更", "changes"),
            ("\uE713", "分支", "branches"),
            ("\uE756", "Git Bash", "bash"),
            ("\uE713", "设置", "settings"),
        };

        var buttons = new List<Button>();
        var navStack = new StackPanel { Spacing = 2 };
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
            FontSize = 15,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        _collapseBtn = new Button
        {
            Content = _toggleIcon,
            Background = ClearBrush,
            BorderThickness = new Thickness(0),
            Padding = new Thickness(8),
            CornerRadius = new CornerRadius(8),
            Width = 36,
            Height = 36,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(8, 0, 0, 0),
        };
        _collapseBtn.Click += CollapseToggle_Click;
        AutomationProperties.SetName(_collapseBtn, "切换侧边栏");

        _appTitle = new TextBlock
        {
            Text = "GitUI",
            FontSize = 14,
            FontWeight = new Windows.UI.Text.FontWeight(600),
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
        _rootGrid = new Grid();
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

        // S7 命令面板按钮（标题栏右侧，系统按钮左侧；design.md §4.1 标题栏命令入口）
        var paletteBtn = new Button
        {
            Content = "",
            FontFamily = new FontFamily("Segoe Fluent Icons, Segoe MDL2 Assets"),
            FontSize = 14,
            Background = ClearBrush,
            BorderThickness = new Thickness(0),
            Padding = new Thickness(6, 4, 6, 4),
            CornerRadius = new CornerRadius(6),
            Width = 32,
            Height = 32,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 0, 160, 0),
        };
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

        // ---- S7 全局快捷键（design.md §6.2）----
        // Ctrl+Shift+P 命令面板
        var paletteAccel = new KeyboardAccelerator { Modifiers = VirtualKeyModifiers.Control | VirtualKeyModifiers.Shift, Key = VirtualKey.P };
        paletteAccel.Invoked += (_, args) => { OpenCommandPalette(); args.Handled = true; };
        _rootGrid.KeyboardAccelerators.Add(paletteAccel);

        // Ctrl+1..5 直达页签（sidebar 顺序：Log / 变更 / 分支 / Git Bash / 设置）
        var pageKeys = new[] { ("log", VirtualKey.Number1), ("changes", VirtualKey.Number2), ("branches", VirtualKey.Number3), ("bash", VirtualKey.Number4), ("settings", VirtualKey.Number5) };
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
        ShowPage("log");
    }

    private void UpdateWindowTitle()
    {
        var workDir = _repoContext.WorkDir;
        var name = workDir is null ? "GitUI" : System.IO.Path.GetFileName(workDir.TrimEnd('/', '\\')) + " - GitUI";
        Title = name;
        _appTitle.Text = name;
    }

    /// <summary>Ctrl+Tab：按 sidebar 顺序循环切换页签。</summary>
    private void CyclePage(int direction)
    {
        var order = new[] { "log", "changes", "branches", "bash", "settings" };
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
        // row = Grid，2 列：Col 0 (icon, Width=22), Col 1 (label, Auto)
        // 展开 & 折叠：row 始终左对齐，icon 靠左，位置固定不变。
        // 折叠时 label 隐藏，icon 位置不变；只 sidebar 变窄。
        var row = new Grid
        {
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(22) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = 16,
            Width = 22,
            Height = 22,
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
            Margin = new Thickness(14, 0, 0, 0),
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
            Padding = new Thickness(12),
            CornerRadius = new CornerRadius(10),
            Height = 44,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Left,
            VerticalContentAlignment = VerticalAlignment.Center,
            Tag = key,
            Margin = new Thickness(8, 2, 8, 2),
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

        _bashPage ??= new BashPage(_settings);
        UIElement page = key switch
        {
            "changes" => _changesPage ??= new ChangesPage(_settings, _repoService, _repoContext),
            "branches" => _branchesPage ??= new BranchesPage(_settings, _repoService, _repoContext),
            "bash" => _bashPage,
            "settings" => new SettingsPage(_settings, ExportSettingsAsync, ImportSettingsAsync),
            _ => _logPage ??= new LogPage(_settings, _repoService, _repoContext),
        };

        _pageHost.Children.Clear();
        _pageHost.Children.Add(page);

        RefreshNavVisuals();
    }

    private void RefreshNavVisuals()
    {
        foreach (var button in _navButtons) RefreshOne(button);
    }

    // ===================== S7：命令面板（design.md §4.6） =====================

    /// <summary>命令面板条目。Action 在 UI 线程执行。</summary>
    public sealed record CommandItem(string Title, Action Action);

    private List<CommandItem> _commands = new();

    /// <summary>构建命令注册表（页面/设置/窗口级命令）。</summary>
    private List<CommandItem> BuildCommands()
    {
        var list = new List<CommandItem>
        {
            new("转到 Log (Ctrl+1)", () => ShowPage("log")),
            new("转到变更 (Ctrl+2)", () => ShowPage("changes")),
            new("转到分支 (Ctrl+3)", () => ShowPage("branches")),
            new("转到 Git Bash (Ctrl+4)", () => ShowPage("bash")),
            new("转到设置 (Ctrl+5)", () => ShowPage("settings")),
            new("刷新当前页 (F5)", RefreshCurrentPage),
            new("新建窗口", OpenNewWindow),
            new("导出设置到文件", () => _ = ExportSettingsAsync()),
            new("从文件导入设置", () => _ = ImportSettingsAsync()),
            new("主题：跟随系统", () => ApplyThemeSetting(ThemePreference.System)),
            new("主题：浅色", () => ApplyThemeSetting(ThemePreference.Light)),
            new("主题：深色", () => ApplyThemeSetting(ThemePreference.Dark)),
            new("Diff 模式：并排", () => ApplyDiffModeSetting(DiffViewMode.SideBySide)),
            new("Diff 模式：内联", () => ApplyDiffModeSetting(DiffViewMode.Inline)),
        };
        return list;
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

    /// <summary>打开命令面板（Ctrl+Shift+P），按当前输入过滤。</summary>
    private void OpenCommandPalette()
    {
        _commands = BuildCommands();

        if (_commandPalette is null)
        {
            _paletteInput = new TextBox { PlaceholderText = "输入命令…" };
            _paletteList = new ListView { MaxHeight = 320, SelectionMode = ListViewSelectionMode.Single };
            _paletteList.DoubleTapped += (_, _) => ExecutePaletteSelection();

            var host = new StackPanel { Spacing = 8, MinWidth = 420 };
            host.Children.Add(_paletteInput);
            host.Children.Add(_paletteList);
            var border = new Border
            {
                Child = host,
                Background = Application.Current?.RequestedTheme == ApplicationTheme.Light
                    ? MakeBrush(0xFF, 0xFA, 0xFA, 0xFB)
                    : MakeBrush(0xFF, 0x27, 0x27, 0x27),
                BorderBrush = MakeBrush(0x40, 0x80, 0x80, 0x80),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(8),
                Padding = new Thickness(12),
            };

            _commandPalette = new Popup
            {
                Child = border,
                IsLightDismissEnabled = true,
            };
            _commandPalette.XamlRoot = Content.XamlRoot;

            _paletteInput.TextChanged += (_, _) => FilterPalette(_paletteInput.Text);
            _paletteInput.KeyDown += (_, e) =>
            {
                switch (e.Key)
                {
                    case VirtualKey.Down when _paletteList is not null:
                        if (_paletteList.SelectedIndex < _paletteResults.Count - 1)
                            _paletteList.SelectedIndex++;
                        e.Handled = true;
                        break;
                    case VirtualKey.Up when _paletteList is not null:
                        if (_paletteList.SelectedIndex > 0)
                            _paletteList.SelectedIndex--;
                        e.Handled = true;
                        break;
                    case VirtualKey.Enter:
                        ExecutePaletteSelection();
                        e.Handled = true;
                        break;
                    case VirtualKey.Escape:
                        _commandPalette.IsOpen = false;
                        e.Handled = true;
                        break;
                }
            };
        }

        _paletteInput!.Text = string.Empty;
        FilterPalette(string.Empty);
        _commandPalette!.IsOpen = true;
        _paletteInput.Focus(FocusState.Keyboard);
    }

    private static SolidColorBrush MakeBrush(byte a, byte r, byte g, byte b)
        => new(Windows.UI.Color.FromArgb(a, r, g, b));

    private void FilterPalette(string query)
    {
        if (_paletteList is null) return;
        _paletteResults = _commands
            .Select(c => (Item: c, Score: GitUI.Core.Services.FuzzyMatcher.Score(c.Title, query)))
            .Where(x => x.Score is not null)
            .OrderByDescending(x => x.Score)
            .Select(x => x.Item)
            .ToList();

        _paletteList.Items.Clear();
        foreach (var item in _paletteResults)
        {
            var lvi = new ListViewItem { Content = item.Title, Padding = new Thickness(8, 4, 8, 4) };
            AutomationProperties.SetName(lvi, item.Title);
            _paletteList.Items.Add(lvi);
        }
        if (_paletteResults.Count > 0) _paletteList.SelectedIndex = 0;
    }

    private void ExecutePaletteSelection()
    {
        if (_paletteList is null || _commandPalette is null) return;
        var idx = _paletteList.SelectedIndex;
        if (idx < 0 || idx >= _paletteResults.Count) return;
        var command = _paletteResults[idx];
        _commandPalette.IsOpen = false;
        command.Action();
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

        button.Background = isSelected ? SelectedBrush : isActive ? HoverBrush : ClearBrush;
        button.Opacity = isSelected ? 1.0 : isActive ? 1.0 : 0.8;

        // 折叠/展开：只切换 label 可见性，row 与 icon 位置固定不变，
        // icon 始终位于按钮左侧（button.Margin.Left + button.Padding.Left = 20）。
        if (button.Content is Grid row && row.Children.Count >= 2
            && row.Children[1] is TextBlock label)
        {
            label.Visibility = _collapsed ? Visibility.Collapsed : Visibility.Visible;
        }
    }
}
