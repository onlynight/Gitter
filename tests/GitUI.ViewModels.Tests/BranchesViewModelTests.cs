using GitUI.Core.Models;
using GitUI.Core.Services;
using GitUI.Git;
using Xunit;

namespace GitUI.ViewModels.Tests;

/// <summary>
/// design.md §8-S6 集成测试：checkout/delete/rebase 终态断言、
/// 危险操作确认文案的 N 值与实际一致、删除后 reflog 恢复。
/// </summary>
public sealed class BranchesViewModelTests : IDisposable
{
    private readonly GitFixtureBuilder _builder;
    private readonly BranchesViewModel _vm;

    public BranchesViewModelTests()
    {
        var dir = Path.Combine(Path.GetTempPath(), "gitui-branch-test-" + Guid.NewGuid().ToString("N"));
        _builder = GitFixtureBuilder.Init(dir, "main");
        _vm = new BranchesViewModel(new LibGit2RepositoryService());
    }

    public void Dispose() => _builder.Dispose();

    private async Task OpenAsync()
    {
        await _vm.OpenRepositoryAsync(_builder.WorkDir);
        Assert.True(_vm.IsRepoOpen);
    }

    private BranchItemRow Row(string name) =>
        _vm.Rows.OfType<BranchItemRow>().Single(r => r.Name == name);

    /// <summary>标准双分支拓扑：main 2 提交 + side 从 base 分叉再进 1 提交。</summary>
    private void BuildDiverged()
    {
        _builder.Commit("base", ("a.txt", "1\n"));
        _builder.Branch("side", _builder.Sha("HEAD"));
        _builder.Commit("main-2", ("a.txt", "2\n"));
        _builder.Checkout("side");
        _builder.Commit("side-1", ("b.txt", "s\n"));
        _builder.Checkout("main");
    }

    [Fact]
    public async Task Open_GroupsLocalAndRemote_ShowsTipMeta()
    {
        BuildDiverged();
        await OpenAsync();

        var groups = _vm.Rows.OfType<BranchGroupRow>().ToList();
        var g = Assert.Single(groups); // 无远程
        Assert.Equal("本地分支 (2)", g.Title);

        var main = Row("main");
        Assert.True(main.IsHead);
        Assert.Contains("main-2", main.Meta);
        Assert.False(main.IsRemote);

        var side = Row("side");
        Assert.False(side.IsHead);
        Assert.Contains("side-1", side.Meta);
    }

    [Fact]
    public async Task Checkout_MovesHead()
    {
        BuildDiverged();
        await OpenAsync();

        await _vm.CheckoutAsync("side");
        Assert.Equal("s", _builder.ShowFile("HEAD", "b.txt").Trim()); // side tip 的文件内容
        Assert.Equal("side-1", _builder.RunGit("log", "-1", "--format=%s")); // HEAD 移动到 side-1
        var head = Row("side");
        Assert.True(head.IsHead);
        Assert.False(Row("main").IsHead);
        Assert.Contains("已检出 side", _vm.StatusText);
    }

    [Fact]
    public async Task CreateBranch_RefExists()
    {
        _builder.Commit("base", ("a.txt", "1\n"));
        await OpenAsync();

        var baseSha = _builder.Sha("HEAD");
        await _vm.CreateAsync("feature/x", baseSha);
        Assert.Contains("refs/heads/feature/x", _builder.RunGit("for-each-ref", "--format=%(refname)", "refs/heads/"));
        Assert.Contains("已创建 feature/x", _vm.StatusText);
    }

    [Fact]
    public async Task RenameBranch_RefMoved()
    {
        _builder.Commit("base", ("a.txt", "1\n"));
        _builder.Branch("old-name", _builder.Sha("HEAD"));
        await OpenAsync();

        await _vm.RenameAsync("old-name", "new-name");
        var refs = _builder.RunGit("for-each-ref", "--format=%(refname)", "refs/heads/");
        Assert.DoesNotContain("refs/heads/old-name", refs);
        Assert.Contains("refs/heads/new-name", refs);
    }

    [Fact]
    public async Task DeleteBranch_RefGone_AndReflogRecovery()
    {
        BuildDiverged();
        await OpenAsync();

        // 删除前记录 side tip（回滚锚点）与可达提交数
        var sideTip = _builder.Sha("side");
        var sideCount = _builder.Count("side");

        var preview = await _vm.RequestDeletePreview("side");
        Assert.True(preview.ForceRequired);
        // N 值一致性（S6 通过标准）：文案里的 N == 实际影响提交数 == side 独有提交数
        var actualUnique = _builder.RunGit("rev-list", "--count", "main..side");
        Assert.Equal(int.Parse(actualUnique), preview.LostCommits.Count);
        Assert.Contains($"将丢弃 {preview.LostCommits.Count} 个提交", preview.ConfirmationText);
        // 文案列出的是短 SHA（§6.4 设计原文格式）
        Assert.Contains(preview.LostCommits[0].ShortSha, preview.ConfirmationText);
        Assert.Equal("side-1", _builder.RunGit("log", "-1", "--format=%s", preview.LostCommits[0].Sha));

        await _vm.DeleteAsync("side", force: true);
        Assert.DoesNotContain("refs/heads/side", _builder.RunGit("for-each-ref", "--format=%(refname)", "refs/heads/"));
        Assert.Contains("已删除 side", _vm.StatusText);

        // 回滚：从删除前 tip 重建分支，提交重新可达（reflog/GUI 恢复的等价路径）
        _builder.Branch("side-recovered", sideTip);
        Assert.Equal(sideCount, _builder.Count("side-recovered"));
    }

