using GitUI.Core.Models;
using GitUI.Core.Services;
using GitUI.Core.Settings;
using GitUI.ViewModels;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Windows.UI;
using Windows.System;

namespace GitUI.App.Pages;

/// <summary>
/// 分支页（S6，design.md §4.5 / §8-S6）：
/// Local / Remote 分支树（[name] (sha) - message）+ 顶部 Pull / Pull Rebase / Push +
/// 操作栏（检出 / 创建 / 重命名 / 删除 / 合并 / 变基 / 快进）。
/// 删除走两段式：RequestDeletePreview 影响计算 → ContentDialog 展示"将丢弃 N 个提交"
/// （N 与实际影响一致是 S6 通过标准）→ 确认后才执行。
/// </summary>
public sealed class BranchesPage : UserControl
{
    private readonly ISettingsStore _settings;
    private readonly IRepositoryService _repoService;
    private readonly RepositoryContext _context;
    private readonly BranchesViewModel _vm;

    private readonly TextBox _repoBox;
    private readonly ComboBox _recentBox;
    private readonly TextBlock _status;
    private readonly TextBlock _banner;
    private readonly Button _copyErrBtn;
    private readonly Microsoft.UI.Dispatching.DispatcherQueueTimer _transientTimer;
    private readonly ItemsRepeater _repeater;
    private readonly ScrollViewer _listScroll;

    private readonly Button _checkoutBtn;
    private readonly Button _createBtn;
    private readonly Button _renameBtn;
    private readonly Button _deleteBtn;
    private readonly Button _mergeBtn;
    private readonly Button _rebaseBtn;
    private readonly Button _ffBtn;

    private Button? _selectedRowButton;
    private bool _suppressRecent;

    public BranchesPage(ISettingsStore settings, IRepositoryService repoService, RepositoryContext context)
    {
        _settings = settings;
        _repoService = repoService;
        _context = context;
        _vm = new BranchesViewModel(repoService);

        // ---- 工具条 ----
        _repoBox = new TextBox { MinWidth = 220, PlaceholderText = @"D:\path\to\repo" };
        AutomationProperties.SetName(_repoBox, "仓库路径");
        _repoBox.KeyDown += (_, e) =>
        {
            if (e.Key == VirtualKey.Enter) { _ = OpenRepoAsync(); e.Handled = true; }
        };

        _recentBox = new ComboBox { Width = 100, PlaceholderText = "最近" };
        AutomationProperties.SetName(_recentBox, "最近仓库");
        _recentBox.SelectionChanged += (_, _) =>
        {
            if (!_suppressRecent && _recentBox.SelectedItem is string s && s.Length > 0)
            {
                _repoBox.Text = s;
                _ = OpenRepoAsync();
            }
        };
        PopulateRecents();

        var openBtn = BuildToolButton("打开仓库");
        openBtn.Click += (_, _) => _ = OpenRepoAsync();

        var refreshBtn = BuildToolButton("\uE72C", "刷新");
        refreshBtn.Click += (_, _) => _ = _vm.RefreshAsync();

        // 顶部三按钮（IDEA 同款，明确区分 merge 与 rebase，§4.5）
        var pullBtn = BuildToolButton("Pull");
        pullBtn.Click += (_, _) => _ = _vm.PullAsync(rebase: false);
        var pullRebaseBtn = BuildToolButton("Pull Rebase");
        pullRebaseBtn.Click += (_, _) => _ = _vm.PullAsync(rebase: true);
        var pushBtn = BuildToolButton("Push");
        pushBtn.Click += (_, _) => _ = _vm.PushAsync();

        var toolbar = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            Margin = new Thickness(10, 6, 10, 2),
            VerticalAlignment = VerticalAlignment.Center,
        };
        toolbar.Children.Add(_repoBox);
        toolbar.Children.Add(_recentBox);
        toolbar.Children.Add(openBtn);
        toolbar.Children.Add(refreshBtn);
        toolbar.Children.Add(Spacer());
        toolbar.Children.Add(pullBtn);
        toolbar.Children.Add(pullRebaseBtn);
        toolbar.Children.Add(pushBtn);

        _banner = new TextBlock
        {
            TextWrapping = TextWrapping.Wrap,
            Foreground = new SolidColorBrush(Microsoft.UI.Colors.OrangeRed),
            VerticalAlignment = VerticalAlignment.Center,
            Visibility = Visibility.Collapsed,
        };
        AutomationProperties.SetName(_banner, "分支提示");

        _copyErrBtn = BuildToolButton("复制错误详情");
        _copyErrBtn.Visibility = Visibility.Collapsed;
        _copyErrBtn.Click += (_, _) => CopyErrorDetail();

