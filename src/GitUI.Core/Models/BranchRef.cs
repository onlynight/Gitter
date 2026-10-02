namespace GitUI.Core.Models;

/// <summary>
/// 一个分支引用。不可变。
/// </summary>
/// <param name="Name">分支友好名，如 <c>main</c>、<c>origin/main</c>（已剥 <c>refs/heads/</c> 前缀）。</param>
/// <param name="Sha">分支指向的提交 SHA。unborn 时为 <c>null</c>。</param>
/// <param name="IsLocal">是否本地分支。</param>
/// <param name="IsRemote">是否远程跟踪分支。</param>
/// <param name="IsHead">是否当前 HEAD 指向的分支。</param>
public sealed record BranchRef(
    string Name,
    string? Sha,
    bool IsLocal,
    bool IsRemote,
    bool IsHead);
