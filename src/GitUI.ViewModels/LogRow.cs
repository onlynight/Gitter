using GitUI.Core.Models;

namespace GitUI.ViewModels;

/// <summary>Log 页扁平行的基类型，供 ItemsRepeater 元素工厂按类型分支构建。</summary>
public abstract record LogRow;

/// <summary>按天分组的组头行。</summary>
public sealed record LogGroupHeaderRow(
    DateTime Day,
    string Title,
    int CommitCount,
    bool IsCollapsed) : LogRow;

/// <summary>提交行上的分支 / 标签徽章。</summary>
public sealed record LogBadge(string Text, bool IsTag);

/// <summary>单个提交行。<see cref="MetaText"/> 已在 ViewModel 侧拼好（作者 · 相对时间）。</summary>
public sealed record LogCommitRow(
    CommitNode Commit,
    bool IsSelected,
    string MetaText,
    IReadOnlyList<LogBadge> Badges) : LogRow;

/// <summary>
/// agent 会话卡行（ai-native-redesign.md §5.1）：折叠时独占一行，展开后其后跟全部
/// 成员提交行。点击卡片 → LogViewModel.ToggleSession。
/// </summary>
public sealed record LogSessionRow(
    AgentSession Session,
    bool IsCollapsed,
    string Title,
    string MetaText) : LogRow;
