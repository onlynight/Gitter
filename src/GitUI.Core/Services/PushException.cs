using GitUI.Core.Models;
using GitUI.Core.Resources;

namespace GitUI.Core.Services;

/// <summary>git CLI 操作（merge / rebase / pull 等）失败时抛出。携带 stderr 供 UI 分类展示。</summary>
public class GitOperationException : Exception
{
    /// <param name="operation">失败的操作描述（如 "merge"；本地化操作名经 Strings.Op_* 取得）。</param>
    /// <param name="stdError">git stderr 原文。</param>
    /// <param name="exitCode">git 退出码。</param>
    public GitOperationException(string operation, string stdError, int exitCode)
        : base(string.Format(Strings.Git_OpFailed, operation, Summarize(stdError)))
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
        if (string.IsNullOrWhiteSpace(stdError)) return Strings.Common_UnknownError;
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
        PushFailureKind.AuthFailed => Strings.Push_HintAuthFailed,
        PushFailureKind.NetworkTimeout => Strings.Push_HintNetwork,
        PushFailureKind.NonFastForward => Strings.Push_HintNonFastForward,
        _ => Strings.Push_HintGeneric,
    };
}
