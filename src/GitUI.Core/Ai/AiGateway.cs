using System.Diagnostics;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using GitUI.Core.Settings;

namespace GitUI.Core.Ai;

/// <summary>provider 配置（从 <see cref="AiSettings"/> 解出明文 key 后组装；key 只在内存，不回写）。</summary>
public sealed record AiProviderConfig(
    string Kind,
    string? Endpoint = null,
    string? Model = null,
    string? ApiKey = null,
    string? CliCommand = null,
    int TimeoutSeconds = 60)
{
    public static AiProviderConfig FromSettings(AiSettings s, string? apiKey) => new(
        AiSettings.NormalizeProvider(s.ProviderKind),
        NullIfEmpty(s.Endpoint),
        NullIfEmpty(s.Model),
        apiKey,
        NullIfEmpty(s.CliCommand));

    private static string? NullIfEmpty(string? v) => string.IsNullOrWhiteSpace(v) ? null : v;
}

/// <summary>
/// <see cref="IAiGateway"/> 的默认实现：按 <see cref="AiProviderConfig.Kind"/> 分发到
/// OpenAI 兼容 / Anthropic / 命令行桥三种传输。零 SDK 依赖，直接 HTTP/进程管道。
/// </summary>
public sealed class AiGateway : IAiGateway
{
    private readonly IAiTransport _transport;

    public AiGateway(IAiTransport transport) => _transport = transport ?? throw new ArgumentNullException(nameof(transport));

    public bool IsConfigured => true;

    public Task<string> CompleteAsync(AiPrompt prompt, CancellationToken ct = default) =>
        _transport.CompleteAsync(prompt, ct);

    /// <summary>按设置构造网关；provider 未配置/关闭返回 null。</summary>
    public static IAiGateway? Create(AiProviderConfig config)
    {
        switch (config.Kind)
        {
            case AiProviderKind.OpenAi:
                if (config.Endpoint is null || config.Model is null) return null;
                return new AiGateway(new OpenAiCompatibleTransport(new HttpClient(), config));
            case AiProviderKind.Anthropic:
                if (config.Endpoint is null || config.Model is null) return null;
                return new AiGateway(new AnthropicTransport(new HttpClient(), config));
            case AiProviderKind.Cli:
                if (config.CliCommand is null) return null;
                return new AiGateway(new CliBridgeTransport(config));
            default:
                return null;
        }
    }
}

/// <summary>单种传输的最小契约（测试可注入假传输）。</summary>
public interface IAiTransport
{
    Task<string> CompleteAsync(AiPrompt prompt, CancellationToken ct);
}

/// <summary>
/// OpenAI 兼容 /chat/completions（覆盖 OpenAI、DeepSeek、Ollama 的 /v1 等所有兼容端点）。
/// Endpoint 填基础地址（如 https://api.xx.com/v1 或 http://127.0.0.1:11434/v1）。
/// </summary>
public sealed class OpenAiCompatibleTransport : IAiTransport
{
    private readonly HttpClient _http;
    private readonly AiProviderConfig _config;

    public OpenAiCompatibleTransport(HttpClient http, AiProviderConfig config)
    {
        _http = http ?? throw new ArgumentNullException(nameof(http));
        _config = config ?? throw new ArgumentNullException(nameof(config));
    }

    public async Task<string> CompleteAsync(AiPrompt prompt, CancellationToken ct)
    {
        var baseUri = _config.Endpoint!.TrimEnd('/');
        using var request = new HttpRequestMessage(HttpMethod.Post, baseUri + "/chat/completions");
        if (!string.IsNullOrEmpty(_config.ApiKey))
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _config.ApiKey);

        var body = new
        {
            model = _config.Model,
            max_tokens = prompt.MaxOutputTokens,
            stream = false,
            messages = new object[]
            {
                new { role = "system", content = prompt.System },
                new { role = "user", content = prompt.User },
            },
        };
        request.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(_config.TimeoutSeconds));
        using var response = await SendAsync(request, cts.Token).ConfigureAwait(false);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: cts.Token).ConfigureAwait(false);

        var text = json.ValueKind == JsonValueKind.Object
            && json.TryGetProperty("choices", out var choices)
            && choices.ValueKind == JsonValueKind.Array
            && choices.GetArrayLength() > 0
            && choices[0].TryGetProperty("message", out var msg)
            && msg.TryGetProperty("content", out var content)
            && content.ValueKind == JsonValueKind.String
                ? content.GetString()
                : null;
        return text is not null
            ? text
            : throw new AiGatewayException($"OpenAI-compatible endpoint returned an unexpected body: {Truncate(json.ToString())}");
    }

    private async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var response = await _http.SendAsync(request, ct).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            throw new AiGatewayException($"AI endpoint returned {(int)response.StatusCode}: {Truncate(body)}");
        }
        return response;
    }

    internal static string Truncate(string s) => s.Length <= 300 ? s : s[..300] + "…";
}

