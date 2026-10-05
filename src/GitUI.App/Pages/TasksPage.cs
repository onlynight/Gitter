using GitUI.Core.Models;
using GitUI.Core.Resources;
using GitUI.Core.Services;
using GitUI.Core.Settings;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace GitUI.App.Pages;

/// <summary>
/// 任务页（P3 并行工作台，ai-native-redesign.md §六）：
/// 每个任务 = 一个 worktree + 一个分支（task/&lt;name&gt; 模板）。任务卡列出
/// worktree 状态，快速动作：打开（当前窗口切到该 worktree）/ 新窗口 / 合并回主分支 /
/// 移除；支持新建任务与清理失效记录。数据源 = 当前仓库（RepositoryContext）。
/// </summary>
public sealed class TasksPage : UserControl
{
    private readonly ISettingsStore _settings;
    private readonly IRepositoryService _repo;
    private readonly RepositoryContext _context;
    private readonly Action<string> _navigate;
    private readonly Action<string, string>? _openTerminalTab;
    private readonly SemaphoreSlim _gate = new(1, 1);

    private readonly TextBlock _status;
    private readonly TextBlock _banner;
    private readonly Button _copyErrBtn;
    private readonly StackPanel _cards;
    private readonly ScrollViewer _listScroll;
    private readonly Button _newBtn;
    private readonly Button _pruneBtn;
    private readonly Button _refreshBtn;

    private string? _error;
    private string? _transient;
    private bool _isLoading;
    private bool _noRepo;

    /// <param name="openTerminalTab">为任务开专用终端 tab（标题，cwd 固定；ai-native-redesign.md §6.3）。null 隐藏入口。</param>
    public TasksPage(
        ISettingsStore settings,
        IRepositoryService repoService,
        RepositoryContext context,
        Action<string> navigate,
        Action<string, string>? openTerminalTab = null)
    {
        _settings = settings;
        _repo = repoService;
        _context = context;
        _navigate = navigate;
        _openTerminalTab = openTerminalTab;

        var toolbar = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(12, 10, 12, 4) };
        _newBtn = ToolButton(Strings.Tasks_NewTask, (_, _) => _ = NewTaskAsync());
        _pruneBtn = ToolButton(Strings.Tasks_Prune, async (_, _) => await RunExclusiveAsync(PruneCoreAsync));
        _refreshBtn = ToolButton(Strings.Common_Refresh, async (_, _) => await RefreshAsync());
        toolbar.Children.Add(_newBtn);
        toolbar.Children.Add(_pruneBtn);
        toolbar.Children.Add(_refreshBtn);
        _status = new TextBlock
        {
            FontSize = 11,
            Foreground = Ui.Text2,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(8, 0, 0, 0),
            TextTrimming = TextTrimming.CharacterEllipsis,
            Text = Strings.Common_NoRepoOpen,
        };
        toolbar.Children.Add(_status);

