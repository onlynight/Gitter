using GitUI.Core.Services;
using Xunit;

namespace GitUI.Core.Tests;

/// <summary>S7 命令面板的模糊匹配打分（design.md §8-S7"断言 fuzzy 搜索排序"）。</summary>
public sealed class FuzzyMatcherTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void EmptyQuery_MatchesEverythingWithZero(string? query)
    {
        Assert.Equal(0, FuzzyMatcher.Score("任意目标", query!));
    }

    [Fact]
    public void EmptyTarget_DoesNotMatch()
    {
        Assert.Null(FuzzyMatcher.Score("", "a"));
    }

    [Fact]
    public void ExactSubstring_BeatsSubsequence()
    {
        var exact = FuzzyMatcher.Score("转到分支", "分支");
        var subseq = FuzzyMatcher.Score("分支树与操作", "分树"); // 非连续
        Assert.NotNull(exact);
        Assert.NotNull(subseq);
        Assert.True(exact > subseq);
    }

    [Fact]
    public void Subsequence_MustBeOrdered()
    {
        Assert.NotNull(FuzzyMatcher.Score("打开仓库", "开仓"));
        Assert.Null(FuzzyMatcher.Score("打开仓库", "仓开")); // 顺序颠倒
    }

    [Fact]
    public void WordStartHit_BeatsMidWordHit()
    {
        var wordStart = FuzzyMatcher.Score("转到 Log 页", "log");
        var midWord = FuzzyMatcher.Score("catalog", "log");
        Assert.NotNull(wordStart);
        Assert.NotNull(midWord);
        Assert.True(wordStart > midWord);
    }

    [Fact]
    public void EarlierHit_BeatsLaterHit()
    {
        var early = FuzzyMatcher.Score("变更页", "变");
        var late = FuzzyMatcher.Score("提交变更", "变");
        Assert.True(early > late);
    }

    [Fact]
    public void CaseInsensitive()
    {
        Assert.NotNull(FuzzyMatcher.Score("Log Page", "log"));
        Assert.NotNull(FuzzyMatcher.Score("settings", "SET"));
    }

    [Fact]
    public void Sort_ProducesSensibleRanking()
    {
        var commands = new[]
        {
            "导出设置到文件",
            "转到变更 (Ctrl+2)",
            "转到 Log (Ctrl+1)",
            "从文件导入设置",
            "新建窗口",
            "转到 Git Bash (Ctrl+4)",
        };

        var ranked = commands
            .Select(c => (c, Score: FuzzyMatcher.Score(c, "变更") ?? int.MinValue))
            .Where(x => x.Score > int.MinValue)
            .OrderByDescending(x => x.Score)
            .Select(x => x.c)
            .ToList();

        Assert.Equal("转到变更 (Ctrl+2)", ranked[0]);
        // "导出设置" 无 "变更" 子串也非子序列 → 不应出现
        Assert.DoesNotContain("导出设置到文件", ranked);
    }

    [Fact]
    public void StreakBonus_RanksContiguousHigher()
    {
        var contiguous = FuzzyMatcher.Score("提交消息", "提交");
        var spread = FuzzyMatcher.Score("提 交 消 息 的 变 更", "提交");
        Assert.True(contiguous > spread);
    }
}
