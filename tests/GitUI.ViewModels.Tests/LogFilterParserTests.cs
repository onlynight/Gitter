using GitUI.Core.Models;
using GitUI.ViewModels;
using Xunit;

namespace GitUI.ViewModels.Tests;

/// <summary>搜索框语法解析（design.md §4.2 P0：author: branch: after: before: topic: + 自由词）。</summary>
public sealed class LogFilterParserTests
{
    [Fact]
    public void Parse_EmptyOrWhitespace_NoFilters()
    {
        foreach (var q in new[] { null, "", "   " })
        {
            var f = LogFilterParser.Parse(q, 50, 0);
            Assert.Null(f.Author);
            Assert.Null(f.Topic);
            Assert.Null(f.Branch);
            Assert.Null(f.After);
            Assert.Null(f.Before);
            Assert.Equal(50, f.Limit);
            Assert.Equal(0, f.Skip);
        }
    }

    [Fact]
    public void Parse_FreeWord_BecomesCaseInsensitiveLiteralRegex()
    {
        var f = LogFilterParser.Parse("fix crash", 50, 0);
        Assert.NotNull(f.Topic);
        Assert.Equal("(?i)(?=.*fix)(?=.*crash)", f.Topic);
    }

    [Fact]
    public void Parse_FreeWord_RegexMetacharactersAreEscaped()
    {
        var f = LogFilterParser.Parse("feat(x)+", 50, 0);
        Assert.Equal("(?i)feat\\(x\\)\\+", f.Topic);
    }

    [Fact]
    public void Parse_TopicPrefix_PassesRegexThroughVerbatim()
    {
        var f = LogFilterParser.Parse("topic:^feat\\(.*\\)$", 50, 0);
        Assert.Equal("^feat\\(.*\\)$", f.Topic);
    }

    [Theory]
    [InlineData("author:alice")]
    [InlineData("AUTHOR:alice")]
    public void Parse_AuthorPrefix_CaseInsensitive(string query)
    {
        Assert.Equal("alice", LogFilterParser.Parse(query).Author);
    }

    [Fact]
    public void Parse_QuotedValue_KeepsSpaces()
    {
        Assert.Equal("Alice Zhang", LogFilterParser.Parse("author:\"Alice Zhang\"").Author);
        Assert.Equal("Alice Zhang", LogFilterParser.Parse("author:'Alice Zhang'").Author);
    }

    [Fact]
    public void Parse_BranchPrefix()
    {
        Assert.Equal("main", LogFilterParser.Parse("branch:main").Branch);
    }

    [Fact]
    public void Parse_DatePrefixes_LocalTimezone()
    {
        var f = LogFilterParser.Parse("after:2024-01-01 before:2024-12-31");
        Assert.Equal(new DateTime(2024, 1, 1), f.After!.Value.LocalDateTime);
        Assert.Equal(new DateTime(2024, 12, 31), f.Before!.Value.LocalDateTime);
    }

    [Fact]
    public void Parse_DateWithTime_IsAccepted()
    {
        // 含空格的时刻需要引号包裹成一个词；ISO 的 T 写法不需要
        var quoted = LogFilterParser.Parse("after:\"2024-06-15 13:30\"");
        Assert.Equal(13, quoted.After!.Value.Hour);
        Assert.Equal(30, quoted.After.Value.Minute);

        var iso = LogFilterParser.Parse("after:2024-06-15T13:30");
        Assert.Equal(13, iso.After!.Value.Hour);
        Assert.Equal(30, iso.After.Value.Minute);
    }

    [Fact]
    public void Parse_InvalidDateValue_FallsBackToFreeWord()
    {
        var f = LogFilterParser.Parse("after:not-a-date");
        Assert.Null(f.After);
        Assert.Equal("(?i)after:not-a-date", f.Topic);
    }

    [Fact]
    public void Parse_CombinedPrefixesAndFreeWords()
    {
        var f = LogFilterParser.Parse("author:alice branch:feat/1 fix crash", 25, 10);
        Assert.Equal("alice", f.Author);
        Assert.Equal("feat/1", f.Branch);
        Assert.Equal("(?i)(?=.*fix)(?=.*crash)", f.Topic);
        Assert.Equal(25, f.Limit);
        Assert.Equal(10, f.Skip);
    }

    [Fact]
    public void Parse_DuplicatePrefix_LastWins()
    {
        Assert.Equal("bob", LogFilterParser.Parse("author:alice author:bob").Author);
    }

    [Fact]
    public void Parse_PrefixWithoutValue_TreatedAsFreeWord()
    {
        var f = LogFilterParser.Parse("author:");
        Assert.Null(f.Author);
        Assert.Equal("(?i)author:", f.Topic);
    }

    [Fact]
    public void Parse_TopicAndFreeWords_Anded()
    {
        var f = LogFilterParser.Parse("topic:^feat refactor");
        Assert.Equal("(?i)(?=.*^feat)(?=.*refactor)", f.Topic);
    }
}
