namespace GitUI.Diff.Highlighting;

/// <summary>单个语法着色片段：行内半开区间 [Start, Start+Length) + 语义样式键。</summary>
/// <remarks>样式键不含颜色——颜色由活动主题的 syntax 段提供（code-highlight-framework.md §三）。</remarks>
public sealed record SyntaxSpan(int Start, int Length, string StyleKey);

/// <summary>跨行状态占位。声明式引擎 P1 逐行无状态；脚本/C# 插件引擎可扩展（块注释、逐字字符串）。</summary>
public sealed class LineState
{
    public static readonly LineState None = new();
}

/// <summary>单行分词结果。</summary>
public sealed record LineHighlightResult(IReadOnlyList<SyntaxSpan> Spans, LineState? NextState);

/// <summary>
/// 语法高亮器统一契约（code-highlight-framework.md §四.1）：
/// 声明式引擎、脚本插件（Jint）、未来 C# ALC 插件实现同一形状。
/// 实现必须可在非 UI 线程调用且无共享可变状态。
/// </summary>
public interface ISyntaxHighlighter
{
    string Id { get; }

    string Language { get; }

    IReadOnlyList<string> Extensions { get; }

    LineHighlightResult TokenizeLine(string line, LineState? state);
}

/// <summary>空高亮器：整行 plain（注册表无匹配语言时的兜底）。</summary>
public sealed class NullHighlighter : ISyntaxHighlighter
{
    public static readonly NullHighlighter Instance = new();

    public string Id => "null";
    public string Language => "";
    public IReadOnlyList<string> Extensions { get; } = Array.Empty<string>();

    public LineHighlightResult TokenizeLine(string line, LineState? state) =>
        new(Array.Empty<SyntaxSpan>(), state);
}
