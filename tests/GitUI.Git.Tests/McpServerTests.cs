using GitUI.Core.Mcp;
using GitUI.Git;
using GitUI.Git.Mcp;
using Xunit;

namespace GitUI.Git.Tests;

/// <summary>
/// 内置 MCP server（ai-native-redesign.md §7.2）：initialize/tools 协议、各只读工具、
/// 写工具权限门、review.submit_feedback 落盘 + 变更页可读。
/// </summary>
public sealed class McpServerTests : IDisposable
{
    private readonly GitFixtureBuilder _builder;

    public McpServerTests()
    {
        var dir = Path.Combine(Path.GetTempPath(), "gitui-mcp-test-" + Guid.NewGuid().ToString("N"));
        _builder = GitFixtureBuilder.Init(dir, "main");
        _builder.Commit("base commit", ("src/app.cs", "Console.WriteLine(1);\n"));
    }

    public void Dispose() => _builder.Dispose();

    private GitterMcpServer CreateServer(bool allowWrites = false) =>
        new(new LibGit2RepositoryService(), _builder.WorkDir, new McpServerOptions(AllowWrites: allowWrites));

    private static string Req(int id, string method, object? ps = null) =>
        System.Text.Json.JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["jsonrpc"] = "2.0",
            ["id"] = id,
            ["method"] = method,
            ["params"] = ps ?? new Dictionary<string, object?>(),
        });

    // ---- 协议 ----

    [Fact]
    public async Task Initialize_ReturnsServerInfo()
    {
        var response = await CreateServer().HandleAsync(Req(1, "initialize"));
        Assert.Contains("gitter", response);
        Assert.Contains("protocolVersion", response);
        Assert.Contains("\"id\":\"1\"", response);
    }

    [Fact]
    public async Task Notification_ReturnsNull()
    {
        Assert.Null(await CreateServer().HandleAsync("{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}"));
    }

    [Fact]
    public async Task UnknownMethod_ReturnsProtocolError()
    {
        var response = await CreateServer().HandleAsync(Req(2, "no/such"));
        Assert.Contains("-32601", response);
    }

    [Fact]
    public async Task MalformedJson_ReturnsParseError()
    {
        Assert.Contains("-32700", await CreateServer().HandleAsync("{not json"));
    }

    [Fact]
    public async Task ToolsList_ContainsAllTools()
    {
        var response = await CreateServer().HandleAsync(Req(3, "tools/list"));
        foreach (var tool in new[] { "repo.status", "repo.log", "repo.diff", "repo.branches", "repo.worktrees", "repo.stage", "repo.commit", "review.submit_feedback" })
            Assert.Contains(tool, response);
    }

    // ---- 只读工具 ----

    [Fact]
    public async Task RepoStatus_ListsFile()
    {
        _builder.Write("src/new.txt", "x");
        var response = await CreateServer().HandleAsync(Req(4, "tools/call", new Dictionary<string, object?>
        {
            ["name"] = "repo.status",
            ["arguments"] = new Dictionary<string, object?>(),
        }));

        Assert.Contains("src/new.txt", response);
        Assert.DoesNotContain("isError", response);
    }

    [Fact]
    public async Task RepoLog_IncludesAiAgentTag()
    {
        _builder.Write("a.txt", "v2\n");
        _builder.Stage("a.txt");
        _builder.RunGit("commit", "-qm", "checkpoint\n\nAssisted-by: deepseek");
        var response = await CreateServer().HandleAsync(Req(5, "tools/call", new Dictionary<string, object?>
        {
            ["name"] = "repo.log",
            ["arguments"] = new Dictionary<string, object?> { ["limit"] = 10 },
        }));

        Assert.Contains("checkpoint", response);
        Assert.Contains("ai:deepseek", response);
        Assert.Contains("base commit", response);
    }

    [Fact]
    public async Task RepoDiff_ReturnsStagedPatch()
    {
        _builder.Write("src/app.cs", "Console.WriteLine(2);\n");
        _builder.Stage("src/app.cs");
        var response = await CreateServer().HandleAsync(Req(6, "tools/call", new Dictionary<string, object?>
        {
            ["name"] = "repo.diff",
            ["arguments"] = new Dictionary<string, object?> { ["path"] = "src/app.cs" },
        }));

        Assert.Contains("Console.WriteLine(2)", response);
    }

    [Fact]
    public async Task RepoWorktrees_ListsMain()
    {
        var response = await CreateServer().HandleAsync(Req(7, "tools/call", new Dictionary<string, object?>
        {
            ["name"] = "repo.worktrees",
            ["arguments"] = new Dictionary<string, object?>(),
        }));

        Assert.Contains("main", response);
    }

    [Fact]
    public async Task UnknownTool_ReturnsInvalidParams()
    {
        var response = await CreateServer().HandleAsync(Req(8, "tools/call", new Dictionary<string, object?> { ["name"] = "nope" }));
        Assert.Contains("-32602", response);
    }

    // ---- 写工具权限门（原则 1.2-2）----

    [Fact]
    public async Task RepoCommit_WithoutWritePermission_Denied()
    {
        _builder.Write("a.txt", "x\n");
        _builder.Stage("a.txt");
        var response = await CreateServer().HandleAsync(Req(9, "tools/call", new Dictionary<string, object?>
        {
            ["name"] = "repo.commit",
            ["arguments"] = new Dictionary<string, object?> { ["message"] = "from agent" },
        }));

        Assert.Contains("disabled", response);
        // 未产生新提交：HEAD 仍是 base commit
        Assert.Equal("base commit", _builder.RunGit("log", "-1", "--format=%s"));
    }

    [Fact]
    public async Task RepoCommit_WithWritePermission_Commits()
    {
        _builder.Write("a.txt", "x\n");
        _builder.Stage("a.txt");
        var response = await CreateServer(allowWrites: true).HandleAsync(Req(10, "tools/call", new Dictionary<string, object?>
        {
            ["name"] = "repo.commit",
            ["arguments"] = new Dictionary<string, object?> { ["message"] = "from agent" },
        }));

        Assert.Contains("committed", response);
        Assert.Equal("from agent", _builder.RunGit("log", "-1", "--format=%s"));
    }

    // ---- 写操作人审门（ai-native-redesign.md §7.2：无人工确认不落盘）----

    private static readonly Dictionary<string, object?> CommitArgs = new()
    {
        ["name"] = "repo.commit",
        ["arguments"] = new Dictionary<string, object?> { ["message"] = "from agent" },
    };

    private async Task PrepareStagedAsync()
    {
        _builder.Write("a.txt", "x" + Environment.NewLine);
        _builder.Stage("a.txt");
    }

    [Fact]
    public async Task WriteTool_Approved_Commits()
    {
        await PrepareStagedAsync();
        var server = new GitterMcpServer(new LibGit2RepositoryService(), _builder.WorkDir,
            new McpServerOptions(WriteApproval: _ => Task.FromResult(true)));

        var response = await server.HandleAsync(Req(20, "tools/call", CommitArgs));

        Assert.Contains("committed", response);
        Assert.Equal("from agent", _builder.RunGit("log", "-1", "--format=%s"));
    }

    [Fact]
    public async Task WriteTool_Rejected_DeniedWithoutCommit()
    {
        await PrepareStagedAsync();
        var server = new GitterMcpServer(new LibGit2RepositoryService(), _builder.WorkDir,
            new McpServerOptions(WriteApproval: _ => Task.FromResult(false)));

        var response = await server.HandleAsync(Req(21, "tools/call", CommitArgs));

        Assert.Contains("disabled", response);
        Assert.Equal("base commit", _builder.RunGit("log", "-1", "--format=%s"));
    }

    [Fact]
    public async Task WriteTool_ApprovalThrows_TreatedAsDenied()
    {
        await PrepareStagedAsync();
        var server = new GitterMcpServer(new LibGit2RepositoryService(), _builder.WorkDir,
            new McpServerOptions(WriteApproval: _ => throw new InvalidOperationException("ui gone")));

        var response = await server.HandleAsync(Req(22, "tools/call", CommitArgs));

        Assert.Contains("disabled", response);
        Assert.Equal("base commit", _builder.RunGit("log", "-1", "--format=%s"));
    }

    // ---- 反馈闭环 ----

    [Fact]
    public async Task SubmitFeedback_Persists_ReadableByChangesVm()
    {
        var response = await CreateServer().HandleAsync(Req(11, "tools/call", new Dictionary<string, object?>
        {
            ["name"] = "review.submit_feedback",
            ["arguments"] = new Dictionary<string, object?> { ["note"] = "这个 hunk 的错误处理缺失", ["path"] = "src/app.cs" },
        }));

        Assert.Contains("recorded", response);
        var feedback = AgentFeedbackStore.Read(_builder.WorkDir);
        Assert.NotNull(feedback);
        Assert.Equal("这个 hunk 的错误处理缺失", feedback!.Note);
        Assert.Equal("src/app.cs", feedback.Path);

        AgentFeedbackStore.Clear(_builder.WorkDir);
        Assert.Null(AgentFeedbackStore.Read(_builder.WorkDir));
    }
}
