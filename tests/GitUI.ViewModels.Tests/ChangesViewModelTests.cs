using GitUI.Core.Models;
using GitUI.Core.Services;
using GitUI.Git;
using Xunit;

namespace GitUI.ViewModels.Tests;

/// <summary>
/// design.md §8-S5 集成测试：勾选提交、hunk 暂存、幂等、分层与勾选语义。
/// </summary>
public sealed class ChangesViewModelTests : IDisposable
{
    private readonly GitFixtureBuilder _builder;
    private readonly ChangesViewModel _vm;

    public ChangesViewModelTests()
    {
        var dir = Path.Combine(Path.GetTempPath(), "gitui-changes-test-" + Guid.NewGuid().ToString("N"));
        _builder = GitFixtureBuilder.Init(dir, "main");
        _vm = new ChangesViewModel(new LibGit2RepositoryService());
    }

    public void Dispose() => _builder.Dispose();

    private async Task OpenAsync()
    {
        await _vm.OpenRepositoryAsync(_builder.WorkDir);
        Assert.True(_vm.IsRepoOpen);
    }

    private async Task<CommitOutcome?> CommitAsync(string message, bool push = false)
        => await _vm.CommitAsync(message, push);

    [Fact]
    public async Task Open_ShowsThreeLayers_WithStats()
    {
        _builder.Commit("base", ("a.txt", "1\n"));
        _builder.Write("a.txt", "modified\n");       // Changes
        _builder.Write("b.txt", "staged content\n");
        _builder.Stage("b.txt");   // 新文件已 add → Staged
        _builder.Write("c.txt", "new\n");            // Unversioned
        await OpenAsync();

        Assert.Single(_vm.Changes);
        Assert.Single(_vm.Staged);
        Assert.Single(_vm.Unversioned);
        Assert.Empty(_vm.Conflicts);

        // numstat 行数统计
        Assert.Equal(1, _vm.Changes[0].AddedLines);
        Assert.Equal(1, _vm.Changes[0].DeletedLines);

        Assert.StartsWith("1 项变更 · 1 项已暂存 · 1 项未跟踪", _vm.StatusText);
    }

    [Fact]
    public async Task CheckDefaults_ChangesStagedOn_UnversionedOff()
    {
        _builder.Commit("base", ("a.txt", "1\n"));
        _builder.Write("a.txt", "m\n");
        _builder.Write("c.txt", "new\n");
        await OpenAsync();

        Assert.True(_vm.IsChecked(_vm.Changes[0]));
        Assert.False(_vm.IsChecked(_vm.Unversioned[0]));

        // 默认勾选数：Changes 1 + Staged 0 = 1
        Assert.Equal(1, _vm.CheckedCount);
    }

    [Fact]
    public async Task Commit_ChecksTwoFiles_IncludesThemInHead()
    {
        _builder.Commit("base", ("a.txt", "1\n"), ("b.txt", "2\n"));
        var baseSha = _builder.Sha("HEAD");
        _builder.Write("a.txt", "1-modified\n");   // 勾选
        _builder.Write("b.txt", "2-modified\n");   // 不勾选
        _builder.Write("c.txt", "new\n");          // 勾选（untracked）
        await OpenAsync();

        _vm.SetChecked(_vm.Changes[0], true);                                   // a.txt
        _vm.SetChecked(_vm.Changes.Single(e => e.Path == "b.txt"), false);      // b.txt
        _vm.SetChecked(_vm.Unversioned[0], true);                               // c.txt

        var outcome = await CommitAsync("test: commit two checked files");
        Assert.NotNull(outcome);
        Assert.Null(outcome!.PushFailure);

        // HEAD 前进一格
        Assert.Equal(baseSha, _builder.Sha("HEAD~1"));
        // a.txt 修改进入 HEAD（git show 输出经 TrimEnd，无尾换行）
        Assert.Equal("1-modified", _builder.ShowFile("HEAD", "a.txt"));
        // c.txt 新增进入 HEAD
        Assert.Equal("new", _builder.ShowFile("HEAD", "c.txt"));
        // b.txt 修改未进入 HEAD（仍是原内容）
        Assert.Equal("2", _builder.ShowFile("HEAD", "b.txt"));

        // 提交成功标记（刷新会清除 transient，先断言）
        Assert.Contains("已提交", _vm.StatusText);
        Assert.NotNull(_vm.LastOutcome);

        // 提交后工作区仍保留 b.txt 的未提交修改
        await _vm.RefreshAsync();
        Assert.Single(_vm.Changes);
        Assert.Equal("b.txt", _vm.Changes[0].Path);
    }

    [Fact]
    public async Task Commit_UncheckedStagedFile_ExcludedAndUnstaged()
    {
        _builder.Commit("base", ("a.txt", "1\n"));
        _builder.Write("a.txt", "v2\n");
        _builder.Stage("a.txt");   // staged
        _builder.Write("a.txt", "v3\n"); // workdir 又改
        await OpenAsync();

        // 取消勾选 staged → 提交时撤销暂存；唯一勾选项被取消后无可提交内容，
        // 服务层拒绝（幂等保护），outcome 为 null 且 HEAD 不动
        _vm.SetChecked(_vm.Staged[0], false);
        var outcome = await CommitAsync("test: nothing staged after uncheck");
        Assert.Null(outcome);
        Assert.Equal(1, _builder.Count("HEAD"));
        Assert.Equal("1", _builder.ShowFile("HEAD", "a.txt"));

        // 撤销暂存后 a.txt 的修改回到 Changes 层
        await _vm.RefreshAsync();
        var entry = _vm.Changes.Concat(_vm.Staged).FirstOrDefault(e => e.Path == "a.txt");
        Assert.NotNull(entry);
        Assert.Equal(StatusCategory.Changes, entry!.Category);
    }

