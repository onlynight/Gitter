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
using Windows.System;
using Windows.UI;

namespace GitUI.App.Pages;

/// <summary>
/// 变更页（S5，design.md §4.3 / §8-S5）：
/// 三层列表（冲突 / 变更 / 已暂存 / 未跟踪，勾选框 IDEA 语义）+ 右侧 diff（可点击选块做
/// hunk 级暂存）+ 底部提交栏（前缀建议 / 最近消息 / 文件预览 / 提交 / 提交并推送）。
/// 仓库来源：本页打开，或复用 RepositoryContext（Log 页等打开后自动加载）。
/// </summary>
public sealed class ChangesPage : UserControl
{
    private const string HeadItem = "(HEAD)";

    private readonly ISettingsStore _settings;
    private readonly IRepositoryService _repoService;
    private readonly RepositoryContext _context;
    private readonly ChangesViewModel _vm;

    private readonly TextBox _repoBox;
    private readonly ComboBox _recentBox;
    private readonly TextBlock _status;
    private readonly TextBlock _banner;
    private readonly ItemsRepeater _repeater;
    private readonly ScrollViewer _listScroll;
    private readonly TextBlock _fileHeader;
    private readonly Button _stageFileBtn;
    private readonly Button _unstageFileBtn;
    private readonly Button _stageHunkBtn;
    private readonly Button _unstageHunkBtn;
    private readonly DiffCanvas _canvas;
    private readonly ComboBox _prefixBox;
    private readonly ComboBox _recentMsgBox;
    private readonly TextBox _messageBox;
    private readonly TextBlock _preview;
    private readonly Button _commitBtn;
    private readonly Button _commitPushBtn;
    private readonly Button _retryPushBtn;

    private bool _suppressRecent;
    private bool _scrollToTopPending;
    private Button? _selectedRowButton;

    public ChangesPage(ISettingsStore settings, IRepositoryService repoService, RepositoryContext context)
    {
        _settings = settings;
        _repoService = repoService;
        _context = context;
        _vm = new ChangesViewModel(repoService);

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
        refreshBtn.Click += (_, _) => { _scrollToTopPending = true; _ = _vm.RefreshAsync(); };

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

        // 注意：不用 InfoBar——本机（WinAppSDK 2.5 / RDP 会话）上 InfoBar 进视觉树即触发
        // XAML fail-fast 崩溃（0xc000027b，实测抓出），普通 TextBlock 横幅足够
        _banner = new TextBlock
        {
            TextWrapping = TextWrapping.Wrap,
            Foreground = new SolidColorBrush(Microsoft.UI.Colors.OrangeRed),
            Margin = new Thickness(12, 2, 12, 2),
            Visibility = Visibility.Collapsed,
        };
        AutomationProperties.SetName(_banner, "变更提示");

        // ---- 左：三层列表 ----
        _repeater = new ItemsRepeater { Layout = new StackLayout() };
        _repeater.ItemTemplate = new RowFactory(this);
        _listScroll = new ScrollViewer
        {
            Content = _repeater,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Padding = new Thickness(0, 2, 0, 8),
        };
        _listScroll.ViewChanged += OnListScrollChanged;

        // ---- 右：文件 diff ----
        _fileHeader = new TextBlock
        {
            FontSize = 13,
            FontWeight = new Windows.UI.Text.FontWeight(600),
            TextTrimming = TextTrimming.CharacterEllipsis,
            Margin = new Thickness(12, 8, 12, 2),
        };
        AutomationProperties.SetName(_fileHeader, "变更文件名");

        _stageFileBtn = BuildToolButton("\uE8E5", "暂存文件");
        _stageFileBtn.Click += (_, _) =>
        {
            if (_vm.Selected is not null && _vm.Selected.Category != StatusCategory.Staged)
                _ = _vm.StageFileAsync(_vm.Selected);
        };
        _unstageFileBtn = BuildToolButton("\uE74B", "撤销暂存文件");
        _unstageFileBtn.Click += (_, _) =>
        {
            if (_vm.Selected is not null && _vm.Selected.Category == StatusCategory.Staged)
                _ = _vm.StageFileAsync(_vm.Selected);
        };

        _stageHunkBtn = BuildToolButton("暂存此块");
        _stageHunkBtn.IsEnabled = false;
        _stageHunkBtn.Click += (_, _) => StageSelectedHunks(reverse: false);

        _unstageHunkBtn = BuildToolButton("撤销此块");
        _unstageHunkBtn.IsEnabled = false;
        _unstageHunkBtn.Click += (_, _) => StageSelectedHunks(reverse: true);

        var opsRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, Margin = new Thickness(8, 2, 8, 2) };
        opsRow.Children.Add(_stageFileBtn);
        opsRow.Children.Add(_unstageFileBtn);
        opsRow.Children.Add(new TextBlock { Text = "  ", Width = 8 });
        opsRow.Children.Add(_stageHunkBtn);
        opsRow.Children.Add(_unstageHunkBtn);

