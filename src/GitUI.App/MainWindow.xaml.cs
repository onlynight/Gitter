using GitUI.App.Pages;
using GitUI.Core.Settings;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Windows.ApplicationModel.DataTransfer;
using Windows.System;
using Windows.UI;

namespace GitUI.App;

/// <summary>
/// 主窗口。Mica 背景 + 自定义标题栏 + 四页签导航 + 右侧 Git Bash 面板（S0b 外壳）。
/// 所有 UI 通过代码构建。参考 ECHWorkers.WinUI3/MainWindow。
/// </summary>
public sealed partial class MainWindow : Window
{
    private const int SidebarExpandedWidth = 200;
    private const int SidebarCollapsedWidth = 72;
    private const int TitleBarHeight = 48;

    // Git Bash 面板（design.md §4.7.2：拖拽范围 [360, 960]，默认 480）
    private const double ConsoleMinWidth = 360;
    private const double ConsoleMaxWidth = 960;
    private const double ConsoleDefaultWidth = 480;

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

    // ---- Git Bash 面板（S0b：stub 输出，ConPTY 在 S0e 接线）----
    private readonly ColumnDefinition _consoleColumn;
    private readonly Border _consoleBorder;
    private readonly Border _splitter;
    private readonly TextBox _consoleOutput;
    private readonly TextBox _consoleInput;
    private readonly TextBlock _consoleStatusLeft;
    private readonly FontIcon _consoleCollapseIcon;
    private readonly ToggleMenuFlyoutItem _followRepoItem;
    private bool _consoleCollapsed;
    private double _consoleWidth;
    private bool _consoleDragging;
    private double _dragStartX;
    private double _dragStartWidth;

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

