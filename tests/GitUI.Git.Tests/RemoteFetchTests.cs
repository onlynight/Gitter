using GitUI.Core.Services;
using Xunit;

namespace GitUI.Git.Tests;

/// <summary>
/// 后台 fetch 与远程列表（ai-native-redesign.md §7.1 / P0-3）。
/// </summary>
public sealed class RemoteFetchTests : IDisposable
{
    private readonly GitFixtureBuilder _builder;

    public RemoteFetchTests()
    {
        var dir = Path.Combine(Path.GetTempPath(), "gitui-fetch-test-" + Guid.NewGuid().ToString("N"));
        _builder = GitFixtureBuilder.Init(dir, "main");
    }

    public void Dispose() => _builder.Dispose();

    [Fact]
    public void GetRemotes_EmptyRepo_ReturnsEmpty()
    {
        var repo = new LibGit2RepositoryService();
        Assert.Empty(repo.GetRemotes(_builder.WorkDir));
    }

    [Fact]
    public void GetRemotes_ReturnsConfiguredNames()
    {
        var bare = Path.Combine(Path.GetTempPath(), "gitui-fetch-bare-" + Guid.NewGuid().ToString("N") + ".git");
        try
        {
            GitFixtureBuilder.InitBare(bare);
            _builder.AddRemote("origin", bare);
            _builder.RunGit("remote", "add", "upstream", bare);

            var repo = new LibGit2RepositoryService();
            var remotes = repo.GetRemotes(_builder.WorkDir);

            Assert.Equal(new[] { "origin", "upstream" }, remotes);
        }
        finally
        {
            GitFixtureBuilder.DeleteDirectory(bare);
        }
    }

    [Fact]
    public void Fetch_NoRemote_IsSilentNoOp()
    {
        var repo = new LibGit2RepositoryService();
        repo.Fetch(_builder.WorkDir, null); // 不抛即通过
    }

    [Fact]
    public void Fetch_LocalBareRemote_SucceedsAndBringsRefs()
    {
        var bare = Path.Combine(Path.GetTempPath(), "gitui-fetch-bare-" + Guid.NewGuid().ToString("N") + ".git");
        try
        {
            GitFixtureBuilder.InitBare(bare);
            _builder.AddRemote("origin", bare);
            var sha = _builder.Commit("base", ("f.txt", "1\n"));
            _builder.RunGit("push", "-q", "origin", "main");
            _builder.RunGit("update-ref", "-d", "refs/remotes/origin/main"); // 模拟陈旧远程视图

            var repo = new LibGit2RepositoryService();
            repo.Fetch(_builder.WorkDir, "origin");

            Assert.Equal(sha, _builder.Sha("refs/remotes/origin/main"));
        }
        finally
        {
            GitFixtureBuilder.DeleteDirectory(bare);
        }
    }

    [Fact]
    public void Fetch_UnreachableRemote_ThrowsGitOperationException()
    {
        _builder.AddRemote("origin", "https://invalid.invalid/repo.git");
        var repo = new LibGit2RepositoryService();
        Assert.ThrowsAny<GitOperationException>(() => repo.Fetch(_builder.WorkDir, "origin"));
    }
}
