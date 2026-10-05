using GitUI.Core.Ai;
using GitUI.Core.Models;
using GitUI.Core.Settings;
using GitUI.Git;
using Xunit;

namespace GitUI.ViewModels.Tests;

/// <summary>
/// 提交前安全网与 AI 提交信息（ai-native-redesign.md §4.1 / §4.2）：
/// Off/Warn/Block 三档行为、豁免路径、AI 草稿生成与 Assisted-by trailer。
/// </summary>
public sealed class AiSafetyNetTests : IDisposable
{
    private readonly GitFixtureBuilder _builder;

    public AiSafetyNetTests()
    {
        var dir = Path.Combine(Path.GetTempPath(), "gitui-ai-safety-" + Guid.NewGuid().ToString("N"));
        _builder = GitFixtureBuilder.Init(dir, "main");
    }

    public void Dispose() => _builder.Dispose();

    private ChangesViewModel CreateVm(IAiGateway? ai = null)
    {
        var vm = new ChangesViewModel(new LibGit2RepositoryService(), new GitUI.Core.Rules.CommitSafetyOptions(), ai);
        vm.OpenRepositoryAsync(_builder.WorkDir).Wait();
        return vm;
    }

    /// <summary>写入一个含"密钥"的工作区文件并暂存（进 staged 层）。</summary>
    private void StageSecretFile(string path = "cfg/app.settings", string content = "apiKey = AKIAIOSFODNN7EXAMPLE\n")
    {
        _builder.Write(path, content);
        _builder.Stage(path);
    }

    // ---- 三档行为 ----

    [Fact]
    public async Task OffMode_NoFindings_CommitSucceeds()
    {
        StageSecretFile();
        var vm = CreateVm();
        vm.SafetyNetMode = CommitSafetyMode.Off;

        var outcome = await vm.CommitAsync("chore: config", push: false);

        Assert.NotNull(outcome);
        Assert.Empty(vm.LastFindings);
    }

    [Fact]
    public async Task WarnMode_SecretFound_CommitStillSucceeds_ButFindingRecorded()
    {
        StageSecretFile();
        var vm = CreateVm();
        vm.SafetyNetMode = CommitSafetyMode.Warn;

        var outcome = await vm.CommitAsync("chore: config", push: false);

        Assert.NotNull(outcome);
        Assert.Contains(vm.LastFindings, f => f.RuleId == "secret.leak");
    }

    [Fact]
    public async Task BlockMode_SecretFound_CommitRejected_IndexStaysStaged()
    {
        StageSecretFile();
        var vm = CreateVm();
        vm.SafetyNetMode = CommitSafetyMode.Block;

        var outcome = await vm.CommitAsync("chore: config", push: false);

        Assert.Null(outcome);
        Assert.NotNull(vm.Error);
        Assert.Contains(vm.LastFindings, f => f.Severity == GitUI.Core.Rules.SafetySeverity.Blocked);
        Assert.NotNull(vm.ErrorDetail);
        // index 保持已暂存：文件仍在 Staged 层
        Assert.Contains(vm.Staged, e => e.Path == "cfg/app.settings");
    }

    [Fact]
    public async Task BlockMode_CleanContent_CommitSucceeds()
    {
        _builder.Write("a.txt", "normal content\n");
        _builder.Stage("a.txt");
        var vm = CreateVm();
        vm.SafetyNetMode = CommitSafetyMode.Block;

        var outcome = await vm.CommitAsync("feat: clean", push: false);

        Assert.NotNull(outcome);
        Assert.Empty(vm.LastFindings);
    }

    [Fact]
    public async Task BlockMode_DebugResidue_WarningOnly_Commits()
    {
        _builder.Write("app.js", "console.log('dbg');\n");
        _builder.Stage("app.js");
        var vm = CreateVm();
        vm.SafetyNetMode = CommitSafetyMode.Block;

        var outcome = await vm.CommitAsync("feat: js", push: false);

        Assert.NotNull(outcome); // Warning 级不拦截
        Assert.Contains(vm.LastFindings, f => f.RuleId == "debug.residue");
    }

    [Fact]
    public async Task ExemptPath_SkipsScan()
    {
        StageSecretFile("secrets/sample.settings");
        var vm = new ChangesViewModel(
            new LibGit2RepositoryService(),
            new GitUI.Core.Rules.CommitSafetyOptions(ExemptPaths: new[] { "secrets/" }),
            ai: null)
        {
            SafetyNetMode = CommitSafetyMode.Block,
        };
        await vm.OpenRepositoryAsync(_builder.WorkDir);

        var outcome = await vm.CommitAsync("chore: exempted", push: false);

        Assert.NotNull(outcome);
        Assert.Empty(vm.LastFindings);
    }

