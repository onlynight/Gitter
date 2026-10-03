using GitUI.Core.Models;

namespace GitUI.Diff.Render;

/// <summary>
/// 视觉行中的一个格：并排视图的左侧（旧内容）或右侧（新内容）。
/// 内联视图每行只有一个格，放在 <see cref="DiffRow.Left"/>。
/// </summary>
public sealed class DiffCell
{
    public DiffCell(DiffRowKind kind, string text, int oldNumber = 0, int newNumber = 0)
    {
        Kind = kind;
        Text = text;
        OldNumber = oldNumber;
        NewNumber = newNumber;
    }

    public DiffRowKind Kind { get; }

    /// <summary>格内容（tab 已展开、不含 diff 前缀字符）。</summary>
    public string Text { get; }

    /// <summary>旧文件行号（并排左格 / 内联行）。0 表示该侧无内容。</summary>
    public int OldNumber { get; }

    /// <summary>新文件行号（并排右格 / 内联行）。0 表示该侧无内容。</summary>
    public int NewNumber { get; }

    /// <summary>
    /// 行内字级差异分段（一对变更行共享同一份分段列表，含 Equal/Deleted/Inserted 全部段）。
    /// 构建时为 null，<see cref="DiffRenderModel.EnsureWordDiff"/> 惰性填充。
    /// 渲染时：删除格画 Deleted 段、新增格画 Inserted 段，Equal 段两侧都画；
    /// 未参与配对的行（纯增/删、段长不齐的余量行）保持 null，无行内高亮。
    /// </summary>
    public IReadOnlyList<WordSegment>? Words { get; internal set; }

    public bool IsChange => Kind is DiffRowKind.Added or DiffRowKind.Deleted;
}

/// <summary>
/// 一行视觉行。Left/Right 均非空 = 并排普通行（含填充侧）；
/// 仅 Left = 内联行、hunk 头分隔行或标记行。
/// </summary>
public sealed class DiffRow
{
    public DiffRow(DiffCell? left, DiffCell? right, int index)
    {
        Left = left;
        Right = right;
        Index = index;
    }

    /// <summary>左格（并排 = 旧内容；内联 = 本行唯一内容）。hunk 头/内联标记行也在这里。</summary>
    public DiffCell? Left { get; }

    /// <summary>右格（并排 = 新内容）。内联行、hunk 头行为 null。</summary>
    public DiffCell? Right { get; }

    /// <summary>在 <see cref="DiffRenderModel.Rows"/> 中的行索引。</summary>
    public int Index { get; }

    /// <summary>本行是否为 hunk 头分隔行（全宽绘制、不参与水平滚动）。</summary>
    public bool IsHunkHeader => Left?.Kind == DiffRowKind.HunkHeader;
}
