using GitUI.Core.Models;
using Xunit;

namespace GitUI.Core.Tests.Models;

public sealed class LogPageTests
{
    private static CommitNode N(int i) => new(
        new string((char)('0' + i % 10), 40),
        "s" + i,
        "msg " + i,
        "msg " + i,
        "A",
        "a@x",
        DateTimeOffset.UnixEpoch.AddSeconds(i),
        "A",
        DateTimeOffset.UnixEpoch.AddSeconds(i),
        CommitNode.NoParents,
        "t",
        System.Collections.Immutable.ImmutableArray<string>.Empty,
        System.Collections.Immutable.ImmutableArray<string>.Empty);

    private static LogPage Page(int total, int skip, int limit, int items) =>
        new(Enumerable.Range(0, items).Select(N).ToList(), total, skip, limit);

    [Fact]
    public void HasMore_True_WhenItemsRemainAfterPage()
    {
        Assert.True(Page(total: 120, skip: 0, limit: 50, items: 50).HasMore);
    }

    [Fact]
    public void HasMore_False_WhenLastPage()
    {
        Assert.False(Page(total: 100, skip: 50, limit: 50, items: 50).HasMore);
    }

    [Fact]
    public void HasMore_False_OnSingleFullPage()
    {
        Assert.False(Page(total: 30, skip: 0, limit: 50, items: 30).HasMore);
    }

    [Fact]
    public void HasMore_False_WhenEmptyRepo()
    {
        Assert.False(Page(total: 0, skip: 0, limit: 50, items: 0).HasMore);
    }

    [Fact]
    public void PageCount_RoundsUp()
    {
        Assert.Equal(3, Page(total: 120, skip: 0, limit: 50, items: 50).PageCount);
        Assert.Equal(1, Page(total: 50, skip: 0, limit: 50, items: 50).PageCount);
        Assert.Equal(1, Page(total: 0, skip: 0, limit: 50, items: 0).PageCount);
    }

    [Fact]
    public void PageCount_SinglePage_WhenLimitUnlimited()
    {
        Assert.Equal(1, Page(total: 1000, skip: 0, limit: 0, items: 1000).PageCount);
    }
}

public sealed class LogFilterTests
{
    [Fact]
    public void Default_HasFiftyLimit_NoSkip()
    {
        var f = LogFilter.Default;
        Assert.Equal(50, f.Limit);
        Assert.Equal(0, f.Skip);
        Assert.Null(f.Author);
        Assert.Null(f.Topic);
        Assert.Null(f.Branch);
        Assert.Null(f.After);
        Assert.Null(f.Before);
    }

    [Fact]
    public void Normalize_ClipsNegativeLimitAndSkip()
    {
        var f = new LogFilter(Limit: -5, Skip: -3).Normalize();
        Assert.Equal(0, f.Limit);
        Assert.Equal(0, f.Skip);
    }

    [Fact]
    public void Normalize_KeepsValidValues()
    {
        var f = new LogFilter(Limit: 20, Skip: 40, Author: "alice").Normalize();
        Assert.Equal(20, f.Limit);
        Assert.Equal(40, f.Skip);
        Assert.Equal("alice", f.Author);
    }

    [Fact]
    public void With_OverridesOnlySpecifiedFields()
    {
        var baseFilter = new LogFilter(Author: "alice", Limit: 10);
        var updated = baseFilter with { Limit = 20 };
        Assert.Equal("alice", updated.Author);
        Assert.Equal(20, updated.Limit);
    }

    [Fact]
    public void All_Unlimited()
    {
        Assert.Equal(0, LogFilter.All.Limit);
    }
}
