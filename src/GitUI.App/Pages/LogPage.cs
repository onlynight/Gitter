using GitUI.Controls;
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
using Windows.System;
using Windows.UI;

namespace GitUI.App.Pages;

/// <summary>
/// Log 页（S4，design.md §4.2 / §8-S4）：
/// 工具条（仓库打开 / 分支切换 / 搜索过滤）+ ItemsRepeater 虚拟列表（单分支时间轴 +
/// 按天分组折叠）+ 右侧详情（提交头 / 变更文件列表 / DiffCanvas）。
/// 滚动接近底部时增量加载下一页（每页 50 条）。
/// 代码构建（§11.2：Button.Padding 不能进 XAML 属性）；状态机在 GitUI.ViewModels.LogViewModel。
/// </summary>
public sealed class LogPage : UserControl
{
    private readonly RepositoryContext _context;
    private readonly LogViewModel _vm;

    private readonly TextBlock _projectLabel;
    private readonly ComboBox _branchBox;
    private readonly TextBox _searchBox;
    private readonly TextBlock _status;
    private readonly ItemsRepeater _repeater;
    private readonly ScrollViewer _listScroll;
    private readonly TextBlock _emptyState;
    private readonly TextBlock _detailSubject;
    private readonly TextBlock _detailMeta;
    private readonly TextBlock _detailMessage;
    private readonly ListView _fileList;
    private readonly DiffCanvas _canvas;
    private readonly Button _pinCompareBtn;
    private readonly Button _clearCompareBtn;
    private readonly TextBlock _compareIndicator;

    private bool _suppressBranchEvent;
    private string? _branchRepoKey;
    private bool _scrollToTopPending;
    private Button? _selectedRowButton;
    private string? _selectedSha;