    // ---- AI 生成与 trailer ----

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
    public async Task GenerateCommitMessage_UsesRecentMessages_AsFewShot()
    {
        _builder.Commit("feat: existing style", ("f.txt", "1\n"));
        _builder.Write("g.txt", "new\n");
        _builder.Stage("g.txt");
        var gateway = new FakeGateway("feat: add g file");
        var vm = CreateVm(gateway);
        vm.UpdateAi(CommitSafetyMode.Warn, AiPrivacyLevel.MetadataOnly, trailerId: "test-model", gateway);

        var draft = await vm.GenerateCommitMessageAsync();

        Assert.Equal("feat: add g file", draft);
        Assert.NotNull(gateway.LastPrompt);
        Assert.Contains("feat: existing style", gateway.LastPrompt!.System); // few-shot 在 system 段
        Assert.DoesNotContain("new\n", gateway.LastPrompt.User);             // metadata 档不含内容
        Assert.Contains("g.txt", gateway.LastPrompt.User);                   // 但含路径
    }

    [Fact]
    public async Task Commit_AfterGeneration_AppendsTrailer_Once()
    {
        _builder.Write("g.txt", "content\n");
        _builder.Stage("g.txt");
        var gateway = new FakeGateway("feat: generated");
        var vm = CreateVm();
        vm.UpdateAi(CommitSafetyMode.Warn, AiPrivacyLevel.MetadataOnly, trailerId: "test-model", gateway);

        await vm.GenerateCommitMessageAsync();
        var outcome = await vm.CommitAsync("feat: generated", push: false);

        Assert.NotNull(outcome);
        var headMessage = _builder.RunGit("log", "-1", "--format=%B");
        Assert.Contains("Assisted-by: test-model", headMessage);

        // 第二次提交不再追加（trailer 已消费）
        _builder.Write("g.txt", "content2\n");
        _builder.Stage("g.txt");
        await vm.RefreshAsync();
        await vm.CommitAsync("feat: second", push: false);
        var secondMessage = _builder.RunGit("log", "-1", "--format=%B");
        Assert.DoesNotContain("Assisted-by:", secondMessage);
    }

    [Fact]
    public async Task Commit_TrailerDisabled_NoTrailer()
    {
        _builder.Write("g.txt", "content\n");
        _builder.Stage("g.txt");
        var vm = CreateVm();

        vm.UpdateAi(CommitSafetyMode.Warn, AiPrivacyLevel.MetadataOnly, trailerId: null, new FakeGateway("feat: generated"));

        await vm.GenerateCommitMessageAsync();
        await vm.CommitAsync("feat: generated", push: false);

        var headMessage = _builder.RunGit("log", "-1", "--format=%B");
        Assert.DoesNotContain("Assisted-by:", headMessage);
    }

    [Fact]
    public async Task Generate_FullDiffPrivacy_SendsDiff_ButBlocksOnSecrets()
    {
        StageSecretFile();
        var gateway = new FakeGateway("feat: leaked");
        var vm = CreateVm(gateway);
        vm.UpdateAi(CommitSafetyMode.Warn, AiPrivacyLevel.FullDiff, trailerId: null, gateway);

        var draft = await vm.GenerateCommitMessageAsync();

        Assert.Null(draft); // secrets 预检阻断，不出网
        Assert.Null(gateway.LastPrompt);
        Assert.NotNull(vm.Error);
    }

    [Fact]
    public async Task Generate_NotConfigured_ReportsError()
    {
        var vm = CreateVm(ai: null);
        vm.UpdateAi(CommitSafetyMode.Warn, AiPrivacyLevel.MetadataOnly, null, null);

        var draft = await vm.GenerateCommitMessageAsync();

        Assert.Null(draft);
        Assert.NotNull(vm.Error);
    }

    [Fact]
    public void UpdateAi_GatewaySwap_ReflectsAvailability()
    {
        var vm = CreateVm();
        Assert.False(vm.IsAiAvailable);

        vm.UpdateAi(CommitSafetyMode.Warn, AiPrivacyLevel.MetadataOnly, null, new FakeGateway("x"));
        Assert.True(vm.IsAiAvailable);

        vm.UpdateAi(CommitSafetyMode.Warn, AiPrivacyLevel.Disabled, null, new FakeGateway("x"));
        Assert.False(vm.IsAiAvailable);
    }
}
