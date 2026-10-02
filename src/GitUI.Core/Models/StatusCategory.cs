namespace GitUI.Core.Models;

/// <summary>
/// 工作区三层 stage 模型分类（IntelliJ 系设计）。
/// </summary>
public enum StatusCategory
{
    /// <summary>已跟踪、工作区有改动但未 add（"Changes"）。</summary>
    Changes = 0,

    /// <summary>已 add 到 index 但未提交（"Staged for Commit"）。</summary>
    Staged = 1,

    /// <summary>未跟踪文件（"Unversioned"）。</summary>
    Unversioned = 2,

    /// <summary>merge 冲突中的文件。v1 归入 UI 的 Changes 分组展示，但保留独立标记。</summary>
    Conflict = 3,
}
