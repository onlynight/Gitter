namespace GitUI.Core.Models;

/// <summary>字级差异分段的类型。</summary>
public enum WordSegmentKind
{
    /// <summary>两侧相同的内容。</summary>
    Equal,

    /// <summary>仅旧行有的内容（被删除）。</summary>
    Deleted,

    /// <summary>仅新行有的内容（被新增）。</summary>
    Inserted,
}

/// <summary>
/// 行内字级（词元级）差异的一段连续内容。不可变。
/// 一对变更行（<c>-</c> 行与对应的 <c>+</c> 行）的完整差异 =
/// Deleted 段串接为旧行内容、Inserted 段串接为新行内容、Equal 段两侧共有。
/// </summary>
/// <param name="Kind">分段类型。</param>
/// <param name="Text">该段文本（原始内容，不含 diff 前缀字符）。</param>
public sealed record WordSegment(WordSegmentKind Kind, string Text);
