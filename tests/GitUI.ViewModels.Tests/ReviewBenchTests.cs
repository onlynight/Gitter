using GitUI.Core.Ai;
using GitUI.Core.Rules;
using GitUI.Core.Settings;
using GitUI.Git;
using Xunit;

namespace GitUI.ViewModels.Tests;

/// <summary>
/// 验收台 v1（ai-native-redesign.md §三）：风险信号扫描、拒绝此块、退回重做反馈、AI 解释。
/// </summary>
public sealed class ReviewBenchTests : IDisposable
{
    private readonly GitFixtureBuilder _builder;

    public ReviewBenchTests()
    {
        var dir = Path.Combine(Path.GetTempPath(), "gitui-review-" + Guid.NewGuid().ToString("N"));
        _builder = GitFixtureBuilder.Init(dir, "main");
    }

    public void Dispose() => _builder.Dispose();

    private async Task<ChangesViewModel> OpenVmAsync()
    {
        var vm = new ChangesViewModel(new LibGit2RepositoryService());
        await vm.OpenRepositoryAsync(_builder.WorkDir);
        return vm;
    }

    // ---- 风险信号扫描 ----

    [Fact]
    public async Task ScanRisks_FlagsSecretInWorktreeChange()
    {
        _builder.Commit("base", ("a.txt", "1\n"));
        _builder.Write("a.txt", "apiKey = AKIAIOSFODNN7EXAMPLE\n");
        var vm = await OpenVmAsync();

        await vm.ScanRisksAsync();

        Assert.Equal(SafetySeverity.Blocked, vm.RiskLevelFor("a.txt"));
        Assert.Contains(vm.FindingsFor("a.txt"), f => f.RuleId == "secret.leak");
    }

    [Fact]
    public async Task ScanRisks_CleanTree_NoFindings()
    {
        _builder.Commit("base", ("a.txt", "1\n"));
        var vm = await OpenVmAsync();

        await vm.ScanRisksAsync();

        Assert.Null(vm.RiskLevelFor("a.txt"));
        Assert.Empty(vm.FindingsFor("a.txt"));
    }

    [Fact]
    public async Task ScanRisks_StagedSecret_FoundViaIndexPatch()
    {
        _builder.Write("cfg.settings", "token = \"live-secret-987654321\"\n");
        _builder.Stage("cfg.settings");
        var vm = await OpenVmAsync();

        await vm.ScanRisksAsync();

        Assert.NotNull(vm.RiskLevelFor("cfg.settings"));
    }

    [Fact]
    public async Task ScanRisks_ExemptPaths_Honored()
    {
        _builder.Commit("base", ("a.txt", "1\n"));
        _builder.Write("a.txt", "apiKey = AKIAIOSFODNN7EXAMPLE\n");
        var vm = new ChangesViewModel(
            new LibGit2RepositoryService(),
            new CommitSafetyOptions(ExemptPaths: new[] { "a.txt" }));
        await vm.OpenRepositoryAsync(_builder.WorkDir);

        await vm.ScanRisksAsync();

        Assert.Null(vm.RiskLevelFor("a.txt"));
    }

    // ---- 拒绝此块 ----

    [Fact]
    public async Task RejectHunks_DiscardsWorktreeChange()
    {
        _builder.Commit("base", ("a.txt", "v1\n"));
        _builder.Write("a.txt", "v1\nv2-unwanted\n");
        var vm = await OpenVmAsync();
        await vm.SelectAsync(vm.Changes[0]);
        var view = vm.SelectedDiff!;
        Assert.True(view.CanStageHunks);

        await vm.RejectHunksAsync(new[] { 0 });

        // 工作区回到 index（= HEAD）状态
        Assert.Equal("v1\n", File.ReadAllText(Path.Combine(_builder.WorkDir, "a.txt")));
        Assert.Empty(vm.Changes);
    }

    [Fact]
    public async Task RejectHunks_StagedView_NoOp()
    {
        _builder.Write("a.txt", "new staged\n");
        _builder.Stage("a.txt");
        var vm = await OpenVmAsync();
        await vm.SelectAsync(vm.Staged[0]);

        await vm.RejectHunksAsync(new[] { 0 });

        // Staged 视图拒绝无效果（对应动作是撤销暂存）；index 未变
        Assert.NotEmpty(vm.Staged);
    }

    // ---- 退回重做 ----

