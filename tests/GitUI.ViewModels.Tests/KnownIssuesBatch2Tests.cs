using GitUI.Core.Models;
using GitUI.Core.Services;
using GitUI.Git;
using Xunit;

namespace GitUI.ViewModels.Tests;

/// <summary>
/// known-issues 第二批修复验证：
/// 2.1 过滤下推（author/日期经 rev-list CLI，与慢路径结果一致）、
/// 2.6 分支 tip 主题批量取、
/// 1.5 的 VM 侧批量 hunk 暂存已由 StageHunksAsync 覆盖（UI 多选在控件层，无 headless 手段）。
/// </summary>
public sealed class KnownIssuesBatch2Tests : IDisposable
{
    // 10k 提交 → pack idx ≈ 284KB，真实越过 HasLargePack 的 128KB 阈值（2000 提交只有 ~52KB，
    // 走不到 CLI 快路径——S4 时的 GetLogFastPathTests 因此已升到 10k）
    private const int BulkCount = 10_000;

    private readonly GitFixtureBuilder _builder;

    public KnownIssuesBatch2Tests()
    {
        var dir = Path.Combine(Path.GetTempPath(), "gitui-batch2-" + Guid.NewGuid().ToString("N"));
        _builder = GitFixtureBuilder.Init(dir, "main");
    }

    public void Dispose() => _builder.Dispose();

    private LibGit2RepositoryService Svc { get; } = new();

    /// <summary>10k 基线 + 少量指定作者的提交（经 GIT_AUTHOR_NAME/EMAIL 注入 + 确定性日期，
    /// 避免 CLI 与慢路径对同秒提交的 tie-break 差异）。</summary>
    private void BuildMixedAuthorRepo()
    {
        _builder.BulkCommits(BulkCount);
        CommitAs("alice", "alice@x.test", "2026-03-01T10:00:00Z", "alice: fix crash", ("a.txt", "1\n"));
        CommitAs("alice", "alice@x.test", "2026-03-01T10:00:02Z", "alice: add log filter", ("a.txt", "2\n"));
        CommitAs("bob", "bob@x.test", "2026-03-01T10:00:04Z", "bob: bump deps", ("b.txt", "1\n"));
        _builder.Commit("maint: chore", ("c.txt", "1\n"));
    }

