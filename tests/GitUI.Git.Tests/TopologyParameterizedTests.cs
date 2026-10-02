using GitUI.Core.Models;
using GitUI.Git;
using Xunit;

namespace GitUI.Git.Tests;

/// <summary>
/// 20 个不同拓扑的集成测试。每个拓扑由 <see cref="RandomizedFixtureGenerator"/> 生成，
/// 测试断言在 GitWorker 之上跑通：GetLog 页数、ParentShas、IsMerge 计数、HEAD 父链可达性。
/// </summary>
public sealed class TopologyParameterizedTests
{
    public static readonly TheoryData<string> TopologyIds = new();

    static TopologyParameterizedTests()
    {
        foreach (var spec in RandomizedFixtureGenerator.Generate20())
            TopologyIds.Add(spec.Id);
    }

    [Theory]
    [MemberData(nameof(TopologyIds))]
    public void Topology_BuildsAndLogRoundTrips(string topologyId)
    {
        var spec = RandomizedFixtureGenerator.Generate20().Single(s => s.Id == topologyId);
        using var repo = new TestRepo();

        var rng = new Random(42);
        spec.Builder(repo.Builder, rng);

        var svc = repo.Service;
        var head = svc.HeadSha(repo.WorkDir);
        Assert.False(string.IsNullOrEmpty(head), $"{topologyId}: HEAD 应为非空");

        // 分页遍历必须覆盖全部提交且不重复
        var all = new List<CommitNode>();
        const int pageSize = 25;
        for (int skip = 0; ; skip += pageSize)
        {
            var page = svc.GetLog(repo.WorkDir, new LogFilter(Limit: pageSize, Skip: skip));
            Assert.All(page.Items, c => Assert.False(string.IsNullOrEmpty(c.Sha)));
            all.AddRange(page.Items);
            if (!page.HasMore) break;
        }

        Assert.NotEmpty(all);

        // 无重复 SHA
        var shas = all.Select(c => c.Sha).ToHashSet();
        Assert.Equal(all.Count, shas.Count);

        // HEAD 一定在 log 里
        Assert.Contains(all, c => c.Sha == head);

        // 每个非 root 提交的父 SHA 都能在集合里找到
        foreach (var c in all.Where(c => !c.IsRoot))
        {
            foreach (var p in c.ParentShas)
            {
                Assert.True(shas.Contains(p), $"{topologyId}: {c.ShortSha} 的父 {p} 应该在集合里");
            }
        }

        // 合并数（>=1 个父以外的提交数）与拓扑预期一致
        if (spec.ExpectedMergeCount is int expectedMerges && expectedMerges > 0)
        {
            var actualMerges = all.Count(c => c.IsMerge);
            Assert.True(actualMerges >= expectedMerges,
                $"{topologyId}: 期望合并数 >= {expectedMerges}，实际 {actualMerges}");
        }

        // GetCommit 能按 SHA 反向查找 HEAD
        var headNode = svc.GetCommit(repo.WorkDir, head);
        Assert.NotNull(headNode);
        Assert.Equal(head, headNode!.Sha);
    }

    [Theory]
    [MemberData(nameof(TopologyIds))]
    public void Topology_GetStatus_CleanAfterCommit(string topologyId)
    {
        var spec = RandomizedFixtureGenerator.Generate20().Single(s => s.Id == topologyId);
        using var repo = new TestRepo();
        spec.Builder(repo.Builder, new Random(7));

        // 大多数拓扑 builder 已把所有变更提交，故工作区应干净。
        // 例外：CherryPickConflict（设计上就是让 cherry-pick 冲突后不提交）→ 忽略。
        if (topologyId == "cherry-pick-conflict") return;
        var statuses = repo.Service.GetStatus(repo.WorkDir);
        Assert.Empty(statuses);
    }
}
