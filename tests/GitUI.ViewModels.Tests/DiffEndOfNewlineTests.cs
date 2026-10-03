using GitUI.Core.Services;
using GitUI.Git;
using Xunit;

namespace GitUI.ViewModels.Tests;

/// <summary>known-issues 1.6：提交/文件 diff 的 EOF 标志（"\ No newline" 透传到 DiffResult）。</summary>
public sealed class DiffEndOfNewlineTests : IDisposable
{
    private readonly GitFixtureBuilder _builder;

    public DiffEndOfNewlineTests()
    {
        var dir = Path.Combine(Path.GetTempPath(), "gitui-eof-test-" + Guid.NewGuid().ToString("N"));
        _builder = GitFixtureBuilder.Init(dir, "main");
    }

    public void Dispose() => _builder.Dispose();

    [Theory]
    [InlineData(true, true, false)]  // 两侧都有尾换行 → 无标记
    [InlineData(true, false, true)]  // 新侧缺尾换行 → 标记跟在 + 行后
    [InlineData(false, true, true)]  // 旧侧缺尾换行 → 标记跟在 - 行后
    [InlineData(false, false, true)] // 两侧都缺 → 两个标记
    public void DetectEndOfNewline_MarkerSides(bool oldEof, bool newEof, bool withMarker)
    {
        // 构造：old/new 各自是否带尾换行；修改最后一行产生含标记（或不带）的 patch
        var nl = "\n";
        var oldText = "l1" + nl + "l2" + (oldEof ? nl : "");
        var newText = "l1" + nl + "L2" + (newEof ? nl : "");
        _builder.Commit("base", ("f.txt", oldText));
        _builder.Write("f.txt", newText);

        var patch = new GitUI.Git.LibGit2RepositoryService().GetWorktreePatch(_builder.WorkDir, "f.txt");
        Assert.NotNull(patch);
        Assert.Equal(withMarker, patch.Contains("\\ No newline at end of file", StringComparison.Ordinal));

        var (oldGot, newGot) = UnifiedPatch.DetectEndOfNewline(patch);
        Assert.Equal(oldEof, oldGot);
        Assert.Equal(newEof, newGot);
    }

    [Fact]
    public void DetectEndOfNewline_NoMarker_BothTrue()
    {
        var (o, n) = UnifiedPatch.DetectEndOfNewline("diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n+b\n");
        Assert.True(o);
        Assert.True(n);
    }

    [Fact]
    public void DetectEndOfNewline_EmptyInput_BothTrue()
    {
        var (o, n) = UnifiedPatch.DetectEndOfNewline(null);
        Assert.True(o);
        Assert.True(n);
    }

    [Fact]
    public void GetCommitDiff_CarriesEofFlags()
    {
        var oldText = "l1\nl2";
        _builder.Commit("base", ("f.txt", oldText));
        _builder.Write("f.txt", "l1\nL2"); // 两侧都缺尾换行
        _builder.Stage("f.txt");
        _builder.Commit("second");

        var svc = new LibGit2RepositoryService();
        var head = svc.GetCommit(_builder.WorkDir, "HEAD")!;
        var diffs = svc.GetCommitDiff(_builder.WorkDir, head.Sha);
        var f = Assert.Single(diffs);
        Assert.False(f.OldEndsWithNewline);
        Assert.False(f.NewEndsWithNewline);
    }

    [Fact]
    public void GetCommitDiff_NormalFiles_DefaultTrue()
    {
        _builder.Commit("base", ("f.txt", "l1\nl2\n"));
        _builder.Write("f.txt", "l1\nL2\n");
        _builder.Stage("f.txt");
        _builder.Commit("second");

        var svc = new LibGit2RepositoryService();
        var head = svc.GetCommit(_builder.WorkDir, "HEAD")!;
        var f = Assert.Single(svc.GetCommitDiff(_builder.WorkDir, head.Sha));
        Assert.True(f.OldEndsWithNewline);
        Assert.True(f.NewEndsWithNewline);
    }

    [Fact]
    public void GetFileDiff_CarriesEofFlagsFromBlobs()
    {
        _builder.Commit("base", ("f.txt", "l1\nl2\n"));
        _builder.Commit("second", ("f.txt", "l1\nL2")); // 新版本缺尾换行

        var svc = new LibGit2RepositoryService();
        var head = _builder.Sha("HEAD");
        var prev = _builder.Sha("HEAD~1");
        var f = svc.GetFileDiff(_builder.WorkDir, "f.txt", prev, head);
        Assert.True(f.OldEndsWithNewline);
        Assert.False(f.NewEndsWithNewline);
    }
}
