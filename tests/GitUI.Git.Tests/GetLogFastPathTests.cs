using GitUI.Core.Models;
using GitUI.Git;
using Xunit;

namespace GitUI.Git.Tests;

/// <summary>
/// S4 GetLog 快路径（大仓库、无过滤查询：git rev-list --count + --skip/--max-count 窗口）
/// 与全量遍历路径的结果一致性。带过滤的查询仍走全量路径，用 author 过滤命中全部
/// 提交来构造"结果相同、路径不同"的对照。
/// 快路径仅对 pack idx ≥ 128KB 的大仓库启用（2000 提交的 idx 只有 ~52KB 走不到
/// CLI 路径，曾使本测试退化为两侧都走慢路径），故 fixture 用 fast-import 灌 10k 提交。
/// </summary>
public sealed class GetLogFastPathTests : IDisposable
{
    private const int BulkCount = 10_000;
    private readonly TestRepo _repo;

    public GetLogFastPathTests()
    {
        _repo = new TestRepo();
        _repo.Builder.BulkCommits(BulkCount);
    }

    public void Dispose() => _repo.Dispose();

    [Fact]
    public void Unfiltered_MatchesFilteredAllAuthor_PageAndTotal()
    {
        // 快路径：无过滤
        var fast = _repo.Service.GetLog(_repo.WorkDir, new LogFilter(Limit: 3, Skip: 0));
        // 全量路径：author 过滤命中所有提交（fixture 作者统一为 Fixture）
        var slow = _repo.Service.GetLog(_repo.WorkDir, new LogFilter(Author: "Fixture", Limit: 3, Skip: 0));

        Assert.Equal(slow.TotalCount, fast.TotalCount);
        Assert.Equal(BulkCount, fast.TotalCount);
        Assert.Equal(
            fast.Items.Select(c => c.Sha).ToArray(),
            slow.Items.Select(c => c.Sha).ToArray());
        Assert.Equal(3, fast.Items.Count);
    }

    [Fact]
    public void Unfiltered_SkipPages_NoOverlapAndComplete()
    {
        var pages = new List<string>();
        for (int skip = 0; skip < 150; skip += 50)
        {
            var page = _repo.Service.GetLog(_repo.WorkDir, new LogFilter(Limit: 50, Skip: skip));
            pages.AddRange(page.Items.Select(c => c.Sha));
            Assert.Equal(BulkCount, page.TotalCount);
        }

        Assert.Equal(150, pages.Distinct().Count());
    }

    [Fact]
    public void Unfiltered_LastPage_ShortAndHasMoreFalse()
    {
        var page = _repo.Service.GetLog(_repo.WorkDir, new LogFilter(Limit: 50, Skip: BulkCount - 10));
        Assert.Equal(10, page.Items.Count);
        Assert.Equal(BulkCount, page.TotalCount);
        Assert.False(page.HasMore);
    }

    [Fact]
    public void Unfiltered_WithBranchParam_CountMatchesWalk()
    {
        // fast-import 只写了 main；在 main 头上追加分支与提交
        _repo.Builder.Commit("extra-on-main", ("g.txt", "x\n"));
        var baseSha = _repo.Builder.Sha("main");
        _repo.Builder.Branch("side", baseSha);
        _repo.Builder.Checkout("side");
        _repo.Builder.Commit("on-side", ("g.txt", "y\n"));
        _repo.Builder.Checkout("main");
        _repo.Builder.Commit("on-main", ("g.txt", "z\n"));

        var side = _repo.Service.GetLog(_repo.WorkDir, new LogFilter(Branch: "side", Limit: 10));
        Assert.Equal(BulkCount + 2, side.TotalCount); // 基线 + base 追加 + on-side
        Assert.Equal(10, side.Items.Count);
        Assert.Equal("on-side", side.Items[0].Subject);

        var head = _repo.Service.GetLog(_repo.WorkDir, new LogFilter(Limit: 10));
        Assert.Equal(BulkCount + 2, head.TotalCount);
        Assert.Equal("on-main", head.Items[0].Subject);
    }
}
