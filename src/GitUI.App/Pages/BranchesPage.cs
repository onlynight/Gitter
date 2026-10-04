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
using Microsoft.UI.Xaml.Shapes;
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
    private readonly IRepositoryService _repoService;
    private readonly RepositoryContext _context;
    private readonly BranchesViewModel _vm;

    private readonly TextBlock _projectLabel;
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

    /// <param name="navigate">跳转到指定页签（切换项目按钮用）；null 时按钮禁用。</param>
    public BranchesPage(IRepositoryService repoService, RepositoryContext context, Action<string>? navigate = null)
    {
        _repoService = repoService;
        _context = context;
        _vm = new BranchesViewModel(repoService);

        // ---- 工具条（仓库路径唯一入口在「项目」页；此处只读展示当前项目）----
        _projectLabel = new TextBlock
        {
            Text = "未选择项目",
            FontSize = 12,
            Opacity = 0.8,
            VerticalAlignment = VerticalAlignment.Center,
            MaxWidth = 340,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        var switchBtn = BuildToolButton("切换项目");
        switchBtn.Click += (_, _) => navigate?.Invoke("projects");
        if (navigate is null) switchBtn.IsEnabled = false;

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
            Spacing = 8,
            Margin = new Thickness(10, 6, 10, 2),
            VerticalAlignment = VerticalAlignment.Center,
        };
        toolbar.Children.Add(_projectLabel);
        toolbar.Children.Add(switchBtn);
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

        _copyErrBtn = BuildToolButton("复制错误详情");
        _copyErrBtn.Visibility = Visibility.Collapsed;
        _copyErrBtn.Click += (_, _) => CopyErrorDetail();

        var bannerRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(10, 2, 10, 2) };
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

        // 追上创建前已设置的当前项目（启动恢复 / 其他页先行切换）
        if (_context.WorkDir is not null)
        {
            OnContextChanged();
        }
    }

    // ---- 主题色 / 构建 ----

    private static readonly SolidColorBrush ClearBrush = new(Microsoft.UI.Colors.Transparent);

    private static SolidColorBrush RowSelectedBrush => Ui.AccentSoft;

    private static SolidColorBrush AccentBrush => Ui.Accent;

    private static SolidColorBrush SectionBrush => Ui.Hover;

    private static SolidColorBrush HeadBrush => Ui.Accent;

    private static FrameworkElement Spacer() => new TextBlock { Text = "  ", Width = 8 };

    private static Button BuildToolButton(string text, string? automationName = null)
    {
        var btn = new Button
        {
            Content = text,
            Background = ClearBrush,
            BorderThickness = new Thickness(0),
            Padding = new Thickness(10, 3, 10, 4),
            CornerRadius = new CornerRadius(Ui.CornerRadius),
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

    /// <summary>F5 / 命令面板刷新入口（S7）。</summary>
    public Task RefreshAsync() => _vm.RefreshAsync();

    // ---- 命令面板入口（v2）：MainWindow 经页面缓存对象调用；未开仓库/无选中时由 MainWindow 置灰 ----

    /// <summary>仓库是否已打开（提交/同步类命令的置灰依据）。</summary>
    public bool IsRepoOpen => _vm.IsRepoOpen;

    /// <summary>是否有选中的本地分支（分支操作类命令的置灰依据；HEAD 分支算选中）。</summary>
    public bool HasSelectedLocalBranch => _vm.Selected is { } b && !b.IsRemote;

    public void PullFromPalette(bool rebase) => _ = _vm.PullAsync(rebase);

    public void PushFromPalette() => _ = _vm.PushAsync();

    public void CheckoutSelectedFromPalette()
    {
        if (Sel() is { } b && !b.IsRemote && !b.IsHead) _ = _vm.CheckoutAsync(b.Name);
    }

    public void MergeSelectedFromPalette()
    {
        if (Sel() is { } b && !b.IsRemote && !b.IsHead) _ = _vm.MergeAsync(b.Name, noFastForward: false, message: null);
    }

    public void RebaseSelectedFromPalette()
    {
        if (Sel() is { } b && !b.IsRemote && !b.IsHead) _ = _vm.RebaseAsync(b.Name);
    }

    public void FastForwardSelectedFromPalette()
    {
        if (Sel() is { } b && !b.IsRemote && !b.IsHead) _ = _vm.FastForwardAsync(b.Name);
    }

    public Task CreateBranchFromPaletteAsync() => ShowCreateDialogAsync();

    public Task RenameBranchFromPaletteAsync() => ShowRenameDialogAsync();

    public Task DeleteBranchFromPaletteAsync() => ShowDeleteDialogAsync();

    /// <summary>项目页切换/移除项目后分支页跟随。置空时回"未选择项目"空态。</summary>
    private void OnContextChanged()
    {
        var workDir = _context.WorkDir;
        _projectLabel.Text = workDir ?? "未选择项目";
        if (workDir is null)
        {
            if (_vm.IsRepoOpen) _vm.CloseRepository();
            return;
        }
        if (workDir == _vm.WorkDir) return;
        _ = _vm.OpenRepositoryAsync(workDir);
    }

    // ---- 对话框（创建 / 重命名 / 删除确认）----

    /// <summary>对话框宿主：命令面板先跳转本页再弹框，页面刚入树时自身 XamlRoot 可能尚未传播，回退到 Content 的。</summary>
    private Microsoft.UI.Xaml.XamlRoot? DialogXamlRoot => XamlRoot ?? Content.XamlRoot;

    private async Task ShowCreateDialogAsync()
    {
        if (DialogXamlRoot is null) return;
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
            XamlRoot = DialogXamlRoot,
        };
        var result = await dialog.ShowAsync();
        if (result != ContentDialogResult.Primary || string.IsNullOrWhiteSpace(input.Text)) return;
        var fromSha = string.IsNullOrWhiteSpace(from.Text) ? null : from.Text.Trim();
        await _vm.CreateAsync(input.Text.Trim(), fromSha);
    }

    private async Task ShowRenameDialogAsync()
    {
        if (DialogXamlRoot is null) return;
        if (Sel() is not { } b || b.IsRemote) return;
        var input = new TextBox { PlaceholderText = "新名称", Text = b.Name };
        AutomationProperties.SetName(input, "新名称");
        var dialog = new ContentDialog
        {
            Title = $"重命名分支 {b.Name}",
            Content = input,
            PrimaryButtonText = "确认重命名",
            CloseButtonText = "取消",
            XamlRoot = DialogXamlRoot,
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
        if (DialogXamlRoot is null) return;
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
            XamlRoot = DialogXamlRoot,
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
            CornerRadius = new CornerRadius(Ui.CornerRadius),
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
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        // 仅 HEAD 分支着色；其余分支不能设 Foreground=null——null 本地值会覆盖主题
        // 默认前景画刷导致文字不可见（分支名消失 bug）
        if (b.IsHead) name.Foreground = HeadBrush;
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

        // 选中态完全由 VM 状态驱动（点击只更新 VM，重建时统一渲染）——
        // 手工背景切换在重建时会失步（known-issues 第二批教训的同型）
        var isSelected = _vm.Selected is not null && _vm.Selected.Name == b.Name && _vm.Selected.IsRemote == b.IsRemote;

        var accent = new Rectangle
        {
            Width = 3,
            Fill = AccentBrush,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Stretch,
            Margin = new Thickness(2, 4, 0, 4),
            Visibility = isSelected ? Visibility.Visible : Visibility.Collapsed,
        };

        var rowHost = new Grid();
        rowHost.Children.Add(accent);
        row.ColumnDefinitions.Insert(0, new ColumnDefinition { Width = new GridLength(5) });
        // 插入强调条列后，原 name/meta 的列号整体右移
        Grid.SetColumn(name, 1);
        Grid.SetColumn(meta, 2);
        Grid.SetColumn(row, 1);
        rowHost.Children.Add(row);

        var btn = new Button
        {
            Content = rowHost,
            Padding = new Thickness(4, 4, 12, 4),
            Margin = new Thickness(8, 1, 8, 1),
            CornerRadius = new CornerRadius(Ui.CornerRadius),
            Background = isSelected ? RowSelectedBrush : ClearBrush,
            BorderThickness = new Thickness(0),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            MinHeight = 34,
        };
        AutomationProperties.SetName(btn, $"分支 {b.Name}{(b.IsHead ? " 当前" : "")}{(isSelected ? " 已选中" : "")}");
        btn.Click += (_, _) => _vm.Select(b);
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
