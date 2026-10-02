using GitUI.Core.Models;

namespace GitUI.Core.Services;

/// <summary>
/// Diff 引擎抽象（S2，docs/design.md §8）。纯算法层：输入文本、输出差异块，
/// 不依赖 git / UI / 渲染。实现为 Myers O(ND) 线性空间变体（GitUI.Diff）。
/// </summary>
public interface IDiffEngine
{
    /// <summary>
    /// 计算两份文本的行级 unified diff 块（含上下文）。
    /// 行语义见 <see cref="DiffText"/>；块头语义（纯新增/纯删除的 0 计数范围）遵循 git。
    /// 两文本完全一致时返回空列表。
    /// </summary>
    IReadOnlyList<DiffHunk> ComputeHunks(string oldText, string newText, DiffOptions? options = null);

    /// <summary>
    /// 计算一对变更行内部的字级（词元级）差异，供渲染层高亮行内变化部分。
    /// 传入的行内容是原始文本（不带 diff 前缀字符）。两行相同返回单个 Equal 段。
    /// </summary>
    IReadOnlyList<WordSegment> ComputeWordDiff(string oldLine, string newLine);
}