    /// <param name="navigate">跳转到指定页签（切换项目按钮用）；null 时按钮禁用。</param>
    public LogPage(ISettingsStore settings, IRepositoryService repo, RepositoryContext context, Action<string>? navigate = null)
    {
        _context = context;
        _vm = new LogViewModel(repo);

        // ---- 工具条（仓库路径唯一入口在「项目」页；此处只读展示当前项目）----
        _projectLabel = new TextBlock
        {
            Text = "未选择项目",
            FontFamily = Ui.Mono,
            FontSize = 11,
            Foreground = Ui.Text2,
            VerticalAlignment = VerticalAlignment.Center,
            MaxWidth = 340,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        var switchBtn = BuildToolButton("切换项目");
        switchBtn.Click += (_, _) => navigate?.Invoke("projects");
        if (navigate is null) switchBtn.IsEnabled = false;

        _branchBox = new ComboBox { MinWidth = 130, PlaceholderText = "分支" };
        AutomationProperties.SetName(_branchBox, "分支选择");
        _branchBox.SelectionChanged += (_, _) =>
        {
            if (_suppressBranchEvent || _branchBox.SelectedIndex < 0) return;
            var name = _branchBox.SelectedItem as string;
            _scrollToTopPending = true;
            _ = _vm.SetBranchAsync(name == HeadItem ? null : name);
        };

        _searchBox = new TextBox { MinWidth = 200, PlaceholderText = "author: branch: after: before: topic: 自由词" };
        AutomationProperties.SetName(_searchBox, "Log 搜索");
        _searchBox.KeyDown += (_, e) =>
        {
            if (e.Key == VirtualKey.Enter) { DoSearch(); e.Handled = true; }
        };

        var searchBtn = BuildToolButton("搜索");
        searchBtn.Click += (_, _) => DoSearch();

        var refreshBtn = BuildToolButton("\uE72C", "刷新");
        refreshBtn.Click += (_, _) =>
        {
            _scrollToTopPending = true;
            _ = _vm.RefreshAsync();
        };

        var toolbar = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            Margin = new Thickness(10, 6, 10, 2),
            VerticalAlignment = VerticalAlignment.Center,
        };
        toolbar.Children.Add(_projectLabel);
        toolbar.Children.Add(switchBtn);
        toolbar.Children.Add(_branchBox);
        toolbar.Children.Add(_searchBox);
        toolbar.Children.Add(searchBtn);
        toolbar.Children.Add(refreshBtn);

        _status = new TextBlock
        {
            FontSize = 11,
            Foreground = Ui.Text2,
            Margin = new Thickness(14, 0, 14, 0),
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            Text = "未打开仓库",
        };
        // 注意：不设置 AutomationProperties.Name——显式 Name 会覆盖 TextBlock 的动态文本，
        // UIA 冒烟依赖该元素的 Name 即状态内容（"已加载 N / 共 M"）。
        var statusRow = new Grid { Height = 22 };
        statusRow.Children.Add(_status);

        // ---- 左：虚拟列表（时间轴 + 分组） ----
        _repeater = new ItemsRepeater { Layout = new StackLayout() };
        _repeater.ItemTemplate = new LogRowFactory(this);

        _listScroll = new ScrollViewer
        {
            Content = _repeater,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Padding = new Thickness(0, 2, 0, 8),
        };
        _listScroll.ViewChanged += OnListScrollChanged;

        _emptyState = new TextBlock
        {
            FontSize = 12,
            Foreground = Ui.Text3,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
            TextAlignment = TextAlignment.Center,
            Margin = new Thickness(24, 0, 24, 0),
            Visibility = Visibility.Collapsed,
        };

        var listHost = new Grid();
        listHost.Children.Add(_listScroll);
        listHost.Children.Add(_emptyState);

        // ---- 右：提交详情 + 文件列表 + DiffCanvas ----
        _detailSubject = new TextBlock
        {
            FontSize = 13.5,
            FontWeight = new Windows.UI.Text.FontWeight(600),
            Foreground = Ui.Text,
            TextTrimming = TextTrimming.CharacterEllipsis,
            Margin = new Thickness(12, 8, 12, 2),
        };
        _detailMeta = new TextBlock
        {
            FontFamily = Ui.Mono,
            FontSize = 11,
            Foreground = Ui.Text2,
            TextTrimming = TextTrimming.CharacterEllipsis,
            Margin = new Thickness(12, 0, 12, 2),
        };
        _detailMessage = new TextBlock
        {
            FontSize = 11.5,
            Foreground = Ui.Text2,
            TextWrapping = TextWrapping.Wrap,
            MaxLines = 4,
            TextTrimming = TextTrimming.CharacterEllipsis,
            Margin = new Thickness(12, 0, 12, 6),
            Visibility = Visibility.Collapsed,
        };
        // S7 通用 git diff：比较基准栏（任意两点比较，design.md §4.2 P1）
        _pinCompareBtn = Ui.ToolButton("设为比较基准");
        _pinCompareBtn.Padding = new Thickness(7, 2, 7, 3);
        _pinCompareBtn.FontSize = 11;
        _pinCompareBtn.Click += (_, _) =>
        {
            if (_vm.Selected is not null) _vm.SetCompareBase(_vm.Selected);
        };

        _clearCompareBtn = Ui.ToolButton("清除比较基准");
        _clearCompareBtn.Padding = new Thickness(7, 2, 7, 3);
        _clearCompareBtn.FontSize = 11;
        _clearCompareBtn.Visibility = Visibility.Collapsed;
        _clearCompareBtn.Click += (_, _) => _vm.SetCompareBase(null);

        _compareIndicator = new TextBlock
        {
            FontSize = 11,
            Foreground = Ui.Text3,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(8, 0, 0, 0),
            TextTrimming = TextTrimming.CharacterEllipsis,
            Text = "未设置基准：显示与父提交的差异",
        };

        var compareRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(12, 2, 12, 2) };
        compareRow.Children.Add(_pinCompareBtn);
        compareRow.Children.Add(_clearCompareBtn);
        compareRow.Children.Add(_compareIndicator);

        var detailHeader = new StackPanel { Orientation = Orientation.Vertical };
        AutomationProperties.SetName(detailHeader, "提交详情");
        detailHeader.Children.Add(_detailSubject);
        detailHeader.Children.Add(_detailMeta);
        detailHeader.Children.Add(_detailMessage);
        detailHeader.Children.Add(compareRow);