    [Fact]
    public async Task DeleteFullyMergedBranch_ZeroImpact_NoForceNeeded()
    {
        BuildDiverged();
        // feature 指向 main（全可达）→ 删除无影响
        _builder.Branch("feature", _builder.Sha("main"));
        await OpenAsync();

        var preview = await _vm.RequestDeletePreview("feature");
        Assert.Empty(preview.LostCommits);
        Assert.False(preview.ForceRequired);
        Assert.Contains("不会丢弃任何提交", preview.ConfirmationText);

        await _vm.DeleteAsync("feature", force: false);
        Assert.DoesNotContain("refs/heads/feature", _builder.RunGit("for-each-ref", "--format=%(refname)", "refs/heads/"));
    }

    [Fact]
    public async Task MergeBranch_FastForward_Linearizes()
    {
        // main 停在 base，side 快进 1 提交 → merge --ff 线性化
        _builder.Commit("base", ("a.txt", "1\n"));
        _builder.Branch("side", _builder.Sha("HEAD"));
        _builder.Checkout("side");
        _builder.Commit("side-1", ("b.txt", "s\n"));
        _builder.Checkout("main");
        await OpenAsync();

        await _vm.MergeAsync("side", noFastForward: false, message: null);

        // HEAD == side tip，历史线性（无合并提交）
        Assert.Equal(_builder.Sha("side"), _builder.Sha("main"));
        Assert.Equal(0, _builder.ParentCount("main") - 1); // 单父
        Assert.Contains("已合并 side", _vm.StatusText);
    }

    [Fact]
    public async Task MergeBranch_NoFastForward_ProducesMergeCommit()
    {
        BuildDiverged();
        await OpenAsync();

        await _vm.MergeAsync("side", noFastForward: true, message: "merge side");
        Assert.Equal(2, _builder.ParentCount(_builder.Sha("HEAD"))); // 合并提交双父
        Assert.Contains("merge side", _builder.RunGit("log", "-1", "--format=%s"));
    }

    [Fact]
    public async Task Rebase_LinearizesOntoUpstream()
    {
        BuildDiverged();
        _builder.Checkout("side");
        await OpenAsync();

        await _vm.RebaseAsync("main");
        // side 现在线性位于 main 之上：side 可达数 = main 可达数 + 1
        Assert.Equal(_builder.Count("main") + 1, _builder.Count("side"));
        // 线性化：HEAD 单父链上包含 main 的提交，b.txt 保留 side 的内容
        var log = _builder.RunGit("log", "--format=%s");
        Assert.Contains("main-2", log);
        Assert.Contains("side-1", log);
        Assert.Equal(1, _builder.ParentCount(_builder.Sha("HEAD"))); // 单父 = 线性
        Assert.Contains("已变基到 main", _vm.StatusText);
    }

    [Fact]
    public async Task FastForward_RejectedWhenDiverged()
    {
        BuildDiverged();
        await OpenAsync();

        // main 与 side 分叉 → 快进必然失败（影响范围校验）
        await _vm.FastForwardAsync("side");
        Assert.NotNull(_vm.Error);
        Assert.Contains("fast-forward", _vm.Error, StringComparison.OrdinalIgnoreCase); // git 原生拒绝文案
        // HEAD 未被污染：a.txt 仍是 main-2 的内容 "2"
        Assert.Equal("2", _builder.ShowFile("HEAD", "a.txt"));
        Assert.Contains("main-2", _builder.RunGit("log", "-1", "--format=%s"));
    }

    [Fact]
    public async Task Merge_Conflict_SurfacesErrorWithoutStateLoss()
    {
        _builder.Commit("base", ("a.txt", "v1\n"));
        _builder.Branch("side", _builder.Sha("HEAD"));
        _builder.Commit("main change", ("a.txt", "main\n"));
        _builder.Checkout("side");
        _builder.Commit("side change", ("a.txt", "side\n"));
        _builder.Checkout("main");
        await OpenAsync();

        await _vm.MergeAsync("side", noFastForward: false, message: "m");
        Assert.NotNull(_vm.Error);
        // 冲突状态留在工作区（用户可解），HEAD 未动
        Assert.Contains("main change", _builder.RunGit("log", "-1", "--format=%s"));
    }

    [Fact]
    public async Task StatusText_TransientOverCounts()
    {
        _builder.Commit("base", ("a.txt", "1\n"));
        _builder.Branch("b2", _builder.Sha("HEAD"));
        await OpenAsync();
        Assert.Equal("共 2 个分支", _vm.StatusText);

        await _vm.CheckoutAsync("b2");
        Assert.StartsWith("已检出 b2", _vm.StatusText);
    }
}
