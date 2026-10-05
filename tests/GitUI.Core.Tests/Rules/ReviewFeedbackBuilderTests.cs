using GitUI.Core.Ai;
using GitUI.Core.Rules;
using GitUI.Core.Settings;
using Xunit;

namespace GitUI.Core.Tests.Rules;

public sealed class ReviewFeedbackBuilderTests
{
    [Fact]
    public void Build_ContainsFileDiffAndNote()
    {
        var prompt = ReviewFeedbackBuilder.Build(
            new[] { new ReviewFeedbackFile("src/a.cs", new[] { "@@ -1 +1,2 @@\n+bad" }, new[] { 0 }) },
            "这里的错误处理缺失");

        Assert.Contains("src/a.cs", prompt);
        Assert.Contains("+bad", prompt);
        Assert.Contains("这里的错误处理缺失", prompt);
        Assert.Contains("```diff", prompt);
    }

    [Fact]
    public void Build_WithoutNote_StillHasInstructionAndDiff()
    {
        var prompt = ReviewFeedbackBuilder.Build(
            new[] { new ReviewFeedbackFile("f.txt", new[] { "@@ -1 +1 @@" }, new[] { 0 }) },
            note: null);

        Assert.DoesNotContain("## 问题", prompt);
        Assert.Contains("f.txt", prompt);
    }

    [Fact]
    public void Build_OutOfRangeHunkIndex_Skipped()
    {
        var prompt = ReviewFeedbackBuilder.Build(
            new[] { new ReviewFeedbackFile("f.txt", new[] { "@@ -1 +1 @@" }, new[] { 0, 5, -1 }) },
            note: null);

        // 只保留合法下标的块（```diff 开栅每块一次）
        Assert.Equal(1, prompt.Split("```diff").Length - 1);
    }
}

public sealed class ExplainPromptBuilderTests
{
    private static ExplainInput SampleInput(string? diff = "diff --git a/f b/f\n+code") => new(
        Files: new[] { new CommitMessageFile("src/a.cs", 10, 2) },
        DiffText: diff);

    [Fact]
    public void ExplainIntent_AndReviewIntent_ProduceDifferentSystems()
    {
        var explain = ExplainPromptBuilder.Build(SampleInput(), AiPrivacyLevel.FullDiff, ExplainIntent.Explain);
        var review = ExplainPromptBuilder.Build(SampleInput(), AiPrivacyLevel.FullDiff, ExplainIntent.Review);

        Assert.NotEqual(explain.System, review.System);
        Assert.Contains("review", review.System, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("diff --git", explain.User);
    }

    [Fact]
    public void MetadataOnly_OmitsDiff()
    {
        var prompt = ExplainPromptBuilder.Build(SampleInput(), AiPrivacyLevel.MetadataOnly, ExplainIntent.Explain);

        Assert.DoesNotContain("diff --git", prompt.User);
        Assert.Contains("src/a.cs", prompt.User);
    }

    [Fact]
    public void FullDiff_Truncates()
    {
        var longDiff = new string('x', CommitMessagePromptBuilder.DiffBudgetChars + 4_000);
        var prompt = ExplainPromptBuilder.Build(SampleInput(longDiff), AiPrivacyLevel.FullDiff, ExplainIntent.Explain);

        Assert.Contains("(truncated)", prompt.User);
    }
}