    [Fact]
    public async Task Commit_EmptyMessage_Rejected()
    {
        _builder.Commit("base", ("a.txt", "1\n"));
        _builder.Write("a.txt", "2\n");
        await OpenAsync();
        var outcome = await CommitAsync("   ");
        Assert.Null(outcome);
        Assert.NotNull(_vm.Error);
    }

    [Fact]
    public async Task Commit_Idempotent_DoubleInvoke_SingleCommit()
    {
        _builder.Commit("base", ("a.txt", "1\n"));
        var before = _builder.Count("HEAD");
        _builder.Write("a.txt", "2\n");
        await OpenAsync();

        // 同一时刻重复点击（in-flight 守卫）：第二次调用被拒
        var first = Task.Run(() => _vm.CommitAsync("test: only once", push: false));
        var second = Task.Run(() => _vm.CommitAsync("test: only once", push: false));
        await Task.WhenAll(first, second);
        // 第二次要么被 in-flight 守卫拒绝（null），要么提交后无事可提交失败——历史只前进一格
        Assert.Equal(before + 1, _builder.Count("HEAD"));
    }

    [Fact]
    public async Task Commit_SecondClickAfterSuccess_NoDuplicate()
    {
        _builder.Commit("base", ("a.txt", "1\n"));
        var before = _builder.Count("HEAD");
        _builder.Write("a.txt", "2\n");
        await OpenAsync();

        var first = await CommitAsync("test: first", push: false);
        Assert.NotNull(first);
        var second = await CommitAsync("test: second", push: false);
        Assert.Null(second); // 没有可提交内容
        Assert.Equal(before + 1, _builder.Count("HEAD"));
        Assert.NotNull(_vm.Error);
    }

    [Fact]
    public async Task Commit_WithCheckedConflict_Blocked()
    {
        _builder.Commit("base", ("a.txt", "v1\n"));
        _builder.Branch("side", _builder.Sha("HEAD"));
        _builder.Checkout("side");
        _builder.Commit("side change", ("a.txt", "side\n"));
        _builder.Checkout("main");
        _builder.Commit("main change", ("a.txt", "main\n"));

        // 制造冲突状态（merge 失败即留下未合并条目）
        var svc = new LibGit2RepositoryService();
        await Assert.ThrowsAsync<GitOperationException>(() =>
            Task.Run(() => svc.MergeBranch(_builder.WorkDir, "side", noFastForward: false, message: "m")));

        await OpenAsync();
        Assert.Single(_vm.Conflicts);

        _vm.SetChecked(_vm.Conflicts[0], true);
        var outcome = await CommitAsync("test: blocked");
        Assert.Null(outcome);
        Assert.Contains("冲突", _vm.Error);
    }

    [Fact]
    public async Task StageFile_MovesBetweenLayers()
    {
        _builder.Commit("base", ("a.txt", "1\n"));
        _builder.Write("a.txt", "2\n");
        await OpenAsync();

        await _vm.StageFileAsync(_vm.Changes[0]);
        Assert.Empty(_vm.Changes);
        Assert.Single(_vm.Staged);

        await _vm.StageFileAsync(_vm.Staged[0]); // 撤销暂存
        Assert.Single(_vm.Changes);
        Assert.Empty(_vm.Staged);
    }

    [Fact]
    public async Task Select_LoadsHunksAndChunks_WithMatchingCounts()
    {
        _builder.Commit("base", ("a.txt", "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n"));
        _builder.Write("a.txt", "l1\nL2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nL10\n");
        await OpenAsync();

        await _vm.SelectAsync(_vm.Changes[0]);
        var view = _vm.SelectedDiff;
        Assert.NotNull(view);
        Assert.Equal(2, view!.Hunks.Count);
        Assert.Equal(2, view.PatchChunks.Count);
        Assert.True(view.CanStageHunks);
        Assert.False(view.IsStagedView);
    }

    [Fact]
    public async Task PrefixSuggestions_ByFilePaths()
    {
        _builder.Commit("base", ("docs/readme.md", "r\n"));
        _builder.Write("docs/readme.md", "r2\n");
        await OpenAsync();

        var suggestions = _vm.PrefixSuggestions();
        Assert.Equal(CommitPrefixSuggester.Docs, suggestions[0]);
        Assert.Contains(CommitPrefixSuggester.Feat, suggestions);
    }

    [Fact]
    public async Task RecentMessages_ReturnsSubjects()
    {
        _builder.Commit("feat: alpha", ("a.txt", "1\n"));
        _builder.Commit("fix: beta", ("a.txt", "2\n"));
        await OpenAsync();

        var messages = _vm.RecentMessages(20);
        Assert.Contains("feat: alpha", messages);
        Assert.Contains("fix: beta", messages);
    }
}
