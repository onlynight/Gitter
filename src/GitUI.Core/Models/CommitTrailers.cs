using System.Text.RegularExpressions;

namespace GitUI.Core.Models;

/// <summary>一个提交的 AI 参与元数据（trailer 解析，ai-native-redesign.md §5.2）。</summary>
public sealed record CommitAiMeta(string? AssistedBy, string? SessionId)
{
    public bool IsAi => AssistedBy is not null;

    public static CommitAiMeta None { get; } = new(null, null);
}

/// <summary>
/// 从提交 message 解析 AI 署名 trailer（纯函数）：
/// <c>Assisted-by: &lt;agent&gt;</c> 与 <c>Gitter-Session: &lt;uuid&gt;</c>。
/// 只看 message 的最后一个段落（git trailer 约定位置），大小写不敏感。
/// </summary>
public static partial class CommitTrailers
{
    [GeneratedRegex(@"^assisted-by:\s*(?<v>.+)$", RegexOptions.IgnoreCase | RegexOptions.Multiline | RegexOptions.CultureInvariant)]
    private static partial Regex AssistedBy();

    [GeneratedRegex(@"^gitter-session:\s*(?<v>.+)$", RegexOptions.IgnoreCase | RegexOptions.Multiline | RegexOptions.CultureInvariant)]
    private static partial Regex GitterSession();

    public static CommitAiMeta Read(string? message)
    {
        if (string.IsNullOrEmpty(message)) return CommitAiMeta.None;

        // git trailer 规范：最后一个段落（与正文之间隔一个空行），逐行 key: value
        var blocks = message.TrimEnd().Split(["\r\n\r\n", "\n\n"], StringSplitOptions.None);
        var trailerBlock = blocks[^1];

        var agent = AssistedBy().Match(trailerBlock);
        var session = GitterSession().Match(trailerBlock);

        if (!agent.Success && !session.Success) return CommitAiMeta.None;
        return new CommitAiMeta(
            agent.Success ? agent.Groups["v"].Value.Trim() : null,
            session.Success ? session.Groups["v"].Value.Trim() : null);
    }
}
