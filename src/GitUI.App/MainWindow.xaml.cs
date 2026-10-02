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
    private readonly ColumnDefinition _sidebarColumn;
    private readonly FontIcon _toggleIcon;
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

        // ---- 右侧内容区 ----
        _pageHost = new Grid();

        var rightHost = new Grid();
        rightHost.Children.Add(_pageHost);

        // ---- 标题栏：app 名 + 收起按钮 ----
        _toggleIcon = new FontIcon
        {
            Glyph = "\uE700", // Collapse（向左）
            FontSize = 15,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var collapseBtn = new Button
        {
            Content = _toggleIcon,
            Background = ClearBrush,
            BorderThickness = new Thickness(0),
            Padding = new Thickness(8),
            CornerRadius = new CornerRadius(8),
            Width = 36,
            Height = 36,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        collapseBtn.Click += CollapseToggle_Click;

        var titleBarRow = new Grid();
        titleBarRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(200) });
        titleBarRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        // app 名（左，与 sidebar 对齐）
        var appTitle = new Border
        {
            Margin = new Thickness(20, 0, 0, 0),
            Height = TitleBarHeight,
            Child = new TextBlock
            {
                Text = "GitUI",
                FontSize = 14,
                FontWeight = new Windows.UI.Text.FontWeight(600),
                VerticalAlignment = VerticalAlignment.Center,
            },
        };
        Grid.SetColumn(appTitle, 0);
        titleBarRow.Children.Add(appTitle);

        // 收起按钮（在 sidebar 右侧列的左端）
        var collapseBorder = new Border
        {
            Margin = new Thickness(8, 0, 0, 0),
            Height = TitleBarHeight,
            Child = collapseBtn,
        };
        Grid.SetColumn(collapseBorder, 1);
        titleBarRow.Children.Add(collapseBorder);

        // ---- 根布局：Row 0 = 标题栏，Row 1 = 内容（sidebar + right） ----
        var rootGrid = new Grid();
        rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(TitleBarHeight) });
        rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        Grid.SetRow(titleBarRow, 0);
        rootGrid.Children.Add(titleBarRow);

        // 内容行：sidebar + rightHost
        _sidebarWidth = _settings.Current.SidebarCollapsed ? SidebarCollapsedWidth : SidebarExpandedWidth;
        var contentGrid = new Grid();
        _sidebarColumn = new ColumnDefinition { Width = new GridLength(_sidebarWidth) };
        contentGrid.ColumnDefinitions.Add(_sidebarColumn);
        contentGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(_sidebarHost, 0);
        contentGrid.Children.Add(_sidebarHost);
        Grid.SetColumn(rightHost, 1);
        contentGrid.Children.Add(rightHost);

        Grid.SetRow(contentGrid, 1);
        rootGrid.Children.Add(contentGrid);

        // 标题栏拖拽条覆盖整个标题栏行
        Grid.SetRow(_titleBarStrip, 0);
        rootGrid.Children.Add(_titleBarStrip);

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
        _sidebarColumn.Width = new GridLength(_sidebarWidth);
        _toggleIcon.Glyph = _collapsed ? "\uE712" : "\uE700"; // 展开：E712(向右)，收起：E700(向左)
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
        var row = new Grid();
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(22) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = 16,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 0, 14, 0),
            Tag = "icon",
        };
        Grid.SetColumn(icon, 0);
        row.Children.Add(icon);

        var text = new TextBlock
        {
            Text = label,
            VerticalAlignment = VerticalAlignment.Center,
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

        // 折叠时：隐藏标签，图标居中；展开时：图标靠左 + 标签靠右
        if (button.Content is Grid row && row.ColumnDefinitions.Count >= 2
            && row.Children.Count >= 2
            && row.Children[0] is FontIcon icon
            && row.Children[1] is TextBlock label)
        {
            if (_collapsed)
            {
                label.Visibility = Visibility.Collapsed;
                // 折叠时让第一列自动宽度并居中，去掉右边距
                row.ColumnDefinitions[0].Width = GridLength.Auto;
                icon.HorizontalAlignment = HorizontalAlignment.Center;
                icon.Margin = new Thickness(0);
            }
            else
            {
                label.Visibility = Visibility.Visible;
                row.ColumnDefinitions[0].Width = new GridLength(22);
                icon.HorizontalAlignment = HorizontalAlignment.Center;
                icon.Margin = new Thickness(0, 0, 14, 0);
            }
        }
    }
}
