using System.Collections.Immutable;
using GitUI.Core.Models;
using GitUI.ViewModels;
using Xunit;

namespace GitUI.ViewModels.Tests;

/// <summary>按天分组（design.md §8-S4"按天分组折叠"）：分组边界、顺序、相对称谓标题。</summary>
public sealed class LogGroupingTests
{
    private static CommitNode Node(string subject, DateTimeOffset when) => new(
        /* sha */ subject, /* shortSha */ subject.Length >= 7 ? subject[..7] : subject,
        /* message */ subject, /* subject */ subject,
        /* author */ "a", /* authorEmail */ "a@x", /* authorDate */ when,
        /* committer */ "a", /* committerDate */ when,
        CommitNode.NoParents, /* treeSha */ "t",
        ImmutableArray<string>.Empty, ImmutableArray<string>.Empty);

    private static readonly DateTime Today = new(2026, 10, 3, 0, 0, 0, DateTimeKind.Local);
    private static readonly TimeSpan LocalOffset = TimeZoneInfo.Local.GetUtcOffset(new DateTime(2026, 10, 3));

    private static DateTimeOffset At(int year, int month, int day, int hour, int minute = 0) =>
        new(year, month, day, hour, minute, 0, LocalOffset);

    [Fact]
    public void Group_SameDayCommits_SingleGroupPreservingOrder()
    {
        var d = At(2026, 10, 3, 9);
        var groups = LogDayGrouping.Group(new[] { Node("c1", d), Node("c2", d.AddHours(-1)) }, Today);
        var group = Assert.Single(groups);
        Assert.Equal(2, group.Commits.Count);
        Assert.Equal("c1", group.Commits[0].Subject);
    }

    [Fact]
    public void Group_DayBoundary_SplitsGroups()
    {
        var late = At(2026, 10, 2, 23, 59);
        var next = At(2026, 10, 3, 0, 1);
        var groups = LogDayGrouping.Group(new[] { Node("new", next), Node("old", late) }, Today);

        Assert.Equal(2, groups.Count);
        Assert.Equal(new DateTime(2026, 10, 3), groups[0].Day);
        Assert.Equal("new", groups[0].Commits[0].Subject);
        Assert.Equal(new DateTime(2026, 10, 2), groups[1].Day);
    }

    [Fact]
    public void Group_SkipsEmptyDays()
    {
        var a = At(2026, 10, 3, 8);
        var b = At(2026, 9, 1, 8);
        var groups = LogDayGrouping.Group(new[] { Node("a", a), Node("b", b) }, Today);
        Assert.Equal(2, groups.Count);
        Assert.Equal(new DateTime(2026, 9, 1), groups[1].Day);
    }

    [Fact]
    public void Group_Title_Today()
    {
        var when = At(2026, 10, 3, 8);
        var groups = LogDayGrouping.Group(new[] { Node("a", when) }, Today);
        // 2026-10-03 是星期六
        Assert.Equal("今天 · 10月3日 星期六", groups[0].Title);
    }

    [Fact]
    public void Group_Title_Yesterday()
    {
        var when = At(2026, 10, 2, 8);
        var groups = LogDayGrouping.Group(new[] { Node("a", when) }, Today);
        Assert.Equal("昨天 · 10月2日 星期五", groups[0].Title);
    }

    [Fact]
    public void Group_Title_ThisYearOmitsYear()
    {
        var when = At(2026, 9, 28, 8);
        var groups = LogDayGrouping.Group(new[] { Node("a", when) }, Today);
        Assert.Equal("9月28日 星期一", groups[0].Title);
    }

    [Fact]
    public void Group_Title_OtherYearIncludesYear()
    {
        var when = At(2025, 12, 30, 8);
        var groups = LogDayGrouping.Group(new[] { Node("a", when) }, Today);
        Assert.Equal("2025年12月30日 星期二", groups[0].Title);
    }

    [Fact]
    public void Group_EmptyInput_EmptyResult()
    {
        Assert.Empty(LogDayGrouping.Group(Array.Empty<CommitNode>(), Today));
    }
}