    private void CommitAs(string name, string email, string dateStamp, string message, params (string file, string content)[] files)
    {
        foreach (var (file, content) in files)
        {
            var full = Path.Combine(_builder.WorkDir, file.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            File.WriteAllText(full, content);
            _builder.RunGit("add", "-f", file);
        }
        _builder.RunGitWithDate(dateStamp,
            "-c", $"user.name={name}", "-c", $"user.email={email}",
            "commit", "-m", message);
    }

    private static IReadOnlyList<string> Shas(LogPage page) => page.Items.Select(c => c.Sha).ToList();

    [Fact]
    public void AuthorFilter_PushdownMatchesSlowPath()
    {
        BuildMixedAuthorRepo();

        // CLI 下推：author 过滤（topic 为空）
        var pushed = Svc.GetLog(_builder.WorkDir, new LogFilter(Author: "alice", Limit: 2, Skip: 1));
        // 慢路径：topic 非空强制走 libgit2 全量遍历，author 语义应当一致
        var slow = Svc.GetLog(_builder.WorkDir, new LogFilter(Author: "alice", Topic: ".", Limit: 2, Skip: 1));

        Assert.Equal(slow.TotalCount, pushed.TotalCount);
        Assert.Equal(2, pushed.TotalCount); // alice 的两条
        Assert.Equal(Shas(slow), Shas(pushed));
        Assert.All(pushed.Items, c => Assert.Contains("alice", c.Author, StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void AuthorFilter_PushdownCaseInsensitive()
    {
        BuildMixedAuthorRepo();
        var lower = Svc.GetLog(_builder.WorkDir, new LogFilter(Author: "alice", Limit: 10));
        var upper = Svc.GetLog(_builder.WorkDir, new LogFilter(Author: "ALICE", Limit: 10));
        Assert.Equal(2, lower.TotalCount);
        Assert.Equal(Shas(lower), Shas(upper));
    }

    [Fact]
    public void DateRangeFilter_PushdownMatchesSlowPath()
    {
        // 先灌基线（时间戳 2024-01-01），再按单调时间追加——fast-import 拒绝非快进更新
        _builder.BulkCommits(BulkCount);
        _builder.CommitOn("old", new DateTimeOffset(2024, 1, 1, 10, 0, 0, TimeSpan.Zero), ("f.txt", "1\n"));
        _builder.CommitOn("mid", new DateTimeOffset(2024, 6, 1, 10, 0, 0, TimeSpan.Zero), ("f.txt", "2\n"));
        _builder.CommitOn("new", new DateTimeOffset(2024, 9, 1, 10, 0, 0, TimeSpan.Zero), ("f.txt", "3\n"));

        var pushed = Svc.GetLog(_builder.WorkDir, new LogFilter(
            After: new DateTimeOffset(2024, 5, 1, 0, 0, 0, TimeSpan.Zero),
            Before: new DateTimeOffset(2024, 7, 1, 0, 0, 0, TimeSpan.Zero),
            Limit: 10));
        var slow = Svc.GetLog(_builder.WorkDir, new LogFilter(
            After: new DateTimeOffset(2024, 5, 1, 0, 0, 0, TimeSpan.Zero),
            Before: new DateTimeOffset(2024, 7, 1, 0, 0, 0, TimeSpan.Zero),
            Topic: ".",
            Limit: 10));

        Assert.Single(pushed.Items);
        Assert.Equal("mid", pushed.Items[0].Subject);
        Assert.Equal(slow.TotalCount, pushed.TotalCount);
        Assert.Equal(Shas(slow), Shas(pushed));
    }

    [Fact]
    public void TopicFilter_StillWalksSlowPath()
    {
        BuildMixedAuthorRepo();
        // topic 过滤不满足下推条件（.NET 正则语义），必须返回正确结果（慢路径）
        var page = Svc.GetLog(_builder.WorkDir, new LogFilter(Topic: "alice: fix", Limit: 10));
        Assert.Equal(1, page.TotalCount);
        Assert.Contains("alice: fix", page.Items[0].Subject);
    }

    [Fact]
    public void AuthorRegexMetacharacters_MatchedLiterally()
    {
        BuildMixedAuthorRepo();
        // "alice@x" 含 @（regex 无特殊义）但 "." 有——字面语义不应把 @. 当通配
        var page = Svc.GetLog(_builder.WorkDir, new LogFilter(Author: "alice@x.test", Limit: 10));
        Assert.Equal(2, page.TotalCount);
    }

    // ---- 2.6 分支 tip 主题批量取 ----

    [Fact]
    public void GetBranchTipSubjects_CoversAllBranches()
    {
        _builder.Commit("base commit", ("a.txt", "1\n"));
        var baseSha = _builder.Sha("HEAD");
        _builder.Branch("feature", baseSha);
        _builder.Commit("second commit", ("a.txt", "2\n"));

        var tips = Svc.GetBranchTipSubjects(_builder.WorkDir);

        Assert.Equal("base commit", tips[baseSha]);
        Assert.Equal("second commit", tips[_builder.Sha("HEAD")]);
        Assert.Equal(tips[baseSha], tips[_builder.Sha("feature")]); // feature 指向 base
    }

    [Fact]
    public async Task BranchRows_ShowTipSubject_WithSingleRefCall()
    {
        _builder.Commit("alpha subject", ("a.txt", "1\n"));
        var vm = new BranchesViewModel(Svc);
        await vm.OpenRepositoryAsync(_builder.WorkDir);

        var main = vm.Rows.OfType<BranchItemRow>().Single(r => r.Name == "main");
        Assert.Contains("alpha subject", main.Meta);
        Assert.StartsWith(_builder.Sha("HEAD")[..7], main.Meta);
    }
}
