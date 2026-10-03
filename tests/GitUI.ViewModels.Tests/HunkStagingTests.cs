using GitUI.Core.Models;
using GitUI.Core.Services;
using GitUI.Git;
using Xunit;

namespace GitUI.ViewModels.Tests;

/// <summary>
/// design.md §8-S5 核心验收："hunk 暂存 → 提交 → 断言只包含该 hunk"。
/// 通过 <see cref="UnifiedPatch"/> 分块 + 服务层 ApplyIndexPatch（git apply --cached）走完整链路。
/// </summary>
public sealed class HunkStagingTests : IDisposable
{
    private readonly GitFixtureBuilder _builder;
    private readonly ChangesViewModel _vm;
    private readonly LibGit2RepositoryService _svc;

    public HunkStagingTests()
    {
        var dir = Path.Combine(Path.GetTempPath(), "gitui-hunk-test-" + Guid.NewGuid().ToString("N"));
        _builder = GitFixtureBuilder.Init(dir, "main");
        _svc = new LibGit2RepositoryService();
        _vm = new ChangesViewModel(_svc);
    }

    public void Dispose() => _builder.Dispose();

    [Fact]
    public async Task StageSingleHunk_ThenCommit_HeadContainsOnlyThatHunk()
    {
        var content = string.Concat(Enumerable.Range(1, 10).Select(i => $"l{i}\n"));
        _builder.Commit("base", ("f.txt", content));
        var baseSha = _builder.Sha("HEAD");

        // 两处修改（相隔 ≥ 2×context+1 行 → 两个独立 hunk）
        var modified = content.Replace("l2\n", "L2\n").Replace("l10\n", "L10\n");
        _builder.Write("f.txt", modified);
        await _vm.OpenRepositoryAsync(_builder.WorkDir);

        await _vm.SelectAsync(_vm.Changes[0]);
        var view = _vm.SelectedDiff;
        Assert.NotNull(view);
        Assert.Equal(2, view!.PatchChunks.Count);

        // 只暂存第二个 hunk（l10 → L10）
        await _vm.StageHunksAsync(new[] { 1 });
        // 暂存后刷新，剩余未暂存 diff 只剩第一个 hunk
        Assert.NotNull(_vm.SelectedDiff);
        Assert.Single(_vm.SelectedDiff!.Hunks);

        // 提交
        var outcome = await _vm.CommitAsync("test: only second hunk", push: false);
        Assert.NotNull(outcome);
        Assert.Equal(baseSha, _builder.Sha("HEAD~1"));

        var headContent = _builder.ShowFile("HEAD", "f.txt");
        Assert.Contains("\nl2\n", headContent);    // 第一个 hunk 未提交（l2 原样）
        Assert.DoesNotContain("L2", headContent);
        Assert.EndsWith("L10", headContent);       // 第二个 hunk 已提交（尾换行经 TrimEnd）

        // 工作区仍保留第一个 hunk 的修改
        Assert.Contains("L2\n", File.ReadAllText(Path.Combine(_builder.WorkDir, "f.txt")));
        await _vm.RefreshAsync();
        Assert.Single(_vm.Changes); // l2 的修改留在 Changes 层
    }

    [Fact]
    public async Task UnstageSingleHunk_FromStaged_RemovesItFromIndex()
    {
        var content = string.Concat(Enumerable.Range(1, 10).Select(i => $"l{i}\n"));
        _builder.Commit("base", ("f.txt", content));

        var modified = content.Replace("l2\n", "L2\n").Replace("l10\n", "L10\n");
        _builder.Write("f.txt", modified);
        _builder.Stage("f.txt");   // 两处修改全部暂存
        await _vm.OpenRepositoryAsync(_builder.WorkDir);

        await _vm.SelectAsync(_vm.Staged[0]);
        var view = _vm.SelectedDiff;
        Assert.NotNull(view);
        Assert.True(view!.IsStagedView);
        Assert.Equal(2, view.PatchChunks.Count);

        // 反向应用第一个 hunk（撤销 l2 的暂存）
        await _vm.StageHunksAsync(new[] { 0 });

        // 刷新后层分布：l2 的修改（工作区 vs index）留在 Changes 层，
        // l10 的修改（index vs HEAD）留在 Staged 层
        await _vm.RefreshAsync();
        Assert.Single(_vm.Changes);
        Assert.Single(_vm.Staged);
        Assert.Equal("f.txt", _vm.Changes[0].Path);
        Assert.Equal("f.txt", _vm.Staged[0].Path);
    }

    [Fact]
    public async Task StageHunks_OnCorruptedPatch_SurfacesErrorWithoutStateChange()
    {
        // 内容不匹配的 patch 会被 git apply 拒绝，错误上浮且 index 不变
        _builder.Commit("base", ("f.txt", "a\nb\nc\n"));
        await _vm.OpenRepositoryAsync(_builder.WorkDir);

        var bogus = "diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n a\n-x\n+b\n c\n";
        await Assert.ThrowsAsync<GitOperationException>(() =>
            Task.Run(() => _svc.ApplyIndexPatch(_builder.WorkDir, bogus, reverse: false)));
    }
}
