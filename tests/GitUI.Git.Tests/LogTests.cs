using GitUI.Core.Services;
using GitUI.Core.Models;
using GitUI.Git;
using Xunit;

namespace GitUI.Git.Tests;

public sealed class LogTests : IDisposable
{
    private readonly TestRepo _repo = new();
    private LibGit2RepositoryService Svc => _repo.Service;

    public void Dispose() => _repo.Dispose();

    [Fact]
    public void Open_NormalizesWorkingDir()
    {
        _repo.Builder.Commit("init", ("a.txt", "x\n"));
        var normalized = Svc.Open(_repo.WorkDir);
        Assert.Equal(_repo.WorkDir, normalized);
        Assert.False(normalized.EndsWith(Path.DirectorySeparatorChar));
    }

    [Fact]
    public void Open_NonRepository_Throws()
    {
        var empty = Path.Combine(Path.GetTempPath(), "gitui-not-a-repo-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(empty);
        try { Assert.Throws<RepositoryNotFoundException>(() => Svc.Open(empty)); }
        finally { Directory.Delete(empty, recursive: true); }
    }

    [Fact]
    public void Open_MissingPath_Throws()
    {
        Assert.Throws<RepositoryNotFoundException>(() => Svc.Open(Path.GetTempPath() + @"\nope"));
    }

    [Fact]
    public void GetLog_EmptyRepo_ReturnsEmptyPage()
    {
        var page = Svc.GetLog(_repo.WorkDir, new LogFilter());
        Assert.Empty(page.Items);
        Assert.Equal(0, page.TotalCount);
        Assert.False(page.HasMore);
        Assert.Equal(1, page.PageCount);
    }

    [Fact]
    public void GetLog_ReturnsNewestFirst()
    {
        _repo.Builder.Commit("oldest", ("a.txt", "1\n"));
        _repo.Builder.Commit("middle", ("b.txt", "2\n"));
        _repo.Builder.Commit("newest", ("c.txt", "3\n"));
        var page = Svc.GetLog(_repo.WorkDir, new LogFilter());
        Assert.Equal(3, page.TotalCount);
        Assert.Equal("newest", page.Items[0].Subject);
        Assert.Equal("middle", page.Items[1].Subject);
        Assert.Equal("oldest", page.Items[2].Subject);
    }

    [Fact]
    public void GetLog_PaginatesWithoutOverlap()
    {
        for (int i = 1; i <= 7; i++) _repo.Builder.Commit($"c{i}", ($"f{i}.txt", $"{i}\n"));
        var p1 = Svc.GetLog(_repo.WorkDir, new LogFilter(Limit: 3, Skip: 0));
        var p2 = Svc.GetLog(_repo.WorkDir, new LogFilter(Limit: 3, Skip: 3));
        Assert.Equal(3, p1.Items.Count);
        Assert.True(p1.HasMore);
        Assert.Equal(3, p2.Items.Count);
        Assert.True(p2.HasMore);
        // 页面无重叠
        var p1Shas = new HashSet<string>(p1.Items.Select(c => c.Sha));
        foreach (var c in p2.Items) Assert.DoesNotContain(c.Sha, p1Shas);
        Assert.Equal(7, p1.TotalCount);
    }

    [Fact]
    public void GetLog_LastPage_HasMoreFalse()
    {
        for (int i = 1; i <= 4; i++) _repo.Builder.Commit($"c{i}", ($"f{i}.txt", $"{i}\n"));
        var page = Svc.GetLog(_repo.WorkDir, new LogFilter(Limit: 3, Skip: 3));
        Assert.Single(page.Items);
        Assert.False(page.HasMore);
    }

    [Fact]
    public void GetLog_Unlimited_ReturnsEverything()
    {
        for (int i = 1; i <= 6; i++) _repo.Builder.Commit($"c{i}", ($"f{i}.txt", $"{i}\n"));
        var page = Svc.GetLog(_repo.WorkDir, LogFilter.All);
        Assert.Equal(6, page.Items.Count);
        Assert.False(page.HasMore);
    }

    [Fact]
    public void GetLog_ParentShas_AreCorrect()
    {
        var c1 = _repo.Builder.Commit("c1", ("a.txt", "1\n"));
        var c2 = _repo.Builder.Commit("c2", ("b.txt", "2\n"));
        var page = Svc.GetLog(_repo.WorkDir, LogFilter.All);
        Assert.Equal(2, page.Items.Count);
        Assert.Single(page.Items[0].ParentShas);
        Assert.Equal(c1, page.Items[0].ParentShas[0]);
        Assert.Empty(page.Items[1].ParentShas);
    }

    [Fact]
    public void GetLog_MergeCommit_Recognized()
    {
        var baseSha = _repo.Builder.Commit("base", ("f.txt", "1\n"));
        _repo.Builder.Branch("feature", baseSha);
        _repo.Builder.Checkout("main");
        _repo.Builder.Commit("main-c", ("a.txt", "a\n"));
        _repo.Builder.Checkout("feature");
        _repo.Builder.Commit("feat-c", ("b.txt", "b\n"));
        _repo.Builder.Checkout("main");
        _repo.Builder.Merge("merge", "feature");

        var page = Svc.GetLog(_repo.WorkDir, LogFilter.All);
        var merge = page.Items.First(c => c.IsMerge);
        Assert.Equal(2, merge.ParentShas.Length);
        // 根提交是唯一 0 父的节点；其余非合并提交都是 1 父
        Assert.Single(page.Items.Where(c => c.IsRoot));
        Assert.All(page.Items.Where(c => !c.IsMerge && !c.IsRoot), c => Assert.Single(c.ParentShas));
    }

    [Fact]
    public void GetLog_AuthorFilter_MatchesByName()
    {
        // 该 fixture 里作者统一为 "Fixture"
        _repo.Builder.Commit("c1", ("a.txt", "1\n"));
        _repo.Builder.Commit("c2", ("b.txt", "2\n"));
        var page = Svc.GetLog(_repo.WorkDir, new LogFilter(Author: "Fixture"));
        Assert.Equal(2, page.TotalCount);
        Assert.All(page.Items, c => Assert.Equal("Fixture", c.Author));
    }

    [Fact]
    public void GetLog_AuthorFilter_ExcludesNonMatching()
    {
        _repo.Builder.Commit("c1", ("a.txt", "1\n"));
        var page = Svc.GetLog(_repo.WorkDir, new LogFilter(Author: "Nobody"));
        Assert.Empty(page.Items);
    }

    [Fact]
    public void GetLog_TopicFilter_MatchesSubject()
    {
        _repo.Builder.Commit("feat: one", ("a.txt", "1\n"));
        _repo.Builder.Commit("fix: two", ("b.txt", "2\n"));
        _repo.Builder.Commit("feat: three", ("c.txt", "3\n"));
        var page = Svc.GetLog(_repo.WorkDir, new LogFilter(Topic: "^feat:"));
        Assert.Equal(2, page.TotalCount);
        Assert.All(page.Items, c => Assert.StartsWith("feat:", c.Subject));
    }

    [Fact]
    public void GetLog_TopicFilter_InvalidRegex_MatchesNothing()
    {
        // 非法正则降级为无匹配，绝不抛异常
        _repo.Builder.Commit("hello", ("a.txt", "1\n"));
        var page = Svc.GetLog(_repo.WorkDir, new LogFilter(Topic: "h[e"));
        Assert.Empty(page.Items);
    }

    [Fact]
    public void GetLog_TopicFilter_LiteralSubstringMatches()
    {
        _repo.Builder.Commit("hello world", ("a.txt", "1\n"));
        _repo.Builder.Commit("bye world", ("b.txt", "2\n"));
        var page = Svc.GetLog(_repo.WorkDir, new LogFilter(Topic: "world"));
        Assert.Equal(2, page.TotalCount);
        Assert.All(page.Items, c => Assert.Contains("world", c.Subject));
    }

    [Fact]
    public void GetLog_BranchFilter_LimitsToReachableFromBranch()
    {
        var baseSha = _repo.Builder.Commit("base", ("f.txt", "1\n"));
        _repo.Builder.Branch("feature", baseSha);
        _repo.Builder.Checkout("main");
        _repo.Builder.Commit("main-1", ("a.txt", "a\n"));
        _repo.Builder.Checkout("feature");
        _repo.Builder.Commit("feat-1", ("b.txt", "b\n"));
        _repo.Builder.Checkout("main");
        // main 分支不可达 feat-1
        var page = Svc.GetLog(_repo.WorkDir, new LogFilter(Branch: "main"));
        Assert.All(page.Items, c => Assert.DoesNotContain("feat-1", c.Subject));
        Assert.Contains(page.Items, c => c.Subject == "main-1");
    }

    [Fact]
    public void GetCommit_ExistingReturnsNode()
    {
        var sha = _repo.Builder.Commit("the commit", ("a.txt", "1\n"));
        var node = Svc.GetCommit(_repo.WorkDir, sha);
        Assert.NotNull(node);
        Assert.Equal(sha, node!.Sha);
        Assert.Equal(sha[..7], node.ShortSha);
        Assert.Equal(7, node.ShortSha.Length);
    }

    [Fact]
    public void GetCommit_MissingSha_ReturnsNull()
    {
        _repo.Builder.Commit("c", ("a.txt", "1\n"));
        Assert.Null(Svc.GetCommit(_repo.WorkDir, new string('0', 40)));
    }

    [Fact]
    public void GetLog_NegativeLimits_Normalized()
    {
        _repo.Builder.Commit("c1", ("a.txt", "1\n"));
        var page = Svc.GetLog(_repo.WorkDir, new LogFilter(Limit: -5, Skip: -3));
        Assert.Single(page.Items);
    }

    [Fact]
    public void GetLog_AuthorNameAppearsInBranchNamesForHead()
    {
        var sha = _repo.Builder.Commit("head commit", ("a.txt", "1\n"));
        var page = Svc.GetLog(_repo.WorkDir, LogFilter.All);
        Assert.Single(page.Items);
        Assert.Contains("main", page.Items[0].BranchNames);
    }

    [Fact]
    public void GetLog_CommitterDateIsSet()
    {
        _repo.Builder.Commit("c", ("a.txt", "1\n"));
        var page = Svc.GetLog(_repo.WorkDir, LogFilter.All);
        Assert.True(page.Items[0].CommitterDate > DateTimeOffset.UnixEpoch);
    }
}
