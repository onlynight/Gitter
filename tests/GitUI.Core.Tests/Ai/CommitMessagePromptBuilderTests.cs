using GitUI.Core.Ai;
using GitUI.Core.Settings;
using Xunit;

namespace GitUI.Core.Tests.Ai;

/// <summary>提交信息 prompt 构造（ai-native-redesign.md §4.1）：few-shot 风格学习 + 隐私分级。</summary>
public sealed class CommitMessagePromptBuilderTests
{
    private static CommitMessageInput SampleInput(string? diff = "diff --git a/f b/f\n+hello") => new(
        RecentSubjects: new[] { "feat: 已有功能", "fix: 修复问题" },
        Files: new[] { new CommitMessageFile("src/a.cs", 10, 2), new CommitMessageFile("README.md", 1, 0) },
        DiffText: diff);

    [Fact]
    public void MetadataOnly_DoesNotIncludeDiff()
    {
        var prompt = CommitMessagePromptBuilder.Build(SampleInput(), AiPrivacyLevel.MetadataOnly);

        Assert.DoesNotContain("diff --git", prompt.User);
        Assert.Contains("src/a.cs", prompt.User);
        Assert.Contains("(+10, -2)", prompt.User);
    }

    [Fact]
    public void FullDiff_IncludesDiffText()
    {
        var prompt = CommitMessagePromptBuilder.Build(SampleInput(), AiPrivacyLevel.FullDiff);

        Assert.Contains("diff --git", prompt.User);
        Assert.Contains("+hello", prompt.User);
    }

    [Fact]
    public void FullDiff_TruncatesToBudget()
    {
        var longDiff = new string('x', CommitMessagePromptBuilder.DiffBudgetChars + 5_000);
        var prompt = CommitMessagePromptBuilder.Build(SampleInput(longDiff), AiPrivacyLevel.FullDiff);

        Assert.Contains("(truncated)", prompt.User);
        Assert.True(prompt.User.Length < CommitMessagePromptBuilder.DiffBudgetChars + 2_000);
    }

    [Fact]
    public void RecentSubjects_AppearAsFewShot_StyleInstructionPresent()
    {
        var many = Enumerable.Range(1, 30).Select(i => $"feat: commit {i}").ToList();
        var prompt = CommitMessagePromptBuilder.Build(SampleInput() with { RecentSubjects = many }, AiPrivacyLevel.MetadataOnly);

        // 最多 20 条 few-shot（few-shot 在 system 段）
        Assert.Equal(20, prompt.System.Split("- feat: commit ").Length - 1);
        Assert.Contains("Match the language and style", prompt.System);
        Assert.Contains("ONLY the message subject", prompt.System);
    }

    [Fact]
    public void WithoutDiff_StripsDiffEvenIfCallerPassedIt()
    {
        var input = CommitMessagePromptBuilder.WithoutDiff(SampleInput());
        Assert.Null(input.DiffText);
    }

    [Fact]
    public void CleanDraft_RemovesFencesQuotesAndBlankLines()
    {
        Assert.Equal("feat: x", ChangesCleanHelper("```\nfeat: x\n```"));
        Assert.Equal("feat: x", ChangesCleanHelper("\"feat: x\""));
        Assert.Equal("feat: x\nbody line", ChangesCleanHelper("feat: x\n\nbody line\n"));
        Assert.Equal(string.Empty, ChangesCleanHelper("``` ```"));
    }

    private static string ChangesCleanHelper(string raw) => CommitMessagePromptBuilder.CleanDraft(raw);
}
