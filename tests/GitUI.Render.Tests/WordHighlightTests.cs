using Xunit;
using GitUI.Core.Models;
using GitUI.Diff.Render;

namespace GitUI.Render.Tests;

/// <summary>字级差异的惰性计算与缓存行为。</summary>
public class WordHighlightTests
{
    [Fact]
    public void ModifiedPair_SegmentsCoverBothSides()
    {
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 3, 1, 3, " a", "-int x = 1;", "+int x = 2;", " b")), sideBySide: true);

        model.EnsureWordDiff(0, model.Rows.Count - 1);
        var words = model.Rows[2].Left!.Words;
        Assert.NotNull(words);

        // 段串接序列覆盖两侧：Deleted 段串接 = 旧行，Inserted 段串接 = 新行，Equal 段两侧共有
        Assert.Equal("int x = 1;", string.Concat(words!.Where(s => s.Kind != WordSegmentKind.Inserted).Select(s => s.Text)));
        Assert.Equal("int x = 2;", string.Concat(words.Where(s => s.Kind != WordSegmentKind.Deleted).Select(s => s.Text)));
        Assert.Contains(words, s => s.Kind == WordSegmentKind.Deleted && s.Text.Contains('1'));
        Assert.Contains(words, s => s.Kind == WordSegmentKind.Inserted && s.Text.Contains('2'));
    }

    [Fact]
    public void PairCells_ShareSameSegmentList()
    {
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 2, 1, 2, "-foo(1)", "+foo(2)")), sideBySide: true);

        model.EnsureWordDiff(0, model.Rows.Count - 1);
        Assert.Same(model.Rows[1].Left!.Words, model.Rows[1].Right!.Words);
    }

    [Fact]
    public void EnsureWordDiff_OnlyInRange()
    {
        // 两个相距较远的修改对
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 4, 1, 4, "-a1", "+a2", " c", " c"),
            TestHunks.H(10, 4, 10, 4, "-b1", "+b2", " c", " c")), sideBySide: true);

        model.EnsureWordDiff(0, 1);
        Assert.NotNull(model.Rows[1].Left!.Words);
        Assert.Null(model.Rows[^2].Left!.Words);
    }

    [Fact]
    public void EnsureWordDiff_Idempotent_SameReference()
    {
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 2, 1, 2, "-x", "+y")), sideBySide: true);

        model.EnsureWordDiff(0, 0);
        var first = model.Rows[1].Left!.Words;
        model.EnsureWordDiff(0, 0);
        Assert.Same(first, model.Rows[1].Left!.Words);
    }

    [Fact]
    public void OversizedPair_Skipped_NoHighlight()
    {
        var longOld = new string('a', 3000);
        var longNew = new string('a', 2999) + "b";
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 2, 1, 2, "-" + longOld, "+" + longNew)), sideBySide: true);

        Assert.True(longOld.Length + longNew.Length > DiffRenderModel.WordDiffMaxChars);
        model.EnsureWordDiff(0, model.Rows.Count - 1);
        Assert.Null(model.Rows[1].Left!.Words);
    }

    [Fact]
    public void UnpairedRows_NeverGetWords()
    {
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 4, 1, 2, "-a1", "-a2", "-a3", "+b1", " c")), sideBySide: true);

        model.EnsureWordDiff(0, model.Rows.Count - 1);
        // 配对行 a1/b1 有分段；余量删除行 a2/a3 没有
        Assert.NotNull(model.Rows[1].Left!.Words);
        Assert.Null(model.Rows[2].Left!.Words);
        Assert.Null(model.Rows[3].Left!.Words);
    }

    [Fact]
    public void CJKPair_ProducesPerCharSegments()
    {
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 2, 1, 2, "-你好世界", "+你好世间")), sideBySide: true);

        model.EnsureWordDiff(0, model.Rows.Count - 1);
        var words = model.Rows[1].Left!.Words;
        Assert.NotNull(words);
        // "你好" 相同前缀 + "世界"→"世间" 逐字替换
        Assert.Contains(words!, s => s.Kind == WordSegmentKind.Deleted && s.Text.Contains('界'));
        Assert.Contains(words, s => s.Kind == WordSegmentKind.Inserted && s.Text.Contains('间'));
    }
}
