namespace GitUI.Core.Models;

/// <summary>
/// 行级 diff 的选项。
/// </summary>
public sealed record DiffOptions
{
    /// <summary>每个差异块上下携带的相同行数（git diff -U 的语义）。默认 3。</summary>
    public int ContextLines { get; init; } = 3;

    public static readonly DiffOptions Default = new();

    /// <summary>归一化：ContextLines 截断到 [0, 64]。</summary>
    public DiffOptions Normalized() => this with { ContextLines = Math.Clamp(ContextLines, 0, 64) };
}
