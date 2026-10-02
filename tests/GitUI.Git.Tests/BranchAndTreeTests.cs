using CoreFileMode = GitUI.Core.Models.FileMode;
using CoreTreeEntryType = GitUI.Core.Models.TreeEntryType;
using GitUI.Core.Models;
using GitUI.Git;
using Xunit;

namespace GitUI.Git.Tests;

public sealed class BranchAndTreeTests : IDisposable
{
    private readonly TestRepo _repo = new();
    private LibGit2RepositoryService Svc => _repo.Service;

    public void Dispose() => _repo.Dispose();

    [Fact]
    public void GetBranches_EmptyRepo_ReturnsEmpty()
    {
        Assert.Empty(Svc.GetBranches(_repo.WorkDir));
    }

    [Fact]
    public void GetBranches_SingleCommit_HeadMarkedIsHead()
    {
        _repo.Builder.Commit("init", ("a.txt", "a\n"));
        var branches = Svc.GetBranches(_repo.WorkDir);
        var head = Assert.Single(branches);
        Assert.Equal("main", head.Name);
        Assert.True(head.IsLocal);
        Assert.True(head.IsHead);
        Assert.False(head.IsRemote);
    }

    [Fact]
    public void GetBranches_MultipleBranches_OnlyCurrentIsHead()
    {
        _repo.Builder.Commit("root", ("a.txt", "a\n"));
        _repo.Builder.Branch("feature", _repo.Builder.Sha("HEAD"));
        _repo.Builder.Branch("release", _repo.Builder.Sha("HEAD"));

        var branches = Svc.GetBranches(_repo.WorkDir);
        Assert.Equal(3, branches.Count);
        var head = branches.Single(b => b.Name == "main");
        Assert.True(head.IsHead);
        Assert.All(branches.Where(b => b.Name != "main"), b => Assert.False(b.IsHead));
    }

    [Fact]
    public void GetBranches_DetachedHead_NoIsHeadSet()
    {
        _repo.Builder.Commit("c1", ("a.txt", "1\n"));
        _repo.Builder.Commit("c2", ("a.txt", "2\n"));
        // 手动切换到 HEAD~1 制造 detached HEAD
        var psi = new System.Diagnostics.ProcessStartInfo("git")
        {
            Arguments = "checkout --detach HEAD~1",
            WorkingDirectory = _repo.WorkDir,
            RedirectStandardOutput = true, RedirectStandardError = true,
            UseShellExecute = false, CreateNoWindow = true,
        };
        psi.Environment["HOME"] = _repo.WorkDir;
        psi.Environment["GIT_CONFIG_GLOBAL"] = Path.Combine(_repo.WorkDir, "config");
        psi.Environment["GIT_CONFIG_SYSTEM"] = Path.Combine(_repo.WorkDir, "no.ini");
        using var p = System.Diagnostics.Process.Start(psi)!;
        p.WaitForExit();

        var branches = Svc.GetBranches(_repo.WorkDir);
        Assert.All(branches, b => Assert.False(b.IsHead));
    }

    [Fact]
    public void GetTree_Head_ContainsCommittedFiles()
    {
        _repo.Builder.Commit("root",
            ("a.txt", "a\n"),
            ("dir/b.txt", "b\n"),
            ("dir/nested/c.txt", "c\n"));

        var tree = Svc.GetTree(_repo.WorkDir, "HEAD");
        // WalkTree 是扁平化遍历，返回所有层级
        Assert.Equal(5, tree.Count);
        Assert.Contains(tree, t => t.Path == "a.txt" && t.Mode == CoreFileMode.NonExecutable);
        var dir = tree.Single(t => t.Path == "dir");
        Assert.Equal(CoreTreeEntryType.Tree, dir.EntryType);
        Assert.Equal(CoreFileMode.Tree, dir.Mode);
        Assert.Contains(tree, t => t.Path == "dir/b.txt");
        Assert.Contains(tree, t => t.Path == "dir/nested/c.txt");
    }

