using GitUI.Core.Models;
using GitUI.Core.Services;
using GitUI.Git;
using Xunit;

namespace GitUI.ViewModels.Tests;

/// <summary>
/// design.md §8-S5：push 失败分类、可重试；端到端"修改工作区 → 提交并 push"。
/// 远程端 = 本地 bare 仓库（无凭据路径）。
/// </summary>
public sealed class PushFlowTests : IDisposable
{
    private readonly GitFixtureBuilder _builder;
    private readonly string _barePath;
    private readonly ChangesViewModel _vm;

    public PushFlowTests()
    {
        var dir = Path.Combine(Path.GetTempPath(), "gitui-push-test-" + Guid.NewGuid().ToString("N"));
        _builder = GitFixtureBuilder.Init(dir, "main");
        _barePath = GitFixtureBuilder.InitBare(dir + "-bare.git");
        _builder.AddRemote("origin", _barePath);
        _vm = new ChangesViewModel(new LibGit2RepositoryService());
    }

    public void Dispose() => _builder.Dispose();

    [Fact]
    public void PushErrorClassifier_ClassifiesStderr()
    {
        Assert.Equal(PushFailureKind.AuthFailed, PushErrorClassifier.Classify(
            "remote: HTTP Basic: Access denied. The provided password or token is incorrect.\nfatal: Authentication failed for 'https://host/repo.git/'"));
        Assert.Equal(PushFailureKind.NetworkTimeout, PushErrorClassifier.Classify(
            "fatal: unable to access 'https://host/repo.git/': Could not resolve host: host"));
        Assert.Equal(PushFailureKind.NetworkTimeout, PushErrorClassifier.Classify(
            "fatal: unable to access 'https://host/repo.git/': Failed to connect to host port 443 after 21000 ms: Connection timed out"));
        Assert.Equal(PushFailureKind.NonFastForward, PushErrorClassifier.Classify(
            "To https://host/repo.git/\n ! [rejected]        main -> main (non-fast-forward)\nerror: failed to push some refs to 'https://host/repo.git/'\nhint: Updates were rejected because the tip of your current branch is behind"));
        Assert.Equal(PushFailureKind.Other, PushErrorClassifier.Classify(
            "fatal: something completely unexpected"));
    }

    [Fact]
    public async Task CommitAndPush_Succeeds_ToBareRemote()
    {
        _builder.Commit("base", ("a.txt", "1\n"));
        _builder.RunGit("push", "-u", "origin", "main");   // 建立远程基线
        _builder.Write("a.txt", "2\n");
        await _vm.OpenRepositoryAsync(_builder.WorkDir);

        var outcome = await _vm.CommitAsync("test: e2e push", push: true);
        Assert.NotNull(outcome);
        Assert.Null(outcome!.PushFailure);

        // 远程 tip == 本地 tip（design.md §8-S5 端到端状态断言）
        var remoteSha = GitFixtureBuilder.RunGitIn(_barePath, "rev-parse", "HEAD");
        Assert.Equal(_builder.Sha("HEAD"), remoteSha);

        // 工作区干净
        await _vm.RefreshAsync();
        Assert.Equal("工作区干净", _vm.StatusText);
    }

    [Fact]
    public async Task Push_NonFastForward_ClassifiedAndRetryable()
    {
        _builder.Commit("base", ("a.txt", "1\n"));
        _builder.RunGit("push", "-u", "origin", "main");

        // 另一个 clone 抢先推进远程
        var otherDir = _builder.WorkDir + "-other";
        GitFixtureBuilder.RunGitIn(Path.GetTempPath(), "clone", "--quiet", _barePath, otherDir);
        File.WriteAllText(Path.Combine(otherDir, "other.txt"), "rival\n");
        GitFixtureBuilder.RunGitIn(otherDir, "add", ".");
        GitFixtureBuilder.RunGitIn(otherDir, "commit", "-m", "rival commit");
        GitFixtureBuilder.RunGitIn(otherDir, "push", "origin", "main");

        // 本地在旧基线上提交 → push 被拒
        _builder.Write("a.txt", "2\n");
        await _vm.OpenRepositoryAsync(_builder.WorkDir);
        var outcome = await _vm.CommitAsync("test: diverged push", push: true);

        Assert.NotNull(outcome);
        Assert.NotNull(outcome!.PushFailure);
        Assert.Equal(PushFailureKind.NonFastForward, outcome.PushFailure.Kind);
        Assert.False(string.IsNullOrWhiteSpace(outcome.PushFailure.Hint));
        // 提交本身生效（base + 本次提交 = 2）
        Assert.Equal(2, _builder.Count("HEAD"));

        // 重试仍失败（远程仍领先），但重试路径可执行
        var retryFailure = await _vm.RetryPushAsync();
        Assert.NotNull(retryFailure);
        Assert.Equal(PushFailureKind.NonFastForward, retryFailure!.Kind);
    }

    [Fact]
    public async Task Push_UnreachableRemote_NetworkClassification()
    {
        // 先成功 push 建立上游跟踪，再把 origin 指向不可解析域名
        _builder.Commit("base", ("a.txt", "1\n"));
        _builder.RunGit("push", "-u", "origin", "main");
        _builder.RunGit("remote", "set-url", "origin", "https://invalid.invalid/repo.git");
        _builder.Write("a.txt", "2\n");
        await _vm.OpenRepositoryAsync(_builder.WorkDir);

        var outcome = await _vm.CommitAsync("test: unreachable", push: true);
        Assert.NotNull(outcome);
        Assert.NotNull(outcome!.PushFailure);
        Assert.Equal(PushFailureKind.NetworkTimeout, outcome.PushFailure.Kind);
        // 提交生效（推送失败不影响提交）
        Assert.Equal(2, _builder.Count("HEAD"));
    }

    [Fact]
    public async Task RetryPush_WithoutFailure_IsNoop()
    {
        _builder.Commit("base", ("a.txt", "1\n"));
        await _vm.OpenRepositoryAsync(_builder.WorkDir);
        Assert.Null(await _vm.RetryPushAsync());
    }
}