        _canvas = new DiffCanvas { Mode = settings.Current.DiffMode };
        _canvas.Clear("选择左侧文件查看差异");
        _canvas.HunkSelected += (_, hunk) =>
        {
            UpdateHunkButtons(hunk);
        };


        var diffHost = new Grid();
        diffHost.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        diffHost.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        diffHost.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(_fileHeader, 0);
        diffHost.Children.Add(_fileHeader);
        Grid.SetRow(opsRow, 1);
        diffHost.Children.Add(opsRow);
        Grid.SetRow(_canvas, 2);
        diffHost.Children.Add(_canvas);

        var content = new Grid();
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(9, GridUnitType.Star) });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1) });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(11, GridUnitType.Star) });
        Grid.SetColumn(_listScroll, 0);
        content.Children.Add(_listScroll);
        var divider = new Border
        {
            Width = 1,
            Background = DividerBrush,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Stretch,
        };
        Grid.SetColumn(divider, 1);
        content.Children.Add(divider);
        Grid.SetColumn(diffHost, 2);
        content.Children.Add(diffHost);

        // ---- 底部提交栏 ----
        _messageBox = new TextBox
        {
            AcceptsReturn = false,
            PlaceholderText = "提交消息（Ctrl+Enter 提交）",
        };
        AutomationProperties.SetName(_messageBox, "提交消息");
        _messageBox.KeyDown += (_, e) =>
        {
            if (e.Key == VirtualKey.Enter
                && Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(VirtualKey.Control)
                    .HasFlag(Windows.UI.Core.CoreVirtualKeyStates.Down))
            {
                _ = CommitAsync(push: false);
                e.Handled = true;
            }
        };

        _prefixBox = new ComboBox { MinWidth = 90, PlaceholderText = "前缀" };
        AutomationProperties.SetName(_prefixBox, "提交前缀");
        _prefixBox.SelectionChanged += (_, _) =>
        {
            if (_prefixBox.SelectedItem is string p && p.Length > 0)
            {
                _messageBox.Text = p + " " + _messageBox.Text;
                _prefixBox.SelectedIndex = -1;
            }
        };

        _recentMsgBox = new ComboBox { MinWidth = 220, PlaceholderText = "最近提交消息（作模板）" };
        AutomationProperties.SetName(_recentMsgBox, "最近消息");
        _recentMsgBox.SelectionChanged += (_, _) =>
        {
            if (_recentMsgBox.SelectedItem is string m && m.Length > 0)
            {
                _messageBox.Text = m;
                _recentMsgBox.SelectedIndex = -1;
            }
        };

        _preview = new TextBlock
        {
            FontSize = 11.5,
            Opacity = 0.7,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            Margin = new Thickness(8, 0, 0, 0),
        };
        AutomationProperties.SetName(_preview, "提交文件预览");

        _commitBtn = BuildToolButton("提交");
        _commitBtn.Click += (_, _) => _ = CommitAsync(push: false);

        _commitPushBtn = BuildToolButton("提交并推送");
        _commitPushBtn.Click += (_, _) => _ = CommitAsync(push: true);

        _retryPushBtn = BuildToolButton("重试推送");
        _retryPushBtn.Visibility = Visibility.Collapsed;
        _retryPushBtn.Click += (_, _) => _ = _vm.RetryPushAsync();

        var commitBar = new Grid { Margin = new Thickness(10, 4, 10, 4) };
        commitBar.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        commitBar.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        var assistRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Margin = new Thickness(0, 0, 0, 4) };
        assistRow.Children.Add(_prefixBox);
        assistRow.Children.Add(_recentMsgBox);
        var commitRow = new Grid();
        commitRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        commitRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_messageBox, 0);
        commitRow.Children.Add(_messageBox);
        var commitBtns = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Margin = new Thickness(8, 0, 0, 0) };
        commitBtns.Children.Add(_commitBtn);
        commitBtns.Children.Add(_commitPushBtn);
        commitBtns.Children.Add(_retryPushBtn);
        Grid.SetColumn(commitBtns, 1);
        commitRow.Children.Add(commitBtns);
        Grid.SetRow(assistRow, 0);
        commitBar.Children.Add(assistRow);
        Grid.SetRow(commitRow, 1);
        commitBar.Children.Add(commitRow);

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
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(22) });
        Grid.SetRow(toolbar, 0);
        root.Children.Add(toolbar);
        Grid.SetRow(_banner, 1);
        root.Children.Add(_banner);
        Grid.SetRow(content, 2);
        root.Children.Add(content);
        Grid.SetRow(commitBar, 3);
        root.Children.Add(commitBar);
        Grid.SetRow(statusRow, 4);
        root.Children.Add(statusRow);

        Content = root;

        _vm.StructureChanged += () => DispatcherQueue.TryEnqueue(Rebind);
        _vm.SelectionChanged += () => DispatcherQueue.TryEnqueue(UpdateSelection);
        _context.Changed += () => DispatcherQueue.TryEnqueue(OnContextChanged);
        ActualThemeChanged += (_, _) => Rebind();

        Rebind();
    }

    // ---- 主题色 ----

    private static bool IsLight => Application.Current?.RequestedTheme != ApplicationTheme.Dark;

    private static readonly SolidColorBrush ClearBrush = new(Microsoft.UI.Colors.Transparent);

    private static SolidColorBrush RowSelectedBrush =>
        IsLight ? Make(0x24, 0x1C, 0x1B, 0x1F) : Make(0x38, 0xFF, 0xFF, 0xFF);

    private static SolidColorBrush SectionBrush =>
        IsLight ? Make(0x14, 0x1C, 0x1B, 0x1F) : Make(0x1C, 0xFF, 0xFF, 0xFF);

    private static SolidColorBrush DividerBrush =>
        IsLight ? Make(0x22, 0x1C, 0x1B, 0x1F) : Make(0x22, 0xFF, 0xFF, 0xFF);

    private static SolidColorBrush Make(byte a, byte r, byte g, byte b) => new(Color.FromArgb(a, r, g, b));

    // ---- 行为 ----

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

    private async Task OpenRepoAsync()
    {
        var path = _repoBox.Text.Trim();
        if (path.Length == 0) return;
        _scrollToTopPending = true;
        await _vm.OpenRepositoryAsync(path);
        if (_vm.IsRepoOpen) _context.Set(_vm.WorkDir);
    }

    private void OnContextChanged()
    {
        var workDir = _context.WorkDir;
        if (workDir is null || workDir == _vm.WorkDir) return;
        _repoBox.Text = workDir;
        _scrollToTopPending = true;
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

    private void StageSelectedHunks(bool reverse)
    {
        var hunk = _canvas.SelectedHunk;
        if (hunk < 0) return;
        _ = _vm.StageHunksAsync(new[] { hunk });
        _canvas.SetSelectedHunk(-1);
    }

    private async Task CommitAsync(bool push)
    {
        await _vm.CommitAsync(_messageBox.Text, push);
        _messageBox.Text = string.Empty;
        UpdateRecentMessages();
    }

    private void OnListScrollChanged(object? sender, ScrollViewerViewChangedEventArgs e)
    {
        // 变更列表通常不长，无分页；占位以保持与 LogPage 一致的结构
    }

    // ---- 行构建 ----

    private UIElement BuildRow(object data) => data switch
    {
        SectionHeaderRow h => BuildSectionHeader(h),
        FileRowData f => BuildFileRow(f),
        _ => new TextBlock { Text = string.Empty },
    };

    private UIElement BuildSectionHeader(SectionHeaderRow h)
    {
        var title = new TextBlock
        {
            Text = h.Title,
            FontSize = 12.5,
            FontWeight = new Windows.UI.Text.FontWeight(600),
            VerticalAlignment = VerticalAlignment.Center,
        };
        var host = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        host.Children.Add(title);
        foreach (var (label, action) in h.Actions)
        {
            var b = BuildToolButton(label);
            b.Padding = new Thickness(6, 1, 6, 1);
            b.FontSize = 11.5;
            b.Click += (_, _) => action();
            host.Children.Add(b);
        }

        var border = new Border
        {
            Child = host,
            Background = SectionBrush,
            Padding = new Thickness(10, 5, 10, 5),
            CornerRadius = new CornerRadius(6),
            Margin = new Thickness(8, 6, 8, 2),
        };
        AutomationProperties.SetName(border, h.AutomationName);
        return border;
    }

    private UIElement BuildFileRow(FileRowData f)
    {
        var entry = f.Entry;
        var checkBox = new CheckBox
        {
            MinWidth = 0,
            Padding = new Thickness(0),
            Margin = new Thickness(0, 0, 4, 0),
            IsChecked = _vm.IsChecked(entry),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(checkBox, $"勾选 {entry.Path}");
        checkBox.Click += (_, _) =>
        {
            if (checkBox.IsChecked is { } v) _vm.SetChecked(entry, v);
        };

        var statusLetter = new TextBlock
        {
            Text = f.StatusLabel,
            FontFamily = new FontFamily("Consolas"),
            FontSize = 12,
            FontWeight = new Windows.UI.Text.FontWeight(600),
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 0, 6, 0),
        };

        var path = new TextBlock
        {
            Text = entry.Path,
            FontSize = 12.5,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };

        var stats = new TextBlock
        {
            Text = f.StatsLabel,
            FontFamily = new FontFamily("Consolas"),
            FontSize = 11,
            Foreground = new SolidColorBrush(Microsoft.UI.Colors.Gray),
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(8, 0, 0, 0),
        };

        var row = new Grid();
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(checkBox, 0);
        row.Children.Add(checkBox);
        Grid.SetColumn(statusLetter, 1);
        row.Children.Add(statusLetter);
        Grid.SetColumn(path, 2);
        row.Children.Add(path);
        Grid.SetColumn(stats, 3);
        row.Children.Add(stats);

        // 用 Button 承载行（UIA InvokePattern 可驱动冒烟），样式对齐 Border 外观
        var rowBtn = new Button
        {
            Content = row,
            Padding = new Thickness(10, 3, 8, 3),
            Margin = new Thickness(8, 1, 8, 1),
            CornerRadius = new CornerRadius(6),
            Background = entry.Path == _vm.Selected?.Path ? RowSelectedBrush : ClearBrush,
            BorderThickness = new Thickness(0),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };
        if (entry.Path == _vm.Selected?.Path) _selectedRowButton = rowBtn;
        AutomationProperties.SetName(rowBtn, f.RowAutomationName);
        rowBtn.Click += (_, _) =>
        {
            if (_selectedRowButton is not null && !ReferenceEquals(_selectedRowButton, rowBtn))
                _selectedRowButton.Background = ClearBrush;
            rowBtn.Background = RowSelectedBrush;
            _selectedRowButton = rowBtn;
            _ = _vm.SelectAsync(entry);
        };
        return rowBtn;
    }

    // ---- 绑定 ----

    private void Rebind()
    {
        _status.Text = _vm.StatusText;

        var failure = _vm.LastOutcome?.PushFailure;
        if (failure is not null)
        {
            _banner.Text = "推送失败: " + failure.Message + "\n" + failure.Hint;
            _banner.Visibility = Visibility.Visible;
            _retryPushBtn.Visibility = Visibility.Visible;
        }
        else if (_vm.Error is not null)
        {
            _banner.Text = "错误: " + _vm.Error;
            _banner.Visibility = Visibility.Visible;
            _retryPushBtn.Visibility = Visibility.Collapsed;
        }
        else
        {
            _banner.Text = string.Empty;
            _banner.Visibility = Visibility.Collapsed;
            _retryPushBtn.Visibility = Visibility.Collapsed;
        }

        _repeater.ItemsSource = BuildFlatRows();
        _selectedRowButton = null;
        if (_scrollToTopPending)
        {
            _scrollToTopPending = false;
            _listScroll.ChangeView(null, 0, null, disableAnimation: true);
        }

        _commitBtn.IsEnabled = !_vm.IsCommitting && _vm.IsRepoOpen;
        _commitPushBtn.IsEnabled = _commitBtn.IsEnabled;

        // 文件预览：勾选文件列表（最多 5 条 + 省略）
        var previewPaths = _vm.Changes.Concat(_vm.Staged).Concat(_vm.Unversioned)
            .Where(_vm.IsChecked)
            .Select(e => e.Path).ToList();
        _preview.Text = previewPaths.Count == 0
            ? "未勾选任何文件"
            : string.Join(", ", previewPaths.Take(5)) + (previewPaths.Count > 5 ? $" 等 {previewPaths.Count} 个文件" : "");
    }

    private IReadOnlyList<object> BuildFlatRows()
    {
        var rows = new List<object>();
        void AddSection(string title, string automationName, IReadOnlyList<WorktreeFileStatus> files,
            string statusLetter, (string Label, Action Action)[] actions, Func<WorktreeFileStatus, string> statsOf)
        {
            if (files.Count == 0) return; // 空层连组头都不显示（避免与导航按钮重名的 UIA 干扰）
            rows.Add(new SectionHeaderRow(title, automationName, actions));
            foreach (var e in files)
                rows.Add(new FileRowData(e, statusLetter, statsOf(e), $"{automationName} {e.Path}"));
        }

        AddSection($"冲突 ({_vm.Conflicts.Count})", "冲突", _vm.Conflicts, "C",
            Array.Empty<(string, Action)>(), _ => string.Empty);
        AddSection($"Changes ({_vm.Changes.Count})", "变更", _vm.Changes, "M",
            new[] { ("全部暂存 +", (Action)(() => _vm.SetAllChecked(StatusCategory.Changes, true))) },
            e => StatsLabel(e.AddedLines, e.DeletedLines));
        AddSection($"Staged for Commit ({_vm.Staged.Count})", "已暂存", _vm.Staged, "S",
            new[] { ("全部撤销 −", (Action)(() => _vm.SetAllChecked(StatusCategory.Staged, false))) },
            e => StatsLabel(e.AddedLines, e.DeletedLines));
        AddSection($"Unversioned ({_vm.Unversioned.Count})", "未跟踪", _vm.Unversioned, "U",
            new[] { ("全部暂存 +", (Action)(() => _vm.SetAllChecked(StatusCategory.Unversioned, true))) },
            _ => string.Empty);
        return rows;
    }

    private static string StatsLabel(int? added, int? deleted) =>
        added is null || deleted is null || (added == 0 && deleted == 0)
            ? string.Empty
            : $"+{added} −{deleted}";

    private void UpdateSelection()
    {
        var view = _vm.SelectedDiff;
        var selected = _vm.Selected;
        if (selected is null)
        {
            _fileHeader.Text = string.Empty;
            _canvas.Clear("选择左侧文件查看差异");
            UpdateHunkButtons(-1);
            return;
        }

        _fileHeader.Text = selected.Path;
        if (view is null)
        {
            _canvas.Clear(selected.IsConflict ? "冲突文件：请在解决冲突后暂存" : "无差异");
            UpdateHunkButtons(-1);
            return;
        }

        if (view.Hunks.Count == 0) _canvas.Clear("无差异");
        else _canvas.Load(view.Hunks);
        UpdateHunkButtons(-1);
    }

    private void UpdateHunkButtons(int selectedHunk)
    {
        var view = _vm.SelectedDiff;
        var canStage = view is { CanStageHunks: true } && selectedHunk >= 0;
        _stageHunkBtn.IsEnabled = canStage && view!.IsStagedView == false;
        _unstageHunkBtn.IsEnabled = canStage && view!.IsStagedView;
    }

    private void UpdateRecentMessages()
    {
        _suppressRecent = true;
        _recentMsgBox.Items.Clear();
        foreach (var m in _vm.RecentMessages(20))
            _recentMsgBox.Items.Add(m);
        _recentMsgBox.SelectedIndex = -1;
        _suppressRecent = false;
        _prefixBox.ItemsSource = _vm.PrefixSuggestions();
        _prefixBox.SelectedIndex = -1;
    }

    // ---- 行数据 ----

    /// <summary>层头行：标题 + 组级动作按钮。</summary>
    private sealed record SectionHeaderRow(
        string Title, string AutomationName, (string Label, Action Action)[] Actions);

    private sealed record FileRowData(
        WorktreeFileStatus Entry, string StatusLabel, string StatsLabel, string RowAutomationName);

    private sealed class RowFactory(ChangesPage page) : IElementFactory
    {
        public UIElement GetElement(ElementFactoryGetArgs args) => page.BuildRow(args.Data);
        public void RecycleElement(ElementFactoryRecycleArgs args) { }
    }
}