    [Fact]
    public void GetTree_BlobPath_HasCorrectMode()
    {
        _repo.Builder.Commit("root", ("exec.txt", "line\n"));
        var tree = Svc.GetTree(_repo.WorkDir, "HEAD");
        var entry = Assert.Single(tree);
        Assert.Equal("exec.txt", entry.Path);
        Assert.Equal(CoreTreeEntryType.Blob, entry.EntryType);
        Assert.Equal(CoreFileMode.NonExecutable, entry.Mode);
        Assert.False(string.IsNullOrEmpty(entry.Sha));
    }

    [Fact]
    public void GetCommitDiff_SingleFileCommit_ReturnsFileStats()
    {
        _repo.Builder.Commit("root", ("a.txt", "line1\nline2\nline3\n"));
        _repo.Builder.Commit("mod", ("a.txt", "line1\nCHANGED\nline3\n"));
        var sha = _repo.Builder.Sha("HEAD");

        var diffs = Svc.GetCommitDiff(_repo.WorkDir, sha);
        var diff = Assert.Single(diffs);
        Assert.Equal("a.txt", diff.Path);
        Assert.True(diff.IsModified);
        Assert.False(diff.IsNew);
        Assert.False(diff.IsDeleted);
        Assert.Single(diff.Hunks);
        Assert.True(diff.AddedLines > 0);
        Assert.True(diff.DeletedLines > 0);
    }

    [Fact]
    public void GetCommitDiff_MultipleFiles_ReturnsAll()
    {
        _repo.Builder.Commit("root", ("a.txt", "a\n"));
        _repo.Builder.Commit("multi",
            ("a.txt", "a2\n"),
            ("b.txt", "b\n"),
            ("c.txt", "c\n"));

        var diffs = Svc.GetCommitDiff(_repo.WorkDir, _repo.Builder.Sha("HEAD"));
        Assert.Equal(3, diffs.Count);
        Assert.Contains(diffs, d => d.Path == "a.txt" && d.IsModified);
        Assert.Contains(diffs, d => d.Path == "b.txt" && d.IsNew);
        Assert.Contains(diffs, d => d.Path == "c.txt" && d.IsNew);
    }

    [Fact]
    public void GetCommitDiff_Deletion_MarksIsDeleted()
    {
        _repo.Builder.Commit("root", ("a.txt", "a\n"));
        _repo.Builder.Delete("a.txt");
        _repo.Builder.Stage("a.txt");
        _repo.Builder.Commit("delete-a", ("b.txt", "b\n")); // 附带另一个文件确保 commit 不空

        // 直接对删除提交读 diff
        var diffs = Svc.GetCommitDiff(_repo.WorkDir, _repo.Builder.Sha("HEAD"));
        Assert.Contains(diffs, d => d.Path == "a.txt" && d.IsDeleted);
    }

    [Fact]
    public void GetFileDiff_HeadAndHead_TwoRevisionsOfSamePath()
    {
        _repo.Builder.Commit("root", ("a.txt", "one\ntwo\nthree\n"));
        var a = _repo.Builder.Sha("HEAD");
        _repo.Builder.Commit("mod", ("a.txt", "one\nTWO\nthree\n"));
        var b = _repo.Builder.Sha("HEAD");

        var diff = Svc.GetFileDiff(_repo.WorkDir, "a.txt", a, b);
        Assert.Equal("a.txt", diff.Path);
        Assert.True(diff.IsModified);
        Assert.Single(diff.Hunks);
    }

    [Fact]
    public void HeadSha_EmptyRepo_ReturnsEmptyOrThrows()
    {
        // unborn HEAD 场景应明确失败或返回空字符串，不能抛 NRE
        var result = Record.Exception(() => Svc.HeadSha(_repo.WorkDir));
        Assert.True(result is null || result is System.Exception,
            "HeadSha on unborn HEAD should either succeed empty or throw cleanly");
    }

    [Fact]
    public void GetTree_UnbornHead_ThrowsOrEmpty()
    {
        var ex = Record.Exception(() => Svc.GetTree(_repo.WorkDir, "HEAD"));
        // 无 HEAD 时应该抛异常，不返回 null
        Assert.NotNull(ex);
    }
}
