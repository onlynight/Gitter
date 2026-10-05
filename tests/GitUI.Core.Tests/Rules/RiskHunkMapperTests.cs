using GitUI.Core.Models;
using GitUI.Core.Rules;
using Xunit;

namespace GitUI.Core.Tests.Rules;

/// <summary>风险发现 → hunk 映射（验收台画布标记，ai-native-redesign.md §3.3）。</summary>
public sealed class RiskHunkMapperTests
{
    private static DiffHunk Hunk(int newStart, int newCount) =>
        new(1, 1, newStart, newCount, Array.Empty<string>(), Array.Empty<string>());

    private static RuleFinding AtLine(int? line) =>
        new("debug.residue", SafetySeverity.Warning, "a.js", line, "dbg");

    [Fact]
    public void Map_LineFallsIntoHunkRange()
    {
        var hunks = new[] { Hunk(1, 3), Hunk(10, 2), Hunk(20, 5) };
        var hits = RiskHunkMapper.Map(new[] { AtLine(11), AtLine(21), AtLine(24) }, hunks);
        Assert.Equal(new[] { 1, 2 }, hits);
    }

    [Fact]
    public void Map_PureDeletionHunk_HasNoNewLines_NeverHit()
    {
        // 纯删除 hunk：NewCount=0（新侧无行）
        var hunks = new[] { Hunk(5, 0), Hunk(10, 2) };
        var hits = RiskHunkMapper.Map(new[] { AtLine(5) }, hunks);
        Assert.Empty(hits);
    }

    [Fact]
    public void Map_OutOfRange_And_NullLine_Ignored()
    {
        var hunks = new[] { Hunk(1, 3) };
        var findings = new[] { AtLine(99), AtLine(null), AtLine(0), AtLine(2) };
        Assert.Equal(new[] { 0 }, RiskHunkMapper.Map(findings, hunks));
    }

    [Fact]
    public void Map_Deduplicates_AndSorts()
    {
        var hunks = new[] { Hunk(1, 10) };
        var hits = RiskHunkMapper.Map(new[] { AtLine(1), AtLine(5), AtLine(9) }, hunks);
        Assert.Equal(new[] { 0 }, hits);
    }

    [Fact]
    public void Map_EmptyInputs_ReturnEmpty()
    {
        Assert.Empty(RiskHunkMapper.Map(Array.Empty<RuleFinding>(), Array.Empty<DiffHunk>()));
    }
}
