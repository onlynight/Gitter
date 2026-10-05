using GitUI.Core.Ai;
using GitUI.Core.Settings;
using GitUI.App.Platform;

namespace GitUI.App;

/// <summary>
/// 从设置构造 <see cref="IAiGateway"/>（ai-native-redesign.md §8.1）。
/// Ollama 是 OpenAI 兼容端点的预设（endpoint 为空时默认本机 11434）；
/// key 经 DPAPI 解出，仅在内存传递。provider 关闭/配置不完整返回 null。
/// </summary>
public static class AiGatewayFactory
{
    public static IAiGateway? FromSettings(AiSettings settings)
    {
        if (!settings.IsEnabled) return null;

        var kind = AiSettings.NormalizeProvider(settings.ProviderKind);
        var endpoint = settings.Endpoint;
        if (kind == AiProviderKind.OpenAi && string.IsNullOrWhiteSpace(endpoint))
            endpoint = "http://127.0.0.1:11434/v1"; // Ollama 默认

        var config = new AiProviderConfig(
            kind,
            endpoint,
            settings.Model,
            SecretProtector.Unprotect(settings.ApiKeyProtected),
            settings.CliCommand);

        var gateway = AiGateway.Create(config);
        return gateway is { IsConfigured: true } ? gateway : null;
    }

    /// <summary>Assisted-by trailer 的溯源 id：模型名优先，否则 provider 名。</summary>
    public static string TrailerId(AiSettings settings)
    {
        var kind = AiSettings.NormalizeProvider(settings.ProviderKind);
        return string.IsNullOrWhiteSpace(settings.Model) ? kind : settings.Model.Trim();
    }
}
