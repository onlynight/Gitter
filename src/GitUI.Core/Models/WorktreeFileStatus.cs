namespace GitUI.Core.Models;

/// <summary>
/// 工作区单个文件的状态。不可变。
/// </summary>
/// <param name="Path">仓库相对路径。</param>
/// <param name="Category">三层分类。</param>
/// <param name="IsConflict">是否处于冲突状态。</param>
/// <param name="IsExecutable">文件是否带可执行位。</param>
/// <param name="AddedLines">新增行数（未跟踪/纯新增时可能为 null）。</param>
/// <param name="DeletedLines">删除行数。</param>
public sealed record WorktreeFileStatus(
    string Path,
    StatusCategory Category,
    bool IsConflict,
    bool IsExecutable,
    int? AddedLines,
    int? DeletedLines);
