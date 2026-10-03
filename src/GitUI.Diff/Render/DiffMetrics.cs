namespace GitUI.Diff.Render;

/// <summary>
/// DiffCanvas 的布局度量。设计约束（design.md §8-S3）：行高 18px 固定栅格；
/// 字符宽为等宽字体的实测步进（Cascadia Mono 下 fontSize × 0.6），
/// 由 UI 控件在运行期测量后注入，Headless 测试直接给确定性值。
/// </summary>
public sealed record DiffMetrics
{
    /// <summary>行高（固定栅格，逻辑像素）。</summary>
    public double LineHeight { get; init; } = 18;

    /// <summary>等宽字符步进（逻辑像素）。默认 Cascadia Mono 13px 的理论值。</summary>
    public double CharWidth { get; init; } = 7.8;

    /// <summary>字号（逻辑像素）。</summary>
    public double FontSize { get; init; } = 13;

    /// <summary>行号槽内边距。</summary>
    public double GutterPadding { get; init; } = 8;

    /// <summary>tab 展开的列宽（模型层 <see cref="DiffRenderModel.ExpandTabs"/> 用同值）。</summary>
    public int TabWidth { get; init; } = 8;

    /// <summary>上下各多绘的 overscan 行数（design.md：20 行）。</summary>
    public int OverscanRows { get; init; } = 20;

    public static DiffMetrics Default { get; } = new();
}
