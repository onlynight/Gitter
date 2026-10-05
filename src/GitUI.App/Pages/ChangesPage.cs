using GitUI.Controls;
using GitUI.Core.Models;
using GitUI.Core.Resources;
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

    private readonly TextBlock _projectLabel;
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
    private readonly Button _copyErrBtn;
    private readonly Button _openEditorBtn;
    private readonly Button _switchBtn;
    private readonly Button _refreshBtn;
    private readonly Button _aiMsgBtn;
    private readonly Button _rejectHunkBtn;
    private readonly Button _retakeBtn;
    private readonly Button _explainBtn;
    private readonly Button _explainCloseBtn;
    private readonly Border _explainPanel;
    private readonly TextBlock _explainText;
    private readonly StackPanel _agentFeedbackBlock;
    private readonly TextBlock _agentFeedbackText;
    private readonly Microsoft.UI.Dispatching.DispatcherQueueTimer _transientTimer;

    private bool _scrollToTopPending;
    private bool _aiGenerating;
    private System.Threading.CancellationTokenSource? _explainCts;
    private readonly Func<bool>? _canSendToTerminal;
    private readonly Action<string>? _sendToTerminal;
    private Button? _selectedRowButton;

    /// <param name="navigate">跳转到指定页签（切换项目按钮用）；null 时按钮禁用。</param>
    /// <param name="canSendToTerminal">终端直投可用性（会话存活 + agent 已识别，§3.4 cli-pty 直投）；null 隐藏入口。</param>
    /// <param name="sendToTerminal">把反馈 prompt 直投终端（MainWindow 路由到终端页）。</param>
    public ChangesPage(ISettingsStore settings, IRepositoryService repoService, RepositoryContext context, Action<string>? navigate = null,
        Func<bool>? canSendToTerminal = null, Action<string>? sendToTerminal = null)
    {
        _canSendToTerminal = canSendToTerminal;
        _sendToTerminal = sendToTerminal;
        _settings = settings;
        _repoService = repoService;
        _context = context;
        _vm = new ChangesViewModel(repoService, new GitUI.Core.Rules.CommitSafetyOptions(), AiGatewayFactory.FromSettings(settings.Current.Ai));
        ApplyAiSettings(settings.Current);
        _settings.Changed += (_, _) => ApplyAiSettings(_settings.Current);
        // ---- 工具条（仓库路径唯一入口在「项目」页；此处只读展示当前项目）----
        _projectLabel = new TextBlock
        {
            Text = Strings.Common_NoProjectSelected,
            FontFamily = Ui.Mono,
            FontSize = 11,
            Foreground = Ui.Text2,
            VerticalAlignment = VerticalAlignment.Center,
            MaxWidth = 340,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        var switchBtn = _switchBtn = BuildToolButton(Strings.Common_SwitchProject);
        switchBtn.Click += (_, _) => navigate?.Invoke("projects");
        if (navigate is null) switchBtn.IsEnabled = false;

        var refreshBtn = _refreshBtn = Ui.IconButton("\uE72C", Strings.Common_Refresh);
        refreshBtn.Click += (_, _) => { _scrollToTopPending = true; _ = _vm.RefreshAsync(); };

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

        // 注意：不用 InfoBar——本机（WinAppSDK 2.5 / RDP 会话）上 InfoBar 进视觉树即触发
        // XAML fail-fast 崩溃（0xc000027b，实测抓出），普通 TextBlock 横幅足够
        _banner = new TextBlock
        {
            TextWrapping = TextWrapping.Wrap,
            Foreground = new SolidColorBrush(Microsoft.UI.Colors.OrangeRed),
            VerticalAlignment = VerticalAlignment.Center,
            Visibility = Visibility.Collapsed,
        };

        _copyErrBtn = BuildToolButton(Strings.Common_CopyErrorDetail);
        _copyErrBtn.Visibility = Visibility.Collapsed;
        _copyErrBtn.Click += (_, _) => CopyErrorDetail();

        _openEditorBtn = BuildToolButton(Strings.Changes_OpenInEditor);
        _openEditorBtn.IsEnabled = false;
        _openEditorBtn.Click += (_, _) => _ = OpenSelectedInEditorAsync();

        var bannerRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(10, 2, 10, 2) };
        bannerRow.Children.Add(_banner);
        bannerRow.Children.Add(_copyErrBtn);

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

        _stageFileBtn = Ui.IconToolButton("\uE8E5", Strings.Changes_StageFile);
        _stageFileBtn.Click += (_, _) =>
        {
            if (_vm.Selected is not null && _vm.Selected.Category != StatusCategory.Staged)
                _ = _vm.StageFileAsync(_vm.Selected);
        };
        // E738=Remove（减号语义）；原 E74B 实为 Down 箭头，语义不符
        _unstageFileBtn = Ui.IconToolButton("\uE738", Strings.Changes_UnstageFile);
        _unstageFileBtn.Click += (_, _) =>
        {
            if (_vm.Selected is not null && _vm.Selected.Category == StatusCategory.Staged)
                _ = _vm.StageFileAsync(_vm.Selected);
        };

        _stageHunkBtn = BuildToolButton(Strings.Changes_StageHunk);
        _stageHunkBtn.IsEnabled = false;
        _stageHunkBtn.Click += (_, _) => StageSelectedHunks(reverse: false);

        _unstageHunkBtn = BuildToolButton(Strings.Changes_UnstageHunk);
        _unstageHunkBtn.IsEnabled = false;
        _unstageHunkBtn.Click += (_, _) => StageSelectedHunks(reverse: true);

        // 验收台 v1（ai-native-redesign.md §3.4/§3.5）：拒绝此块 / 退回重做 / AI 解释与审查
        _rejectHunkBtn = BuildToolButton(Strings.Changes_RejectHunk);
        _rejectHunkBtn.IsEnabled = false;
        _rejectHunkBtn.Click += (_, _) => RejectSelectedHunks();

        _retakeBtn = BuildToolButton(Strings.Changes_Retake);
        _retakeBtn.IsEnabled = false;
        _retakeBtn.Click += (_, _) => _ = ShowRetakeDialogAsync();

        _explainBtn = BuildToolButton(Strings.Changes_AiExplain);
        _explainBtn.IsEnabled = false;
        _explainBtn.Click += (_, _) => StartExplain(GitUI.Core.Ai.ExplainIntent.Explain);

        // opsRow 上只放解释；"审查风险"放在 AI 批注栏头部，避免工具条拥挤
        _explainCloseBtn = Ui.IconToolButton("\uE711", Strings.Common_Close);
        _explainCloseBtn.Click += (_, _) =>
        {
            _explainCts?.Cancel();
            _vm.ClearExplanation();
            Rebind();
        };

        _explainText = new TextBlock
        {
            FontSize = 12,
            IsTextSelectionEnabled = true,
            TextWrapping = TextWrapping.Wrap,
            Foreground = Ui.Text,
        };
        var explainHeader = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
        explainHeader.Children.Add(new TextBlock
        {
            Text = Strings.Changes_ExplainPanelTitle,
            FontSize = 11.5,
            FontWeight = new Windows.UI.Text.FontWeight(600),
            Foreground = Ui.Text2,
            VerticalAlignment = VerticalAlignment.Center,
        });
        var reviewBtn = BuildToolButton(Strings.Changes_AiReview);
        reviewBtn.Click += (_, _) => StartExplain(GitUI.Core.Ai.ExplainIntent.Review);
        explainHeader.Children.Add(reviewBtn);
        explainHeader.Children.Add(_explainCloseBtn);
        // agent 反馈（§7.2 review.submit_feedback）：面板顶部固定段，带清除按钮
        _agentFeedbackText = new TextBlock
        {
            FontSize = 12,
            IsTextSelectionEnabled = true,
            TextWrapping = TextWrapping.Wrap,
            Foreground = Ui.Text,
        };
        var feedbackRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        feedbackRow.Children.Add(new TextBlock
        {
            Text = Strings.Changes_AgentFeedback,
            FontSize = 11.5,
            FontWeight = new Windows.UI.Text.FontWeight(600),
            Foreground = Ui.ChipPurpleFg,
            VerticalAlignment = VerticalAlignment.Center,
        });
        var feedbackClear = BuildToolButton(Strings.Common_Close);
        feedbackClear.Click += (_, _) => _vm.ClearAgentFeedback();
        feedbackRow.Children.Add(feedbackClear);
        _agentFeedbackBlock = new StackPanel { Spacing = 4, Visibility = Visibility.Collapsed };
        _agentFeedbackBlock.Children.Add(feedbackRow);
        _agentFeedbackBlock.Children.Add(_agentFeedbackText);
        var explainHost = new StackPanel { Spacing = 4 };
        explainHost.Children.Add(explainHeader);
        explainHost.Children.Add(_agentFeedbackBlock);
        explainHost.Children.Add(_explainText);
        _explainPanel = new Border
        {
            Background = Ui.Panel,
            CornerRadius = new CornerRadius(6),
            Padding = new Thickness(10, 8, 10, 8),
            Margin = new Thickness(8, 2, 8, 4),
            Child = new ScrollViewer
            {
                MaxHeight = 180,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                Content = explainHost,
            },
            Visibility = Visibility.Collapsed,
        };

        var opsRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, Margin = new Thickness(8, 2, 8, 2) };
        opsRow.Children.Add(_openEditorBtn);
        opsRow.Children.Add(_stageFileBtn);
        opsRow.Children.Add(_unstageFileBtn);
        opsRow.Children.Add(new TextBlock { Text = "  ", Width = 8 });
        opsRow.Children.Add(_stageHunkBtn);
        opsRow.Children.Add(_unstageHunkBtn);
        opsRow.Children.Add(_rejectHunkBtn);
        opsRow.Children.Add(_retakeBtn);
        opsRow.Children.Add(_explainBtn);

        _canvas = new DiffCanvas { Mode = settings.Current.DiffMode };
        _canvas.Clear(Strings.Changes_CanvasIdle);
        _canvas.HunkSelectionChanged += (_, _) => UpdateHunkButtons();


        var diffHost = new Grid();
        diffHost.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        diffHost.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        diffHost.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        diffHost.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(_fileHeader, 0);
        diffHost.Children.Add(_fileHeader);
        Grid.SetRow(opsRow, 1);
        diffHost.Children.Add(opsRow);
        Grid.SetRow(_explainPanel, 2);
        diffHost.Children.Add(_explainPanel);
        Grid.SetRow(_canvas, 3);
        diffHost.Children.Add(_canvas);

        var content = new Grid();
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(9, GridUnitType.Star) });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(11, GridUnitType.Star) });
        Grid.SetColumn(_listScroll, 0);
        content.Children.Add(_listScroll);
        var divider = new PaneDivider(content.ColumnDefinitions[0], () => content.ActualWidth, DividerBrush)
        {
            InitialFraction = _settings.Current.ChangesSplitterFraction,
        };
        divider.FractionChanged += f =>
        {
            _settings.Update(s => s.ChangesSplitterFraction = f);
            _settings.Save();
        };
        Grid.SetColumn(divider, 1);
        content.Children.Add(divider);
        Grid.SetColumn(diffHost, 2);
        content.Children.Add(diffHost);

        // ---- 底部提交栏 ----
        _messageBox = new TextBox
        {
            AcceptsReturn = false,
            PlaceholderText = Strings.Changes_MessagePlaceholder,
        };
        AutomationProperties.SetName(_messageBox, Strings.Changes_MessageAutomation);
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

        _prefixBox = new ComboBox { MinWidth = 90, PlaceholderText = Strings.Changes_PrefixPlaceholder };
        AutomationProperties.SetName(_prefixBox, Strings.Changes_PrefixAutomation);
        _prefixBox.SelectionChanged += (_, _) =>
        {
            if (_prefixBox.SelectedItem is string p && p.Length > 0)
            {
                _messageBox.Text = p + " " + _messageBox.Text;
                _prefixBox.SelectedIndex = -1;
            }
        };

        _recentMsgBox = new ComboBox { MinWidth = 220, PlaceholderText = Strings.Changes_RecentPlaceholder };
        AutomationProperties.SetName(_recentMsgBox, Strings.Changes_RecentAutomation);
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

        _commitBtn = Ui.PrimaryButton(Strings.Changes_Commit);
        _commitBtn.MinWidth = 84;
        _commitBtn.Click += (_, _) => _ = CommitAsync(push: false);

        _commitPushBtn = BuildToolButton(Strings.Changes_CommitAndPush);
        _commitPushBtn.Click += (_, _) => _ = CommitAsync(push: true);

        _retryPushBtn = BuildToolButton(Strings.Changes_RetryPush);
        _retryPushBtn.Visibility = Visibility.Collapsed;
        _retryPushBtn.Click += (_, _) => _ = _vm.RetryPushAsync();

        // AI 提交信息草稿（ai-native-redesign.md §4.1）：网关未配置时禁用（不隐藏，提示可发现性）
        _aiMsgBtn = BuildToolButton(Strings.Changes_AiGenerate);
        AutomationProperties.SetName(_aiMsgBtn, Strings.Changes_AiGenerate);
        _aiMsgBtn.Click += (_, _) => _ = GenerateMessageAsync();

        var commitBar = new Grid { Margin = new Thickness(10, 4, 10, 4) };
        commitBar.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        commitBar.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        var assistRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(0, 0, 0, 4) };
        assistRow.Children.Add(_aiMsgBtn);
        assistRow.Children.Add(_prefixBox);
        assistRow.Children.Add(_recentMsgBox);
        var commitRow = new Grid();
        commitRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        commitRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_messageBox, 0);
        commitRow.Children.Add(_messageBox);
        var commitBtns = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(8, 0, 0, 0) };
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
            FontSize = 11,
            Foreground = Ui.Text2,
            Margin = new Thickness(14, 0, 14, 0),
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            Text = Strings.Common_NoRepoOpen,
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
        Grid.SetRow(bannerRow, 1);
        root.Children.Add(bannerRow);
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

    // ---- 主题色（令牌来自 Ui，"Gitter IDE" v3）----

    private static readonly SolidColorBrush ClearBrush = new(Microsoft.UI.Colors.Transparent);

    private static SolidColorBrush RowSelectedBrush => Ui.AccentSoft;

    private static SolidColorBrush SectionBrush => Ui.Hover;

    private static SolidColorBrush DividerBrush => Ui.Border;

    // ---- 行为 ----

    private static Button BuildToolButton(string text, string? automationName = null)
        => Ui.ToolButton(text, automationName);

    /// <summary>项目页切换/移除项目后变更页跟随。置空时回"未选择项目"空态。</summary>
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

    /// <summary>用外部编辑器（设置指定或系统默认）打开选中文件（known-issues 1.4）。</summary>
    private async Task OpenSelectedInEditorAsync()
    {
        var entry = _vm.Selected;
        var workDir = _vm.WorkDir;
        if (entry is null || workDir is null) return;
        var full = System.IO.Path.Combine(workDir, entry.Path.Replace('/', System.IO.Path.DirectorySeparatorChar));
        try
        {
            var editor = _settings.Current.ExternalEditor;
            if (!string.IsNullOrWhiteSpace(editor))
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(editor, '"' + full + '"')
                {
                    UseShellExecute = true,
                });
            }
            else
            {
                var file = await Windows.Storage.StorageFile.GetFileFromPathAsync(full);
                _ = await Windows.System.Launcher.LaunchFileAsync(file);
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine("open in editor: " + ex);
        }
    }

    private void StageSelectedHunks(bool reverse)
    {
        // known-issues 1.5：Ctrl+点击可多选，一次批量暂存/撤销
        var hunks = _canvas.SelectedHunks;
        if (hunks.Count == 0) return;
        _ = _vm.StageHunksAsync(hunks);
        _canvas.SetSelectedHunks(Array.Empty<int>());
    }

    private void RejectSelectedHunks()
    {
        // 验收台"拒绝"（§3.4）：丢弃选中 hunk 的工作区改动
        var hunks = _canvas.SelectedHunks;
        if (hunks.Count == 0) return;
        _ = _vm.RejectHunksAsync(hunks);
        _canvas.SetSelectedHunks(Array.Empty<int>());
    }

    /// <summary>对话框宿主（同 BranchesPage：页面刚入树时自身 XamlRoot 可能尚未传播，回退 Content 的）。</summary>
    private Microsoft.UI.Xaml.XamlRoot? DialogXamlRoot => XamlRoot ?? Content.XamlRoot;

    private async Task ShowRetakeDialogAsync()
    {
        var hunks = _canvas.SelectedHunks;
        if (hunks.Count == 0) return;
        if (DialogXamlRoot is null) return;

        var note = new TextBox
        {
            PlaceholderText = Strings.Changes_RetakeNotePlaceholder,
            AcceptsReturn = true,
            Height = 96,
            TextWrapping = TextWrapping.Wrap,
        };
        AutomationProperties.SetName(note, Strings.Changes_RetakeNotePlaceholder);
        var canDirect = _canSendToTerminal?.Invoke() == true && _sendToTerminal is not null;
        var dialog = new ContentDialog
        {
            Title = Strings.Changes_RetakeTitle,
            Content = note,
            PrimaryButtonText = Strings.Changes_RetakeCopy,
            SecondaryButtonText = canDirect ? Strings.Changes_RetypeSendToTerminal : null,
            CloseButtonText = Strings.Common_Cancel,
            XamlRoot = DialogXamlRoot,
        };
        var result = await dialog.ShowAsync();
        if (result == ContentDialogResult.None) return;

        var prompt = _vm.BuildRetakeFeedback(hunks, string.IsNullOrWhiteSpace(note.Text) ? null : note.Text.Trim());
        if (prompt is null) return;

        if (result == ContentDialogResult.Secondary && _sendToTerminal is not null)
        {
            // cli-pty 直投（§12.7）：prompt 送入运行中 agent CLI 的 PTY（回车提交）
            _sendToTerminal(prompt);
        }
        else
        {
            try
            {
                var dp = new Windows.ApplicationModel.DataTransfer.DataPackage();
                dp.SetText(prompt);
                Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(dp);
            }
            catch { /* 剪贴板被占用等：静默 */ }
        }
        _canvas.SetSelectedHunks(Array.Empty<int>());
    }

    private void StartExplain(GitUI.Core.Ai.ExplainIntent intent)
    {
        if (_vm.IsExplaining || !_vm.IsAiAvailable) return;
        _explainCts?.Cancel();
        _explainCts = new System.Threading.CancellationTokenSource();
        var ct = _explainCts.Token;
        _ = _vm.ExplainAsync(intent, ct);
    }

    /// <summary>AI 与安全网设置热更新（ai-native-redesign.md §四/§八；设置页变更即时生效）。</summary>
    private void ApplyAiSettings(GitUI.Core.Settings.AppSettings s)
    {
        _vm.UpdateAi(
            s.SafetyNetMode,
            s.Ai.Privacy,
            s.Ai.AppendTrailer ? AiGatewayFactory.TrailerId(s.Ai) : null,
            AiGatewayFactory.FromSettings(s.Ai));
        Rebind();
    }

    private async Task CommitAsync(bool push)
    {
        await _vm.CommitAsync(_messageBox.Text, push);
        _messageBox.Text = string.Empty;
        UpdateRecentMessages();
    }

    /// <summary>AI 生成提交信息草稿填入输入框（必经人工确认后才提交，原则 1.2-2）。</summary>
    private async Task GenerateMessageAsync()
    {
        if (_aiGenerating || !_vm.IsAiAvailable) return;
        _aiGenerating = true;
        _aiMsgBtn.Content = Strings.Changes_AiGenerating;
        _aiMsgBtn.IsEnabled = false;
        try
        {
            var draft = await _vm.GenerateCommitMessageAsync();
            if (!string.IsNullOrEmpty(draft)) _messageBox.Text = draft;
        }
        finally
        {
            _aiGenerating = false;
            _aiMsgBtn.Content = Strings.Changes_AiGenerate;
            _aiMsgBtn.IsEnabled = _vm.IsAiAvailable;
        }
    }

    /// <summary>F5 / 命令面板刷新入口（S7）。</summary>
    public Task RefreshAsync() => _vm.RefreshAsync();

    /// <summary>语言热切换：静态文案重取值（docs/i18n.md §四；由 MainWindow 驱动）。</summary>
    internal void OnLanguageChanged()
    {
        _switchBtn.Content = Strings.Common_SwitchProject;
        AutomationProperties.SetName(_refreshBtn, Strings.Common_Refresh);
        _copyErrBtn.Content = Strings.Common_CopyErrorDetail;
        _openEditorBtn.Content = Strings.Changes_OpenInEditor;
        _aiMsgBtn.Content = Strings.Changes_AiGenerate;
        AutomationProperties.SetName(_aiMsgBtn, Strings.Changes_AiGenerate);
        _rejectHunkBtn.Content = Strings.Changes_RejectHunk;
        _retakeBtn.Content = Strings.Changes_Retake;
        _explainBtn.Content = Strings.Changes_AiExplain;
        _explainCloseBtn.Content = Strings.Common_Close;
        AutomationProperties.SetName(_explainCloseBtn, Strings.Common_Close);
        _stageHunkBtn.Content = Strings.Changes_StageHunk;
        _unstageHunkBtn.Content = Strings.Changes_UnstageHunk;
        _messageBox.PlaceholderText = Strings.Changes_MessagePlaceholder;
        AutomationProperties.SetName(_messageBox, Strings.Changes_MessageAutomation);
        _prefixBox.PlaceholderText = Strings.Changes_PrefixPlaceholder;
        AutomationProperties.SetName(_prefixBox, Strings.Changes_PrefixAutomation);
        _recentMsgBox.PlaceholderText = Strings.Changes_RecentPlaceholder;
        AutomationProperties.SetName(_recentMsgBox, Strings.Changes_RecentAutomation);
        _commitBtn.Content = Strings.Changes_Commit;
        _commitPushBtn.Content = Strings.Changes_CommitAndPush;
        _retryPushBtn.Content = Strings.Changes_RetryPush;
        _projectLabel.Text = _context.WorkDir ?? Strings.Common_NoProjectSelected;
        if (_vm.Selected is null)
        {
            _canvas.Clear(Strings.Changes_CanvasIdle);
        }

        UpdateSelection(); // 重转译 _stageFileBtn 的冲突文案与画布提示
        Rebind();
    }

    // ---- 命令面板入口（v2）：MainWindow 经页面缓存对象调用；未开仓库时由 MainWindow 置灰 ----

    /// <summary>仓库是否已打开（提交/暂存类命令的置灰依据）。</summary>
    public bool IsRepoOpen => _vm.IsRepoOpen;

    /// <summary>提交当前勾选文件（可选推送）。消息为空时 VM 显示"提交消息不能为空"横幅。</summary>
    public void CommitFromPalette(bool push)
    {
        if (!_vm.IsRepoOpen) return;
        _ = CommitAsync(push);
    }

    /// <summary>全部暂存：勾选 Changes + Unversioned 两层（与组头"全部暂存 +"同语义，跨层批量）。</summary>
    public void StageAllFromPalette()
    {
        if (!_vm.IsRepoOpen) return;
        _vm.SetAllChecked(StatusCategory.Changes, true);
        _vm.SetAllChecked(StatusCategory.Unversioned, true);
    }

    /// <summary>全部撤销暂存：取消 Staged 层勾选（组头"全部撤销 −"同语义）。</summary>
    public void UnstageAllFromPalette()
    {
        if (!_vm.IsRepoOpen) return;
        _vm.SetAllChecked(StatusCategory.Staged, false);
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
            FontSize = 11.5,
            FontWeight = new Windows.UI.Text.FontWeight(600),
            Foreground = Ui.Text,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var host = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        host.Children.Add(title);
        foreach (var (label, action) in h.Actions)
        {
            var b = BuildToolButton(label);
            b.Padding = new Thickness(6, 1, 6, 2);
            b.FontSize = 11;
            b.MinHeight = 22;
            b.Click += (_, _) => action();
            host.Children.Add(b);
        }

        var border = new Border
        {
            Child = host,
            Background = SectionBrush,
            Padding = new Thickness(9, 4, 9, 4),
            CornerRadius = new CornerRadius(Ui.CornerRadius),
            Margin = new Thickness(4, 4, 4, 1),
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
        AutomationProperties.SetName(checkBox, string.Format(Strings.Changes_CheckAutomation, entry.Path));
        checkBox.Click += (_, _) =>
        {
            if (checkBox.IsChecked is { } v) _vm.SetChecked(entry, v);
        };

        var statusLetter = new TextBlock
        {
            Text = f.StatusLabel,
            FontFamily = Ui.Mono,
            FontSize = 11.5,
            FontWeight = new Windows.UI.Text.FontWeight(600),
            Foreground = StatusBrush(f.StatusLabel),
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 0, 8, 0),
        };

        var path = new TextBlock
        {
            Text = entry.Path,
            FontSize = 12,
            Foreground = Ui.Text,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };

        var stats = new TextBlock
        {
            Text = f.StatsLabel,
            FontFamily = Ui.Mono,
            FontSize = 10.5,
            Foreground = Ui.Text3,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(8, 0, 0, 0),
        };

        var row = new Grid();
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(checkBox, 0);
        row.Children.Add(checkBox);
        Grid.SetColumn(statusLetter, 1);
        row.Children.Add(statusLetter);
        Grid.SetColumn(path, 2);
        row.Children.Add(path);

        // 风险徽标（§3.3）：红点 = 有阻止级发现，琥珀点 = 仅警告；tooltip 带计数
        var risk = _vm.RiskLevelFor(entry.Path);
        if (risk is not null)
        {
            var blocked = risk == GitUI.Core.Rules.SafetySeverity.Blocked;
            var count = _vm.FindingsFor(entry.Path).Count;
            var dot = new Ellipse
            {
                Width = 7,
                Height = 7,
                Fill = blocked ? Ui.Red : Ui.Amber,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(6, 0, 0, 0),
            };
            ToolTipService.SetToolTip(dot, string.Format(
                blocked ? Strings.Changes_RiskBlockedTooltip : Strings.Changes_RiskWarningTooltip, count));
            Grid.SetColumn(dot, 3);
            row.Children.Add(dot);
        }

        Grid.SetColumn(stats, 4);
        row.Children.Add(stats);

        // 用 Button 承载行（UIA InvokePattern 可驱动冒烟），样式对齐 Border 外观
        var rowBtn = new Button
        {
            Content = row,
            Padding = new Thickness(8, 2, 8, 3),
            Margin = new Thickness(4, 0, 4, 0),
            CornerRadius = new CornerRadius(Ui.CornerRadius),
            Background = entry.Path == _vm.Selected?.Path ? RowSelectedBrush : ClearBrush,
            BorderThickness = new Thickness(0),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            MinHeight = 26,
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
            _banner.Text = string.Format(Strings.Changes_PushFailed, failure.Message, failure.Hint);
            _banner.Visibility = Visibility.Visible;
            _retryPushBtn.Visibility = Visibility.Visible;
        }
        else if (_vm.Error is not null)
        {
            _banner.Text = string.Format(Strings.Common_ErrorPrefix, _vm.Error);
            _banner.Visibility = Visibility.Visible;
            _retryPushBtn.Visibility = Visibility.Collapsed;
        }
        else
        {
            _banner.Text = string.Empty;
            _banner.Visibility = Visibility.Collapsed;
            _retryPushBtn.Visibility = Visibility.Collapsed;
        }

        // 复制完整错误详情（known-issues 1.7）
        var detail = _vm.ErrorDetail;
        _copyErrBtn.Visibility = detail is null ? Visibility.Collapsed : Visibility.Visible;

        // transient 5s 消退（known-issues 1.8）：每次 Rebind 重置计时
        if (!string.IsNullOrEmpty(_vm.TransientMessage))
        {
            _transientTimer.Stop();
            _transientTimer.Start();
        }
        else
        {
            _transientTimer.Stop();
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
        _aiMsgBtn.IsEnabled = !_aiGenerating && _vm.IsAiAvailable && _vm.IsRepoOpen && _vm.CheckedCount > 0;

        // AI 批注栏（§3.5）：非阻塞展示，关闭按钮收起
        _explainBtn.IsEnabled = !_vm.IsExplaining && _vm.IsAiAvailable && _vm.Selected is not null;
        if (_vm.Explanation is { } explanation)
        {
            _explainText.Text = _vm.IsExplaining ? Strings.Changes_AiGenerating : explanation;
            _explainPanel.Visibility = Visibility.Visible;
            // 反馈段与解释共存时一并展示
            _agentFeedbackText.Text = _vm.AgentFeedback?.Note ?? string.Empty;
            _agentFeedbackBlock.Visibility = _vm.AgentFeedback is null ? Visibility.Collapsed : Visibility.Visible;
        }
        else if (_vm.AgentFeedback is { } fb)
        {
            // agent 反馈（§7.2）：无 AI 解释时也展示反馈段
            _agentFeedbackText.Text = fb.Note;
            _agentFeedbackBlock.Visibility = Visibility.Visible;
            _explainText.Text = string.Empty;
            _explainPanel.Visibility = Visibility.Visible;
        }
        else
        {
            _agentFeedbackBlock.Visibility = Visibility.Collapsed;
            _explainPanel.Visibility = Visibility.Collapsed;
        }

        // 文件预览：勾选文件列表（最多 5 条 + 省略）
        var previewPaths = _vm.Changes.Concat(_vm.Staged).Concat(_vm.Unversioned)
            .Where(_vm.IsChecked)
            .Select(e => e.Path).ToList();
        _preview.Text = previewPaths.Count == 0
            ? Strings.Changes_NoFilesChecked
            : string.Join(", ", previewPaths.Take(5)) + (previewPaths.Count > 5 ? string.Format(Strings.Changes_PreviewMore, previewPaths.Count) : "");
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

        AddSection(string.Format(Strings.Changes_SectionConflicts, _vm.Conflicts.Count), Strings.Changes_SectionConflictsAutomation, _vm.Conflicts, "C",
            Array.Empty<(string, Action)>(), _ => string.Empty);
        AddSection(string.Format(Strings.Changes_SectionChanges, _vm.Changes.Count), Strings.Changes_SectionChangesAutomation, _vm.Changes, "M",
            new[] { (Strings.Changes_StageAll, (Action)(() => _vm.SetAllChecked(StatusCategory.Changes, true))) },
            e => StatsLabel(e.AddedLines, e.DeletedLines));
        AddSection(string.Format(Strings.Changes_SectionStaged, _vm.Staged.Count), Strings.Changes_SectionStagedAutomation, _vm.Staged, "S",
            new[] { (Strings.Changes_UnstageAll, (Action)(() => _vm.SetAllChecked(StatusCategory.Staged, false))) },
            e => StatsLabel(e.AddedLines, e.DeletedLines));
        AddSection(string.Format(Strings.Changes_SectionUntracked, _vm.Unversioned.Count), Strings.Changes_SectionUntrackedAutomation, _vm.Unversioned, "U",
            new[] { (Strings.Changes_StageAll, (Action)(() => _vm.SetAllChecked(StatusCategory.Unversioned, true))) },
            _ => string.Empty);
        return rows;
    }

    private static string StatsLabel(int? added, int? deleted) =>
        added is null || deleted is null || (added == 0 && deleted == 0)
            ? string.Empty
            : $"+{added} −{deleted}";

    /// <summary>状态字母语义色：M/S 蓝、A 绿、D 红、U 琥珀、C 红。</summary>
    private static SolidColorBrush StatusBrush(string label) => label switch
    {
        "A" => Ui.Green,
        "D" or "C" => Ui.Red,
        "U" => Ui.Amber,
        _ => Ui.ChipBlueFg,
    };

    private void UpdateSelection()
    {
        var view = _vm.SelectedDiff;
        var selected = _vm.Selected;
        if (selected is null)
        {
            _fileHeader.Text = string.Empty;
            _openEditorBtn.IsEnabled = false;
            _canvas.Clear(Strings.Changes_CanvasIdle);
            UpdateHunkButtons();
            return;
        }

        _fileHeader.Text = selected.Path;
        _canvas.SourcePath = selected.Path; // 语法高亮按扩展名解析（code-highlight-framework P1）
        _openEditorBtn.IsEnabled = true;
        // 冲突文件下"暂存文件"即"标记已解决"（git add 移除冲突条目），换标签提示语义
        var isConflict = selected.IsConflict;
        _stageFileBtn.Content = Ui.IconTextContent("\uE8E5",
            isConflict ? Strings.Changes_MarkResolved : Strings.Changes_StageFile);
        AutomationProperties.SetName(_stageFileBtn, isConflict ? Strings.Changes_MarkResolved : Strings.Changes_StageFile);
        if (view is null)
        {
            _canvas.Clear(selected.IsConflict ? Strings.Changes_ConflictHint : Strings.Common_NoDiff);
            UpdateHunkButtons();
            return;
        }

        if (view.Hunks.Count == 0) _canvas.Clear(Strings.Common_NoDiff);
        else _canvas.Load(view.Hunks, view.OldEndsWithNewline, view.NewEndsWithNewline);
        UpdateRiskMarks(view);
        UpdateHunkButtons();
    }

    /// <summary>风险发现映射到 hunk（§3.3 画布标记）：行号 → hunk 序号，红/琥珀分级。</summary>
    private void UpdateRiskMarks(FileDiffView view)
    {
        var findings = _vm.FindingsFor(view.Path);
        if (findings.Count == 0)
        {
            _canvas.SetRiskHunks(Array.Empty<int>(), Array.Empty<int>());
            return;
        }

        var blocked = findings.Where(f => f.Severity == GitUI.Core.Rules.SafetySeverity.Blocked).ToList();
        var warning = findings.Where(f => f.Severity == GitUI.Core.Rules.SafetySeverity.Warning).ToList();
        _canvas.SetRiskHunks(
            GitUI.Core.Rules.RiskHunkMapper.Map(blocked, view.Hunks),
            GitUI.Core.Rules.RiskHunkMapper.Map(warning, view.Hunks));
    }

    private void UpdateHunkButtons()
    {
        var view = _vm.SelectedDiff;
        var canStage = view is { CanStageHunks: true } && _canvas.SelectedHunks.Count > 0;
        _stageHunkBtn.IsEnabled = canStage && view!.IsStagedView == false;
        _unstageHunkBtn.IsEnabled = canStage && view!.IsStagedView;
        // 验收台三态（§3.4）：拒绝/退回仅作用于工作区改动（Staged 视图的对应动作是撤销暂存）
        _rejectHunkBtn.IsEnabled = canStage && view!.IsStagedView == false;
        _retakeBtn.IsEnabled = canStage && view!.IsStagedView == false;
    }

    private void UpdateRecentMessages()
    {
        _recentMsgBox.Items.Clear();
        foreach (var m in _vm.RecentMessages(20))
            _recentMsgBox.Items.Add(m);
        _recentMsgBox.SelectedIndex = -1;
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
