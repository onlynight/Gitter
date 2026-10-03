using GitUI.Core.Models;
using GitUI.Git;
using Xunit;

namespace GitUI.ViewModels.Tests;

/// <summary>S7 通用 git diff：任意两提交的树对比（design.md §4.2 P1"任意两点比较"）。</summary>
public sealed class TreeDiffTests : IDisposable
{
    private readonly GitFixtureBuilder _builder;

    public TreeDiffTests()
    {
        var dir = Path.Combine(Path.GetTempPath(), "gitui-treediff-" + Guid.NewGuid().ToString("N"));
        _builder = GitFixtureBuilder.Init(dir, "main");
    }

    public void Dispose() => _builder.Dispose();

    private LibGit2RepositoryService Svc { get; } = new();

    [Fact]
    public void TreeDiff_BetweenNonParentCommits()
    {
        // A：加 a.txt 和 b.txt；B：改两者；C：删 b.txt、改 a.txt、加 c.txt
        var a = _builder.Commit("A", ("a.txt", "v1\n"), ("b.txt", "b\n"));
        _builder.Commit("B", ("a.txt", "v2\n"), ("b.txt", "b2\n"));
        _builder.Delete("b.txt");
        _builder.Stage("b.txt"); // 暂存删除（Delete 只删工作区）
        _builder.Commit("C", ("a.txt", "v3\n"), ("c.txt", "c\n"));

        // A → C（链上祖孙，非直接父子）
        var diff = Svc.GetTreeDiff(_builder.WorkDir, a, _builder.Sha("HEAD"));
        Assert.Equal(3, diff.Count);
        Assert.Contains(diff, d => d.Path == "a.txt" && d.IsModified && d.AddedLines == 1 && d.DeletedLines == 1);
        Assert.Contains(diff, d => d.Path == "b.txt" && d.IsDeleted);
        Assert.Contains(diff, d => d.Path == "c.txt" && d.IsNew);
    }

    [Fact]
    public void TreeDiff_ReverseDirection_SwapsSides()
    {
        var a = _builder.Commit("A", ("a.txt", "v1\n"));
        _builder.Commit("B", ("a.txt", "v2\n"), ("b.txt", "b\n"));

        var forward = Svc.GetTreeDiff(_builder.WorkDir, a, _builder.Sha("HEAD"));
        var backward = Svc.GetTreeDiff(_builder.WorkDir, _builder.Sha("HEAD"), a);

        Assert.Equal(2, forward.Count);
        Assert.Equal(2, backward.Count);
        // 方向反转：新文件变删除文件
        Assert.Contains(forward, d => d.Path == "b.txt" && d.IsNew);
        Assert.Contains(backward, d => d.Path == "b.txt" && d.IsDeleted);
    }

    [Fact]
    public void TreeDiff_IdenticalTrees_Empty()
    {
        var a = _builder.Commit("A", ("a.txt", "v1\n"));
        _builder.Commit("B"); // 空提交：不同 SHA、相同树

        var diff = Svc.GetTreeDiff(_builder.WorkDir, a, _builder.Sha("HEAD"));
        Assert.Empty(diff);
    }

    [Fact]
    public void TreeDiff_UnknownSha_Throws()
    {
        _builder.Commit("A", ("a.txt", "1\n"));
        Assert.Throws<InvalidOperationException>(() =>
            Svc.GetTreeDiff(_builder.WorkDir, _builder.Sha("HEAD"), new string('0', 40)));
    }

    [Fact]
    public async Task CompareBase_FlowsThroughSelect()
    {
        var a = _builder.Commit("A", ("a.txt", "v1\n"), ("b.txt", "b\n"));
        _builder.Commit("B", ("a.txt", "v2\n"), ("b.txt", "b2\n"));
        _builder.Delete("b.txt");
        _builder.Stage("b.txt");
        _builder.Commit("C", ("a.txt", "v3\n"), ("c.txt", "c\n"));

        var vm = new LogViewModel(Svc);
        await vm.OpenRepositoryAsync(_builder.WorkDir);

        // 默认：C 对父提交 B —— a.txt 修改 + b.txt 删除 + c.txt 新增
        var c = vm.Groups.SelectMany(g => g.Commits).First(x => x.Subject == "C");
        await vm.SelectAsync(c);
        Assert.Equal(["a.txt", "b.txt", "c.txt"], vm.SelectedFiles.Select(f => f.Path).OrderBy(p => p).ToList());

        // 设 A 为基准：C 对 A —— a.txt 修改 + b.txt 删除 + c.txt 新增
        var nodeA = vm.Groups.SelectMany(g => g.Commits).First(x => x.Subject == "A");
        vm.SetCompareBase(nodeA);
        Assert.Equal(nodeA, vm.CompareBase);

        // SetCompareBase 内部会重载当前选中
        await Task.Delay(50); // SetCompareBase 触发的 SelectAsync 是 fire-and-forget，等待其完成
        var retry = 0;
        while (vm.SelectedFiles.Count < 3 && retry++ < 50) await Task.Delay(20);
        Assert.Equal(3, vm.SelectedFiles.Count);
        Assert.Contains(vm.SelectedFiles, f => f.Path == "b.txt" && f.IsDeleted);
        Assert.Contains(vm.SelectedFiles, f => f.Path == "a.txt" && f.IsModified);

        // 点基准提交本身 → 回退父 diff（A 是根，无父 → 空）
        await vm.SelectAsync(nodeA);
        Assert.Empty(vm.SelectedFiles);

        // 清除基准 → 恢复父 diff
        vm.SetCompareBase(null);
        await vm.SelectAsync(c);
        Assert.Equal(["a.txt", "b.txt", "c.txt"], vm.SelectedFiles.Select(f => f.Path).OrderBy(p => p).ToList());
        Assert.Null(vm.CompareBase);
    }
}
