using GitUI.Git;
using Xunit;

namespace GitUI.Git.Tests;

public sealed class GitFixtureBuilderTests : IDisposable
{
    private readonly TestRepo _repo = new();
    public void Dispose() => _repo.Dispose();

    [Fact]
    public void Init_HeadUnborn()
    {
        Assert.True(_repo.Service.IsHeadUnborn(_repo.WorkDir));
        Assert.Null(_repo.Service.HeadSha(_repo.WorkDir));
    }

    [Fact]
    public void Init_DefaultBranchIsMain()
    {
        var sha = _repo.Builder.Commit("init", ("a.txt", "x\n"));
        Assert.Equal("main", _repo.Builder.BranchNames().Single());
        Assert.Equal(40, sha.Length);
        Assert.False(_repo.Service.IsHeadUnborn(_repo.WorkDir));
        Assert.Equal(sha, _repo.Service.HeadSha(_repo.WorkDir));
    }

    [Fact]
    public void Branch_CountsAreAccurate()
    {
        var baseSha = _repo.Builder.Commit("base", ("f.txt", "1\n"));
        _repo.Builder.Branch("feature", baseSha);
        Assert.Contains("main", _repo.Builder.BranchNames());
        Assert.Contains("feature", _repo.Builder.BranchNames());
        Assert.Equal(baseSha, _repo.Builder.Sha("feature"));
    }

    [Fact]
    public void Merge_CreatesMergeCommit_WithTwoParents()
    {
        var baseSha = _repo.Builder.Commit("base", ("f.txt", "1\n"));
        _repo.Builder.Branch("feature", baseSha);
        _repo.Builder.Checkout("main");
        _repo.Builder.Commit("main-c", ("a.txt", "a\n"));
        _repo.Builder.Checkout("feature");
        _repo.Builder.Commit("feat-c", ("b.txt", "b\n"));
        _repo.Builder.Checkout("main");
        var mergeSha = _repo.Builder.Merge("merge", "feature");
        Assert.Equal(2, _repo.Builder.ParentCount(mergeSha));
    }

    [Fact]
    public void CherryPick_DuplicatesCommit_WithNewSha()
    {
        _repo.Builder.Commit("c1", ("a.txt", "a\n"));
        var baseSha = _repo.Builder.Commit("c2", ("b.txt", "b\n"));
        _repo.Builder.Branch("feature", baseSha);
        _repo.Builder.Checkout("feature");
        _repo.Builder.Commit("f1", ("f.txt", "f\n"));
        _repo.Builder.Checkout("main");
        _repo.Builder.Commit("main-c", ("c.txt", "c\n"));
        // 从 feature 独立地挑一个提交过来：它不是 main 的祖先，所以不是空操作
        var newSha = _repo.Builder.CherryPick(_repo.Builder.Sha("feature"));
        Assert.NotEqual(_repo.Builder.Sha("feature"), newSha);
        Assert.Equal(1, _repo.Builder.ParentCount(newSha));
    }

    [Fact]
    public void RevParse_ResolvesRevShorthand()
    {
        var c1 = _repo.Builder.Commit("c1", ("a.txt", "a\n"));
        var c2 = _repo.Builder.Commit("c2", ("b.txt", "b\n"));
        Assert.Equal(c2, _repo.Builder.Sha("HEAD"));
        Assert.Equal(c1, _repo.Builder.Sha("HEAD~1"));
    }

    [Fact]
    public void Topology_ReturnsAllReachableCommits()
    {
        for (int i = 1; i <= 5; i++) _repo.Builder.Commit($"c{i}", ($"f{i}.txt", $"{i}\n"));
        Assert.Equal(5, _repo.Builder.Topology("HEAD").Count);
    }
}
