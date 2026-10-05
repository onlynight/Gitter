using GitUI.App.Platform;
using GitUI.Core.Models;
using GitUI.Core.Resources;
using GitUI.Core.Services;
using GitUI.Core.Settings;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.UI;

namespace GitUI.App.Pages;

/// <summary>
/// 项目页：用户显式管理的本地文件夹列表，替代手动填写仓库路径。
/// 右上角「添加项目」弹出系统目录选择对话框；双击列表项（或已高亮项再次单击/回车）
/// 设为当前项目——全窗口路径随之切换（RepositoryContext），并自动跳转 Log 页。
/// 交互约定：单击仅高亮候选，双击提交；右键菜单提供 设为当前 / 资源管理器打开 / 移除。
/// </summary>
public sealed class ProjectsPage : UserControl
{
    private readonly ISettingsStore _settings;
    private readonly IRepositoryService _repoService;
    private readonly RepositoryContext _context;
    private readonly Action<string> _navigate;
    private readonly Func<IntPtr> _getHwnd;

    private readonly TextBlock _title;
    private readonly TextBlock _banner;
    private readonly Button _addBtn;
    // 在 BuildEmptyState（ctor 调用的方法）中赋值：非 readonly + null! 抑制流分析
    private Button _emptyAddBtn = null!;
    private TextBlock _emptyTitle = null!;
    private TextBlock _emptySub = null!;
    private readonly ItemsRepeater _repeater;
    private readonly ScrollViewer _listScroll;
    private readonly FrameworkElement _emptyState;
    private readonly TextBlock _status;
    private readonly Microsoft.UI.Dispatching.DispatcherQueueTimer _transientTimer;

    /// <summary>候选高亮路径（单击设置，再次单击/双击提交）。</summary>
    private string? _highlighted;

    /// <summary>一次性状态消息（5s 消退），如"该项目已在列表中"。</summary>
    private string? _transient;

    /// <summary>错误横幅（目录选择器异常等），手动清除。</summary>
    private string? _error;

    public ProjectsPage(ISettingsStore settings, IRepositoryService repoService, RepositoryContext context, Action<string> navigate, Func<IntPtr> getHwnd)
    {
        _settings = settings;
        _repoService = repoService;
        _context = context;
        _navigate = navigate;
        _getHwnd = getHwnd;

        // ---- 工具条：标题 + 右上角添加按钮 ----
        _title = new TextBlock
        {
            Text = Strings.Nav_Projects,
            FontSize = 13,
            FontWeight = new Windows.UI.Text.FontWeight(600),
            VerticalAlignment = VerticalAlignment.Center,
        };

        var addBtn = _addBtn = BuildToolButton(Strings.Projects_AddProject, Strings.Projects_AddProjectAutomation);
        addBtn.Click += (_, _) => _ = AddProjectAsync();

        var toolbar = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            Margin = new Thickness(10, 6, 10, 2),
            VerticalAlignment = VerticalAlignment.Center,
        };
        toolbar.Children.Add(_title);
        toolbar.Children.Add(Spacer());
        toolbar.Children.Add(addBtn);

        // ---- 错误横幅 ----
        _banner = new TextBlock
        {
            TextWrapping = TextWrapping.Wrap,
            Foreground = new SolidColorBrush(Microsoft.UI.Colors.OrangeRed),
            VerticalAlignment = VerticalAlignment.Center,
            Visibility = Visibility.Collapsed,
            Margin = new Thickness(10, 2, 10, 2),
        };

        // ---- 项目列表 ----
        _repeater = new ItemsRepeater { Layout = new StackLayout() };
        _repeater.ItemTemplate = new ProjectRowFactory(this);
        _listScroll = new ScrollViewer
        {
            Content = _repeater,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Padding = new Thickness(0, 2, 0, 8),
        };

        // ---- 空状态 ----
        _emptyState = BuildEmptyState(addBtn_Click: (_, _) => _ = AddProjectAsync());

        var listHost = new Grid();
        listHost.Children.Add(_listScroll);
        listHost.Children.Add(_emptyState);

        // ---- 状态条 ----
        _status = new TextBlock
        {
            FontSize = 11.5,
            Opacity = 0.72,
            Margin = new Thickness(14, 0, 14, 0),
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            Text = string.Format(Strings.Projects_StatusNoCurrentMany, 0),
        };
        // 不设 AutomationProperties.Name（显式 Name 覆盖动态文本，UIA 冒烟依赖 Name=内容）
        var statusRow = new Grid { Height = 22 };
        statusRow.Children.Add(_status);