/// <summary>Anthropic /v1/messages。</summary>
public sealed class AnthropicTransport : IAiTransport
{
    private readonly HttpClient _http;
    private readonly AiProviderConfig _config;

    public AnthropicTransport(HttpClient http, AiProviderConfig config)
    {
        _http = http ?? throw new ArgumentNullException(nameof(http));
        _config = config ?? throw new ArgumentNullException(nameof(config));
    }

    public async Task<string> CompleteAsync(AiPrompt prompt, CancellationToken ct)
    {
        var baseUri = _config.Endpoint!.TrimEnd('/');
        if (!baseUri.EndsWith("/v1", StringComparison.Ordinal)) baseUri += "/v1";

        using var request = new HttpRequestMessage(HttpMethod.Post, baseUri + "/messages");
        request.Headers.Add("x-api-key", _config.ApiKey ?? string.Empty);
        request.Headers.Add("anthropic-version", "2023-06-01");

        var body = new
        {
            model = _config.Model,
            max_tokens = prompt.MaxOutputTokens,
            system = prompt.System,
            messages = new object[] { new { role = "user", content = prompt.User } },
        };
        request.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(_config.TimeoutSeconds));
        using var response = await _http.SendAsync(request, cts.Token).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            var err = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            throw new AiGatewayException($"AI endpoint returned {(int)response.StatusCode}: {OpenAiCompatibleTransport.Truncate(err)}");
        }

        var json = await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: cts.Token).ConfigureAwait(false);
        return json.ValueKind == JsonValueKind.Object
            && json.TryGetProperty("content", out var content)
            && content.ValueKind == JsonValueKind.Array
            && content.GetArrayLength() > 0
            && content[0].TryGetProperty("text", out var text)
            && text.ValueKind == JsonValueKind.String
                ? text.GetString()!
                : throw new AiGatewayException($"Anthropic endpoint returned an unexpected body: {OpenAiCompatibleTransport.Truncate(json.ToString())}");
    }
}

/// <summary>
/// 命令行桥（ai-native-redesign.md §8.1 最关键的 provider）：prompt 经 stdin 给用户自配的
/// 任意 CLI，stdout 取结果——零 SDK 依赖，天然复用用户已有订阅（如 claude -p、codex exec）。
/// </summary>
public sealed class CliBridgeTransport : IAiTransport
{
    private readonly AiProviderConfig _config;

    public CliBridgeTransport(AiProviderConfig config) => _config = config ?? throw new ArgumentNullException(nameof(config));

    public async Task<string> CompleteAsync(AiPrompt prompt, CancellationToken ct)
    {
        var (exe, args) = ParseCliCommand(_config.CliCommand!);
        var psi = new ProcessStartInfo(exe)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var a in args) psi.ArgumentList.Add(a);

        using var process = Process.Start(psi)
            ?? throw new AiGatewayException($"Failed to start AI CLI: {_config.CliCommand}");
        await process.StandardInput.WriteAsync(prompt.User.AsMemory(), ct).ConfigureAwait(false);
        process.StandardInput.Close();

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(_config.TimeoutSeconds));

        var stdoutTask = process.StandardOutput.ReadToEndAsync(cts.Token);
        var stderrTask = process.StandardError.ReadToEndAsync(cts.Token);
        try
        {
            await process.WaitForExitAsync(cts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            try { process.Kill(); } catch { /* 已退出则忽略 */ }
            throw new AiGatewayException($"AI CLI timed out after {_config.TimeoutSeconds}s.");
        }

        var stdout = await stdoutTask.ConfigureAwait(false);
        var stderr = await stderrTask.ConfigureAwait(false);
        if (process.ExitCode != 0)
            throw new AiGatewayException($"AI CLI exited with {process.ExitCode}: {OpenAiCompatibleTransport.Truncate(stderr)}");

        return stdout.Trim().Length == 0
            ? throw new AiGatewayException("AI CLI returned empty output.")
            : stdout.Trim();
    }

    /// <summary>
    /// 命令行解析：首个空格分隔段为可执行文件，其余为参数；双引号包裹的段可含空格
    /// （支持 "C:\Program Files\x\x.exe" -p 形态）。引号内无转义嵌套（AI CLI 配置足够）。
    /// </summary>
    internal static (string Exe, string[] Args) ParseCliCommand(string command)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(command);
        var tokens = new List<string>();
        var current = new StringBuilder();
        var inQuotes = false;
        foreach (var ch in command)
        {
            switch (ch)
            {
                case '"':
                    inQuotes = !inQuotes;
                    break;
                case ' ' when !inQuotes:
                    if (current.Length > 0) { tokens.Add(current.ToString()); current.Clear(); }
                    break;
                default:
                    current.Append(ch);
                    break;
            }
        }
        if (current.Length > 0) tokens.Add(current.ToString());

        return (tokens[0], tokens.Skip(1).ToArray());
    }
}
