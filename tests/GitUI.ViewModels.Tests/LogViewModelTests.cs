using GitUI.Git;
using GitUI.ViewModels;
using Xunit;

namespace GitUI.ViewModels.Tests;

/// <summary>
/// design.md §8-S4 集成测试：在 fixture 仓库上断言过滤结果、分组边界、分页加载数量、折叠状态。
/// 服务层 = 真 <see cref="LibGit2RepositoryService"/>（含 S4 无过滤快路径）。
/// </summary>
public sealed class LogViewModelTests : IDisposable
{
    private readonly GitFixtureBuilder _builder;
    private readonly LibGit2RepositoryService _service;
    private readonly LogViewModel _vm;

    public LogViewModelTests()
    {
        var dir = Path.Combine(Path.GetTempPath(), "gitui-vm-test-" + Guid.NewGuid().ToString("N"));
        _builder = GitFixtureBuilder.Init(dir, "main");
        _service = new LibGit2RepositoryService();
        _vm = new LogViewModel(_service);
    }

    public void Dispose() => _builder.Dispose();

    // CommitOn 的时间经"转 UTC 存储 → libgit2 按本地时区读回"，测试时间戳一律用本地 offset
    // 构造，保证分组的 LocalDateTime.Date 与断言的日界一致（UTC 23:59 在 +8 是次日 07:59）。
    private static DateTimeOffset At(int year, int month, int day, int hour, int minute = 0) =>
        new(year, month, day, hour, minute, 0, TimeZoneInfo.Local.GetUtcOffset(new DateTime(year, month, day)));

    private void Subscribe(Action counter) => _vm.StructureChanged += counter;

    [Fact]
    public async Task OpenRepository_NormalizesWorkDir()
    {
        _builder.Commit("c1", ("a.txt", "1\n"));
        await _vm.OpenRepositoryAsync(_builder.WorkDir);
        Assert.True(_vm.IsRepoOpen);
        Assert.Equal(_builder.WorkDir, _vm.WorkDir);
        Assert.Single(_vm.Groups.SelectMany(g => g.Commits));
        Assert.StartsWith("已加载 1 / 共 1", _vm.StatusText);
    }

