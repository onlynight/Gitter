namespace GitUI.Core.Models;

/// <summary>
/// 一个 git worktree（ai-native-redesign.md §六：AI 并行任务的标准隔离单元）。
/// </summary>
public sealed record WorktreeInfo(
    string Path,
    string? Branch,
    string HeadSha,
    bool IsBare,
    bool IsMain,
    bool IsDetached)
{
    /// <summary>卡片展示名：分支名优先，否则路径末段。</summary>
    public string DisplayName => Branch ?? System.IO.Path.GetFileName(Path.TrimEnd('/', '\\'));

    /// <summary>短 SHA（≤7 位）。</summary>
    public string ShortSha => HeadSha.Length == 0 ? "" : HeadSha[..Math.Min(7, HeadSha.Length)];
}

/// <summary>git reset 模式（验收台/会话整理用）。</summary>
public enum ResetMode
{
    /// <summary>保留工作区与 index（仅移动 HEAD）——session squash 用。</summary>
    Soft = 0,
    /// <summary>重置 index，保留工作区。</summary>
    Mixed = 1,
    /// <summary>index 与工作区一起重置（丢弃改动，危险操作需确认）。</summary>
    Hard = 2,
}