        // ---- 侧边栏 ----
        var items = new (string Glyph, string Label, string Key)[]
        {
            ("\uE789", "Log", "log"),
            ("\uE7E8", "变更", "changes"),
            ("\uE713", "分支", "branches"),
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

        // ---- 右侧内容区 ----
        _pageHost = new Grid();

        _rightHost = new Grid();
        _rightHost.Children.Add(_pageHost);

        // ---- Git Bash 面板（最右列，与 sidebar 对称；design.md §4.7.2）----
        _consoleWidth = _settings.Current.ConsolePaneWidth;
        _consoleCollapsed = _settings.Current.ConsolePaneCollapsed;
        var consoleUi = BuildConsolePane();
        _consoleOutput = consoleUi.Output;
        _consoleInput = consoleUi.Input;
        _consoleStatusLeft = consoleUi.StatusLeft;
        _consoleCollapseIcon = consoleUi.CollapseIcon;
        _followRepoItem = consoleUi.FollowRepoItem;
        _consoleBorder = new Border
        {
            Child = consoleUi.Root,
            Width = _consoleWidth,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
            BorderThickness = new Thickness(1, 0, 0, 0),
            BorderBrush = HoverBrush,
        };

        // 拖拽手柄：位于面板左边缘，自绘以精确控制 clamp 与持久化
        // （原生 GridSplitter 会把 Star 列改写成固定宽度，破坏主区布局）。
        _splitter = new Border
        {
            Width = 8,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Stretch,
            Background = ClearBrush,
        };
        _splitter.PointerEntered += Splitter_PointerEntered;
        _splitter.PointerExited += Splitter_PointerExited;
        _splitter.PointerPressed += Splitter_PointerPressed;
        _splitter.PointerMoved += Splitter_PointerMoved;
        _splitter.PointerReleased += Splitter_PointerReleased;
        _splitter.PointerCanceled += Splitter_PointerReleased;

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

        var appTitle = new TextBlock
        {
            Text = "GitUI",
            FontSize = 14,
            FontWeight = new Windows.UI.Text.FontWeight(600),
            Margin = new Thickness(52, 0, 0, 0),
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Left,
        };

        // ---- 根布局：3 列 × 2 行（design.md §4.7.2）----
        //   Row 0 = 标题栏 48px，跨 3 列
        //   Row 1 = 内容 *
        //   Col 0 = sidebar（Border.Width 控制实际宽度）
        //   Col 1 = 主内容 *
        //   Col 2 = Git Bash 面板（Border.Width 控制，可折叠为 0）
        // sidebar 只在 Row 1（从 y=48 起），不与标题栏重叠。
        // z-order（Row 0）：TitleBarStrip 底层 → appTitle → collapseBtn 顶层，
        // 保证汉堡按钮可点击、不被拖拽热区遮挡。
        _rootGrid = new Grid();
        _rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(TitleBarHeight) });
        _rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        _sidebarColumn = new ColumnDefinition { Width = new GridLength(_sidebarWidth) };
        _consoleColumn = new ColumnDefinition { Width = new GridLength(_consoleCollapsed ? 0 : _consoleWidth) };
        _rootGrid.ColumnDefinitions.Add(_sidebarColumn);
        _rootGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _rootGrid.ColumnDefinitions.Add(_consoleColumn);

        // TitleBarStrip：透明拖拽热区，铺满 Row 0（底层）。ColumnSpan=3，
        // 否则标题栏右侧露出背景（design.md §4.7.2）。
        _titleBarStrip.Margin = new Thickness(0);
        Grid.SetRow(_titleBarStrip, 0);
        Grid.SetColumn(_titleBarStrip, 0);
        Grid.SetColumnSpan(_titleBarStrip, 3);
        _rootGrid.Children.Add(_titleBarStrip);

        // appTitle 在 Row 0，Col 0-1 全宽，Margin.Left 定位在 hamburger 右侧
        appTitle.HorizontalAlignment = HorizontalAlignment.Left;
        appTitle.Margin = new Thickness(52, 0, 0, 0); // 8(hamburger margin) + 36(按钮) + 8
        Grid.SetRow(appTitle, 0);
        Grid.SetColumn(appTitle, 0);
        Grid.SetColumnSpan(appTitle, 2);
        _rootGrid.Children.Add(appTitle);

        // collapseBtn 在最上层，固定左上角
        _collapseBtn.HorizontalAlignment = HorizontalAlignment.Left;
        _collapseBtn.Margin = new Thickness(8, 0, 0, 0);
        Grid.SetRow(_collapseBtn, 0);
        Grid.SetColumn(_collapseBtn, 0);
        Grid.SetColumnSpan(_collapseBtn, 2);
        _rootGrid.Children.Add(_collapseBtn);

        // sidebar 在 Col 0, Row 1
        Grid.SetColumn(_sidebarBorder, 0);
        Grid.SetRow(_sidebarBorder, 1);
        _rootGrid.Children.Add(_sidebarBorder);

        // 右侧内容 host：Col 1, Row 1
        _rightHost.Margin = new Thickness(0);
        Grid.SetColumn(_rightHost, 1);
        Grid.SetRow(_rightHost, 1);
        _rootGrid.Children.Add(_rightHost);

        // 拖拽手柄与面板：Col 2, Row 1。splitter 叠在面板左缘（z-order 在上）。
        Grid.SetColumn(_splitter, 2);
        Grid.SetRow(_splitter, 1);
        _rootGrid.Children.Add(_splitter);
        Grid.SetColumn(_consoleBorder, 2);
        Grid.SetRow(_consoleBorder, 1);
        _rootGrid.Children.Add(_consoleBorder);

        // 快捷键（design.md §4.7.2）：Ctrl+J 折叠面板、Ctrl+Shift+J 切换跟随仓库
        var toggleConsoleAccel = new KeyboardAccelerator { Modifiers = VirtualKeyModifiers.Control, Key = VirtualKey.J };
        toggleConsoleAccel.Invoked += (_, args) =>
        {
            ToggleConsolePane();
            args.Handled = true;
        };
        _rootGrid.KeyboardAccelerators.Add(toggleConsoleAccel);

        var toggleFollowAccel = new KeyboardAccelerator { Modifiers = VirtualKeyModifiers.Control | VirtualKeyModifiers.Shift, Key = VirtualKey.J };
        toggleFollowAccel.Invoked += (_, args) =>
        {
            ToggleFollowRepo();
            args.Handled = true;
        };
        _rootGrid.KeyboardAccelerators.Add(toggleFollowAccel);

        RootGrid.Children.Clear();
        RootGrid.Children.Add(_rootGrid);

        // 主题
        ApplyTheme(_settings.Current.Theme);
        _settings.Changed += (_, _) => ApplyTheme(_settings.Current.Theme);

        RefreshConsoleLayout();
        AppendConsoleLine("Git Bash 面板（S0b 外壳）");
        AppendConsoleLine("ConPTY 将在 S0e 阶段接入；当前为占位 stub，支持 echo / clear / exit。");
        UpdateConsoleStatus();
        RefreshNavVisuals();
        ShowPage("log");
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

        UIElement page = key switch
        {
            "changes" => new ChangesPage(),
            "branches" => new BranchesPage(),
            "settings" => new SettingsPage(_settings),
            _ => new LogPage(),
        };

        _pageHost.Children.Clear();
        _pageHost.Children.Add(page);

        RefreshNavVisuals();
    }

    private void RefreshNavVisuals()
    {
        foreach (var button in _navButtons) RefreshOne(button);
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

    // ==================== Git Bash 面板（S0b 外壳）====================

    private (Grid Root, TextBox Output, TextBox Input, TextBlock StatusLeft, FontIcon CollapseIcon, ToggleMenuFlyoutItem FollowRepoItem) BuildConsolePane()
    {
        var host = new Grid();
        host.RowDefinitions.Add(new RowDefinition { Height = new GridLength(32) });      // 工具条
        host.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) }); // 输出
        host.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });         // 输入行
        host.RowDefinitions.Add(new RowDefinition { Height = new GridLength(20) });      // 状态条

        // —— 工具条（32px）：▣ Git Bash …… [清屏] [折叠] [⋯] ——
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
            Margin = new Thickness(8, 0, 0, 0),
        };
        titleHost.Children.Add(titleIcon);
        titleHost.Children.Add(title);

        var clearBtn = BuildToolbarButton("\uE74D", "清屏");
        clearBtn.Click += (_, _) => ClearConsole();

        var collapseBtn = BuildToolbarButton("\uE8A7", "折叠面板 (Ctrl+J)");
        var collapseIcon = (FontIcon)collapseBtn.Content;
        collapseBtn.Click += (_, _) => ToggleConsolePane();

        var moreBtn = BuildToolbarButton("\uE712", "更多");
        var (consoleMenu, followItem) = BuildConsoleMenu();
        moreBtn.Flyout = consoleMenu;

        var toolsHost = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
            Spacing = 2,
            Margin = new Thickness(0, 0, 6, 0),
        };
        toolsHost.Children.Add(clearBtn);
        toolsHost.Children.Add(collapseBtn);
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
        var output = new TextBox
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
        ScrollViewer.SetVerticalScrollBarVisibility(output, ScrollBarVisibility.Auto);
        ScrollViewer.SetHorizontalScrollBarVisibility(output, ScrollBarVisibility.Auto);
        Grid.SetRow(output, 1);
        host.Children.Add(output);

        // —— 输入行：❯ [command] ——
        var prompt = new TextBlock
        {
            Text = "\u276F",
            FontFamily = new FontFamily($"{_settings.Current.TerminalFontFamily}, Consolas"),
            FontSize = _settings.Current.TerminalFontSize,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(8, 0, 6, 0),
        };
        var input = new TextBox
        {
            PlaceholderText = "输入命令（stub 支持 echo / clear / exit）",
            FontFamily = new FontFamily($"{_settings.Current.TerminalFontFamily}, Consolas"),
            FontSize = _settings.Current.TerminalFontSize,
            Margin = new Thickness(0, 0, 8, 4),
        };
        input.KeyDown += ConsoleInput_KeyDown;

        var inputHost = new Grid();
        inputHost.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        inputHost.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(prompt, 0);
        inputHost.Children.Add(prompt);
        Grid.SetColumn(input, 1);
        inputHost.Children.Add(input);
        Grid.SetRow(inputHost, 2);
        host.Children.Add(inputHost);

        // —— 状态条（20px）——
        var statusLeft = new TextBlock
        {
            FontSize = 11,
            Opacity = 0.65,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(8, 0, 0, 0),
        };
        var statusRight = new TextBlock
        {
            Text = "\u25CF Stub（ConPTY 于 S0e 接入）",
            FontSize = 11,
            Opacity = 0.65,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
            Margin = new Thickness(0, 0, 8, 0),
        };
        var statusHost = new Grid();
        statusHost.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        statusHost.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(statusLeft, 0);
        statusHost.Children.Add(statusLeft);
        Grid.SetColumn(statusRight, 1);
        statusHost.Children.Add(statusRight);
        Grid.SetRow(statusHost, 3);
        host.Children.Add(statusHost);

        return (host, output, input, statusLeft, collapseIcon, followItem);
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
            UpdateConsoleStatus();
        };
        menu.Items.Add(followItem);

        var copy = new MenuFlyoutItem { Text = "复制输出" };
        copy.Click += (_, _) => CopyConsoleOutput();
        menu.Items.Add(copy);

        return (menu, followItem);
    }

    /// <summary>折叠/展开面板：宽度、列宽、splitter 三处必须一起改（design.md §4.7.2 避坑）。</summary>
    private void ToggleConsolePane()
    {
        _consoleCollapsed = !_consoleCollapsed;
        RefreshConsoleLayout();
        _settings.Update(s => s.ConsolePaneCollapsed = _consoleCollapsed);
        _settings.Save();
    }

    private void RefreshConsoleLayout()
    {
        var width = _consoleCollapsed ? 0 : _consoleWidth;
        _consoleBorder.Width = width;
        _consoleColumn.Width = new GridLength(width);
        _splitter.Visibility = _consoleCollapsed ? Visibility.Collapsed : Visibility.Visible;
        _consoleCollapseIcon.Glyph = _consoleCollapsed ? "\uE8A6" : "\uE8A7"; // OpenPane / ClosePane
    }

    private void ToggleFollowRepo()
    {
        _settings.Update(s => s.TerminalFollowRepo = !s.TerminalFollowRepo);
        _settings.Save();
        _followRepoItem.IsChecked = _settings.Current.TerminalFollowRepo;
        UpdateConsoleStatus();
        AppendConsoleLine($"跟随仓库目录: {(_settings.Current.TerminalFollowRepo ? "开" : "关")}");
    }

    // —— 拖拽调宽 ——

    private void Splitter_PointerEntered(object sender, PointerRoutedEventArgs e) => ShowSplitterCue();

    private void Splitter_PointerExited(object sender, PointerRoutedEventArgs e)
    {
        if (!_consoleDragging)
        {
            HideSplitterCue();
        }
    }

    private void Splitter_PointerPressed(object sender, PointerRoutedEventArgs e)
    {
        if (!e.GetCurrentPoint(_splitter).Properties.IsLeftButtonPressed)
        {
            return;
        }

        _consoleDragging = true;
        _splitter.CapturePointer(e.Pointer);
        _dragStartX = e.GetCurrentPoint(_rootGrid).Position.X;
        _dragStartWidth = _consoleWidth;
        e.Handled = true;
    }

    private void Splitter_PointerMoved(object sender, PointerRoutedEventArgs e)
    {
        if (!_consoleDragging)
        {
            return;
        }

        var dx = e.GetCurrentPoint(_rootGrid).Position.X - _dragStartX;
        SetConsoleWidth(_dragStartWidth - dx); // 面板在右侧：向左拖（dx<0）变宽
        e.Handled = true;
    }

    private void Splitter_PointerReleased(object sender, PointerRoutedEventArgs e)
    {
        if (!_consoleDragging)
        {
            return;
        }

        _consoleDragging = false;
        _splitter.ReleasePointerCapture(e.Pointer);
        HideSplitterCue();
        _settings.Update(s => s.ConsolePaneWidth = _consoleWidth);
        _settings.Save();
        e.Handled = true;
    }

    private void SetConsoleWidth(double width)
    {
        _consoleWidth = Math.Clamp(width, ConsoleMinWidth, ConsoleMaxWidth);
        RefreshConsoleLayout();
    }

    /// <summary>hover/拖拽中给 splitter 半透明底色作可拖拽提示（该 SDK 投影无 Window.ProtectedCursor）。</summary>
    private void ShowSplitterCue() => _splitter.Background = HoverBrush;

    private void HideSplitterCue()
    {
        if (!_consoleDragging)
        {
            _splitter.Background = ClearBrush;
        }
    }

    // —— stub 输出（ConPTY 于 S0e 替换）——

    private void ConsoleInput_KeyDown(object sender, KeyRoutedEventArgs e)
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
        var command = _consoleInput.Text.Trim();
        _consoleInput.Text = string.Empty;
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

    private void AppendConsoleLine(string line) => _consoleOutput.Text += line + Environment.NewLine;

    private void ClearConsole() => _consoleOutput.Text = string.Empty;

    private void UpdateConsoleStatus()
    {
        var follow = _settings.Current.TerminalFollowRepo ? "开" : "关";
        _consoleStatusLeft.Text = $"stub · 80×24 · 跟随仓库: {follow}";
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
            package.SetText(_consoleOutput.Text);
            Clipboard.SetContent(package);
        }
        catch (Exception ex)
        {
            AppendConsoleLine("复制失败: " + ex.Message);
        }
    }
}
