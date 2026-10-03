using GitUI.Core.Models;
using GitUI.Git;
using Xunit;

namespace GitUI.Git.Tests;

public sealed class DiffHunkParsingTests : IDisposable
{
    private readonly TestRepo _repo = new();
    private LibGit2RepositoryService Svc => _repo.Service;
    public void Dispose() => _repo.Dispose();

    [Fact]
    public void ComputeDiff_PureAddition_ProducesInsertionHunk()
    {
        var hunks = Svc.ComputeDiff(string.Empty, "line1\nline2\nline3\n");
        Assert.Single(hunks);
        // 用 SplitLines 后长度是 3，但 LineDiff 保留空尾行为，可能有 4 行；用范围断言
        Assert.InRange(hunks[0].NewLines.Count(l => l.StartsWith("+")), 3, 4);
        Assert.All(hunks[0].OldLines, l => Assert.False(l.StartsWith("-")));
    }

    [Fact]
    public void ComputeDiff_PureDeletion_ProducesDeletionHunk()
    {
        var hunks = Svc.ComputeDiff("line1\nline2\nline3\n", string.Empty);
        Assert.Single(hunks);
        Assert.InRange(hunks[0].OldLines.Count(l => l.StartsWith("-")), 3, 4);
        Assert.All(hunks[0].NewLines, l => Assert.False(l.StartsWith("+")));
    }

    [Fact]
    public void ComputeDiff_MiddleModification_OldLinesContainsChange()
    {
        var oldText = "one\ntwo\nthree\nfour\nfive\n";
        var newText = "one\nTWO\nthree\nfour\nfive\n";
        var hunks = Svc.ComputeDiff(oldText, newText);
        Assert.Single(hunks);
        var h = hunks[0];
        Assert.Contains("-two", h.OldLines);
        Assert.Contains("+TWO", h.NewLines);
    }

    [Fact]
    public void ComputeDiff_EmptyInputs_ReturnsNoHunks()
    {
        Assert.Empty(Svc.ComputeDiff(string.Empty, string.Empty));
    }

    [Fact]
    public void ComputeDiff_AppendAtEnd_CorrectInsertionCount()
    {
        var oldText = "a\nb\nc\n";
        var newText = "a\nb\nc\nd\ne\n";
        var hunks = Svc.ComputeDiff(oldText, newText);
        Assert.Single(hunks);
        // 末尾新增两行；OldLines 不应含 `-` 删除标记，NewLines 含两条 `+`
        var inserts = hunks[0].NewLines.Where(l => l.StartsWith("+")).Count();
        Assert.Equal(2, inserts);
        Assert.DoesNotContain(hunks[0].OldLines, l => l.StartsWith("-"));
    }

    [Fact]
    public void ComputeDiff_InsertAtStart_ProducesInsertionOnly()
    {
        var oldText = "b\nc\n";
        var newText = "a\nb\nc\n";
        var hunks = Svc.ComputeDiff(oldText, newText);
        Assert.Single(hunks);
        var inserts = hunks[0].NewLines.Where(l => l.StartsWith("+")).Count();
        Assert.Equal(1, inserts);
        Assert.DoesNotContain(hunks[0].OldLines, l => l.StartsWith("-"));
    }

    [Fact]
    public void ComputeDiff_MultipleSeparateChanges_MultipleHunks()
    {
        // S2 起 hunk 组装遵循 git 语义：相距 ≤ 2×context(3) 行相同内容的编辑块合并，
        // 因此用相距 ≥ 7 行的两处修改断言多 hunk。
        var oldLines = Enumerable.Range(1, 18).Select(i => $"a{i}");
        var oldText = string.Join('\n', oldLines) + "\n";
        var newText = oldText.Replace("a1\n", "A1\n").Replace("a18\n", "A18\n");
        var hunks = Svc.ComputeDiff(oldText, newText);
        Assert.Equal(2, hunks.Count);
    }

    [Fact]
    public void ComputeDiff_NearbyChanges_MergeIntoSingleHunk()
    {
        // 相距 3 行相同内容（≤ 2×context）→ 合并为一个 hunk（git/GNU diff 同语义）
        var oldText = "a1\na2\na3\na4\na5\na6\na7\na8\na9\n";
        var newText = "A1\na2\na3\na4\nA5\na6\na7\na8\na9\n";
        var hunks = Svc.ComputeDiff(oldText, newText);
        Assert.Single(hunks);
    }

    [Fact]
    public void ComputeDiff_Identical_ReturnsEmpty()
    {
        Assert.Empty(Svc.ComputeDiff("same\nsame\n", "same\nsame\n"));
    }
}

/// <summary>
/// S3 回归：ParseUnifiedDiff 的 hunk 头解析（docs/design.md §11.13）。
/// 旧实现把 "-1,7 +1,7 @@" 整段喂给 TryParse：OldStart 解析成 -1、
/// OldCount 因尾部杂质回退 1 —— 真实仓库 diff 的行号与块头全部错位。
/// </summary>
public sealed class HunkHeaderParseTests
{
    private static (int OldStart, int OldCount, int NewStart, int NewCount) Parse(string patch)
    {
        var hunks = LibGit2RepositoryService.ParseUnifiedDiff(patch);
        Assert.Single(hunks);
        return (hunks[0].OldStart, hunks[0].OldCount, hunks[0].NewStart, hunks[0].NewCount);
    }

    [Fact]
    public void StandardHeader_BothCounts()
    {
        var h = Parse("@@ -1,7 +1,7 @@\n ctx\n-old\n+new\n ctx\n ctx\n ctx\n ctx");
        Assert.Equal((1, 7, 1, 7), h);
    }

    [Fact]
    public void TrailingSectionHeading_Ignored()
    {
        var h = Parse("@@ -12,4 +12,5 @@ public static void Main()\n ctx");
        Assert.Equal((12, 4, 12, 5), h);
    }

    [Fact]
    public void PureAddition_CountZeroOldSide()
    {
        var h = Parse("@@ -0,0 +1,3 @@\n+a\n+b\n+c");
        Assert.Equal((0, 0, 1, 3), h);
    }

    [Fact]
    public void PureDeletion_CountZeroNewSide()
    {
        var h = Parse("@@ -1,3 +0,0 @@\n-a\n-b\n-c");
        Assert.Equal((1, 3, 0, 0), h);
    }

    [Fact]
    public void OmittedCount_MeansOne()
    {
        var h = Parse("@@ -5 +5 @@\n-old\n+new");
        Assert.Equal((5, 1, 5, 1), h);
    }
}