    [Fact]
    public async Task RetakeFeedback_ContainsSelectedHunkAndNote()
    {
        _builder.Commit("base", ("a.txt", "v1\n"));
        _builder.Write("a.txt", "v1\nv2\n");
        var vm = await OpenVmAsync();
        await vm.SelectAsync(vm.Changes[0]);

        var prompt = vm.BuildRetakeFeedback(new[] { 0 }, "v2 这行逻辑不对");

        Assert.NotNull(prompt);
        Assert.Contains("a.txt", prompt);
        Assert.Contains("v2 这行逻辑不对", prompt);
        Assert.Contains("+v2", prompt);
    }

    [Fact]
    public async Task RetakeFeedback_NoSelection_ReturnsNull()
    {
        var vm = await OpenVmAsync();
        Assert.Null(vm.BuildRetakeFeedback(new[] { 0 }, "note"));
    }

    // ---- AI 解释 ----

    private sealed class FakeGateway(string reply) : IAiGateway
    {
        public bool IsConfigured => true;
        public AiPrompt? LastPrompt { get; private set; }
        public Task<string> CompleteAsync(AiPrompt prompt, CancellationToken ct = default)
        {
            LastPrompt = prompt;
            return Task.FromResult(reply);
        }
    }

    [Fact]
    public async Task Explain_SelectedFile_SendsPatchUnderFullDiff()
    {
        _builder.Commit("base", ("a.txt", "v1\n"));
        _builder.Write("a.txt", "v1\nv2\n");
        var gateway = new FakeGateway("这次改动加了 v2 行。");
        var vm = await OpenVmAsync();
        vm.UpdateAi(CommitSafetyMode.Warn, AiPrivacyLevel.FullDiff, trailerId: null, gateway);
        vm.Scope = ChangesViewModel.ExplainScope.SelectedFile;
        await vm.SelectAsync(vm.Changes[0]);

        await vm.ExplainAsync(ExplainIntent.Explain, CancellationToken.None);

        Assert.False(vm.IsExplaining);
        Assert.Equal("这次改动加了 v2 行。", vm.Explanation);
        Assert.NotNull(gateway.LastPrompt);
        Assert.Contains("+v2", gateway.LastPrompt!.User);
    }

    [Fact]
    public async Task Explain_MetadataOnly_OmitsContent()
    {
        _builder.Commit("base", ("a.txt", "v1\n"));
        _builder.Write("a.txt", "v1\nv2-secret-content\n");
        var gateway = new FakeGateway("ok");
        var vm = await OpenVmAsync();
        vm.UpdateAi(CommitSafetyMode.Warn, AiPrivacyLevel.MetadataOnly, trailerId: null, gateway);
        vm.Scope = ChangesViewModel.ExplainScope.SelectedFile;
        await vm.SelectAsync(vm.Changes[0]);

        await vm.ExplainAsync(ExplainIntent.Explain, CancellationToken.None);

        Assert.Contains("a.txt", gateway.LastPrompt!.User);
        Assert.DoesNotContain("v2-secret-content", gateway.LastPrompt.User);
    }

    [Fact]
    public async Task Explain_FullDiff_BlocksOnSecrets()
    {
        _builder.Commit("base", ("a.txt", "1\n"));
        _builder.Write("a.txt", "apiKey = AKIAIOSFODNN7EXAMPLE\n");
        var gateway = new FakeGateway("leaked");
        var vm = await OpenVmAsync();
        vm.UpdateAi(CommitSafetyMode.Warn, AiPrivacyLevel.FullDiff, trailerId: null, gateway);
        vm.Scope = ChangesViewModel.ExplainScope.SelectedFile;
        await vm.SelectAsync(vm.Changes[0]);

        await vm.ExplainAsync(ExplainIntent.Explain, CancellationToken.None);

        Assert.Null(vm.Explanation); // 未出网
        Assert.Null(gateway.LastPrompt);
        Assert.NotNull(vm.Error);
    }

    [Fact]
    public void ClearExplanation_RemovesText()
    {
        var vm = new ChangesViewModel(new LibGit2RepositoryService());
        vm.UpdateAi(CommitSafetyMode.Warn, AiPrivacyLevel.MetadataOnly, null, new FakeGateway("x"));
        Assert.False(vm.IsExplaining);

        vm.ClearExplanation(); // 无解释时安全
        Assert.Null(vm.Explanation);
    }
}
