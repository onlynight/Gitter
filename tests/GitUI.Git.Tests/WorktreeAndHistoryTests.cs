using GitUI.Core.Models;
using GitUI.Core.Services;
using Xunit;

namespace GitUI.Git.Tests;

/// <summary>
/// P3 并行工作台 git 能力（ai-native-redesign.md §六）：worktree 编排、cherry-pick、
/// reset、tag、stash。
/// </summary>
public sealed class WorktreeAndHistoryTests : IDisposable
{
    private readonly GitFixtureBuilder _builder;
    private readonly LibGit2RepositoryService _repo = new();

    public WorktreeAndHistoryTests()
    {
        var dir = Path.Combine(Path.GetTempPath(), "gitui-wt-test-" + Guid.NewGuid().ToString("N"));
        _builder = GitFixtureBuilder.Init(dir, "main");
    }

    public void Dispose() => _builder.Dispose();

    // ---- worktree ----

    [Fact]
    public void GetWorktrees_FreshRepo_ListsMainOnly()
    {
        _builder.Commit("base", ("f.txt", "1\n"));
        var worktrees = _repo.GetWorktrees(_builder.WorkDir);

        var main = Assert.Single(worktrees);
        Assert.True(main.IsMain);
        Assert.False(main.IsBare);
        Assert.Equal("main", main.Branch);
        Assert.Equal(_builder.Sha("HEAD"), main.HeadSha);
    }

    [Fact]
    public void CreateWorktree_AddsEntry_CheckoutWorksAndRemoveCleansUp()
    {
        _builder.Commit("base", ("f.txt", "1\n"));
        var taskPath = Path.Combine(Path.GetTempPath(), "gitui-wt-task-" + Guid.NewGuid().ToString("N"));

        try
        {
            _repo.CreateWorktree(_builder.WorkDir, taskPath, "task/demo", startPoint: null);

            var worktrees = _repo.GetWorktrees(_builder.WorkDir);
            Assert.Equal(2, worktrees.Count);
            var task = worktrees.Single(w => !w.IsMain);
            Assert.Equal("task/demo", task.Branch);
            Assert.False(task.IsDetached);
            Assert.True(Directory.Exists(taskPath));

            // 任务 worktree 内部可正常读状态
            _repo.Open(taskPath);
            Assert.Equal(_builder.Sha("HEAD"), _repo.HeadSha(taskPath));
        }
        finally
        {
            if (Directory.Exists(taskPath))
            {
                try { _repo.RemoveWorktree(_builder.WorkDir, taskPath); }
                catch { GitFixtureBuilder.DeleteDirectory(taskPath); _repo.PruneWorktrees(_builder.WorkDir); }
            }
        }
    }

    [Fact]
    public void CreateWorktree_DuplicateBranch_Throws()
    {
        _builder.Commit("base", ("f.txt", "1\n"));
        var taskPath = Path.Combine(Path.GetTempPath(), "gitui-wt-dup-" + Guid.NewGuid().ToString("N"));
        try
        {
            _builder.Branch("task/demo", _builder.Sha("HEAD"));
            Assert.ThrowsAny<GitOperationException>(() =>
                _repo.CreateWorktree(_builder.WorkDir, taskPath, "task/demo", null));
        }
        finally
        {
            GitFixtureBuilder.DeleteDirectory(taskPath);
            _repo.PruneWorktrees(_builder.WorkDir);
        }
    }

    [Fact]
    public void RemoveWorktree_DirtyWorktree_ThrowsWithoutForce()
    {
        _builder.Commit("base", ("f.txt", "1\n"));
        var taskPath = Path.Combine(Path.GetTempPath(), "gitui-wt-dirty-" + Guid.NewGuid().ToString("N"));
        try
        {
            _repo.CreateWorktree(_builder.WorkDir, taskPath, "task/dirty", null);
            File.WriteAllText(Path.Combine(taskPath, "dirty.txt"), "x");

            Assert.ThrowsAny<GitOperationException>(() => _repo.RemoveWorktree(_builder.WorkDir, taskPath));
            Assert.True(Directory.Exists(taskPath));
        }
        finally
        {
            if (Directory.Exists(taskPath))
            {
                GitFixtureBuilder.DeleteDirectory(taskPath);
                _repo.PruneWorktrees(_builder.WorkDir);
            }
        }
    }

    [Fact]
    public void DefaultBranchName_FallsBackToMain()
    {
        _builder.Commit("base", ("f.txt", "1\n"));
        Assert.Equal("main", _repo.DefaultBranchName(_builder.WorkDir));
    }

    // ---- cherry-pick / reset / tag / stash ----

    [Fact]
    public void CherryPick_BringsCommitToCurrentBranch()
    {
        var baseSha = _builder.Commit("base", ("f.txt", "1\n"));
        _builder.Branch("side", _builder.Sha("HEAD"));
        _builder.Checkout("side");
        var picked = _builder.Commit("picked change", ("g.txt", "side\n"));
        _builder.Checkout("main");

        _repo.CherryPick(_builder.WorkDir, picked);

        Assert.Equal(baseSha, _builder.Sha("HEAD~1"));
        Assert.Equal("side", _builder.ShowFile("HEAD", "g.txt"));
    }

    [Fact]
    public void ResetTo_Soft_KeepsChangesStaged()
    {
        _builder.Commit("base", ("f.txt", "1\n"));
        var baseSha = _builder.Sha("HEAD");
        _builder.Commit("second", ("f.txt", "2\n"));

        _repo.ResetTo(_builder.WorkDir, baseSha, ResetMode.Soft);

        Assert.Equal(baseSha, _builder.Sha("HEAD"));
        // 改动保留在 index（session squash 的形态）：index 里的 f.txt 是新内容
        Assert.Equal("2", _builder.ShowFile("", "f.txt"));
    }

    [Fact]
    public void CreateTag_AndDuplicate_Throws()
    {
        var sha = _builder.Commit("base", ("f.txt", "1\n"));

        _repo.CreateTag(_builder.WorkDir, "v1.0", sha);
        Assert.Contains("v1.0", _builder.RunGit("tag", "-l"));

        Assert.ThrowsAny<GitOperationException>(() => _repo.CreateTag(_builder.WorkDir, "v1.0", null));
    }

    [Fact]
    public void Stash_AndPop_RoundTripsChanges()
    {
        _builder.Commit("base", ("f.txt", "1\n"));
        _builder.Write("f.txt", "2\n");

        Assert.True(_repo.Stash(_builder.WorkDir, "wip"));
        Assert.Equal("1\n", File.ReadAllText(Path.Combine(_builder.WorkDir, "f.txt")));

        _repo.StashPop(_builder.WorkDir);
        Assert.Equal("2\n", File.ReadAllText(Path.Combine(_builder.WorkDir, "f.txt")));
    }

    [Fact]
    public void Stash_CleanTree_ReturnsFalseOrThrowsGracefully()
    {
        _builder.Commit("base", ("f.txt", "1\n"));
        // 干净树：git stash push 退出码 0、无条目 → 返回 false
        var stashed = _repo.Stash(_builder.WorkDir, null);
        Assert.False(stashed);
    }
}