        var bannerRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Margin = new Thickness(10, 2, 10, 2) };
        bannerRow.Children.Add(_banner);
        bannerRow.Children.Add(_copyErrBtn);

        // ---- 操作栏（对选中分支）----
        _checkoutBtn = BuildToolButton("检出");
        _checkoutBtn.Click += (_, _) => { if (Sel() is { } b && !b.IsRemote) _ = _vm.CheckoutAsync(b.Name); };
        _createBtn = BuildToolButton("创建");
        _createBtn.Click += (_, _) => _ = ShowCreateDialogAsync();
        _renameBtn = BuildToolButton("重命名");
        _renameBtn.Click += (_, _) => _ = ShowRenameDialogAsync();
        _deleteBtn = BuildToolButton("删除");
        _deleteBtn.Click += (_, _) => _ = ShowDeleteDialogAsync();
        _mergeBtn = BuildToolButton("合并到当前分支");
        _mergeBtn.Click += (_, _) => { if (Sel() is { } b && !b.IsRemote && !b.IsHead) _ = _vm.MergeAsync(b.Name, noFastForward: false, message: null); };
        _rebaseBtn = BuildToolButton("变基到该分支");
        _rebaseBtn.Click += (_, _) => { if (Sel() is { } b && !b.IsRemote && !b.IsHead) _ = _vm.RebaseAsync(b.Name); };
        _ffBtn = BuildToolButton("快进");
        _ffBtn.Click += (_, _) => { if (Sel() is { } b && !b.IsRemote && !b.IsHead) _ = _vm.FastForwardAsync(b.Name); };

        var ops = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            Margin = new Thickness(10, 2, 10, 2),
        };
        ops.Children.Add(_checkoutBtn);
        ops.Children.Add(_createBtn);
        ops.Children.Add(_renameBtn);
        ops.Children.Add(_deleteBtn);
        ops.Children.Add(Spacer());
        ops.Children.Add(_mergeBtn);
        ops.Children.Add(_rebaseBtn);
        ops.Children.Add(_ffBtn);

        // ---- 分支树 ----
        _repeater = new ItemsRepeater { Layout = new StackLayout() };
        _repeater.ItemTemplate = new BranchRowFactory(this);
        _listScroll = new ScrollViewer
        {
            Content = _repeater,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Padding = new Thickness(0, 2, 0, 8),
        };

        _status = new TextBlock
        {
            FontSize = 11.5,
            Opacity = 0.72,
            Margin = new Thickness(14, 0, 14, 0),
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            Text = "未打开仓库",
        };
        // 不设 AutomationProperties.Name（显式 Name 覆盖动态文本，UIA 冒烟依赖 Name=内容）
        var statusRow = new Grid { Height = 22 };
        statusRow.Children.Add(_status);

        var root = new Grid();
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(22) });
        Grid.SetRow(toolbar, 0);
        root.Children.Add(toolbar);
        Grid.SetRow(bannerRow, 1);
        root.Children.Add(bannerRow);
        Grid.SetRow(ops, 2);
        root.Children.Add(ops);
        Grid.SetRow(_listScroll, 3);
        root.Children.Add(_listScroll);
        Grid.SetRow(statusRow, 4);
        root.Children.Add(statusRow);

        Content = root;

        _vm.StructureChanged += () => DispatcherQueue.TryEnqueue(Rebind);
        _context.Changed += () => DispatcherQueue.TryEnqueue(OnContextChanged);
        // 分支集合变化（创建/重命名/删除）转发给其他页（known-issues 1.2）
        _vm.BranchListChanged += () => _context.NotifyBranchesChanged();

        // 一次性成功消息 5s 自动消退（known-issues 1.8）
        _transientTimer = DispatcherQueue.CreateTimer();
        _transientTimer.Interval = TimeSpan.FromSeconds(5);
        _transientTimer.Tick += (_, _) =>
        {
            _transientTimer.Stop();
            _vm.ClearTransient();
        };

        Rebind();
    }

    // ---- 主题色 / 构建 ----

    private static bool IsLight => Application.Current?.RequestedTheme != ApplicationTheme.Dark;

    private static readonly SolidColorBrush ClearBrush = new(Microsoft.UI.Colors.Transparent);

    private static SolidColorBrush RowSelectedBrush =>
        IsLight ? Make(0x24, 0x1C, 0x1B, 0x1F) : Make(0x38, 0xFF, 0xFF, 0xFF);

    private static SolidColorBrush SectionBrush =>
        IsLight ? Make(0x14, 0x1C, 0x1B, 0x1F) : Make(0x1C, 0xFF, 0xFF, 0xFF);

    private static SolidColorBrush HeadBrush => Make(0xFF, 0x00, 0x78, 0xD4);

    private static SolidColorBrush Make(byte a, byte r, byte g, byte b) => new(Color.FromArgb(a, r, g, b));

    private static FrameworkElement Spacer() => new TextBlock { Text = "  ", Width = 8 };

    private static Button BuildToolButton(string text, string? automationName = null)
    {
        var btn = new Button
        {
            Content = text,
            Background = ClearBrush,
            BorderThickness = new Thickness(0),
            Padding = new Thickness(10, 4, 10, 4),
            CornerRadius = new CornerRadius(6),
            FontSize = 12.5,
        };
        AutomationProperties.SetName(btn, automationName ?? text);
        return btn;
    }

    private BranchItemRow? Sel() => _vm.Selected;

    private void CopyErrorDetail()
    {
        var detail = _vm.ErrorDetail;
        if (detail is null) return;
        try
        {
            var dp = new Windows.ApplicationModel.DataTransfer.DataPackage();
            dp.SetText(detail);
            Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(dp);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine("copy error detail: " + ex);
        }
    }

    // ---- 行为 ----

    private async Task OpenRepoAsync()
    {
        var path = _repoBox.Text.Trim();
        if (path.Length == 0) return;
        await _vm.OpenRepositoryAsync(path);
        if (_vm.IsRepoOpen) _context.Set(_vm.WorkDir);
    }

    private void OnContextChanged()
    {
        var workDir = _context.WorkDir;
        if (workDir is null || workDir == _vm.WorkDir) return;
        _repoBox.Text = workDir;
        _ = _vm.OpenRepositoryAsync(workDir);
    }

    private void PopulateRecents()
    {
        _suppressRecent = true;
        _recentBox.Items.Clear();
        foreach (var p in _settings.Current.RecentRepos)
            _recentBox.Items.Add(p);
        _recentBox.SelectedIndex = -1;
        _suppressRecent = false;
    }

    // ---- 对话框（创建 / 重命名 / 删除确认）----

    private async Task ShowCreateDialogAsync()
    {
        var input = new TextBox { PlaceholderText = "新分支名" };
        AutomationProperties.SetName(input, "新分支名");
        var from = new TextBox { PlaceholderText = "起点（留空 = HEAD）" };
        AutomationProperties.SetName(from, "起点");

        var panel = new StackPanel { Spacing = 8 };
        panel.Children.Add(input);
        panel.Children.Add(from);

        var dialog = new ContentDialog
        {
            Title = "创建分支",
            Content = panel,
            PrimaryButtonText = "确认创建",
            CloseButtonText = "取消",
            XamlRoot = XamlRoot,
        };
        var result = await dialog.ShowAsync();
        if (result != ContentDialogResult.Primary || string.IsNullOrWhiteSpace(input.Text)) return;
        var fromSha = string.IsNullOrWhiteSpace(from.Text) ? null : from.Text.Trim();
        await _vm.CreateAsync(input.Text.Trim(), fromSha);
    }

    private async Task ShowRenameDialogAsync()
    {
        if (Sel() is not { } b || b.IsRemote) return;
        var input = new TextBox { PlaceholderText = "新名称", Text = b.Name };
        AutomationProperties.SetName(input, "新名称");
        var dialog = new ContentDialog
        {
            Title = $"重命名分支 {b.Name}",
            Content = input,
            PrimaryButtonText = "确认重命名",
            CloseButtonText = "取消",
            XamlRoot = XamlRoot,
        };
        var result = await dialog.ShowAsync();
        if (result != ContentDialogResult.Primary || string.IsNullOrWhiteSpace(input.Text)) return;
        await _vm.RenameAsync(b.Name, input.Text.Trim());
    }

    /// <summary>
    /// 删除两段式（§6.4 可撤销/危险操作）：先 RequestDeletePreview 影响计算，
    /// 对话框展示"将丢弃 N 个提交：…"（N 与实际一致，S6 通过标准），确认才删。
    /// </summary>
    private async Task ShowDeleteDialogAsync()
    {
        if (Sel() is not { } b || b.IsRemote) return;

        var preview = await _vm.RequestDeletePreview(b.Name);
        var body = new StackPanel { Spacing = 8 };
        body.Children.Add(new TextBlock
        {
            Text = preview.ConfirmationText,
            TextWrapping = TextWrapping.Wrap,
        });
        body.Children.Add(new TextBlock
        {
            Text = "恢复方式：删除后可从 reflog 或本对话框列出的提交 SHA 重建分支。",
            FontSize = 11.5,
            Opacity = 0.7,
            TextWrapping = TextWrapping.Wrap,
        });

        var dialog = new ContentDialog
        {
            Title = $"删除分支 {b.Name}",
            Content = body,
            // 按钮文案带"确认"前缀：与页面操作栏的"删除"按钮在 UIA 里不重名
            PrimaryButtonText = "确认删除",
            CloseButtonText = "取消",
            DefaultButton = ContentDialogButton.Close,
            XamlRoot = XamlRoot,
        };
        var result = await dialog.ShowAsync();
        if (result != ContentDialogResult.Primary) return;
        await _vm.DeleteAsync(b.Name, force: preview.ForceRequired);
    }

    // ---- 行构建 ----

    private UIElement BuildRow(object data) => data switch
    {
        BranchGroupRow g => BuildGroupRow(g),
        BranchItemRow b => BuildBranchRow(b),
        _ => new TextBlock { Text = string.Empty },
    };

    private UIElement BuildGroupRow(BranchGroupRow g)
    {
        var border = new Border
        {
            Child = new TextBlock
            {
                Text = g.Title,
                FontSize = 12.5,
                FontWeight = new Windows.UI.Text.FontWeight(600),
                VerticalAlignment = VerticalAlignment.Center,
            },
            Background = SectionBrush,
            Padding = new Thickness(10, 5, 10, 5),
            CornerRadius = new CornerRadius(6),
            Margin = new Thickness(8, 6, 8, 2),
        };
        AutomationProperties.SetName(border, g.IsRemote ? "远程分支组" : "本地分支组");
        return border;
    }

    private UIElement BuildBranchRow(BranchItemRow b)
    {
        var name = new TextBlock
        {
            Text = b.IsHead ? "\u2713 " + b.Name : b.Name,
            FontSize = 13,
            FontWeight = b.IsHead ? new Windows.UI.Text.FontWeight(600) : new Windows.UI.Text.FontWeight(400),
            Foreground = b.IsHead ? HeadBrush : null,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        var meta = new TextBlock
        {
            Text = b.Meta,
            FontFamily = new FontFamily("Consolas"),
            FontSize = 11,
            Opacity = 0.65,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(8, 0, 0, 0),
        };

        var row = new Grid();
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(name, 0);
        row.Children.Add(name);
        Grid.SetColumn(meta, 1);
        row.Children.Add(meta);

        var isSelected = _vm.Selected is not null && _vm.Selected.Name == b.Name && _vm.Selected.IsRemote == b.IsRemote;
        var btn = new Button
        {
            Content = row,
            Padding = new Thickness(12, 4, 12, 4),
            Margin = new Thickness(8, 1, 8, 1),
            CornerRadius = new CornerRadius(6),
            Background = isSelected ? RowSelectedBrush : ClearBrush,
            BorderThickness = new Thickness(0),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            MinHeight = 34,
        };
        if (isSelected) _selectedRowButton = btn;
        AutomationProperties.SetName(btn, $"分支 {b.Name}{(b.IsHead ? " 当前" : "")}");
        btn.Click += (_, _) =>
        {
            if (_selectedRowButton is not null && !ReferenceEquals(_selectedRowButton, btn))
                _selectedRowButton.Background = ClearBrush;
            btn.Background = RowSelectedBrush;
            _selectedRowButton = btn;
            _vm.Select(b);
        };
        return btn;
    }

    // ---- 绑定 ----

    private void Rebind()
    {
        _status.Text = _vm.StatusText;

        if (_vm.Error is not null)
        {
            _banner.Text = "错误: " + _vm.Error;
            _banner.Visibility = Visibility.Visible;
        }
        else
        {
            _banner.Text = string.Empty;
            _banner.Visibility = Visibility.Collapsed;
        }

        // 复制完整错误详情（known-issues 1.7）
        _copyErrBtn.Visibility = _vm.ErrorDetail is null ? Visibility.Collapsed : Visibility.Visible;

        // transient 5s 消退（known-issues 1.8）
        if (!string.IsNullOrEmpty(_vm.TransientMessage))
        {
            _transientTimer.Stop();
            _transientTimer.Start();
        }
        else
        {
            _transientTimer.Stop();
        }

        _repeater.ItemsSource = _vm.Rows;
        _selectedRowButton = null;

        var sel = _vm.Selected;
        var hasLocal = sel is not null && !sel.IsRemote;
        var selNotHead = hasLocal && !sel!.IsHead;
        _checkoutBtn.IsEnabled = selNotHead;
        _renameBtn.IsEnabled = hasLocal;
        _deleteBtn.IsEnabled = hasLocal;
        _mergeBtn.IsEnabled = selNotHead;
        _rebaseBtn.IsEnabled = selNotHead;
        _ffBtn.IsEnabled = selNotHead;
        _createBtn.IsEnabled = _vm.IsRepoOpen && !_vm.IsBusy;
        _checkoutBtn.IsEnabled = selNotHead && !_vm.IsBusy;
    }

    private sealed class BranchRowFactory(BranchesPage page) : IElementFactory
    {
        public UIElement GetElement(ElementFactoryGetArgs args) => page.BuildRow(args.Data);
        public void RecycleElement(ElementFactoryRecycleArgs args) { }
    }
}