        var root = new Grid();
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(22) });
        Grid.SetRow(toolbar, 0);
        root.Children.Add(toolbar);
        Grid.SetRow(_banner, 1);
        root.Children.Add(_banner);
        Grid.SetRow(listHost, 2);
        root.Children.Add(listHost);
        Grid.SetRow(statusRow, 3);
        root.Children.Add(statusRow);

        Content = root;

        _context.Changed += () => DispatcherQueue.TryEnqueue(Rebind);
        _settings.Changed += (_, _) => DispatcherQueue.TryEnqueue(Rebind);

        // 一次性状态消息 5s 自动消退（同 BranchesPage known-issues 1.8 模式）
        _transientTimer = DispatcherQueue.CreateTimer();
        _transientTimer.Interval = TimeSpan.FromSeconds(5);
        _transientTimer.Tick += (_, _) =>
        {
            _transientTimer.Stop();
            _transient = null;
            Rebind();
        };

        Rebind();
    }

    // ---- 主题色 / 构建（同 BranchesPage 约定） ----

    private static readonly SolidColorBrush ClearBrush = new(Microsoft.UI.Colors.Transparent);

    private static SolidColorBrush RowSelectedBrush => Ui.AccentSoft;

    private static SolidColorBrush HoverBrush => Ui.Hover;

    private static SolidColorBrush AccentBrush => Ui.Accent;

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

    private FrameworkElement BuildEmptyState(RoutedEventHandler addBtn_Click)
    {
        var icon = new FontIcon
        {
            Glyph = "\uE8B7",
            FontSize = 34,
            Opacity = 0.35,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        var title = _emptyTitle = new TextBlock
        {
            Text = Strings.Projects_EmptyTitle,
            FontSize = 14,
            FontWeight = new Windows.UI.Text.FontWeight(600),
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 10, 0, 0),
        };
        var sub = _emptySub = new TextBlock
        {
            Text = Strings.Projects_EmptyHint,
            FontSize = 12.5,
            Opacity = 0.6,
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 4, 0, 0),
        };
        var addBtn = _emptyAddBtn = BuildToolButton(Strings.Projects_AddProject, Strings.Projects_AddProjectAutomation);
        addBtn.HorizontalAlignment = HorizontalAlignment.Center;
        addBtn.Margin = new Thickness(0, 14, 0, 0);
        addBtn.Click += addBtn_Click;

        var panel = new StackPanel { MaxWidth = 360, VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center };
        panel.Children.Add(icon);
        panel.Children.Add(title);
        panel.Children.Add(sub);
        panel.Children.Add(addBtn);

        AutomationProperties.SetName(panel, Strings.Projects_EmptyAutomation);
        return panel;
    }

    // ---- 行构建 ----

    private UIElement BuildRow(ProjectEntry entry)
    {
        var isCurrent = string.Equals(_context.WorkDir, entry.Path, StringComparison.OrdinalIgnoreCase);
        var isHighlighted = string.Equals(_highlighted, entry.Path, StringComparison.OrdinalIgnoreCase);

        var name = new TextBlock
        {
            Text = entry.Name,
            FontSize = 13,
            FontWeight = new Windows.UI.Text.FontWeight((ushort)(isCurrent ? 600 : 400)),
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        var path = new TextBlock
        {
            Text = entry.Path,
            FontSize = 11,
            Opacity = 0.6,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(8, 0, 0, 0),
            TextTrimming = TextTrimming.CharacterEllipsis,
        };

        var row = new Grid();
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(name, 0);
        row.Children.Add(name);
        Grid.SetColumn(path, 1);
        row.Children.Add(path);

        // 当前项目 = 强调条 + 选中背景（由 context 状态驱动渲染，同 BranchesPage 教训）；
        // 候选高亮 = 仅悬停色背景
        var accent = new Rectangle
        {
            Width = 3,
            Fill = AccentBrush,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Stretch,
            Margin = new Thickness(2, 4, 0, 4),
            Visibility = isCurrent ? Visibility.Visible : Visibility.Collapsed,
        };

        var rowHost = new Grid();
        rowHost.Children.Add(accent);
        row.ColumnDefinitions.Insert(0, new ColumnDefinition { Width = new GridLength(5) });
        Grid.SetColumn(name, 1);
        Grid.SetColumn(path, 2);
        Grid.SetColumn(row, 1);
        rowHost.Children.Add(row);

        var btn = new Button
        {
            Content = rowHost,
            Padding = new Thickness(4, 4, 12, 4),
            Margin = new Thickness(8, 1, 8, 1),
            CornerRadius = new CornerRadius(Ui.CornerRadius),
            Background = isCurrent ? RowSelectedBrush : isHighlighted ? HoverBrush : ClearBrush,
            BorderThickness = new Thickness(0),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            MinHeight = 40,
        };
        AutomationProperties.SetName(btn, string.Format(Strings.Projects_RowAutomation, entry.Name)
            + (isCurrent ? Strings.Branches_CurrentSuffix : string.Empty)
            + (isHighlighted ? Strings.Branches_SelectedSuffix : string.Empty));
        btn.Click += (_, _) => RowClick(entry);
        btn.DoubleTapped += (_, _) => CommitProject(entry);
        btn.ContextFlyout = BuildRowMenu(entry);
        return btn;
    }

    private MenuFlyout BuildRowMenu(ProjectEntry entry)
    {
        var menu = new MenuFlyout();

        var openItem = new MenuFlyoutItem { Text = Strings.Projects_SetCurrent };
        openItem.Click += (_, _) => CommitProject(entry);
        AutomationProperties.SetName(openItem, Strings.Projects_SetCurrent);
        menu.Items.Add(openItem);

        var explorerItem = new MenuFlyoutItem { Text = Strings.Projects_OpenInExplorer };
        explorerItem.Click += (_, _) => OpenInExplorer(entry);
        AutomationProperties.SetName(explorerItem, Strings.Projects_OpenInExplorer);
        menu.Items.Add(explorerItem);

        var removeItem = new MenuFlyoutItem { Text = Strings.Projects_Remove };
        removeItem.Click += (_, _) => _ = RemoveProjectAsync(entry);
        AutomationProperties.SetName(removeItem, Strings.Projects_Remove);
        menu.Items.Add(removeItem);

        return menu;
    }

    // ---- 行为 ----

    private void RowClick(ProjectEntry entry)
    {
        // 首次单击仅高亮候选；已高亮项再次单击 = 提交（与双击等价，兼顾键盘 Enter）
        if (!string.Equals(_highlighted, entry.Path, StringComparison.OrdinalIgnoreCase))
        {
            _highlighted = entry.Path;
            Rebind();
            return;
        }
        CommitProject(entry);
    }

    /// <summary>双击/回车/菜单「设为当前项目」：切换 RepositoryContext 并持久化，然后跳转 Log 页。</summary>
    private void CommitProject(ProjectEntry entry)
    {
        var path = entry.Path;
        _highlighted = path;
        _context.Set(path);
        _settings.Update(s =>
        {
            s.CurrentProjectPath = path;
            var match = s.Projects.FirstOrDefault(p => string.Equals(p.Path, path, StringComparison.OrdinalIgnoreCase));
            if (match is not null)
            {
                match.LastOpenedAt = DateTimeOffset.Now;
            }
        });
        _settings.Save();
        _navigate("log");
    }

    private async Task AddProjectAsync()
    {
        string? picked;
        try
        {
            // 初始定位到最近一次添加的项目所在目录，减少导航成本
            var startDir = _settings.Current.Projects.Count > 0 ? _settings.Current.Projects[0].Path : null;
            picked = FolderPicker.PickFolder(_getHwnd(), Strings.Projects_PickFolderTitle, startDir);
        }
        catch (Exception ex)
        {
            _error = string.Format(Strings.Projects_PickerFailed, ex.Message);
            Rebind();
            return;
        }

        if (string.IsNullOrWhiteSpace(picked))
        {
            return; // 用户取消
        }

        var path = System.IO.Path.TrimEndingDirectorySeparator(System.IO.Path.GetFullPath(picked.Trim()));
        var existing = _settings.Current.Projects.FirstOrDefault(p => string.Equals(p.Path, path, StringComparison.OrdinalIgnoreCase));
        if (existing is not null)
        {
            ShowTransient(string.Format(Strings.Projects_AlreadyInList, existing.Name));
            _highlighted = existing.Path;
            Rebind();
            return;
        }

        var name = System.IO.Path.GetFileName(path);
        if (!await ConfirmIfNotRepoAsync(path, name))
        {
            return; // 非 git 仓库且用户取消
        }

        _settings.Update(s =>
        {
            s.Projects.Insert(0, new ProjectEntry { Path = path, Name = name, AddedAt = DateTimeOffset.Now });
            s.CurrentProjectPath = path;
        });
        _settings.Save();
        _context.Set(path);
        _navigate("log");
    }

    /// <summary>所选目录不是 git 仓库时弹确认；是仓库或用户确认添加时返回 true。</summary>
    private async Task<bool> ConfirmIfNotRepoAsync(string path, string name)
    {
        var isRepo = await Task.Run(() =>
        {
            try
            {
                _repoService.Open(path);
                return true;
            }
            catch
            {
                return false;
            }
        });
        if (isRepo)
        {
            return true;
        }

        var dialog = new ContentDialog
        {
            XamlRoot = XamlRoot,
            Title = Strings.Projects_NotRepoTitle,
            Content = string.Format(Strings.Projects_NotRepoBody, name),
            PrimaryButtonText = Strings.Projects_AddAnyway,
            CloseButtonText = Strings.Common_Cancel,
            DefaultButton = ContentDialogButton.Close,
        };
        var result = await dialog.ShowAsync();
        return result == ContentDialogResult.Primary;
    }

    private async Task RemoveProjectAsync(ProjectEntry entry)
    {
        var isCurrent = string.Equals(_context.WorkDir, entry.Path, StringComparison.OrdinalIgnoreCase);
        if (isCurrent)
        {
            var dialog = new ContentDialog
            {
                XamlRoot = XamlRoot,
                Title = Strings.Projects_RemoveCurrentTitle,
                Content = string.Format(Strings.Projects_RemoveCurrentBody, entry.Name),
                PrimaryButtonText = Strings.Projects_RemoveConfirm,
                CloseButtonText = Strings.Common_Cancel,
                DefaultButton = ContentDialogButton.Close,
            };
            if (await dialog.ShowAsync() != ContentDialogResult.Primary)
            {
                return;
            }
        }

        if (string.Equals(_highlighted, entry.Path, StringComparison.OrdinalIgnoreCase))
        {
            _highlighted = null;
        }

        _settings.Update(s => s.Projects.RemoveAll(p => string.Equals(p.Path, entry.Path, StringComparison.OrdinalIgnoreCase)));
        _settings.Save();

        if (isCurrent)
        {
            // Normalize 已把 CurrentProjectPath 清空；这里同步运行时上下文，各页回空态
            _context.Set(null);
        }
        Rebind();
    }

    private void OpenInExplorer(ProjectEntry entry)
    {
        try
        {
            var psi = new System.Diagnostics.ProcessStartInfo(entry.Path) { UseShellExecute = true };
            System.Diagnostics.Process.Start(psi);
        }
        catch (Exception ex)
        {
            ShowTransient(string.Format(Strings.Projects_ExplorerFailed, ex.Message));
        }
    }

    private void ShowTransient(string message)
    {
        _transient = message;
        Rebind();
        _transientTimer.Stop();
        _transientTimer.Start();
    }

    // ---- 绑定 ----

    /// <summary>语言热切换：空态/按钮文案重取值（docs/i18n.md §四；由 MainWindow 驱动）。</summary>
    internal void OnLanguageChanged()
    {
        _addBtn.Content = Strings.Projects_AddProject;
        AutomationProperties.SetName(_addBtn, Strings.Projects_AddProjectAutomation);
        _emptyAddBtn.Content = Strings.Projects_AddProject;
        AutomationProperties.SetName(_emptyAddBtn, Strings.Projects_AddProjectAutomation);
        _emptyTitle.Text = Strings.Projects_EmptyTitle;
        _emptySub.Text = Strings.Projects_EmptyHint;
        AutomationProperties.SetName(_emptyState, Strings.Projects_EmptyAutomation);
        Rebind();
    }

    private void Rebind()
    {
        var projects = _settings.Current.Projects;
        _title.Text = string.Format(Strings.Projects_TitleFormat, projects.Count);

        _repeater.ItemsSource = projects.ToList();
        _listScroll.Visibility = projects.Count == 0 ? Visibility.Collapsed : Visibility.Visible;
        _emptyState.Visibility = projects.Count == 0 ? Visibility.Visible : Visibility.Collapsed;

        if (_error is not null)
        {
            _banner.Text = string.Format(Strings.Common_ErrorPrefix, _error);
            _banner.Visibility = Visibility.Visible;
        }
        else
        {
            _banner.Text = string.Empty;
            _banner.Visibility = Visibility.Collapsed;
        }

        if (_transient is not null)
        {
            _status.Text = _transient;
        }
        else
        {
            var currentName = _context.WorkDir is null
                ? null
                : projects.FirstOrDefault(p => string.Equals(p.Path, _context.WorkDir, StringComparison.OrdinalIgnoreCase))?.Name
                    ?? System.IO.Path.GetFileName(_context.WorkDir.TrimEnd('/', '\\'));
            _status.Text = currentName is null
                ? string.Format(projects.Count == 1 ? Strings.Projects_StatusNoCurrentOne : Strings.Projects_StatusNoCurrentMany, projects.Count)
                : string.Format(projects.Count == 1 ? Strings.Projects_StatusCurrentOne : Strings.Projects_StatusCurrentMany, projects.Count, currentName);
        }
    }

    private sealed class ProjectRowFactory(ProjectsPage page) : IElementFactory
    {
        public UIElement GetElement(ElementFactoryGetArgs args) => page.BuildRow((ProjectEntry)args.Data);
        public void RecycleElement(ElementFactoryRecycleArgs args) { }
    }
}
