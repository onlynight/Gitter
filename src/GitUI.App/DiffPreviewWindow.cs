using GitUI.Controls;
using GitUI.Core.Models;
using GitUI.Core.Services;
using GitUI.Core.Settings;
using GitUI.Git;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace GitUI.App;

/// <summary>
/// S3 手动验证工具（design.md §8-S3「手动验证清单」）：
/// 选择真实仓库 → 列出提交 → 选提交 → 列出变更文件 → 用 DiffCanvas 渲染该文件 diff。
/// 仅用于渲染对齐的人眼检查，不属于任何页签；Log 页的正式接线在 S4。
/// </summary>
public sealed class DiffPreviewWindow : Window
{
    private readonly IRepositoryService _repo = new LibGit2RepositoryService();
    private readonly TextBox _pathBox;
    private readonly ListView _commitList;
    private readonly ListView _fileList;
    private readonly DiffCanvas _canvas;
    private readonly TextBlock _status;
    private readonly Button _sideBySideBtn;
    private readonly Button _inlineBtn;

    private string _workDir = string.Empty;
    private IReadOnlyList<CommitNode> _commits = Array.Empty<CommitNode>();
    private IReadOnlyList<DiffResult> _files = Array.Empty<DiffResult>();

    public DiffPreviewWindow(ISettingsStore settings)
    {
        Title = "Diff 渲染预览（S3 验证）";

        _canvas = new DiffCanvas { Mode = settings.Current.DiffMode };
        _pathBox = new TextBox
        {
            PlaceholderText = @"D:\path\to\repo",
            MinWidth = 420,
        };
        AutomationProperties.SetName(_pathBox, "仓库路径");

        var openBtn = new Button { Content = "打开仓库" };
        AutomationProperties.SetName(openBtn, "打开仓库");
        openBtn.Click += Open_Click;

        _sideBySideBtn = new Button { Content = "并排" };
        _inlineBtn = new Button { Content = "内联" };
        _sideBySideBtn.Click += (_, _) => SetMode(DiffViewMode.SideBySide);
        _inlineBtn.Click += (_, _) => SetMode(DiffViewMode.Inline);
        AutomationProperties.SetName(_sideBySideBtn, "并排模式");
        AutomationProperties.SetName(_inlineBtn, "内联模式");

        _status = new TextBlock
        {
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(12, 0, 0, 0),
            Opacity = 0.75,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };

        var toolbar = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            Margin = new Thickness(12, 8, 12, 8),
        };
        toolbar.Children.Add(new TextBlock { Text = "仓库:", VerticalAlignment = VerticalAlignment.Center });
        toolbar.Children.Add(_pathBox);
        toolbar.Children.Add(openBtn);
        toolbar.Children.Add(_sideBySideBtn);
        toolbar.Children.Add(_inlineBtn);
        toolbar.Children.Add(_status);

        _commitList = new ListView
        {
            Height = 150,
            Margin = new Thickness(12, 0, 12, 0),
            SelectionMode = ListViewSelectionMode.Single,
        };
        AutomationProperties.SetName(_commitList, "提交列表");
        _commitList.SelectionChanged += Commit_Selected;

        _fileList = new ListView
        {
            Height = 120,
            Margin = new Thickness(12, 8, 12, 8),
            SelectionMode = ListViewSelectionMode.Single,
        };
        AutomationProperties.SetName(_fileList, "文件列表");
        _fileList.SelectionChanged += File_Selected;

        var root = new Grid();
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        Grid.SetRow(toolbar, 0);
        root.Children.Add(toolbar);
        Grid.SetRow(_commitList, 1);
        root.Children.Add(_commitList);
        Grid.SetRow(_fileList, 2);
        root.Children.Add(_fileList);
        Grid.SetRow(_canvas, 3);
        root.Children.Add(_canvas);

        Content = root;

        var appWindow = AppWindow;
        appWindow?.Resize(new Windows.Graphics.SizeInt32(1200, 800));

        SetMode(settings.Current.DiffMode);
    }

    private void SetMode(DiffViewMode mode)
    {
        _canvas.Mode = mode;
        var selected = new Windows.UI.Text.FontWeight(600);
        var normal = new Windows.UI.Text.FontWeight(400);
        _sideBySideBtn.FontWeight = mode == DiffViewMode.SideBySide ? selected : normal;
        _inlineBtn.FontWeight = mode == DiffViewMode.Inline ? selected : normal;
    }

    private void Open_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            _workDir = _repo.Open(_pathBox.Text.Trim());
            var page = _repo.GetLog(_workDir, new LogFilter { Limit = 100 });
            _commits = page.Items;

            _commitList.Items.Clear();
            _fileList.Items.Clear();
            _files = Array.Empty<DiffResult>();
            _canvas.Clear("选择一个提交");
            foreach (var c in _commits)
            {
                AddListItem(_commitList, $"{c.ShortSha}  {c.Subject}  ({c.Author} {c.AuthorDate.LocalDateTime:yyyy-MM-dd})", c.Sha);
            }

            _status.Text = $"{_workDir} — {page.TotalCount} 个提交（显示最近 {_commits.Count} 个）";
        }
        catch (Exception ex)
        {
            _status.Text = "打开失败: " + ex.Message;
        }
    }

    private void Commit_Selected(object sender, SelectionChangedEventArgs e)
    {
        var idx = _commitList.SelectedIndex;
        if (idx < 0 || idx >= _commits.Count) return;

        try
        {
            _files = _repo.GetCommitDiff(_workDir, _commits[idx].Sha);
            _fileList.Items.Clear();
            _canvas.Clear("选择一个文件");
            foreach (var f in _files)
            {
                var label = f.IsBinary
                    ? $"B  {f.Path}  (二进制)"
                    : $"{f.StatusCode}  {f.Path}  +{f.AddedLines} −{f.DeletedLines}";
                AddListItem(_fileList, label, f.Path);
            }

            _status.Text = $"{_commits[idx].ShortSha} — {_files.Count} 个文件";
        }
        catch (Exception ex)
        {
            _status.Text = "读取提交失败: " + ex.Message;
        }
    }

    private void File_Selected(object sender, SelectionChangedEventArgs e)
    {
        var idx = _fileList.SelectedIndex;
        if (idx < 0 || idx >= _files.Count) return;

        var file = _files[idx];
        if (file.IsBinary)
        {
            _canvas.Clear("二进制文件已修改，无法比较");
        }
        else if (file.Hunks.Count == 0)
        {
            _canvas.Clear("无差异");
        }
        else
        {
            _canvas.Load(file.Hunks);
        }
    }

    private static void AddListItem(ListView list, string label, string tag)
    {
        var item = new ListViewItem { Content = label, Tag = tag, Padding = new Thickness(8, 2, 8, 2) };
        AutomationProperties.SetName(item, label);
        list.Items.Add(item);
    }
}
