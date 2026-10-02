using GitUI.Core.Models;
using Xunit;
using CoreFileMode = GitUI.Core.Models.FileMode;

namespace GitUI.Core.Tests.Models;

public sealed class DiffHunkTests
{
    [Fact]
    public void AddedCount_CountsPlusLinesOnly()
    {
        var h = new DiffHunk(1, 1, 1, 3,
            new[] { "-a" }, new[] { "+x", "+y", "+z" });
        Assert.Equal(3, h.AddedCount);
        Assert.Equal(1, h.DeletedCount);
    }

    [Fact]
    public void PureInsertion_HasZeroOldCount()
    {
        var h = new DiffHunk(0, 0, 5, 2,
            Array.Empty<string>(), new[] { "+a", "+b" });
        Assert.Equal(0, h.OldCount);
        Assert.Equal(0, h.OldStart);
        Assert.Equal(2, h.AddedCount);
    }

    [Fact]
    public void PureDeletion_HasZeroNewCount()
    {
        var h = new DiffHunk(3, 2, 0, 0,
            new[] { "-a", "-b" }, Array.Empty<string>());
        Assert.Equal(0, h.NewCount);
        Assert.Equal(2, h.DeletedCount);
    }

    [Fact]
    public void ContextLines_AreNotCounted()
    {
        var h = new DiffHunk(1, 3, 1, 3,
            new[] { " a", "-b", " c" }, new[] { " a", "+b2", " c" });
        Assert.Equal(1, h.AddedCount);
        Assert.Equal(1, h.DeletedCount);
    }

    [Fact]
    public void Empty_IsEmptyLists()
    {
        Assert.Empty(DiffHunk.Empty.OldLines);
        Assert.Empty(DiffHunk.Empty.NewLines);
        Assert.Equal(0, DiffHunk.Empty.OldCount);
    }
}

public sealed class DiffResultTests
{
    [Fact]
    public void StatusCode_NewFile_IsA()
    {
        var d = new DiffResult("a.txt", "a.txt", false, true, false, false, Array.Empty<DiffHunk>(), 5, 0);
        Assert.Equal('A', d.StatusCode);
        Assert.False(d.IsModified);
    }

    [Fact]
    public void StatusCode_DeletedFile_IsD()
    {
        var d = new DiffResult("a.txt", "a.txt", false, false, true, false, Array.Empty<DiffHunk>(), 0, 5);
        Assert.Equal('D', d.StatusCode);
        Assert.False(d.IsModified);
    }

    [Fact]
    public void StatusCode_Renamed_IsR()
    {
        var d = new DiffResult("new.txt", "old.txt", false, false, false, true, Array.Empty<DiffHunk>(), 0, 0);
        Assert.Equal('R', d.StatusCode);
    }

    [Fact]
    public void StatusCode_Modified_IsM()
    {
        var d = new DiffResult("a.txt", "a.txt", false, false, false, false, Array.Empty<DiffHunk>(), 2, 1);
        Assert.Equal('M', d.StatusCode);
        Assert.True(d.IsModified);
    }

    [Fact]
    public void StatusCode_BinaryStillClassifiedByChangeType()
    {
        var d = new DiffResult("img.png", "img.png", true, false, false, false, Array.Empty<DiffHunk>(), 0, 0);
        Assert.Equal('M', d.StatusCode);
    }

    [Fact]
    public void FileMode_OctalValuesMatchGit()
    {
        Assert.Equal(33188, (int)CoreFileMode.NonExecutable); // 100644
        Assert.Equal(33261, (int)CoreFileMode.Executable);    // 100755
        Assert.Equal(16384, (int)CoreFileMode.Tree);          // 040000
    }
}

public sealed class BranchRefTests
{
    [Fact]
    public void UnbornBranch_HasNullSha()
    {
        var b = new BranchRef("main", null, true, false, true);
        Assert.Null(b.Sha);
        Assert.True(b.IsHead);
    }

    [Fact]
    public void RemoteBranch_FlaggedRemote_NotLocal()
    {
        var b = new BranchRef("origin/main", "abc", false, true, false);
        Assert.True(b.IsRemote);
        Assert.False(b.IsLocal);
    }
}
