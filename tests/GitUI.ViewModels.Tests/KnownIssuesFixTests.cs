using GitUI.Core.Models;
using GitUI.Core.Services;
using GitUI.Git;
using Xunit;
using GitUI.Core.Resources;

namespace GitUI.ViewModels.Tests;

/// <summary>known-issues 修复验证：1.1 部分暂存标记、1.7 错误详情、1.8 transient 消退、1.2 分支列表联动。</summary>
public sealed class KnownIssuesFixTests : IDisposable
{
    private readonly GitFixtureBuilder _builder;

    public KnownIssuesFixTests()
    {
        var dir = Path.Combine(Path.GetTempPath(), "gitui-kifix-" + Guid.NewGuid().ToString("N"));
        _builder = GitFixtureBuilder.Init(dir, "main");
    }

    public void Dispose() => _builder.Dispose();

    // ---- 1.1 部分暂存标记在提交后清除 ----

    [Fact]
    public async Task PartialStagedFlag_ClearedAfterCommit_NextWholeFileCommitIncludesLeftover()
    {
        var content = string.Concat(Enumerable.Range(1, 10).Select(i => $"l{i}\n"));
        _builder.Commit("base", ("f.txt", content));

        var modified = content.Replace("l2\n", "L2\n").Replace("l10\n", "L10\n");
        _builder.Write("f.txt", modified);

        var vm = new ChangesViewModel(new GitUI.Git.LibGit2RepositoryService());
        await vm.OpenRepositoryAsync(_builder.WorkDir);
        await vm.SelectAsync(vm.Changes[0]);

        // 只暂存一个 hunk 后提交
        await vm.StageHunksAsync(new[] { 1 });
        var first = await vm.CommitAsync("first: single hunk", push: false);
        Assert.NotNull(first);
        Assert.DoesNotContain("L2", _builder.ShowFile("HEAD", "f.txt"));

        // 剩余的 L2 修改回到 Changes 层；勾选整文件提交必须包含它（修复前会被标记吞掉）
        await vm.RefreshAsync();
        var entry = Assert.Single(vm.Changes);
        Assert.Equal("f.txt", entry.Path);
        vm.SetChecked(entry, true);
        var second = await vm.CommitAsync("second: leftover", push: false);
        Assert.NotNull(second);
        Assert.Contains("L2", _builder.ShowFile("HEAD", "f.txt"));
        await vm.RefreshAsync();
        Assert.Equal(Strings.Changes_CleanTree, vm.StatusText);
    }

    [Fact]
    public async Task PartialStagedFlag_ClearedOnRepoReopen()
    {
        _builder.Commit("base", ("f.txt", "a\nb\nc\n"));
        _builder.Write("f.txt", "a\nB\nc\n");
        var vm = new ChangesViewModel(new GitUI.Git.LibGit2RepositoryService());
        await vm.OpenRepositoryAsync(_builder.WorkDir);
        await vm.SelectAsync(vm.Changes[0]);
        await vm.StageHunksAsync(new[] { 0 });

        // 重开仓库（不同 VM 实例等价于重开）：不允许残留标记影响后续提交
        var vm2 = new ChangesViewModel(new GitUI.Git.LibGit2RepositoryService());
        await vm2.OpenRepositoryAsync(_builder.WorkDir);
        Assert.Single(vm2.Staged); // 暂存的 hunk 在 index
        await vm2.CommitAsync("commit staged", push: false);
        Assert.NotNull(vm2.LastOutcome);
    }

    // ---- 1.7 错误详情 ----

    [Fact]
    public async Task ErrorDetail_CapturedForGitOperationException()
    {
        _builder.Commit("base", ("a.txt", "1\n"));
        _builder.Branch("side", _builder.Sha("HEAD"));
        _builder.Checkout("side");
        _builder.Commit("side-1", ("b.txt", "s\n")); // side 有独有提交 → 未合并
        _builder.Checkout("main");
        _builder.Commit("main-2", ("a.txt", "2\n"));

        var vm = new BranchesViewModel(new GitUI.Git.LibGit2RepositoryService());
        await vm.OpenRepositoryAsync(_builder.WorkDir);
        await vm.DeleteAsync("side", force: false); // -d 拒绝未合并分支

        Assert.NotNull(vm.Error);
        Assert.NotNull(vm.ErrorDetail);
        Assert.Contains("side", vm.ErrorDetail, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ErrorDetail_ClearedWithNextSuccess()
    {
        _builder.Commit("base", ("a.txt", "1\n"));
        _builder.Branch("side", _builder.Sha("HEAD"));
        _builder.Checkout("side");
        _builder.Commit("side-1", ("b.txt", "s\n"));
        _builder.Checkout("main");
        _builder.Commit("main-2", ("a.txt", "2\n"));

        var vm = new BranchesViewModel(new GitUI.Git.LibGit2RepositoryService());
        await vm.OpenRepositoryAsync(_builder.WorkDir);
        await vm.DeleteAsync("side", force: false);
        Assert.NotNull(vm.ErrorDetail);

        await vm.DeleteAsync("side", force: true); // 成功
        Assert.Null(vm.Error);
        Assert.Null(vm.ErrorDetail);
    }

    // ---- 1.8 transient 消退 ----

    [Fact]
    public async Task ClearTransient_RemovesSuccessMessage()
    {
        _builder.Commit("base", ("a.txt", "1\n"));
        _builder.Branch("side", _builder.Sha("HEAD"));

        var vm = new BranchesViewModel(new GitUI.Git.LibGit2RepositoryService());
        await vm.OpenRepositoryAsync(_builder.WorkDir);
        await vm.CheckoutAsync("side");
        Assert.NotNull(vm.TransientMessage);
        Assert.StartsWith(string.Format(Strings.Branches_CheckedOut, "side"), vm.StatusText);

        vm.ClearTransient();
        Assert.Null(vm.TransientMessage);
        Assert.Equal(string.Format(Strings.Branches_TotalCountMany, 2), vm.StatusText);
    }

    // ---- 1.2 分支列表联动 ----

    [Fact]
    public async Task BranchListChanged_FiresOnCreateDeleteRename()
    {
        _builder.Commit("base", ("a.txt", "1\n"));
        var vm = new BranchesViewModel(new GitUI.Git.LibGit2RepositoryService());
        await vm.OpenRepositoryAsync(_builder.WorkDir);

        var fired = 0;
        vm.BranchListChanged += () => fired++;

        await vm.CreateAsync("b1", null);
        await vm.RenameAsync("b1", "b2");
        await vm.DeleteAsync("b2", force: false);
        Assert.Equal(3, fired);

        // 检出不改变分支集合
        await vm.CheckoutAsync("main");
        Assert.Equal(3, fired);
    }

    [Fact]
    public async Task RefreshBranches_LogSeesBranchesCreatedInBranchesPage()
    {
        _builder.Commit("base", ("a.txt", "1\n"));
        var log = new LogViewModel(new GitUI.Git.LibGit2RepositoryService());
        var branches = new BranchesViewModel(new GitUI.Git.LibGit2RepositoryService());
        await log.OpenRepositoryAsync(_builder.WorkDir);
        await branches.OpenRepositoryAsync(_builder.WorkDir);

        await branches.CreateAsync("from-branches-page", null);

        // Log 页经 RepositoryContext.BranchesChanged → RefreshBranchesAsync（页面级）；
        // 此处直接验证 VM 层刷新语义
        Assert.DoesNotContain(log.Branches, b => b.Name == "from-branches-page");
        await log.RefreshBranchesAsync();
        Assert.Contains(log.Branches, b => b.Name == "from-branches-page");
    }
}
