using System.Net;
using GitUI.Core.Ai;
using GitUI.Core.Settings;
using Xunit;

namespace GitUI.Core.Tests.Ai;

/// <summary>AI 网关传输层（ai-native-redesign.md §8.1）：OpenAI 兼容 / Anthropic / 命令行桥。</summary>
public sealed class AiGatewayTests
{
    /// <summary>假 HttpMessageHandler：捕获请求体，回放固定响应。</summary>
    private sealed class FakeHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public HttpRequestMessage? LastRequest;
        public string? LastBody;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            LastRequest = request;
            LastBody = await request.Content!.ReadAsStringAsync(ct);
            return respond(request);
        }

        public static HttpResponseMessage Json(string body, HttpStatusCode status = HttpStatusCode.OK) => new(status)
        {
            Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json"),
        };
    }

    private static AiPrompt Prompt => new("sys", "usr", 300);

    // ---- OpenAI 兼容 ----

    [Fact]
    public async Task OpenAiCompatible_SendsModelAndMessages_ParsesContent()
    {
        var handler = new FakeHandler(_ => FakeHandler.Json(
            """{"choices":[{"message":{"content":"feat: add thing"}}]}"""));
        var transport = new OpenAiCompatibleTransport(
            new HttpClient(handler),
            new AiProviderConfig(AiProviderKind.OpenAi, "https://api.example.com/v1", "deepseek-chat", "sk-test"));

        var text = await transport.CompleteAsync(Prompt, CancellationToken.None);

        Assert.Equal("feat: add thing", text);
        Assert.Equal("https://api.example.com/v1/chat/completions", handler.LastRequest!.RequestUri!.ToString());
        Assert.Contains("\"deepseek-chat\"", handler.LastBody);
        Assert.Contains("\"system\"", handler.LastBody);
        Assert.Contains("Bearer sk-test", handler.LastRequest.Headers.Authorization!.ToString());
    }

    [Fact]
    public async Task OpenAiCompatible_ErrorStatus_ThrowsGatewayException()
    {
        var transport = new OpenAiCompatibleTransport(
            new HttpClient(new FakeHandler(_ => FakeHandler.Json("""{"error":"rate limited"}""", HttpStatusCode.TooManyRequests))),
            new AiProviderConfig(AiProviderKind.OpenAi, "https://api.example.com/v1", "m", "k"));

        var ex = await Assert.ThrowsAsync<AiGatewayException>(() => transport.CompleteAsync(Prompt, CancellationToken.None));
        Assert.Contains("429", ex.Message);
    }

    [Fact]
    public async Task OpenAiCompatible_MalformedBody_ThrowsGatewayException()
    {
        var transport = new OpenAiCompatibleTransport(
            new HttpClient(new FakeHandler(_ => FakeHandler.Json("""{"nope":true}"""))),
            new AiProviderConfig(AiProviderKind.OpenAi, "https://api.example.com/v1", "m", null));

        await Assert.ThrowsAsync<AiGatewayException>(() => transport.CompleteAsync(Prompt, CancellationToken.None));
    }

    // ---- Anthropic ----

    [Fact]
    public async Task Anthropic_SendsSystemAndApiKey_ParsesText()
    {
        var handler = new FakeHandler(_ => FakeHandler.Json(
            """{"content":[{"type":"text","text":"fix: correct thing"}]}"""));
        var transport = new AnthropicTransport(
            new HttpClient(handler),
            new AiProviderConfig(AiProviderKind.Anthropic, "https://api.example.com", "claude-x", "ak-test"));

        var text = await transport.CompleteAsync(Prompt, CancellationToken.None);

        Assert.Equal("fix: correct thing", text);
        Assert.Equal("https://api.example.com/v1/messages", handler.LastRequest!.RequestUri!.ToString());
        Assert.Equal("ak-test", handler.LastRequest.Headers.GetValues("x-api-key").Single());
        Assert.Contains("\"system\"", handler.LastBody);
    }

    // ---- 命令行桥 ----

    [Fact]
    public async Task CliBridge_EchoesPromptFromStdin()
    {
        // cmd /c more：把 stdin 原样回显——零依赖的确定性桥接验证
        var transport = new CliBridgeTransport(new AiProviderConfig(AiProviderKind.Cli, null, null, null, "cmd /c more"));

        var text = await transport.CompleteAsync(new AiPrompt("s", "hello-ai-bridge-42"), CancellationToken.None);

        Assert.Contains("hello-ai-bridge-42", text);
    }

    [Fact]
    public async Task CliBridge_NonZeroExit_ThrowsWithStderr()
    {
        var transport = new CliBridgeTransport(new AiProviderConfig(AiProviderKind.Cli, null, null, null, "cmd /c exit /b 3"));

        var ex = await Assert.ThrowsAsync<AiGatewayException>(() => transport.CompleteAsync(Prompt, CancellationToken.None));
        Assert.Contains("3", ex.Message);
    }

    [Theory]
    [InlineData("claude -p", "claude", new[] { "-p" })]
    [InlineData("\"C:\\Program Files\\agent\\cli.exe\" --json run", "C:\\Program Files\\agent\\cli.exe", new[] { "--json", "run" })]
    [InlineData("deepseek-agent", "deepseek-agent", new string[0])]
    public void ParseCliCommand_SplitsExeAndArgs_QuoteAware(string command, string exe, string[] args)
    {
        var (parsedExe, parsedArgs) = CliBridgeTransport.ParseCliCommand(command);
        Assert.Equal(exe, parsedExe);
        Assert.Equal(args, parsedArgs);
    }

    // ---- 工厂 ----

    [Fact]
    public void Create_OffKind_ReturnsNull()
    {
        Assert.Null(AiGateway.Create(new AiProviderConfig(AiProviderKind.Off, null, null, null, null)));
        Assert.Null(AiGateway.Create(new AiProviderConfig(AiProviderKind.OpenAi, null, "m", null, null))); // 缺 endpoint
        Assert.Null(AiGateway.Create(new AiProviderConfig(AiProviderKind.Cli, null, null, null, null)));   // 缺命令
    }
}
