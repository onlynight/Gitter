namespace GitUI.Core.Models;

/// <summary>
/// 单个文件的 diff 结果。不可变。
/// </summary>
/// <param name="Path">仓库相对路径，前导 <c>/</c> 已剥除。</param>
/// <param name="OldPath">重命名/复制前的旧路径。未重命名时为 <see cref="Path"/>。</param>
/// <param name="IsBinary">二进制文件，无法做文本 diff。</param>
/// <param name="IsNew">新文件。</param>
/// <param name="IsDeleted">已删除文件。</param>
/// <param name="IsRenamed">重命名。</param>
/// <param name="Hunks">差异块列表。二进制或空 diff 时为空。</param>
/// <param name="AddedLines">新增行数汇总。</param>
/// <param name="DeletedLines">删除行数汇总。</param>
public sealed record DiffResult(
    string Path,
    string OldPath,
    bool IsBinary,
    bool IsNew,
    bool IsDeleted,
    bool IsRenamed,
    IReadOnlyList<DiffHunk> Hunks,
    int AddedLines,
    int DeletedLines)
{
    public bool IsModified => !IsNew && !IsDeleted && !IsRenamed;

    /// <summary>统一状态字符：M/A/D/R/U（未跟踪）。</summary>
    public char StatusCode => IsNew ? 'A' : IsDeleted ? 'D' : IsRenamed ? 'R' : IsModified ? 'M' : 'U';
}
