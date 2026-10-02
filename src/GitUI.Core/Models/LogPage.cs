namespace GitUI.Core.Models;

/// <summary>
/// 分页后的 Log 结果。不可变。
/// </summary>
/// <param name="Items">本页提交，按提交时间倒序。</param>
/// <param name="TotalCount">过滤条件下的提交总数（不含分页）。</param>
/// <param name="Skip">本页起始偏移。</param>
/// <param name="Limit">本页请求条数。</param>
public sealed record LogPage(
    IReadOnlyList<CommitNode> Items,
    int TotalCount,
    int Skip,
    int Limit)
{
    public bool HasMore => TotalCount > 0 && Skip + Items.Count < TotalCount;

    /// <summary>空仓库返回 1（表示"没有更多页可翻"，而不是 0）。</summary>
    public int PageCount => Limit <= 0 || TotalCount == 0
        ? 1
        : (int)Math.Ceiling((double)TotalCount / Limit);
}