    [Fact]
    public async Task OpenRepository_NonRepo_SetsErrorAndStaysClosed()
    {
        var notRepo = Path.Combine(Path.GetTempPath(), "gitui-vm-empty-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(notRepo);
        try
        {
            await _vm.OpenRepositoryAsync(notRepo);
            Assert.False(_vm.IsRepoOpen);
            Assert.NotNull(_vm.Error);
            Assert.Contains("错误:", _vm.StatusText);
        }
        finally { Directory.Delete(notRepo, recursive: true); }
    }

    [Fact]
    public async Task OpenRepository_EmptyRepo_ShowsZero()
    {
        await _vm.OpenRepositoryAsync(_builder.WorkDir);
        Assert.True(_vm.IsRepoOpen);
        Assert.Empty(_vm.Groups);
        Assert.StartsWith("已加载 0 / 共 0", _vm.StatusText);
    }

    [Fact]
    public async Task Pagination_FirstScreen50_LoadNextTo120()
    {
        _builder.BulkCommits(120);
        await _vm.OpenRepositoryAsync(_builder.WorkDir);

        Assert.Equal(50, _vm.Groups.SelectMany(g => g.Commits).Count());
        Assert.True(_vm.HasMore);
        Assert.Contains("已加载 50 / 共 120", _vm.StatusText);

        await _vm.LoadNextPageAsync();
        Assert.Equal(100, _vm.Groups.SelectMany(g => g.Commits).Count());
        Assert.True(_vm.HasMore);

        await _vm.LoadNextPageAsync();
        Assert.Equal(120, _vm.Groups.SelectMany(g => g.Commits).Count());
        Assert.False(_vm.HasMore);
        // 加载完成的页面之间无重叠
        var shas = _vm.Groups.SelectMany(g => g.Commits).Select(c => c.Sha).ToList();
        Assert.Equal(120, shas.Distinct().Count());
    }

    [Fact]
    public async Task Pagination_LoadNextWhenNoMore_IsNoop()
    {
        _builder.Commit("only", ("a.txt", "1\n"));
        await _vm.OpenRepositoryAsync(_builder.WorkDir);
        await _vm.LoadNextPageAsync();
        Assert.Single(_vm.Groups.SelectMany(g => g.Commits));
    }

    [Fact]
    public async Task DayGroups_BoundaryAcrossFixtureDates()
    {
        // 按时间递增提交（与真实历史一致）；时间倒挂的线性链上 git rev-list 只能按链序输出
        _builder.CommitOn("d1", At(2026, 1, 2, 8), ("f.txt", "1\n"));
        _builder.CommitOn("d2", At(2026, 1, 2, 23, 59), ("f.txt", "2\n"));
        _builder.CommitOn("d3", At(2026, 1, 5, 12), ("f.txt", "3\n"));

        await _vm.OpenRepositoryAsync(_builder.WorkDir);

        Assert.Equal(2, _vm.Groups.Count);
        Assert.Equal(new DateTime(2026, 1, 5), _vm.Groups[0].Day);
        Assert.Single(_vm.Groups[0].Commits);
        Assert.Equal(new DateTime(2026, 1, 2), _vm.Groups[1].Day);
        Assert.Equal(2, _vm.Groups[1].Commits.Count);
        // 组内保持时间倒序
        Assert.Equal("d2", _vm.Groups[1].Commits[0].Subject);
    }

    [Fact]
    public async Task Collapse_TogglesRowsButKeepsItems()
    {
        _builder.CommitOn("a", At(2026, 1, 5, 12), ("f.txt", "1\n"));
        _builder.CommitOn("b", At(2026, 1, 5, 13), ("f.txt", "2\n"));
        _builder.CommitOn("c", At(2026, 1, 6, 9), ("f.txt", "3\n"));
        await _vm.OpenRepositoryAsync(_builder.WorkDir);

        var totalRows = _vm.Rows.Count; // 2 组头 + 3 提交
        Assert.Equal(5, totalRows);

        var day5 = _vm.Groups.Single(g => g.Day == new DateTime(2026, 1, 5)).Day;
        _vm.ToggleCollapse(day5);
        Assert.Equal(3, _vm.Rows.Count); // 组头保留，组内 2 行（a、b）隐藏
        Assert.Contains(_vm.Rows, r => r is LogGroupHeaderRow { IsCollapsed: true, CommitCount: 2 });

        _vm.ToggleCollapse(day5);
        Assert.Equal(5, _vm.Rows.Count);
        Assert.All(_vm.Rows.OfType<LogGroupHeaderRow>(), h => Assert.False(h.IsCollapsed));
    }

    [Fact]
    public async Task Collapse_PersistsAcrossNextPage()
    {
        _builder.BulkCommits(3);
        await _vm.OpenRepositoryAsync(_builder.WorkDir);
        var day = _vm.Groups[0].Day;
        _vm.ToggleCollapse(day);
        await _vm.LoadNextPageAsync();
        Assert.Contains(_vm.Rows, r => r is LogGroupHeaderRow { IsCollapsed: true });
    }

    [Fact]
    public async Task Search_AuthorPrefix_FiltersResults()
    {
        // fixture 仓库的所有提交作者均为 "Fixture"
        _builder.CommitOn("a1", At(2026, 1, 5, 12), ("f.txt", "1\n"));
        _builder.CommitOn("a2", At(2026, 1, 5, 13), ("f.txt", "2\n"));
        _builder.CommitOn("a3", At(2026, 1, 6, 10), ("f.txt", "3\n"));
        await _vm.OpenRepositoryAsync(_builder.WorkDir);
        Assert.Equal(3, _vm.TotalCountShown());

        await _vm.SetQueryAsync("author:Fixture");
        Assert.Equal(3, _vm.TotalCountShown());

        // 不存在的作者 → 0 条 + 空态
        await _vm.SetQueryAsync("author:nonexistent-xyz");
        Assert.Equal(0, _vm.TotalCountShown());
        Assert.StartsWith("已加载 0 / 共 0", _vm.StatusText);
    }

    [Fact]
    public async Task Search_FreeWord_FiltersBySubjectSubstring()
    {
        _builder.Commit("feat: add log filter", ("f.txt", "1\n"));
        _builder.Commit("fix: null deref", ("f.txt", "2\n"));
        _builder.Commit("chore: bump deps", ("f.txt", "3\n"));
        await _vm.OpenRepositoryAsync(_builder.WorkDir);

        await _vm.SetQueryAsync("log");
        Assert.Equal(1, _vm.TotalCountShown());

        // 大小写不敏感
        await _vm.SetQueryAsync("LOG");
        Assert.Equal(1, _vm.TotalCountShown());

        // 多词 AND
        await _vm.SetQueryAsync("fix deref");
        Assert.Equal(1, _vm.TotalCountShown());

        await _vm.SetQueryAsync("fix bump");
        Assert.Equal(0, _vm.TotalCountShown());

        // 清空恢复
        await _vm.SetQueryAsync("");
        Assert.Equal(3, _vm.TotalCountShown());
    }

    [Fact]
    public async Task Search_BranchPrefix_RestrictsReachability()
    {
        var baseSha = _builder.Commit("base", ("f.txt", "1\n"));
        _builder.Branch("side", baseSha);
        _builder.Checkout("side");
        _builder.Commit("on-side", ("f.txt", "2\n"));
        _builder.Checkout("main");
        _builder.Commit("on-main", ("f.txt", "3\n"));
        await _vm.OpenRepositoryAsync(_builder.WorkDir);

        // HEAD（main）可达：base + on-main
        Assert.Equal(2, _vm.TotalCountShown());

        await _vm.SetQueryAsync("branch:side");
        Assert.Equal(2, _vm.TotalCountShown()); // base + on-side
        var subjects = _vm.Groups.SelectMany(g => g.Commits).Select(c => c.Subject).ToHashSet();
        Assert.Contains("on-side", subjects);
        Assert.DoesNotContain("on-main", subjects);
    }

    [Fact]
    public async Task Search_BranchComboBoxMerges_WhenQueryHasNoBranch()
    {
        var baseSha = _builder.Commit("base", ("f.txt", "1\n"));
        _builder.Branch("side", baseSha);
        _builder.Checkout("side");
        _builder.Commit("on-side", ("f.txt", "2\n"));
        _builder.Checkout("main");
        _builder.Commit("on-main", ("f.txt", "3\n"));
        await _vm.OpenRepositoryAsync(_builder.WorkDir);

        await _vm.SetBranchAsync("side");
        Assert.Equal(2, _vm.TotalCountShown());

        // 搜索 author 过滤与 UI 分支选择叠加
        await _vm.SetQueryAsync("author:Fixture");
        Assert.Equal(2, _vm.TotalCountShown());
    }

    [Fact]
    public async Task Search_DateRange_Filters()
    {
        _builder.CommitOn("old", At(2024, 3, 1, 10), ("f.txt", "1\n"));
        _builder.CommitOn("mid", At(2024, 6, 1, 10), ("f.txt", "2\n"));
        _builder.CommitOn("new", At(2024, 9, 1, 10), ("f.txt", "3\n"));
        await _vm.OpenRepositoryAsync(_builder.WorkDir);

        await _vm.SetQueryAsync("after:2024-05-01 before:2024-07-01");
        Assert.Equal(1, _vm.TotalCountShown());
        Assert.Equal("mid", _vm.Groups.SelectMany(g => g.Commits).Single().Subject);
    }

    [Fact]
    public async Task Select_LoadsChangedFiles()
    {
        _builder.Commit("init", ("a.txt", "1\n"));
        var second = _builder.Commit("second", ("a.txt", "2\n"), ("b.txt", "x\n"));
        await _vm.OpenRepositoryAsync(_builder.WorkDir);

        var commit = _vm.Groups.SelectMany(g => g.Commits).First(c => c.Sha == second);
        await _vm.SelectAsync(commit);

        Assert.Equal(commit, _vm.Selected);
        Assert.Equal(2, _vm.SelectedFiles.Count);
        Assert.Contains(_vm.SelectedFiles, f => f.Path == "a.txt");
        Assert.Contains(_vm.SelectedFiles, f => f.Path == "b.txt");
    }

    [Fact]
    public async Task Select_RootCommit_EmptyFiles()
    {
        _builder.Commit("root", ("a.txt", "1\n"));
        await _vm.OpenRepositoryAsync(_builder.WorkDir);
        var root = _vm.Groups.SelectMany(g => g.Commits).Single();
        await _vm.SelectAsync(root);
        Assert.Empty(_vm.SelectedFiles);
        Assert.True(root.IsRoot);
    }

    [Fact]
    public async Task StructureChanged_FiresOnLoadAndCollapse()
    {
        _builder.Commit("c1", ("a.txt", "1\n"));
        await _vm.OpenRepositoryAsync(_builder.WorkDir);

        var count = 0;
        Subscribe(() => count++);
        _vm.ToggleCollapse(_vm.Groups[0].Day);
        Assert.True(count >= 1);
    }

    [Fact]
    public async Task Rows_CarryBadgesAndMeta()
    {
        var baseSha = _builder.Commit("base", ("f.txt", "1\n"));
        _builder.Branch("feature/x", baseSha);
        _builder.Commit("child", ("f.txt", "2\n"));
        await _vm.OpenRepositoryAsync(_builder.WorkDir);

        var row = Assert.Single(_vm.Rows.OfType<LogCommitRow>(), r => r.Commit.Subject == "base");
        Assert.Contains(row.Badges, b => b.Text == "feature/x" && !b.IsTag);
        Assert.False(string.IsNullOrWhiteSpace(row.MetaText));
        Assert.Contains("Fixture", row.MetaText);
    }
}

file static class LogViewModelTestExtensions
{
    public static int TotalCountShown(this LogViewModel vm) =>
        int.Parse(vm.StatusText.Split("共 ")[1].Split(' ')[0]);
}
