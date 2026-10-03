namespace GitUI.Core.Models;

/// <summary>推送失败的分类（design.md §5.3：认证失败 / 网络超时 / 分支冲突 三类 + 其他）。</summary>
public enum PushFailureKind
{
    /// <summary>凭据错误 / 权限不足。</summary>
    AuthFailed = 0,

    /// <summary>无法解析主机、连接失败、超时。</summary>
    NetworkTimeout = 1,

    /// <summary>远端分支领先（non-fast-forward），需先拉取。</summary>
    NonFastForward = 2,

    /// <summary>其他失败。</summary>
    Other = 3,
}
