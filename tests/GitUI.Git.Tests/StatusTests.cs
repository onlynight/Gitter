using GitUI.Core.Models;
using GitUI.Git;
using Xunit;

namespace GitUI.Git.Tests;

public sealed class StatusTests : IDisposable
{
    private readonly TestRepo _repo = new();
    private LibGit2RepositoryService Svc => _repo.Service;

    public void Dispose() => _repo.Dispose();

    private void CommitBase()
    {
        _repo.Builder.Commit("init", ("tracked.txt", "v1\n"));
    }

    [Fact]
    public void GetStatus_EmptyRepo_ReturnsEmpty()
    {
        Assert.Empty(Svc.GetStatus(_repo.WorkDir));
    }

    [Fact]
    public void GetStatus_CleanTree_ReturnsEmpty()
    {
        CommitBase();
        Assert.Empty(Svc.GetStatus(_repo.WorkDir));
    }

    [Fact]
    public void GetStatus_ModifiedTracked_IsChanges()
    {
        CommitBase();
        _repo.Builder.Write("tracked.txt", "v2\n");
        var statuses = Svc.GetStatus(_repo.WorkDir);
        var s = Assert.Single(statuses);
        Assert.Equal("tracked.txt", s.Path);
        Assert.Equal(StatusCategory.Changes, s.Category);
        Assert.False(s.IsConflict);
    }

    [Fact]
    public void GetStatus_StageNewFile_IsStaged()
    {
        CommitBase();
        _repo.Builder.Write("new.txt", "n\n");
        _repo.Builder.Stage("new.txt");
        var s = Assert.Single(Svc.GetStatus(_repo.WorkDir));
        Assert.Equal("new.txt", s.Path);
        Assert.Equal(StatusCategory.Staged, s.Category);
    }

    [Fact]
    public void GetStatus_StageModification_IsStaged()
    {
        CommitBase();
        _repo.Builder.Write("tracked.txt", "v2\n");
        _repo.Builder.Stage("tracked.txt");
        var s = Assert.Single(Svc.GetStatus(_repo.WorkDir));
        Assert.Equal(StatusCategory.Staged, s.Category);
    }

    [Fact]
    public void GetStatus_UntrackedNewFile_IsUnversioned()
    {
        CommitBase();
        _repo.Builder.Write("stray.txt", "s\n");
        var s = Assert.Single(Svc.GetStatus(_repo.WorkDir));
        Assert.Equal("stray.txt", s.Path);
        Assert.Equal(StatusCategory.Unversioned, s.Category);
    }

    [Fact]
    public void GetStatus_DeletedTracked_IsChanges()
    {
        CommitBase();
        _repo.Builder.Delete("tracked.txt");
        var s = Assert.Single(Svc.GetStatus(_repo.WorkDir));
        Assert.Equal(StatusCategory.Changes, s.Category);
    }

    [Fact]
    public void GetStatus_StagedAndModifiedInWorkdir_ProducesBothEntries()
    {
        CommitBase();
        _repo.Builder.Write("tracked.txt", "v2\n");
        _repo.Builder.Stage("tracked.txt");
        _repo.Builder.Write("tracked.txt", "v3\n");
        // index 有 v2，工作区有 v3 —— 两层都有改动
        var statuses = Svc.GetStatus(_repo.WorkDir).ToList();
        Assert.Contains(statuses, s => s.Category == StatusCategory.Staged);
        Assert.Contains(statuses, s => s.Category == StatusCategory.Changes);
    }

    [Fact]
    public void GetStatus_UntrackedInSubdirectory_IsFound()
    {
        CommitBase();
        _repo.Builder.Write("sub/dir/deep.txt", "d\n");
        var s = Assert.Single(Svc.GetStatus(_repo.WorkDir));
        Assert.Equal("sub/dir/deep.txt", s.Path);
        Assert.Equal(StatusCategory.Unversioned, s.Category);
    }

    [Fact]
    public void GetStatus_MixedScenarios_ClassifiesEachCorrectly()
    {
        CommitBase();
        // 修改已跟踪
        _repo.Builder.Write("tracked.txt", "modified\n");
        // 新增未跟踪
        _repo.Builder.Write("brand-new.txt", "new\n");
        // 新增并 stage
        _repo.Builder.Write("staged-new.txt", "s\n");
        _repo.Builder.Stage("staged-new.txt");
        // 删除已跟踪
        _repo.Builder.Delete("tracked.txt");

        var statuses = Svc.GetStatus(_repo.WorkDir);
        Assert.Contains(statuses, s => s.Path == "brand-new.txt" && s.Category == StatusCategory.Unversioned);
        Assert.Contains(statuses, s => s.Path == "staged-new.txt" && s.Category == StatusCategory.Staged);
        Assert.Contains(statuses, s => s.Path == "tracked.txt" && s.Category == StatusCategory.Changes);
    }

    [Fact]
    public void GetStatus_IgnoredFiles_AreNotReturned()
    {
        CommitBase();
        // 写 .gitignore
        var gitignore = Path.Combine(_repo.WorkDir, ".gitignore");
        File.WriteAllText(gitignore, "ignored.txt\n");
        _repo.Builder.Commit("ignore rules", ("tracked.txt", "v2\n"));
        _repo.Builder.Write("ignored.txt", "should not appear\n");
        var statuses = Svc.GetStatus(_repo.WorkDir);
        Assert.DoesNotContain(statuses, s => s.Path == "ignored.txt");
    }

    [Fact]
    public void GetStatus_RenamedFile_IsClassified()
    {
        CommitBase();
        var path = Path.Combine(_repo.WorkDir, "renamed.txt");
        File.Move(Path.Combine(_repo.WorkDir, "tracked.txt"), path);
        var statuses = Svc.GetStatus(_repo.WorkDir);
        Assert.NotEmpty(statuses);
    }
}
