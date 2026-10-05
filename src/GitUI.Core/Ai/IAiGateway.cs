namespace GitUI.Core.Ai;

/// <summary>
/// AI 网关抽象（ai-native-redesign.md §8.1）：Gitter 不绑定模型厂商，
/// provider 由用户在设置里自配（OpenAI 兼容端点 / Anthropic / 命令行桥 / Ollama 走兼容端点）。
/// 实现必须可取消、有超时，失败抛 <see cref="AiGatewayException"/>。
/// </summary>
public interface IAiGateway
{
    /// <summary>provider 是否已配置（未配置时 UI 隐藏/禁用 AI 入口）。</summary>
    bool IsConfigured { get; }

    /// <summary>单轮补全。网络/协议/取消失败抛 <see cref="AiGatewayException"/>（OperationCanceledException 原样透传）。</summary>
    Task<string> CompleteAsync(AiPrompt prompt, CancellationToken ct = default);
}

/// <summary>一次补全请求（system + user，无多轮对话——Gitter 的 AI 用法都是单请求非交互形态）。</summary>
public sealed record AiPrompt(string System, string User, int MaxOutputTokens = 400);

/// <summary>AI 调用失败（网络 / 认证 / 限流 / 命令行桥非零退出）。</summary>
public sealed class AiGatewayException : Exception
{
    public AiGatewayException(string message) : base(message) { }
    public AiGatewayException(string message, Exception inner) : base(message, inner) { }
}
