using GitUI.Core.Models;
using GitUI.Diff;
using Xunit;

namespace GitUI.Diff.Tests;

/// <summary>
/// 字级（词元级）差异测试：一对变更行内部的差异分段。
/// 断言约定：Deleted 段串接 = 旧行内容，Inserted 段串接 = 新行内容，
/// Equal 段两侧内容一致。
/// </summary>
public sealed class WordDiffTests
{
    private static readonly MyersDiffEngine Engine = MyersDiffEngine.Instance;

    private static string Deleted(IReadOnlyList<WordSegment> segs)
        => string.Concat(segs.Where(s => s.Kind != WordSegmentKind.Inserted).Select(s => s.Text));

    private static string Inserted(IReadOnlyList<WordSegment> segs)
        => string.Concat(segs.Where(s => s.Kind != WordSegmentKind.Deleted).Select(s => s.Text));

    private static string EqualText(IReadOnlyList<WordSegment> segs)
        => string.Concat(segs.Where(s => s.Kind == WordSegmentKind.Equal).Select(s => s.Text));

    [Fact]
    public void IdenticalLines_SingleEqualSegment()
    {
        var segs = Engine.ComputeWordDiff("foo bar", "foo bar");
        var s = Assert.Single(segs);
        Assert.Equal(WordSegmentKind.Equal, s.Kind);
        Assert.Equal("foo bar", s.Text);
    }

    [Fact]
    public void IdenticalEmptyLines_NoSegments()
        => Assert.Empty(Engine.ComputeWordDiff(string.Empty, string.Empty));

    [Fact]
    public void IdentifierRename_OnlyChangedPartMarked()
    {
        var segs = Engine.ComputeWordDiff("int totalCount = 0;", "int totalSum = 0;");
        Assert.Equal("int totalCount = 0;", Deleted(segs));
        Assert.Equal("int totalSum = 0;", Inserted(segs));
        // 词元按整词切：Equal 覆盖 "int " 前缀与 " = 0;" 后缀，仅标识符整体替换
        Assert.Contains(new WordSegment(WordSegmentKind.Equal, "int "), segs);
        Assert.Contains(new WordSegment(WordSegmentKind.Equal, " = 0;"), segs);
        Assert.Contains(new WordSegment(WordSegmentKind.Deleted, "totalCount"), segs);
        Assert.Contains(new WordSegment(WordSegmentKind.Inserted, "totalSum"), segs);
    }

    [Fact]
    public void CjkCharacters_DiffAtCharGranularity()
    {
        var segs = Engine.ComputeWordDiff("提交信息：修复空指针", "提交信息：修复空引用");
        Assert.Equal("提交信息：修复空指针", Deleted(segs));
        Assert.Equal("提交信息：修复空引用", Inserted(segs));
        Assert.Equal("提交信息：修复空", EqualText(segs));
    }

    [Fact]
    public void WhitespaceRunChange_IsSingleSegment()
    {
        var segs = Engine.ComputeWordDiff("    return x;", "\treturn x;");
        var kinds = segs.Select(s => s.Kind).ToList();
        Assert.Equal(WordSegmentKind.Deleted, kinds[0]);
        Assert.Equal(WordSegmentKind.Inserted, kinds[1]);
        Assert.Equal(WordSegmentKind.Equal, kinds[^1]);
        Assert.Equal("    ", segs[0].Text);
        Assert.Equal("\t", segs[1].Text);
    }

    [Fact]
    public void EmptyToText_AllInserted()
    {
        var segs = Engine.ComputeWordDiff(string.Empty, "content");
        var s = Assert.Single(segs);
        Assert.Equal(WordSegmentKind.Inserted, s.Kind);
        Assert.Equal("content", s.Text);
    }

    [Fact]
    public void PunctuationChange_CharLevel()
    {
        var segs = Engine.ComputeWordDiff("a,b", "a.b");
        // 标点逐字符成词元：Equal a，Del ,，Ins .，Equal b
        Assert.Equal(
            new[]
            {
                new WordSegment(WordSegmentKind.Equal, "a"),
                new WordSegment(WordSegmentKind.Deleted, ","),
                new WordSegment(WordSegmentKind.Inserted, "."),
                new WordSegment(WordSegmentKind.Equal, "b"),
            },
            segs);
    }

    [Fact]
    public void SegmentsConcatenateBackToOriginalLines()
    {
        // 通用性质：任意输入下，Deleted+Equal 串接 = 旧行，Inserted+Equal 串接 = 新行
        var pairs = new[]
        {
            ("const x = foo(bar, 1);", "const x = foo(baz, 2);"),
            ("if (a && b) {", "if (a || b) {"),
            ("return null;", "return value ?? throw new Exception();"),
            ("中文混合 english 混排", "中文 混合english 混排!"),
        };
        foreach (var (o, n) in pairs)
        {
            var segs = Engine.ComputeWordDiff(o, n);
            Assert.Equal(o, Deleted(segs));
            Assert.Equal(n, Inserted(segs));
        }
    }
}