        _fileList = new ListView
        {
            Height = 170,
            Margin = new Thickness(8, 2, 8, 4),
            SelectionMode = ListViewSelectionMode.Single,
            FontFamily = Ui.Mono,
            FontSize = 11.5,
        };
        AutomationProperties.SetName(_fileList, "文件列表");
        _fileList.SelectionChanged += File_Selected;

        _canvas = new DiffCanvas { Mode = settings.Current.DiffMode };
        _canvas.Clear("选择提交与文件查看差异");

        var detailHost = new Grid();
        detailHost.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        detailHost.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        detailHost.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(detailHeader, 0);
        detailHost.Children.Add(detailHeader);
        Grid.SetRow(_fileList, 1);
        detailHost.Children.Add(_fileList);
        Grid.SetRow(_canvas, 2);
        detailHost.Children.Add(_canvas);

        // ---- 内容区两列 ----
        var content = new Grid();
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10, GridUnitType.Star) });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1) });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(11, GridUnitType.Star) });
        Grid.SetColumn(listHost, 0);
        content.Children.Add(listHost);
        var divider = new Border
        {
            Width = 1,
            Background = DividerBrush,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Stretch,
        };
        Grid.SetColumn(divider, 1);
        content.Children.Add(divider);
        Grid.SetColumn(detailHost, 2);
        content.Children.Add(detailHost);

        var root = new Grid();
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(22) });
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(toolbar, 0);
        root.Children.Add(toolbar);
        Grid.SetRow(statusRow, 1);
        root.Children.Add(statusRow);
        Grid.SetRow(content, 2);
        root.Children.Add(content);

        Content = root;

        // VM 事件 → UI 线程
        _vm.StructureChanged += () => DispatcherQueue.TryEnqueue(Rebind);
        _vm.SelectionChanged += () => DispatcherQueue.TryEnqueue(UpdateDetail);
        _context.Changed += () => DispatcherQueue.TryEnqueue(OnContextChanged);
        _context.BranchesChanged += () => DispatcherQueue.TryEnqueue(OnBranchesChangedExternally);
        ActualThemeChanged += (_, _) => Rebind();

        Rebind();

        // 追上创建前已设置的当前项目（启动恢复 / 其他页先行切换）
        if (_context.WorkDir is not null)
        {
            OnContextChanged();
        }
    }

    private const string HeadItem = "(HEAD)";

    // ---- 主题色（令牌来自 Ui，"Gitter IDE" v3）----

    private static readonly SolidColorBrush ClearBrush = new(Color.FromArgb(0, 0, 0, 0));

    private static SolidColorBrush RowSelectedBrush => Ui.AccentSoft;

    private static SolidColorBrush LineBrush => Ui.Border;

    private static SolidColorBrush DotBrush => Ui.Text3;

    private static SolidColorBrush MergeDotBrush => Ui.Amber;

    private static SolidColorBrush DividerBrush => Ui.Border;

    // ---- 构建 ----

    private static Button BuildToolButton(string text, string? automationName = null)
        => Ui.ToolButton(text, automationName);

    private UIElement BuildRow(object data) => data switch
    {
        LogGroupHeaderRow h => BuildHeaderRow(h),
        LogCommitRow r => BuildCommitRow(r),
        _ => new TextBlock { Text = string.Empty },
    };

    private UIElement BuildHeaderRow(LogGroupHeaderRow h)
    {
        var chevron = new FontIcon
        {
            Glyph = h.IsCollapsed ? "\uE76B" : "\uE70D",
            FontSize = 9,
            Foreground = Ui.Text3,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var title = new TextBlock
        {
            Text = h.Title,
            FontSize = 11,
            FontWeight = new Windows.UI.Text.FontWeight(600),
            Foreground = Ui.Text2,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(6, 0, 0, 0),
        };
        var count = new TextBlock
        {
            Text = $"{h.CommitCount} 个提交",
            FontFamily = Ui.Mono,
            FontSize = 10.5,
            Foreground = Ui.Text3,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var content = new Grid();
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(chevron, 0);
        content.Children.Add(chevron);
        Grid.SetColumn(title, 1);
        content.Children.Add(title);
        Grid.SetColumn(count, 2);
        content.Children.Add(count);

        var btn = new Button
        {
            Content = content,
            Height = 24,
            Margin = new Thickness(4, 4, 4, 2),
            Padding = new Thickness(8, 1, 8, 2),
            Background = ClearBrush,
            BorderThickness = new Thickness(0),
            CornerRadius = new CornerRadius(Ui.CornerRadius),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(btn, $"分组 {h.Title}");
        btn.Click += (_, _) => _vm.ToggleCollapse(h.Day);
        return btn;
    }

    private UIElement BuildCommitRow(LogCommitRow r)
    {
        // 时间轴列：贯穿竖线 + 节点圆点（合并提交放大并换色）
        var line = new Rectangle
        {
            Width = 2,
            Fill = LineBrush,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Stretch,
        };
        var dotSize = r.Commit.IsMerge ? 11.0 : 8.0;
        var dot = new Ellipse
        {
            Width = dotSize,
            Height = dotSize,
            Fill = r.Commit.IsMerge ? MergeDotBrush : DotBrush,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var timeline = new Grid { Width = 18 };
        timeline.Children.Add(line);
        timeline.Children.Add(dot);

        // IDE 单行密度：SHA(等宽) · 徽标 · 提交消息 · 右侧作者·时间
        var sha = Ui.MonoText(r.Commit.ShortSha, 11, Ui.Text3);
        sha.VerticalAlignment = VerticalAlignment.Center;
        sha.Margin = new Thickness(0, 0, 8, 0);

        var subject = new TextBlock
        {
            Text = r.Commit.Subject,
            FontSize = 12.5,
            Foreground = Ui.Text,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };

        var meta = new TextBlock
        {
            Text = r.MetaText,
            FontSize = 10.5,
            Foreground = Ui.Text3,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(10, 0, 0, 0),
            TextTrimming = TextTrimming.CharacterEllipsis,
        };

        var badgeHost = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        foreach (var badge in r.Badges)
            badgeHost.Children.Add(BuildBadge(badge));

        var content = new Grid();
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(18) });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(timeline, 0);
        content.Children.Add(timeline);
        Grid.SetColumn(sha, 1);
        content.Children.Add(sha);
        Grid.SetColumn(badgeHost, 2);
        content.Children.Add(badgeHost);
        Grid.SetColumn(subject, 3);
        content.Children.Add(subject);
        Grid.SetColumn(meta, 4);
        content.Children.Add(meta);

        var isSelected = r.Commit.Sha == _selectedSha;
        var btn = new Button
        {
            Content = content,
            MinHeight = 30,
            Margin = new Thickness(4, 0, 4, 0),
            Padding = new Thickness(4, 3, 8, 3),
            Background = isSelected ? RowSelectedBrush : ClearBrush,
            BorderThickness = new Thickness(0),
            CornerRadius = new CornerRadius(Ui.CornerRadius),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(btn, $"提交 {r.Commit.ShortSha} {r.Commit.Subject}");
        if (isSelected) _selectedRowButton = btn;
        btn.Click += (_, _) => SelectCommit(r, btn);
        return btn;
    }

    private FrameworkElement BuildBadge(LogBadge badge)
    {
        return new Border
        {
            Background = badge.IsTag ? Ui.ChipPurpleBg : Ui.ChipBlueBg,
            CornerRadius = new CornerRadius(3),
            Padding = new Thickness(5, 0, 5, 1),
            VerticalAlignment = VerticalAlignment.Center,
            Child = new TextBlock
            {
                Text = badge.Text,
                FontSize = 10,
                Foreground = badge.IsTag ? Ui.ChipPurpleFg : Ui.ChipBlueFg,
                VerticalAlignment = VerticalAlignment.Center,
            },
        };
    }

    // ---- 行为 ----

    /// <summary>F5 / 命令面板刷新入口（S7）。</summary>
    public Task RefreshAsync() => _vm.RefreshAsync();

    private void DoSearch()
    {
        _scrollToTopPending = true;
        _ = _vm.SetQueryAsync(_searchBox.Text);
    }

    /// <summary>项目页切换/移除项目后 Log 页跟随（known-issues 1.3）。置空时回"未选择项目"空态。</summary>
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
        _scrollToTopPending = true;
        _ = _vm.OpenRepositoryAsync(workDir);
    }

    /// <summary>分支页增删分支后刷新下拉（known-issues 1.2）。</summary>
    private void OnBranchesChangedExternally()
    {
        if (!_vm.IsRepoOpen) return;
        _ = RefreshBranchesComboAsync();
    }

    private async Task RefreshBranchesComboAsync()
    {
        await _vm.RefreshBranchesAsync();
        _branchRepoKey = null; // 强制 UpdateBranchCombo 重建
        UpdateBranchCombo();
    }

    private void SelectCommit(LogCommitRow r, Button rowBtn)
    {
        if (_selectedRowButton is not null && !ReferenceEquals(_selectedRowButton, rowBtn))
            _selectedRowButton.Background = ClearBrush;
        _selectedRowButton = rowBtn;
        rowBtn.Background = RowSelectedBrush;
        _selectedSha = r.Commit.Sha;

        var c = r.Commit;
        _detailSubject.Text = c.Subject;
        var refs = string.Join(' ', c.BranchNames.Select(n => $"[{n}]").Concat(c.TagNames.Select(n => $"#{n}")));
        _detailMeta.Text = $"{c.ShortSha} · {c.Author} · {c.CommitterDate.LocalDateTime:yyyy-MM-dd HH:mm}"
                           + (refs.Length > 0 ? $" · {refs}" : string.Empty)
                           + (c.IsMerge ? " · 合并提交" : string.Empty);
        var body = ExtractMessageBody(c.Message);
        _detailMessage.Text = body;
        _detailMessage.Visibility = body.Length > 0 ? Visibility.Visible : Visibility.Collapsed;

        _canvas.Clear("加载变更中…");
        _fileList.Items.Clear();
        UpdateCompareBar();
        _ = _vm.SelectAsync(c);
    }

    /// <summary>比较基准栏状态（S7 通用 git diff）。</summary>
    private void UpdateCompareBar()
    {
        var baseCommit = _vm.CompareBase;
        var hasBase = baseCommit is not null;
        _clearCompareBtn.Visibility = hasBase ? Visibility.Visible : Visibility.Collapsed;
        _pinCompareBtn.IsEnabled = _vm.Selected is not null
            && (!hasBase || _vm.Selected.Sha != baseCommit!.Sha);
        _compareIndicator.Text = hasBase
            ? $"基准 {baseCommit!.ShortSha}：所选提交显示与基准的差异"
            : "未设置基准：显示与父提交的差异";
    }

    /// <summary>提交全文去掉首行主题后的正文（无正文时返回空串）。</summary>
    private static string ExtractMessageBody(string message)
    {
        var idx = message.IndexOf('\n');
        if (idx < 0) return string.Empty;
        return message[(idx + 1)..].Trim();
    }

    private void UpdateDetail()
    {
        UpdateCompareBar(); // 选中态在 SelectAsync 内异步赋值，这里同步刷新比较栏可用性
        var files = _vm.SelectedFiles;
        _fileList.Items.Clear();
        foreach (var f in files)
        {
            var label = f.IsBinary
                ? $"B  {f.Path}  (二进制)"
                : $"{StatusCode(f)}  {f.Path}  +{f.AddedLines} −{f.DeletedLines}";
            var item = new ListViewItem { Content = label, Tag = f, Padding = new Thickness(10, 2, 10, 2) };
            AutomationProperties.SetName(item, $"文件 {f.Path}");
            _fileList.Items.Add(item);
        }

        if (_vm.Selected is null)
        {
            _canvas.Clear("选择提交与文件查看差异");
        }
        else if (_vm.SelectedError is not null)
        {
            _canvas.Clear("读取变更失败: " + _vm.SelectedError);
        }
        else if (files.Count == 0)
        {
            _canvas.Clear(_vm.Selected.IsRoot ? "根提交没有父提交，无差异" : "选择上方文件查看差异");
        }
        else
        {
            _canvas.Clear("选择上方文件查看差异");
        }
    }

    private static string StatusCode(DiffResult f) =>
        f.IsNew ? "A" : f.IsDeleted ? "D" : f.IsRenamed ? "R" : "M";

    private void File_Selected(object sender, SelectionChangedEventArgs e)
    {
        if (_fileList.SelectedItem is ListViewItem item && item.Tag is DiffResult f) LoadFile(f);
    }

    private void LoadFile(DiffResult f)
    {
        _canvas.SourcePath = f.IsBinary ? null : f.Path; // 语法高亮按扩展名解析（code-highlight-framework P1）
        if (f.IsBinary) _canvas.Clear("二进制文件已修改，无法比较");
        else if (f.Hunks.Count == 0) _canvas.Clear("无差异");
        else _canvas.Load(f.Hunks, f.OldEndsWithNewline, f.NewEndsWithNewline);
    }

    private void OnListScrollChanged(object? sender, ScrollViewerViewChangedEventArgs e)
    {
        if (!_vm.HasMore || _vm.IsLoading) return;
        if (_listScroll.VerticalOffset + _listScroll.ViewportHeight >= _listScroll.ScrollableHeight - 240)
            _ = _vm.LoadNextPageAsync();
    }

    // ---- 绑定 ----

    private void Rebind()
    {
        _status.Text = _vm.StatusText;
        UpdateEmptyState();
        UpdateBranchCombo();
        UpdateCompareBar();
        _repeater.ItemsSource = _vm.Rows;
        _selectedRowButton = null;

        if (_scrollToTopPending)
        {
            _scrollToTopPending = false;
            _listScroll.ChangeView(null, 0, null, disableAnimation: true);
        }

        if (_vm.Selected is not null)
        {
            var files = _vm.SelectedFiles;
            if (files.Count == 0 && _vm.SelectedError is null)
                UpdateDetail();
        }
    }

    private void UpdateEmptyState()
    {
        string? text = null;
        if (!_vm.IsRepoOpen)
        {
            text = _vm.Error is not null
                ? "打开仓库失败：" + _vm.Error
                : "未选择项目：在左侧「项目」页添加并双击选择（Ctrl+1）";
        }
        else if (!_vm.IsLoading && _vm.Groups.Count == 0)
        {
            text = _vm.Query.Length > 0 || _vm.Branch is not null
                ? "没有匹配的提交（调整搜索词，或清空搜索）"
                : "空仓库：还没有任何提交";
        }

        _emptyState.Text = text ?? string.Empty;
        _emptyState.Visibility = text is null ? Visibility.Collapsed : Visibility.Visible;
    }

    private void UpdateBranchCombo()
    {
        if (_branchRepoKey == _vm.WorkDir) return;
        _branchRepoKey = _vm.WorkDir;

        _suppressBranchEvent = true;
        _branchBox.Items.Clear();
        if (_vm.IsRepoOpen)
        {
            _branchBox.Items.Add(HeadItem);
            foreach (var b in _vm.Branches.Where(b => b.IsLocal))
                _branchBox.Items.Add(b.Name);
            _branchBox.SelectedIndex = 0;
        }
        else
        {
            _branchBox.SelectedIndex = -1;
        }
        _suppressBranchEvent = false;
    }

    /// <summary>
    /// Log 行元素工厂。不池化回收（每页 50 行、滚动实存量为可视区量级），交给 GC。
    /// </summary>
    private sealed class LogRowFactory(LogPage page) : IElementFactory
    {
        public UIElement GetElement(ElementFactoryGetArgs args) => page.BuildRow(args.Data);

        public void RecycleElement(ElementFactoryRecycleArgs args) { }
    }
}
