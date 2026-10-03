using GitUI.Core.Models;

namespace GitUI.Core.Services;

/// <summary>git CLI 操作（merge / rebase / pull 等）失败时抛出。携带 stderr 供 UI 分类展示。</summary>
public class GitOperationException : Exception
{
    /// <param name="operation">失败的操作描述（如 "merge"）。</param>
    /// <param name="stdError">git stderr 原文。</param>
    /// <param name="exitCode">git 退出码。</param>
    public GitOperationException(string operation, string stdError, int exitCode)
        : base($"{operation} 失败: {Summarize(stdError)}")
    {
        Operation = operation;
        StdError = stdError;
        ExitCode = exitCode;
    }

    public string Operation { get; }

    /// <summary>git stderr 原文（供分类与"复制完整输出"）。</summary>
    public string StdError { get; }

    public int ExitCode { get; }

    private static string Summarize(string stdError)
    {
        if (string.IsNullOrWhiteSpace(stdError)) return "未知错误";
        var line = stdError.Trim().Split('\n', StringSplitOptions.RemoveEmptyEntries)[^1].Trim();
        return line.Length > 300 ? line[..300] : line;
    }
}

/// <summary>push 失败（§5.3 三分类 + 其他），由 stderr 文本归类；UI 据此给出下一步建议并允许重试。</summary>
public sealed class PushException : GitOperationException
{
    public PushException(string stdError, int exitCode, PushFailureKind kind)
        : base("push", stdError, exitCode)
    {
        Kind = kind;
    }

    public PushFailureKind Kind { get; }

    /// <summary>分类对应的下一步建议文案（toast 展示）。</summary>
    public string Hint => Kind switch
    {
        PushFailureKind.AuthFailed => "凭据被拒绝，请检查远程仓库的登录状态后重试",
        PushFailureKind.NetworkTimeout => "无法连接远程仓库，请检查网络后重试",
        PushFailureKind.NonFastForward => "远端分支有新提交，请先拉取（Pull）再推送",
        _ => "推送失败，可重试或查看完整输出",
    };
}
