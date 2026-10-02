using GitUI.App.Pages;
using GitUI.Core.Settings;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Windows.UI;

namespace GitUI.App;

/// <summary>
/// 主窗口。Mica 背景 + 自定义标题栏 + 四页签导航。
/// 所有 UI 通过代码构建。参考 ECHWorkers.WinUI3/MainWindow。
/// </summary>
public sealed partial class MainWindow : Window
{
    private const int SidebarExpandedWidth = 200;
    private const int SidebarCollapsedWidth = 72;
    private const int TitleBarHeight = 48;

    private readonly ISettingsStore _settings;
    private readonly Button[] _navButtons;
    private readonly Grid _pageHost;
    private readonly Border _titleBarStrip;
    private readonly Grid _sidebarHost;
    private readonly FontIcon _toggleIcon;
    private readonly Button _collapseBtn;
    private readonly Border _sidebarBorder;
    private readonly Grid _rightHost;
    private bool _collapsed;
    private int _sidebarWidth;

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

        // 标题栏拖拽热区：只覆盖左侧 app 名区域（200px），
        // 右侧留出空间放可点击按钮。
        // 标题栏拖拽热区：覆盖整个标题栏行，仅用于窗口拖拽。
        // 可点击按钮通过在其后添加保证 z-order 在上层。
        _titleBarStrip = new Border
        {
            Height = TitleBarHeight,
            VerticalAlignment = VerticalAlignment.Top,
            Background = ClearBrush,
        };

        this.SetTitleBar(_titleBarStrip);
        this.ExtendsContentIntoTitleBar = true;
        this.Title = "GitUI";

        try { this.SystemBackdrop = new MicaBackdrop(); }
        catch { }

        var appWindow = this.AppWindow;
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

        // ---- 标题栏：TitleBarStrip（拖拽热区）+ appTitle + collapseBtn ----
        _toggleIcon = new FontIcon
        {
            Glyph = "\uE700",
            FontSize = 15,
            VerticalAlignment = VerticalAlignment.Center,
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
            Margin = new Thickness(_sidebarWidth + 8, 0, 0, 0),
        };
        _collapseBtn.Click += CollapseToggle_Click;

        var appTitle = new TextBlock
        {
            Text = "GitUI",
            FontSize = 14,
            FontWeight = new Windows.UI.Text.FontWeight(600),
            Margin = new Thickness(20, 0, 0, 0),
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Left,
        };

        // ---- 根布局 ----
        // Grid: Row 0 = 标题栏 48px，Row 1 = 内容 *
        //   Col 0: Row 1 = sidebar Border (定宽)
        //   Col 1: Row 0 = TitleBarStrip + appTitle + collapseBtn
        //         Row 1 = rightHost (pageHost)
        var rootGrid = new Grid();
        rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(TitleBarHeight) });
        rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        // sidebar 跨越 Row 0 到 Row 1（从顶部开始）
        _sidebarBorder.VerticalAlignment = VerticalAlignment.Stretch;
        Grid.SetRow(_sidebarBorder, 0);
        Grid.SetRowSpan(_sidebarBorder, 2);
        rootGrid.Children.Add(_sidebarBorder);

        // 右侧 titlebar 元素用 Margin.Left = sidebar 宽度定位
        _titleBarStrip.Margin = new Thickness(_sidebarWidth, 0, 0, 0);
        Grid.SetRow(_titleBarStrip, 0);
        rootGrid.Children.Add(_titleBarStrip);

        appTitle.HorizontalAlignment = HorizontalAlignment.Left;
        appTitle.Margin = new Thickness(_sidebarWidth + 20, 0, 0, 0);
        Grid.SetRow(appTitle, 0);
        rootGrid.Children.Add(appTitle);

        _collapseBtn.HorizontalAlignment = HorizontalAlignment.Left;
        _collapseBtn.Margin = new Thickness(_sidebarWidth + 8, 0, 0, 0);
        Grid.SetRow(_collapseBtn, 0);
        rootGrid.Children.Add(_collapseBtn);

        _rightHost.Margin = new Thickness(_sidebarWidth, 0, 0, 0);
        Grid.SetRow(_rightHost, 1);
        rootGrid.Children.Add(_rightHost);

        RootGrid.Children.Clear();
        RootGrid.Children.Add(rootGrid);

        // 主题
        ApplyTheme(_settings.Current.Theme);
        _settings.Changed += (_, _) => ApplyTheme(_settings.Current.Theme);

        RefreshNavVisuals();
        ShowPage("log");
    }

    /// <summary>标题栏折叠/展开按钮点击处理。</summary>
    private void CollapseToggle_Click(object sender, RoutedEventArgs e)
    {
        _collapsed = !_collapsed;
        _sidebarWidth = _collapsed ? SidebarCollapsedWidth : SidebarExpandedWidth;
        // 更新 sidebar 宽度（Border.Width）
        _sidebarBorder.Width = _sidebarWidth;
        // 更新 collapseBtn 位置：sidebar 右端 + 8
        _collapseBtn.Margin = new Thickness(_sidebarWidth + 8, 0, 0, 0);
        // 更新右侧内容 host 左缘
        _rightHost.Margin = new Thickness(_sidebarWidth, TitleBarHeight, 0, 0);
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
        // 用 StackPanel(Horizontal) 精确控制：icon(22) + margin + label
        // 避免 Grid + Star 列让内容自适应时超出 Border 分配的空间
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = 16,
            Width = 22,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 0, 14, 0),
            Tag = "icon",
        };
        row.Children.Add(icon);

        var text = new TextBlock
        {
            Text = label,
            VerticalAlignment = VerticalAlignment.Center,
            Tag = "label",
        };
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
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
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

        // 折叠时：隐藏标签，图标居中；展开时：图标 + 标签并排
        if (button.Content is StackPanel row && row.Children.Count >= 2
            && row.Children[0] is FontIcon icon
            && row.Children[1] is TextBlock label)
        {
            if (_collapsed)
            {
                label.Visibility = Visibility.Collapsed;
                icon.Margin = new Thickness(0);
                // StackPanel 只有 icon 时，通过 button 的 HorizontalContentAlignment 居中
                button.HorizontalAlignment = HorizontalAlignment.Center;
            }
            else
            {
                label.Visibility = Visibility.Visible;
                icon.Margin = new Thickness(0, 0, 14, 0);
                button.HorizontalAlignment = HorizontalAlignment.Stretch;
            }
        }
    }
}