        _banner = new TextBlock
        {
            FontSize = 11.5,
            Foreground = Ui.Red,
            Margin = new Thickness(12, 0, 12, 0),
            TextWrapping = TextWrapping.Wrap,
            Visibility = Visibility.Collapsed,
        };
        _copyErrBtn = ToolButton(Strings.Common_CopyErrorDetail, (_, _) =>
        {
            try
            {
                var dp = new Windows.ApplicationModel.DataTransfer.DataPackage();
                dp.SetText(_error ?? string.Empty);
                Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(dp);
            }
            catch { /* 剪贴板占用：静默 */ }
        });
        var bannerRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(12, 2, 12, 2) };
        bannerRow.Children.Add(_banner);
        bannerRow.Children.Add(_copyErrBtn);

        _cards = new StackPanel { Spacing = 8 };
        _listScroll = new ScrollViewer
        {
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            Content = new StackPanel { Spacing = 8, Margin = new Thickness(12, 8, 12, 12), Children = { _cards } },
        };

        var root = new Grid();
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(toolbar, 0);
        root.Children.Add(toolbar);
        Grid.SetRow(bannerRow, 1);
        root.Children.Add(bannerRow);
        Grid.SetRow(_listScroll, 2);
        root.Children.Add(_listScroll);
        Content = root;

        _context.Changed += () => DispatcherQueue.TryEnqueue(() => _ = RefreshAsync());
        Loaded += (_, _) => _ = RefreshAsync();
    }

    /// <summary>F5 / 命令面板 / 仓库变化刷新入口。</summary>
    public Task RefreshAsync() => RunExclusiveAsync(LoadCoreAsync);

    private async Task RunExclusiveAsync(Func<Task> action)
    {
        await _gate.WaitAsync();
        try
        {
            _isLoading = true;
            RebindStatus();
            await action();
            _isLoading = false;
            RebindStatus();
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task LoadCoreAsync()
    {
        _transient = null;
        var workDir = _context.WorkDir;
        if (workDir is null)
        {
            _noRepo = true;
            _cards.Children.Clear();
            return;
        }
        _noRepo = false;

        try
        {
            var worktrees = await Task.Run(() => _repo.GetWorktrees(workDir));
            var cards = new List<UIElement>();
            foreach (var wt in worktrees)
            {
                var dirty = await CountDirtyAsync(wt.Path);
                cards.Add(BuildCard(workDir, wt, dirty));
            }
            _cards.Children.Clear();
            foreach (var c in cards) _cards.Children.Add(c);
            _error = null;
        }
        catch (Exception ex)
        {
            _error = ex.Message;
        }
    }

    private async Task<int> CountDirtyAsync(string path)
    {
        try
        {
            var status = await Task.Run(() => _repo.GetStatus(path));
            return status.Count;
        }
        catch
        {
            return -1; // 读不到（权限/竞态）按未知处理
        }
    }

    private async Task NewTaskAsync()
    {
        if (_context.WorkDir is null) return;
        if (DialogXamlRoot is null) return;

        var input = new TextBox { PlaceholderText = Strings.Tasks_NamePlaceholder };
        AutomationProperties.SetName(input, Strings.Tasks_NamePlaceholder);
        var dialog = new ContentDialog
        {
            Title = Strings.Tasks_NewTaskTitle,
            Content = input,
            PrimaryButtonText = Strings.Tasks_Create,
            CloseButtonText = Strings.Common_Cancel,
            XamlRoot = DialogXamlRoot,
        };
        var result = await dialog.ShowAsync();
        if (result != ContentDialogResult.Primary) return;

        var slug = Slugify(input.Text);
        if (slug.Length == 0) return;
        var branch = "task/" + slug;
        var taskPath = TaskWorktreePath(_context.WorkDir!, slug);

        await RunExclusiveAsync(async () =>
        {
            try
            {
                await Task.Run(() => _repo.CreateWorktree(_context.WorkDir!, taskPath, branch, startPoint: null));
                _transient = string.Format(Strings.Tasks_CreatedFormat, branch);
                _error = null;
            }
            catch (Exception ex)
            {
                _error = ex.Message;
            }
            await LoadCoreAsync();
        });
    }

    private async Task PruneCoreAsync()
    {
        if (_context.WorkDir is null) return;
        try
        {
            await Task.Run(() => _repo.PruneWorktrees(_context.WorkDir!));
            _transient = Strings.Tasks_Prune;
        }
        catch (Exception ex)
        {
            _error = ex.Message;
        }
        await LoadCoreAsync();
    }

    private UIElement BuildCard(string workDir, WorktreeInfo wt, int dirty)
    {
        var info = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        titleRow.Children.Add(new TextBlock
        {
            Text = wt.DisplayName,
            FontSize = 13,
            FontWeight = new Windows.UI.Text.FontWeight(600),
            Foreground = Ui.Text,
            VerticalAlignment = VerticalAlignment.Center,
        });
        if (wt.IsMain)
        {
            titleRow.Children.Add(new Border
            {
                Background = Ui.AccentSoft,
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(5, 1, 5, 2),
                Child = new TextBlock { Text = Strings.Tasks_MainBadge, FontSize = 10, Foreground = Ui.Accent },
                VerticalAlignment = VerticalAlignment.Center,
            });
        }
        info.Children.Add(titleRow);

        info.Children.Add(new TextBlock
        {
            Text = wt.IsMain ? Strings.Tasks_MainHint : wt.Path,
            FontSize = 10.5,
            Foreground = Ui.Text3,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        var state = dirty < 0
            ? wt.ShortSha
            : dirty == 0
                ? $"{Strings.Tasks_Clean} · {wt.ShortSha}"
                : $"{string.Format(Strings.Tasks_DirtyFormat, dirty)} · {wt.ShortSha}";
        info.Children.Add(new TextBlock { Text = state, FontSize = 10.5, FontFamily = Ui.Mono, Foreground = Ui.Text3 });

        var buttons = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        if (wt.IsMain)
        {
            // 主 worktree 只读展示
        }
        else
        {
            var open = ToolButton(Strings.Tasks_Open, (_, _) =>
            {
                _context.Set(wt.Path);
                _navigate("changes");
            });
            AutomationProperties.SetName(open, Strings.Tasks_Open + " " + wt.DisplayName);

            Button? terminalBtn = null;
            if (_openTerminalTab is not null)
            {
                var title = wt.DisplayName;
                var cwd = wt.Path;
                terminalBtn = ToolButton(Strings.Nav_Terminal, (_, _) => _openTerminalTab(title, cwd));
                AutomationProperties.SetName(terminalBtn, Strings.Nav_Terminal + " " + title);
            }

            var newWindow = ToolButton(Strings.Tasks_NewWindow, (_, _) => App.OpenNewWindow(wt.Path));
            AutomationProperties.SetName(newWindow, Strings.Tasks_NewWindow + " " + wt.DisplayName);

            var merge = ToolButton(Strings.Tasks_Merge, (_, _) => _ = MergeAsync(wt));
            AutomationProperties.SetName(merge, Strings.Tasks_Merge + " " + wt.DisplayName);

            var remove = ToolButton(Strings.Tasks_Remove, (_, _) => _ = RemoveAsync(wt));
            AutomationProperties.SetName(remove, Strings.Tasks_Remove + " " + wt.DisplayName);

            buttons.Children.Add(open);
            if (terminalBtn is not null) buttons.Children.Add(terminalBtn);
            buttons.Children.Add(newWindow);
            buttons.Children.Add(merge);
            buttons.Children.Add(remove);
        }

        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(info, 0);
        grid.Children.Add(info);
        Grid.SetColumn(buttons, 1);
        grid.Children.Add(buttons);

        return new Border
        {
            Background = Ui.Panel,
            BorderBrush = Ui.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(Ui.CornerRadius),
            Padding = new Thickness(12, 8, 12, 8),
            Child = grid,
        };
    }

    private async Task MergeAsync(WorktreeInfo wt)
    {
        var workDir = _context.WorkDir;
        if (workDir is null || wt.Branch is null) return;
        if (DialogXamlRoot is null) return;

        // 目标 = 主 worktree 当前分支（ai-native-redesign.md §6.2"合并回主分支"）
        string targetBranch;
        try
        {
            var main = (await Task.Run(() => _repo.GetWorktrees(workDir))).First(w => w.IsMain);
            targetBranch = main.Branch ?? Strings.Common_Refresh;
        }
        catch (Exception ex)
        {
            _error = ex.Message;
            RebindBanner();
            return;
        }

        var dialog = new ContentDialog
        {
            Title = Strings.Tasks_Merge,
            Content = new TextBlock { Text = string.Format(Strings.Tasks_MergeConfirmFormat, wt.Branch, targetBranch), TextWrapping = TextWrapping.Wrap },
            PrimaryButtonText = Strings.Tasks_Merge,
            CloseButtonText = Strings.Common_Cancel,
            XamlRoot = DialogXamlRoot,
        };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;

        await RunExclusiveAsync(async () =>
        {
            try
            {
                var mainPath = (await Task.Run(() => _repo.GetWorktrees(workDir))).First(w => w.IsMain).Path;
                await Task.Run(() => _repo.MergeBranch(mainPath, wt.Branch!, noFastForward: false, message: null));
                _transient = string.Format(Strings.Tasks_MergedFormat, wt.Branch, targetBranch);
                _error = null;
            }
            catch (Exception ex)
            {
                _error = ex.Message;
            }
            await LoadCoreAsync();
        });
    }

    private async Task RemoveAsync(WorktreeInfo wt)
    {
        var workDir = _context.WorkDir;
        if (workDir is null) return;
        if (DialogXamlRoot is null) return;

        var dialog = new ContentDialog
        {
            Title = Strings.Tasks_Remove,
            Content = new TextBlock { Text = string.Format(Strings.Tasks_RemoveConfirmFormat, wt.Path), TextWrapping = TextWrapping.Wrap },
            PrimaryButtonText = Strings.Tasks_Remove,
            CloseButtonText = Strings.Common_Cancel,
            XamlRoot = DialogXamlRoot,
        };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;

        await RunExclusiveAsync(async () =>
        {
            try
            {
                await Task.Run(() => _repo.RemoveWorktree(workDir, wt.Path));
                _transient = string.Format(Strings.Tasks_RemovedFormat, wt.DisplayName);
                _error = null;
            }
            catch (Exception ex)
            {
                _error = ex.Message;
            }
            await LoadCoreAsync();
        });
    }

    // ---- 渲染 ----

    private void RebindStatus()
    {
        _status.Text = _error is not null ? string.Format(Strings.Common_ErrorPrefix, _error)
            : _isLoading ? Strings.Common_Loading
            : _noRepo ? Strings.Common_NoRepoOpen
            : _transient is not null ? _transient
            : string.Format("{0}", Strings.Nav_Tasks);
        RebindBanner();
    }

    private void RebindBanner()
    {
        _banner.Text = _error is null ? string.Empty : string.Format(Strings.Common_ErrorPrefix, _error);
        _banner.Visibility = _error is null ? Visibility.Collapsed : Visibility.Visible;
        _copyErrBtn.Visibility = _error is null ? Visibility.Collapsed : Visibility.Visible;
    }

    /// <summary>
    /// 任务 worktree 的落盘位置：%LOCALAPPDATA%\GitUI\tasks\&lt;仓库名-&lt;路径 hash8&gt;\&lt;slug&gt;。
    /// 不能放仓库内（污染 status），也不能假定仓库父目录可写。
    /// </summary>
    private static string TaskWorktreePath(string workDir, string slug)
    {
        var repoName = Path.GetFileName(workDir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
        var hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
            System.Text.Encoding.UTF8.GetBytes(workDir.ToLowerInvariant())))[..8];
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "GitUI", "tasks", $"{repoName}-{hash}", slug);
    }

    private static string Slugify(string raw)
    {
        var chars = raw.Trim().ToLowerInvariant()
            .Select(c => char.IsAsciiLetterOrDigit(c) ? c : c is '-' or '_' ? '-' : '-');
        var slug = new string(chars.ToArray());
        while (slug.Contains("--")) slug = slug.Replace("--", "-");
        return slug.Trim('-');
    }

    private static Button ToolButton(string text, EventHandler<RoutedEventArgs> onClick) => new()
    {
        Content = text,
        Padding = new Thickness(10, 4, 10, 5),
        CornerRadius = new CornerRadius(4),
        FontSize = 12,
    };

    private Microsoft.UI.Xaml.XamlRoot? DialogXamlRoot => XamlRoot ?? Content.XamlRoot;
}
