namespace GitUI.Core.Models;

/// <summary>
/// 统一 diff 的一个差异块。不可变。
/// 遵循 unified diff 的 <c>@@ -oldStart,oldCount +newStart,newCount @@</c> 语义。
/// </summary>
/// <param name="OldStart">旧文件起始行号（1 基）。纯新增时为 0。</param>
/// <param name="OldCount">旧文件涉及行数。为 0 时表示纯新增块。</param>
/// <param name="NewStart">新文件起始行号（1 基）。纯删除时为 0。</param>
/// <param name="NewCount">新文件涉及行数。为 0 时表示纯删除块。</param>
/// <param name="OldLines">旧侧行内容。删除行以 '-' 开头，上下文行以 ' ' 开头。</param>
/// <param name="NewLines">新侧行内容。新增行以 '+' 开头，上下文行以 ' ' 开头。</param>
public sealed record DiffHunk(
    int OldStart,
    int OldCount,
    int NewStart,
    int NewCount,
    IReadOnlyList<string> OldLines,
    IReadOnlyList<string> NewLines)
{
    /// <summary>本块新增行数（不含上下文）。</summary>
    public int AddedCount => NewLines.Count(l => l.StartsWith('+'));

    /// <summary>本块删除行数（不含上下文）。</summary>
    public int DeletedCount => OldLines.Count(l => l.StartsWith('-'));

    public static readonly DiffHunk Empty = new(
        0, 0, 0, 0,
        Array.Empty<string>(), Array.Empty<string>());
}
