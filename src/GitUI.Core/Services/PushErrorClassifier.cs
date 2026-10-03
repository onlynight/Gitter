using System.Text;
using GitUI.Core.Models;

namespace GitUI.Core.Services;

/// <summary>
/// push 失败分类器（design.md §5.3：认证失败 / 网络超时 / 分支冲突 三类 + 其他）。
/// 纯文本规则，公开为静态以便单测覆盖各类 stderr 样本。
/// </summary>
public static class PushErrorClassifier
{
    public static PushFailureKind Classify(string? stdError)
    {
        var text = stdError ?? string.Empty;
        if (Contains(text,
                "Authentication fail", "could not read Username", "could not read Password",
                "access denied", "permission denied", "403", "invalid credentials",
                "logon failure", "terminal prompts disabled"))
            return PushFailureKind.AuthFailed;

        if (Contains(text,
                "Could not resolve host", "Failed to connect", "Connection timed out",
                "connection refused", "ssh: connect to host", "network is unreachable",
                "unable to access", "host unreachable", "temporary failure in name resolution"))
            return PushFailureKind.NetworkTimeout;

        if (Contains(text,
                "rejected", "non-fast-forward", "fetch first", "contains work",
                "behind its remote counterpart"))
            return PushFailureKind.NonFastForward;

        return PushFailureKind.Other;
    }

    private static bool Contains(string text, params string[] needles)
    {
        foreach (var n in needles)
        {
            if (text.Contains(n, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }
}
